import { SIG } from '@/lib/sim/colors';
import { clamp, damp, lerp, type Curve, type Pt } from '@/lib/sim/geometry';
import { PredictGame } from '@/lib/sim/predict';
import { mulberry32 } from '@/lib/sim/rng';
import { Sim, type ScriptEvent, type WireSpec } from '@/lib/sim/Sim';
import { cw, curlShape, easeInOut, polar, shortest } from './geom';
import { TWO32, commas, pct } from './hash';
import {
  KEY_NAMES,
  SERVERS,
  SERVER_IDS,
  buildRing,
  diffOwnership,
  hrwScore,
  hrwWinner,
  keyHash,
  keyString,
  lookupIndex,
  modMoveFraction,
  modOwner,
  ownerOf,
  ownerToken,
  ownership,
  preferenceWalk,
  ringShares,
  scaleMoves,
  tokenHash,
  type Change,
  type ScaleMoves,
  type Token,
} from './ring';

/* ------------------------------------------------------------------ */
/* Config                                                              */
/* ------------------------------------------------------------------ */

export type View = 'buckets' | 'line' | 'ring' | 'hrw';
export type ClickMode = 'remove' | 'fail' | null;
export type PredictKind = 'modn' | 'owner' | 'join';

export interface Cfg {
  view: View;
  /** Servers present when the step starts (or, with `intro`, the ones the script adds) */
  servers: string[];
  /** Tokens (virtual nodes) per server, multiplied by each server's weight */
  tokens: number;
  weights: Record<string, number>;
  /** How many of KEY_NAMES are on the ring / in the caches at the start */
  keys: number;
  /** Replication factor R */
  replicas: number;
  /** Background traffic: cache requests (buckets) or lookups (ring), per second */
  rps: number;
  arcs: boolean;
  lines: boolean;
  /** What clicking a server on the stage does */
  click: ClickMode;
  /** Click a key to see its preference list */
  selectKeys: boolean;
  /** Cycle the selected key every few seconds */
  autoSelect: boolean;
  /** Card in the middle of the ring */
  client: 'none' | 'app' | 'driver';
  /** Dynamo-style replicated writes flowing from the client */
  writes: boolean;
  /** Keys start unowned; the step script adds the servers */
  intro: boolean;
}

export const DEFAULTS: Cfg = {
  view: 'ring',
  servers: ['a', 'b', 'c', 'd'],
  tokens: 1,
  weights: {},
  keys: 26,
  replicas: 1,
  rps: 0,
  arcs: true,
  lines: true,
  click: null,
  selectKeys: false,
  autoSelect: false,
  client: 'none',
  writes: false,
  intro: false,
};

/** Slider stops for "tokens per server". */
export const TOKEN_STEPS = [1, 2, 4, 8, 16, 32, 64, 128, 256];

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */

export interface SrvState {
  id: string;
  /** Has tokens on the ring (a member) */
  present: boolean;
  /** Not crashed. A crashed member keeps its tokens; reads go to the next replica */
  up: boolean;
  /** Drawn as a dashed placeholder: about to join, or removed (click to restore) */
  ghost: 'joining' | 'removed' | null;
  weight: number;
  bornVt: number;
}

export interface KeyState {
  name: string;
  label: string;
  h: number;
  /** Position on the ring, 0..1 clockwise from the top */
  f: number;
  placed: boolean;
  placedVt: number;
  /** The server answering for this key right now (primary, or the next live replica) */
  owner: string | null;
  /** Ring position of the token its line points at */
  tokF: number;
  prevOwner: string | null;
  prevTokF: number;
  moveVt: number;
  flashVt: number;
  /** Every replica is down */
  lost: boolean;
  /** A question about this key is open */
  asking: boolean;
}

export interface Chip {
  key: string;
  /** Still in this cache's memory, but the key now maps to another server */
  stale: boolean;
  vt: number;
  hitVt: number;
  movedVt: number;
}

export interface Walker {
  id: number;
  kind: 'lookup' | 'reveal';
  f0: number;
  /** Clockwise distance to travel, as a fraction of the ring */
  span: number;
  t0: number;
  /** Seconds spent flying in from the ring's center first */
  lead: number;
  dur: number;
  color: string;
  onDone?: () => void;
}

export interface PrefMark {
  /** Clockwise distance from the key */
  d: number;
  tf: number;
  sid: string;
  /** Replica number (1 = primary), or null when skipped (same machine again) */
  n: number | null;
}

export interface PrefWalk {
  key: string;
  marks: PrefMark[];
  span: number;
  t0: number;
  dur: number;
}

export interface RingGeo {
  cx: number;
  cy: number;
  R: number;
  keyR: number;
  bandR: number;
  bandW: number;
  gap: number;
  small: boolean;
  /** Width of the right-hand readout column (landscape) */
  side: number;
}

export interface RingChange {
  kind: 'join' | 'leave' | 'fail' | 'revive';
  sid: string;
  /** Visible keys that now live on a different server */
  moved: number;
  total: number;
  /** Same change under hash mod N (membership changes only) */
  modMoved: number | null;
  /** join: where the moved keys came from. leave: where they went */
  flow: Map<string, number>;
  scale: ScaleMoves | null;
  n0: number;
  n1: number;
  lost: number;
  vt: number;
}

export interface BucketChange {
  n0: number;
  n1: number;
  moved: number;
  total: number;
  /** Same change measured over 100,000 keys */
  scale: number;
  vt: number;
}

export interface CacheReq {
  key: string;
  h: number;
  n: number;
  idx: number;
  sid: string;
  result: 'hit' | 'miss' | null;
}

export interface WriteState {
  key: string;
  reps: string[];
  coord: string;
  acked: Set<string>;
  need: number;
  done: boolean;
}

export interface Asking {
  kind: PredictKind;
  key?: string;
  sid?: string;
  text: string;
}

const QUESTION_KEYS = ['adam', 'lou', 'cole', 'jane', 'sean', 'opal'];
const JOINERS = ['e', 'f', 'g'];
const MODN_PLAN: { add?: string; remove?: string }[] = [{ add: 'e' }, { remove: 'e' }, { remove: 'd' }, { add: 'd' }];
const AUTO_KEYS = ['alice', 'lou', 'cole', 'jane', 'bob', 'sean', 'opal', 'mia', 'carol', 'reed'];
export const HRW_KEYS = ['alice', 'bob', 'carol', 'dave', 'eli', 'mia', 'sara', 'joe'];
const CHIP_CAP = 12;
export const MOVE_DUR = 0.9;

/* ------------------------------------------------------------------ */

export class RingSim extends Sim {
  cfg: Cfg = { ...DEFAULTS };
  game: PredictGame | null = null;
  pKind: PredictKind | null = null;
  asking: Asking | null = null;

  srv = new Map<string, SrvState>();
  keys: KeyState[] = [];
  ring: Token[] = [];
  /** Bumped whenever the token list changes (drawing caches key off it) */
  ringVer = 0;
  shares = new Map<string, number>();
  sweep: { changes: Change[]; vt: number } | null = null;
  lastChange: RingChange | null = null;
  walkers: Walker[] = [];
  pref: PrefWalk | null = null;
  selected: string | null = null;
  lastLookup: { key: string; sid: string } | null = null;
  write: WriteState | null = null;
  geo: RingGeo = { cx: 300, cy: 300, R: 200, keyR: 181, bandR: 192, bandW: 9, gap: 13, small: false, side: 290 };

  /* chapter 1: hash mod N in front of four caches */
  blist: string[] = [];
  chips = new Map<string, Chip[]>();
  bGhost: string | null = null;
  bLeaving: string | null = null;
  bChange: BucketChange | null = null;
  lastReq: CacheReq | null = null;
  dbVt = -10;
  private reqLog: { t: number; hit: boolean }[] = [];
  private dbLog: number[] = [];
  private reqSeq = 0;
  private missVt = new Map<string, number>();

  /* rendezvous hashing */
  hrwIdx = 0;
  hrwRemoved = new Set<string>();
  hrwChange: { sid: string; moved: number; total: number; to: Map<string, number>; vt: number } | null = null;
  hrwBars = new Map<string, number>();
  /** Keys that changed winner in the last removal, and who won them before */
  hrwMovedFrom = new Map<string, string>();

  private nextIn = 0.5;
  private writeIn = 0.8;
  private writeSeq = 0;
  private pNextAt = 0;
  private round = 0;
  private autoNext = 0;
  private autoHold = 0;
  private autoIdx = -1;
  private walkSeq = 1;

  constructor() {
    super();
    for (const id of SERVER_IDS) this.srv.set(id, { id, present: false, up: true, ghost: null, weight: 1, bornVt: -10 });
    this.keys = KEY_NAMES.map((name) => {
      const h = keyHash(name);
      return {
        name,
        label: keyString(name),
        h,
        f: h / TWO32,
        placed: false,
        placedVt: -10,
        owner: null,
        tokF: h / TWO32,
        prevOwner: null,
        prevTokF: h / TWO32,
        moveVt: -10,
        flashVt: -10,
        lost: false,
        asking: false,
      };
    });
  }

  /* ================================================================ */
  /* Step entry                                                        */
  /* ================================================================ */

  enter(cfg: Cfg, script: ScriptEvent<RingSim>[] = [], opts: { predict?: PredictKind | null; needed?: number } = {}) {
    this.cfg = { ...cfg, servers: [...cfg.servers], weights: { ...cfg.weights } };
    this.resetWorld();
    this.pKind = opts.predict ?? null;
    this.game = this.pKind ? new PredictGame(this, opts.needed ?? 3) : null;
    this.round = 0;
    this.asking = null;
    this.pNextAt = this.t + (this.pKind === 'modn' ? 2.6 : this.pKind === 'join' ? 1.4 : 1.1);
    this.runScript(script);
    this.syncBoxes();
    this.relayout();
    for (const b of this.boxes.values()) {
      b.x = b.tx;
      b.y = b.ty;
    }
    this.rev++;
  }

  private resetWorld() {
    this.clearTransient();
    this.rng = mulberry32(11);
    const c = this.cfg;
    for (const s of this.srv.values()) {
      s.present = !c.intro && c.servers.includes(s.id);
      s.up = true;
      s.ghost = null;
      s.weight = c.weights[s.id] ?? 1;
      s.bornVt = -10;
    }
    this.keys.forEach((k, i) => {
      k.placed = i < c.keys;
      k.placedVt = -10;
      k.owner = null;
      k.prevOwner = null;
      k.tokF = k.f;
      k.prevTokF = k.f;
      k.moveVt = -10;
      k.flashVt = -10;
      k.lost = false;
      k.asking = false;
    });
    this.ring = buildRing(this.counts());
    this.ringVer++;
    this.shares = ringShares(this.ring);
    this.reassign(false, false);
    this.sweep = null;
    this.lastChange = null;
    this.walkers = [];
    this.pref = null;
    this.selected = null;
    this.lastLookup = null;
    this.write = null;
    // chapter 1 caches: warm, every key cached where hash mod N sends it
    this.blist = [...c.servers].sort();
    this.chips = new Map(this.blist.map((id) => [id, [] as Chip[]]));
    for (const k of this.keys) {
      if (!k.placed) continue;
      const sid = modOwner(this.blist, k.h);
      if (sid) this.chips.get(sid)?.push({ key: k.name, stale: false, vt: -10, hitVt: -10, movedVt: -10 });
    }
    this.bGhost = null;
    this.bLeaving = null;
    this.bChange = null;
    this.lastReq = null;
    this.reqLog = [];
    this.dbLog = [];
    this.reqSeq = 0;
    this.dbVt = -10;
    this.hrwIdx = 0;
    this.hrwRemoved.clear();
    this.hrwChange = null;
    this.hrwMovedFrom = new Map();
    this.nextIn = 0.5;
    this.writeIn = 0.8;
    this.writeSeq = 0;
    this.autoNext = this.t + 0.9;
    this.autoHold = 0;
    this.autoIdx = -1;
    if (c.selectKeys && !c.autoSelect) this.selected = 'alice';
  }

  /* ================================================================ */
  /* Layout                                                            */
  /* ================================================================ */

  private computeGeo(): RingGeo {
    const { w, h } = this;
    if (this.orient === 'landscape') {
      const side = this.cfg.view === 'hrw' ? 0 : Math.min(300, Math.max(250, w * 0.29));
      const areaW = w - side;
      const R = clamp(Math.min(areaW / 2 - 86, (h - 136) / 2 - 64), 100, 245);
      return { cx: areaW / 2 + 12, cy: h / 2 + 6, R, keyR: R - 19, bandR: R - 8, bandW: 9, gap: 13, small: false, side };
    }
    const top = 66;
    const bottom = 138;
    const avail = h - top - bottom;
    const R = clamp(Math.min(w / 2 - 46, avail / 2 - 34), 80, 150);
    return { cx: w / 2, cy: top + avail / 2, R, keyR: R - 15, bandR: R - 6, bandW: 6, gap: 9, small: true, side: 0 };
  }

  protected layout() {
    this.geo = this.computeGeo();
    if (this.cfg.view === 'buckets') this.layoutBuckets();
    else this.layoutRing();
  }

  /** Card size for a cache server in the chapter-1 view. */
  bucketCard() {
    if (this.orient === 'landscape') return { w: 214, h: 94 };
    const n = Math.max(4, this.blist.length + (this.bGhost ? 1 : 0));
    return { w: Math.min(84, (this.w - 20 - (n - 1) * 6) / n), h: 70 };
  }

  private layoutBuckets() {
    const { w, h } = this;
    const ids = [...this.blist];
    if (this.bGhost && !ids.includes(this.bGhost)) ids.push(this.bGhost);
    ids.sort();
    const card = this.bucketCard();
    if (this.orient === 'landscape') {
      const appX = Math.max(152, w * 0.15);
      if (this.boxes.has('app')) this.place('app', appX, h * 0.46, 148, 52);
      if (this.boxes.has('db')) this.place('db', w * 0.84, h * 0.46, 118, 86);
      const n = ids.length;
      const gap = clamp((h - 190 - n * card.h) / Math.max(1, n - 1), 8, 20);
      const total = n * card.h + (n - 1) * gap;
      ids.forEach((id, i) => {
        if (this.boxes.has(`srv:${id}`)) this.place(`srv:${id}`, w * 0.5, h * 0.46 - total / 2 + card.h / 2 + i * (card.h + gap), card.w, card.h);
      });
    } else {
      if (this.boxes.has('app')) this.place('app', w / 2, 92, 150, 42);
      if (this.boxes.has('db')) this.place('db', w / 2, h * 0.655, 110, 62);
      const n = ids.length;
      const total = n * card.w + (n - 1) * 6;
      ids.forEach((id, i) => {
        if (this.boxes.has(`srv:${id}`)) this.place(`srv:${id}`, w / 2 - total / 2 + card.w / 2 + i * (card.w + 6), h * 0.405, card.w, card.h);
      });
    }
  }

  /** Where a server's label sits: next to its first token, nudged apart if two collide. */
  private layoutRing() {
    const g = this.geo;
    if (this.boxes.has('center')) this.place('center', g.cx, g.cy, g.small ? 130 : 136, g.small ? 38 : 42);
    const items = [...this.srv.values()]
      .filter((s) => this.boxes.has(`srv:${s.id}`) && (s.present || s.ghost))
      .map((s) => {
        const w = g.small ? 24 : SERVERS[s.id].name.length * 6.5 + 30;
        return { id: s.id, a: (tokenHash(s.id, 0) / TWO32) * Math.PI * 2, w, h: g.small ? 24 : 24 };
      })
      .sort((p, q) => p.a - q.a);
    const posOf = (it: { a: number; w: number; h: number }) => {
      const ext = Math.abs(Math.sin(it.a)) * (it.w / 2) + Math.abs(Math.cos(it.a)) * (it.h / 2);
      const r = g.R + g.gap + ext;
      return { x: g.cx + r * Math.sin(it.a), y: g.cy - r * Math.cos(it.a) };
    };
    for (let iter = 0; iter < 60 && items.length > 1; iter++) {
      let moved = false;
      for (let i = 0; i < items.length; i++) {
        const p = items[i];
        const q = items[(i + 1) % items.length];
        const A = posOf(p);
        const B = posOf(q);
        const ox = (p.w + q.w) / 2 + 6 - Math.abs(A.x - B.x);
        const oy = (p.h + q.h) / 2 + 4 - Math.abs(A.y - B.y);
        if (ox > 0 && oy > 0) {
          p.a -= 0.012;
          q.a += 0.012;
          moved = true;
        }
      }
      if (!moved) break;
    }
    for (const it of items) {
      const p = posOf(it);
      this.place(`srv:${it.id}`, p.x, p.y, it.w, it.h);
    }
  }

  /** Create the boxes this view needs and fade out the rest. */
  private syncBoxes() {
    const want = new Set<string>();
    const v = this.cfg.view;
    if (v === 'buckets') {
      want.add('app');
      want.add('db');
      for (const id of this.blist) want.add(`srv:${id}`);
      if (this.bGhost) want.add(`srv:${this.bGhost}`);
    } else if (v === 'ring') {
      for (const s of this.srv.values()) if (s.present || s.ghost) want.add(`srv:${s.id}`);
      if (this.cfg.client !== 'none') want.add('center');
    }
    for (const id of want) this.box(id);
    for (const id of [...this.boxes.keys()]) if (!want.has(id)) this.hide(id);
  }

  protected wires(): WireSpec[] {
    if (this.cfg.view !== 'buckets') return [];
    const out: WireSpec[] = [];
    for (const id of this.blist) {
      out.push({ from: 'app', to: `srv:${id}`, state: this.bLeaving === id ? 'down' : 'normal' });
      out.push({ from: `srv:${id}`, to: 'db', state: 'dim' });
    }
    if (this.bGhost) out.push({ from: 'app', to: `srv:${this.bGhost}`, state: 'dashed' });
    return out;
  }

  protected curveFor(from: string, to: string, lane: number): Curve | null {
    if (this.cfg.view !== 'ring') return super.curveFor(from, to, lane);
    const a = this.boxes.get(from);
    const b = this.boxes.get(to);
    if (!a || !b || Number.isNaN(a.x) || Number.isNaN(b.x)) return null;
    const g = this.geo;
    const A = { x: a.x, y: a.y };
    const B = { x: b.x, y: b.y };
    const len = Math.hypot(B.x - A.x, B.y - A.y) || 1;
    const nx = -(B.y - A.y) / len;
    const ny = (B.x - A.x) / len;
    const off = lane;
    const bow = from === 'center' || to === 'center' ? 0 : 0.42;
    const C = { x: g.cx, y: g.cy };
    const c1 = { x: lerp(lerp(A.x, B.x, 0.3), C.x, bow), y: lerp(lerp(A.y, B.y, 0.3), C.y, bow) };
    const c2 = { x: lerp(lerp(A.x, B.x, 0.7), C.x, bow), y: lerp(lerp(A.y, B.y, 0.7), C.y, bow) };
    return {
      p0: { x: A.x + nx * off, y: A.y + ny * off },
      p1: { x: c1.x + nx * off, y: c1.y + ny * off },
      p2: { x: c2.x + nx * off, y: c2.y + ny * off },
      p3: { x: B.x + nx * off, y: B.y + ny * off },
    };
  }

  /* ================================================================ */
  /* Geometry helpers for the stage                                    */
  /* ================================================================ */

  pt(f: number, r: number): Pt {
    return polar(this.geo.cx, this.geo.cy, r, f);
  }

  /** Ring position of a server's first token (where its label hangs). */
  tokenF0(sid: string) {
    return tokenHash(sid, 0) / TWO32;
  }

  /** Cache cards to draw in chapter 1, in list order. */
  presentBuckets() {
    const ids = [...this.blist];
    if (this.bGhost && !ids.includes(this.bGhost)) ids.push(this.bGhost);
    return ids.sort();
  }

  keyByName(name: string | null | undefined) {
    return name ? (this.keys.find((k) => k.name === name) ?? null) : null;
  }

  /** Ring positions of keys wearing a name tag right now (asked or selected). */
  taggedKeyFs(): number[] {
    const out: number[] = [];
    const asked = this.asking?.kind === 'owner' ? this.keyByName(this.asking.key) : null;
    if (asked?.placed) out.push(asked.f);
    const sel = this.keyByName(this.selected);
    if (sel?.placed) out.push(sel.f);
    return out;
  }

  /** Morph from number line (0) to ring (1) in the "bend the line" step. */
  morph() {
    if (this.cfg.view !== 'line') return 1;
    return easeInOut(clamp((this.stepT - 2.2) / 2.6, 0, 1));
  }

  lineLength() {
    const g = this.geo;
    return this.orient === 'landscape' ? Math.min(this.w - g.side - 90, 640) : this.w - 56;
  }

  /** Where the line end sits right now (the "wraps to 0" point). */
  curlPoint(u: number) {
    const g = this.geo;
    return curlShape(g.cx, g.cy, g.R, this.morph(), this.lineLength()).at(u);
  }

  /** Current end of a key's line (eases when its owner changes). */
  endpointF(k: KeyState) {
    const p = clamp((this.vt - k.moveVt) / MOVE_DUR, 0, 1);
    if (p >= 1) return k.tokF;
    return (k.prevTokF + shortest(k.prevTokF, k.tokF) * easeInOut(p) + 1) % 1;
  }

  /** Callout targets beyond plain boxes: key:<name>, arc:<sid>, top, line-end. */
  calloutRect(target: string): { x: number; y: number; w: number; h: number } | null {
    const g = this.geo;
    if (target.startsWith('wide:')) {
      // Only on roomy stages: phones hide these callouts.
      if (this.orient !== 'landscape') return null;
      const inner = target.slice(5);
      const r = this.calloutRect(inner);
      if (r) return r;
      const b = this.boxes.get(inner);
      return b && !Number.isNaN(b.x) ? { x: b.x, y: b.y, w: b.w, h: b.h } : null;
    }
    if (target.startsWith('key:')) {
      const k = this.keyByName(target.slice(4));
      if (!k || !k.placed) return null;
      const p = this.cfg.view === 'line' ? this.curlPoint(k.f) : this.pt(k.f, g.keyR);
      return { x: p.x, y: p.y, w: 12, h: 12 };
    }
    if (target.startsWith('arc:')) {
      const sid = target.slice(4);
      let best: { a: number; b: number } | null = null;
      for (const iv of ownership(this.ring)) if (iv.sid === sid && (!best || iv.b - iv.a > best.b - best.a)) best = iv;
      if (!best) return null;
      const p = this.pt((best.a + best.b) / 2, g.bandR);
      return { x: p.x, y: p.y, w: 14, h: 14 };
    }
    if (target === 'top') {
      const p = this.cfg.view === 'line' ? this.curlPoint(0) : this.pt(0, g.R);
      return { x: p.x, y: p.y, w: 10, h: 10 };
    }
    if (target === 'line-end') {
      const p = this.curlPoint(1);
      return { x: p.x, y: p.y, w: 10, h: 10 };
    }
    if (target.startsWith('hrw:')) {
      const r = this.hrwRow(target.slice(4));
      return r ? { x: r.x + r.w / 2, y: r.y, w: r.w, h: r.h } : null;
    }
    return null;
  }

  /* ================================================================ */
  /* The ring                                                          */
  /* ================================================================ */

  presentList() {
    return SERVER_IDS.filter((id) => this.srv.get(id)?.present);
  }

  tokensOf(sid: string) {
    const s = this.srv.get(sid);
    return Math.max(1, Math.round(this.cfg.tokens * (s?.weight ?? 1)));
  }

  private counts() {
    const m = new Map<string, number>();
    for (const id of SERVER_IDS) if (this.srv.get(id)?.present) m.set(id, this.tokensOf(id));
    return m;
  }

  private anyDown() {
    for (const s of this.srv.values()) if (s.present && !s.up) return true;
    return false;
  }

  /** Which token answers for a key: its owner, or the next live replica when the owner is down. */
  serveOf(k: KeyState): { tok: Token | null; lost: boolean } {
    if (!this.ring.length) return { tok: null, lost: false };
    if (!this.anyDown()) return { tok: this.ring[lookupIndex(this.ring, k.h)], lost: false };
    const { list } = preferenceWalk(this.ring, k.h, this.cfg.replicas);
    const live = list.find((t) => this.srv.get(t.sid)?.up);
    return live ? { tok: live, lost: false } : { tok: list[0] ?? null, lost: true };
  }

  private reassign(animate: boolean, flash = true) {
    for (const k of this.keys) {
      if (!k.placed || k.asking) continue;
      const { tok, lost } = this.serveOf(k);
      const sid = tok?.sid ?? null;
      const f = tok ? tok.h / TWO32 : k.f;
      const newServer = sid !== k.owner;
      if (!newServer && Math.abs(f - k.tokF) < 1e-12 && lost === k.lost) continue;
      if (animate) {
        k.prevTokF = k.owner ? this.endpointF(k) : k.f;
        k.prevOwner = k.owner;
        k.moveVt = this.vt;
        if (flash && newServer && k.owner && sid) k.flashVt = this.vt;
      } else {
        k.moveVt = -10;
      }
      k.owner = sid;
      k.tokF = f;
      k.lost = lost;
    }
  }

  private commitMembership(kind: 'join' | 'leave', sid: string, beforeRing: Token[], beforeList: string[], quiet: boolean) {
    this.ring = buildRing(this.counts());
    this.ringVer++;
    this.shares = ringShares(this.ring);
    const afterList = this.presentList();
    const placed = this.keys.filter((k) => k.placed && !k.asking);
    let moved = 0;
    let modMoved = 0;
    const flow = new Map<string, number>();
    for (const k of placed) {
      const o0 = ownerOf(beforeRing, k.h);
      const o1 = ownerOf(this.ring, k.h);
      if (o0 !== o1) {
        moved++;
        const other = kind === 'join' ? o0 : o1;
        if (other) flow.set(other, (flow.get(other) ?? 0) + 1);
      }
      if (modOwner(beforeList, k.h) !== modOwner(afterList, k.h)) modMoved++;
    }
    const both = beforeRing.length > 0 && this.ring.length > 0;
    this.sweep = both
      ? { changes: diffOwnership(beforeRing, this.ring), vt: this.vt }
      : this.ring.length
        ? { changes: [{ a: 0, b: 1, from: '', to: this.ring[0].sid }], vt: this.vt }
        : null;
    if (!quiet) {
      this.lastChange = {
        kind,
        sid,
        moved,
        total: placed.length,
        modMoved,
        flow,
        scale: both ? scaleMoves(beforeRing, this.ring, beforeList, afterList) : null,
        n0: beforeList.length,
        n1: afterList.length,
        lost: 0,
        vt: this.vt,
      };
    }
    this.reassign(true, !quiet);
    if (this.pref) this.startPref(this.pref.key);
    this.syncBoxes();
    this.relayout();
    this.rev++;
  }

  /** A server joins the ring. */
  join(sid: string, quiet = false) {
    const s = this.srv.get(sid);
    if (!s || s.present) return;
    const beforeRing = this.ring;
    const beforeList = this.presentList();
    s.present = true;
    s.ghost = null;
    s.up = true;
    s.bornVt = this.vt;
    this.commitMembership('join', sid, beforeRing, beforeList, quiet);
    this.fx({ kind: 'ring', at: { id: `srv:${sid}` }, color: SERVERS[sid].color, size: 1.3 });
  }

  /** A server leaves the ring (decommissioned, or ejected by the client). */
  leave(sid: string, ghost = true) {
    const s = this.srv.get(sid);
    if (!s || !s.present || this.presentList().length <= 1) return;
    const beforeRing = this.ring;
    const beforeList = this.presentList();
    s.present = false;
    s.ghost = ghost ? 'removed' : null;
    s.up = true;
    this.commitMembership('leave', sid, beforeRing, beforeList, false);
  }

  /** Intro: a server takes its seat and we show the hash that put it there. */
  introJoin(sid: string) {
    this.join(sid, true);
    this.sayInside(`srv:${sid}`, `hash = ${commas(tokenHash(sid, 0))}`, SERVERS[sid].color, 2.2);
  }

  /** Like say(), but keeps the floating label inside the stage. */
  private sayInside(id: string, text: string, color: string, dur = 1.4) {
    const b = this.boxes.get(id);
    if (!b) return;
    const half = (text.length * 6.5 + 18) / 2;
    const x = clamp(b.tx, half + 6, this.w - half - 6);
    this.fx({ kind: 'text', at: { x, y: b.ty - b.h / 2 - 10 }, text, color, dur });
  }

  fail(sid: string) {
    const s = this.srv.get(sid);
    if (!s || !s.present || !s.up) return;
    s.up = false;
    this.afterHealth('fail', sid);
    this.fx({ kind: 'x', at: { id: `srv:${sid}` }, color: SIG.err, size: 1.3 });
  }

  revive(sid: string) {
    const s = this.srv.get(sid);
    if (!s || !s.present || s.up) return;
    s.up = true;
    this.afterHealth('revive', sid);
    this.fx({ kind: 'ring', at: { id: `srv:${sid}` }, color: SIG.res });
  }

  private afterHealth(kind: 'fail' | 'revive', sid: string) {
    const before = new Map(this.keys.map((k) => [k.name, k.owner]));
    this.reassign(true);
    const placed = this.keys.filter((k) => k.placed && !k.asking);
    let moved = 0;
    for (const k of placed) if (before.get(k.name) !== k.owner) moved++;
    const n = this.presentList().length;
    this.lastChange = { kind, sid, moved, total: placed.length, modMoved: null, flow: new Map(), scale: null, n0: n, n1: n, lost: this.lostCount(), vt: this.vt };
    this.rev++;
  }

  private rebuildTokens() {
    const before = this.ring;
    this.ring = buildRing(this.counts());
    this.ringVer++;
    this.shares = ringShares(this.ring);
    this.sweep = before.length && this.ring.length ? { changes: diffOwnership(before, this.ring), vt: this.vt } : null;
    this.reassign(true, false);
    if (this.pref) this.startPref(this.pref.key);
    this.relayout();
    this.rev++;
  }

  setTokens(n: number) {
    if (n === this.cfg.tokens) return;
    this.cfg = { ...this.cfg, tokens: n };
    this.rebuildTokens();
  }

  setWeight(sid: string, w: number) {
    const s = this.srv.get(sid);
    if (!s || s.weight === w) return;
    s.weight = w;
    this.rebuildTokens();
  }

  setReplicas(r: number) {
    if (r === this.cfg.replicas) return;
    this.cfg = { ...this.cfg, replicas: r };
    this.reassign(true);
    if (this.selected) this.startPref(this.selected);
    if (this.lastChange && (this.lastChange.kind === 'fail' || this.lastChange.kind === 'revive')) this.lastChange = { ...this.lastChange, lost: this.lostCount() };
    this.rev++;
  }

  /** Stage click on a server marker. */
  clickServer(sid: string) {
    const g = this.game;
    if (g?.pending && !g.pending.choices) {
      g.answer(sid);
      return;
    }
    const s = this.srv.get(sid);
    if (!s) return;
    if (this.cfg.click === 'remove') {
      if (s.present) this.leave(sid);
      else if (s.ghost === 'removed') this.join(sid);
    } else if (this.cfg.click === 'fail' && s.present) {
      if (s.up) this.fail(sid);
      else this.revive(sid);
    }
  }

  serverClickable(sid: string) {
    const s = this.srv.get(sid);
    if (!s) return false;
    if (this.game?.pending && !this.game.pending.choices) return s.present;
    if (this.cfg.click === 'remove') return s.present || s.ghost === 'removed';
    if (this.cfg.click === 'fail') return s.present;
    return false;
  }

  /** Playground: add or remove a server from the ring. */
  toggleMember(sid: string) {
    const s = this.srv.get(sid);
    if (!s) return;
    if (s.present) this.leave(sid, false);
    else this.join(sid);
  }

  lostCount() {
    return this.keys.filter((k) => k.placed && !k.asking && k.lost).length;
  }

  /* ---------------- replication: preference lists ---------------- */

  selectKey(name: string) {
    if (!this.cfg.selectKeys) return;
    const k = this.keyByName(name);
    if (!k || !k.placed) return;
    this.autoHold = this.t + 14;
    this.selected = name;
    this.startPref(name);
    this.rev++;
  }

  private startPref(name: string) {
    const k = this.keyByName(name);
    if (!k || !this.ring.length) {
      this.pref = null;
      return;
    }
    const { steps } = preferenceWalk(this.ring, k.h, this.cfg.replicas);
    let n = 0;
    const marks: PrefMark[] = steps.map((st) => ({ d: cw(k.f, st.token.h / TWO32), tf: st.token.h / TWO32, sid: st.token.sid, n: st.skip ? null : ++n }));
    const span = marks.length ? marks[marks.length - 1].d : 0;
    this.pref = { key: name, marks, span, t0: this.t, dur: 0.5 + span * 2.6 };
  }

  /** How far the preference walk has got (0..1 of its span). */
  prefProgress() {
    const p = this.pref;
    if (!p) return 1;
    return easeInOut(clamp((this.t - p.t0) / p.dur, 0, 1));
  }

  /* ================================================================ */
  /* Simulation clock                                                  */
  /* ================================================================ */

  protected step(dt: number) {
    if (this.walkers.length) {
      const done = this.walkers.filter((w) => this.t >= w.t0 + w.lead + w.dur);
      if (done.length) {
        this.walkers = this.walkers.filter((w) => !done.includes(w));
        for (const w of done) w.onDone?.();
      }
    }
    const c = this.cfg;
    if (c.rps > 0) {
      this.nextIn -= dt;
      if (this.nextIn <= 0) {
        this.nextIn += 1 / c.rps;
        if (c.view === 'buckets') this.cacheRequest();
        else if (c.view === 'ring') this.ringLookup();
      }
    }
    if (c.writes && c.view === 'ring') {
      this.writeIn -= dt;
      if (this.writeIn <= 0) {
        this.writeIn = 4.6;
        this.dynamoWrite();
      }
    }
    if (c.autoSelect && this.t >= this.autoNext && this.t >= this.autoHold && !c.writes) {
      this.autoNext = this.t + 5.6;
      this.autoIdx++;
      const name = AUTO_KEYS[this.autoIdx % AUTO_KEYS.length];
      this.selected = name;
      this.startPref(name);
      this.rev++;
    }
    const g = this.game;
    if (g && !g.pending && !this.asking && this.t >= this.pNextAt) {
      if (!g.done) {
        if (this.pKind === 'modn') this.modnRound();
        else if (this.pKind === 'owner') this.ownerRound(false);
        else if (this.pKind === 'join') this.joinRound();
      } else if (this.pKind === 'owner') {
        this.ownerRound(true);
      }
    }
  }

  protected animate(dt: number) {
    if (this.cfg.view !== 'hrw') return;
    const key = keyString(this.hrwKey());
    for (const sid of this.cfg.servers) {
      const target = this.hrwRemoved.has(sid) ? 0 : hrwScore(key, sid) / TWO32;
      this.hrwBars.set(sid, damp(this.hrwBars.get(sid) ?? 0, target, 7, dt));
    }
  }

  private addWalker(w: Omit<Walker, 'id' | 't0'>) {
    this.walkers.push({ ...w, id: this.walkSeq++, t0: this.t });
  }

  /** Where a walker is now: fraction on the ring, or a point while flying in from the center. */
  walkerPos(w: Walker): { f: number; inFlight: number | null; p: number } {
    const e = this.t - w.t0;
    if (e < w.lead) return { f: w.f0, inFlight: clamp(e / w.lead, 0, 1), p: 0 };
    const p = easeInOut(clamp((e - w.lead) / w.dur, 0, 1));
    return { f: (w.f0 + w.span * p) % 1, inFlight: null, p };
  }

  /* ---------------- traffic on the ring ---------------- */

  private ringLookup() {
    const pool = this.keys.filter((k) => k.placed && !k.asking && k.owner && !k.lost);
    if (!pool.length) return;
    const k = pool[Math.floor(this.rng() * pool.length)];
    const { tok } = this.serveOf(k);
    if (!tok) return;
    const span = cw(k.f, tok.h / TWO32);
    this.addWalker({
      kind: 'lookup',
      f0: k.f,
      span,
      lead: this.cfg.client !== 'none' ? 0.4 : 0,
      dur: 0.3 + span * 1.5,
      color: SIG.req,
      onDone: () => {
        this.lastLookup = { key: k.name, sid: tok.sid };
        this.fx({ kind: 'ring', at: this.pt(tok.h / TWO32, this.geo.R), color: SERVERS[tok.sid].color, size: 0.6, dur: 0.6 });
        this.rev++;
      },
    });
  }

  private dynamoWrite() {
    const pool = AUTO_KEYS.map((n) => this.keyByName(n)).filter((k): k is KeyState => !!k && k.placed);
    if (!pool.length || !this.ring.length) return;
    const k = pool[this.writeSeq++ % pool.length];
    const { list } = preferenceWalk(this.ring, k.h, this.cfg.replicas);
    const reps = list.map((t) => t.sid);
    const coord = reps.find((s) => this.srv.get(s)?.up);
    if (!coord) return;
    const w: WriteState = { key: k.name, reps, coord, acked: new Set(), need: Math.floor(reps.length / 2) + 1, done: false };
    this.write = w;
    this.selected = k.name;
    this.startPref(k.name);
    this.rev++;
    this.send({
      from: 'center',
      to: `srv:${coord}`,
      dur: 1.1,
      color: SIG.req,
      label: `PUT ${k.name}`,
      lane: 0,
      onArrive: () => {
        w.acked.add(coord);
        this.fx({ kind: 'ring', at: { id: `srv:${coord}` }, color: SIG.res, size: 0.8 });
        let nth = 0;
        for (const r of reps) {
          if (r === coord || !this.srv.get(r)?.up) continue;
          // The last replica is a little slow, so you can see the quorum not waiting for it.
          const slow = nth++ > 0 ? 1.5 : 1;
          this.send({
            from: `srv:${coord}`,
            to: `srv:${r}`,
            dur: 1.05 * slow,
            color: SIG.req,
            lane: 3,
            onArrive: () => {
              this.fx({ kind: 'ring', at: { id: `srv:${r}` }, color: SIG.res, size: 0.8 });
              this.send({
                from: `srv:${r}`,
                to: `srv:${coord}`,
                dur: 0.85 * slow,
                color: SIG.res,
                lane: 3,
                r: 3.6,
                onArrive: () => {
                  w.acked.add(r);
                  this.maybeReply(w);
                  this.rev++;
                },
              });
            },
          });
        }
        this.maybeReply(w);
        this.rev++;
      },
    });
  }

  private maybeReply(w: WriteState) {
    if (w.done || w.acked.size < w.need) return;
    w.done = true;
    this.send({ from: `srv:${w.coord}`, to: 'center', dur: 1.0, color: SIG.res, label: 'OK', lane: 0 });
  }

  /* ================================================================ */
  /* Chapter 1: hash mod N in front of a cache cluster                 */
  /* ================================================================ */

  private cacheRequest() {
    const pool = this.keys.filter((k) => k.placed);
    const n = this.blist.length;
    if (!pool.length || !n) return;
    // The first request is Alice, the worked example in the narration.
    const k = this.reqSeq++ === 0 ? pool[0] : pool[Math.floor(this.rng() * pool.length)];
    const idx = k.h % n;
    const sid = this.blist[idx];
    const req: CacheReq = { key: k.name, h: k.h, n, idx, sid, result: null };
    this.lastReq = req;
    this.rev++;
    this.send({ from: 'app', to: `srv:${sid}`, dur: 0.75, color: SIG.req, label: k.name, onArrive: () => this.atCache(req) });
  }

  private atCache(req: CacheReq) {
    const list = this.chips.get(req.sid);
    if (!list || !this.blist.includes(req.sid)) return;
    const chip = list.find((c) => c.key === req.key && !c.stale);
    if (chip) {
      chip.hitVt = this.vt;
      req.result = 'hit';
      this.reqLog.push({ t: this.t, hit: true });
      this.send({ from: `srv:${req.sid}`, to: 'app', dur: 0.7, color: SIG.res });
    } else {
      req.result = 'miss';
      this.reqLog.push({ t: this.t, hit: false });
      this.missLabel(req.sid);
      this.send({
        from: `srv:${req.sid}`,
        to: 'db',
        dur: 0.65,
        color: SIG.heavy,
        onArrive: () => {
          this.dbLog.push(this.t);
          this.dbVt = this.vt;
          this.send({
            from: 'db',
            to: `srv:${req.sid}`,
            dur: 0.65,
            color: SIG.heavy,
            onArrive: () => {
              this.storeChip(req.sid, req.key);
              this.send({ from: `srv:${req.sid}`, to: 'app', dur: 0.7, color: SIG.res });
            },
          });
        },
      });
    }
    if (this.reqLog.length > 40) this.reqLog.shift();
    this.rev++;
  }

  /** "miss" tag on the side of the card that faces the database, one at a time per card. */
  private missLabel(sid: string) {
    const b = this.boxes.get(`srv:${sid}`);
    if (!b) return;
    if (this.vt - (this.missVt.get(sid) ?? -10) < 1.2) return;
    this.missVt.set(sid, this.vt);
    const at = this.orient === 'landscape' ? { x: b.tx + b.w / 2 + 34, y: b.ty + 8 } : { x: b.tx, y: b.ty - b.h / 2 - 6 };
    this.fx({ kind: 'text', at, text: 'miss', color: SIG.heavy, dur: 1.1 });
  }

  private storeChip(sid: string, key: string) {
    const list = this.chips.get(sid);
    if (!list || !this.blist.includes(sid)) return;
    if (list.some((c) => c.key === key && !c.stale)) return;
    const old = list.findIndex((c) => c.key === key);
    if (old >= 0) list.splice(old, 1);
    if (list.length >= CHIP_CAP) {
      const i = list.findIndex((c) => c.stale);
      list.splice(i >= 0 ? i : 0, 1);
    }
    list.push({ key, stale: false, vt: this.vt, hitVt: -10, movedVt: -10 });
    this.rev++;
  }

  /** Change the cache cluster to `next` (ids, sorted) and mark what just went stale. */
  private bucketsSet(next: string[]) {
    const before = this.blist;
    const placed = this.keys.filter((k) => k.placed);
    let moved = 0;
    for (const k of placed) if (modOwner(before, k.h) !== modOwner(next, k.h)) moved++;
    this.blist = next;
    for (const id of [...this.chips.keys()]) if (!next.includes(id)) this.chips.delete(id);
    for (const id of next) if (!this.chips.has(id)) this.chips.set(id, []);
    for (const [id, list] of this.chips) {
      for (const c of list) {
        const mine = modOwner(next, keyHash(c.key)) === id;
        if (c.stale && mine) c.stale = false;
        else if (!c.stale && !mine) {
          c.stale = true;
          c.movedVt = this.vt;
        }
      }
    }
    this.bChange = { n0: before.length, n1: next.length, moved, total: placed.length, scale: modMoveFraction(before.length, next.length), vt: this.vt };
    this.bGhost = null;
    this.bLeaving = null;
    this.syncBoxes();
    this.relayout();
    this.rev++;
  }

  bucketsAdd() {
    const id = SERVER_IDS.find((x) => !this.blist.includes(x));
    if (id && this.blist.length < 6) this.bucketsSet([...this.blist, id].sort());
  }

  bucketsRemove() {
    if (this.blist.length > 1) this.bucketsSet(this.blist.slice(0, -1));
  }

  /** Share of the last 16 requests that were cache hits. */
  hitRate() {
    const recent = this.reqLog.slice(-16);
    if (!recent.length) return null;
    return recent.filter((r) => r.hit).length / recent.length;
  }

  /** Database reads per second over the last 5 simulated seconds. */
  dbRate() {
    const since = this.t - 5;
    return this.dbLog.filter((x) => x >= since).length / 5;
  }

  /* ================================================================ */
  /* Predictions                                                       */
  /* ================================================================ */

  private modnRound() {
    const plan = MODN_PLAN[this.round % MODN_PLAN.length];
    this.round++;
    const before = this.blist;
    const next = plan.add ? [...before, plan.add].sort() : before.filter((x) => x !== plan.remove);
    const placed = this.keys.filter((k) => k.placed);
    const total = placed.length;
    const moved = placed.filter((k) => modOwner(before, k.h) !== modOwner(next, k.h)).length;
    const n = before.length;
    const m = next.length;
    if (plan.add) this.bGhost = plan.add;
    else this.bLeaving = plan.remove ?? null;
    this.syncBoxes();
    this.relayout();
    const text = plan.add ? `${SERVERS[plan.add].name} joins: ${n} → ${m} servers` : `${SERVERS[plan.remove ?? 'a'].name} leaves: ${n} → ${m} servers`;
    this.asking = { kind: 'modn', sid: plan.add ?? plan.remove, text };
    this.rev++;
    this.after(0.9, () => {
      const g = this.game;
      if (!g) return;
      g.ask({
        acceptable: ['most'],
        choices: [
          { id: 'few', label: `About ${total - moved}` },
          { id: 'half', label: `About ${Math.round(total / 2)}` },
          { id: 'most', label: `About ${moved}` },
        ],
        ask: text,
        explain: (picked) =>
          `${moved} of ${total} keys now map to a different server. A key stays put only when hash mod ${n} equals hash mod ${m}, and that happens for about 1 key in ${Math.max(n, m)}.` +
          (picked === 'few' ? ' It isn’t just the new server’s share: changing N changes the remainder for almost every key.' : ''),
        resolve: () => {
          this.bucketsSet(next);
          this.asking = null;
          this.pNextAt = this.t + 7.5;
        },
      });
    });
  }

  private ownerRound(auto: boolean) {
    let k: KeyState | null | undefined = this.keys.find((x) => QUESTION_KEYS.includes(x.name) && !x.placed);
    if (!k) {
      if (auto) return;
      for (const x of this.keys) {
        if (!QUESTION_KEYS.includes(x.name)) continue;
        x.placed = false;
        x.owner = null;
      }
      k = this.keyByName(QUESTION_KEYS[0]);
      if (!k) return;
    }
    const key = k;
    key.placed = true;
    key.placedVt = this.vt;
    key.asking = true;
    key.owner = null;
    key.moveVt = -10;
    const text = `Which server owns ${key.label}?`;
    this.asking = { kind: 'owner', key: key.name, text };
    this.rev++;
    if (auto) {
      this.after(0.7, () => this.revealOwner(key));
      return;
    }
    this.after(0.75, () => {
      const tok = ownerToken(this.ring, key.h);
      const g = this.game;
      if (!tok || !g) return;
      g.ask({
        acceptable: [tok.sid],
        ask: text,
        explain: (picked, ok) => this.explainOwner(key, tok, picked, ok),
        resolve: () => this.revealOwner(key),
      });
    });
  }

  private explainOwner(k: KeyState, tok: Token, picked: string, ok: boolean) {
    const owner = SERVERS[tok.sid].name;
    const last = this.ring[this.ring.length - 1];
    const idx = lookupIndex(this.ring, k.h);
    const prev = this.ring[(idx - 1 + this.ring.length) % this.ring.length];
    if (k.h > last.h) return `${k.label} sits past the last server, so the walk wraps through 0 and the first server it meets is ${owner}.`;
    if (!ok && picked === prev.sid) {
      const closer = cw(prev.h / TWO32, k.f) < cw(k.f, tok.h / TWO32);
      return `${SERVERS[picked].name} is ${closer ? 'closer, but it’s ' : ''}behind the key. The walk only goes clockwise, so the next server, ${owner}, owns it.`;
    }
    return `Walking clockwise from ${k.label} (${pct(k.f, 0)} of the way round), the first server you reach is ${owner}.`;
  }

  private revealOwner(k: KeyState) {
    const tok = ownerToken(this.ring, k.h);
    if (!tok) return;
    const tf = tok.h / TWO32;
    const span = cw(k.f, tf);
    this.addWalker({
      kind: 'reveal',
      f0: k.f,
      span,
      lead: 0,
      dur: 0.45 + span * 2.6,
      color: SIG.warn,
      onDone: () => {
        k.asking = false;
        k.owner = tok.sid;
        k.tokF = tf;
        k.prevOwner = null;
        k.prevTokF = k.f;
        k.moveVt = this.vt;
        k.lost = false;
        this.lastLookup = { key: k.name, sid: tok.sid };
        this.fx({ kind: 'ring', at: { id: `srv:${tok.sid}` }, color: SERVERS[tok.sid].color, size: 1.1 });
        this.asking = null;
        this.pNextAt = this.t + 1.3;
        this.rev++;
      },
    });
  }

  private joinRound() {
    let sid = JOINERS.find((x) => !this.srv.get(x)?.present);
    if (!sid) {
      // Everyone has joined but the learner wants more practice: roll back quietly.
      for (const x of JOINERS) {
        const s = this.srv.get(x);
        if (s) {
          s.present = false;
          s.ghost = null;
        }
      }
      this.ring = buildRing(this.counts());
      this.ringVer++;
      this.shares = ringShares(this.ring);
      this.sweep = null;
      this.reassign(false);
      sid = JOINERS[0];
    }
    const id = sid;
    const s = this.srv.get(id);
    if (!s) return;
    s.ghost = 'joining';
    this.syncBoxes();
    this.relayout();
    const h = tokenHash(id, 0);
    const victim = ownerOf(this.ring, h) ?? 'a';
    const idx = lookupIndex(this.ring, h);
    const pred = this.ring[(idx - 1 + this.ring.length) % this.ring.length].sid;
    const wraps = tokenHash(victim, 0) < h;
    const name = SERVERS[id].name;
    const text = `Who hands keys to ${name}?`;
    this.asking = { kind: 'join', sid: id, text };
    this.rev++;
    this.after(0.9, () => {
      this.game?.ask({
        acceptable: [victim],
        ask: text,
        explain: () =>
          `${name} lands inside ${SERVERS[victim].name}’s arc${wraps ? ' (the one that wraps past 0)' : ''}, so it takes over the keys between ${SERVERS[pred].name} and itself. All of them come from ${SERVERS[victim].name}; every other server keeps every key.`,
        resolve: () => {
          this.join(id);
          this.asking = null;
          this.pNextAt = this.t + 4.6;
        },
      });
    });
  }

  /** The key a question is about, or the last one we looked up (for the lookup readout). */
  lookupInfo() {
    const name = this.asking?.kind === 'owner' ? this.asking.key : this.lastLookup?.key;
    const k = this.keyByName(name);
    if (!k) return null;
    const revealed = !k.asking;
    const tok = ownerToken(this.ring, k.h);
    const last = this.ring[this.ring.length - 1];
    return { key: k, revealed, owner: tok?.sid ?? null, wrap: !!last && k.h > last.h };
  }

  /* ================================================================ */
  /* Rendezvous hashing                                                */
  /* ================================================================ */

  hrwKey() {
    return HRW_KEYS[this.hrwIdx % HRW_KEYS.length];
  }

  hrwLive() {
    return this.cfg.servers.filter((s) => !this.hrwRemoved.has(s));
  }

  hrwNext() {
    this.hrwIdx++;
    this.rev++;
  }

  hrwRemoveWinner() {
    const live = this.hrwLive();
    if (live.length <= 2) return;
    const win = hrwWinner(keyString(this.hrwKey()), live);
    if (!win) return;
    const after = live.filter((s) => s !== win);
    let moved = 0;
    const to = new Map<string, number>();
    this.hrwMovedFrom = new Map();
    for (const name of KEY_NAMES) {
      const a = hrwWinner(keyString(name), live);
      const b = hrwWinner(keyString(name), after);
      if (a !== b && a && b) {
        moved++;
        to.set(b, (to.get(b) ?? 0) + 1);
        this.hrwMovedFrom.set(name, a);
      }
    }
    this.hrwRemoved.add(win);
    this.hrwChange = { sid: win, moved, total: KEY_NAMES.length, to, vt: this.vt };
    const row = this.hrwRow(win);
    if (row) this.fx({ kind: 'x', at: { x: row.x + 6, y: row.y }, color: SIG.err, size: 1.3 });
    this.rev++;
  }

  hrwRestore() {
    this.hrwRemoved.clear();
    this.hrwChange = null;
    this.hrwMovedFrom = new Map();
    this.rev++;
  }

  /** Layout of one server's row in the rendezvous view. */
  hrwRow(sid: string) {
    const ids = this.cfg.servers;
    const i = ids.indexOf(sid);
    if (i < 0) return null;
    const land = this.orient === 'landscape';
    const rowH = land ? 58 : 44;
    const x = land ? Math.max(48, this.w * 0.07) : 22;
    const wAll = land ? Math.min(560, this.w - x - 330) : this.w - 44;
    const blockH = 70 + ids.length * rowH + 90;
    const top = land ? Math.max(120, this.h / 2 - blockH / 2 + 70) : 128;
    return { x, y: top + i * rowH, w: wAll, h: rowH - 18 };
  }

  /** One square per key, colored by the server that wins it. */
  hrwGrid() {
    const ids = this.cfg.servers;
    const first = this.hrwRow(ids[0]);
    const last = this.hrwRow(ids[ids.length - 1]);
    if (!first || !last) return null;
    const land = this.orient === 'landscape';
    const perRow = land ? KEY_NAMES.length : 13;
    const gap = land ? 4 : 5;
    const size = Math.min(18, (first.w - (perRow - 1) * gap) / perRow);
    const y = last.y + last.h / 2 + (land ? 54 : 42);
    const cells = KEY_NAMES.map((name, i) => ({
      name,
      x: first.x + (i % perRow) * (size + gap),
      y: y + Math.floor(i / perRow) * (size + gap),
      movedFrom: this.hrwMovedFrom.get(name) ?? null,
    }));
    return { x: first.x, y, size, cells };
  }
}
