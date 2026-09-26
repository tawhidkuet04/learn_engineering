import { SIG } from '@/lib/sim/colors';

/*
 * A tiny JavaScript runtime, one instruction at a time.
 *
 * Programs are written twice: as the exact source the learner reads, and as a
 * list of ops (one per thing that happens on a line). The Machine runs the ops
 * with the real rules: one call stack, Web APIs that count down on their own,
 * a task queue, a microtask queue that is drained completely after every
 * task, and a render step when a frame is due. Everything that moves on the
 * stage is a "visual id" (vid) that the sim positions from this state.
 */

export type QName = 'task' | 'micro' | 'raf' | 'timers' | 'poll' | 'check';
export type Policy = 'browser' | 'node';
export type Icon = 'script' | 'timer' | 'net' | 'click' | 'promise' | 'resume' | 'raf' | 'fn' | 'api' | 'file' | 'immediate';
export type FrameKind = 'script' | 'fn' | 'api' | 'task' | 'micro' | 'raf' | 'io' | 'immediate';
export type Text = string | ((m: Machine) => string);

export interface Fn {
  /** Function name for stack frames, e.g. "greet" → greet('Ada') */
  name: string;
  /** Label on the card while it waits in a queue, e.g. "timeout → B" */
  card?: string;
  body: Op[];
  async?: boolean;
}

export interface PromiseRef {
  id: number;
  state: 'pending' | 'fulfilled';
  waiters: Job[];
  label: string;
}

export type Op =
  | { op: 'log'; line: number; text: Text; src?: string; pre?: (m: Machine) => void }
  | { op: 'stmt'; line: number; cost?: number; dur?: number; run?: (m: Machine) => void; mark?: Text }
  | { op: 'dom'; line: number; run: (m: Machine) => void; mark?: Text }
  | { op: 'call'; line: number; fn: Fn; args?: string; label?: string }
  | { op: 'return'; line: number; mark?: Text }
  | { op: 'timeout'; line: number; ms: number; fn: Fn; api?: string; repeat?: boolean }
  | { op: 'sleep'; line: number; ms: number; api?: string }
  | { op: 'then'; line: number; fn: Fn; on?: 'resolved' | 'last'; api?: string; wait?: string }
  | { op: 'micro'; line: number; fn: Fn; api?: string }
  | { op: 'await'; line: number; on: 'value' | 'last'; wait?: string }
  | { op: 'fetch'; line: number; url: string; ms: number }
  | { op: 'work'; line: number; ms: number }
  | { op: 'listen'; line: number; fn: Fn; api?: string }
  | { op: 'raf'; line: number; fn: Fn }
  | { op: 'if'; line: number; test: (m: Machine) => boolean; body: Op[] }
  | { op: 'resolve'; line: number; p: PromiseRef }
  | { op: 'immediate'; line: number; fn: Fn }
  | { op: 'readFile'; line: number; ms: number; fn: Fn };

export interface Program {
  id: string;
  /** File name on the code pane */
  file: string;
  code: string;
  main: Op[];
  policy?: Policy;
  /** What a correct run prints (asserted in development) */
  expect?: string[];
  /** Ask the learner for the whole output before it runs */
  ask?: { choices: string[]; answer: number; explain: string };
  /** The mini page next to the render step */
  screen?: 'cart' | 'anim' | null;
  /** Virtual ms until the first frame is due */
  firstFrame?: number;
}

export interface Frame {
  vid: string;
  label: string;
  kind: FrameKind;
  icon: Icon;
  body: Op[];
  pc: number;
  line: number | null;
  parent?: Frame;
  async?: { promise: PromiseRef; returned: boolean };
  last?: PromiseRef;
  onFinish?: () => void;
  work?: { from: number; ms: number };
  resumed?: boolean;
}

export interface Job {
  vid: string;
  label: string;
  q: QName;
  icon: Icon;
  make: () => Frame;
  line?: number;
  /** Shown under the card while it's parked on a pending promise */
  sub?: string;
  /** First thing it prints, for predict questions */
  says?: string;
}

export interface ApiItem {
  vid: string;
  kind: 'timer' | 'interval' | 'net' | 'listener' | 'file';
  label: string;
  start: number;
  due: number;
  /** Sim time before which it can't fire, so the learner sees it arrive */
  readyAt: number;
  line: number;
  fire: () => void;
}

export interface OutLine {
  text: string;
  src: 'script' | 'task' | 'timer' | 'micro' | 'raf' | 'io' | 'immediate';
  /** Sim time it was printed (the line appears when the dot lands) */
  t: number;
}

export type LoopState = 'run' | 'drain' | 'render' | 'pick' | 'idle' | 'phase' | 'exit';

export interface Host {
  t(): number;
  vt(): number;
  frozen(): boolean;
  /** A new visual starts at the position of `from` (or drops into place) */
  spawn(vid: string, from: string | null): void;
  /** A visual leaves (fades out) */
  drop(vid: string): void;
  flight(from: string, to: string, color: string): void;
  ring(vid: string, color: string): void;
  /** Predict hook: return true after asking a question (the sim freezes) */
  gate(kind: 'start' | 'drain'): boolean;
  finished(): void;
  /** Single-step mode: may the machine start its next logical step? */
  mayStart(): boolean;
  started(): void;
}

export const FRAME_MS = 1000 / 60;
/** Virtual ms of busy work per simulated second */
export const WORK_RATE = 160;

export const BROWSER_STATIONS = ['task', 'micro', 'render'] as const;
export const NODE_PHASES = ['timers', 'pending', 'idle', 'poll', 'check', 'close'] as const;

export const KIND_COLOR: Record<FrameKind, string> = {
  script: SIG.line,
  fn: SIG.text2,
  api: SIG.dim,
  task: SIG.req,
  micro: SIG.hc,
  raf: SIG.res,
  io: SIG.teal,
  immediate: SIG.pink,
};

export const Q_COLOR: Record<QName, string> = {
  task: SIG.req,
  micro: SIG.hc,
  raf: SIG.res,
  timers: SIG.req,
  poll: SIG.teal,
  check: SIG.pink,
};

const B = { push: 0.34, act: 0.46, pop: 0.28, line: 0.44, move: 0.44, pass: 0.3, deq: 0.52, pause: 0.7, paint: 0.26 };

interface Beat {
  dur: number;
  /** Virtual ms that pass during the beat */
  cost?: number;
  act?: () => void;
}

const val = (t: Text, m: Machine) => (typeof t === 'function' ? t(m) : t);

/** First literal thing a function prints (for predict choices). */
function firstSay(body: Op[]): string | undefined {
  for (const op of body) {
    if (op.op === 'log' && typeof op.text === 'string') return op.text;
  }
  return undefined;
}

export class Machine {
  policy: Policy = 'browser';
  prog: Program | null = null;

  ms = 0;
  stack: Frame[] = [];
  apis: ApiItem[] = [];
  parked: { job: Job; p: PromiseRef }[] = [];
  queues: Record<QName, Job[]> = { task: [], micro: [], raf: [], timers: [], poll: [], check: [] };
  out: OutLine[] = [];
  marks: Record<number, string> = {};
  vars: Record<string, number> = {};

  loop: LoopState = 'pick';
  /** Index into BROWSER_STATIONS or NODE_PHASES */
  station = 0;
  /** Loop stations passed so far (the pointer only moves forward) */
  lap = 0;
  note = '';
  renderList: Job[] | null = null;
  renderStep: 'style' | 'layout' | 'paint' | null = null;

  ran = { task: 0, micro: 0, raf: 0 };
  frames = 0;
  lastPaint = -1e9;
  paintVt = -10;
  dirty = false;
  dom = { x: 0, label: 'Buy' };
  painted = { x: 0, label: 'Buy' };
  clicks = 0;
  finishedFlag = false;
  started = false;

  private listenerFn: Fn | null = null;
  private seq = 0;
  private pseq = 0;
  private beats: Beat[] = [];
  private cur: Beat | null = null;
  private left = 0;
  private rate = 0;
  private idleFor = NaN;
  private idleRate = 0;

  constructor(private host: Host) {}

  /* ---------------------------------------------------------------- */
  /* setup                                                             */
  /* ---------------------------------------------------------------- */

  load(prog: Program) {
    this.prog = prog;
    this.policy = prog.policy ?? 'browser';
    this.ms = 0;
    this.stack = [];
    this.apis = [];
    this.parked = [];
    this.queues = { task: [], micro: [], raf: [], timers: [], poll: [], check: [] };
    this.out = [];
    this.marks = {};
    this.vars = {};
    this.loop = 'pick';
    this.station = 0;
    this.lap = 0;
    this.note = '';
    this.renderList = null;
    this.renderStep = null;
    this.ran = { task: 0, micro: 0, raf: 0 };
    this.frames = 0;
    this.lastPaint = (prog.firstFrame ?? 0) - FRAME_MS;
    this.paintVt = -10;
    this.dirty = false;
    this.dom = { x: 0, label: 'Buy' };
    this.painted = { x: 0, label: 'Buy' };
    this.clicks = 0;
    this.finishedFlag = false;
    this.started = false;
    this.listenerFn = null;
    this.beats = [];
    this.cur = null;
    this.left = 0;
    this.rate = 0;
    this.idleFor = NaN;

    if (this.policy === 'node') {
      // Node runs the main module first, then starts the loop.
      const f = this.frame('main module', 'script', prog.main, 'script');
      this.stack.push(f);
      this.host.spawn(f.vid, null);
      this.loop = 'run';
      this.note = 'run the main module';
      return;
    }
    const script: Job = {
      vid: this.vid(),
      label: 'main script',
      q: 'task',
      icon: 'script',
      make: () => this.frame('main script', 'script', prog.main, 'script', script.vid),
    };
    this.queues.task.push(script);
    this.host.spawn(script.vid, null);
  }

  vid() {
    return `v${++this.seq}`;
  }

  /* ---------------------------------------------------------------- */
  /* queries used by the stage                                         */
  /* ---------------------------------------------------------------- */

  get top(): Frame | undefined {
    return this.stack[this.stack.length - 1];
  }

  /** The line the code pane highlights: the innermost user frame's line. */
  get activeLine(): number | null {
    for (let i = this.stack.length - 1; i >= 0; i--) {
      const f = this.stack[i];
      if (f.line != null && f.line > 0) return f.line;
    }
    return null;
  }

  get busy() {
    return this.stack.length > 0;
  }

  get idle() {
    return this.loop === 'idle' || this.loop === 'exit';
  }

  /** Lines with a callback still waiting somewhere, and the color of where it waits. */
  pendingLines(): Record<number, string> {
    const out: Record<number, string> = {};
    for (const a of this.apis) if (a.kind !== 'listener') out[a.line] = SIG.req;
    for (const p of this.parked) if (p.job.line) out[p.job.line] = SIG.hc;
    for (const q of Object.keys(this.queues) as QName[]) {
      for (const j of this.queues[q]) if (j.line) out[j.line] = Q_COLOR[q];
    }
    return out;
  }

  needsRender() {
    return this.queues.raf.length > 0 || this.dirty;
  }

  frameReady() {
    return this.needsRender() && this.ms - this.lastPaint >= FRAME_MS - 1e-6;
  }

  /** Virtual ms until the next frame could be drawn (for the loop's note). */
  nextFrameIn() {
    return Math.max(0, this.lastPaint + FRAME_MS - this.ms);
  }

  hasListener() {
    return this.apis.some((a) => a.kind === 'listener');
  }

  /* ---------------------------------------------------------------- */
  /* the learner's input                                               */
  /* ---------------------------------------------------------------- */

  /** A click on #buy: the browser queues a task for the listener. */
  click(): boolean {
    const l = this.apis.find((a) => a.kind === 'listener');
    const fn = this.listenerFn;
    if (!l || !fn) return false;
    const vid = this.vid();
    this.host.spawn(vid, l.vid);
    this.host.ring(l.vid, SIG.warn);
    this.clicks++;
    const label = `click #${this.clicks}`;
    this.enqueue({ vid, label, q: 'task', icon: 'click', line: l.line, says: firstSay(fn.body), make: () => this.frame(label, 'task', fn.body, 'click', vid) });
    return true;
  }

  /* ---------------------------------------------------------------- */
  /* the clock                                                         */
  /* ---------------------------------------------------------------- */

  tick(dt: number) {
    // Charge a beat's cost exactly: never past the end of the beat.
    if (this.cur) this.ms += this.rate * Math.min(dt, Math.max(0, this.left));
    else if (this.loop === 'idle') this.ms += this.idleClock() * dt;
    this.environment();

    if (this.cur) {
      this.left -= dt;
      if (this.left > 1e-9) return;
      this.cur = null;
    }
    for (let guard = 0; guard < 80; guard++) {
      if (this.host.frozen()) return;
      let b = this.beats.shift();
      if (!b) {
        if (!this.host.mayStart()) return;
        const seq = this.next();
        if (!seq || !seq.length) return;
        this.host.started();
        this.beats.push(...seq);
        b = this.beats.shift()!;
      }
      b.act?.();
      if (b.dur > 0) {
        this.cur = b;
        this.left = b.dur;
        this.rate = (b.cost ?? 0) / b.dur;
        return;
      }
    }
  }

  /** True while a logical step is still playing out (for single-stepping). */
  get midStep() {
    return !!this.cur || this.beats.length > 0;
  }

  private idleClock() {
    const target = this.nextEventAt();
    if (!Number.isFinite(target)) {
      this.idleFor = NaN;
      return this.hasListener() ? 220 : 0;
    }
    if (target !== this.idleFor) {
      this.idleFor = target;
      const gap = target - this.ms;
      this.idleRate = gap <= 0 ? 0 : Math.min(6000, Math.max(28, gap / 1.15));
    }
    return this.ms >= target ? 0 : this.idleRate;
  }

  private nextEventAt() {
    let t = Infinity;
    for (const a of this.apis) if (Number.isFinite(a.due)) t = Math.min(t, a.due);
    if (this.policy === 'browser' && this.needsRender()) t = Math.min(t, this.lastPaint + FRAME_MS);
    return t;
  }

  /** The browser's own threads: timers expire, responses arrive. */
  private environment() {
    const now = this.host.t();
    const due = this.apis.filter((a) => a.due <= this.ms + 1e-9 && now >= a.readyAt).sort((a, b) => a.due - b.due);
    for (const a of due) a.fire();
  }

  /* ---------------------------------------------------------------- */
  /* scheduling: what happens next                                     */
  /* ---------------------------------------------------------------- */

  private next(): Beat[] | null {
    if (!this.started) {
      this.started = true;
      if (this.host.gate('start')) return [{ dur: 0 }];
      return [{ dur: B.pause }];
    }
    const top = this.top;
    if (top) return this.exec(top);
    return this.policy === 'node' ? this.nodeLoop() : this.browserLoop();
  }

  private move(station: number, cost = 0.01): Beat {
    return {
      dur: B.move,
      cost,
      act: () => {
        const n = this.policy === 'node' ? NODE_PHASES.length : BROWSER_STATIONS.length;
        const steps = (station - this.station + n) % n;
        this.lap += steps;
        this.station = station;
      },
    };
  }

  private browserLoop(): Beat[] | null {
    switch (this.loop) {
      case 'run':
        this.loop = 'drain';
        this.note = 'task done';
        return [this.move(1)];

      case 'drain': {
        if (this.queues.micro.length) {
          if (this.host.gate('drain')) return [{ dur: 0 }];
          this.note = 'run every microtask';
          return this.dequeue('micro');
        }
        this.loop = 'render';
        this.note = 'microtasks: empty';
        return [this.move(2)];
      }

      case 'render': {
        if (this.renderList) {
          if (this.queues.micro.length) return this.dequeue('micro');
          const next = this.renderList.shift();
          if (next) return this.dequeue(null, next);
          this.renderList = null;
          return this.paint();
        }
        if (this.frameReady()) {
          this.renderList = [...this.queues.raf];
          this.queues.raf = [];
          this.note = this.renderList.length ? 'frame due: rAF callbacks' : 'frame due';
          return [{ dur: 0.34, cost: 0.02 }];
        }
        this.loop = 'pick';
        this.note = this.needsRender() ? `no frame due yet` : 'nothing to paint';
        return [{ dur: B.pass, cost: 0.01 }, this.move(0)];
      }

      case 'pick':
        if (this.queues.task.length) {
          this.loop = 'run';
          this.note = 'take one task';
          return this.dequeue('task');
        }
        this.loop = 'idle';
        this.note = 'waiting';
        return [{ dur: 0.05 }];

      case 'idle': {
        if (this.queues.task.length) {
          this.loop = 'pick';
          return [{ dur: 0.12 }];
        }
        if (this.frameReady()) {
          // No task, but a frame is due: go around to the render step.
          this.loop = 'drain';
          this.note = 'frame due';
          return [this.move(1)];
        }
        if (!this.finishedFlag && this.nothingPending()) {
          this.finishedFlag = true;
          this.note = 'all done';
          this.host.finished();
        }
        return null;
      }

      default:
        return null;
    }
  }

  private nothingPending() {
    const q = this.queues;
    return !this.apis.length && !q.task.length && !q.micro.length && !q.raf.length && !this.dirty && !q.timers.length && !q.poll.length && !q.check.length;
  }

  private paint(): Beat[] {
    return [
      { dur: B.paint, cost: 0.4, act: () => (this.renderStep = 'style') },
      { dur: B.paint, cost: 0.6, act: () => (this.renderStep = 'layout') },
      {
        dur: B.paint + 0.1,
        cost: 0.8,
        act: () => {
          this.renderStep = 'paint';
          this.frames++;
          this.lastPaint = this.ms;
          this.paintVt = this.host.vt();
          this.painted = { ...this.dom };
          this.dirty = false;
          this.note = `painted frame ${this.frames}`;
        },
      },
      {
        dur: 0.05,
        act: () => {
          this.renderStep = null;
          this.loop = 'pick';
        },
      },
      this.move(0),
    ];
  }

  /** Move the head of a queue (or a given job) onto the stack. */
  private dequeue(q: QName | null, given?: Job): Beat[] {
    const job = given ?? this.queues[q as QName][0];
    return [
      {
        dur: B.deq,
        cost: 0.02,
        act: () => {
          if (!given && q) this.queues[q].shift();
          const f = job.make();
          f.line = null;
          this.stack.push(f);
          if (job.q === 'micro') this.ran.micro++;
          else if (job.q === 'raf') this.ran.raf++;
          else if (f.kind !== 'script') this.ran.task++;
        },
      },
    ];
  }

  /* ---------------------------------------------------------------- */
  /* Node's phases                                                     */
  /* ---------------------------------------------------------------- */

  private nodeLoop(): Beat[] | null {
    switch (this.loop) {
      case 'run':
        this.loop = 'drain';
        return [{ dur: 0.2, cost: 0.05 }];
      case 'drain':
        if (this.queues.micro.length) return this.dequeue('micro');
        this.loop = 'phase';
        return [{ dur: 0.05 }];
      case 'phase':
        return this.phaseStep();
      case 'idle': {
        if (this.queues.poll.length) {
          this.loop = 'phase';
          this.note = 'I/O callback ready';
          return [{ dur: 0.15 }];
        }
        if (this.queues.timers.length) {
          this.loop = 'phase';
          return [{ dur: 0.05 }, ...this.nextPhase()];
        }
        return null;
      }
      case 'exit':
        return null;
      default:
        return null;
    }
  }

  private phaseStep(): Beat[] | null {
    const ph = NODE_PHASES[this.station];
    const q = this.queues;
    if (ph === 'timers' && q.timers.length) {
      this.note = 'run expired timers';
      this.loop = 'run';
      return this.dequeue('timers');
    }
    if (ph === 'poll') {
      if (q.poll.length) {
        this.note = 'run I/O callbacks';
        this.loop = 'run';
        return this.dequeue('poll');
      }
      // Nothing to run: block here waiting for I/O, unless immediates or
      // expired timers need a turn.
      if (!q.check.length && !q.timers.length && this.apis.length) {
        this.loop = 'idle';
        this.note = this.apis.some((a) => a.kind === 'file') ? 'wait for I/O' : 'wait for a timer';
        return [{ dur: 0.05 }];
      }
    }
    if (ph === 'check' && q.check.length) {
      this.note = 'run setImmediate callbacks';
      this.loop = 'run';
      return this.dequeue('check');
    }
    return this.nextPhase();
  }

  private nextPhase(): Beat[] {
    const nextSt = (this.station + 1) % NODE_PHASES.length;
    const q = this.queues;
    if (nextSt === 0 && !this.apis.length && !q.timers.length && !q.poll.length && !q.check.length && !q.micro.length) {
      return [
        {
          dur: 0.4,
          act: () => {
            this.loop = 'exit';
            this.note = 'nothing left: exit';
            if (!this.finishedFlag) {
              this.finishedFlag = true;
              this.host.finished();
            }
          },
        },
      ];
    }
    const name = NODE_PHASES[nextSt];
    return [
      { ...this.move(nextSt, 0.3), dur: name === 'pending' || name === 'idle' || name === 'close' ? B.move * 0.75 : B.move },
      {
        dur: 0.05,
        act: () => {
          this.note = name === 'pending' || name === 'idle' || name === 'close' ? 'nothing here' : '';
        },
      },
    ];
  }

  /* ---------------------------------------------------------------- */
  /* running code                                                      */
  /* ---------------------------------------------------------------- */

  private frame(label: string, kind: FrameKind, body: Op[], icon: Icon, vid?: string): Frame {
    return { vid: vid ?? this.vid(), label, kind, icon, body, pc: 0, line: null };
  }

  private push(f: Frame) {
    this.stack.push(f);
    this.host.spawn(f.vid, null);
  }

  private promise(label: string): PromiseRef {
    return { id: ++this.pseq, state: 'pending', waiters: [], label };
  }

  private resolved(): PromiseRef {
    const p = this.promise('resolved');
    p.state = 'fulfilled';
    return p;
  }

  private resolve(p: PromiseRef) {
    if (p.state === 'fulfilled') return;
    p.state = 'fulfilled';
    const ws = p.waiters;
    p.waiters = [];
    for (const j of ws) {
      this.parked = this.parked.filter((x) => x.job !== j);
      this.enqueue(j);
    }
  }

  private whenDone(p: PromiseRef, job: Job, wait: string) {
    if (p.state === 'fulfilled') {
      this.enqueue(job);
    } else {
      job.sub = wait;
      p.waiters.push(job);
      this.parked.push({ job, p });
    }
  }

  private enqueue(job: Job) {
    this.queues[job.q].push(job);
  }

  private print(text: string, from: string) {
    const root = this.stack[0];
    const src: OutLine['src'] =
      !root || root.kind === 'script'
        ? 'script'
        : root.kind === 'micro'
          ? 'micro'
          : root.kind === 'raf'
            ? 'raf'
            : root.kind === 'io'
              ? 'io'
              : root.kind === 'immediate'
                ? 'immediate'
                : this.policy === 'node'
                  ? 'timer'
                  : 'task';
    this.out.push({ text, src, t: this.host.t() });
    const color = src === 'script' ? SIG.text : src === 'micro' ? SIG.hc : src === 'raf' ? SIG.res : src === 'io' ? SIG.teal : src === 'immediate' ? SIG.pink : SIG.req;
    this.host.flight(from, 'console', color);
  }

  /** A call into a browser API: push its frame, do the thing, pop. */
  private api(f: Frame, label: string, act: (vid: string) => void, o: { cost?: number; dur?: number } = {}): Beat[] {
    const a = this.frame(label, 'api', [], 'api');
    a.line = f.line;
    return [
      { dur: B.push, cost: 0.01, act: () => this.push(a) },
      { dur: o.dur ?? B.act, cost: o.cost ?? 0.03, act: () => act(a.vid) },
      {
        dur: B.pop,
        act: () => {
          this.stack.pop();
          this.host.drop(a.vid);
          f.pc++;
        },
      },
    ];
  }

  private finish(f: Frame): Beat[] {
    return [
      {
        dur: B.pop,
        act: () => {
          this.stack.pop();
          this.host.drop(f.vid);
          if (f.async) {
            this.resolve(f.async.promise);
            if (!f.async.returned) this.returnTo(f);
          } else if (f.parent) {
            f.parent.pc++;
          }
          f.onFinish?.();
        },
      },
    ];
  }

  private returnTo(f: Frame) {
    if (!f.async) return;
    f.async.returned = true;
    const p = f.parent;
    if (p) {
      p.pc++;
      p.last = f.async.promise;
    }
    f.parent = undefined;
  }

  private exec(f: Frame): Beat[] {
    if (f.pc >= f.body.length) return this.finish(f);
    const op = f.body[f.pc];
    f.line = op.line;

    switch (op.op) {
      case 'log': {
        const src = op.src ?? (typeof op.text === 'string' ? `'${op.text}'` : '…');
        return this.api(
          f,
          `console.log(${src})`,
          (vid) => {
            op.pre?.(this);
            this.print(val(op.text, this), vid);
          },
          { cost: 0.08 },
        );
      }

      case 'stmt':
        return [
          {
            dur: op.dur ?? B.line,
            cost: op.cost ?? 0.04,
            act: () => {
              op.run?.(this);
              if (op.mark) this.marks[op.line] = val(op.mark, this);
              f.pc++;
            },
          },
        ];

      case 'dom':
        return [
          {
            dur: B.line,
            cost: 0.05,
            act: () => {
              op.run(this);
              this.dirty = true;
              if (op.mark) this.marks[op.line] = val(op.mark, this);
              f.pc++;
            },
          },
        ];

      case 'call': {
        const fn = op.fn;
        const child = this.frame(op.label ?? `${fn.name}(${op.args ?? ''})`, 'fn', fn.body, 'fn');
        child.parent = f;
        if (fn.async) child.async = { promise: this.promise(`${fn.name}()`), returned: false };
        return [{ dur: B.push, cost: 0.02, act: () => this.push(child) }];
      }

      case 'return':
        return [
          {
            dur: B.line,
            cost: 0.02,
            act: () => {
              if (op.mark) this.marks[op.line] = val(op.mark, this);
              f.pc = f.body.length;
            },
          },
        ];

      case 'timeout':
        return this.api(f, op.api ?? `${op.repeat ? 'setInterval' : 'setTimeout'}(…, ${op.ms})`, (vid) => this.addTimer(op.fn, op.ms, op.line, vid, !!op.repeat));

      case 'sleep':
        return this.api(f, op.api ?? `setTimeout(r, ${op.ms})`, (vid) => {
          const p = this.promise('timer');
          f.last = p;
          const fn: Fn = { name: 'r', card: 'timeout → resolve', body: [{ op: 'resolve', line: 0, p }] };
          this.addTimer(fn, op.ms, op.line, vid, false);
        });

      case 'then': {
        const src = op.on === 'last' && f.last ? f.last : this.resolved();
        return this.api(f, op.api ?? '.then(…)', (vid) => {
          const fn = op.fn;
          const result = this.promise('then');
          const jvid = this.vid();
          const label = fn.card ?? 'then callback';
          const job: Job = {
            vid: jvid,
            label,
            q: 'micro',
            icon: 'promise',
            line: op.line,
            says: firstSay(fn.body),
            make: () => {
              const fr = this.frame(label, 'micro', fn.body, 'promise', jvid);
              fr.onFinish = () => this.resolve(result);
              return fr;
            },
          };
          this.host.spawn(jvid, vid);
          this.whenDone(src, job, op.wait ?? 'waits for its promise');
          f.last = result;
        });
      }

      case 'micro':
        return this.api(f, op.api ?? 'queueMicrotask(…)', (vid) => {
          const fn = op.fn;
          const jvid = this.vid();
          const label = fn.card ?? `${fn.name}()`;
          this.host.spawn(jvid, vid);
          this.enqueue({ vid: jvid, label, q: 'micro', icon: 'promise', line: op.line, says: firstSay(fn.body), make: () => this.frame(label, 'micro', fn.body, 'promise', jvid) });
        });

      case 'await': {
        const p = op.on === 'last' && f.last ? f.last : this.resolved();
        return [
          { dur: B.line, cost: 0.02 },
          {
            dur: B.deq,
            cost: 0.02,
            act: () => {
              f.pc++;
              this.stack.pop();
              const job: Job = {
                vid: f.vid,
                label: `resume ${f.label.replace(/\(.*\)$/, '')}`,
                q: 'micro',
                icon: 'resume',
                line: op.line,
                says: firstSay(f.body.slice(f.pc)),
                make: () => {
                  f.kind = 'micro';
                  f.resumed = true;
                  return f;
                },
              };
              this.whenDone(p, job, op.wait ?? `waits for ${p.label}`);
              if (f.async && !f.async.returned) this.returnTo(f);
              else f.parent = undefined;
            },
          },
        ];
      }

      case 'fetch':
        return this.api(f, `fetch('${op.url}')`, (vid) => {
          const p = this.promise('fetch');
          f.last = p;
          const ivid = this.vid();
          const item: ApiItem = {
            vid: ivid,
            kind: 'net',
            label: `GET ${op.url}`,
            start: this.ms,
            due: this.ms + op.ms,
            readyAt: this.host.t() + 0.6,
            line: op.line,
            fire: () => {
              this.apis = this.apis.filter((a) => a !== item);
              this.enqueue({
                vid: ivid,
                label: 'fetch response',
                q: 'task',
                icon: 'net',
                line: op.line,
                make: () => this.frame('fetch response', 'task', [{ op: 'resolve', line: 0, p }], 'net', ivid),
              });
            },
          };
          this.apis.push(item);
          this.host.spawn(ivid, vid);
        });

      case 'work': {
        const dur = op.ms / WORK_RATE;
        return [
          {
            dur,
            cost: op.ms,
            act: () => {
              f.work = { from: this.ms, ms: op.ms };
            },
          },
          {
            dur: 0.05,
            act: () => {
              f.work = undefined;
              f.pc++;
            },
          },
        ];
      }

      case 'listen':
        return this.api(f, op.api ?? "addEventListener('click', …)", (vid) => {
          const ivid = this.vid();
          this.listenerFn = op.fn;
          this.apis.push({ vid: ivid, kind: 'listener', label: '#buy · click', start: this.ms, due: Infinity, readyAt: 0, line: op.line, fire: () => {} });
          this.host.spawn(ivid, vid);
        });

      case 'raf':
        return this.api(f, 'requestAnimationFrame(…)', (vid) => {
          const fn = op.fn;
          const jvid = this.vid();
          this.host.spawn(jvid, vid);
          this.enqueue({ vid: jvid, label: `rAF → ${fn.name}`, q: 'raf', icon: 'raf', line: op.line, make: () => this.frame(`${fn.name}()`, 'raf', fn.body, 'raf', jvid) });
        });

      case 'if':
        return [
          {
            dur: B.line * 0.8,
            cost: 0.02,
            act: () => {
              f.pc++;
              if (op.test(this)) f.body = [...f.body.slice(0, f.pc), ...op.body, ...f.body.slice(f.pc)];
            },
          },
        ];

      case 'resolve':
        return [
          {
            dur: B.act,
            cost: 0.04,
            act: () => {
              this.resolve(op.p);
              f.pc++;
            },
          },
        ];

      case 'immediate':
        return this.api(f, 'setImmediate(…)', (vid) => {
          const fn = op.fn;
          const jvid = this.vid();
          const label = fn.card ?? 'immediate';
          this.host.spawn(jvid, vid);
          this.enqueue({ vid: jvid, label, q: 'check', icon: 'immediate', line: op.line, says: firstSay(fn.body), make: () => this.frame(label, 'immediate', fn.body, 'immediate', jvid) });
        });

      case 'readFile':
        return this.api(f, 'fs.readFile(…)', (vid) => {
          const fn = op.fn;
          const ivid = this.vid();
          const label = fn.card ?? 'readFile callback';
          const item: ApiItem = {
            vid: ivid,
            kind: 'file',
            label: 'read app.js',
            start: this.ms,
            due: this.ms + op.ms,
            readyAt: this.host.t() + 0.8,
            line: op.line,
            fire: () => {
              this.apis = this.apis.filter((a) => a !== item);
              this.enqueue({ vid: ivid, label, q: 'poll', icon: 'file', line: op.line, make: () => this.frame(label, 'io', fn.body, 'file', ivid) });
            },
          };
          this.apis.push(item);
          this.host.spawn(ivid, vid);
        });
    }
  }

  private addTimer(fn: Fn, ms: number, line: number, from: string, repeat: boolean) {
    const vid = this.vid();
    const node = this.policy === 'node';
    const delay = node ? Math.max(1, ms) : ms;
    const q: QName = node ? 'timers' : 'task';
    const label = fn.card ?? (repeat ? 'interval callback' : 'timeout callback');
    const item: ApiItem = {
      vid,
      kind: repeat ? 'interval' : 'timer',
      label: `${repeat ? 'setInterval' : 'setTimeout'} · ${node && ms < 1 ? `${ms} → 1` : ms} ms`,
      start: this.ms,
      due: this.ms + delay,
      readyAt: this.host.t() + 0.62,
      line,
      fire: () => {
        if (repeat) {
          // An interval re-arms after its callback runs, so they never pile up.
          item.due = Infinity;
          const cvid = this.vid();
          this.host.spawn(cvid, vid);
          this.enqueue({
            vid: cvid,
            label,
            q,
            icon: 'timer',
            line,
            says: firstSay(fn.body),
            make: () => {
              const fr = this.frame(label, 'task', fn.body, 'timer', cvid);
              fr.onFinish = () => {
                item.start = this.ms;
                item.due = this.ms + delay;
                item.readyAt = this.host.t() + 0.4;
              };
              return fr;
            },
          });
        } else {
          this.apis = this.apis.filter((a) => a !== item);
          this.enqueue({ vid, label, q, icon: 'timer', line, says: firstSay(fn.body), make: () => this.frame(label, 'task', fn.body, 'timer', vid) });
        }
      },
    };
    this.apis.push(item);
    this.host.spawn(vid, from);
  }
}
