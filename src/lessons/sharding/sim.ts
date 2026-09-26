import type { SeqMessage, SeqNote, SeqSpan } from '@/components/stage/SequenceDiagram';
import { PALETTE, SIG } from '@/lib/sim/colors';
import { clamp, damp, lerp, type Curve } from '@/lib/sim/geometry';
import { PredictGame } from '@/lib/sim/predict';
import { mulberry32 } from '@/lib/sim/rng';
import { Sim, type ScriptEvent, type WireSpec } from '@/lib/sim/Sim';
import {
  BUCKET_OWNER_4,
  BUCKET_OWNER_5,
  COUNTRIES,
  COUNTRY_MAP,
  DIR_START,
  NAMES,
  PREDICT_NAMES,
  PREDICT_QUERIES,
  TENANTS,
  TILE_HASHES,
  TODAY,
  VITESS_RANGES,
  hash2,
  hash2s,
  keyspaceId,
  nameShard,
  packCountries,
  vitessShard,
  type QuerySpec,
} from './routing';

/* ================================================================== */
/* Config                                                              */
/* ================================================================== */

export type SceneKind = 'single' | 'replicas' | 'sharded' | 'twopc';
export type Rule = 'none' | 'name' | 'year' | 'hash' | 'country' | 'dir' | 'vitess';
export type QueryMode = 'none' | 'monthly' | 'myorders' | 'demo' | 'join' | 'predict';
export type ReadoutKind = 'none' | 'writes' | 'queries' | 'ids' | 'tiles';

export interface ShardConfig {
  scene: SceneKind;
  shards: number;
  rule: Rule;
  keyName: 'customer_id' | 'seller_id';
  /** Writes per second arriving at the app */
  rate: number;
  /** Ramp the write rate: [from, to, over seconds] */
  ramp: [number, number, number] | null;
  /** Writes per second one database machine can absorb */
  cap: number;
  /** Disk % added per applied write */
  fillPer: number;
  /** Disk % per node when the step starts */
  prefill: number[];
  labels: boolean;
  routerMode: 'proxy' | 'app';
  routerSub: string;
  configSvc: boolean;
  replicas: number;
  reads: boolean;
  hot: boolean;
  salted: boolean;
  hashMode: 'modn' | 'buckets';
  tiles: boolean;
  queries: QueryMode;
  joinMode: 'reference' | 'sharded';
  idMode: 'none' | 'auto' | 'snowflake';
  brace: boolean;
  predict: 'none' | 'shard' | 'query';
  rounds: number;
  readout: ReadoutKind;
  /** Playground: years stored by the created_at rule */
  years: number[];
}

export const DEFAULTS: ShardConfig = {
  scene: 'sharded',
  shards: 4,
  rule: 'hash',
  keyName: 'customer_id',
  rate: 4,
  ramp: null,
  cap: 4,
  fillPer: 0.22,
  prefill: [30, 30, 30, 30],
  labels: false,
  routerMode: 'proxy',
  routerSub: 'shard router',
  configSvc: false,
  replicas: 2,
  reads: false,
  hot: false,
  salted: false,
  hashMode: 'modn',
  tiles: false,
  queries: 'none',
  joinMode: 'reference',
  idMode: 'none',
  brace: false,
  predict: 'none',
  rounds: 3,
  readout: 'writes',
  years: [2023, 2024, 2025, 2026],
};

/* ================================================================== */
/* State types                                                         */
/* ================================================================== */

export interface DbNode {
  id: string;
  kind: 'db' | 'primary' | 'replica' | 'shard';
  /** Shard index (shards) or position (others) */
  idx: number;
  /** Smoothed write arrivals per second */
  r: number;
  queue: string[];
  work: number;
  /** Disk % for db/replicas; shards derive theirs from units */
  store: number;
  failed: number;
  /** Eased values for drawing */
  shownFill: number;
  shownLoad: number;
  /** A query being worked on */
  q: { t0: number; dur: number } | null;
  cap: number;
}

interface Unit {
  key: string;
  owner: number;
  store: number;
}

export type Detail =
  | { rule: 'name'; key: string; letter: string; shard: number }
  | { rule: 'year'; key: string; year: number; shard: number }
  | { rule: 'hash'; id: number; h: number; n: number; salt: number | null; shard: number; mode: 'modn' | 'buckets'; bucket: number }
  | { rule: 'country'; code: string; shard: number }
  | { rule: 'dir'; tenant: string; shard: number }
  | { rule: 'vitess'; id: number; ks: string; range: string; shard: number };

interface Write {
  id: number;
  label: string;
  unit: string;
  shard: number;
  detail: Detail;
  predict: boolean;
}

export interface QueryRun {
  id: number;
  spec: QuerySpec;
  kind: 'single' | 'scatter' | 'join';
  targets: number[];
  /** Per shard: displayed ms, null while working */
  results: { shard: number; ms: number | null; round: number }[];
  round: number;
  total: number | null;
  slowest: number | null;
  asked: boolean;
  /** Join: shards holding the products, for round 2 */
  round2: number[];
}

export interface Tile {
  h: number;
  owner: number;
  moving: boolean;
  moved: boolean;
}

export interface IdEvent {
  id: string;
  shard: number;
  dup: boolean;
}

export interface TwoPcView {
  messages: SeqMessage[];
  notes: SeqNote[];
  spans: SeqSpan[];
  crashed: boolean;
  done: boolean;
  running: boolean;
  /** Step time at the top of the diagram (each run starts at the top) */
  origin: number;
}

const TAU = 2.4;
const MAX_QUEUE = 6;
const HOP_IN = 0.6;
const HOP_OUT = 0.8;
/** Simulated seconds of shard work per displayed millisecond */
const MS = 0.03;
export const HOT_ID = 12;
const SALTS = 4;
const TWITTER_EPOCH = 1288834974657;
const NOW_MS = Date.UTC(2026, 8, 26, 14, 3, 12);

export const shardColor = (i: number) => PALETTE[i % PALETTE.length];
export const shardId = (i: number) => `s${i}`;

/* ================================================================== */

export class ShardSim extends Sim {
  cfg: ShardConfig = { ...DEFAULTS };
  game: PredictGame | null = null;

  nodes = new Map<string, DbNode>();
  units = new Map<string, Unit>();
  /** Bucket → shard for the 100-bucket playground scheme */
  bucketOwner: number[] = [];

  /** Live write rate (the ramp and sliders change it) */
  rate = 0;
  capMul = 1;
  failed = 0;
  applied = 0;
  lastFailT = -99;
  last: Detail | null = null;
  lastVt = -10;
  pendingWrite: Write | null = null;
  lookups = 0;

  /* queries */
  query: QueryRun | null = null;
  qPending: QueryRun | null = null;
  lat = { single: [] as number[], scatter: [] as number[] };
  lastByKind: { single: number | null; scatter: number | null } = { single: null, scatter: null };
  monthly: { shards: number; ms: number | null } | null = null;
  myOrders: { shards: number } | null = null;
  joinStats: { shards: number; trips: number; ms: number } | null = null;

  /* resharding */
  tiles: Tile[] = [];
  tileMoves = 0;
  tileMoving = 0;
  moved: { rows: number; of: number } | null = null;
  movedPct: number | null = null;
  lastReshard: { from: number; to: number; rule: Rule; mode: 'modn' | 'buckets'; pct: number } | null = null;

  /* directory */
  dirMap: Record<string, number> = { ...DIR_START };
  dirMoving: string | null = null;

  /* ids */
  autoInc: number[] = [];
  seq: number[] = [];
  issued = new Map<string, number>();
  ids: IdEvent[] = [];
  dupes = 0;
  idsIssued = 0;

  /* two-phase commit */
  tpc: TwoPcView = { messages: [], notes: [], spans: [], crashed: false, done: false, running: false, origin: 0 };
  private tpcRun = 0;
  /** The 2PC diagram's clock and where it stops */
  tpcClock = 0;
  private tpcStopAt = Infinity;

  private nextIn = 0.3;
  private deck: number[] = [];
  private deckN = 0;
  private swrr = new Map<string, Map<string, number>>();
  private readIn = 0.5;
  private queryIn = 1;
  private busy = false;
  private seqName = 0;
  private seqCust = 1041;
  private seqQuery = 0;
  private writeSeq = 1;
  private querySeq = 1;
  private readRR = 0;
  private cfgPulseIn = 1.2;
  private queryFlip = false;
  private queued: 'single' | 'scatter' | null = null;
  private msScript: number[] = [];

  constructor() {
    super();
    this.box('app');
  }

  /* ================================================================ */
  /* Step entry                                                        */
  /* ================================================================ */

  enter(cfg: ShardConfig, script: ScriptEvent<ShardSim>[] = [], opts: { reset?: boolean; seed?: number } = {}) {
    this.cfg = { ...cfg, prefill: [...cfg.prefill], years: [...cfg.years] };
    this.clearTransient();
    this.rng = mulberry32(opts.seed ?? 7);
    this.rate = cfg.ramp ? cfg.ramp[0] : cfg.rate;
    this.capMul = 1;
    this.failed = 0;
    this.applied = 0;
    this.lastFailT = -99;
    this.last = null;
    this.pendingWrite = null;
    this.lookups = 0;
    this.query = null;
    this.qPending = null;
    this.lat = { single: [], scatter: [] };
    this.lastByKind = { single: null, scatter: null };
    this.monthly = null;
    this.myOrders = null;
    this.joinStats = null;
    this.moved = null;
    this.movedPct = null;
    this.lastReshard = null;
    this.tileMoves = 0;
    this.tileMoving = 0;
    this.dirMap = { ...DIR_START };
    this.dirMoving = null;
    this.ids = [];
    this.issued.clear();
    this.dupes = 0;
    this.idsIssued = 0;
    this.nextIn = 0.35;
    this.readIn = 0.6;
    this.queryIn = cfg.queries === 'predict' ? 1.0 : 0.5;
    this.busy = false;
    this.seqName = 0;
    this.seqCust = 1041;
    this.seqQuery = 0;
    this.readRR = 0;
    this.cfgPulseIn = 0.8;
    this.queryFlip = false;
    this.queued = null;
    // single-shard: 9 ms; then scatter-gather: one of four shards has a hiccup
    this.msScript = cfg.queries === 'demo' ? [9, 8, 11, 44, 10] : cfg.queries === 'join' ? [10, 9, 12, 11, 10] : [];
    this.deck = [];
    this.swrr.clear();
    this.tpc = { messages: [], notes: [], spans: [], crashed: false, done: false, running: false, origin: 0 };
    this.tpcRun++;
    this.tpcClock = 0;
    this.tpcStopAt = Infinity;

    this.buildBoxes();
    this.buildNodes();
    this.buildUnits();
    this.warmStart();
    if (cfg.tiles) this.buildTiles();
    if (cfg.idMode !== 'none') this.resetIds();

    this.game = cfg.predict !== 'none' ? new PredictGame(this, cfg.rounds) : null;
    this.runScript(script);
    if (cfg.scene === 'twopc') this.after(0.4, () => this.runTransfer(false));
    this.rev++;
  }

  /** Which boxes exist in this scene; new shards grow out of the old database. */
  private buildBoxes() {
    const c = this.cfg;
    const want = new Set<string>();
    if (c.scene !== 'twopc') want.add('app');
    if (c.scene === 'single') want.add('db');
    if (c.scene === 'replicas') {
      want.add('db');
      for (let i = 1; i <= c.replicas; i++) want.add(`rep${i}`);
    }
    if (c.scene === 'sharded') {
      if (c.routerMode === 'proxy') want.add('router');
      for (let i = 0; i < c.shards; i++) want.add(shardId(i));
      if (c.rule === 'dir') want.add('dir');
      if (c.configSvc) want.add('cfg');
    }
    const origin = this.boxes.get('db');
    const from = origin && !Number.isNaN(origin.x) && this.isLive('db') ? { x: origin.x, y: origin.y } : null;
    const fresh: string[] = [];
    for (const id of want) {
      if (!this.isLive(id)) fresh.push(id);
      this.box(id);
    }
    for (const id of [...this.boxes.keys()]) if (!want.has(id)) this.hide(id);
    this.relayout();
    if (!this.sized) return;
    // Shards and replicas grow out of the original database.
    for (const id of fresh) {
      const b = this.boxes.get(id);
      if (!b) continue;
      if (from && (id.startsWith('s') || id.startsWith('rep'))) {
        b.x = from.x;
        b.y = from.y;
      }
      b.alpha = 0;
    }
  }

  private buildNodes() {
    const c = this.cfg;
    const keep = new Set<string>();
    const make = (id: string, kind: DbNode['kind'], idx: number, store: number) => {
      keep.add(id);
      const old = this.nodes.get(id);
      const n: DbNode = {
        id,
        kind,
        idx,
        r: 0,
        queue: [],
        work: 0,
        store,
        failed: 0,
        shownFill: old ? old.shownFill : store,
        shownLoad: old ? old.shownLoad : 0,
        q: null,
        cap: c.cap,
      };
      this.nodes.set(id, n);
    };
    if (c.scene === 'single') make('db', 'db', 0, c.prefill[0] ?? 60);
    if (c.scene === 'replicas') {
      make('db', 'primary', 0, c.prefill[0] ?? 60);
      for (let i = 1; i <= c.replicas; i++) make(`rep${i}`, 'replica', i, c.prefill[0] ?? 60);
    }
    if (c.scene === 'sharded') for (let i = 0; i < c.shards; i++) make(shardId(i), 'shard', i, 0);
    for (const id of [...this.nodes.keys()]) if (!keep.has(id)) this.nodes.delete(id);
  }

  /** Units are the pieces of data a rule assigns to shards (letters, years, hash values…). */
  private buildUnits() {
    const c = this.cfg;
    this.units.clear();
    if (c.scene !== 'sharded') return;
    const n = c.shards;
    const add = (key: string, owner: number) => this.units.set(key, { key, owner, store: 0 });
    switch (c.rule) {
      case 'name':
        for (let i = 0; i < 26; i++) {
          const L = String.fromCharCode(65 + i);
          add(L, nameShard(L));
        }
        break;
      case 'year':
        c.years.forEach((y, i) => add(`y${y}`, yearOwner(i, c.years.length, n)));
        break;
      case 'hash':
        if (c.hashMode === 'buckets') this.bucketOwner = Array.from({ length: 100 }, (_, b) => b % n);
        for (let h = 0; h < 100; h++) add(`h${h}`, c.hashMode === 'buckets' ? this.bucketOwner[h] : h % n);
        break;
      case 'country': {
        const map = n === 4 ? COUNTRY_MAP : packCountries(n);
        for (const k of COUNTRIES) add(k.code, map[k.code]);
        break;
      }
      case 'dir':
        for (const t of TENANTS) add(t.name, this.dirMap[t.name]);
        break;
      case 'vitess':
        for (let i = 0; i < 4; i++) add(`r${i}`, i);
        break;
    }
    // Spread each shard's starting disk use over the units it owns, by weight.
    for (let s = 0; s < n; s++) {
      const mine = [...this.units.values()].filter((u) => u.owner === s);
      const total = mine.reduce((a, u) => a + this.unitWeight(u.key), 0) || 1;
      for (const u of mine) u.store = ((c.prefill[s] ?? c.prefill[c.prefill.length - 1] ?? 20) * this.unitWeight(u.key)) / total;
    }
    for (const node of this.nodes.values()) if (node.kind === 'shard') node.shownFill = this.fillOf(node);
  }

  private unitWeight(key: string) {
    const c = COUNTRIES.find((k) => k.code === key);
    if (this.cfg.rule === 'country' && c) return c.w;
    const t = TENANTS.find((k) => k.name === key);
    if (this.cfg.rule === 'dir' && t) return t.w;
    return 1;
  }

  /* ================================================================ */
  /* Layout                                                            */
  /* ================================================================ */

  /** Geometry shared by the scene and callouts. */
  dims() {
    const P = this.orient === 'portrait';
    const W = this.w;
    const H = this.h;
    const appW = P ? 150 : this.compact ? 170 : 184;
    const appH = P ? 40 : 48;
    const rW = P ? 152 : 176;
    const rH = P ? 46 : 56;
    const cylH = P ? (this.cfg.tiles ? 96 : 86) : this.cfg.tiles ? 118 : 112;
    const appY = P ? 98 : 104;
    // Shards sit above the legend/controls band (and the readout strip on phones).
    const shardY = P ? H - 56 - 104 - 30 - cylH / 2 : Math.max(appY + 250, H - 150 - cylH / 2);
    const tagTop = shardY - cylH / 2 - 16;
    const routerY = P ? Math.round((appY + appH / 2 + tagTop) / 2) : Math.round(lerp(appY, tagTop, 0.46));
    return { P, W, H, appW, appH, rW, rH, cylH, appY, shardY, routerY };
  }

  protected layout() {
    const c = this.cfg;
    const D = this.dims();
    const { P, W, H } = D;
    const put = (id: string, x: number, y: number, w: number, h: number) => {
      if (this.boxes.has(id)) this.place(id, x, y, w, h);
    };

    if (c.scene === 'single') {
      put('app', W / 2, P ? 110 : H * 0.2, D.appW, D.appH);
      const bw = P ? 150 : 196;
      const bh = P ? 128 : 160;
      put('db', W / 2, P ? 300 : H * 0.55, bw, bh);
      return;
    }

    if (c.scene === 'replicas') {
      put('app', W / 2, P ? 110 : H * 0.2, D.appW, D.appH);
      const ids = [...Array.from({ length: c.replicas }, (_, i) => `rep${i + 1}`)];
      // primary in the middle, replicas either side
      const order = [ids[0], 'db', ...ids.slice(1)];
      const cy = P ? 318 : H * 0.57;
      this.row(order, cy, P ? 104 : 164, P ? 116 : 150, P ? 10 : 56);
      return;
    }

    if (c.scene === 'twopc') return;

    // sharded
    const routerX = c.rule === 'dir' || c.configSvc ? (P ? W * 0.62 : W / 2 + 40) : W / 2;
    put('app', W / 2, D.appY, D.appW, D.appH);
    put('router', routerX, D.routerY, D.rW, D.rH);
    if (c.rule === 'dir') put('dir', P ? W * 0.2 : Math.max(110, routerX - 290), D.routerY, P ? 112 : 150, P ? 46 : 54);
    if (c.configSvc) put('cfg', P ? W * 0.2 : Math.max(110, routerX - 290), P ? D.routerY : lerp(D.appY, D.routerY, 0.55), P ? 116 : 158, P ? 46 : 54);
    const ids = [...this.boxes.keys()].filter((id) => /^s\d$/.test(id) && this.isLive(id)).sort();
    const n = ids.length;
    const maxW = P ? 84 : 136;
    const gap = P ? (n > 4 ? 6 : 8) : n > 4 ? 18 : 26;
    this.row(ids, D.shardY, maxW, D.cylH, gap);
  }

  private row(ids: string[], cy: number, maxW: number, h: number, gap: number) {
    const pad = this.orient === 'portrait' ? 10 : 40;
    const n = ids.length;
    if (!n) return;
    const w = Math.min(maxW, (this.w - 2 * pad - (n - 1) * gap) / n);
    const total = n * w + (n - 1) * gap;
    const x0 = this.w / 2 - total / 2 + w / 2;
    ids.forEach((id, i) => {
      if (this.boxes.has(id)) this.place(id, x0 + i * (w + gap), cy, w, h);
    });
  }

  protected wires(): WireSpec[] {
    const c = this.cfg;
    const out: WireSpec[] = [];
    if (c.scene === 'single') out.push({ from: 'app', to: 'db' });
    if (c.scene === 'replicas') {
      out.push({ from: 'app', to: 'db' });
      for (let i = 1; i <= c.replicas; i++) {
        out.push({ from: 'db', to: `rep${i}`, state: 'control' });
        if (c.reads) out.push({ from: 'app', to: `rep${i}`, state: 'dim' });
      }
    }
    if (c.scene === 'sharded') {
      const hub = c.routerMode === 'proxy' ? 'router' : 'app';
      if (hub === 'router' && this.isLive('router')) out.push({ from: 'app', to: 'router' });
      for (const node of this.shardNodes()) {
        if (!this.isLive(node.id)) continue;
        const overloaded = node.shownLoad > 1;
        out.push({ from: hub, to: node.id, state: overloaded ? 'hot' : 'normal' });
      }
      if (this.isLive('dir')) out.push({ from: 'router', to: 'dir', state: 'control' });
      if (this.isLive('cfg')) out.push({ from: 'cfg', to: hub, state: 'control' });
    }
    return out;
  }

  /** Rows moving between shards arc over the row instead of cutting through it. */
  protected curveFor(from: string, to: string, lane: number): Curve | null {
    // Replication to a replica that isn't next to the primary arcs over the row.
    if ((from === 'db' && to.startsWith('rep')) || (to === 'db' && from.startsWith('rep'))) {
      const a = this.boxes.get(from);
      const b = this.boxes.get(to);
      if (!a || !b || Number.isNaN(a.x) || Number.isNaN(b.x)) return null;
      const far = Math.abs(b.x - a.x) > (a.w + b.w) / 2 + a.w * 0.9;
      if (far) {
        const s = Math.sign(b.x - a.x) || 1;
        const y0 = a.y - a.h / 2 - 26;
        const y1 = b.y - b.h / 2 - 26;
        const lift = 40 + Math.abs(b.x - a.x) * 0.12;
        return {
          p0: { x: a.x + (s * a.w) / 4, y: y0 },
          p1: { x: a.x + (s * a.w) / 4, y: y0 - lift },
          p2: { x: b.x - (s * b.w) / 4, y: y1 - lift },
          p3: { x: b.x - (s * b.w) / 4, y: y1 },
        };
      }
    }
    if (/^s\d$/.test(from) && /^s\d$/.test(to)) {
      const a = this.boxes.get(from);
      const b = this.boxes.get(to);
      if (!a || !b || Number.isNaN(a.x) || Number.isNaN(b.x)) return null;
      const lift = 34 + Math.abs(b.x - a.x) * 0.22;
      const y0 = a.y - a.h / 2 - 24;
      const y1 = b.y - b.h / 2 - 24;
      return {
        p0: { x: a.x + lane, y: y0 },
        p1: { x: a.x + lane, y: y0 - lift },
        p2: { x: b.x + lane, y: y1 - lift },
        p3: { x: b.x + lane, y: y1 },
      };
    }
    // The app or router fans out to the databases below: always leave from the bottom and
    // enter through the top (above the tag pill), however wide the row gets.
    const hub = (id: string) => id === 'router' || id === 'app';
    const store = (id: string) => /^s\d$/.test(id) || id === 'db' || id.startsWith('rep');
    if ((hub(from) && store(to)) || (store(from) && hub(to))) {
      const a = this.boxes.get(from);
      const b = this.boxes.get(to);
      if (!a || !b || Number.isNaN(a.x) || Number.isNaN(b.x)) return null;
      const down = b.y > a.y;
      const s = down ? 1 : -1;
      const off = -lane * s;
      const y0 = down ? a.y + a.h / 2 : a.y - a.h / 2 - this.tagLift(from);
      const y3 = down ? b.y - b.h / 2 - this.tagLift(to) : b.y + b.h / 2;
      const k = Math.max(18, Math.abs(y3 - y0) * 0.5);
      return {
        p0: { x: a.x + off, y: y0 },
        p1: { x: a.x + off, y: y0 + s * k },
        p2: { x: b.x + off, y: y3 - s * k },
        p3: { x: b.x + off, y: y3 },
      };
    }
    return super.curveFor(from, to, lane);
  }

  /** Height of the tag pill drawn above a node (0 when it has none). */
  private tagLift(id: string): number {
    if (/^s\d$/.test(id)) return 21;
    if (this.cfg.scene === 'replicas' && (id === 'db' || id.startsWith('rep'))) return 21;
    return 0;
  }

  /* ================================================================ */
  /* Simulation loop                                                   */
  /* ================================================================ */

  protected step(dt: number) {
    const c = this.cfg;
    if (c.scene === 'twopc') {
      this.tpcClock = Math.min(this.tpcStopAt, this.tpcClock + dt);
      return;
    }
    if (c.ramp) this.rate = lerp(c.ramp[0], c.ramp[1], clamp(this.stepT / c.ramp[2], 0, 1));

    // Arrivals
    const predicting = !!this.game && !this.game.done && c.predict === 'shard';
    if (predicting) {
      if (!this.busy) {
        this.nextIn -= dt;
        if (this.nextIn <= 0) {
          this.busy = true;
          this.spawnWrite(true);
        }
      }
    } else if (this.rate > 0 && !c.tiles) {
      this.nextIn -= dt;
      if (this.nextIn <= 0) {
        this.nextIn += (1 / this.rate) * (0.55 + 0.9 * this.rng());
        this.spawnWrite(false);
      }
    }

    if (c.reads && c.scene === 'replicas') {
      this.readIn -= dt;
      if (this.readIn <= 0) {
        this.readIn += 0.55;
        this.spawnRead();
      }
    }

    this.stepQueries(dt);

    if (c.configSvc && this.isLive('cfg')) {
      this.cfgPulseIn -= dt;
      if (this.cfgPulseIn <= 0) {
        this.cfgPulseIn += 5;
        this.send({ from: 'cfg', to: c.routerMode === 'proxy' ? 'router' : 'app', dur: 0.7, color: SIG.hc, r: 3.4, label: 'shard map v7', lane: 0 });
      }
    }

    // Each node drains its queue at its capacity.
    const decay = Math.exp(-dt / TAU);
    for (const node of this.nodes.values()) {
      node.r *= decay;
      node.work += node.cap * this.capMul * dt;
      while (node.work >= 1 && node.queue.length) {
        const unit = node.queue.shift()!;
        node.work -= 1;
        this.apply(node, unit);
      }
      if (!node.queue.length) node.work = Math.min(node.work, 1);
    }
  }

  protected animate(dt: number) {
    for (const node of this.nodes.values()) {
      node.shownFill = damp(node.shownFill, this.fillOf(node), 5, dt);
      node.shownLoad = damp(node.shownLoad, this.loadOf(node), 3, dt);
    }
  }

  /* ================================================================ */
  /* Writes                                                            */
  /* ================================================================ */

  private spawnWrite(predict: boolean) {
    const c = this.cfg;
    if (c.scene === 'single' || c.scene === 'replicas') {
      const id = this.writeSeq++;
      this.count('db');
      // Every write the primary takes is replayed by every replica.
      for (let i = 1; i <= c.replicas; i++) if (c.scene === 'replicas') this.count(`rep${i}`);
      this.send({
        from: 'app',
        to: 'db',
        dur: 0.9,
        color: SIG.req,
        onArrive: () => this.arrive(this.nodes.get('db')!, 'all', id),
      });
      return;
    }
    const w = this.makeWrite(predict);
    if (!w) return;
    this.count(shardId(w.shard));
    if (c.routerMode === 'app') {
      this.decide(w);
      this.send({
        from: 'app',
        to: shardId(w.shard),
        dur: HOP_OUT + 0.3,
        color: shardColor(w.shard),
        label: c.labels ? w.label : undefined,
        onArrive: () => this.arriveWrite(w),
      });
      return;
    }
    this.send({
      from: 'app',
      to: 'router',
      dur: HOP_IN,
      color: SIG.req,
      label: predict || (c.labels && this.rate <= 2.5) ? w.label : undefined,
      onArrive: () => this.atRouter(w),
    });
  }

  /** Pick the next key and work out where the rule sends it. */
  private makeWrite(predict: boolean): Write | null {
    const c = this.cfg;
    const n = c.shards;
    const id = this.writeSeq++;
    switch (c.rule) {
      case 'name': {
        let name: string;
        if (predict || this.seqName < 3) name = PREDICT_NAMES[this.seqName++ % PREDICT_NAMES.length];
        else {
          // A random name from a shard dealt off the deck, so the four ranges share the load evenly.
          const want = this.evenShard(n);
          const pool = NAMES.filter((nm) => this.ownerOf(nm[0].toUpperCase()) === want);
          const list = pool.length ? pool : NAMES;
          name = list[Math.floor(this.rng() * list.length)];
        }
        const L = name[0].toUpperCase();
        const shard = this.ownerOf(L);
        return { id, label: name, unit: L, shard, detail: { rule: 'name', key: name, letter: L, shard }, predict };
      }
      case 'year': {
        const y = c.years[c.years.length - 1];
        const unit = `y${y}`;
        const shard = this.ownerOf(unit);
        const key = y === 2026 ? TODAY : `${y}-01-01`;
        return { id, label: key, unit, shard, detail: { rule: 'year', key, year: y, shard }, predict };
      }
      case 'hash': {
        let cust: number;
        let salt: number | null = null;
        let h: number;
        const seller = c.keyName === 'seller_id';
        const randomKey = () => (seller ? 20 + Math.floor(this.rng() * 480) : 1000 + Math.floor(this.rng() * 9000));
        if (predict) cust = this.seqCust++;
        else if (c.hot && this.smooth('hot', [{ k: 'hot', w: 7 }, { k: 'rest', w: 3 }]) === 'hot') cust = HOT_ID;
        else {
          // Random keys, but drawn so each shard gets its fair share over every few writes.
          const want = this.evenShard(n);
          cust = randomKey();
          for (let i = 0; i < 400 && this.ownerOf(`h${hash2(cust)}`) !== want; i++) cust = randomKey();
        }
        if (cust === HOT_ID && c.salted) {
          salt = Number(this.smooth('salt', Array.from({ length: SALTS }, (_, i) => ({ k: String(i), w: 1 }))));
          h = hash2s(`${HOT_ID}#${salt}`);
        } else h = hash2(cust);
        const unit = `h${h}`;
        const shard = this.ownerOf(unit);
        const label = seller ? (salt != null ? `seller ${cust}#${salt}` : `seller ${cust}`) : `${cust}`;
        return { id, label, unit, shard, detail: { rule: 'hash', id: cust, h, n, salt, shard, mode: c.hashMode, bucket: h }, predict };
      }
      case 'country': {
        const code = this.smooth(
          'country',
          COUNTRIES.map((k) => ({ k: k.code, w: k.w })),
        );
        const shard = this.ownerOf(code);
        return { id, label: code, unit: code, shard, detail: { rule: 'country', code, shard }, predict };
      }
      case 'dir': {
        const name = this.smooth(
          'dir',
          TENANTS.map((t) => ({ k: t.name, w: t.w })),
        );
        const shard = this.dirMap[name];
        return { id, label: name, unit: name, shard, detail: { rule: 'dir', tenant: name, shard }, predict };
      }
      case 'vitess': {
        const want = this.evenShard(4);
        let cust = 1000 + Math.floor(this.rng() * 9000);
        for (let i = 0; i < 400 && vitessShard(keyspaceId(cust)) !== want; i++) cust = 1000 + Math.floor(this.rng() * 9000);
        const ks = keyspaceId(cust);
        const shard = vitessShard(ks);
        return { id, label: `${cust}`, unit: `r${shard}`, shard, detail: { rule: 'vitess', id: cust, ks, range: VITESS_RANGES[shard], shard }, predict };
      }
      default:
        return null;
    }
  }

  private ownerOf(unit: string) {
    return this.units.get(unit)?.owner ?? 0;
  }

  /** Floating text above a shard's tag pill (so it doesn't cover the tag). */
  private sayAbove(id: string, text: string, color: string, dur = 1.4, extra = 0) {
    const b = this.boxes.get(id);
    this.fx({ kind: 'text', at: { id, dy: -(b?.h ?? 60) / 2 - 32 - extra }, text, color, dur });
  }

  /** Floating text to the right of a box (keeps clear of the HUD above the app). */
  private sayBeside(id: string, text: string, color: string, dur = 1.4, dy = 8) {
    const b = this.boxes.get(id);
    if (!b) return;
    const half = (text.length * 6.3 + 16) / 2;
    const dx = b.w / 2 + 12 + half;
    // Only if it fits on the stage (phones are narrow); the HUD carries the number anyway.
    if (b.x + dx + half > this.w - 6) return;
    this.fx({ kind: 'text', at: { id, dx, dy }, text, color, dur });
  }

  /**
   * Keys are random, but a real system sees millions of them, so its shares are
   * exact. With a handful of dots per second we'd see mostly noise, so the sim
   * deals shards from a shuffled deck: every shard once per round, random order.
   */
  private evenShard(n: number): number {
    if (!this.deck.length || this.deckN !== n) {
      this.deckN = n;
      this.deck = Array.from({ length: n }, (_, i) => i);
      for (let i = n - 1; i > 0; i--) {
        const j = Math.floor(this.rng() * (i + 1));
        [this.deck[i], this.deck[j]] = [this.deck[j], this.deck[i]];
      }
    }
    return this.deck.pop()!;
  }

  /** Smooth weighted round robin: exact shares over short windows, nicely interleaved. */
  private smooth(name: string, items: { k: string; w: number }[]): string {
    const state = this.swrr.get(name) ?? new Map<string, number>();
    this.swrr.set(name, state);
    const total = items.reduce((a, it) => a + it.w, 0);
    let best: { k: string; w: number } | null = null;
    let bestV = -Infinity;
    for (const it of items) {
      const v = (state.get(it.k) ?? this.rng() * it.w) + it.w;
      state.set(it.k, v);
      if (v > bestV) {
        bestV = v;
        best = it;
      }
    }
    const k = (best ?? items[0]).k;
    state.set(k, (state.get(k) ?? 0) - total);
    return k;
  }

  /** Expected share of writes per shard for the current rule. */
  private shares(): number[] {
    const c = this.cfg;
    const n = c.shards;
    const out = Array.from({ length: n }, () => 0);
    switch (c.rule) {
      case 'name':
        for (const nm of NAMES) out[this.ownerOf(nm[0].toUpperCase())] += 1 / NAMES.length;
        break;
      case 'year':
        out[this.ownerOf(`y${c.years[c.years.length - 1]}`)] = 1;
        break;
      case 'hash': {
        const hot = c.hot ? 0.7 : 0;
        for (let i = 0; i < n; i++) out[i] = (1 - hot) / n;
        if (hot) {
          if (c.salted) for (let s = 0; s < SALTS; s++) out[this.ownerOf(`h${hash2s(`${HOT_ID}#${s}`)}`)] += hot / SALTS;
          else out[this.ownerOf(`h${hash2(HOT_ID)}`)] += hot;
        }
        break;
      }
      case 'country': {
        const total = COUNTRIES.reduce((a, k) => a + k.w, 0);
        for (const k of COUNTRIES) out[this.ownerOf(k.code)] += k.w / total;
        break;
      }
      case 'dir': {
        const total = TENANTS.reduce((a, t) => a + t.w, 0);
        for (const t of TENANTS) out[this.dirMap[t.name]] += t.w / total;
        break;
      }
      case 'vitess':
        for (let i = 0; i < n; i++) out[i] = 1 / n;
        break;
    }
    return out;
  }

  /** Start a step in steady state, so the gauges already tell the story. */
  private warmStart() {
    const c = this.cfg;
    if (c.predict !== 'none' || c.tiles) return;
    const rate = this.rate;
    const shares = this.shares();
    for (const node of this.nodes.values()) {
      let r = 0;
      if (node.kind === 'shard') r = rate * (shares[node.idx] ?? 0);
      else if (node.kind === 'db' || node.kind === 'primary') r = rate;
      else if (node.kind === 'replica') r = Math.min(rate, node.cap);
      node.r = r;
      node.shownLoad = r / (node.cap * (node.kind === 'shard' ? 1 : this.capMul));
    }
  }

  private atRouter(w: Write) {
    const c = this.cfg;
    if (c.rule === 'dir') {
      this.lookups++;
      this.send({
        from: 'router',
        to: 'dir',
        dur: 0.45,
        color: SIG.hc,
        r: 3.4,
        lane: 5,
        onArrive: () =>
          this.send({
            from: 'dir',
            to: 'router',
            dur: 0.45,
            color: SIG.hc,
            r: 3.4,
            lane: 5,
            onArrive: () => {
              // The directory may have changed while we asked.
              w.shard = this.dirMap[w.unit] ?? w.shard;
              if (w.detail.rule === 'dir') w.detail = { ...w.detail, shard: w.shard };
              this.forward(w);
            },
          }),
      });
      return;
    }
    if (w.predict && this.game && !this.game.done) {
      this.pendingWrite = w;
      const target = shardId(w.shard);
      const asked = this.game.ask({
        acceptable: [target],
        ask: c.rule === 'name' ? `Which shard gets ${w.label}?` : `Which shard gets customer ${w.label}?`,
        askAt: { id: 'router' },
        explain: (picked, ok) => this.explainWrite(w, picked, ok),
        resolve: (picked, ok) => {
          this.pendingWrite = null;
          if (!ok) this.fx({ kind: 'ring', at: { id: picked }, color: SIG.err, size: 1.6, dur: 0.9 });
          this.forward(w);
        },
      });
      if (!asked) this.forward(w);
      return;
    }
    this.forward(w);
  }

  private explainWrite(w: Write, picked: string, ok: boolean): string {
    void picked;
    void ok;
    const d = w.detail;
    const lead = '';
    if (d.rule === 'name') {
      const range = ['A–F', 'G–L', 'M–R', 'S–Z'][d.shard];
      return `${lead}${d.key} starts with ${d.letter}, and ${d.letter} falls in ${range}, so it goes to shard-${d.shard}.`;
    }
    if (d.rule === 'hash') {
      const q = Math.floor(d.h / d.n);
      return `${lead}hash(${d.id}) = ${d.h}, and ${d.h} = ${d.n} × ${q} + ${d.shard}, so ${d.h} mod ${d.n} = ${d.shard}: shard-${d.shard}.`;
    }
    return `${lead}It goes to shard-${d.shard}.`;
  }

  /** Router → shard. */
  private forward(w: Write) {
    const c = this.cfg;
    this.decide(w);
    this.send({
      from: 'router',
      to: shardId(w.shard),
      dur: HOP_OUT,
      color: shardColor(w.shard),
      label: w.predict || (c.labels && this.rate <= 2.5) ? w.label : undefined,
      onArrive: () => this.arriveWrite(w),
    });
  }

  private decide(w: Write) {
    this.last = w.detail;
    this.lastVt = this.vt;
    this.rev++;
  }

  private arriveWrite(w: Write) {
    const node = this.nodes.get(shardId(w.shard));
    if (!node) return;
    this.arrive(node, w.unit, w.id);
    if (w.predict) {
      this.fx({ kind: 'ring', at: { id: node.id }, color: SIG.res, size: 1.4, dur: 0.9 });
      this.after(0.7, () => {
        this.busy = false;
        this.nextIn = 0.25;
      });
    }
    if (this.cfg.idMode !== 'none') this.issueId(node);
  }

  /**
   * Count a write toward a node's load meter. We count when the write is sent
   * rather than when it lands: the meter is a rate, and the travel time is the
   * same for every write, so it only shifts the curve by a moment.
   */
  private count(id: string) {
    const node = this.nodes.get(id);
    if (node) node.r += 1 / TAU;
  }

  private arrive(node: DbNode, unit: string, id: number) {
    void id;
    if (node.queue.length >= MAX_QUEUE) {
      node.failed++;
      this.failed++;
      this.lastFailT = this.t;
      const h = this.boxes.get(node.id)?.h ?? 60;
      this.fx({ kind: 'x', at: { id: node.id, dx: (this.rng() - 0.5) * 24, dy: -h / 2 - 36 }, color: SIG.err, size: 1.1 });
      if (this.rng() < 0.3) this.sayAbove(node.id, 'timeout', SIG.err, 1.1, 14);
      this.rev++;
      return;
    }
    node.queue.push(unit);
  }

  private apply(node: DbNode, unit: string) {
    const c = this.cfg;
    this.applied++;
    if (node.kind === 'shard') {
      const u = this.units.get(unit);
      if (u) u.store = Math.min(u.store + c.fillPer, 400);
      return;
    }
    node.store = Math.min(97.5, node.store + c.fillPer);
    if (node.kind === 'primary') {
      for (let i = 1; i <= c.replicas; i++) {
        const rep = this.nodes.get(`rep${i}`);
        if (!rep || !this.isLive(rep.id)) continue;
        this.send({ from: 'db', to: rep.id, dur: 0.5, color: SIG.hc, r: 3.4, lane: 0, onArrive: () => this.arrive(rep, 'copy', 0) });
      }
    }
  }

  private spawnRead() {
    const reps = [...this.nodes.values()].filter((n) => n.kind === 'replica' && this.isLive(n.id));
    if (!reps.length) return;
    const rep = reps[this.readRR++ % reps.length];
    this.send({
      from: 'app',
      to: rep.id,
      dur: 0.7,
      color: SIG.req,
      r: 2.6,
      lane: -6,
      trail: false,
      onArrive: () => this.after(0.08, () => this.send({ from: rep.id, to: 'app', dur: 0.7, color: SIG.res, r: 2.6, lane: -6, trail: false })),
    });
  }

  /* ================================================================ */
  /* Queries                                                           */
  /* ================================================================ */

  private stepQueries(dt: number) {
    const c = this.cfg;
    if (c.queries === 'none') return;
    if (c.queries === 'predict') {
      if (this.game && !this.game.done) {
        if (!this.query && !this.qPending) {
          this.queryIn -= dt;
          if (this.queryIn <= 0) this.startQuery(PREDICT_QUERIES[this.seqQuery++ % PREDICT_QUERIES.length], true);
        }
        return;
      }
      // After the game: keep a gentle mix running.
      if (!this.query) {
        this.queryIn -= dt;
        if (this.queryIn <= 0) {
          this.queryIn = 3.2;
          this.startQuery(PREDICT_QUERIES[this.seqQuery++ % PREDICT_QUERIES.length], false);
        }
      }
      return;
    }
    if (this.query) return;
    this.queryIn -= dt;
    if (this.queryIn > 0) return;
    if (c.queries === 'monthly') {
      this.queryIn = 4.2;
      this.startQuery(
        { sql: "SELECT sum(total) FROM orders WHERE created_at >= '2026-09-01'", short: "created_at >= '2026-09-01'", kind: c.rule === 'year' ? 'key' : 'all', why: '' },
        false,
      );
    } else if (c.queries === 'myorders') {
      this.queryIn = 4.2;
      this.startQuery({ sql: 'SELECT * FROM orders WHERE customer_id = 42', short: 'customer_id = 42', kind: c.rule === 'hash' ? 'key' : 'all', customer: 42, why: '' }, false);
    } else if (c.queries === 'demo') {
      this.queryIn = 3.6;
      this.queryFlip = !this.queryFlip;
      this.runQuery(this.queryFlip ? 'single' : 'scatter', false);
    } else if (c.queries === 'join') {
      this.queryIn = 4.6;
      this.runJoin();
    }
  }

  /** Public: run a demo query (buttons). */
  runQuery(kind: 'single' | 'scatter', manual = true) {
    // One query at a time keeps the picture readable; a click while one runs is queued.
    if (this.query) {
      if (manual) this.queued = kind;
      this.rev++;
      return;
    }
    const spec: QuerySpec =
      kind === 'single'
        ? { sql: 'SELECT * FROM orders WHERE customer_id = 42 ORDER BY created_at DESC LIMIT 10', short: 'customer_id = 42', kind: 'key', customer: 42, why: '' }
        : { sql: 'SELECT * FROM orders ORDER BY created_at DESC LIMIT 10', short: 'latest 10, all customers', kind: 'all', why: '' };
    this.startQuery(spec, false);
    // After a click, let the learner drive for a while before the demo resumes.
    this.queryIn = manual ? 8 : 3.6;
  }

  private targetsFor(spec: QuerySpec): number[] {
    const c = this.cfg;
    const all = Array.from({ length: c.shards }, (_, i) => i);
    if (spec.kind === 'all') return all;
    if (c.rule === 'year') return [this.ownerOf(`y${c.years[c.years.length - 1]}`)];
    if (spec.customer != null) return [this.ownerOf(`h${hash2(spec.customer)}`)];
    return [0];
  }

  private startQuery(spec: QuerySpec, ask: boolean) {
    const targets = this.targetsFor(spec);
    const q: QueryRun = {
      id: this.querySeq++,
      spec,
      kind: targets.length > 1 ? 'scatter' : 'single',
      targets,
      results: [],
      round: 1,
      total: null,
      slowest: null,
      asked: ask,
      round2: [],
    };
    this.query = q;
    this.rev++;
    this.send({
      from: 'app',
      to: 'router',
      dur: HOP_IN,
      color: SIG.req,
      shape: 'square',
      r: 5,
      lane: -5,
      onArrive: () => this.queryAtRouter(q),
    });
  }

  private queryAtRouter(q: QueryRun) {
    if (q.asked && this.game && !this.game.done) {
      this.qPending = q;
      const n = this.cfg.shards;
      const ok = q.targets.length > 1 ? 'all' : 'one';
      const asked = this.game.ask({
        acceptable: [ok],
        choices: [
          { id: 'one', label: 'Just one shard' },
          { id: 'all', label: `All ${n} shards` },
        ],
        ask: 'How many shards must answer?',
        askAt: { id: 'router' },
        explain: () => q.spec.why,
        resolve: () => {
          this.qPending = null;
          this.fanOut(q);
        },
      });
      if (!asked) this.fanOut(q);
      this.rev++;
      return;
    }
    this.fanOut(q);
  }

  private shardMs(): number {
    // The first answers are scripted so the first comparison is a fair one.
    const scripted = this.msScript.shift();
    if (scripted != null) return scripted;
    const base = 6 + this.rng() * 7;
    return Math.round(this.rng() < 0.14 ? 34 + this.rng() * 26 : base);
  }

  private fanOut(q: QueryRun, round = 1, targets = q.targets) {
    q.round = round;
    for (const s of targets) {
      const entry: QueryRun['results'][number] = { shard: s, ms: null, round };
      q.results.push(entry);
      const id = shardId(s);
      this.send({
        from: 'router',
        to: id,
        dur: HOP_OUT * 0.8,
        color: SIG.req,
        shape: 'square',
        r: 4.4,
        lane: -5,
        onArrive: () => {
          const ms = this.shardMs();
          const node = this.nodes.get(id);
          const dur = ms * MS;
          if (node) node.q = { t0: this.t, dur };
          this.after(dur, () => {
            if (node) node.q = null;
            this.sayAbove(id, `${ms} ms`, ms > 30 ? SIG.heavy : SIG.res, 1.2);
            this.send({
              from: id,
              to: 'router',
              dur: HOP_OUT * 0.8,
              color: SIG.res,
              shape: 'square',
              r: 4.4,
              lane: -5,
              onArrive: () => {
                entry.ms = ms;
                this.rev++;
                this.roundDone(q);
              },
            });
          });
        },
      });
    }
    this.rev++;
  }

  private roundDone(q: QueryRun) {
    if (q.results.some((r) => r.round === q.round && r.ms == null)) return;
    if (q.kind === 'join' && q.round === 1 && q.round2.length) {
      this.say('router', 'got product ids', SIG.text2, 1.1);
      this.after(0.25, () => this.fanOut(q, 2, q.round2));
      return;
    }
    const perRound = [1, 2].map((r) => Math.max(0, ...q.results.filter((x) => x.round === r).map((x) => x.ms ?? 0)));
    const slow = q.results.reduce((a, b) => ((b.ms ?? 0) > (a.ms ?? 0) ? b : a), q.results[0]);
    const net = 2 * q.round;
    const merge = q.targets.length > 1 || q.round2.length ? 2 : 0;
    q.total = perRound[0] + perRound[1] + net + merge;
    q.slowest = q.results.length > 1 ? slow.shard : null;
    if (q.targets.length > 1 || q.round2.length) {
      this.fx({ kind: 'ring', at: { id: 'router' }, color: SIG.res, size: 1.5, dur: 0.8 });
      this.say('router', q.kind === 'join' ? 'join' : 'merge', SIG.res, 1.0);
    }
    this.send({
      from: 'router',
      to: 'app',
      dur: HOP_IN,
      color: SIG.res,
      shape: 'square',
      r: 5,
      lane: -5,
      onArrive: () => this.queryDone(q),
    });
  }

  private queryDone(q: QueryRun) {
    const total = q.total ?? 0;
    if (q.kind === 'join') {
      const shards = new Set(q.results.map((r) => r.shard)).size;
      this.joinStats = { shards, trips: q.round2.length ? 2 : 1, ms: total };
    } else {
      const list = q.kind === 'single' ? this.lat.single : this.lat.scatter;
      list.push(total);
      if (list.length > 12) list.shift();
      this.lastByKind[q.kind] = total;
    }
    if (this.cfg.queries === 'monthly') this.monthly = { shards: q.targets.length, ms: total };
    if (this.cfg.queries === 'myorders') this.myOrders = { shards: q.targets.length };
    this.sayBeside('app', `${total} ms`, SIG.res, 1.4);
    this.after(0.9, () => {
      if (this.query === q) this.query = null;
      this.queryIn = Math.min(this.queryIn, q.asked ? 0.6 : this.queryIn);
      const next = this.queued;
      this.queued = null;
      if (next) this.runQuery(next, true);
      this.rev++;
    });
    this.rev++;
  }

  /** Alice's orders joined with product names. */
  private runJoin() {
    const c = this.cfg;
    const home = this.ownerOf(`h${hash2(42)}`);
    const products = [19, 23, 7];
    const remote = [...new Set(products.map((p) => hash2(p) % c.shards))].sort();
    const q: QueryRun = {
      id: this.querySeq++,
      spec: {
        sql: 'SELECT o.id, p.name FROM orders o JOIN products p ON p.id = o.product_id WHERE o.customer_id = 42',
        short: 'orders ⨝ products',
        kind: 'key',
        customer: 42,
        why: '',
      },
      kind: 'join',
      targets: [home],
      results: [],
      round: 1,
      total: null,
      slowest: null,
      asked: false,
      round2: c.joinMode === 'sharded' ? remote : [],
    };
    this.query = q;
    this.rev++;
    this.send({ from: 'app', to: 'router', dur: HOP_IN, color: SIG.req, shape: 'square', r: 5, lane: -5, onArrive: () => this.fanOut(q) });
  }

  /* ================================================================ */
  /* Global ids                                                        */
  /* ================================================================ */

  private resetIds() {
    this.autoInc = Array.from({ length: 8 }, () => 1000);
    this.seq = Array.from({ length: 8 }, () => 0);
    this.issued.clear();
    this.ids = [];
    this.dupes = 0;
    this.idsIssued = 0;
  }

  private issueId(node: DbNode) {
    const s = node.idx;
    let id: string;
    if (this.cfg.idMode === 'auto') {
      this.autoInc[s] += 1;
      id = String(this.autoInc[s]);
    } else {
      const ms = NOW_MS - TWITTER_EPOCH + Math.floor(this.t * 1000);
      this.seq[s] = (this.seq[s] + 1) & 4095;
      id = ((BigInt(ms) << BigInt(22)) | (BigInt(s) << BigInt(12)) | BigInt(this.seq[s])).toString();
    }
    const prev = this.issued.get(id);
    const dup = prev != null && prev !== s;
    if (prev == null) this.issued.set(id, s);
    this.idsIssued++;
    const ev: IdEvent = { id, shard: s, dup };
    this.ids.unshift(ev);
    if (this.ids.length > 6) this.ids.pop();
    const short = this.cfg.idMode === 'auto' ? `id ${id}` : `id …${id.slice(-6)}`;
    this.send({
      from: node.id,
      to: 'router',
      dur: HOP_OUT * 0.8,
      color: SIG.res,
      r: 3.6,
      lane: -5,
      label: short,
      tag: 'id',
      onArrive: () =>
        this.send({
          from: 'router',
          to: 'app',
          dur: HOP_IN,
          color: dup ? SIG.err : SIG.res,
          r: 3.6,
          lane: -5,
          label: short,
          tag: 'id',
          onArrive: () => {
            if (dup) {
              this.dupes++;
              this.fx({ kind: 'x', at: { id: 'app', dx: (this.boxes.get('app')?.w ?? 160) / 2 + 16 }, color: SIG.err, size: 1.4 });
              this.sayBeside('app', `duplicate id ${id}`, SIG.err, 1.6, -22);
            }
            this.rev++;
          },
        }),
    });
    this.rev++;
  }

  setIdMode(mode: 'auto' | 'snowflake') {
    this.cfg = { ...this.cfg, idMode: mode };
    this.resetIds();
    // Ids already on their way back were made by the old scheme.
    this.flights = this.flights.filter((f) => f.tag !== 'id');
    this.rev++;
  }

  /* ================================================================ */
  /* Two-phase commit (drawn as a sequence diagram)                    */
  /* ================================================================ */

  runTransfer(crash: boolean) {
    const run = ++this.tpcRun;
    // The diagram has its own clock: it only runs while the protocol is doing something.
    const b = 0.3;
    const m: SeqMessage[] = [];
    const add = (id: string, from: string, to: string, t0: number, label: string, color?: string, hot?: boolean) =>
      m.push({ id, from, to, t0: b + t0, t1: b + t0 + 0.6, label, color, hot });
    // Pairs of messages leave 0.45 s apart so their labels don't collide.
    add('req', 'app', 'router', 0, 'transfer $50');
    add('d', 'router', 's0', 0.8, 'debit alice');
    add('c', 'router', 's2', 1.25, 'credit bob');
    add('dok', 's0', 'router', 2.0, 'ok', SIG.res);
    add('cok', 's2', 'router', 2.45, 'ok', SIG.res);
    add('p0', 'router', 's0', 3.3, 'PREPARE', SIG.warn, true);
    add('p2', 'router', 's2', 3.75, 'PREPARE', SIG.warn, true);
    add('y0', 's0', 'router', 4.55, 'YES', SIG.res, true);
    add('y2', 's2', 'router', 5.0, 'YES', SIG.res, true);
    const notes: SeqNote[] = [];
    const spans: SeqSpan[] = [
      { id: 'l0', actor: 's0', t0: b + 1.4, t1: null, label: 'locks held', color: SIG.heavy },
      { id: 'l2', actor: 's2', t0: b + 1.85, t1: null, label: 'locks held', color: SIG.heavy },
    ];
    this.tpc = { messages: m, notes, spans, crashed: false, done: false, running: true, origin: 0 };
    this.tpcClock = 0;
    this.tpcStopAt = Infinity;
    const P = this.orient === 'portrait';
    if (crash) {
      // Both votes are in and the decision is logged... then the coordinator dies before telling anyone.
      notes.push({ id: 'log', actor: 'router', t: b + 5.9, text: P ? 'COMMIT' : 'log: COMMIT', color: SIG.warn });
      this.after(b + 6.2, () => {
        if (run !== this.tpcRun) return;
        const t = this.tpcClock;
        notes.push({ id: 'crash', actor: 'router', t: t + 0.25, text: P ? '✕ down' : '✕ coordinator crashed', color: SIG.err });
        notes.push({ id: 'doubt0', actor: 's0', t: t + 0.75, text: P ? 'wait' : 'in doubt: wait', color: SIG.heavy });
        notes.push({ id: 'doubt2', actor: 's2', t: t + 0.75, text: P ? 'wait' : 'in doubt: wait', color: SIG.heavy });
        this.tpc = { ...this.tpc, crashed: true, running: false };
        // Let the notes appear, then stop the clock: nothing happens until someone restarts it.
        this.tpcStopAt = t + 1.4;
        this.rev++;
      });
    } else {
      this.after(b + 5.8, () => {
        if (run !== this.tpcRun) return;
        this.commitPhase(this.tpcClock);
      });
    }
    this.rev++;
  }

  /** Public: bring a crashed coordinator back. It reads its log and finishes the commit. */
  recoverCoordinator() {
    if (!this.tpc.crashed) return;
    const t = this.tpcClock + 0.2;
    const P = this.orient === 'portrait';
    this.tpc.notes.push({ id: 'rec', actor: 'router', t, text: P ? 'back up' : 'restart · log says COMMIT', color: SIG.res });
    this.tpc = { ...this.tpc, crashed: false, running: true };
    this.tpcStopAt = Infinity;
    const run = this.tpcRun;
    this.after(0.7, () => {
      if (run !== this.tpcRun) return;
      this.commitPhase(this.tpcClock);
    });
    this.rev++;
  }

  private commitPhase(at: number) {
    const b = at;
    const { messages: m, notes, spans } = this.tpc;
    if (!notes.some((n) => n.id === 'log')) notes.push({ id: 'log', actor: 'router', t: b + 0.1, text: this.orient === 'portrait' ? 'COMMIT' : 'log: COMMIT', color: SIG.warn });
    m.push({ id: 'k0', from: 'router', to: 's0', t0: b + 0.4, t1: b + 1.0, label: 'COMMIT', color: SIG.res, hot: true });
    m.push({ id: 'k2', from: 'router', to: 's2', t0: b + 0.85, t1: b + 1.45, label: 'COMMIT', color: SIG.res, hot: true });
    const s0 = spans.find((s) => s.id === 'l0');
    const s2 = spans.find((s) => s.id === 'l2');
    if (s0) s0.t1 = b + 1.0;
    if (s2) s2.t1 = b + 1.45;
    m.push({ id: 'a0', from: 's0', to: 'router', t0: b + 1.65, t1: b + 2.25, label: 'ACK', color: SIG.res });
    m.push({ id: 'a2', from: 's2', to: 'router', t0: b + 2.1, t1: b + 2.7, label: 'ACK', color: SIG.res });
    m.push({ id: 'done', from: 'router', to: 'app', t0: b + 2.95, t1: b + 3.55, label: 'done ✓', color: SIG.res });
    const run = this.tpcRun;
    this.tpcStopAt = b + 4.0;
    this.after(3.6, () => {
      if (run !== this.tpcRun) return;
      this.tpc = { ...this.tpc, done: true, running: false };
      this.rev++;
    });
    this.rev++;
  }

  /* ================================================================ */
  /* Resharding                                                        */
  /* ================================================================ */

  private buildTiles() {
    this.tiles = TILE_HASHES.map((h) => ({ h, owner: h % 4, moving: false, moved: false }));
  }

  /** Public: add or remove shard-4 in the tile demos. */
  reshardTiles(n: 4 | 5) {
    const c = this.cfg;
    if (this.tileMoving > 0 || c.shards === n) return;
    const from = c.shards;
    this.cfg = { ...c, shards: n };
    if (n === 5) {
      this.box('s4');
      this.buildNodesKeep();
      this.relayout();
      const b = this.boxes.get('s4');
      const s3 = this.boxes.get('s3');
      if (b && s3) {
        b.x = s3.x + 60;
        b.y = s3.y;
        b.alpha = 0;
      }
    }
    const owner = (h: number) => (c.hashMode === 'buckets' ? (n === 5 ? BUCKET_OWNER_5 : BUCKET_OWNER_4)[h % 16] : h % n);
    let moving = 0;
    let delay = 0.35;
    const movers = this.tiles.filter((t) => owner(t.h) !== t.owner);
    for (const t of movers) {
      const to = owner(t.h);
      const src = t.owner;
      const d = delay;
      delay += movers.length > 10 ? 0.11 : 0.22;
      moving++;
      this.after(d, () => {
        t.moving = true;
        this.send({
          from: shardId(src),
          to: shardId(to),
          dur: 1.1,
          color: shardColor(to),
          shape: 'square',
          r: 4.6,
          lane: 0,
          label: String(t.h),
          onArrive: () => {
            t.owner = to;
            t.moving = false;
            t.moved = true;
            this.tileMoving--;
            this.tileMoves++;
            this.rev++;
            if (this.tileMoving === 0 && n === 4) this.dropShard(4);
          },
        });
        this.rev++;
      });
    }
    this.tileMoving = moving;
    for (const t of this.tiles) t.moved = false;
    this.tileMoves = 0;
    this.moved = { rows: movers.length, of: this.tiles.length };
    this.lastReshard = { from, to: n, rule: 'hash', mode: c.hashMode, pct: movers.length / this.tiles.length };
    if (moving === 0 && n === 4) this.dropShard(4);
    this.rev++;
  }

  private dropShard(i: number) {
    // The shard may have been added back in the meantime.
    if (i < this.cfg.shards) return;
    this.hide(shardId(i));
    this.nodes.delete(shardId(i));
    this.rev++;
  }

  private buildNodesKeep() {
    const c = this.cfg;
    for (let i = 0; i < c.shards; i++) {
      const id = shardId(i);
      if (!this.nodes.has(id)) {
        this.nodes.set(id, { id, kind: 'shard', idx: i, r: 0, queue: [], work: 0, store: 0, failed: 0, shownFill: 0, shownLoad: 0, q: null, cap: c.cap });
      }
    }
  }

  /** Public: give the biggest tenant its own shard (directory step). */
  moveTenant(name: string) {
    const c = this.cfg;
    if (this.dirMoving || c.rule !== 'dir') return;
    const src = this.dirMap[name];
    const dst = c.shards;
    if (dst > 5) return;
    this.cfg = { ...c, shards: dst + 1, prefill: [...c.prefill, 0] };
    const id = shardId(dst);
    this.box(id);
    this.buildNodesKeep();
    this.relayout();
    const b = this.boxes.get(id);
    const prev = this.boxes.get(shardId(dst - 1));
    if (b && prev) {
      b.x = prev.x + 50;
      b.y = prev.y;
      b.alpha = 0;
    }
    this.dirMoving = name;
    const copies = 7;
    for (let i = 0; i < copies; i++) {
      this.after(0.5 + i * 0.28, () =>
        this.send({
          from: shardId(src),
          to: id,
          dur: 1.15,
          color: shardColor(dst),
          shape: 'square',
          r: 4.4,
          lane: 0,
          label: i === 0 ? name : undefined,
          onArrive: () => {
            if (i === copies - 1) {
              const u = this.units.get(name);
              if (u) u.owner = dst;
              this.dirMap = { ...this.dirMap, [name]: dst };
              this.dirMoving = null;
              this.say('dir', `${name} → shard-${dst}`, SIG.hc, 1.8);
              this.rev++;
            }
          },
        }),
      );
    }
    this.rev++;
  }

  /* ================================================================ */
  /* Controls used by the panel                                        */
  /* ================================================================ */

  setRate(v: number) {
    this.rate = v;
    this.cfg = { ...this.cfg, rate: v, ramp: null };
    this.rev++;
  }

  /** Vertical scaling: a machine with twice the CPU and disk. */
  upgradeDb() {
    if (this.capMul >= 2) return;
    this.capMul = 2;
    const db = this.nodes.get('db');
    if (db) db.store /= 2;
    this.say('db', '2× CPU · 2× disk', SIG.res, 1.8);
    this.rev++;
  }

  addReplica() {
    const c = this.cfg;
    if (c.replicas >= 3) return;
    const i = c.replicas + 1;
    this.cfg = { ...c, replicas: i };
    const id = `rep${i}`;
    this.box(id);
    const db = this.nodes.get('db');
    this.nodes.set(id, { id, kind: 'replica', idx: i, r: 0, queue: [], work: 0, store: db?.store ?? 60, failed: 0, shownFill: 0, shownLoad: 0, q: null, cap: c.cap });
    this.relayout();
    const b = this.boxes.get(id);
    const p = this.boxes.get('db');
    if (b && p) {
      b.x = p.x;
      b.y = p.y;
      b.alpha = 0;
    }
    // A new replica starts by copying everything the primary has.
    for (let k = 0; k < 6; k++)
      this.after(0.2 + k * 0.18, () => this.send({ from: 'db', to: id, dur: 0.7, color: SIG.hc, r: 3.6, lane: 0, shape: 'square' }));
    this.say(id, 'copying 100% of the data', SIG.hc, 2);
    this.rev++;
  }

  /** Switch the rule (shard key) and start over with that key's data layout. */
  setRule(rule: Rule, prefill?: number[]) {
    this.cfg = { ...this.cfg, rule, prefill: prefill ?? this.cfg.prefill };
    for (const node of this.nodes.values()) {
      node.queue = [];
      node.r = 0;
    }
    this.buildUnits();
    this.deck = [];
    this.warmStart();
    this.last = null;
    this.monthly = null;
    this.myOrders = null;
    this.query = null;
    this.queryIn = 1.2;
    this.failed = 0;
    // Writes already in the air were routed by the old key; drop them.
    this.flights = [];
    this.rev++;
  }

  setRouterMode(mode: 'proxy' | 'app') {
    this.cfg = { ...this.cfg, routerMode: mode };
    if (mode === 'proxy') this.box('router');
    else this.hide('router');
    this.flights = [];
    this.rev++;
  }

  /** A hot key takes ~70% of writes. In the lesson step it also brings a traffic spike. */
  setHot(on: boolean, spike = true) {
    this.cfg = { ...this.cfg, hot: on, salted: on ? this.cfg.salted : false };
    if (spike) this.rate = on ? Math.max(this.rate, 8) : this.cfg.rate;
    this.rev++;
  }

  setSalted(on: boolean) {
    this.cfg = { ...this.cfg, salted: on };
    this.rev++;
  }

  setJoinMode(mode: 'reference' | 'sharded') {
    this.cfg = { ...this.cfg, joinMode: mode };
    this.joinStats = null;
    // Drop the query in flight (it used the old layout) and start a fresh one.
    this.query = null;
    this.flights = [];
    for (const node of this.nodes.values()) node.q = null;
    // Steady shard times for the first run, so the only difference is the extra round trip.
    this.msScript = [10, 11, 9, 12, 10];
    this.queryIn = 0.3;
    this.rev++;
  }

  /* ---------------- playground ---------------- */

  /** Change the number of shards and move whatever the rule says must move. */
  pgSetShards(n: number) {
    const c = this.cfg;
    const from = c.shards;
    if (n === from || n < 2 || n > 6) return;
    const oldOwner = new Map([...this.units.values()].map((u) => [u.key, u.owner]));
    const total = [...this.units.values()].reduce((a, u) => a + u.store, 0) || 1;
    this.cfg = { ...c, shards: n };
    const fresh: string[] = [];
    for (let i = from; i < n; i++) {
      fresh.push(shardId(i));
      this.box(shardId(i));
    }
    this.buildNodesKeep();
    // Re-own units.
    if (c.rule === 'hash') {
      if (c.hashMode === 'buckets') this.bucketOwner = rebalanceBuckets(this.bucketOwner, from, n);
      for (const u of this.units.values()) {
        const h = Number(u.key.slice(1));
        u.owner = c.hashMode === 'buckets' ? this.bucketOwner[h] : h % n;
      }
    } else if (c.rule === 'year') {
      c.years.forEach((y, i) => {
        const u = this.units.get(`y${y}`);
        if (u) u.owner = yearOwner(i, c.years.length, n);
      });
    } else if (c.rule === 'country') {
      const map = packCountries(n);
      for (const u of this.units.values()) u.owner = map[u.key];
    }
    // Animate the moves: one flight per chunk of moved data.
    let movedStore = 0;
    const flows = new Map<string, number>();
    for (const u of this.units.values()) {
      const o = oldOwner.get(u.key) ?? u.owner;
      if (o === u.owner) continue;
      movedStore += u.store;
      const k = `${o}>${u.owner}`;
      flows.set(k, (flows.get(k) ?? 0) + u.store);
    }
    this.relayout();
    // New shards slide in from the right end of the row.
    const lastOld = this.boxes.get(shardId(from - 1));
    for (const id of fresh) {
      const b = this.boxes.get(id);
      if (b && lastOld) {
        b.x = lastOld.x + 40;
        b.y = lastOld.y;
        b.alpha = 0;
      }
    }
    let d = 0.3;
    for (const [k, amount] of flows) {
      const [a, b] = k.split('>').map(Number);
      const count = Math.max(1, Math.min(4, Math.round((amount / total) * 20)));
      for (let i = 0; i < count; i++) {
        this.after(d, () => {
          if (this.boxes.has(shardId(a)) && this.boxes.has(shardId(b))) this.send({ from: shardId(a), to: shardId(b), dur: 1.1, color: shardColor(b), shape: 'square', r: 4.2, lane: 0 });
        });
        d += 0.08;
      }
    }
    // Removed shards stay until their data has left, then fade out.
    for (let i = n; i < from; i++) this.after(d + 0.25, () => this.dropShard(i));
    const pct = movedStore / total;
    this.movedPct = pct;
    this.lastReshard = { from, to: n, rule: c.rule, mode: c.hashMode, pct };
    this.rev++;
  }

  pgSetMode(mode: 'modn' | 'buckets') {
    if (this.cfg.hashMode === mode) return;
    this.cfg = { ...this.cfg, hashMode: mode };
    if (this.cfg.rule === 'hash') {
      const n = this.cfg.shards;
      this.bucketOwner = Array.from({ length: 100 }, (_, b) => b % n);
      for (const u of this.units.values()) u.owner = Number(u.key.slice(1)) % n;
    }
    this.rev++;
  }

  pgSetRule(rule: 'hash' | 'year' | 'country') {
    const n = this.cfg.shards;
    const prefill = rule === 'year' ? yearPrefill(this.cfg.years.length, n) : Array.from({ length: n }, () => 26);
    // The hot customer only exists for the customer_id key.
    if (rule !== 'hash') this.cfg = { ...this.cfg, hot: false, salted: false };
    this.setRule(rule, prefill);
    this.movedPct = null;
    this.lastReshard = null;
  }

  /* ================================================================ */
  /* Read-only helpers for drawing and the panel                      */
  /* ================================================================ */

  shardNodes(): DbNode[] {
    return [...this.nodes.values()].filter((n) => n.kind === 'shard').sort((a, b) => a.idx - b.idx);
  }

  fillOf(node: DbNode): number {
    if (node.kind !== 'shard') return node.store;
    let s = 0;
    for (const u of this.units.values()) if (u.owner === node.idx) s += u.store;
    return s;
  }

  loadOf(node: DbNode): number {
    return node.r / (node.cap * (node.kind === 'shard' ? 1 : this.capMul));
  }

  tagOf(i: number): string {
    const c = this.cfg;
    switch (c.rule) {
      case 'name':
        return ['A–F', 'G–L', 'M–R', 'S–Z'][i] ?? '';
      case 'year': {
        const ys = c.years.filter((y) => this.ownerOf(`y${y}`) === i);
        if (!ys.length) return '—';
        const last = c.years[c.years.length - 1];
        const lo = ys[0];
        const hi = ys[ys.length - 1];
        const txt = lo === hi ? `${lo}` : `${lo}–${String(hi).slice(2)}`;
        return hi === last ? `${txt}+` : txt;
      }
      case 'hash':
        if (c.tiles && c.hashMode === 'buckets') {
          const own = c.shards === 5 ? BUCKET_OWNER_5 : BUCKET_OWNER_4;
          return `b ${own.map((s, b) => (s === i ? b : -1)).filter((b) => b >= 0).join(' ')}`;
        }
        if (c.hashMode === 'buckets') return `${this.bucketOwner.filter((s) => s === i).length} buckets`;
        return `mod ${c.shards} = ${i}`;
      case 'country':
        return COUNTRIES.filter((k) => this.ownerOf(k.code) === i)
          .map((k) => k.code)
          .join(' ');
      case 'dir':
        return TENANTS.filter((t) => this.dirMap[t.name] === i)
          .map((t) => t.name)
          .join(' ');
      case 'vitess':
        return VITESS_RANGES[i] ?? '';
      default:
        return '';
    }
  }

  /** Units a shard owns in the playground (for the readout). */
  unitShare(i: number): number {
    const all = [...this.units.values()].reduce((a, u) => a + u.store, 0) || 1;
    return [...this.units.values()].filter((u) => u.owner === i).reduce((a, u) => a + u.store, 0) / all;
  }

  hottest(): DbNode | null {
    const list = this.cfg.scene === 'sharded' ? this.shardNodes() : [...this.nodes.values()];
    return list.reduce<DbNode | null>((a, b) => (!a || b.shownLoad > a.shownLoad ? b : a), null);
  }

  skew(): number | null {
    const list = this.shardNodes();
    if (!list.length) return null;
    const loads = list.map((n) => n.shownLoad);
    const mean = loads.reduce((a, b) => a + b, 0) / loads.length;
    if (mean < 0.05) return null;
    return Math.max(...loads) / mean;
  }

  idle(): number {
    return this.shardNodes().filter((n) => n.shownLoad < 0.05).length;
  }

  totalRate(): number {
    let s = 0;
    for (const n of this.nodes.values()) if (n.kind === 'shard' || n.kind === 'db' || n.kind === 'primary') s += n.r;
    return s;
  }

  avg(list: number[]): number | null {
    return list.length ? Math.round(list.reduce((a, b) => a + b, 0) / list.length) : null;
  }

  sinceFail(): number {
    return this.t - this.lastFailT;
  }

  shardCount(): number {
    return this.cfg.shards;
  }
}

/* ================================================================== */
/* helpers                                                             */
/* ================================================================== */

/** Contiguous year ranges: the newest year gets its own shard, older years share the rest. */
export function yearOwner(i: number, years: number, n: number): number {
  if (i === years - 1) return n - 1;
  if (n <= 1) return 0;
  const older = years - 1;
  return Math.min(n - 2, Math.floor((i * (n - 1)) / older));
}

export function yearPrefill(years: number, n: number): number[] {
  // Older years hold more data: the business has been busy.
  const per = Array.from({ length: years }, (_, i) => (i === years - 1 ? 18 : 30 + i * 4));
  const out = Array.from({ length: n }, () => 0);
  per.forEach((v, i) => (out[yearOwner(i, years, n)] += v));
  return out.map((v) => Math.min(92, v));
}

/** Minimal-move rebalance of 100 buckets from `from` shards to `n` shards. */
export function rebalanceBuckets(owner: number[], from: number, n: number): number[] {
  const out = [...owner];
  const target = (i: number) => Math.floor(100 / n) + (i < 100 % n ? 1 : 0);
  // Orphaned buckets (removed shards) need a new home.
  const orphans: number[] = [];
  out.forEach((s, b) => {
    if (s >= n) orphans.push(b);
  });
  const count = Array.from({ length: n }, (_, i) => out.filter((s) => s === i).length);
  // Take extras from over-full shards.
  for (let i = 0; i < n; i++) {
    while (count[i] > target(i)) {
      const b = out.lastIndexOf(i);
      out[b] = -1;
      orphans.push(b);
      count[i]--;
    }
  }
  for (const b of orphans) {
    let best = 0;
    for (let i = 1; i < n; i++) if (count[i] - target(i) < count[best] - target(best)) best = i;
    out[b] = best;
    count[best]++;
  }
  void from;
  return out;
}
