import type { InspectorLine } from '@/components/stage/overlays';
import { SIG } from '@/lib/sim/colors';
import { clamp, damp, type Curve } from '@/lib/sim/geometry';
import { PredictGame } from '@/lib/sim/predict';
import { mulberry32 } from '@/lib/sim/rng';
import { Sim, type Flight, type ScriptEvent, type WireSpec } from '@/lib/sim/Sim';
import { Cache, sampleRank, zipfWeights, type Entry, type Ghost, type GoneKind, type Policy } from './cache';
import { ADMIN, HOT, PRODUCTS, SHOPPERS, keyName, product } from './products';

/* ------------------------------------------------------------------ */
/* Configuration                                                       */
/* ------------------------------------------------------------------ */

export type View = 'flow' | 'race' | 'sequence' | 'layers';
/** What a write does: DB only (and forget the cache), or one of the classic strategies. */
export type WriteMode = 'none' | 'around' | 'through' | 'back';
export type PredictKind = 'hitmiss' | 'evict' | 'stampede';

export interface CacheConfig {
  view: View;
  /** Is there a cache at all? */
  cache: boolean;
  /** Cache capacity, in keys */
  slots: number;
  policy: Policy;
  /** Seconds (simulated); 0 = keys never expire */
  ttl: number;
  /** TTL jitter, as a fraction (0.1 = ±10%) */
  jitter: number;
  /** Shopper reads per simulated second */
  rps: number;
  /** How many products the traffic touches (most popular first) */
  keys: number;
  /** Zipf exponent: 0 = every product equally popular */
  skew: number;
  /** Share of traffic forced onto the hot product (a flash sale) */
  hotShare: number;
  /** Scripted product ids, cycled instead of random picks */
  sequence: number[] | null;
  /** One request at a time (for predictions and the guided tour) */
  sequential: boolean;
  /** Keys loaded before the step starts, most recently used first */
  prewarm: number[];
  /** Remaining TTL of the hot key at the start of the step */
  hotTtlLeft: number | null;
  /** Dave the admin is on stage */
  admin: boolean;
  /** Seconds between Dave's automatic price changes (0 = only when asked) */
  writeEvery: number;
  writeMode: WriteMode;
  /** Single flight: one DB query per key, everyone else waits for it */
  coalesce: boolean;
  /** Refresh hot keys in the background before they expire */
  refreshAhead: boolean;
  dbWorkers: number;
  /** Write-back: seconds between flushes to the database */
  flushEvery: number;
  /** Guided tour: slower hops and an inspector card riding along */
  tour: boolean;
  predict: PredictKind | null;
  /** Draw TTL bars in the cache rows */
  showTtl: boolean;
  /** Draw LFU read counters in the cache rows */
  showFreq: boolean;
  /** Draw the database's product table next to it */
  showTable: boolean;
  /**
   * How the cache rows are drawn: 'policy' keeps them in eviction order (the
   * next victim last, rows reorder on every access); 'slot' keeps each key in
   * a fixed place, which is calmer when eviction isn't the point.
   */
  order: 'policy' | 'slot';
}

export const DEFAULTS: CacheConfig = {
  view: 'flow',
  cache: true,
  slots: 8,
  policy: 'lru',
  ttl: 0,
  jitter: 0,
  rps: 1.6,
  keys: 8,
  skew: 1.1,
  hotShare: 0,
  sequence: null,
  sequential: false,
  prewarm: [],
  hotTtlLeft: null,
  admin: false,
  writeEvery: 0,
  writeMode: 'none',
  coalesce: false,
  refreshAhead: false,
  dbWorkers: 3,
  flushEvery: 5,
  tour: false,
  predict: null,
  showTtl: false,
  showFreq: false,
  showTable: false,
  order: 'slot',
};

/* ------------------------------------------------------------------ */
/* Timing                                                              */
/* ------------------------------------------------------------------ */

/** Hop durations, simulated seconds. Not to scale: hits are slowed down so you can see them. */
const HOP = { client: 0.62, cache: 0.3, db: 0.46 };
/** A product-page query: ~1.8 simulated seconds, shown as ~50 ms. */
const QUERY_S = 1.8;
const UPDATE_S = 0.8;
/** Displayed time for an UPDATE by primary key plus its commit, ms. */
const WRITE_MS = 9;
const FLUSH_S = 0.9;
/** Displayed milliseconds per simulated second of database time. */
export const DB_MS_PER_S = 50 / QUERY_S;
/** Displayed round trip to Redis, ms. */
export const REDIS_MS = 1;
/** Race view, drawn to scale: 1 ms = 0.06 simulated seconds. */
export const RACE_S_PER_MS = 0.06;
const RACE_DB_MS = 50;
const RACE_EVERY = 5.6;
/** Refresh-ahead kicks in when a hot key has less than this share of its TTL left. */
const REFRESH_AT = 0.45;

const NIL = '#8FA6C9';
/** How long an evicted / expired / deleted row lingers, fading (visual seconds). */
export const GHOST_S = 1.05;

/* ------------------------------------------------------------------ */
/* Internal state                                                      */
/* ------------------------------------------------------------------ */

interface Req {
  id: number;
  client: string;
  key: number;
  /** Arrived at the app (simulated time) */
  t0: number;
  hit: boolean | null;
  price: number | null;
  /** Displayed database time for this read, ms */
  dbMs: number;
  /** Coalesced: waiting since (simulated time) */
  waitFrom: number | null;
  /** Already counted as a miss; this is the double-check re-read */
  recheck: boolean;
  /** Version of the data this read got, and whether it was already outdated */
  ver: number;
  stale: boolean;
}

export type DbKind = 'select' | 'update' | 'flush' | 'refresh';

export interface DbJob {
  id: number;
  key: number;
  kind: DbKind;
  enq: number;
  start: number | null;
  dur: number;
  /** Price read (select) or written (update), fixed when the job starts */
  price: number;
  /** Row version read (select); stale = older than an acknowledged write */
  ver: number;
  stale: boolean;
  onDone: (job: DbJob) => void;
}

export interface Note {
  head: string;
  lines: InspectorLine[];
  tone: 'req' | 'res' | 'err';
  at: { flight: number } | { box: string; dy?: number };
  progress?: () => number;
}

export interface RaceState {
  t0: number;
  cacheMs: number | null;
  dbMs: number | null;
  round: number;
}

export interface LayerReq {
  path: string;
  /** The layer (0 = browser) that has it cached */
  hitAt: number;
}

export const LAYER_REQS: LayerReq[] = [
  { path: 'GET /app.3f9a.js', hitAt: 0 },
  { path: 'GET /img/boots.jpg', hitAt: 1 },
  { path: 'GET /api/flags', hitAt: 2 },
  { path: 'GET /api/products/42', hitAt: 3 },
  { path: 'GET /api/orders?me', hitAt: 4 },
];

export interface LayerState {
  idx: number;
  /** Which band is lit, and how */
  lit: { band: number; kind: 'miss' | 'hit'; vt: number }[];
  hits: number[];
  current: LayerReq | null;
}

/* ------------------------------------------------------------------ */

export class CacheSim extends Sim {
  cfg: CacheConfig = { ...DEFAULTS };
  cache = new Cache(DEFAULTS.slots, DEFAULTS.policy);
  ghosts: Ghost[] = [];
  game: PredictGame | null = null;
  note: Note | null = null;

  /** The database's rows (the source of truth for prices) */
  dbPrice = new Map<number, number>();
  /** Version of each product's row in Postgres (every committed write bumps it) */
  dbVer = new Map<number, number>();
  /**
   * Newest version whose write was acknowledged to the writer. A read that
   * returns anything older is stale. (Reads racing an unfinished write may
   * return either value: that's not stale, just concurrent.)
   */
  ackVer = new Map<number, number>();
  private verSeq = new Map<number, number>();
  /** Last price Dave asked for, per product, so repeated changes walk a ladder */
  private lastAsked = new Map<number, number>();
  running: DbJob[] = [];
  queue: DbJob[] = [];
  /** Coalescing: requests waiting for a query already in flight, by key */
  inflight = new Map<number, Req[]>();
  refreshing = new Set<number>();
  cacheDown = false;
  race: RaceState | null = null;
  layer: LayerState = { idx: 0, lit: [], hits: [0, 0, 0, 0, 0], current: null };

  /* ---- metrics ---- */
  hits = 0;
  misses = 0;
  staleReads = 0;
  evictions = 0;
  hotEvictions = 0;
  hotQueriesLastExpiry = 0;
  /** Background refreshes of the hot key (refresh-ahead) */
  hotRefreshes = 0;
  /** The last time the hot key expired: how many queries it caused, once things settled */
  lastHerd: { queries: number; rps: number; coalesce: boolean } | null = null;
  private herdOpen = false;
  private herdRps = 0;
  lostWrites = 0;
  lastWriteMs: number | null = null;
  tally = new Map<number, number>();
  private lookups: boolean[] = [];
  private lats: number[] = [];
  private stales: boolean[] = [];
  private busyBuckets: number[] = [];
  private busyAcc = 0;
  private bucketT = 0;
  p95Spark: number[] = [];

  /* ---- layout facts the renderer needs ---- */
  rowH = 22;
  headerH = 30;

  private weights = zipfWeights(DEFAULTS.keys, DEFAULTS.skew);
  private rand = mulberry32(7);
  private reqSeq = 0;
  private jobSeq = 0;
  private nextIn = 0.4;
  private nextWrite = 3;
  private nextFlush = 5;
  private seqIdx = 0;
  private clientIdx = 0;
  private activeReads = 0;
  private gap = 0;
  private writeIdx = 0;

  constructor() {
    super();
    this.resetWorld();
  }

  /* ================================================================ */
  /* Step entry                                                       */
  /* ================================================================ */

  enter(cfg: CacheConfig, script: ScriptEvent<CacheSim>[] = [], opts: { reset?: boolean; predict?: number } = {}) {
    this.cfg = { ...cfg };
    if (opts.reset) this.resetWorld();
    else this.applyCacheShape();
    this.weights = zipfWeights(this.cfg.keys, this.cfg.skew);
    this.syncBoxes();
    this.game = opts.predict ? new PredictGame(this, opts.predict) : null;
    this.note = null;
    if (this.cfg.view === 'race') this.after(0.7, () => this.startRace());
    if (this.cfg.view === 'layers') this.after(0.6, () => this.startLayerReq());
    this.runScript(script);
    this.relayout();
    this.rev++;
  }

  private resetWorld() {
    this.clearTransient();
    this.rand = mulberry32(7);
    this.cache = new Cache(this.cfg.slots, this.cfg.policy);
    this.ghosts = [];
    this.running = [];
    this.queue = [];
    this.inflight.clear();
    this.refreshing.clear();
    this.cacheDown = false;
    this.race = null;
    this.layer = { idx: 0, lit: [], hits: [0, 0, 0, 0, 0], current: null };
    this.dbPrice = new Map(PRODUCTS.map((p) => [p.id, p.price]));
    this.dbVer = new Map();
    this.ackVer = new Map();
    this.verSeq = new Map();
    this.lastAsked = new Map();
    this.hits = 0;
    this.misses = 0;
    this.staleReads = 0;
    this.evictions = 0;
    this.hotEvictions = 0;
    this.hotQueriesLastExpiry = 0;
    this.hotRefreshes = 0;
    this.lastHerd = null;
    this.herdOpen = false;
    this.lostWrites = 0;
    this.lastWriteMs = null;
    this.tally = new Map();
    this.lookups = [];
    this.lats = [];
    this.stales = [];
    this.busyBuckets = [];
    this.busyAcc = 0;
    this.bucketT = 0;
    this.p95Spark = [];
    this.nextIn = 0.4;
    this.nextWrite = this.cfg.writeEvery > 0 ? Math.min(2.5, this.cfg.writeEvery) : Infinity;
    this.nextFlush = this.cfg.flushEvery;
    this.seqIdx = 0;
    this.clientIdx = 0;
    this.activeReads = 0;
    this.gap = 0.3;
    this.writeIdx = 0;
    this.note = null;
    this.prewarm();
  }

  private prewarm() {
    const list = this.cfg.cache ? this.cfg.prewarm.slice(0, this.cfg.slots) : [];
    // Insert least recent first, so the first key listed ends up most recently used.
    [...list].reverse().forEach((key, i) => {
      const at = this.t - (list.length - i) * 0.05;
      const ttl = this.ttlFor(key);
      const { entry } = this.cache.set(key, this.dbPrice.get(key) ?? product(key).price, at, ttl);
      entry.freq = Math.max(1, Math.round(9 / (1 + PRODUCTS.findIndex((p) => p.id === key))));
      if (ttl > 0) {
        // Spread the remaining TTLs so the bars don't all look alike.
        const left = key === HOT && this.cfg.hotTtlLeft != null ? this.cfg.hotTtlLeft : ttl * (0.45 + 0.5 * ((i * 0.37) % 1));
        entry.expiresAt = this.t + left;
      }
    });
    list.forEach((key, i) => {
      const e = this.cache.peek(key);
      if (e) e.slot = i;
    });
    this.cache.ordered().forEach((e, i) => {
      e.ry = this.cfg.order === 'slot' ? e.slot : i;
      e.alpha = 1;
    });
  }

  /** Capacity or policy changed without a reset. */
  private applyCacheShape() {
    this.cache.policy = this.cfg.policy;
    if (this.cfg.slots !== this.cache.capacity) {
      for (const e of this.cache.resize(this.cfg.slots)) this.addGhost(e, 'evict');
    }
  }

  private syncBoxes() {
    const want = new Set<string>();
    const v = this.cfg.view;
    if (v === 'flow' || v === 'race') {
      if (v === 'flow') SHOPPERS.forEach((c) => want.add(c.id));
      if (v === 'flow' && this.cfg.admin) want.add(ADMIN.id);
      want.add('app');
      if (this.cfg.cache) want.add('cache');
      want.add('db');
    } else if (v === 'layers') {
      want.add('user');
      for (let i = 0; i < 5; i++) want.add(`L${i}`);
    }
    for (const id of want) this.box(id);
    for (const id of [...this.boxes.keys()]) if (!want.has(id)) this.hide(id);
  }

  /* ================================================================ */
  /* Methods the panel calls                                          */
  /* ================================================================ */

  setRps(rps: number) {
    this.cfg = { ...this.cfg, rps };
    this.rev++;
  }

  setSlots(slots: number) {
    this.cfg = { ...this.cfg, slots };
    this.applyCacheShape();
    this.lookups = [];
    this.relayout();
    this.rev++;
  }

  setPolicy(policy: Policy) {
    this.cfg = { ...this.cfg, policy, showFreq: policy === 'lfu' };
    this.cache.policy = policy;
    this.evictions = 0;
    this.hotEvictions = 0;
    this.lookups = [];
    this.hits = 0;
    this.misses = 0;
    this.rev++;
  }

  setTtl(ttl: number) {
    this.cfg = { ...this.cfg, ttl, showTtl: ttl > 0 };
    // So the slider takes effect at once, cached keys are clamped to the new TTL.
    // (In Redis, existing keys would keep their old deadline until rewritten.)
    for (const e of this.cache.entries.values()) {
      e.ttl = ttl;
      e.expiresAt = ttl > 0 ? Math.min(e.expiresAt, this.t + ttl) : Infinity;
    }
    this.lookups = [];
    this.stales = [];
    this.rev++;
  }

  setSkew(skew: number) {
    this.cfg = { ...this.cfg, skew };
    this.weights = zipfWeights(this.cfg.keys, skew);
    this.rev++;
  }

  setCoalesce(on: boolean) {
    this.cfg = { ...this.cfg, coalesce: on };
    this.rev++;
  }

  setWriteMode(mode: WriteMode) {
    this.cfg = { ...this.cfg, writeMode: mode };
    this.lastWriteMs = null;
    this.rev++;
  }

  /** Dave changes a price every few seconds (or stops). */
  setWrites(on: boolean, every = 3) {
    this.cfg = { ...this.cfg, admin: on, writeEvery: on ? every : 0 };
    this.nextWrite = on ? 1.2 : Infinity;
    this.syncBoxes();
    this.relayout();
    this.rev++;
  }

  /** Stampede demo: protection off, coalescing, or refresh-ahead. */
  setProtection(p: 'none' | 'coalesce' | 'refresh') {
    this.cfg = { ...this.cfg, coalesce: p === 'coalesce', refreshAhead: p === 'refresh' };
    this.hotQueriesLastExpiry = 0;
    this.rev++;
  }

  /** Force a key to expire right now. */
  expireNow(key: number = HOT) {
    const e = this.cache.peek(key);
    if (e) e.expiresAt = this.t;
    this.rev++;
  }

  /** Dave changes a price. The write strategy decides what happens to the cache. */
  changePrice(key: number = HOT, mode: WriteMode = this.cfg.writeMode) {
    const cur = this.lastAsked.get(key) ?? product(key).price;
    const ladder = [89, 79, 69, 59, 99];
    const base = product(key).price;
    const next = key === HOT ? ladder[(ladder.indexOf(cur) + 1) % ladder.length] : cur === base ? base - 4 : base;
    this.lastAsked.set(key, next);
    this.adminWrite(key, next, mode);
  }

  /** Redis dies and restarts empty. Unflushed write-back data is gone. */
  crashCache() {
    if (!this.cfg.cache || this.cacheDown) return;
    const all = this.cache.clear();
    let lost = 0;
    for (const e of all) {
      if (e.dirty) {
        lost += 1;
        // The acknowledged write never reached the database: it's gone for good.
        this.ackVer.set(e.key, this.dbVer.get(e.key) ?? 0);
        this.lastAsked.set(e.key, this.dbPrice.get(e.key) ?? e.price);
      }
      this.addGhost(e, 'lost');
    }
    this.lostWrites += lost;
    this.cacheDown = true;
    this.fx({ kind: 'x', at: { id: 'cache' }, color: SIG.err, dur: 1.2, size: 2 });
    this.say('cache', lost ? `crashed: ${lost} unsaved write${lost > 1 ? 's' : ''} lost` : 'crashed', SIG.err, 2.2);
    this.after(2.2, () => {
      this.cacheDown = false;
      this.say('cache', 'restarted, empty', SIG.text2);
      this.rev++;
    });
    this.rev++;
  }

  /* ================================================================ */
  /* Queries for the renderer and panel                               */
  /* ================================================================ */

  get hitRatio(): number | null {
    // Wait for a few lookups so the number isn't wild; one-at-a-time steps show it sooner.
    if (this.lookups.length < (this.cfg.sequential ? 2 : 6)) return null;
    return this.lookups.filter(Boolean).length / this.lookups.length;
  }

  get p95(): number | null {
    if (this.lats.length < 3) return null;
    const s = [...this.lats].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(s.length * 0.95))];
  }

  get avgLatency(): number | null {
    if (!this.lats.length) return null;
    return this.lats.reduce((a, b) => a + b, 0) / this.lats.length;
  }

  get staleRate(): number | null {
    if (!this.stales.length) return null;
    return this.stales.filter(Boolean).length / this.stales.length;
  }

  /** Share of the database's capacity in use over the last few seconds. */
  get dbLoad(): number {
    const window = this.busyBuckets.length * 0.5 + this.bucketT;
    if (window <= 0.01) return this.running.length / Math.max(1, this.cfg.dbWorkers);
    const busy = this.busyBuckets.reduce((a, b) => a + b, 0) + this.busyAcc;
    return clamp(busy / (window * this.cfg.dbWorkers), 0, 1);
  }

  get dbInFlight(): number {
    return this.running.length + this.queue.length;
  }

  waitingFor(key: number): number {
    return this.inflight.get(key)?.length ?? 0;
  }

  get waitingTotal(): number {
    let n = 0;
    for (const w of this.inflight.values()) n += w.length;
    return n;
  }

  /** Rows in display order: the next victim is last. */
  rows(): Entry[] {
    return this.cache.ordered();
  }

  /** Does this cached copy hold an older version than a write already acknowledged? */
  isStale(e: Entry): boolean {
    return !e.dirty && e.version < this.ackOf(e.key);
  }

  private ackOf(key: number) {
    return this.ackVer.get(key) ?? 0;
  }

  private nextVer(key: number) {
    const v = (this.verSeq.get(key) ?? 0) + 1;
    this.verSeq.set(key, v);
    return v;
  }

  jobProgress(j: DbJob): number {
    return j.start == null ? 0 : clamp((this.t - j.start) / j.dur, 0, 1);
  }

  /** Geometry of the cache box's rows, in stage pixels. */
  cacheGeom() {
    const b = this.boxes.get('cache');
    if (!b || Number.isNaN(b.x)) return null;
    return { x0: b.x - b.w / 2, y0: b.y - b.h / 2, w: b.w, h: b.h, header: this.headerH, rowH: this.rowH, alpha: b.alpha };
  }

  /** A cache row's rectangle (center + size) for callouts: a key, or 'next' = the next victim. */
  rowRect(which: number | 'next') {
    const g = this.cacheGeom();
    if (!g) return null;
    const e = which === 'next' ? this.cache.victim() : this.cache.peek(which);
    if (!e) return null;
    return { x: g.x0 + g.w / 2, y: g.y0 + g.header + 3 + (e.ry + 0.5) * g.rowH, w: g.w - 16, h: g.rowH - 4 };
  }

  /** Where readouts dock on a landscape stage: bottom-left, under the shoppers. */
  dock() {
    const pad = this.compact ? 16 : 24;
    return { x: pad, y: this.h - 86 };
  }

  /* ================================================================ */
  /* Layout                                                           */
  /* ================================================================ */

  protected layout() {
    const { w, h } = this;
    const v = this.cfg.view;
    if (v === 'layers') return this.layoutLayers();
    if (v === 'sequence') return;

    const shoppers = SHOPPERS.map((c) => c.id);
    const clients = this.cfg.admin ? [...shoppers, ADMIN.id] : shoppers;

    if (this.orient === 'landscape') {
      // Shoppers upper-left, app in the middle, Redis upper-right, Postgres
      // lower-middle (clear of the title block). Readouts dock bottom-left.
      const compact = this.compact;
      const pad = compact ? 16 : 24;
      const top = 84;
      const bottom = h - 100;
      const cw = compact ? 132 : 150;
      const ch = compact ? 38 : 42;
      const clientsMid = top + (bottom - top) * 0.4;
      const spacing = compact ? 66 : 78;
      clients.forEach((id, i) => {
        const extra = id === ADMIN.id ? 12 : 0;
        this.place(id, pad + cw / 2, clientsMid + (i - (clients.length - 1) / 2) * spacing + extra, cw, ch);
      });

      const cacheW = compact ? 270 : 312;
      const cacheX = w - pad - cacheW / 2 - 12;
      const dbW = compact ? 136 : 150;
      const dbH = compact ? 92 : 100;
      const dbX = Math.min(w - 292 - dbW / 2, cacheX - 20);
      const dbY = bottom - dbH / 2 + 2;
      this.place('db', dbX, dbY, dbW, dbH);

      const race = v === 'race';
      const appX = race ? Math.max(pad + 150, w * 0.3) : pad + cw + (cacheX - cacheW / 2 - pad - cw) * 0.42;
      this.place('app', appX, race ? (top + bottom) / 2 : clientsMid, compact ? 150 : 164, compact ? 56 : 60);

      const rows = Math.max(1, this.cfg.slots);
      this.headerH = 32;
      const cacheTop = top + (race ? 64 : 6);
      const maxCacheH = dbY - dbH / 2 - 26 - cacheTop;
      this.rowH = clamp((maxCacheH - this.headerH - 10) / rows, 17, 25);
      const cacheH = this.headerH + rows * this.rowH + 10;
      this.place('cache', cacheX, cacheTop + cacheH / 2, cacheW, cacheH);
    } else {
      const pad = 12;
      const top = 74;
      const n = clients.length;
      const cw = Math.min(112, (w - pad * 2 - (n - 1) * 8) / n);
      const cy = top + 18;
      clients.forEach((id, i) => this.place(id, w / 2 + (i - (n - 1) / 2) * (cw + 8), cy, cw, 32));

      const appY = cy + 16 + 58;
      const dbW = 108;
      const dbH = 78;
      this.place('app', pad + 72 + 8, appY, 144, 46);
      this.place('db', w - pad - dbW / 2 - 4, appY + 6, dbW, dbH);

      const rows = Math.max(1, this.cfg.slots);
      this.headerH = 26;
      const cacheTop = appY + dbH / 2 + 30;
      const room = h - cacheTop - (this.cfg.showTable || this.cfg.view === 'race' ? 150 : 128);
      this.rowH = clamp((room - this.headerH - 8) / rows, 14, 19);
      const cacheH = this.headerH + rows * this.rowH + 8;
      this.place('cache', w / 2, cacheTop + cacheH / 2, w - pad * 2, cacheH);
      if (v === 'race') {
        this.place('app', pad + 72 + 8, appY, 144, 46);
      }
    }
  }

  private layoutLayers() {
    const { w, h } = this;
    const portrait = this.orient === 'portrait';
    const top = portrait ? 78 : 84;
    const bottom = h - (portrait ? 70 : 100);
    const userH = portrait ? 34 : 40;
    this.place('user', portrait ? 110 : 124, top + userH / 2, portrait ? 196 : 200, userH);
    const bandsTop = top + userH + (portrait ? 18 : 24);
    const gap = portrait ? 8 : 12;
    const bandH = (bottom - bandsTop - gap * 4) / 5;
    for (let i = 0; i < 5; i++) {
      const y = bandsTop + i * (bandH + gap) + bandH / 2;
      this.place(`L${i}`, portrait ? 34 : 50, y, 16, 16);
    }
    this.bandGeom = { x0: portrait ? 12 : 24, x1: w - (portrait ? 12 : 24), top: bandsTop, h: bandH, gap };
  }

  bandGeom = { x0: 24, x1: 900, top: 150, h: 90, gap: 12 };

  protected curveFor(from: string, to: string, lane: number): Curve | null {
    if (this.cfg.view === 'layers') {
      // Straight down the lane on the left: requests fall on one side, answers rise on the other.
      const a = this.boxes.get(from);
      const b = this.boxes.get(to);
      const lane0 = this.boxes.get('L0');
      if (!a || !b || !lane0 || Number.isNaN(a.x) || Number.isNaN(b.x)) return null;
      const off = lane === 0 ? 0 : to === 'user' ? 5 : -5;
      const x = lane0.x + off;
      const y0 = from === 'user' ? a.y + a.h / 2 : a.y;
      const y1 = to === 'user' ? b.y + b.h / 2 : b.y;
      const k = (y1 - y0) / 3;
      return { p0: { x, y: y0 }, p1: { x, y: y0 + k }, p2: { x, y: y1 - k }, p3: { x, y: y1 } };
    }
    return super.curveFor(from, to, lane);
  }

  protected wires(): WireSpec[] {
    const v = this.cfg.view;
    const out: WireSpec[] = [];
    if (v === 'flow' || v === 'race') {
      if (v === 'flow') for (const c of SHOPPERS) out.push({ from: c.id, to: 'app' });
      if (v === 'flow' && this.cfg.admin) out.push({ from: ADMIN.id, to: 'app', state: 'dashed' });
      if (this.cfg.cache) out.push({ from: 'app', to: 'cache', state: this.cacheDown ? 'down' : 'normal', color: this.cacheDown ? undefined : 'rgba(75,227,160,0.42)' });
      out.push({ from: 'app', to: 'db', color: this.dbLoad > 0.9 && this.queue.length > 2 ? 'rgba(255,77,106,0.5)' : 'rgba(255,154,60,0.34)' });
      if (this.cfg.cache && this.cfg.writeMode === 'back') out.push({ from: 'cache', to: 'db', state: 'control' });
    } else if (v === 'layers') {
      out.push({ from: 'user', to: 'L0', state: 'dashed' });
      for (let i = 0; i < 4; i++) out.push({ from: `L${i}`, to: `L${i + 1}`, state: 'dashed' });
    }
    return out;
  }

  /* ================================================================ */
  /* The simulation                                                   */
  /* ================================================================ */

  protected step(dt: number) {
    const cfg = this.cfg;
    if (cfg.view === 'flow') {
      this.arrivals(dt);
      if (cfg.admin && cfg.writeEvery > 0) {
        this.nextWrite -= dt;
        if (this.nextWrite <= 0) {
          this.nextWrite += cfg.writeEvery;
          this.autoWrite();
        }
      }
      if (cfg.cache && cfg.writeMode === 'back') {
        this.nextFlush -= dt;
        if (this.nextFlush <= 0) {
          this.nextFlush += cfg.flushEvery;
          this.flush();
        }
      }
    }
    this.expireKeys();
    this.dbStep(dt);
    this.sample(dt);
  }

  private arrivals(dt: number) {
    const cfg = this.cfg;
    if (cfg.rps <= 0) return;
    if (cfg.sequential) {
      if (this.activeReads > 0 || this.frozen) return;
      this.gap -= dt;
      if (this.gap <= 0) {
        this.gap = cfg.tour ? 1.6 : 0.7;
        this.spawnRead();
      }
      return;
    }
    this.nextIn -= dt;
    while (this.nextIn <= 0) {
      // Poisson arrivals: bursty, like real traffic.
      this.nextIn += -Math.log(1 - this.rand() * 0.999) / cfg.rps;
      this.spawnRead();
    }
  }

  private pickKey(): number {
    const cfg = this.cfg;
    if (cfg.sequence?.length) return cfg.sequence[this.seqIdx++ % cfg.sequence.length];
    if (cfg.hotShare > 0 && this.rand() < cfg.hotShare) return HOT;
    const rank = sampleRank(this.weights, this.rand());
    return PRODUCTS[Math.min(rank, PRODUCTS.length - 1)].id;
  }

  private slow(d: number) {
    return this.cfg.tour ? d * 1.9 : d;
  }

  private spawnRead() {
    const key = this.pickKey();
    const client = SHOPPERS[this.clientIdx++ % SHOPPERS.length];
    const req: Req = { id: ++this.reqSeq, client: client.id, key, t0: this.t, hit: null, price: null, dbMs: 0, waitFrom: null, ver: 0, stale: false, recheck: false };
    this.activeReads += 1;
    this.tally.set(key, (this.tally.get(key) ?? 0) + 1);
    const f = this.send({ from: client.id, to: 'app', dur: this.slow(HOP.client), color: SIG.req, label: `#${key}`, tag: 'req', onArrive: () => this.atApp(req) });
    this.tourNote(f, 'GET /products/' + key, [`from ${client.name}`, { t: `the app needs ${keyName(key)}`, kind: 'dim' }]);
  }

  private atApp(req: Req) {
    req.t0 = this.t;
    if (!this.cfg.cache) {
      this.queryDb(req);
      return;
    }
    if (this.cacheDown) {
      // Redis is unreachable: fall back to the database (slow, but still correct).
      this.recordLookup(false);
      this.queryDb(req);
      return;
    }
    const g = this.game;
    if (g && !g.done && this.cfg.predict === 'hitmiss') {
      const hit = this.cache.has(req.key, this.t);
      const k = keyName(req.key);
      g.ask({
        acceptable: [hit ? 'hit' : 'miss'],
        choices: [
          { id: 'hit', label: 'Hit: it’s cached' },
          { id: 'miss', label: 'Miss: go to Postgres' },
        ],
        ask: `${k}: hit or miss?`,
        askAt: { id: 'app' },
        explain: () =>
          hit
            ? `${k} is in Redis, so this read never touches the database: about 1 ms.`
            : `${k} isn’t in Redis, so the app runs the 50 ms query, then stores a copy for next time.`,
        resolve: () => this.cacheGet(req),
      });
      return;
    }
    this.cacheGet(req);
  }

  private cacheGet(req: Req) {
    const f = this.send({ from: 'app', to: 'cache', dur: this.slow(HOP.cache), color: SIG.req, r: 3.8, tag: 'get', label: this.cfg.tour ? 'GET' : undefined, onArrive: () => this.atCache(req) });
    this.tourNote(f, '1 · ask Redis first', [`GET ${keyName(req.key)}`]);
  }

  private atCache(req: Req) {
    const e = this.cacheDown ? null : this.cache.get(req.key, this.t);
    if (e) {
      req.hit = true;
      req.price = e.price;
      req.ver = e.version;
      req.stale = e.version < this.ackOf(req.key);
      e.flash = { kind: 'hit', vt: this.vt };
      if (!req.recheck) this.recordLookup(true);
      if (this.cfg.refreshAhead && e.ttl > 0 && e.expiresAt - this.t < e.ttl * REFRESH_AT && !this.refreshing.has(req.key)) this.refreshAhead(req.key);
      const f = this.send({ from: 'cache', to: 'app', dur: this.slow(HOP.cache), color: SIG.res, r: 3.8, tag: 'hit', label: this.cfg.tour ? 'HIT' : undefined, onArrive: () => this.respond(req) });
      this.tourNote(f, 'hit', [`"{name:'${product(req.key).name}',price:${e.price}}"`, { t: 'found in memory: done', kind: 'add' }], 'res');
    } else {
      req.hit = false;
      if (!req.recheck) this.recordLookup(false);
      const f = this.send({ from: 'cache', to: 'app', dur: this.slow(HOP.cache), color: NIL, r: 3.6, tag: 'nil', label: this.cfg.tour ? 'nil' : undefined, onArrive: () => this.onMiss(req) });
      this.tourNote(f, 'miss', ['(nil)', { t: 'not in the cache', kind: 'bad' }], 'err');
    }
    this.rev++;
  }

  private onMiss(req: Req) {
    if (this.cfg.coalesce) {
      const waiters = this.inflight.get(req.key);
      if (waiters) {
        req.waitFrom = this.t;
        waiters.push(req);
        this.rev++;
        return;
      }
      // Double-check before starting a new query: the key may have been
      // refilled while this read's "nil" was on its way back.
      if (!req.recheck && this.cache.has(req.key, this.t)) {
        req.recheck = true;
        this.cacheGet(req);
        return;
      }
      this.inflight.set(req.key, []);
    }
    this.queryDb(req);
  }

  private queryDb(req: Req) {
    const f = this.send({
      from: 'app',
      to: 'db',
      dur: this.slow(HOP.db),
      color: SIG.heavy,
      tag: 'query',
      label: this.cfg.tour ? 'SELECT' : undefined,
      onArrive: () => {
        const job = this.dbEnqueue(req.key, 'select', (j) => {
          req.dbMs = (j.start! - j.enq + j.dur) * DB_MS_PER_S;
          const back = this.send({ from: 'db', to: 'app', dur: this.slow(HOP.db), color: SIG.heavy, tag: 'row', label: this.cfg.tour ? 'row' : undefined, onArrive: () => this.rowArrived(req, j) });
          this.tourNote(back, 'the row comes back', [`{ name: '${product(req.key).name}',`, `  price: ${j.price} }`], 'res');
        });
        if (this.cfg.tour) {
          this.note = {
            head: 'postgres · running the query',
            lines: ['join products + 12,000 reviews', { t: `≈ ${Math.round(job.dur * DB_MS_PER_S)} ms`, kind: 'strong' }],
            tone: 'req',
            at: { box: 'db' },
            progress: () => this.jobProgress(job),
          };
        }
      },
    });
    this.tourNote(f, this.cfg.cache ? '2 · miss: ask Postgres' : 'query Postgres', ['SELECT name, price, avg(stars)…', `WHERE id = ${req.key}`]);
  }

  private rowArrived(req: Req, job: DbJob) {
    req.price = job.price;
    req.ver = job.ver;
    req.stale = job.stale;
    const finish = (force: number | null) => {
      // Single flight resolves once the copy is stored, so misses that land
      // before the SET still join this query instead of starting another.
      const settle = () => {
        const waiters = this.inflight.get(req.key) ?? [];
        this.inflight.delete(req.key);
        const doneAt = job.start! + job.dur;
        for (const w of waiters) {
          w.price = job.price;
          w.ver = job.ver;
          w.stale = job.stale;
          w.dbMs = Math.max(0, doneAt - (w.waitFrom ?? doneAt)) * DB_MS_PER_S;
          this.respond(w);
        }
      };
      if (this.cfg.cache && !this.cacheDown) this.cacheSet(req.key, job.price, { force, version: job.ver, after: settle });
      else settle();
      this.respond(req);
    };
    const g = this.game;
    if (g && !g.done && this.cfg.predict === 'evict' && this.cfg.cache && !this.cache.has(req.key, this.t) && this.cache.size >= this.cache.capacity) {
      const v = this.cache.victim();
      if (v) {
        const vk = keyName(v.key);
        g.ask({
          acceptable: [`row:${v.key}`],
          ask: `Full! Which key does LRU evict?`,
          askAt: { id: 'cache' },
          explain: (picked, ok) =>
            ok
              ? `${vk} was the least recently used: it sat at the bottom of the list, untouched the longest.`
              : `It’s ${vk}: every read moves a key to the top, so the bottom row is the one untouched the longest.`,
          resolve: () => finish(v.key),
        });
        return;
      }
    }
    finish(null);
  }

  private cacheSet(key: number, price: number, opts: { force?: number | null; dirty?: boolean; version?: number; after?: () => void; label?: string } = {}) {
    const f = this.send({
      from: 'app',
      to: 'cache',
      dur: this.slow(HOP.cache),
      color: SIG.hc,
      r: 3.8,
      tag: 'set',
      label: opts.label ?? (this.cfg.tour ? 'SET' : undefined),
      onArrive: () => {
        if (this.cacheDown) {
          opts.after?.();
          return;
        }
        const ttl = this.ttlFor(key);
        const { entry, evicted } = this.cache.set(key, price, this.t, ttl, { force: opts.force, dirty: opts.dirty, version: opts.version });
        entry.flash = { kind: 'set', vt: this.vt };
        if (key === HOT && this.herdOpen) {
          // The hot key is back. Let stragglers already on their way land, then record the damage.
          this.herdOpen = false;
          const rps = this.herdRps;
          this.after(3, () => {
            this.lastHerd = { queries: this.hotQueriesLastExpiry, rps, coalesce: this.cfg.coalesce };
            this.rev++;
          });
        }
        if (evicted) {
          this.evictions += 1;
          if (evicted.key === HOT) this.hotEvictions += 1;
          this.addGhost(evicted, 'evict');
        }
        opts.after?.();
        this.rev++;
      },
    });
    this.tourNote(f, '3 · keep a copy', [`SET ${keyName(key)} "{…}" EX ${this.cfg.ttl || 60}`, { t: 'next read of it is a hit', kind: 'dim' }]);
  }

  private ttlFor(key: number): number {
    const base = this.cfg.ttl;
    if (base <= 0) return 0;
    void key;
    const j = this.cfg.jitter > 0 ? 1 + this.cfg.jitter * (this.rand() * 2 - 1) : 1;
    return base * j;
  }

  private respond(req: Req) {
    let lat: number;
    if (req.hit) lat = REDIS_MS * (0.7 + this.rand() * 0.6);
    else if (!this.cfg.cache) lat = req.dbMs + 0.4;
    else lat = REDIS_MS + req.dbMs + REDIS_MS;
    const stale = req.stale;
    if (stale) this.staleReads += 1;
    this.push(this.lats, lat, 40);
    this.push(this.stales, stale, 40);
    const fast = lat < 10;
    const label = stale ? `$${req.price} stale` : `${lat < 2 ? '1' : Math.round(lat)} ms`;
    const f = this.send({
      from: 'app',
      to: req.client,
      dur: this.slow(HOP.client),
      color: stale ? SIG.err : SIG.res,
      tag: stale ? 'stale' : fast ? 'resp-fast' : 'resp-slow',
      label,
      onArrive: () => {
        if (stale) this.fx({ kind: 'ring', at: { id: req.client }, color: SIG.err, dur: 0.8 });
      },
    });
    this.activeReads = Math.max(0, this.activeReads - 1);
    this.tourNote(
      f,
      '200 OK',
      [`served in ${label}`, { t: req.hit ? 'cache hit: never touched Postgres' : 'cache miss: paid for the query', kind: req.hit ? 'add' : 'change' }],
      'res',
    );
    this.rev++;
  }

  /* ---------------- writes ---------------- */

  private autoWrite() {
    const pool = PRODUCTS.slice(0, Math.min(6, this.cfg.keys)).map((p) => p.id);
    const key = pool[this.writeIdx++ % pool.length];
    this.changePrice(key, this.cfg.writeMode);
  }

  private adminWrite(key: number, price: number, mode: WriteMode) {
    const k = keyName(key);
    const ver = this.nextVer(key);
    const ack = (ms: number) => {
      // Dave is told "saved": from now on, anything older counts as stale.
      this.ackVer.set(key, Math.max(this.ackOf(key), ver));
      this.lastWriteMs = ms;
      this.send({ from: 'app', to: ADMIN.id, dur: HOP.client, color: SIG.res, r: 3.8, tag: 'ack', label: `saved · ${Math.max(1, Math.round(ms))} ms` });
      this.rev++;
    };
    this.send({
      from: ADMIN.id,
      to: 'app',
      dur: HOP.client,
      color: SIG.warn,
      shape: 'square',
      tag: 'write',
      label: `#${key} → $${price}`,
      onArrive: () => {
        if (mode === 'back' && this.cfg.cache && !this.cacheDown) {
          this.cacheSet(key, price, { dirty: true, version: ver, label: 'SET', after: () => ack(REDIS_MS) });
          return;
        }
        this.dbUpdate(key, price, ver, (dbMs) => {
          if (mode === 'through' && this.cfg.cache) {
            this.cacheSet(key, price, { version: ver, label: 'SET', after: () => ack(dbMs + REDIS_MS) });
          } else if (mode === 'around' && this.cfg.cache) {
            this.send({
              from: 'app',
              to: 'cache',
              dur: HOP.cache,
              color: SIG.hc,
              r: 3.8,
              tag: 'del',
              label: 'DEL',
              onArrive: () => {
                const gone = this.cache.del(key);
                if (gone) this.addGhost(gone, 'del');
                this.say('cache', gone ? `DEL ${k} → 1` : `DEL ${k} → 0`, SIG.hc);
                ack(dbMs + REDIS_MS);
              },
            });
          } else {
            ack(dbMs);
          }
        });
      },
    });
  }

  /** UPDATE by primary key + commit. `then` gets the displayed database time in ms. */
  private dbUpdate(key: number, price: number, ver: number, then: (dbMs: number) => void) {
    this.send({
      from: 'app',
      to: 'db',
      dur: HOP.db,
      color: SIG.heavy,
      tag: 'update',
      label: 'UPDATE',
      onArrive: () => {
        this.dbEnqueue(
          key,
          'update',
          (j) => {
            this.dbPrice.set(key, price);
            this.dbVer.set(key, Math.max(this.dbVer.get(key) ?? 0, ver));
            this.fx({ kind: 'ring', at: { id: 'db' }, color: SIG.heavy, dur: 0.8 });
            const ms = (j.start! - j.enq) * DB_MS_PER_S + WRITE_MS;
            this.send({ from: 'db', to: 'app', dur: HOP.db, color: SIG.heavy, r: 3.6, tag: 'row', onArrive: () => then(ms) });
            this.rev++;
          },
          price,
        );
      },
    });
  }

  private flush() {
    const dirty = [...this.cache.entries.values()].filter((e) => e.dirty);
    if (!dirty.length || this.cacheDown) return;
    const batch = dirty.map((e) => ({ key: e.key, price: e.price, version: e.version }));
    this.send({
      from: 'cache',
      to: 'db',
      dur: HOP.db,
      color: SIG.hc,
      tag: 'flush',
      label: `flush ×${batch.length}`,
      onArrive: () => {
        this.dbEnqueue(batch[0].key, 'flush', () => {
          for (const b of batch) {
            this.dbPrice.set(b.key, b.price);
            this.dbVer.set(b.key, Math.max(this.dbVer.get(b.key) ?? 0, b.version));
            const e = this.cache.peek(b.key);
            if (e && e.version === b.version) e.dirty = false;
          }
          this.fx({ kind: 'ring', at: { id: 'db' }, color: SIG.hc, dur: 0.8 });
          this.rev++;
        });
      },
    });
  }

  private refreshAhead(key: number) {
    this.refreshing.add(key);
    this.send({
      from: 'app',
      to: 'db',
      dur: HOP.db,
      color: SIG.hc,
      tag: 'refresh',
      label: 'refresh',
      onArrive: () => {
        this.dbEnqueue(key, 'refresh', (j) => {
          this.send({
            from: 'db',
            to: 'app',
            dur: HOP.db,
            color: SIG.hc,
            r: 3.8,
            tag: 'row',
            onArrive: () => {
              this.cacheSet(key, j.price, {
                version: j.ver,
                label: 'SET',
                after: () => {
                  const e = this.cache.peek(key);
                  if (e) e.flash = { kind: 'refresh', vt: this.vt };
                  this.refreshing.delete(key);
                },
              });
            },
          });
        });
      },
    });
  }

  /* ---------------- expiry ---------------- */

  private expireKeys() {
    if (!this.cfg.cache) return;
    const due = [...this.cache.entries.values()].filter((e) => e.expiresAt <= this.t);
    if (!due.length) return;
    const g = this.game;
    const hot = due.find((e) => e.key === HOT);
    for (const e of this.cache.expire(this.t)) this.addGhost(e, 'expire');
    if (hot) {
      this.hotQueriesLastExpiry = 0;
      this.herdOpen = true;
      this.herdRps = this.cfg.rps;
      this.say('cache', `${keyName(HOT)} expired`, SIG.warn, 1.6);
      if (g && !g.done && this.cfg.predict === 'stampede') {
        g.ask({
          acceptable: ['all'],
          choices: [
            { id: 'one', label: 'Just 1 query' },
            { id: 'few', label: 'A few, then it stops' },
            { id: 'all', label: 'One per read until it’s cached again' },
          ],
          ask: `${keyName(HOT)} just expired. How many queries?`,
          askAt: { id: 'cache' },
          explain: () =>
            'Every read that arrives before the first query refills the key misses too, and each one starts its own 50 ms query. Count the orange dots piling up at Postgres.',
        });
      }
    }
    this.rev++;
  }

  /* ---------------- database ---------------- */

  private dbEnqueue(key: number, kind: DbKind, onDone: (j: DbJob) => void, price?: number): DbJob {
    const dur = kind === 'update' ? UPDATE_S : kind === 'flush' ? FLUSH_S : QUERY_S * (0.9 + this.rand() * 0.2);
    const job: DbJob = { id: ++this.jobSeq, key, kind, enq: this.t, start: null, dur, price: price ?? 0, ver: 0, stale: false, onDone };
    if (key === HOT && kind === 'select') this.hotQueriesLastExpiry += 1;
    if (key === HOT && kind === 'refresh') this.hotRefreshes += 1;
    this.queue.push(job);
    this.startJobs();
    this.rev++;
    return job;
  }

  private startJobs() {
    while (this.running.length < this.cfg.dbWorkers && this.queue.length) {
      const j = this.queue.shift()!;
      j.start = this.t;
      if (j.kind === 'select' || j.kind === 'refresh') {
        // Postgres reads the row as of the moment the query starts.
        j.price = this.dbPrice.get(j.key) ?? product(j.key).price;
        j.ver = this.dbVer.get(j.key) ?? 0;
        j.stale = j.ver < this.ackOf(j.key);
      }
      this.running.push(j);
    }
  }

  private dbStep(dt: number) {
    this.busyAcc += this.running.length * dt;
    const done = this.running.filter((j) => j.start != null && this.t - j.start >= j.dur);
    if (done.length) {
      this.running = this.running.filter((j) => !done.includes(j));
      for (const j of done) j.onDone(j);
      this.startJobs();
      this.rev++;
    }
  }

  /* ---------------- metrics ---------------- */

  private recordLookup(hit: boolean) {
    if (hit) this.hits += 1;
    else this.misses += 1;
    this.push(this.lookups, hit, 60);
  }

  private push<T>(arr: T[], v: T, max: number) {
    arr.push(v);
    if (arr.length > max) arr.shift();
  }

  private sample(dt: number) {
    this.bucketT += dt;
    if (this.bucketT >= 0.5) {
      this.busyBuckets.push(this.busyAcc);
      if (this.busyBuckets.length > 12) this.busyBuckets.shift();
      this.busyAcc = 0;
      this.bucketT = 0;
      const p = this.p95;
      if (p != null) this.push(this.p95Spark, p, 40);
      this.rev++;
    }
  }

  private addGhost(e: Entry, kind: GoneKind) {
    this.ghosts.push({ key: e.key, price: e.price, ry: e.ry, kind, vt: this.vt, dirty: e.dirty });
  }

  /* ---------------- guided tour ---------------- */

  private tourNote(f: Flight, head: string, lines: InspectorLine[], tone: Note['tone'] = 'req') {
    if (!this.cfg.tour) return;
    this.note = { head, lines, tone, at: { flight: f.id } };
    this.rev++;
  }

  /* ================================================================ */
  /* Race view: the same question to Redis and Postgres, to scale     */
  /* ================================================================ */

  private startRace() {
    if (this.cfg.view !== 'race') return;
    const round = (this.race?.round ?? 0) + 1;
    this.race = { t0: this.t, cacheMs: null, dbMs: null, round };
    const leg = (REDIS_MS / 2) * RACE_S_PER_MS;
    this.flashWire('app', 'cache');
    this.send({
      from: 'app',
      to: 'cache',
      dur: leg,
      color: SIG.req,
      tag: 'get',
      onArrive: () => {
        const e = this.cache.get(HOT, this.t);
        if (e) e.flash = { kind: 'hit', vt: this.vt };
        this.send({
          from: 'cache',
          to: 'app',
          dur: leg,
          color: SIG.res,
          tag: 'hit',
          onArrive: () => {
            if (this.race && this.race.round === round) this.race.cacheMs = (this.t - this.race.t0) / RACE_S_PER_MS;
            this.fx({ kind: 'ring', at: { id: 'cache' }, color: SIG.res, dur: 0.9, size: 1.6 });
            this.rev++;
          },
        });
      },
    });
    this.send({
      from: 'app',
      to: 'db',
      dur: leg,
      color: SIG.heavy,
      tag: 'query',
      onArrive: () => {
        const job = this.dbEnqueue(HOT, 'select', () => {
          this.send({
            from: 'db',
            to: 'app',
            dur: leg,
            color: SIG.heavy,
            tag: 'row',
            onArrive: () => {
              if (this.race && this.race.round === round) this.race.dbMs = (this.t - this.race.t0) / RACE_S_PER_MS;
              this.fx({ kind: 'ring', at: { id: 'db' }, color: SIG.heavy, dur: 0.9, size: 1.6 });
              this.rev++;
            },
          });
        });
        job.dur = (RACE_DB_MS - REDIS_MS) * RACE_S_PER_MS;
      },
    });
    this.after(RACE_EVERY, () => this.startRace());
  }

  /** Live milliseconds for the race counters. */
  raceElapsedMs(): number {
    return this.race ? (this.t - this.race.t0) / RACE_S_PER_MS : 0;
  }

  /* ================================================================ */
  /* Layers view: a request falls through the caches until one hits   */
  /* ================================================================ */

  private startLayerReq() {
    if (this.cfg.view !== 'layers') return;
    const req = LAYER_REQS[this.layer.idx % LAYER_REQS.length];
    this.layer.current = req;
    this.rev++;
    this.send({ from: 'user', to: 'L0', dur: 0.5, color: SIG.req, tag: 'req', lane: 1, onArrive: () => this.atLayer(req, 0) });
  }

  private atLayer(req: LayerReq, band: number) {
    const hit = band === req.hitAt;
    this.layer.lit = [...this.layer.lit.filter((l) => l.band !== band), { band, kind: hit ? 'hit' : 'miss', vt: this.vt }];
    if (hit) {
      this.layer.hits[band] += 1;
      this.fx({ kind: 'ring', at: { id: `L${band}` }, color: SIG.res, dur: 0.9, size: 1.2 });
      this.after(0.45, () => {
        this.send({
          from: `L${band}`,
          to: 'user',
          dur: 0.35 + band * 0.22,
          color: SIG.res,
          tag: 'resp-fast',
          lane: 1,
          onArrive: () => {
            this.fx({ kind: 'ring', at: { id: 'user' }, color: SIG.res, dur: 0.8 });
            this.after(1.5, () => {
              this.layer.idx += 1;
              this.layer.lit = [];
              this.startLayerReq();
            });
          },
        });
      });
    } else {
      this.send({ from: `L${band}`, to: `L${band + 1}`, dur: 0.55, color: SIG.req, tag: 'req', lane: 1, onArrive: () => this.atLayer(req, band + 1) });
    }
    this.rev++;
  }

  /* ================================================================ */
  /* Per-frame easing of the cache rows                               */
  /* ================================================================ */

  protected animate(dt: number) {
    const rows = this.cache.ordered();
    const bySlot = this.cfg.order === 'slot';
    rows.forEach((e, i) => {
      const target = bySlot ? e.slot : i;
      if (e.alpha < 0.04) e.ry = target;
      e.ry = damp(e.ry, target, 11, dt);
      e.alpha = damp(e.alpha, 1, 9, dt);
    });
    if (this.ghosts.length) this.ghosts = this.ghosts.filter((g) => this.vt - g.vt < GHOST_S);
  }
}

export type { Entry, Ghost };
