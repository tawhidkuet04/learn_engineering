import { SIG } from '@/lib/sim/colors';
import { clamp, damp, lerp, smoothstep } from '@/lib/sim/geometry';
import { PredictGame } from '@/lib/sim/predict';
import { Sim, type ScriptEvent, type WireSpec } from '@/lib/sim/Sim';
import { SORT_ITEMS, SYMPTOMS, TRACE_HOPS, type BreakKind, type Symptom } from './content';
import {
  APPS,
  BLOCK_LAYER,
  LAYERS,
  build,
  blockBytes,
  isHollow,
  receiverFor,
  unitName,
  type AppKind,
  type BlockKind,
  type Built,
  type LayerN,
  type LinkKind,
  type ModelKind,
} from './model';

export type DevId = 'alice' | 'sw' | 'rt' | 'srv' | 'ref';
export type ViewKind = 'stack' | 'path' | 'single' | 'chain';
export type PredictKind = 'headers' | 'hops' | 'symptoms';
export type Act = 'encap' | 'rx' | 'read' | 'tx' | 'strip' | 'route' | 'reframe' | 'decap';

export interface TripSpec {
  /** Waypoint where the trip starts, e.g. 'alice.7' */
  from: string;
  /** Waypoint where it stops, e.g. 'srv.7' */
  to: string;
  loop?: boolean;
  /** Speed multiplier for dwell and travel */
  pace?: number;
  /** Seconds to wait at the end before looping */
  pause?: number;
  /** Seconds before the first move */
  delay?: number;
}

export interface OsiConfig {
  view: ViewKind;
  model: ModelKind;
  app: AppKind;
  link: LinkKind;
  trip: TripSpec | null;
  ttl: number;
}

export const DEFAULTS: OsiConfig = { view: 'stack', model: 'osi', app: 'http', link: 'ethernet', trip: null, ttl: 64 };

export interface Waypoint {
  dev: DevId;
  layer: LayerN;
  act: Act;
}

export interface Block {
  key: number;
  kind: BlockKind;
  /** vt when it appeared */
  born: number;
  /** vt when it started leaving */
  dead: number | null;
  /** Offset from the unit's left edge and drawn width (scale-1 px), laid out every frame */
  x: number;
  w: number;
  /** Eased room the block takes in the row (width + gap): grows on insert, collapses on removal */
  space: number;
  /** Which hop's values (for L2) */
  seg: 0 | 1;
  /** Encrypted payload (TLS) */
  enc: boolean;
}

export interface Col {
  dev: DevId;
  cx: number;
  w: number;
  layers: LayerN[];
  /** Hosts in the path view: layers 4–7 share one slot */
  collapsed: boolean;
}

export interface Geo {
  view: ViewKind;
  cols: Col[];
  pitch: number;
  rowH: number;
  /** Center y of the bottom (layer 1) slot */
  y1: number;
  /** Sprite drawn with labels and byte counts */
  big: boolean;
  scale: number;
}

export interface SpriteView {
  x: number;
  y: number;
  align: number;
  dev: DevId;
  layer: LayerN;
  alpha: number;
}

export interface WireView {
  x0: number;
  x1: number;
  y: number;
  /** 0..1 progress of the bit train */
  k: number;
  radio: boolean;
  lostAt: number | null;
}

export interface TraceRow {
  ttl: number;
  ip: string;
  ms: [number, number, number];
}

const BASE_W: Record<BlockKind, number> = { app: 100, tls: 52, tcp: 64, udp: 56, ip: 64, eth: 64, wifi: 78, fcs: 40 };
const APP_W: Record<AppKind, number> = { http: 100, https: 100, smtp: 90, dns: 80, video: 120 };
const GAP = 3;
const SPRITE_GAP_PORTRAIT = 7;
/** Landscape stack view: room outside each stack for the rail that shows where each layer runs. */
export const RAIL_W = 20;

export function blockWidth(k: BlockKind, app: AppKind) {
  return k === 'app' ? APP_W[app] : BASE_W[k];
}

/** Width of the largest frame for these settings, used to scale the sprite once per trip. */
function fullWidth(app: AppKind, link: LinkKind) {
  const kinds: BlockKind[] = [link === 'wifi' ? 'wifi' : 'eth', 'ip', APPS[app].l4, ...(app === 'https' ? (['tls'] as BlockKind[]) : []), 'app', 'fcs'];
  return kinds.reduce((s, k) => s + blockWidth(k, app), 0) + GAP * (kinds.length - 1);
}

export class OsiSim extends Sim {
  cfg: OsiConfig = { ...DEFAULTS };
  g: Geo = { view: 'stack', cols: [], pitch: 56, rowH: 48, y1: 500, big: true, scale: 1 };
  game: PredictGame | null = null;
  predictKind: PredictKind | null = null;

  /* ---- the journey ---- */
  path: Waypoint[] = [];
  private i0 = 0;
  private i1 = 0;
  /** Index of the waypoint the data unit is at (or leaving) */
  at = 0;
  moving: { to: number; k: number; dur: number } | null = null;
  private nextAt: number | null = null;
  tripDone = false;
  private tripSpec: TripSpec | null = null;
  /** The first waypoint's act runs after the start delay. */
  private pendingArrive = false;
  runs = 0;

  /* ---- the data unit ---- */
  blocks: Block[] = [];
  private blockSeq = 1;
  bits = false;
  bitsK = 0;
  /** Eased total width of the unit (scale-1 px) */
  spriteW = 0;
  ttl = 64;
  seg: 0 | 1 = 0;
  syn = false;
  /** Block being read or changed right now */
  hot: BlockKind | null = null;
  hotVt = 0;
  lastAdded: BlockKind | null = null;
  lastRemoved: BlockKind | null = null;
  lastAct: { dev: DevId; layer: LayerN; act: Act; vt: number } | null = null;
  delivered = 0;
  /** Set when the unit reaches the top of the receiver's stack */
  deliveredTo: string | null = null;
  dead: { dev: DevId; layer: LayerN; why: string } | null = null;
  wireLost: number | null = null;
  swPhase: 'idle' | 'lookup' | 'sent' = 'idle';
  rtPhase: 'idle' | 'check' | 'route' | 'frame' | 'sent' | 'expired' | 'noroute' = 'idle';
  modelK = 0;
  /** Where the peer-line labels sit across the lane (0..1), eased away from the data unit */
  peerK = 0.78;
  flashes = new Map<string, { vt: number; color: string }>();

  /* ---- learner modes ---- */
  selected: LayerN | null = null;
  broken: BreakKind | null = null;
  symptom: Symptom | null = null;
  private symIdx = 0;
  /** Symptom game: ask the next question once this run has failed */
  private symNext = false;
  sortIdx = 0;
  sortPlaced: { id: string; label: string; home: LayerN; picked: LayerN; ok: boolean; vt: number }[] = [];
  sortLast: { ok: boolean; text: string; key: number } | null = null;
  trace: TraceRow[] = [];
  traceBusy = false;
  traceProbe: { ttl: number; result: string; ok: boolean } | null = null;
  private traceAuto: number[] = [];
  pgStats = { dns: false, httpsWifi: false, ttl: false };

  constructor() {
    super();
    this.syncBoxes();
  }

  /* ================================================================ */
  /* Steps                                                            */
  /* ================================================================ */

  enter(cfg: OsiConfig, script: ScriptEvent<OsiSim>[] = [], opts: { reset?: boolean; predict?: { kind: PredictKind; needed: number } } = {}) {
    const viewChanged = cfg.view !== this.cfg.view;
    this.cfg = { ...cfg };
    this.clearTransient();
    this.flashes.clear();
    this.selected = null;
    this.broken = null;
    this.symptom = null;
    this.dead = null;
    this.wireLost = null;
    this.swPhase = 'idle';
    this.rtPhase = 'idle';
    this.trace = [];
    this.traceBusy = false;
    this.traceProbe = null;
    this.traceAuto = [];
    this.sortIdx = 0;
    this.sortPlaced = [];
    this.sortLast = null;
    this.symIdx = 0;
    this.symNext = false;
    this.pgStats = { dns: false, httpsWifi: false, ttl: false };
    if (opts.reset) this.delivered = 0;
    this.predictKind = opts.predict?.kind ?? null;
    this.game = opts.predict ? new PredictGame(this, opts.predict.needed) : null;
    this.syncBoxes();
    this.relayout();
    if (viewChanged) this.rev++;
    this.path = this.buildPath();
    this.stopTrip();
    if (cfg.trip) this.startTrip(cfg.trip);
    if (this.predictKind === 'symptoms') this.after(0.8, () => this.askSymptom());
    this.runScript(script);
    this.rev++;
  }

  /* ---------------- settings the learner can change ---------------- */

  setLink(link: LinkKind) {
    if (link === this.cfg.link) return;
    this.cfg = { ...this.cfg, link };
    this.restartTrip();
  }

  setApp(app: AppKind) {
    if (app === this.cfg.app) return;
    this.cfg = { ...this.cfg, app };
    this.restartTrip();
  }

  setModel(model: ModelKind) {
    this.cfg = { ...this.cfg, model };
    this.rev++;
  }

  setView(view: ViewKind) {
    if (view === this.cfg.view) return;
    this.cfg = { ...this.cfg, view };
    this.syncBoxes();
    this.relayout();
    this.path = this.buildPath();
    this.restartTrip();
  }

  setTtl(ttl: number) {
    this.cfg = { ...this.cfg, ttl };
    this.rev++;
  }

  /** Send a fresh data unit along the current trip. */
  sendAgain() {
    this.restartTrip();
  }

  /** Break one layer and send a request to see where it dies. */
  breakLayer(kind: BreakKind | null) {
    this.broken = kind;
    this.symptom = kind ? (SYMPTOMS.find((s) => s.id === kind) ?? null) : null;
    this.restartTrip();
  }

  /* ---------------- inspect ---------------- */

  select(layer: LayerN | null) {
    this.selected = layer;
    if (layer) this.flash(`alice.${layer}`, LAYERS[layer].color);
    this.rev++;
  }

  /* ---------------- sorting game ---------------- */

  get sortItem() {
    return SORT_ITEMS[this.sortIdx] ?? null;
  }

  sortAnswer(layer: LayerN) {
    const item = this.sortItem;
    if (!item) return;
    const ok = item.accept.includes(layer);
    this.sortPlaced.push({ id: item.id, label: item.label, home: item.home, picked: layer, ok, vt: this.vt });
    this.sortLast = { ok, text: ok ? item.why : `Not layer ${layer}. ${item.why}`, key: this.sortPlaced.length };
    this.flash(`ref.${item.home}`, ok ? SIG.res : SIG.err);
    this.sortIdx++;
    this.rev++;
  }

  sortRestart() {
    this.sortIdx = 0;
    this.sortPlaced = [];
    this.sortLast = null;
    this.rev++;
  }

  get sortScore() {
    return this.sortPlaced.filter((p) => p.ok).length;
  }

  /* ---------------- traceroute ---------------- */

  startTraceroute() {
    this.trace = [];
    this.traceAuto = [1, 2, 3, 4, 5];
    this.nextAutoProbe();
  }

  private nextAutoProbe() {
    const ttl = this.traceAuto.shift();
    if (ttl == null) return;
    this.sendProbe(ttl, true);
  }

  /** Send one probe with this TTL down the chain. */
  sendProbe(ttl: number, auto = false) {
    if (this.traceBusy) return;
    if (!auto) this.traceAuto = [];
    this.traceBusy = true;
    this.traceProbe = null;
    this.rev++;
    this.probeHop('c.alice', 0, ttl, ttl, auto);
  }

  private probeHop(from: string, hopIdx: number, ttl: number, ttl0: number, auto: boolean) {
    const hop = TRACE_HOPS[hopIdx];
    this.send({
      from,
      to: hop.id,
      dur: 0.5,
      color: SIG.req,
      label: `TTL ${ttl}`,
      onArrive: () => {
        if (hop.id === 'c.srv') {
          this.fx({ kind: 'ring', at: { id: hop.id }, color: SIG.res });
          this.note(hop.id, 'nothing on port 33434', SIG.hc);
          this.icmpBack(hopIdx, 'port unreachable', ttl0, auto, true);
          return;
        }
        const left = ttl - 1;
        if (left <= 0) {
          this.fx({ kind: 'x', at: { id: hop.id }, color: SIG.err, size: 1.3 });
          this.note(hop.id, 'TTL 1 → 0: drop', SIG.err);
          this.icmpBack(hopIdx, 'time exceeded', ttl0, auto, false);
          return;
        }
        this.note(hop.id, `TTL ${ttl} → ${left}`, SIG.warn, 1);
        this.probeHop(hop.id, hopIdx + 1, left, ttl0, auto);
      },
    });
  }

  private icmpBack(hopIdx: number, label: string, ttl0: number, auto: boolean, reached: boolean) {
    const ids = ['c.alice', ...TRACE_HOPS.map((h) => h.id)];
    const hop = TRACE_HOPS[hopIdx];
    const back = (i: number) => {
      if (i <= 0) {
        if (auto && !this.trace.some((r) => r.ttl === ttl0)) this.trace.push({ ttl: ttl0, ip: hop.ip, ms: hop.ms });
        this.trace.sort((a, b) => a.ttl - b.ttl);
        this.traceProbe = reached
          ? { ttl: ttl0, ok: true, result: `Reached shop.example (${hop.ip}) at hop ${hopIdx + 1}. It answered “port unreachable”, which tells traceroute it’s done.` }
          : { ttl: ttl0, ok: false, result: `Expired at hop ${hopIdx + 1}, ${hop.ip} (${hop.name}), which sent back ICMP “time exceeded”.` };
        this.traceBusy = false;
        this.rev++;
        if (auto) this.after(0.4, () => this.nextAutoProbe());
        return;
      }
      this.send({ from: ids[i], to: ids[i - 1], dur: 0.32, color: SIG.hc, label: i === hopIdx + 1 ? label : undefined, lane: -5, onArrive: () => back(i - 1) });
    };
    back(hopIdx + 1);
  }

  /* ---------------- stage clicks ---------------- */

  /** A layer row on the stage was clicked. */
  rowClick(dev: DevId, layer: LayerN) {
    const q = this.game?.pending;
    if (q && this.predictKind === 'symptoms') {
      this.game!.answer(String(layer));
      return;
    }
    if (dev === 'ref' && this.sortItem) {
      this.sortAnswer(layer);
      return;
    }
    if (dev === 'alice') this.select(layer);
  }

  /* ================================================================ */
  /* Boxes and layout                                                 */
  /* ================================================================ */

  private devsFor(view: ViewKind): DevId[] {
    if (view === 'path') return ['alice', 'sw', 'rt', 'srv'];
    if (view === 'single') return ['ref'];
    if (view === 'chain') return [];
    return ['alice', 'srv'];
  }

  static layersOf(dev: DevId): LayerN[] {
    if (dev === 'sw') return [2, 1];
    if (dev === 'rt') return [3, 2, 1];
    return [7, 6, 5, 4, 3, 2, 1];
  }

  private syncBoxes() {
    const want = new Set<string>();
    if (this.cfg.view === 'chain') {
      want.add('c.alice');
      for (const h of TRACE_HOPS) want.add(h.id);
    } else {
      for (const dev of this.devsFor(this.cfg.view)) {
        want.add(dev);
        for (const L of OsiSim.layersOf(dev)) want.add(`${dev}.${L}`);
      }
    }
    for (const id of want) this.box(id);
    for (const id of [...this.boxes.keys()]) if (!want.has(id)) this.hide(id);
  }

  protected layout() {
    const { w, h } = this;
    const land = this.orient === 'landscape';
    const view = this.cfg.view;
    const cols: Col[] = [];
    let pitch = 56;
    let rowH = 48;
    let y1 = h - 160;
    let big = land;
    let scale = 1;
    const full = fullWidth(this.cfg.app, this.cfg.link);

    if (view === 'stack' || view === 'single') {
      if (land) {
        const top = 104;
        pitch = clamp((h - 138 - top) / 7, 42, 72);
        rowH = pitch - 11;
        y1 = top + 6 * pitch + rowH / 2;
        if (view === 'stack') {
          // The outer edge of each stack holds the rail that shows where each layer runs.
          const edge = 24 + RAIL_W;
          const cw = clamp(w * 0.235, 186, 236);
          cols.push({ dev: 'alice', cx: edge + cw / 2, w: cw, layers: OsiSim.layersOf('alice'), collapsed: false });
          cols.push({ dev: 'srv', cx: w - edge - cw / 2, w: cw, layers: OsiSim.layersOf('srv'), collapsed: false });
          const lane = w - 2 * edge - 2 * cw;
          scale = Math.min(1, (lane - 30) / full);
        } else {
          const cw = clamp(w * 0.27, 220, 270);
          cols.push({ dev: 'ref', cx: Math.max(40 + cw / 2, w * 0.3), w: cw, layers: OsiSim.layersOf('ref'), collapsed: false });
        }
      } else {
        const top = 88;
        pitch = clamp((h - 172 - top) / 7, 34, 50);
        rowH = pitch - 5;
        y1 = top + 6 * pitch + rowH / 2;
        big = false;
        if (view === 'stack') {
          const cw = clamp(w * 0.27, 92, 104);
          cols.push({ dev: 'alice', cx: 8 + cw / 2, w: cw, layers: OsiSim.layersOf('alice'), collapsed: false });
          cols.push({ dev: 'srv', cx: w - 8 - cw / 2, w: cw, layers: OsiSim.layersOf('srv'), collapsed: false });
          const lane = w - 16 - 2 * cw;
          scale = Math.min(0.62, (lane - 2 * SPRITE_GAP_PORTRAIT - 4) / full);
        } else {
          const cw = clamp(w * 0.42, 140, 170);
          cols.push({ dev: 'ref', cx: 8 + cw / 2, w: cw, layers: OsiSim.layersOf('ref'), collapsed: false });
        }
      }
    } else if (view === 'path') {
      if (land) {
        const hw = clamp(w * 0.17, 140, 176);
        const dw = clamp(w * 0.125, 104, 124);
        pitch = clamp((h - 420) / 4, 50, 66);
        rowH = pitch - 10;
        y1 = h - 178;
        const aR = 22 + hw;
        const sL = w - 22 - hw;
        cols.push({ dev: 'alice', cx: 22 + hw / 2, w: hw, layers: OsiSim.layersOf('alice'), collapsed: true });
        cols.push({ dev: 'sw', cx: lerp(aR, sL, 0.29), w: dw, layers: OsiSim.layersOf('sw'), collapsed: false });
        cols.push({ dev: 'rt', cx: lerp(aR, sL, 0.71), w: dw, layers: OsiSim.layersOf('rt'), collapsed: false });
        cols.push({ dev: 'srv', cx: w - 22 - hw / 2, w: hw, layers: OsiSim.layersOf('srv'), collapsed: true });
        scale = Math.min(0.66, (sL - aR) * 0.4 / full);
        big = false;
      } else {
        const hw = clamp(w * 0.215, 70, 84);
        const dw = clamp(w * 0.165, 54, 64);
        const gap = (w - 12 - 2 * hw - 2 * dw) / 3;
        pitch = 46;
        rowH = 40;
        y1 = h - 112;
        cols.push({ dev: 'alice', cx: 6 + hw / 2, w: hw, layers: OsiSim.layersOf('alice'), collapsed: true });
        cols.push({ dev: 'sw', cx: 6 + hw + gap + dw / 2, w: dw, layers: OsiSim.layersOf('sw'), collapsed: false });
        cols.push({ dev: 'rt', cx: 6 + hw + 2 * gap + dw * 1.5, w: dw, layers: OsiSim.layersOf('rt'), collapsed: false });
        cols.push({ dev: 'srv', cx: w - 6 - hw / 2, w: hw, layers: OsiSim.layersOf('srv'), collapsed: true });
        scale = Math.min(0.5, (w - 40) / full);
        big = false;
      }
    }

    this.g = { view, cols, pitch, rowH, y1, big, scale };
    for (const c of cols) {
      for (const L of c.layers) this.place(`${c.dev}.${L}`, c.cx, this.slotY(c, L), c.w, rowH);
      const top = this.colTop(c);
      this.place(c.dev, c.cx, top - 16, c.w, 22);
    }

    if (view === 'chain') {
      const ids = ['c.alice', ...TRACE_HOPS.map((t) => t.id)];
      if (land) {
        const x0 = 96;
        const x1 = w - 96;
        ids.forEach((id, i) => {
          const end = i === 0 || i === ids.length - 1;
          this.place(id, lerp(x0, x1, i / (ids.length - 1)), Math.round(h * 0.34), end ? 138 : 118, 46);
        });
      } else {
        const bw = Math.min(168, w * 0.46);
        const gap = clamp((h - 330) / (ids.length - 1), 44, 56);
        ids.forEach((id, i) => this.place(id, 12 + bw / 2, 92 + i * gap, bw, 38));
      }
    }
  }

  slotY(c: Col, L: LayerN) {
    const idx = c.collapsed && L >= 4 ? 3 : L - 1;
    return this.g.y1 - idx * this.g.pitch;
  }

  colTop(c: Col) {
    return this.slotY(c, c.layers[0]) - this.g.rowH / 2;
  }

  col(dev: DevId) {
    return this.g.cols.find((c) => c.dev === dev) ?? null;
  }

  protected wires(): WireSpec[] {
    if (this.cfg.view !== 'chain') return [];
    const ids = ['c.alice', ...TRACE_HOPS.map((t) => t.id)];
    return ids.slice(1).map((id, i) => ({ from: ids[i], to: id }));
  }

  /* ================================================================ */
  /* The journey                                                      */
  /* ================================================================ */

  private buildPath(): Waypoint[] {
    const p: Waypoint[] = [];
    const view = this.cfg.view;
    if (view !== 'stack' && view !== 'path') return p;
    for (let L = 7; L >= 1; L--) p.push({ dev: 'alice', layer: L as LayerN, act: 'encap' });
    if (view === 'path') {
      p.push({ dev: 'sw', layer: 1, act: 'rx' }, { dev: 'sw', layer: 2, act: 'read' }, { dev: 'sw', layer: 1, act: 'tx' });
      p.push({ dev: 'rt', layer: 1, act: 'rx' }, { dev: 'rt', layer: 2, act: 'strip' }, { dev: 'rt', layer: 3, act: 'route' });
      p.push({ dev: 'rt', layer: 2, act: 'reframe' }, { dev: 'rt', layer: 1, act: 'tx' });
    }
    p.push({ dev: 'srv', layer: 1, act: 'rx' });
    for (let L = 2; L <= 7; L++) p.push({ dev: 'srv', layer: L as LayerN, act: 'decap' });
    return p;
  }

  /** First waypoint matching 'dev.layer' at or after `from` (a router's layer 1 is visited twice). */
  private indexOf(ref: string, from = 0, fallback = 0) {
    const [dev, l] = ref.split('.');
    const layer = Number(l);
    const i = this.path.findIndex((w, j) => j >= from && w.dev === dev && w.layer === layer);
    return i < 0 ? fallback : i;
  }

  private stopTrip() {
    this.tripSpec = null;
    this.moving = null;
    this.nextAt = null;
    this.tripDone = true;
    this.blocks = [];
    this.bits = false;
    this.bitsK = 0;
    this.hot = null;
    this.lastAdded = null;
    this.lastRemoved = null;
    this.lastAct = null;
  }

  private startTrip(spec: TripSpec) {
    this.tripSpec = spec;
    this.swPhase = 'idle';
    this.rtPhase = 'idle';
    this.i0 = this.indexOf(spec.from);
    this.i1 = Math.max(this.i0, this.indexOf(spec.to, this.i0, this.path.length - 1));
    this.resetUnit();
    this.nextAt = this.t + (spec.delay ?? 0.5);
    this.at = this.i0;
    this.pendingArrive = true;
    this.rev++;
  }

  restartTrip() {
    this.clearTransient();
    this.dead = null;
    this.wireLost = null;
    this.swPhase = 'idle';
    this.rtPhase = 'idle';
    this.path = this.buildPath();
    this.relayout();
    if (this.cfg.trip) this.startTrip({ ...this.cfg.trip, delay: 0.35 });
    this.rev++;
  }

  private resetUnit() {
    this.blocks = [];
    this.bits = false;
    this.bitsK = 0;
    this.ttl = this.cfg.ttl;
    this.seg = 0;
    this.hot = null;
    this.lastAdded = null;
    this.lastRemoved = null;
    this.lastAct = null;
    this.moving = null;
    this.tripDone = false;
    this.dead = null;
    this.deliveredTo = null;
    this.wireLost = null;
    this.syn = this.broken === 'port';
    // Fast-forward everything before the start without animation.
    for (let i = 0; i < this.i0; i++) this.apply(i, false);
    this.snapBlocks();
  }

  get pace() {
    return this.tripSpec?.pace ?? 1;
  }

  /** A data unit is on the stage (a trip was started this step). */
  get tripSpecActive() {
    return !!this.tripSpec;
  }

  protected step(dt: number) {
    if (this.tripSpec && !this.tripDone) {
      if (this.moving) {
        const m = this.moving;
        m.k += dt / m.dur;
        const leg = this.legOf(this.at, m.to);
        if (leg === 'wire' && this.broken === 'cable' && this.path[this.at].dev === 'alice' && m.k >= 0.42) {
          this.wireLost = 0.42;
          this.moving = null;
          this.die('alice', 1, 'no carrier: the cable is unplugged');
          return;
        }
        // Two-stack view: the network in the middle holds at least one router, which drops a TTL-1 packet.
        if (leg === 'wire' && this.cfg.view === 'stack' && this.path[this.at].dev === 'alice' && this.ttl <= 1 && m.k >= 0.5) {
          const wv = this.wireView();
          this.wireLost = 0.5;
          this.moving = null;
          this.pgStats.ttl = true;
          this.die('rt', 3, 'TTL reached 0 at a router');
          if (wv) this.fx({ kind: 'text', at: { x: (wv.x0 + wv.x1) / 2, y: wv.y - 26 }, text: 'a router: TTL 1 → 0, dropped', color: SIG.err, dur: 3.2 });
          return;
        }
        if (m.k >= 1) {
          this.at = m.to;
          this.moving = null;
          this.arrive(this.at);
        }
      } else if (this.nextAt != null && this.t >= this.nextAt) {
        this.nextAt = null;
        if (this.pendingArrive) {
          this.pendingArrive = false;
          this.arrive(this.at);
        } else this.leave(this.at);
      }
    } else if (this.tripSpec?.loop && this.tripDone && this.nextAt != null && this.t >= this.nextAt) {
      this.nextAt = null;
      this.runs++;
      this.startTrip({ ...this.tripSpec, delay: 0.2 });
    }
  }

  legOf(a: number, b: number): 'wire' | 'up' | 'down' {
    const A = this.path[a];
    const B = this.path[b];
    if (!A || !B) return 'down';
    if (A.dev !== B.dev) return 'wire';
    return B.layer > A.layer ? 'up' : 'down';
  }

  private leave(i: number) {
    if (i >= this.i1) return;
    const leg = this.legOf(i, i + 1);
    let dur = 0.46 / this.pace;
    if (leg === 'wire') {
      const a = this.col(this.path[i].dev);
      const b = this.col(this.path[i + 1].dev);
      const len = a && b ? Math.abs(b.cx - a.cx) : 400;
      dur = clamp(len / 360, 0.7, 1.5) / this.pace;
      this.bits = true;
    }
    this.hot = null;
    this.moving = { to: i + 1, k: 0, dur };
    this.rev++;
  }

  private arrive(i: number) {
    const wp = this.path[i];
    if (!wp) return;
    if (this.maybeAsk(i)) return;
    this.act(i);
  }

  private act(i: number) {
    const dwell = this.apply(i, true);
    if (this.dead) return;
    if (i >= this.i1) {
      this.finish();
      return;
    }
    this.nextAt = this.t + dwell / this.pace;
  }

  private finish() {
    this.tripDone = true;
    this.rev++;
    this.queueSymptom();
    // A broken run holds its final state so the learner can read it.
    if (this.tripSpec?.loop && !this.broken) this.nextAt = this.t + (this.tripSpec.pause ?? 2.2);
  }

  /** In the symptom game, the next question comes a few seconds after a run ends. */
  private queueSymptom() {
    if (!this.symNext) return;
    this.symNext = false;
    this.after(3.4, () => this.askSymptom());
  }

  private die(dev: DevId, layer: LayerN, why: string) {
    this.queueSymptom();
    this.dead = { dev, layer, why };
    this.tripDone = true;
    this.moving = null;
    this.flash(`${dev}.${layer}`, SIG.err, 3);
    const b = this.boxes.get(`${dev}.${layer}`);
    if (b) this.fx({ kind: 'x', at: { id: `${dev}.${layer}`, dx: b.w / 2 - 14 }, color: SIG.err, size: 1.4, dur: 2.4 });
    this.rev++;
    if (this.tripSpec?.loop && !this.broken) this.nextAt = this.t + (this.tripSpec.pause ?? 2.2) + 1.2;
  }

  /* ---------------- what each layer does ---------------- */

  /** Apply the waypoint's act to the data unit. Returns the dwell time. */
  private apply(i: number, live: boolean): number {
    const wp = this.path[i];
    const { app } = this.cfg;
    const a = APPS[app];
    const https = app === 'https';
    if (live) this.lastAct = { dev: wp.dev, layer: wp.layer, act: wp.act, vt: this.vt };
    const mark = (k: BlockKind | null) => {
      if (!live) return;
      this.hot = k;
      this.hotVt = this.vt;
    };
    const flashRow = (color?: string) => live && this.flash(`${wp.dev}.${wp.layer}`, color ?? LAYERS[wp.layer].color);

    // Layers 5 and 6 are only boxes in the model unless TLS runs: the unit passes through without a flash.
    const hollow = isHollow(wp.layer, app);
    if (wp.act === 'encap') {
      if (!hollow) flashRow();
      switch (wp.layer) {
        case 7:
          if (live && this.broken === 'dns') {
            this.die('alice', 7, 'could not resolve host');
            return 0;
          }
          if (!this.syn) this.addBlock('app', 'end', live);
          mark('app');
          this.lastAdded = this.syn ? null : 'app';
          return 1.1;
        case 6:
          if (https && !this.syn) {
            if (live && this.broken === 'tls') {
              this.die('alice', 6, 'certificate has expired');
              return 0;
            }
            for (const b of this.blocks) if (b.kind === 'app') b.enc = true;
            this.addBlock('tls', 'front', live);
            mark('tls');
            this.lastAdded = 'tls';
            return 1.1;
          }
          return 0.3;
        case 5:
          return 0.3;
        case 4:
          this.addBlock(a.l4, 'front', live);
          mark(a.l4);
          this.lastAdded = a.l4;
          return 1.1;
        case 3:
          this.addBlock('ip', 'front', live);
          mark('ip');
          this.lastAdded = 'ip';
          return 1.1;
        case 2:
          if (live && this.broken === 'wifi') {
            this.die('alice', 2, 'not associated with an access point');
            return 0;
          }
          {
            const l2: BlockKind = this.cfg.link === 'wifi' ? 'wifi' : 'eth';
            this.addBlock(l2, 'front', live);
            this.addBlock('fcs', 'end', live);
            mark(l2);
            this.lastAdded = l2;
          }
          return 1.1;
        case 1:
          this.bits = true;
          this.lastAdded = null;
          mark(null);
          return 0.8;
      }
    }

    if (wp.act === 'rx') {
      this.bits = true;
      flashRow();
      if (!live) this.bitsK = 1;
      if (this.cfg.view === 'stack' && wp.dev === 'srv') {
        // The two-stack view hides the network in between. What reaches the server has
        // passed one router (new frame, TTL - 1) and, from Wi-Fi, an access point.
        const l2 = this.blocks.find((b) => (b.kind === 'wifi' || b.kind === 'eth') && b.dead == null);
        if (l2) {
          l2.kind = 'eth';
          l2.seg = 1;
        }
        this.seg = 1;
        this.ttl -= 1;
        this.snapBlocks();
      }
      return 0.3;
    }

    if (wp.act === 'tx') {
      this.bits = true;
      flashRow();
      if (wp.dev === 'sw') this.swPhase = 'sent';
      if (wp.dev === 'rt') this.rtPhase = 'sent';
      return 0.25;
    }

    if (wp.act === 'read') {
      // A switch reads the destination MAC, looks it up and forwards. Nothing changes.
      // With Wi-Fi this box is an access point: it also swaps the 802.11 header for Ethernet.
      this.bits = false;
      flashRow();
      this.swPhase = 'lookup';
      if (this.blocks.some((b) => b.kind === 'wifi' && b.dead == null)) {
        this.removeBlocks(['wifi'], live, 0.5);
        this.addBlock('eth', 'front', live);
        this.lastAdded = 'eth';
        mark('eth');
        if (live) this.sayBelow('sw', '802.11 → Ethernet, same MACs', LAYERS[2].color);
        return 1.9;
      }
      mark('eth');
      if (live) this.sayBelow('sw', 'dst MAC → out port Gi0/8', LAYERS[2].color);
      return 1.6;
    }

    if (wp.act === 'strip') {
      this.bits = false;
      flashRow();
      this.rtPhase = 'check';
      this.removeBlocks(['eth', 'wifi', 'fcs'], live, 0.4);
      this.lastRemoved = 'eth';
      mark('eth');
      return 1.2;
    }

    if (wp.act === 'route') {
      flashRow();
      mark('ip');
      if (live && this.broken === 'route') {
        this.rtPhase = 'noroute';
        this.die('rt', 3, 'no route to 203.0.113.0/24');
        this.send({ from: 'rt.3', to: 'alice.3', dur: 1.3, color: SIG.hc, label: 'ICMP net unreachable', lane: 0 });
        return 0;
      }
      this.ttl -= 1;
      if (this.ttl <= 0) {
        if (live) {
          this.rtPhase = 'expired';
          this.pgStats.ttl = true;
          this.die('rt', 3, 'TTL reached 0');
          this.send({ from: 'rt.3', to: 'alice.3', dur: 1.3, color: SIG.hc, label: 'ICMP time exceeded', lane: 0 });
        }
        return 0;
      }
      this.rtPhase = 'route';
      if (live) this.sayBelow('rt', `TTL ${this.ttl + 1} → ${this.ttl}`, SIG.warn);
      return 1.7;
    }

    if (wp.act === 'reframe') {
      flashRow();
      this.seg = 1;
      this.rtPhase = 'frame';
      this.addBlock('eth', 'front', live);
      this.addBlock('fcs', 'end', live);
      mark('eth');
      this.lastAdded = 'eth';
      return 1.5;
    }

    if (wp.act === 'decap') {
      if (!hollow) flashRow();
      switch (wp.layer) {
        case 2:
          this.bits = false;
          this.removeBlocks(['eth', 'wifi', 'fcs'], live, 0.4);
          this.lastRemoved = 'eth';
          mark('eth');
          return 1.1;
        case 3:
          this.removeBlocks(['ip'], live, 0.3);
          this.lastRemoved = 'ip';
          mark('ip');
          return 1.1;
        case 4:
          if (live && this.syn) {
            this.die('srv', 4, 'nothing listening on port 80');
            this.send({ from: 'srv.4', to: 'alice.4', dur: 1.5, color: SIG.err, label: 'TCP RST', lane: 0 });
            return 0;
          }
          this.removeBlocks(['tcp', 'udp'], live, 0.3);
          this.lastRemoved = a.l4;
          mark(a.l4);
          return 1.1;
        case 5:
          return 0.3;
        case 6:
          if (https) {
            this.removeBlocks(['tls'], live, 0.3);
            for (const b of this.blocks) if (b.kind === 'app') b.enc = false;
            this.lastRemoved = 'tls';
            mark('tls');
            return 1.1;
          }
          return 0.3;
        case 7:
          mark('app');
          if (live) {
            this.delivered++;
            if (this.cfg.app === 'dns') this.pgStats.dns = true;
            if (this.cfg.app === 'https' && this.cfg.link === 'wifi') this.pgStats.httpsWifi = true;
            const rx = receiverFor(this.cfg.app);
            this.deliveredTo = this.broken === 'app500' ? `${rx.proc} answered 500` : `delivered to ${rx.proc}`;
            if (this.broken === 'app500') {
              this.flash('srv.7', SIG.err, 3);
              this.send({ from: 'srv.7', to: 'alice.7', dur: 1.6, color: SIG.err, label: '500 Internal Server Error', lane: 0 });
            }
          }
          return 1.4;
      }
    }
    return 0.4;
  }

  private addBlock(kind: BlockKind, where: 'front' | 'end', live: boolean) {
    const b: Block = { key: this.blockSeq++, kind, born: live ? this.vt : -10, dead: null, x: 0, w: 0, space: 0, seg: this.seg, enc: false };
    if (where === 'front') this.blocks.unshift(b);
    else this.blocks.push(b);
    if (!live) this.snapBlocks();
    else this.layoutBlocks();
  }

  private removeBlocks(kinds: BlockKind[], live: boolean, delay: number) {
    for (const b of this.blocks) {
      if (kinds.includes(b.kind) && b.dead == null) {
        if (live) b.dead = this.vt + delay;
        else b.dead = -10;
      }
    }
    if (!live) this.blocks = this.blocks.filter((b) => b.dead == null);
  }

  /** Blocks still part of the unit (not flying away). */
  get liveBlocks() {
    return this.blocks.filter((b) => b.dead == null || b.dead > this.vt);
  }

  get outer(): BlockKind | null {
    const live = this.blocks.filter((b) => b.dead == null);
    return live[0]?.kind ?? null;
  }

  get unit() {
    if (!this.blocks.some((b) => b.dead == null)) return this.syn ? 'segment' : '—';
    return unitName(this.outer, this.bits);
  }

  get size() {
    const built = this.built();
    return this.blocks.filter((b) => b.dead == null).reduce((s, b) => s + (b.kind === 'wifi' ? built.l2.length : blockBytes(b.kind, built, b.enc)), 0);
  }

  /** The real bytes of the unit as it is right now. */
  built(seg: 0 | 1 = this.seg, ttl = this.ttl): Built {
    const wifi = this.blocks.some((b) => b.kind === 'wifi' && b.dead == null);
    return build(this.cfg.app, { seg, ttl: Math.max(0, ttl), link: wifi ? 'wifi' : 'ethernet' });
  }

  private snapBlocks() {
    for (const b of this.blocks) b.space = b.dead == null ? blockWidth(b.kind, this.cfg.app) + GAP : 0;
    this.layoutBlocks();
  }

  /**
   * Lay the blocks out in a row like flexbox. Each block takes up `space`,
   * which eases toward its full width, so a new header visibly pushes the
   * rest of the unit aside and a stripped one lets it close up.
   */
  private layoutBlocks(dt = 0) {
    let x = 0;
    for (const b of this.blocks) {
      const full = blockWidth(b.kind, this.cfg.app);
      const leaving = b.dead != null && this.vt >= b.dead;
      if (dt > 0) b.space = damp(b.space, leaving ? 0 : full + GAP, 11, dt);
      b.x = x;
      b.w = Math.max(0, Math.min(full, b.space - GAP));
      x += b.space;
    }
    this.spriteW = Math.max(0, x - GAP);
  }

  get spriteWidth() {
    const live = this.blocks.filter((b) => b.dead == null);
    if (!live.length) return 0;
    return live.reduce((s, b) => s + blockWidth(b.kind, this.cfg.app), 0) + GAP * (live.length - 1);
  }

  /** A floating note beside a chain node: above it in landscape, to its right in portrait. */
  private note(id: string, text: string, color: string, dur = 1.4) {
    const b = this.boxes.get(id);
    if (!b) return;
    if (this.orient === 'landscape') {
      this.say(id, text, color, dur);
      return;
    }
    const tw = text.length * 6.4 + 16;
    this.fx({ kind: 'text', at: { id, dx: b.w / 2 + 10 + tw / 2, dy: 10 }, text, color, dur: dur + 0.4 });
  }

  /** A floating note under a device column (path view), clear of titles and cards. */
  private sayBelow(dev: DevId, text: string, color: string) {
    if (!this.col(dev) || !this.boxes.get(`${dev}.1`)) return;
    this.fx({ kind: 'text', at: { id: `${dev}.1`, dy: this.g.rowH / 2 + 30 }, text, color, dur: 1.9 });
  }

  flash(id: string, color: string, dur = 1) {
    this.flashes.set(id, { vt: this.vt + dur - 1, color });
  }

  protected animate(dt: number) {
    this.blocks = this.blocks.filter((b) => b.dead == null || this.vt - b.dead < 0.7);
    this.layoutBlocks(dt);
    this.bitsK = damp(this.bitsK, this.bits ? 1 : 0, 7, dt);
    this.modelK = damp(this.modelK, this.cfg.model === 'tcpip' ? 1 : 0, 5, dt);
    const sv = this.cfg.view === 'stack' ? this.spriteView() : null;
    if (sv) this.peerK = damp(this.peerK, sv.dev === 'srv' ? 0.22 : 0.78, 4, dt);
    for (const [id, f] of this.flashes) if (this.vt - f.vt > 1.6) this.flashes.delete(id);
  }

  /* ---------------- where things are drawn ---------------- */

  /** Where the data unit is, for drawing. */
  spriteView(): SpriteView | null {
    // Lost on the wire: all that's left is the broken bit train.
    if (!this.tripSpec || !this.path.length || this.wireLost != null) return null;
    const m = this.moving;
    const A = this.path[this.at];
    if (!A) return null;
    if (m && this.legOf(this.at, m.to) === 'wire') return null;
    const B = m ? this.path[m.to] : A;
    const k = m ? smoothstep(clamp(m.k, 0, 1)) : 1;
    const col = this.col(A.dev);
    if (!col) return null;
    const layer = (k > 0.5 ? B.layer : A.layer) as LayerN;
    if (this.cfg.view === 'stack') {
      const y = lerp(this.slotY(col, A.layer), this.slotY(col, B.layer), k);
      const left = A.dev === 'alice';
      const gap = this.orient === 'landscape' ? 14 : SPRITE_GAP_PORTRAIT;
      return { x: left ? col.cx + col.w / 2 + gap : col.cx - col.w / 2 - gap, y, align: left ? 0 : 1, dev: A.dev, layer, alpha: 1 };
    }
    // path view: the unit floats above the device that holds it, all at one height
    const s = this.g.scale;
    const half = (this.spriteWidth * s) / 2;
    const x = clamp(col.cx, 10 + half, this.w - 10 - half);
    return { x, y: this.spriteRowY(), align: 0.5, dev: A.dev, layer, alpha: 1 };
  }

  /** Height of the floating data unit in the path view. */
  spriteRowY() {
    const tops = this.g.cols.map((c) => this.colTop(c));
    return (tops.length ? Math.min(...tops) : 300) - (this.orient === 'landscape' ? 46 : 54);
  }

  /** The bit train on the cable, when the unit is between two machines. */
  wireView(): WireView | null {
    const m = this.moving;
    const lost = this.wireLost;
    if ((!m || this.legOf(this.at, m.to) !== 'wire') && lost == null) return null;
    const A = this.path[this.at];
    const B = this.path[m ? m.to : this.at + 1];
    if (!A || !B) return null;
    const a = this.col(A.dev);
    const b = this.col(B.dev);
    if (!a || !b) return null;
    const y = this.slotY(a, 1);
    const radio = this.cfg.link === 'wifi' && A.dev === 'alice';
    return { x0: a.cx + a.w / 2, x1: b.cx - b.w / 2, y, k: m ? m.k : (lost ?? 0), radio, lostAt: lost };
  }

  /* ================================================================ */
  /* Predict games                                                    */
  /* ================================================================ */

  private maybeAsk(i: number): boolean {
    const g = this.game;
    if (!g || g.done || !this.predictKind) return false;
    const wp = this.path[i];
    const go = () => this.act(i);

    if (this.predictKind === 'headers' && wp.dev === 'alice' && wp.layer <= 4) {
      const choices = [
        { id: 'l4', label: 'Ports and sequence numbers' },
        { id: 'l3', label: 'IP addresses and a TTL' },
        { id: 'l2', label: 'MAC addresses and an FCS trailer' },
        { id: 'l1', label: 'No header: it turns it all into signals' },
      ];
      const L = wp.layer;
      const explain: Record<number, string> = {
        4: 'Transport adds the TCP header: source and destination ports, so the right program gets the data, plus sequence and ack numbers for reliability.',
        3: 'Network adds the IP header: source and destination IP addresses, plus a TTL that routers count down.',
        2: 'Data link adds the Ethernet header (destination and source MAC) and the only trailer in the stack: the FCS checksum.',
        1: 'Physical adds no header at all. It turns the finished frame into signals on the wire (after a short preamble).',
      };
      return g.ask({
        acceptable: [`l${L}`],
        choices,
        ask: `What does layer ${L} add?`,
        askAt: { id: `alice.${L}` },
        explain: () => explain[L],
        resolve: go,
      });
    }

    if (this.predictKind === 'hops') {
      // The frame has been received in full before anyone decides anything.
      if (wp.act === 'read' || wp.act === 'strip') this.bits = false;
      if (wp.dev === 'sw' && wp.act === 'read') {
        return g.ask({
          acceptable: ['mac'],
          choices: [
            { id: 'mac', label: 'Destination MAC' },
            { id: 'ip', label: 'Destination IP' },
            { id: 'port', label: 'Destination port' },
          ],
          ask: 'What does the switch read?',
          askAt: { id: 'sw' },
          explain: (p) =>
            p === 'mac'
              ? 'A switch only reads the frame. It looks up 0e:5a:c3:10:77:01 in its MAC table and sends the frame out port Gi0/8, unchanged.'
              : 'A switch never opens the packet inside the frame. It forwards on the destination MAC alone: 0e:5a:c3:10:77:01, out port Gi0/8.',
          resolve: go,
        });
      }
      if (wp.dev === 'rt' && wp.act === 'strip') {
        return g.ask({
          acceptable: ['macttl'],
          choices: [
            { id: 'macttl', label: 'The MACs and the TTL' },
            { id: 'dstip', label: 'The destination IP' },
            { id: 'nothing', label: 'Nothing, it just forwards' },
            { id: 'ports', label: 'The TCP ports' },
          ],
          ask: 'What will the router change?',
          askAt: { id: 'rt' },
          explain: (p) =>
            p === 'macttl'
              ? 'It throws the old frame away, counts the TTL down 64 → 63, and wraps the packet in a new frame with new MAC addresses. The IP addresses and ports ride through untouched.'
              : 'The router keeps the IP addresses and ports (no NAT here), but every hop gets a fresh frame with new MACs, and the TTL drops by one: 64 → 63.',
          resolve: go,
        });
      }
      if (wp.dev === 'rt' && wp.act === 'reframe') {
        const rx = receiverFor(this.cfg.app);
        return g.ask({
          acceptable: ['srv'],
          choices: [
            { id: 'srv', label: `The server’s MAC` },
            { id: 'self', label: 'The router’s own MAC' },
            { id: 'alice', label: 'Alice’s MAC' },
            { id: 'bcast', label: 'ff:ff:ff:ff:ff:ff' },
          ],
          ask: 'New frame: destination MAC?',
          askAt: { id: 'rt' },
          explain: () => `The server (${rx.ip}) is on the router’s eth1 network, so the next hop is the server itself. ARP gave its MAC: ${rx.mac}.`,
          resolve: go,
        });
      }
      if (wp.dev === 'srv' && wp.layer === 3) {
        return g.ask({
          acceptable: ['proto'],
          choices: [
            { id: 'proto', label: 'protocol = 6 in the IP header' },
            { id: 'port', label: 'Destination port 80' },
            { id: 'type', label: 'EtherType 0x0800' },
          ],
          ask: 'IP → which layer 4 protocol?',
          askAt: { id: 'srv' },
          explain: () => 'The IP header’s protocol field says what’s inside: 6 means TCP (17 would be UDP). The port is only read after that, by TCP itself.',
          resolve: go,
        });
      }
    }
    return false;
  }

  private askSymptom() {
    const g = this.game;
    const s = SYMPTOMS[this.symIdx % SYMPTOMS.length];
    this.symIdx++;
    this.symptom = s;
    this.broken = null;
    this.dead = null;
    this.stopTrip();
    this.rev++;
    const show = () => {
      this.broken = s.id;
      this.cfg = { ...this.cfg, app: s.id === 'tls' ? 'https' : 'http', link: s.id === 'wifi' ? 'wifi' : 'ethernet' };
      this.path = this.buildPath();
      this.symNext = true;
      this.startTrip({ from: 'alice.7', to: 'srv.7', pace: 2.4, delay: 0.3 });
    };
    if (g && !g.done) {
      g.ask({
        acceptable: s.accept.map(String),
        choices: [7, 6, 5, 4, 3, 2, 1].map((n) => ({ id: String(n), label: `${n} · ${LAYERS[n as LayerN].name}` })),
        ask: 'Which layer is broken?',
        explain: () => s.why,
        resolve: show,
      });
    } else {
      show();
    }
  }

  /** Blocks for the inspector, by layer. */
  static layerOfBlock(k: BlockKind): LayerN {
    return BLOCK_LAYER[k];
  }
}
