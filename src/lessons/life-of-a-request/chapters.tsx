import type { ReactNode } from 'react';
import type { CodeSpec } from '@/components/lesson/CodeBlock';
import { Aside } from '@/components/lesson/Prose';
import type { QuizSpec } from '@/components/lesson/QuizCard';
import { Term } from '@/components/lesson/Term';
import type { LegendItem } from '@/components/stage/chrome';
import type { Callout } from '@/components/stage/overlays';
import { SIG } from '@/lib/sim/colors';
import { PH, WARM, type NetConfig, type RowId } from './journey';
import type { HudKey } from './Overlay';
import type { StepConfig } from './sim';

export const META = { slug: 'life-of-a-request', code: 'NET-01', track: 'Networking', title: 'What happens when you hit Enter' };

export type Interaction = 'syn' | 'tls' | 'cert' | 'sliders' | 'script' | 'playground';

export interface Step {
  id: string;
  title: string;
  body: ReactNode;
  cfg?: Partial<Omit<StepConfig, 'net'>> & { net?: Partial<NetConfig> };
  hud?: HudKey[];
  /** Shown on wide stages; add phone: true to keep one on phones too */
  callouts?: (Callout & { phone?: boolean })[];
  legend?: LegendItem[];
  focus?: string[];
  /** Waterfall rows to highlight */
  rows?: RowId[];
  code?: CodeSpec;
  quiz?: QuizSpec;
  predict?: ReactNode;
  interaction?: Interaction;
  overlay?: 'checks' | 'cert' | 'budget';
  extra?: 'cheatsheet';
}

export interface Chapter {
  id: string;
  title: string;
  steps: Step[];
}

const L = {
  dns: { label: 'DNS', color: PH.dns },
  tcp: { label: 'TCP handshake', color: PH.tcp },
  tls: { label: 'TLS handshake', color: PH.tls },
  req: { label: 'request', color: PH.req, shape: 'env' as const },
  res: { label: 'response', color: PH.res, shape: 'env' as const },
  parse: { label: 'parsing', color: PH.parse, shape: 'square' as const },
  render: { label: 'rendering', color: PH.render, shape: 'square' as const },
  js: { label: 'script runs', color: PH.js, shape: 'square' as const },
  lost: { label: 'lost', color: SIG.err },
  rejected: { label: 'rejected', color: SIG.err },
  blocked: { label: 'blocked', color: SIG.line, shape: 'square' as const },
  ghost: { label: 'first visit', color: SIG.text2, shape: 'ring' as const },
};

const b = (s: string) => <strong>{s}</strong>;

export const CHAPTERS: Chapter[] = [
  /* ================================================================ */
  {
    id: 'enter',
    title: 'Press Enter',
    steps: [
      {
        id: 'you-press-enter',
        title: 'You press Enter',
        cfg: { loop: true, speed: 40, loopDelay: 3.2 },
        hud: ['since', 'phase', 'fcp'],
        body: (
          <>
            <p>
              <Term k="browser">Alice</Term> types <code>https://shop.example/cart</code> and presses Enter. About a quarter of a second later her cart is
              on screen. In between, her browser talks to two other machines, trades about a dozen messages, and turns a stream of bytes into pixels.
            </p>
            <p>
              This lesson slows that quarter second down about 25 times. Packets fly between the browser, a <Term k="resolver">DNS resolver</Term> and the
              shop&apos;s <Term k="server">server</Term>. Along the bottom, a <Term k="waterfall">waterfall</Term> records every phase in real
              milliseconds, the same view your browser&apos;s DevTools shows for any page.
            </p>
            <p>Watch it once from end to end. Then we&apos;ll take it apart, one phase at a time.</p>
          </>
        ),
        callouts: [{ target: 'waterfall', text: <>every phase, in <b>real milliseconds</b></>, dir: 'up' }],
        legend: [L.dns, L.tcp, L.tls, L.req, L.res, L.render],
        code: {
          title: 'DevTools › Network › Timing',
          lang: 'http',
          code: `Queueing                        0.5 ms
!DNS Lookup                     24.0 ms
!Initial connection             80.0 ms
!  SSL                          40.0 ms
Request sent                    0.1 ms
!Waiting for server response   100.0 ms
Content Download                9.6 ms`,
          note: 'Click any request in the Network tab, then Timing. “Initial connection” includes the SSL (TLS) part.',
        },
      },
      {
        id: 'reading-the-url',
        title: 'Reading the URL',
        cfg: { view: 'url', idle: true, inspector: 'off' },
        focus: ['browser'],
        hud: ['since', 'phase'],
        body: (
          <>
            <p>
              First the browser decides what you typed. Text with a scheme or a dotted host name is a <strong>URL</strong>. Anything else becomes a
              search.
            </p>
            <p>Then it splits the URL into parts. Each part sets up a later phase of the journey:</p>
            <p>
              <Term k="url:scheme">https</Term> means encrypt everything with TLS, on port 443 since no port was typed.{' '}
              <Term k="url:host">shop.example</Term> is a name, but computers connect to IP addresses, so DNS comes first.{' '}
              <Term k="url:path">/cart</Term> is what to ask the server for, once there&apos;s a connection to ask over.
            </p>
          </>
        ),
        code: {
          title: 'the same parse, in JavaScript',
          lang: 'js',
          code: `const url = new URL('https://shop.example/cart');
url.protocol   // 'https:'
url.hostname   // 'shop.example'
!url.port       // ''  (empty: use the default, 443)
url.pathname   // '/cart'`,
        },
      },
      {
        id: 'checks-before-the-network',
        title: 'Checks before the network',
        cfg: { idle: true, inspector: 'off' },
        overlay: 'checks',
        focus: ['browser'],
        hud: ['since', 'phase'],
        body: (
          <>
            <p>Before sending a single packet, the browser checks whether it can skip some of the work.</p>
            <p>
              {b('HSTS.')} Browsers remember which sites must only ever use https, from a list built into the browser and from the{' '}
              <code>Strict-Transport-Security</code> header of sites they&apos;ve seen. shop.example is on that list, so even a typed{' '}
              <code>http://</code> would be rewritten to <code>https://</code> right here. No request ever travels unencrypted.
            </p>
            <p>
              {b('Service worker.')} A site can install a script that answers requests from its own cache, even offline. None is registered yet.
            </p>
            <p>
              {b('HTTP cache.')} Is a fresh copy of <code>/cart</code> already stored? Not this time. Off to the network.
            </p>
            <Aside>In DevTools, an HSTS upgrade shows up as a “307 Internal Redirect” that never touched the network.</Aside>
          </>
        ),
        code: {
          title: 'the header behind HSTS',
          lang: 'http',
          code: `HTTP/1.1 200 OK
!Strict-Transport-Security: max-age=31536000; includeSubDomains`,
          note: 'After seeing this once, a browser upgrades every http:// URL for the site to https:// for a year. Sites can also apply to be built into browsers’ HSTS preload list, which protects even the very first visit.',
        },
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'dns',
    title: 'Find the server',
    steps: [
      {
        id: 'dns-lookup',
        title: 'Where is shop.example?',
        cfg: { from: 0, to: 'dnsEnd', speed: 8 },
        focus: ['browser', 'resolver'],
        rows: ['dns'],
        hud: ['since', 'phase'],
        body: (
          <>
            <p>
              The browser needs an IP address for <code>shop.example</code>. It checks its own DNS cache, then the operating system&apos;s. Both miss.
            </p>
            <p>
              So it asks a <Term k="resolver">recursive resolver</Term>, usually run by the ISP or a public DNS service. The resolver doesn&apos;t
              know either, so it walks the DNS tree (root → <code>.example</code> → shop.example&apos;s own name server) and brings back the answer:{' '}
              <code>203.0.113.10</code>.
            </p>
            <p>
              The answer carries a <strong>TTL</strong> of 300 seconds: everyone along the way may cache it for five minutes. Total: 24 ms, the first
              bar in the <Term k="row:dns">waterfall</Term>. The card under the path shows the actual query and answer.
            </p>
            <Aside>Browsers ask for IPv4 (A) and IPv6 (AAAA) addresses in parallel. The DNS lesson follows the resolver&apos;s walk hop by hop.</Aside>
          </>
        ),
        callouts: [{ target: 'resolver', text: <>the <b>resolver</b> does the legwork</>, dir: 'right' }],
        legend: [L.dns],
        code: {
          title: 'terminal',
          lang: 'shell',
          code: `$ dig shop.example A

;; QUESTION SECTION:
;shop.example.            IN   A

;; ANSWER SECTION:
!shop.example.     300    IN   A    203.0.113.10

!;; Query time: 24 msec`,
        },
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'tcp',
    title: 'Open a connection',
    steps: [
      {
        id: 'can-it-send-yet',
        title: 'Can it send the request yet?',
        cfg: { from: 0, to: 'reqArrive', predict: 'order', speed: 28, loopDelay: 2.2 },
        hud: ['since', 'phase', 'rtts'],
        body: (
          <>
            <p>
              The browser has an address. Can it just send <code>GET /cart</code> to <code>203.0.113.10</code>?
            </p>
            <p>
              Your turn. The animation freezes at each decision point: <strong>pick what the browser does next</strong>, then watch it happen.
            </p>
          </>
        ),
        predict: 'What has to happen before GET /cart can leave the browser?',
        legend: [L.dns, L.tcp, L.tls, L.req],
      },
      {
        id: 'three-way-handshake',
        title: 'The three-way handshake',
        cfg: { view: 'seq', from: 'dnsEnd', to: 84, speed: 16 },
        rows: ['tcp'],
        hud: ['since', 'rtts'],
        body: (
          <>
            <p>
              <strong>TCP</strong> gives both sides a reliable, ordered stream of bytes. To set one up, they trade three segments: {b('SYN')} (“let&apos;s
              talk, my byte numbers start here”), {b('SYN-ACK')} (“got it, mine start here”) and {b('ACK')}.
            </p>
            <p>
              This is a sequence diagram: time runs downward, and each arrow slopes because a packet takes 20 ms to cross. The browser can&apos;t send
              anything useful until the SYN-ACK is back. That&apos;s one full <strong>round trip time (RTT)</strong>: 40 ms here.
            </p>
            <p>
              40 ms is roughly a server a couple of thousand kilometers away. Light in fiber covers about 200 km per millisecond, and real routes
              zigzag.
            </p>
            <Aside>The last ACK costs no extra wait: the browser sends it together with its first real data, the TLS ClientHello.</Aside>
          </>
        ),
        legend: [L.tcp, L.tls],
        code: {
          title: 'tcpdump on Alice’s machine',
          lang: 'shell',
          code: `$ sudo tcpdump -nS host 203.0.113.10
!.024 IP …42.52814 > …10.443: Flags [S], seq 1043920113
!.064 IP …10.443 > …42.52814: Flags [S.], seq 2913377021, ack 1043920114
!.064 IP …42.52814 > …10.443: Flags [.], ack 2913377022`,
          note: 'Trimmed for width. tcpdump writes SYN as [S], SYN-ACK as [S.] and a bare ACK as [.]. The timestamps are 40 ms apart: one round trip.',
        },
      },
      {
        id: 'lose-the-syn',
        title: 'Break it: lose the SYN',
        cfg: { from: 'dnsEnd', to: 'tlsEnd', speed: 26, loop: true, loopDelay: 2.4 },
        rows: ['tcp'],
        hud: ['since', 'phase'],
        interaction: 'syn',
        body: (
          <>
            <p>The internet drops packets: a router&apos;s queue overflows, a Wi-Fi frame gets garbled. What if the very first one vanishes?</p>
            <p>
              Nobody tells the browser. Its operating system simply hears nothing back, so it waits for a <strong>retransmission timeout</strong> (RTO)
              of one second, then sends the SYN again. Try it, and watch the TCP row of the waterfall.
            </p>
          </>
        ),
        legend: [L.tcp, L.tls, L.lost],
        code: {
          title: 'Linux',
          lang: 'shell',
          code: `!$ sysctl net.ipv4.tcp_syn_retries
!net.ipv4.tcp_syn_retries = 6
# the wait doubles after each loss: 1 s, 2 s, 4 s, 8 s…
# after 6 retries (about 2 minutes) connect() gives up`,
          note: 'The first timeout is 1 second (RFC 6298), far longer than a round trip, because the sender has no RTT measurement yet.',
        },
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'tls',
    title: 'Make it private',
    steps: [
      {
        id: 'tls-handshake',
        title: 'TLS 1.3: one more round trip',
        cfg: { view: 'seq', from: 'dnsEnd', to: 'reqArrive', speed: 18 },
        rows: ['tls'],
        hud: ['since', 'rtts'],
        body: (
          <>
            <p>
              The URL says <code>https</code>, so before any HTTP, the browser and server must agree on encryption keys, and the browser must make sure
              it&apos;s really talking to shop.example.
            </p>
            <p>
              In <strong>TLS 1.3</strong> that takes one round trip. The {b('ClientHello')} names the site (SNI), offers protocols (ALPN:{' '}
              <code>h2</code>) and already carries the browser&apos;s half of a key exchange. The server answers with its half, its{' '}
              {b('certificate')} and a {b('Finished')} message, already encrypted.
            </p>
            <p>
              Now both sides can compute the same secret keys. The browser sends its own Finished and, in the same flight, the HTTP request. That makes
              two round trips spent before a single byte of HTTP, and the request itself needs a third.
            </p>
            <Aside>
              Classic TLS 1.2 needs two round trips. Browsers later bolted on a shortcut (False Start) that sends the request one round trip early;
              TLS 1.3 made that the design.
            </Aside>
          </>
        ),
        interaction: 'tls',
        legend: [L.tcp, L.tls, L.req],
        code: {
          title: 'terminal',
          lang: 'shell',
          code: `$ curl -v https://shop.example/cart
* Connected to shop.example (203.0.113.10) port 443
* ALPN: curl offers h2,http/1.1
!* TLSv1.3 (OUT), TLS handshake, Client hello (1):
!* TLSv1.3 (IN), TLS handshake, Server hello (2):
* TLSv1.3 (IN), TLS handshake, Encrypted Extensions (8):
* TLSv1.3 (IN), TLS handshake, Certificate (11):
* TLSv1.3 (IN), TLS handshake, CERT verify (15):
!* TLSv1.3 (IN), TLS handshake, Finished (20):
!* TLSv1.3 (OUT), TLS handshake, Finished (20):
* SSL connection using TLSv1.3 / TLS_AES_128_GCM_SHA256
* ALPN: server accepted h2`,
        },
      },
      {
        id: 'certificate-check',
        title: 'Is it really shop.example?',
        cfg: { from: 'tcpEnd', to: 'reqArrive', speed: 18, inspector: 'off', loop: true, loopDelay: 3 },
        overlay: 'cert',
        interaction: 'cert',
        rows: ['tls'],
        hud: ['since', 'phase'],
        body: (
          <>
            <p>
              Anyone on the path could claim to be shop.example. The <strong>certificate</strong> proves it: a certificate authority (CA) checked that
              the site&apos;s owner controls the name, then signed the certificate. Browsers trust a small set of root CAs built into the OS or the
              browser itself.
            </p>
            <p>
              The browser checks that the signatures chain up to a trusted root, that the certificate covers <code>shop.example</code>, and that
              it&apos;s within its validity dates. Break it and see what happens.
            </p>
          </>
        ),
        legend: [L.tcp, L.tls, L.rejected],
        code: {
          title: 'terminal',
          lang: 'shell',
          code: `$ openssl s_client -connect shop.example:443 -servername shop.example
depth=2 CN = Example Root CA
depth=1 CN = Example Issuing CA 1
depth=0 CN = shop.example
…
!Verify return code: 0 (ok)`,
          note: 'With an expired certificate the last line reads: Verify return code: 10 (certificate has expired).',
        },
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'http',
    title: 'Ask and wait',
    steps: [
      {
        id: 'the-request',
        title: 'The HTTP request',
        cfg: { from: 'tlsEnd', to: 'reqArrive', speed: 10, loop: true, loopDelay: 3.4, pin: 'get' },
        rows: ['wait'],
        hud: ['since', 'rtts'],
        body: (
          <>
            <p>
              Finally, the request itself: a request line (method, path, version), then headers. <code>Host</code> says which site, since one IP
              address can host many. <code>Cookie</code> carries Alice&apos;s session, which is how the server knows whose cart to show.
            </p>
            <p>
              It travels inside the TLS connection, so anyone on the path sees only encrypted bytes heading to <code>203.0.113.10:443</code>. They can
              tell <em>that</em> Alice visits the shop, but not which page, and they never see the cookie.
            </p>
            <Aside>
              We show HTTP/1.1 text because it&apos;s readable. Over HTTP/2 (the <code>h2</code> the server accepted), the same fields travel as
              compressed binary frames, and <code>Host</code> becomes <code>:authority</code>.
            </Aside>
          </>
        ),
        legend: [L.req],
        code: {
          title: 'the request, as HTTP/1.1 text',
          lang: 'http',
          code: `!GET /cart HTTP/1.1
!Host: shop.example
User-Agent: Mozilla/5.0 (Macintosh; …) Chrome/…
Accept: text/html,application/xhtml+xml,…
Accept-Encoding: gzip, deflate, br, zstd
Accept-Language: en-US,en;q=0.9
!Cookie: session=a1f9c2…`,
        },
      },
      {
        id: 'behind-the-address',
        title: 'Behind 203.0.113.10',
        cfg: { cluster: true, from: 'reqArrive', to: 'ttfb', speed: 20, slow: ['internal'], loop: true, loopDelay: 3 },
        rows: ['wait'],
        hud: ['since', 'ttfb'],
        body: (
          <>
            <p>
              The address might be a single machine. Often it&apos;s a <Term k="server">load balancer</Term> that forwards the request to an{' '}
              <Term k="app">app server</Term>, which asks a <Term k="db">database</Term> for Alice&apos;s cart and renders the HTML.
            </p>
            <p>
              All of that is the server&apos;s <strong>think time</strong>: 60 ms here, mostly the database query. The browser can only wait. The{' '}
              <code>Server-Timing</code> header can report where the time went.
            </p>
            <p>
              The first byte of the response lands 204 ms after Enter: 24 ms of DNS, three 40 ms round trips, and 60 ms of thinking. That moment is the{' '}
              <strong>time to first byte (TTFB)</strong>.
            </p>
          </>
        ),
        callouts: [{ target: 'db', text: <>most of the <b>think time</b></>, dir: 'down' }],
        legend: [L.req, L.res],
        code: {
          title: 'response headers',
          lang: 'http',
          code: `HTTP/1.1 200 OK
Content-Type: text/html; charset=utf-8
!Server-Timing: db;dur=37;desc="cart query"
!Server-Timing: app;dur=21`,
          note: 'A header may repeat. DevTools shows Server-Timing entries in the Timing tab, right under the browser’s own phases.',
        },
      },
      {
        id: 'distance-vs-think-time',
        title: 'Try it: distance vs. think time',
        cfg: { staticWf: true, loop: true, fit: 6.5, inspector: 'off', loopDelay: 1.2 },
        overlay: 'budget',
        interaction: 'sliders',
        hud: ['ttfb', 'fcp', 'rtts'],
        body: (
          <>
            <p>
              Two numbers shape this whole waterfall: how far away the server is (the RTT) and how long it thinks. Drag them and watch the bars
              stretch.
            </p>
            <p>
              On a cold https visit the first byte needs <strong>three round trips</strong> to the server (TCP, TLS, the request) plus DNS and think
              time. So distance <em>multiplies</em> while think time only adds once. That&apos;s why big sites put servers, or at least a CDN, close to
              their users.
            </p>
          </>
        ),
        legend: [L.dns, L.tcp, L.tls, L.req, L.res, L.render],
        quiz: {
          question: 'Alice is in Sydney; the server is in Virginia, about 200 ms round trip away. It thinks for 50 ms. Roughly when does the first byte arrive on a cold https visit?',
          options: [
            { text: 'About 250 ms', why: 'That counts just one round trip. TCP and TLS each need their own before the request can even leave.' },
            { text: 'About 450 ms', why: 'Close, but that’s two round trips. Cold https needs three: TCP, TLS, and the request itself.' },
            { text: 'About 670 ms', correct: true, why: 'DNS (~20 ms) + 3 × 200 ms + 50 ms. Distance dominates: halving the server time would save 25 ms, a nearby CDN edge could save hundreds.' },
          ],
        },
        code: {
          title: 'measure it for real users',
          lang: 'js',
          code: `const [nav] = performance.getEntriesByType('navigation');
nav.domainLookupEnd - nav.domainLookupStart   // DNS
nav.connectEnd - nav.connectStart             // TCP + TLS
!nav.connectEnd - nav.secureConnectionStart    // TLS alone
!nav.responseStart - nav.requestStart          // request → first byte
nav.responseStart                             // TTFB, since navigation start`,
        },
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'render',
    title: 'Bytes to pixels',
    steps: [
      {
        id: 'the-response',
        title: 'The response streams in',
        cfg: { from: 'resSent', to: 'dlEnd', speed: 9, loop: true, loopDelay: 3.2, pin: 'res' },
        rows: ['wait', 'download'],
        hud: ['since', 'ttfb'],
        body: (
          <>
            <p>
              The response starts with a status line and headers, then the body: 12 KB of HTML, compressed with Brotli (<code>br</code>).
            </p>
            <p>
              Two headers matter later. <code>Cache-Control: no-store</code> says never keep a copy: a cart is personal and changes. And{' '}
              <code>Strict-Transport-Security</code> is the header that teaches browsers the HSTS rule from the first chapter.
            </p>
            <p>The browser doesn&apos;t wait for the whole file. It starts parsing the moment the first bytes arrive.</p>
            <Aside>
              We model a download as size ÷ bandwidth. Real TCP also starts slowly (slow start): a new connection sends about 14 KB in its first round
              trip, which is why keeping the start of a page small pays off.
            </Aside>
          </>
        ),
        legend: [L.res],
        code: {
          title: 'the response',
          lang: 'http',
          code: `!HTTP/1.1 200 OK
Content-Type: text/html; charset=utf-8
Content-Encoding: br
!Cache-Control: no-store
Strict-Transport-Security: max-age=31536000
Server-Timing: db;dur=37, app;dur=21

<!doctype html>
<html>
<head>
  <link rel="stylesheet" href="/app.css">
  …`,
        },
      },
      {
        id: 'dom-and-cssom',
        title: 'Building the DOM and CSSOM',
        cfg: { view: 'render', from: 'ttfb', to: 'fcp', predict: 'paint', slow: ['parse', 'render'], speed: 22, loopDelay: 2.2 },
        rows: ['parse', 'css', 'js'],
        hud: ['since', 'phase'],
        body: (
          <>
            <p>
              The HTML parser turns bytes into tokens, and tokens into the <Term k="dom">DOM</Term>: the tree of elements your JavaScript sees.
            </p>
            <p>
              In the <code>&lt;head&gt;</code> it finds <code>app.css</code> and <code>app.js</code> and requests both over the connection that&apos;s
              already open: no DNS, no handshakes, just one round trip. When the CSS arrives it becomes the <Term k="cssom">CSSOM</Term>, every rule
              parsed.
            </p>
            <p>The DOM is ready well before the CSS. Predict what the browser does in between.</p>
          </>
        ),
        predict: 'The DOM is built, but app.css is still downloading. What does the browser do?',
        legend: [L.parse, L.req, L.res, L.render],
        code: {
          title: 'cart.html',
          lang: 'http',
          code: `<!doctype html>
<html>
<head>
!  <link rel="stylesheet" href="/app.css">
!  <script src="/app.js" defer></script>
</head>
<body>
  <header>…</header>
  <h1>Your cart</h1>
  <ul class="items">…</ul>
  <div class="promo">…</div>
  <button class="btn">Checkout</button>
</body>`,
        },
      },
      {
        id: 'layout-paint-composite',
        title: 'Layout, paint, composite',
        cfg: { view: 'render', from: 'cssReady', to: 'fcp', slow: ['render'], speed: 22, loop: true, loopDelay: 3.4 },
        rows: ['layout', 'paint'],
        hud: ['since', 'fcp'],
        body: (
          <>
            <p>
              With the DOM and CSSOM ready, the browser combines them into a <Term k="render tree">render tree</Term>: only what will be visible, each
              node with its final style. The <code>&lt;head&gt;</code> and the hidden promo banner are left out.
            </p>
            <p>
              <Term k="layout">Layout</Term> works out where every box goes and how big it is. <Term k="paint">Paint</Term> records the drawing
              commands: backgrounds, text, borders. <Term k="composite">Composite</Term> turns them into pixels and stacks the layers into the final
              frame, mostly on the GPU.
            </p>
            <p>
              At 277 ms Alice sees her cart: the <strong>first contentful paint</strong>. The product photos aren&apos;t here yet. Images never block
              rendering; they fill in when they arrive.
            </p>
          </>
        ),
        legend: [L.render],
        code: {
          title: 'app.css',
          lang: 'http',
          code: `/* changes geometry: layout, paint, composite */
.cart { width: 50%; }

/* changes pixels only: paint, composite */
.btn:hover { background: gold; }

!/* moves a layer: composite only */
!.toast { transform: translateY(-8px); opacity: 0.9; }`,
          note: 'Animating transform and opacity skips layout and paint, which is why smooth animations stick to them.',
        },
      },
      {
        id: 'a-blocking-script',
        title: 'Break it: a blocking script',
        cfg: { view: 'render', from: 'ttfb', to: 'end', speed: 30, slow: ['parse'], loop: true, loopDelay: 2.6 },
        interaction: 'script',
        rows: ['parse', 'js'],
        hud: ['since', 'fcp'],
        body: (
          <>
            <p>
              A plain <code>&lt;script src&gt;</code> in the head stops the parser. The browser must download and run the script before reading any
              further, because the script might change the document it&apos;s parsing.
            </p>
            <p>
              Remove <code>defer</code> and watch the Parse row stall until the 90 KB <code>app.js</code> arrives and runs. First paint slips from 277
              ms to 365 ms, and the page shows nothing at all in between.
            </p>
            <Aside>
              While the parser is stuck, a <strong>preload scanner</strong> reads ahead and starts downloading anything else it spots, like images
              further down the page. It can fetch, but it can&apos;t build the DOM.
            </Aside>
          </>
        ),
        legend: [L.parse, L.blocked, L.js, L.render],
        code: {
          title: 'cart.html · <head>',
          lang: 'http',
          code: `<!-- blocks the parser until downloaded and run -->
<script src="/app.js"></script>

<!-- downloads in parallel, runs after parsing, in order -->
!<script src="/app.js" defer></script>

<!-- downloads in parallel, runs the moment it arrives -->
<script src="/app.js" async></script>`,
        },
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'repeat',
    title: 'The second visit',
    steps: [
      {
        id: 'come-back-later',
        title: 'Come back a minute later',
        cfg: { net: WARM, ghost: true, predict: 'repeat', from: 0, to: 'fcp', speed: 22, loopDelay: 2.2 },
        hud: ['since', 'first'],
        body: (
          <>
            <p>
              A minute later, Alice clicks a link back to her cart. The dashed outlines in the waterfall are her first visit: 277 ms to first paint.
            </p>
            <p>
              The browser remembers a lot from last time. <strong>Predict what it can skip</strong> this time; the animation pauses at each decision.
            </p>
          </>
        ),
        predict: 'What can the browser skip on the second visit?',
        legend: [L.req, L.res, L.render, L.ghost],
      },
      {
        id: 'why-its-faster',
        title: 'Why it’s twice as fast',
        cfg: { net: WARM, ghost: true, from: 0, to: 'end', loop: true, speed: 26, loopDelay: 2.6 },
        hud: ['fcp', 'first'],
        body: (
          <>
            <p>
              {b('DNS:')} the answer is still within its 300 s TTL. {b('Connection:')} the browser kept it open (<strong>keep-alive</strong>) and the
              server hasn&apos;t closed it yet, so no TCP or TLS handshakes. {b('app.css and app.js:')} served with a one-year{' '}
              <code>max-age</code>, so they come straight from the disk cache.
            </p>
            <p>
              Only the personal HTML makes a round trip. First paint drops from 277 ms to 126 ms, and the gap grows with distance: at a 150 ms RTT
              it&apos;s 717 ms versus 236 ms.
            </p>
            <Aside>
              If the connection had closed, <strong>TLS session resumption</strong> would still skip the certificate work. And HTTP/3 runs over QUIC,
              which folds the transport and TLS handshakes into a single round trip.
            </Aside>
          </>
        ),
        legend: [L.req, L.res, L.render, L.ghost],
        code: {
          title: 'nginx.conf',
          lang: 'nginx',
          code: `!keepalive_timeout 75s;     # keep idle connections open

location = /cart {
!    add_header Cache-Control "no-store";   # personal: always fresh
}

location ~* \\.(css|js)$ {
    # real file names carry a content hash: app.3f9a1c.css
!    add_header Cache-Control "public, max-age=31536000, immutable";
}`,
          note: 'A new release gets new file names, so “cache for a year” never serves stale code.',
        },
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'recap',
    title: 'Recap & playground',
    steps: [
      {
        id: 'cheat-sheet',
        title: 'Cheat sheet',
        cfg: { loop: true, speed: 40, loopDelay: 3 },
        hud: ['since', 'phase', 'fcp'],
        extra: 'cheatsheet',
        body: <p>The whole journey on one page. The waterfall on the stage replays the cold visit.</p>,
        legend: [L.dns, L.tcp, L.tls, L.req, L.res, L.render],
        quiz: {
          question: 'curl prints time_connect 0.064 and time_appconnect 0.104. How long did the TLS handshake take?',
          options: [
            { text: '104 ms', why: 'curl’s numbers are cumulative from the start, so 0.104 also includes DNS and TCP.' },
            { text: '40 ms', correct: true, why: 'Subtract: 0.104 − 0.064 = 0.040 s. One round trip, as TLS 1.3 promises.' },
            { text: '64 ms', why: 'That’s when TCP finished, counted from the start (DNS included).' },
          ],
        },
        code: {
          title: 'terminal',
          lang: 'shell',
          code: `$ curl -so /dev/null https://shop.example/cart -w '
  dns   %{time_namelookup}
  tcp   %{time_connect}
  tls   %{time_appconnect}
  ttfb  %{time_starttransfer}
  total %{time_total}\\n'

!  dns   0.024
!  tcp   0.064
!  tls   0.104
!  ttfb  0.204
  total 0.214`,
          note: 'Every number is cumulative from the start. Subtract neighbors to get each phase.',
        },
      },
      {
        id: 'playground',
        title: 'Playground',
        cfg: { staticWf: true, loop: true, fit: 6.5, inspector: 'off', loopDelay: 1.2, net: { rtt: 80, serverMs: 120, tls: '1.2', script: 'blocking' } },
        overlay: 'budget',
        interaction: 'playground',
        hud: ['ttfb', 'fcp', 'rtts'],
        body: (
          <p>
            Every knob from the lesson in one place. This site starts out slow: far away, TLS 1.2, a blocking script, nothing cached. Fix it, and take
            on the challenges below.
          </p>
        ),
        legend: [L.dns, L.tcp, L.tls, L.req, L.res, L.render],
      },
    ],
  },
];
