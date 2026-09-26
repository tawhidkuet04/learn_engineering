import { SIG } from '@/lib/sim/colors';
import { bezier, type Curve, type Pt } from '@/lib/sim/geometry';
import { PredictGame, type Question } from '@/lib/sim/predict';
import { mulberry32 } from '@/lib/sim/rng';
import { Sim, type Box, type ScriptEvent } from '@/lib/sim/Sim';
import { GenModel, ZONE_CELLS, ZONE_COLS, type Zone } from './gen';
import { SCENES } from './scenes';
import { ThreadsModel } from './threads';
import { DEFAULTS, type Fate, type GcConfig, type Mark, type ObjDef, type ObjKind, type RootDef, type Section } from './types';

/*
 * The garbage collection world: roots, heap objects and the references
 * between them, a 24-block heap, and the collectors that clean it up
 * (reference counting, mark-sweep, mark-compact, copying). The generational
 * world (gen.ts) and the pause timeline (threads.ts) live next to it.
 *
 * Box ids: roots are r:<id>, objects o:<id>, generational objects g:<n>.
 * Edge ids: <from box>><to box>.
 */

export const HEAP_BLOCKS = 24;
export const BLOCK_BYTES = 16;
export const addrHex = (a: number) => `0x${(a * BLOCK_BYTES).toString(16).padStart(3, '0')}`;

export interface GRoot {
  id: string;
  label: string;
  section: Section;
  v: number;
  px: number;
  frame?: string;
  pane: number;
}

export interface GObj {
  id: string;
  label: string;
  kind: ObjKind;
  size: number;
  /** First heap block, or -1 when not in the heap */
  addr: number;
  u: number;
  v: number;
  p: [number, number];
  pane: number;
  sub?: string;
  rc: number;
  mark: Mark;
  fate: Fate;
  /** vt of the last count change (badge pulse) */
  pulse: number;
  tag: { text: string; color: string } | null;
  /** CPython cycle detector scratch count */
  gcRefs: number | null;
  /** Playground grid slot */
  slot?: number;
  /** Where it lived before its memory was released */
  lastAddr?: number;
}

export interface GEdge {
  id: string;
  from: string;
  to: string;
  weak: boolean;
  /** Points at freed memory (C) */
  dangling: boolean;
  bend: number;
  /** Logically gone (ignored by every algorithm), still fading out */
  removing: boolean;
  alpha: number;
  talpha: number;
  flashVt: number;
  flashColor: string;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A row-major grid of heap blocks. */
export interface Strip {
  x: number;
  y: number;
  cols: number;
  rows: number;
  cw: number;
  ch: number;
  rowGap: number;
  n: number;
}

export interface ZoneGeo {
  x: number;
  y: number;
  cols: number;
  rows: number;
  pitch: number;
  cell: number;
}

export interface Geo {
  land: boolean;
  objW: number;
  objH: number;
  rootW: number;
  rootH: number;
  /** Graph region per pane (object centers live inside) */
  regions: Rect[];
  /** Pane frames (split view) */
  panes: Rect[];
  strip: Strip | null;
  /** Heap view: which row each half lives on (copying) */
  copyRows: boolean;
  zones: Partial<Record<Zone, ZoneGeo>>;
  frames: { young?: Rect; old?: Rect; heap?: Rect };
  chart: Rect | null;
  lanes: { x0: number; x1: number; ys: number[]; h: number } | null;
  /** Where a readout goes in landscape (center x, top y, width) */
  readoutAt?: { x: number; y: number; w: number } | null;
}

export interface LogLine {
  text: string;
  kind?: 'ok' | 'bad' | 'dim' | 'hot';
}

export type Phase = 'idle' | 'mark' | 'sweep' | 'compact' | 'copy' | 'rc' | 'cycle' | 'alloc';

type AskKind = 'obj' | 'edge' | 'choice' | 'mixed';

const EMPTY_GEO: Geo = {
  land: true,
  objW: 90,
  objH: 36,
  rootW: 120,
  rootH: 28,
  regions: [],
  panes: [],
  strip: null,
  copyRows: false,
  zones: {},
  frames: {},
  chart: null,
  lanes: null,
};

export class GcSim extends Sim {
  cfg: GcConfig = { ...DEFAULTS };
  game: PredictGame | null = null;
  askKind: AskKind | null = null;

  roots = new Map<string, GRoot>();
  objs = new Map<string, GObj>();
  edges = new Map<string, GEdge>();
  heapFx: { addr: number; size: number; vt: number; color: string }[] = [];
  g: Geo = EMPTY_GEO;

  /** A collector animation is running: cuts are disabled */
  busy = false;
  phase: Phase = 'idle';
  worklist: string[] = [];
  scanning: string | null = null;
  sweepAt: number | null = null;
  private sweepSpeed = 5;
  private swept = new Set<string>();
  private sweepDone: (() => void) | null = null;
  /** Heap view: allocation scan highlight */
  scan: { addr: number; size: number; ok: boolean } | null = null;
  /** Heap view: bump pointer after compaction or copying */
  bump: number | null = null;
  /** Heap view: forwarding stubs left in from-space by the copying collector */
  ghosts: { addr: number; size: number; label: string; to: number }[] = [];
  /** Which half is from-space right now (copying) */
  fromLow = true;
  /** Stage banner, e.g. "GC · app paused" */
  banner: { text: string; tone: 'gc' | 'bad' | 'ok' } | null = null;
  /** One-line result under the stage prompt area */
  note: { text: string; tone: 'ok' | 'bad' | 'info' } | null = null;
  /** Allocator / collector log (readouts) */
  log: LogLine[] = [];
  /** C allocator free list (block addresses) */
  freeList: number[] = [];
  /** Per-pane result lines (split view) */
  paneMsg: [LogLine | null, LogLine | null] = [null, null];
  /** Reference counting applies per pane */
  rcOn: [boolean, boolean] = [false, false];
  stats = { freed: 0, updates: 0, collections: 0, lastBatch: 0, bestBatch: 0 };
  crashed = false;
  /** Leak hunt: retained megabytes after each GC */
  memSeries: number[] = [];
  /** Playground state */
  pg = {
    mode: 'rc' as 'rc' | 'mark-sweep' | 'mark-compact',
    selected: null as string | null,
    linking: false,
    size: 2,
    seq: 0,
    failedWithRoom: false,
    fixed: false,
    failSize: 0,
    leakedCycle: false,
    message: null as LogLine | null,
  };
  /** Anything the lesson wants to remember between script events */
  memo: Record<string, number | string | boolean | null> = {};

  gen: GenModel;
  threads = new ThreadsModel();

  constructor() {
    super();
    this.gen = new GenModel(this);
  }

  /* ================================================================ */
  /* Steps                                                             */
  /* ================================================================ */

  enter(cfg: GcConfig, script: ScriptEvent<GcSim>[] = [], opts: { reset?: boolean; predict?: number; seed?: number } = {}) {
    const prev = this.cfg;
    this.cfg = { ...cfg };
    const rebuild = opts.reset || prev.view !== cfg.view || prev.scene !== cfg.scene;
    if (rebuild) this.resetWorld(opts.seed ?? 7);
    else {
      this.rcOn = cfg.view === 'split' ? [true, false] : [cfg.rc, cfg.rc];
      this.gen.allocRate = cfg.allocRate;
      this.gen.generational = cfg.generational;
      this.gen.longLived = cfg.longLived;
      this.gen.paused = cfg.genPaused;
      this.threads.setMode(cfg.gcMode);
      this.threads.setLive(cfg.liveMB);
    }
    this.game = opts.predict ? new PredictGame(this, opts.predict) : null;
    this.askKind = null;
    this.runScript(script);
    this.relayout();
    this.rev++;
  }

  private resetWorld(seed: number) {
    this.clearTransient();
    this.rng = mulberry32(seed);
    this.boxes.clear();
    this.roots.clear();
    this.objs.clear();
    this.edges.clear();
    this.heapFx = [];
    this.busy = false;
    this.phase = 'idle';
    this.worklist = [];
    this.scanning = null;
    this.sweepAt = null;
    this.sweepDone = null;
    this.swept.clear();
    this.scan = null;
    this.bump = null;
    this.ghosts = [];
    this.fromLow = true;
    this.banner = null;
    this.note = null;
    this.log = [];
    this.paneMsg = [null, null];
    this.stats = { freed: 0, updates: 0, collections: 0, lastBatch: 0, bestBatch: 0 };
    this.crashed = false;
    this.memSeries = [];
    this.memo = {};
    this.freeList = [];
    this.pg = { mode: 'rc', selected: null, linking: false, size: 2, seq: 0, failedWithRoom: false, fixed: false, failSize: 0, leakedCycle: false, message: null };
    const cfg = this.cfg;
    this.rcOn = cfg.view === 'split' ? [true, false] : [cfg.rc, cfg.rc];
    this.gen.reset();
    this.gen.allocRate = cfg.allocRate;
    this.gen.generational = cfg.generational;
    this.gen.longLived = cfg.longLived;
    this.gen.paused = cfg.genPaused;
    this.gen.barrier = true;
    this.threads.reset(this.t);
    this.threads.setMode(cfg.gcMode);
    this.threads.setLive(cfg.liveMB);
    if (cfg.view === 'gen') {
      this.box('gen:roots');
      if (cfg.scene === 'barrier') this.box('gen:rs');
    }
    if (cfg.scene && SCENES[cfg.scene]) this.build(cfg.scene);
  }

  /** Build a scene's roots, objects and references. */
  build(id: string) {
    const def = SCENES[id];
    for (const r of def.roots) this.addRoot(r);
    for (const o of def.objs) this.addObj(o);
    for (const [from, to, opts] of def.refs) this.link(from, to, { weak: opts?.weak, bend: opts?.bend, silent: true });
    this.relayout();
  }

  /* ================================================================ */
  /* Model: roots, objects, edges                                      */
  /* ================================================================ */

  addRoot(r: RootDef) {
    const root: GRoot = { id: r.id, label: r.label, section: r.section, v: r.v, px: r.px ?? r.v, frame: r.frame, pane: r.pane ?? 0 };
    this.roots.set(r.id, root);
    this.box(`r:${r.id}`);
    return root;
  }

  removeRoot(id: string) {
    this.roots.delete(id);
    this.hide(`r:${id}`);
    for (const e of this.edges.values()) if (e.from === `r:${id}`) this.dropEdge(e);
  }

  addObj(o: ObjDef & { slot?: number }) {
    const obj: GObj = {
      id: o.id,
      label: o.label,
      kind: o.kind ?? 'obj',
      size: o.size,
      addr: o.addr ?? -1,
      u: o.u,
      v: o.v,
      p: o.p ?? [o.v, o.u],
      pane: o.pane ?? 0,
      sub: o.sub,
      rc: 0,
      mark: 'white',
      fate: 'live',
      pulse: -10,
      tag: null,
      gcRefs: null,
      slot: o.slot,
    };
    this.objs.set(o.id, obj);
    this.box(`o:${o.id}`);
    return obj;
  }

  obj(boxId: string) {
    return boxId.startsWith('o:') ? this.objs.get(boxId.slice(2)) : undefined;
  }

  /** Add a reference. Counts it when reference counting is on for that pane. */
  link(from: string, to: string, opts: { weak?: boolean; bend?: number; silent?: boolean } = {}) {
    const id = `${from}>${to}`;
    const existing = this.edges.get(id);
    if (existing && !existing.removing) return existing;
    const e: GEdge = {
      id,
      from,
      to,
      weak: !!opts.weak,
      dangling: false,
      bend: opts.bend ?? 0,
      removing: false,
      alpha: 0,
      talpha: 1,
      flashVt: -10,
      flashColor: SIG.warn,
    };
    this.edges.set(id, e);
    const t = this.obj(to);
    if (t && !e.weak) {
      t.rc += 1;
      if (!opts.silent) t.pulse = this.vt;
    }
    return e;
  }

  /** Remove an edge immediately (logic) and fade it out. Does not touch counts. */
  private dropEdge(e: GEdge, fadeDelay = 0) {
    if (e.removing) return;
    e.removing = true;
    if (fadeDelay > 0) this.after(fadeDelay, () => (e.talpha = 0));
    else e.talpha = 0;
  }

  /** Drop a reference without any counting semantics (a C pointer being overwritten). */
  unlink(edgeId: string) {
    const e = this.edges.get(edgeId);
    if (!e) return;
    const t = this.obj(e.to);
    if (t && !e.weak) t.rc = Math.max(0, t.rc - 1);
    this.dropEdge(e);
    this.rev++;
  }

  /** Point an existing reference somewhere else (keeps its dangling flag). */
  retarget(edgeId: string, to: string) {
    const e = this.edges.get(edgeId);
    if (!e) return;
    const dangling = e.dangling;
    this.edges.delete(edgeId);
    const n = this.link(e.from, to, { silent: true });
    n.dangling = dangling;
    n.alpha = 1;
    const old = this.obj(e.to);
    if (old && old.fate === 'ghost') this.hide(`o:${old.id}`);
    this.rev++;
  }

  /** Take an object off the stage but leave its memory allocated (nobody freed it). */
  retire(id: string) {
    this.hide(`o:${id}`);
    const bid = `o:${id}`;
    for (const e of this.liveEdges()) if (e.from === bid || e.to === bid) this.dropEdge(e);
  }

  /** Mark a reference weak: it no longer counts, and tracing ignores it. */
  setWeak(edgeId: string) {
    const e = this.edges.get(edgeId);
    if (!e || e.weak) return;
    e.weak = true;
    e.flashVt = this.vt;
    e.flashColor = SIG.hc;
    const t = this.obj(e.to);
    if (t) {
      t.rc = Math.max(0, t.rc - 1);
      t.pulse = this.vt;
      this.sayAt(`o:${t.id}`, `weak → ${t.rc}`, SIG.hc, 1.4);
    }
    this.rev++;
  }

  /** C's free(): the memory goes back to the allocator, but pointers to it survive (dangling). */
  freeManual(id: string) {
    const o = this.objs.get(id);
    if (!o || o.addr < 0) return;
    const addr = o.addr;
    this.log.push({ text: `free(${addrHex(addr)})`, kind: 'ok' });
    this.freeList.push(addr);
    this.releaseBlocks(o, SIG.heavy);
    o.fate = 'ghost';
    o.tag = { text: 'freed', color: SIG.heavy };
    for (const e of this.liveEdges()) {
      if (e.to !== `o:${id}`) continue;
      e.dangling = true;
      e.flashVt = this.vt;
      e.flashColor = SIG.err;
    }
    this.rev++;
  }

  /** The process died (double free). */
  crash() {
    this.crashed = true;
    this.banner = { text: 'process aborted', tone: 'bad' };
    for (const o of this.liveObjs()) if (o.fate === 'live') o.tag = null;
    this.fx({ kind: 'ring', at: { x: this.w / 2, y: this.h * 0.4 }, color: SIG.err, size: 3, dur: 1.2 });
    this.rev++;
  }

  /** Rebuild a scene from scratch without leaving the step. */
  resetScene(id: string) {
    this.cfg = { ...this.cfg, scene: id };
    this.resetWorld(7);
    this.relayout();
    this.rev++;
  }

  /** Allocate at the bump pointer (after compaction or copying). */
  bumpAlloc(size: number, def: { id: string; label: string; kind?: ObjKind }) {
    const at = this.bump ?? this.firstFit(size);
    if (at < 0) return;
    this.addObj({ id: def.id, label: def.label, kind: def.kind, size, u: 0, v: 0, addr: at });
    this.heapFx.push({ addr: at, size, vt: this.vt, color: SIG.res });
    this.log.push({ text: `bump: ${addrHex(at)} → ${addrHex(at + size)}`, kind: 'ok' });
    this.bump = at + size;
    this.relayout();
    this.rev++;
  }

  liveEdges() {
    return [...this.edges.values()].filter((e) => !e.removing);
  }

  outEdges(boxId: string) {
    return this.liveEdges().filter((e) => e.from === boxId);
  }

  rootEdge(rootId: string) {
    return this.liveEdges().find((e) => e.from === `r:${rootId}`);
  }

  paneOf(boxId: string) {
    if (boxId.startsWith('r:')) return this.roots.get(boxId.slice(2))?.pane ?? 0;
    return this.obj(boxId)?.pane ?? 0;
  }

  /** Objects reachable from the roots, following strong references. Maps object id to the box it was reached from. */
  reach(pane?: number): Map<string, string> {
    const seen = new Map<string, string>();
    const queue: string[] = [];
    for (const e of this.liveEdges()) {
      if (!e.from.startsWith('r:') || e.weak || e.dangling) continue;
      if (pane != null && this.paneOf(e.from) !== pane) continue;
      const t = this.obj(e.to);
      if (t && t.fate !== 'freed' && t.fate !== 'ghost' && !seen.has(t.id)) {
        seen.set(t.id, e.from);
        queue.push(t.id);
      }
    }
    while (queue.length) {
      const id = queue.shift() as string;
      for (const e of this.outEdges(`o:${id}`)) {
        if (e.weak) continue;
        const t = this.obj(e.to);
        if (t && t.fate !== 'freed' && t.fate !== 'ghost' && !seen.has(t.id)) {
          seen.set(t.id, `o:${id}`);
          queue.push(t.id);
        }
      }
    }
    return seen;
  }

  labelOf(boxId: string) {
    if (boxId.startsWith('r:')) return this.roots.get(boxId.slice(2))?.label ?? boxId;
    return this.obj(boxId)?.label ?? boxId;
  }

  /** "cache → avatar": how an object is reached from a root. */
  pathTo(id: string, reach = this.reach()): string {
    const parts: string[] = [];
    let cur: string | undefined = `o:${id}`;
    let guard = 0;
    while (cur && guard++ < 20) {
      parts.unshift(this.labelOf(cur));
      if (cur.startsWith('r:')) break;
      cur = reach.get(cur.slice(2));
    }
    return parts.join(' → ');
  }

  liveObjs(pane?: number) {
    return [...this.objs.values()].filter((o) => o.fate !== 'freed' && (pane == null || o.pane === pane));
  }

  /* ================================================================ */
  /* Heap                                                              */
  /* ================================================================ */

  /** Blocks currently occupied, by object. */
  heapObjs() {
    return [...this.objs.values()].filter((o) => o.addr >= 0);
  }

  freeBlocks() {
    const used = new Set<number>();
    for (const o of this.heapObjs()) for (let i = 0; i < o.size; i++) used.add(o.addr + i);
    const out: number[] = [];
    for (let i = 0; i < HEAP_BLOCKS; i++) if (!used.has(i)) out.push(i);
    return out;
  }

  /** Contiguous free runs in address order, optionally within [lo, hi). */
  holes(lo = 0, hi = HEAP_BLOCKS) {
    const free = new Set(this.freeBlocks());
    const out: { addr: number; size: number }[] = [];
    let i = lo;
    while (i < hi) {
      if (free.has(i)) {
        const start = i;
        while (i < hi && free.has(i)) i++;
        out.push({ addr: start, size: i - start });
      } else i++;
    }
    return out;
  }

  firstFit(size: number, lo = 0, hi = HEAP_BLOCKS) {
    return this.holes(lo, hi).find((h) => h.size >= size)?.addr ?? -1;
  }

  /** Release an object's blocks with a flash. */
  private releaseBlocks(o: GObj, color: string = SIG.err) {
    if (o.addr < 0) return;
    this.heapFx.push({ addr: o.addr, size: o.size, vt: this.vt, color });
    o.lastAddr = o.addr;
    o.addr = -1;
  }

  /* ================================================================ */
  /* Freeing and reference counting                                    */
  /* ================================================================ */

  /** Free an object: its memory goes back, its references disappear. */
  free(id: string, opts: { cascade?: boolean; color?: string } = {}) {
    const o = this.objs.get(id);
    if (!o || o.fate === 'freed') return;
    o.fate = 'freed';
    o.tag = null;
    this.stats.freed += 1;
    this.stats.lastBatch += 1;
    this.stats.bestBatch = Math.max(this.stats.bestBatch, this.stats.lastBatch);
    this.releaseBlocks(o, opts.color);
    const bid = `o:${id}`;
    const outs = this.outEdges(bid);
    for (const e of outs) {
      this.dropEdge(e, opts.cascade ? 0.5 : 0.25);
      if (opts.cascade && !e.weak) {
        const t = this.obj(e.to);
        if (t && t.fate !== 'freed') {
          this.send({
            from: bid,
            to: e.to,
            dur: 0.5,
            color: SIG.hc,
            r: 3.4,
            lane: 0,
            label: '−1',
            onArrive: () => this.rcDrop(t.id),
          });
        }
      }
    }
    for (const e of this.liveEdges()) if (e.to === bid && !e.from.startsWith('r:')) this.dropEdge(e, 0.2);
    for (const e of this.liveEdges()) if (e.to === bid && e.from.startsWith('r:')) this.dropEdge(e, 0.2);
    this.after(0.45, () => this.hide(bid));
    this.rev++;
  }

  /** A floating label above a box, nudged so it never leaves the stage. */
  sayAt(boxId: string, text: string, color: string, dur = 1.6, dy = 0) {
    const b = this.boxes.get(boxId);
    if (!b) return;
    const half = text.length * 3.3 + 10;
    const x = Math.min(Math.max(b.x, half + 6), this.w - half - 6);
    this.fx({ kind: 'text', at: { x, y: b.y - b.h / 2 - 12 + dy }, text, color, dur });
  }

  /** One reference to this object went away. Free it when the count hits zero. */
  rcDrop(id: string) {
    const o = this.objs.get(id);
    if (!o || o.fate === 'freed') return;
    o.rc = Math.max(0, o.rc - 1);
    o.pulse = this.vt;
    this.stats.updates += 1;
    const b = this.boxes.get(`o:${id}`);
    if (b) {
      const text = `−1 → ${o.rc}`;
      const half = text.length * 3.3 + 10;
      const x = Math.min(Math.max(b.x + b.w / 2 - 4, half + 6), this.w - half - 6);
      this.fx({ kind: 'text', at: { x, y: b.y - b.h / 2 - 10 }, text, color: o.rc === 0 ? SIG.err : SIG.hc, dur: 1.2 });
    }
    if (o.rc === 0) {
      o.tag = { text: 'count 0', color: SIG.err };
      this.after(0.4, () => this.free(id, { cascade: true }));
    }
    this.rev++;
  }

  /* ================================================================ */
  /* Cutting references                                                */
  /* ================================================================ */

  /** Cut an edge. Returns the objects that just became unreachable. */
  cut(edgeId: string): string[] {
    const e = this.edges.get(edgeId);
    if (!e || e.removing) return [];
    const pane = this.paneOf(e.from);
    const before = this.reach(pane);
    this.dropEdge(e);
    const c = this.curveOf(e);
    if (c) {
      const mid = bezierMid(c);
      this.fx({ kind: 'x', at: mid, color: SIG.warn, size: 1.1 });
    }
    this.stats.lastBatch = 0;
    const t = this.obj(e.to);
    if (t && !e.weak && this.rcOn[pane]) this.rcDrop(t.id);
    else if (t) t.rc = Math.max(0, t.rc - (e.weak ? 0 : 1));
    const after = this.reach(pane);
    this.rev++;
    return [...before.keys()].filter((k) => !after.has(k) && this.objs.get(k)?.fate === 'live');
  }

  edgeClickable(e: GEdge) {
    if (e.removing || e.dangling || this.crashed) return false;
    if (this.game?.pending) return this.askKind === 'edge';
    if (this.busy) return false;
    if (this.cfg.cut === 'off') return false;
    if (this.cfg.scene === 'pg') return true;
    return true;
  }

  objClickable(o: GObj) {
    if (o.fate === 'freed') return false;
    if (this.game?.pending) return this.askKind === 'obj' || this.askKind === 'mixed';
    return this.cfg.scene === 'pg' && !this.busy;
  }

  /** Learner clicked an arrow on the stage. */
  clickEdge(id: string) {
    const e = this.edges.get(id);
    if (!e || !this.edgeClickable(e)) return;
    if (this.game?.pending) {
      if (this.askKind === 'edge') this.game.answer(id);
      return;
    }
    if (this.cfg.scene === 'pg') {
      this.pgCut(id);
      return;
    }
    const lost = this.cut(id);
    if (this.cfg.cut === 'predict') this.afterPredictCut(lost, e);
  }

  /** Learner clicked an object on the stage. */
  clickObj(id: string) {
    const o = this.objs.get(id);
    if (!o || !this.objClickable(o)) return;
    if (this.game?.pending) {
      this.game.answer(id);
      return;
    }
    if (this.cfg.scene === 'pg') this.pgClickObj(id);
  }

  clickRoot(id: string) {
    if (this.cfg.scene !== 'pg' || this.busy || this.game?.pending) return;
    this.pg.selected = `r:${id}`;
    this.pg.linking = false;
    this.rev++;
  }

  /** Freeze and ask a question. */
  ask(kind: AskKind, q: Question) {
    if (!this.game) return false;
    const ok = this.game.ask(q);
    if (ok) this.askKind = kind;
    return ok;
  }

  /* ---------- Chapter 2: cut, predict, reveal ---------- */

  private afterPredictCut(lost: string[], e: GEdge) {
    const game = this.game;
    this.busy = true;
    const reveal = () => this.revealGarbage(lost);
    if (!game || game.done) {
      this.after(0.3, reveal);
      return;
    }
    const reach = this.reach();
    const names = (ids: string[]) => ids.map((i) => this.objs.get(i)?.label ?? i).join(' and ');
    const target = this.obj(e.to);
    this.after(0.35, () => {
      this.ask('mixed', {
        acceptable: lost.length ? lost : ['none'],
        choices: [{ id: 'none', label: 'Nothing, all still reachable' }],
        ask: 'Click an object that just became garbage',
        explain: (picked, ok) => {
          if (!lost.length) {
            const via = target ? this.pathTo(target.id, reach) : '';
            return ok ? `Every object still has a path from a root${via ? `: ${via}` : ''}.` : `Nothing lost its last path. ${target?.label ?? 'It'} is still reachable: ${via}.`;
          }
          const lostTxt = `${names(lost)} ${lost.length > 1 ? 'have' : 'has'} no path from any root now`;
          if (ok) {
            const survivor = target && !lost.includes(target.id) ? ` ${target.label} survives: ${this.pathTo(target.id, reach)}.` : '';
            return `${lostTxt}.${survivor}`;
          }
          if (picked === 'none') return `${lostTxt}, so ${lost.length > 1 ? 'they are' : 'it is'} garbage.`;
          const p = this.objs.get(picked);
          return `${p?.label ?? picked} is still reachable: ${this.pathTo(picked, reach)}. The garbage is ${names(lost)}.`;
        },
        resolve: () => this.after(0.2, reveal),
      });
    });
  }

  /** Trace from the roots, paint the garbage red, then free it. */
  revealGarbage(ids: string[], onDone?: () => void) {
    this.busy = true;
    this.wave({
      step: 0.42,
      onDone: () => {
        for (const id of ids) {
          const o = this.objs.get(id);
          if (o && o.fate === 'live') {
            o.fate = 'garbage';
            o.tag = { text: 'garbage', color: SIG.err };
          }
        }
        this.rev++;
        this.after(ids.length ? 1.3 : 0.4, () => {
          this.stats.lastBatch = 0;
          for (const id of ids) this.free(id);
          this.after(0.6, () => {
            this.clearMarks();
            this.busy = false;
            this.rev++;
            onDone?.();
          });
        });
      },
    });
  }

  clearMarks(pane?: number) {
    for (const o of this.liveObjs(pane)) {
      o.mark = 'white';
      if (o.tag?.text === 'reachable' || o.tag?.text === 'marked') o.tag = null;
    }
  }

  /* ================================================================ */
  /* Tracing                                                           */
  /* ================================================================ */

  /** Breadth-first wave from the roots: flights along every reference, objects light up as they're reached. */
  wave(opts: { pane?: number; step?: number; onDone?: (reached: Set<string>) => void } = {}) {
    const step = opts.step ?? 0.6;
    const pane = opts.pane;
    this.clearMarks(pane);
    const reached = new Set<string>();
    const level: string[] = [];
    for (const e of this.liveEdges()) {
      if (!e.from.startsWith('r:') || e.weak || e.dangling) continue;
      if (pane != null && this.paneOf(e.from) !== pane) continue;
      const t = this.obj(e.to);
      if (!t || t.fate === 'freed') continue;
      this.send({ from: e.from, to: e.to, dur: step * 0.85, color: SIG.res, r: 3.4, lane: 0 });
      if (!reached.has(t.id)) {
        reached.add(t.id);
        level.push(t.id);
      }
    }
    const advance = (ids: string[]) => {
      this.after(step * 0.85, () => {
        for (const id of ids) {
          const o = this.objs.get(id);
          if (o && o.fate !== 'freed') o.mark = 'black';
        }
        this.rev++;
      });
      this.after(step, () => {
        const next: string[] = [];
        for (const id of ids) {
          for (const e of this.outEdges(`o:${id}`)) {
            if (e.weak) continue;
            const t = this.obj(e.to);
            if (!t || t.fate === 'freed') continue;
            this.send({ from: e.from, to: e.to, dur: step * 0.85, color: SIG.res, r: 3.4, lane: 0 });
            if (!reached.has(t.id)) {
              reached.add(t.id);
              next.push(t.id);
            }
          }
        }
        if (!next.length) {
          this.after(step * 0.85, () => opts.onDone?.(reached));
          return;
        }
        advance(next);
      });
    };
    if (!level.length) {
      this.after(0.2, () => opts.onDone?.(reached));
      return;
    }
    advance(level);
  }

  /** Mark with an explicit worklist, one object at a time (depth first), the way real markers do. */
  markWorklist(opts: { step?: number; pane?: number; onDone?: () => void } = {}) {
    const step = opts.step ?? 0.75;
    const pane = opts.pane;
    this.phase = 'mark';
    this.busy = true;
    this.clearMarks(pane);
    this.worklist = [];
    this.scanning = null;
    for (const r of this.roots.values()) {
      if (pane != null && r.pane !== pane) continue;
      const e = this.rootEdge(r.id);
      if (!e || e.weak) continue;
      const t = this.obj(e.to);
      if (!t || t.fate === 'freed') continue;
      this.send({ from: e.from, to: e.to, dur: step * 0.6, color: SIG.res, r: 3.4, lane: 0 });
      if (t.mark === 'white') {
        this.after(step * 0.6, () => {
          if (t.mark === 'white') {
            t.mark = 'gray';
            this.worklist.push(t.id);
            this.rev++;
          }
        });
      }
    }
    const scanNext = () => {
      const id = this.worklist.pop();
      if (!id) {
        this.scanning = null;
        this.phase = 'idle';
        this.rev++;
        opts.onDone?.();
        return;
      }
      const o = this.objs.get(id);
      if (!o) {
        scanNext();
        return;
      }
      this.scanning = id;
      o.mark = 'black';
      this.stats.updates += 1;
      for (const e of this.outEdges(`o:${id}`)) {
        if (e.weak) continue;
        const t = this.obj(e.to);
        if (!t || t.fate === 'freed') continue;
        this.send({ from: e.from, to: e.to, dur: step * 0.6, color: SIG.res, r: 3.4, lane: 0 });
        this.after(step * 0.6, () => {
          if (t.mark === 'white') {
            t.mark = 'gray';
            this.worklist.push(t.id);
          }
          this.rev++;
        });
      }
      this.rev++;
      this.after(step, scanNext);
    };
    this.after(step * 0.9, scanNext);
  }

  /** Walk the heap in address order: unmarked objects are freed, marked ones get their bit cleared. */
  sweep(opts: { speed?: number; onDone?: () => void; pane?: number } = {}) {
    this.phase = 'sweep';
    this.busy = true;
    this.sweepAt = 0;
    this.sweepSpeed = opts.speed ?? 5;
    this.swept.clear();
    this.stats.lastBatch = 0;
    this.sweepDone = opts.onDone ?? null;
  }

  private stepSweep(dt: number) {
    if (this.sweepAt == null) return;
    this.sweepAt += dt * this.sweepSpeed;
    for (const o of this.heapObjs()) {
      if (this.swept.has(o.id) || o.addr > this.sweepAt) continue;
      this.swept.add(o.id);
      if (o.mark === 'black') {
        o.mark = 'white';
        this.heapFx.push({ addr: o.addr, size: o.size, vt: this.vt, color: SIG.res });
      } else if (o.fate !== 'freed') {
        this.free(o.id);
      }
    }
    if (this.sweepAt >= HEAP_BLOCKS) {
      this.sweepAt = null;
      this.phase = 'idle';
      const done = this.sweepDone;
      this.sweepDone = null;
      this.rev++;
      done?.();
    }
  }

  /** Paint unmarked objects as garbage (after marking, before sweeping). */
  flagUnmarked(pane?: number, text = 'unmarked') {
    for (const o of this.liveObjs(pane)) {
      if (o.mark !== 'black' && o.fate === 'live') {
        o.fate = 'garbage';
        o.tag = { text, color: SIG.err };
      }
    }
    this.rev++;
  }

  /* ================================================================ */
  /* Heap view: first-fit scan, compaction, copying                    */
  /* ================================================================ */

  /** Walk the holes in address order looking for one that fits, then allocate there (or fail). */
  scanAlloc(size: number, def: { id: string; label: string; kind?: ObjKind }, onDone?: (ok: boolean) => void) {
    this.phase = 'alloc';
    this.busy = true;
    const holes = this.holes();
    let i = 0;
    const next = () => {
      const h = holes[i++];
      if (!h) {
        this.scan = null;
        this.phase = 'idle';
        this.busy = false;
        const free = this.freeBlocks().length;
        this.note = { text: `No hole of ${size} blocks. ${free} blocks are free, but not in one piece.`, tone: 'bad' };
        this.log.push({ text: `malloc(${size * BLOCK_BYTES}) → NULL`, kind: 'bad' });
        this.fx({ kind: 'text', at: this.stripCenter(), text: 'allocation failed', color: SIG.err, dur: 2 });
        this.rev++;
        onDone?.(false);
        return;
      }
      this.scan = { addr: h.addr, size: h.size, ok: h.size >= size };
      this.rev++;
      this.after(0.55, () => {
        if (h.size >= size) {
          this.scan = null;
          const o = this.addObj({ id: def.id, label: def.label, kind: def.kind, size, u: 0, v: 0, addr: h.addr });
          this.heapFx.push({ addr: h.addr, size, vt: this.vt, color: SIG.res });
          this.note = { text: `Fits in the ${h.size}-block hole at ${addrHex(h.addr)}.`, tone: 'ok' };
          this.log.push({ text: `malloc(${size * BLOCK_BYTES}) → ${addrHex(h.addr)}`, kind: 'ok' });
          this.phase = 'idle';
          this.busy = false;
          this.relayout();
          this.rev++;
          void o;
          onDone?.(true);
          return;
        }
        next();
      });
    };
    next();
  }

  stripCenter(): Pt {
    const s = this.g.strip;
    if (!s) return { x: this.w / 2, y: this.h / 2 };
    return { x: s.x + (s.cols * s.cw) / 2, y: s.y - 14 };
  }

  /** Mark-compact: mark, flag garbage, slide live objects to the start of the heap, fix every pointer. */
  markCompact(onDone?: () => void) {
    this.phase = 'mark';
    this.busy = true;
    this.banner = { text: 'mark-compact · app paused', tone: 'gc' };
    this.log = [];
    this.wave({
      step: 0.45,
      onDone: () => {
        this.flagUnmarked(undefined, 'garbage');
        this.after(0.8, () => {
          this.phase = 'compact';
          const garbage = this.heapObjs().filter((o) => o.fate === 'garbage');
          for (const o of garbage) this.free(o.id);
          const live = this.heapObjs()
            .filter((o) => o.fate !== 'freed')
            .sort((a, b) => a.addr - b.addr);
          let top = 0;
          this.log = [];
          for (const o of live) {
            if (o.addr !== top) this.log.push({ text: `${o.label.padEnd(5)} ${addrHex(o.addr)} → ${addrHex(top)}`, kind: 'hot' });
            o.addr = top;
            top += o.size;
          }
          this.rev++;
          this.after(0.5, () => {
            this.relayout();
            this.after(1.1, () => {
              for (const e of this.liveEdges()) {
                e.flashVt = this.vt;
                e.flashColor = SIG.warn;
              }
              this.bump = top;
              this.clearMarks();
              this.note = { text: `Every pointer now uses the new address. Free space: one ${HEAP_BLOCKS - top}-block run.`, tone: 'ok' };
              this.banner = null;
              this.phase = 'idle';
              this.busy = false;
              this.rev++;
              onDone?.();
            });
          });
        });
      },
    });
  }

  /** Cheney-style copying: evacuate reachable objects to to-space in breadth-first order, then drop from-space whole. */
  copyCollect(onDone?: () => void) {
    this.phase = 'copy';
    this.busy = true;
    this.banner = { text: 'copying collection · app paused', tone: 'gc' };
    const toBase = this.fromLow ? 12 : 0;
    let free = toBase;
    const order: string[] = [];
    const copied = new Set<string>();
    this.log = [];
    this.bump = free;
    const copyObj = (id: string, via: string) => {
      if (copied.has(id)) {
        this.log.push({ text: `${this.labelOf(via)} → ${this.objs.get(id)?.label}: already copied, use forwarding address`, kind: 'dim' });
        return false;
      }
      const o = this.objs.get(id);
      if (!o || o.addr < 0) return false;
      copied.add(id);
      order.push(id);
      this.ghosts.push({ addr: o.addr, size: o.size, label: o.label, to: free });
      this.log.push({ text: `copy ${o.label.padEnd(4)} ${addrHex(o.addr)} → ${addrHex(free)}`, kind: 'hot' });
      o.addr = free;
      o.mark = 'black';
      free += o.size;
      this.bump = free;
      this.relayout();
      this.rev++;
      return true;
    };
    // Roots first.
    const rootTargets: [string, string][] = [];
    for (const r of this.roots.values()) {
      const e = this.rootEdge(r.id);
      const t = e && this.obj(e.to);
      if (e && t) rootTargets.push([t.id, e.from]);
    }
    const stepDur = 0.8;
    let t = 0.4;
    for (const [id, via] of rootTargets) {
      this.after(t, () => copyObj(id, via));
      t += stepDur;
    }
    // Then scan to-space objects in order, copying their children.
    let scanIdx = 0;
    const scanNext = () => {
      const id = order[scanIdx++];
      if (!id) {
        this.after(0.5, finish);
        return;
      }
      const edges = this.outEdges(`o:${id}`);
      let d = 0;
      for (const e of edges) {
        const child = this.obj(e.to);
        if (!child) continue;
        this.after(d, () => {
          e.flashVt = this.vt;
          copyObj(child.id, e.from);
        });
        d += stepDur;
      }
      this.after(Math.max(0.35, d), scanNext);
    };
    const finish = () => {
      const dead = this.heapObjs().filter((o) => !copied.has(o.id));
      this.stats.lastBatch = 0;
      for (const o of dead) this.free(o.id);
      this.ghosts = [];
      this.fromLow = !this.fromLow;
      this.memo.copied = true;
      this.clearMarks();
      this.banner = null;
      this.note = { text: `Copied ${copied.size} survivors. The ${dead.length} dead objects were never touched: their half is free in one go.`, tone: 'ok' };
      this.phase = 'idle';
      this.busy = false;
      this.rev++;
      onDone?.();
    };
    this.after(t + 0.2, scanNext);
  }

  /* ================================================================ */
  /* Playground                                                        */
  /* ================================================================ */

  static PG_SLOTS: { u: number; v: number; p: [number, number] }[] = (() => {
    const out: { u: number; v: number; p: [number, number] }[] = [];
    const us = [0, 0.45, 0.9];
    const vs = [0, 0.33, 0.66, 1];
    const pxs = [0, 0.33, 0.67, 1];
    const pys = [0, 0.5, 1];
    for (let li = 0; li < 4; li++) for (let di = 0; di < 3; di++) out.push({ u: us[di], v: vs[li], p: [pxs[li], pys[di]] });
    return out;
  })();

  setPgMode(mode: 'rc' | 'mark-sweep' | 'mark-compact') {
    if (this.busy) return;
    this.pg.mode = mode;
    this.rcOn = [mode === 'rc', false];
    // Recount from scratch so badges are right when switching into counting.
    for (const o of this.liveObjs()) o.rc = 0;
    for (const e of this.liveEdges()) {
      const t = this.obj(e.to);
      if (t && !e.weak) t.rc += 1;
    }
    this.pg.message = null;
    this.rev++;
  }

  setPgSize(n: number) {
    this.pg.size = n;
    this.rev++;
  }

  toggleLink() {
    if (!this.pg.selected || this.busy) return;
    this.pg.linking = !this.pg.linking;
    this.rev++;
  }

  /** A free grid slot, preferring the one just to the right of (or below) the parent. */
  private pgSlotFree(parent: string | null): number {
    const taken = new Set(this.liveObjs().map((o) => o.slot));
    let pl = 0;
    let pd = -1;
    if (parent?.startsWith('r:')) {
      const r = this.roots.get(parent.slice(2));
      pl = r ? Math.round(r.v * 3) : 0;
    } else if (parent) {
      const o = this.obj(parent);
      if (o?.slot != null) {
        pl = Math.floor(o.slot / 3);
        pd = o.slot % 3;
      }
    }
    let best = -1;
    let bestScore = Infinity;
    for (let s = 0; s < 12; s++) {
      if (taken.has(s)) continue;
      const li = Math.floor(s / 3);
      const di = s % 3;
      const score = Math.abs(li - pl) * 3 + (di > pd ? di - pd - 1 : 4 + (pd - di));
      if (score < bestScore) {
        bestScore = score;
        best = s;
      }
    }
    return best;
  }

  pgClickObj(id: string) {
    const bid = `o:${id}`;
    if (this.pg.linking && this.pg.selected && this.pg.selected !== bid) {
      const from = this.pg.selected;
      if (from.startsWith('r:')) {
        const old = this.rootEdge(from.slice(2));
        if (old) {
          const t = this.obj(old.to);
          this.dropEdge(old);
          if (t && this.rcOn[0]) this.rcDrop(t.id);
          else if (t) t.rc = Math.max(0, t.rc - 1);
        }
      }
      this.link(from, bid);
      this.pg.linking = false;
      this.pg.message = { text: `${this.labelOf(from)} now points at ${this.labelOf(bid)}.`, kind: 'ok' };
      this.checkPgLeak();
      this.rev++;
      return;
    }
    this.pg.selected = this.pg.selected === bid ? null : bid;
    this.pg.linking = false;
    this.rev++;
  }

  pgCut(edgeId: string) {
    this.stats.lastBatch = 0;
    this.cut(edgeId);
    this.pg.message = null;
    this.after(2.2, () => this.checkPgLeak());
    this.rev++;
  }

  private checkPgLeak() {
    if (this.pg.mode !== 'rc') return;
    const reach = this.reach();
    const stranded = this.liveObjs().filter((o) => !reach.has(o.id) && o.fate === 'live');
    if (stranded.length >= 2) {
      this.pg.leakedCycle = true;
      for (const o of stranded) o.tag = { text: 'leaked', color: SIG.err };
      this.pg.message = { text: `${stranded.length} objects are unreachable, but their counts never hit 0: a leak.`, kind: 'bad' };
      this.rev++;
    }
  }

  pgNew() {
    if (this.busy) return;
    const size = this.pg.size;
    const from = this.pg.selected ?? this.pgDefaultParent();
    const slot = this.pgSlotFree(from);
    if (slot < 0) {
      this.pg.message = { text: 'The stage is full. Cut something and collect first.', kind: 'bad' };
      this.rev++;
      return;
    }
    const addr = this.firstFit(size);
    if (addr < 0) {
      const free = this.freeBlocks().length;
      if (free >= size) {
        this.pg.failedWithRoom = true;
        this.pg.failSize = size;
      }
      this.pg.message = {
        text: free >= size ? `Out of memory: ${free} blocks are free, but no hole is ${size} long. Try mark-compact.` : `Out of memory: only ${free} blocks free. Collect garbage first.`,
        kind: 'bad',
      };
      this.fx({ kind: 'text', at: this.stripCenter(), text: `no room for ${size * BLOCK_BYTES} B`, color: SIG.err, dur: 1.8 });
      this.rev++;
      return;
    }
    const n = ++this.pg.seq;
    const s = GcSim.PG_SLOTS[slot];
    const names = ['obj', 'node', 'item', 'buf', 'data', 'temp', 'row', 'map'];
    const label = `${names[(n - 1) % names.length]}${n}`;
    const id = `new${n}`;
    this.addObj({ id, label, kind: size >= 3 ? 'arr' : 'obj', size, u: s.u, v: s.v, p: s.p, addr, slot });
    this.heapFx.push({ addr, size, vt: this.vt, color: SIG.res });
    if (from) {
      if (from.startsWith('r:')) {
        const old = this.rootEdge(from.slice(2));
        if (old) {
          const t = this.obj(old.to);
          this.dropEdge(old);
          if (t && this.rcOn[0]) this.rcDrop(t.id);
          else if (t) t.rc = Math.max(0, t.rc - 1);
        }
      }
      this.link(from, `o:${id}`);
    }
    this.pg.message = { text: `new ${label}: ${size} blocks at ${addrHex(addr)}${from ? `, referenced by ${this.labelOf(from)}` : ''}.`, kind: 'ok' };
    this.relayout();
    this.rev++;
  }

  private pgDefaultParent(): string | null {
    for (const r of this.roots.values()) if (!this.rootEdge(r.id)) return `r:${r.id}`;
    return 'r:c';
  }

  /** Run the playground's tracing collector. */
  pgCollect() {
    if (this.busy || this.pg.mode === 'rc') return;
    this.stats.lastBatch = 0;
    this.pg.message = null;
    this.banner = { text: `${this.pg.mode} · app paused`, tone: 'gc' };
    this.busy = true;
    this.wave({
      step: 0.4,
      onDone: () => {
        this.flagUnmarked(undefined, 'garbage');
        this.after(0.9, () => {
          const garbage = this.liveObjs().filter((o) => o.fate === 'garbage');
          for (const o of garbage) this.free(o.id);
          const n = garbage.length;
          const finish = () => {
            this.clearMarks();
            this.banner = null;
            this.busy = false;
            this.stats.collections += 1;
            const moved = this.pg.mode === 'mark-compact' ? (n ? ' The survivors slid together.' : ' Live objects still slid together.') : '';
            this.pg.message = { text: `${n ? `Freed ${n} object${n > 1 ? 's' : ''}.` : 'Nothing to free: every object is reachable.'}${moved}`, kind: n ? 'ok' : 'dim' };
            this.rev++;
          };
          if (this.pg.mode === 'mark-compact') {
            this.after(0.5, () => {
              const live = this.heapObjs()
                .filter((o) => o.fate !== 'freed')
                .sort((a, b) => a.addr - b.addr);
              let top = 0;
              for (const o of live) {
                if (o.addr !== top) this.heapFx.push({ addr: top, size: o.size, vt: this.vt, color: SIG.warn });
                o.addr = top;
                top += o.size;
              }
              if (this.pg.failedWithRoom && HEAP_BLOCKS - top >= this.pg.failSize) this.pg.fixed = true;
              this.after(0.6, finish);
            });
          } else this.after(0.4, finish);
        });
      },
    });
  }

  resetPg() {
    const cfg = this.cfg;
    const mode = this.pg.mode;
    const done = { failedWithRoom: this.pg.failedWithRoom, failSize: this.pg.failSize, fixed: this.pg.fixed, leakedCycle: this.pg.leakedCycle, best: this.stats.bestBatch };
    this.resetWorld(7);
    this.cfg = cfg;
    this.pg.failedWithRoom = done.failedWithRoom;
    this.pg.failSize = done.failSize;
    this.pg.fixed = done.fixed;
    this.pg.leakedCycle = done.leakedCycle;
    this.stats.bestBatch = done.best;
    this.setPgMode(mode);
    this.relayout();
  }

  /* ================================================================ */
  /* Generational world and pause timeline controls                   */
  /* ================================================================ */

  setAllocRate(v: number) {
    this.cfg = { ...this.cfg, allocRate: v };
    this.gen.allocRate = v;
    this.rev++;
  }

  /** Switching generations on or off starts the heap over. */
  setGenerational(on: boolean) {
    if (this.cfg.generational === on) return;
    this.cfg = { ...this.cfg, generational: on };
    this.clearTransient();
    this.gen.reset();
    this.gen.generational = on;
    this.boxes.delete('gen:rs');
    this.relayout();
    this.rev++;
  }

  setGcMode(mode: GcConfig['gcMode']) {
    this.cfg = { ...this.cfg, gcMode: mode };
    this.threads.setMode(mode);
    this.rev++;
  }

  setLiveMB(mb: number) {
    this.cfg = { ...this.cfg, liveMB: mb };
    this.threads.setLive(mb);
    this.rev++;
  }

  /* ================================================================ */
  /* Layout                                                            */
  /* ================================================================ */

  heapVisible() {
    const h = this.cfg.heap;
    return h === 'on' || (h === 'land' && this.orient === 'landscape');
  }

  /** Extra room reserved on the right of the graph (e.g. for a chart). */
  sideW() {
    if (this.orient !== 'landscape') return 0;
    if (this.cfg.scene === 'leak') return 250;
    return this.cfg.ro && this.cfg.view === 'graph' ? 284 : 0;
  }

  protected layout() {
    const v = this.cfg.view;
    if (v === 'graph' || v === 'split') this.layoutGraph();
    else if (v === 'heap') this.layoutHeap();
    else if (v === 'gen') this.layoutGen();
    else this.layoutThreads();
  }

  private layoutGraph() {
    const W = this.w;
    const H = this.h;
    const land = this.orient === 'landscape';
    const split = this.cfg.view === 'split';
    const heapOn = this.heapVisible() && !split;
    const g: Geo = { ...EMPTY_GEO, land, regions: [], panes: [], zones: {}, frames: {} };
    if (land) {
      g.rootW = split ? 96 : this.compact ? 110 : 122;
      g.rootH = 28;
      g.objW = split ? 86 : this.compact || (this.cfg.ro && this.cfg.view === 'graph') ? 86 : 94;
      g.objH = 36;
    } else {
      g.rootH = 26;
      g.objW = 66;
      g.objH = 30;
      g.rootW = 76;
    }
    const panes = split ? [0, 1] : [0];
    for (const pane of panes) {
      let frame: Rect;
      if (!split) frame = { x: 0, y: 0, w: W, h: H };
      else if (land) {
        const pw = (W - 40 - 18) / 2;
        const ph = Math.min(H - 250, 430);
        frame = { x: 20 + pane * (pw + 18), y: Math.max(84, (H - 150 - ph) / 2 + 30), w: pw, h: ph };
      } else {
        const ph = 196;
        frame = { x: 10, y: 74 + pane * (ph + 10), w: W - 20, h: ph };
      }
      g.panes.push(frame);
      const nRoots = [...this.roots.values()].filter((r) => r.pane === pane).length || 1;
      if (land) {
        const rootX = frame.x + (split ? 20 : 30) + g.rootW / 2;
        const x0 = rootX + g.rootW / 2 + (split ? 52 : 70) + g.objW / 2;
        const x1 = frame.x + frame.w - (split ? 26 : 56) - g.objW / 2 - this.sideW();
        const y0 = split ? frame.y + 112 : 128;
        const y1 = split ? frame.y + frame.h - 96 : heapOn ? H - 284 : H - 196;
        g.regions.push({ x: x0, y: y0, w: Math.max(40, x1 - x0), h: Math.max(40, y1 - y0) });
        for (const r of this.roots.values()) {
          if (r.pane !== pane) continue;
          this.place(`r:${r.id}`, rootX, y0 + r.v * (y1 - y0), g.rootW, g.rootH);
        }
      } else {
        const x0 = frame.x + 16 + g.objW / 2 + 4;
        const x1 = frame.x + frame.w - 20 - g.objW / 2;
        // As wide as the gaps between neighbouring roots allow.
        const pxs = [...this.roots.values()].filter((r) => r.pane === pane).map((r) => r.px).sort((a, b) => a - b);
        let gap = Infinity;
        for (let i = 1; i < pxs.length; i++) gap = Math.min(gap, (pxs[i] - pxs[i - 1]) * (x1 - x0));
        g.rootW = Math.min(split ? 96 : 104, gap - 10, (W - 28 - (nRoots - 1) * 10) / nRoots);
        const rootY = split ? frame.y + 60 : 108;
        const stripY = H - (this.cfg.ro ? 250 : 192);
        const y0 = split ? frame.y + 120 : rootY + 68;
        const y1 = split ? frame.y + 120 : heapOn ? stripY - 66 : H - (this.cfg.ro ? 250 : 166);
        g.regions.push({ x: x0, y: y0, w: Math.max(40, x1 - x0), h: Math.max(0, y1 - y0) });
        for (const r of this.roots.values()) {
          if (r.pane !== pane) continue;
          const x = Math.min(Math.max(x0 + r.px * (x1 - x0), frame.x + 14 + g.rootW / 2), frame.x + frame.w - 14 - g.rootW / 2);
          this.place(`r:${r.id}`, x, rootY, g.rootW, g.rootH);
        }
      }
    }
    for (const o of this.objs.values()) {
      const bid = `o:${o.id}`;
      if (!this.boxes.has(bid)) continue;
      const reg = g.regions[o.pane] ?? g.regions[0];
      if (land) this.place(bid, reg.x + o.u * reg.w, reg.y + o.v * reg.h, g.objW, g.objH);
      else this.place(bid, reg.x + o.p[0] * reg.w, reg.y + o.p[1] * reg.h, g.objW, g.objH);
    }
    if (heapOn) {
      if (land) {
        const cw = (W - 80) / HEAP_BLOCKS;
        g.strip = { x: 40, y: H - 206, cols: HEAP_BLOCKS, rows: 1, cw, ch: 34, rowGap: 0, n: HEAP_BLOCKS };
      } else {
        const cols = 12;
        const cw = (W - 28) / cols;
        g.strip = { x: 14, y: H - (this.cfg.ro ? 250 : 192), cols, rows: 2, cw, ch: 22, rowGap: 6, n: HEAP_BLOCKS };
      }
    }
    if (this.cfg.scene === 'leak') {
      g.chart = land ? { x: W - 270, y: 92, w: 240, h: 150 } : null;
    }
    this.g = g;
  }

  /** Heap view: objects are drawn as blocks at their addresses, roots in a row above (or between rows when copying). */
  private layoutHeap() {
    const W = this.w;
    const H = this.h;
    const land = this.orient === 'landscape';
    const copy = this.cfg.play === 'copy';
    const g: Geo = { ...EMPTY_GEO, land, regions: [], panes: [], zones: {}, frames: {}, copyRows: copy };
    g.rootW = land ? 64 : 50;
    g.rootH = land ? 28 : 24;
    let s: Strip;
    let rootY: number;
    if (copy) {
      const cols = 12;
      const cw = land ? Math.min(62, (W - 140) / cols) : (W - 28) / cols;
      const ch = land ? 46 : 32;
      const top = land ? 150 : 132;
      const gap = land ? 170 : 164;
      s = { x: (W - cols * cw) / 2, y: top, cols, rows: 2, cw, ch, rowGap: gap, n: HEAP_BLOCKS };
      rootY = top + ch + gap / 2;
    } else if (land) {
      const cw = Math.min(36, (W - 90) / HEAP_BLOCKS);
      const ch = 50;
      s = { x: (W - HEAP_BLOCKS * cw) / 2, y: Math.round(H * 0.42), cols: HEAP_BLOCKS, rows: 1, cw, ch, rowGap: 0, n: HEAP_BLOCKS };
      rootY = s.y - 150;
    } else {
      const cols = 12;
      const cw = (W - 28) / cols;
      const ch = 34;
      s = { x: 14, y: 196, cols, rows: 2, cw, ch, rowGap: 72, n: HEAP_BLOCKS };
      rootY = 112;
    }
    g.strip = s;
    const sw = s.cols * s.cw;
    for (const r of this.roots.values()) this.place(`r:${r.id}`, s.x + r.px * sw + g.rootW / 2, rootY, g.rootW, g.rootH);
    for (const o of this.objs.values()) {
      const bid = `o:${o.id}`;
      if (!this.boxes.has(bid) || o.addr < 0) continue;
      const rect = this.blockRect(o.addr, o.size, s);
      this.place(bid, rect.x + rect.w / 2, rect.y + rect.h / 2, rect.w, rect.h);
    }
    this.g = g;
  }

  /** Pixel rectangle of a run of blocks (assumes it doesn't wrap). */
  blockRect(addr: number, size: number, s: Strip | null = this.g.strip): Rect {
    if (!s) return { x: 0, y: 0, w: 0, h: 0 };
    const row = Math.floor(addr / s.cols);
    const col = addr % s.cols;
    return { x: s.x + col * s.cw + 1.5, y: s.y + row * (s.ch + s.rowGap), w: size * s.cw - 3, h: s.ch };
  }

  private layoutGen() {
    const W = this.w;
    const H = this.h;
    const land = this.orient === 'landscape';
    const g: Geo = { ...EMPTY_GEO, land, regions: [], panes: [], zones: {}, frames: {} };
    const gen = this.cfg.generational;
    const pitch = land ? 40 : 25;
    const cell = land ? 34 : 21;
    const pad = land ? 16 : 8;
    const head = land ? 46 : 32;
    const zone = (x: number, y: number, z: Zone): ZoneGeo => ({ x, y, cols: ZONE_COLS[z], rows: Math.ceil(ZONE_CELLS[z] / ZONE_COLS[z]), pitch, cell });
    const rowsW = (z: Zone) => ZONE_COLS[z] * pitch - (pitch - cell);
    const rowsH = (z: Zone) => Math.ceil(ZONE_CELLS[z] / ZONE_COLS[z]) * pitch - (pitch - cell);
    const rs = this.boxes.has('gen:rs');
    const top = land ? 104 : 136;
    if (gen) {
      const survGap = land ? 40 : 26;
      const youngW = rowsW('eden') + pad * 2;
      const oldW = rowsW('old') + pad * 2;
      const youngH = head + rowsH('eden') + survGap + rowsH('surv') + pad;
      const oldH = head + rowsH('old') + pad;
      const zonesH = Math.max(youngH, oldH);
      const between = land ? 92 : Math.max(10, W - 28 - youngW - oldW);
      const rootsW = land ? 150 : 0;
      const total = rootsW + youngW + between + oldW;
      const left = land ? Math.max(20, (W - total) / 2) : (W - (youngW + between + oldW)) / 2;
      const yx = left + rootsW;
      g.frames.young = { x: yx, y: top, w: youngW, h: zonesH };
      g.frames.old = { x: yx + youngW + between, y: top, w: oldW, h: zonesH };
      g.zones.eden = zone(yx + pad, top + head, 'eden');
      g.zones.surv = zone(yx + pad, top + head + rowsH('eden') + survGap, 'surv');
      g.zones.old = zone(g.frames.old.x + pad, top + head, 'old');
      if (land) {
        this.place('gen:roots', left + 62, top + zonesH * (rs ? 0.3 : 0.45), 120, 42);
        if (rs) this.place('gen:rs', left + 62, top + zonesH * 0.74, 120, 42);
      } else {
        this.place('gen:roots', rs ? W * 0.27 : W * 0.5, 102, 110, 28);
        if (rs) this.place('gen:rs', W * 0.72, 102, 140, 28);
      }
      const chartTop = top + zonesH + (land ? 44 : 30);
      g.chart = { x: land ? left : 16, y: chartTop, w: land ? total : W - 32, h: land ? 112 : 70 };
      g.readoutAt = land ? { x: W / 2, y: chartTop + 112 + 28, w: 320 } : null;
    } else {
      const frameW = rowsW('heap') + pad * 2;
      const frameH = head + rowsH('heap') + pad;
      const rootsW = land ? 150 : 0;
      const side = land && this.cfg.ro ? 300 : 0;
      const left = land ? Math.max(20, (W - (rootsW + frameW + side)) / 2) : (W - frameW) / 2;
      g.frames.heap = { x: left + rootsW, y: top, w: frameW, h: frameH };
      g.zones.heap = zone(left + rootsW + pad, top + head, 'heap');
      if (land) this.place('gen:roots', left + 58, top + frameH * 0.42, 112, 42);
      else this.place('gen:roots', W * 0.5, 102, 110, 28);
      const chartTop = top + frameH + (land ? 44 : 30);
      g.chart = { x: land ? left : 16, y: chartTop, w: land ? rootsW + frameW + side : W - 32, h: land ? Math.min(112, H - chartTop - 190) : 70 };
      g.readoutAt = land && side ? { x: left + rootsW + frameW + 40 + 130, y: top + 6, w: 260 } : null;
    }
    for (const o of this.gen.objs) {
      if (!this.boxes.has(o.id)) continue;
      const z = g.zones[o.zone] ?? g.zones.heap ?? g.zones.eden;
      if (!z) continue;
      const col = o.cell % z.cols;
      const row = Math.floor(o.cell / z.cols);
      this.place(o.id, z.x + col * z.pitch + cell / 2, z.y + row * z.pitch + cell / 2, cell, cell);
    }
    this.g = g;
  }

  private layoutThreads() {
    const W = this.w;
    const land = this.orient === 'landscape';
    const g: Geo = { ...EMPTY_GEO, land, regions: [], panes: [], zones: {}, frames: {} };
    const H = this.h;
    const mid = land ? Math.max(290, H * 0.44) : Math.max(240, H * 0.46);
    if (land) g.lanes = { x0: 150, x1: W - 50, ys: [mid - 104, mid - 46, mid + 46, mid + 104], h: 30 };
    else g.lanes = { x0: 66, x1: W - 16, ys: [mid - 84, mid - 38, mid + 38, mid + 84], h: 24 };
    this.g = g;
  }

  /* ================================================================ */
  /* Edge geometry                                                     */
  /* ================================================================ */

  /** The curve an edge is drawn along (also used for flights). */
  curveOf(e: GEdge): Curve | null {
    const a = this.boxes.get(e.from);
    const b = this.boxes.get(e.to);
    if (!a || !b || Number.isNaN(a.x) || Number.isNaN(b.x)) return null;
    if (this.cfg.view === 'heap') return this.heapCurve(a, b, e);
    const land = this.orient === 'landscape';
    if (e.from.startsWith('r:')) {
      // Leave a root slot from its port: right side (landscape) or bottom (portrait).
      const p0 = land ? { x: a.x + a.w / 2, y: a.y } : { x: a.x, y: a.y + a.h / 2 };
      const p3 = clipToBox(b, p0.x - b.x, p0.y - b.y, 3);
      const dx = p3.x - p0.x;
      const dy = p3.y - p0.y;
      const straight: Curve = land
        ? { p0, p1: { x: p0.x + Math.max(20, dx * 0.45), y: p0.y }, p2: { x: p3.x - dx * 0.35, y: p3.y - dy * 0.1 }, p3 }
        : { p0, p1: { x: p0.x, y: p0.y + Math.max(18, dy * 0.45) }, p2: { x: p3.x - dx * 0.1, y: p3.y - dy * 0.35 }, p3 };
      if (!this.curveBlocked(e, straight)) return straight;
      // Something sits in the way: arc over (or beside) it.
      const arc = (sign: number): Curve => {
        if (land) {
          const lift = sign * (b.h / 2 + 44);
          const ddx = b.x - p0.x;
          const p1 = { x: p0.x + 30, y: p0.y + lift };
          const p2 = { x: b.x - ddx * 0.25, y: b.y + lift };
          return { p0, p1, p2, p3: clipToBox(b, p2.x - b.x, p2.y - b.y, 3) };
        }
        const shift = sign * (b.w / 2 + 40);
        const ddy = b.y - p0.y;
        const p1 = { x: p0.x + shift, y: p0.y + 26 };
        const p2 = { x: b.x + shift, y: b.y - ddy * 0.25 };
        return { p0, p1, p2, p3: clipToBox(b, p2.x - b.x, p2.y - b.y, 3) };
      };
      const first = arc(-1);
      if (!this.curveBlocked(e, first)) return first;
      const second = arc(1);
      return this.curveBlocked(e, second) ? first : second;
    }
    const twin = this.edges.get(`${e.to}>${e.from}`);
    const off = twin && !twin.removing ? 6 : 0;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const ax = a.x + nx * off;
    const ay = a.y + ny * off;
    const bx = b.x + nx * off;
    const by = b.y + ny * off;
    const p0 = clipToBox({ ...a, x: ax, y: ay }, bx - ax, by - ay, 2);
    const p3 = clipToBox({ ...b, x: bx, y: by }, ax - bx, ay - by, 3);
    const bent = (bend: number): Curve => ({
      p0,
      p1: { x: p0.x + (p3.x - p0.x) / 3 + nx * bend, y: p0.y + (p3.y - p0.y) / 3 + ny * bend },
      p2: { x: p0.x + ((p3.x - p0.x) * 2) / 3 + nx * bend, y: p0.y + ((p3.y - p0.y) * 2) / 3 + ny * bend },
      p3,
    });
    const base = bent(e.bend);
    if (e.bend || !this.curveBlocked(e, base)) return base;
    // Route around whatever is in the way.
    const m = (Math.abs(ny) * (b.h / 2) + Math.abs(nx) * (b.w / 2) + 16) / 0.75;
    for (const k of [-1, 1, -1.6, 1.6]) {
      const c = bent(k * m);
      if (!this.curveBlocked(e, c)) return c;
    }
    return bent(-m);
  }

  /** Does this curve run through an object other than the edge's own ends? */
  private curveBlocked(e: GEdge, c: Curve): boolean {
    const boxes: Box[] = [];
    for (const [id, bx] of this.boxes) {
      if (id === e.from || id === e.to || !id.startsWith('o:') || bx.removing || Number.isNaN(bx.x)) continue;
      boxes.push(bx);
    }
    if (!boxes.length) return false;
    for (let i = 1; i < 16; i++) {
      const pt = bezier(c, i / 16);
      for (const bx of boxes) if (Math.abs(pt.x - bx.x) < bx.w / 2 + 5 && Math.abs(pt.y - bx.y) < bx.h / 2 + 5) return true;
    }
    return false;
  }

  /** Heap view: arcs between blocks, arrows down (or up) from the roots. */
  private heapCurve(a: Box, b: Box, e: GEdge): Curve {
    const s = this.g.strip;
    const rowOf = (box: Box) => (s ? Math.round((box.y - box.h / 2 - s.y) / (s.ch + s.rowGap)) : 0);
    if (e.from.startsWith('r:')) {
      const down = b.y > a.y;
      const p0 = { x: a.x, y: down ? a.y + a.h / 2 : a.y - a.h / 2 };
      const p3 = { x: b.x, y: down ? b.y - b.h / 2 - 2 : b.y + b.h / 2 + 2 };
      const k = Math.abs(p3.y - p0.y) * 0.5;
      const sgn = down ? 1 : -1;
      return { p0, p1: { x: p0.x, y: p0.y + sgn * k }, p2: { x: p3.x, y: p3.y - sgn * k }, p3 };
    }
    const ra = rowOf(a);
    const rb = rowOf(b);
    if (ra === rb) {
      // Same row: arc over the top (or under the bottom row when copying).
      const under = this.g.copyRows && ra === 1;
      const sgn = under ? 1 : -1;
      const ya = under ? a.y + a.h / 2 : a.y - a.h / 2;
      const yb = under ? b.y + b.h / 2 : b.y - b.h / 2;
      const ox = Math.sign(b.x - a.x) * Math.min(a.w / 2 - 4, 8);
      const p0 = { x: a.x + ox, y: ya };
      const p3 = { x: b.x - ox * 0.5, y: yb + sgn * 2 };
      const rise = 18 + Math.min(70, Math.abs(p3.x - p0.x) * 0.22);
      return { p0, p1: { x: p0.x, y: p0.y + sgn * rise }, p2: { x: p3.x, y: p3.y + sgn * rise }, p3 };
    }
    const down = rb > ra;
    const p0 = { x: a.x, y: down ? a.y + a.h / 2 : a.y - a.h / 2 };
    const p3 = { x: b.x, y: down ? b.y - b.h / 2 - 2 : b.y + b.h / 2 + 2 };
    const k = Math.abs(p3.y - p0.y) * 0.5;
    const sgn = down ? 1 : -1;
    return { p0, p1: { x: p0.x, y: p0.y + sgn * k }, p2: { x: p3.x, y: p3.y - sgn * k }, p3 };
  }

  protected curveFor(from: string, to: string, lane: number): Curve | null {
    const e = this.edges.get(`${from}>${to}`);
    if (e) return this.curveOf(e);
    return super.curveFor(from, to, lane);
  }

  /* ================================================================ */
  /* Clock                                                             */
  /* ================================================================ */

  protected step(dt: number) {
    if (this.sweepAt != null) this.stepSweep(dt);
    if (this.cfg.view === 'gen') this.gen.step(dt);
    if (this.cfg.view === 'threads') this.threads.step(this.t);
  }

  protected animate(dt: number) {
    for (const [id, e] of this.edges) {
      e.alpha += (e.talpha - e.alpha) * (1 - Math.exp(-8 * dt));
      if (e.removing && e.talpha === 0 && e.alpha < 0.02) this.edges.delete(id);
    }
    for (const [id, o] of this.objs) if (o.fate === 'freed' && !this.boxes.has(`o:${id}`)) this.objs.delete(id);
    if (this.heapFx.length) this.heapFx = this.heapFx.filter((f) => this.vt - f.vt < 1.1);
    if (this.cfg.view === 'gen') this.gen.prune();
  }
}

/* ------------------------------------------------------------------ */

/** Where a ray from a box's center, heading (dx, dy), leaves the box (plus a margin). */
export function clipToBox(b: { x: number; y: number; w: number; h: number }, dx: number, dy: number, margin = 0): Pt {
  const hw = b.w / 2 + margin;
  const hh = b.h / 2 + margin;
  if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return { x: b.x, y: b.y };
  const tx = Math.abs(dx) > 1e-6 ? hw / Math.abs(dx) : Infinity;
  const ty = Math.abs(dy) > 1e-6 ? hh / Math.abs(dy) : Infinity;
  const t = Math.min(tx, ty);
  return { x: b.x + dx * t, y: b.y + dy * t };
}

export function bezierMid(c: Curve): Pt {
  return {
    x: 0.125 * c.p0.x + 0.375 * c.p1.x + 0.375 * c.p2.x + 0.125 * c.p3.x,
    y: 0.125 * c.p0.y + 0.375 * c.p1.y + 0.375 * c.p2.y + 0.125 * c.p3.y,
  };
}
