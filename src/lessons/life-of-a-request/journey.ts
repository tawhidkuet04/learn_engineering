import { SIG } from '@/lib/sim/colors';

/* ------------------------------------------------------------------ */
/* The journey of https://shop.example/cart as a pure timing model.    */
/* Everything is in real milliseconds since Enter was pressed; the sim */
/* plays it back slowed down.                                          */
/* ------------------------------------------------------------------ */

export type TlsVersion = '1.3' | '1.2';
export type ScriptMode = 'defer' | 'blocking';
export type CertState = 'valid' | 'expired' | 'wrong-name';
export type NodeId = 'browser' | 'resolver' | 'server' | 'app' | 'db';

export interface NetConfig {
  /** Round trip between the browser and the server, ms */
  rtt: number;
  /** Server think time for /cart, ms */
  serverMs: number;
  tls: TlsVersion;
  /** The DNS answer is still in the browser/OS cache */
  dnsCached: boolean;
  /** An idle keep-alive connection to shop.example is still open */
  reuse: boolean;
  /** app.css and app.js are fresh in the HTTP cache */
  assetsCached: boolean;
  script: ScriptMode;
  cert: CertState;
  /** Lose the first SYN on the way */
  dropSyn: boolean;
}

export const NET_DEFAULTS: NetConfig = {
  rtt: 40,
  serverMs: 60,
  tls: '1.3',
  dnsCached: false,
  reuse: false,
  assetsCached: false,
  script: 'defer',
  cert: 'valid',
  dropSyn: false,
};

export const WARM: Partial<NetConfig> = { dnsCached: true, reuse: true, assetsCached: true };

/** Fixed facts about this little world. */
export const FACTS = {
  /** Browser ↔ ISP resolver round trip */
  resolverRtt: 8,
  /** Resolver walks root → TLD → authoritative on a cache miss */
  recursion: 16,
  /** Server time for a static file */
  staticMs: 4,
  /** 10 Mbit/s ≈ 1.25 KB per ms */
  kbPerMs: 1.25,
  htmlKB: 12,
  cssKB: 16,
  jsKB: 90,
  /** Main-thread work to parse the whole HTML */
  parseMs: 8,
  /** CSSOM + style recalc (builds the render tree) */
  styleMs: 3,
  layoutMs: 5,
  paintMs: 4,
  compositeMs: 2,
  jsExecMs: 10,
  /** Reading a file back from the disk cache */
  cacheMs: 2,
  /** TCP's initial retransmission timeout (RFC 6298) */
  rto: 1000,
  /** The parser meets <link> and <script> this long after the first byte */
  discoverMs: 2,
  ttl: 300,
};

export const IP = {
  browser: '198.51.100.42',
  resolver: '192.0.2.53',
  server: '203.0.113.10',
  app: '10.0.1.12',
  db: '10.0.2.5',
};

/** One color per phase, shared by packets, waterfall bars and the legend. */
export const PH = {
  dns: SIG.teal,
  tcp: SIG.heavy,
  tls: SIG.hc,
  req: SIG.req,
  res: SIG.res,
  parse: SIG.blue,
  render: SIG.pink,
  js: SIG.lime,
  err: SIG.err,
  internal: SIG.line,
};

export type RowId = 'dns' | 'tcp' | 'tls' | 'wait' | 'download' | 'parse' | 'css' | 'js' | 'layout' | 'paint';

export const ROWS: { id: RowId; label: string; short: string }[] = [
  { id: 'dns', label: 'DNS lookup', short: 'DNS' },
  { id: 'tcp', label: 'TCP connect', short: 'TCP' },
  { id: 'tls', label: 'TLS handshake', short: 'TLS' },
  { id: 'wait', label: 'Waiting for server', short: 'Waiting' },
  { id: 'download', label: 'Download HTML', short: 'Download' },
  { id: 'parse', label: 'Parse HTML', short: 'Parse' },
  { id: 'css', label: 'GET app.css', short: 'app.css' },
  { id: 'js', label: 'GET app.js', short: 'app.js' },
  { id: 'layout', label: 'Style + layout', short: 'Layout' },
  { id: 'paint', label: 'Paint + composite', short: 'Paint' },
];

export type SegKind = 'bar' | 'retry' | 'blocked' | 'cache' | 'skip' | 'exec' | 'error';

export interface Seg {
  row: RowId;
  start: number;
  end: number;
  kind: SegKind;
  color: string;
}

export type InfoKey =
  | 'dns-q'
  | 'dns-a'
  | 'resolver'
  | 'syn'
  | 'syn-lost'
  | 'syn-ack'
  | 'hello'
  | 'server-hello'
  | 'server-hello-12'
  | 'client-kx'
  | 'server-fin'
  | 'alert'
  | 'get'
  | 'server'
  | 'res'
  | 'chunk'
  | 'sub-get'
  | 'css-res'
  | 'js-res'
  | 'lb-app'
  | 'app'
  | 'app-db'
  | 'db'
  | 'db-app'
  | 'app-lb';

export interface Pkt {
  id: string;
  from: NodeId;
  to: NodeId;
  send: number;
  arrive: number;
  label: string;
  color: string;
  shape: 'dot' | 'envelope';
  r?: number;
  /** Lost at this fraction of the trip */
  lostAt?: number;
  info: InfoKey;
  /** Only drawn when the server's insides are shown */
  internal?: boolean;
}

export interface Work {
  id: string;
  node: NodeId;
  start: number;
  end: number;
  label: string;
  color: string;
  info: InfoKey;
  internal?: boolean;
}

export interface Marks {
  dnsEnd: number;
  /** When the SYN that gets through was sent */
  synAt: number;
  tcpEnd: number;
  /** TLS done: the request leaves now */
  tlsEnd: number;
  reqArrive: number;
  resSent: number;
  ttfb: number;
  dlEnd: number;
  discover: number;
  cssReady: number;
  jsReady: number;
  parseEnd: number;
  renderStart: number;
  styleEnd: number;
  layoutEnd: number;
  paintEnd: number;
  fcp: number;
  jsRun: [number, number];
  /** Parser stopped at a blocking script */
  blockedAt: number | null;
  lossAt: number | null;
  /** Certificate rejected */
  failAt: number | null;
  end: number;
}

export type MarkKey = Exclude<keyof Marks, 'jsRun' | 'blockedAt' | 'lossAt' | 'failAt'>;

export interface Journey {
  cfg: NetConfig;
  packets: Pkt[];
  segs: Seg[];
  work: Work[];
  marks: Marks;
  /** Time-lapse windows (nothing happens but waiting) */
  lapse: { from: number; to: number; factor: number }[];
  /** Server-side breakdown for the Server-Timing header */
  timing: { db: number; app: number };
  /** Round trips to the server before the first byte */
  rtts: number;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

export function computeJourney(c: NetConfig): Journey {
  const F = FACTS;
  const half = c.rtt / 2;
  const P: Pkt[] = [];
  const S: Seg[] = [];
  const Wk: Work[] = [];
  const lapse: Journey['lapse'] = [];
  const pkt = (p: Omit<Pkt, 'shape'> & { shape?: Pkt['shape'] }): Pkt => {
    const full: Pkt = { shape: 'dot', ...p };
    P.push(full);
    return full;
  };
  const INF = Number.POSITIVE_INFINITY;
  const m: Marks = {
    dnsEnd: 0,
    synAt: 0,
    tcpEnd: 0,
    tlsEnd: 0,
    reqArrive: INF,
    resSent: INF,
    ttfb: INF,
    dlEnd: INF,
    discover: INF,
    cssReady: INF,
    jsReady: INF,
    parseEnd: INF,
    renderStart: INF,
    styleEnd: INF,
    layoutEnd: INF,
    paintEnd: INF,
    fcp: INF,
    jsRun: [INF, INF],
    blockedAt: null,
    lossAt: null,
    failAt: null,
    end: 0,
  };
  let t = 0;
  let rtts = 0;

  /* 1 · DNS ---------------------------------------------------------- */
  if (c.dnsCached) {
    S.push({ row: 'dns', start: 0, end: 0, kind: 'cache', color: PH.dns });
  } else {
    const rh = F.resolverRtt / 2;
    pkt({ id: 'dns-q', from: 'browser', to: 'resolver', send: 0, arrive: rh, label: 'A? shop.example', color: PH.dns, info: 'dns-q' });
    Wk.push({ id: 'recurse', node: 'resolver', start: rh, end: rh + F.recursion, label: 'asking root → .example → ns1', color: PH.dns, info: 'resolver' });
    pkt({ id: 'dns-a', from: 'resolver', to: 'browser', send: rh + F.recursion, arrive: F.resolverRtt + F.recursion, label: 'A 203.0.113.10', color: PH.dns, info: 'dns-a' });
    t = F.resolverRtt + F.recursion;
    S.push({ row: 'dns', start: 0, end: t, kind: 'bar', color: PH.dns });
  }
  m.dnsEnd = t;

  /* 2 · TCP + TLS ---------------------------------------------------- */
  let reqLabel = 'GET /cart';
  if (c.reuse) {
    S.push({ row: 'tcp', start: t, end: t, kind: 'skip', color: PH.tcp });
    S.push({ row: 'tls', start: t, end: t, kind: 'skip', color: PH.tls });
    m.synAt = t;
    m.tcpEnd = t;
    m.tlsEnd = t;
  } else {
    let synAt = t;
    if (c.dropSyn) {
      pkt({ id: 'syn-lost', from: 'browser', to: 'server', send: t, arrive: t + half, lostAt: 0.55, label: 'SYN', color: PH.tcp, info: 'syn-lost' });
      m.lossAt = t + half * 0.55;
      synAt = t + F.rto;
      S.push({ row: 'tcp', start: t, end: synAt, kind: 'retry', color: PH.err });
      lapse.push({ from: m.lossAt + 6, to: synAt - 6, factor: 14 });
    }
    m.synAt = synAt;
    pkt({ id: 'syn', from: 'browser', to: 'server', send: synAt, arrive: synAt + half, label: c.dropSyn ? 'SYN (again)' : 'SYN', color: PH.tcp, info: 'syn' });
    pkt({ id: 'syn-ack', from: 'server', to: 'browser', send: synAt + half, arrive: synAt + c.rtt, label: 'SYN-ACK', color: PH.tcp, info: 'syn-ack' });
    t = synAt + c.rtt;
    rtts++;
    S.push({ row: 'tcp', start: synAt, end: t, kind: 'bar', color: PH.tcp });
    m.tcpEnd = t;

    const ts = t;
    pkt({ id: 'hello', from: 'browser', to: 'server', send: t, arrive: t + half, label: 'ACK + ClientHello', color: PH.tls, info: 'hello' });
    let certAt: number;
    if (c.tls === '1.3') {
      pkt({ id: 'server-hello', from: 'server', to: 'browser', send: t + half, arrive: t + c.rtt, label: 'ServerHello … Finished', color: PH.tls, info: 'server-hello' });
      certAt = t + c.rtt;
      rtts++;
      if (c.cert === 'valid') {
        t += c.rtt;
        reqLabel = 'Finished + GET /cart';
      }
    } else {
      pkt({ id: 'server-hello-12', from: 'server', to: 'browser', send: t + half, arrive: t + c.rtt, label: 'ServerHello, Certificate…', color: PH.tls, info: 'server-hello-12' });
      certAt = t + c.rtt;
      rtts++;
      if (c.cert === 'valid') {
        pkt({ id: 'client-kx', from: 'browser', to: 'server', send: t + c.rtt, arrive: t + c.rtt + half, label: 'ClientKeyExchange, Finished', color: PH.tls, info: 'client-kx' });
        pkt({ id: 'server-fin', from: 'server', to: 'browser', send: t + c.rtt + half, arrive: t + 2 * c.rtt, label: 'Finished', color: PH.tls, info: 'server-fin' });
        t += 2 * c.rtt;
        rtts++;
      }
    }
    if (c.cert !== 'valid') {
      const failAt = certAt + 1;
      m.failAt = failAt;
      S.push({ row: 'tls', start: ts, end: failAt, kind: 'bar', color: PH.tls });
      S.push({ row: 'tls', start: failAt, end: failAt, kind: 'error', color: PH.err });
      pkt({ id: 'alert', from: 'browser', to: 'server', send: failAt, arrive: failAt + half, label: c.cert === 'expired' ? 'alert: certificate_expired' : 'alert: certificate_unknown', color: PH.err, info: 'alert' });
      m.tlsEnd = failAt;
      m.end = failAt + half + 4;
      return { cfg: c, packets: P, segs: S, work: Wk, marks: m, lapse, timing: { db: 0, app: 0 }, rtts };
    }
    S.push({ row: 'tls', start: ts, end: t, kind: 'bar', color: PH.tls });
    m.tlsEnd = t;
  }

  /* 3 · Request → first byte ----------------------------------------- */
  const reqAt = t;
  pkt({ id: 'get', from: 'browser', to: 'server', send: reqAt, arrive: reqAt + half, label: reqLabel, color: PH.req, shape: 'envelope', info: 'get' });
  m.reqArrive = reqAt + half;
  m.resSent = m.reqArrive + c.serverMs;
  m.ttfb = m.resSent + half;
  rtts++;
  Wk.push({ id: 'think', node: 'server', start: m.reqArrive, end: m.resSent, label: 'building /cart', color: PH.req, info: 'server' });
  pkt({ id: 'res', from: 'server', to: 'browser', send: m.resSent, arrive: m.ttfb, label: '200 OK', color: PH.res, shape: 'envelope', info: 'res' });
  S.push({ row: 'wait', start: reqAt, end: m.ttfb, kind: 'bar', color: PH.req });

  // The server's insides: load balancer → app → database → app → load balancer
  const a = m.reqArrive;
  const sm = c.serverMs;
  const hop = Math.min(1, sm / 12);
  const dbMs = Math.max(1, sm * 0.62);
  const tApp = a + hop;
  const tDb = tApp + Math.min(2, sm * 0.04);
  const tDbDone = tDb + hop + dbMs;
  const tBack = m.resSent - hop;
  pkt({ id: 'lb-app', from: 'server', to: 'app', send: a, arrive: tApp, label: '', color: PH.req, info: 'lb-app', internal: true, shape: 'envelope' });
  Wk.push({ id: 'app-auth', node: 'app', start: tApp, end: tDb, label: 'check session', color: PH.req, info: 'app', internal: true });
  pkt({ id: 'app-db', from: 'app', to: 'db', send: tDb, arrive: tDb + hop, label: '', color: PH.req, info: 'app-db', internal: true });
  Wk.push({ id: 'db-work', node: 'db', start: tDb + hop, end: tDbDone, label: 'query', color: PH.req, info: 'db', internal: true });
  pkt({ id: 'db-app', from: 'db', to: 'app', send: tDbDone, arrive: tDbDone + hop, label: '', color: PH.res, info: 'db-app', internal: true });
  Wk.push({ id: 'app-render', node: 'app', start: tDbDone + hop, end: tBack, label: 'render HTML', color: PH.req, info: 'app', internal: true });
  pkt({ id: 'app-lb', from: 'app', to: 'server', send: tBack, arrive: m.resSent, label: '', color: PH.res, info: 'app-lb', internal: true, shape: 'envelope' });
  const timing = { db: Math.round(dbMs), app: Math.round(sm - dbMs - 2 * hop) };

  /* 4 · Download the HTML (streams) ----------------------------------- */
  const dl = F.htmlKB / F.kbPerMs;
  m.dlEnd = m.ttfb + dl;
  S.push({ row: 'download', start: m.ttfb, end: m.dlEnd, kind: 'bar', color: PH.res });
  pkt({ id: 'chunk-1', from: 'server', to: 'browser', send: m.resSent + dl * 0.5, arrive: m.ttfb + dl * 0.5, label: '', color: PH.res, r: 3, info: 'chunk' });
  pkt({ id: 'chunk-2', from: 'server', to: 'browser', send: m.resSent + dl, arrive: m.dlEnd, label: '', color: PH.res, r: 3, info: 'chunk' });

  /* 5 · Subresources: app.css and app.js on the same connection -------- */
  m.discover = m.ttfb + F.discoverMs;
  if (c.assetsCached) {
    m.cssReady = m.discover + F.cacheMs;
    m.jsReady = m.discover + F.cacheMs + 1;
    S.push({ row: 'css', start: m.discover, end: m.cssReady, kind: 'cache', color: PH.res });
    S.push({ row: 'js', start: m.discover, end: m.jsReady, kind: 'cache', color: PH.res });
  } else {
    pkt({ id: 'sub-get', from: 'browser', to: 'server', send: m.discover, arrive: m.discover + half, label: 'GET app.css, app.js', color: PH.req, shape: 'envelope', info: 'sub-get' });
    const firstByte = m.discover + c.rtt + F.staticMs;
    // One connection, CSS first (highest priority), then JS: the downloads share the pipe.
    const cssStart = Math.max(firstByte, m.dlEnd);
    m.cssReady = cssStart + F.cssKB / F.kbPerMs;
    const jsStart = m.cssReady;
    m.jsReady = jsStart + F.jsKB / F.kbPerMs;
    pkt({ id: 'css-res', from: 'server', to: 'browser', send: cssStart - half, arrive: cssStart, label: 'app.css', color: PH.res, shape: 'envelope', info: 'css-res' });
    pkt({ id: 'js-res', from: 'server', to: 'browser', send: jsStart - half, arrive: jsStart, label: 'app.js', color: PH.res, shape: 'envelope', info: 'js-res' });
    S.push({ row: 'css', start: m.discover, end: cssStart, kind: 'bar', color: PH.req });
    S.push({ row: 'css', start: cssStart, end: m.cssReady, kind: 'bar', color: PH.res });
    S.push({ row: 'js', start: m.discover, end: jsStart, kind: 'bar', color: PH.req });
    S.push({ row: 'js', start: jsStart, end: m.jsReady, kind: 'bar', color: PH.res });
  }

  /* 6 · Parse, run scripts, render ------------------------------------ */
  if (c.script === 'blocking') {
    // The parser stops at <script src="/app.js"> in <head> until it has run.
    // A classic script also waits for pending stylesheets before it runs.
    m.blockedAt = m.discover;
    const run = Math.max(m.jsReady, m.cssReady);
    m.jsRun = [run, run + F.jsExecMs];
    const rest = F.parseMs - (m.discover - m.ttfb);
    m.parseEnd = Math.max(m.jsRun[1] + rest, m.dlEnd);
    S.push({ row: 'parse', start: m.ttfb, end: m.discover, kind: 'bar', color: PH.parse });
    S.push({ row: 'parse', start: m.discover, end: m.jsRun[1], kind: 'blocked', color: PH.parse });
    S.push({ row: 'parse', start: m.jsRun[1], end: m.parseEnd, kind: 'bar', color: PH.parse });
    S.push({ row: 'js', start: m.jsRun[0], end: m.jsRun[1], kind: 'exec', color: PH.js });
  } else {
    m.parseEnd = Math.max(m.dlEnd, m.ttfb + F.parseMs) + 2;
    S.push({ row: 'parse', start: m.ttfb, end: m.parseEnd, kind: 'bar', color: PH.parse });
  }

  // First render needs the whole DOM (small page) and the CSSOM (render-blocking CSS).
  m.renderStart = Math.max(m.parseEnd, m.cssReady);
  m.styleEnd = m.renderStart + F.styleMs;
  m.layoutEnd = m.styleEnd + F.layoutMs;
  m.paintEnd = m.layoutEnd + F.paintMs;
  m.fcp = m.paintEnd + F.compositeMs;
  S.push({ row: 'layout', start: m.renderStart, end: m.layoutEnd, kind: 'bar', color: PH.render });
  S.push({ row: 'paint', start: m.layoutEnd, end: m.fcp, kind: 'bar', color: PH.render });

  if (c.script === 'defer') {
    // Deferred scripts run once parsing is done (and CSS is in); here the
    // first frame wins any tie.
    let run = Math.max(m.parseEnd, m.jsReady, m.cssReady);
    if (run < m.fcp && run >= m.renderStart) run = m.fcp;
    m.jsRun = [run, run + F.jsExecMs];
    S.push({ row: 'js', start: m.jsRun[0], end: m.jsRun[1], kind: 'exec', color: PH.js });
  }

  m.end = Math.max(m.fcp, m.jsRun[1], m.jsReady) + 4;
  for (const k of Object.keys(m) as (keyof Marks)[]) {
    const v = m[k];
    if (typeof v === 'number' && Number.isFinite(v)) (m as unknown as Record<string, number>)[k] = r1(v);
  }
  return { cfg: c, packets: P, segs: S, work: Wk, marks: m, lapse, timing, rtts };
}

/** A mark, falling back to the journey's end when this journey never gets there (e.g. a bad certificate). */
export function markAt(j: Journey, k: MarkKey | number): number {
  if (typeof k === 'number') return k;
  const v = j.marks[k];
  return Number.isFinite(v) ? v : j.marks.end;
}

export const fmtMs = (v: number) => {
  if (!Number.isFinite(v)) return '—';
  if (v >= 1000) return `${(v / 1000).toFixed(2)} s`;
  return `${Math.round(v)} ms`;
};

/** A rough place on the map for a round-trip time. */
export function distanceLabel(rtt: number) {
  if (rtt <= 10) return 'same city';
  if (rtt <= 30) return 'same region';
  if (rtt <= 60) return 'same continent';
  if (rtt <= 120) return 'across an ocean';
  return 'other side of the world';
}
