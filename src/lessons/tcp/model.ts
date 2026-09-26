/**
 * A small but faithful model of one TCP connection. Pure logic, no React.
 *
 * Alice's laptop (the client, side 'c') uploads data to the server (side 's').
 * The server only acknowledges, apart from its own SYN-ACK and FIN.
 *
 * Times are model milliseconds. The sim advances the model with on-screen
 * seconds; `msPerSec` converts between them. When nothing is in flight and
 * the next event is a long timer (a 1 s SYN timeout, 60 s of TIME_WAIT), the
 * model fast-forwards and records the "warp" so drawings can show the skip.
 *
 * Sequence numbers are kept relative (first byte of data = 1, like tcpdump
 * and Wireshark print them); the random ISNs are kept for display.
 */

export type Side = 'c' | 's';
export type TcpState =
  | 'CLOSED'
  | 'LISTEN'
  | 'SYN_SENT'
  | 'SYN_RECEIVED'
  | 'ESTABLISHED'
  | 'FIN_WAIT_1'
  | 'FIN_WAIT_2'
  | 'CLOSE_WAIT'
  | 'LAST_ACK'
  | 'TIME_WAIT';
export type SegKind = 'syn' | 'synack' | 'ack' | 'data' | 'fin' | 'probe' | 'wupd';
export type CcAlgo = 'none' | 'reno' | 'cubic' | 'bbr';
export type LossKind = 'fast' | 'rto';
export type DropWhy = 'random' | 'queue' | 'user' | 'outage' | 'script';
export type TimerKind = 'syn' | 'synack' | 'rto' | 'persist' | 'timewait' | 'fin';

export interface Seg {
  id: number;
  from: Side;
  kind: SegKind;
  /** Relative sequence number of the first byte (SYN = 0) */
  seq: number;
  /** Payload bytes */
  len: number;
  /** Relative acknowledgment number, -1 when the ACK flag is off */
  ack: number;
  /** Advertised receive window, bytes */
  win: number;
  /** SACK blocks, relative [start, end) */
  sack: [number, number][];
  /** Data segment index, -1 for control segments */
  idx: number;
  rtx: boolean;
  /** Duplicate ACK ordinal as the receiver sent it (0 = not a duplicate) */
  dup: number;
  /** Reply to a zero-window probe */
  probeReply: boolean;
  /** Model ms when it left */
  sent: number;
  /** Model ms when it reaches the other end (planned, also for lost ones) */
  arrive: number;
  /** Bottleneck path: arrival at and departure from the router */
  hop: { at: number; dep: number } | null;
  /** Fraction of its leg where it was lost */
  lostAt: number | null;
  lossT: number | null;
  status: 'flight' | 'done' | 'lost';
  drop: DropWhy | null;
  /** Hide the ack number (the learner is predicting it) */
  conceal: boolean;
  /** Pending arrival event */
  ev: Ev | null;
}

export interface TcpConfig {
  mss: number;
  /** One-way propagation delay, ms */
  owd: number;
  /** Random extra delay, 0..jitter ms */
  jitter: number;
  path: 'direct' | 'bottleneck';
  /** Bottleneck: ms to forward one full segment */
  svc: number;
  /** Bottleneck: router buffer in segments (including the one being sent) */
  qcap: number;
  /** Sender NIC: min ms between segments */
  gap: number;
  /** Random loss probability for data segments */
  loss: number;
  /** Random loss probability for ACKs */
  ackLoss: number;
  /** Data segments to send (Infinity = bulk transfer) */
  total: number;
  /** Payload of the last segment */
  lastLen: number;
  /** Bytes already exchanged before this scenario began */
  preBytes: number;
  cc: CcAlgo;
  /** Window in segments when cc = 'none' */
  fixedWnd: number;
  initCwnd: number;
  initSsthresh: number;
  fastRetransmit: boolean;
  /** Receiver sends SACK blocks (RFC 2018) and the sender uses them */
  sack: boolean;
  rtoMin: number;
  rtoInit: number;
  /** Server receive buffer, segments */
  rbuf: number;
  /** Server app reads this many segments per second (Infinity = immediately) */
  appRate: number;
  delAck: boolean;
  delAckMs: number;
  /** CUBIC's C, scaled up so the curve fits in a lesson */
  cubicC: number;
  /** TIME_WAIT = 2 x MSL; Linux uses 60 s */
  timeWait: number;
  /** How long after the handshake ACK the app's first write goes out, ms */
  firstData: number;
  /** Fixed initial sequence numbers [client, server] (default: random) */
  isn: [number, number] | null;
  /** How long the server app takes to close after the client's FIN */
  closeDelay: number;
  /** Model ms per on-screen second */
  msPerSec: number;
  /** Fast-forward idle waits longer than warpMin ms */
  warp: boolean;
  warpMin: number;
  seed: number;
}

export const TCP_DEFAULTS: TcpConfig = {
  mss: 1460,
  owd: 50,
  jitter: 3,
  path: 'direct',
  svc: 12.5,
  qcap: 8,
  gap: 18,
  loss: 0,
  ackLoss: 0,
  total: Infinity,
  lastLen: 1460,
  preBytes: 0,
  cc: 'none',
  fixedWnd: 4,
  initCwnd: 10,
  initSsthresh: Infinity,
  fastRetransmit: true,
  sack: true,
  rtoMin: 200,
  rtoInit: 1000,
  rbuf: 44,
  appRate: Infinity,
  delAck: false,
  delAckMs: 40,
  cubicC: 40,
  timeWait: 60000,
  isn: null,
  firstData: 30,
  closeDelay: 30,
  msPerSec: 62.5,
  warp: true,
  warpMin: 450,
  seed: 7,
};

export interface Ev {
  at: number;
  n: number;
  run: () => void;
  dead: boolean;
}

interface TxRec {
  t: number;
  count: number;
  /** Delivery-rate bookkeeping (as in Linux tcp_rate.c) */
  delivered: number;
  deliveredTime: number;
  firstSent: number;
}

export interface Note {
  id: number;
  side: Side;
  ms: number;
  text: string;
  tone: 'state' | 'good' | 'warn' | 'bad' | 'ctl';
}

export interface TimerLog {
  id: number;
  kind: TimerKind;
  side: Side;
  start: number;
  deadline: number;
  end: number | null;
  fired: boolean;
}

export interface CwndPt {
  ms: number;
  cwnd: number;
  ssthresh: number;
  q: number;
}

export interface LossMark {
  ms: number;
  kind: LossKind;
  cwnd: number;
}

export interface Warp {
  ms0: number;
  ms1: number;
  disp0: number;
  disp1: number;
}

export type ModelEvent =
  | { type: 'state'; side: Side; state: TcpState }
  | { type: 'lost'; seg: Seg }
  | { type: 'rto' }
  | { type: 'fast'; idx: number }
  | { type: 'zero' }
  | { type: 'probe' }
  | { type: 'queueDrop'; seg: Seg };

export interface Hooks {
  onSend?: (s: Seg) => void;
  /** Return true to take over: the model waits until you call apply() */
  onLoss?: (kind: LossKind, apply: () => void) => boolean;
  onEvent?: (e: ModelEvent) => void;
  /** Checked after every event; true stops processing (the sim froze) */
  stop?: () => boolean;
}

export interface Stats {
  newSegs: number;
  rtx: number;
  fastRtx: number;
  timeouts: number;
  dropsRandom: number;
  dropsQueue: number;
  dropsUser: number;
  dropsScript: number;
  dropsOutage: number;
  dupAcksIn: number;
  dupData: number;
  probes: number;
  zeroWin: number;
  segsOut: number;
}

const U32 = 4294967296;
const HIGH_GAIN = 2.885;
const BBR_GAINS = [1.25, 0.75, 1, 1, 1, 1, 1, 1];

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class TcpModel {
  cfg: TcpConfig;
  now = 0;
  /** On-screen seconds elapsed (drives the sequence diagram's vertical axis) */
  disp = 0;
  hooks: Hooks = {};

  segs: Seg[] = [];
  notes: Note[] = [];
  timerLog: TimerLog[] = [];
  warps: Warp[] = [];
  cwndHist: CwndPt[] = [];
  lossMarks: LossMark[] = [];
  stats: Stats = {
    newSegs: 0,
    rtx: 0,
    fastRtx: 0,
    timeouts: 0,
    dropsRandom: 0,
    dropsQueue: 0,
    dropsUser: 0,
    dropsScript: 0,
    dropsOutage: 0,
    dupAcksIn: 0,
    dupData: 0,
    probes: 0,
    zeroWin: 0,
    segsOut: 0,
  };

  /* ---------- connection state ---------- */
  cState: TcpState = 'CLOSED';
  sState: TcpState = 'LISTEN';
  cIss = 0;
  sIss = 0;

  /* ---------- client: the data sender ---------- */
  una = 0;
  nxt = 0;
  cwnd: number;
  ssthresh: number;
  /** Right edge of the receiver's window, as a segment index (exclusive) */
  sndRight = 0;
  lastWin = -1;
  sacked = new Set<number>();
  lost = new Set<number>();
  dupacks = 0;
  inRecovery = false;
  srtt = 0;
  rttvar = 0;
  rto: number;
  lastRtt = 0;
  closeWanted = false;
  /** Next byte the client expects from the server */
  cRcv = 0;

  /* ---------- server: the receiver ---------- */
  rcvNxt = 0;
  ooo = new Set<number>();
  appRead = 0;
  appStalled = false;
  finRcvd = false;
  lastAckOut = -1;
  lastWinOut = -1;
  lastData: Seg | null = null;
  srvSrtt = 0;

  /* ---------- network ---------- */
  outageUntil = -1;
  /** Next matching segments are dropped (scripted or by the learner) */
  dropNext: { kind: SegKind; from?: Side; n: number }[] = [];
  /** First transmission of these data segments is dropped */
  dropIdx = new Set<number>();

  private rng: () => number;
  private q: Ev[] = [];
  private evN = 0;
  private segN = 1;
  private noteN = 1;
  private timerN = 1;
  private knots: { ms: number; disp: number; rate: number }[] = [];
  private warpOn: { until: number; rate: number; ms0: number; disp0: number } | null = null;
  private timers = new Map<string, { ev: Ev; log: TimerLog }>();
  private tx = new Map<number, TxRec>();
  private rtxd = new Set<number>();
  private recover = 0;
  private rtoRecover = 0;
  /** Consecutive timeouts without progress (ssthresh is held after the first) */
  private rtoStreak = 0;
  private forceRtx = false;
  private nicFree = 0;
  private txEv: Ev | null = null;
  private persistIv = 0;
  private delivered = 0;
  private deliveredTime = 0;
  private firstSent = 0;
  private dupRun = 0;
  private pendingAcks = 0;
  private delackEv: Ev | null = null;
  private readEv: Ev | null = null;
  private lastRead = -1e9;
  private lastOoo = -1;
  private routerFree = 0;
  private synSentAt = 0;
  private synRtx = false;
  private synTries = 0;
  private synAckSentAt = 0;
  private synAckRtx = false;
  private synAckTries = 0;
  private finTriesC = 0;
  private finTriesS = 0;
  private ackLog: { ms: number; segs: number }[] = [];
  private bbr = {
    mode: 'startup' as 'startup' | 'drain' | 'probe_bw',
    btlBw: 0,
    samples: [] as { round: number; bw: number }[],
    minRtt: Infinity,
    round: 0,
    nextRound: 0,
    fullBw: 0,
    fullCnt: 0,
    cycle: 2,
    cycleStamp: 0,
    pacingGain: HIGH_GAIN,
    cwndGain: HIGH_GAIN,
  };
  private cub = { wMax: 0, lastMax: 0, k: 0, epoch: -1, origin: 0 };

  constructor(cfg: Partial<TcpConfig> = {}) {
    this.cfg = { ...TCP_DEFAULTS, ...cfg };
    this.rng = mulberry(this.cfg.seed);
    this.cwnd = this.cfg.initCwnd;
    this.ssthresh = this.cfg.initSsthresh;
    this.rto = this.cfg.rtoInit;
    this.knots.push({ ms: 0, disp: 0, rate: this.cfg.msPerSec });
  }

  /* ================================================================ */
  /* Scenarios                                                         */
  /* ================================================================ */

  /** Fresh listening server and a closed client: call connect() to start. */
  startClosed() {
    this.cState = 'CLOSED';
    this.sState = 'LISTEN';
    this.note('s', 'LISTEN', 'state');
  }

  /** Skip the handshake: both sides ESTABLISHED, RTT already measured once. */
  startEstablished() {
    this.cIss = this.rand32();
    this.sIss = this.rand32();
    this.cState = 'ESTABLISHED';
    this.sState = 'ESTABLISHED';
    this.cRcv = 1;
    const base = this.baseRtt();
    this.rttSample(base);
    this.srvSrtt = base;
    this.sndRight = this.cfg.rbuf;
    this.lastWin = this.cfg.rbuf * this.cfg.mss;
    this.sample(true);
  }

  baseRtt() {
    return 2 * this.cfg.owd + (this.cfg.path === 'bottleneck' ? this.cfg.svc : 0);
  }

  /** Client: open the connection (active open). */
  connect() {
    if (this.cState !== 'CLOSED') return;
    this.cIss = this.cfg.isn ? this.cfg.isn[0] : this.rand32();
    this.setState('c', 'SYN_SENT');
    this.synTries = 0;
    this.synRtx = false;
    this.sendSyn(false);
  }

  /** Client: start (or continue) sending data. */
  kick() {
    this.trySend();
  }

  /** Client app closes: FIN goes out once every byte is acknowledged. */
  close() {
    this.closeWanted = true;
    this.maybeFin();
  }

  /* ================================================================ */
  /* Clock                                                             */
  /* ================================================================ */

  advance(dtSec: number) {
    if (dtSec <= 0) return;
    this.trimQueue();
    if (!this.q.length && !this.anyInFlight()) {
      // Nothing is happening: hold the clock (and stop any fast-forward).
      if (this.warpOn) this.endWarp();
      return;
    }
    if (this.warpOn && (this.now >= this.warpOn.until || this.anyInFlight())) this.endWarp();
    if (!this.warpOn && this.cfg.warp && !this.anyInFlight() && this.q.length) {
      const wait = this.q[0].at - this.now;
      if (wait > this.cfg.warpMin) this.beginWarp(this.q[0].at, wait / 1.2);
    }
    const rate = this.warpOn ? this.warpOn.rate : this.cfg.msPerSec;
    const target = this.now + dtSec * rate;
    while (this.q.length && this.q[0].at <= target) {
      const ev = this.q.shift()!;
      if (ev.dead) continue;
      this.moveTo(Math.max(this.now, ev.at), rate);
      ev.run();
      if (this.warpOn && this.anyInFlight()) {
        this.endWarp();
        this.sample(false);
        return;
      }
      if (this.hooks.stop?.()) {
        this.sample(false);
        return;
      }
    }
    this.moveTo(target, rate);
    this.sample(false);
  }

  private moveTo(ms: number, rate: number) {
    this.disp += (ms - this.now) / rate;
    this.now = ms;
  }

  private beginWarp(until: number, rate: number) {
    this.warpOn = { until, rate, ms0: this.now, disp0: this.disp };
    this.knots.push({ ms: this.now, disp: this.disp, rate });
  }

  private endWarp() {
    const w = this.warpOn;
    if (!w) return;
    this.warps.push({ ms0: w.ms0, ms1: this.now, disp0: w.disp0, disp1: this.disp });
    this.knots.push({ ms: this.now, disp: this.disp, rate: this.cfg.msPerSec });
    this.warpOn = null;
  }

  get warping() {
    return !!this.warpOn;
  }

  /** Map a model time to on-screen seconds (compressing fast-forwarded waits). */
  msToDisp(ms: number) {
    const ks = this.knots;
    let k = ks[0];
    for (let i = ks.length - 1; i >= 0; i--) {
      if (ks[i].ms <= ms) {
        k = ks[i];
        break;
      }
    }
    return k.disp + (ms - k.ms) / k.rate;
  }

  quiescent() {
    this.trimQueue();
    return !this.q.length && !this.anyInFlight();
  }

  anyInFlight() {
    for (let i = this.segs.length - 1; i >= 0; i--) if (this.segs[i].status === 'flight') return true;
    return false;
  }

  private trimQueue() {
    while (this.q.length && this.q[0].dead) this.q.shift();
  }

  private at(ms: number, run: () => void): Ev {
    const ev: Ev = { at: ms, n: this.evN++, run, dead: false };
    const q = this.q;
    let lo = 0;
    let hi = q.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (q[mid].at < ms || (q[mid].at === ms && q[mid].n < ev.n)) lo = mid + 1;
      else hi = mid;
    }
    q.splice(lo, 0, ev);
    return ev;
  }

  private armTimer(key: string, kind: TimerKind, side: Side, ms: number, fire: () => void) {
    this.cancelTimer(key);
    const log: TimerLog = { id: this.timerN++, kind, side, start: this.now, deadline: this.now + ms, end: null, fired: false };
    this.timerLog.push(log);
    const ev = this.at(this.now + ms, () => {
      this.timers.delete(key);
      log.end = this.now;
      log.fired = true;
      fire();
    });
    this.timers.set(key, { ev, log });
  }

  private cancelTimer(key: string) {
    const t = this.timers.get(key);
    if (!t) return;
    t.ev.dead = true;
    this.timers.delete(key);
    // Cancelled timers did their job quietly: forget them so drawings stay clean.
    // A restarted TIME_WAIT is the exception: its first stretch still happened.
    if (t.log.kind === 'timewait') t.log.end = this.now;
    else this.timerLog = this.timerLog.filter((l) => l !== t.log);
  }

  timer(key: string): TimerLog | null {
    return this.timers.get(key)?.log ?? null;
  }

  /* ================================================================ */
  /* Byte arithmetic                                                   */
  /* ================================================================ */

  segSeq(i: number) {
    return 1 + this.cfg.preBytes + i * this.cfg.mss;
  }

  segLen(i: number) {
    return i === this.cfg.total - 1 ? this.cfg.lastLen : this.cfg.mss;
  }

  /** Bytes in data segments [0, k) */
  bytesThrough(k: number) {
    if (k <= 0) return 0;
    const { total, mss, lastLen } = this.cfg;
    if (!Number.isFinite(total) || k < total) return k * mss;
    return (total - 1) * mss + lastLen;
  }

  totalBytes() {
    return Number.isFinite(this.cfg.total) ? this.bytesThrough(this.cfg.total) : Infinity;
  }

  ackForIdx(k: number) {
    return 1 + this.cfg.preBytes + this.bytesThrough(k);
  }

  idxForAck(ack: number) {
    const b = ack - 1 - this.cfg.preBytes;
    const tb = this.totalBytes();
    if (b >= tb) return this.cfg.total;
    return Math.max(0, Math.floor(b / this.cfg.mss));
  }

  finSeqC() {
    const tb = this.totalBytes();
    return 1 + this.cfg.preBytes + (Number.isFinite(tb) ? tb : 0);
  }

  absC(rel: number) {
    return (this.cIss + rel) % U32;
  }

  absS(rel: number) {
    return (this.sIss + rel) % U32;
  }

  private rand32() {
    // Keep ISNs comfortably 10 digits so "+1" is easy to spot.
    return 1000000000 + Math.floor(this.rng() * 3000000000);
  }

  /* ================================================================ */
  /* Segments on the wire                                              */
  /* ================================================================ */

  private mkSeg(
    from: Side,
    kind: SegKind,
    o: { seq: number; len?: number; ack: number; win: number; sack?: [number, number][]; idx?: number; rtx?: boolean; dup?: number; probeReply?: boolean },
  ): Seg {
    return {
      id: this.segN++,
      from,
      kind,
      seq: o.seq,
      len: o.len ?? 0,
      ack: o.ack,
      win: o.win,
      sack: o.sack ?? [],
      idx: o.idx ?? -1,
      rtx: !!o.rtx,
      dup: o.dup ?? 0,
      probeReply: !!o.probeReply,
      sent: this.now,
      arrive: this.now,
      hop: null,
      lostAt: null,
      lossT: null,
      status: 'flight',
      drop: null,
      conceal: false,
      ev: null,
    };
  }

  private jitter() {
    return this.cfg.jitter ? this.rng() * this.cfg.jitter : 0;
  }

  private takeForcedDrop(s: Seg) {
    if (s.kind === 'data' && !s.rtx && this.dropIdx.has(s.idx)) {
      this.dropIdx.delete(s.idx);
      return true;
    }
    const i = this.dropNext.findIndex((d) => d.kind === s.kind && (!d.from || d.from === s.from));
    if (i < 0) return false;
    const d = this.dropNext[i];
    d.n -= 1;
    if (d.n <= 0) this.dropNext.splice(i, 1);
    return true;
  }

  private transmit(s: Seg) {
    const c = this.cfg;
    this.segs.push(s);
    this.stats.segsOut++;
    const viaRouter = c.path === 'bottleneck' && s.from === 'c';
    const leg1 = viaRouter ? c.owd / 2 : c.owd;
    s.arrive = this.now + leg1 + this.jitter() + (viaRouter ? c.svc + c.owd / 2 : 0);

    let why: DropWhy | null = null;
    if (this.takeForcedDrop(s)) why = 'script';
    else if (s.from === 'c' && (s.kind === 'data' || s.kind === 'probe') && this.now < this.outageUntil) why = 'outage';
    else if (s.kind === 'data' && c.loss > 0 && this.rng() < c.loss) why = 'random';
    else if ((s.kind === 'ack' || s.kind === 'wupd') && c.ackLoss > 0 && this.rng() < c.ackLoss) why = 'random';

    if (why) {
      const frac = why === 'script' ? 0.5 : 0.28 + this.rng() * 0.44;
      const legEnd = viaRouter ? this.now + leg1 : s.arrive;
      const t = this.now + frac * (legEnd - this.now);
      s.ev = this.at(t, () => this.lose(s, frac, why as DropWhy));
    } else if (viaRouter) {
      s.ev = this.at(this.now + leg1, () => this.routerIn(s));
    } else {
      s.ev = this.at(s.arrive, () => this.deliver(s));
    }
    this.hooks.onSend?.(s);
  }

  private lose(s: Seg, frac: number, why: DropWhy) {
    if (s.status !== 'flight') return;
    s.status = 'lost';
    s.lostAt = frac;
    s.lossT = this.now;
    s.drop = why;
    s.ev = null;
    if (why === 'random') this.stats.dropsRandom++;
    else if (why === 'outage') this.stats.dropsOutage++;
    else if (why === 'script') this.stats.dropsScript++;
    this.hooks.onEvent?.({ type: 'lost', seg: s });
  }

  /** The learner clicked a segment: lose it right where it is. */
  dropSeg(id: number): boolean {
    const s = this.segs.find((x) => x.id === id);
    if (!s || s.status !== 'flight') return false;
    if (s.hop && this.now >= s.hop.at && this.now < s.hop.dep) return false; // sitting in the router queue
    let frac: number;
    if (s.hop) frac = (this.now - s.hop.dep) / Math.max(1e-6, s.arrive - s.hop.dep);
    else if (this.cfg.path === 'bottleneck' && s.from === 'c') frac = (this.now - s.sent) / (this.cfg.owd / 2);
    else frac = (this.now - s.sent) / Math.max(1e-6, s.arrive - s.sent);
    if (s.ev) s.ev.dead = true;
    s.status = 'lost';
    s.lostAt = Math.min(1, Math.max(0, frac));
    s.lossT = this.now;
    s.drop = 'user';
    s.ev = null;
    this.stats.dropsUser++;
    this.hooks.onEvent?.({ type: 'lost', seg: s });
    return true;
  }

  /** Segments waiting in (or being sent by) the router right now, oldest first. */
  routerQueue(): Seg[] {
    const out: Seg[] = [];
    for (const s of this.segs) if (s.hop && s.status === 'flight' && this.now >= s.hop.at && this.now < s.hop.dep) out.push(s);
    return out.sort((a, b) => (a.hop as { dep: number }).dep - (b.hop as { dep: number }).dep);
  }

  private routerIn(s: Seg) {
    if (s.status !== 'flight') return;
    const c = this.cfg;
    if (this.routerQueue().length >= c.qcap) {
      s.status = 'lost';
      s.drop = 'queue';
      s.lostAt = 1;
      s.lossT = this.now;
      s.ev = null;
      this.stats.dropsQueue++;
      this.hooks.onEvent?.({ type: 'queueDrop', seg: s });
      return;
    }
    const dep = Math.max(this.now, this.routerFree) + c.svc * (s.len > 0 ? s.len / c.mss : 0.2);
    this.routerFree = dep;
    s.hop = { at: this.now, dep };
    s.arrive = dep + c.owd / 2;
    s.ev = this.at(s.arrive, () => this.deliver(s));
  }

  /** A burst of total loss on the uplink (e.g. a Wi-Fi hiccup). */
  outage(ms: number) {
    this.outageUntil = this.now + ms;
  }

  private deliver(s: Seg) {
    if (s.status !== 'flight') return;
    s.status = 'done';
    s.ev = null;
    if (s.from === 'c') this.srvRecv(s);
    else this.cliRecv(s);
  }

  /* ================================================================ */
  /* Server (receiver)                                                 */
  /* ================================================================ */

  private srvRecv(s: Seg) {
    switch (this.sState) {
      case 'LISTEN':
        if (s.kind === 'syn') {
          this.sIss = this.cfg.isn ? this.cfg.isn[1] : this.rand32();
          this.setState('s', 'SYN_RECEIVED');
          this.synAckTries = 0;
          this.synAckRtx = false;
          this.sendSynAck(false);
        }
        return;
      case 'SYN_RECEIVED':
        if (s.kind === 'syn') {
          this.sendSynAck(true);
          return;
        }
        if (s.ack === 1) {
          this.cancelTimer('synack');
          if (!this.synAckRtx) this.srvSrtt = this.now - this.synAckSentAt;
          this.setState('s', 'ESTABLISHED');
          if (s.kind === 'data') this.srvData(s);
        }
        return;
      case 'ESTABLISHED':
      case 'CLOSE_WAIT':
        if (s.kind === 'data') this.srvData(s);
        else if (s.kind === 'probe') this.srvAck('ack', true);
        else if (s.kind === 'fin') this.srvFin();
        return;
      case 'LAST_ACK':
        if (s.kind === 'fin') this.srvAck('ack');
        else if (s.ack === 2) {
          this.cancelTimer('fins');
          this.setState('s', 'CLOSED');
        }
        return;
      default:
        return;
    }
  }

  private sendSynAck(rtx: boolean) {
    const s = this.mkSeg('s', 'synack', { seq: 0, ack: 1, win: this.cfg.rbuf * this.cfg.mss, rtx });
    this.synAckSentAt = this.now;
    if (rtx) this.synAckRtx = true;
    this.transmit(s);
    const iv = this.cfg.rtoInit * Math.pow(2, this.synAckTries++);
    this.armTimer('synack', 'synack', 's', iv, () => {
      if (this.sState === 'SYN_RECEIVED') this.sendSynAck(true);
    });
  }

  private srvData(s: Seg) {
    const i = s.idx;
    this.lastData = s;
    const right = this.appRead + this.cfg.rbuf;
    let immediate = false;
    if (i < this.rcvNxt || this.ooo.has(i)) {
      immediate = true;
      this.stats.dupData++;
    } else if (i >= right) {
      immediate = true; // outside the window: dropped, but say where the window is
    } else if (i === this.rcvNxt) {
      const filledHole = this.ooo.size > 0;
      this.rcvNxt++;
      while (this.ooo.has(this.rcvNxt)) {
        this.ooo.delete(this.rcvNxt);
        this.rcvNxt++;
      }
      this.readable();
      if (filledHole || !this.cfg.delAck) immediate = true;
      else {
        this.pendingAcks++;
        if (this.pendingAcks >= 2) immediate = true;
        else if (!this.delackEv)
          this.delackEv = this.at(this.now + this.cfg.delAckMs, () => {
            this.delackEv = null;
            this.srvAck('ack');
          });
      }
    } else {
      this.ooo.add(i);
      this.lastOoo = i;
      immediate = true; // out of order: ACK right away (a duplicate ACK)
    }
    if (immediate) this.srvAck('ack');
  }

  private srvFin() {
    if (this.finRcvd) {
      this.srvAck('ack');
      return;
    }
    this.finRcvd = true;
    this.setState('s', 'CLOSE_WAIT');
    this.srvAck('ack');
    this.at(this.now + this.cfg.closeDelay, () => {
      if (this.sState !== 'CLOSE_WAIT') return;
      this.setState('s', 'LAST_ACK');
      this.finTriesS = 0;
      this.sendFinS(false);
    });
  }

  private sendFinS(rtx: boolean) {
    const s = this.mkSeg('s', 'fin', { seq: 1, ack: this.srvAckNo(), win: this.advWin(), rtx });
    this.transmit(s);
    const rto = Math.max(this.cfg.rtoMin, (this.srvSrtt || this.baseRtt()) + this.cfg.rtoMin);
    this.armTimer('fins', 'fin', 's', rto * Math.pow(2, this.finTriesS++), () => {
      if (this.sState === 'LAST_ACK') this.sendFinS(true);
    });
  }

  srvAckNo() {
    return this.ackForIdx(this.rcvNxt) + (this.finRcvd ? 1 : 0);
  }

  /** Receive window the server advertises, bytes */
  advWin() {
    return Math.max(0, this.appRead + this.cfg.rbuf - this.rcvNxt) * this.cfg.mss;
  }

  private sackBlocks(): [number, number][] {
    if (!this.cfg.sack || !this.ooo.size) return [];
    const idx = [...this.ooo].sort((a, b) => a - b);
    const ranges: [number, number][] = [];
    let a = idx[0];
    let b = idx[0];
    for (let k = 1; k < idx.length; k++) {
      if (idx[k] === b + 1) b = idx[k];
      else {
        ranges.push([a, b]);
        a = b = idx[k];
      }
    }
    ranges.push([a, b]);
    // Most recently received block first (RFC 2018), at most 3.
    ranges.sort((x, y) => (x[0] <= this.lastOoo && this.lastOoo <= x[1] ? -1 : y[0] <= this.lastOoo && this.lastOoo <= y[1] ? 1 : y[0] - x[0]));
    return ranges.slice(0, 3).map(([x, y]) => [this.ackForIdx(x), this.ackForIdx(y + 1)]);
  }

  private srvAck(kind: 'ack' | 'wupd', probeReply = false) {
    if (this.delackEv) {
      this.delackEv.dead = true;
      this.delackEv = null;
    }
    this.pendingAcks = 0;
    const ack = this.srvAckNo();
    const win = this.advWin();
    const isDup = kind === 'ack' && !probeReply && ack === this.lastAckOut && win === this.lastWinOut;
    this.dupRun = isDup ? this.dupRun + 1 : 0;
    const s = this.mkSeg('s', kind, { seq: 1, ack, win, sack: this.sackBlocks(), dup: this.dupRun, probeReply });
    if (win === 0 && this.lastWinOut !== 0) {
      this.stats.zeroWin++;
      this.hooks.onEvent?.({ type: 'zero' });
    }
    this.lastAckOut = ack;
    this.lastWinOut = win;
    this.transmit(s);
  }

  private readable() {
    if (this.appStalled) return;
    if (!Number.isFinite(this.cfg.appRate)) {
      this.appRead = this.rcvNxt;
      return;
    }
    this.scheduleRead();
  }

  private scheduleRead() {
    if (this.readEv || this.appStalled || this.appRead >= this.rcvNxt || !Number.isFinite(this.cfg.appRate)) return;
    const t = Math.max(this.now, this.lastRead + 1000 / this.cfg.appRate);
    this.readEv = this.at(t, () => {
      this.readEv = null;
      this.readOne();
    });
  }

  private readOne() {
    if (this.appStalled || this.appRead >= this.rcvNxt) return;
    this.appRead++;
    this.lastRead = this.now;
    this.windowUpdateIfNeeded();
    this.scheduleRead();
  }

  private windowUpdateIfNeeded() {
    const open = this.sState === 'ESTABLISHED' || this.sState === 'CLOSE_WAIT';
    if (open && this.lastWinOut === 0 && this.advWin() > 0) this.srvAck('wupd');
  }

  setAppStalled(v: boolean) {
    this.appStalled = v;
    if (v) {
      if (this.readEv) this.readEv.dead = true;
      this.readEv = null;
      return;
    }
    if (!Number.isFinite(this.cfg.appRate)) this.appRead = this.rcvNxt;
    this.windowUpdateIfNeeded();
    this.scheduleRead();
  }

  setAppRate(r: number) {
    this.cfg = { ...this.cfg, appRate: r };
    if (this.readEv) this.readEv.dead = true;
    this.readEv = null;
    this.readable();
    this.windowUpdateIfNeeded();
  }

  /* ================================================================ */
  /* Client (sender)                                                   */
  /* ================================================================ */

  private cliWin() {
    return 64240;
  }

  private sendSyn(rtx: boolean) {
    const s = this.mkSeg('c', 'syn', { seq: 0, ack: -1, win: this.cliWin(), rtx });
    this.synSentAt = this.now;
    if (rtx) this.synRtx = true;
    this.transmit(s);
    const iv = this.cfg.rtoInit * Math.pow(2, this.synTries++);
    this.armTimer('syn', 'syn', 'c', iv, () => {
      if (this.cState === 'SYN_SENT') this.sendSyn(true);
    });
  }

  private cliAckOnly() {
    const seq = this.cState === 'TIME_WAIT' ? this.finSeqC() + 1 : 1;
    const s = this.mkSeg('c', 'ack', { seq, ack: this.cRcv, win: this.cliWin() });
    this.transmit(s);
  }

  private cliRecv(s: Seg) {
    switch (this.cState) {
      case 'SYN_SENT':
        if (s.kind === 'synack' && s.ack === 1) {
          this.cancelTimer('syn');
          this.cRcv = 1;
          if (!this.synRtx) this.rttSample(this.now - this.synSentAt);
          this.sndRight = Math.floor(s.win / this.cfg.mss);
          this.lastWin = s.win;
          this.setState('c', 'ESTABLISHED');
          this.cliAckOnly();
          this.nicFree = this.now + Math.max(this.cfg.gap, this.cfg.firstData); // the app's first write follows the ACK
          this.sample(true);
          this.trySend();
          this.maybeFin();
        }
        return;
      case 'ESTABLISHED':
        if (s.kind === 'synack') this.cliAckOnly(); // our ACK was lost: say it again
        else if (s.ack >= 0) this.cliAck(s);
        return;
      case 'FIN_WAIT_1':
        if (s.ack === this.finSeqC() + 1) {
          this.cancelTimer('finc');
          this.setState('c', 'FIN_WAIT_2');
        }
        if (s.kind === 'fin') this.cliFin();
        return;
      case 'FIN_WAIT_2':
        if (s.kind === 'fin') this.cliFin();
        return;
      case 'TIME_WAIT':
        if (s.kind === 'fin') {
          this.cliAckOnly();
          this.armTimer('tw', 'timewait', 'c', this.cfg.timeWait, () => this.setState('c', 'CLOSED'));
        }
        return;
      default:
        return;
    }
  }

  private cliFin() {
    this.cRcv = 2;
    this.setState('c', 'TIME_WAIT');
    this.cliAckOnly();
    this.armTimer('tw', 'timewait', 'c', this.cfg.timeWait, () => this.setState('c', 'CLOSED'));
  }

  private maybeFin() {
    if (!this.closeWanted || this.cState !== 'ESTABLISHED') return;
    if (Number.isFinite(this.cfg.total) && this.una < this.cfg.total) return;
    if (!Number.isFinite(this.cfg.total)) return;
    this.setState('c', 'FIN_WAIT_1');
    this.finTriesC = 0;
    this.sendFinC(false);
  }

  private sendFinC(rtx: boolean) {
    const s = this.mkSeg('c', 'fin', { seq: this.finSeqC(), ack: this.cRcv, win: this.cliWin(), rtx });
    this.transmit(s);
    this.armTimer('finc', 'fin', 'c', this.rto * Math.pow(2, this.finTriesC++), () => {
      if (this.cState === 'FIN_WAIT_1') this.sendFinC(true);
    });
  }

  /** Effective congestion window in whole segments. */
  wnd() {
    return this.cfg.cc === 'none' ? this.cfg.fixedWnd : Math.max(1, Math.floor(this.cwnd + 1e-9));
  }

  /** Segments the sender believes are still in the network (RFC 6675 "pipe"). */
  pipe() {
    let p = 0;
    for (let i = this.una; i < this.nxt; i++) if (!this.sacked.has(i) && !this.lost.has(i)) p++;
    return p;
  }

  /** Receiver window in segments, as the sender sees it now. */
  rwndSegs() {
    return Math.max(0, this.sndRight - this.una);
  }

  private firstLost() {
    let best = -1;
    for (const i of this.lost) if (i >= this.una && !this.sacked.has(i) && (best < 0 || i < best)) best = i;
    return best;
  }

  private canSendData() {
    return this.cState === 'ESTABLISHED';
  }

  private trySend() {
    if (!this.canSendData() || this.txEv) return;
    if (this.now < this.nicFree - 1e-9) {
      this.txEv = this.at(this.nicFree, () => {
        this.txEv = null;
        this.trySend();
      });
      return;
    }
    const w = this.wnd();
    const pipe = this.pipe();
    let i = -1;
    let rtx = false;
    const lostNext = this.firstLost();
    if (lostNext >= 0 && (pipe < w || this.forceRtx)) {
      i = lostNext;
      rtx = true;
      this.forceRtx = false;
    } else if (this.nxt < this.cfg.total && this.nxt < this.sndRight && pipe < w) {
      i = this.nxt;
    }
    if (i < 0) {
      this.maybePersist();
      return;
    }
    if (rtx) {
      this.lost.delete(i);
      this.rtxd.add(i);
    } else this.nxt++;
    this.sendData(i, rtx);
    this.nicFree = this.now + this.pacingGap();
    this.txEv = this.at(this.nicFree, () => {
      this.txEv = null;
      this.trySend();
    });
  }

  private pacingGap() {
    if (this.cfg.cc !== 'bbr') return this.cfg.gap;
    const b = this.bbr;
    const rate = b.btlBw > 0 ? b.pacingGain * b.btlBw : (HIGH_GAIN * this.cfg.initCwnd) / (this.srtt || this.baseRtt());
    return Math.max(this.cfg.gap, 1 / rate);
  }

  private sendData(i: number, rtx: boolean) {
    const s = this.mkSeg('c', 'data', { seq: this.segSeq(i), len: this.segLen(i), ack: this.cRcv, win: this.cliWin(), idx: i, rtx });
    const rec = this.tx.get(i);
    if (this.pipe() === 0) {
      // Nothing in flight: restart the delivery-rate clocks from now.
      this.firstSent = this.now;
      this.deliveredTime = this.now;
    }
    this.tx.set(i, { t: this.now, count: (rec?.count ?? 0) + 1, delivered: this.delivered, deliveredTime: this.deliveredTime, firstSent: this.firstSent });
    if (rtx) this.stats.rtx++;
    else this.stats.newSegs++;
    if (!this.timers.has('rto')) this.armRto();
    this.transmit(s);
  }

  private cliAck(s: Seg) {
    const ackIdx = this.idxForAck(s.ack);
    // Everything this ACK newly reports as delivered, cumulatively or by SACK.
    const fresh: number[] = [];
    for (let i = this.una; i < ackIdx; i++) if (!this.sacked.has(i)) fresh.push(i);
    for (const [a, b] of s.sack) {
      const i0 = this.idxForAck(a);
      const i1 = this.idxForAck(b);
      for (let i = Math.max(i0, this.una); i < i1; i++) {
        if (!this.sacked.has(i)) fresh.push(i);
        this.sacked.add(i);
      }
    }
    let cand: TxRec | null = null;
    for (const i of fresh) {
      const r = this.tx.get(i);
      if (r && (!cand || r.t > cand.t)) cand = r;
    }
    if (fresh.length) {
      this.delivered += fresh.length;
      this.deliveredTime = this.now;
      if (cand) this.firstSent = cand.t;
    }
    const winChanged = s.win !== this.lastWin;
    this.lastWin = s.win;
    const right = ackIdx + Math.floor(s.win / this.cfg.mss);
    if (right > this.sndRight) this.sndRight = right;

    if (ackIdx > this.una) this.newAck(ackIdx);
    else if (ackIdx === this.una && this.una < this.nxt && !winChanged && (s.kind === 'ack' || s.kind === 'wupd') && !s.probeReply) this.dupAck();
    if (this.cfg.cc === 'bbr' && fresh.length) this.bbrUpdate(fresh.length, cand);

    if (this.sndRight > this.nxt && this.timers.has('persist')) {
      this.cancelTimer('persist');
      this.persistIv = 0;
    }
    this.trySend();
    this.maybeFin();
  }

  private newAck(ackIdx: number) {
    const acked = ackIdx - this.una;
    const last = this.tx.get(ackIdx - 1);
    // Karn's rule: if this ACK covers any retransmitted segment, it can't be timed.
    let clean = !!last && last.count === 1;
    for (let i = this.una; i < ackIdx && clean; i++) if ((this.tx.get(i)?.count ?? 1) > 1) clean = false;
    if (clean && last) this.rttSample(this.now - last.t);
    this.rtoStreak = 0;
    const inflightBefore = this.nxt - this.una;
    this.ackLog.push({ ms: this.now, segs: acked });
    for (let i = this.una; i < ackIdx; i++) {
      this.sacked.delete(i);
      this.lost.delete(i);
      this.rtxd.delete(i);
      if (i < ackIdx - 1) this.tx.delete(i);
    }
    this.una = ackIdx;
    this.dupacks = 0;
    if (this.inRecovery) {
      if (this.una >= this.recover) this.inRecovery = false;
      else {
        if (!this.sacked.has(this.una) && !this.rtxd.has(this.una)) this.lost.add(this.una); // partial ACK: next hole is lost too
        this.markSackLosses();
      }
    } else this.ccOnAck(acked, inflightBefore);
    if (this.una < this.nxt || this.lost.size) this.armRto();
    else this.cancelTimer('rto');
  }

  private dupAck() {
    this.dupacks++;
    this.stats.dupAcksIn++;
    if (this.inRecovery) {
      this.markSackLosses();
      return;
    }
    if (!this.cfg.fastRetransmit || this.una < this.rtoRecover) return;
    if (this.dupacks >= 3 || this.sackedAbove(this.una) >= 3) this.enterRecovery();
  }

  private sackedAbove(i: number) {
    let n = 0;
    for (const k of this.sacked) if (k > i) n++;
    return n;
  }

  private markSackLosses() {
    let above = 0;
    for (let i = this.nxt - 1; i >= this.una; i--) {
      if (this.sacked.has(i)) {
        above++;
        continue;
      }
      if (above >= 3 && !this.lost.has(i) && !this.rtxd.has(i)) this.lost.add(i);
    }
    // A retransmission is lost too if 3 segments sent after it were SACKed.
    for (const i of [...this.rtxd]) {
      if (i < this.una || this.sacked.has(i)) continue;
      const t = this.tx.get(i)?.t ?? Infinity;
      let later = 0;
      for (const k of this.sacked) if ((this.tx.get(k)?.t ?? -1) > t && ++later >= 3) break;
      if (later >= 3) {
        this.rtxd.delete(i);
        this.lost.add(i);
      }
    }
  }

  private enterRecovery() {
    const apply = () => {
      const before = this.cfg.cc === 'none' ? this.cfg.fixedWnd : this.cwnd;
      this.inRecovery = true;
      this.recover = this.nxt;
      this.rtxd.clear();
      this.ccOnLoss('fast');
      this.lost.add(this.una);
      this.markSackLosses();
      this.stats.fastRtx++;
      this.lossMarks.push({ ms: this.now, kind: 'fast', cwnd: before });
      this.forceRtx = true;
      this.hooks.onEvent?.({ type: 'fast', idx: this.una });
      this.sample(true);
      this.trySend();
    };
    if (this.hooks.onLoss?.('fast', apply)) return;
    apply();
  }

  private armRto() {
    this.armTimer('rto', 'rto', 'c', this.rto, () => this.onRto());
  }

  private onRto() {
    if (this.una >= this.nxt && !this.lost.size) return;
    const apply = () => {
      const before = this.cfg.cc === 'none' ? this.cfg.fixedWnd : this.cwnd;
      this.stats.timeouts++;
      this.ccOnLoss('rto');
      this.rtoStreak++;
      this.inRecovery = false;
      this.rtoRecover = this.nxt;
      // With a congestion window, cwnd = 1 paces the go-back; a fixed window would
      // blast everything again, so there only the oldest segment is presumed lost.
      if (this.cfg.cc === 'none') this.lost.add(this.una);
      else for (let i = this.una; i < this.nxt; i++) if (!this.sacked.has(i)) this.lost.add(i);
      this.rtxd.clear();
      this.dupacks = 0;
      this.rto = Math.min(this.rto * 2, 120000);
      this.lossMarks.push({ ms: this.now, kind: 'rto', cwnd: before });
      this.forceRtx = true;
      this.hooks.onEvent?.({ type: 'rto' });
      this.armRto();
      this.sample(true);
      this.trySend();
    };
    if (this.hooks.onLoss?.('rto', apply)) return;
    apply();
  }

  private maybePersist() {
    const more = this.nxt < this.cfg.total;
    if (!more || this.nxt < this.sndRight || this.una < this.nxt || this.lost.size || this.timers.has('persist')) return;
    if (!this.persistIv) this.persistIv = Math.max(this.rto, this.cfg.rtoMin);
    this.armTimer('persist', 'persist', 'c', this.persistIv, () => {
      const s = this.mkSeg('c', 'probe', { seq: this.segSeq(this.nxt) - 1, ack: this.cRcv, win: this.cliWin() });
      this.stats.probes++;
      this.hooks.onEvent?.({ type: 'probe' });
      this.transmit(s);
      this.persistIv = Math.min(this.persistIv * 2, 120000);
      this.maybePersist();
    });
  }

  private rttSample(r: number) {
    if (!this.srtt) {
      this.srtt = r;
      this.rttvar = r / 2;
    } else {
      this.rttvar = 0.75 * this.rttvar + 0.25 * Math.abs(this.srtt - r);
      this.srtt = 0.875 * this.srtt + 0.125 * r;
    }
    // RFC 6298 with Linux's 200 ms floor on the variance term.
    this.rto = Math.min(120000, this.srtt + Math.max(4 * this.rttvar, this.cfg.rtoMin));
    this.lastRtt = r;
    if (r < this.bbr.minRtt) this.bbr.minRtt = r;
  }

  /* ================================================================ */
  /* Congestion control                                                */
  /* ================================================================ */

  private ccOnAck(acked: number, inflightBefore: number) {
    const cc = this.cfg.cc;
    if (cc === 'none' || cc === 'bbr') return;
    // Only grow when the window was actually the limit (Linux: tcp_is_cwnd_limited).
    const slow = this.cwnd < this.ssthresh;
    const limited = slow ? inflightBefore * 2 > this.cwnd : inflightBefore >= Math.floor(this.cwnd) - 1;
    if (!limited) return;
    let a = acked;
    if (slow) {
      const inc = Math.min(a, this.ssthresh - this.cwnd);
      this.cwnd += inc;
      a -= inc;
      if (a <= 0) return;
    }
    if (cc === 'reno') this.cwnd += a / this.cwnd;
    else this.cubicGrow(a);
  }

  private ccOnLoss(kind: LossKind) {
    const cc = this.cfg.cc;
    if (cc === 'none') return;
    if (cc === 'bbr') {
      if (kind === 'rto') this.cwnd = Math.max(4, this.cwnd / 2);
      return;
    }
    if (kind === 'rto' && this.rtoStreak > 0) {
      // RFC 5681: a segment that already timed out once doesn't cut ssthresh again.
      this.cwnd = 1;
      return;
    }
    const beta = cc === 'cubic' ? 0.7 : 0.5;
    if (cc === 'cubic') {
      const c = this.cub;
      c.epoch = -1;
      if (this.cwnd < c.lastMax) {
        c.lastMax = this.cwnd;
        c.wMax = (this.cwnd * (1 + beta)) / 2; // fast convergence
      } else {
        c.lastMax = this.cwnd;
        c.wMax = this.cwnd;
      }
    }
    this.ssthresh = Math.max(2, Math.floor(this.cwnd * beta));
    this.cwnd = kind === 'rto' ? 1 : this.ssthresh;
  }

  private cubicGrow(acked: number) {
    const c = this.cub;
    const C = this.cfg.cubicC;
    if (c.epoch < 0) {
      c.epoch = this.now;
      if (this.cwnd < c.wMax) {
        c.k = Math.cbrt((c.wMax - this.cwnd) / C);
        c.origin = c.wMax;
      } else {
        c.k = 0;
        c.origin = this.cwnd;
      }
    }
    const t = (this.now - c.epoch + (this.srtt || this.baseRtt())) / 1000;
    const target = c.origin + C * Math.pow(t - c.k, 3);
    // At most +50% per round trip, and at most +1 segment for any single ACK.
    if (target > this.cwnd) this.cwnd += Math.min(1, (acked * Math.min(target - this.cwnd, this.cwnd * 0.5)) / this.cwnd);
    else this.cwnd += (acked * 0.01) / this.cwnd;
  }

  /** Simplified BBR v1: model bottleneck bandwidth and min RTT, pace at that rate. */
  private bbrUpdate(delivered: number, recIn: TxRec | null) {
    const b = this.bbr;
    let roundStart = false;
    const minRtt0 = Number.isFinite(b.minRtt) ? b.minRtt : this.srtt || this.baseRtt();
    // An original copy arriving just after its retransmission: the record describes the
    // retransmission, so it says nothing about rounds or rates.
    const rec = recIn && this.now - recIn.t >= 0.8 * minRtt0 ? recIn : null;
    if (rec && rec.delivered >= b.nextRound) {
      b.nextRound = this.delivered;
      b.round++;
      roundStart = true;
    }
    const minRtt = Number.isFinite(b.minRtt) ? b.minRtt : this.srtt || this.baseRtt();
    if (rec) {
      // Delivery rate over max(send interval, ack interval); shorter than min RTT is unreliable.
      const iv = Math.max(rec.t - rec.firstSent, this.deliveredTime - rec.deliveredTime);
      if (iv >= minRtt) b.samples.push({ round: b.round, bw: (this.delivered - rec.delivered) / iv });
    }
    b.samples = b.samples.filter((s) => s.round > b.round - 10);
    b.btlBw = b.samples.reduce((m, s) => Math.max(m, s.bw), 0);
    if (b.mode === 'startup' && roundStart && b.btlBw > 0) {
      if (b.btlBw >= b.fullBw * 1.25) {
        b.fullBw = b.btlBw;
        b.fullCnt = 0;
      } else if (++b.fullCnt >= 3) b.mode = 'drain';
    }
    const bdp = b.btlBw * minRtt;
    if (b.mode === 'drain' && this.nxt - this.una <= bdp) {
      b.mode = 'probe_bw';
      b.cycle = 2;
      b.cycleStamp = this.now;
    }
    if (b.mode === 'probe_bw' && this.now - b.cycleStamp > minRtt) {
      b.cycle = (b.cycle + 1) % BBR_GAINS.length;
      b.cycleStamp = this.now;
    }
    b.pacingGain = b.mode === 'startup' ? HIGH_GAIN : b.mode === 'drain' ? 1 / HIGH_GAIN : BBR_GAINS[b.cycle];
    b.cwndGain = b.mode === 'probe_bw' ? 2 : HIGH_GAIN;
    if (b.btlBw > 0) this.cwnd = Math.max(4, b.cwndGain * bdp);
    else this.cwnd += delivered;
  }

  bbrInfo() {
    const b = this.bbr;
    return { mode: b.mode, btlBw: b.btlBw, minRtt: b.minRtt, pacingGain: b.pacingGain };
  }

  /* ================================================================ */
  /* Bookkeeping                                                       */
  /* ================================================================ */

  private setState(side: Side, st: TcpState) {
    if (side === 'c') this.cState = st;
    else this.sState = st;
    const tone: Note['tone'] =
      st === 'ESTABLISHED' ? 'good' : st === 'SYN_SENT' || st === 'SYN_RECEIVED' ? 'warn' : st === 'CLOSED' || st === 'LISTEN' ? 'state' : 'ctl';
    this.note(side, st, tone);
    this.hooks.onEvent?.({ type: 'state', side, state: st });
  }

  note(side: Side, text: string, tone: Note['tone']) {
    this.notes.push({ id: this.noteN++, side, ms: this.now, text, tone });
  }

  /** Record cwnd / queue for the chart (throttled unless forced). */
  sample(force: boolean) {
    const h = this.cwndHist;
    const last = h[h.length - 1];
    const q = this.cfg.path === 'bottleneck' ? this.routerQueue().length : 0;
    const cw = this.cfg.cc === 'none' ? this.cfg.fixedWnd : this.cwnd;
    if (force || !last || this.now - last.ms >= 20 || Math.abs(last.cwnd - cw) >= 0.25 || last.q !== q) {
      h.push({ ms: this.now, cwnd: cw, ssthresh: this.ssthresh, q });
    }
    if (h.length > 4000) h.splice(0, h.length - 3000);
  }

  /** Goodput over the last `span` ms, in bytes per second. */
  goodput(span = 1000) {
    const from = this.now - span;
    while (this.ackLog.length && this.ackLog[0].ms < from - 5000) this.ackLog.shift();
    let segs = 0;
    for (const a of this.ackLog) if (a.ms >= from) segs += a.segs;
    const dur = Math.min(span, Math.max(1, this.now));
    return (segs * this.cfg.mss * 1000) / dur;
  }

  /** Share of data segments sent in the last `span` ms that were lost (0..1), or null */
  recentLoss(span = 3000): number | null {
    let sent = 0;
    let lost = 0;
    const from = this.now - span;
    for (const s of this.segs) {
      if (s.kind !== 'data' || s.sent < from) continue;
      sent++;
      if (s.status === 'lost') lost++;
    }
    return sent ? lost / sent : null;
  }

  /** Link capacity for the bottleneck path, bytes per second */
  capacity() {
    return (this.cfg.mss * 1000) / this.cfg.svc;
  }

  /** Drop drawing history that scrolled far out of view. */
  prune(keepDisp: number) {
    const cut = this.disp - keepDisp;
    if (cut <= 0) return;
    const ms = this.dispToMsApprox(cut);
    this.segs = this.segs.filter((s) => s.status === 'flight' || Math.max(s.arrive, s.lossT ?? 0) >= ms);
    this.notes = this.notes.filter((n) => n.ms >= ms);
    this.timerLog = this.timerLog.filter((l) => l.end == null || l.end >= ms);
    this.warps = this.warps.filter((w) => w.ms1 >= ms);
  }

  private dispToMsApprox(d: number) {
    const ks = this.knots;
    let k = ks[0];
    for (let i = ks.length - 1; i >= 0; i--) {
      if (ks[i].disp <= d) {
        k = ks[i];
        break;
      }
    }
    return k.ms + (d - k.disp) * k.rate;
  }

  /* ---------- knobs the playground turns ---------- */

  setLoss(p: number) {
    this.cfg = { ...this.cfg, loss: p };
  }

  setOwd(ms: number) {
    this.cfg = { ...this.cfg, owd: ms };
  }

  setCc(cc: CcAlgo) {
    if (cc === this.cfg.cc) return;
    this.cfg = { ...this.cfg, cc };
    this.cub = { wMax: 0, lastMax: 0, k: 0, epoch: -1, origin: 0 };
    this.bbr.mode = 'startup';
    this.bbr.fullBw = 0;
    this.bbr.fullCnt = 0;
    this.bbr.samples = [];
    this.bbr.btlBw = 0;
    if (cc !== 'bbr') this.ssthresh = Math.max(2, Math.floor(this.cwnd));
    if (cc === 'bbr') this.ssthresh = Infinity;
    this.sample(true);
  }
}
