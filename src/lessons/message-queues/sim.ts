import { SIG } from '@/lib/sim/colors';
import { clamp, damp, type Curve } from '@/lib/sim/geometry';
import { PredictGame } from '@/lib/sim/predict';
import { mulberry32 } from '@/lib/sim/rng';
import { Sim, type Box, type ScriptEvent, type WireSpec } from '@/lib/sim/Sim';
import {
  AMOUNTS,
  CALL_TIMEOUT_MS,
  DEFAULTS,
  EFFECT_AT,
  FRAUD,
  HOP,
  SERVICES,
  USERS,
  freshMetrics,
  toyHash,
  userOf,
  vis,
  withAlpha,
  type Consumer,
  type Group,
  type HashInfo,
  type LedgerRow,
  type MQConfig,
  type Metrics,
  type Mode,
  type Msg,
  type Part,
  type Phase,
  type PhaseKey,
  type PlanRow,
  type Queue,
  type ReadoutKind,
  type Rec,
  type SignupReq,
  type SvcCall,
  type SvcId,
  type Tour,
  type TourStage,
  type Worker,
} from './model';

/* ------------------------------------------------------------------ */
/* Geometry helpers                                                    */
/* ------------------------------------------------------------------ */

type Axis = 'x' | 'y';

function pt(x: number, y: number, w = 2, h = 2): Box {
  return { id: 'pt', x, y, tx: x, ty: y, w, h, alpha: 1, talpha: 1, removing: false };
}

/** A cubic between two boxes along a forced axis (the kit's portCurve picks the axis itself). */
function axisCurve(a: Box, b: Box, axis: Axis, lane: number): Curve {
  if (axis === 'x') {
    const s = Math.sign(b.x - a.x) || 1;
    const x0 = a.x + (s * a.w) / 2;
    const x3 = b.x - (s * b.w) / 2;
    const k = Math.max(18, Math.abs(x3 - x0) * 0.5);
    const off = lane * s;
    return {
      p0: { x: x0, y: a.y + off },
      p1: { x: x0 + s * k, y: a.y + off },
      p2: { x: x3 - s * k, y: b.y + off },
      p3: { x: x3, y: b.y + off },
    };
  }
  const s = Math.sign(b.y - a.y) || 1;
  const y0 = a.y + (s * a.h) / 2;
  const y3 = b.y - (s * b.h) / 2;
  const k = Math.max(18, Math.abs(y3 - y0) * 0.5);
  const off = -lane * s;
  return {
    p0: { x: a.x + off, y: y0 },
    p1: { x: a.x + off, y: y0 + s * k },
    p2: { x: b.x + off, y: y3 - s * k },
    p3: { x: b.x + off, y: y3 },
  };
}

export interface QueueGeo {
  left: number;
  right: number;
  top: number;
  bottom: number;
  /** Inner rail bounds */
  x0: number;
  x1: number;
  railTop: number;
  railH: number;
  railY: number;
  shelfTop: number;
  shelfH: number;
  shelfY: number;
  cw: number;
  ch: number;
  pitch: number;
  cap: number;
}

export interface PartGeo {
  left: number;
  right: number;
  top: number;
  bottom: number;
  x0: number;
  x1: number;
  cw: number;
  ch: number;
  pitch: number;
  cap: number;
  rowY: number;
  lw: number;
}

/** Room a portrait readout strip needs at the bottom of the stage. */
const STRIP: Record<ReadoutKind, number> = { none: 0, waterfall: 96, ledger: 92, plans: 78, hash: 60, offsets: 64, tour: 104 };

const WORKER_IDS = ['w1', 'w2', 'w3', 'w4', 'w5', 'w6'];

function newQueue(id: string, name: string, dead: boolean, shelf: boolean): Queue {
  return { id, name, visible: [], inflight: [], dead, shelf, flash: -10 };
}

function newWorker(id: string, name: string, queue: string, sub: string | null): Worker {
  return {
    id,
    name,
    queue,
    sub,
    state: 'idle',
    msg: null,
    p: 0,
    dur: 1,
    effect: false,
    crashAt: null,
    downUntil: null,
    errorUntil: 0,
    status: 'idle · polling',
    tone: 'normal',
    retiring: false,
    served: 0,
    flash: null,
    note: null,
    acked: false,
  };
}

/* ------------------------------------------------------------------ */
/* The simulation                                                      */
/* ------------------------------------------------------------------ */

/**
 * One world for the whole lesson: users and a signup API, the services it
 * calls, a queue with its in-flight shelf and dead-letter queue, competing
 * workers, a fan-out exchange with subscriber queues, and a partitioned log
 * with consumer groups. Each step picks a mode and a config.
 */
export class MQSim extends Sim {
  cfg: MQConfig = { ...DEFAULTS };
  game: PredictGame | null = null;

  queues = new Map<string, Queue>();
  workers = new Map<string, Worker>();
  reqs: SignupReq[] = [];
  /** The signup the waterfall readout follows */
  focus: SignupReq | null = null;
  calls = new Map<SvcId, SvcCall[]>();
  parts: Part[] = [];
  groups = new Map<string, Group>();
  consumers = new Map<string, Consumer>();
  ledger: LedgerRow[] = [];
  plans = new Map<string, PlanRow>();
  tour: Tour | null = null;
  hash: HashInfo | null = null;
  m: Metrics = freshMetrics();
  userFlash = new Map<string, { ok: boolean; vt: number }>();
  exFlash = -10;
  apiFlash = -10;

  private seq = 0;
  private reqSeq = 0;
  private nextIn = 0.5;
  private userIdx = 0;
  private sampleIn = 0;
  private scaleIn = 1;
  private quietFor = 0;
  private keySeq = new Map<string, number>();
  private keyIdx = 0;
  private planIdx = 0;
  private probe: { msg: Msg; done: boolean; doneAt: number } | null = null;
  private pendingArm: number | null = null;

  constructor() {
    super();
    this.syncBoxes();
  }

  /* ================================================================ */
  /* Steps                                                             */
  /* ================================================================ */

  enter(cfg: MQConfig, script: ScriptEvent<MQSim>[] = [], opts: { reset?: boolean; predict?: number; seed?: number } = {}) {
    const fresh = opts.reset || cfg.mode !== this.cfg.mode;
    this.cfg = { ...cfg, subs: [...cfg.subs], groups: [...cfg.groups] };
    if (fresh) this.resetWorld(opts.seed ?? 7);
    this.frozen = false;
    this.game = opts.predict ? new PredictGame(this, opts.predict) : null;
    this.syncBoxes();
    if (fresh) this.seedWorld();
    this.runScript(script);
    this.rev++;
  }

  private resetWorld(seed: number) {
    this.clearTransient();
    this.rng = mulberry32(seed);
    for (const q of this.queues.values()) {
      q.visible = [];
      q.inflight = [];
      q.flash = -10;
    }
    for (const w of this.workers.values()) {
      this.makeIdle(w);
      w.served = 0;
      w.flash = null;
      w.downUntil = null;
    }
    this.reqs = [];
    this.focus = null;
    this.calls.clear();
    this.parts = [];
    this.groups.clear();
    this.consumers.clear();
    this.ledger = [];
    this.plans.clear();
    this.tour = null;
    this.hash = null;
    this.m = freshMetrics();
    this.userFlash.clear();
    this.seq = 0;
    this.reqSeq = 0;
    this.nextIn = 0.5;
    this.userIdx = 0;
    this.sampleIn = 0;
    this.scaleIn = 1;
    this.quietFor = 0;
    this.keySeq.clear();
    this.keyIdx = 0;
    this.planIdx = 0;
    this.probe = null;
    this.pendingArm = null;
  }

  private seedWorld() {
    const c = this.cfg;
    this.relayout();
    const q = this.queues.get('q');
    if (c.mode === 'queue' && q && c.backlog > 0) {
      for (let i = 0; i < c.backlog; i++) {
        const msg = this.makeMsg();
        msg.sentAt = this.t - (c.backlog - i) * 0.5;
        this.store(q, msg);
      }
    }
    if (c.tour) this.tour = { stage: 'wait', msg: null, since: this.t, allow: false, flight: null, x: 0, y: 0 };
    if (c.mode === 'log') this.syncLog();
  }

  /* ================================================================ */
  /* Controls (components call these; they never assign fields)        */
  /* ================================================================ */

  update(patch: Partial<MQConfig>) {
    this.cfg = { ...this.cfg, ...patch };
    this.syncBoxes();
    this.rev++;
  }

  setRate(rate: number) {
    this.update({ rate });
    if (rate > 0) this.nextIn = Math.min(this.nextIn, 1 / rate);
  }

  setWorkers(n: number) {
    this.update({ workers: clamp(Math.round(n), 1, 6) });
  }

  setEmail(state: MQConfig['email']) {
    this.update({ email: state });
  }

  /** Switch between calling the services directly and going through the queue. */
  setMode(mode: Mode) {
    if (mode === this.cfg.mode) return;
    this.clearTransient();
    this.reqs = [];
    this.focus = null;
    this.calls.clear();
    for (const q of this.queues.values()) {
      q.visible = [];
      q.inflight = [];
    }
    for (const w of this.workers.values()) this.makeIdle(w);
    this.cfg = { ...this.cfg, mode };
    this.nextIn = 0.4;
    this.syncBoxes();
    this.rev++;
  }

  /** A burst of arrivals, e.g. a marketing email goes out. */
  spike(n = 24, over = 2) {
    for (let i = 0; i < n; i++) this.after((i / n) * over, () => this.arrival());
    this.rev++;
  }

  sendPoison() {
    const msg = this.makeMsg({ poison: true });
    this.sendToQueue('q', msg, 'api');
  }

  deployFix() {
    this.update({ fixed: true });
    const g = this.queueGeo('q');
    if (g) this.fx({ kind: 'text', at: { x: (g.left + g.right) / 2, y: g.top - 6 }, text: 'fix deployed: workers now parse “twenty”', color: SIG.res, dur: 2.4 });
    for (const w of this.workers.values()) if (w.state !== 'down') this.fx({ kind: 'ring', at: { id: w.id }, color: SIG.res, size: 1.6, dur: 0.9 });
  }

  /** Move everything in the dead-letter queue back to the main queue. */
  redrive() {
    const d = this.queues.get('dlq');
    if (!d || !d.visible.length) return;
    const msgs = [...d.visible];
    d.visible = [];
    msgs.forEach((msg, i) => {
      const from = `pt:${msg.x.toFixed(1)},${msg.y.toFixed(1)}`;
      msg.receives = 0;
      this.after(i * 0.25, () =>
        this.send({
          from,
          to: 'q#in',
          dur: HOP.dlq,
          color: msg.color,
          tag: 'msg',
          label: msg.label,
          onArrive: () => {
            const q = this.queues.get('q');
            if (q) this.store(q, msg);
          },
        }),
      );
    });
    this.rev++;
  }

  toggleWorker(id: string) {
    const w = this.workers.get(id);
    if (!w || this.game?.pending) return;
    if (w.state === 'down') this.revive(w);
    else this.crash(w);
  }

  /** Crash the next worker when its current job reaches `at` (0..1). */
  armCrash(at: number) {
    const busy = [...this.workers.values()].find((w) => w.state === 'working' && w.p < at - 0.12 && !w.msg?.poison);
    if (busy) busy.crashAt = at;
    else this.pendingArm = at;
    this.rev++;
  }

  setIdempotent(on: boolean) {
    this.update({ idempotent: on });
  }

  setAckBefore(on: boolean) {
    this.update({ ackBefore: on });
  }

  setSlowSub(id: string | null) {
    this.update({ slowSub: id });
  }

  addSubscriber() {
    if (this.cfg.subs.some((s) => s.id === FRAUD.id)) return;
    this.update({ subs: [...this.cfg.subs, FRAUD] });
  }

  crashConsumer(id: string) {
    const c = this.consumers.get(id);
    const g = c && this.groups.get(c.group);
    if (!c || !g || c.state === 'down') return;
    const lost = c.cur;
    c.state = 'down';
    c.cur = null;
    c.p = 0;
    c.status = lost ? `✕ crashed mid-${lost.rec.label}` : '✕ crashed';
    this.fx({ kind: 'x', at: { id }, color: SIG.err, size: 1.6, dur: 1.2 });
    this.rebalance(g);
  }

  reviveConsumer(id: string) {
    const c = this.consumers.get(id);
    const g = c && this.groups.get(c.group);
    if (!c || !g || c.state !== 'down') return;
    c.state = 'idle';
    c.status = 'joining…';
    this.fx({ kind: 'ring', at: { id }, color: SIG.res, size: 1.6, dur: 0.9 });
    this.rebalance(g);
  }

  toggleConsumer(id: string) {
    const c = this.consumers.get(id);
    if (!c) return;
    if (c.state === 'down') this.reviveConsumer(id);
    else this.crashConsumer(id);
  }

  addConsumer(group: string) {
    const groups = this.cfg.groups.map((g) => (g.id === group ? { ...g, members: Math.min(4, g.members + 1) } : g));
    this.update({ groups });
  }

  startGroup(id: string, color: string) {
    if (this.cfg.groups.some((g) => g.id === id)) return;
    this.update({ groups: [...this.cfg.groups, { id, members: 1, color }] });
  }

  /** Stage clicks on a partition answer the "which partition?" question. */
  pickPartition(p: number) {
    if (this.game?.pending) this.game.answer(`p${p}`);
  }

  /* ================================================================ */
  /* Read-outs for the stage and the panel                             */
  /* ================================================================ */

  depth(qid = 'q') {
    return this.queues.get(qid)?.visible.length ?? 0;
  }

  inflightCount(qid = 'q') {
    return this.queues.get(qid)?.inflight.length ?? 0;
  }

  /** Age of the oldest message that hasn't been deleted (SQS ApproximateAgeOfOldestMessage). */
  oldestAge(qid = 'q') {
    const q = this.queues.get(qid);
    if (!q) return 0;
    let min = Infinity;
    for (const m of q.visible) min = Math.min(min, m.sentAt);
    for (const m of q.inflight) min = Math.min(min, m.sentAt);
    return Number.isFinite(min) ? Math.max(0, this.t - min) : 0;
  }

  private rateOf(times: number[]) {
    const win = clamp(this.stepT, 2, 10);
    const cut = this.t - win;
    let n = 0;
    for (let i = times.length - 1; i >= 0 && times[i] >= cut; i--) n++;
    return n / win;
  }

  rateIn() {
    return this.rateOf(this.m.arr);
  }

  rateOut() {
    return this.rateOf(this.m.done);
  }

  liveWorkers() {
    return [...this.workers.values()].filter((w) => !w.retiring && w.state !== 'down').length;
  }

  lag(gid: string) {
    const g = this.groups.get(gid);
    if (!g) return 0;
    return this.parts.reduce((s, p, i) => s + Math.max(0, p.log.length - (g.committed[i] ?? 0)), 0);
  }

  partsOf(g: Group, cid: string) {
    const out: number[] = [];
    g.assign.forEach((a, p) => {
      if (a === cid) out.push(p);
    });
    return out;
  }

  /** What a user is experiencing right now, for their card on the stage. */
  userStatus(id: string): string {
    for (let i = this.reqs.length - 1; i >= 0; i--) {
      const r = this.reqs[i];
      if (r.user.id !== id) continue;
      if (r.outcome === 'ok') return `✓ ${Math.round(r.total ?? 0).toLocaleString('en-US')} ms`;
      if (r.outcome === 'fail') return `✕ ${r.status} error`;
      if (!r.phases.length) return 'sending…';
      const ms = r.phases.reduce((s, p) => s + (p.state === 'run' ? clamp((this.t - p.t0) / Math.max(0.05, p.dur), 0, 1) * p.ms : p.ms), 0);
      return `waits ${Math.round(ms).toLocaleString('en-US')} ms`;
    }
    return 'idle';
  }

  /** The request/response times of the most recent signups. */
  lastSignup() {
    const r = this.m.resp;
    return r.length ? r[r.length - 1] : null;
  }

  /* ================================================================ */
  /* Boxes                                                             */
  /* ================================================================ */

  private wanted(): Set<string> {
    const c = this.cfg;
    const s = new Set<string>(['api']);
    if (c.mode === 'sync' || (c.mode === 'queue' && c.users)) for (const u of USERS.slice(0, 3)) s.add(`u:${u.id}`);
    if (c.mode === 'sync') for (const v of SERVICES) s.add(`svc:${v.id}`);
    if (c.mode === 'queue') {
      s.add('q');
      if (c.dlq) s.add('dlq');
    }
    if (c.mode === 'fanout') {
      s.add('ex');
      for (const sub of c.subs) {
        s.add(`q:${sub.id}`);
        s.add(`w:${sub.id}`);
      }
    }
    if (c.mode === 'log') {
      for (let i = 0; i < c.partitions; i++) s.add(`p${i}`);
      for (const g of c.groups) for (let k = 1; k <= g.members; k++) s.add(`c:${g.id}-${k}`);
    }
    return s;
  }

  private syncBoxes() {
    const c = this.cfg;
    const want = this.wanted();
    for (const id of want) this.box(id);
    for (const [id, b] of this.boxes) {
      if (want.has(id) || b.removing) continue;
      if (c.mode === 'queue' && WORKER_IDS.includes(id)) continue;
      this.hide(id);
    }

    // Queues
    const qname = (id: string) => {
      if (id === 'q') return c.queue;
      if (id === 'dlq') return `${c.queue}-dlq`;
      return c.subs.find((s) => `q:${s.id}` === id)?.name ?? id;
    };
    for (const id of want) {
      if (id !== 'q' && id !== 'dlq' && !id.startsWith('q:')) continue;
      const q = this.queues.get(id) ?? newQueue(id, qname(id), id === 'dlq', false);
      q.name = qname(id);
      q.shelf = id === 'q' && c.shelf;
      this.queues.set(id, q);
    }

    // Workers
    if (c.mode === 'queue') this.syncWorkers();
    if (c.mode === 'fanout') {
      for (const sub of c.subs) {
        const id = `w:${sub.id}`;
        if (!this.workers.has(id)) this.workers.set(id, newWorker(id, sub.worker, `q:${sub.id}`, sub.id));
      }
    }
    if (c.mode === 'log') this.syncLog();
  }

  private syncWorkers() {
    const n = clamp(Math.round(this.cfg.workers), 0, 6);
    WORKER_IDS.forEach((id, i) => {
      let w = this.workers.get(id);
      if (i < n) {
        if (!w) {
          w = newWorker(id, `worker-${i + 1}`, 'q', null);
          this.workers.set(id, w);
        }
        w.retiring = false;
        this.box(id);
      } else if (w && !w.retiring) {
        w.retiring = true;
        if (w.state !== 'working' && w.state !== 'fetching') this.hide(id);
      }
    });
  }

  private syncLog() {
    const P = this.cfg.partitions;
    while (this.parts.length < P) this.parts.push({ idx: this.parts.length, log: [] });
    if (this.parts.length > P) this.parts.length = P;
    for (const gs of this.cfg.groups) {
      let g = this.groups.get(gs.id);
      if (!g) {
        g = {
          id: gs.id,
          color: gs.color,
          committed: Array(P).fill(0),
          position: Array(P).fill(0),
          members: [],
          assign: Array(P).fill(null),
          rebalanceUntil: this.t + 0.4,
          needsAssign: true,
        };
        this.groups.set(gs.id, g);
      }
      for (let k = 1; k <= gs.members; k++) {
        const id = `c:${gs.id}-${k}`;
        if (this.consumers.has(id)) continue;
        this.consumers.set(id, { id, name: `${gs.id}-${k}`, group: gs.id, state: 'idle', cur: null, p: 0, dur: 1, rr: 0, status: 'joining…' });
        g.members.push(id);
        if (g.members.length > 1 || this.parts.some((p) => p.log.length)) this.rebalance(g);
      }
    }
  }

  /* ================================================================ */
  /* Layout                                                            */
  /* ================================================================ */

  chipDims() {
    return this.orient === 'portrait' ? { cw: 24, ch: 20, pitch: 28 } : { cw: 30, ch: 22, pitch: 35 };
  }

  queueH(shelf: boolean) {
    const { ch } = this.chipDims();
    return 20 + (shelf ? ch + 12 + 6 : 0) + ch + 14;
  }

  private frame() {
    const P = this.orient === 'portrait';
    const W = this.w;
    const H = this.h;
    const pad = P ? 12 : this.compact ? 18 : 24;
    const top = P ? 74 : 84;
    const bottom = P ? H - 64 - STRIP[this.cfg.readout] : H - 84;
    return { P, W, H, pad, top, bottom, bottomR: P ? bottom : H - 108, midY: (top + bottom) / 2 - 4 };
  }

  protected layout() {
    const m = this.cfg.mode;
    if (m === 'sync') this.layoutSync();
    else if (m === 'queue') this.layoutQueue();
    else if (m === 'fanout') this.layoutFanout();
    else this.layoutLog();
  }

  private placeUsers(f: ReturnType<MQSim['frame']>, x: number, y: number, w: number, h: number) {
    USERS.slice(0, 3).forEach((u, i) => {
      if (!this.boxes.has(`u:${u.id}`)) return;
      if (f.P) this.place(`u:${u.id}`, f.W / 2 + (i - 1) * (w + 8), y, w, h);
      else this.place(`u:${u.id}`, x, y + (i - 1) * (h + 34), w, h);
    });
  }

  /** Top of a block of height `h`, centered (a little high) in the free space. */
  private vtop(f: ReturnType<MQSim['frame']>, h: number) {
    return f.top + 6 + Math.max(0, f.bottom - f.top - 6 - h) * 0.42;
  }

  private stack(ids: string[], x: number, cy: number, w: number, h: number, gap: number, lo: number, hi: number) {
    const n = ids.length;
    const total = n * h + Math.max(0, n - 1) * gap;
    const y0 = clamp(cy - total / 2, lo, Math.max(lo, hi - total));
    ids.forEach((id, i) => this.place(id, x, y0 + h / 2 + i * (h + gap), w, h));
  }

  private layoutSync() {
    const f = this.frame();
    if (!f.P) {
      const uw = this.compact ? 128 : 144;
      this.placeUsers(f, f.pad + uw / 2, f.midY, uw, 40);
      const aw = this.compact ? 150 : 164;
      const sw = this.compact ? 160 : 180;
      const sx = f.W - f.pad - sw / 2;
      const ax = clamp(f.W * 0.43, f.pad + uw + 60 + aw / 2, sx - sw / 2 - 120 - aw / 2);
      this.place('api', ax, f.midY - 30, aw, 58);
      this.stack(SERVICES.map((s) => `svc:${s.id}`), sx, f.midY - 30, sw, 58, 30, f.top, f.bottomR);
    } else {
      const uw = (f.W - 2 * f.pad - 16) / 3;
      const colH = 3 * 50 + 2 * 14;
      const y0 = this.vtop(f, 36 + 44 + colH);
      this.placeUsers(f, 0, y0 + 18, uw, 36);
      const sw = 108;
      const sx = f.W - f.pad - sw / 2;
      const cy = y0 + 36 + 44 + colH / 2;
      this.place('api', f.pad + 70, cy, 140, 50);
      this.stack(SERVICES.map((s) => `svc:${s.id}`), sx, cy, sw, 50, 14, y0 + 36 + 30, f.bottom);
    }
  }

  private layoutQueue() {
    const f = this.frame();
    const c = this.cfg;
    const qH = this.queueH(c.shelf);
    const railH = this.chipDims().ch + 14;
    const dH = this.queueH(false);
    const workerIds = WORKER_IDS.filter((id) => this.isLive(id));
    const below = c.readout === 'ledger' || c.readout === 'plans';
    if (!f.P) {
      const uw = 134;
      const aw = c.users ? 138 : 156;
      const ax = c.users ? f.pad + uw + 50 + aw / 2 : f.pad + aw / 2 + 4;
      const ww = this.compact ? 150 : 170;
      const wx = f.W - f.pad - ww / 2;
      const qx0 = ax + aw / 2 + (this.compact ? 44 : 58);
      const qx1 = wx - ww / 2 - (this.compact ? 52 : 70);
      const railY = f.midY - (c.dlq ? 56 : below ? 74 : 0);
      if (c.users) this.placeUsers(f, f.pad + uw / 2, railY, uw, 38);
      this.place('api', ax, railY, aw, 54);
      const qy = railY - qH / 2 + railH / 2;
      this.place('q', (qx0 + qx1) / 2, qy, qx1 - qx0, qH);
      if (this.boxes.has('dlq')) {
        const dw = Math.min(300, (qx1 - qx0) * 0.64);
        this.place('dlq', qx1 - dw / 2, qy + qH / 2 + 64 + dH / 2, dw, dH);
      }
      const gap = workerIds.length > 4 ? 10 : 16;
      this.stack(workerIds, wx, railY, ww, 56, gap, f.top, f.bottomR);
    } else {
      const uw = (f.W - 2 * f.pad - 16) / 3;
      const uH = c.users ? 36 + 30 : 0;
      const dlq = this.isLive('dlq');
      const y0 = this.vtop(f, uH + 46 + 40 + qH + (dlq ? 44 + dH : 0));
      if (c.users) this.placeUsers(f, 0, y0 + 18, uw, 36);
      const ww = 104;
      const wx = f.W - f.pad - ww / 2;
      const aw = 150;
      const ay = y0 + uH + 23;
      this.place('api', f.pad + aw / 2, ay, aw, 46);
      const qx0 = f.pad;
      const qx1 = wx - ww / 2 - 14;
      const qTop = ay + 23 + 40;
      this.place('q', (qx0 + qx1) / 2, qTop + qH / 2, qx1 - qx0, qH);
      const railY = qTop + qH - railH / 2;
      if (this.boxes.has('dlq')) {
        const dw = Math.min(214, qx1 - qx0);
        this.place('dlq', qx0 + dw / 2, qTop + qH + 44 + dH / 2, dw, dH);
      }
      const gap = workerIds.length > 4 ? 8 : 10;
      this.stack(workerIds, wx, railY, ww, 48, gap, c.users ? y0 + 36 + 14 : f.top, f.bottom);
    }
  }

  private layoutFanout() {
    const f = this.frame();
    const subs = this.cfg.subs.filter((s) => this.isLive(`q:${s.id}`));
    const n = Math.max(1, subs.length);
    const qH = this.queueH(false);
    const railH = this.chipDims().ch + 14;
    if (!f.P) {
      const aw = 156;
      const ax = f.pad + aw / 2 + 4;
      const ew = 104;
      const exX = ax + aw / 2 + 56 + ew / 2;
      const ww = this.compact ? 146 : 164;
      const wx = f.W - f.pad - ww / 2;
      const qx0 = exX + ew / 2 + 52;
      const qx1 = wx - ww / 2 - 60;
      const pitch = Math.min(112, (f.bottomR - f.top - 30) / n);
      const cy = f.midY - 10;
      const rowY = (i: number) => cy + (i - (n - 1) / 2) * pitch;
      this.place('api', ax, cy, aw, 54);
      const exTop = rowY(0) - 64;
      const exBottom = rowY(n - 1) + 30;
      this.place('ex', exX, (exTop + exBottom) / 2, ew, exBottom - exTop);
      subs.forEach((s, i) => {
        this.place(`q:${s.id}`, (qx0 + qx1) / 2, rowY(i) - qH / 2 + railH / 2, qx1 - qx0, qH);
        this.place(`w:${s.id}`, wx, rowY(i), ww, 54);
      });
    } else {
      const aw = 150;
      const pitch = Math.min(84, (f.bottom - f.top - 46 - 56) / n);
      const top = this.vtop(f, 46 + 56 + n * pitch);
      const ay = top + 23;
      this.place('api', f.pad + aw / 2, ay, aw, 46);
      const ew = 40;
      const ww = 100;
      const wx = f.W - f.pad - ww / 2;
      const qx0 = f.pad + ew + 14;
      const qx1 = wx - ww / 2 - 12;
      const y0 = ay + 23 + 56;
      const rowY = (i: number) => y0 + pitch / 2 + i * pitch;
      const exTop = rowY(0) - 40;
      const exBottom = rowY(n - 1) + 26;
      this.place('ex', f.pad + ew / 2, (exTop + exBottom) / 2, ew, exBottom - exTop);
      subs.forEach((s, i) => {
        this.place(`q:${s.id}`, (qx0 + qx1) / 2, rowY(i) - qH / 2 + railH / 2, qx1 - qx0, qH);
        this.place(`w:${s.id}`, wx, rowY(i), ww, 46);
      });
    }
  }

  private layoutLog() {
    const f = this.frame();
    const P = Math.max(1, this.cfg.partitions);
    const cons = [...this.consumers.keys()].filter((id) => this.isLive(id));
    const rowH = this.chipDims().ch + 34;
    if (!f.P) {
      const aw = 156;
      const ax = f.pad + aw / 2 + 4;
      const cw = this.compact ? 146 : 160;
      const cx = f.W - f.pad - cw / 2;
      const px0 = ax + aw / 2 + 64;
      const px1 = cx - cw / 2 - 64;
      const pitch = Math.min(96, (f.bottomR - f.top) / (P + 2));
      const cy = f.midY - 40;
      const rowY = (i: number) => cy + (i - (P - 1) / 2) * pitch;
      this.place('api', ax, cy, aw, 54);
      for (let i = 0; i < P; i++) this.place(`p${i}`, (px0 + px1) / 2, rowY(i) + 8, px1 - px0, rowH);
      cons.forEach((id, j) => {
        const y = j < P ? rowY(j) : rowY(P - 1) + (j - P + 1) * 70;
        this.place(id, cx, y, cw, 54);
      });
    } else {
      const aw = 150;
      const rows = Math.max(P, cons.length);
      const pitch = Math.min(70, (f.bottom - f.top - 46 - 62) / (rows + 0.2));
      const top = this.vtop(f, 46 + 62 + rows * pitch);
      const ay = top + 23;
      this.place('api', f.pad + aw / 2, ay, aw, 46);
      const cw = 96;
      const cx = f.W - f.pad - cw / 2;
      const px0 = f.pad;
      const px1 = cx - cw / 2 - 12;
      const y0 = ay + 23 + 62;
      const rowY = (i: number) => y0 + i * pitch;
      for (let i = 0; i < P; i++) this.place(`p${i}`, (px0 + px1) / 2, rowY(i) + 8, px1 - px0, rowH);
      cons.forEach((id, j) => {
        const y = j < P ? rowY(j) : rowY(P - 1) + (j - P + 1) * Math.min(56, pitch);
        this.place(id, cx, y, cw, 46);
      });
    }
  }

  /** Where everything inside a queue goes, derived from its (easing) box. */
  queueGeo(id: string): QueueGeo | null {
    const b = this.boxes.get(id);
    if (!b || Number.isNaN(b.x)) return null;
    const { cw, ch, pitch } = this.chipDims();
    const left = b.x - b.w / 2;
    const right = b.x + b.w / 2;
    const top = b.y - b.h / 2;
    const bottom = b.y + b.h / 2;
    const railH = ch + 14;
    const railTop = bottom - railH;
    const shelfTop = top + 20;
    const shelfH = ch + 12;
    const x0 = left + 6;
    const x1 = right - 6;
    const cap = Math.max(1, Math.floor((x1 - x0 - 10 + (pitch - cw)) / pitch));
    return { left, right, top, bottom, x0, x1, railTop, railH, railY: railTop + railH / 2, shelfTop, shelfH, shelfY: shelfTop + shelfH / 2, cw, ch, pitch, cap };
  }

  slotX(g: QueueGeo, i: number) {
    return g.x1 - 5 - g.cw / 2 - i * g.pitch;
  }

  /** Height just above a partition row, where records travel to and from their cells. */
  liftY(p: number) {
    const g = this.partGeo(p);
    return g ? g.top - g.ch / 2 - 6 : 0;
  }

  partGeo(p: number): PartGeo | null {
    const b = this.boxes.get(`p${p}`);
    if (!b || Number.isNaN(b.x)) return null;
    const { cw, ch, pitch } = this.chipDims();
    const lw = this.orient === 'portrait' ? 22 : 30;
    const left = b.x - b.w / 2;
    const right = b.x + b.w / 2;
    const top = b.y - b.h / 2;
    const bottom = b.y + b.h / 2;
    const x0 = left + lw + 8;
    const x1 = right - 6;
    const cap = Math.max(2, Math.floor((x1 - x0 + (pitch - cw)) / pitch));
    return { left, right, top, bottom, x0, x1, cw, ch, pitch, cap, rowY: top + 5 + ch / 2, lw };
  }

  /** Oldest offset still drawn in a partition row (the row scrolls as the log grows). */
  partBase(p: number) {
    const g = this.partGeo(p);
    const len = this.parts[p]?.log.length ?? 0;
    return g ? Math.max(0, len + 1 - g.cap) : 0;
  }

  cellPos(p: number, offset: number) {
    const g = this.partGeo(p);
    if (!g) return null;
    const i = offset - this.partBase(p);
    return { x: g.x0 + g.cw / 2 + Math.max(-0.6, i) * g.pitch, y: g.rowY, visible: i >= 0 };
  }

  markPos(gid: string, p: number) {
    const g = this.groups.get(gid);
    const geo = this.partGeo(p);
    if (!g || !geo) return null;
    const gi = [...this.groups.keys()].indexOf(gid);
    const base = this.partBase(p);
    const i = Math.max(-0.35, (g.committed[p] ?? 0) - base);
    return { x: geo.x0 + geo.cw / 2 + i * geo.pitch, y: geo.rowY + geo.ch / 2 + 7 + gi * 9, clipped: (g.committed[p] ?? 0) < base };
  }

  /** Rectangle for a callout target: a box id or a named part of a queue. */
  rectOf(target: string): { x: number; y: number; w: number; h: number } | null {
    const hash = target.indexOf('#');
    if (hash > 0) {
      const qid = target.slice(0, hash);
      const part = target.slice(hash + 1);
      const g = this.queueGeo(qid);
      const q = this.queues.get(qid);
      if (!g || !q) return null;
      const cx = (g.left + g.right) / 2;
      if (part === 'shelf') return { x: cx, y: g.shelfY, w: g.right - g.left, h: g.shelfH };
      if (part === 'rail') return { x: cx, y: g.railY, w: g.right - g.left, h: g.railH };
      if (part === 'head') return { x: this.slotX(g, 0), y: g.railY, w: g.cw, h: g.ch };
      if (part === 'tail') return { x: g.x0 + g.cw / 2, y: g.railY, w: g.cw, h: g.ch };
      if (part === 'ghost') {
        const m = q.inflight[0];
        return m ? { x: m.x, y: m.y, w: g.cw, h: g.ch } : { x: this.slotX(g, 0), y: g.shelfY, w: g.cw, h: g.ch };
      }
      return null;
    }
    const b = this.boxes.get(target);
    return b && !Number.isNaN(b.x) ? { x: b.x, y: b.y, w: b.w, h: b.h } : null;
  }

  /* ================================================================ */
  /* Routing: anchors and curves for wires and flights                 */
  /* ================================================================ */

  private liveBox(id: string): Box | null {
    const b = this.boxes.get(id);
    return b && !Number.isNaN(b.x) ? b : null;
  }

  /** Resolve an id to something with a position and size: a box, a port, a chip… */
  private anchorOf(id: string): Box | null {
    if (id.startsWith('pt:')) {
      const [x, y] = id.slice(3).split(',').map(Number);
      return pt(x, y);
    }
    if (id.startsWith('m:')) {
      const rest = id.slice(2);
      const k = rest.lastIndexOf(':');
      const qid = rest.slice(0, k);
      const mid = Number(rest.slice(k + 1));
      const q = this.queues.get(qid);
      const msg = q && (q.inflight.find((x) => x.id === mid) ?? q.visible.find((x) => x.id === mid));
      return msg ? pt(msg.x, msg.y, 4, 4) : this.liveBox(qid);
    }
    if (id.startsWith('cell:') || id.startsWith('lift:')) {
      const [kind, p, o] = id.split(':');
      const c = this.cellPos(Number(p), Number(o));
      if (!c) return null;
      return kind === 'lift' ? pt(c.x, this.liftY(Number(p))) : pt(c.x, c.y);
    }
    if (id.startsWith('mark:')) {
      const [, gid, p] = id.split(':');
      const mk = this.markPos(gid, Number(p));
      return mk ? pt(mk.x, mk.y) : null;
    }
    const hash = id.indexOf('#');
    if (hash > 0) {
      const base = id.slice(0, hash);
      const port = id.slice(hash + 1);
      if (base === 'ex') {
        const ex = this.liveBox('ex');
        const g = this.queueGeo(`q:${port}`);
        return ex && g ? pt(ex.x + ex.w / 2, g.railY) : null;
      }
      if (/^p\d+$/.test(base)) {
        const p = Number(base.slice(1));
        const g = this.partGeo(p);
        if (!g) return null;
        if (port === 'in') return pt(g.left, g.rowY);
        if (port === 'out') return pt(g.right, g.rowY);
        const c = this.cellPos(p, this.parts[p]?.log.length ?? 0);
        return c ? pt(c.x, this.liftY(p)) : null;
      }
      const g = this.queueGeo(base);
      if (!g) return null;
      if (port === 'in') {
        if (this.orient === 'portrait' && base === 'q') return pt(g.x0 + g.cw / 2 + 2, g.railTop + 2);
        return pt(g.left, g.railY);
      }
      if (port === 'out') return pt(g.right, g.railY);
      if (port === 'drop') return pt(g.x0 + g.cw / 2 + 2, g.railTop + 1);
      if (port === 'bottom') {
        const d = this.queueGeo('dlq');
        return pt(d ? d.x0 + d.cw / 2 + 2 : g.left + 30, g.bottom);
      }
      return null;
    }
    return this.liveBox(id);
  }

  private axisOf(from: string, to: string): Axis {
    const P = this.orient === 'portrait';
    const either = (f: (s: string) => boolean) => f(from) || f(to);
    if (either((s) => s.startsWith('dlq') || s === 'q#bottom')) return 'y';
    if (P && either((s) => s.startsWith('u:'))) return 'y';
    if (P && either((s) => s === 'api') && either((s) => s === 'q#in' || s === 'ex' || /^p\d+#/.test(s))) return 'y';
    return 'x';
  }

  protected curveFor(from: string, to: string, lane: number): Curve | null {
    const a = this.anchorOf(from);
    const b = this.anchorOf(to);
    if (!a || !b) return null;
    return axisCurve(a, b, this.axisOf(from, to), lane);
  }

  protected wires(): WireSpec[] {
    const c = this.cfg;
    const out: WireSpec[] = [];
    if (c.mode === 'sync' || (c.mode === 'queue' && c.users)) for (const u of USERS.slice(0, 3)) out.push({ from: `u:${u.id}`, to: 'api' });
    if (c.mode === 'sync') {
      for (const s of SERVICES) {
        const st = s.id === 'email' ? c.email : 'ok';
        out.push({ from: 'api', to: `svc:${s.id}`, state: st === 'down' ? 'down' : st === 'slow' ? 'hot' : 'normal' });
      }
    }
    if (c.mode === 'queue') {
      out.push({ from: 'api', to: 'q#in' });
      for (const w of this.workers.values()) {
        if (!this.isLive(w.id) || w.sub) continue;
        out.push({ from: 'q#out', to: w.id, state: w.state === 'down' ? 'down' : w.state === 'idle' ? 'control' : 'normal' });
      }
      if (this.isLive('dlq')) out.push({ from: 'q#bottom', to: 'dlq#drop', state: 'dashed', color: 'rgba(255,77,106,0.5)' });
    }
    if (c.mode === 'fanout') {
      out.push({ from: 'api', to: 'ex' });
      for (const s of c.subs) {
        const w = this.workers.get(`w:${s.id}`);
        out.push({ from: `ex#${s.id}`, to: `q:${s.id}#in` });
        out.push({ from: `q:${s.id}#out`, to: `w:${s.id}`, state: w?.state === 'idle' ? 'control' : 'normal' });
      }
    }
    if (c.mode === 'log') {
      for (let p = 0; p < c.partitions; p++) out.push({ from: 'api', to: `p${p}#in`, state: 'dim' });
      for (const g of this.groups.values()) {
        g.assign.forEach((cid, p) => {
          if (cid && this.isLive(cid)) out.push({ from: `p${p}#out`, to: cid, color: withAlpha(g.color, 0.55) });
        });
      }
    }
    return out;
  }

  /* ================================================================ */
  /* The clock                                                         */
  /* ================================================================ */

  protected step(dt: number) {
    const c = this.cfg;
    this.produce(dt);
    if (c.mode === 'queue' || c.mode === 'fanout') {
      this.checkTimeouts();
      for (const w of this.workers.values()) this.stepWorker(w, dt);
      if (c.autoscale && c.mode === 'queue') this.autoscale(dt);
    }
    if (c.mode === 'log') this.stepLog(dt);
    this.sample(dt);
  }

  protected animate(dt: number) {
    for (const q of this.queues.values()) {
      const g = this.queueGeo(q.id);
      if (!g) continue;
      const room = q.visible.length > g.cap ? g.cap - 1 : g.cap;
      q.visible.forEach((m, i) => {
        const hide = i >= room;
        this.easeChip(m, hide ? g.x0 + g.cw / 2 : this.slotX(g, i), g.railY, hide ? 0 : 1, dt);
      });
      q.inflight.forEach((m, j) => {
        const hide = !q.shelf || j >= g.cap;
        this.easeChip(m, this.slotX(g, hide ? 0 : j), q.shelf ? g.shelfY : g.railY, hide ? 0 : 1, dt);
      });
    }
    for (const part of this.parts) {
      for (const r of part.log) {
        const pos = this.cellPos(part.idx, r.offset);
        if (!pos) continue;
        r.x = damp(r.x, pos.x, 9, dt);
        r.y = damp(r.y, pos.y, 9, dt);
        r.alpha = damp(r.alpha, pos.visible ? 1 : 0, 9, dt);
      }
    }
    for (const id of [...this.workers.keys()]) if (!this.boxes.has(id)) this.workers.delete(id);
    for (const id of [...this.queues.keys()]) if (!this.boxes.has(id)) this.queues.delete(id);
    for (const id of [...this.consumers.keys()]) {
      if (this.boxes.has(id)) continue;
      const c = this.consumers.get(id);
      const g = c && this.groups.get(c.group);
      if (g) g.members = g.members.filter((x) => x !== id);
      this.consumers.delete(id);
    }
  }

  private easeChip(m: Msg, tx: number, ty: number, ta: number, dt: number) {
    if (!Number.isFinite(m.x) || (m.x === 0 && m.y === 0)) {
      m.x = tx;
      m.y = ty;
    }
    m.x = damp(m.x, tx, 10, dt);
    m.y = damp(m.y, ty, 10, dt);
    m.alpha = damp(m.alpha, ta, 10, dt);
  }

  private sample(dt: number) {
    this.sampleIn -= dt;
    if (this.sampleIn > 0) return;
    this.sampleIn = 0.5;
    const d = this.cfg.mode === 'log' ? this.lag('billing') : this.depth();
    this.m.depth.push(d);
    if (this.m.depth.length > 60) this.m.depth.shift();
    const cut = this.t - 12;
    while (this.m.arr.length && this.m.arr[0] < cut) this.m.arr.shift();
    while (this.m.done.length && this.m.done[0] < cut) this.m.done.shift();
    this.rev++;
  }

  private rnd(a: number, b: number) {
    return a + (b - a) * this.rng();
  }

  /** Message flights keep their label unless a burst makes them pile up. */
  private msgLabel(label: string) {
    let n = 0;
    for (const f of this.flights) if (f.tag === 'msg') n++;
    return n >= 4 ? undefined : label;
  }

  private labelsOn() {
    return this.flights.length < 9;
  }

  /* ================================================================ */
  /* Producers                                                         */
  /* ================================================================ */

  private produce(dt: number) {
    const c = this.cfg;
    if (c.tour || c.rate <= 0) return;
    this.nextIn -= dt;
    let guard = 0;
    while (this.nextIn <= 0 && guard++ < 8) {
      const gap = 1 / c.rate;
      this.nextIn += c.poisson ? -Math.log(1 - this.rng() * 0.98) * gap : gap * (0.85 + 0.3 * this.rng());
      this.arrival();
    }
  }

  private arrival() {
    const c = this.cfg;
    if (c.mode === 'sync' || (c.mode === 'queue' && c.users)) this.startSignup();
    else if (c.mode === 'queue' && c.job === 'plan') this.planPair();
    else if (c.mode === 'queue') this.sendToQueue('q', this.makeMsg(), 'api');
    else if (c.mode === 'fanout') this.publishEvent();
    else this.produceRecord();
  }

  private makeMsg(o: { user?: string; poison?: boolean } = {}): Msg {
    const id = ++this.seq;
    const user = o.user ?? USERS[(id - 1) % 3].id;
    const poison = o.poison ?? (this.cfg.poisonRate > 0 && this.rng() < this.cfg.poisonRate);
    return {
      id,
      label: String(id),
      color: poison ? SIG.err : SIG.req,
      user,
      key: user,
      poison,
      order: 1040 + id,
      amount: AMOUNTS[id % AMOUNTS.length],
      plan: null,
      seq: 0,
      work: null,
      sentAt: this.t,
      receives: 0,
      visibleAt: 0,
      x: 0,
      y: 0,
      alpha: 0,
    };
  }

  private sendToQueue(qid: string, msg: Msg, from: string, onStored?: () => void, onRejected?: () => void) {
    this.m.sent++;
    this.m.arr.push(this.t);
    this.send({
      from,
      to: `${qid}#in`,
      dur: HOP.send,
      color: msg.color,
      tag: 'msg',
      label: this.msgLabel(msg.label),
      onArrive: () => {
        const q = this.queues.get(qid);
        if (!q || !this.isLive(qid)) return;
        if (this.store(q, msg)) onStored?.();
        else onRejected?.();
      },
    });
  }

  /** Put a message at the tail of a queue. Returns false if a bounded queue is full. */
  private store(q: Queue, msg: Msg): boolean {
    const g = this.queueGeo(q.id);
    if (!q.dead && this.cfg.maxDepth != null && q.visible.length >= this.cfg.maxDepth) {
      this.m.rejected++;
      q.flash = this.vt;
      if (g) this.fx({ kind: 'x', at: { x: g.x0 + 12, y: g.railY }, color: SIG.err, size: 1.2 });
      this.rev++;
      return false;
    }
    if (g) {
      msg.x = g.x0 + g.cw / 2;
      msg.y = g.railY;
    }
    msg.alpha = 0.25;
    q.visible.push(msg);
    this.rev++;
    return true;
  }

  /* ---------------- signups (sync mode, or queued with users) ---------------- */

  private startSignup() {
    const user = USERS[this.userIdx++ % 3];
    const req: SignupReq = { id: ++this.reqSeq, user, mode: this.cfg.mode === 'sync' ? 'sync' : 'queue', phases: [], outcome: 'pending', total: null, status: null };
    this.reqs.push(req);
    if (this.reqs.length > 16) this.reqs.shift();
    this.send({
      from: `u:${user.id}`,
      to: 'api',
      dur: HOP.user,
      color: SIG.req,
      tag: 'req',
      label: this.labelsOn() ? 'POST /signup' : undefined,
      onArrive: () => this.atApi(req),
    });
  }

  private phase(req: SignupReq, key: PhaseKey, label: string, ms: number, dur: number): Phase {
    const ph: Phase = { key, label, ms, t0: this.t, dur, state: 'run' };
    req.phases.push(ph);
    this.rev++;
    return ph;
  }

  private atApi(req: SignupReq) {
    this.focus = req;
    this.apiFlash = this.vt;
    const ms = this.rnd(16, 24);
    const ph = this.phase(req, 'db', 'insert user', ms, vis(ms));
    this.after(ph.dur, () => {
      ph.state = 'ok';
      if (req.mode === 'sync') this.callSvc(req, 0);
      else this.enqueueSignup(req);
      this.rev++;
    });
  }

  private callSvc(req: SignupReq, i: number) {
    if (i >= SERVICES.length) {
      this.respond(req, 201);
      return;
    }
    const s = SERVICES[i];
    const health = s.id === 'email' ? this.cfg.email : 'ok';
    const svcId = `svc:${s.id}`;
    const ms = health === 'down' ? this.rnd(20, 40) : health === 'slow' ? CALL_TIMEOUT_MS : this.rnd(s.ms[0], s.ms[1]);
    const work = health === 'slow' ? vis(4200) : vis(ms);
    const dur = health === 'down' ? HOP.svc * 2 : health === 'slow' ? HOP.svc + vis(CALL_TIMEOUT_MS) : HOP.svc * 2 + work;
    const ph = this.phase(req, s.id, s.call, ms, dur);
    this.send({
      from: 'api',
      to: svcId,
      dur: HOP.svc,
      color: SIG.req,
      tag: 'call',
      onArrive: () => {
        if (ph.state !== 'run') return;
        if (health === 'down') {
          this.fx({ kind: 'x', at: { id: svcId }, color: SIG.err, size: 1.2 });
          this.send({ from: svcId, to: 'api', dur: HOP.svc, color: SIG.err, tag: 'call', onArrive: () => this.failCall(req, ph, 'connection refused') });
          return;
        }
        const call: SvcCall = { req, t0: this.t, dur: work };
        const list = this.calls.get(s.id) ?? [];
        list.push(call);
        this.calls.set(s.id, list);
        this.after(work, () => {
          this.calls.set(s.id, (this.calls.get(s.id) ?? []).filter((x) => x !== call));
          if (ph.state !== 'run') return;
          this.send({
            from: svcId,
            to: 'api',
            dur: HOP.svc,
            color: SIG.res,
            tag: 'call',
            onArrive: () => {
              if (ph.state !== 'run') return;
              ph.state = 'ok';
              this.rev++;
              this.callSvc(req, i + 1);
            },
          });
        });
      },
    });
    if (health === 'slow') {
      this.after(dur, () => {
        if (ph.state !== 'run') return;
        this.calls.set(s.id, (this.calls.get(s.id) ?? []).filter((x) => x.req !== req));
        this.say('api', 'email timed out', SIG.err);
        this.failCall(req, ph, 'timed out');
      });
    }
  }

  private failCall(req: SignupReq, ph: Phase, why: string) {
    ph.state = 'fail';
    ph.note = why;
    this.respond(req, 500);
  }

  private enqueueSignup(req: SignupReq) {
    const ms = this.rnd(9, 18);
    const ph = this.phase(req, 'send', 'queue.send', ms, HOP.send + HOP.sendAck);
    const msg = this.makeMsg({ user: req.user.id });
    this.sendToQueue(
      'q',
      msg,
      'api',
      () =>
        this.send({
          from: 'q#in',
          to: 'api',
          dur: HOP.sendAck,
          color: SIG.res,
          r: 3,
          trail: false,
          tag: 'ok',
          onArrive: () => {
            ph.state = 'ok';
            this.respond(req, 201);
          },
        }),
      () => {
        ph.state = 'fail';
        ph.note = 'queue full';
        this.respond(req, 503);
      },
    );
  }

  private respond(req: SignupReq, status: number) {
    req.status = status;
    req.total = req.phases.reduce((s, p) => s + p.ms, 0);
    const ok = status < 400;
    const text = status === 201 ? '201 Created' : status === 503 ? '503 Unavailable' : '500 Error';
    this.rev++;
    this.send({
      from: 'api',
      to: `u:${req.user.id}`,
      dur: HOP.user,
      color: ok ? SIG.res : SIG.err,
      tag: 'res',
      label: this.labelsOn() ? text : undefined,
      onArrive: () => {
        req.outcome = ok ? 'ok' : 'fail';
        this.userFlash.set(req.user.id, { ok, vt: this.vt });
        if (ok) {
          this.m.okSignups++;
          this.m.resp.push(req.total ?? 0);
          if (this.m.resp.length > 24) this.m.resp.shift();
        } else this.m.failedSignups++;
        this.rev++;
      },
    });
  }

  /* ---------------- ordering demo: two plan changes per user ---------------- */

  private planPair() {
    const key = USERS[this.planIdx % USERS.length].id;
    const first = this.planIdx === 0;
    this.planIdx++;
    const row = this.plans.get(key) ?? { user: key, plan: null, latest: null, latestSeq: 0, maxApplied: 0, pending: 0, stale: false, vt: this.vt };
    const [a, b]: ('pro' | 'free')[] = row.plan === 'pro' ? ['free', 'pro'] : ['pro', 'free'];
    const send = (plan: 'pro' | 'free', work: number | null) => {
      const msg = this.makeMsg({ user: key });
      const n = (this.keySeq.get(key) ?? 0) + 1;
      this.keySeq.set(key, n);
      msg.seq = n;
      msg.plan = plan;
      msg.work = work;
      msg.label = `${userOf(key).name[0]}${n}`;
      msg.color = userOf(key).color;
      row.latest = plan;
      row.latestSeq = n;
      row.pending++;
      row.stale = false;
      this.plans.set(key, row);
      this.sendToQueue('q', msg, 'api');
    };
    send(a, first ? 3.6 : this.rnd(0.9, 2.8));
    this.after(0.3, () => send(b, first ? 1.1 : this.rnd(0.9, 2.8)));
  }

  private applyPlan(w: Worker, msg: Msg) {
    const row = this.plans.get(msg.key);
    if (!row || !msg.plan) return;
    row.pending = Math.max(0, row.pending - 1);
    row.plan = msg.plan;
    row.vt = this.vt;
    if (msg.seq < row.maxApplied) {
      row.stale = true;
      this.m.wrongOrder++;
      w.flash = { color: SIG.err, vt: this.vt };
    } else {
      row.maxApplied = msg.seq;
      row.stale = false;
    }
  }

  /* ---------------- fan-out ---------------- */

  private publishEvent() {
    const base = this.makeMsg();
    this.m.sent++;
    this.m.arr.push(this.t);
    this.send({
      from: 'api',
      to: 'ex',
      dur: HOP.ex,
      color: SIG.req,
      tag: 'msg',
      label: base.label,
      onArrive: () => {
        this.exFlash = this.vt;
        for (const s of this.cfg.subs) {
          const qid = `q:${s.id}`;
          if (!this.isLive(qid)) continue;
          const copy: Msg = { ...base };
          this.send({
            from: `ex#${s.id}`,
            to: `${qid}#in`,
            dur: HOP.fan,
            color: SIG.req,
            tag: 'msg',
            label: copy.label,
            onArrive: () => {
              const q = this.queues.get(qid);
              if (q) this.store(q, copy);
            },
          });
        }
        this.rev++;
      },
    });
  }

  /* ---------------- partitioned log ---------------- */

  private nextKey() {
    const seqd = ['alice', 'bob', 'alice', 'dave', 'carol', 'bob', 'alice', 'dave'];
    const k = this.keyIdx < seqd.length ? seqd[this.keyIdx] : USERS[Math.floor(this.rng() * USERS.length)].id;
    this.keyIdx++;
    return k;
  }

  private produceRecord() {
    if (this.hash?.asking) return;
    const key = this.nextKey();
    const u = userOf(key);
    const n = (this.keySeq.get(key) ?? 0) + 1;
    this.keySeq.set(key, n);
    const h = toyHash(key);
    const P = this.cfg.partitions;
    const p = h % P;
    const id = ++this.seq;
    const info: HashInfo = { key, label: `${u.name[0]}${n}`, color: u.color, hash: h, n: P, p, asking: false };
    this.hash = info;
    this.m.sent++;
    const go = () => {
      info.asking = false;
      this.sendRecord(p, { offset: -1, id, key, label: info.label, color: u.color, x: 0, y: 0, alpha: 0 });
      this.rev++;
    };
    const g = this.game;
    if (this.cfg.predict === 'partition' && g && !g.done && this.keyIdx > 2) {
      info.asking = true;
      const repeat = n > 1;
      g.ask({
        acceptable: [`p${p}`],
        choices: Array.from({ length: P }, (_, i) => ({ id: `p${i}`, label: `P${i}` })),
        ask: `Which partition gets ${info.label}?`,
        askAt: { id: 'api' },
        explain: (_picked, ok) => {
          if (repeat)
            return ok
              ? `Same key, same hash, same partition. ${info.label} lines up behind ${u.name}'s earlier events in P${p}, so they stay in order.`
              : `${u.name}'s key always hashes to ${h}, and ${h} mod ${P} = ${p}. Same key, same partition, every time. That's what keeps ${u.name}'s events in order.`;
          return ok
            ? `hash('${key}') = ${h}, and ${h} mod ${P} = ${p}. From now on every ${u.name} event goes to P${p}.`
            : `hash('${key}') = ${h}, and ${h} = ${P} × ${Math.floor(h / P)} + ${p}. The remainder is ${p}, so it's P${p}, and so is every later ${u.name} event.`;
        },
        resolve: go,
      });
      this.rev++;
      return;
    }
    go();
  }

  private sendRecord(p: number, rec: Rec) {
    this.m.arr.push(this.t);
    this.send({
      from: 'api',
      to: `p${p}#next`,
      dur: HOP.log,
      color: rec.color,
      tag: 'msg',
      label: rec.label,
      lane: 0,
      onArrive: () => {
        const part = this.parts[p];
        if (!part) return;
        rec.offset = part.log.length;
        const pos = this.cellPos(p, rec.offset);
        if (pos) {
          rec.x = pos.x;
          rec.y = this.liftY(p);
        }
        rec.alpha = 1;
        part.log.push(rec);
        this.rev++;
      },
    });
  }

  private rebalance(g: Group) {
    g.needsAssign = true;
    g.rebalanceUntil = this.t + 1.2;
    for (const id of g.members) {
      const c = this.consumers.get(id);
      if (c && c.state !== 'down') c.status = 'rebalancing…';
    }
    this.rev++;
  }

  private assign(g: Group) {
    const P = this.cfg.partitions;
    const live = g.members.filter((id) => this.consumers.get(id)?.state !== 'down').sort();
    for (let p = 0; p < P; p++) {
      g.assign[p] = live.length ? live[p % live.length] : null;
      g.position[p] = g.committed[p] ?? 0;
    }
    g.needsAssign = false;
    for (const id of g.members) {
      const c = this.consumers.get(id);
      if (!c || c.state === 'down') continue;
      const mine = this.partsOf(g, id);
      c.status = mine.length ? `owns ${mine.map((x) => `P${x}`).join(' ')}` : 'idle: no partition left';
    }
    this.rev++;
  }

  private stepLog(dt: number) {
    for (const g of this.groups.values()) {
      if (g.needsAssign) {
        const busy = g.members.some((id) => {
          const c = this.consumers.get(id);
          return c && (c.state === 'fetching' || c.state === 'working');
        });
        if (this.t >= g.rebalanceUntil && !busy) this.assign(g);
      }
      for (const id of g.members) {
        const c = this.consumers.get(id);
        if (!c) continue;
        if (c.state === 'working') {
          c.p = Math.min(1, c.p + dt / c.dur);
          if (c.p >= 1) this.commit(c, g);
        } else if (c.state === 'idle' && !g.needsAssign) this.fetchNext(c, g);
      }
    }
  }

  private fetchNext(c: Consumer, g: Group) {
    const mine = this.partsOf(g, c.id);
    if (!mine.length) return;
    for (let k = 0; k < mine.length; k++) {
      const p = mine[(c.rr + k) % mine.length];
      const part = this.parts[p];
      if (!part || g.position[p] >= part.log.length) continue;
      c.rr = (c.rr + k + 1) % mine.length;
      const rec = part.log[g.position[p]];
      g.position[p]++;
      c.state = 'fetching';
      c.cur = { p, rec };
      c.status = `${rec.label} · P${p} @${rec.offset}`;
      this.send({
        from: `lift:${p}:${rec.offset}`,
        to: c.id,
        dur: HOP.log,
        color: rec.color,
        tag: 'msg',
        label: rec.label,
        lane: 0,
        onArrive: () => {
          if (c.state !== 'fetching' || c.cur?.rec !== rec) return;
          c.state = 'working';
          c.p = 0;
          c.dur = Math.max(0.4, this.cfg.work * (1 + this.cfg.jitter * (this.rng() * 2 - 1)));
        },
      });
      return;
    }
    c.status = `caught up · ${mine.map((x) => `P${x}`).join(' ')}`;
  }

  private commit(c: Consumer, g: Group) {
    const cur = c.cur;
    c.state = 'idle';
    c.cur = null;
    c.p = 0;
    if (!cur) return;
    this.m.processed++;
    this.m.done.push(this.t);
    this.send({
      from: c.id,
      to: `mark:${g.id}:${cur.p}`,
      dur: HOP.commit,
      color: g.color,
      r: 3,
      trail: false,
      tag: 'commit',
      onArrive: () => {
        g.committed[cur.p] = Math.max(g.committed[cur.p] ?? 0, cur.rec.offset + 1);
        this.rev++;
      },
    });
  }

  /* ================================================================ */
  /* Workers                                                           */
  /* ================================================================ */

  private stepWorker(w: Worker, dt: number) {
    if (w.state === 'down') {
      if (w.downUntil != null && this.t >= w.downUntil) this.revive(w);
      return;
    }
    if (w.state === 'error') {
      if (this.t >= w.errorUntil) this.makeIdle(w);
      return;
    }
    if (w.state === 'idle') {
      if (!w.retiring) this.tryReceive(w);
      return;
    }
    if (w.state === 'working') this.work(w, dt);
  }

  private makeIdle(w: Worker) {
    w.state = 'idle';
    w.msg = null;
    w.p = 0;
    w.effect = false;
    w.crashAt = null;
    w.tone = 'normal';
    w.note = null;
    w.status = 'idle · polling';
  }

  private tourSlow() {
    return this.cfg.tour ? 2.4 : 1;
  }

  private tryReceive(w: Worker) {
    const q = this.queues.get(w.queue);
    if (!q || !q.visible.length || !this.isLive(w.id)) return;
    if (this.tour && !this.tour.allow) return;
    const msg = q.visible.shift();
    if (!msg) return;
    msg.receives++;
    msg.visibleAt = this.t + this.cfg.visibility;
    q.inflight.push(msg);
    if (msg.poison) this.m.poisonTries++;
    w.state = 'fetching';
    w.msg = msg;
    w.p = 0;
    w.effect = false;
    w.note = null;
    w.acked = false;
    w.crashAt = null;
    w.tone = 'normal';
    w.status = 'receiving…';
    this.armFor(w, msg);
    const f = this.send({
      from: `pt:${msg.x.toFixed(1)},${msg.y.toFixed(1)}`,
      to: w.id,
      dur: HOP.recv * this.tourSlow(),
      color: msg.color,
      tag: 'msg',
      label: this.msgLabel(msg.label),
      onArrive: () => this.gotMsg(w, q, msg),
    });
    if (this.tour && this.tour.msg === msg) {
      this.tour.allow = false;
      this.setTour('fetch', f.id);
    }
    this.rev++;
  }

  private armFor(w: Worker, msg: Msg) {
    const c = this.cfg;
    if (msg.poison) return;
    if (this.pendingArm != null) {
      w.crashAt = this.pendingArm;
      this.pendingArm = null;
      return;
    }
    if (c.crashRate > 0 && this.rng() < c.crashRate) w.crashAt = 0.15 + this.rng() * 0.8;
    const g = this.game;
    if (!g || g.done || (c.predict !== 'crash' && c.predict !== 'double')) return;
    if (msg.receives !== 1) return;
    if (this.probe && (!this.probe.done || this.t < this.probe.doneAt + 1.5)) return;
    w.crashAt = c.predict === 'crash' ? 0.42 : 0.8;
    this.probe = { msg, done: false, doneAt: 0 };
  }

  private gotMsg(w: Worker, q: Queue, msg: Msg) {
    if (w.state !== 'fetching' || w.msg !== msg) return;
    w.state = 'working';
    w.p = 0;
    w.dur = this.workDur(w, msg);
    w.status = this.statusFor(w, msg);
    if (this.cfg.ackBefore) {
      w.acked = true;
      this.sendAck(w, q, msg);
    }
    if (this.tour && this.tour.msg === msg) this.setTour('hidden');
    this.rev++;
  }

  private workDur(w: Worker, msg: Msg) {
    if (msg.work != null) return msg.work;
    const sub = w.sub ? this.cfg.subs.find((s) => s.id === w.sub) : null;
    const base = sub ? sub.work * (this.cfg.slowSub === sub.id ? 3.4 : 1) : this.cfg.work;
    return Math.max(0.3, base * (1 + this.cfg.jitter * (this.rng() * 2 - 1)));
  }

  private statusFor(w: Worker, msg: Msg) {
    const p = w.p;
    if (w.sub) return `${this.cfg.subs.find((s) => s.id === w.sub)?.does ?? 'working'}…`;
    if (this.cfg.job === 'plan') return `set plan = ${msg.plan}…`;
    if (this.cfg.job === 'charge') {
      if (!w.effect) return `charging $${msg.poison ? '???' : msg.amount}…`;
      if (w.note === 'skipped') return 'seen it → skip';
      if (w.note === 'double') return 'charged AGAIN';
      return 'charged ✓';
    }
    return p < 0.36 ? 'welcome email…' : p < 0.88 ? 'resizing avatar…' : 'tracking signup…';
  }

  private work(w: Worker, dt: number) {
    const msg = w.msg;
    if (!msg) {
      this.makeIdle(w);
      return;
    }
    const q = this.queues.get(w.queue) ?? null;
    w.p = Math.min(1, w.p + dt / w.dur);
    if (msg.poison && !this.cfg.fixed && w.p >= 0.4) {
      this.fail(w);
      return;
    }
    if (!w.effect && w.p >= EFFECT_AT && this.cfg.job === 'charge' && !w.sub) {
      w.effect = true;
      this.charge(w, msg);
    }
    if (w.crashAt != null && w.p >= w.crashAt) {
      this.crash(w);
      return;
    }
    w.status = this.statusFor(w, msg);
    if (w.p >= 1) this.finish(w, q, msg);
  }

  private charge(w: Worker, msg: Msg) {
    const before = this.ledger.some((r) => r.order === msg.order && (r.kind === 'ok' || r.kind === 'dup'));
    const row: LedgerRow = { order: msg.order, user: msg.user, amount: msg.amount, kind: 'ok', msg: msg.label, vt: this.vt };
    if (this.cfg.idempotent && before) {
      row.kind = 'skip';
      w.note = 'skipped';
      this.m.skipped++;
      w.flash = { color: SIG.hc, vt: this.vt };
    } else if (before) {
      row.kind = 'dup';
      w.note = 'double';
      this.m.charges++;
      this.m.dupes++;
      w.flash = { color: SIG.err, vt: this.vt };
    } else {
      w.note = 'charged';
      this.m.charges++;
    }
    this.ledger.push(row);
    if (this.ledger.length > 40) this.ledger.shift();
    this.rev++;
  }

  private fail(w: Worker) {
    w.state = 'error';
    w.errorUntil = this.t + 1;
    w.msg = null;
    w.p = 0;
    w.status = '✕ threw: bad amount';
    w.tone = 'bad';
    w.flash = { color: SIG.err, vt: this.vt };
    this.fx({ kind: 'x', at: { id: w.id }, color: SIG.err, size: 1.1, dur: 0.9 });
    this.rev++;
  }

  private finish(w: Worker, q: Queue | null, msg: Msg) {
    if (this.cfg.job === 'plan') this.applyPlan(w, msg);
    w.served++;
    this.m.processed++;
    this.m.done.push(this.t);
    if (q && !w.acked) this.sendAck(w, q, msg);
    this.makeIdle(w);
    if (w.retiring) this.hide(w.id);
    this.rev++;
  }

  private sendAck(w: Worker, q: Queue, msg: Msg) {
    const f = this.send({
      from: w.id,
      to: `m:${q.id}:${msg.id}`,
      dur: HOP.ack * this.tourSlow(),
      color: SIG.res,
      r: 3.6,
      tag: 'ack',
      label: this.cfg.ackLabels ? `delete #${msg.label}` : undefined,
      onArrive: () => this.deleteMsg(q, msg),
    });
    if (this.tour && this.tour.msg === msg) this.setTour('delete', f.id);
  }

  private deleteMsg(q: Queue, msg: Msg) {
    let i = q.inflight.indexOf(msg);
    if (i >= 0) q.inflight.splice(i, 1);
    else {
      i = q.visible.indexOf(msg);
      if (i < 0) return;
      q.visible.splice(i, 1);
    }
    this.fx({ kind: 'ring', at: { x: msg.x, y: msg.y }, color: SIG.res, size: 0.7, dur: 0.7 });
    if (this.probe && this.probe.msg === msg && msg.receives >= 2) {
      this.probe.done = true;
      this.probe.doneAt = this.t;
    }
    if (this.tour && this.tour.msg === msg) {
      this.tour.x = msg.x;
      this.tour.y = msg.y;
      this.setTour('gone');
    }
    this.rev++;
  }

  private checkTimeouts() {
    for (const q of this.queues.values()) {
      if (!q.inflight.length || q.dead) continue;
      const expired = q.inflight.filter((m) => this.t >= m.visibleAt);
      for (const msg of expired) {
        q.inflight.splice(q.inflight.indexOf(msg), 1);
        if (this.cfg.dlq && q.id === 'q' && msg.receives >= this.cfg.maxReceives && this.isLive('dlq')) {
          this.toDlq(msg);
          continue;
        }
        q.visible.unshift(msg);
        this.m.redelivered++;
        this.fx({ kind: 'ring', at: { x: msg.x, y: msg.y }, color: SIG.warn, size: 0.7, dur: 0.8 });
        if (q.shelf) this.chipNote(q, msg, `#${msg.label} visible again`, SIG.warn);
        this.rev++;
      }
    }
  }

  /** A short note inside the in-flight band, just left of a chip. */
  private chipNote(q: Queue, msg: Msg, text: string, color: string) {
    const g = this.queueGeo(q.id);
    if (!g) return;
    const est = text.length * 6.4 + 18;
    const x = Math.max(g.left + est / 2 + 4, msg.x - g.cw / 2 - 8 - est / 2);
    this.fx({ kind: 'text', at: { x, y: g.shelfY + 9 }, text, color, dur: 1.8 });
  }

  private toDlq(msg: Msg) {
    const q = this.queues.get('q');
    if (q) this.chipNote(q, msg, `${msg.receives} tries → DLQ`, SIG.err);
    this.send({
      from: `pt:${msg.x.toFixed(1)},${msg.y.toFixed(1)}`,
      to: 'dlq#drop',
      dur: HOP.dlq,
      color: SIG.err,
      tag: 'msg',
      label: msg.label,
      onArrive: () => {
        const d = this.queues.get('dlq');
        if (d && this.store(d, msg)) this.m.dlq++;
        this.rev++;
      },
    });
    this.rev++;
  }

  crash(w: Worker) {
    if (w.state === 'down') return;
    const msg = w.msg;
    const was = w.state;
    const charged = w.effect;
    const acked = w.acked;
    w.state = 'down';
    w.msg = null;
    w.p = 0;
    w.crashAt = null;
    w.effect = false;
    w.note = null;
    w.status = msg ? `✕ crashed (#${msg.label})` : '✕ crashed';
    w.tone = 'bad';
    w.downUntil = this.cfg.restart > 0 ? this.t + this.cfg.restart : null;
    w.flash = { color: SIG.err, vt: this.vt };
    this.fx({ kind: 'x', at: { id: w.id }, color: SIG.err, size: 1.8, dur: 1.2 });
    this.m.crashes++;
    const busy = was === 'working' || was === 'fetching';
    if (msg && busy && acked && !charged) {
      this.m.lost++;
      if (this.cfg.job === 'charge') {
        this.ledger.push({ order: msg.order, user: msg.user, amount: msg.amount, kind: 'lost', msg: msg.label, vt: this.vt });
        if (this.ledger.length > 40) this.ledger.shift();
      }
    }
    if (w.retiring) this.hide(w.id);
    if (msg && busy) this.onCrash(w, msg, charged);
    this.rev++;
  }

  private revive(w: Worker) {
    this.makeIdle(w);
    w.downUntil = null;
    this.fx({ kind: 'ring', at: { id: w.id }, color: SIG.res, size: 1.6, dur: 0.9 });
    this.rev++;
  }

  private autoscale(dt: number) {
    this.scaleIn -= dt;
    if (this.scaleIn > 0) return;
    this.scaleIn = 1.2;
    const n = this.cfg.workers;
    const want = clamp(Math.ceil(this.depth() / 3), 1, 6);
    if (want > n) {
      this.cfg = { ...this.cfg, workers: n + 1 };
      this.syncWorkers();
      this.quietFor = 0;
      this.rev++;
    } else if (want < n) {
      this.quietFor += 1.2;
      if (this.quietFor >= 4.8) {
        this.cfg = { ...this.cfg, workers: n - 1 };
        this.syncWorkers();
        this.quietFor = 0;
        this.rev++;
      }
    } else this.quietFor = 0;
  }

  /* ================================================================ */
  /* Predictions                                                       */
  /* ================================================================ */

  private onCrash(w: Worker, msg: Msg, charged: boolean) {
    const g = this.game;
    if (!g || g.done || g.pending || !this.probe || this.probe.msg !== msg) return;
    if (this.cfg.predict === 'crash') this.askCrash(w, msg);
    else if (this.cfg.predict === 'double' && charged) this.askDouble(msg);
  }

  private askPoint(msg: Msg) {
    const g = this.queueGeo('q');
    return { x: msg.x, y: g ? g.top - 6 : msg.y - 30 };
  }

  private askCrash(w: Worker, msg: Msg) {
    const v = this.cfg.visibility;
    this.game?.ask({
      acceptable: ['back'],
      choices: [
        { id: 'lost', label: 'Lost for good' },
        { id: 'back', label: 'Back after the timeout' },
        { id: 'stuck', label: 'Hidden forever' },
      ],
      ask: `What happens to #${msg.label}?`,
      askAt: this.askPoint(msg),
      explain: (picked, ok) =>
        ok
          ? `#${msg.label} was never deleted, only hidden. When its ${v}-second visibility timeout runs out it becomes visible again, and the next free worker gets it. Its receive count goes to 2.`
          : picked === 'lost'
            ? `Receiving a message doesn't remove it. Only a delete (the ack) does, and ${w.name} died before sending one. So #${msg.label} is hidden, not gone: it reappears when the ${v}-second visibility timeout runs out.`
            : `Nothing stays hidden forever. The visibility timeout is the safety net for exactly this: when it runs out, #${msg.label} becomes visible again and another worker picks it up.`,
    });
  }

  private askDouble(msg: Msg) {
    const u = userOf(msg.user).name;
    this.game?.ask({
      acceptable: ['twice'],
      choices: [
        { id: 'twice', label: `Yes, ${u} pays twice` },
        { id: 'once', label: 'No, just once' },
      ],
      ask: `#${msg.label} comes back. Charged twice?`,
      askAt: this.askPoint(msg),
      explain: (_picked, ok) =>
        ok
          ? `The queue only knows about deletes. It never got one for #${msg.label}, so it hands it out again, and the next worker charges ${u} again. That's at-least-once delivery.`
          : `The queue can't know the charge went through: the worker died before deleting #${msg.label}. So it redelivers it, and the next worker charges ${u} a second time. Watch the charges table.`,
    });
  }

  /* ================================================================ */
  /* Follow one message                                                */
  /* ================================================================ */

  private setTour(stage: TourStage, flight: number | null = null) {
    const t = this.tour;
    if (!t) return;
    t.stage = stage;
    t.since = this.t;
    t.flight = flight;
    this.rev++;
    if (stage === 'stored') {
      this.after(2.6, () => {
        if (this.tour && this.tour.stage === 'stored') this.tour.allow = true;
      });
    }
    if (stage === 'gone') this.after(3.4, () => this.tourSend());
  }

  /** Send the one message the tour follows. */
  tourSend() {
    const t = this.tour;
    if (!t) return;
    const msg = this.makeMsg({ user: 'alice' });
    t.msg = msg;
    t.allow = false;
    this.m.sent++;
    const f = this.send({
      from: 'api',
      to: 'q#in',
      dur: HOP.send * 3,
      color: msg.color,
      tag: 'msg',
      label: msg.label,
      onArrive: () => {
        const q = this.queues.get('q');
        if (q && this.store(q, msg)) this.setTour('stored');
      },
    });
    this.setTour('send', f.id);
  }
}

