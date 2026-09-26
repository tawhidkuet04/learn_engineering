import type { FileSpec, ResType } from './page';

/**
 * A deterministic, event-driven model of one page load over one HTTP version.
 *
 * What it models: connection setup (TCP + TLS 1.3, or QUIC), how many
 * requests can be in flight (one per connection for HTTP/1.x, all at once
 * for HTTP/2 and HTTP/3), one shared link that sends a chunk at a time
 * (round-robin between whatever is ready), in-order delivery (per TCP
 * connection, or per QUIC stream), loss + retransmission about one round
 * trip later, and switching networks mid-load.
 *
 * What it leaves out (said so in the lesson): congestion control and slow
 * start, loss of handshake/request packets, and real byte counts: a "chunk"
 * stands for ~16 KB, a burst of real packets.
 */

export type Proto = 'h1.0' | 'h1.1' | 'h2' | 'h3';

/** Real milliseconds per simulated second: the stage runs ten times slower than life. */
export const MS = 100;
/** Link capacity in chunks per simulated second (about 30 Mbit/s with 16 KB chunks). */
export const CAP = 24;
/** Browser: HTML finished → subresources discovered */
const PARSE = 0.08;
const THINK_HTML = 0.12;
const THINK_STATIC = 0.04;
/** Browser notices the network changed and starts reconnecting */
const RECONNECT = 0.4;
/** Visual gap between back-to-back requests sent together */
const STAGGER = 0.014;
/** Request priority (lower goes first), roughly what browsers use */
const PRIORITY: Record<ResType, number> = { html: 0, css: 1, font: 1, js: 2, img: 3 };
/** Raw HTTP/1.1 request headers (cookie, user-agent, accept…) */
export const H1_HEADERS = 612;
/** First HPACK/QPACK-encoded request on a connection (static table + Huffman) */
export const FIRST_HEADERS = 418;

export interface LoadConfig {
  proto: Proto;
  rttMs: number;
  /** Probability that a data chunk is lost */
  loss: number;
  files: FileSpec[];
  /** Max parallel connections per host (HTTP/1.x) */
  conns: number;
  /** HTTP/3 resumption: send the first request in the first flight */
  zeroRtt: boolean;
  seed: number;
  /** Data chunks (1-based send order) that are always lost */
  forceLoss?: number[];
}

export type SegKind = 'queue' | 'connect' | 'wait' | 'dl' | 'lost';
export interface Seg {
  kind: SegKind;
  t0: number;
  t1: number | null;
}
export interface Span {
  t0: number;
  t1: number | null;
}

export interface Res {
  i: number;
  name: string;
  /** The file whose arrival reveals this one (-1 for the HTML) */
  parent: number;
  type: ResType;
  chunks: number;
  slow: number | null;
  discovered: boolean;
  requested: boolean;
  done: boolean;
  tDiscover: number | null;
  tReq: number | null;
  tDone: number | null;
  /** Waterfall phases, in order */
  segs: Seg[];
  /** Times it was blocked waiting for lost data */
  stalls: Span[];
  stalled: boolean;
  /** Chunks handed to the browser, in order */
  delivered: number;
  /** Server: next chunk to send */
  sent: number;
  serverReady: boolean;
  conn: number | null;
  stream: number | null;
  /** HTTP/3: which stream lane it is drawn on */
  slot: number;
  /** QUIC: next chunk expected, and chunks that arrived early */
  expect: number;
  held: Pkt[];
  lostOut: number;
  /** Bumped when the file is re-requested from scratch */
  gen: number;
  hdrBytes: number;
}

export type ConnState = 'handshake' | 'idle' | 'busy' | 'closed' | 'dead';

export interface Conn {
  i: number;
  lane: number;
  state: ConnState;
  tOpen: number;
  tReady: number;
  tClose: number | null;
  /** HTTP/1.x: the file it is carrying */
  cur: number | null;
  /** TCP: next sequence number to send, next one the browser expects, early arrivals */
  sendSeq: number;
  expect: number;
  held: Pkt[];
  fresh: boolean;
  streams: number;
  served: number;
}

export type PktKind = 'hs' | 'req' | 'data' | 'ctl';
export type LossWhy = 'random' | 'forced' | 'path' | 'dead';

export interface Pkt {
  id: number;
  kind: PktKind;
  /** Browser → server */
  up: boolean;
  conn: number;
  res: number | null;
  chunk: number;
  seq: number;
  t0: number;
  t1: number;
  /** Fraction of the trip at which it disappears, if lost */
  lostAt: number | null;
  why: LossWhy | null;
  retx: boolean;
  gen: number;
  label: string | null;
  arrived: boolean;
  held: boolean;
  gone: boolean;
  cancel: boolean;
  /** Data chunks: send order (1-based) */
  ord: number;
}

interface Retx {
  res: number;
  chunk: number;
  conn: number;
  seq: number;
  gen: number;
  retx: boolean;
}

export interface LoadHooks {
  onLost?: (p: Pkt) => void;
  onFileDone?: (r: Res) => void;
  onLoad?: () => void;
  onSend?: (p: Pkt) => void;
}

export interface Hold {
  key: string;
  lane: number;
  pkts: Pkt[];
  tcp: boolean;
}

/** Stable pseudo-random number in [0, 1) for (seed, n). */
export function hash01(seed: number, n: number) {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(n + 0x632be5ab, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function insertBy(list: Pkt[], p: Pkt, key: (x: Pkt) => number) {
  let i = list.length;
  while (i > 0 && key(list[i - 1]) > key(p)) i--;
  list.splice(i, 0, p);
}

export const PROTO_NAME: Record<Proto, string> = { 'h1.0': 'HTTP/1.0', 'h1.1': 'HTTP/1.1', h2: 'HTTP/2', h3: 'HTTP/3' };

export class PageLoad {
  readonly cfg: LoadConfig;
  readonly rtt: number;
  readonly owd: number;
  readonly nSlots: number;
  now = 0;
  res: Res[];
  conns: Conn[] = [];
  pkts: Pkt[] = [];
  /** HTTP/1.x: files waiting for a free connection */
  queue: number[] = [];
  /** HTTP/2-3: files waiting for the connection to be ready */
  pending: number[] = [];
  tLoad: number | null = null;
  net: 'wifi' | 'cell' = 'wifi';
  tMigrate: number | null = null;
  migrations = 0;
  lostCount = 0;
  pathLost = 0;
  handshakes = 0;
  requests = 0;
  headerBytes = 0;
  lastLoss: Pkt | null = null;
  hooks: LoadHooks;

  private q: { t: number; n: number; fn: () => void }[] = [];
  private qn = 0;
  private linkFree = 0;
  private pumpAt = -1;
  private rr = -1;
  private retxQ: Retx[] = [];
  private ord = 0;
  private pid = 1;
  private dropNext = 0;
  private muxConn = -1;
  private pathDeadUntil = -1;

  constructor(cfg: LoadConfig, hooks: LoadHooks = {}) {
    this.cfg = cfg;
    this.hooks = hooks;
    this.rtt = cfg.rttMs / MS;
    this.owd = this.rtt / 2;
    this.nSlots = Math.max(1, cfg.files.length - 1);
    const index = new Map(cfg.files.map((f, i) => [f.name, i]));
    this.res = cfg.files.map((f, i) => ({
      i,
      name: f.name,
      parent: i === 0 ? -1 : (index.get(f.after ?? '') ?? 0),
      type: f.type,
      chunks: f.chunks,
      slow: f.slow ?? null,
      discovered: false,
      requested: false,
      done: false,
      tDiscover: null,
      tReq: null,
      tDone: null,
      segs: [],
      stalls: [],
      stalled: false,
      delivered: 0,
      sent: 0,
      serverReady: false,
      conn: null,
      stream: null,
      slot: i === 0 ? 0 : (i - 1) % this.nSlots,
      expect: 0,
      held: [],
      lostOut: 0,
      gen: 0,
      hdrBytes: 0,
    }));
    this.discover(0);
    if (this.h1) {
      this.queue.push(0);
      this.dispatch();
    } else {
      this.pending.push(0);
      this.openMux();
    }
  }

  /* ---------------- derived ---------------- */

  get h1() {
    return this.cfg.proto === 'h1.0' || this.cfg.proto === 'h1.1';
  }
  get tcp() {
    return this.cfg.proto !== 'h3';
  }
  get done() {
    return this.tLoad != null;
  }
  get loadMs() {
    return (this.tLoad ?? this.now) * MS;
  }
  get filesDone() {
    return this.res.reduce((n, r) => n + (r.done ? 1 : 0), 0);
  }
  get totalChunks() {
    return this.res.reduce((n, r) => n + r.chunks, 0);
  }
  get deliveredChunks() {
    return this.res.reduce((n, r) => n + (r.done ? r.chunks : r.delivered), 0);
  }
  get muxIndex() {
    return this.muxConn;
  }
  /** Connections that are open or opening */
  get liveConns() {
    return this.conns.filter((c) => c.state === 'handshake' || c.state === 'idle' || c.state === 'busy');
  }
  /** Files requested and not finished */
  get openStreams() {
    return this.res.filter((r) => r.requested && !r.done).length;
  }

  /* ---------------- clock ---------------- */

  private at(t: number, fn: () => void) {
    const ev = { t, n: this.qn++, fn };
    let lo = 0;
    let hi = this.q.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const e = this.q[mid];
      if (e.t < t || (e.t === t && e.n < ev.n)) lo = mid + 1;
      else hi = mid;
    }
    this.q.splice(lo, 0, ev);
  }

  /** Run events up to now + dt. Stops early (at the event's time) if `stop` says so. */
  advance(dt: number, stop?: () => boolean) {
    const target = this.now + dt;
    let guard = 0;
    while (this.q.length && this.q[0].t <= target + 1e-9 && guard++ < 50000) {
      const ev = this.q.shift()!;
      if (ev.t > this.now) this.now = ev.t;
      ev.fn();
      if (stop?.()) return;
    }
    this.now = Math.max(this.now, target);
  }

  /** Fast-forward until the page has loaded (for baselines and predictions). */
  runToEnd(limit = 900) {
    while (this.tLoad == null && this.now < limit) this.advance(0.5);
    return this;
  }

  /* ---------------- learner actions ---------------- */

  /** Lose the next data chunk the server sends. */
  dropNextChunk() {
    this.dropNext++;
  }

  /** Lose this chunk right where it is. */
  dropPacket(id: number) {
    const p = this.pkts.find((x) => x.id === id);
    if (!p || p.kind !== 'data' || p.gone || p.cancel || p.arrived || p.lostAt != null) return false;
    if (this.now < p.t0 || this.now >= p.t1) return false;
    p.lostAt = Math.max(0.02, (this.now - p.t0) / (p.t1 - p.t0));
    p.why = 'forced';
    this.lose(p);
    return true;
  }

  /** The browser's network changes (e.g. Wi-Fi → cellular), so its IP address does too. */
  migrate() {
    if (this.tLoad != null) return false;
    const t = this.now;
    this.net = this.net === 'wifi' ? 'cell' : 'wifi';
    this.tMigrate = t;
    this.migrations++;
    if (this.tcp) {
      // A TCP connection is its 4-tuple. New address: every connection is dead.
      for (const c of this.conns) {
        if (c.state === 'closed' || c.state === 'dead') continue;
        c.state = 'dead';
        c.tClose = t;
        for (const p of c.held) p.gone = true;
        c.held = [];
      }
      for (const p of this.pkts) {
        if (p.gone || p.cancel || p.arrived) continue;
        if (p.t0 > t) {
          p.cancel = true;
          continue;
        }
        const end = p.lostAt != null ? p.t0 + p.lostAt * (p.t1 - p.t0) : p.t1;
        if (t >= end) continue;
        if (p.lostAt == null) {
          const k = (t - p.t0) / (p.t1 - p.t0);
          p.lostAt = p.up ? Math.max(0.02, k) : Math.max(0.965, k);
          this.at(p.t0 + p.lostAt * (p.t1 - p.t0), () => this.lose(p));
        }
        p.why = 'dead';
      }
      this.retxQ = [];
      const redo: number[] = [];
      for (const r of this.res) {
        if (!r.discovered || r.done) continue;
        r.gen++;
        r.delivered = 0;
        r.sent = 0;
        r.serverReady = false;
        r.requested = false;
        r.held = [];
        r.expect = 0;
        r.lostOut = 0;
        r.conn = null;
        r.stream = null;
        this.seg(r, 'lost');
        redo.push(r.i);
      }
      if (this.h1) {
        this.queue = [];
        for (const i of redo) this.enqueue(i);
      } else this.pending = redo;
      this.refreshStalls();
      this.at(t + RECONNECT, () => {
        if (this.h1) this.dispatch();
        else this.openMux();
      });
    } else {
      // QUIC: same connection (same connection ID), new path. Only what was in flight is lost.
      this.pathDeadUntil = t + this.owd;
      for (const p of this.pkts) {
        if (p.gone || p.cancel || p.arrived || p.up || p.kind !== 'data' || p.lostAt != null) continue;
        if (p.t0 > t || p.t1 <= t) continue;
        p.lostAt = 0.965;
        p.why = 'path';
        this.at(p.t0 + p.lostAt * (p.t1 - p.t0), () => this.lose(p));
      }
      const c = this.conns[this.muxConn];
      if (c) {
        const o = this.owd;
        this.emit({ kind: 'ctl', up: true, conn: c.i, t0: t, label: 'same connection ID' });
        this.emit({ kind: 'ctl', up: false, conn: c.i, t0: t + o, label: 'PATH_CHALLENGE' });
        this.emit({ kind: 'ctl', up: true, conn: c.i, t0: t + 2 * o, label: 'PATH_RESPONSE' });
      }
    }
    return true;
  }

  /* ---------------- views ---------------- */

  /** Packets on the wire right now, with their progress 0..1. */
  inFlight() {
    const out: { p: Pkt; k: number }[] = [];
    for (const p of this.pkts) {
      if (p.gone || p.cancel || p.arrived || p.t0 > this.now) continue;
      const dur = p.t1 - p.t0;
      const end = p.lostAt != null ? p.t0 + p.lostAt * dur : p.t1;
      if (this.now >= end) continue;
      out.push({ p, k: (this.now - p.t0) / dur });
    }
    return out;
  }

  /** Chunks that arrived but are waiting for an earlier, lost one. */
  holds(): Hold[] {
    const out: Hold[] = [];
    if (this.tcp) {
      for (const c of this.conns) if (c.held.length) out.push({ key: `c${c.i}`, lane: c.lane, pkts: c.held, tcp: true });
    } else {
      for (const r of this.res) if (r.held.length) out.push({ key: `r${r.i}`, lane: r.slot, pkts: r.held, tcp: false });
    }
    return out;
  }

  /** The connection currently drawn on each lane (HTTP/1.x) */
  laneConn(lane: number): Conn | null {
    let found: Conn | null = null;
    for (const c of this.conns) if (c.lane === lane) found = c;
    return found;
  }

  get muxConnection(): Conn | null {
    return this.conns[this.muxConn] ?? null;
  }

  /**
   * Files that will use a connection still handshaking, with its start time.
   * Browsers bind a request to whichever connection is ready first, so this
   * pairs handshakes with the front of the queue, in order.
   */
  pendingConnects(): Map<number, number> {
    const out = new Map<number, number>();
    const opening = this.conns.filter((c) => c.state === 'handshake').sort((a, b) => a.tOpen - b.tOpen);
    if (!opening.length) return out;
    const waiting = this.h1 ? this.queue : this.pending.slice(0, 1);
    opening.forEach((c, k) => {
      const i = waiting[k];
      if (i != null) out.set(i, c.tOpen);
    });
    return out;
  }

  /* ---------------- connections ---------------- */

  private openMux() {
    const c = this.openConn(0);
    this.muxConn = c.i;
  }

  private freeLane() {
    const used = new Set(this.liveConns.map((c) => c.lane));
    let l = 0;
    while (used.has(l)) l++;
    return l;
  }

  private openConn(lane: number): Conn {
    const c: Conn = {
      i: this.conns.length,
      lane,
      state: 'handshake',
      tOpen: this.now,
      tReady: this.now,
      tClose: null,
      cur: null,
      sendSeq: 0,
      expect: 0,
      held: [],
      fresh: true,
      streams: 0,
      served: 0,
    };
    this.conns.push(c);
    this.handshakes++;
    const o = this.owd;
    let flights: [boolean, string][];
    let ready: number;
    if (this.tcp) {
      flights = [
        [true, 'SYN'],
        [false, 'SYN-ACK'],
        [true, 'ACK + ClientHello'],
        [false, 'ServerHello … Finished'],
      ];
      ready = 2 * this.rtt;
    } else if (this.cfg.zeroRtt) {
      flights = [[true, 'Initial + 0-RTT']];
      ready = 0;
    } else {
      flights = [
        [true, 'Initial · ClientHello'],
        [false, 'Initial + Handshake'],
      ];
      ready = this.rtt;
    }
    flights.forEach(([up, label], k) => this.emit({ kind: 'hs', up, conn: c.i, t0: this.now + k * o, label }));
    if (!this.tcp && this.cfg.zeroRtt) this.emit({ kind: 'hs', up: false, conn: c.i, t0: this.now + o, label: 'Handshake' });
    c.tReady = this.now + ready;
    this.at(c.tReady, () => this.onReady(c));
    return c;
  }

  private onReady(c: Conn) {
    if (c.state !== 'handshake') return;
    c.state = 'idle';
    if (this.h1) this.dispatch();
    else {
      c.state = 'busy';
      this.flushMux();
    }
  }

  /** HTTP/1.x: hand queued files to idle connections, open more if allowed. */
  private dispatch() {
    if (!this.h1 || this.tLoad != null) return;
    for (const c of this.conns) {
      if (!this.queue.length) break;
      if (c.state === 'idle') this.requestOn(c, this.queue.shift()!);
    }
    let live = this.liveConns;
    let opening = live.filter((c) => c.state === 'handshake').length;
    while (this.queue.length > opening && live.length < this.cfg.conns) {
      this.openConn(this.freeLane());
      live = this.liveConns;
      opening++;
    }
  }

  private requestOn(c: Conn, i: number) {
    const r = this.res[i];
    c.state = 'busy';
    c.cur = i;
    c.served++;
    r.conn = c.i;
    this.markConnect(c, r);
    this.sendRequest(c, r);
  }

  /** HTTP/2-3: send every pending request at once. */
  private flushMux() {
    const c = this.conns[this.muxConn];
    if (!c || c.state !== 'busy' || !this.pending.length) return;
    const ids = this.pending.splice(0);
    const first = c.streams === 0 && !this.tcp && this.cfg.zeroRtt ? 0.04 : 0;
    ids.forEach((i, k) => {
      const r = this.res[i];
      const gen = r.gen;
      this.at(this.now + first + k * STAGGER, () => {
        if (c.state !== 'busy' || r.gen !== gen || r.requested) return;
        this.markConnect(c, r);
        this.sendRequest(c, r);
      });
    });
  }

  /** The waterfall charges a connection's setup to the first file it carries. */
  private markConnect(c: Conn, r: Res) {
    if (!c.fresh) return;
    c.fresh = false;
    this.seg(r, 'connect', Math.max(c.tOpen, r.tDiscover ?? c.tOpen));
  }

  private sendRequest(c: Conn, r: Res) {
    this.seg(r, 'wait');
    r.requested = true;
    r.tReq = this.now;
    this.requests++;
    r.stream = this.h1 ? null : this.cfg.proto === 'h2' ? 1 + 2 * c.streams : 4 * c.streams;
    c.streams++;
    r.hdrBytes = this.h1 ? H1_HEADERS : c.streams === 1 ? FIRST_HEADERS : 20 + Math.ceil(r.name.length * 0.75);
    this.headerBytes += r.hdrBytes;
    r.conn = c.i;
    const gen = r.gen;
    const p = this.emit({ kind: 'req', up: true, conn: c.i, res: r.i, t0: this.now, gen });
    this.hooks.onSend?.(p);
    this.at(p.t1, () => {
      if (p.lostAt == null) this.atServer(r, gen);
    });
  }

  private atServer(r: Res, gen: number) {
    if (r.gen !== gen) return;
    const think = r.slow ?? (r.type === 'html' ? THINK_HTML : THINK_STATIC);
    this.at(this.now + think, () => {
      if (r.gen !== gen) return;
      r.serverReady = true;
      this.pump();
    });
  }

  /* ---------------- the shared link ---------------- */

  private connUsable(ci: number | null) {
    if (ci == null) return false;
    const c = this.conns[ci];
    return !!c && (c.state === 'busy' || c.state === 'idle');
  }

  private pump() {
    if (this.pumpAt >= 0) return;
    if (this.now < this.linkFree - 1e-9) {
      this.wake(this.linkFree);
      return;
    }
    const x = this.pick();
    if (!x) return;
    this.sendChunk(x);
    this.linkFree = this.now + 1 / CAP;
    this.wake(this.linkFree);
  }

  private wake(t: number) {
    this.pumpAt = t;
    this.at(t, () => {
      this.pumpAt = -1;
      this.pump();
    });
  }

  /** Resends first, then round-robin over every response that has data ready. */
  private pick(): Retx | null {
    while (this.retxQ.length) {
      const x = this.retxQ.shift()!;
      if (this.res[x.res].gen === x.gen && this.connUsable(x.conn)) return x;
    }
    let first: Res | null = null;
    let next: Res | null = null;
    for (const r of this.res) {
      if (!r.serverReady || r.sent >= r.chunks) continue;
      const ci = this.h1 ? r.conn : this.muxConn;
      if (!this.connUsable(ci)) continue;
      if (!first) first = r;
      if (!next && r.i > this.rr) next = r;
    }
    const r = next ?? first;
    if (!r) return null;
    this.rr = r.i;
    const ci = (this.h1 ? r.conn : this.muxConn) as number;
    const c = this.conns[ci];
    const chunk = r.sent++;
    return { res: r.i, chunk, conn: ci, seq: this.tcp ? c.sendSeq++ : chunk, gen: r.gen, retx: false };
  }

  private sendChunk(x: Retx) {
    let why: LossWhy | null = null;
    let ord = 0;
    if (!x.retx) {
      ord = ++this.ord;
      if (this.dropNext > 0) {
        this.dropNext--;
        why = 'forced';
      } else if (this.cfg.forceLoss?.includes(ord)) why = 'forced';
      else if (this.cfg.loss > 0 && hash01(this.cfg.seed, ord) < this.cfg.loss) why = 'random';
    }
    if (this.now < this.pathDeadUntil) why = 'path';
    const lostAt = why == null ? null : why === 'path' ? 0.965 : 0.34 + 0.3 * hash01(this.cfg.seed + 17, ord + 31 * this.pid);
    const p = this.emit({
      kind: 'data',
      up: false,
      conn: x.conn,
      res: x.res,
      chunk: x.chunk,
      seq: x.seq,
      t0: this.now,
      lostAt,
      why,
      retx: x.retx,
      gen: x.gen,
      ord,
    });
    this.hooks.onSend?.(p);
    if (lostAt != null) this.at(p.t0 + lostAt * this.owd, () => this.lose(p));
    else this.at(p.t1, () => this.arrive(p));
  }

  private emit(o: Partial<Pkt> & { kind: Pkt['kind']; up: boolean; conn: number; t0: number }): Pkt {
    const p: Pkt = {
      id: this.pid++,
      res: null,
      chunk: 0,
      seq: 0,
      t1: o.t0 + this.owd,
      lostAt: null,
      why: null,
      retx: false,
      gen: 0,
      label: null,
      arrived: false,
      held: false,
      gone: false,
      cancel: false,
      ord: 0,
      ...o,
    };
    this.pkts.push(p);
    return p;
  }

  /* ---------------- loss and delivery ---------------- */

  private lose(p: Pkt) {
    if (p.gone || p.cancel) return;
    p.gone = true;
    if (p.why === 'path') this.pathLost++;
    else if (p.why !== 'dead') this.lostCount++;
    if (p.why !== 'dead') this.lastLoss = p;
    this.hooks.onLost?.(p);
    if (p.kind !== 'data' || p.why === 'dead' || p.res == null) return;
    const r = this.res[p.res];
    if (r.gen !== p.gen) return;
    r.lostOut++;
    // The sender notices about one round trip after sending (gaps in the ACKs) and resends.
    const tDetect = Math.max(this.now + 0.02, p.t0 + this.rtt * 1.1, this.pathDeadUntil + 0.02);
    this.at(tDetect, () => {
      if (r.gen !== p.gen || !this.connUsable(p.conn)) return;
      this.retxQ.push({ res: r.i, chunk: p.chunk, conn: p.conn, seq: p.seq, gen: p.gen, retx: true });
      this.pump();
    });
    this.refreshStalls();
  }

  private arrive(p: Pkt) {
    if (p.lostAt != null || p.gone || p.cancel) return;
    p.arrived = true;
    if (p.kind !== 'data' || p.res == null) {
      p.gone = true;
      return;
    }
    const r = this.res[p.res];
    if (r.gen !== p.gen) {
      p.gone = true;
      return;
    }
    if (p.retx) r.lostOut = Math.max(0, r.lostOut - 1);
    if (this.tcp) {
      // TCP: one ordered byte stream per connection, whatever files it carries.
      const c = this.conns[p.conn];
      if (c.state === 'dead') {
        p.gone = true;
        return;
      }
      if (p.seq === c.expect) {
        this.deliver(p);
        c.expect++;
        while (c.held.length && c.held[0].seq === c.expect) {
          this.deliver(c.held.shift()!);
          c.expect++;
        }
      } else if (p.seq > c.expect) {
        p.held = true;
        insertBy(c.held, p, (a) => a.seq);
      } else p.gone = true;
    } else {
      // QUIC: each stream is ordered on its own.
      if (p.chunk === r.expect) {
        this.deliver(p);
        r.expect++;
        while (r.held.length && r.held[0].chunk === r.expect) {
          this.deliver(r.held.shift()!);
          r.expect++;
        }
      } else if (p.chunk > r.expect) {
        p.held = true;
        insertBy(r.held, p, (a) => a.chunk);
      } else p.gone = true;
    }
    this.refreshStalls();
  }

  private deliver(p: Pkt) {
    p.held = false;
    p.gone = true;
    if (p.res == null) return;
    const r = this.res[p.res];
    if (r.gen !== p.gen || r.done) return;
    r.delivered++;
    if (r.delivered === 1) this.seg(r, 'dl');
    if (r.delivered >= r.chunks) this.finish(r);
  }

  private finish(r: Res) {
    r.done = true;
    r.tDone = this.now;
    this.closeSeg(r);
    this.hooks.onFileDone?.(r);
    if (this.h1 && r.conn != null) {
      const c = this.conns[r.conn];
      if (c.cur === r.i) c.cur = null;
      if (c.state === 'busy') {
        if (this.cfg.proto === 'h1.0') {
          c.state = 'closed';
          c.tClose = this.now;
        } else c.state = 'idle';
      }
    }
    if (this.res.some((x) => x.parent === r.i)) this.at(this.now + PARSE, () => this.discoverChildren(r.i));
    if (this.res.every((x) => x.done)) {
      this.tLoad = this.now;
      this.refreshStalls();
      this.hooks.onLoad?.();
      return;
    }
    this.dispatch();
  }

  private discover(i: number) {
    const r = this.res[i];
    r.discovered = true;
    r.tDiscover = this.now;
    this.seg(r, 'queue');
  }

  /** The browser parses a finished file and finds the files it references. */
  private discoverChildren(parent: number) {
    const fresh: number[] = [];
    for (const r of this.res) {
      if (r.discovered || r.parent !== parent) continue;
      this.discover(r.i);
      fresh.push(r.i);
    }
    if (!fresh.length) return;
    if (this.h1) {
      for (const i of fresh) this.enqueue(i);
      this.dispatch();
    } else {
      this.pending.push(...fresh);
      this.flushMux();
    }
  }

  /** Browsers hand out free connections by priority: CSS and fonts first, images last. */
  private enqueue(i: number) {
    const rank = PRIORITY[this.res[i].type];
    let k = this.queue.length;
    while (k > 0 && PRIORITY[this.res[this.queue[k - 1]].type] > rank) k--;
    this.queue.splice(k, 0, i);
  }

  private refreshStalls() {
    const on = new Set<number>();
    for (const r of this.res) if (!r.done && (r.lostOut > 0 || r.held.length)) on.add(r.i);
    if (this.tcp) for (const c of this.conns) for (const p of c.held) if (p.res != null) on.add(p.res);
    for (const r of this.res) {
      const is = on.has(r.i) && !r.done;
      if (is && !r.stalled) r.stalls.push({ t0: this.now, t1: null });
      if (!is && r.stalled) {
        const s = r.stalls[r.stalls.length - 1];
        if (s) s.t1 = this.now;
      }
      r.stalled = is;
    }
  }

  private seg(r: Res, kind: SegKind, from = this.now) {
    const cur = r.segs[r.segs.length - 1];
    if (cur && cur.t1 == null) cur.t1 = Math.max(cur.t0, from);
    r.segs.push({ kind, t0: from, t1: null });
  }

  private closeSeg(r: Res) {
    const cur = r.segs[r.segs.length - 1];
    if (cur && cur.t1 == null) cur.t1 = this.now;
  }
}

/** Load time in real milliseconds for a config (runs instantly). */
export function simulate(cfg: LoadConfig) {
  return new PageLoad(cfg).runToEnd().loadMs;
}
