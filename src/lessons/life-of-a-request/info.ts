import { FACTS, IP, type InfoKey, type Journey } from './journey';

/* What the inspector card shows for each packet or piece of work. */

export type LineKind = 'strong' | 'dim' | 'add' | 'change' | 'bad';

export interface InfoLine {
  /** Field name, drawn in a left column */
  k?: string;
  v: string;
  kind?: LineKind;
}

export interface Info {
  head: string;
  tone: 'dns' | 'tcp' | 'tls' | 'req' | 'res' | 'err' | 'int';
  lines: (InfoLine | 'rule')[];
  /** Fewer lines for the phone layout */
  short?: (InfoLine | 'rule')[];
  note?: string;
}

export function infoFor(key: InfoKey, j: Journey): Info {
  const c = j.cfg;
  const tls12 = c.tls === '1.2';
  switch (key) {
    case 'dns-q':
      return {
        head: 'DNS query · UDP port 53',
        tone: 'dns',
        lines: [
          { k: 'from', v: `${IP.browser}:51712`, kind: 'dim' },
          { k: 'to', v: `${IP.resolver}:53 (resolver)`, kind: 'dim' },
          { k: 'id', v: '0x3f2a · flags: RD' },
          { k: 'question', v: 'shop.example.  IN  A', kind: 'strong' },
        ],
        short: [
          { k: 'to', v: `${IP.resolver}:53`, kind: 'dim' },
          { k: 'ask', v: 'shop.example.  IN  A', kind: 'strong' },
        ],
        note: 'RD = recursion desired: “find it for me”.',
      };
    case 'resolver':
      return {
        head: 'Resolver · cache miss',
        tone: 'dns',
        lines: [
          { v: 'cache: shop.example → miss', kind: 'dim' },
          { k: 'root', v: '→ refers to .example servers' },
          { k: '.example', v: '→ refers to ns1.shop.example' },
          { k: 'ns1', v: '→ A 203.0.113.10', kind: 'add' },
        ],
        short: [
          { v: 'root → .example → ns1.shop.example' },
          { v: 'answer: 203.0.113.10', kind: 'add' },
        ],
        note: 'The resolver caches every answer, so this is usually much faster.',
      };
    case 'dns-a':
      return {
        head: 'DNS answer',
        tone: 'dns',
        lines: [
          { k: 'id', v: '0x3f2a · flags: QR RD RA' },
          { k: 'status', v: 'NOERROR' },
          { k: 'answer', v: 'shop.example.  A  203.0.113.10', kind: 'add' },
          { k: 'ttl', v: '300 seconds' },
        ],
        short: [{ k: 'answer', v: 'A 203.0.113.10 · TTL 300', kind: 'add' }],
        note: 'The browser, the OS and the resolver all keep a copy until the TTL runs out.',
      };
    case 'syn':
    case 'syn-lost':
      return {
        head: key === 'syn-lost' ? 'TCP segment · SYN · lost' : c.dropSyn ? 'TCP segment · SYN (retransmitted)' : 'TCP segment · SYN',
        tone: key === 'syn-lost' ? 'err' : 'tcp',
        lines: [
          { k: 'ports', v: '52814 → 443', kind: 'dim' },
          { k: 'flags', v: '[SYN]', kind: 'strong' },
          { k: 'seq', v: '1043920113 (random start)' },
          { k: 'options', v: 'mss 1460 · sack · wscale 7', kind: 'dim' },
          ...(key === 'syn-lost' ? [{ v: 'dropped by a congested router', kind: 'bad' as const }] : []),
        ],
        short: [
          { k: 'flags', v: '[SYN]', kind: 'strong' },
          { k: 'seq', v: '1043920113 (random)' },
        ],
        note: key === 'syn-lost' ? 'Nobody tells the browser. It just waits for its retransmission timer.' : '“Let’s connect. My byte numbers start here.”',
      };
    case 'syn-ack':
      return {
        head: 'TCP segment · SYN-ACK',
        tone: 'tcp',
        lines: [
          { k: 'ports', v: '443 → 52814', kind: 'dim' },
          { k: 'flags', v: '[SYN, ACK]', kind: 'strong' },
          { k: 'seq', v: '2913377021 (server’s start)' },
          { k: 'ack', v: '1043920114 (your seq + 1)', kind: 'add' },
        ],
        short: [
          { k: 'flags', v: '[SYN, ACK]', kind: 'strong' },
          { k: 'ack', v: '1043920114 = seq + 1', kind: 'add' },
        ],
        note: '“Got it, mine start here.” One round trip used.',
      };
    case 'hello':
      return {
        head: 'TCP ACK + TLS ClientHello',
        tone: 'tls',
        lines: [
          { k: 'tcp', v: '[ACK] ack 2913377022', kind: 'dim' },
          { k: 'sni', v: 'shop.example', kind: 'strong' },
          { k: 'alpn', v: 'h2, http/1.1' },
          tls12 ? { k: 'versions', v: 'TLS 1.2' } : { k: 'key_share', v: 'x25519 · 32 bytes', kind: 'add' },
          { k: 'ciphers', v: tls12 ? 'ECDHE-RSA-AES128-GCM-…' : 'TLS_AES_128_GCM_SHA256, …' },
        ],
        short: [
          { k: 'sni', v: 'shop.example', kind: 'strong' },
          { k: 'alpn', v: 'h2, http/1.1' },
          ...(tls12 ? [] : [{ k: 'key_share', v: 'x25519', kind: 'add' as const }]),
        ],
        note: 'The ACK needs no reply, so the ClientHello leaves right behind it.',
      };
    case 'server-hello':
      return {
        head: 'TLS 1.3 · the server’s reply',
        tone: 'tls',
        lines: [
          { k: 'ServerHello', v: 'key_share x25519', kind: 'strong' },
          { v: '·· encrypted from here on ··', kind: 'dim' },
          { k: 'Extensions', v: 'alpn: h2' },
          { k: 'Certificate', v: 'shop.example ← Example CA', kind: 'add' },
          { k: 'CertVerify', v: 'signed by the cert’s key' },
          { k: 'Finished', v: 'MAC of the handshake' },
        ],
        short: [
          { k: 'ServerHello', v: 'key_share x25519', kind: 'strong' },
          { k: 'Certificate', v: 'shop.example', kind: 'add' },
          { k: 'Finished', v: '(encrypted)' },
        ],
        note: 'Two key shares in, one shared secret out: both sides derive the same keys.',
      };
    case 'server-hello-12':
      return {
        head: 'TLS 1.2 · the server’s reply',
        tone: 'tls',
        lines: [
          { k: 'ServerHello', v: 'ECDHE-RSA-AES128-GCM', kind: 'strong' },
          { k: 'Certificate', v: 'shop.example ← Example CA', kind: 'add' },
          { k: 'ServerKeyExchange', v: 'x25519 key, signed' },
          { k: 'ServerHelloDone', v: '(your turn)', kind: 'dim' },
        ],
        short: [
          { k: 'ServerHello', v: 'cipher chosen', kind: 'strong' },
          { k: 'Certificate', v: 'shop.example', kind: 'add' },
        ],
        note: 'Only now can the browser send its half of the key exchange, so TLS 1.2 needs a second round trip.',
      };
    case 'client-kx':
      return {
        head: 'TLS 1.2 · browser’s second flight',
        tone: 'tls',
        lines: [
          { k: 'ClientKeyExchange', v: 'x25519 key', kind: 'add' },
          { k: 'ChangeCipherSpec', v: '(switch to the new keys)', kind: 'dim' },
          { k: 'Finished', v: '(encrypted)' },
        ],
        note: 'Still no HTTP: the browser waits for the server’s Finished.',
      };
    case 'server-fin':
      return {
        head: 'TLS 1.2 · server Finished',
        tone: 'tls',
        lines: [
          { k: 'ChangeCipherSpec', v: '(switch to the new keys)', kind: 'dim' },
          { k: 'Finished', v: '(encrypted)', kind: 'strong' },
        ],
        note: 'Two round trips after the ClientHello, the request can finally go.',
      };
    case 'alert':
      return {
        head: 'TLS alert · handshake aborted',
        tone: 'err',
        lines: [
          { k: 'level', v: 'fatal', kind: 'bad' },
          { k: 'reason', v: c.cert === 'expired' ? 'certificate has expired' : 'name doesn’t match shop.example', kind: 'bad' },
          { v: 'connection closed', kind: 'dim' },
        ],
        note: 'GET /cart, and Alice’s cookie, never leave the browser.',
      };
    case 'get':
      return {
        head: c.reuse || tls12 ? 'HTTP request · inside TLS' : 'TLS Finished + HTTP request',
        tone: 'req',
        lines: [
          { v: 'GET /cart HTTP/1.1', kind: 'strong' },
          { v: 'Host: shop.example' },
          { v: 'Accept: text/html,…' },
          { v: 'Accept-Encoding: gzip, br' },
          { v: 'Cookie: session=a1f9…', kind: 'add' },
        ],
        short: [
          { v: 'GET /cart HTTP/1.1', kind: 'strong' },
          { v: 'Host: shop.example' },
          { v: 'Cookie: session=a1f9…', kind: 'add' },
        ],
        note: 'On the wire it’s all encrypted: onlookers see bytes to 203.0.113.10:443.',
      };
    case 'server':
      return {
        head: 'shop.example · thinking',
        tone: 'req',
        lines: [
          { v: '→ session a1f9… belongs to Alice' },
          { v: '→ load her cart from the database' },
          { v: '→ render the HTML' },
        ],
        short: [{ v: '→ session → cart → render HTML' }],
        note: `${c.serverMs} ms of think time. The browser can only wait.`,
      };
    case 'res':
      return {
        head: 'HTTP response',
        tone: 'res',
        lines: [
          { v: 'HTTP/1.1 200 OK', kind: 'strong' },
          { v: 'Content-Type: text/html; charset=utf-8' },
          { v: 'Content-Encoding: br' },
          { v: 'Cache-Control: no-store', kind: 'change' },
          { v: 'Strict-Transport-Security: max-age=31536000' },
          { v: `Server-Timing: db;dur=${j.timing.db}, app;dur=${j.timing.app}` },
        ],
        short: [
          { v: 'HTTP/1.1 200 OK', kind: 'strong' },
          { v: 'Content-Type: text/html', kind: 'dim' },
          { v: 'Cache-Control: no-store', kind: 'change' },
        ],
        note: `Then the body: ${FACTS.htmlKB} KB of compressed HTML, streaming in.`,
      };
    case 'sub-get':
      return {
        head: 'Two more requests',
        tone: 'req',
        lines: [
          { v: 'GET /app.css', kind: 'strong' },
          { v: 'GET /app.js', kind: 'strong' },
          { v: 'same connection: no DNS, no handshakes', kind: 'add' },
        ],
        note: 'HTTP/2 carries both side by side on the one open connection.',
      };
    case 'css-res':
      return {
        head: 'Response · app.css',
        tone: 'res',
        lines: [
          { v: 'HTTP/1.1 200 OK', kind: 'strong' },
          { v: 'Content-Type: text/css' },
          { v: 'Cache-Control: max-age=31536000, immutable', kind: 'add' },
        ],
        short: [
          { v: '200 OK · text/css', kind: 'strong' },
          { v: 'max-age=31536000, immutable', kind: 'add' },
        ],
        note: `${FACTS.cssKB} KB. Render-blocking: no paint until it’s parsed.`,
      };
    case 'js-res':
      return {
        head: 'Response · app.js',
        tone: 'res',
        lines: [
          { v: 'HTTP/1.1 200 OK', kind: 'strong' },
          { v: 'Content-Type: text/javascript' },
          { v: 'Cache-Control: max-age=31536000, immutable', kind: 'add' },
        ],
        short: [
          { v: '200 OK · text/javascript', kind: 'strong' },
          { v: 'max-age=31536000, immutable', kind: 'add' },
        ],
        note: c.script === 'defer' ? `${FACTS.jsKB} KB. Deferred: it runs after parsing, off the critical path.` : `${FACTS.jsKB} KB. The parser has been stuck waiting for exactly this.`,
      };
    case 'lb-app':
      return {
        head: 'Load balancer → app-2',
        tone: 'int',
        lines: [
          { v: 'GET /cart HTTP/1.1', kind: 'strong' },
          { v: 'X-Forwarded-For: 198.51.100.42', kind: 'add' },
          { k: 'dst', v: `${IP.app}:8080`, kind: 'change' },
        ],
        note: 'TLS usually ends at the load balancer. Inside the data center, a hop takes under a millisecond.',
      };
    case 'app':
      return {
        head: 'app-2 · handling it',
        tone: 'int',
        lines: [{ v: '→ session a1f9… = Alice' }, { v: '→ ask postgres for her cart' }, { v: '→ render the cart template' }],
        short: [{ v: 'session → query → render' }],
      };
    case 'app-db':
      return {
        head: 'app-2 → postgres',
        tone: 'int',
        lines: [
          { v: 'SELECT name, price, qty', kind: 'strong' },
          { v: '  FROM cart_items' },
          { v: '  WHERE user_id = 1042;' },
        ],
        short: [{ v: 'SELECT … FROM cart_items', kind: 'strong' }],
      };
    case 'db':
      return {
        head: 'postgres · running the query',
        tone: 'int',
        lines: [{ v: 'index scan on cart_items' }, { v: `${j.timing.db} ms`, kind: 'strong' }],
        note: 'The slowest part of the server’s time, as it often is.',
      };
    case 'db-app':
      return {
        head: 'postgres → app-2',
        tone: 'int',
        lines: [{ v: '2 rows: Trail boots, Wool socks', kind: 'add' }],
      };
    case 'app-lb':
      return {
        head: 'app-2 → load balancer',
        tone: 'int',
        lines: [
          { v: '200 OK · text/html', kind: 'strong' },
          { v: `Server-Timing: db;dur=${j.timing.db}, app;dur=${j.timing.app}`, kind: 'add' },
        ],
      };
    case 'chunk':
    default:
      return { head: 'HTML streaming in', tone: 'res', lines: [] };
  }
}
