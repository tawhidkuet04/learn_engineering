import { SIG } from '@/lib/sim/colors';
import { bezier, type Curve, type Pt } from '@/lib/sim/geometry';
import { PredictGame } from '@/lib/sim/predict';
import { Sim, type Flight, type WireSpec } from '@/lib/sim/Sim';
import { FeedCtl } from './feed';
import { rev, shift } from './geom';
import { HOP, MS_PER_S, NODES, PEOPLE, REGION, pairKey, oneWay, vvCompare, type ClientId, type NodeId, type Val, type VV } from './model';
import { QuorumCtl } from './quorum';
import { RaftCtl } from './raft';

/* ------------------------------------------------------------------ */
/* Config                                                              */
/* ------------------------------------------------------------------ */

export type View = 'world' | 'quorum' | 'feed' | 'spectrum';
export type Tone = 'ok' | 'stale' | 'err' | 'info';
export type Merge = 'lww' | 'vv';
export type Auto = 'tunable' | 'pacelc' | 'raft' | null;

export interface CapConfig {
  view: View;
  /** Starting value of seats_left and its version */
  seats: number;
  ver: number;
  /** Replicas that must hold a write before the client hears "booked" (1 = just the local one) */
  wq: number;
  /** Replicas a read must hear from (1 = answer locally) */
  rq: number;
  /** Serve reads locally even when writes wait for a quorum */
  readLocal: boolean;
  /** Coordinator knows who is reachable and fails at once (Cassandra's UnavailableException) */
  failFast: boolean;
  /** Keep replication that can't cross the partition and deliver it after the heal (hinted handoff) */
  hints: boolean;
  merge: Merge;
  /** Network partition: Virginia cut off from Frankfurt and Singapore */
  cut: boolean;
  heartbeats: boolean;
  /** Show round-trip times on the links */
  rtt: boolean;
  /** Virginia's clock runs this many ms ahead */
  skew: number;
  /** Show writer + timestamp on the cards */
  showTs: boolean;
  /** Label the majority / minority sides of a partition */
  sides: boolean;
  auto: Auto;
  /* quorum view */
  n: number;
  r: number;
  w: number;
  /* feed view */
  causal: boolean;
  /* spectrum view */
  level: number;
}

export const DEFAULTS: CapConfig = {
  view: 'world',
  seats: 3,
  ver: 7,
  wq: 1,
  rq: 1,
  readLocal: false,
  failFast: false,
  hints: false,
  merge: 'lww',
  cut: false,
  heartbeats: false,
  rtt: false,
  skew: 0,
  showTs: false,
  sides: false,
  auto: null,
  n: 3,
  r: 2,
  w: 2,
  causal: false,
  level: 0,
};

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */

export interface Status {
  text: string;
  tone: Tone;
}

export type Role = 'leader' | 'follower' | 'candidate' | 'none';

export interface Replica {
  id: NodeId;
  val: Val;
  /** Concurrent versions kept side by side (version vectors) */
  siblings: Val[];
  /** A write waiting for acks (not committed yet) */
  pending: Val | null;
  /** Replication held back by the partition, delivered after the heal */
  hints: { to: NodeId; val: Val }[];
  /** A short-lived remark shown under the card */
  note: (Status & { until: number }) | null;
  /** Refused a request because it couldn't reach a majority (until the heal) */
  refusing: boolean;
  flashVt: number;
  flashTone: Tone;
  /** Last time a heartbeat arrived from each peer */
  heard: Partial<Record<NodeId, number>>;
}

export interface ClientState {
  id: ClientId;
  result: { text: string; tone: Tone } | null;
  busy: boolean;
  pulseVt: number;
  pulseTone: Tone;
}

export interface AskSpec {
  ask: string;
  why: string;
  choices?: { id: string; label: string }[];
}

export type OpKind = 'book' | 'read' | 'cut' | 'heal' | 'wait' | 'dilemma' | 'set' | 'reset' | 'lww';

export interface Op {
  kind: OpKind;
  c?: ClientId;
  ask?: AskSpec;
  /** Pause after this op, in simulated seconds */
  wait?: number;
  /** Handle this request as a CP or AP system would (the CAP step shows both) */
  as?: 'cp' | 'ap';
  /** For 'set': config changes to apply */
  patch?: Partial<CapConfig>;
}

export interface Decision {
  node: NodeId;
  kind: 'book' | 'read';
  need: number;
  reach: number;
  outcome: string;
  tone: Tone;
  vt: number;
}

export const WRITE_CHOICES = [
  { id: 'ok', label: 'Booked ✓' },
  { id: 'err', label: 'Error: refused' },
];

export const READ_CHOICES = [
  { id: 'new', label: 'The new value' },
  { id: 'stale', label: 'An old, stale value' },
  { id: 'err', label: 'An error' },
];

const TONE_COLOR: Record<Tone, string> = { ok: SIG.res, stale: SIG.heavy, err: SIG.err, info: SIG.text2 };
export const toneColor = (t: Tone) => TONE_COLOR[t];

const TIMEOUT = 2.6;

function vvFor(ver: number): VV {
  const va = Math.ceil(ver / 3);
  const fra = Math.round(ver / 3);
  return { va, fra, sg: ver - va - fra };
}

/* ------------------------------------------------------------------ */

export class CapSim extends Sim {
  cfg: CapConfig = { ...DEFAULTS };
  game: PredictGame | null = null;
  replicas = {} as Record<NodeId, Replica>;
  clients = {} as Record<ClientId, ClientState>;
  cut = false;
  cutVt = -10;
  stats = { ok: 0, stale: 0, errors: 0, dropped: 0, lastWriteMs: null as number | null, lastReadMs: null as number | null };
  flags = { oversold: false, refused: false, skewWin: false, siblings: false, dropped: false };
  /** People told "booked" for the last seat */
  lastSeat: string[] = [];
  /** Latest acknowledged write, as an all-seeing observer knows it */
  latest: Val | null = null;
  decision: Decision | null = null;
  /** Alice's read held at a replica that must choose (the dilemma step) */
  dilemma: { c: ClientId; x: NodeId; done?: () => void } | null = null;
  /** A choice made before the held read arrived */
  private queuedChoice: 'answer' | 'refuse' | null = null;
  private dilemmaSeen = false;
  /** The last write that LWW threw away */
  dropped: { loser: Val; winner: Val; node: NodeId; vt: number } | null = null;

  raft: RaftCtl;
  quorum: QuorumCtl;
  feed: FeedCtl;

  private ops: Op[] = [];
  private opIdx = 0;
  private opLoop = false;
  private opGen = 0;
  private writeSeq = 1;
  private t0 = 0;
  private hbIn = 0.4;
  private autoIn = 0.8;
  private autoN = 0;

  constructor() {
    super();
    this.raft = new RaftCtl(this);
    this.quorum = new QuorumCtl(this);
    this.feed = new FeedCtl(this);
    this.resetValues();
    for (const c of ['alice', 'bob', 'carol'] as ClientId[]) this.clients[c] = { id: c, result: null, busy: false, pulseVt: -10, pulseTone: 'ok' };
  }

  /* ---------------- step entry ---------------- */

  enter(cfg: CapConfig, opts: { reset?: boolean; predict?: number; ops?: Op[]; loop?: boolean; onEnter?: (s: CapSim) => void } = {}) {
    const prevView = this.cfg.view;
    this.cfg = { ...cfg };
    if (opts.reset || prevView !== cfg.view) {
      this.clearTransient();
      this.t0 = this.t;
      this.resetValues();
      this.resetClients();
      this.stats = { ok: 0, stale: 0, errors: 0, dropped: 0, lastWriteMs: null, lastReadMs: null };
      this.flags = { oversold: false, refused: false, skewWin: false, siblings: false, dropped: false };
      this.raft.reset();
      this.quorum.reset();
      this.feed.reset();
      this.hbIn = 0.4;
      this.autoIn = 0.8;
      this.autoN = 0;
    }
    this.syncBoxes();
    this.game = opts.predict ? new PredictGame(this, opts.predict) : null;
    this.opGen++;
    this.ops = opts.ops ?? [];
    this.opIdx = 0;
    this.opLoop = !!opts.loop;
    if (this.ops.length) {
      const gen = this.opGen;
      this.after(0.6, () => this.nextOp(gen));
    }
    if (cfg.view === 'quorum') this.quorum.start();
    if (cfg.view === 'feed') this.feed.start();
    if (cfg.auto === 'raft') this.raft.start();
    opts.onEnter?.(this);
    this.runScript([]);
    this.rev++;
  }

  /** Which boxes exist depends on the view. */
  private syncBoxes() {
    const v = this.cfg.view;
    const world = v === 'world' || v === 'feed';
    const show = (id: string, on: boolean) => {
      if (on) this.box(id);
      else this.hide(id);
    };
    for (const id of [...NODES, 'alice', 'bob', 'carol']) show(id, world);
    for (let i = 1; i <= 5; i++) show(`q${i}`, v === 'quorum' && i <= this.cfg.n);
    for (const id of ['qa', 'qb']) show(id, v === 'quorum');
  }

  resetValues() {
    const base: Val = { id: 0, seats: this.cfg.seats, ver: this.cfg.ver, by: null, at: null, ts: 0, real: 0, vv: vvFor(this.cfg.ver) };
    for (const id of NODES) {
      this.replicas[id] = { id, val: base, siblings: [], pending: null, hints: [], note: null, refusing: false, flashVt: -10, flashTone: 'ok', heard: {} };
    }
    this.latest = base;
    this.lastSeat = [];
    this.decision = null;
    this.dilemma = null;
    this.dilemmaSeen = false;
    this.queuedChoice = null;
    this.dropped = null;
    this.cut = this.cfg.cut;
    this.cutVt = this.cfg.cut ? this.vt - 5 : -10;
  }

  private resetClients() {
    for (const c of Object.values(this.clients)) {
      c.result = null;
      c.busy = false;
      c.pulseVt = -10;
    }
  }

  /** Restart the current step's scenario without touching the prediction score. */
  private restartOps() {
    const gen = this.opGen;
    this.clearTransient();
    this.t0 = this.t;
    this.resetValues();
    this.resetClients();
    this.opIdx = 0;
    this.rev++;
    this.after(0.8, () => this.nextOp(gen));
  }

  /* ---------------- layout ---------------- */

  /** Card sizes for the world view. */
  get dims() {
    const p = this.orient === 'portrait';
    return {
      rw: p ? 150 : this.compact ? 170 : 184,
      rh: p ? 70 : 80,
      cw: p ? 140 : 150,
      ch: p ? 36 : 40,
    };
  }

  protected layout() {
    const { w, h } = this;
    const D = this.dims;
    if (this.orient === 'landscape') {
      const va = { x: w * 0.19, y: h * 0.47 };
      const fra = { x: w * 0.55, y: h * 0.29 };
      const sg = { x: w * 0.79, y: h * 0.57 };
      this.place('va', va.x, va.y, D.rw, D.rh);
      this.place('fra', fra.x, fra.y, D.rw, D.rh);
      this.place('sg', sg.x, sg.y, D.rw, D.rh);
      this.place('alice', va.x, va.y + 112, D.cw, D.ch);
      this.place('bob', fra.x, fra.y - 106, D.cw, D.ch);
      this.place('carol', sg.x, sg.y + 112, D.cw, D.ch);
    } else {
      // Portrait: Alice and Virginia on top, the partition across the middle,
      // Frankfurt and Singapore below, and room at the bottom for a docked readout.
      const top = 152;
      const low = Math.min(h - 270, 306);
      this.place('va', w / 2, top, D.rw, D.rh);
      this.place('fra', w * 0.25, low, Math.min(D.rw, w * 0.5 - 20), D.rh);
      this.place('sg', w * 0.75, low, Math.min(D.rw, w * 0.5 - 20), D.rh);
      this.place('alice', w / 2, 88, D.cw, D.ch);
      this.place('bob', w * 0.25, low + 84, Math.min(D.cw, w * 0.5 - 24), D.ch);
      this.place('carol', w * 0.75, low + 84, Math.min(D.cw, w * 0.5 - 24), D.ch);
    }
    this.quorum.layout();
  }

  protected wires(): WireSpec[] {
    const v = this.cfg.view;
    if (v === 'quorum') return this.quorum.wires();
    if (v !== 'world' && v !== 'feed') return [];
    const out: WireSpec[] = [];
    const pairs: [NodeId, NodeId][] = [
      ['va', 'fra'],
      ['va', 'sg'],
      ['fra', 'sg'],
    ];
    for (const [a, b] of pairs) out.push({ from: a, to: b, state: this.crosses(a, b) ? 'down' : 'normal' });
    for (const c of ['alice', 'bob', 'carol'] as ClientId[]) out.push({ from: c, to: PEOPLE[c].home, state: 'dim' });
    return out;
  }

  /* ---------------- curves ---------------- */

  /** Ports and bends for each replica link, so arcs never cross cards or labels. */
  private linkCurve(a: NodeId, b: NodeId): Curve | null {
    const A = this.boxes.get(a);
    const B = this.boxes.get(b);
    if (!A || !B || Number.isNaN(A.x) || Number.isNaN(B.x)) return null;
    const land = this.orient === 'landscape';
    const k = pairKey(a, b);
    const va = a === 'va' ? A : B;
    const other = a === 'va' ? B : A;
    if (k === pairKey('va', 'fra')) {
      const p0 = land ? { x: va.x + va.w / 2 - 36, y: va.y - va.h / 2 } : { x: va.x - va.w / 2, y: va.y + 12 };
      const p3 = land ? { x: other.x - other.w / 2, y: other.y + 8 } : { x: other.x - 18, y: other.y - other.h / 2 };
      const c: Curve = land
        ? { p0, p1: { x: p0.x, y: p0.y - 70 }, p2: { x: p3.x - 90, y: p3.y }, p3 }
        : { p0, p1: { x: p0.x - 48, y: p0.y + 50 }, p2: { x: p3.x, y: p3.y - 21 }, p3 };
      return a === 'va' ? c : rev(c);
    }
    if (k === pairKey('va', 'sg')) {
      const p0 = land ? { x: va.x + va.w / 2, y: va.y + 16 } : { x: va.x + va.w / 2, y: va.y + 12 };
      const p3 = land ? { x: other.x - other.w / 2, y: other.y + 4 } : { x: other.x + 18, y: other.y - other.h / 2 };
      const c: Curve = land
        ? { p0, p1: { x: p0.x + 150, y: p0.y + 70 }, p2: { x: p3.x - 150, y: p3.y + 50 }, p3 }
        : { p0, p1: { x: p0.x + 48, y: p0.y + 50 }, p2: { x: p3.x, y: p3.y - 21 }, p3 };
      return a === 'va' ? c : rev(c);
    }
    // Frankfurt ↔ Singapore
    const fra = a === 'fra' ? A : B;
    const sg = a === 'fra' ? B : A;
    const p0 = land ? { x: fra.x + fra.w / 2 - 30, y: fra.y + fra.h / 2 } : { x: fra.x + fra.w / 2 - 22, y: fra.y - fra.h / 2 };
    const p3 = land ? { x: sg.x - 24, y: sg.y - sg.h / 2 } : { x: sg.x - sg.w / 2 + 22, y: sg.y - sg.h / 2 };
    const c: Curve = land
      ? { p0, p1: { x: p0.x, y: p0.y + 70 }, p2: { x: p3.x, y: p3.y - 70 }, p3 }
      : { p0, p1: { x: p0.x + 8, y: p0.y - 30 }, p2: { x: p3.x - 8, y: p3.y - 30 }, p3 };
    return a === 'fra' ? c : rev(c);
  }

  /** A point along a replica link (t = 0 at `a`). */
  linkPoint(a: NodeId, b: NodeId, t: number): Pt | null {
    const c = this.linkCurve(a, b);
    return c ? bezier(c, t) : null;
  }

  protected curveFor(from: string, to: string, lane: number): Curve | null {
    if (isNode(from) && isNode(to)) {
      const c = this.linkCurve(from, to);
      return c ? shift(c, lane) : null;
    }
    const q = this.quorum.curveFor(from, to, lane);
    if (q !== undefined) return q;
    return super.curveFor(from, to, lane);
  }

  /** Midpoint of a replica link (where the partition cuts it). */
  linkMid(a: NodeId, b: NodeId): Pt | null {
    const c = this.linkCurve(a, b);
    return c ? bezier(c, 0.5) : null;
  }

  /** The partition as a line through the two severed links, extended past both. */
  cutLine(): { a: Pt; b: Pt } | null {
    const m1 = this.linkMid('va', 'fra');
    const m2 = this.linkMid('va', 'sg');
    if (!m1 || !m2) return null;
    if (this.orient === 'portrait') {
      const y = (m1.y + m2.y) / 2;
      return { a: { x: 16, y }, b: { x: this.w - 16, y } };
    }
    const dx = m2.x - m1.x;
    const dy = m2.y - m1.y;
    const len = Math.hypot(dx, dy) || 1;
    const ext = 78;
    return {
      a: { x: m1.x - (dx / len) * ext, y: m1.y - (dy / len) * ext },
      b: { x: m2.x + (dx / len) * (ext + 20), y: m2.y + (dy / len) * (ext + 20) },
    };
  }

  /* ---------------- connectivity ---------------- */

  /** Does a message between these replicas have to cross the partition? */
  crosses(a: NodeId, b: NodeId) {
    return this.cut && (a === 'va') !== (b === 'va');
  }

  canReach(a: NodeId, b: NodeId) {
    return !this.crosses(a, b);
  }

  /** How many replicas (including itself) this one can talk to right now. */
  reach(x: NodeId) {
    return NODES.filter((n) => this.canReach(x, n)).length;
  }

  peers(x: NodeId) {
    return NODES.filter((n) => n !== x);
  }

  /** Wall clock (ms after 10:00:00.000) and a replica's own clock, which may be skewed. */
  wall() {
    return (this.t - this.t0) * MS_PER_S;
  }

  clock(x: NodeId) {
    return this.wall() + (x === 'va' ? this.cfg.skew : 0);
  }

  nextWriteId() {
    return this.writeSeq++;
  }

  /* ---------------- messages between replicas ---------------- */

  /** Send between replicas; anything crossing the partition is lost where the line cuts it. */
  link(o: { from: NodeId; to: NodeId; color?: string; r?: number; label?: string; lane?: number; shape?: 'dot' | 'envelope' | 'square'; tag?: string; dur?: number; onArrive?: (f: Flight) => void; onLost?: (f: Flight) => void }) {
    return this.send({
      from: o.from,
      to: o.to,
      dur: o.dur ?? oneWay(o.from, o.to),
      color: o.color ?? SIG.req,
      r: o.r,
      label: o.label,
      lane: o.lane ?? 5,
      shape: o.shape,
      tag: o.tag,
      lostAt: this.crosses(o.from, o.to) ? 0.5 : null,
      onArrive: o.onArrive,
      onLost: o.onLost,
    });
  }

  cutNetwork() {
    if (this.cut) return;
    this.cut = true;
    this.cutVt = this.vt;
    // Messages already past the cut keep going; the rest are lost at the line.
    for (const f of this.flights) {
      if (isNode(f.from) && isNode(f.to) && this.crosses(f.from, f.to) && this.progressOf(f) < 0.5) f.lostAt = 0.5;
    }
    const c = this.cutLine();
    if (c) this.fx({ kind: 'ring', at: { x: (c.a.x + c.b.x) / 2, y: (c.a.y + c.b.y) / 2 }, color: SIG.err, size: 1.6 });
    this.raft.onCut();
    this.rev++;
  }

  healNetwork() {
    if (!this.cut) return;
    this.cut = false;
    for (const f of this.flights) {
      if (f.lostAt != null && this.progressOf(f) < f.lostAt) f.lostAt = null;
    }
    for (const r of NODES) {
      this.replicas[r].refusing = false;
      this.replicas[r].note = null;
    }
    this.flushHints();
    if (!this.cfg.hints && this.cfg.view === 'world' && this.cfg.auto !== 'raft') this.catchUp();
    this.raft.onHeal();
    this.rev++;
  }

  toggleCut() {
    if (this.cut) this.healNetwork();
    else this.cutNetwork();
  }

  /* ---------------- scenario sequencer ---------------- */

  private nextOp(gen: number) {
    if (gen !== this.opGen) return;
    if (this.opIdx >= this.ops.length) {
      if (this.opLoop) this.after(2.8, () => gen === this.opGen && this.restartOps());
      return;
    }
    const op = this.ops[this.opIdx++];
    const next = (d: number) => this.after(d, () => this.nextOp(gen));
    if (op.kind === 'wait') next(op.wait ?? 1);
    else if (op.kind === 'cut') {
      this.cutNetwork();
      next(op.wait ?? 1.2);
    } else if (op.kind === 'heal') {
      this.healNetwork();
      next(op.wait ?? 2.4);
    } else if (op.kind === 'set') {
      this.update(op.patch ?? {});
      next(op.wait ?? 0.2);
    } else if (op.kind === 'reset') {
      this.freshRound();
      next(op.wait ?? 0.8);
    } else if (op.kind === 'lww') this.askLww(() => next(op.wait ?? 4.5));
    else if (op.kind === 'dilemma') this.request(op.c ?? 'alice', 'read', { hold: true, done: () => next(op.wait ?? 1.2) });
    else this.request(op.c ?? 'alice', op.kind, { ask: op.ask, as: op.as, done: () => next(op.wait ?? 1.1) });
  }

  /* ---------------- client requests ---------------- */

  /** A person sends a booking or a read to their nearby replica. */
  request(c: ClientId, kind: 'book' | 'read', o: { ask?: AskSpec; as?: 'cp' | 'ap'; hold?: boolean; done?: () => void; onAck?: () => void } = {}) {
    const x = PEOPLE[c].home;
    this.clients[c].busy = true;
    this.send({ from: c, to: x, dur: HOP, color: SIG.req, shape: 'envelope', label: kind, onArrive: () => this.atReplica(c, x, kind, o) });
    this.rev++;
  }

  private atReplica(c: ClientId, x: NodeId, kind: 'book' | 'read', o: { ask?: AskSpec; as?: 'cp' | 'ap'; hold?: boolean; done?: () => void; onAck?: () => void }) {
    if (o.hold) {
      this.dilemmaSeen = true;
      this.dilemma = { c, x, done: o.done };
      if (this.queuedChoice) {
        const choice = this.queuedChoice;
        this.queuedChoice = null;
        this.after(0.4, () => this.decideDilemma(choice));
      }
      this.rev++;
      return;
    }
    const go = () => (kind === 'book' ? this.write(c, x, o.as, o.done, o.onAck) : this.read(c, x, o.as, o.done));
    const g = this.game;
    const ask = o.ask;
    if (ask && g && !g.done) {
      const ok = g.ask({
        acceptable: [this.predictOutcome(x, kind, o.as)],
        choices: ask.choices ?? (kind === 'book' ? WRITE_CHOICES : READ_CHOICES),
        ask: ask.ask,
        askAt: { id: x },
        explain: () => ask.why,
        resolve: go,
      });
      if (ok) return;
    }
    go();
  }

  /** The dilemma step: the learner decides how the cut-off replica answers. */
  decideDilemma(choice: 'answer' | 'refuse') {
    const d = this.dilemma;
    if (!d) {
      // Too early: remember the choice until Alice's read reaches Virginia.
      if (!this.dilemmaSeen && this.ops.some((o) => o.kind === 'dilemma')) this.queuedChoice = choice;
      else if (!this.clients.alice.busy) this.request('alice', 'read', { as: choice === 'answer' ? 'ap' : 'cp' });
      return;
    }
    this.dilemma = null;
    this.read(d.c, d.x, choice === 'answer' ? 'ap' : 'cp', d.done);
  }

  wNeed(as?: 'cp' | 'ap') {
    return as === 'cp' ? 2 : as === 'ap' ? 1 : this.cfg.wq;
  }

  rNeed(as?: 'cp' | 'ap') {
    if (as) return as === 'cp' ? 2 : 1;
    return this.cfg.readLocal ? 1 : this.cfg.rq;
  }

  /** What will happen, computed from the rules (used to grade predictions). */
  predictOutcome(x: NodeId, kind: 'book' | 'read', as?: 'cp' | 'ap') {
    if (kind === 'book') {
      if (this.reach(x) < this.wNeed(as)) return 'err';
      return this.replicas[x].val.seats > 0 ? 'ok' : 'soldout';
    }
    const need = this.rNeed(as);
    if (this.reach(x) < need) return 'err';
    return this.isStale(this.readValue(x, need)) ? 'stale' : 'new';
  }

  /** The value a read would return: newest among this replica and its nearest reachable peers. */
  readValue(x: NodeId, need: number): Val {
    const near = this.peers(x)
      .filter((p) => this.canReach(x, p))
      .sort((a, b) => oneWay(x, a) - oneWay(x, b))
      .slice(0, need - 1);
    return [x, ...near].map((n) => this.replicas[n].val).reduce((m, v) => (v.ver > m.ver ? v : m));
  }

  /** Stale = misses the latest write that some client was told succeeded. */
  isStale(v: Val) {
    const L = this.latest;
    return !!L && (v.ver < L.ver || (v.ver === L.ver && v.id !== L.id));
  }

  makeVal(x: NodeId, c: ClientId): Val {
    const R = this.replicas[x];
    const all = R.siblings.length ? R.siblings : [R.val];
    const base = all.reduce((m, v) => (v.seats < m.seats ? v : m));
    const vv = { ...base.vv };
    for (const s of all) for (const n of NODES) vv[n] = Math.max(vv[n], s.vv[n]);
    vv[x] += 1;
    const ver = Math.max(...all.map((s) => s.ver)) + 1;
    return { id: this.nextWriteId(), seats: base.seats - 1, ver, by: PEOPLE[c].name, at: x, ts: this.clock(x), real: this.wall(), vv };
  }

  private write(c: ClientId, x: NodeId, as: 'cp' | 'ap' | undefined, done?: () => void, onAck?: () => void) {
    const R = this.replicas[x];
    const need = this.wNeed(as);
    const t0 = this.t;
    const tag = as === 'cp' ? 'C: ' : as === 'ap' ? 'A: ' : '';
    if (R.val.seats <= 0 && !R.siblings.length) {
      this.decide(x, 'book', need, 'sold out', 'info');
      this.reply(c, x, 'info', 'sold out · 0 left', `${tag}sold out`, done);
      return;
    }
    if (this.cfg.failFast && this.reach(x) < need) {
      this.decide(x, 'book', need, 'Unavailable', 'err');
      this.flags.refused = true;
      this.note(x, `only ${this.reach(x)} of ${need} reachable`, 'err');
      this.reply(c, x, 'err', '✕ Unavailable', 'Unavailable', done);
      return;
    }
    const val = this.makeVal(x, c);
    if (need <= 1) {
      this.merge(x, val, true);
      this.acked(val);
      this.stats.lastWriteMs = 2;
      this.decide(x, 'book', need, 'accepted locally', 'ok');
      onAck?.();
      this.reply(c, x, 'ok', booked(val.seats), `${tag}✓ ok`, done);
      this.replicate(x, val);
      return;
    }
    // Quorum write: offer it to every peer, commit once `need` replicas hold it.
    R.pending = val;
    const op = { acks: 1, done: false };
    this.rev++;
    for (const p of this.peers(x)) {
      this.link({
        from: x,
        to: p,
        label: `v${val.ver}`,
        onArrive: () => {
          this.merge(p, val, false);
          this.link({
            from: p,
            to: x,
            color: SIG.res,
            r: 3.4,
            label: 'ack',
            onArrive: () => {
              op.acks++;
              if (op.done || op.acks < need) return;
              op.done = true;
              R.pending = null;
              this.merge(x, val, true);
              this.acked(val);
              this.stats.lastWriteMs = (this.t - t0) * MS_PER_S + 2;
              this.decide(x, 'book', need, `committed on ${need} of 3`, 'ok');
              onAck?.();
              this.reply(c, x, 'ok', booked(val.seats), `${tag}✓ ok`, done);
            },
          });
        },
        onLost: () => {
          if (this.cfg.hints) {
            R.hints.push({ to: p, val });
            this.rev++;
          }
        },
      });
    }
    this.after(TIMEOUT, () => {
      if (op.done) return;
      op.done = true;
      R.pending = null;
      R.refusing = true;
      this.flags.refused = true;
      this.decide(x, 'book', need, 'no majority: refused', 'err');
      this.note(x, 'no majority · write refused', 'err');
      this.reply(c, x, 'err', '✕ 503 no majority', `${tag}503`, done);
    });
  }

  private read(c: ClientId, x: NodeId, as: 'cp' | 'ap' | undefined, done?: () => void) {
    const R = this.replicas[x];
    const need = this.rNeed(as);
    const t0 = this.t;
    const tag = as === 'cp' ? 'C: ' : as === 'ap' ? 'A: ' : '';
    const answer = (v: Val) => {
      if (R.siblings.length && need <= 1) {
        this.reply(c, x, 'stale', `⚠ ${R.siblings.length} versions`, `${tag}siblings`, done);
        return;
      }
      const stale = this.isStale(v);
      this.reply(c, x, stale ? 'stale' : 'ok', stale ? `${v.seats} left · stale!` : `✓ ${v.seats} left`, `${tag}${v.seats} left`, done);
    };
    if (need <= 1) {
      this.stats.lastReadMs = 2;
      this.decide(x, 'read', need, 'answered from its own copy', this.isStale(R.val) ? 'stale' : 'ok');
      answer(R.val);
      return;
    }
    if (this.cfg.failFast && this.reach(x) < need) {
      this.decide(x, 'read', need, 'Unavailable', 'err');
      this.flags.refused = true;
      this.reply(c, x, 'err', '✕ Unavailable', 'Unavailable', done);
      return;
    }
    const op = { got: [R.val], done: false };
    for (const p of this.peers(x)) {
      this.link({
        from: x,
        to: p,
        color: SIG.hc,
        r: 3.2,
        label: 'v?',
        onArrive: () => {
          const pv = this.replicas[p].val;
          this.link({
            from: p,
            to: x,
            color: SIG.res,
            r: 3.2,
            label: `v${pv.ver}`,
            onArrive: () => {
              if (op.done) return;
              op.got.push(pv);
              if (op.got.length < need) return;
              op.done = true;
              const best = op.got.reduce((m, v) => (v.ver > m.ver ? v : m));
              if (best.id !== R.val.id && best.ver > R.val.ver) this.merge(x, best, false);
              this.stats.lastReadMs = (this.t - t0) * MS_PER_S + 2;
              this.decide(x, 'read', need, `checked ${need} of 3`, this.isStale(best) ? 'stale' : 'ok');
              answer(best);
            },
          });
        },
      });
    }
    this.after(TIMEOUT, () => {
      if (op.done) return;
      op.done = true;
      R.refusing = true;
      this.flags.refused = true;
      this.decide(x, 'read', need, 'no majority: refused', 'err');
      this.note(x, 'no majority · read refused', 'err');
      this.reply(c, x, 'err', '✕ 503 no majority', `${tag}503`, done);
    });
  }

  reply(c: ClientId, x: NodeId, tone: Tone, text: string, label: string, done?: () => void) {
    this.send({
      from: x,
      to: c,
      dur: HOP,
      color: toneColor(tone),
      shape: 'envelope',
      label,
      onArrive: () => {
        const cl = this.clients[c];
        cl.result = { text, tone };
        cl.busy = false;
        cl.pulseVt = this.vt;
        cl.pulseTone = tone;
        if (tone === 'stale') this.stats.stale++;
        else if (tone === 'err') this.stats.errors++;
        else if (tone === 'ok') this.stats.ok++;
        this.rev++;
        done?.();
      },
    });
  }

  private decide(node: NodeId, kind: 'book' | 'read', need: number, outcome: string, tone: Tone) {
    this.decision = { node, kind, need, reach: this.reach(node), outcome, tone, vt: this.vt };
    this.rev++;
  }

  /** A client was told the write succeeded. */
  acked(v: Val) {
    this.latest = v;
    if (v.seats === 0 && v.by) {
      this.lastSeat.push(v.by);
      if (new Set(this.lastSeat).size >= 2) this.flags.oversold = true;
    }
    this.rev++;
  }

  /** Fire-and-forget copies to every peer (asynchronous replication). */
  private replicate(x: NodeId, val: Val) {
    for (const p of this.peers(x)) {
      this.link({
        from: x,
        to: p,
        label: `v${val.ver}`,
        onArrive: () => this.merge(p, val, false),
        onLost: () => {
          if (this.cfg.hints) {
            this.replicas[x].hints.push({ to: p, val });
            this.rev++;
          }
        },
      });
    }
  }

  /* ---------------- merging versions ---------------- */

  private dropSeen = new Set<number>();

  private recordDrop(node: NodeId, loser: Val, winner: Val) {
    this.dropped = { loser, winner, node, vt: this.vt };
    this.flags.dropped = true;
    if (winner.real < loser.real) this.flags.skewWin = true;
    if (!this.dropSeen.has(loser.id)) {
      this.dropSeen.add(loser.id);
      this.stats.dropped++;
      this.say(node, `✕ ${loser.by}'s write dropped`, SIG.err, 2.4);
    }
  }

  /** Put a version into a replica using the merge rule. Returns true if it took effect. */
  merge(p: NodeId, val: Val, local: boolean): boolean {
    const R = this.replicas[p];
    const cur = R.val;
    if (cur.id === val.id || R.siblings.some((s) => s.id === val.id)) return false;
    const flash = (tone: Tone) => {
      R.flashVt = this.vt;
      R.flashTone = tone;
      this.rev++;
    };
    if (this.cfg.merge === 'vv') {
      const mine = R.siblings.length ? R.siblings : [cur];
      if (mine.some((s) => vvCompare(s.vv, val.vv) !== 'concurrent' && vvCompare(s.vv, val.vv) !== 'b')) return false;
      const keep = mine.filter((s) => vvCompare(val.vv, s.vv) !== 'a');
      if (!keep.length) {
        R.val = val;
        R.siblings = [];
        flash('ok');
        return true;
      }
      R.siblings = [...keep, val];
      R.val = val;
      this.flags.siblings = true;
      this.say(p, '⚠ concurrent: kept both', SIG.warn, 2.2);
      flash('stale');
      return true;
    }
    // Last write wins: the higher timestamp stays, whatever the history says.
    const newer = val.ts > cur.ts || (val.ts === cur.ts && (val.at ?? '') > (cur.at ?? ''));
    const order = vvCompare(val.vv, cur.vv);
    if (newer) {
      if (order === 'concurrent' && cur.by) this.recordDrop(p, cur, val);
      R.val = val;
      R.siblings = [];
      flash('ok');
      return true;
    }
    if (order === 'concurrent' || (local && order === 'a')) this.recordDrop(p, val, cur);
    return false;
  }

  /** Take a value as-is (a Raft follower copying its leader's log). */
  adopt(p: NodeId, val: Val) {
    const R = this.replicas[p];
    if (R.val.id === val.id) return;
    R.val = val;
    R.siblings = [];
    R.flashVt = this.vt;
    R.flashTone = 'ok';
    this.rev++;
  }

  /* ---------------- after the partition ---------------- */

  private flushHints() {
    let k = 0;
    for (const x of NODES) {
      const R = this.replicas[x];
      const hints = R.hints;
      R.hints = [];
      for (const h of hints) {
        this.after(0.35 + k++ * 0.35, () =>
          this.link({ from: x, to: h.to, label: `v${h.val.ver}`, onArrive: () => this.merge(h.to, h.val, false) }),
        );
      }
    }
  }

  /** A replica that missed writes during the partition copies the newest value from a peer. */
  private catchUp() {
    const best = NODES.map((n) => this.replicas[n].val).reduce((m, v) => (v.ver > m.ver ? v : m));
    NODES.forEach((n, i) => {
      if (this.replicas[n].val.ver >= best.ver) return;
      const src = NODES.find((s) => this.replicas[s].val.id === best.id);
      if (!src) return;
      this.after(0.3 + i * 0.2, () => this.link({ from: src, to: n, label: `v${best.ver}`, onArrive: () => this.merge(n, best, false) }));
    });
  }

  /* ---------------- status shown under each replica ---------------- */

  note(x: NodeId, text: string, tone: Tone, dur = 3) {
    this.replicas[x].note = { text, tone, until: this.t + dur };
    this.rev++;
  }

  statusFor(x: NodeId): Status | null {
    const R = this.replicas[x];
    if (this.cfg.auto === 'raft') return this.raft.statusFor(x);
    if (R.pending) return { text: `v${R.pending.ver} waiting for acks…`, tone: 'info' };
    if (this.dilemma?.x === x) return { text: 'answer, or refuse?', tone: 'info' };
    if (R.note && this.t < R.note.until) return R.note;
    if (R.siblings.length) return { text: `⚠ ${R.siblings.length} versions kept`, tone: 'stale' };
    if (R.hints.length) return { text: `holding ${R.hints.length} update${R.hints.length > 1 ? 's' : ''} for later`, tone: 'stale' };
    if (this.cut && R.refusing && this.reach(x) < 2) return { text: '✕ no majority: refusing', tone: 'err' };
    if (this.cfg.heartbeats && this.cut) {
      const silent = this.peers(x).filter((p) => this.crosses(x, p));
      const since = Math.min(...silent.map((p) => R.heard[p] ?? this.t));
      if (silent.length && this.t - since > 2.2) return { text: `no word from ${silent.map((p) => REGION[p].short).join(', ')}`, tone: 'stale' };
    }
    return null;
  }

  /** Do all replicas hold the same single version? */
  get agree() {
    const ids = new Set(NODES.map((n) => this.replicas[n].val.id));
    return ids.size === 1 && NODES.every((n) => !this.replicas[n].siblings.length);
  }

  /* ---------------- per-frame logic ---------------- */

  protected step(dt: number) {
    const v = this.cfg.view;
    if (v === 'quorum') return this.quorum.step(dt);
    if (v === 'feed') return this.feed.step(dt);
    if (v !== 'world') return;
    if (this.cfg.auto === 'raft') return this.raft.step(dt);
    if (this.cfg.heartbeats) {
      this.hbIn -= dt;
      if (this.hbIn <= 0) {
        this.hbIn += 1.7;
        for (const a of NODES) {
          for (const b of this.peers(a)) {
            this.link({ from: a, to: b, color: SIG.hc, r: 2.5, lane: -6, tag: 'hb', onArrive: () => (this.replicas[b].heard[a] = this.t) });
          }
        }
      }
    }
    if (this.cfg.auto === 'tunable' || this.cfg.auto === 'pacelc') {
      this.autoIn -= dt;
      if (this.autoIn <= 0 && !this.clients.carol.busy) {
        this.autoIn = 3.4;
        this.autoN++;
        const pacelc = this.cfg.auto === 'pacelc';
        this.request('carol', 'book', {
          onAck: pacelc ? () => this.after(0.05, () => !this.clients.bob.busy && this.request('bob', 'read')) : undefined,
        });
      }
    }
  }

  /* ---------------- controls used by the panel ---------------- */

  update(patch: Partial<CapConfig>) {
    this.cfg = { ...this.cfg, ...patch };
    if (patch.cut !== undefined && patch.cut !== this.cut) this.toggleCut();
    if (patch.n !== undefined || patch.r !== undefined || patch.w !== undefined) this.quorum.configure();
    if (patch.causal !== undefined) this.feed.restart();
    if (this.cfg.view === 'quorum') this.syncBoxes();
    this.rev++;
  }

  /** Playground reset: a fresh flight with one seat left. */
  newFlight() {
    this.clearTransient();
    this.t0 = this.t;
    this.resetValues();
    this.resetClients();
    this.opGen++;
    this.rev++;
  }

  setMode(m: 'cp' | 'ap') {
    this.update({ wq: m === 'cp' ? 2 : 1, rq: m === 'cp' ? 2 : 1, hints: m === 'ap', sides: m === 'cp' });
  }

  /** Start a new round inside a scenario: same step, fresh values, clock back near 10:00:00. */
  private freshRound() {
    this.clearTransient();
    this.t0 = this.t;
    this.resetValues();
    this.resetClients();
    if (this.cut) this.cutVt = this.vt;
    this.rev++;
  }

  /** Both sides booked during the partition. Ask who survives, then heal. */
  private askLww(done: () => void) {
    const heal = () => {
      this.healNetwork();
      done();
    };
    const g = this.game;
    const a = this.replicas.va.val;
    const b = this.replicas.fra.val;
    if (g && !g.done && a.by && b.by && a.id !== b.id) {
      const win = a.ts > b.ts || (a.ts === b.ts && a.at === 'va') ? a : b;
      const lose = win === a ? b : a;
      const skew = this.cfg.skew;
      const gap = Math.round(Math.abs(b.real - a.real));
      const asked = g.ask({
        acceptable: [win.by ?? ''],
        choices: [
          { id: a.by, label: `${a.by}’s booking` },
          { id: b.by, label: `${b.by}’s booking` },
        ],
        ask: skew ? `Virginia's clock is ${skew} ms fast. After the heal, whose booking survives?` : 'The network heals. Whose booking survives?',
        askAt: { id: 'fra' },
        explain: () =>
          win.real >= lose.real
            ? `${win.by} booked ${gap} ms later, so ${win.by}'s timestamp is higher and every replica keeps it. ${lose.by} was told “booked”, yet that write is simply gone: no error, no log line.`
            : `${lose.by} really booked ${gap} ms later, but Virginia's clock is ${skew} ms fast, so ${win.by}'s timestamp comes out higher. Last-write-wins keeps the earlier booking and silently drops the later one.`,
        resolve: heal,
      });
      if (asked) {
        this.rev++;
        return;
      }
    }
    heal();
  }

  /** Alice books, and Carol reads the moment Alice hears back: a race against replication. */
  race() {
    if (this.clients.alice.busy || this.clients.carol.busy) return;
    this.request('alice', 'book', { done: () => this.request('carol', 'read') });
  }

  userRequest(c: ClientId, kind: 'book' | 'read') {
    if (this.clients[c].busy) return;
    this.request(c, kind);
  }
}

/* ------------------------------------------------------------------ */

/** Short confirmation text for a person's card. */
export const booked = (n: number) => (n < 10 ? `✓ booked · ${n} left` : '✓ booked');

export const isNode = (id: string): id is NodeId => id === 'va' || id === 'fra' || id === 'sg';
