import { SIG } from '@/lib/sim/colors';
import { clamp, damp, type Curve, type Pt } from '@/lib/sim/geometry';
import { PredictGame } from '@/lib/sim/predict';
import { Sim } from '@/lib/sim/Sim';
import {
  DATA_HI,
  DATA_LO,
  DIVE_FRAME,
  HEAP_BASE,
  HEAP_HI,
  HEAP_LO,
  LIBS_HI,
  LIBS_LO,
  MAX_DEPTH,
  STACK_BASE,
  STACK_HI,
  STACK_LIMIT,
  STACK_LO,
  STACK_PRE_USED,
  TEXT_HI,
  TEXT_LO,
  bytes,
  group,
  jsId,
  tail,
} from './addr';
import {
  NONE,
  NULLP,
  fmtVal,
  int,
  str,
  val,
  type Block,
  type BlockSpec,
  type Field,
  type Frame,
  type Lang,
  type ObjSpec,
  type Op,
  type OutLine,
  type Program,
  type Raw,
  type Slot,
  type SlotSpec,
  type SlotType,
  type Val,
} from './model';

export type View = 'map' | 'run' | 'overflow';

export interface Cfg {
  view: View;
  program: Program | null;
  /** Run ops on a timer (false: wait for "Next line") */
  auto: boolean;
  /** Start over a few seconds after the program ends */
  loop: boolean;
  /** Seconds per line */
  beat: number;
  /** Show the return address and saved rbp as full rows */
  detail: 'compact' | 'full';
  /** Keep popped frames visible below the stack pointer */
  ghosts: boolean;
  /** Animate malloc's search through the free holes */
  scan: boolean;
  console: boolean;
  info: 'alloc' | 'overflow' | null;
  /** Garbage-collected languages: seconds before unreachable objects are collected */
  gcDelay: number;
  /** Map view: reveal the segments one by one */
  reveal: boolean;
  /** Overflow view */
  depth: number;
  noBase: boolean;
  /** Interactive malloc/free sandbox (ch. 4) */
  sandbox: boolean;
  playground: boolean;
  /** Phones: reserve a row under the caption for "your turn" prompts */
  lane: boolean;
}

export const DEFAULT_CFG: Cfg = {
  view: 'run',
  program: null,
  auto: true,
  loop: true,
  beat: 1.3,
  detail: 'compact',
  ghosts: false,
  scan: false,
  console: true,
  info: null,
  gcDelay: 1.3,
  reveal: false,
  depth: 1000,
  noBase: false,
  sandbox: false,
  playground: false,
  lane: false,
};

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Geo {
  portrait: boolean;
  code: Rect | null;
  codeLines: number;
  lineH: number;
  codeFont: number;
  cap: Rect | null;
  con: Rect | null;
  conLines: number;
  info: Rect | null;
  stack: Rect;
  heap: Rect;
  frameW: number;
  blockW: number;
  map: Rect | null;
  lane: Rect | null;
  gauge: Rect | null;
  cards: Rect | null;
  font: { head: number; row: number; addr: number };
}

/** Per-layout frame/block metrics (shrink when the column gets crowded). */
export interface Metrics {
  headH: number;
  rowH: number;
  bkH: number;
  gap: number;
  bHead: number;
  bRow: number;
  bGap: number;
}

export interface ArrowView {
  key: string;
  d: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  ang: number;
  color: string;
  bad: boolean;
  born: number;
}

export interface SegDef {
  id: 'stack' | 'libs' | 'heap' | 'data' | 'text';
  name: string;
  desc: string;
  lo: number;
  hi: number;
  weight: number;
  gapAfter: number;
}

export const SEGS: SegDef[] = [
  { id: 'stack', name: 'Stack', desc: 'locals, arguments, return addresses', lo: STACK_LO, hi: STACK_HI, weight: 1.3, gapAfter: 0.95 },
  { id: 'libs', name: 'Shared libraries', desc: 'libc.so and other mapped files', lo: LIBS_LO, hi: LIBS_HI, weight: 0.5, gapAfter: 0.95 },
  { id: 'heap', name: 'Heap', desc: 'malloc / new', lo: HEAP_LO, hi: HEAP_HI, weight: 1.1, gapAfter: 0.22 },
  { id: 'data', name: 'Data', desc: 'globals and statics', lo: DATA_LO, hi: DATA_HI, weight: 0.5, gapAfter: 0.1 },
  { id: 'text', name: 'Text', desc: 'machine code, read-only', lo: TEXT_LO, hi: TEXT_HI, weight: 0.62, gapAfter: 0 },
];
const REVEAL_ORDER: SegDef['id'][] = ['text', 'data', 'heap', 'libs', 'stack'];

export interface Pin {
  id: string;
  seg: SegDef['id'];
  label: string;
  addr: number;
  at: number;
  flash: number;
  freed?: boolean;
}

type Anchor = { x: number; y: number; l: number; r: number; top: number; col: 'stack' | 'heap' | 'con' | 'map' | 'pt' | 'code' };

const round16 = (n: number) => Math.ceil(n / 16) * 16;
const SIZE: Record<SlotType, number> = { int: 4, ptr: 8, own: 24, char: 1 };
const FLY = 0.5;

/* ================================================================== */

export class MemSim extends Sim {
  cfg: Cfg = { ...DEFAULT_CFG };
  view: View = 'run';
  game: PredictGame | null = null;
  geo: Geo = emptyGeo();
  fm: Metrics = { headH: 20, rowH: 17, bkH: 12, gap: 7, bHead: 21, bRow: 16, bGap: 7 };

  /* memory */
  frames: Frame[] = [];
  blocks: Block[] = [];
  heapTop = HEAP_BASE;
  heapTopY = 0;
  out: OutLine[] = [];
  cmd = '';
  caption = '';
  capVt = -10;
  capBad = false;

  /* program runner */
  prog: Program | null = null;
  lang: Lang = 'c';
  mode: 'c' | 'gc' | 'rust' = 'c';
  pc = 0;
  line: number | null = null;
  lineBad = false;
  auto = true;
  /** Stopped at a breakpoint, waiting for the learner */
  paused = false;
  ended = false;
  crashed = false;
  askAt: string | null = null;
  private wait = 0;
  private ffTo = -1;
  /** "Next line" pressed while the previous line's values were still in flight */
  private queued = false;
  /** Timers that must run before a sandbox action may start */
  private laters = 0;
  private seq = 1;
  private allocSeq = 1;
  private uidSeq = 1;
  private arrowSeen = new Map<string, { vt: number; tgt: string }>();
  private ez = new Map<string, { w: number; h: number }>();

  /* map */
  pins: Pin[] = [];
  revealT = 0;

  /* overflow */
  ov = { target: 1000, noBase: false, depth: 1, phase: 'dive' as 'dive' | 'hold' | 'unwind' | 'done' | 'crash', timer: 0, overflowed: false, runs: 0 };

  /* sandbox / playground */
  gen: string[] = [];
  sb = { n: 0, order: [] as string[], note: '', declared: new Set<string>() };
  pg = { n: 0, depth: 0, allocs: 0, errors: 0, exited: false, flags: { leak: false, uaf: false, alias: false, clean: false } };

  constructor() {
    super();
  }

  /* ================================================================ */
  /* Step entry                                                        */
  /* ================================================================ */

  enter(cfg: Cfg, opts: { predict?: number } = {}) {
    this.cfg = { ...cfg };
    this.view = cfg.view;
    this.clearTransient();
    this.laters = 0;
    this.game = opts.predict ? new PredictGame(this, opts.predict) : null;
    this.askAt = null;
    this.runScript([]);
    this.revealT = cfg.reveal ? 0 : 99;
    for (const s of SEGS) {
      if (this.view === 'map' || s.id === 'stack' || s.id === 'heap') this.box(`seg:${s.id}`);
      else this.hide(`seg:${s.id}`);
    }
    this.ov = { ...this.ov, target: cfg.depth, noBase: cfg.noBase, depth: 1, phase: 'dive', timer: 0, overflowed: false, runs: 0 };
    this.pg = { n: 0, depth: 0, allocs: 0, errors: 0, exited: false, flags: { leak: false, uaf: false, alias: false, clean: false } };
    this.loadProgram(cfg.program);
    this.relayout();
    this.rev++;
  }

  /** Swap the program (toggle cards) and start it from the top. */
  loadProgram(p: Program | null) {
    this.prog = p;
    this.cfg = { ...this.cfg, program: p };
    this.lang = p?.lang ?? 'c';
    this.mode = p?.mode ?? 'c';
    this.restart();
  }

  /** Clear memory and run the current program again from its first line. */
  restart() {
    this.clearTransient();
    this.laters = 0;
    if (this.game?.pending) this.game.skip();
    this.resetMemory();
    this.pc = 0;
    this.line = null;
    this.lineBad = false;
    this.auto = this.cfg.auto;
    this.paused = false;
    this.ended = false;
    this.crashed = false;
    this.ffTo = -1;
    this.queued = false;
    this.wait = 0.7;
    this.cmd = this.view === 'overflow' ? './dive' : (this.prog?.cmd ?? '');
    this.setCaption('');
    if (this.cfg.sandbox) this.sbInit();
    if (this.cfg.playground) this.pgInit();
    if (this.view === 'overflow') this.ovRestart();
    this.relayout();
    this.rev++;
  }

  private resetMemory() {
    for (const f of this.frames) this.hide(`fr:${f.id}`);
    for (const b of this.blocks) this.hide(`bk:${b.id}`);
    this.frames = [];
    this.blocks = [];
    this.heapTop = HEAP_BASE;
    this.out = [];
    this.pins = [];
    this.gen = [];
    this.arrowSeen.clear();
    this.allocSeq = 1;
  }

  /* ================================================================ */
  /* Program runner                                                    */
  /* ================================================================ */

  get beat() {
    return this.prog?.beat ?? this.cfg.beat;
  }

  /** "Next line" button: run exactly one op, then wait. */
  next() {
    if (this.frozen || !this.prog) return;
    this.auto = false;
    this.paused = false;
    if (this.flights.length) {
      this.queued = true;
      return;
    }
    if (this.pc >= this.prog.ops.length) {
      this.restart();
      this.auto = false;
      this.wait = 0;
      this.execNext(true);
      return;
    }
    this.execNext(true);
  }

  /** "Run" button: continue automatically. */
  play() {
    if (!this.prog) return;
    if (this.pc >= this.prog.ops.length) this.restart();
    this.auto = true;
    this.paused = false;
    this.wait = Math.min(this.wait, 0.35);
    this.rev++;
  }

  /** Fast-forward through the program until the op on `line` has run, then stop. */
  runTo(line: number) {
    const ops = this.prog?.ops;
    if (!ops) return;
    let idx = ops.findIndex((o, i) => i >= this.pc && o.line === line);
    if (idx < 0) {
      this.restart();
      idx = ops.findIndex((o) => o.line === line);
      if (idx < 0) return;
    }
    this.ffTo = idx;
    this.auto = true;
    this.paused = false;
    this.wait = Math.min(this.wait, 0.25);
    this.rev++;
  }

  private stepProgram(dt: number) {
    const ops = this.prog?.ops;
    if (!ops) return;
    if (this.pc >= ops.length) {
      if (!this.ended) {
        this.ended = true;
        this.rev++;
      }
      if (this.cfg.loop) {
        this.wait -= dt;
        if (this.wait <= 0) this.restart();
      }
      return;
    }
    // Let the current line's values land before the next line runs.
    if (this.flights.length) return;
    if (this.queued) {
      this.queued = false;
      this.execNext(true);
      return;
    }
    if (!this.auto) return;
    this.wait -= dt;
    if (this.wait > 0) return;
    this.execNext(false);
  }

  private execNext(manual: boolean) {
    const ops = this.prog?.ops;
    if (!ops || this.pc >= ops.length) return;
    const op = ops[this.pc];
    if (op.pause && !manual && this.ffTo < this.pc) {
      this.auto = false;
      this.paused = true;
      this.line = op.line;
      this.rev++;
      return;
    }
    const a = op.ask;
    if (a && this.game && !this.game.done) {
      this.line = op.line;
      this.askAt = a.at ?? null;
      this.game.ask({
        acceptable: [a.correct],
        choices: a.choices,
        ask: a.q,
        explain: (picked, ok) => a.explain(ok, picked),
        resolve: () => {
          this.askAt = null;
          this.execOp(op);
        },
      });
      return;
    }
    this.execOp(op);
  }

  private execOp(op: Op) {
    const ops = this.prog?.ops ?? [];
    const idx = this.pc;
    this.pc++;
    this.line = op.line;
    this.lineBad = false;
    if (op.note) this.setCaption(op.note);
    const ff = this.ffTo >= idx;
    this.wait = ff ? 0.6 : (op.dur ?? this.beat);
    op.run?.(this);
    if (this.ffTo === idx) {
      this.ffTo = -1;
      this.auto = false;
      this.wait = 0.4;
    }
    if (this.pc >= ops.length && !this.crashed) this.wait += 3.2;
    this.rev++;
  }

  setCaption(text: string, bad = false) {
    this.caption = text;
    this.capBad = bad;
    this.capVt = this.vt;
  }

  /* ================================================================ */
  /* Stack operations (called by programs)                             */
  /* ================================================================ */

  top(): Frame | undefined {
    let best: Frame | undefined;
    for (const f of this.frames) if (!f.ghost && (!best || f.base < best.base)) best = f;
    return best;
  }

  liveFrames(): Frame[] {
    return this.frames.filter((f) => !f.ghost).sort((a, b) => b.base - a.base);
  }

  private caller(): Frame | undefined {
    const live = this.liveFrames();
    return live[live.length - 2];
  }

  get sp() {
    const t = this.top();
    return t ? t.base - t.size : STACK_BASE;
  }

  /** Push a frame. `from` maps a parameter to the caller's slot its value comes from. */
  call(fn: string, specs: SlotSpec[], from: Record<string, string> = {}) {
    const caller = this.top();
    const base = caller ? caller.base - caller.size : STACK_BASE;
    const slots: Slot[] = [
      this.mkSlot('ret', 'ret', 'ptr', base - 8, 8, { t: 'code', v: caller ? `→ ${caller.fn}` : '→ libc' }),
      this.mkSlot('rbp', 'rbp', 'ptr', base - 16, 8, caller ? { t: 'code', v: tail(caller.base - 16) } : { t: 'code', v: '(libc)' }),
    ];
    let a = base - 16;
    for (const s of specs) {
      const size = SIZE[s.type];
      a = Math.floor((a - size) / Math.min(8, size)) * Math.min(8, size);
      const slot = this.mkSlot(s.name, s.param ? 'param' : 'local', s.type, a, size, NONE);
      slot.color = s.color;
      slots.push(slot);
    }
    const size = round16(base - a);
    const f: Frame = { id: `f${this.seq++}`, fn, base, size, slots, ghost: false };

    // Overwrite any popped frame that used the same addresses; its bytes are still there.
    const lo = base - size;
    for (const g of this.frames.filter((g) => g.ghost && g.base > lo && g.base - g.size < base)) {
      for (const s of slots) {
        if (s.kind !== 'local') continue;
        const old = g.slots.find((o) => o.addr === s.addr && o.size === s.size && o.kind !== 'ret' && o.kind !== 'rbp');
        if (old && old.v.t !== 'none' && old.v.t !== 'code') s.v = { ...old.v, stale: true } as Val;
      }
      this.frames = this.frames.filter((x) => x !== g);
      this.hide(`fr:${g.id}`);
    }
    this.frames.push(f);
    this.frames.sort((x, y) => y.base - x.base);
    this.box(`fr:${f.id}`);
    this.relayout();
    const b = this.boxes.get(`fr:${f.id}`);
    if (b) b.y = b.ty + 14;

    for (const s of specs) {
      if (s.init == null) continue;
      const slot = slots.find((x) => x.name === s.name);
      if (!slot) continue;
      const init = s.init;
      if (caller && s.param) {
        const src = from[s.name] ? `s:${caller.id}:${from[s.name]}` : `f:${caller.id}`;
        this.send({
          from: src,
          to: `s:${f.id}:${s.name}`,
          dur: FLY,
          color: SIG.req,
          label: this.fmt(init),
          onArrive: () => {
            slot.v = init;
            slot.flash = this.vt;
            this.refreshReach();
            this.rev++;
          },
        });
      } else {
        slot.v = init;
        slot.flash = this.vt;
      }
    }
    this.refreshReach();
    this.rev++;
    return f;
  }

  private mkSlot(name: string, kind: Slot['kind'], type: SlotType, addr: number, size: number, v: Val): Slot {
    return { uid: this.uidSeq++, name, kind, type, addr, size, v, flash: -10 };
  }

  /** Add a local to the current frame (playground: declare a new pointer). */
  addLocal(spec: SlotSpec, frame = this.top()) {
    if (!frame) return null;
    const size = SIZE[spec.type];
    const lowest = Math.min(...frame.slots.map((s) => s.addr));
    const a = Math.floor((lowest - size) / Math.min(8, size)) * Math.min(8, size);
    const slot = this.mkSlot(spec.name, 'local', spec.type, a, size, spec.init ?? NONE);
    slot.color = spec.color;
    frame.slots.push(slot);
    frame.size = round16(frame.base - a);
    this.relayout();
    return slot;
  }

  slot(name: string): { f: Frame; s: Slot } | null {
    const live = this.liveFrames();
    for (let i = live.length - 1; i >= 0; i--) {
      const s = live[i].slots.find((x) => x.name === name && x.kind !== 'ret' && x.kind !== 'rbp');
      if (s) return { f: live[i], s };
    }
    return null;
  }

  set(name: string, r: Raw) {
    const hit = this.slot(name);
    if (!hit) return;
    hit.s.v = val(r);
    hit.s.flash = this.vt;
    hit.s.bad = false;
    this.refreshReach();
    this.rev++;
  }

  /** Return from the current function; the value flies back into the caller's slot `into`. */
  ret(r?: Raw | null, into?: string, opts: { label?: string } = {}) {
    const f = this.top();
    if (!f) return;
    const caller = this.caller();
    const bx = this.boxes.get(`fr:${f.id}`);
    const from = bx ? `pt:${bx.x - bx.w / 2},${bx.y - bx.h / 2 + this.fm.headH / 2}` : `f:${f.id}`;
    const v = r == null ? null : val(r);
    const blk = v && v.t === 'ptr' ? this.blockAt(v.addr) : null;
    if (blk) blk.pending = true;
    if (this.cfg.ghosts) f.ghost = true;
    else {
      this.frames = this.frames.filter((x) => x !== f);
      this.hide(`fr:${f.id}`);
    }
    this.relayout();
    this.refreshReach();
    if (v && caller) {
      const to = into ? `s:${caller.id}:${into}` : `f:${caller.id}`;
      this.send({
        from: this.cfg.ghosts ? `f:${f.id}` : from,
        to,
        dur: FLY,
        color: SIG.res,
        label: opts.label ?? this.fmt(v),
        onArrive: () => {
          if (blk) blk.pending = false;
          if (into) {
            const s = caller.slots.find((x) => x.name === into);
            if (s) {
              s.v = v;
              s.flash = this.vt;
            }
          } else {
            this.fx({ kind: 'ring', at: { id: `fr:${caller.id}`, dx: -(this.boxes.get(`fr:${caller.id}`)?.w ?? 0) / 2 + 10, dy: -((this.boxes.get(`fr:${caller.id}`)?.h ?? 0) / 2) + 10 }, color: SIG.res, dur: 0.7, size: 0.6 });
          }
          this.refreshReach();
          this.rev++;
        },
      });
    } else if (blk) blk.pending = false;
    this.rev++;
  }

  /** p = &x */
  addrOf(dst: string, src: string) {
    const d = this.slot(dst);
    const s = this.slot(src);
    if (!d || !s) return;
    const v: Val = { t: 'ptr', addr: s.s.addr, prov: s.s.uid };
    this.send({
      from: `s:${s.f.id}:${src}`,
      to: `s:${d.f.id}:${dst}`,
      dur: FLY,
      color: SIG.req,
      label: `&${src}`,
      onArrive: () => {
        d.s.v = v;
        d.s.flash = this.vt;
        this.rev++;
      },
    });
  }

  /** dst = src (copies whatever src holds: a number, or an address). */
  assign(dst: string, src: string) {
    const d = this.slot(dst);
    const s = this.slot(src);
    if (!d || !s) return;
    const v = s.s.v;
    this.send({
      from: `s:${s.f.id}:${src}`,
      to: `s:${d.f.id}:${dst}`,
      dur: FLY,
      color: v.t === 'ptr' ? SIG.req : SIG.req,
      label: this.fmt(v),
      onArrive: () => {
        d.s.v = v;
        d.s.flash = this.vt;
        this.refreshReach();
        this.rev++;
      },
    });
  }

  /** Rust: let dst = src; ownership moves, src becomes unusable. */
  move(dst: string, src: string) {
    const d = this.slot(dst);
    const s = this.slot(src);
    if (!d || !s) return;
    const v = s.s.v;
    this.send({
      from: `s:${s.f.id}:${src}`,
      to: `s:${d.f.id}:${dst}`,
      dur: FLY,
      color: SIG.req,
      label: 'move',
      onArrive: () => {
        d.s.v = v;
        d.s.flash = this.vt;
        s.s.moved = true;
        s.s.flash = this.vt;
        this.refreshReach();
        this.rev++;
      },
    });
  }

  nul(name: string) {
    this.set(name, NULLP);
  }

  /* ================================================================ */
  /* Heap operations                                                   */
  /* ================================================================ */

  blockAt(addr: number): Block | undefined {
    if (!addr) return undefined;
    return this.blocks.find((b) => addr >= b.addr && addr < b.addr + b.size);
  }

  /** First fit: the lowest free hole that is big enough, else grow the heap. */
  private place16(req: number): { addr: number; size: number; grew: boolean; tried: Block[]; hole: Block | null } {
    const size = Math.max(16, round16(req));
    const holes = this.blocks.filter((b) => b.state === 'free').sort((a, b) => a.addr - b.addr);
    const tried: Block[] = [];
    for (const h of holes) {
      tried.push(h);
      if (h.size >= size) return { addr: h.addr, size, grew: false, tried, hole: h };
    }
    return { addr: this.heapTop, size, grew: true, tried, hole: null };
  }

  /** Model-only allocation. Returns the new block (not yet shown). */
  private alloc(req: number, spec: BlockSpec, js = false): Block {
    const p = this.place16(req);
    if (p.hole) {
      const h = p.hole;
      if (h.size > p.size) {
        h.addr += p.size;
        h.size -= p.size;
      } else {
        this.blocks = this.blocks.filter((b) => b !== h);
        this.hide(`bk:${h.id}`);
      }
    } else this.heapTop += p.size;
    const b: Block = {
      id: `b${this.seq++}`,
      alloc: this.allocSeq++,
      addr: p.addr,
      size: p.size,
      req,
      label: spec.label,
      kind: spec.kind,
      fields: spec.fields.map(([k, r]): Field => ({ k, v: val(r), flash: -10 })),
      state: 'live',
      shown: false,
      pending: true,
      flash: -10,
      since: this.vt,
      js,
    };
    this.blocks.push(b);
    this.blocks.sort((x, y) => x.addr - y.addr);
    this.box(`bk:${b.id}`);
    this.relayout();
    const bx = this.boxes.get(`bk:${b.id}`);
    if (bx) {
      bx.alpha = 0;
      bx.talpha = 0;
      bx.x = bx.tx + 18;
    }
    return b;
  }

  private showBlock(b: Block) {
    b.shown = true;
    b.flash = this.vt;
    const bx = this.boxes.get(`bk:${b.id}`);
    if (bx) bx.talpha = 1;
    this.rev++;
  }

  /** p = malloc(n): request flies to the heap, the address flies back into p. */
  malloc(into: string, req: number, spec: BlockSpec, opts: { label?: string; onDone?: (b: Block) => void } = {}) {
    const hit = this.slot(into);
    if (!hit) return null;
    const p = this.place16(req);
    const scanDelay = this.cfg.scan ? this.scan(p.tried, Math.max(16, round16(req)), p.grew) : 0;
    const b = this.alloc(req, spec, this.lang === 'js');
    const go = () => {
      this.send({
        from: `s:${hit.f.id}:${into}`,
        to: `b:${b.id}`,
        dur: 0.45,
        color: SIG.heavy,
        label: opts.label ?? (this.lang === 'js' ? 'new' : `malloc(${req})`),
        onArrive: () => {
          this.showBlock(b);
          this.send({
            from: `b:${b.id}`,
            to: `s:${hit.f.id}:${into}`,
            dur: 0.45,
            color: SIG.res,
            label: this.lang === 'js' ? jsId(b.alloc) : tail(b.addr),
            onArrive: () => {
              hit.s.v = { t: 'ptr', addr: b.addr, prov: b.alloc };
              hit.s.flash = this.vt;
              hit.s.moved = false;
              b.pending = false;
              this.refreshReach();
              opts.onDone?.(b);
              this.rev++;
            },
          });
        },
      });
    };
    if (scanDelay > 0) this.later(scanDelay, go);
    else go();
    return b;
  }

  /** Show malloc's first-fit search: check each hole, then use it or grow the heap. */
  private scan(tried: Block[], need: number, grew: boolean): number {
    let t = 0;
    for (const h of tried) {
      const ok = h.size >= need;
      this.after(t, () => {
        this.fx({ kind: 'ring', at: { id: `bk:${h.id}` }, color: ok ? SIG.res : SIG.warn, dur: 0.55, size: 0.9 });
        this.fx({ kind: 'text', at: { id: `bk:${h.id}`, dy: -2 }, text: ok ? `${h.size} B hole: fits ✓` : `${h.size} B < ${need} B ✗`, color: ok ? SIG.res : SIG.warn, dur: 1.1 });
      });
      t += 0.55;
    }
    if (grew) {
      this.after(t, () => {
        const g = this.geo;
        this.fx({ kind: 'text', at: { x: g.heap.x + g.blockW / 2, y: Math.max(g.heap.y + 30, this.heapTopY - 6) }, text: g.portrait ? 'grow the heap' : 'no hole fits: grow the heap', color: SIG.heavy, dur: 1.3 });
      });
      t += 0.5;
    }
    return t;
  }

  /** JavaScript: const x = { … } (nested objects are allocated first). */
  newObj(into: string, spec: ObjSpec) {
    const hit = this.slot(into);
    if (!hit) return;
    const made: Block[] = [];
    const build = (o: ObjSpec): Block => {
      const fieldsOut: [string, Raw][] = o.fields.map(([k, v]) => {
        if (v && typeof v === 'object' && 'fields' in v) {
          const child = build(v);
          return [k, { t: 'ptr', addr: child.addr, prov: child.alloc }];
        }
        return [k, v as Raw];
      });
      const b = this.alloc(16 + fieldsOut.length * 8, { label: o.label, kind: 'fields', fields: fieldsOut }, true);
      made.push(b);
      return b;
    };
    const root = build(spec);
    this.send({
      from: `s:${hit.f.id}:${into}`,
      to: `b:${root.id}`,
      dur: 0.45,
      color: SIG.heavy,
      label: 'new',
      onArrive: () => {
        made.forEach((b, i) => this.after(i * 0.12, () => this.showBlock(b)));
        this.after(made.length * 0.12, () =>
          this.send({
            from: `b:${root.id}`,
            to: `s:${hit.f.id}:${into}`,
            dur: 0.45,
            color: SIG.res,
            label: jsId(root.alloc),
            onArrive: () => {
              hit.s.v = { t: 'ptr', addr: root.addr, prov: root.alloc };
              hit.s.flash = this.vt;
              for (const b of made) b.pending = false;
              this.refreshReach();
              this.rev++;
            },
          }),
        );
      },
    });
  }

  /** JavaScript: const copy = { ...src } or structuredClone(src). */
  copyObj(into: string, src: string, deep: boolean) {
    const d = this.slot(into);
    const s = this.slot(src);
    if (!d || !s || s.s.v.t !== 'ptr') return;
    const srcBlock = this.blockAt(s.s.v.addr);
    if (!srcBlock) return;
    const made: Block[] = [];
    const dup = (b: Block): Block => {
      const fieldsOut: [string, Raw][] = b.fields.map((f) => {
        if (deep && f.v.t === 'ptr' && f.v.addr) {
          const child = this.blockAt(f.v.addr);
          if (child) {
            const c = dup(child);
            return [f.k, { t: 'ptr', addr: c.addr, prov: c.alloc }];
          }
        }
        return [f.k, f.v];
      });
      const nb = this.alloc(b.req, { label: b.label, kind: b.kind, fields: fieldsOut }, true);
      made.push(nb);
      return nb;
    };
    const root = dup(srcBlock);
    this.send({
      from: `b:${srcBlock.id}`,
      to: `b:${root.id}`,
      dur: 0.5,
      color: SIG.heavy,
      label: deep ? 'deep copy' : 'copy fields',
      onArrive: () => {
        made.forEach((b, i) => this.after(i * 0.12, () => this.showBlock(b)));
        this.after(made.length * 0.12, () =>
          this.send({
            from: `b:${root.id}`,
            to: `s:${d.f.id}:${into}`,
            dur: 0.45,
            color: SIG.res,
            label: jsId(root.alloc),
            onArrive: () => {
              d.s.v = { t: 'ptr', addr: root.addr, prov: root.alloc };
              d.s.flash = this.vt;
              for (const b of made) b.pending = false;
              this.refreshReach();
              this.rev++;
            },
          }),
        );
      },
    });
  }

  /** Follow a path of pointers: path[0] is a slot, the rest are pointer fields. */
  private walk(path: string[]): { hops: { from: string; to: string; bad: boolean }[]; block: Block | null; slotT: { f: Frame; s: Slot } | null; bad: boolean } | null {
    const start = this.slot(path[0]);
    if (!start) return null;
    const hops: { from: string; to: string; bad: boolean }[] = [];
    let v = start.s.v;
    let from = `s:${start.f.id}:${path[0]}`;
    let block: Block | null = null;
    let bad = false;
    for (let i = 0; i <= path.length - 1; i++) {
      if (v.t !== 'ptr' || !v.addr) return { hops, block: null, slotT: null, bad: true };
      const tgt = this.resolvePtr(v);
      if (!tgt) return { hops, block: null, slotT: null, bad: true };
      if (tgt.kind === 'slot') {
        hops.push({ from, to: `s:${tgt.f.id}:${tgt.s.name}`, bad: !tgt.ok });
        return { hops, block: null, slotT: { f: tgt.f, s: tgt.s }, bad: bad || !tgt.ok };
      }
      block = tgt.b;
      bad = bad || !tgt.ok;
      hops.push({ from, to: `b:${block.id}`, bad: !tgt.ok });
      if (i < path.length - 1) {
        const fld = block.fields.find((f) => f.k === path[i + 1]);
        if (!fld) break;
        from = `bf:${block.id}:${fld.k}`;
        v = fld.v;
      }
    }
    return { hops, block, slotT: null, bad };
  }

  private fly(hops: { from: string; to: string; bad: boolean }[], color: string, label: string | undefined, done: () => void) {
    if (!hops.length) {
      done();
      return;
    }
    const [h, ...rest] = hops;
    this.send({ from: h.from, to: h.to, dur: 0.42, color: h.bad ? SIG.err : color, label, onArrive: () => this.fly(rest, color, label, done) });
  }

  /** *p = v, p->field = v, copy.stats.score = v … */
  write(path: string[], key: string | number | null, r: Raw, opts: { label?: string } = {}) {
    const w = this.walk(path);
    if (!w) return;
    const v = val(r);
    this.fly(w.hops, SIG.req, opts.label ?? this.fmt(v), () => {
      if (w.slotT) {
        w.slotT.s.v = v;
        w.slotT.s.flash = this.vt;
        w.slotT.s.bad = w.bad;
      } else if (w.block) {
        const fld = key == null ? w.block.fields[0] : w.block.fields.find((f) => f.k === String(key));
        if (fld) {
          fld.v = v;
          fld.flash = this.vt;
          fld.bad = w.bad;
        }
        w.block.flash = this.vt;
      }
      this.refreshReach();
      this.rev++;
    });
  }

  /** Read through a pointer and print what comes back. `shown` overrides the printed text. */
  read(path: string[], key: string | number | null, opts: { shown?: string; tone?: OutLine['tone'] } = {}) {
    const w = this.walk(path);
    if (!w) return;
    this.fly(w.hops, SIG.req, undefined, () => {
      let v: Val = NONE;
      let src = '';
      if (w.slotT) {
        v = w.slotT.s.v;
        src = `s:${w.slotT.f.id}:${w.slotT.s.name}`;
        w.slotT.s.flash = this.vt;
      } else if (w.block) {
        const fld = key == null ? w.block.fields[0] : w.block.fields.find((f) => f.k === String(key));
        if (fld) {
          v = fld.v;
          fld.flash = this.vt;
          src = `bf:${w.block.id}:${fld.k}`;
        } else src = `b:${w.block.id}`;
      }
      const shown = opts.shown ?? (v.t === 'str' ? v.v : v.t === 'int' ? String(v.v) : this.fmt(v));
      if (!src) {
        this.print(shown, opts.tone ?? (w.bad ? 'err' : undefined));
        return;
      }
      this.send({
        from: src,
        to: 'con',
        dur: 0.5,
        color: w.bad ? SIG.err : SIG.res,
        label: shown.length > 10 ? undefined : shown,
        onArrive: () => this.print(shown, opts.tone ?? (w.bad ? 'err' : undefined)),
      });
    });
  }

  /** dst = path->key: follow the pointers, then carry the field's value back into a slot. */
  load(dst: string, path: string[], key: string) {
    const d = this.slot(dst);
    const w = this.walk(path);
    if (!d || !w || !w.block) return;
    const blk = w.block;
    this.fly(w.hops, SIG.req, undefined, () => {
      const fld = blk.fields.find((f) => f.k === key);
      const v = fld?.v ?? NONE;
      if (fld) fld.flash = this.vt;
      this.send({
        from: `bf:${blk.id}:${key}`,
        to: `s:${d.f.id}:${dst}`,
        dur: 0.45,
        color: SIG.res,
        label: this.fmt(v),
        onArrive: () => {
          d.s.v = v;
          d.s.flash = this.vt;
          this.refreshReach();
          this.rev++;
        },
      });
    });
  }

  /** printf / console.log of a variable: its value flies to the terminal. */
  echo(name: string, shown?: string) {
    const hit = this.slot(name);
    if (!hit) return;
    const v = hit.s.v;
    const text = shown ?? (v.t === 'str' ? v.v : this.fmt(v));
    hit.s.flash = this.vt;
    this.send({ from: `s:${hit.f.id}:${name}`, to: 'con', dur: 0.55, color: SIG.res, label: text.length > 10 ? undefined : text, onArrive: () => this.print(text) });
  }

  /** free(p). Freeing twice aborts, like glibc does. */
  free(name: string, opts: { onDone?: () => void; quiet?: boolean } = {}) {
    const hit = this.slot(name);
    if (!hit || hit.s.v.t !== 'ptr' || !hit.s.v.addr) return;
    const b = this.blockAt(hit.s.v.addr);
    if (!b) return;
    this.send({
      from: `s:${hit.f.id}:${name}`,
      to: `b:${b.id}`,
      dur: 0.45,
      color: SIG.hc,
      label: this.mode === 'rust' ? 'drop' : 'free',
      onArrive: () => {
        if (b.state === 'free') {
          this.crash(['free(): double free detected in tcache 2', 'Aborted (core dumped)'], `b:${b.id}`);
          opts.onDone?.();
          return;
        }
        this.freeBlock(b);
        opts.onDone?.();
      },
    });
  }

  /** Mark a block free and merge it with free neighbours. */
  private freeBlock(b: Block, meta = 'allocator bookkeeping') {
    b.state = 'free';
    b.since = this.vt;
    b.flash = this.vt;
    b.meta = meta;
    b.pending = false;
    this.fx({ kind: 'ring', at: { id: `bk:${b.id}` }, color: SIG.hc, dur: 0.7 });
    this.coalesce();
    this.refreshReach();
    this.relayout();
    this.rev++;
  }

  private coalesce() {
    this.blocks.sort((a, b) => a.addr - b.addr);
    for (let i = 0; i < this.blocks.length - 1; ) {
      const a = this.blocks[i];
      const b = this.blocks[i + 1];
      if (a.state === 'free' && b.state === 'free' && a.addr + a.size === b.addr) {
        a.size += b.size;
        a.since = this.vt;
        this.blocks.splice(i + 1, 1);
        this.hide(`bk:${b.id}`);
      } else i++;
    }
  }

  /** Rust: the owner goes out of scope, so its heap data is freed exactly once. */
  dropOwner(name: string) {
    const hit = this.slot(name);
    if (!hit || hit.s.v.t !== 'ptr' || !hit.s.v.addr) return;
    const b = this.blockAt(hit.s.v.addr);
    if (!b) return;
    this.send({
      from: `s:${hit.f.id}:${name}`,
      to: `b:${b.id}`,
      dur: 0.45,
      color: SIG.hc,
      label: 'drop',
      onArrive: () => this.freeBlock(b, 'freed by drop'),
    });
  }

  /** A garbage collector pass: everything unreachable is reclaimed. */
  gcSweep() {
    const g = this.blocks.filter((b) => b.state === 'garbage');
    g.forEach((b, i) => this.after(i * 0.18, () => this.collect(b)));
    if (!g.length) this.setCaption('The collector found nothing to free.');
  }

  private collect(b: Block) {
    if (!this.blocks.includes(b)) return;
    this.fx({ kind: 'ring', at: { id: `bk:${b.id}` }, color: SIG.hc, dur: 0.8, size: 1.2 });
    this.fx({ kind: 'text', at: { id: `bk:${b.id}`, dy: -4 }, text: 'collected', color: SIG.hc, dur: 1 });
    this.blocks = this.blocks.filter((x) => x !== b);
    this.hide(`bk:${b.id}`);
    this.relayout();
    this.rev++;
  }

  /** Which blocks can the program still reach? The rest are leaks (C) or garbage (GC). */
  refreshReach() {
    const reached = new Set<number>();
    const visit = (v: Val) => {
      if (v.t !== 'ptr' || !v.addr) return;
      const b = this.blockAt(v.addr);
      if (!b || b.state === 'free' || b.alloc !== v.prov || reached.has(b.alloc)) return;
      reached.add(b.alloc);
      for (const f of b.fields) visit(f.v);
    };
    for (const f of this.frames) if (!f.ghost) for (const s of f.slots) if (!s.moved) visit(s.v);
    for (const b of this.blocks)
      if (b.pending && b.state !== 'free') {
        reached.add(b.alloc);
        for (const f of b.fields) visit(f.v);
      }
    for (const b of this.blocks) {
      if (b.state === 'free' || !b.shown) continue;
      const r = reached.has(b.alloc);
      if (!r && b.state === 'live') {
        b.state = this.mode === 'gc' ? 'garbage' : 'leaked';
        b.since = this.vt;
        if (b.state === 'leaked') {
          this.fx({ kind: 'ring', at: { id: `bk:${b.id}` }, color: SIG.err, dur: 0.9, size: 1.1 });
          this.fx({ kind: 'text', at: { id: `bk:${b.id}`, dy: -6 }, text: 'no pointer left: leaked', color: SIG.err, dur: 1.5 });
          if (this.cfg.playground) this.pg.flags.leak = true;
        }
      } else if (r && (b.state === 'leaked' || b.state === 'garbage')) b.state = 'live';
    }
    if (this.cfg.playground) this.pgCheck();
  }

  private stepGC() {
    if (this.mode !== 'gc' || this.prog?.manualGc) return;
    for (const b of this.blocks) if (b.state === 'garbage' && this.vt - b.since > this.cfg.gcDelay) this.collect(b);
  }

  /* ================================================================ */
  /* Output                                                            */
  /* ================================================================ */

  print(text: string, tone?: OutLine['tone']) {
    this.out.push({ text, tone, vt: this.vt });
    if (this.out.length > 40) this.out.shift();
    this.rev++;
  }

  /** The process dies: print the error, highlight the line, stop the program. */
  crash(lines: string[], at?: string) {
    lines.forEach((l) => this.print(l, 'err'));
    this.crashed = true;
    this.lineBad = true;
    const ops = this.prog?.ops;
    if (ops) this.pc = ops.length;
    this.ended = false;
    this.wait = 4.2;
    this.setCaption(lines[0], true);
    if (at) {
      this.fx({ kind: 'x', at: { id: at.replace(/^b:/, 'bk:') }, color: SIG.err, dur: 1.2, size: 2 });
      this.fx({ kind: 'ring', at: { id: at.replace(/^b:/, 'bk:') }, color: SIG.err, dur: 1, size: 1.6 });
    }
    this.rev++;
  }

  /** Map view: a labelled marker for a variable at an address. */
  pin(id: string, seg: SegDef['id'], label: string, addr: number) {
    const p = this.pins.find((x) => x.id === id);
    if (p) {
      p.flash = this.vt;
      return;
    }
    this.pins.push({ id, seg, label, addr, at: this.vt, flash: this.vt });
    this.rev++;
  }

  pinFree(id: string) {
    const p = this.pins.find((x) => x.id === id);
    if (p) {
      p.freed = true;
      p.flash = this.vt;
    }
    this.rev++;
  }

  /** Map view: print an address and fly it to its pin. */
  printAddr(pinId: string, text: string) {
    this.print(text);
    this.send({
      from: 'con',
      to: `pin:${pinId}`,
      dur: 0.8,
      color: SIG.warn,
      onArrive: () => {
        const p = this.pins.find((x) => x.id === pinId);
        if (p) p.flash = this.vt;
        this.rev++;
      },
    });
  }

  fmt(v: Val): string {
    return fmtVal(v, this.lang, jsId, tail);
  }

  /* ================================================================ */
  /* Overflow                                                          */
  /* ================================================================ */

  setDepth(target: number) {
    this.ov.target = target;
    this.ovRestart();
  }

  setNoBase(on: boolean) {
    this.ov.noBase = on;
    this.ovRestart();
  }

  get maxDepth() {
    return MAX_DEPTH;
  }

  private ovRestart() {
    this.ov.depth = 1;
    this.ov.phase = 'dive';
    this.ov.timer = 0;
    this.out = [];
    this.crashed = false;
    this.lineBad = false;
    this.line = 6;
    this.setCaption(this.ov.noBase ? 'No base case: dive() never stops calling itself' : `Recursing toward depth ${group(this.ov.target)}…`);
    this.rev++;
  }

  private stepOverflow(dt: number) {
    const o = this.ov;
    const goal = o.noBase ? Infinity : o.target;
    if (o.phase === 'dive') {
      const rate = Math.max(1.6, Math.log(Math.min(goal, MAX_DEPTH * 1.05)) / 2.6);
      o.depth = o.depth * Math.exp(rate * dt) + dt * 4;
      this.line = 6;
      if (o.depth > MAX_DEPTH) {
        o.depth = MAX_DEPTH + 1;
        o.phase = 'crash';
        o.timer = 0;
        o.overflowed = true;
        o.runs++;
        this.crashed = true;
        this.lineBad = true;
        this.print('Segmentation fault (core dumped)', 'err');
        this.setCaption(`Frame ${group(MAX_DEPTH + 1)} doesn't fit: it hits the guard page → SIGSEGV`, true);
        this.fx({ kind: 'ring', at: { x: this.geo.gauge ? this.geo.gauge.x + this.geo.gauge.w / 2 : 0, y: this.geo.gauge ? this.geo.gauge.y + this.geo.gauge.h + 8 : 0 }, color: SIG.err, dur: 1.2, size: 2 });
      } else if (o.depth >= goal) {
        o.depth = goal;
        o.phase = 'hold';
        o.timer = 0;
        this.line = 5;
        this.setCaption(`Base case at depth ${group(goal)}: ${bytes(goal * DIVE_FRAME)} of frames on the stack.`);
      }
      this.rev++;
    } else if (o.phase === 'hold') {
      o.timer += dt;
      if (o.timer > 1.2) {
        o.phase = 'unwind';
        o.runs++;
        this.setCaption('Unwinding: every return pops one frame and SP climbs back up.');
      }
    } else if (o.phase === 'unwind') {
      const rate = Math.max(2, Math.log(Math.max(2, o.target)) / 1.3);
      o.depth = Math.max(1, o.depth * Math.exp(-rate * dt) - dt * 4);
      this.line = 5;
      if (o.depth <= 1.01) {
        o.depth = 1;
        o.phase = 'done';
        o.timer = 0;
        this.line = 11;
        this.setCaption('All frames popped. The program exits normally.');
      }
      this.rev++;
    } else {
      o.timer += dt;
      if (o.timer > (o.phase === 'crash' ? 4.5 : 2.2)) this.ovRestart();
    }
  }

  get ovUsed() {
    return STACK_PRE_USED + Math.floor(this.ov.depth) * DIVE_FRAME;
  }

  get ovFrac() {
    return clamp(this.ovUsed / STACK_LIMIT, 0, 1);
  }

  /* ================================================================ */
  /* Sandbox: malloc / free by hand (ch. 4)                            */
  /* ================================================================ */

  private sbInit() {
    this.sb = { n: 0, order: [], note: '', declared: new Set<string>() };
    this.gen = ['int main(void) {'];
    this.call('main', ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'].map((n) => ({ name: n, type: 'ptr' as const })));
    this.line = 1;
    this.setCaption('A few allocations to start with…');
    // A short demo so the heap isn't empty, then it's the learner's turn.
    this.later(0.8, () => this.sbDoMalloc(32));
    this.later(2.6, () => this.sbDoMalloc(64));
    this.later(4.4, () => this.sbDoMalloc(32));
    this.later(6.2, () => this.sbDoFree());
    this.later(8.2, () => {
      this.setCaption('Your turn: malloc and free with the buttons in the panel.');
      this.rev++;
    });
  }

  sbMalloc(req: number) {
    this.flush();
    this.sbDoMalloc(req);
  }

  sbFreeOldest() {
    this.flush();
    this.sbDoFree();
  }

  private sbDoMalloc(req: number) {
    const main = this.liveFrames()[0];
    const s = main?.slots.find((x) => x.kind === 'local' && (x.v.t === 'none' || (x.v.t === 'ptr' && !x.v.addr)));
    if (!main || !s) {
      this.setCaption('All six pointers are in use. free() one first.', true);
      this.rev++;
      return;
    }
    const p = this.place16(req);
    this.genLine(this.sb.declared.has(s.name) ? `    ${s.name} = malloc(${req});` : `    char *${s.name} = malloc(${req});`);
    this.sb.declared.add(s.name);
    this.setCaption(
      p.grew
        ? p.tried.length
          ? `malloc(${req}): checked ${p.tried.length} hole${p.tried.length > 1 ? 's' : ''}, none fit → heap grows`
          : `malloc(${req}): no free holes → carve ${Math.max(16, round16(req))} B off the top`
        : `malloc(${req}): reuses the free hole at ${tail(p.addr)}`,
    );
    this.sb.order.push(s.name);
    this.malloc(s.name, req, text(`char[${req}]`));
    this.rev++;
  }

  private sbDoFree() {
    const name = this.sb.order.shift();
    if (!name) {
      this.setCaption('Nothing to free yet. malloc() something first.', true);
      this.rev++;
      return;
    }
    const hit = this.slot(name);
    const b = hit && hit.s.v.t === 'ptr' ? this.blockAt(hit.s.v.addr) : undefined;
    this.genLine(`    free(${name}); ${name} = NULL;`);
    this.setCaption(`free(${name}): its ${b?.size ?? ''} B become a hole. Neighbouring holes merge.`);
    this.free(name, { onDone: () => this.nul(name) });
    this.rev++;
  }

  private later(delay: number, fn: () => void) {
    this.laters++;
    this.after(delay, () => {
      this.laters--;
      fn();
    });
  }

  /**
   * Finish whatever is still animating, instantly. The stage stops animating
   * while it is scrolled out of view (phones), so a sandbox button must never
   * wait for a flight to land.
   */
  private flush() {
    for (let i = 0; i < 40 && (this.flights.length > 0 || this.laters > 0); i++) this.advance(0.1, true, 10);
  }

  private genLine(l: string) {
    this.gen.push(l);
    if (this.gen.length > 60) this.gen.splice(1, 1);
    this.line = this.gen.length;
  }

  get sbStats() {
    const inUse = this.blocks.filter((b) => b.state !== 'free').reduce((s, b) => s + b.size, 0);
    const free = this.blocks.filter((b) => b.state === 'free').reduce((s, b) => s + b.size, 0);
    const holes = this.blocks.filter((b) => b.state === 'free').sort((a, b) => a.addr - b.addr);
    return { inUse, free, holes, heap: this.heapTop - HEAP_BASE };
  }

  /* ================================================================ */
  /* Playground                                                        */
  /* ================================================================ */

  private pgInit() {
    this.gen = ['int main(void) {'];
    this.pg.n = 0;
    this.pg.depth = 0;
    this.pg.allocs = 0;
    this.pg.errors = 0;
    this.pg.exited = false;
    this.call('main', []);
    this.line = 1;
    this.setCaption('Your program. Use the controls in the panel.');
    this.later(0.8, () => {
      this.pgDoMalloc(32);
      this.pg.allocs = 0;
    });
  }

  private indent() {
    return '    '.repeat(this.pg.depth + 1);
  }

  get pgPointers(): { name: string; fn: string; target: Block | null; ok: boolean; isNull: boolean; pending: boolean }[] {
    const out: { name: string; fn: string; target: Block | null; ok: boolean; isNull: boolean; pending: boolean }[] = [];
    for (const f of this.liveFrames())
      for (const s of f.slots) {
        if (s.kind !== 'local' || s.type !== 'ptr') continue;
        if (s.v.t !== 'ptr') {
          out.push({ name: s.name, fn: f.fn, target: null, ok: true, isNull: false, pending: true });
          continue;
        }
        const b = s.v.addr ? (this.blockAt(s.v.addr) ?? null) : null;
        out.push({ name: s.name, fn: f.fn, target: b, ok: !!b && b.state !== 'free' && b.alloc === s.v.prov, isNull: !s.v.addr, pending: false });
      }
    return out;
  }

  /** Only a finished (exited or crashed) session blocks the controls. */
  get pgBusy() {
    return this.pg.exited;
  }

  /** Bytes allocated right now, including blocks whose malloc is still animating. */
  get heapReserved() {
    return this.blocks.filter((b) => b.state !== 'free').reduce((s, b) => s + b.req, 0);
  }

  pgMalloc(req: number) {
    if (this.pgBusy) return;
    this.flush();
    this.pgDoMalloc(req);
  }

  private pgDoMalloc(req: number) {
    const f = this.top();
    if (!f) return;
    if (f.slots.filter((s) => s.kind === 'local').length >= 4) {
      this.setCaption(`${f.fn}() already has 4 pointers. Return, or reuse one.`, true);
      this.rev++;
      return;
    }
    const name = `p${++this.pg.n}`;
    const fn = this.mode === 'gc' ? 'GC_MALLOC' : 'malloc';
    this.addLocal({ name, type: 'ptr' }, f);
    this.genLine(`${this.indent()}char *${name} = ${fn}(${req});`);
    this.setCaption(`${fn}(${req}) → ${name}`);
    this.pg.allocs++;
    this.malloc(name, req, text(`char[${req}]`, 'data'), { label: `${fn}(${req})` });
    this.rev++;
  }

  pgCopy(src: string) {
    if (this.pgBusy) return;
    this.flush();
    const f = this.top();
    const s = this.slot(src);
    if (!f || !s) return;
    if (f.slots.filter((x) => x.kind === 'local').length >= 4) {
      this.setCaption(`${f.fn}() already has 4 pointers. Return first.`, true);
      this.rev++;
      return;
    }
    const name = `p${++this.pg.n}`;
    this.addLocal({ name, type: 'ptr' }, f);
    this.genLine(`${this.indent()}char *${name} = ${src};`);
    this.setCaption(`${name} = ${src}: two pointers, one block`);
    this.assign(name, src);
    this.rev++;
  }

  pgNull(name: string) {
    if (this.pgBusy) return;
    this.flush();
    this.genLine(`${this.indent()}${name} = NULL;`);
    this.setCaption(`${name} = NULL`);
    this.nul(name);
  }

  pgFree(name: string) {
    if (this.pgBusy) return;
    this.flush();
    const hit = this.slot(name);
    if (!hit || hit.s.v.t !== 'ptr') return;
    this.genLine(`${this.indent()}free(${name});`);
    if (!hit.s.v.addr) {
      this.setCaption('free(NULL) does nothing: that is why setting pointers to NULL after free is a good habit.');
      this.rev++;
      return;
    }
    const b = this.blockAt(hit.s.v.addr);
    if (b && (b.state === 'free' || b.alloc !== hit.s.v.prov)) {
      this.pgError([`ERROR: AddressSanitizer: attempting double-free on ${hex12(hit.s.v.addr)}`, `SUMMARY: AddressSanitizer: double-free in ${this.top()?.fn ?? 'main'}`], `b:${b.id}`);
      return;
    }
    this.setCaption(`free(${name})`);
    this.free(name);
  }

  /** Write through the pointer: fine if it's valid, a bug if it dangles or is NULL. */
  pgUse(name: string) {
    if (this.pgBusy) return;
    this.flush();
    const hit = this.slot(name);
    if (!hit || hit.s.v.t !== 'ptr') return;
    this.genLine(`${this.indent()}${name}[0] = 'x';`);
    if (!hit.s.v.addr) {
      this.pgError(['ERROR: AddressSanitizer: SEGV on unknown address 0x000000000000', `SUMMARY: AddressSanitizer: SEGV in ${this.top()?.fn ?? 'main'}`], `s:${hit.f.id}:${name}`);
      return;
    }
    const t = this.resolvePtr(hit.s.v);
    if (!t || !t.ok) {
      this.pg.flags.uaf = true;
      const b = t && t.kind === 'block' ? t.b : null;
      this.write([name], null, 'x', { label: "'x'" });
      const fn = this.top()?.fn ?? 'main';
      this.after(0.5, () => this.pgError([`ERROR: AddressSanitizer: heap-use-after-free on address ${hex12(hit.s.v.t === 'ptr' ? hit.s.v.addr : 0)}`, `SUMMARY: AddressSanitizer: heap-use-after-free in ${fn}`], b ? `b:${b.id}` : undefined));
      return;
    }
    this.setCaption(`${name}[0] = 'x': a valid write`);
    this.write([name], null, 'xata', { label: "'x'" });
  }

  pgCall() {
    if (this.pgBusy) return;
    this.flush();
    if (this.pg.depth >= 2) {
      this.setCaption('Deep enough for this sandbox: return first.', true);
      this.rev++;
      return;
    }
    const fn = this.pg.depth === 0 ? 'f' : 'g';
    this.genLine(`${this.indent()}${fn}();   // → ${fn}()`);
    this.pg.depth++;
    this.call(fn, []);
    this.setCaption(`call ${fn}(): a new frame. Pointers you malloc now live in it.`);
    this.rev++;
  }

  pgReturn() {
    if (this.pgBusy) return;
    this.flush();
    const f = this.top();
    if (!f) return;
    if (this.pg.depth === 0) {
      this.pgExit();
      return;
    }
    this.genLine(`${this.indent()}return;   // ← back`);
    this.pg.depth--;
    this.setCaption(`${f.fn}() returns: its frame and its pointers are gone.`);
    this.ret(null);
    this.rev++;
  }

  /** main returns: LeakSanitizer checks what is still allocated. */
  pgExit() {
    if (this.pgBusy) return;
    this.flush();
    this.genLine('    return 0;');
    this.gen.push('}');
    this.pg.exited = true;
    this.ret(null);
    this.after(0.4, () => {
      const leaked = this.blocks.filter((b) => b.state === 'leaked');
      if (leaked.length) {
        const n = leaked.reduce((s, b) => s + b.req, 0);
        this.print(`ERROR: LeakSanitizer: detected memory leaks`, 'err');
        this.print(`SUMMARY: AddressSanitizer: ${n} byte(s) leaked in ${leaked.length} allocation(s).`, 'err');
        this.setCaption('Exited with leaks.', true);
      } else if (this.pg.errors === 0) {
        this.print('exit 0 · no leaks, no errors', 'ok');
        this.setCaption('Clean exit: every malloc had its free.');
        if (this.pg.allocs >= 3) this.pg.flags.clean = true;
      } else this.print('exit 0', 'dim');
      this.rev++;
    });
    this.after(4.2, () => this.pgRestartSession());
    this.rev++;
  }

  private pgError(lines: string[], at?: string) {
    this.pg.errors++;
    lines.forEach((l) => this.print(l, 'err'));
    this.lineBad = true;
    this.setCaption('AddressSanitizer stopped the program.', true);
    if (at) {
      const id = at.startsWith('b:') ? `bk:${at.slice(2)}` : null;
      if (id) this.fx({ kind: 'x', at: { id }, color: SIG.err, dur: 1.2, size: 2 });
    }
    this.pg.exited = true;
    this.after(4.2, () => this.pgRestartSession());
    this.rev++;
  }

  private pgRestartSession() {
    const flags = { ...this.pg.flags };
    this.clearTransient();
    this.laters = 0;
    this.resetMemory();
    this.pg = { n: 0, depth: 0, allocs: 0, errors: 0, exited: false, flags };
    this.pgInit();
    this.out = [{ text: '(process restarted)', tone: 'dim', vt: this.vt }];
    this.relayout();
    this.rev++;
  }

  setMode(mode: 'c' | 'gc') {
    this.mode = mode;
    this.lang = 'c';
    if (mode === 'gc') {
      for (const b of this.blocks) if (b.state === 'leaked') {
        b.state = 'garbage';
        b.since = this.vt;
      }
    }
    this.refreshReach();
    this.rev++;
  }

  private pgCheck() {
    const counts = new Map<number, number>();
    for (const f of this.liveFrames())
      for (const s of f.slots)
        if (s.v.t === 'ptr' && s.v.addr) {
          const b = this.blockAt(s.v.addr);
          if (b && b.state === 'live' && b.alloc === s.v.prov) counts.set(b.alloc, (counts.get(b.alloc) ?? 0) + 1);
        }
    if ([...counts.values()].some((n) => n >= 2)) this.pg.flags.alias = true;
  }

  /* ================================================================ */
  /* Simulation loop                                                   */
  /* ================================================================ */

  protected step(dt: number) {
    if (this.view === 'overflow') {
      this.stepOverflow(dt);
      return;
    }
    if (this.revealT < 99) this.revealT += dt;
    this.stepProgram(dt);
    this.stepGC();
  }

  protected animate(dt: number) {
    for (const [id, b] of this.boxes) {
      if (!id.startsWith('seg:')) continue;
      const e = this.ez.get(id);
      if (!e || !Number.isFinite(e.w)) this.ez.set(id, { w: b.w, h: b.h });
      else {
        e.w = damp(e.w, b.w, 6.5, dt);
        e.h = damp(e.h, b.h, 6.5, dt);
      }
    }
  }

  /** Eased size of a segment box (so the map can morph into the two columns). */
  segRect(id: string): Rect | null {
    const b = this.boxes.get(`seg:${id}`);
    if (!b || Number.isNaN(b.x)) return null;
    const e = this.ez.get(`seg:${id}`) ?? { w: b.w, h: b.h };
    return { x: b.x - e.w / 2, y: b.y - e.h / 2, w: e.w, h: e.h };
  }

  segAlpha(id: SegDef['id']): number {
    const b = this.boxes.get(`seg:${id}`);
    if (!b) return 0;
    if (this.view !== 'map' || !this.cfg.reveal) return b.alpha;
    const i = REVEAL_ORDER.indexOf(id);
    return b.alpha * clamp((this.revealT - 0.35 - i * 0.75) / 0.45, 0, 1);
  }

  /* ================================================================ */
  /* Layout                                                            */
  /* ================================================================ */

  get codeText(): string {
    if (this.cfg.sandbox || this.cfg.playground) return [...this.gen, ...(this.gen[this.gen.length - 1] === '}' ? [] : ['}'])].join('\n');
    if (this.view === 'overflow') return diveCode(this.ov.target, this.ov.noBase);
    return this.prog?.code ?? '';
  }

  private codeLineCount() {
    const t = this.codeText;
    return t ? t.split('\n').length : 0;
  }

  protected layout() {
    this.geo = this.computeGeo();
    if (this.view === 'map') this.layoutMap();
    else {
      const g = this.geo;
      this.place('seg:stack', g.stack.x + g.stack.w / 2, g.stack.y + g.stack.h / 2, g.stack.w, g.stack.h);
      this.place('seg:heap', g.heap.x + g.heap.w / 2, g.heap.y + g.heap.h / 2, g.heap.w, g.heap.h);
      if (this.view === 'run') {
        this.layoutStack();
        this.layoutHeap();
      }
    }
  }

  private computeGeo(): Geo {
    const { w, h } = this;
    const portrait = this.orient === 'portrait';
    const hasCode = this.view !== 'map' ? true : !!this.prog;
    const nLines = this.codeLineCount();
    const conOn = this.cfg.console;
    const infoOn = !!this.cfg.info;
    const g: Geo = emptyGeo();
    g.portrait = portrait;

    if (!portrait) {
      const pad = 20;
      const top = 70;
      const leftBottom = h - 84;
      const rightBottom = h - 106;
      const codeW = clamp(w * 0.345, 290, 350);
      g.codeFont = codeW < 340 ? 11.5 : 12;
      g.lineH = codeW < 340 ? 19.5 : 20.4;
      g.font = { head: 11.5, row: 10.5, addr: 9 };
      const memX0 = hasCode ? pad + codeW + 30 : pad + 40;
      const memW = w - pad - memX0;
      const stackW = Math.round(memW * 0.41);
      const heapW = Math.round(memW * 0.41);
      const colH = rightBottom - top;
      g.stack = { x: memX0, y: top, w: stackW, h: colH };
      g.heap = { x: w - pad - heapW, y: top, w: heapW, h: colH };
      g.frameW = stackW - 30;
      g.blockW = heapW - 22;
      // Run view: the terminal (or the allocator readout) sits under a shorter heap
      // column, so blocks stay close to the frames that point at them.
      const runBelow = this.view === 'run' && (conOn || infoOn);
      if (runBelow) {
        const heapH = Math.round(colH * 0.6);
        g.heap = { ...g.heap, h: heapH };
        const y0 = top + heapH + 18;
        if (conOn) {
          g.conLines = 5;
          g.con = { x: g.heap.x, y: y0, w: heapW, h: 30 + 10 + g.conLines * 15 };
        } else g.info = { x: g.heap.x, y: y0, w: heapW, h: 118 };
      }
      // Left column: code, caption, then (map and overflow views) a readout and the terminal.
      const infoH = infoOn && !runBelow ? 118 : 0;
      const leftCon = conOn && hasCode && !runBelow;
      const conLines = this.view === 'map' ? 4 : 2;
      const conH = leftCon ? 30 + 10 + (conLines + 1) * 16 : 0;
      if (hasCode) {
        const below = 30 + (infoH ? infoH + 12 : 0) + (conH ? conH + 12 : 0);
        const maxH = leftBottom - top - below;
        g.codeLines = Math.max(4, Math.min(nLines, Math.floor((maxH - 38) / g.lineH)));
        g.code = { x: pad, y: top, w: codeW, h: 38 + g.codeLines * g.lineH };
        g.cap = { x: pad, y: g.code.y + g.code.h + 8, w: codeW, h: 22 };
        let y = g.cap.y + g.cap.h + 12;
        if (infoH) {
          g.info = { x: pad, y, w: codeW, h: infoH };
          y += infoH + 12;
        }
        if (leftCon) {
          g.conLines = conLines;
          g.con = { x: pad, y, w: codeW, h: conH };
        }
      }
      if (this.view === 'map') {
        const colW = hasCode ? 150 : 190;
        const cx = hasCode ? memX0 + 110 + colW / 2 : w * 0.43;
        g.map = { x: cx - colW / 2, y: top + 18, w: colW, h: rightBottom - top - 48 };
      }
      if (this.view === 'overflow') {
        const gx = memX0 + 96;
        g.gauge = { x: gx, y: top + 40, w: 58, h: rightBottom - top - 66 };
        g.cards = { x: gx + 58 + 44, y: top, w: Math.min(250, w - pad - (gx + 58 + 44)), h: rightBottom - top };
      }
    } else {
      const pad = 10;
      const top = 58;
      g.codeFont = 10.5;
      g.lineH = 15.5;
      g.font = { head: 10, row: 9.5, addr: 8 };
      let bottom = h - 60;
      if (conOn && hasCode) {
        // Phones get a compact, headerless terminal: the last two lines.
        g.conLines = 2;
        const conH = 12 + g.conLines * 14;
        g.con = { x: pad, y: bottom - conH, w: w - pad * 2, h: conH };
        bottom = g.con.y - 8;
      }
      if (infoOn && this.cfg.info === 'alloc' && this.view === 'run') {
        const ih = 62;
        g.info = { x: pad, y: bottom - ih, w: w - pad * 2, h: ih };
        bottom = g.info.y - 8;
      }
      let memTop = top;
      if (hasCode) {
        g.codeLines = Math.min(nLines, this.view === 'map' ? 4 : 5);
        g.code = { x: pad, y: top, w: w - pad * 2, h: 32 + g.codeLines * g.lineH };
        g.cap = { x: pad, y: g.code.y + g.code.h + 5, w: w - pad * 2, h: 28 };
        memTop = g.cap.y + g.cap.h + 6;
        if (this.cfg.lane) {
          g.lane = { x: pad, y: memTop - 2, w: w - pad * 2, h: 26 };
          memTop += 26;
        }
      }
      const colW = (w - pad * 2) / 2 - 6;
      g.stack = { x: pad, y: memTop, w: colW, h: bottom - memTop };
      g.heap = { x: w / 2 + 6, y: memTop, w: colW, h: bottom - memTop };
      g.frameW = colW - 20;
      g.blockW = colW - 14;
      if (this.view === 'map') {
        const colWm = 104;
        const mapBottom = Math.min(bottom - 22, h - 86);
        const mapTop = hasCode ? memTop + 20 : memTop + 16;
        g.map = { x: 104, y: mapTop, w: colWm, h: mapBottom - mapTop };
      }
      if (this.view === 'overflow') {
        g.gauge = { x: 50, y: memTop + 40, w: 40, h: bottom - memTop - 66 };
        g.cards = { x: 122, y: memTop + 40, w: w - pad - 122, h: bottom - memTop - 40 };
      }
    }
    return g;
  }

  frameH(f: Frame) {
    const m = this.fm;
    const rows = f.slots.filter((s) => s.kind === 'param' || s.kind === 'local').length;
    return m.headH + (this.cfg.detail === 'full' ? 2 * m.rowH : m.bkH) + rows * m.rowH + 3;
  }

  private layoutStack() {
    const g = this.geo;
    const base: Metrics = g.portrait
      ? { headH: 16, rowH: 14, bkH: 9, gap: 5, bHead: 17, bRow: 13.5, bGap: 5 }
      : { headH: 20, rowH: 17, bkH: 12, gap: 7, bHead: 21, bRow: 16, bGap: 7 };
    this.fm = { ...base };
    const order = [...this.frames].sort((a, b) => b.base - a.base);
    const avail = g.stack.h - 26;
    let need = order.reduce((s, f) => s + this.frameH(f) + this.fm.gap, 0);
    if (need > avail) {
      const k = Math.max(0.74, avail / need);
      this.fm = { ...this.fm, headH: base.headH * k, rowH: base.rowH * k, bkH: base.bkH * k, gap: base.gap * k };
      need = order.reduce((s, f) => s + this.frameH(f) + this.fm.gap, 0);
    }
    let y = g.stack.y + 24;
    const x = g.stack.x + g.stack.w - g.frameW / 2;
    for (const f of order) {
      const fh = this.frameH(f);
      this.place(`fr:${f.id}`, x, y + fh / 2, g.frameW, fh);
      y += fh + this.fm.gap;
    }
  }

  blockH(b: Block): number {
    const m = this.fm;
    if (b.compact) return g2(m.bRow + 2);
    if (b.state === 'free') return m.bHead + 2;
    if (b.kind === 'cells') return m.bHead + m.bRow + 6;
    if (b.kind === 'text') return m.bHead + m.bRow + 4;
    return m.bHead + b.fields.length * m.bRow + 4;
  }

  private layoutHeap() {
    const g = this.geo;
    const list = [...this.blocks].sort((a, b) => a.addr - b.addr);
    for (const b of list) b.compact = false;
    const avail = g.heap.h - 26 - 24;
    const total = () => list.reduce((s, b) => s + this.blockH(b) + this.fm.bGap, 0);
    if (total() > avail) for (const b of list) if (b.state !== 'live') b.compact = true;
    if (total() > avail) for (const b of list) b.compact = true;
    let y = g.heap.y + g.heap.h - 24;
    const x = g.heap.x + g.blockW / 2;
    for (const b of list) {
      const bh = this.blockH(b);
      this.place(`bk:${b.id}`, x, y - bh / 2, g.blockW, bh);
      y -= bh + this.fm.bGap;
    }
    this.heapTopY = y;
  }

  private layoutMap() {
    const g = this.geo;
    const m = g.map;
    if (!m) return;
    const total = SEGS.reduce((s, d) => s + d.weight + d.gapAfter, 0);
    const unit = m.h / total;
    let y = m.y;
    for (const d of SEGS) {
      const sh = d.weight * unit;
      this.place(`seg:${d.id}`, m.x + m.w / 2, y + sh / 2, m.w, sh);
      y += sh + d.gapAfter * unit;
    }
  }

  /* ================================================================ */
  /* Geometry for drawing, flights and callouts                        */
  /* ================================================================ */

  frameRect(f: Frame): Rect | null {
    const b = this.boxes.get(`fr:${f.id}`);
    if (!b || Number.isNaN(b.x)) return null;
    return { x: b.x - b.w / 2, y: b.y - b.h / 2, w: b.w, h: b.h };
  }

  blockRect(bl: Block): Rect | null {
    const b = this.boxes.get(`bk:${bl.id}`);
    if (!b || Number.isNaN(b.x)) return null;
    return { x: b.x - b.w / 2, y: b.y - b.h / 2, w: b.w, h: b.h };
  }

  /** Vertical center of a slot's row inside its frame. */
  slotY(f: Frame, s: Slot, r: Rect): number {
    const m = this.fm;
    if (s.kind === 'ret' || s.kind === 'rbp') {
      if (this.cfg.detail !== 'full') return r.y + m.headH + m.bkH / 2;
      return r.y + m.headH + (s.kind === 'ret' ? 0.5 : 1.5) * m.rowH;
    }
    const rows = f.slots.filter((x) => x.kind === 'param' || x.kind === 'local');
    const i = rows.indexOf(s);
    return r.y + m.headH + (this.cfg.detail === 'full' ? 2 * m.rowH : m.bkH) + (i + 0.5) * m.rowH;
  }

  fieldY(bl: Block, k: string, r: Rect): number {
    const m = this.fm;
    if (bl.kind !== 'fields') return r.y + m.bHead + m.bRow / 2 + 2;
    const i = Math.max(0, bl.fields.findIndex((f) => f.k === k));
    return r.y + m.bHead + (i + 0.5) * m.bRow + 1;
  }

  private anchor(id: string): Anchor | null {
    if (id.startsWith('pt:')) {
      const [x, y] = id.slice(3).split(',').map(Number);
      return { x, y, l: x, r: x, top: y, col: 'pt' };
    }
    if (id === 'con') {
      const c = this.geo.con;
      if (!c) return null;
      return { x: c.x + c.w / 2, y: c.y + c.h / 2, l: c.x, r: c.x + c.w, top: c.y, col: 'con' };
    }
    const [kind, a, b] = id.split(':');
    if (kind === 's' || kind === 'f') {
      const f = this.frames.find((x) => x.id === a);
      if (!f) return null;
      const r = this.frameRect(f);
      if (!r) return null;
      let y = r.y + this.fm.headH / 2;
      if (kind === 's') {
        const s = f.slots.find((x) => x.name === b);
        if (!s) return null;
        y = this.slotY(f, s, r);
      }
      return { x: r.x + r.w / 2, y, l: r.x, r: r.x + r.w, top: r.y, col: 'stack' };
    }
    if (kind === 'b' || kind === 'bf') {
      const bl = this.blocks.find((x) => x.id === a);
      if (!bl) return null;
      const r = this.blockRect(bl);
      if (!r) return null;
      const y = kind === 'bf' ? this.fieldY(bl, b, r) : r.y + Math.min(this.fm.bHead / 2 + 1, r.h / 2);
      return { x: r.x + r.w / 2, y, l: r.x, r: r.x + r.w, top: r.y, col: 'heap' };
    }
    if (kind === 'pin') {
      const p = this.pinPos(a);
      if (!p) return null;
      return { x: p.x, y: p.y, l: p.x - 6, r: p.x + 6, top: p.y, col: 'map' };
    }
    return null;
  }

  protected curveFor(from: string, to: string): Curve | null {
    const A = this.anchor(from);
    const B = this.anchor(to);
    if (!A || !B) return null;
    return this.route(A, B);
  }

  private route(A: Anchor, B: Anchor): Curve {
    if (A.col === 'stack' && B.col === 'stack') {
      const p0 = { x: A.l, y: A.y };
      const p3 = { x: B.l, y: B.y };
      const k = 14 + Math.abs(p3.y - p0.y) * 0.25;
      return { p0, p1: { x: p0.x - k, y: p0.y }, p2: { x: p3.x - k, y: p3.y }, p3 };
    }
    if (A.col === 'heap' && B.col === 'heap') {
      const p0 = { x: A.r, y: A.y };
      const p3 = { x: B.r, y: B.y };
      const k = 12 + Math.abs(p3.y - p0.y) * 0.22;
      return { p0, p1: { x: p0.x + k, y: p0.y }, p2: { x: p3.x + k, y: p3.y }, p3 };
    }
    if (B.col === 'con' || A.col === 'con' || B.col === 'map' || A.col === 'map') {
      const vertical = this.geo.portrait && (B.col === 'con' || A.col === 'con');
      if (vertical) {
        const p0 = A.col === 'con' ? { x: A.x, y: A.top } : { x: A.x, y: A.y };
        const p3 = B.col === 'con' ? { x: clamp(A.x, B.l + 20, B.r - 20), y: B.top } : { x: B.x, y: B.y };
        const k = Math.abs(p3.y - p0.y) * 0.45;
        return { p0, p1: { x: p0.x, y: p0.y + Math.sign(p3.y - p0.y) * k }, p2: { x: p3.x, y: p3.y - Math.sign(p3.y - p0.y) * k }, p3 };
      }
      const p0 = A.col === 'con' ? { x: A.r - 20, y: A.y } : { x: A.x < B.x ? A.r : A.l, y: A.y };
      const p3 = B.col === 'con' ? { x: B.r - 24, y: B.top } : { x: B.x, y: B.y };
      const dx = p3.x - p0.x;
      return { p0, p1: { x: p0.x + dx * 0.5, y: p0.y }, p2: { x: p3.x - dx * 0.1, y: p3.y - (B.col === 'con' ? 40 : 0) }, p3 };
    }
    const ltr = A.x <= B.x;
    const p0 = { x: ltr ? A.r : A.l, y: A.y };
    const p3 = { x: ltr ? B.l : B.r, y: B.y };
    const dx = p3.x - p0.x;
    return { p0, p1: { x: p0.x + dx * 0.45, y: p0.y }, p2: { x: p3.x - dx * 0.45, y: p3.y }, p3 };
  }

  resolvePtr(v: Val): { kind: 'block'; b: Block; ok: boolean } | { kind: 'slot'; f: Frame; s: Slot; ok: boolean } | null {
    if (v.t !== 'ptr' || !v.addr) return null;
    const b = this.blocks.find((x) => x.shown && v.addr >= x.addr && v.addr < x.addr + x.size);
    if (b) return { kind: 'block', b, ok: b.state !== 'free' && b.alloc === v.prov };
    for (const f of this.frames)
      for (const s of f.slots) if (s.addr === v.addr && s.kind !== 'ret' && s.kind !== 'rbp') return { kind: 'slot', f, s, ok: !f.ghost && s.uid === v.prov };
    return null;
  }

  /** Every pointer drawn as an arrow, recomputed each frame from the boxes. */
  arrowViews(defaultColor: string = SIG.req): ArrowView[] {
    type Raw = { key: string; sx: number; sy: number; tgt: string; tx: number; ty: number; mode: 'lr' | 'rr' | 'hr'; color: string; bad: boolean };
    const raws: Raw[] = [];
    for (const f of this.frames) {
      if (f.ghost) continue;
      const fr = this.frameRect(f);
      if (!fr) continue;
      for (const s of f.slots) {
        if (s.kind === 'ret' || s.kind === 'rbp' || s.v.t !== 'ptr' || !s.v.addr || s.moved) continue;
        const t = this.resolvePtr(s.v);
        if (!t) continue;
        const sy = this.slotY(f, s, fr);
        const color = t.ok ? (s.color ?? defaultColor) : SIG.err;
        if (t.kind === 'block') {
          const br = this.blockRect(t.b);
          if (!br) continue;
          raws.push({ key: `${f.id}:${s.name}`, sx: fr.x + fr.w, sy, tgt: t.b.id, tx: br.x, ty: br.y + Math.min(this.fm.bHead / 2 + 1, br.h / 2), mode: 'lr', color, bad: !t.ok });
        } else {
          const tr = this.frameRect(t.f);
          if (!tr) continue;
          raws.push({ key: `${f.id}:${s.name}`, sx: fr.x + fr.w, sy, tgt: `${t.f.id}:${t.s.name}`, tx: tr.x + tr.w, ty: this.slotY(t.f, t.s, tr), mode: 'rr', color, bad: !t.ok });
        }
      }
    }
    for (const b of this.blocks) {
      if (b.state === 'free' || !b.shown) continue;
      const r = this.blockRect(b);
      if (!r) continue;
      for (const fl of b.fields) {
        if (fl.v.t !== 'ptr' || !fl.v.addr) continue;
        const t = this.resolvePtr(fl.v);
        if (!t || t.kind !== 'block') continue;
        const tr = this.blockRect(t.b);
        if (!tr) continue;
        raws.push({ key: `${b.id}:${fl.k}`, sx: r.x + r.w, sy: this.fieldY(b, fl.k, r), tgt: t.b.id, tx: tr.x + tr.w, ty: tr.y + Math.min(this.fm.bHead / 2 + 1, tr.h / 2), mode: 'hr', color: t.ok ? SIG.hc : SIG.err, bad: !t.ok });
      }
    }
    // Spread arrowheads that land on the same target.
    const byT = new Map<string, Raw[]>();
    for (const r of raws) byT.set(`${r.tgt}:${r.mode}`, [...(byT.get(`${r.tgt}:${r.mode}`) ?? []), r]);
    for (const list of byT.values()) {
      if (list.length < 2) continue;
      list.sort((a, b) => a.sy - b.sy);
      list.forEach((r, i) => (r.ty += (i - (list.length - 1) / 2) * 6));
    }
    const out: ArrowView[] = [];
    const seen = new Set<string>();
    for (const r of raws) {
      seen.add(r.key);
      const prev = this.arrowSeen.get(r.key);
      if (!prev || prev.tgt !== r.tgt) this.arrowSeen.set(r.key, { vt: this.vt, tgt: r.tgt });
      const born = this.arrowSeen.get(r.key)?.vt ?? this.vt;
      let c: Curve;
      if (r.mode === 'lr') {
        const dx = r.tx - r.sx;
        c = { p0: { x: r.sx, y: r.sy }, p1: { x: r.sx + dx * 0.5, y: r.sy }, p2: { x: r.tx - dx * 0.5, y: r.ty }, p3: { x: r.tx - 1, y: r.ty } };
      } else {
        const k = (r.mode === 'rr' ? 16 : 12) + Math.abs(r.ty - r.sy) * 0.2;
        c = { p0: { x: r.sx, y: r.sy }, p1: { x: r.sx + k, y: r.sy }, p2: { x: r.tx + k, y: r.ty }, p3: { x: r.tx + 1, y: r.ty } };
      }
      const f = (n: number) => n.toFixed(1);
      out.push({
        key: r.key,
        d: `M${f(c.p0.x)},${f(c.p0.y)} C${f(c.p1.x)},${f(c.p1.y)} ${f(c.p2.x)},${f(c.p2.y)} ${f(c.p3.x)},${f(c.p3.y)}`,
        x0: c.p0.x,
        y0: c.p0.y,
        x1: c.p3.x,
        y1: c.p3.y,
        ang: Math.atan2(c.p3.y - c.p2.y, c.p3.x - c.p2.x),
        color: r.color,
        bad: r.bad,
        born,
      });
    }
    for (const k of [...this.arrowSeen.keys()]) if (!seen.has(k)) this.arrowSeen.delete(k);
    return out;
  }

  pinPos(id: string): Pt | null {
    const p = this.pins.find((x) => x.id === id);
    if (!p) return null;
    const r = this.segRect(p.seg);
    const d = SEGS.find((s) => s.id === p.seg);
    if (!r || !d) return null;
    const frac = clamp((d.hi - p.addr) / (d.hi - d.lo), 0.3, 0.72);
    return { x: r.x + r.w * 0.5, y: r.y + r.h * frac };
  }

  /**
   * A named thing on the stage, for callouts, hover highlights and prompts:
   * code, console, sp, stack, heap, frame:<fn>, ghost, slot:<name>, block, block:<label>,
   * hole, leaked, seg:<id>, gauge, guard, cards. Prefix with "L:" for landscape only.
   */
  target(t: string): Rect | null {
    if (t.startsWith('L:')) {
      if (this.geo.portrait) return null;
      t = t.slice(2);
    }
    const g = this.geo;
    const [kind, arg] = t.split(':');
    switch (kind) {
      case 'code':
        return g.code;
      case 'console':
        return g.con;
      case 'info':
        return g.info;
      case 'caption':
        return g.cap;
      case 'stack':
        return this.segRect('stack') ?? g.stack;
      case 'heap':
        return this.segRect('heap') ?? g.heap;
      case 'heaptop': {
        const r = this.segRect('heap') ?? g.heap;
        return { x: r.x, y: Math.max(r.y + 40, this.heapTopY - 16), w: r.w, h: 20 };
      }
      case 'seg':
        return this.segRect(arg);
      case 'sp': {
        const tp = this.top();
        const r = tp ? this.frameRect(tp) : null;
        if (!r) return null;
        return { x: g.stack.x, y: r.y + r.h - 8, w: 26, h: 16 };
      }
      case 'frame': {
        const live = this.liveFrames().filter((f) => !arg || f.fn === arg);
        const f = live[live.length - 1];
        return f ? this.frameRect(f) : null;
      }
      case 'ghost': {
        const f = this.frames.find((x) => x.ghost);
        return f ? this.frameRect(f) : null;
      }
      case 'slot': {
        const hit = this.slot(arg);
        if (!hit) return null;
        const r = this.frameRect(hit.f);
        if (!r) return null;
        const y = this.slotY(hit.f, hit.s, r);
        return { x: r.x, y: y - this.fm.rowH / 2, w: r.w, h: this.fm.rowH };
      }
      case 'bk': {
        const f = this.top();
        const r = f ? this.frameRect(f) : null;
        if (!f || !r) return null;
        const y = r.y + this.fm.headH;
        return { x: r.x, y, w: r.w, h: this.cfg.detail === 'full' ? this.fm.rowH * 2 : this.fm.bkH };
      }
      case 'block': {
        const b = this.blocks.find((x) => x.shown && x.state !== 'free' && (!arg || x.label === arg));
        return b ? this.blockRect(b) : null;
      }
      case 'hole': {
        const b = this.blocks.find((x) => x.shown && x.state === 'free');
        return b ? this.blockRect(b) : null;
      }
      case 'leaked': {
        const b = this.blocks.find((x) => x.state === 'leaked');
        return b ? this.blockRect(b) : null;
      }
      case 'garbage': {
        const b = this.blocks.find((x) => x.state === 'garbage');
        return b ? this.blockRect(b) : null;
      }
      case 'gauge':
        return g.gauge;
      case 'guard':
        return g.gauge ? { x: g.gauge.x, y: g.gauge.y + g.gauge.h, w: g.gauge.w, h: 12 } : null;
      case 'edge': {
        if (!g.gauge) return null;
        const y = g.gauge.y + g.gauge.h * this.ovFrac;
        return { x: g.gauge.x, y: y - 2, w: g.gauge.w, h: 4 };
      }
      case 'cards':
        return g.cards;
      case 'pin': {
        const p = this.pinPos(arg);
        return p ? { x: p.x - 30, y: p.y - 8, w: 60, h: 16 } : null;
      }
      default:
        return null;
    }
  }

  /* ================================================================ */
  /* Readouts                                                          */
  /* ================================================================ */

  get stackUsed() {
    return this.liveFrames().reduce((s, f) => s + f.size, 0);
  }

  get heapInUse() {
    return this.blocks.filter((b) => b.state !== 'free' && b.shown).reduce((s, b) => s + b.req, 0);
  }

  get leakedBytes() {
    return this.blocks.filter((b) => b.state === 'leaked').reduce((s, b) => s + b.req, 0);
  }
}

/* ------------------------------------------------------------------ */

function emptyGeo(): Geo {
  const z = { x: 0, y: 0, w: 0, h: 0 };
  return {
    portrait: false,
    code: null,
    codeLines: 0,
    lineH: 20,
    codeFont: 12,
    cap: null,
    con: null,
    conLines: 0,
    info: null,
    stack: z,
    heap: z,
    frameW: 180,
    blockW: 200,
    map: null,
    lane: null,
    gauge: null,
    cards: null,
    font: { head: 11.5, row: 10.5, addr: 9 },
  };
}

const g2 = (n: number) => Math.round(n);
const hex12 = (n: number) => `0x${n.toString(16).padStart(12, '0')}`;

function text(label: string, s?: string): BlockSpec {
  return { label, kind: 'text', fields: [['', s == null ? NONE : str(s)]] };
}

/** The overflow demo's source, rewritten live by the slider and the base-case toggle. */
export function diveCode(target: number, noBase: boolean) {
  const t = Math.round(target);
  return [
    'void dive(int depth) {',
    '    char buf[40];',
    '    buf[0] = (char)depth;',
    noBase ? `    // if (depth == ${t})` : `    if (depth == ${t})`,
    noBase ? '    //     return;' : '        return;',
    '    dive(depth + 1);',
    '}',
    '',
    'int main(void) {',
    '    dive(1);',
    '    return 0;',
    '}',
  ].join('\n');
}

export { int, str };
