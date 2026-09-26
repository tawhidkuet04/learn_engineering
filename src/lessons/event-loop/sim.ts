import { SIG } from '@/lib/sim/colors';
import { clamp, damp } from '@/lib/sim/geometry';
import { PredictGame } from '@/lib/sim/predict';
import { Sim } from '@/lib/sim/Sim';
import { BROWSER_STATIONS, KIND_COLOR, Machine, NODE_PHASES, Q_COLOR, WORK_RATE, type Host, type Icon, type Op, type Program, type QName } from './engine';
import { buildProgram, PG_MAX_BLOCKS, PG_MAX_LINES, PG_START, BLOCK_INFO, type Block, type BlockKind, type BuiltProgram } from './programs';
import { MainThread, TOTAL_WORK, type ThreadMode } from './thread';

export type View = 'machine' | 'browser' | 'node';

/** Top-left based rectangle */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface StepCfg {
  view: View;
  /** Programs to run; more than one means rounds */
  programs?: Program[];
  /** Start the program again a few seconds after it finishes */
  loop?: boolean;
  predict?: 'order' | 'decide';
  mode?: ThreadMode;
  /** Browser view: run the demo (work + clicks) by itself once */
  auto?: boolean;
  /** Spotlight: box ids that stay bright */
  focus?: string[];
  playground?: boolean;
}

export interface CardView {
  vid: string;
  x: number;
  y: number;
  w: number;
  h: number;
  alpha: number;
  role: 'frame' | 'api' | 'job' | 'parked' | 'ghost';
  label: string;
  sub?: string;
  color: string;
  icon: Icon;
  top?: boolean;
  builtin?: boolean;
  head?: boolean;
  /** 0..1: busy-loop progress or timer/network progress */
  progress?: number;
  remain?: string;
  listener?: boolean;
  /** This card is a possible answer to the open question */
  pick?: string;
  q?: QName;
}

export interface BeltGeo {
  q: QName;
  label: string;
  rect: Rect;
}

export interface Geo {
  code: Rect;
  console: Rect;
  stack: Rect;
  apis: Rect;
  shelf: Rect | null;
  belts: BeltGeo[];
  ring: { cx: number; cy: number; r: number };
  screen: Rect | null;
  tray: Rect | null;
  compact: boolean;
  codeLines: number;
  /* browser view */
  page: Rect;
  timeline: Rect;
  src: Rect | null;
}

/** Code pane metrics (kept in sync with el.module.css). */
export const CODE_METRICS = {
  landscape: { head: 31, line: 20, pad: 14 },
  portrait: { head: 26, line: 16, pad: 10 },
};

const R0: Rect = { x: 0, y: 0, w: 0, h: 0 };

/** Where things sit inside the page mock (relative to the page), per orientation. */
export const PAGE_LAYOUT = {
  landscape: {
    h: 232,
    bar: 30,
    spinner: { x: 18, y: 46, s: 44 },
    title: { x: 76, y: 50 },
    proc: { x: 18, y: 110, w: 170, h: 34 },
    progress: { x: 204, y: 123, right: 62 },
    cart: { x: 18, y: 168, w: 132, h: 34 },
    count: { x: 164, y: 174 },
  },
  portrait: {
    h: 176,
    bar: 26,
    spinner: { x: 12, y: 36, s: 34 },
    title: { x: 56, y: 38 },
    proc: { x: 12, y: 84, w: 142, h: 30 },
    progress: { x: 166, y: 95, right: 48 },
    cart: { x: 12, y: 126, w: 118, h: 30 },
    count: { x: 142, y: 131 },
  },
};
const MACHINE_BOXES = ['code', 'console', 'stack', 'apis', 'ring'];
const BROWSER_BOXES = ['page', 'timeline', 'procBtn', 'cartBtn', 'src'];

export type ChallengeId = 'reverse' | 'cut' | 'split';

/** Visit every op in a program once, following callbacks (programs can be recursive). */
function walk(ops: Op[], visit: (op: Op) => void, seen = new Set<Op[]>()) {
  if (seen.has(ops)) return;
  seen.add(ops);
  for (const op of ops) {
    visit(op);
    if ('fn' in op) walk(op.fn.body, visit, seen);
    if (op.op === 'if') walk(op.body, visit, seen);
  }
}

/** Does anything in this program wait on a pending promise? Then we need the shelf. */
function usesShelf(p: Program) {
  let yes = false;
  walk(p.main, (op) => {
    if (op.op === 'fetch' || op.op === 'sleep' || (op.op === 'then' && op.on === 'last') || (op.op === 'await' && op.on === 'last')) yes = true;
  });
  return yes;
}

export class EventLoopSim extends Sim {
  view: View = 'machine';
  cfg: StepCfg = { view: 'machine' };
  m: Machine;
  th = new MainThread();
  game: PredictGame | null = null;
  programs: Program[] = [];
  round = 0;
  g: Geo = {
    code: R0,
    console: R0,
    stack: R0,
    apis: R0,
    shelf: null,
    belts: [],
    ring: { cx: 0, cy: 0, r: 0 },
    screen: null,
    tray: null,
    compact: false,
    codeLines: 0,
    page: R0,
    timeline: R0,
    src: null,
  };
  cards: CardView[] = [];
  /** Eased position of the loop pointer, in stations passed */
  ptr = 0;
  /** Single-step mode: 'one' may start one logical step, 'finish' completes it */
  stepMode: 'one' | 'finish' | null = null;
  doneAt: number | null = null;
  /** Sim time the call stack last became empty (the "empty" label fades in after it) */
  emptySince = 0;
  /** Browser view: the learner has pressed the page's buttons, so stop replaying the demo */
  private manual = false;
  /** Browser view: thread time (ms) at which the demo replays by itself */
  private autoAt: number | null = null;
  private lastJobEnd = 0;

  /* playground */
  pg: { blocks: Block[]; built: BuiltProgram; done: Set<ChallengeId>; runs: number } = {
    blocks: [],
    built: buildProgram([]),
    done: new Set(),
    runs: 0,
  };
  private pgSeq = 0;

  private asked = new Set<string>();
  private askN = 0;
  private sz = new Map<string, { w: number; h: number }>();
  private ghosts = new Map<string, CardView>();
  private dropIn = new Set<string>();
  private shelfOn = false;

  constructor() {
    super();
    const host: Host = {
      t: () => this.t,
      vt: () => this.vt,
      frozen: () => this.frozen,
      spawn: (vid, from) => this.spawnCard(vid, from),
      drop: (vid) => this.dropCard(vid),
      flight: (from, to, color) => this.send({ from, to, dur: 0.42, color, r: 3.6, lane: 0 }),
      ring: (vid, color) => this.fx({ kind: 'ring', at: { id: vid }, color, dur: 0.8 }),
      gate: (kind) => this.gate(kind),
      finished: () => this.finished(),
      mayStart: () => this.stepMode !== 'finish',
      started: () => {
        if (this.stepMode === 'one') this.stepMode = 'finish';
      },
    };
    this.m = new Machine(host);
    this.pgReset();
  }

  /* ---------------------------------------------------------------- */
  /* the machine's window into the stage                               */
  /* ---------------------------------------------------------------- */

  private spawnCard(vid: string, from: string | null) {
    const b = this.box(vid);
    const src = from ? this.boxes.get(from) : null;
    if (src && !Number.isNaN(src.x)) {
      b.x = src.x;
      b.y = src.y;
      b.alpha = 0.25;
      const s = this.sz.get(from!) ?? { w: src.w, h: src.h };
      this.sz.set(vid, { ...s });
    } else {
      this.dropIn.add(vid);
    }
  }

  private dropCard(vid: string) {
    const last = this.cards.find((c) => c.vid === vid);
    if (last) this.ghosts.set(vid, { ...last, role: 'ghost', top: false, pick: undefined });
    const b = this.boxes.get(vid);
    if (b) b.ty -= 12;
    this.hide(vid);
  }

  private gate(kind: 'start' | 'drain'): boolean {
    const g = this.game;
    const prog = this.m.prog;
    if (!g || g.done || !prog) return false;
    if (kind === 'start' && this.cfg.predict === 'order' && prog.ask) {
      const a = prog.ask;
      return g.ask({
        acceptable: [`c${a.answer}`],
        choices: a.choices.map((c, i) => ({ id: `c${i}`, label: c })),
        ask: 'What will the console print?',
        askAt: { id: 'console' },
        explain: () => a.explain,
      });
    }
    if (kind === 'drain' && this.cfg.predict === 'decide') {
      const mh = this.m.queues.micro[0];
      const th = this.m.queues.task[0];
      if (!mh || !th) return false;
      const key = `${mh.vid}|${th.vid}`;
      if (this.asked.has(key)) return false;
      this.asked.add(key);
      const ms = mh.says ?? mh.label;
      const ts = th.says ?? th.label;
      const flip = this.askN++ % 2 === 1;
      const choices = [
        { id: 'micro', label: `'${ms}'` },
        { id: 'task', label: `'${ts}'` },
      ];
      return g.ask({
        acceptable: ['micro'],
        choices: flip ? choices.reverse() : choices,
        ask: 'The stack is empty. What runs next?',
        askAt: { id: 'ring' },
        explain: (_p, ok) =>
          ok
            ? `After every task, the loop drains the microtask queue before it takes another task, so '${ms}' (a microtask) runs before '${ts}'.`
            : `'${ts}' has waited longer, but it's a task. The loop always empties the microtask queue first, so '${ms}' runs next.`,
      });
    }
    return false;
  }

  private finished() {
    this.doneAt = this.t;
    if (this.cfg.playground) this.pgCheck();
    this.rev++;
  }

  /* ---------------------------------------------------------------- */
  /* steps                                                             */
  /* ---------------------------------------------------------------- */

  enter(cfg: StepCfg, o: { predict?: number } = {}) {
    this.cfg = cfg;
    this.clearTransient();
    this.runScript([]);
    this.stepMode = null;
    this.doneAt = null;
    this.game = o.predict ? new PredictGame(this, o.predict) : null;
    this.asked.clear();
    this.askN = 0;
    this.setView(cfg.view);
    if (cfg.view === 'browser') {
      this.th.reset(cfg.mode ?? 'long');
      this.manual = false;
      this.autoAt = null;
      this.lastJobEnd = 0;
      if (cfg.auto) this.demo(0.5);
    } else {
      this.programs = cfg.playground ? [this.pg.built.program] : (cfg.programs ?? []);
      this.round = 0;
      this.wipeCards();
      if (this.programs[0]) this.load(this.programs[0]);
    }
    this.rev++;
  }

  private setView(v: View) {
    this.view = v;
    const want = v === 'browser' ? BROWSER_BOXES : MACHINE_BOXES;
    const all = [...MACHINE_BOXES, ...BROWSER_BOXES, 'shelf', 'screen', 'tray', 'q:task', 'q:micro', 'q:timers', 'q:poll', 'q:check'];
    for (const id of all) if (!want.includes(id)) this.hide(id);
    for (const id of want) this.box(id);
  }

  private wipeCards() {
    for (const id of [...this.boxes.keys()]) if (/^v\d+$/.test(id)) this.boxes.delete(id);
    this.ghosts.clear();
    this.sz.clear();
    this.dropIn.clear();
    this.cards = [];
  }

  /** Fade the current program's cards out and start `p`. */
  private load(p: Program) {
    for (const c of this.cards) {
      this.ghosts.set(c.vid, { ...c, role: 'ghost', top: false, pick: undefined });
      this.hide(c.vid);
    }
    this.m.load(p);
    this.doneAt = null;
    this.asked.clear();
    this.shelfOn = usesShelf(p);
    for (const id of ['shelf', 'screen', 'tray']) this.hide(id);
    const node = p.policy === 'node';
    for (const q of ['q:task', 'q:micro', 'q:timers', 'q:poll', 'q:check']) this.hide(q);
    const qs = node ? ['q:timers', 'q:poll', 'q:check', 'q:micro'] : ['q:task', 'q:micro'];
    for (const q of qs) this.box(q);
    if (this.shelfOn) this.box('shelf');
    if (p.screen) {
      this.box('screen');
      this.box('tray');
    }
    this.ptr = this.m.lap;
    this.rev++;
  }

  /** Replay the current program from the top. */
  restart() {
    const p = this.programs[this.round];
    if (!p || this.game?.pending) return;
    this.clearTransient();
    this.stepMode = null;
    this.load(p);
  }

  private nextRound() {
    if (!this.programs.length) return;
    this.round = (this.round + 1) % this.programs.length;
    this.load(this.programs[this.round]);
  }

  /** Advance one logical step while paused (the learner's "Step" button). */
  stepOnce() {
    if (this.view === 'browser') return;
    if (this.m.finishedFlag && !this.m.midStep) {
      this.restart();
    }
    this.stepMode = this.m.midStep ? 'finish' : 'one';
    this.rev++;
  }

  advance(realDt: number, playing: boolean, speed: number) {
    if (playing) this.stepMode = null;
    const stepping = !playing && this.stepMode !== null;
    super.advance(realDt, playing || stepping, speed);
    if (this.stepMode === 'finish' && !this.m.midStep) this.stepMode = null;
    if (this.stepMode === 'one' && this.m.finishedFlag) this.stepMode = null;
  }

  protected step(dt: number) {
    if (this.view === 'browser') {
      this.th.tick(dt * 1000);
      const th = this.th;
      // Replay the demo a few seconds after each run, until the learner takes over.
      if (th.job.t1 > 0 && th.job.t1 !== this.lastJobEnd) {
        this.lastJobEnd = th.job.t1;
        if (this.cfg.auto && !this.manual) this.autoAt = th.job.t1 + 2600;
      }
      if (this.autoAt != null && th.ms >= this.autoAt && !th.job.active) {
        this.autoAt = null;
        this.demo(0, false);
      }
      return;
    }
    this.m.tick(dt);
    if (this.doneAt != null && !this.frozen) {
      const hold = this.cfg.playground ? Infinity : this.programs.length > 1 ? 3.4 : 2.6;
      if (this.t - this.doneAt > hold) {
        this.doneAt = null;
        if (this.programs.length > 1) this.nextRound();
        else if (this.cfg.loop) this.load(this.programs[0]);
      }
    }
  }

  /* ---------------------------------------------------------------- */
  /* the learner's input                                               */
  /* ---------------------------------------------------------------- */

  /** Click #buy in the machine view. */
  clickBuy() {
    const ok = this.m.click();
    this.rev++;
    return ok;
  }

  /** Answer the open question by clicking a queue card. */
  pickCard(pick: string) {
    if (this.game?.pending) this.game.answer(pick);
  }

  /* browser view */

  setMode(mode: ThreadMode) {
    this.cfg = { ...this.cfg, mode };
    this.th.reset(mode);
    this.clearTransient();
    this.demo(0.35);
    this.rev++;
  }

  /**
   * Start the work, then click "Add to cart" three times while it runs.
   * `fresh` wipes the timeline first; a replay keeps the history.
   */
  demo(delay = 0.35, fresh = true) {
    if (fresh) {
      this.clearTransient();
      this.th.reset(this.th.mode);
      this.manual = false;
      this.lastJobEnd = 0;
    }
    this.autoAt = null;
    this.after(delay, () => this.pressProcess(true));
    for (const d of [0.45, 0.85, 1.25]) this.after(delay + d, () => this.pressCart(true));
    this.rev++;
  }

  pressProcess(ghost = false) {
    if (this.view !== 'browser') return;
    if (!ghost) {
      this.manual = true;
      this.autoAt = null;
    }
    if (this.th.startJob()) this.fx({ kind: 'ring', at: { id: 'procBtn' }, color: SIG.warn, dur: 0.7 });
    this.rev++;
  }

  pressCart(ghost = false) {
    if (this.view !== 'browser') return;
    if (!ghost) {
      this.manual = true;
      this.autoAt = null;
    }
    this.th.clickCart();
    this.fx({ kind: 'ring', at: { id: 'cartBtn' }, color: SIG.warn, dur: ghost ? 0.9 : 0.7, size: ghost ? 1.5 : 1 });
    this.rev++;
  }

  /* playground */

  pgReset() {
    this.pg.blocks = PG_START.map((kind) => ({ id: ++this.pgSeq, kind }));
    this.pgRebuild();
  }

  pgAdd(kind: BlockKind) {
    if (!this.pgCanAdd(kind)) return;
    this.pg.blocks = [...this.pg.blocks, { id: ++this.pgSeq, kind }];
    this.pgRebuild();
  }

  pgCanAdd(kind: BlockKind) {
    const lines = this.pg.blocks.reduce((n, b) => n + BLOCK_INFO[b.kind].lines, 0) + BLOCK_INFO[kind].lines;
    return this.pg.blocks.length < PG_MAX_BLOCKS && lines <= PG_MAX_LINES;
  }

  pgRemove(id: number) {
    this.pg.blocks = this.pg.blocks.filter((b) => b.id !== id);
    this.pgRebuild();
  }

  pgMove(id: number, dir: -1 | 1) {
    const i = this.pg.blocks.findIndex((b) => b.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= this.pg.blocks.length) return;
    const next = [...this.pg.blocks];
    [next[i], next[j]] = [next[j], next[i]];
    this.pg.blocks = next;
    this.pgRebuild();
  }

  pgClear() {
    this.pg.blocks = [];
    this.pgRebuild();
  }

  private pgRebuild() {
    this.pg.built = buildProgram(this.pg.blocks);
    if (this.cfg.playground && this.view === 'machine') {
      this.programs = [this.pg.built.program];
      this.round = 0;
      this.clearTransient();
      this.stepMode = null;
      this.load(this.pg.built.program);
    }
    this.rev++;
  }

  private pgCheck() {
    const { blocks, built } = this.pg;
    const outs = this.m.out.map((o) => o.text);
    const at = (l: string) => outs.indexOf(l);
    const all = built.letters.flat();
    this.pg.runs += 1;
    if (all.length >= 3 && outs.length === all.length && outs.join('') === [...all].reverse().join('')) this.pg.done.add('reverse');
    blocks.forEach((b, i) => {
      if (b.kind !== 'timeout' && b.kind !== 'timeout100') return;
      const tl = built.letters[i][0];
      blocks.forEach((c, j) => {
        if (j > i && (c.kind === 'then' || c.kind === 'micro')) {
          const ml = built.letters[j][0];
          if (at(ml) >= 0 && at(tl) >= 0 && at(ml) < at(tl)) this.pg.done.add('cut');
        }
      });
    });
    blocks.forEach((b, i) => {
      if (b.kind !== 'async') return;
      const [a1, a2] = built.letters[i];
      if (all.some((l) => l !== a1 && l !== a2 && at(a1) < at(l) && at(l) < at(a2))) this.pg.done.add('split');
    });
  }

  /* ---------------------------------------------------------------- */
  /* layout                                                            */
  /* ---------------------------------------------------------------- */

  protected layout() {
    if (this.view === 'browser') this.layoutBrowser();
    else this.layoutMachine();
  }

  private rectBox(id: string, r: Rect | null) {
    if (!r) return;
    if (this.isLive(id) || this.boxes.has(id)) this.place(id, r.x + r.w / 2, r.y + r.h / 2, r.w, r.h);
  }

  private layoutMachine() {
    const { w, h } = this;
    const m = this.m;
    const prog = m.prog;
    const node = m.policy === 'node';
    const g = this.g;
    const nLines = prog ? prog.code.split('\n').length : 6;
    const L = this.orient === 'landscape';
    g.compact = !L;

    if (L) {
      const pad = 16;
      const top = 70;
      const cm = CODE_METRICS.landscape;
      const codeW = clamp(Math.round(w * 0.4), 320, 440);
      const lines = Math.min(nLines, 16);
      g.codeLines = lines;
      g.code = { x: pad, y: top, w: codeW, h: cm.head + lines * cm.line + cm.pad };
      const conY = g.code.y + g.code.h + 14;
      g.console = { x: pad, y: conY, w: codeW, h: clamp(h - 86 - conY, 80, 196) };
      const midX = pad + codeW + 18;
      const stackW = clamp(Math.round(w * 0.18), 150, 200);
      const rightX = midX + stackW + 18;
      const rightW = w - pad - rightX;
      const beltH = 32;

      if (!node) {
        const ringR = 44;
        const ringY = Math.round(clamp(h * 0.63, 400, h - 200));
        g.ring = { cx: midX + stackW / 2, cy: ringY, r: ringR };
        g.stack = { x: midX, y: top, w: stackW, h: ringY - ringR - 44 - top };
        const taskY = ringY - 44;
        const microY = ringY + 44;
        g.belts = [
          { q: 'task', label: 'task queue', rect: { x: rightX, y: taskY - beltH / 2, w: rightW, h: beltH } },
          { q: 'micro', label: 'microtask queue', rect: { x: rightX, y: microY - beltH / 2, w: rightW, h: beltH } },
        ];
        const shelfH = 48;
        const shelfY = taskY - beltH / 2 - 26 - shelfH;
        g.shelf = this.shelfOn ? { x: rightX, y: shelfY, w: rightW, h: shelfH } : null;
        const apisBottom = this.shelfOn ? shelfY - 14 : taskY - beltH / 2 - 26;
        g.apis = { x: rightX, y: top, w: rightW, h: apisBottom - top };
        g.screen = prog?.screen ? { x: midX - 6, y: ringY + ringR + 30, w: 156, h: 92 } : null;
        g.tray = g.screen ? { x: g.screen.x + g.screen.w + 18, y: g.screen.y + 6, w: Math.min(230, w - pad - (g.screen.x + g.screen.w + 18)), h: 58 } : null;
      } else {
        const ringR = 56;
        const beltGap = 52;
        const y0 = Math.round(clamp(h * 0.42, 290, h - 330));
        g.belts = (['timers', 'poll', 'check', 'micro'] as QName[]).map((q, i) => ({
          q,
          label: q === 'timers' ? 'timers (expired)' : q === 'poll' ? 'poll: I/O callbacks' : q === 'check' ? 'check: setImmediate' : 'microtasks',
          rect: { x: rightX, y: y0 + i * beltGap, w: rightW, h: 28 },
        }));
        const ringY = y0 + (3 * beltGap) / 2 + 14;
        g.ring = { cx: midX + stackW / 2, cy: ringY, r: ringR };
        g.stack = { x: midX, y: top, w: stackW, h: ringY - ringR - 46 - top };
        g.shelf = null;
        g.apis = { x: rightX, y: top, w: rightW, h: y0 - 26 - top };
        g.screen = null;
        g.tray = null;
      }
    } else {
      const pad = 8;
      const cm = CODE_METRICS.portrait;
      const lines = Math.min(nLines, 10);
      g.codeLines = lines;
      g.code = { x: pad, y: pad, w: w - 2 * pad, h: cm.head + lines * cm.line + cm.pad };
      const conH = 76;
      const conY = h - 62 - conH;
      g.console = { x: pad, y: conY, w: w - 2 * pad, h: conH };
      const y0 = g.code.y + g.code.h + 12;
      const leftW = clamp(Math.round(w * 0.37), 118, 160);
      const rightX = pad + leftW + 10;
      const rightW = w - pad - rightX;
      const bottom = conY - 10;
      const beltH = 24;
      if (!node) {
        const ringR = 23;
        const ringY = bottom - ringR - 10;
        g.ring = { cx: pad + leftW / 2, cy: ringY, r: ringR };
        g.stack = { x: pad, y: y0, w: leftW, h: ringY - ringR - 26 - y0 };
        const microY = ringY + 14;
        const taskY = ringY - 30;
        g.belts = [
          { q: 'task', label: 'task queue', rect: { x: rightX, y: taskY - beltH / 2, w: rightW, h: beltH } },
          { q: 'micro', label: 'microtask queue', rect: { x: rightX, y: microY - beltH / 2, w: rightW, h: beltH } },
        ];
        const upper = taskY - beltH / 2 - 17;
        const extra = this.shelfOn || prog?.screen;
        const shelfH = 34;
        const shelfY = upper - shelfH - 4;
        g.shelf = this.shelfOn ? { x: rightX, y: shelfY, w: rightW, h: shelfH } : null;
        g.screen = prog?.screen ? { x: rightX, y: shelfY - 6, w: 104, h: shelfH + 10 } : null;
        g.tray = g.screen ? { x: rightX + 110, y: shelfY - 6, w: rightW - 110, h: shelfH + 10 } : null;
        g.apis = { x: rightX, y: y0, w: rightW, h: (extra ? shelfY - 12 : upper - 6) - y0 };
      } else {
        const ringR = 30;
        const beltGap = 34;
        const y4 = bottom - 4 * beltGap;
        g.belts = (['timers', 'poll', 'check', 'micro'] as QName[]).map((q, i) => ({
          q,
          label: q === 'timers' ? 'timers' : q === 'poll' ? 'poll (I/O)' : q === 'check' ? 'check' : 'microtasks',
          rect: { x: rightX, y: y4 + i * beltGap + 12, w: rightW, h: 20 },
        }));
        const ringY = bottom - ringR - 16;
        g.ring = { cx: pad + leftW / 2, cy: ringY, r: ringR };
        g.stack = { x: pad, y: y0, w: leftW, h: ringY - ringR - 26 - y0 };
        g.shelf = null;
        g.screen = null;
        g.tray = null;
        g.apis = { x: rightX, y: y0, w: rightW, h: y4 - 4 - y0 };
      }
    }

    this.rectBox('code', g.code);
    this.rectBox('console', g.console);
    this.rectBox('stack', g.stack);
    this.rectBox('apis', g.apis);
    this.rectBox('shelf', g.shelf);
    this.rectBox('screen', g.screen);
    this.rectBox('tray', g.tray);
    const rg = g.ring;
    this.rectBox('ring', { x: rg.cx - rg.r, y: rg.cy - rg.r, w: rg.r * 2, h: rg.r * 2 });
    for (const b of g.belts) this.rectBox(`q:${b.q}`, b.rect);
    this.placeCards();
  }

  /** Card sizes for this orientation. */
  get metrics() {
    const L = this.orient === 'landscape';
    return {
      frameH: L ? 26 : 21,
      cardW: L ? 128 : 106,
      cardH: L ? 26 : 20,
      itemH: L ? 34 : 26,
      gap: L ? 6 : 4,
    };
  }

  private placeCards() {
    const m = this.m;
    const g = this.g;
    const k = this.metrics;
    const put = (vid: string, cx: number, cy: number, w: number, h: number) => {
      this.place(vid, cx, cy, w, h);
      const b = this.boxes.get(vid);
      if (b && this.dropIn.has(vid)) {
        this.dropIn.delete(vid);
        if (Number.isNaN(b.x)) {
          b.x = cx;
          b.y = cy - 16;
          b.alpha = 0;
        }
      }
    };

    // Call stack: bottom-up.
    const s = g.stack;
    const n = m.stack.length;
    const room = s.h - 34;
    const step = n > 1 ? Math.min(k.frameH + 4, (room - k.frameH) / (n - 1)) : 0;
    m.stack.forEach((f, i) => {
      put(f.vid, s.x + s.w / 2, s.y + s.h - 8 - k.frameH / 2 - i * step, s.w - 14, k.frameH);
    });

    // Web APIs: a grid of items under the header.
    const a = g.apis;
    const cols = a.w > 300 ? 2 : 1;
    const iw = (a.w - 16 - (cols - 1) * 8) / cols;
    const head = this.orient === 'landscape' ? 30 : 22;
    const rows = Math.max(1, Math.floor((a.h - head - 4) / (k.itemH + 6)));
    m.apis.forEach((it, i) => {
      const r = Math.floor(i / cols);
      const c = i % cols;
      const rr = Math.min(r, rows - 1);
      put(it.vid, a.x + 8 + c * (iw + 8) + iw / 2, a.y + head + rr * (k.itemH + 6) + k.itemH / 2, iw, k.itemH);
    });

    // Parked on a pending promise.
    const sh = g.shelf;
    m.parked.forEach((p, i) => {
      if (!sh) return;
      const cw = Math.min(k.cardW + 30, (sh.w - 16 - (m.parked.length - 1) * 6) / Math.max(1, m.parked.length));
      put(p.job.vid, sh.x + 8 + cw / 2 + i * (cw + 6), sh.y + sh.h / 2 + (this.orient === 'landscape' ? 5 : 3), cw, k.cardH + (this.orient === 'landscape' ? 4 : 0));
    });

    // Queues: head on the left.
    for (const bg of g.belts) {
      const jobs = m.queues[bg.q];
      const r = bg.rect;
      // Shrink cards to fit before letting them overlap.
      const fitW = jobs.length > 1 ? (r.w - 16 - (jobs.length - 1) * k.gap) / jobs.length : k.cardW;
      const cw = Math.min(k.cardW, r.w - 16, Math.max(this.orient === 'landscape' ? 84 : 64, fitW));
      const ch = Math.min(k.cardH, r.h - 6);
      const cap = r.w - 16 - cw;
      const st = jobs.length > 1 ? Math.min(cw + k.gap, cap / (jobs.length - 1)) : 0;
      jobs.forEach((j, i) => put(j.vid, r.x + 8 + cw / 2 + i * st, r.y + r.h / 2, cw, ch));
    }
    // The script waits in the task queue before it runs (browser only).

    // Animation-frame callbacks wait in the tray by the screen.
    const tr = g.tray;
    m.queues.raf.forEach((j, i) => {
      if (!tr) return;
      const cw = Math.min(k.cardW, tr.w - 12);
      put(j.vid, tr.x + 6 + cw / 2, tr.y + tr.h - 6 - k.cardH / 2 - i * (k.cardH + 4), cw, k.cardH);
    });
  }

  private layoutBrowser() {
    const { w, h } = this;
    const g = this.g;
    const L = this.orient === 'landscape';
    const pl = L ? PAGE_LAYOUT.landscape : PAGE_LAYOUT.portrait;
    const worker = this.cfg.mode === 'worker';
    if (L) {
      const pad = 16;
      const top = 76;
      const pageW = clamp(Math.round(w * 0.46), 360, 520);
      g.page = { x: pad, y: top, w: pageW, h: pl.h };
      g.src = { x: pad + pageW + 18, y: top, w: w - pad - (pad + pageW + 18), h: pl.h };
      const ty = top + pl.h + 22;
      g.timeline = { x: pad, y: ty, w: w - 2 * pad, h: Math.min(worker ? 214 : 176, Math.max(140, h - 94 - ty)) };
    } else {
      const pad = 8;
      const top = 62;
      g.page = { x: pad, y: top, w: w - 2 * pad, h: pl.h };
      g.src = null;
      const ty = top + pl.h + 10;
      g.timeline = { x: pad, y: ty, w: w - 2 * pad, h: clamp(h - 142 - ty, worker ? 160 : 136, 240) };
    }
    this.rectBox('page', g.page);
    this.rectBox('timeline', g.timeline);
    if (g.src) this.rectBox('src', g.src);
    else this.hide('src');
    const p = g.page;
    // Anchors for click effects on the page's buttons.
    this.place('procBtn', p.x + pl.proc.x + pl.proc.w / 2, p.y + pl.proc.y + pl.proc.h / 2, pl.proc.w, pl.proc.h);
    this.place('cartBtn', p.x + pl.cart.x + pl.cart.w / 2, p.y + pl.cart.y + pl.cart.h / 2, pl.cart.w, pl.cart.h);
  }

  /* ---------------------------------------------------------------- */
  /* per-frame visuals                                                 */
  /* ---------------------------------------------------------------- */

  protected animate(dt: number) {
    // Positions depend on the machine's state, which changes every beat.
    this.layout();
    for (const b of this.boxes.values()) {
      if (Number.isNaN(b.x)) {
        b.x = b.tx;
        b.y = b.ty;
        b.alpha = 0;
      }
      const cur = this.sz.get(b.id);
      if (!cur) this.sz.set(b.id, { w: b.w, h: b.h });
      else {
        cur.w = damp(cur.w, b.w, 9, dt);
        cur.h = damp(cur.h, b.h, 9, dt);
      }
    }
    for (const id of [...this.sz.keys()]) if (!this.boxes.has(id)) this.sz.delete(id);
    for (const id of [...this.ghosts.keys()]) if (!this.boxes.has(id)) this.ghosts.delete(id);
    this.ptr = damp(this.ptr, this.m.lap, 7, dt);
    if (this.m.stack.length) this.emptySince = this.t;
    if (this.view !== 'browser') this.buildCards();
  }

  sizeOf(id: string) {
    const b = this.boxes.get(id);
    const s = this.sz.get(id);
    return s ?? (b ? { w: b.w, h: b.h } : { w: 0, h: 0 });
  }

  private buildCards() {
    const m = this.m;
    const out: CardView[] = [];
    const add = (vid: string, v: Omit<CardView, 'vid' | 'x' | 'y' | 'w' | 'h' | 'alpha'>) => {
      const b = this.boxes.get(vid);
      if (!b || Number.isNaN(b.x)) return;
      const s = this.sizeOf(vid);
      out.push({ vid, x: b.x, y: b.y, w: s.w, h: s.h, alpha: b.alpha, ...v });
    };
    for (const [vid, gv] of this.ghosts) {
      const b = this.boxes.get(vid);
      if (b) out.push({ ...gv, x: b.x, y: b.y, alpha: b.alpha });
    }
    for (const a of m.apis) {
      const span = a.due - a.start;
      const left = Math.max(0, a.due - m.ms);
      const icon: Icon = a.kind === 'net' ? 'net' : a.kind === 'listener' ? 'click' : a.kind === 'file' ? 'file' : 'timer';
      add(a.vid, {
        role: 'api',
        label: a.label,
        color: a.kind === 'listener' ? SIG.warn : a.kind === 'file' ? SIG.teal : SIG.req,
        icon,
        progress: Number.isFinite(a.due) && span > 0 ? clamp(1 - left / span, 0, 1) : Number.isFinite(a.due) ? 1 : undefined,
        remain: a.kind === 'listener' ? undefined : !Number.isFinite(a.due) ? 'callback queued' : left > 0 ? `${left >= 10 ? Math.ceil(left) : left.toFixed(1)} ms left` : a.kind === 'net' ? 'response in' : 'done',
        listener: a.kind === 'listener',
      });
    }
    for (const p of m.parked) add(p.job.vid, { role: 'parked', label: p.job.label, sub: p.job.sub, color: Q_COLOR.micro, icon: p.job.icon, q: 'micro' });
    const q = this.game?.pending;
    const picking = !!q && this.cfg.predict === 'decide';
    for (const qn of Object.keys(m.queues) as QName[]) {
      m.queues[qn].forEach((j, i) => {
        const pick = picking && i === 0 && (qn === 'micro' || qn === 'task') ? qn : undefined;
        add(j.vid, { role: 'job', label: j.label, color: j.icon === 'script' ? SIG.line : Q_COLOR[qn], icon: j.icon, head: i === 0, pick, q: qn });
      });
    }
    m.stack.forEach((f, i) => {
      const work = f.work ? clamp((m.ms - f.work.from) / f.work.ms, 0, 1) : undefined;
      add(f.vid, {
        role: 'frame',
        label: f.label,
        color: f.work ? SIG.heavy : KIND_COLOR[f.kind],
        icon: f.icon,
        top: i === m.stack.length - 1,
        builtin: f.kind === 'api',
        progress: work,
        remain: f.work ? `busy ${Math.round((work ?? 0) * f.work.ms)} / ${f.work.ms} ms` : undefined,
      });
    });
    this.cards = out;
  }

  /** Angle (degrees) of the loop pointer. */
  get pointerAngle() {
    return this.angleAt(this.ptr);
  }

  stationAngle(i: number) {
    if (this.m.policy === 'node') return -90 + i * 60;
    return [-35, 35, 160][i];
  }

  angleAt(pos: number) {
    const n = this.m.policy === 'node' ? NODE_PHASES.length : BROWSER_STATIONS.length;
    const i = Math.floor(pos);
    const f = pos - i;
    const a = this.stationAngle(((i % n) + n) % n);
    const b = this.stationAngle((((i + 1) % n) + n) % n);
    const span = (((b - a) % 360) + 360) % 360;
    return a + span * f;
  }

  /** Which queue the loop is serving right now, for highlights. */
  get serving(): QName | 'render' | null {
    const m = this.m;
    if (m.policy === 'node') {
      const ph = NODE_PHASES[m.station];
      if (m.loop === 'drain' || m.top?.kind === 'micro') return 'micro';
      return ph === 'timers' ? 'timers' : ph === 'poll' ? 'poll' : ph === 'check' ? 'check' : null;
    }
    if (m.station === 1) return 'micro';
    if (m.station === 2) return 'render';
    return 'task';
  }

  /** Time the busy loop still needs, for the HUD. */
  get workLeft() {
    const f = this.m.stack.find((x) => x.work);
    return f?.work ? Math.max(0, f.work.ms - (this.m.ms - f.work.from)) : 0;
  }

  get workRate() {
    return WORK_RATE;
  }

  get totalWork() {
    return TOTAL_WORK;
  }
}
