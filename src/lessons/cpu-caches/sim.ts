import { SIG } from '@/lib/sim/colors';
import { clamp, type Curve, type Pt } from '@/lib/sim/geometry';
import { PredictGame } from '@/lib/sim/predict';
import { mulberry32, type Rng } from '@/lib/sim/rng';
import { Sim, type ScriptEvent, type WireSpec } from '@/lib/sim/Sim';
import { Machine, type Order, type Pace } from './machine';
import { LEVELS, LEVEL_IDS, NS_HIT, NS_MISS, PER_LINE, WS_STEPS, avgNs, hex, levelMix, type LevelId } from './model';

/* ------------------------------------------------------------------ */
/* Config                                                              */
/* ------------------------------------------------------------------ */

export type View = 'wall' | 'ladder' | 'grid' | 'race' | 'cliff' | 'cores';
/** slow: every access readable · tutorial: brisk · true: on-screen time proportional to real time */
export type PaceKind = 'slow' | 'tutorial' | 'true';
export type PredictKind = 'grid' | 'fs';
export type CoresMode = 'coherence' | 'packed' | 'padded';
export type Mesi = 'M' | 'E' | 'S' | 'I';

export interface Cfg {
  view: View;
  /** wall: is there a cache between the core and RAM? */
  cache: boolean;
  /** ladder: human-time stopwatch */
  human: boolean;
  /** grid: label the array as a[k] (1) or a[i][j] (2) */
  dims: 1 | 2;
  order: Order;
  /** race: the right-hand machine's order */
  orderB: Order;
  ways: number;
  prefetch: boolean;
  pace: PaceKind;
  /** grid: show the running loop on the stage (landscape) */
  code: boolean;
  /** cliff: working set in bytes */
  ws: number;
  cores: CoresMode;
}

export const DEFAULTS: Cfg = {
  view: 'wall',
  cache: false,
  human: false,
  dims: 1,
  order: 'row',
  orderB: 'col',
  ways: 4,
  prefetch: false,
  pace: 'slow',
  code: false,
  ws: 8 * 1024 * 1024,
  cores: 'coherence',
};

/** Seconds on screen per nanosecond of machine time, per scene. */
const SPN = { wall: 0.012, ladder: 0.03, cliff: 0.011, grid: 0.004, race: 0.003, cores: 0.018 };
const PACES: Record<Exclude<PaceKind, 'true'>, Pace> = {
  slow: { hit: 0.36, miss: 1.5 },
  tutorial: { hit: 0.22, miss: 1.05 },
};

/* ------------------------------------------------------------------ */
/* Chapter 1: a linked list scattered through RAM                      */
/* ------------------------------------------------------------------ */

export const LIST = [
  { addr: 0x7f40, value: 5 },
  { addr: 0x2c80, value: 3 },
  { addr: 0x9a00, value: 8 },
  { addr: 0x1bc0, value: 1 },
  { addr: 0xb3c0, value: 9 },
  { addr: 0x4e40, value: 2 },
];

interface WallState {
  k: number;
  pass: number;
  inLoad: boolean;
  hit: boolean;
  loadT0: number;
  loadNs: number;
  lastCycles: number;
  passNs: number;
  passes: number[];
  cached: Set<number>;
  waitNs: number;
  workNs: number;
  sum: number;
}

interface LadderState {
  level: LevelId | null;
  busy: boolean;
  t0: number;
  ns: number;
  last: { level: LevelId; ns: number } | null;
  cycle: number;
  queue: LevelId[];
}

interface CliffState {
  level: LevelId | null;
  busy: boolean;
  counts: Record<LevelId, number>;
  n: number;
  ns: number;
  rng: Rng;
}

interface CoresState {
  mesi: [Mesi, Mesi];
  /** Padded mode: the second core's own line */
  mesiB: [Mesi, Mesi];
  /** Has each core held a copy (so an Invalid line was thrown out, not never there)? */
  had: [boolean, boolean];
  l3: boolean;
  x: { c0: number | null; c1: number | null; l3: number | null; ram: number };
  act: number;
  log: string;
  owner: 0 | 1;
  cnt: [number, number];
  transfers: number;
  t0: number;
  acc: number;
  xfer: { from: 0 | 1; vt: number } | null;
  asked: number;
}

export interface GridGeo {
  x0: number;
  y0: number;
  cw: number;
  ch: number;
  lg: number;
  rg: number;
  rows: number;
  cols: number;
  w: number;
  h: number;
}

export interface SlotGeo {
  x: number;
  y: number;
  cw: number;
  ch: number;
  rowH: number;
  horizontal: boolean;
  /** columns of slots (portrait playground with many lines) */
  ncol: number;
  colW: number;
  tags: boolean;
}

export interface ChartGeo {
  x: number;
  y: number;
  w: number;
  h: number;
}

const BURST = 8;

/* ------------------------------------------------------------------ */

export class CacheSim extends Sim {
  cfg: Cfg = { ...DEFAULTS };
  game: PredictGame | null = null;
  pKind: PredictKind | null = null;
  asking: { m: 'a' | 'b'; e: number } | { fs: 1 | 2 } | null = null;

  ma = new Machine('a');
  mb = new Machine('b');
  private freeAt = { a: 0, b: 0 };
  private noAsk = { a: -1, b: -1 };
  private raceHold = -1;

  wall: WallState = this.freshWall();
  lad: LadderState = { level: null, busy: false, t0: 0, ns: 0, last: null, cycle: 0, queue: [] };
  cl: CliffState = this.freshCliff();
  co: CoresState = this.freshCores();

  /** Cell sizes etc. computed in layout() */
  cell = { cw: 28, ch: 28, lg: 8, rg: 5, padL: 70, padT: 40, padR: 14, padB: 14 };
  slotSpec = { cw: 11, ch: 12, rowH: 28, headH: 34, horizontal: false, ncol: 1, tags: true };
  /** Ladder: pixels per nanosecond (one way) and the axis origin */
  chain = { axis: 'x' as 'x' | 'y', k: 10, x0: 0, y: 0 };
  private lastView: View | null = null;

  constructor() {
    super();
    this.ma.configure({ order: DEFAULTS.order, ways: DEFAULTS.ways, prefetch: false });
    this.mb.configure({ order: DEFAULTS.orderB, ways: DEFAULTS.ways, prefetch: false });
    this.syncBoxes();
  }

  /* ================================================================ */
  /* Step entry                                                        */
  /* ================================================================ */

  enter(cfg: Cfg, script: ScriptEvent<CacheSim>[] = [], opts: { predict?: PredictKind | null; needed?: number } = {}) {
    const viewChanged = cfg.view !== this.lastView;
    this.cfg = { ...cfg };
    this.lastView = cfg.view;
    this.clearTransient();
    this.pKind = opts.predict ?? null;
    this.game = this.pKind ? new PredictGame(this, opts.needed ?? 3) : null;
    this.asking = null;
    this.resetWorld();
    this.runScript(script);
    this.syncBoxes();
    this.relayout();
    if (viewChanged) this.snap();
    this.rev++;
  }

  private resetWorld() {
    const c = this.cfg;
    this.raceHold = -1;
    this.noAsk = { a: -1, b: -1 };
    if (c.view === 'grid' || c.view === 'race') {
      this.ma.configure({ order: c.order, ways: c.ways, prefetch: c.prefetch });
      this.mb.configure({ order: c.orderB, ways: c.ways, prefetch: c.prefetch });
      this.freeAt = { a: this.t + 0.5, b: this.t + 0.5 };
    }
    if (c.view === 'wall') {
      this.wall = this.freshWall();
      this.after(0.7, () => this.wallStart());
    }
    if (c.view === 'ladder') {
      this.lad = { level: null, busy: false, t0: 0, ns: 0, last: null, cycle: 0, queue: [] };
      this.after(0.6, () => this.ladStart());
    }
    if (c.view === 'cliff') {
      this.cl = this.freshCliff();
      this.after(0.5, () => this.clStart());
    }
    if (c.view === 'cores') {
      this.co = this.freshCores();
      this.after(0.6, () => this.coStart());
    }
  }

  private freshWall(): WallState {
    return { k: 0, pass: 0, inLoad: false, hit: false, loadT0: 0, loadNs: 0, lastCycles: 0, passNs: 0, passes: [], cached: new Set(), waitNs: 0, workNs: 0, sum: 0 };
  }

  private freshCliff(): CliffState {
    return { level: null, busy: false, counts: { l1: 0, l2: 0, l3: 0, ram: 0 }, n: 0, ns: 0, rng: mulberry32(19) };
  }

  private freshCores(): CoresState {
    const padded = this.cfg.cores === 'padded';
    const warm = this.cfg.cores !== 'coherence';
    return {
      mesi: warm ? ['M', 'I'] : ['I', 'I'],
      mesiB: padded ? ['I', 'M'] : ['I', 'I'],
      had: [warm, padded],
      l3: warm,
      x: { c0: null, c1: null, l3: null, ram: 0 },
      act: 0,
      log: 'x = 0 lives in RAM',
      owner: 0,
      cnt: [0, 0],
      transfers: 0,
      t0: this.t,
      acc: 0,
      xfer: null,
      asked: 0,
    };
  }

  /* ================================================================ */
  /* Controls the panel calls                                          */
  /* ================================================================ */

  setOrder(order: Order) {
    this.cfg = { ...this.cfg, order };
    this.ma.configure({ order, ways: this.cfg.ways, prefetch: this.cfg.prefetch });
    this.freeAt.a = this.t + 0.25;
    this.clearTransient();
    this.rev++;
  }

  setPrefetch(on: boolean) {
    this.cfg = { ...this.cfg, prefetch: on };
    this.ma.configure({ order: this.cfg.order, ways: this.cfg.ways, prefetch: on });
    this.mb.configure({ order: this.cfg.orderB, ways: this.cfg.ways, prefetch: on });
    this.freeAt = { a: this.t + 0.25, b: this.t + 0.25 };
    this.raceHold = -1;
    this.clearTransient();
    this.rev++;
  }

  setWays(ways: number) {
    this.cfg = { ...this.cfg, ways };
    this.ma.configure({ order: this.cfg.order, ways, prefetch: this.cfg.prefetch });
    this.freeAt.a = this.t + 0.25;
    this.clearTransient();
    this.relayout();
    this.rev++;
  }

  setPace(pace: PaceKind) {
    this.cfg = { ...this.cfg, pace };
    this.ma.reset();
    this.freeAt.a = this.t + 0.25;
    this.clearTransient();
    this.rev++;
  }

  /** Start the current pass over (cold cache). */
  restartPass() {
    this.ma.reset();
    this.mb.reset();
    this.freeAt = { a: this.t + 0.3, b: this.t + 0.3 };
    this.raceHold = -1;
    this.clearTransient();
    this.rev++;
  }

  /** Run the rest of the current pass instantly: same timing rules, no animation. */
  fastForward() {
    const m = this.ma;
    if (m.finished) return;
    const p = this.paceOf();
    let tv = Math.max(this.t, this.freeAt.a);
    if (m.cur) {
      tv = Math.max(tv, m.cur.t1);
      m.complete(tv, this.vt);
    }
    for (let guard = 0; guard < 5000 && !m.finished; guard++) {
      m.arrive(tv, this.vt);
      const op = m.begin(tv, p);
      if (!op) break;
      m.complete(op.t1, this.vt);
      tv = op.t1;
    }
    m.arrive(Infinity, this.vt);
    m.evicted = [];
    m.finishedT = this.t;
    this.freeAt.a = this.t;
    this.clearTransient();
    this.rev++;
  }

  setWs(ws: number) {
    this.cfg = { ...this.cfg, ws };
    this.cl.counts = { l1: 0, l2: 0, l3: 0, ram: 0 };
    this.cl.n = 0;
    this.cl.ns = 0;
    this.rev++;
  }

  /** Ladder: make the next load come from this level. */
  loadFrom(level: LevelId) {
    this.lad.queue = [...this.lad.queue, level].slice(-3);
    this.rev++;
  }

  setCores(mode: CoresMode) {
    this.cfg = { ...this.cfg, cores: mode };
    this.clearTransient();
    this.co = this.freshCores();
    this.syncBoxes();
    this.after(0.4, () => this.coStart());
    this.rev++;
  }

  /* ================================================================ */
  /* Boxes and layout                                                  */
  /* ================================================================ */

  private syncBoxes() {
    const want = new Set<string>();
    const v = this.cfg.view;
    if (v === 'wall') {
      want.add('core');
      want.add('ram');
      if (this.cfg.cache) want.add('cache');
      LIST.forEach((_, i) => want.add(`node:${i}`));
    } else if (v === 'ladder' || v === 'cliff') {
      ['core', 'l1', 'l2', 'l3', 'ram'].forEach((id) => want.add(id));
      if (v === 'cliff') want.add('chart');
    } else if (v === 'grid') {
      ['core', 'l1', 'ram'].forEach((id) => want.add(id));
    } else if (v === 'race') {
      ['l1', 'ram', 'l1:b', 'ram:b'].forEach((id) => want.add(id));
    } else if (v === 'cores') {
      ['core', 'core:1', 'l1', 'l1:1', 'l3', 'ram'].forEach((id) => want.add(id));
    }
    for (const id of want) this.box(id);
    for (const id of [...this.boxes.keys()]) if (!want.has(id)) this.hide(id);
  }

  protected layout() {
    switch (this.cfg.view) {
      case 'wall':
        return this.layoutWall();
      case 'ladder':
        return this.layoutChain(false);
      case 'cliff':
        return this.layoutChain(true);
      case 'grid':
        return this.layoutGrid();
      case 'race':
        return this.layoutRace();
      case 'cores':
        return this.layoutCores();
    }
  }

  private layoutWall() {
    const { w, h } = this;
    const land = this.orient === 'landscape';
    if (land) {
      const cy = clamp(h * 0.47, 250, h - 290);
      const coreW = clamp(w * 0.25, 200, 250);
      const cx = 36 + coreW / 2;
      this.place('core', cx, cy, coreW, 180);
      if (this.boxes.has('cache')) this.place('cache', cx + coreW / 2 + 40 + 78, cy, 156, 180);
      const rw = clamp(w * 0.4, 330, 410);
      const rh = clamp(h * 0.56, 360, 440);
      const rx = w - 36 - rw / 2;
      this.place('ram', rx, cy, rw, rh);
      const nw = Math.min(124, rw * 0.32);
      const cols = [rx - rw * 0.25, rx + rw * 0.25];
      const top = cy - rh / 2 + 70;
      const step = (rh - 100) / 6;
      this.placeNodes(cols, top, step, nw, 36);
    } else {
      this.place('core', w / 2, 122, Math.min(230, w - 40), 88);
      if (this.boxes.has('cache')) this.place('cache', w / 2, 214, Math.min(230, w - 40), 48);
      const rw = w - 32;
      const rh = 196;
      const ry = h - 64 - 22 - rh / 2;
      this.place('ram', w / 2, ry, rw, rh);
      const nw = Math.min(128, rw * 0.36);
      this.placeNodes([w / 2 - rw * 0.26, w / 2 + rw * 0.26], ry - rh / 2 + 42, (rh - 52) / 6, nw, 22);
    }
  }

  /** Nodes sit at a height that follows their address, alternating columns. */
  private placeNodes(cols: number[], top: number, step: number, nw: number, nh: number) {
    const rank = [...LIST.keys()].sort((a, b) => LIST[a].addr - LIST[b].addr);
    rank.forEach((k, r) => this.place(`node:${k}`, cols[r % 2], top + r * step + step / 2 - 4, nw, nh));
  }

  /** Core, L1, L2, L3, RAM on one axis with distances to scale (one-way latency). */
  private layoutChain(mini: boolean) {
    const { w, h } = this;
    const land = this.orient === 'landscape';
    const human = this.cfg.human;
    // Phones get a taller chain when there's no table to fit underneath.
    const s = mini ? 0.7 : human ? 1 : land ? 1.2 : 1.4;
    const small = !land;
    const coreW = (small ? 72 : 128) * (mini ? 0.72 : 1);
    const coreH = (small ? 84 : 150) * s;
    const ramW = (small ? 64 : 150) * (mini ? 0.72 : 1);
    const ramH = (small ? 110 : 210) * s;
    const slabs: Record<'l1' | 'l2' | 'l3', { w: number; h: number }> = {
      l1: { w: small ? 7 : 10, h: (small ? 46 : 78) * s },
      l2: { w: small ? 9 : 14, h: (small ? 62 : 112) * s },
      l3: { w: small ? 13 : 20, h: (small ? 86 : 160) * s },
    };
    const margin = small ? 16 : 44;
    const cy = mini ? (small ? 112 : 168) : small ? (human ? 176 : 210) : human ? clamp(h * 0.31, 200, 260) : h * 0.4;
    const coreX = margin + coreW / 2;
    const ramLeft = w - margin - ramW;
    const x0 = coreX + coreW / 2;
    const k = (ramLeft - x0) / (LEVELS.ram.ns / 2);
    this.chain = { axis: 'x', k, x0, y: cy };
    this.place('core', coreX, cy, coreW, coreH);
    for (const id of ['l1', 'l2', 'l3'] as const) {
      const left = x0 + (LEVELS[id].ns / 2) * k;
      this.place(id, left + slabs[id].w / 2, cy, slabs[id].w, slabs[id].h);
    }
    this.place('ram', ramLeft + ramW / 2, cy, ramW, ramH);
    if (this.boxes.has('chart')) {
      if (land) {
        const top = cy + ramH / 2 + 62;
        const bottom = h - 138;
        this.place('chart', w / 2 + 14, (top + bottom) / 2, Math.min(w - 170, 760), Math.max(160, bottom - top));
      } else {
        const top = cy + ramH / 2 + 62;
        const bottom = h - 64 - 76 - 36;
        this.place('chart', w / 2 + 10, (top + bottom) / 2, w - 64, Math.max(120, bottom - top));
      }
    }
  }

  private layoutGrid() {
    const { w, h } = this;
    const land = this.orient === 'landscape';
    const ways = this.cfg.ways;
    const rows = this.ma.rows;
    if (land) {
      const colX = clamp(w * 0.18, 150, 205);
      const rowH = ways <= 6 ? 28 : 22;
      this.slotSpec = { cw: 11, ch: ways <= 6 ? 13 : 11, rowH, headH: 38, horizontal: false, ncol: 1, tags: true };
      const l1H = 38 + ways * rowH + 8;
      const l1W = 224;
      const leftEdge = colX + l1W / 2 + 56;
      const padL = 74;
      const padR = 16;
      const cw = Math.floor(clamp((w - 30 - leftEdge - padL - padR - 8) / 16, 16, 31));
      const ch = Math.round(cw * 1.1);
      const lg = Math.max(5, Math.round(cw * 0.26));
      const rg = Math.max(3, Math.round(cw * 0.16));
      this.cell = { cw, ch, lg, rg, padL, padT: this.cfg.dims === 2 ? 56 : 40, padR, padB: 14 };
      const gw = 16 * cw + lg;
      const gh = rows * ch + (rows - 1) * rg;
      const rw = gw + padL + padR;
      const rh = gh + this.cell.padT + this.cell.padB;
      const rx = w - 30 - rw / 2;
      const ry = clamp(h * 0.47, 124 + rh / 2, h - 110 - rh / 2);
      this.place('ram', rx, ry, rw, rh);
      const coreY = Math.max(150, ry - rh / 2 + 12);
      this.place('core', colX, coreY, 160, 64);
      this.place('l1', colX, Math.max(coreY + 64 + l1H / 2, ry - 12), l1W, l1H);
    } else {
      const ncol = ways > 5 ? 2 : 1;
      const per = Math.ceil(ways / ncol);
      const rowH = 16;
      const l1W = ncol === 2 ? w - 32 : Math.min(210, w * 0.57);
      this.slotSpec = { cw: ncol === 2 ? 8 : 9, ch: 10, rowH, headH: 22, horizontal: false, ncol, tags: ncol === 1 };
      const l1H = 22 + per * rowH + 6;
      const cw = Math.floor(clamp((w - 32 - 16 - 6) / 16, 12, 22));
      const lg = 5;
      const rg = 3;
      const top = 74;
      const coreBelow = ncol === 2;
      const ramTop = (coreBelow ? top + 56 : top) + l1H + 24;
      const avail = h - 56 - 80 - ramTop - 10;
      const ch = Math.floor(clamp((avail - 32 - (rows - 1) * rg) / rows, 12, 22));
      this.cell = { cw, ch, lg, rg, padL: 8, padT: 24, padR: 8, padB: 8 };
      const gw = 16 * cw + lg;
      const gh = rows * ch + (rows - 1) * rg;
      const rw = gw + 16;
      const rh = gh + 32;
      if (!coreBelow) {
        const coreW = w - 32 - l1W - 12;
        this.place('core', 16 + coreW / 2, top + l1H / 2, coreW, 52);
        this.place('l1', w - 16 - l1W / 2, top + l1H / 2, l1W, l1H);
      } else {
        this.place('core', w / 2, top + 22, 160, 44);
        this.place('l1', w / 2, top + 56 + l1H / 2, l1W, l1H);
      }
      this.place('ram', w / 2, ramTop + rh / 2, rw, rh);
    }
  }

  private layoutRace() {
    const { w, h } = this;
    const land = this.orient === 'landscape';
    const rows = this.ma.rows;
    if (land) {
      const half = w / 2;
      const cw = Math.floor(clamp((half - 58 - 16 - 6) / 16, 12, 26));
      const lg = Math.max(4, Math.round(cw * 0.26));
      const rg = Math.max(3, Math.round(cw * 0.16));
      this.cell = { cw, ch: cw, lg, rg, padL: 8, padT: 30, padR: 8, padB: 10 };
      this.slotSpec = { cw: Math.max(6, Math.min(10, Math.floor(cw * 0.4))), ch: 13, rowH: 0, headH: 0, horizontal: true, ncol: 1, tags: false };
      const gw = 16 * cw + lg;
      const gh = rows * cw + (rows - 1) * rg;
      const rw = gw + 16;
      const rh = gh + 40;
      const l1W = 4 * (8 * this.slotSpec.cw) + 3 * 10 + 20;
      const cy = clamp(h * 0.5, 250, h - 200);
      for (const [id, x] of [
        ['', w * 0.26],
        [':b', w * 0.74],
      ] as const) {
        this.place(`ram${id}`, x, cy, rw, rh);
        this.place(`l1${id}`, x, cy - rh / 2 - 58, Math.max(l1W, 150), 40);
      }
    } else {
      const cw = Math.floor(clamp((w - 32 - 16 - 5) / 16, 12, 21));
      const ch = 11;
      const rg = 2;
      this.cell = { cw, ch, lg: 5, rg, padL: 8, padT: 22, padR: 8, padB: 7 };
      this.slotSpec = { cw: 6, ch: 9, rowH: 0, headH: 0, horizontal: true, ncol: 1, tags: false };
      const gw = 16 * cw + 5;
      const gh = rows * ch + (rows - 1) * rg;
      const rw = gw + 16;
      const rh = gh + 29;
      const l1W = 4 * 48 + 30 + 16;
      const span = (h - 64 - 80) / 2;
      for (const [id, top] of [
        ['', 76],
        [':b', 76 + span + 6],
      ] as const) {
        this.place(`l1${id}`, w / 2, top + 13, l1W, 26);
        this.place(`ram${id}`, w / 2, top + 34 + rh / 2, rw, rh);
      }
    }
  }

  private layoutCores() {
    const { w, h } = this;
    if (this.orient === 'landscape') {
      const top = clamp(h * 0.2, 140, 170);
      const cw = Math.min(270, w * 0.3);
      this.place('core', w * 0.28, top, Math.min(220, cw), 62);
      this.place('core:1', w * 0.72, top, Math.min(220, cw), 62);
      this.place('l1', w * 0.28, top + 142, cw, 112);
      this.place('l1:1', w * 0.72, top + 142, cw, 112);
      this.place('l3', w / 2, top + 306, Math.min(440, w * 0.46), 92);
      this.place('ram', w / 2, top + 434, 240, 50);
    } else {
      const lw = (w - 44) / 2;
      this.place('core', 16 + lw / 2, 104, lw, 48);
      this.place('core:1', w - 16 - lw / 2, 104, lw, 48);
      this.place('l1', 16 + lw / 2, 198, lw, 88);
      this.place('l1:1', w - 16 - lw / 2, 198, lw, 88);
      this.place('l3', w / 2, 308, w - 40, 70);
      this.place('ram', w / 2, 384, 190, 38);
    }
  }

  protected wires(): WireSpec[] {
    const v = this.cfg.view;
    if (v === 'wall') {
      if (this.cfg.cache) return [{ from: 'core', to: 'cache' }, { from: 'cache', to: 'ram' }];
      return [{ from: 'core', to: 'ram' }];
    }
    if (v === 'grid') return [{ from: 'core', to: 'l1' }, { from: 'l1', to: 'ram' }];
    if (v === 'race')
      return [
        { from: 'l1', to: 'ram' },
        { from: 'l1:b', to: 'ram:b' },
      ];
    if (v === 'cores') {
      const padded = this.cfg.cores === 'padded';
      return [
        { from: 'core', to: 'l1' },
        { from: 'core:1', to: 'l1:1' },
        { from: 'l1', to: 'l3', state: padded ? 'dim' : 'normal' },
        { from: 'l1:1', to: 'l3', state: padded ? 'dim' : 'normal' },
        { from: 'l3', to: 'ram', state: 'dim' },
      ];
    }
    return [];
  }

  /** Ladder and cliff: straight lines along the axis, out above and back below. */
  protected curveFor(from: string, to: string, lane: number): Curve | null {
    const v = this.cfg.view;
    if (v !== 'ladder' && v !== 'cliff') return super.curveFor(from, to, lane);
    const a = this.boxes.get(from);
    const b = this.boxes.get(to);
    if (!a || !b || Number.isNaN(a.x) || Number.isNaN(b.x)) return null;
    const out = from === 'core';
    const lvl = out ? b : a;
    const off = out ? -5 : 5;
    const x0 = this.chain.x0;
    const x1 = lvl.x - lvl.w / 2;
    const y = this.chain.y + off;
    const A: Pt = out ? { x: x0, y } : { x: x1, y };
    const B: Pt = out ? { x: x1, y } : { x: x0, y };
    return {
      p0: A,
      p1: { x: A.x + (B.x - A.x) / 3, y },
      p2: { x: A.x + ((B.x - A.x) * 2) / 3, y },
      p3: B,
    };
  }

  /* ================================================================ */
  /* Geometry the scene reads                                          */
  /* ================================================================ */

  gridGeo(m: 'a' | 'b'): GridGeo | null {
    const b = this.boxes.get(m === 'a' ? 'ram' : 'ram:b');
    if (!b || Number.isNaN(b.x)) return null;
    const { cw, ch, lg, rg, padL, padT } = this.cell;
    const rows = this.ma.rows;
    const cols = this.ma.cols;
    const w = cols * cw + lg * (cols / PER_LINE - 1);
    const hh = rows * ch + (rows - 1) * rg;
    const x0 = b.x - b.w / 2 + padL;
    const y0 = b.y - b.h / 2 + padT;
    return { x0, y0, cw, ch, lg, rg, rows, cols, w, h: hh };
  }

  cellRect(g: GridGeo, e: number) {
    const r = Math.floor(e / g.cols);
    const c = e % g.cols;
    return { x: g.x0 + c * g.cw + Math.floor(c / PER_LINE) * g.lg, y: g.y0 + r * (g.ch + g.rg), w: g.cw, h: g.ch };
  }

  lineRect(g: GridGeo, line: number) {
    const a = this.cellRect(g, line * PER_LINE);
    return { x: a.x, y: a.y, w: g.cw * PER_LINE, h: g.ch };
  }

  slotGeo(m: 'a' | 'b'): SlotGeo | null {
    const b = this.boxes.get(m === 'a' ? 'l1' : 'l1:b');
    if (!b || Number.isNaN(b.x)) return null;
    const s = this.slotSpec;
    if (s.horizontal) {
      const stripW = 8 * s.cw;
      const gap = 10;
      const ways = (m === 'a' ? this.ma : this.mb).ways;
      const total = ways * stripW + (ways - 1) * gap;
      return { x: b.x - total / 2, y: b.y - s.ch / 2 + (this.orient === 'landscape' ? 7 : 0), cw: s.cw, ch: s.ch, rowH: stripW + gap, horizontal: true, ncol: 1, colW: 0, tags: false };
    }
    const colW = (b.w - 12) / s.ncol;
    return { x: b.x - b.w / 2 + 10, y: b.y - b.h / 2 + s.headH, cw: s.cw, ch: s.ch, rowH: s.rowH, horizontal: false, ncol: s.ncol, colW, tags: s.tags };
  }

  slotRect(g: SlotGeo, i: number, ways: number) {
    if (g.horizontal) return { x: g.x + i * g.rowH, y: g.y, w: 8 * g.cw, h: g.ch };
    const per = Math.ceil(ways / g.ncol);
    const col = Math.floor(i / per);
    const row = i % per;
    return { x: g.x + col * g.colW, y: g.y + row * g.rowH, w: 8 * g.cw, h: g.ch };
  }

  chartGeo(): ChartGeo | null {
    const b = this.boxes.get('chart');
    if (!b || Number.isNaN(b.x)) return null;
    return { x: b.x - b.w / 2, y: b.y - b.h / 2, w: b.w, h: b.h };
  }

  machine(m: 'a' | 'b') {
    return m === 'a' ? this.ma : this.mb;
  }

  paceOf(): Pace {
    const p = this.cfg.pace;
    if (p === 'true') {
      const spn = this.cfg.view === 'race' ? SPN.race : SPN.grid;
      return { hit: NS_HIT * spn, miss: NS_MISS * spn };
    }
    return PACES[p];
  }

  /** Callout targets beyond plain boxes. */
  calloutRect(target: string): { x: number; y: number; w: number; h: number } | null {
    if (target.startsWith('wide:')) {
      if (this.orient !== 'landscape') return null;
      return this.calloutRect(target.slice(5));
    }
    if (target === 'gauge') {
      const b = this.boxes.get('core');
      if (!b) return null;
      return this.orient === 'landscape' ? { x: b.x, y: b.y + 18, w: b.w - 30, h: 60 } : { x: b.x, y: b.y + 14, w: b.w - 20, h: 30 };
    }
    if (target.startsWith('line:')) {
      const g = this.gridGeo('a');
      if (!g) return null;
      const r = this.lineRect(g, Number(target.slice(5)));
      return { x: r.x + r.w / 2, y: r.y + r.h / 2, w: r.w + 4, h: r.h + 4 };
    }
    if (target.startsWith('row:')) {
      const g = this.gridGeo('a');
      if (!g) return null;
      const r = this.cellRect(g, Number(target.slice(4)) * g.cols);
      return { x: g.x0 + g.w / 2, y: r.y + r.h / 2, w: g.w, h: r.h };
    }
    if (target.startsWith('col:')) {
      const g = this.gridGeo('a');
      if (!g) return null;
      const r = this.cellRect(g, Number(target.slice(4)));
      return { x: r.x + r.w / 2, y: g.y0 + g.h / 2, w: r.w, h: g.h };
    }
    if (target.startsWith('slots')) {
      const g = this.slotGeo(target === 'slots:b' ? 'b' : 'a');
      if (!g) return null;
      const m = this.machine(target === 'slots:b' ? 'b' : 'a');
      const first = this.slotRect(g, 0, m.ways);
      const last = this.slotRect(g, m.ways - 1, m.ways);
      const x1 = last.x + last.w;
      const y1 = last.y + last.h;
      return { x: (first.x + x1) / 2, y: (first.y + y1) / 2, w: x1 - first.x, h: y1 - first.y };
    }
    if (target === 'cursor') {
      const g = this.gridGeo('a');
      const e = this.cursor('a');
      if (!g || e == null) return null;
      const r = this.cellRect(g, e);
      return { x: r.x + r.w / 2, y: r.y + r.h / 2, w: r.w, h: r.h };
    }
    if (target === 'curve') {
      const g = this.chartGeo();
      if (!g) return null;
      const p = this.chartPoint(this.cfg.ws);
      return p ? { x: p.x, y: p.y, w: 10, h: 10 } : null;
    }
    const b = this.boxes.get(target);
    return b && !Number.isNaN(b.x) ? { x: b.x, y: b.y, w: b.w, h: b.h } : null;
  }

  /** Element the machine is on (current access, else the next one). */
  cursor(m: 'a' | 'b'): number | null {
    const mm = this.machine(m);
    if (mm.cur) return mm.cur.e;
    if (mm.finished) return mm.lastOp?.e ?? null;
    return mm.peek();
  }

  /* ---- chart mapping (cliff) ---- */

  chartX(ws: number, g: ChartGeo) {
    const l = Math.log2(ws);
    return g.x + ((l - 12) / 18) * g.w;
  }

  chartY(ns: number, g: ChartGeo) {
    const lo = Math.log10(0.7);
    const hi = Math.log10(160);
    return g.y + g.h - ((Math.log10(ns) - lo) / (hi - lo)) * g.h;
  }

  chartPoint(ws: number): Pt | null {
    const g = this.chartGeo();
    if (!g) return null;
    return { x: this.chartX(ws, g), y: this.chartY(avgNs(ws), g) };
  }

  /* ================================================================ */
  /* Simulation                                                        */
  /* ================================================================ */

  protected step(dt: number) {
    const v = this.cfg.view;
    if (v === 'grid') this.runMachine(this.ma);
    else if (v === 'race') {
      this.runMachine(this.ma);
      this.runMachine(this.mb);
      this.raceRestart();
    } else if (v === 'cores' && this.cfg.cores === 'padded') this.paddedTick(dt);
  }

  /* ---------------- grid machines ---------------- */

  private runMachine(m: Machine) {
    const id = m.id;
    const p = this.paceOf();
    if (m.arrive(this.t, this.vt)) this.rev++;
    for (let guard = 0; guard < 80; guard++) {
      if (m.finished) {
        if (this.cfg.view === 'grid' && this.t - m.finishedT > (this.cfg.pace === 'true' ? 1.4 : 2.2)) {
          m.reset();
          this.freeAt[id] = this.t + 0.2;
          this.rev++;
        }
        return;
      }
      if (!m.cur) {
        if (this.t < this.freeAt[id]) return;
        if (this.game && !this.game.done && !this.game.pending && m.shouldAsk() && this.noAsk[id] !== m.pos) {
          this.askGrid(m);
          return;
        }
        const op = m.begin(this.freeAt[id], p);
        if (!op) return;
        this.onBegin(m);
        this.rev++;
      }
      const op = m.cur;
      if (!op || op.t1 > this.t) return;
      m.complete(op.t1, this.vt);
      this.freeAt[id] = op.t1;
      this.onComplete(m);
      this.rev++;
    }
  }

  private onBegin(m: Machine) {
    if (this.cfg.pace === 'true' || this.cfg.view !== 'grid') return;
    const op = m.cur;
    if (!op) return;
    this.send({ from: 'core', to: 'l1', dur: Math.min(0.14, this.paceOf().hit * 0.4), color: SIG.req, r: 3.4, lane: 3 });
  }

  private onComplete(m: Machine) {
    const op = m.lastOp;
    if (!op || this.cfg.view !== 'grid' || this.cfg.pace === 'true') return;
    this.send({ from: 'l1', to: 'core', dur: Math.min(0.16, this.paceOf().hit * 0.45), color: SIG.res, r: 3.4, lane: 3 });
    const g = this.gridGeo('a');
    if (!g || this.cfg.pace !== 'slow' || op.kind === 'hit') return;
    const r = this.cellRect(g, op.e);
    const row0 = op.e < g.cols;
    this.fx({ kind: 'text', at: { x: r.x + r.w / 2, y: row0 ? r.y + r.h + 22 : r.y - 4 }, text: 'miss · 100 ns', color: SIG.heavy, dur: 1.2 });
  }

  private askGrid(m: Machine) {
    const e = m.peek();
    if (e == null || !this.game) return;
    const hit = m.wouldHit(e);
    const name = this.elemName(e);
    const line = m.lineOf(e);
    const lineName = this.lineName(line);
    this.asking = { m: m.id, e };
    const everCached = m.evicted.some((x) => x.line === line);
    this.game.ask({
      acceptable: [hit ? 'hit' : 'miss'],
      choices: [
        { id: 'hit', label: 'Hit: it’s in L1' },
        { id: 'miss', label: 'Miss: go to RAM' },
      ],
      ask: `${name}: hit or miss?`,
      explain: () => {
        if (hit) return `${name} lives in line ${lineName}, which is already in L1. Answered in about 1 ns.`;
        if (everCached) return `${lineName} was in L1 earlier, but it was the least recently used line when something new needed room, so it was evicted. Back to RAM: about 100 ns.`;
        if (this.cfg.order === 'colquiz') return `${name} sits ${this.ma.cols * 8} bytes past the last access, in line ${lineName}, which isn’t in L1. Miss: about 100 ns.`;
        return `Nothing has loaded line ${lineName} yet, so ${name} misses. The whole line comes in, 8 values, about 100 ns.`;
      },
      resolve: () => {
        this.asking = null;
        this.noAsk[m.id] = m.pos;
        this.freeAt[m.id] = this.t;
        this.rev++;
      },
    });
  }

  /** "a[37]" or "a[2][5]" */
  elemName(e: number) {
    if (this.cfg.dims === 2) return `a[${Math.floor(e / this.ma.cols)}][${e % this.ma.cols}]`;
    return `a[${e}]`;
  }

  /** "a[8..15]" or "a[1][0..7]" */
  lineName(line: number) {
    const e = line * PER_LINE;
    if (this.cfg.dims === 2) {
      const r = Math.floor(e / this.ma.cols);
      const c = e % this.ma.cols;
      return `a[${r}][${c}..${c + 7}]`;
    }
    return `a[${e}..${e + 7}]`;
  }

  addrOf(e: number) {
    return 0x1000 + e * 8;
  }

  private raceRestart() {
    if (!this.ma.finished || !this.mb.finished) return;
    if (this.raceHold < 0) {
      this.raceHold = this.t;
      this.rev++;
      return;
    }
    if (this.t - this.raceHold > 3.2) {
      this.restartPass();
    }
  }

  /* ---------------- chapter 1: the linked list ---------------- */

  private wallStart() {
    const W = this.wall;
    const k = W.k;
    const node = LIST[k];
    const cached = this.cfg.cache && W.cached.has(k);
    W.inLoad = true;
    W.hit = cached;
    W.loadT0 = this.t;
    W.loadNs = cached ? NS_HIT : NS_MISS;
    const label = `load ${hex(node.addr)}`;
    const back = `${node.value} · next ${k + 1 < LIST.length ? hex(LIST[k + 1].addr) : 'NULL'}`;
    const done = () => this.wallGot();
    if (cached) {
      const d = 0.11;
      this.send({
        from: 'core',
        to: 'cache',
        dur: d,
        color: SIG.req,
        onArrive: () => {
          this.fx({ kind: 'ring', at: { id: 'cache' }, color: SIG.res, size: 0.8 });
          this.send({ from: 'cache', to: 'core', dur: d, color: SIG.res, onArrive: done });
        },
      });
      return;
    }
    const total = NS_MISS * SPN.wall;
    if (this.cfg.cache) {
      const near = total * 0.07;
      const far = total * 0.43;
      this.send({
        from: 'core',
        to: 'cache',
        dur: near,
        color: SIG.req,
        onArrive: () => {
          if (this.orient === 'landscape') this.say('cache', 'miss', SIG.heavy, 0.9);
          this.send({
            from: 'cache',
            to: `node:${k}`,
            dur: far,
            color: SIG.req,
            label,
            onArrive: () =>
              this.send({
                from: `node:${k}`,
                to: 'cache',
                dur: far,
                color: SIG.res,
                label: back,
                onArrive: () => {
                  W.cached.add(k);
                  this.rev++;
                  this.send({ from: 'cache', to: 'core', dur: near, color: SIG.res, onArrive: done });
                },
              }),
          });
        },
      });
      return;
    }
    this.send({
      from: 'core',
      to: `node:${k}`,
      dur: total / 2,
      color: SIG.req,
      label,
      onArrive: () => this.send({ from: `node:${k}`, to: 'core', dur: total / 2, color: SIG.res, label: back, onArrive: done }),
    });
  }

  private wallGot() {
    const W = this.wall;
    W.inLoad = false;
    W.lastCycles = W.loadNs * 4;
    W.passNs += W.loadNs;
    W.waitNs += W.loadNs;
    W.workNs += 0.25;
    W.sum += LIST[W.k].value;
    this.rev++;
    this.after(0.2, () => this.wallNext());
  }

  private wallNext() {
    const W = this.wall;
    W.k++;
    if (W.k < LIST.length) {
      this.wallStart();
      return;
    }
    // With a cache, remember walk 1 (cold) and walk 2 (warm) separately; they
    // stay on screen through the flush and get refreshed by the next cycle.
    const next = [...W.passes];
    next[this.cfg.cache ? W.pass : 0] = W.passNs;
    W.passes = next;
    W.k = 0;
    W.passNs = 0;
    W.sum = 0;
    W.pass++;
    let pause = 0.9;
    if (this.cfg.cache && W.pass >= 2) {
      pause = 2.2;
      this.after(1.6, () => {
        W.cached.clear();
        W.pass = 0;
        if (this.orient === 'landscape') this.say('cache', 'cache flushed', SIG.text2, 1.2);
        this.rev++;
      });
    }
    this.rev++;
    this.after(pause, () => this.wallStart());
  }

  /** Cycles the core has been waiting on the current load. */
  wallCycles() {
    const W = this.wall;
    if (!W.inLoad) return W.lastCycles;
    const ns = W.hit ? Math.min(NS_HIT, (this.t - W.loadT0) / 0.22) : Math.min(NS_MISS, (this.t - W.loadT0) / SPN.wall);
    return Math.round(ns * 4);
  }

  /* ---------------- chapter 2: the hierarchy ---------------- */

  private ladStart() {
    const L = this.lad;
    const level = L.queue.shift() ?? LEVEL_IDS[L.cycle++ % LEVEL_IDS.length];
    L.level = level;
    L.busy = true;
    L.t0 = this.t;
    L.ns = LEVELS[level].ns;
    const one = (L.ns / 2) * SPN.ladder;
    this.rev++;
    this.send({
      from: 'core',
      to: level,
      dur: one,
      color: SIG.req,
      r: 4,
      onArrive: () => {
        this.fx({ kind: 'ring', at: { id: level }, color: level === 'ram' ? SIG.heavy : SIG.res, size: level === 'ram' ? 1.4 : 0.8 });
        this.send({
          from: level,
          to: 'core',
          dur: one,
          color: SIG.res,
          r: 4,
          onArrive: () => {
            L.last = { level, ns: L.ns };
            L.busy = false;
            this.rev++;
            this.after(L.queue.length ? 0.35 : 0.9, () => this.ladStart());
          },
        });
      },
    });
  }

  /** Nanoseconds elapsed on the load in flight (or the last one). */
  ladElapsed() {
    const L = this.lad;
    if (L.busy) return Math.min(L.ns, (this.t - L.t0) / SPN.ladder);
    return L.last?.ns ?? 0;
  }

  /* ---------------- chapter 6: the capacity cliff ---------------- */

  private clStart() {
    const C = this.cl;
    const mix = levelMix(this.cfg.ws);
    const r = C.rng();
    let acc = 0;
    let level: LevelId = 'ram';
    for (let i = 0; i < 4; i++) {
      acc += mix[i];
      if (r < acc) {
        level = LEVEL_IDS[i];
        break;
      }
    }
    C.level = level;
    C.busy = true;
    const ns = LEVELS[level].ns;
    const one = (ns / 2) * SPN.cliff;
    this.send({
      from: 'core',
      to: level,
      dur: one,
      color: SIG.req,
      r: 3.6,
      onArrive: () => {
        if (level !== 'l1') this.fx({ kind: 'ring', at: { id: level }, color: level === 'ram' ? SIG.heavy : SIG.res, size: 0.7 });
        this.send({
          from: level,
          to: 'core',
          dur: one,
          color: SIG.res,
          r: 3.6,
          onArrive: () => {
            C.counts[level]++;
            C.n++;
            C.ns += ns;
            C.busy = false;
            this.rev++;
            this.after(level === 'l1' ? 0.05 : 0.12, () => this.clStart());
          },
        });
      },
    });
  }

  wsIndex() {
    return Math.max(0, WS_STEPS.indexOf(this.cfg.ws));
  }

  /* ---------------- chapter 7: many cores ---------------- */

  private hop(from: string, to: string, color: string, label: string | undefined, ns: number, then?: () => void) {
    this.send({ from, to, dur: ns * SPN.cores, color, label, r: 4, onArrive: then });
  }

  private coStart() {
    this.co.t0 = this.t;
    this.co.cnt = [0, 0];
    if (this.cfg.cores === 'coherence') this.coAct(0);
    else if (this.cfg.cores === 'packed') this.fsBurst();
  }

  private setMesi(m: [Mesi, Mesi]) {
    const C = this.co;
    C.mesi = m;
    C.had = [C.had[0] || m[0] !== 'I', C.had[1] || m[1] !== 'I'];
  }

  /** The scripted MESI walk-through, one act at a time. */
  private coAct(i: number) {
    const C = this.co;
    C.act = i;
    this.rev++;
    const next = (pause: number) => this.after(pause, () => this.coAct(i + 1));
    switch (i) {
      case 0:
        C.mesi = ['I', 'I'];
        C.had = [false, false];
        C.l3 = false;
        C.x = { c0: null, c1: null, l3: null, ram: 0 };
        C.log = 'x = 0 lives in RAM. Neither core has a copy.';
        next(1.2);
        return;
      case 1:
        C.log = 'Core 0 reads x: misses L1 and L3, fetches the line from RAM.';
        this.hop('core', 'l1', SIG.req, 'read x', 8, () =>
          this.hop('l1', 'l3', SIG.req, undefined, 14, () =>
            this.hop('l3', 'ram', SIG.req, undefined, 30, () =>
              this.hop('ram', 'l3', SIG.res, 'x = 0', 30, () => {
                C.l3 = true;
                C.x.l3 = 0;
                this.rev++;
                this.hop('l3', 'l1', SIG.res, undefined, 14, () => {
                  this.setMesi(['E', C.mesi[1]]);
                  C.x.c0 = 0;
                  C.log = 'Core 0 holds the only copy: Exclusive (E).';
                  this.rev++;
                  this.hop('l1', 'core', SIG.res, undefined, 8, () => next(1.4));
                });
              }),
            ),
          ),
        );
        return;
      case 2:
        C.log = 'Core 1 reads x: its L1 misses, L3 has the line.';
        this.hop('core:1', 'l1:1', SIG.req, 'read x', 8, () =>
          this.hop('l1:1', 'l3', SIG.req, undefined, 14, () => {
            this.hop('l3', 'l1', SIG.hc, 'now shared', 14, () => {
              this.setMesi(['S', C.mesi[1]]);
              this.rev++;
            });
            this.hop('l3', 'l1:1', SIG.res, 'x = 0', 14, () => {
              this.setMesi([C.mesi[0], 'S']);
              C.x.c1 = 0;
              C.log = 'Both cores hold a clean copy: Shared (S).';
              this.rev++;
              this.hop('l1:1', 'core:1', SIG.res, undefined, 8, () => next(1.4));
            });
          }),
        );
        return;
      case 3:
        C.log = 'Core 0 writes x = 1. First, every other copy must go.';
        this.hop('core', 'l1', SIG.heavy, 'x = 1', 8, () =>
          this.hop('l1', 'l3', SIG.hc, 'invalidate', 14, () =>
            this.hop('l3', 'l1:1', SIG.hc, 'invalidate', 14, () => {
              this.setMesi([C.mesi[0], 'I']);
              C.x.c1 = null;
              C.log = 'Core 1’s copy is now Invalid (I).';
              this.rev++;
              this.hop('l1:1', 'l3', SIG.hc, 'ack', 14, () =>
                this.hop('l3', 'l1', SIG.hc, 'ack', 14, () => {
                  this.setMesi(['M', 'I']);
                  C.x.c0 = 1;
                  C.log = 'Core 0 writes: Modified (M). RAM is now stale.';
                  this.rev++;
                  next(1.6);
                }),
              );
            }),
          ),
        );
        return;
      case 4:
        C.log = 'Core 1 reads x again: miss. Core 0 must hand over its dirty line.';
        this.hop('core:1', 'l1:1', SIG.req, 'read x', 8, () =>
          this.hop('l1:1', 'l3', SIG.req, undefined, 14, () =>
            this.hop('l3', 'l1', SIG.hc, 'give it up', 14, () =>
              this.hop('l1', 'l3', SIG.res, 'x = 1', 14, () => {
                this.setMesi(['S', 'I']);
                C.x.l3 = 1;
                this.rev++;
                this.hop('l3', 'l1:1', SIG.res, 'x = 1', 14, () => {
                  this.setMesi(['S', 'S']);
                  C.x.c1 = 1;
                  C.log = 'Both Shared again, both see x = 1.';
                  this.rev++;
                  this.hop('l1:1', 'core:1', SIG.res, undefined, 8, () => next(2.6));
                });
              }),
            ),
          ),
        );
        return;
      default:
        this.coAct(0);
    }
  }

  /* ---- false sharing: the line ping-pongs between the cores ---- */

  private fsBurst() {
    const C = this.co;
    const who = C.owner;
    let n = 0;
    const one = () => {
      C.cnt[who]++;
      n++;
      this.rev++;
      this.after(NS_HIT * SPN.cores, n < BURST ? one : () => this.fsTransfer());
    };
    one();
  }

  private fsTransfer() {
    const C = this.co;
    const from = C.owner;
    const to: 0 | 1 = from === 0 ? 1 : 0;
    const go = () => this.fsMove(from, to);
    if (this.game && !this.game.done) {
      const q = C.asked % 2 === 0 ? 1 : 2;
      C.asked++;
      this.asking = { fs: q };
      const reqName = to === 1 ? 'Core 1' : 'Core 0';
      const ownName = from === 0 ? 'core 0' : 'core 1';
      const mine = to === 1 ? 'b' : 'a';
      if (q === 1) {
        this.game.ask({
          acceptable: ['inval'],
          choices: [
            { id: 'keep', label: `Nothing: ${mine} isn’t its variable` },
            { id: 'inval', label: 'Invalidated: the whole line goes' },
          ],
          ask: `${reqName} writes ${mine}. What happens to ${ownName}’s copy?`,
          explain: (p) =>
            p === 'keep'
              ? `Coherence tracks whole 64-byte lines, not variables. To write ${mine}, ${reqName.toLowerCase()} needs the line exclusively, so ${ownName}’s copy is invalidated even though it only ever touches the other counter.`
              : `The cache tracks whole lines. ${reqName} needs the line exclusively to write ${mine}, so ${ownName}’s copy is invalidated and the line moves over.`,
          resolve: () => {
            this.asking = null;
            go();
          },
        });
      } else {
        this.game.ask({
          acceptable: ['fetch'],
          choices: [
            { id: 'hit', label: `In its own L1: a hit` },
            { id: 'fetch', label: 'Gone: fetch it from the other core' },
          ],
          ask: `${reqName} wants to write ${mine} again. Where’s the line?`,
          explain: (p) =>
            p === 'hit'
              ? `Its copy was invalidated when the other core wrote. The line has to come back across the chip: another 40 ns or so.`
              : `Its copy was invalidated by the other core’s write, so it has to win the line back: another trip across the chip. Every write steals the line.`,
          resolve: () => {
            this.asking = null;
            go();
          },
        });
      }
      return;
    }
    go();
  }

  private fsMove(from: 0 | 1, to: 0 | 1) {
    const C = this.co;
    const req = to === 0 ? 'l1' : 'l1:1';
    const own = from === 0 ? 'l1' : 'l1:1';
    C.xfer = { from, vt: this.vt };
    this.hop(req, 'l3', SIG.hc, 'want to write', 10, () =>
      this.hop('l3', own, SIG.hc, 'invalidate', 10, () => {
        this.setMesi(from === 0 ? ['I', C.mesi[1]] : [C.mesi[0], 'I']);
        this.rev++;
        this.hop(own, 'l3', SIG.res, 'line', 10, () =>
          this.hop('l3', req, SIG.res, 'line', 10, () => {
            this.setMesi(to === 0 ? ['M', 'I'] : ['I', 'M']);
            C.owner = to;
            C.transfers++;
            C.xfer = null;
            this.rev++;
            this.fsBurst();
          }),
        );
      }),
    );
  }

  private paddedTick(dt: number) {
    const C = this.co;
    C.acc += dt;
    const inc = NS_HIT * SPN.cores;
    let changed = false;
    while (C.acc >= inc) {
      C.acc -= inc;
      C.cnt = [C.cnt[0] + 1, C.cnt[1] + 1];
      changed = true;
    }
    if (changed) this.rev++;
  }

  /** Nanoseconds of machine time per increment, per thread, measured so far. */
  nsPerInc(): number | null {
    const C = this.co;
    const n = Math.min(C.cnt[0], C.cnt[1]);
    if (n < 4) return null;
    return (this.t - C.t0) / SPN.cores / Math.max(C.cnt[0], C.cnt[1]);
  }

  /** Machine nanoseconds since the counters started. */
  coreNs() {
    return (this.t - this.co.t0) / SPN.cores;
  }
}
