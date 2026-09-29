/**
 * Network stand-ins for the nginx lessons: a relay that adds latency and
 * records every byte, apps and origins that record what reached them,
 * tiny memcached servers, and runners for curl and openssl.
 */
import { execFile, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import http2 from 'node:http2';
import https from 'node:https';
import net from 'node:net';
import path from 'node:path';
import tls from 'node:tls';
import { testCert } from './confs';
import { tmpDir } from './procs';

const closeServer = (s: net.Server) => new Promise<void>((r) => s.close(() => r()));

/* ------------------------------------------------------------------ */
/* A slow network                                                      */
/* ------------------------------------------------------------------ */

export interface Relayed {
  /** performance.now() when the client connected */
  t0: number;
  /** Bytes from the client, stamped (ms after t0) when they left the client */
  up: { t: number; b: Buffer }[];
  /** Bytes from the server, stamped (ms after t0) when they reached the client */
  down: { t: number; b: Buffer }[];
}

/**
 * A TCP relay to 127.0.0.1:`target` that holds every chunk for `oneWayMs`
 * in each direction, so the server looks `2 × oneWayMs` of round trip away.
 * (TCP's own handshake with the relay stays instant.)
 */
export async function delayProxy(target: number, oneWayMs: number) {
  const conns: Relayed[] = [];
  const sockets = new Set<net.Socket>();
  const server = net.createServer((c) => {
    const rec: Relayed = { t0: performance.now(), up: [], down: [] };
    conns.push(rec);
    const u = net.connect(target, '127.0.0.1');
    sockets.add(c);
    sockets.add(u);
    const later = (fn: () => void) => setTimeout(fn, oneWayMs);
    c.on('data', (b) => {
      rec.up.push({ t: performance.now() - rec.t0, b });
      later(() => !u.destroyed && u.write(b));
    });
    u.on('data', (b) =>
      later(() => {
        rec.down.push({ t: performance.now() - rec.t0, b });
        if (!c.destroyed) c.write(b);
      }),
    );
    c.on('end', () => later(() => u.end()));
    u.on('end', () => later(() => c.end()));
    c.on('close', () => later(() => u.destroy()));
    u.on('close', () => later(() => c.destroy()));
    c.on('error', () => {});
    u.on('error', () => {});
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  return {
    port: (server.address() as net.AddressInfo).port,
    rtt: 2 * oneWayMs,
    conns,
    close: async () => {
      for (const s of sockets) s.destroy();
      await closeServer(server);
    },
  };
}

/* ------------------------------------------------------------------ */
/* Apps behind nginx                                                   */
/* ------------------------------------------------------------------ */

export interface Seen {
  /** performance.now() when the request arrived */
  t: number;
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  remotePort: number;
}

/** An app server that records every request and answers with `answer` (default 200 "ok"). */
export async function recordingApp(name = 'app', answer?: (req: http.IncomingMessage, res: http.ServerResponse) => void) {
  const seen: Seen[] = [];
  const server = http.createServer((req, res) => {
    seen.push({ t: performance.now(), method: req.method ?? '', url: req.url ?? '', headers: req.headers, remotePort: req.socket.remotePort ?? 0 });
    req.resume();
    req.on('end', () => {
      if (answer) return answer(req, res);
      res.writeHead(200, { 'content-type': 'text/plain', 'x-backend': name });
      res.end(`${name}\n`);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  return { name, port: (server.address() as net.AddressInfo).port, seen, close: () => closeServer(server) };
}

export interface OriginRoute {
  cacheControl?: string;
  vary?: string;
  /** Answer If-None-Match: "a1b2" with 304 */
  etag?: boolean;
  /** A body that depends on the X-User request header (an account page) */
  personal?: boolean;
  delayMs?: number;
}

export interface OriginHit {
  path: string;
  search: string;
  ifNoneMatch: string | null;
  userAgent: string | null;
  user: string | null;
  status: number;
  remotePort: number;
}

/** An HTTPS origin (test certificate) that answers each path with the headers its route asks for. */
export async function httpsOrigin(routes: Record<string, OriginRoute>) {
  const hits: OriginHit[] = [];
  const c = testCert();
  const server = https.createServer({ key: readFileSync(c.key), cert: readFileSync(c.crt), keepAlive: true }, (req, res) => {
    const u = new URL(req.url ?? '/', 'https://origin.shop.example');
    const route = routes[u.pathname] ?? {};
    const inm = (req.headers['if-none-match'] as string | undefined) ?? null;
    const user = (req.headers['x-user'] as string | undefined) ?? null;
    const headers: Record<string, string> = { 'content-type': 'text/plain' };
    if (route.cacheControl) headers['cache-control'] = route.cacheControl;
    if (route.vary) headers.vary = route.vary;
    if (route.etag) headers.etag = '"a1b2"';
    const status = route.etag && inm === '"a1b2"' ? 304 : 200;
    hits.push({ path: u.pathname, search: u.search, ifNoneMatch: inm, userAgent: (req.headers['user-agent'] as string) ?? null, user, status, remotePort: req.socket.remotePort ?? 0 });
    setTimeout(() => {
      res.writeHead(status, headers);
      res.end(status === 304 ? undefined : route.personal ? `orders of ${user}\n` : `${u.pathname}\n`);
    }, route.delayMs ?? 0);
  });
  server.keepAliveTimeout = 60_000;
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  return { port: (server.address() as net.AddressInfo).port, hits, close: () => closeServer(server) };
}

/** Tiny memcached servers: every `get key` returns the server's own name. */
export async function memcachedServers(names: string[]) {
  return Promise.all(
    names.map(async (name) => {
      const sockets = new Set<net.Socket>();
      const handler = (s: net.Socket) => {
        sockets.add(s);
        s.on('close', () => sockets.delete(s));
        let buf = '';
        s.on('data', (d) => {
          buf += d;
          for (let i = buf.indexOf('\r\n'); i >= 0; i = buf.indexOf('\r\n')) {
            const key = buf.slice(0, i).split(' ')[1] ?? '';
            buf = buf.slice(i + 2);
            s.write(`VALUE ${key} 0 ${name.length}\r\n${name}\r\nEND\r\n`);
          }
        });
        s.on('error', () => {});
      };
      let server = net.createServer(handler);
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
      const port = (server.address() as net.AddressInfo).port;
      return {
        name,
        port,
        /** Like a crash: the port refuses connections until `revive` */
        kill: async () => {
          for (const s of sockets) s.destroy();
          await closeServer(server);
        },
        revive: async () => {
          server = net.createServer(handler);
          await new Promise<void>((r) => server.listen(port, '127.0.0.1', () => r()));
        },
      };
    }),
  );
}

/* ------------------------------------------------------------------ */
/* Clients                                                             */
/* ------------------------------------------------------------------ */

export interface Answer {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
  ms: number;
  error?: string;
}

/** One request on a fresh connection, with the response headers (HTTPS accepts the test certificate). */
export function get(url: string, opts: { method?: string; headers?: Record<string, string>; body?: string; timeoutMs?: number } = {}): Promise<Answer> {
  const t = performance.now();
  return new Promise((resolve) => {
    const done = (res: http.IncomingMessage) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body, ms: performance.now() - t }));
    };
    const base = { method: opts.method ?? 'GET', headers: opts.headers, agent: false as const };
    const req = url.startsWith('https:') ? https.request(url, { ...base, rejectUnauthorized: false }, done) : http.request(url, base, done);
    req.setTimeout(opts.timeoutMs ?? 8000, () => req.destroy(new Error('timeout')));
    req.on('error', (e) => resolve({ status: 0, headers: {}, body: '', ms: performance.now() - t, error: e.message }));
    req.end(opts.body);
  });
}

/**
 * Run a command without blocking the event loop (the relay and apps live in
 * this process). `merged` sends stderr into stdout, keeping the order the
 * program printed them in, as a terminal would show it.
 */
export function run(cmd: string, args: string[], opts: { input?: string; timeoutMs?: number; merged?: boolean } = {}) {
  const [c, a] = opts.merged ? ['/bin/sh', ['-c', 'exec "$0" "$@" 2>&1', cmd, ...args]] : [cmd, args];
  return new Promise<{ code: number; out: string; err: string }>((resolve) => {
    const p = execFile(c, a, { timeout: opts.timeoutMs ?? 20_000, maxBuffer: 16 << 20 }, (e, stdout, stderr) =>
      resolve({ code: e ? (typeof e.code === 'number' ? e.code : 1) : 0, out: String(stdout), err: String(stderr) }),
    );
    p.stdin?.end(opts.input ?? '');
  });
}

export function opensslVersion() {
  return execFileSync('openssl', ['version'], { encoding: 'utf8' }).match(/OpenSSL ([\d.]+)/)?.[1] ?? 'unknown';
}

/** `openssl s_client` to 127.0.0.1:port as shop.example; stdout and stderr together. */
export async function sClient(port: number, args: string[] = [], input = '') {
  const r = await run('openssl', ['s_client', '-connect', `127.0.0.1:${port}`, '-servername', 'shop.example', '-ign_eof', ...args], { input });
  return `${r.out}${r.err}`;
}

export interface TlsRun {
  protocol: string | null;
  reused: boolean;
  /** ms after connecting */
  handshake: number;
  firstByte: number;
  status: string;
  session: Buffer | null;
  cert: Buffer | null;
}

/** One HTTPS request with Node's TLS client; the session it got back can resume the next one. */
export function tlsRequest(port: number, opts: tls.ConnectionOptions & { request?: string } = {}): Promise<TlsRun> {
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    let session: Buffer | null = null;
    let handshake = 0;
    let firstByte = 0;
    let buf = '';
    let protocol: string | null = null;
    let reused = false;
    let cert: Buffer | null = null;
    const s = tls.connect({ host: '127.0.0.1', port, servername: 'shop.example', rejectUnauthorized: false, ...opts }, () => {
      handshake = performance.now() - t0;
      protocol = s.getProtocol();
      reused = s.isSessionReused();
      cert = s.getPeerCertificate().raw ?? null;
      s.write(opts.request ?? 'GET / HTTP/1.1\r\nHost: shop.example\r\nConnection: close\r\n\r\n');
    });
    s.on('session', (x) => (session = x));
    s.on('data', (b) => {
      if (!firstByte) firstByte = performance.now() - t0;
      buf += b;
    });
    s.on('end', () => s.destroy());
    s.on('error', reject);
    s.on('close', () => resolve({ protocol, reused, handshake, firstByte, status: buf.split('\r\n')[0], session, cert }));
    s.setTimeout(10_000, () => s.destroy(new Error('timeout')));
  });
}

/** Ask for every path at once over one HTTP/2 connection; returns which stream each DATA chunk belonged to, in arrival order. */
export async function h2All(port: number, paths: string[]) {
  const session = http2.connect(`https://127.0.0.1:${port}`, { servername: 'shop.example', rejectUnauthorized: false });
  const order: { stream: number; bytes: number }[] = [];
  const streams = await Promise.all(
    paths.map(
      (p) =>
        new Promise<{ path: string; id: number; status: number; bytes: number }>((resolve, reject) => {
          const req = session.request({ ':path': p });
          let status = 0;
          let bytes = 0;
          req.on('response', (h) => (status = Number(h[':status'])));
          req.on('data', (d: Buffer) => {
            bytes += d.length;
            order.push({ stream: req.id ?? -1, bytes: d.length });
          });
          req.on('end', () => resolve({ path: p, id: req.id ?? -1, status, bytes }));
          req.on('error', reject);
          req.end();
        }),
    ),
  );
  const alpn = (session.socket as tls.TLSSocket).alpnProtocol;
  session.close();
  return { streams, order, alpn };
}

/* ------------------------------------------------------------------ */
/* Certificates like the TLS lesson's                                  */
/* ------------------------------------------------------------------ */

/**
 * A root, an intermediate and a leaf with the TLS lesson's names, plus
 * Mallory's three fakes: self-signed, a real one for mallory.example, and
 * an expired one.
 */
export function lessonPki() {
  const dir = tmpDir('pki');
  const f = (n: string) => path.join(dir, n);
  const ssl = (...args: string[]) => execFileSync('openssl', args, { stdio: 'ignore' });
  const ext = (name: string, text: string) => {
    writeFileSync(f(name), text);
    return f(name);
  };
  const ec = ['-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes'];
  ssl('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', f('root.key'), '-out', f('root.crt'), '-days', '30', '-subj', '/C=US/O=Example Trust/CN=Example Root X1', '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign');
  ssl('req', '-newkey', 'rsa:2048', '-nodes', '-keyout', f('inter.key'), '-out', f('inter.csr'), '-subj', '/C=US/O=Example Trust/CN=Example CA R3');
  const ca = ext('ca.ext', 'basicConstraints=critical,CA:TRUE,pathlen:0\nkeyUsage=critical,keyCertSign,cRLSign\n');
  ssl('x509', '-req', '-in', f('inter.csr'), '-CA', f('root.crt'), '-CAkey', f('root.key'), '-CAcreateserial', '-out', f('inter.crt'), '-days', '30', '-extfile', ca);
  const leafExt = ext('leaf.ext', 'subjectAltName=DNS:shop.example,DNS:www.shop.example\nbasicConstraints=CA:FALSE\n');
  ssl('req', ...ec, '-keyout', f('leaf.key'), '-out', f('leaf.csr'), '-subj', '/CN=shop.example');
  ssl('x509', '-req', '-in', f('leaf.csr'), '-CA', f('inter.crt'), '-CAkey', f('inter.key'), '-CAcreateserial', '-out', f('leaf.crt'), '-days', '30', '-extfile', leafExt);
  ssl('req', ...ec, '-keyout', f('mal.key'), '-out', f('mal.csr'), '-subj', '/CN=mallory.example');
  const malExt = ext('mal.ext', 'subjectAltName=DNS:mallory.example\n');
  ssl('x509', '-req', '-in', f('mal.csr'), '-CA', f('inter.crt'), '-CAkey', f('inter.key'), '-CAcreateserial', '-out', f('mal.crt'), '-days', '30', '-extfile', malExt);
  ssl('req', '-x509', ...ec, '-keyout', f('self.key'), '-out', f('self.crt'), '-days', '30', '-subj', '/CN=shop.example', '-addext', 'subjectAltName=DNS:shop.example');
  ssl('x509', '-req', '-in', f('leaf.csr'), '-CA', f('inter.crt'), '-CAkey', f('inter.key'), '-CAcreateserial', '-out', f('old.crt'), '-not_before', '20250101000000Z', '-not_after', '20250401000000Z', '-extfile', leafExt);
  const chain = (name: string, leaf: string) => {
    writeFileSync(f(name), readFileSync(f(leaf), 'utf8') + readFileSync(f('inter.crt'), 'utf8'));
    return f(name);
  };
  return {
    root: f('root.crt'),
    good: { crt: chain('fullchain.pem', 'leaf.crt'), key: f('leaf.key') },
    selfSigned: { crt: f('self.crt'), key: f('self.key') },
    otherName: { crt: chain('mallory.pem', 'mal.crt'), key: f('mal.key') },
    expired: { crt: chain('expired.pem', 'old.crt'), key: f('leaf.key') },
    /** DER bytes of the leaf, to look for on the wire */
    leafDer: Buffer.from(
      readFileSync(f('leaf.crt'), 'utf8')
        .replace(/-----[^-]+-----/g, '')
        .replace(/\s+/g, ''),
      'base64',
    ),
  };
}

/** A fresh ECH key pair; `configList` is what a DNS HTTPS record would publish. */
export function echKeys(publicName: string) {
  const file = path.join(tmpDir('ech'), 'ech.pem');
  execFileSync('openssl', ['ech', '-public_name', publicName, '-out', file], { stdio: 'ignore' });
  const configList = readFileSync(file, 'utf8').match(/-----BEGIN ECHCONFIG-----([\s\S]*?)-----END ECHCONFIG-----/)?.[1].replace(/\s+/g, '') ?? '';
  return { file, configList };
}

/** A plain HTTP/1.1 request on a socket we keep, so we can see whether the server keeps it open. */
export function rawHttp(port: number) {
  const sock = net.connect(port, '127.0.0.1');
  let closedAt: number | null = null;
  let buf = '';
  sock.on('data', (d) => (buf += d));
  sock.on('close', () => (closedAt = performance.now()));
  sock.on('error', () => {});
  const ready = new Promise<void>((r) => sock.once('connect', () => r()));
  return {
    ready,
    get closedAt() {
      return closedAt;
    },
    /** Send one request and wait for a complete response (Content-Length bodies only). */
    async get(p: string, host = 'shop.example') {
      buf = '';
      sock.write(`GET ${p} HTTP/1.1\r\nHost: ${host}\r\n\r\n`);
      for (let i = 0; i < 200; i++) {
        const head = buf.indexOf('\r\n\r\n');
        if (head >= 0) {
          const len = Number(buf.slice(0, head).match(/content-length:\s*(\d+)/i)?.[1] ?? 0);
          if (buf.length >= head + 4 + len) return buf;
        }
        if (closedAt != null) return buf;
        await new Promise((r) => setTimeout(r, 10));
      }
      return buf;
    },
    close: () => sock.destroy(),
  };
}
