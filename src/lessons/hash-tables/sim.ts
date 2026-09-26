import { SIG } from '@/lib/sim/colors';
import { curveBetween, lerp, type Curve } from '@/lib/sim/geometry';
import { PredictGame, type Question } from '@/lib/sim/predict';
import { Sim, type Flight } from '@/lib/sim/Sim';
import { ATTACK_KEYS, DEFAULT_SEED, fmt, javaHashCode, phoneOf, polyHash, polySteps, type HashKind, type PolyStep } from './hashing';
import { PyDict, type PyProbe } from './pydict';
import { TOMB, Table, type Mode } from './table';

/* ------------------------------------------------------------------ */
/* Config                                                              */
/* ------------------------------------------------------------------ */

export type View = 'table' | 'list' | 'race' | 'chart' | 'pydict';
export type MachineMode = 'full' | 'strip' | 'off';
export type Op = 'put' | 'get' | 'del' | 'hash' | 'rehash' | 'scan' | 'jump';

export interface HashCfg {
  view: View;
  mode: Mode;
  hash: HashKind;
  cap: number;
  /** Resize when items / capacity goes above this (Infinity: never) */
  maxLoad: number;
  /** Keys inserted instantly when the step starts */
  preset: string[];
  machine: MachineMode;
  /** The plain list (list and race views), or the fill order (load-factor step) */
  list: string[];
  /** Buckets with more than 8 keys become balanced trees (Java's defense) */
  tree: boolean;
  seed: number;
  /** Chain nodes of room reserved under each rack row */
  reserve: number;
  /** Seconds per character while the machine hashes */
  pace: number;
  /** Never grow past this many buckets (the stage is only so big) */
  maxCap: number;
  /** Draw the cost-of-a-miss curves under the table (load-factor step) */
  curve: boolean;
}

export const DEFAULTS: HashCfg = {
  view: 'table',
  mode: 'chain',
  hash: 'poly',
  cap: 10,
  maxLoad: Infinity,
  preset: [],
  machine: 'full',
  list: [],
  tree: false,
  seed: DEFAULT_SEED,
  reserve: 3,
  pace: 0.34,
  maxCap: 20,
  curve: false,
};

/** Java turns a bucket into a tree once it holds more than this many entries. */
export const TREEIFY = 8;

/* ------------------------------------------------------------------ */
/* View state                                                          */
/* ------------------------------------------------------------------ */

export interface MachineState {
  key: string;
  op: Op;
  kind: HashKind | 'py';
  steps: PolyStep[];
  /** Characters consumed so far */
  shown: number;
  hash: number | null;
  /** Java: hashCode() before spreading */
  raw: number | null;
  cap: number;
  index: number | null;
  /** Show "= ?" while the learner predicts */
  ask: boolean;
  /** Rehash: the hash is reused, only the index is recomputed */
  stored: boolean;
  /** Rehash: the bucket it came from */
  from: number | null;
  /** Python: the latest probe step */
  probe: PyProbe | null;
  vt: number;
}

export type MarkKind = 'cmp' | 'hit' | 'skip' | 'fresh' | 'home' | 'taken' | 'tomb' | 'empty' | 'moved' | 'stay' | 'lift' | 'clash';

export interface Mark {
  kind: MarkKind;
  vt: number;
}

export interface LastOp {
  op: Op;
  key: string;
  cmp: number;
  result: 'found' | 'missing' | 'placed' | 'updated' | 'deleted' | 'full' | 'collision';
  index?: number;
  hash?: number;
  value?: string;
}

export interface RaceSide {
  cmp: number;
  done: boolean;
  found: boolean;
  t: number;
}

export interface RaceState {
  key: string;
  list: RaceSide;
  table: RaceSide;
  winner: 'list' | 'table' | 'tie' | null;
}

export interface Bar {
  n: number;
  work: number;
  resize: boolean;
  cap: number;
}

export interface ChartState {
  bars: Bar[];
  count: number;
  cap: number;
  total: number;
  target: number;
}

export interface RackGeo {
  id: string;
  cap: number;
  kind: 'table' | 'list' | 'py';
  mode: Mode;
  perRow: number;
  rows: number;
  pitch: number;
  slotW: number;
  slotH: number;
  nodeH: number;
  nodeGap: number;
  x0: number;
  rowY: number[];
  anchorGap: number;
  caption?: string;
}

export interface Geo {
  racks: RackGeo[];
  machine: { x: number; y: number; w: number; h: number; mode: 'full' | 'strip' } | null;
  op: { x: number; y: number; w: number; h: number } | null;
  chart: { x: number; y: number; w: number; h: number } | null;
  entries: { x: number; y: number; w: number; rowH: number; rows: number } | null;
  curve: { x: number; y: number; w: number; h: number } | null;
  /** y just under the lowest content (readouts go here) */
  below: number;
  top: number;
  bottom: number;
  padX: number;
}

/* ------------------------------------------------------------------ */
/* Ids                                                                 */
/* ------------------------------------------------------------------ */

export const slotId = (rack: string, i: number) => `${rack}:${i}`;
export const anchorId = (rack: string, i: number) => `${rack}^${i}`;
export const keyId = (k: string) => `k:${k}`;
export const rackOf = (t: Table) => `t${t.gen}`;
export const entryId = (n: number) => `E:${n}`;

export function slotCenter(r: RackGeo, i: number) {
  return { x: r.x0 + (i % r.perRow) * r.pitch, y: r.rowY[Math.floor(i / r.perRow)] ?? 0 };
}

export function nodeY(r: RackGeo, slotY: number, depth: number) {
  return slotY + r.slotH / 2 + 10 + r.nodeH / 2 + depth * r.nodeGap;
}

/* ------------------------------------------------------------------ */
/* The simulation                                                      */
/* ------------------------------------------------------------------ */

type Wait = number | (() => boolean);
type Job = Generator<Wait, void, unknown>;
interface Runner {
  gen: Job;
  wait: Wait;
}

export interface PutOpts {
  quick?: boolean;
  /** Freeze before revealing the bucket and ask the learner */
  predict?: 'bucket' | 'probe';
  /** Ask stay-or-move during the resize this insert may trigger */
  predictRehash?: boolean;
  /** Stop and hover over the bucket if it is already taken (the collision cliffhanger) */
  hover?: boolean;
}

const COLOR: Record<'put' | 'get' | 'del', string> = { put: SIG.req, get: SIG.hc, del: SIG.pink };

export class HashSim extends Sim {
  cfg: HashCfg = { ...DEFAULTS };
  table: Table = new Table(10, 'chain', 'poly');
  /** The bigger table being filled during a resize */
  next: Table | null = null;
  list: string[] = [];
  py: PyDict | null = null;
  pyGen = 0;
  machine: MachineState | null = null;
  game: PredictGame | null = null;
  marks = new Map<string, Mark>();
  /** Key comparisons in the current (or last) operation */
  cmp = 0;
  last: LastOp | null = null;
  opCard: { op: Op; key: string } | null = null;
  race: RaceState | null = null;
  chart: ChartState | null = null;
  hashLog: { key: string; hash: number; again: boolean }[] = [];
  jumpInfo: { i: number } | null = null;
  resizing: { done: number; total: number } | null = null;
  /** Comparisons spent by every insert and lookup since the step started */
  totalCmp = 0;
  attacked = false;
  /** Playground bookkeeping */
  stats = { collided: false, resized: false, maxCmp: 0, maxRun: 0 };
  /** Entry just appended in the Python view */
  pyFresh: number | null = null;
  geo: Geo = { racks: [], machine: null, op: null, chart: null, entries: null, curve: null, below: 0, top: 0, bottom: 0, padX: 0 };

  private queue: (() => Job)[] = [];
  private main: Runner | null = null;
  private side: Runner[] = [];
  private run: ((s: HashSim) => void) | null = null;
  private loopGap: number | null = null;
  private loopAt: number | null = null;
  private dropTarget: { table: Table; bucket: number; depth: number } | null = null;

  constructor() {
    super();
    this.sync();
  }

  /* ================================================================ */
  /* Step lifecycle                                                   */
  /* ================================================================ */

  /** Called by the lesson when a step starts (or replays). */
  enter(cfg: HashCfg, run?: ((s: HashSim) => void) | null, o: { predict?: number; loop?: number } = {}) {
    this.clearTransient();
    this.cfg = { ...cfg, preset: [...cfg.preset], list: [...cfg.list] };
    this.run = run ?? null;
    this.loopGap = o.loop ?? null;
    this.game = o.predict ? new PredictGame(this, o.predict) : null;
    this.reset();
    this.run?.(this);
    this.rev++;
  }

  /** Change settings and replay the step's script from the start. */
  replayWith(patch: Partial<HashCfg>) {
    this.clearTransient();
    this.cfg = { ...this.cfg, ...patch };
    this.reset();
    this.run?.(this);
    this.rev++;
  }

  /** Back to the step's starting table, without running the script. */
  fresh(patch: Partial<HashCfg> = {}) {
    this.clearTransient();
    this.cfg = { ...this.cfg, ...patch };
    this.reset();
    this.rev++;
  }

  /**
   * Re-insert the current keys with new settings. Keys glide to their new homes.
   * If an operation (or a resize) is running, the rebuild happens the moment it
   * finishes, ahead of anything else queued, so no key is lost and the click still
   * feels immediate. Later queued operations then run on the rebuilt table.
   */
  rebuild(patch: Partial<HashCfg>) {
    this.cfg = { ...this.cfg, ...patch };
    if (this.busy) this.queue.unshift(() => this.callJob(() => this.rebuildNow()));
    else this.rebuildNow();
    this.rev++;
  }

  /** Keys in the table, counting both arrays while a resize is moving them. */
  get totalKeys() {
    return this.table.count + (this.next?.count ?? 0);
  }

  /** Runs only when nothing else is in flight, so it must not touch the queue: work queued after it still runs. */
  private rebuildNow() {
    this.flights = [];
    this.effects = [];
    const keys = [...this.table.order];
    const t = new Table(this.table.cap, this.cfg.mode, this.cfg.hash, this.cfg.seed, this.table.gen);
    for (const k of keys) t.put(k);
    this.table = t;
    this.next = null;
    this.resizing = null;
    this.machine = null;
    this.opCard = null;
    this.marks.clear();
    this.cmp = 0;
    this.last = null;
    this.stats.maxRun = Math.max(this.stats.maxRun, t.longestRun());
    this.sync();
    this.rev++;
  }

  private stopJobs() {
    this.queue = [];
    this.main = null;
    this.side = [];
    this.loopAt = null;
    this.dropTarget = null;
  }

  private reset() {
    this.stopJobs();
    this.marks.clear();
    this.cmp = 0;
    this.last = null;
    this.opCard = null;
    this.machine = null;
    this.race = null;
    this.chart = null;
    this.hashLog = [];
    this.jumpInfo = null;
    this.resizing = null;
    this.totalCmp = 0;
    this.attacked = false;
    this.next = null;
    this.pyFresh = null;
    this.stats = { collided: false, resized: false, maxCmp: 0, maxRun: 0 };
    this.table = new Table(this.cfg.cap, this.cfg.mode, this.cfg.hash, this.cfg.seed, 0);
    for (const k of this.cfg.preset) this.table.put(k);
    this.list = [...this.cfg.list];
    this.py = null;
    if (this.cfg.view === 'pydict') {
      this.pyGen = 0;
      this.py = new PyDict(this.cfg.cap);
      for (const k of this.cfg.preset) this.py.insert(k);
    }
    this.sync();
  }

  get busy() {
    return !!this.main || this.queue.length > 0 || this.side.length > 0;
  }

  /* ================================================================ */
  /* Public actions (panel buttons call these)                        */
  /* ================================================================ */

  put(key: string, o: PutOpts = {}) {
    this.queue.push(() => this.putJob(key, o));
  }

  get(key: string, o: { quick?: boolean } = {}) {
    this.queue.push(() => this.getJob(key, !!o.quick));
  }

  del(key: string, o: { tomb?: boolean; quick?: boolean } = {}) {
    this.queue.push(() => this.delJob(key, o.tomb ?? true, !!o.quick));
  }

  hashOnly(key: string) {
    this.queue.push(() => this.hashOnlyJob(key));
  }

  scan(key: string) {
    this.queue.push(() => this.scanJob(key));
  }

  jump(i: number) {
    this.queue.push(() => this.jumpJob(i));
  }

  raceFor(key: string) {
    this.queue.push(() => this.raceJob(key));
  }

  resize(o: { predict?: boolean } = {}) {
    this.queue.push(() => this.resizeJob(!!o.predict));
  }

  pause(s: number) {
    this.queue.push(() => this.pauseJob(s));
  }

  runChart(n: number) {
    this.queue.push(() => this.chartJob(n));
  }

  pyPut(key: string, quick = false) {
    this.queue.push(() => this.pyPutJob(key, quick));
  }

  /** Learner-driven operations (typed keys, playground). A fast pace means quick animations. */
  userPut(key: string) {
    if (!key) return;
    this.put(key, { quick: this.cfg.pace < 0.2 });
    this.rev++;
  }

  userGet(key: string) {
    if (!key) return;
    this.get(key, { quick: this.cfg.pace < 0.2 });
    this.rev++;
  }

  userDel(key: string) {
    if (!key) return;
    this.del(key, { tomb: true, quick: this.cfg.pace < 0.2 });
    this.rev++;
  }

  /** Tombstone demo: start from the preset, delete, then look up a key past the hole. */
  demoDelete(victim: string, then: string, tomb: boolean) {
    this.fresh();
    this.pause(0.3);
    this.del(victim, { tomb });
    this.pause(0.5);
    this.get(then);
  }

  /** Hash flooding: insert every attack key. */
  attack() {
    if (this.attacked) return;
    this.attacked = true;
    for (const k of ATTACK_KEYS) this.put(k, { quick: true });
    this.rev++;
  }

  /** Load-factor step: show the first n keys of the fill order. */
  setFill(n: number) {
    this.clearTransient();
    this.stopJobs();
    const t = new Table(this.table.cap, this.cfg.mode, this.cfg.hash, this.cfg.seed, this.table.gen);
    for (const k of this.cfg.list.slice(0, n)) t.put(k);
    this.cfg = { ...this.cfg, preset: this.cfg.list.slice(0, n) };
    this.table = t;
    this.machine = null;
    this.marks.clear();
    const newest = this.cfg.list[n - 1];
    if (newest) this.mark(keyId(newest), 'fresh');
    this.sync();
    this.rev++;
  }

  setMaxLoad(v: number) {
    this.cfg = { ...this.cfg, maxLoad: v };
    this.rev++;
  }

  /** Playground: switch strategy or hash and keep the keys. */
  setMode(mode: Mode) {
    this.rebuild({ mode });
  }

  setHash(hash: HashKind) {
    this.rebuild({ hash });
  }

  /** Playground: empty table, but finished challenges stay finished. */
  clearAll() {
    const stats = this.stats;
    this.clearTransient();
    this.cfg = { ...this.cfg, preset: [], cap: 10 };
    this.reset();
    this.stats = stats;
    this.rev++;
  }

  /** Stage click on a slot (answers a prediction). */
  pick(id: string) {
    if (this.game?.pending && !this.game.pending.choices) this.game.answer(id);
  }

  /* ================================================================ */
  /* Runner                                                           */
  /* ================================================================ */

  protected step(dt: number) {
    if (!this.main && this.queue.length) this.main = { gen: this.queue.shift()!(), wait: 0 };
    if (this.main && this.pump(this.main, dt)) this.main = null;
    if (this.side.length) this.side = this.side.filter((r) => !this.pump(r, dt));
    if (this.loopGap != null && this.run && !this.busy) {
      if (this.loopAt == null) this.loopAt = this.stepT + this.loopGap;
      else if (this.stepT >= this.loopAt) {
        this.loopAt = null;
        this.reset();
        this.run(this);
        this.rev++;
      }
    }
  }

  private pump(r: Runner, dt: number): boolean {
    if (typeof r.wait === 'number') {
      r.wait -= dt;
      if (r.wait > 1e-6) return false;
    } else if (!r.wait()) return false;
    for (let i = 0; i < 200; i++) {
      const res = r.gen.next();
      if (res.done) return true;
      r.wait = res.value;
      if (typeof r.wait === 'number') {
        if (r.wait > 1e-6) return false;
      } else if (!r.wait()) return false;
    }
    return false;
  }

  private spawn(gen: Job) {
    this.side.push({ gen, wait: 0 });
  }

  private *pauseJob(s: number): Job {
    yield s;
  }

  private *callJob(fn: () => void): Job {
    fn();
    this.rev++;
  }

  /* ================================================================ */
  /* Helpers                                                          */
  /* ================================================================ */

  mark(id: string, kind: MarkKind) {
    this.marks.set(id, { kind, vt: this.vt });
  }

  markOf(id: string): Mark | undefined {
    return this.marks.get(id);
  }

  private removeFlight(f: Flight | null) {
    if (f) this.flights = this.flights.filter((x) => x !== f);
  }

  private startOp(op: Op, key: string) {
    this.marks.clear();
    this.cmp = 0;
    this.opCard = { op, key };
    this.rev++;
  }

  private finish(l: Omit<LastOp, 'cmp'>) {
    this.last = { ...l, cmp: this.cmp };
    if (l.op === 'get' || l.op === 'put') {
      this.stats.maxCmp = Math.max(this.stats.maxCmp, this.cmp);
      this.totalCmp += this.cmp;
    }
    this.stats.maxRun = Math.max(this.stats.maxRun, this.table.longestRun());
    this.rev++;
  }

  /** Where a lookup's answer floats: beside the found chain node (toward the middle), or above a probe slot. */
  private resultAnchor(t: Table, key: string, fallback: string) {
    const b = this.boxes.get(keyId(key));
    if (t.mode !== 'chain' || !b) return { id: fallback };
    const side = b.x > this.w * 0.62 ? -1 : 1;
    return { id: keyId(key), dx: side * (b.w / 2 + 46), dy: 9 };
  }

  private treeify(t: Table) {
    t.trees = new Set();
    if (!this.cfg.tree || t.mode !== 'chain') return;
    t.chains.forEach((c, b) => {
      if (c.length > TREEIFY) t.trees.add(b);
    });
  }

  /** The key, as the chip that flies around, fits the slots: ≤ 6 characters. */
  static clean(raw: string) {
    return raw.toLowerCase().replace(/[^a-z]/g, '').slice(0, 6);
  }

  /* ================================================================ */
  /* The hash machine                                                 */
  /* ================================================================ */

  private blankMachine(key: string, op: Op, kind: MachineState['kind'], cap: number): MachineState {
    return { key, op, kind, steps: polySteps(key), shown: 0, hash: null, raw: null, cap, index: null, ask: false, stored: false, from: null, probe: null, vt: this.vt };
  }

  /** The key rides from the op card into the machine (wide stages); the machine shows it waiting. */
  private *feed(key: string, op: Op, color: string): Job {
    this.opCard = { op, key };
    const py = this.cfg.view === 'pydict' && this.py;
    this.machine = this.blankMachine(key, op, py ? 'py' : this.table.hash, py ? this.py!.size : this.table.cap);
    this.rev++;
    if (this.machineMode() === 'off' || !this.isLive('op')) return;
    const f = this.send({ from: 'op', to: 'Mi', dur: 0.42, color, label: key, trail: false });
    yield 0.42;
    this.removeFlight(f);
  }

  private *hashAnim(key: string, op: Op, t: Table, quick: boolean): Job {
    const m = this.blankMachine(key, op, t.hash, t.cap);
    const steps = m.steps;
    this.machine = m;
    this.rev++;
    if (this.machineMode() === 'off') {
      m.shown = steps.length;
      m.hash = t.h(key);
      return;
    }
    if (t.hash === 'poly' && !quick) {
      for (let i = 1; i <= steps.length; i++) {
        m.shown = i;
        m.vt = this.vt;
        this.rev++;
        yield this.cfg.pace;
      }
      yield 0.12;
    } else if (t.hash === 'first') {
      m.shown = 1;
      m.vt = this.vt;
      yield quick ? 0.3 : 0.6;
    } else {
      m.shown = steps.length;
      m.vt = this.vt;
      yield quick ? 0.22 : 0.5;
    }
    if (t.hash === 'java') m.raw = javaHashCode(key);
    m.hash = t.h(key);
    m.vt = this.vt;
    this.rev++;
    yield quick ? 0.2 : 0.4;
  }

  private *reveal(idx: number, q: Question | null, quick = false): Job {
    const m = this.machine;
    if (!m) return;
    m.ask = true;
    m.vt = this.vt;
    this.rev++;
    if (q && this.game && !this.game.done && this.game.ask(q)) {
      yield () => !this.game?.pending;
    } else if (this.machineMode() !== 'off') {
      yield quick ? 0.2 : 0.38;
    }
    m.ask = false;
    m.index = idx;
    m.vt = this.vt;
    this.rev++;
    if (this.machineMode() !== 'off') yield quick ? 0.16 : 0.3;
  }

  /* ================================================================ */
  /* Predictions                                                      */
  /* ================================================================ */

  private bucketQuestion(key: string, h: number, idx: number, cap: number): Question {
    const R = rackOf(this.table);
    return {
      acceptable: [slotId(R, idx)],
      ask: `Which bucket does ${key} go to?`,
      askAt: { id: 'M' },
      explain: (picked, ok) => {
        const got = Number(picked.split(':')[1]);
        const why = `${fmt(h)} mod ${cap} = ${idx}${cap === 10 ? ': just its last digit' : ''}.`;
        return ok ? `${key} lands in bucket ${idx}. ${why}` : `You picked ${Number.isNaN(got) ? 'another bucket' : `bucket ${got}`}, but ${why}`;
      },
    };
  }

  private probeQuestion(key: string, home: number, at: number, taken: number[]): Question {
    const R = rackOf(this.table);
    return {
      acceptable: [slotId(R, at)],
      ask: `Where does ${key} end up?`,
      askAt: { id: anchorId(R, home) },
      explain: (_p, ok) => {
        const why = taken.length
          ? `Its home is slot ${home}. ${taken.length === 1 ? `Slot ${taken[0]} is` : `Slots ${taken.slice(0, -1).join(', ')} and ${taken[taken.length - 1]} are`} taken, so it steps right to slot ${at}.`
          : `Its home, slot ${home}, is free, so it lands right there.`;
        return ok ? why : `Not there. ${why}`;
      },
    };
  }

  private rehashQuestion(key: string, h: number, from: number, idx: number, oldCap: number, newCap: number): Question {
    const stay = idx === from;
    return {
      acceptable: [stay ? 'stay' : 'move'],
      choices: [
        { id: 'stay', label: `Stays in ${from}` },
        { id: 'move', label: `Moves to ${from + oldCap}` },
      ],
      ask: `${key}: stay or move?`,
      askAt: { id: 'M' },
      explain: () =>
        `${fmt(h)} mod ${newCap} = ${idx}${stay ? `, the same bucket as before.` : `, so it moves ${oldCap} buckets over.`} (Look at the last two digits: ${String(h % 100).padStart(2, '0')}.)`,
    };
  }

  /* ================================================================ */
  /* Jobs: insert, lookup, delete                                     */
  /* ================================================================ */

  private *compareKey(stored: string, key: string, quick: boolean): Job {
    this.cmp++;
    const id = keyId(stored);
    this.mark(id, 'cmp');
    this.rev++;
    yield quick ? 0.2 : 0.38;
    this.mark(id, stored === key ? 'hit' : 'skip');
    this.rev++;
    yield quick ? 0.06 : 0.14;
  }

  private *putJob(key: string, o: PutOpts): Job {
    const t = this.table;
    const R = rackOf(t);
    const quick = !!o.quick;
    this.startOp('put', key);
    if (t.mode === 'probe' && !t.has(key) && t.count >= t.cap && t.tombstones() === 0) {
      this.machine = null;
      this.say('M', 'table full', SIG.err);
      this.finish({ op: 'put', key, result: 'full' });
      yield 1;
      return;
    }
    yield* this.feed(key, 'put', COLOR.put);
    yield* this.hashAnim(key, 'put', t, quick);
    const plan = t.planPut(key);
    const h = t.h(key);
    const q = o.predict === 'bucket' ? this.bucketQuestion(key, h, plan.home, t.cap) : null;
    yield* this.reveal(plan.home, q, quick);
    if (plan.full) {
      this.say('M', 'table full', SIG.err);
      this.finish({ op: 'put', key, result: 'full' });
      return;
    }
    this.mark(slotId(R, plan.home), 'home');
    const fly = quick ? 0.5 : 0.75;
    let chip: Flight | null = this.send({ from: 'Mo', to: anchorId(R, plan.home), dur: fly, color: COLOR.put, label: key, hold: true });
    yield fly;

    if (o.hover && t.chains[plan.home]?.length) {
      // Two keys, one bucket: leave the new key hovering over it.
      this.mark(slotId(R, plan.home), 'clash');
      for (const k of t.chains[plan.home]) this.mark(keyId(k), 'cmp');
      this.fx({ kind: 'ring', at: { id: anchorId(R, plan.home) }, color: SIG.heavy, size: 1.4, dur: 1.2 });
      this.stats.collided = true;
      this.finish({ op: 'put', key, result: 'collision', index: plan.home, hash: h });
      return;
    }

    if (t.mode === 'chain') {
      const bucketWasBusy = t.chains[plan.home].length > 0;
      for (const v of plan.visits) {
        yield* this.compareKey(v.seen as string, key, quick);
        if (v.seen === key) break;
      }
      if (plan.exists) {
        this.removeFlight(chip);
        this.fx({ kind: 'text', at: { id: anchorId(R, plan.home) }, text: 'updated', color: SIG.res, dur: 1.4 });
        this.finish({ op: 'put', key, result: 'updated', index: plan.home, hash: h });
        yield 0.4;
        return;
      }
      this.dropTarget = { table: t, bucket: plan.home, depth: plan.depth };
      this.sync();
      this.removeFlight(chip);
      chip = this.send({ from: anchorId(R, plan.home), to: 'tgt', dur: 0.3, color: COLOR.put, label: key, trail: false });
      yield 0.3;
      this.removeFlight(chip);
      this.dropTarget = null;
      t.applyPut(key, plan);
      this.sync();
      this.mark(keyId(key), 'fresh');
      if (bucketWasBusy) this.stats.collided = true;
    } else {
      if (o.predict === 'probe' && this.game && !this.game.done) {
        const taken = plan.visits.filter((v) => v.seen !== null && v.slot !== plan.at).map((v) => v.slot);
        if (this.game.ask(this.probeQuestion(key, plan.home, plan.at, taken))) yield () => !this.game?.pending;
      }
      for (let n = 0; n < plan.visits.length; n++) {
        const v = plan.visits[n];
        const sid = slotId(R, v.slot);
        if (v.seen === null) break;
        if (v.seen === TOMB) {
          this.mark(sid, 'tomb');
          this.rev++;
          yield quick ? 0.18 : 0.32;
        } else {
          yield* this.compareKey(v.seen, key, quick);
          if (v.seen === key) break;
          this.mark(sid, 'taken');
        }
        const nxt = plan.visits[n + 1];
        if (nxt) {
          this.removeFlight(chip);
          chip = this.send({ from: anchorId(R, v.slot), to: anchorId(R, nxt.slot), dur: quick ? 0.24 : 0.34, color: COLOR.put, label: key, hold: true });
          yield quick ? 0.24 : 0.34;
        }
      }
      if (plan.exists) {
        this.removeFlight(chip);
        this.fx({ kind: 'text', at: { id: anchorId(R, plan.at) }, text: 'updated', color: SIG.res, dur: 1.4 });
        this.finish({ op: 'put', key, result: 'updated', index: plan.at, hash: h });
        yield 0.4;
        return;
      }
      const lastSlot = plan.visits[plan.visits.length - 1].slot;
      if (plan.at !== lastSlot) {
        this.removeFlight(chip);
        chip = this.send({ from: anchorId(R, lastSlot), to: anchorId(R, plan.at), dur: 0.4, color: COLOR.put, label: key, hold: true });
        yield 0.4;
      }
      this.removeFlight(chip);
      chip = this.send({ from: anchorId(R, plan.at), to: slotId(R, plan.at), dur: 0.22, color: COLOR.put, label: key, trail: false });
      yield 0.22;
      this.removeFlight(chip);
      t.applyPut(key, plan);
      this.sync();
      this.mark(keyId(key), 'fresh');
      if (plan.at !== plan.home) this.stats.collided = true;
    }
    this.finish({ op: 'put', key, result: 'placed', index: plan.at, hash: h });
    yield 0.2;
    if (Number.isFinite(this.cfg.maxLoad) && t.load > this.cfg.maxLoad + 1e-9 && t.cap * 2 <= this.cfg.maxCap && this.table === t) {
      yield* this.resizeJob(!!o.predictRehash);
    }
  }

  private *getJob(key: string, quick: boolean): Job {
    const t = this.table;
    const R = rackOf(t);
    this.startOp('get', key);
    yield* this.feed(key, 'get', COLOR.get);
    yield* this.hashAnim(key, 'get', t, quick);
    const plan = t.planGet(key);
    const h = t.h(key);
    yield* this.reveal(plan.home, null, quick);
    this.mark(slotId(R, plan.home), 'home');
    const fly = quick ? 0.5 : 0.75;
    let chip: Flight | null = this.send({ from: 'Mo', to: anchorId(R, plan.home), dur: fly, color: COLOR.get, label: key, hold: true });
    yield fly;
    let endAnchor = anchorId(R, plan.home);

    if (t.mode === 'chain') {
      if (!plan.visits.length) {
        this.mark(slotId(R, plan.home), 'empty');
        this.rev++;
        yield 0.3;
      }
      for (const v of plan.visits) {
        yield* this.compareKey(v.seen as string, key, quick);
        if (v.seen === key) break;
      }
    } else {
      for (let n = 0; n < plan.visits.length; n++) {
        const v = plan.visits[n];
        const sid = slotId(R, v.slot);
        endAnchor = anchorId(R, v.slot);
        if (v.seen === null) {
          this.mark(sid, 'empty');
          this.rev++;
          yield quick ? 0.25 : 0.4;
          break;
        }
        if (v.seen === TOMB) {
          this.mark(sid, 'tomb');
          this.rev++;
          yield quick ? 0.18 : 0.34;
        } else {
          yield* this.compareKey(v.seen, key, quick);
          if (v.seen === key) break;
        }
        const nxt = plan.visits[n + 1];
        if (nxt) {
          this.removeFlight(chip);
          chip = this.send({ from: anchorId(R, v.slot), to: anchorId(R, nxt.slot), dur: quick ? 0.24 : 0.34, color: COLOR.get, label: key, hold: true });
          yield quick ? 0.24 : 0.34;
        }
      }
    }

    this.removeFlight(chip);
    chip = null;
    if (plan.found) {
      this.mark(keyId(key), 'hit');
      this.fx({ kind: 'ring', at: { id: keyId(key) }, color: SIG.res, size: 1.1 });
      this.fx({ kind: 'text', at: this.resultAnchor(t, key, endAnchor), text: `→ ${phoneOf(key)}`, color: SIG.res, dur: 2 });
      this.finish({ op: 'get', key, result: 'found', index: plan.home, hash: h, value: phoneOf(key) });
    } else {
      this.fx({ kind: 'x', at: { id: endAnchor }, color: SIG.err, size: 1.3, dur: 1.4 });
      this.fx({ kind: 'text', at: { id: endAnchor }, text: 'not found', color: SIG.err, dur: 2 });
      this.finish({ op: 'get', key, result: 'missing', index: plan.home, hash: h });
    }
    yield 0.9;
  }

  private *delJob(key: string, tomb: boolean, quick: boolean): Job {
    const t = this.table;
    const R = rackOf(t);
    this.startOp('del', key);
    yield* this.feed(key, 'del', COLOR.del);
    yield* this.hashAnim(key, 'del', t, quick);
    const plan = t.planGet(key);
    yield* this.reveal(plan.home, null, quick);
    this.mark(slotId(R, plan.home), 'home');
    const fly = quick ? 0.5 : 0.7;
    let chip: Flight | null = this.send({ from: 'Mo', to: anchorId(R, plan.home), dur: fly, color: COLOR.del, label: key, hold: true });
    yield fly;
    if (t.mode === 'chain') {
      for (const v of plan.visits) {
        yield* this.compareKey(v.seen as string, key, quick);
        if (v.seen === key) break;
      }
    } else {
      for (let n = 0; n < plan.visits.length; n++) {
        const v = plan.visits[n];
        if (v.seen === null) break;
        if (v.seen === TOMB) {
          this.mark(slotId(R, v.slot), 'tomb');
          yield 0.25;
        } else {
          yield* this.compareKey(v.seen, key, quick);
          if (v.seen === key) break;
        }
        const nxt = plan.visits[n + 1];
        if (nxt) {
          this.removeFlight(chip);
          chip = this.send({ from: anchorId(R, v.slot), to: anchorId(R, nxt.slot), dur: 0.3, color: COLOR.del, label: key, hold: true });
          yield 0.3;
        }
      }
    }
    this.removeFlight(chip);
    if (!plan.found) {
      this.fx({ kind: 'text', at: { id: anchorId(R, plan.home) }, text: 'not found', color: SIG.err, dur: 1.6 });
      this.finish({ op: 'del', key, result: 'missing', index: plan.home });
      yield 0.6;
      return;
    }
    this.fx({ kind: 'x', at: { id: keyId(key) }, color: SIG.pink, size: 1.2, dur: 0.9 });
    yield 0.35;
    t.remove(key, tomb);
    this.sync();
    if (t.mode === 'probe') this.mark(slotId(R, plan.at), tomb ? 'tomb' : 'empty');
    this.finish({ op: 'del', key, result: 'deleted', index: plan.at });
    yield 0.6;
  }

  /* ================================================================ */
  /* Resize                                                           */
  /* ================================================================ */

  private *resizeJob(predict: boolean): Job {
    // Fast-paced steps (cheat sheet, playground) move keys briskly; teaching steps take their time.
    const fast = this.cfg.pace < 0.2 && !predict;
    const old = this.table;
    const nt = new Table(old.cap * 2, old.mode, old.hash, old.seed, old.gen + 1);
    this.next = nt;
    this.resizing = { done: 0, total: old.count };
    this.machine = null;
    this.opCard = null;
    this.marks.clear();
    this.sync();
    this.say('M', `load ${old.load.toFixed(2)} > ${this.cfg.maxLoad} · resize to ${nt.cap}`, SIG.warn, 2.2);
    this.rev++;
    yield fast ? 0.9 : 1.2;
    const keys = old.storageOrder();
    for (const key of keys) {
      const from = old.locate(key)?.at ?? 0;
      const h = old.h(key);
      const idx = nt.home(key);
      this.machine = { ...this.blankMachine(key, 'rehash', old.hash, nt.cap), hash: h, stored: true, from };
      this.opCard = { op: 'rehash', key };
      this.marks.clear();
      this.mark(keyId(key), 'lift');
      this.rev++;
      yield fast ? 0.14 : predict && this.game && !this.game.done ? 0.25 : 0.32;
      const q = predict && this.game && !this.game.done && old.mode === 'chain' ? this.rehashQuestion(key, h, from, idx, old.cap, nt.cap) : null;
      yield* this.reveal(idx, q, fast);
      old.remove(key, false);
      nt.put(key);
      this.sync();
      this.mark(keyId(key), idx === from ? 'stay' : 'moved');
      if (this.resizing) this.resizing.done++;
      this.rev++;
      yield fast ? 0.32 : 0.55;
    }
    this.machine = null;
    this.opCard = null;
    this.table = nt;
    this.next = null;
    this.resizing = null;
    this.stats.resized = true;
    this.marks.clear();
    this.sync();
    this.rev++;
    yield fast ? 0.5 : 0.9;
  }

  /* ================================================================ */
  /* Jobs: the other views                                            */
  /* ================================================================ */

  private *hashOnlyJob(key: string): Job {
    this.startOp('hash', key);
    yield* this.feed(key, 'hash', COLOR.put);
    yield* this.hashAnim(key, 'hash', this.table, false);
    const h = this.table.h(key);
    const again = this.hashLog.some((e) => e.key === key);
    this.hashLog = [...this.hashLog, { key, hash: h, again }].slice(-4);
    if (again) this.say('M', `same key, same number: ${fmt(h)}`, SIG.res, 2.2);
    this.rev++;
    yield 1.3;
  }

  private *scanJob(key: string): Job {
    this.startOp('scan', key);
    this.jumpInfo = null;
    const n = this.list.length;
    let chip: Flight | null = this.send({ from: 'Q', to: anchorId('L', 0), dur: 0.6, color: COLOR.get, label: key, hold: true });
    yield 0.6;
    let found = -1;
    for (let i = 0; i < n; i++) {
      if (i > 0) {
        this.removeFlight(chip);
        chip = this.send({ from: anchorId('L', i - 1), to: anchorId('L', i), dur: 0.2, color: COLOR.get, label: key, hold: true });
        yield 0.2;
      }
      this.cmp++;
      this.mark(slotId('L', i), 'cmp');
      this.rev++;
      yield 0.3;
      if (this.list[i] === key) {
        found = i;
        this.mark(slotId('L', i), 'hit');
        break;
      }
      this.mark(slotId('L', i), 'skip');
    }
    this.removeFlight(chip);
    if (found >= 0) {
      this.fx({ kind: 'ring', at: { id: slotId('L', found) }, color: SIG.res, size: 1.3 });
      this.fx({ kind: 'text', at: { id: anchorId('L', found) }, text: `→ ${phoneOf(key)}`, color: SIG.res, dur: 2.2 });
      this.finish({ op: 'scan', key, result: 'found', index: found, value: phoneOf(key) });
    } else {
      this.fx({ kind: 'x', at: { id: anchorId('L', n - 1) }, color: SIG.err, size: 1.3, dur: 1.4 });
      this.fx({ kind: 'text', at: { id: anchorId('L', n - 1) }, text: 'not found', color: SIG.err, dur: 2.2 });
      this.finish({ op: 'scan', key, result: 'missing' });
    }
    yield 1.6;
  }

  private *jumpJob(i: number): Job {
    this.startOp('jump', `[${i}]`);
    this.jumpInfo = { i };
    this.cmp = 0;
    this.rev++;
    yield 0.5;
    const chip = this.send({ from: 'Q', to: anchorId('L', i), dur: 0.7, color: SIG.warn, label: `contacts[${i}]`, hold: true });
    yield 0.7;
    this.cmp = 1;
    this.mark(slotId('L', i), 'hit');
    this.fx({ kind: 'ring', at: { id: slotId('L', i) }, color: SIG.res, size: 1.3 });
    this.rev++;
    yield 1.6;
    this.removeFlight(chip);
    this.finish({ op: 'jump', key: this.list[i] ?? '', result: 'found', index: i, value: phoneOf(this.list[i] ?? '') });
    yield 0.6;
  }

  private *raceJob(key: string): Job {
    this.marks.clear();
    this.cmp = 0;
    this.race = { key, list: { cmp: 0, done: false, found: false, t: 0 }, table: { cmp: 0, done: false, found: false, t: 0 }, winner: null };
    this.rev++;
    const t0 = this.t;
    this.spawn(this.raceList(key, t0));
    this.spawn(this.raceTable(key, t0));
    yield () => !!this.race && this.race.list.done && this.race.table.done;
    const r = this.race;
    if (r) {
      r.winner = Math.abs(r.list.t - r.table.t) < 0.05 ? 'tie' : r.list.t < r.table.t ? 'list' : 'table';
      this.rev++;
    }
    yield 2.4;
  }

  private *raceList(key: string, t0: number): Job {
    const r = this.race!;
    let chip: Flight | null = this.send({ from: 'Q', to: anchorId('L', 0), dur: 0.35, color: COLOR.get, label: key, hold: true });
    yield 0.35;
    for (let i = 0; i < this.list.length; i++) {
      if (i > 0) {
        this.removeFlight(chip);
        chip = this.send({ from: anchorId('L', i - 1), to: anchorId('L', i), dur: 0.14, color: COLOR.get, label: key, hold: true });
        yield 0.14;
      }
      r.list.cmp++;
      this.mark(slotId('L', i), 'cmp');
      this.rev++;
      yield 0.2;
      if (this.list[i] === key) {
        r.list.found = true;
        this.mark(slotId('L', i), 'hit');
        break;
      }
      this.mark(slotId('L', i), 'skip');
    }
    this.removeFlight(chip);
    if (!r.list.found) this.fx({ kind: 'x', at: { id: anchorId('L', this.list.length - 1) }, color: SIG.err, size: 1.2, dur: 1.2 });
    r.list.done = true;
    r.list.t = this.t - t0;
    this.rev++;
  }

  private *raceTable(key: string, t0: number): Job {
    const r = this.race!;
    const t = this.table;
    const R = rackOf(t);
    yield* this.hashAnim(key, 'get', t, true);
    const plan = t.planGet(key);
    yield* this.reveal(plan.home, null);
    const chip = this.send({ from: 'Mo', to: anchorId(R, plan.home), dur: 0.45, color: COLOR.get, label: key, hold: true });
    yield 0.45;
    for (const v of plan.visits) {
      r.table.cmp++;
      this.mark(keyId(v.seen as string), 'cmp');
      this.rev++;
      yield 0.2;
      this.mark(keyId(v.seen as string), v.seen === key ? 'hit' : 'skip');
      if (v.seen === key) break;
    }
    this.removeFlight(chip);
    r.table.found = plan.found;
    if (!plan.found) this.fx({ kind: 'x', at: { id: anchorId(R, plan.home) }, color: SIG.err, size: 1.2, dur: 1.2 });
    r.table.done = true;
    r.table.t = this.t - t0;
    this.rev++;
  }

  private *chartJob(n: number): Job {
    this.chart = { bars: [], count: 0, cap: 10, total: 0, target: n };
    this.rev++;
    yield 0.6;
    for (let i = 1; i <= n; i++) {
      const c = this.chart;
      if (!c) return;
      c.count++;
      let work = 1;
      let resize = false;
      if (c.count / c.cap > 0.75) {
        work += c.count;
        c.cap *= 2;
        resize = true;
      }
      c.total += work;
      c.bars = [...c.bars, { n: i, work, resize, cap: c.cap }];
      this.rev++;
      yield resize ? 1.1 : 0.13;
    }
    yield 3;
  }

  /* ---------------- Python's compact dict ---------------- */

  private *pyPutJob(key: string, quick: boolean): Job {
    let d = this.py;
    if (!d || d.has(key)) return;
    this.startOp('put', key);
    if (d.needsResize()) {
      const size = d.grownSize();
      this.say('M', `2/3 full · rebuild indices with ${size} slots`, SIG.warn, 2.4);
      this.machine = null;
      this.opCard = null;
      yield 1.3;
      // A bigger index array; the entries come along in order, with their stored hashes.
      const nd = PyDict.withEntries(size, d.entries);
      this.pyGen++;
      this.py = nd;
      this.sync();
      yield 0.8;
      for (let n = 0; n < nd.entries.length; n++) {
        const seq = nd.placeIndex(n);
        this.pyFresh = n;
        this.mark(slotId(`P${this.pyGen}`, seq[seq.length - 1].slot), 'fresh');
        this.rev++;
        yield 0.3;
      }
      this.pyFresh = null;
      d = nd;
      yield 0.5;
      this.startOp('put', key);
    }
    const R = `P${this.pyGen}`;
    yield* this.feed(key, 'put', COLOR.put);
    const hash = polyHash(key);
    const seq = d.probe(hash);
    const m = this.blankMachine(key, 'put', 'py', d.size);
    this.machine = m;
    m.shown = m.steps.length;
    this.rev++;
    yield quick ? 0.25 : 0.45;
    m.hash = hash;
    m.vt = this.vt;
    this.rev++;
    yield quick ? 0.3 : 0.5;
    m.index = seq[0].slot;
    m.probe = seq[0];
    m.vt = this.vt;
    this.rev++;
    yield 0.35;
    let chip: Flight | null = this.send({ from: 'Mo', to: anchorId(R, seq[0].slot), dur: 0.6, color: COLOR.put, label: key, hold: true });
    yield 0.6;
    for (let i = 1; i < seq.length; i++) {
      this.mark(slotId(R, seq[i - 1].slot), 'taken');
      this.cmp++;
      m.probe = seq[i];
      m.index = seq[i].slot;
      m.vt = this.vt;
      this.rev++;
      yield 0.6;
      this.removeFlight(chip);
      chip = this.send({ from: anchorId(R, seq[i - 1].slot), to: anchorId(R, seq[i].slot), dur: 0.4, color: COLOR.put, label: key, hold: true });
      yield 0.4;
    }
    const slot = seq[seq.length - 1].slot;
    this.removeFlight(chip);
    // The slot stores only the entry's position; the entry itself is appended.
    const entry = d.entries.length;
    chip = this.send({ from: anchorId(R, slot), to: 'Eend', dur: 0.55, color: COLOR.put, label: key, trail: false });
    yield 0.55;
    this.removeFlight(chip);
    d.insert(key);
    this.pyFresh = entry;
    this.mark(slotId(R, slot), 'fresh');
    this.sync();
    this.finish({ op: 'put', key, result: 'placed', index: slot, hash });
    yield 0.5;
  }

  /* ================================================================ */
  /* Geometry                                                         */
  /* ================================================================ */

  machineMode(): MachineMode {
    const c = this.cfg.machine;
    const v = this.cfg.view;
    if (c === 'off' || v === 'list' || v === 'chart') return 'off';
    if (v === 'race') return 'strip';
    // Two arrays on stage during a resize: make room.
    if (c === 'full' && this.next) return 'strip';
    return c;
  }

  /** The op card sits left of the machine on wide stages only. */
  opFits() {
    return this.orient === 'landscape' && this.machineMode() === 'full' && this.w - 2 * this.padX() >= 660;
  }

  private fullMachineH() {
    const L = this.orient === 'landscape';
    const extra = this.cfg.hash === 'java' || this.cfg.view === 'pydict' ? 1 : 0;
    return (L ? 132 : 106) + extra * (L ? 21 : 17);
  }

  private tablesShown(): Table[] {
    const v = this.cfg.view;
    if (v === 'list' || v === 'chart' || v === 'pydict') return [];
    return this.next ? [this.table, this.next] : [this.table];
  }

  private padX() {
    return this.orient === 'landscape' ? (this.compact ? 26 : 40) : 12;
  }

  private rackGeo(id: string, cap: number, kind: RackGeo['kind'], mode: Mode, caption?: string): RackGeo {
    const L = this.orient === 'landscape';
    let perRow = cap <= 10 ? Math.max(1, cap) : Math.ceil(cap / 2);
    // On phones a long plain list reads better as two rows of five.
    if (!L && kind === 'list' && this.cfg.view === 'list' && cap > 7) perRow = Math.ceil(cap / 2);
    const rows = Math.ceil(cap / perRow);
    const avail = this.w - 2 * this.padX();
    const pitch = L ? Math.min(88, avail / perRow) : avail / perRow;
    const slotW = L ? Math.min(76, pitch - 10) : pitch - (perRow <= 6 ? 8 : 3);
    const slotH = kind === 'list' ? (L ? 54 : perRow <= 6 ? 44 : 38) : L ? 38 : 28;
    const x0 = this.w / 2 - ((perRow - 1) * pitch) / 2;
    return {
      id,
      cap,
      kind,
      mode,
      perRow,
      rows,
      pitch,
      slotW,
      slotH,
      nodeH: L ? 24 : 19,
      nodeGap: L ? 29 : 22,
      x0,
      rowY: [],
      anchorGap: L ? 27 : 22,
      caption,
    };
  }

  private rackAbove(r: RackGeo, row: number) {
    const L = this.orient === 'landscape';
    if (row > 0) return L ? 46 : 38;
    return (L ? 60 : 46) + (r.caption ? (L ? 8 : 10) : 0);
  }

  /** Room under a row of buckets: enough for the longest chain (or tree) in that row. */
  private rackBelow(r: RackGeo, row: number, t: Table | null) {
    if (r.kind !== 'table' || r.mode !== 'chain') return 14;
    let need = this.cfg.reserve;
    if (t) {
      for (let b = row * r.perRow; b < Math.min(t.cap, (row + 1) * r.perRow); b++) {
        const n = t.chains[b]?.length ?? 0;
        if (t.trees.has(b)) {
          let depth = 0;
          for (const s of t.treeShape(b).values()) depth = Math.max(depth, s.level);
          need = Math.max(need, (depth + 1) * 1.18);
        } else need = Math.max(need, n);
      }
    }
    return 12 + need * r.nodeGap;
  }

  private rackHeight(r: RackGeo, t: Table | null) {
    let h = 0;
    for (let row = 0; row < r.rows; row++) h += this.rackAbove(r, row) + r.slotH + this.rackBelow(r, row, t);
    return h;
  }

  private computeGeo(): Geo {
    const L = this.orient === 'landscape';
    const W = this.w;
    const H = this.h;
    const top = L ? 80 : 74;
    const bottom = L ? H - 104 : H - 62;
    const padX = this.padX();
    const g: Geo = { racks: [], machine: null, op: null, chart: null, entries: null, curve: null, below: top, top, bottom, padX };
    const v = this.cfg.view;

    if (v === 'chart') {
      g.chart = { x: padX + 40, y: top + 30, w: W - 2 * padX - 60, h: Math.max(160, bottom - top - (L ? 64 : 84)) };
      g.below = bottom;
      return g;
    }

    type Item =
      | { kind: 'machine'; h: number }
      | { kind: 'rack'; r: RackGeo; t: Table | null; h: number }
      | { kind: 'entries'; h: number; rows: number }
      | { kind: 'curve'; h: number };
    const items: Item[] = [];
    const mm = this.machineMode();

    if (v === 'list' || v === 'race') {
      const r = this.rackGeo('L', Math.max(1, this.list.length), 'list', 'probe', v === 'race' ? 'unsorted list' : 'contacts · unsorted list');
      items.push({ kind: 'rack', r, t: null, h: this.rackHeight(r, null) });
    }
    if (mm !== 'off') {
      const h = mm === 'strip' ? (L ? 46 : 42) : this.fullMachineH();
      items.push({ kind: 'machine', h: h + (v === 'race' ? 10 : 0) });
    }
    for (const t of this.tablesShown()) {
      const cap = v === 'race' ? 'hash table' : this.next ? (t === this.next ? `new array · ${t.cap} buckets` : `old array · ${t.cap} buckets`) : undefined;
      const r = this.rackGeo(rackOf(t), t.cap, 'table', t.mode, cap);
      items.push({ kind: 'rack', r, t, h: this.rackHeight(r, t) });
    }
    if (this.cfg.curve && v === 'table') items.push({ kind: 'curve', h: L ? 190 : 170 });
    if (v === 'pydict' && this.py) {
      const r = this.rackGeo(`P${this.pyGen}`, this.py.size, 'py', 'probe', 'indices');
      items.push({ kind: 'rack', r, t: null, h: this.rackHeight(r, null) });
      const rows = Math.max(6, this.py.entries.length + 1);
      items.push({ kind: 'entries', h: (L ? 30 : 26) + rows * (L ? 22 : 19), rows });
    }

    const total = items.reduce((s, it) => s + it.h, 0);
    let y = top + Math.max(0, (bottom - top - total) / 2);
    for (const it of items) {
      if (it.kind === 'machine') {
        const strip = mm === 'strip';
        const opFits = this.opFits();
        const mW = strip ? (L ? Math.min(640, W - 2 * padX) : W - 2 * padX) : L ? Math.min(520, W - 2 * padX - (opFits ? 150 : 0)) : W - 2 * padX;
        const mH = strip ? (L ? 46 : 42) : this.fullMachineH();
        const opW = 116;
        const groupW = opFits ? opW + 26 + mW : mW;
        const gx = W / 2 - groupW / 2;
        const mx = opFits ? gx + opW + 26 + mW / 2 : W / 2;
        const my = y + (v === 'race' ? 4 : 0) + mH / 2;
        g.machine = { x: mx, y: my, w: mW, h: mH, mode: strip ? 'strip' : 'full' };
        if (opFits) g.op = { x: gx + opW / 2, y: my, w: opW, h: 62 };
      } else if (it.kind === 'rack') {
        const r = it.r;
        let ry = y;
        for (let row = 0; row < r.rows; row++) {
          const above = this.rackAbove(r, row);
          r.rowY.push(ry + above + r.slotH / 2);
          ry += above + r.slotH + this.rackBelow(r, row, it.t);
        }
        g.racks.push(r);
      } else if (it.kind === 'curve') {
        const w = L ? Math.min(470, W - 2 * padX) : W - 2 * padX - 36;
        g.curve = { x: W / 2 - w / 2 + (L ? 0 : 14), y: y + 30, w, h: it.h - 58 };
      } else {
        g.entries = { x: W / 2, y: y + 8, w: L ? Math.min(480, W - 2 * padX) : W - 2 * padX, rowH: L ? 22 : 19, rows: it.rows };
      }
      y += it.h;
    }
    g.below = y;
    return g;
  }

  /** Where every key of a table sits. */
  keyPositions(t: Table, r: RackGeo): Map<string, { x: number; y: number; w: number; h: number; level?: number }> {
    const out = new Map<string, { x: number; y: number; w: number; h: number; level?: number }>();
    if (t.mode === 'probe') {
      t.slots.forEach((s, i) => {
        if (s && s !== TOMB) {
          const c = slotCenter(r, i);
          out.set(s, { x: c.x, y: c.y, w: r.slotW, h: r.slotH });
        }
      });
      return out;
    }
    const padX = this.padX();
    for (let b = 0; b < t.cap; b++) {
      const c = slotCenter(r, b);
      const chain = t.chains[b];
      if (t.trees.has(b)) {
        const shape = t.treeShape(b);
        let rootOrder = 0;
        for (const s of shape.values()) if (s.level === 0) rootOrder = s.order;
        const n = chain.length;
        const half = r.slotW / 2;
        const fitL = rootOrder > 0 ? (c.x - padX - half) / rootOrder : Infinity;
        const fitR = n - 1 - rootOrder > 0 ? (this.w - padX - c.x - half) / (n - 1 - rootOrder) : Infinity;
        const sp = Math.min(r.pitch * 0.62, fitL, fitR);
        for (const [k, s] of shape) out.set(k, { x: c.x + (s.order - rootOrder) * sp, y: nodeY(r, c.y, 0) + s.level * r.nodeGap * 1.18, w: r.slotW, h: r.nodeH, level: s.level });
        continue;
      }
      chain.forEach((k, d) => out.set(k, { x: c.x, y: nodeY(r, c.y, d), w: r.slotW, h: r.nodeH }));
    }
    return out;
  }

  /** The rectangle covering every row of slots in a rack. */
  private rackRect(r: RackGeo) {
    const w = (r.perRow - 1) * r.pitch + r.slotW;
    const top = r.rowY[0] - r.slotH / 2;
    const bottom = r.rowY[r.rowY.length - 1] + r.slotH / 2;
    return { x: r.x0 + ((r.perRow - 1) * r.pitch) / 2, y: (top + bottom) / 2, w, h: bottom - top };
  }

  rackFor(t: Table | null): RackGeo | undefined {
    if (!t) return undefined;
    return this.geo.racks.find((r) => r.id === rackOf(t));
  }

  private sync() {
    const live = new Set<string>();
    const v = this.cfg.view;
    for (const t of this.tablesShown()) {
      const R = rackOf(t);
      for (let i = 0; i < t.cap; i++) {
        live.add(slotId(R, i));
        live.add(anchorId(R, i));
      }
      for (const k of t.order) live.add(keyId(k));
      this.treeify(t);
    }
    if (v === 'list' || v === 'race') {
      for (let i = 0; i < this.list.length; i++) {
        live.add(slotId('L', i));
        live.add(anchorId('L', i));
      }
      live.add('Q');
    }
    if (v === 'pydict' && this.py) {
      const R = `P${this.pyGen}`;
      for (let i = 0; i < this.py.size; i++) {
        live.add(slotId(R, i));
        live.add(anchorId(R, i));
      }
      for (let e = 0; e < this.py.entries.length; e++) live.add(entryId(e));
      live.add('Eend');
    }
    if (this.machineMode() !== 'off') {
      live.add('M');
      live.add('Mo');
      live.add('Mi');
      if (this.opFits()) live.add('op');
    }
    if (this.dropTarget) live.add('tgt');
    for (const id of live) if (!this.isLive(id)) this.box(id);
    for (const [id, b] of this.boxes) if (!live.has(id) && !b.removing) this.hide(id);
    this.relayout();
  }

  /** Move a box's target only if the box exists (never creates one). */
  private pos(id: string, x: number, y: number, w: number, h: number) {
    const b = this.boxes.get(id);
    if (!b || b.removing) return;
    b.tx = x;
    b.ty = y;
    b.w = w;
    b.h = h;
  }

  protected layout() {
    const g = this.computeGeo();
    this.geo = g;
    const m = g.machine;
    if (m) {
      this.pos('M', m.x, m.y, m.w, m.h);
      this.pos('Mo', m.x, m.y + m.h / 2 + 1, 10, 2);
      this.pos('Mi', m.x - m.w / 2, m.y, 2, 10);
      if (g.op) this.pos('op', g.op.x, g.op.y, g.op.w, g.op.h);
    }
    for (const r of g.racks) {
      for (let i = 0; i < r.cap; i++) {
        const c = slotCenter(r, i);
        this.pos(slotId(r.id, i), c.x, c.y, r.slotW, r.slotH);
        this.pos(anchorId(r.id, i), c.x, c.y - r.slotH / 2 - r.anchorGap, 8, 8);
      }
    }
    for (const t of this.tablesShown()) {
      const r = this.rackFor(t);
      if (!r) continue;
      for (const [k, p] of this.keyPositions(t, r)) this.pos(keyId(k), p.x, p.y, p.w, p.h);
    }
    if (this.dropTarget) {
      const r = this.rackFor(this.dropTarget.table);
      if (r) {
        const c = slotCenter(r, this.dropTarget.bucket);
        this.pos('tgt', c.x, nodeY(r, c.y, this.dropTarget.depth), r.slotW, r.nodeH);
      }
    }
    const lr = g.racks.find((r) => r.id === 'L');
    if (lr) {
      const L = this.orient === 'landscape';
      const qy = lr.rowY[0] - lr.slotH / 2 - (L ? 96 : 78);
      this.pos('Q', this.cfg.view === 'race' ? lr.x0 - lr.pitch * 0.2 : this.w / 2, Math.max(g.top - 10, qy), 8, 8);
    }
    if (g.entries && this.py) {
      const e = g.entries;
      const head = this.orient === 'landscape' ? 26 : 22;
      this.py.entries.forEach((_, n) => this.pos(entryId(n), e.x, e.y + head + n * e.rowH + e.rowH / 2, e.w, e.rowH - 3));
      this.pos('Eend', e.x, e.y + head + this.py.entries.length * e.rowH + e.rowH / 2, e.w, e.rowH - 3);
    }
  }

  protected curveFor(from: string, to: string, lane: number): Curve | null {
    void lane;
    const a = this.boxes.get(from);
    const b = this.boxes.get(to);
    if (!a || !b || Number.isNaN(a.x) || Number.isNaN(b.x)) return null;
    const A = { x: a.x, y: a.y };
    const B = { x: b.x, y: b.y };
    if (from === 'op') return curveBetween({ x: a.x + a.w / 2, y: a.y }, B, 'x');
    if (from === 'Mo' || from === 'Q') return curveBetween(A, B, 'y');
    if (from.includes('^') && to.includes('^')) {
      const dx = B.x - A.x;
      const lift = Math.min(40, 14 + Math.abs(dx) * 0.22);
      const top = Math.min(A.y, B.y) - lift;
      return { p0: A, p1: { x: A.x + dx * 0.15, y: top }, p2: { x: B.x - dx * 0.15, y: top }, p3: B };
    }
    return { p0: A, p1: { x: lerp(A.x, B.x, 1 / 3), y: lerp(A.y, B.y, 1 / 3) }, p2: { x: lerp(A.x, B.x, 2 / 3), y: lerp(A.y, B.y, 2 / 3) }, p3: B };
  }

  /* ================================================================ */
  /* Callout targets                                                  */
  /* ================================================================ */

  /**
   * Callout and hover targets: 'machine', 'slot:3', 'list' or 'list:8', 'key:frank',
   * 'chain:0' (a bucket and its chain), 'rack' (the bucket array), 'entries' (Python's entry list).
   */
  targetRect(target: string): { x: number; y: number; w: number; h: number } | null {
    const box = (id: string) => {
      const b = this.boxes.get(id);
      return b && !Number.isNaN(b.x) ? { x: b.x, y: b.y, w: b.w, h: b.h } : null;
    };
    const [kind, arg] = target.split(':');
    const R = rackOf(this.table);
    switch (kind) {
      case 'machine':
        return box('M');
      case 'slot':
        return box(slotId(R, Number(arg)));
      case 'list': {
        if (arg != null) return box(slotId('L', Number(arg)));
        const r = this.geo.racks.find((x) => x.id === 'L');
        return r ? this.rackRect(r) : null;
      }
      case 'key':
        return box(keyId(arg));
      case 'entries': {
        const e = this.geo.entries;
        return e ? { x: e.x, y: e.y + (e.rows * e.rowH) / 2, w: e.w, h: e.rows * e.rowH } : null;
      }
      case 'chain': {
        const b = Number(arg);
        const s = box(slotId(R, b));
        const r = this.rackFor(this.table);
        if (!s || !r) return null;
        const n = Math.max(1, this.table.chains[b]?.length ?? 1);
        const bottom = nodeY(r, s.y, n - 1) + r.nodeH / 2;
        const topY = s.y - s.h / 2;
        return { x: s.x, y: (topY + bottom) / 2, w: s.w, h: bottom - topY };
      }
      case 'rack': {
        const r = this.cfg.view === 'pydict' ? this.geo.racks.find((x) => x.id.startsWith('P')) : this.rackFor(this.table);
        return r ? this.rackRect(r) : null;
      }
      default:
        return box(target);
    }
  }
}
