import { SIG } from '@/lib/sim/colors';
import { clamp, type Curve } from '@/lib/sim/geometry';
import { PredictGame } from '@/lib/sim/predict';
import { mulberry32 } from '@/lib/sim/rng';
import { Sim, portCurve, type WireSpec } from '@/lib/sim/Sim';
import { fastRun, type FastResult, type FastSample, type Strategy } from './fastrun';
import {
  bankProgram,
  counterProgram,
  seatProgram,
  transferProgram,
  type BankMode,
  type CounterKind,
  type Ctx,
  type DLStrategy,
  type Instr,
  type LockOrder,
  type Program,
  type SeatMode,
  type TId,
  type Val,
} from './programs';

export const TCOLOR: Record<TId, string> = { A: SIG.pink, B: SIG.teal, C: SIG.lime, D: SIG.blue };
const ALL: TId[] = ['A', 'B', 'C', 'D'];

export type SceneKind = 'counter' | 'deadlock' | 'seat' | 'bank';
export type Mode = 'plan' | 'manual' | 'auto' | 'alternate' | 'run' | 'idle';

export interface RaceCfg {
  scene: SceneKind;
  counter?: CounterKind;
  /** Increments per thread in the animated counter */
  iters?: number;
  seat?: SeatMode;
  bank?: BankMode;
  orders?: [LockOrder, LockOrder];
  dl?: DLStrategy;
  mode: Mode;
  plan?: TId[];
  loop?: boolean;
  predict?: 'count' | 'lock';
  /** Draw the critical-section band on the thread cards */
  crit?: boolean;
  timeline?: boolean;
  chart?: boolean;
  /** Run mode (the 1,000-increment experiment) */
  threads?: number;
  strategy?: Strategy;
  per?: number;
  work?: number;
  start?: number;
  focus?: TId[];
  /** Start one run of the experiment as soon as the step opens */
  autoRun?: boolean;
}

export type ThreadStatus = 'ready' | 'busy' | 'blocked' | 'done' | 'sleep';

export interface ThreadState {
  id: TId;
  name: string;
  /** Name for narrow (phone) cards */
  short: string;
  who: string;
  color: string;
  prog: Program;
  pc: number;
  iter: number;
  regs: Record<string, Val | null>;
  /** Version of each cell when this thread last read it */
  seen: Record<string, number>;
  status: ThreadStatus;
  waitFor: string | null;
  holds: string[];
  result: { text: string; ok: boolean } | null;
  /** Instruction executing right now */
  exec: number | null;
  /** Result shown next to each executed line */
  vals: (string | null)[];
  flashAt: number;
  /** A register just changed by arithmetic: show a small badge */
  addAt: number;
  addText: string;
  timeoutAt: number | null;
  sleepUntil: number | null;
  lastRanAt: number;
  failMsg: string | null;
  inside: boolean;
  waited: boolean;
  retries: number;
}

export interface CellState {
  id: string;
  label: string;
  value: Val;
  prev: Val | null;
  ver: number;
  writer: TId | null;
  changedAt: number;
  lost: { value: Val; by: TId | null; at: number } | null;
  atomic: TId | null;
}

export interface LockState {
  id: string;
  label: string;
  owner: TId | null;
  queue: TId[];
  changedAt: number;
}

export type ChipTone = 'bad' | 'ok' | 'wait' | 'atomic' | 'fail';

export interface Chip {
  tid: TId;
  code: string;
  val?: string;
  tone?: ChipTone;
}

export interface RunSummary {
  id: number;
  strategy: Strategy;
  threads: number;
  per: number;
  work: number;
  final: number;
  expected: number;
  lost: number;
  ticks: number;
  waitShare: number;
  retries: number;
}

export interface RoundResult {
  ok: boolean;
  text: string;
  final?: number;
  expected?: number;
}

/** Scripted interleavings for "predict the final count". */
export const COUNT_ROUNDS: { plan: TId[]; final: number; why: string }[] = [
  { plan: ['A', 'A', 'A', 'B', 'B', 'B'], final: 7, why: 'A stored 6 before B loaded, so B read 6 and wrote 7. The threads never overlapped.' },
  { plan: ['A', 'B', 'B', 'B', 'A', 'A'], final: 6, why: 'A loaded 5, then B did its whole increment (6). A still held the stale 5, added 1 and wrote 6 over B’s 6.' },
  { plan: ['A', 'A', 'B', 'A', 'B', 'B'], final: 6, why: 'B loaded 5 before A stored its 6. Both computed 6, so the second store just repeated the first.' },
  { plan: ['B', 'B', 'B', 'A', 'A', 'A'], final: 7, why: 'B finished before A loaded. Taking turns is always safe.' },
  { plan: ['A', 'B', 'A', 'B', 'A', 'B'], final: 6, why: 'Both loaded 5 before either stored. Classic lost update.' },
];

const D = { flight: 0.8, local: 0.55, lock: 0.55, bump: 0.45, handoff: 0.55, check: 0.6, work: 0.75, half: 0.45, cas: 0.75, inc: 0.6 };

const isMem = (id: string) => id.startsWith('c:') || id.startsWith('l:');
const fmt = (v: Val | null | undefined) => (v == null ? '·' : String(v));

export class RaceSim extends Sim {
  cfg: RaceCfg = { scene: 'counter', counter: 'basic', mode: 'idle' };
  scene: SceneKind = 'counter';
  threads: ThreadState[] = [];
  cells: CellState[] = [];
  locks: LockState[] = [];
  hist: Chip[] = [];
  game: PredictGame | null = null;
  busy: TId | null = null;
  plan: TId[] = [];
  planPos = 0;
  /** Plan waits for the learner's prediction */
  holdPlan = false;
  roundOver = false;
  round = 0;
  lostCount = 0;
  deadlocked = false;
  deadlockAt = 0;
  result: RoundResult | null = null;
  outcomes: number[] = [];
  /** Bank / seat outcomes, e.g. 'double' | 'ok' */
  tags: string[] = [];

  /* run mode */
  run: { res: FastResult; t0: number; dur: number; shownLost: number; fxAt: number; flyAt: number; flip: boolean } | null = null;
  runs: RunSummary[] = [];
  strategy: Strategy = 'none';
  nThreads = 2;
  per = 1000;
  work = 0;
  private runSeq = 0;

  /* deadlock builder */
  orders: [LockOrder, LockOrder] = ['ab', 'ba'];
  dl: DLStrategy = 'wait';
  dlOutcomes = new Set<string>();
  /** Playground challenges completed */
  badges = new Set<string>();
  /** Some thread has blocked on a lock during this step */
  sawBlock = false;

  seatMode: SeatMode = 'racy';
  bankMode: BankMode = 'racy';

  private gapLeft = 0;
  private asked = new Set<string>();
  private countRound = 0;
  private rnd = mulberry32(7);

  /* ================================================================ */
  /* Entering steps                                                   */
  /* ================================================================ */

  enter(cfg: RaceCfg) {
    this.cfg = { ...cfg };
    this.scene = cfg.scene;
    this.clearTransient();
    this.game = cfg.predict ? new PredictGame(this, 3) : null;
    this.runs = [];
    this.run = null;
    this.outcomes = [];
    this.tags = [];
    this.dlOutcomes = new Set();
    this.badges = new Set();
    this.sawBlock = false;
    this.round = 0;
    this.countRound = 0;
    this.rnd = mulberry32(7);
    this.orders = cfg.orders ?? ['ab', 'ba'];
    this.dl = cfg.dl ?? 'wait';
    this.seatMode = cfg.seat ?? 'racy';
    this.bankMode = cfg.bank ?? 'racy';
    this.strategy = cfg.strategy ?? 'none';
    this.nThreads = cfg.threads ?? 2;
    this.per = cfg.per ?? 1000;
    this.work = cfg.work ?? 0;
    this.newRound();
    this.runScript([]);
    if (cfg.mode === 'run' && cfg.autoRun) this.after(0.8, () => this.startRun());
    this.rev++;
  }

  /** Reset threads, memory and locks for a fresh round of the current scene. */
  newRound() {
    this.clearTransient();
    this.busy = null;
    this.hist = [];
    this.planPos = 0;
    this.roundOver = false;
    this.lostCount = 0;
    this.deadlocked = false;
    this.result = null;
    this.gapLeft = 0.5;
    this.holdPlan = false;
    this.asked.clear();
    this.plan = [...(this.cfg.plan ?? [])];

    const cfg = this.cfg;
    const mk = (id: TId, prog: Program, name?: string, short?: string, who?: string) => this.makeThread(id, prog, name, short, who);

    if (this.scene === 'deadlock') {
      this.threads = [mk('A', transferProgram('A', this.orders[0], this.dl)), mk('B', transferProgram('B', this.orders[1], this.dl))];
      this.cells = [];
      this.locks = [this.makeLock('alice', 'alice'), this.makeLock('bob', 'bob')];
    } else if (this.scene === 'seat') {
      this.threads = [
        mk('A', seatProgram('alice', this.seatMode), 'Alice’s request', 'Alice', 'alice'),
        mk('B', seatProgram('bob', this.seatMode), 'Bob’s request', 'Bob', 'bob'),
      ];
      this.cells = [this.makeCell('seat', 'seat 14C', 'free')];
      this.locks = [];
      this.plan = this.seatMode === 'atomic' ? ['A', 'B'] : ['A', 'B', 'A', 'B', 'A', 'B'];
    } else if (this.scene === 'bank') {
      const p = bankProgram(this.bankMode);
      this.threads = [mk('A', p, 'Withdraw $80 · ATM', 'ATM −$80'), mk('B', p, 'Withdraw $80 · app', 'App −$80')];
      this.cells = [this.makeCell('balance', 'balance', 100), this.makeCell('version', 'version', 7)];
      this.locks = this.bankMode === 'forupdate' ? [this.makeLock('row', 'row lock')] : [];
      this.plan =
        this.bankMode === 'forupdate'
          ? ['A', 'B', 'A', 'A', 'A', 'B', 'B', 'B']
          : this.bankMode === 'optimistic'
            ? ['A', 'B', 'A', 'B', 'A', 'B', 'B', 'B']
            : ['A', 'B', 'A', 'B', 'A', 'B'];
    } else {
      const kind: CounterKind = cfg.mode === 'run' ? this.runKind() : (cfg.counter ?? 'basic');
      const n = cfg.mode === 'run' ? this.nThreads : 2;
      const run = cfg.mode === 'run';
      this.threads = ALL.slice(0, n).map((id) => mk(id, counterProgram(kind, run ? this.per : (cfg.iters ?? 1), run && this.work > 0)));
      this.cells = [this.makeCell('count', 'count', cfg.mode === 'run' ? 0 : (cfg.start ?? 5))];
      this.locks = kind === 'mutex' ? [this.makeLock('mu', 'mu')] : [];
    }

    if (cfg.predict === 'count') {
      const r = COUNT_ROUNDS[this.countRound % COUNT_ROUNDS.length];
      this.plan = [...r.plan];
      if (this.game && !this.game.done) {
        this.holdPlan = true;
        this.after(0.7, () => this.askCount());
      }
    }
    if (cfg.predict === 'lock') {
      const [f, s]: TId[] = this.round % 2 === 0 ? ['A', 'B'] : ['B', 'A'];
      this.plan = [f, f, s, f, f, f, s, s, s, s];
    }
    if (this.scene === 'deadlock' && cfg.mode === 'alternate') this.plan = ['A', 'B'];
    this.syncBoxes();
    this.rev++;
  }

  private makeThread(id: TId, prog: Program, name?: string, short?: string, who?: string): ThreadState {
    return {
      id,
      name: name ?? `Thread ${id}`,
      short: short ?? name ?? `Thread ${id}`,
      who: who ?? id,
      color: TCOLOR[id],
      prog,
      pc: 0,
      iter: 0,
      regs: Object.fromEntries(prog.regs.map((r) => [r, null])),
      seen: {},
      status: 'ready',
      waitFor: null,
      holds: [],
      result: null,
      exec: null,
      vals: [],
      flashAt: -10,
      addAt: -10,
      addText: '',
      timeoutAt: null,
      sleepUntil: null,
      lastRanAt: -1,
      failMsg: null,
      inside: false,
      waited: false,
      retries: 0,
    };
  }

  private makeCell(id: string, label: string, value: Val): CellState {
    return { id, label, value, prev: null, ver: 0, writer: null, changedAt: -10, lost: null, atomic: null };
  }

  private makeLock(id: string, label: string): LockState {
    return { id, label, owner: null, queue: [], changedAt: -10 };
  }

  private runKind(): CounterKind {
    return this.strategy === 'none' ? 'basic' : this.strategy;
  }

  /** Which boxes exist right now; everything else fades out. */
  private syncBoxes() {
    const live = new Set<string>();
    for (const c of this.cells) live.add(`c:${c.id}`);
    for (const l of this.locks) live.add(`l:${l.id}`);
    for (const t of this.threads) {
      live.add(`t:${t.id}`);
      if (this.showRegs()) live.add(`r:${t.id}`);
    }
    if (this.cfg.chart) live.add('chart');
    else if (this.cfg.timeline) live.add('tl');
    for (const id of live) this.box(id);
    for (const id of [...this.boxes.keys()]) if (!live.has(id)) this.hide(id);
    this.relayout();
  }

  showRegs() {
    return this.scene !== 'deadlock' && this.cfg.mode !== 'run' && this.threads.some((t) => t.prog.regs.length > 0);
  }

  /* ================================================================ */
  /* Methods the panel calls                                          */
  /* ================================================================ */

  thread(id: TId) {
    return this.threads.find((t) => t.id === id) ?? null;
  }

  cell(id: string) {
    return this.cells.find((c) => c.id === id) ?? null;
  }

  lock(id: string) {
    return this.locks.find((l) => l.id === id) ?? null;
  }

  /** Manual scheduling: why a thread can't run right now (or null if it can). */
  blockedReason(id: TId): string | null {
    const t = this.thread(id);
    if (!t) return 'missing';
    if (this.roundOver) return 'round over';
    if (t.status === 'done') return 'done';
    if (t.status === 'blocked') return `waiting for ${t.waitFor}`;
    if (this.busy) return 'busy';
    return null;
  }

  runNext(id: TId) {
    if (this.cfg.mode !== 'manual') return;
    const t = this.thread(id);
    if (!t || this.blockedReason(id)) return;
    this.begin(t);
  }

  restartRound() {
    this.round++;
    this.newRound();
  }

  /** Run mode */
  setStrategy(s: Strategy) {
    if (this.run) return;
    this.strategy = s;
    this.newRound();
  }

  setThreads(n: number) {
    if (this.run) return;
    this.nThreads = n;
    this.newRound();
  }

  setPer(n: number) {
    if (this.run) return;
    this.per = n;
    this.newRound();
  }

  setWork(n: number) {
    if (this.run) return;
    this.work = n;
    this.newRound();
  }

  clearRuns() {
    this.runs = [];
    this.rev++;
  }

  startRun() {
    if (this.cfg.mode !== 'run' || this.run) return;
    this.newRound();
    const seed = 1000 + this.runSeq * 7919 + this.nThreads * 31 + this.per;
    const res = fastRun({ strategy: this.strategy, threads: this.nThreads, per: this.per, work: this.work, start: 0 }, mulberry32(seed));
    const dur = clamp(1.8 + res.ticks / 6000, 2.2, 7);
    this.run = { res, t0: this.t, dur, shownLost: 0, fxAt: -1, flyAt: 0, flip: false };
    this.rev++;
  }

  /** Where the running experiment is right now. */
  runSample(): FastSample | null {
    const r = this.run;
    if (!r) return null;
    const k = clamp((this.t - r.t0) / r.dur, 0, 1);
    const s = r.res.samples;
    return s[Math.min(s.length - 1, Math.floor(k * (s.length - 1)))];
  }

  runProgress() {
    const r = this.run;
    return r ? clamp((this.t - r.t0) / r.dur, 0, 1) : 0;
  }

  /** Deadlock builder */
  setOrder(i: 0 | 1, o: LockOrder) {
    const next: [LockOrder, LockOrder] = [...this.orders];
    next[i] = o;
    this.orders = next;
    this.restartRound();
  }

  setDL(s: DLStrategy) {
    this.dl = s;
    this.restartRound();
  }

  setSeatMode(m: SeatMode) {
    this.seatMode = m;
    this.restartRound();
  }

  setBankMode(m: BankMode) {
    this.bankMode = m;
    this.restartRound();
  }

  /* ================================================================ */
  /* Scheduling                                                       */
  /* ================================================================ */

  protected step(dt: number) {
    if (this.cfg.mode === 'run') {
      this.stepRun();
      return;
    }
    for (const t of this.threads) {
      if (t.status === 'sleep' && t.sleepUntil != null && this.t >= t.sleepUntil) {
        t.status = 'ready';
        t.sleepUntil = null;
        this.rev++;
      }
    }
    if (this.busy || this.roundOver || this.deadlocked || this.holdPlan) return;
    for (const t of this.threads) {
      if (t.status === 'blocked' && t.timeoutAt != null && this.t >= t.timeoutAt) {
        this.timeOut(t);
        return;
      }
    }
    if (this.gapLeft > 0) {
      this.gapLeft -= dt;
      return;
    }
    const next = this.pickNext();
    if (!next) {
      this.checkStuck();
      return;
    }
    if (this.hook(next)) return;
    this.begin(next);
  }

  private pickNext(): ThreadState | null {
    const ready = this.threads.filter((t) => t.status === 'ready');
    if (!ready.length) return null;
    const mode = this.cfg.mode;
    if (mode === 'manual' || mode === 'idle') return null;
    if (mode === 'plan' || mode === 'alternate') {
      while (this.planPos < this.plan.length) {
        const t = this.thread(this.plan[this.planPos]);
        if (t && t.status === 'ready') return t;
        if (t && (t.status === 'blocked' || t.status === 'sleep') && !ready.length) return null;
        this.planPos++;
      }
      return [...ready].sort((a, b) => a.lastRanAt - b.lastRanAt)[0];
    }
    // auto: random, with a tendency to keep running the same thread for a bit
    const last = this.hist[this.hist.length - 1]?.tid;
    const same = ready.find((t) => t.id === last);
    if (same && this.rnd() < 0.5) return same;
    return ready[Math.floor(this.rnd() * ready.length)];
  }

  private gap() {
    return this.cfg.mode === 'auto' ? 0.15 : this.cfg.mode === 'manual' ? 0 : 0.35;
  }

  /* ================================================================ */
  /* Predictions                                                      */
  /* ================================================================ */

  private askCount() {
    const g = this.game;
    if (!g || g.done) {
      this.holdPlan = false;
      return;
    }
    const r = COUNT_ROUNDS[this.countRound % COUNT_ROUNDS.length];
    g.ask({
      acceptable: [String(r.final)],
      choices: [
        { id: '5', label: 'count = 5' },
        { id: '6', label: 'count = 6' },
        { id: '7', label: 'count = 7' },
      ],
      ask: 'What will count be at the end?',
      askAt: { id: 'c:count' },
      explain: (picked, ok) => (ok ? r.why : picked === '5' ? `Each thread stores at least 6, so 5 is impossible. ${r.why}` : r.why),
      resolve: () => {
        this.holdPlan = false;
        this.gapLeft = 0.3;
      },
    });
  }

  /** Lock-step questions asked just before an instruction runs. */
  private hook(t: ThreadState): boolean {
    const g = this.game;
    if (!g || g.done || this.cfg.predict !== 'lock') return false;
    const ins = t.prog.instrs[t.pc];
    const mu = this.lock('mu');
    if (!mu) return false;
    const other = this.threads.find((x) => x.id !== t.id);
    const O = other?.id ?? '?';
    const go = () => {
      this.gapLeft = 0.25;
      this.begin(t);
    };
    if (ins.op === 'lock' && mu.owner && mu.owner !== t.id && !this.asked.has('q1')) {
      this.asked.add('q1');
      return g.ask({
        acceptable: ['wait'],
        choices: [
          { id: 'wait', label: `${t.id} waits` },
          { id: 'both', label: `${t.id} gets it too` },
          { id: 'kick', label: `${O} loses the lock` },
        ],
        ask: `${t.id} tries LOCK, but ${O} holds mu. What happens?`,
        askAt: { id: `t:${t.id}` },
        explain: () => `A mutex has exactly one owner. ${t.id} blocks: the OS puts it to sleep until ${O} unlocks.`,
        resolve: go,
      });
    }
    if (ins.op === 'unlock' && mu.queue.length && !this.asked.has('q2')) {
      this.asked.add('q2');
      return g.ask({
        acceptable: ['take'],
        choices: [
          { id: 'take', label: `${O} takes mu, carries on` },
          { id: 'restart', label: `${O} starts over` },
          { id: 'sleep', label: `${O} keeps sleeping` },
        ],
        ask: `${t.id} unlocks while ${O} waits. Then what?`,
        askAt: { id: `t:${O}` },
        explain: () => `Unlocking wakes a waiter. ${O} takes the mutex and continues right after its LOCK line.`,
        resolve: go,
      });
    }
    if (ins.op === 'load' && t.waited && !this.asked.has('q3')) {
      this.asked.add('q3');
      const c = this.cell('count');
      const v = String(c?.value ?? '?');
      return g.ask({
        acceptable: [v],
        choices: [
          { id: '5', label: 'reads 5' },
          { id: '6', label: 'reads 6' },
          { id: '7', label: 'reads 7' },
        ],
        ask: `${t.id} loads count now. What does it read?`,
        askAt: { id: 'c:count' },
        explain: () => `${O} stored 6 before unlocking, and ${t.id} could only load after taking the lock. It reads 6, so the final count is 7.`,
        resolve: go,
      });
    }
    return false;
  }

  /* ================================================================ */
  /* Executing one instruction (animated)                             */
  /* ================================================================ */

  private ctx(t: ThreadState): Ctx {
    return { regs: t.regs, who: t.who };
  }

  /** Where a thread's data flights start and end. */
  private port(t: ThreadState) {
    return this.showRegs() && this.isLive(`r:${t.id}`) ? `r:${t.id}` : `t:${t.id}`;
  }

  private begin(t: ThreadState) {
    if ((this.cfg.mode === 'plan' || this.cfg.mode === 'alternate') && this.plan[this.planPos] === t.id) this.planPos++;
    const ins = t.prog.instrs[t.pc];
    if (!ins) return;
    this.busy = t.id;
    t.status = 'busy';
    t.exec = t.pc;
    t.lastRanAt = this.t;
    if (t.prog.crit && t.pc === t.prog.crit[0]) t.inside = true;
    this.rev++;
    switch (ins.op) {
      case 'inc':
        return this.opInc(t);
      case 'load':
        return this.opLoad(t, ins);
      case 'add':
        return this.opAdd(t, ins);
      case 'store':
        return this.opStore(t, ins);
      case 'lock':
      case 'trylock':
        return this.opLock(t, ins);
      case 'unlock':
        return this.opUnlock(t, ins);
      case 'faa':
        return this.opFaa(t, ins);
      case 'cas':
        return this.opCas(t, ins);
      case 'check':
        return this.opCheck(t, ins);
      case 'work':
        return this.opWork(t, ins);
    }
  }

  /** A floating note just below a box (the gap under the memory row is free). */
  private note(id: string, text: string, color: string, dur = 1.6) {
    const b = this.boxes.get(id);
    this.fx({ kind: 'text', at: { id, dy: (b?.h ?? 20) / 2 + 26 }, text, color, dur });
  }

  /** Where a lock's padlock icon sits. */
  private padlockAt(id: string) {
    const b = this.boxes.get(`l:${id}`);
    const P = this.orient === 'portrait';
    return { id: `l:${id}`, dx: -(b?.w ?? 0) / 2 + (P ? 16 : 24), dy: -1 };
  }

  private write(c: CellState, v: Val, by: TId) {
    c.prev = c.value;
    c.value = v;
    c.ver++;
    c.writer = by;
    c.changedAt = this.vt;
  }

  private opInc(t: ThreadState) {
    const c = this.cell('count');
    if (!c) return;
    const v = Number(c.value);
    this.send({
      from: 'c:count',
      to: `t:${t.id}`,
      dur: D.inc,
      color: t.color,
      label: String(v),
      lane: 5,
      onArrive: () => {
        t.addAt = this.vt;
        t.addText = `${v} + 1`;
        this.after(0.3, () =>
          this.send({
            from: `t:${t.id}`,
            to: 'c:count',
            dur: D.inc,
            color: t.color,
            label: String(v + 1),
            lane: -5,
            onArrive: () => {
              this.write(c, v + 1, t.id);
              this.fx({ kind: 'ring', at: { id: 'c:count' }, color: t.color, size: 1.4 });
              this.complete(t, { code: 'INC', val: `→${v + 1}` }, `→ ${v + 1}`);
            },
          }),
        );
      },
    });
  }

  private opLoad(t: ThreadState, ins: Instr) {
    const c = this.cell(ins.cell ?? '');
    if (!c) return;
    const v = c.value;
    const ver = c.ver;
    const extra = (ins.also ?? []).map((a) => ({ a, c: this.cell(a.cell) }));
    for (const e of extra) {
      if (e.c) this.send({ from: `c:${e.c.id}`, to: this.port(t), dur: D.flight, color: t.color, label: fmt(e.c.value), lane: 5 });
    }
    const snap = extra.map((e) => ({ reg: e.a.reg, v: e.c?.value ?? null, id: e.c?.id, ver: e.c?.ver ?? 0 }));
    this.send({
      from: `c:${c.id}`,
      to: this.port(t),
      dur: D.flight,
      color: t.color,
      label: fmt(v),
      lane: 5,
      onArrive: () => {
        t.regs[ins.reg ?? 'r'] = v;
        t.seen[c.id] = ver;
        for (const s of snap) {
          t.regs[s.reg] = s.v;
          if (s.id) t.seen[s.id] = s.ver;
        }
        t.flashAt = this.vt;
        const shown = [fmt(v), ...snap.map((s) => fmt(s.v))].join(', ');
        this.complete(t, { code: ins.code, val: shown }, shown);
      },
    });
  }

  private opAdd(t: ThreadState, ins: Instr) {
    const src = Number(t.regs[ins.src ?? 'r'] ?? 0);
    const v = src + (ins.n ?? 1);
    t.addAt = this.vt;
    t.addText = `+${ins.n ?? 1}`;
    this.after(D.local, () => {
      t.regs[ins.reg ?? 'r'] = v;
      t.flashAt = this.vt;
      this.complete(t, { code: ins.code, val: String(v) }, String(v));
    });
  }

  private opStore(t: ThreadState, ins: Instr) {
    const c = this.cell(ins.cell ?? '');
    if (!c) return;
    const v: Val = ins.put ? ins.put(this.ctx(t)) : (t.regs[ins.src ?? 'r'] ?? 0);
    this.send({
      from: this.port(t),
      to: `c:${c.id}`,
      dur: D.flight,
      color: t.color,
      label: fmt(v),
      lane: -5,
      onArrive: () => {
        const stale = t.seen[c.id] != null && t.seen[c.id] !== c.ver;
        if (stale) {
          c.lost = { value: c.value, by: c.writer, at: this.vt };
          this.lostCount++;
          this.fx({ kind: 'ring', at: { id: `c:${c.id}` }, color: SIG.err, size: 1.8 });
        } else {
          this.fx({ kind: 'ring', at: { id: `c:${c.id}` }, color: t.color, size: 1.4 });
        }
        this.write(c, v, t.id);
        t.inside = false;
        this.complete(t, { code: ins.code, val: fmt(v), tone: stale ? 'bad' : undefined }, fmt(v));
      },
    });
  }

  private opLock(t: ThreadState, ins: Instr) {
    const L = this.lock(ins.lock ?? '');
    if (!L) return;
    const acquired = () => {
      if (ins.thenLoad) {
        const c = this.cell(ins.thenLoad.cell);
        if (!c) return;
        const v = c.value;
        const ver = c.ver;
        const reg = ins.thenLoad.reg;
        this.send({
          from: `c:${c.id}`,
          to: this.port(t),
          dur: D.flight,
          color: t.color,
          label: fmt(v),
          lane: 5,
          onArrive: () => {
            t.regs[reg] = v;
            t.seen[c.id] = ver;
            t.flashAt = this.vt;
            this.complete(t, { code: ins.code, val: fmt(v), tone: 'ok' }, fmt(v));
          },
        });
      } else {
        this.complete(t, { code: ins.code, val: 'got', tone: 'ok' }, 'got it');
      }
    };
    if (L.owner === t.id) {
      // Woken up already holding it (a handoff): just continue.
      acquired();
      return;
    }
    if (L.owner == null) {
      this.send({
        from: `l:${L.id}`,
        to: this.port(t),
        dur: D.lock,
        color: SIG.hc,
        shape: 'square',
        r: 4.2,
        lane: 0,
        onArrive: () => {
          L.owner = t.id;
          L.changedAt = this.vt;
          t.holds.push(L.id);
          this.rev++;
          acquired();
        },
      });
      return;
    }
    // Held by someone else: block.
    this.send({
      from: this.port(t),
      to: `l:${L.id}`,
      dur: D.bump,
      color: t.color,
      lane: 0,
      onArrive: () => {
        this.fx({ kind: 'x', at: this.padlockAt(L.id), color: SIG.warn, size: 1.1 });
        L.queue.push(t.id);
        L.changedAt = this.vt;
        t.status = 'blocked';
        t.waitFor = L.id;
        t.exec = null;
        t.waited = true;
        if (ins.op === 'trylock') t.timeoutAt = this.t + (ins.timeout ?? 1.5);
        this.hist.push({ tid: t.id, code: ins.code, val: 'wait', tone: 'wait' });
        this.sawBlock = true;
        this.busy = null;
        this.gapLeft = this.gap();
        this.rev++;
        this.checkStuck();
      },
    });
  }

  private opUnlock(t: ThreadState, ins: Instr) {
    const L = this.lock(ins.lock ?? '');
    if (!L) return;
    this.send({
      from: this.port(t),
      to: `l:${L.id}`,
      dur: D.lock,
      color: SIG.hc,
      shape: 'square',
      r: 4.2,
      lane: 0,
      onArrive: () => {
        this.releaseLock(t, L);
        this.hist.push({ tid: t.id, code: ins.code });
        t.vals[t.pc] = 'released';
        const n = L.queue.shift();
        if (n) this.handoff(L, n, () => this.complete(t, null));
        else this.complete(t, null);
      },
    });
  }

  private releaseLock(t: ThreadState, L: LockState) {
    L.owner = null;
    L.changedAt = this.vt;
    t.holds = t.holds.filter((h) => h !== L.id);
    this.rev++;
  }

  private handoff(L: LockState, id: TId, then: () => void) {
    const n = this.thread(id);
    if (!n) return then();
    this.send({
      from: `l:${L.id}`,
      to: this.port(n),
      dur: D.handoff,
      color: SIG.hc,
      shape: 'square',
      r: 4.2,
      lane: 0,
      onArrive: () => {
        L.owner = n.id;
        L.changedAt = this.vt;
        n.holds.push(L.id);
        n.waitFor = null;
        n.timeoutAt = null;
        n.status = 'ready';
        const ins = n.prog.instrs[n.pc];
        if (ins && !ins.thenLoad) {
          n.vals[n.pc] = 'got it';
          this.hist.push({ tid: n.id, code: ins.code, val: 'got', tone: 'ok' });
          this.advancePc(n);
        }
        this.rev++;
        then();
      },
    });
  }

  private opFaa(t: ThreadState, ins: Instr) {
    const c = this.cell(ins.cell ?? 'count');
    if (!c) return;
    c.atomic = t.id;
    this.send({
      from: this.port(t),
      to: `c:${c.id}`,
      dur: D.half,
      color: SIG.warn,
      label: '+1',
      lane: -5,
      onArrive: () => {
        const old = Number(c.value);
        this.write(c, old + 1, t.id);
        this.fx({ kind: 'ring', at: { id: `c:${c.id}` }, color: SIG.warn, size: 1.5 });
        this.send({
          from: `c:${c.id}`,
          to: this.port(t),
          dur: D.half,
          color: t.color,
          label: String(old),
          lane: 5,
          onArrive: () => {
            t.regs[ins.reg ?? 'r'] = old;
            t.flashAt = this.vt;
            c.atomic = null;
            this.complete(t, { code: ins.code, val: `${old}→${old + 1}`, tone: 'atomic' }, `${old} → ${old + 1}`);
          },
        });
      },
    });
  }

  private opCas(t: ThreadState, ins: Instr) {
    const c = this.cell(ins.cell ?? '');
    if (!c) return;
    const ctx = this.ctx(t);
    const exp = ins.expect ? ins.expect(ctx) : 0;
    const nv = ins.next ? ins.next(ctx) : 0;
    c.atomic = t.id;
    const label = c.id === 'version' ? `v${exp}?` : c.id === 'seat' ? `if ${exp}` : `${exp}→${nv}?`;
    this.send({
      from: this.port(t),
      to: `c:${c.id}`,
      dur: D.cas,
      color: SIG.warn,
      label,
      lane: -5,
      onArrive: () => {
        c.atomic = null;
        if (c.value === exp) {
          this.write(c, nv, t.id);
          for (const w of ins.alsoWrite ?? []) {
            const o = this.cell(w.cell);
            if (o) this.write(o, w.val(ctx), t.id);
          }
          this.fx({ kind: 'ring', at: { id: `c:${c.id}` }, color: SIG.res, size: 1.5 });
          this.note(`c:${c.id}`, c.id === 'version' ? '1 row updated' : c.id === 'seat' ? '1 row updated' : 'swapped ✓', SIG.res, 1.4);
          this.complete(t, { code: ins.code, val: 'ok', tone: 'ok' }, 'success');
        } else {
          t.retries++;
          this.fx({ kind: 'x', at: { id: `c:${c.id}` }, color: SIG.err, size: 1.3 });
          this.note(
            `c:${c.id}`,
            c.id === 'version' ? `0 rows: version is now ${c.value}` : c.id === 'seat' ? `0 rows: already ${c.value}’s` : `${c.label} is ${c.value}, not ${exp}`,
            SIG.err,
            2,
          );
          if (ins.retryTo != null) this.complete(t, { code: ins.code, val: 'retry', tone: 'fail' }, 'failed → retry', ins.retryTo);
          else this.complete(t, { code: ins.code, val: 'no', tone: 'fail' }, 'failed', 'end', ins.failMsg ?? 'failed');
        }
      },
    });
  }

  private opCheck(t: ThreadState, ins: Instr) {
    const ok = ins.test ? ins.test(this.ctx(t)) : true;
    t.addAt = this.vt;
    t.addText = ok ? (ins.pass ?? 'yes') : (ins.fail ?? 'no');
    this.after(D.check, () => {
      if (ok) this.complete(t, { code: ins.code, val: 'yes', tone: 'ok' }, 'yes');
      else {
        t.failMsg = ins.failMsg ?? 'failed';
        this.complete(t, { code: ins.code, val: 'no', tone: 'fail' }, 'no', ins.failTo ?? 'end', t.failMsg);
      }
    });
  }

  private opWork(t: ThreadState, ins: Instr) {
    const [a, b] = t.id === 'A' ? ['l:alice', 'l:bob'] : ['l:bob', 'l:alice'];
    if (this.isLive(a) && this.isLive(b)) this.send({ from: a, to: b, dur: D.work, color: SIG.res, label: '$10', lane: t.id === 'A' ? 6 : -6 });
    this.after(D.work + 0.05, () => this.complete(t, { code: ins.code, val: '10' }, 'moved'));
  }

  /** Finish the executing instruction and move the program counter. */
  private complete(t: ThreadState, chip: Omit<Chip, 'tid'> | null, shown?: string, jump?: number | 'end', failMsg?: string) {
    if (chip) this.hist.push({ tid: t.id, ...chip });
    if (t.exec != null && shown != null) t.vals[t.exec] = shown;
    t.exec = null;
    if (t.status === 'busy') t.status = 'ready';
    if (jump === 'end') this.finish(t, false, failMsg ?? t.failMsg ?? 'gave up');
    else if (typeof jump === 'number') {
      t.pc = jump;
      t.vals = t.vals.map((v, i) => (i < jump ? v : null));
    } else this.advancePc(t);
    this.busy = null;
    this.gapLeft = this.gap();
    this.rev++;
    if (this.threads.every((x) => x.status === 'done')) this.endRound();
    else this.checkStuck();
  }

  private advancePc(t: ThreadState) {
    t.pc++;
    if (t.pc >= t.prog.instrs.length) {
      t.iter++;
      if (t.iter < (t.prog.iters ?? 1)) {
        t.pc = 0;
        t.vals = [];
      } else {
        this.finish(t, !t.failMsg, t.failMsg ?? t.prog.okMsg ?? 'done');
      }
    }
  }

  private finish(t: ThreadState, ok: boolean, text: string) {
    t.status = 'done';
    t.result = { text, ok };
    t.inside = false;
    t.flashAt = this.vt;
  }

  /** A try-lock gave up: release everything, back off, start over. */
  private timeOut(t: ThreadState) {
    const L = this.lock(t.waitFor ?? '');
    if (L) L.queue = L.queue.filter((x) => x !== t.id);
    const ins = t.prog.instrs[t.pc];
    t.waitFor = null;
    t.timeoutAt = null;
    t.status = 'busy';
    this.busy = t.id;
    this.hist.push({ tid: t.id, code: ins?.code ?? 'TL', val: 'gave up', tone: 'fail' });
    t.addAt = this.vt;
    t.addText = 'timed out';
    const next = () => {
      const held = t.holds[t.holds.length - 1];
      const HL = held ? this.lock(held) : null;
      if (!HL) {
        t.status = 'sleep';
        t.sleepUntil = this.t + 1.1 + this.rnd() * 0.6;
        t.pc = 0;
        t.vals = [];
        this.busy = null;
        this.gapLeft = this.gap();
        this.rev++;
        return;
      }
      this.send({
        from: this.port(t),
        to: `l:${HL.id}`,
        dur: D.lock,
        color: SIG.hc,
        shape: 'square',
        r: 4.2,
        lane: 0,
        onArrive: () => {
          this.releaseLock(t, HL);
          this.hist.push({ tid: t.id, code: 'UL' });
          const n = HL.queue.shift();
          if (n) this.handoff(HL, n, next);
          else next();
        },
      });
    };
    next();
  }

  private checkStuck() {
    if (this.deadlocked || this.busy) return;
    const alive = this.threads.filter((t) => t.status !== 'done');
    if (!alive.length) return;
    if (alive.some((t) => t.status === 'ready' || t.status === 'busy' || t.status === 'sleep')) return;
    if (alive.some((t) => t.timeoutAt != null)) return;
    this.deadlocked = true;
    this.deadlockAt = this.t;
    this.dlOutcomes.add('deadlock');
    for (const l of this.locks) this.fx({ kind: 'ring', at: { id: `l:${l.id}` }, color: SIG.err, size: 1.8 });
    this.result = { ok: false, text: 'Deadlock: both threads wait forever' };
    this.rev++;
  }

  private endRound() {
    this.roundOver = true;
    const r = this.evaluate();
    this.result = r;
    if (r.final != null) this.outcomes.push(r.final);
    const c = this.cells[0];
    if (c) this.fx({ kind: 'ring', at: { id: `c:${c.id}` }, color: r.ok ? SIG.res : SIG.err, size: 2.2 });
    if (this.scene === 'deadlock') {
      if (this.orders[0] === this.orders[1]) this.dlOutcomes.add('ordered');
      else if (this.dl === 'trylock') this.dlOutcomes.add('trylock');
    }
    this.rev++;
    const again = (delay: number) =>
      this.after(delay, () => {
        this.round++;
        this.newRound();
      });
    if (this.cfg.predict === 'count') {
      this.after(2.6, () => {
        this.countRound++;
        this.round++;
        this.newRound();
      });
    } else if (this.cfg.predict === 'lock') again(2.6);
    else if (this.cfg.loop) again(this.cfg.mode === 'auto' ? 1.6 : 3.2);
  }

  /** Did this round come out right? */
  private evaluate(): RoundResult {
    if (this.scene === 'counter') {
      const c = this.cell('count');
      const start = this.cfg.start ?? 5;
      const expected = start + this.threads.reduce((a, t) => a + (t.prog.iters ?? 1), 0);
      const final = Number(c?.value ?? 0);
      const lost = expected - final;
      return {
        ok: lost === 0,
        final,
        expected,
        text: lost === 0 ? `count = ${final}: correct` : `count = ${final}, expected ${expected}: ${lost} update${lost > 1 ? 's' : ''} lost`,
      };
    }
    if (this.scene === 'seat') {
      const booked = this.threads.filter((t) => t.result?.ok).length;
      const owner = String(this.cell('seat')?.value ?? '');
      this.tags.push(booked > 1 ? 'double' : 'ok');
      return booked > 1
        ? { ok: false, text: `Both got a confirmation. The seat says ${owner}.` }
        : { ok: true, text: `One booking (${owner}). The other was told it's sold out.` };
    }
    if (this.scene === 'bank') {
      const paid = this.threads.filter((t) => t.result?.ok).length * 80;
      const bal = Number(this.cell('balance')?.value ?? 0);
      const ok = 100 - paid === bal && bal >= 0;
      this.tags.push(ok ? 'ok' : 'double');
      return ok ? { ok, text: `Paid $${paid}, balance $${bal}. The books balance.` } : { ok, text: `Paid out $${paid} from $100, balance says $${bal}.` };
    }
    return { ok: true, text: 'Both transfers finished' };
  }

  /* ================================================================ */
  /* Run mode: the 1,000-increment experiment, played back            */
  /* ================================================================ */

  private stepRun() {
    const r = this.run;
    if (!r) return;
    const s = this.runSample();
    const c = this.cell('count');
    if (s && c && c.value !== s.count) {
      c.value = s.count;
      c.changedAt = this.vt;
    }
    const mu = this.lock('mu');
    if (mu && s) {
      const o = s.owner >= 0 ? (ALL[s.owner] ?? null) : null;
      if (mu.owner !== o) {
        mu.owner = o;
        mu.changedAt = this.vt;
      }
      mu.queue = this.threads.filter((t, i) => s.waiting[i] && t.id !== o).map((t) => t.id);
    }
    if (s && s.lost > r.shownLost) {
      if (this.t - r.fxAt > 0.22) {
        r.fxAt = this.t;
        this.fx({ kind: 'ring', at: { id: 'c:count' }, color: SIG.err, size: 0.9, dur: 0.5 });
      }
      r.shownLost = s.lost;
    }
    // A few decorative loads/stores so the threads look busy.
    if (this.t - r.flyAt > 0.11 && this.runProgress() < 0.97) {
      r.flyAt = this.t;
      r.flip = !r.flip;
      const t = this.threads[Math.floor(this.rnd() * this.threads.length)];
      const i = this.threads.indexOf(t);
      if (t && s && !s.waiting[i] && s.done[i] < this.per) {
        const color = t.color;
        if (r.flip) this.send({ from: 'c:count', to: `t:${t.id}`, dur: 0.32, color, r: 3, trail: false, lane: 5 });
        else this.send({ from: `t:${t.id}`, to: 'c:count', dur: 0.32, color, r: 3, trail: false, lane: -5 });
      }
    }
    if (this.t - r.t0 >= r.dur) {
      const res = r.res;
      this.run = null;
      if (mu) {
        mu.owner = null;
        mu.queue = [];
      }
      if (c) {
        c.value = res.final;
        c.changedAt = this.vt;
      }
      this.runs = [
        ...this.runs,
        {
          id: ++this.runSeq,
          strategy: res.params.strategy,
          threads: res.params.threads,
          per: res.params.per,
          work: res.params.work,
          final: res.final,
          expected: res.expected,
          lost: res.lost,
          ticks: res.ticks,
          waitShare: res.waitShare,
          retries: res.retries,
        },
      ].slice(-6);
      this.result = res.lost
        ? { ok: false, text: `${res.final.toLocaleString('en-US')} of ${res.expected.toLocaleString('en-US')}: ${res.lost.toLocaleString('en-US')} increments lost` }
        : { ok: true, text: `${res.final.toLocaleString('en-US')} of ${res.expected.toLocaleString('en-US')}: exact` };
      this.fx({ kind: 'ring', at: { id: 'c:count' }, color: res.lost ? SIG.err : SIG.res, size: 2.4 });
      const p = res.params;
      if (p.strategy === 'none' && res.lost * 2 > res.expected) this.badges.add('half');
      if (p.strategy === 'none' && res.lost === 0) this.badges.add('lucky');
      if ((p.strategy === 'faa' || p.strategy === 'cas') && res.lost === 0 && p.per >= 1000) this.badges.add('lockfree');
      this.rev++;
    }
  }

  /* ================================================================ */
  /* Layout                                                           */
  /* ================================================================ */

  protected layout() {
    if (this.scene === 'deadlock') this.layoutDeadlock();
    else this.layoutFlow();
  }

  /** Card metrics shared with the scene. */
  metrics() {
    const P = this.orient === 'portrait';
    // Phones with 3-4 threads stack the cards in two rows, so squeeze them.
    const tight = P && this.threads.length > 2;
    return {
      P,
      tight,
      lh: tight ? 15 : P ? 19 : 25,
      head: tight ? 26 : P ? 30 : 48,
      pad: tight ? 5 : P ? 7 : 10,
      progress: this.cfg.mode === 'run' ? (tight ? 18 : P ? 20 : 28) : 0,
    };
  }

  private cardH(t: ThreadState) {
    const m = this.metrics();
    return m.head + t.prog.instrs.length * m.lh + m.pad + m.progress;
  }

  private layoutFlow() {
    const { w, h } = this;
    const P = this.orient === 'portrait';
    const n = this.threads.length;
    const regs = this.showRegs();
    const tight = this.metrics().tight;
    const top = P ? 76 : 84;
    // Phones: stay clear of the legend row above the playback controls.
    const bottom = h - (P ? 70 : 92);
    const cellH = tight ? 50 : P ? 58 : 90;
    const regH = regs ? (P ? 30 : 38) : 0;
    const cardH = Math.max(0, ...this.threads.map((t) => this.cardH(t)));
    const rows = P && n > 2 ? 2 : 1;
    let gapMR = tight ? 28 : P ? 40 : 60;
    const gapRC = regs ? 6 : 0;
    const rowGap = tight ? 8 : 12;
    let tlH = this.cfg.chart ? (tight ? 104 : P ? 128 : 170) : this.cfg.timeline ? (P ? 24 + n * 27 : 32 + n * 40) : 0;
    let gapCT = tlH ? (tight ? 12 : P ? 18 : 34) : 0;
    const blockH = regH + gapRC + cardH;
    let base = cellH + gapMR + rows * blockH + (rows - 1) * rowGap + gapCT + tlH;
    // Too tall (e.g. four 5-line mutex cards on a phone)? Squeeze the gap, then the chart.
    let over = base - (bottom - top);
    if (over > 0) {
      const cut = Math.min(over, gapMR - (P ? 18 : 34));
      gapMR -= cut;
      over -= cut;
    }
    if (over > 0 && this.cfg.chart) {
      const cut = Math.min(over, tlH - (P ? 80 : 120));
      tlH -= cut;
      over -= cut;
    }
    base = cellH + gapMR + rows * blockH + (rows - 1) * rowGap + gapCT + tlH;
    // Spread spare height: mostly into the flight gap under memory, some above the strip.
    const spare = Math.max(0, bottom - top - base);
    const addMR = Math.min(spare * 0.5, P ? 40 : 56);
    const addCT = tlH ? Math.min(spare * 0.25, P ? 24 : 34) : 0;
    gapMR += addMR;
    gapCT += addCT;
    const total = base + addMR + addCT;
    let y = top + Math.max(0, (bottom - top - total) / 2);

    this.layoutMemRow(y + cellH / 2, cellH);
    y += cellH + gapMR;

    const cols = rows === 2 ? 2 : n;
    const cardW = P ? (w - 42) / 2 : Math.min(n <= 2 ? 312 : 236, (w - 80 - (cols - 1) * 20) / cols);
    const xs: number[] = [];
    if (P) {
      for (let i = 0; i < n; i++) xs.push(i % 2 === 0 ? 16 + cardW / 2 : w - 16 - cardW / 2);
    } else if (n === 2) {
      const spread = Math.min(262, w * 0.27);
      xs.push(w / 2 - spread, w / 2 + spread);
    } else {
      for (let i = 0; i < n; i++) xs.push(w / 2 + (i - (n - 1) / 2) * (cardW + 20));
    }
    const regW = (t: ThreadState) => (t.prog.regs.length > 1 ? (P ? 130 : 180) : P ? 96 : 128);
    this.threads.forEach((t, i) => {
      const row = rows === 2 ? Math.floor(i / 2) : 0;
      const y0 = y + row * (blockH + rowGap);
      if (regs) this.place(`r:${t.id}`, xs[i], y0 + regH / 2, regW(t), regH);
      this.place(`t:${t.id}`, xs[i], y0 + regH + gapRC + cardH / 2, cardW, cardH);
    });
    y += rows * blockH + (rows - 1) * rowGap + gapCT;
    if (tlH) {
      const tw = P ? w - 24 : Math.min(w - 90, n > 2 ? 900 : 830);
      this.place(this.cfg.chart ? 'chart' : 'tl', w / 2, y + tlH / 2, tw, tlH);
    }
  }

  /** The shared-memory row: cells centered, locks to their right. */
  private layoutMemRow(cy: number, cellH: number) {
    const { w } = this;
    const P = this.orient === 'portrait';
    const cw = (c: CellState) => (this.scene === 'bank' ? (c.id === 'version' ? (P ? 78 : 118) : P ? 96 : 156) : P ? 118 : 188);
    const lw = P ? 102 : 172;
    const gap = P ? 10 : 22;
    const inner = P ? 6 : 8;
    const margin = P ? 14 : 30;
    const cellsW = this.cells.reduce((a, c) => a + cw(c), 0) + Math.max(0, this.cells.length - 1) * inner;
    const locksW = this.locks.length * (lw + gap);
    let x = w / 2 - cellsW / 2;
    if (x + cellsW + locksW > w - margin) x = Math.max(margin, w - margin - cellsW - locksW);
    for (const c of this.cells) {
      this.place(`c:${c.id}`, x + cw(c) / 2, cy, cw(c), cellH);
      x += cw(c) + inner;
    }
    x += gap - inner;
    for (const l of this.locks) {
      this.place(`l:${l.id}`, x + lw / 2, cy, lw, cellH);
      x += lw + gap;
    }
  }

  private layoutDeadlock() {
    const { w, h } = this;
    const P = this.orient === 'portrait';
    const m = this.metrics();
    const cardH = m.head + 5 * m.lh + m.pad;
    const cardW = P ? (w - 42) / 2 : 272;
    const lockW = P ? 118 : 172;
    const lockH = P ? 50 : 62;
    const tlH = this.cfg.timeline ? (P ? 76 : 110) : 0;
    let vgap = P ? 30 : 40;
    // On phones the result banner goes under the bob lock.
    const banner = P ? 34 : 0;
    let tlGap = tlH ? (P ? 10 : 28) : 0;
    const top = P ? 76 : 84;
    const bottom = h - (P ? 70 : 92);
    const base = lockH + vgap + cardH + vgap + lockH + banner + tlGap + tlH;
    const spare = Math.max(0, bottom - top - base);
    const addV = Math.min(spare * 0.3, P ? 16 : 30);
    vgap += addV;
    tlGap += Math.min(spare * 0.2, 24);
    const total = lockH + vgap + cardH + vgap + lockH + banner + tlGap + tlH;
    const y0 = top + Math.max(0, (bottom - top - total) / 2);
    const aliceY = y0 + lockH / 2;
    const cardY = y0 + lockH + vgap + cardH / 2;
    const bobY = cardY + cardH / 2 + vgap + lockH / 2;
    const spread = P ? w / 2 - 16 - cardW / 2 : Math.min(300, w * 0.31);
    this.place('l:alice', w / 2, aliceY, lockW, lockH);
    this.place('l:bob', w / 2, bobY, lockW, lockH);
    this.place('t:A', w / 2 - spread, cardY, cardW, cardH);
    this.place('t:B', w / 2 + spread, cardY, cardW, cardH);
    if (tlH) {
      const tw = P ? w - 24 : Math.min(w - 90, 830);
      this.place('tl', w / 2, bobY + lockH / 2 + banner + tlGap + tlH / 2, tw, tlH);
    }
  }

  protected wires(): WireSpec[] {
    if (this.scene === 'deadlock') return [];
    const out: WireSpec[] = [];
    const main = this.cells[0];
    if (!main) return out;
    for (const t of this.threads) {
      const to = this.showRegs() ? `r:${t.id}` : `t:${t.id}`;
      if (this.isLive(to)) out.push({ from: `c:${main.id}`, to, state: 'dashed' });
    }
    return out;
  }

  /** Flights between the memory row and a thread drop straight down (and back up). */
  protected curveFor(from: string, to: string, lane: number): Curve | null {
    const a = this.boxes.get(from);
    const b = this.boxes.get(to);
    if (!a || !b || Number.isNaN(a.x) || Number.isNaN(b.x)) return null;
    const threadSide = (id: string) => id.startsWith('r:') || id.startsWith('t:');
    if (this.scene !== 'deadlock' && ((isMem(from) && threadSide(to)) || (threadSide(from) && isMem(to)))) {
      const up = threadSide(from);
      const m = up ? b : a;
      const r = up ? a : b;
      const x0 = m.x + clamp((r.x - m.x) * 0.35, -m.w * 0.32, m.w * 0.32) + lane;
      const p0 = { x: x0, y: m.y + m.h / 2 };
      const p3 = { x: r.x + lane, y: r.y - r.h / 2 };
      const k = Math.max(16, (p3.y - p0.y) * 0.55);
      const c: Curve = { p0, p1: { x: p0.x, y: p0.y + k }, p2: { x: p3.x, y: p3.y - k }, p3 };
      return up ? { p0: c.p3, p1: c.p2, p2: c.p1, p3: c.p0 } : c;
    }
    return portCurve(a, b, lane);
  }

  /* ================================================================ */
  /* Read-outs for the stage and panel                                */
  /* ================================================================ */

  expectedNow() {
    if (this.cfg.mode === 'run') return this.nThreads * this.per;
    const start = this.cfg.start ?? 5;
    return start + this.threads.reduce((a, t) => a + (t.prog.iters ?? 1), 0);
  }

  insideCount() {
    return this.threads.filter((t) => t.inside).length;
  }

  stuckFor() {
    return this.deadlocked ? this.t - this.deadlockAt : 0;
  }

  retries() {
    return this.threads.reduce((a, t) => a + t.retries, 0);
  }
}
