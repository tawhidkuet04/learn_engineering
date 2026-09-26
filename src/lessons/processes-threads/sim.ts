import { SIG } from '@/lib/sim/colors';
import { clamp, damp, type Curve, type Pt } from '@/lib/sim/geometry';
import { PredictGame } from '@/lib/sim/predict';
import { mulberry32 } from '@/lib/sim/rng';
import { Sim, portCurve, type Box, type ScriptEvent, type WireSpec } from '@/lib/sim/Sim';

/**
 * Processes vs threads: a tiny operating system.
 *
 * Time unit: one simulated second is shown as one millisecond. Real time
 * slices are a few ms, so the pacing is honest; context switches are drawn
 * far longer than real ones (a few µs) so you can see them. The lesson says so.
 *
 * World: a CPU with 1–4 cores, processes (boxes with memory regions) that
 * own threads (colored tokens). A round-robin scheduler with a single FIFO
 * ready queue hands out time slices; every hand-over costs a context switch
 * (cheaper between threads of one process, dearer between processes).
 */

/** One distinct color per thread. Avoids the signal colors used for switches (violet, orange), crashes (red) and data (cyan). */
export const TCOL = ['#FF7EB6', '#2DD4BF', '#C4F25A', '#93A5FF', '#FFB48A', '#F09BFF', '#E9D98B', '#7FD4FF', '#FF9FA8', '#A8F0C8'];
const LETTERS = 'ABCDEFGHIJKL';

/* ================================================================== */
/* Config                                                              */
/* ================================================================== */

export type Detail = 'auto' | 'full' | 'compact' | 'mini';
export type ProcKind = 'app' | 'browser' | 'renderer' | 'gpu' | 'db' | 'python' | 'node';

export interface ThreadSpec {
  id: string;
  /** Token label; defaults to process letter + index, e.g. "A2" */
  name?: string;
  role?: string;
  /** CPU work in ms (batch jobs). Omitted = runs forever. */
  work?: number;
  /** CPU ms between waits for the disk. Omitted = never waits. */
  burst?: number;
  /** ms per disk wait */
  io?: number;
  /** Starts asleep (waiting for an event) instead of ready */
  asleep?: boolean;
}

export interface ProcSpec {
  id: string;
  pid: number;
  name: string;
  letter?: string;
  kind?: ProcKind;
  /** Browser tab label drawn above the process (Chrome renderers) */
  tab?: string;
  threads: ThreadSpec[];
  gil?: boolean;
  globals?: string;
  heap?: number;
  files?: string[];
}

export interface PTConfig {
  cores: number;
  procs: ProcSpec[];
  /** Time slice (quantum), ms */
  slice: number;
  /** Cost of a switch between threads of the same process, ms */
  tsw: number;
  /** Cost of a switch that also changes address space, ms */
  psw: number;
  sched: boolean;
  gantt: boolean;
  queue: boolean;
  disk: boolean;
  file: boolean;
  kernel: boolean;
  detail: Detail;
  /** Threads have finite work; when all finish, record the time and start again */
  batch: boolean;
  /** Show the context-switch inspector */
  inspect: boolean;
  race: 'off' | 'nolock' | 'lock';
  ipc: boolean;
  /** Clicking a thread or a process on the stage crashes it */
  crashable: boolean;
  spawn: 'off' | 'fork' | 'thread';
  /** A readout is docked at the bottom in portrait: leave room for it */
  readout: boolean;
  /** Run the program from a file on disk (first step) */
  launch: boolean;
  /** A live `top -H`-style thread table beside the drawing (wide stages only) */
  table: boolean;
}

export const DEFAULTS: PTConfig = {
  table: false,
  cores: 1,
  procs: [],
  slice: 1.2,
  tsw: 0.14,
  psw: 0.34,
  sched: true,
  gantt: false,
  queue: false,
  disk: false,
  file: false,
  kernel: false,
  detail: 'auto',
  batch: false,
  inspect: false,
  race: 'off',
  ipc: false,
  crashable: false,
  spawn: 'off',
  readout: false,
  launch: false,
};

/* ================================================================== */
/* State                                                               */
/* ================================================================== */

export type ThreadState = 'new' | 'ready' | 'running' | 'blocked' | 'sleep' | 'lock' | 'done' | 'dead';

export interface Thread {
  id: string;
  name: string;
  role?: string;
  procId: string;
  color: string;
  state: ThreadState;
  core: number | null;
  cpu: number;
  /** Recent share of a core this thread got (0..1), smoothed */
  load: number;
  /** Thread ID as the kernel sees it (the main thread's TID equals the PID) */
  tid: number;
  work: number | null;
  workTotal: number | null;
  burst: number | null;
  burstLeft: number;
  io: number;
  ioLeft: number;
  ioTotal: number;
  /** A one-off disk read requested by the learner */
  ioReq: number | null;
  readySince: number;
  pc: number;
  sp: number;
  depth: number;
  depthClock: number;
  allocClock: number;
  /** Visual position of the token (eased toward its target) */
  x: number;
  y: number;
  bornVt: number;
  diedVt: number | null;
  /** Birth delay (sim seconds) before a fresh thread becomes runnable */
  setup: number;
}

export interface HeapBlock {
  id: number;
  w: number;
  by: string | null;
  vt: number;
}

export interface HeapObj {
  name: string;
  value: string;
  color: string;
  vt: number;
  bad?: boolean;
}

export interface Proc {
  id: string;
  pid: number;
  name: string;
  letter: string;
  kind: ProcKind;
  tab?: string;
  gil: boolean;
  gilHolder: string | null;
  gilWait: string[];
  alive: boolean;
  diedVt: number | null;
  reason: string | null;
  heap: HeapBlock[];
  globals: string;
  /** Tint for the globals text (e.g. the thread holding a mutex) */
  globalsColor: string | null;
  files: string[];
  bornVt: number;
  /** fork/exec: seconds of setup left before its threads may run */
  setup: number;
  setupTotal: number;
  setupLabel: string;
  objs: HeapObj[];
  threadIds: string[];
}

export interface Switch {
  from: string | null;
  to: string;
  fromProc: string | null;
  toProc: string;
  left: number;
  dur: number;
  kind: 'tsw' | 'psw';
  t0: number;
  /** Why the core changed hands */
  cause: SwitchCause;
}

export type SwitchCause = 'timer' | 'block' | 'done' | 'idle' | 'lock';

export interface Core {
  i: number;
  thread: string | null;
  slice: number;
  sw: Switch | null;
  lastProc: string | null;
  last: string | null;
  seg: Seg | null;
  /** A value held in a register (race demo) */
  reg: string | null;
  deciding: boolean;
}

export interface Seg {
  core: number;
  kind: 'run' | 'tsw' | 'psw';
  tid: string | null;
  color: string;
  label: string;
  t0: number;
  t1: number | null;
}

export interface Mark {
  core: number;
  t: number;
  kind: 'crash' | 'batch';
  label?: string;
}

interface Bucket {
  t: number;
  run: number;
  sw: number;
  idle: number;
}

export type PredictKind = 'next' | 'share' | 'crash';

export interface TL {
  x0: number;
  y0: number;
  w: number;
  h: number;
}

export interface Col {
  tid: string;
  x0: number;
  w: number;
  cx: number;
  hy: number;
  fy: number;
  maxFrames: number;
}

export interface PGeom {
  box: TL;
  dk: DetailKey;
  head: TL;
  stack: TL;
  cols: Col[];
  heap: TL;
  data: TL | null;
  code: TL | null;
  files: TL | null;
  /** compact detail: one band for code + data */
  codeData: TL | null;
  labelX: number;
}

export interface GanttGeom {
  x: number;
  y: number;
  w: number;
  h: number;
  rowH: number;
  rowGap: number;
  head: number;
  labelW: number;
  win: number;
}

export interface Metrics {
  L: boolean;
  tokR: number;
  detail: DetailKey;
  gantt: GanttGeom | null;
  queue: { x0: number; x1: number; y: number } | null;
  tabs: boolean;
  /** Where the live thread table goes (top-left corner and width), if shown */
  table: { x: number; y: number; w: number } | null;
}

/* ---------- process drawing sizes ---------- */

export const DET = {
  xl: { head: 32, stack: 104, gap: 10, heap: 42, band: 23, bands: 3, label: 58, pad: 11, frameH: 9, tok: 15 },
  full: { head: 26, stack: 74, gap: 8, heap: 30, band: 19, bands: 3, label: 46, pad: 8, frameH: 7, tok: 12 },
  compact: { head: 22, stack: 58, gap: 6, heap: 26, band: 17, bands: 1, label: 40, pad: 6, frameH: 6, tok: 11 },
  mini: { head: 20, stack: 45, gap: 4, heap: 20, band: 0, bands: 0, label: 0, pad: 5, frameH: 5, tok: 9 },
} as const;
export type DetailKey = keyof typeof DET;
type Det = { -readonly [K in keyof (typeof DET)['full']]: number };

/** Sizes for a detail level; on a phone the full level narrows its label column. */
export function detOf(k: DetailKey, portrait: boolean): Det {
  const d: Det = { ...DET[k] };
  if (portrait && k === 'full') {
    d.label = 36;
    d.pad = 6;
  }
  return d;
}

export const procH = (k: DetailKey) => {
  const d = DET[k];
  return d.head + d.stack + d.gap + d.heap + d.bands * (d.band + 3) + d.pad;
};
const prefW = (k: DetailKey, n: number) =>
  k === 'xl'
    ? clamp(96 + 72 * n, 300, 420)
    : k === 'full'
      ? clamp(62 + 56 * n, 214, 340)
      : k === 'compact'
        ? clamp(52 + 44 * n, 150, 262)
        : clamp(14 + 34 * n, 106, 200);
const minW = (k: DetailKey, portrait = false) => (k === 'xl' ? 290 : k === 'full' ? (portrait ? 160 : 200) : k === 'compact' ? 140 : 92);

/** Font sizes for each level of process detail. */
export const FS = {
  xl: { pid: 11.5, name: 13.5, label: 8.5, band: 10.5, tok: 11 },
  full: { pid: 10, name: 12, label: 8, band: 9.5, tok: 9.5 },
  compact: { pid: 10, name: 11, label: 7.5, band: 8.5, tok: 9 },
  mini: { pid: 9, name: 10, label: 7, band: 8, tok: 8 },
} as const;

const c2tl = (r: { x: number; y: number; w: number; h: number }): TL => ({ x0: r.x - r.w / 2, y0: r.y - r.h / 2, w: r.w, h: r.h });
const tl2c = (r: TL) => ({ x: r.x0 + r.w / 2, y: r.y0 + r.h / 2, w: r.w, h: r.h });
const asBox = (r: { x: number; y: number; w: number; h: number }): Box => ({ id: '', x: r.x, y: r.y, tx: r.x, ty: r.y, w: r.w, h: r.h, alpha: 1, talpha: 1, removing: false });

export const hex = (n: number) => `0x${Math.floor(n).toString(16)}`;

/* ================================================================== */
/* The simulation                                                      */
/* ================================================================== */

export class PTSim extends Sim {
  cfg: PTConfig = { ...DEFAULTS };
  procs = new Map<string, Proc>();
  threads = new Map<string, Thread>();
  cores: Core[] = [];
  queue: string[] = [];
  segs: Seg[] = [];
  marks: Mark[] = [];
  M: Metrics = { L: true, tokR: 12, detail: 'full', gantt: null, queue: null, tabs: false, table: null };

  game: PredictGame | null = null;
  pkind: PredictKind | null = null;
  /** Region the sim is asking about (outlined in yellow on the stage) */
  asking: { key: string; text: string } | null = null;
  /** Answer revealed for the last question: the thread that won the core */
  reveal: string | null = null;

  nSw = 0;
  nTsw = 0;
  nPsw = 0;
  crashes = 0;
  batchStart = 0;
  batchLast: number | null = null;
  batchDoneAt: number | null = null;
  batchRuns = 0;
  /** Cores in use when the last batch finished */
  batchCores: number | null = null;
  race = { attempts: 0, lost: 0, start: 41, value: 41, owner: null as string | null, round: 0 };
  ipc = { msgs: 0, copies: 0, calls: 0, buf: [] as string[] };
  spawned = 0;
  /** Last context switch per core, for the inspector */
  lastSw: (Switch & { end: number }) | null = null;
  /** Sim time when the current world was built: the timeline counts from here */
  t0 = 0;
  launchPhase: 'file' | 'loading' | 'running' = 'running';

  private bk: Bucket[] = [];
  private waits: { t: number; w: number }[] = [];
  private seq = { color: 0, heap: 1, msg: 1041, fork: 0, pid: 5000 };
  private shareIdx = 0;
  private shareNext = 0;
  private crashAskAt = 0;
  private crashOk = false;
  private modeGen = 0;
  /** A restarted thread keeps its color, so the learner can follow it */
  private colorMap = new Map<string, string>();

  /** A floating label above a box, nudged sideways so it never runs off the stage. */
  private sayIn(id: string, text: string, color: string, dur = 1.6) {
    const b = this.boxes.get(id);
    if (!b || Number.isNaN(b.x)) return;
    const half = (text.length * 6.6 + 16) / 2;
    const x = clamp(b.x, half + 8, this.w - half - 8);
    this.fx({ kind: 'text', at: { x, y: b.y - b.h / 2 - 12 - (this.M.tabs ? 20 : 0) }, text, color, dur });
  }

  constructor() {
    super();
    this.box('cpu');
  }

  /* ---------------------------------------------------------------- */
  /* Step entry                                                        */
  /* ---------------------------------------------------------------- */

  enter(cfg: PTConfig, opts: { reset?: boolean; script?: ScriptEvent<PTSim>[]; predict?: { kind: PredictKind; rounds: number } | null; seed?: number } = {}) {
    this.cfg = { ...cfg };
    if (opts.reset || this.procs.size === 0) this.rebuild(opts.seed);
    else this.setCores(cfg.cores, true);
    this.modeGen++;
    this.game = null;
    this.pkind = null;
    this.asking = null;
    this.reveal = null;
    if (opts.predict) {
      this.game = new PredictGame(this, opts.predict.rounds);
      this.pkind = opts.predict.kind;
      this.shareIdx = 0;
      this.shareNext = this.t + 1.9;
      this.crashAskAt = this.t + 2.4;
      this.crashOk = false;
    }
    this.runScript(opts.script ?? []);
    this.startModes();
    if (this.sized) this.relayout();
    this.rev++;
  }

  private rebuild(seed = 7) {
    this.clearTransient();
    this.rng = mulberry32(seed);
    this.threads.clear();
    this.colorMap.clear();
    this.queue = [];
    this.segs = [];
    this.marks = [];
    this.bk = [];
    this.waits = [];
    this.nSw = this.nTsw = this.nPsw = 0;
    this.crashes = 0;
    this.batchStart = this.t;
    this.batchLast = null;
    this.batchDoneAt = null;
    this.batchRuns = 0;
    this.batchCores = null;
    this.race = { attempts: 0, lost: 0, start: 41, value: 41, owner: null, round: 0 };
    this.ipc = { msgs: 0, copies: 0, calls: 0, buf: [] };
    this.spawned = 0;
    this.lastSw = null;
    this.t0 = this.t;
    this.seq = { color: 0, heap: 1, msg: 1041, fork: 0, pid: 5000 };
    this.launchPhase = this.cfg.launch ? 'file' : 'running';

    const keep = new Set(this.cfg.launch ? [] : this.cfg.procs.map((p) => p.id));
    for (const id of this.procs.keys()) if (!keep.has(id)) this.hide(`proc:${id}`);
    this.procs.clear();
    if (!this.cfg.launch) this.cfg.procs.forEach((ps, i) => this.addProc(ps, i));

    this.cores = [];
    for (let i = 0; i < this.cfg.cores; i++) this.cores.push(this.newCore(i));
    // Idle cores start with the first process's address space loaded.
    const first = this.cfg.procs[0]?.id ?? null;
    for (const c of this.cores) c.lastProc = first;
  }

  private newCore(i: number): Core {
    return { i, thread: null, slice: 0, sw: null, lastProc: null, last: null, seg: null, reg: null, deciding: false };
  }

  private addProc(ps: ProcSpec, index: number, setup = 0, setupLabel = ''): Proc {
    const p: Proc = {
      id: ps.id,
      pid: ps.pid,
      name: ps.name,
      letter: ps.letter ?? LETTERS[index % LETTERS.length],
      kind: ps.kind ?? 'app',
      tab: ps.tab,
      gil: !!ps.gil,
      gilHolder: null,
      gilWait: [],
      alive: true,
      diedVt: null,
      reason: null,
      heap: [],
      globals: ps.globals ?? 'globals',
      globalsColor: null,
      files: ps.files ?? ['0', '1', '2'],
      bornVt: this.vt,
      setup,
      setupTotal: setup,
      setupLabel,
      objs: [],
      threadIds: [],
    };
    const nHeap = ps.heap ?? 3;
    for (let i = 0; i < nHeap; i++) p.heap.push({ id: this.seq.heap++, w: 9 + Math.floor(this.rng() * 9), by: null, vt: -10 });
    this.procs.set(p.id, p);
    this.box(`proc:${p.id}`);
    ps.threads.forEach((ts) => this.addThread(p, ts, setup > 0 ? setup : 0));
    return p;
  }

  private addThread(p: Proc, ts: ThreadSpec, setup = 0): Thread {
    const idx = p.threadIds.length;
    const n = this.seq.color++;
    const th: Thread = {
      id: ts.id,
      name: ts.name ?? `${p.letter}${idx + 1}`,
      role: ts.role,
      procId: p.id,
      color: this.colorMap.get(ts.id) ?? TCOL[n % TCOL.length],
      state: 'new',
      core: null,
      cpu: 0,
      load: 0,
      tid: p.pid + idx,
      work: ts.work ?? null,
      workTotal: ts.work ?? null,
      burst: ts.burst ?? null,
      burstLeft: ts.burst ?? 0,
      io: ts.io ?? 2,
      ioLeft: 0,
      ioTotal: 0,
      ioReq: null,
      readySince: this.t,
      pc: 0x401000 + ((n * 0x3a7) % 0x2000),
      sp: 0x7ffd0000 - n * 0x21000,
      depth: 1 + (n % 2),
      depthClock: 0.3,
      allocClock: 0.6 + this.rng(),
      x: NaN,
      y: NaN,
      bornVt: this.vt,
      diedVt: null,
      setup,
    };
    this.threads.set(th.id, th);
    this.colorMap.set(th.id, th.color);
    p.threadIds.push(th.id);
    if (ts.asleep) th.state = 'sleep';
    else if (setup <= 0) this.makeReady(th);
    return th;
  }

  /* ---------------------------------------------------------------- */
  /* Public controls (components call these, never assign fields)      */
  /* ---------------------------------------------------------------- */

  setCores(n: number, quiet = false) {
    n = clamp(Math.round(n), 1, 4);
    this.cfg = { ...this.cfg, cores: n };
    while (this.cores.length < n) {
      const c = this.newCore(this.cores.length);
      c.lastProc = this.cores[0]?.lastProc ?? null;
      this.cores.push(c);
    }
    while (this.cores.length > n) {
      const c = this.cores.pop()!;
      const tid = c.sw?.to ?? c.thread;
      this.closeSeg(c);
      if (tid) {
        const th = this.threads.get(tid);
        if (th && th.state === 'running') {
          th.state = 'ready';
          th.core = null;
          th.readySince = this.t;
          this.queue.unshift(th.id);
        }
      }
    }
    this.segs = this.segs.filter((s) => s.core < n);
    this.marks = this.marks.filter((m) => m.core < n);
    if (!quiet) {
      this.bk = [];
      if (this.cfg.batch) this.restartBatch();
    }
    if (this.sized) this.relayout();
    this.rev++;
  }

  setSlice(ms: number) {
    this.cfg = { ...this.cfg, slice: ms };
    this.bk = [];
    this.waits = [];
    this.rev++;
  }

  /** The learner asks a thread to read from the disk. It must be running to make the call. */
  requestIO(tid: string, ms = 2.6) {
    const th = this.threads.get(tid);
    if (!th || th.state === 'dead' || th.state === 'done') return;
    if (th.state === 'blocked') return;
    th.ioReq = ms;
    this.rev++;
  }

  crashThread(tid: string, reason = 'SIGSEGV') {
    const th = this.threads.get(tid);
    if (!th || th.state === 'dead') return;
    const p = this.procs.get(th.procId);
    if (!p || !p.alive) return;
    if (!Number.isNaN(th.x)) {
      this.fx({ kind: 'ring', at: { x: th.x, y: th.y }, color: SIG.err, dur: 0.9, size: 1.3 });
      this.fx({ kind: 'text', at: { x: th.x, y: th.y - this.M.tokR - 12 }, text: reason, color: SIG.err, dur: 1.8 });
    }
    this.killProc(p, reason, th.id);
  }

  crashProcess(pid: string, reason = 'SIGKILL') {
    const p = this.procs.get(pid);
    if (!p || !p.alive) return;
    this.killProc(p, reason, null);
  }

  /** Start a crashed process again. It gets a brand-new PID. */
  restartProcess(pid: string) {
    const p = this.procs.get(pid);
    if (!p || p.alive) return;
    const spec = this.cfg.procs.find((s) => s.id === pid);
    const index = [...this.procs.keys()].indexOf(pid);
    for (const tid of p.threadIds) this.threads.delete(tid);
    this.queue = this.queue.filter((q) => this.threads.has(q));
    const pidNum = Math.max(p.pid, ...[...this.procs.values()].map((x) => x.pid)) + 4;
    const fresh: ProcSpec = spec
      ? { ...spec, pid: pidNum }
      : { id: p.id, pid: pidNum, name: p.name, letter: p.letter, kind: p.kind, tab: p.tab, threads: p.threadIds.map((t) => ({ id: t })) };
    // Keep the map order stable so the layout doesn't jump.
    const entries = [...this.procs.entries()];
    this.procs.clear();
    for (const [id, old] of entries) {
      if (id === pid) this.addProc({ ...fresh, letter: p.letter }, index, 0.45, 'exec');
      else this.procs.set(id, old);
    }
    this.fx({ kind: 'ring', at: { id: `proc:${pid}` }, color: SIG.res, dur: 0.9, size: 2 });
    this.rev++;
  }

  restartAll() {
    for (const p of [...this.procs.values()]) if (!p.alive) this.restartProcess(p.id);
  }

  /** Add a thread to a process (pthread_create). */
  spawnThread(pid: string, opts: { burst?: number; io?: number; work?: number } = {}) {
    const p = this.procs.get(pid);
    if (!p || !p.alive || p.threadIds.length >= 5) return null;
    let k = p.threadIds.length + 1;
    while (this.threads.has(`${p.id}${k}`)) k++;
    const th = this.addThread(p, { id: `${p.id}${k}`, ...opts }, 0.12);
    this.spawned++;
    this.after(0.05, () => {
      if (!Number.isNaN(th.x)) this.fx({ kind: 'ring', at: { x: th.x, y: th.y }, color: th.color, dur: 0.8, size: 1.1 });
    });
    if (this.sized) this.relayout();
    this.rev++;
    return th;
  }

  /** Copy a process (fork). The child gets its own address space and a new PID. */
  forkProcess(parentId: string, opts: { burst?: number; io?: number; work?: number } = {}) {
    const parent = this.procs.get(parentId);
    if (!parent || !parent.alive || this.procs.size >= 5) return null;
    const idx = this.procs.size;
    const id = `f${++this.seq.fork}`;
    const pid = Math.max(...[...this.procs.values()].map((x) => x.pid)) + 1;
    const child = this.addProc(
      // The child is a copy: same code, same globals, and the parent's open files (fds are inherited).
      { id, pid, name: parent.name, letter: LETTERS[idx % LETTERS.length], kind: parent.kind, threads: [{ id: `${id}t`, ...opts }], globals: parent.globals, files: [...parent.files] },
      idx,
      0.85,
      'copying page tables',
    );
    this.spawned++;
    this.send({ from: `head:${parentId}`, to: `head:${id}`, dur: 0.55, color: SIG.hc, label: 'fork()', r: 3.6 });
    if (this.sized) this.relayout();
    this.rev++;
    return child;
  }

  addProcess(threads = 1) {
    if (this.procs.size >= 4) return null;
    const idx = this.procs.size;
    let n = 1;
    while (this.procs.has(`p${n}`)) n++;
    const id = `p${n}`;
    const pid = Math.max(4000, ...[...this.procs.values()].map((x) => x.pid)) + 3;
    const letter = LETTERS[idx % LETTERS.length];
    const k = idx % 4;
    const p = this.addProc(
      {
        id,
        pid,
        name: ['server', 'backup', 'indexer', 'worker'][k],
        globals: ['requests = 0', 'copied = 0', 'docs = 0', 'jobs = 0'][k],
        letter,
        threads: Array.from({ length: threads }, (_, i) => ({ id: `${id}${i + 1}` })),
      },
      idx,
      0.45,
      'exec',
    );
    if (this.sized) this.relayout();
    this.rev++;
    return p;
  }

  removeProcess() {
    const last = [...this.procs.values()].pop();
    if (!last || this.procs.size <= 1) return;
    this.evictProc(last);
    for (const tid of last.threadIds) this.threads.delete(tid);
    this.procs.delete(last.id);
    this.hide(`proc:${last.id}`);
    if (this.sized) this.relayout();
    this.rev++;
  }

  removeThread(pid: string) {
    const p = this.procs.get(pid);
    if (!p || p.threadIds.length <= 1) return;
    const tid = p.threadIds[p.threadIds.length - 1];
    const th = this.threads.get(tid);
    if (th) this.evictThread(th);
    p.threadIds.pop();
    this.threads.delete(tid);
    if (this.sized) this.relayout();
    this.rev++;
  }

  /** Make every thread do (or stop doing) regular disk reads. */
  setIoHeavy(on: boolean) {
    for (const th of this.threads.values()) {
      th.burst = on ? 0.5 + ((th.name.charCodeAt(1) || 1) % 3) * 0.25 : null;
      th.io = 2.2;
      th.burstLeft = th.burst ?? 0;
    }
    this.cfg = { ...this.cfg, disk: on || this.cfg.disk };
    if (this.sized) this.relayout();
    this.rev++;
  }

  setRace(mode: 'nolock' | 'lock') {
    this.cfg = { ...this.cfg, race: mode };
    this.race = { attempts: 0, lost: 0, start: 41, value: 41, owner: null, round: 0 };
    this.clearTransient();
    for (const c of this.cores) c.reg = null;
    const a = this.procs.values().next().value;
    if (a) {
      for (const tid of a.threadIds) {
        const th = this.threads.get(tid);
        if (th && th.state === 'lock') this.makeReady(th);
      }
    }
    this.startModes();
    this.rev++;
  }

  setSpawn(mode: 'fork' | 'thread') {
    this.cfg = { ...this.cfg, spawn: mode };
    this.rebuild(11);
    this.startModes();
    if (this.sized) this.relayout();
    this.rev++;
  }

  /** Swap the whole world to a new set of processes (real-world toggles). */
  load(procs: ProcSpec[], extra: Partial<PTConfig> = {}) {
    this.cfg = { ...this.cfg, ...extra, procs };
    this.rebuild(9);
    this.startModes();
    if (this.sized) this.relayout();
    this.rev++;
  }

  /* ---------------------------------------------------------------- */
  /* Queries used by the stage and panel                               */
  /* ---------------------------------------------------------------- */

  procOf(tid: string) {
    const th = this.threads.get(tid);
    return th ? this.procs.get(th.procId) ?? null : null;
  }

  /** Share of core time spent context switching over the last ~12 ms. */
  get overhead() {
    let sw = 0;
    let tot = 0;
    for (const b of this.bk) {
      sw += b.sw;
      tot += b.run + b.sw + b.idle;
    }
    return tot > 0.5 ? sw / tot : 0;
  }

  get util() {
    let run = 0;
    let tot = 0;
    for (const b of this.bk) {
      run += b.run;
      tot += b.run + b.sw + b.idle;
    }
    return tot > 0.5 ? run / tot : 0;
  }

  /** Longest a ready thread waited for a core recently (responsiveness). */
  get maxWait() {
    let m = 0;
    for (const w of this.waits) if (this.t - w.t < 14) m = Math.max(m, w.w);
    for (const th of this.threads.values()) if (th.state === 'ready') m = Math.max(m, this.t - th.readySince);
    return m;
  }

  get runningNow() {
    return this.cores.filter((c) => c.thread && !c.sw).length;
  }

  get aliveProcs() {
    return [...this.procs.values()].filter((p) => p.alive).length;
  }

  get aliveThreads() {
    return [...this.threads.values()].filter((t) => t.state !== 'dead' && t.state !== 'done').length;
  }

  /* ---------------------------------------------------------------- */
  /* Scheduler                                                         */
  /* ---------------------------------------------------------------- */

  protected step(dt: number) {
    this.accumulate(dt);
    const k = 1 - Math.exp(-dt / 4);
    for (const th of this.threads.values()) {
      const on = th.core != null && this.cores[th.core]?.thread === th.id;
      th.load += ((on ? 1 : 0) - th.load) * k;
    }

    for (const p of this.procs.values()) {
      if (p.alive && p.setup > 0) {
        p.setup -= dt;
        if (p.setup <= 0) {
          p.setup = 0;
          this.rev++;
        }
      }
    }
    for (const th of this.threads.values()) {
      if (th.state === 'new') {
        const p = this.procs.get(th.procId);
        th.setup -= dt;
        if (p && p.alive && p.setup <= 0 && th.setup <= 0) this.makeReady(th);
      } else if (th.state === 'blocked') {
        th.ioLeft -= dt;
        if (th.ioLeft <= 0) this.ioDone(th);
      }
    }

    if (this.cfg.sched) {
      for (const core of this.cores) {
        if (this.frozen) break;
        this.stepCore(core, dt);
      }
    }
    if (!this.frozen) {
      this.stepBatch();
      this.stepPredict();
    }
    if (this.segs.length > 60) {
      const cut = this.t - 20;
      this.segs = this.segs.filter((s) => s.t1 == null || s.t1 > cut);
      this.marks = this.marks.filter((m) => m.t > cut);
    }
  }

  private stepCore(core: Core, dt: number) {
    if (core.deciding) return;
    if (core.sw) {
      core.sw.left -= dt;
      if (core.sw.left <= 0) this.finishSwitch(core);
      return;
    }
    const th = core.thread ? this.threads.get(core.thread) : null;
    if (!th) {
      core.thread = null;
      this.dispatch(core, null);
      return;
    }
    th.cpu += dt;
    core.slice -= dt;
    this.runEffects(th, dt);
    if (th.work != null) {
      th.work -= dt;
      if (th.work <= 0) {
        th.work = 0;
        this.leaveCore(th, core, 'done');
        return;
      }
    }
    if (th.ioReq != null) {
      this.leaveCore(th, core, 'blocked');
      return;
    }
    if (th.burst != null) {
      th.burstLeft -= dt;
      if (th.burstLeft <= 0) {
        this.leaveCore(th, core, 'blocked');
        return;
      }
    }
    if (core.slice <= 0) this.preempt(th, core);
  }

  /** The timer interrupt fired: this thread's slice is used up. */
  private preempt(th: Thread, core: Core) {
    const p = this.procs.get(th.procId);
    const gilHandoff = !!p && p.gil && p.gilWait.length > 0;
    if (this.queue.length === 0 && !gilHandoff) {
      core.slice = this.cfg.slice; // nobody is waiting: keep going
      return;
    }
    this.closeSeg(core);
    core.thread = null;
    th.core = null;
    if (gilHandoff && p) {
      // The interpreter asks the holder to drop the GIL; it then waits to get it back.
      this.releaseGil(p, th);
      th.state = 'lock';
      p.gilWait.push(th.id);
    } else {
      th.state = 'ready';
      th.readySince = this.t;
      this.queue.push(th.id);
    }
    this.rev++;
    this.dispatch(core, th, 'timer');
  }

  private leaveCore(th: Thread, core: Core, why: 'blocked' | 'done') {
    this.closeSeg(core);
    core.thread = null;
    th.core = null;
    const p = this.procs.get(th.procId);
    if (why === 'blocked') {
      th.state = 'blocked';
      th.ioTotal = th.ioReq ?? th.io;
      th.ioLeft = th.ioTotal;
      th.ioReq = null;
      th.burstLeft = th.burst ?? 0;
      if (this.isLive('disk')) this.send({ from: `core:${core.i}`, to: 'disk', dur: 0.45, color: SIG.req, r: 3.4, label: this.M.L && this.cfg.cores <= 2 ? 'read()' : undefined });
    } else {
      th.state = 'done';
      if (!Number.isNaN(th.x)) this.fx({ kind: 'ring', at: { x: th.x, y: th.y }, color: SIG.res, dur: 0.7 });
    }
    if (p) this.releaseGil(p, th);
    this.rev++;
    this.dispatch(core, th, why === 'blocked' ? 'block' : 'done');
  }

  private ioDone(th: Thread) {
    th.ioLeft = 0;
    if (this.isLive('disk') && !Number.isNaN(th.x)) this.fx({ kind: 'ring', at: { x: th.x, y: th.y }, color: SIG.res, dur: 0.6 });
    this.makeReady(th);
  }

  /** Put a thread in the ready queue (or make it wait for its process's GIL). */
  private makeReady(th: Thread) {
    const p = this.procs.get(th.procId);
    if (!p || !p.alive) return;
    if (p.gil) {
      if (p.gilHolder && p.gilHolder !== th.id) {
        th.state = 'lock';
        if (!p.gilWait.includes(th.id)) p.gilWait.push(th.id);
        this.rev++;
        return;
      }
      p.gilHolder = th.id;
    }
    th.state = 'ready';
    th.readySince = this.t;
    if (!this.queue.includes(th.id)) this.queue.push(th.id);
    this.rev++;
  }

  private releaseGil(p: Proc, th: Thread) {
    if (!p.gil || p.gilHolder !== th.id) return;
    p.gilHolder = null;
    const next = p.gilWait.shift();
    if (next) {
      const nt = this.threads.get(next);
      if (nt) this.makeReady(nt);
    }
  }

  /** An idle core looks for work: the front of the ready queue. */
  private dispatch(core: Core, prev: Thread | null, cause: SwitchCause = 'idle') {
    const nextId = this.queue[0];
    if (!nextId) return;
    const next = this.threads.get(nextId);
    if (!next) {
      this.queue.shift();
      return;
    }
    if (this.game && !this.game.done && !this.game.pending && this.pkind === 'next' && prev) {
      this.askNext(core, prev, next, cause);
      return;
    }
    this.beginSwitch(core, prev, next, cause);
  }

  private beginSwitch(core: Core, prev: Thread | null, next: Thread, cause: SwitchCause) {
    this.queue = this.queue.filter((q) => q !== next.id);
    // A freshly built world starts with its first threads already on the cores.
    if (core.last === null && this.t - this.t0 < 0.05) {
      next.state = 'running';
      next.core = core.i;
      core.lastProc = next.procId;
      core.last = next.id;
      core.thread = next.id;
      core.slice = this.cfg.slice;
      this.openSeg(core, 'run', next);
      this.rev++;
      return;
    }
    const kind: Switch['kind'] = core.lastProc === next.procId ? 'tsw' : 'psw';
    const dur = kind === 'tsw' ? this.cfg.tsw : this.cfg.psw;
    this.waits.push({ t: this.t, w: this.t - next.readySince });
    if (this.waits.length > 40) this.waits.shift();
    next.state = 'running';
    next.core = core.i;
    core.sw = { from: prev?.id ?? core.last, to: next.id, fromProc: core.lastProc, toProc: next.procId, left: dur, dur, kind, t0: this.t, cause };
    core.lastProc = next.procId;
    core.last = next.id;
    core.thread = null;
    core.reg = null;
    this.openSeg(core, kind, null);
    this.nSw++;
    if (kind === 'tsw') this.nTsw++;
    else this.nPsw++;
    if (this.cfg.inspect && kind === 'psw') {
      this.send({ from: `head:${next.procId}`, to: `core:${core.i}`, dur: Math.max(0.3, dur * 0.55), color: SIG.heavy, r: 3.6, label: 'page table' });
    }
    this.rev++;
  }

  private finishSwitch(core: Core) {
    const sw = core.sw!;
    this.lastSw = { ...sw, end: this.t };
    core.sw = null;
    const th = this.threads.get(sw.to);
    if (!th || th.state !== 'running') {
      this.closeSeg(core);
      return;
    }
    core.thread = th.id;
    core.slice = this.cfg.slice;
    this.openSeg(core, 'run', th);
    this.rev++;
  }

  private openSeg(core: Core, kind: Seg['kind'], th: Thread | null) {
    this.closeSeg(core);
    const seg: Seg = {
      core: core.i,
      kind,
      tid: th?.id ?? null,
      color: th ? th.color : kind === 'psw' ? SIG.heavy : SIG.hc,
      label: th?.name ?? '',
      t0: this.t,
      t1: null,
    };
    this.segs.push(seg);
    core.seg = seg;
  }

  private closeSeg(core: Core) {
    if (core.seg) {
      core.seg.t1 = this.t;
      core.seg = null;
    }
  }

  /** Stack frames, the program counter and heap traffic change only while a thread runs. */
  private runEffects(th: Thread, dt: number) {
    th.pc += Math.floor(this.rng() * 40 * dt * 30);
    if (th.pc > 0x404000) th.pc = 0x401000 + Math.floor(this.rng() * 0x800);
    th.depthClock -= dt;
    if (th.depthClock <= 0) {
      th.depthClock = 0.22 + this.rng() * 0.45;
      th.depth = clamp(th.depth + (this.rng() < 0.52 ? 1 : -1), 1, 4);
      th.sp = 0x7ffd0000 - (this.threads.size + 1) * 0x10 - th.depth * 0x40;
    }
    th.allocClock -= dt;
    if (th.allocClock <= 0) {
      th.allocClock = 0.7 + this.rng() * 1.3;
      const p = this.procs.get(th.procId);
      if (p && this.cfg.race === 'off' && !this.cfg.ipc) {
        if (p.heap.length < 7 && this.rng() < 0.55) p.heap.push({ id: this.seq.heap++, w: 8 + Math.floor(this.rng() * 10), by: th.id, vt: this.vt });
        else if (p.heap.length) {
          if (p.heap.length >= 7 && this.rng() < 0.3) p.heap.shift();
          const b = p.heap[Math.floor(this.rng() * p.heap.length)];
          b.by = th.id;
          b.vt = this.vt;
        }
      }
    }
  }

  private killProc(p: Proc, reason: string, culprit: string | null) {
    p.alive = false;
    p.diedVt = this.vt;
    p.reason = reason;
    p.gilHolder = null;
    p.gilWait = [];
    this.crashes++;
    this.evictProc(p, true);
    for (const tid of p.threadIds) {
      const th = this.threads.get(tid);
      if (!th) continue;
      th.state = 'dead';
      th.diedVt = this.vt;
      if (tid !== culprit && !Number.isNaN(th.x)) this.fx({ kind: 'x', at: { x: th.x, y: th.y }, color: SIG.err, dur: 1.1, size: 1.2 });
    }
    const long = reason === 'SIGSEGV' ? (this.M.L ? 'Segmentation fault (core dumped)' : 'Segmentation fault') : reason === 'SIGKILL' ? 'Killed' : reason;
    this.sayIn(`proc:${p.id}`, long, SIG.err, 2.2);
    // Chrome: renderers and the GPU process exit when the browser process goes.
    if (p.kind === 'browser') {
      this.after(0.5, () => {
        for (const q of this.procs.values()) if (q.alive && (q.kind === 'renderer' || q.kind === 'gpu')) this.killProc(q, 'parent exited', null);
      });
    }
    this.rev++;
  }

  /** Pull a process's threads off every core and out of every queue. */
  private evictProc(p: Proc, crash = false) {
    for (const tid of p.threadIds) {
      const th = this.threads.get(tid);
      if (th) this.evictThread(th, crash);
    }
  }

  private evictThread(th: Thread, crash = false) {
    this.queue = this.queue.filter((q) => q !== th.id);
    for (const c of this.cores) {
      if (c.sw?.to === th.id || c.thread === th.id) {
        this.closeSeg(c);
        if (crash) this.marks.push({ core: c.i, t: this.t, kind: 'crash' });
        c.sw = null;
        c.thread = null;
        c.reg = null;
        c.lastProc = null;
      }
    }
    th.core = null;
  }

  /* ---------------------------------------------------------------- */
  /* Batch jobs (fixed work per thread)                                */
  /* ---------------------------------------------------------------- */

  private stepBatch() {
    if (!this.cfg.batch) return;
    const jobs = [...this.threads.values()].filter((t) => t.workTotal != null && t.state !== 'dead');
    if (!jobs.length) return;
    const allDone = jobs.every((t) => t.state === 'done');
    if (allDone && this.batchDoneAt == null) {
      this.batchDoneAt = this.t;
      this.batchLast = this.t - this.batchStart;
      this.batchCores = this.cores.length;
      this.batchRuns++;
      this.rev++;
    }
    if (this.batchDoneAt != null && this.t - this.batchDoneAt > 1.6) this.restartBatch();
  }

  restartBatch() {
    this.batchStart = this.t;
    this.batchDoneAt = null;
    for (const c of this.cores) this.marks.push({ core: c.i, t: this.t, kind: 'batch' });
    const order = [...this.threads.values()].filter((t) => t.workTotal != null && t.state !== 'dead');
    for (const th of order) {
      th.work = th.workTotal;
      if (th.state === 'done') {
        th.state = 'new';
        th.setup = 0;
      }
    }
    for (const p of this.procs.values()) {
      p.gilHolder = p.gilHolder && this.threads.get(p.gilHolder)?.state === 'running' ? p.gilHolder : null;
    }
    this.rev++;
  }

  /* ---------------------------------------------------------------- */
  /* Predictions                                                       */
  /* ---------------------------------------------------------------- */

  private askNext(core: Core, prev: Thread, next: Thread, cause: SwitchCause) {
    const g = this.game!;
    core.deciding = true;
    this.reveal = null;
    const others = [...this.threads.values()].filter((t) => t.state === 'blocked' && t.id !== prev.id);
    const oNames = others.map((b) => b.name).join(' and ');
    const prevWent =
      prev.state === 'blocked'
        ? `${prev.name} is waiting on the disk now, so it left the line.`
        : prev.state === 'ready'
          ? `${prev.name} used up its slice, so it went to the back of the line.`
          : '';
    const stillWaiting = others.length ? ` ${oNames} ${others.length > 1 ? 'are' : 'is'} still waiting on the disk, so ${others.length > 1 ? 'they aren’t' : 'it isn’t'} in line.` : '';
    g.ask({
      acceptable: [next.id],
      ask: `Which thread gets core ${core.i} next?`,
      explain: (picked, ok) => {
        const pt = this.threads.get(picked);
        const why = `${next.name} was at the front of the ready queue: it has waited longest.`;
        if (ok) return `${why} ${prevWent}${stillWaiting}`;
        if (pt && pt.state === 'blocked') return `${pt.name} is blocked waiting for the disk, so it can’t run yet. ${why}`;
        if (pt && pt.id === prev.id) return `${prev.name} just had its turn and went to the back of the line. ${why}`;
        return `Round robin takes the front of the queue. ${why} ${prevWent}`;
      },
      resolve: () => {
        core.deciding = false;
        this.reveal = next.id;
        this.after(1.2, () => {
          if (this.reveal === next.id) this.reveal = null;
        });
        const cur = this.threads.get(next.id);
        if (cur && cur.state === 'ready') this.beginSwitch(core, prev, cur, cause);
      },
    });
  }

  private stepPredict() {
    const g = this.game;
    if (!g || g.done || g.pending) return;
    if (this.pkind === 'share' && this.t >= this.shareNext) this.askShare();
    if (this.pkind === 'crash' && this.t >= this.crashAskAt && !this.crashOk) this.askCrash();
  }

  private askShare() {
    const g = this.game!;
    const a = [...this.procs.values()][0];
    const b = [...this.procs.values()][1];
    const newest = a ? this.threads.get(a.threadIds[a.threadIds.length - 1]) : null;
    if (!a || !b || !newest || newest.state === 'new') {
      this.shareNext = this.t + 0.5;
      return;
    }
    const who = newest.name;
    const fds = this.M.detail === 'full' || this.M.detail === 'xl';
    const qs = [
      {
        key: `heap:${a.id}`,
        text: `${a.letter}1’s objects on the heap`,
        ask: `Can ${who} read the objects ${a.letter}1 created on the heap?`,
        ok: 'yes',
        yes: `Yes. Every thread in a process shares one heap, so ${who} can follow any pointer ${a.letter}1 or ${a.letter}2 hands it.`,
        no: `It can. Threads share their process’s heap: any object ${a.letter}1 allocated is reachable from ${who}.`,
        to: `heap:${a.id}`,
      },
      {
        key: fds ? `files:${a.id}` : `data:${a.id}`,
        text: fds ? 'the socket, fd 3' : 'the global variables',
        ask: fds ? `${a.letter}1 opened a socket (fd 3). Can ${who} write to it?` : `Can ${who} read the global variables ${a.letter}1 set?`,
        ok: 'yes',
        yes:
          fds
            ? `Yes. Open files and sockets belong to the process, not to one thread. Any thread can use fd 3.`
            : `Yes. Globals live in the process’s data segment, shared by every thread in it.`,
        no:
          fds
            ? `It can. File descriptors belong to the whole process, so every thread shares fd 3.`
            : `It can. Global variables are shared by every thread of the process.`,
        to: fds ? `files:${a.id}` : `data:${a.id}`,
      },
      {
        key: `heap:${b.id}`,
        text: `process ${b.letter}’s heap`,
        ask: `Can ${who} read the heap of process ${b.letter} (PID ${b.pid})?`,
        ok: 'no',
        yes: `No. ${b.letter} has its own address space. Every address ${who} can form points into ${a.letter}’s memory, so ${b.letter}’s heap is simply unreachable. Talking to ${b.letter} takes IPC.`,
        no: `Right: no. ${b.letter} lives in a separate address space. ${who}’s addresses only map ${a.letter}’s memory, so it would need IPC to talk to ${b.letter}.`,
        to: `heap:${b.id}`,
      },
    ];
    const q = qs[this.shareIdx % qs.length];
    this.asking = { key: q.key, text: q.text };
    g.ask({
      acceptable: [q.ok],
      choices: [
        { id: 'yes', label: 'Yes, it can' },
        { id: 'no', label: 'No, it can’t' },
      ],
      ask: q.ask,
      explain: (picked, ok) => (ok ? (q.ok === 'yes' ? q.yes : q.no) : q.ok === 'yes' ? q.no : q.yes),
      resolve: () => {
        this.asking = null;
        const lost = q.ok === 'no';
        this.send({
          from: `tok:${newest.id}`,
          to: q.to,
          dur: 0.9,
          color: lost ? SIG.err : SIG.res,
          label: lost ? 'load' : 'read',
          lostAt: lost ? 0.52 : null,
          r: 4,
        });
        if (lost) this.after(0.55, () => this.sayIn(`proc:${b.id}`, 'not in this address space', SIG.err, 1.8));
        this.shareIdx++;
        this.shareNext = this.t + 2.4;
        this.rev++;
      },
    });
  }

  private askCrash() {
    const g = this.game!;
    const a = [...this.procs.values()][0];
    if (!a || !a.alive) {
      this.crashAskAt = this.t + 1;
      return;
    }
    const victim = this.threads.get(a.threadIds[1] ?? a.threadIds[0]);
    if (!victim) return;
    this.asking = { key: `tok:${victim.id}`, text: `${victim.name} reads address 0x0` };
    const others = a.threadIds.filter((t) => t !== victim.id).map((t) => this.threads.get(t)?.name ?? t);
    g.ask({
      acceptable: ['proc'],
      choices: [
        { id: 'thread', label: `Only ${victim.name}` },
        { id: 'proc', label: `All of process ${a.letter}` },
        { id: 'all', label: 'Every process' },
      ],
      ask: `${victim.name} just dereferenced a null pointer. What does the OS kill?`,
      explain: (picked, ok) => {
        if (ok)
          return `A segfault kills the whole process. ${others.join(' and ')} share the memory ${victim.name} may have corrupted, so none of it can be trusted. The other process has its own address space and never notices.`;
        if (picked === 'thread')
          return `The OS doesn’t kill just ${victim.name}. SIGSEGV takes down the whole process, because ${others.join(' and ')} share the memory ${victim.name} was touching.`;
        return `Other processes are isolated: separate address spaces, untouched by ${a.letter}’s crash. Only process ${a.letter} dies, all of its threads with it.`;
      },
      resolve: (picked, ok) => {
        this.asking = null;
        this.crashThread(victim.id, 'SIGSEGV');
        if (ok) this.crashOk = true;
        else {
          // Try again with a fresh copy of the process.
          this.after(3.2, () => this.restartProcess(a.id));
          this.crashAskAt = this.t + 6.5;
        }
      },
    });
  }

  /* ---------------------------------------------------------------- */
  /* Scripted modes: race, IPC, spawning                               */
  /* ---------------------------------------------------------------- */

  private startModes() {
    const gen = this.modeGen;
    const a = [...this.procs.values()][0];
    if (this.cfg.race !== 'off' && a) {
      // hits lives on the heap; the mutex is a global, so it shows in the data segment.
      a.objs = [{ name: 'hits', value: String(this.race.value), color: SIG.text, vt: -10 }];
      a.globals = this.cfg.race === 'lock' ? 'mu: unlocked' : 'mu: unused';
      a.globalsColor = null;
      this.after(0.9, () => this.raceRound(gen));
    }
    if (this.cfg.ipc) {
      const b = [...this.procs.values()][1];
      if (a && b) {
        a.objs = [{ name: 'order', value: `#${this.seq.msg}`, color: SIG.text, vt: -10 }];
        b.objs = [{ name: 'buf', value: 'empty', color: SIG.text2, vt: -10 }];
      }
      this.after(1.0, () => this.ipcRound(gen));
    }
    if (this.cfg.spawn !== 'off' && a) {
      const fork = this.cfg.spawn === 'fork';
      [1.0, 2.1, 3.2].forEach((at) =>
        this.after(at, () => {
          if (gen !== this.modeGen) return;
          if (fork) this.forkProcess(a.id);
          else this.spawnThread(a.id);
        }),
      );
    }
  }

  private coreOf(tid: string) {
    const th = this.threads.get(tid);
    return th?.core ?? null;
  }

  private raceRound(gen: number) {
    if (gen !== this.modeGen || this.cfg.race === 'off') return;
    const a = [...this.procs.values()][0];
    if (!a || !a.alive) return;
    const [t1, t2] = a.threadIds;
    const v = this.race.value;
    const hits = () => a.objs.find((o) => o.name === 'hits');
    const setHits = (val: number, by: string, bad = false) => {
      const o = hits();
      const th = this.threads.get(by);
      if (o) {
        o.value = String(val);
        o.vt = this.vt;
        o.color = th?.color ?? SIG.text;
        o.bad = bad;
      }
      this.race.value = val;
      this.rev++;
    };
    const load = (tid: string, then: (val: number) => void) => {
      const ci = this.coreOf(tid);
      if (ci == null) return;
      this.send({
        from: `core:${ci}`,
        to: `obj:${a.id}`,
        dur: 0.4,
        color: SIG.req,
        r: 3.6,
        label: 'load',
        onArrive: () => {
          const val = this.race.value;
          this.send({
            from: `obj:${a.id}`,
            to: `core:${ci}`,
            dur: 0.4,
            color: SIG.req,
            r: 3.6,
            label: String(val),
            onArrive: () => {
              const c = this.cores[ci];
              if (c) c.reg = `${val}`;
              this.rev++;
              then(val);
            },
          });
        },
      });
    };
    const store = (tid: string, val: number, lost: boolean) => {
      const ci = this.coreOf(tid);
      if (ci == null) return;
      this.send({
        from: `core:${ci}`,
        to: `obj:${a.id}`,
        dur: 0.45,
        color: lost ? SIG.err : SIG.res,
        r: 3.8,
        label: `store ${val}`,
        onArrive: () => {
          this.race.attempts++;
          setHits(val, tid, lost);
          const c = this.cores[ci];
          if (c) c.reg = null;
          if (lost) {
            this.race.lost++;
            const r = this.objRect(a, 0);
            const pb = this.boxes.get(`proc:${a.id}`);
            const at = this.M.L ? (r ? { x: r.x0 + r.w + 78, y: r.y0 + r.h / 2 + 8 } : null) : pb ? { x: pb.x, y: pb.y + pb.h / 2 + 24 } : null;
            if (at) this.fx({ kind: 'text', at, text: `lost update: still ${val}`, color: SIG.err, dur: 2 });
          }
        },
      });
    };

    this.race.round++;
    if (this.cfg.race === 'nolock') {
      // Both load before either stores, so both write back the same number.
      let r1 = v;
      let r2 = v;
      load(t1, (val) => (r1 = val));
      this.after(0.22, () => load(t2, (val) => (r2 = val)));
      this.after(1.35, () => store(t1, r1 + 1, false));
      // A1's store lands first, so A2's identical store overwrites it: the update is lost.
      this.after(1.6, () => store(t2, r2 + 1, r2 === r1));
      this.after(3.3, () => this.raceRound(gen));
      return;
    }
    // With a mutex: the second thread waits (off the CPU) until the first unlocks.
    const setMutex = (owner: string | null) => {
      const th = owner ? this.threads.get(owner) : null;
      a.globals = th ? `mu: locked by ${th.name}` : 'mu: unlocked';
      a.globalsColor = th?.color ?? null;
      this.race.owner = owner;
      this.rev++;
    };
    const lockMsg = (tid: string, label: string, color: string, then: () => void) => {
      const ci = this.coreOf(tid);
      if (ci == null) {
        then();
        return;
      }
      this.send({ from: `core:${ci}`, to: `lock:${a.id}`, dur: 0.35, color, r: 3.4, label, onArrive: then });
    };
    lockMsg(t1, 'lock', SIG.hc, () => setMutex(t1));
    this.after(0.25, () =>
      lockMsg(t2, 'lock', SIG.hc, () => {
        const th = this.threads.get(t2);
        if (th && th.state === 'running') this.waitOnLock(th);
      }),
    );
    this.after(0.55, () =>
      load(t1, (val) => {
        this.after(0.35, () => store(t1, val + 1, false));
      }),
    );
    this.after(2.1, () =>
      lockMsg(t1, 'unlock', SIG.hc, () => {
        setMutex(t2);
        const th = this.threads.get(t2);
        if (th && th.state === 'lock') this.makeReady(th);
      }),
    );
    this.after(2.95, () =>
      load(t2, (val) => {
        this.after(0.35, () => store(t2, val + 1, false));
      }),
    );
    this.after(4.35, () => lockMsg(t2, 'unlock', SIG.hc, () => setMutex(null)));
    this.after(5.0, () => this.raceRound(gen));
  }

  /** A thread asks for a held mutex: it leaves the CPU until it is woken. */
  private waitOnLock(th: Thread) {
    const ci = th.core;
    if (ci == null) return;
    const core = this.cores[ci];
    this.closeSeg(core);
    core.thread = null;
    core.sw = null;
    core.reg = null;
    th.core = null;
    th.state = 'lock';
    this.rev++;
    this.dispatch(core, th, 'lock');
  }

  private ipcRound(gen: number) {
    if (gen !== this.modeGen || !this.cfg.ipc) return;
    const [a, b] = [...this.procs.values()];
    if (!a || !b || !a.alive || !b.alive) {
      this.after(1.5, () => this.ipcRound(gen));
      return;
    }
    const msg = `#${this.seq.msg}`;
    const ao = a.objs[0];
    if (ao) {
      ao.value = msg;
      ao.vt = this.vt;
    }
    this.send({
      from: `obj:${a.id}`,
      to: 'pipe',
      dur: 0.9,
      color: SIG.req,
      shape: 'envelope',
      label: 'write()',
      onArrive: () => {
        this.ipc.copies++;
        this.ipc.calls++;
        this.ipc.buf.push(msg);
        this.rev++;
        this.after(0.55, () => {
          this.send({
            from: 'pipe',
            to: `obj:${b.id}`,
            dur: 0.9,
            color: SIG.req,
            shape: 'envelope',
            label: 'read()',
            onArrive: () => {
              this.ipc.copies++;
              this.ipc.calls++;
              this.ipc.msgs++;
              this.ipc.buf.shift();
              const bo = b.objs[0];
              if (bo) {
                bo.value = msg;
                bo.vt = this.vt;
                bo.color = SIG.text;
              }
              this.rev++;
            },
          });
        });
      },
    });
    this.seq.msg++;
    this.after(2.6, () => this.ipcRound(gen));
  }

  /** The first step: run a program file and watch it become a process. */
  launchProgram() {
    const spec = this.cfg.procs[0];
    if (!spec || this.procs.has(spec.id)) return;
    this.launchPhase = 'loading';
    const p = this.addProc(spec, 0, 1.25, 'loading');
    this.send({ from: 'file', to: `code:${p.id}`, dur: 0.7, color: SIG.req, label: 'code', r: 4 });
    this.after(0.3, () => this.send({ from: 'file', to: `data:${p.id}`, dur: 0.7, color: SIG.req, label: 'data', r: 4 }));
    this.after(1.25, () => {
      this.launchPhase = 'running';
      this.rev++;
    });
    if (this.sized) this.relayout();
    this.rev++;
  }

  /* ---------------------------------------------------------------- */
  /* Stats                                                             */
  /* ---------------------------------------------------------------- */

  private accumulate(dt: number) {
    let b = this.bk[this.bk.length - 1];
    if (!b || this.t - b.t >= 0.5) {
      b = { t: this.t, run: 0, sw: 0, idle: 0 };
      this.bk.push(b);
      if (this.bk.length > 24) this.bk.shift();
    }
    for (const c of this.cores) {
      if (c.sw) b.sw += dt;
      else if (c.thread) b.run += dt;
      else b.idle += dt;
    }
  }

  /* ---------------------------------------------------------------- */
  /* Layout                                                            */
  /* ---------------------------------------------------------------- */

  protected layout() {
    const c = this.cfg;
    const L = this.orient === 'landscape';
    const W = this.w;
    const H = this.h;
    const padX = L ? (this.compact ? 18 : 26) : 12;
    const top = L ? 84 : 70;
    let bottom = H - (L ? 104 : 72);
    if (!L && c.readout) bottom -= 74;
    const M: Metrics = { L, tokR: 12, detail: 'full', gantt: null, queue: null, tabs: false, table: null };

    // Timeline, docked at the bottom.
    if (c.gantt) {
      const n = c.cores;
      const rowH = L ? 20 : 13;
      const rowGap = L ? 6 : 4;
      const head = L ? 22 : 16;
      const axis = L ? 17 : 14;
      const gh = head + n * rowH + (n - 1) * rowGap + axis;
      const gw = Math.min(W - 2 * padX, 900);
      const gy = bottom - gh;
      M.gantt = { x: (W - gw) / 2, y: gy, w: gw, h: gh, rowH, rowGap, head, labelW: L ? 62 : 44, win: L ? 12 : 8 };
      this.place('gantt', W / 2, gy + gh / 2, gw, gh);
      bottom = gy - (L ? 26 : 14);
    } else this.hide('gantt');

    // CPU chip geometry (placed below, once we know how much room is left).
    const n = c.cores;
    const sideP = !L && (c.disk || c.file) ? 104 : 0;
    const cg = L ? 14 : 6;
    const cp = L ? 11 : 7;
    const coreH = L ? 76 : 54;
    const coreW = L ? (n <= 2 ? 150 : 128) : clamp(Math.floor((W - 2 * padX - 2 * cp - (n - 1) * cg - (sideP ? sideP + 12 : 0)) / n), 54, 96);
    const chipW = n * coreW + (n - 1) * cg + 2 * cp;
    const chipH = coreH + 2 * cp;
    const chipBlock = 14 + chipH;
    const queueBlock = c.queue ? (L ? 44 : 34) : 0;

    // Processes (and the file, disk or kernel pipe beside them).
    const procs = [...this.procs.values()];
    const np = procs.length;
    const baseGap = L ? 34 : 24;
    const rowTop0 = top + chipBlock + queueBlock + baseGap;
    let rowBot = bottom;
    const kernelBelow = c.kernel && !L;
    if (kernelBelow) rowBot -= 72;
    const tabs = procs.some((p) => !!p.tab);
    M.tabs = tabs;
    const tabH = tabs ? 20 : 0;
    const g = L ? (np >= 4 ? 18 : 26) : 10;
    const fileW = c.file && L ? 170 : 0;
    const diskW = c.disk && L ? 128 : 0;
    const kernW = c.kernel && L ? 156 : 0;
    const sides = [fileW, diskW, kernW].filter((v) => v > 0);
    const sideW = sides.reduce((acc, s) => acc + s + g, 0);
    // The live thread table takes a column on the right, if the processes still fit beside it.
    const tableW = 262;
    const needW = np * minW('full') + Math.max(0, np - 1) * g + sideW;
    const withTable = L && c.table && W - 2 * padX - tableW - 22 >= needW;
    const mx0 = padX;
    const mx1 = withTable ? W - padX - tableW - 22 : W - padX;
    if (withTable) M.table = { x: W - padX - tableW, y: top + 4, w: tableW };
    const availW = mx1 - mx0 - sideW;
    const perRow = L ? Math.max(1, np) : Math.min(2, Math.max(1, np));
    const nRows = Math.max(1, Math.ceil(np / perRow));
    const rg = L ? 22 : 14;
    const hAvail = rowBot - rowTop0;
    const maxT = Math.max(1, ...procs.map((p) => p.threadIds.length));
    const auto: DetailKey[] = L ? ['xl', 'full', 'compact', 'mini'] : ['full', 'compact', 'mini'];
    const order: DetailKey[] = c.detail === 'auto' ? auto : [c.detail, 'compact', 'mini'];
    let dk: DetailKey = 'mini';
    for (const k of order) {
      const colW = Math.min(prefW(k, maxT), (availW - (perRow - 1) * g) / perRow);
      const totalH = nRows * (procH(k) + tabH) + (nRows - 1) * rg;
      if (colW >= minW(k, !L) && totalH <= hAvail + 4) {
        dk = k;
        break;
      }
    }
    M.detail = dk;
    M.tokR = L ? DET[dk].tok : DET[dk].tok - (dk === 'full' ? 1 : 0.5);
    const pw = Math.floor(Math.min(prefW(dk, maxT), (availW - (perRow - 1) * g) / perRow));
    const ph = procH(dk);
    const totalH = nRows * (ph + tabH) + (nRows - 1) * rg;

    // Share out spare height: a little above the chip, more between chip and processes.
    const free = Math.max(0, hAvail - totalH);
    const shift = L ? Math.min(free * 0.28, 64) : Math.min(free * 0.2, 18);
    const boost = L ? Math.min(free * 0.34, 96) : Math.min(free * 0.3, 40);

    const chipX = (mx0 + mx1 - (chipW + (sideP ? sideP + 12 : 0))) / 2 + chipW / 2;
    const chipY = top + shift + 14 + chipH / 2;
    this.place('cpu', chipX, chipY, chipW, chipH);
    for (let i = 0; i < 4; i++) {
      if (i < n) this.place(`core:${i}`, chipX - chipW / 2 + cp + coreW / 2 + i * (coreW + cg), chipY, coreW, coreH);
      else this.hide(`core:${i}`);
    }
    if (sideP) {
      const sx = chipX + chipW / 2 + 12 + sideP / 2;
      if (c.file) this.place('file', sx, chipY, sideP, chipH + 6);
      else this.hide('file');
      if (c.disk) this.place('disk', sx, chipY, sideP, chipH + 6);
      else this.hide('disk');
    }
    if (c.queue) M.queue = { x0: mx0 + 4, x1: mx1 - 4, y: chipY + chipH / 2 + (L ? 30 : 22) };

    const y0 = rowTop0 + shift + boost;
    if (L) {
      const items: { kind: 'file' | 'disk' | 'kernel' | 'proc'; id?: string; w: number }[] = [];
      if (fileW) items.push({ kind: 'file', w: fileW });
      procs.forEach((p, i) => {
        items.push({ kind: 'proc', id: p.id, w: pw });
        if (i === 0 && kernW && np > 1) items.push({ kind: 'kernel', w: kernW });
      });
      if (diskW) items.push({ kind: 'disk', w: diskW });
      const total = items.reduce((acc, it) => acc + it.w, 0) + (items.length - 1) * g;
      let x = (mx0 + mx1 - total) / 2;
      const cy = y0 + tabH + ph / 2;
      for (const it of items) {
        const cx = x + it.w / 2;
        if (it.kind === 'proc') this.place(`proc:${it.id}`, cx, cy, it.w, ph);
        else if (it.kind === 'file') this.place('file', cx, cy, it.w, 128);
        else if (it.kind === 'disk') this.place('disk', cx, cy - 28, it.w, 88);
        else this.place('kernel', cx, cy, it.w, Math.min(124, ph));
        x += it.w + g;
      }
      if (!fileW) this.hide('file');
      if (!diskW) this.hide('disk');
      if (!kernW) this.hide('kernel');
    } else {
      procs.forEach((p, i) => {
        const r = Math.floor(i / perRow);
        const inRow = Math.min(perRow, np - r * perRow);
        const col = i % perRow;
        const cx = W / 2 + (col - (inRow - 1) / 2) * (pw + g);
        const cy = y0 + r * (ph + tabH + rg) + tabH + ph / 2;
        this.place(`proc:${p.id}`, cx, cy, pw, ph);
      });
      if (kernelBelow) this.place('kernel', W / 2, Math.min(rowBot, y0 + totalH) + 44, Math.min(230, W - 2 * padX), 54);
      else this.hide('kernel');
      if (!sideP) {
        this.hide('file');
        this.hide('disk');
      }
    }
    this.M = M;
  }

  /* ---------------------------------------------------------------- */
  /* Geometry                                                          */
  /* ---------------------------------------------------------------- */

  procGeom(p: Proc): PGeom | null {
    const b = this.boxes.get(`proc:${p.id}`);
    if (!b || Number.isNaN(b.x)) return null;
    const dk = this.M.detail;
    const d = detOf(dk, !this.M.L);
    const x0 = b.x - b.w / 2;
    const y0 = b.y - b.h / 2;
    const inX = x0 + d.pad + d.label;
    const inW = b.w - d.pad * 2 - d.label;
    let y = y0 + d.head;
    const stack: TL = { x0: inX, y0: y, w: inW, h: d.stack };
    const n = Math.max(1, p.threadIds.length);
    const colW = inW / n;
    const tok = this.M.tokR;
    const cols: Col[] = p.threadIds.map((tid, i) => {
      const cx = inX + colW * (i + 0.5);
      const hy = y + tok + 5;
      const fy = hy + tok + 6;
      const maxFrames = Math.max(1, Math.floor((y + d.stack - fy - 1) / (d.frameH + 2)));
      return { tid, x0: inX + colW * i, w: colW, cx, hy, fy, maxFrames };
    });
    y += d.stack + d.gap;
    const heap: TL = { x0: inX, y0: y, w: inW, h: d.heap };
    y += d.heap + 3;
    let data: TL | null = null;
    let code: TL | null = null;
    let files: TL | null = null;
    let codeData: TL | null = null;
    if (dk === 'full' || dk === 'xl') {
      data = { x0: inX, y0: y, w: inW, h: d.band };
      y += d.band + 3;
      code = { x0: inX, y0: y, w: inW, h: d.band };
      y += d.band + 3;
      files = { x0: inX, y0: y, w: inW, h: d.band };
    } else if (dk === 'compact') {
      codeData = { x0: inX, y0: y, w: inW, h: d.band };
    }
    return { box: { x0, y0, w: b.w, h: b.h }, dk, head: { x0, y0, w: b.w, h: d.head }, stack, cols, heap, data, code, files, codeData, labelX: x0 + d.pad };
  }

  /** Where the heap object chips sit (race counter, IPC message). */
  objRect(p: Proc, i: number): TL | null {
    const g = this.procGeom(p);
    if (!g) return null;
    const w = g.dk === 'xl' ? 100 : g.dk === 'full' ? 84 : g.dk === 'compact' ? 72 : 60;
    const h = g.heap.h - 8;
    return { x0: g.heap.x0 + 4 + i * (w + 6), y0: g.heap.y0 + 4, w, h };
  }

  /** Center-based rectangle for any named thing on the stage (callouts, flights, highlights). */
  rectOf(key: string): { x: number; y: number; w: number; h: number } | null {
    const b = this.boxes.get(key);
    if (b && !Number.isNaN(b.x)) return { x: b.x, y: b.y, w: b.w, h: b.h };
    const i = key.indexOf(':');
    const kind = i > 0 ? key.slice(0, i) : key;
    const id = i > 0 ? key.slice(i + 1) : '';
    if (kind === 'heap' || kind === 'stack' || kind === 'data' || kind === 'code' || kind === 'files' || kind === 'head') {
      const p = this.procs.get(id);
      const g = p ? this.procGeom(p) : null;
      if (!g) return null;
      const r = kind === 'data' || kind === 'code' ? (g[kind] ?? g.codeData) : g[kind];
      return r ? tl2c(r) : null;
    }
    if (kind === 'tok') {
      const t = this.threads.get(id);
      if (!t || Number.isNaN(t.x)) return null;
      const r = this.M.tokR;
      return { x: t.x, y: t.y, w: r * 2, h: r * 2 };
    }
    if (kind === 'col' || kind === 'home') {
      const t = this.threads.get(id);
      const p = t ? this.procs.get(t.procId) : null;
      const g = p ? this.procGeom(p) : null;
      const col = g?.cols.find((c) => c.tid === id);
      if (!g || !col) return null;
      if (kind === 'home') return { x: col.cx, y: col.hy, w: this.M.tokR * 2, h: this.M.tokR * 2 };
      return { x: col.x0 + col.w / 2, y: g.stack.y0 + g.stack.h / 2, w: col.w, h: g.stack.h };
    }
    if (kind === 'obj') {
      const p = this.procs.get(id);
      const r = p ? this.objRect(p, 0) : null;
      return r ? tl2c(r) : null;
    }
    if (kind === 'lock') {
      // The mutex is a global: it lives in the data segment.
      const p = this.procs.get(id);
      const g = p ? this.procGeom(p) : null;
      const r = g ? (g.data ?? g.codeData) : null;
      return r ? { x: r.x0 + Math.min(70, r.w / 2), y: r.y0 + r.h / 2, w: Math.min(140, r.w), h: r.h } : null;
    }
    if (kind === 'pipe') {
      const k = this.boxes.get('kernel');
      if (!k || Number.isNaN(k.x)) return null;
      // Landscape: under the title. Portrait: near the top, title underneath.
      return this.M.L ? { x: k.x, y: k.y + 12, w: Math.min(110, k.w - 30), h: 26 } : { x: k.x, y: k.y - k.h / 2 + 20, w: Math.min(110, k.w - 30), h: 18 };
    }
    if (kind === 'queue') {
      const q = this.M.queue;
      return q ? { x: (q.x0 + q.x1) / 2, y: q.y, w: q.x1 - q.x0, h: 22 } : null;
    }
    return null;
  }

  /** Blocked threads park next to the disk while they wait. */
  parkPos(th: Thread): Pt | null {
    const d = this.boxes.get('disk');
    if (!d || Number.isNaN(d.x) || d.removing) return null;
    const blocked = [...this.threads.values()].filter((t) => t.state === 'blocked');
    const i = blocked.indexOf(th);
    const n = blocked.length;
    const r = this.M.tokR;
    const step = r * 2 + 6;
    const x = d.x + (i - (n - 1) / 2) * step;
    const y = this.M.L ? d.y + d.h / 2 + r + 12 : d.y + d.h / 2 - r - 6;
    return { x, y };
  }

  tokTarget(th: Thread): Pt | null {
    // Dead threads fall back into their (dead) process, so they never linger on a core.
    if (th.state === 'running' && th.core != null) {
      const b = this.boxes.get(`core:${th.core}`);
      if (b && !Number.isNaN(b.x)) return { x: b.x, y: b.y + (this.M.L ? 5 : 4) };
    }
    if (th.state === 'blocked') {
      const pp = this.parkPos(th);
      if (pp) return pp;
    }
    const r = this.rectOf(`home:${th.id}`);
    return r ? { x: r.x, y: r.y } : null;
  }

  protected animate(dt: number) {
    for (const th of this.threads.values()) {
      const tg = this.tokTarget(th);
      if (!tg) continue;
      if (Number.isNaN(th.x)) {
        th.x = tg.x;
        th.y = tg.y;
        continue;
      }
      const k = th.state === 'running' ? 14 : 11;
      th.x = damp(th.x, tg.x, k, dt);
      th.y = damp(th.y, tg.y, k, dt);
    }
  }

  protected curveFor(from: string, to: string, lane: number): Curve | null {
    const a = this.rectOf(from);
    const b = this.rectOf(to);
    if (!a || !b) return null;
    return portCurve(asBox(a), asBox(b), lane);
  }

  protected wires(): WireSpec[] {
    const out: WireSpec[] = [];
    if (this.cfg.kernel) {
      const [a, b] = [...this.procs.values()];
      if (a && this.isLive('kernel')) out.push({ from: `proc:${a.id}`, to: 'kernel', state: a.alive ? 'dashed' : 'down' });
      if (b && this.isLive('kernel')) out.push({ from: 'kernel', to: `proc:${b.id}`, state: b.alive ? 'dashed' : 'down' });
    }
    if (this.cfg.file && this.isLive('file') && this.launchPhase !== 'running') {
      const p = [...this.procs.values()][0];
      if (p) out.push({ from: 'file', to: `proc:${p.id}`, state: 'dashed' });
    }
    return out;
  }

  /** Top-left rect of a box, for drawing. */
  tl(id: string): TL | null {
    const b = this.boxes.get(id);
    return b && !Number.isNaN(b.x) ? c2tl(b) : null;
  }
}
