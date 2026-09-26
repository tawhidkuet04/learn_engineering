import { SIG } from '@/lib/sim/colors';
import type { Curve, Pt } from '@/lib/sim/geometry';
import { PredictGame } from '@/lib/sim/predict';
import { mulberry32 } from '@/lib/sim/rng';
import { Sim, type ScriptEvent, type WireSpec } from '@/lib/sim/Sim';
import {
  CITIES,
  CITY_IDS,
  GUESTS,
  MAP_ASPECT,
  ORIGIN_PLACE,
  POPS,
  POP_IDS,
  fmtKm,
  km,
  project,
  rttMs,
  type CityId,
  type MapRect,
  type Place,
  type PopId,
} from './geo';

/* ------------------------------------------------------------------ */
/* Content and cache policy                                            */
/* ------------------------------------------------------------------ */

export type FileId = 'app' | 'logo' | 'style' | 'html' | 'account' | 'sale';

export const FILES: Record<FileId, { short: string; path: string }> = {
  app: { short: 'js', path: '/app.3f9a.js' },
  logo: { short: 'png', path: '/logo.png' },
  style: { short: 'css', path: '/style.css' },
  html: { short: 'html', path: '/index.html' },
  account: { short: 'acct', path: '/account' },
  sale: { short: 'jpg', path: '/sale.jpg' },
};

/** Fingerprinted builds: the hash of the file's content is part of its name. */
export const APP_BUILDS = ['3f9a', '8c1e', 'b52d', 'e07f', '41c0', '9d27'];
export const appPath = (v: number) => `/app.${APP_BUILDS[(v - 1) % APP_BUILDS.length]}.js`;

/** The URL of a file at a given version. Fingerprinted files and new banners get new names. */
export function pathOf(file: FileId, v: number) {
  if (file === 'app') return appPath(v);
  if (file === 'sale') return v <= 1 ? '/sale.jpg' : `/sale-${v}.jpg`;
  return FILES[file].path;
}

export const YEAR = 31536000;
export const DAY = 86400;

export interface Policy {
  kind: 'public' | 'no-cache' | 'private';
  /** Seconds the copy stays fresh */
  maxAge?: number;
  /** Extra seconds a stale copy may be served while it is refreshed */
  swr?: number;
  immutable?: boolean;
}

export const DEFAULT_POLICY: Record<FileId, Policy> = {
  app: { kind: 'public', maxAge: YEAR, immutable: true },
  logo: { kind: 'public', maxAge: DAY },
  style: { kind: 'public', maxAge: DAY },
  html: { kind: 'no-cache' },
  account: { kind: 'private' },
  sale: { kind: 'public', maxAge: DAY },
};

export function headerOf(p: Policy): string {
  if (p.kind === 'private') return 'private';
  if (p.kind === 'no-cache') return 'no-cache';
  const parts = ['public', `max-age=${p.maxAge ?? 0}`];
  if (p.swr) parts.push(`stale-while-revalidate=${p.swr}`);
  if (p.immutable) parts.push('immutable');
  return parts.join(', ');
}

/* ------------------------------------------------------------------ */
/* Config                                                              */
/* ------------------------------------------------------------------ */

export type Outcome = 'HIT' | 'MISS' | 'STALE' | 'REVAL' | 'BYPASS' | 'DIRECT' | 'ERROR';

export type Mode = 'traffic' | 'tour' | 'hitmiss' | 'anycast' | 'account' | 'pageviews' | 'idle';

export type WarmSpec = 'cold' | 'all' | Partial<Record<PopId | 'shield', FileId[]>>;

export interface CdnConfig {
  view: 'map' | 'sequence';
  /** Which comparison the sequence view shows */
  seq: 'pageload' | 'dynamic';
  cdn: boolean;
  shield: boolean;
  mode: Mode;
  /** Cities that send traffic (the others are drawn dimmed) */
  cities: CityId[];
  /** Background requests per simulated second */
  rps: number;
  poisson: boolean;
  /** Relative weights of the files users ask for */
  mix: Partial<Record<FileId, number>>;
  /** Ask for the files in `mix` in turn instead of at random */
  cycle: boolean;
  policy: Partial<Record<FileId, Policy>>;
  /** Cache key normalization: drop the query string */
  ignoreQuery: boolean;
  /** Requests carry marketing query strings (?utm_…) */
  utm: boolean;
  warm: WarmSpec;
  /** What 'all' warms */
  warmFiles: FileId[];
  /** Origin capacity, requests per simulated second */
  originCap: number;
  /** Files whose cache state is drawn next to each PoP */
  chips: FileId[];
  /** Latency tag next to each city */
  tags: boolean;
  /** Faint route arcs */
  routes: boolean;
  /** File names on request dots */
  labels: boolean;
  /** Floating HIT / MISS words at the edges */
  say: boolean;
  /** Named people instead of one anonymous user in a city */
  people: { city: CityId; names: string[] } | null;
  /** Show which version of /style.css each response carried */
  versions: boolean;
}

export const DEFAULTS: CdnConfig = {
  view: 'map',
  seq: 'pageload',
  cdn: true,
  shield: false,
  mode: 'traffic',
  cities: CITY_IDS,
  rps: 1.2,
  poisson: false,
  mix: { app: 1 },
  cycle: false,
  policy: {},
  ignoreQuery: false,
  utm: false,
  warm: 'cold',
  warmFiles: ['app', 'logo'],
  originCap: 40,
  chips: [],
  tags: true,
  routes: true,
  labels: false,
  say: false,
  people: null,
  versions: false,
};

/* ------------------------------------------------------------------ */
/* Timing                                                              */
/* ------------------------------------------------------------------ */

/** The animation runs 10× slower than the modeled network: 1 ms of latency = 10 ms on screen. */
export const SLOW = 10;
/** The shortest hop, stretched so it stays visible (simulated seconds). */
const MIN_HOP = 0.24;
/** Cache lookup pause at an edge. */
const LOOKUP = 0.14;
/** An origin that has queued this long starts refusing requests (simulated seconds). */
const MAX_QUEUE = 1.6;

/* ------------------------------------------------------------------ */
/* Model types                                                         */
/* ------------------------------------------------------------------ */

export interface Entry {
  key: string;
  path: string;
  file: FileId;
  version: number;
  owner?: string;
  storedAt: number;
  hits: number;
}

interface Req {
  id: number;
  city: CityId | null;
  user: string;
  file: FileId;
  version: number;
  path: string;
  key: string;
  person?: string;
  pop: PopId | null;
  ms: number;
  then?: (version: number) => void;
}

interface UpRes {
  status: number;
  version: number;
  owner?: string;
  /** Modeled time spent upstream, from the asking node's point of view */
  ms: number;
}

export interface LogLine {
  id: number;
  who: string;
  path: string;
  outcome: Outcome;
  ms: number;
  version: number;
  owner?: string;
  person?: string;
  pop: PopId | null;
  file: FileId;
}

export type TourStage = 'toEdge' | 'lookup' | 'toOrigin' | 'atOrigin' | 'toEdgeBack' | 'stored' | 'toUser' | 'bobToEdge' | 'bobLookup' | 'bobToUser' | 'done';

export interface GuestState {
  place: Place & { side: 'left' | 'right' };
  pop: PopId | null;
  phase: 'arrive' | 'ask' | 'flying' | 'leaving';
}

/** Scripted requests for the hit-or-miss game. */
const HITMISS: { city: CityId; file: FileId }[] = [
  { city: 'sydney', file: 'app' },
  { city: 'tokyo', file: 'app' },
  { city: 'london', file: 'logo' },
  { city: 'tokyo', file: 'app' },
  { city: 'mumbai', file: 'logo' },
  { city: 'lagos', file: 'app' },
  { city: 'saopaulo', file: 'logo' },
  { city: 'london', file: 'logo' },
];

/* ------------------------------------------------------------------ */
/* Arcs                                                                */
/* ------------------------------------------------------------------ */

/** A route drawn the way airline maps do: a curve bowed toward the top of the map. */
export function arcCurve(a: Pt, b: Pt, lane: number, scale = 1): Curve {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const L = Math.hypot(dx, dy) || 1;
  const ux = dx / L;
  const uy = dy / L;
  let nx = uy;
  let ny = -ux;
  if (ny > 0 || (ny === 0 && nx > 0)) {
    nx = -nx;
    ny = -ny;
  }
  const bow = (Math.min(L * 0.17, 70 * scale) + Math.min(Math.abs(dx) * 0.05, 24 * scale)) * 1.33;
  const ox = -uy * lane;
  const oy = ux * lane;
  return {
    p0: { x: a.x + ox, y: a.y + oy },
    p1: { x: a.x + dx * 0.25 + nx * bow + ox, y: a.y + dy * 0.25 + ny * bow + oy },
    p2: { x: a.x + dx * 0.75 + nx * bow + ox, y: a.y + dy * 0.75 + ny * bow + oy },
    p3: { x: b.x + ox, y: b.y + oy },
  };
}

/* ------------------------------------------------------------------ */
/* The simulation                                                      */
/* ------------------------------------------------------------------ */

export class CdnSim extends Sim {
  cfg: CdnConfig = { ...DEFAULTS };
  game: PredictGame | null = null;
  map: MapRect = { x: 0, y: 0, w: 400, h: 170 };
  /** Scale for marker offsets and label sizes */
  k = 1;

  popsDown = new Set<PopId>();
  caches = new Map<string, Map<string, Entry>>();
  /** Current version of each file at the origin */
  version: Record<FileId, number> = { app: 1, logo: 1, style: 1, html: 1, account: 1, sale: 1 };

  guest: GuestState | null = null;
  tour: { stage: TourStage; aliceMs: number; bobMs: number } | null = null;

  /* metrics */
  originFetches = 0;
  hits = 0;
  misses = 0;
  leaks = 0;
  errors = 0;
  purges = 0;
  log: LogLine[] = [];
  cityMs = {} as Record<CityId, { direct: number | null; cdn: number | null; last: number | null }>;
  hitSeries: number[] = [];
  /** Origin fetches for the latest sale banner (shield demo) */
  saleFetches = 0;
  bursts = 0;
  private errorTimes: number[] = [];
  private fileTurn = 0;

  private doneLog: { t: number; ms: number; outcome: Outcome }[] = [];
  private originTimes: number[] = [];
  private inflight = new Map<string, ((r: UpRes) => void)[]>();
  private originFree = 0;
  private nextIn = 0.4;
  private rr = 0;
  private seq = 1;
  private scripted = 0;
  private guestIdx = 0;
  private guestT = 0;
  private sampleT = 0;
  private personTurn = 0;

  constructor() {
    super();
    this.resetMetrics();
    this.syncBoxes(true);
  }

  /* ================================================================ */
  /* Step entry and controls (components call these, never assign)    */
  /* ================================================================ */

  enter(cfg: CdnConfig, script: ScriptEvent<CdnSim>[] = [], opts: { reset?: boolean; predict?: number } = {}) {
    this.cfg = { ...cfg, cities: [...cfg.cities], policy: { ...cfg.policy } };
    if (opts.reset) {
      this.clearTransient();
      this.rng = mulberry32(7);
      this.caches.clear();
      this.inflight.clear();
      this.popsDown.clear();
      this.version = { app: 1, logo: 1, style: 1, html: 1, account: 1, sale: 1 };
      this.resetMetrics();
      this.warmUp(cfg.warm);
      this.guest = null;
      this.hide('guest');
      this.tour = null;
      this.originFree = 0;
      this.nextIn = 0.35;
      this.rr = 0;
      this.scripted = 0;
      this.guestIdx = 0;
      this.guestT = 0.6;
      this.personTurn = 0;
    }
    this.game = opts.predict ? new PredictGame(this, opts.predict) : null;
    this.syncBoxes(false);
    this.runScript(script);
    this.relayout();
    this.rev++;
  }

  setCdn(on: boolean) {
    if (this.cfg.cdn === on) return;
    this.clearTransient();
    this.inflight.clear();
    this.originFree = this.t;
    this.cfg = { ...this.cfg, cdn: on };
    this.nextIn = 0.3;
    this.syncBoxes(false);
    this.relayout();
    this.rev++;
  }

  setShield(on: boolean) {
    if (this.cfg.shield === on) return;
    this.cfg = { ...this.cfg, shield: on };
    this.syncBoxes(false);
    this.rev++;
  }

  setRps(rps: number) {
    this.cfg = { ...this.cfg, rps };
    this.nextIn = Math.min(this.nextIn, rps > 0 ? 1 / rps : 1);
    this.rev++;
  }

  setPolicy(file: FileId, p: Policy) {
    this.cfg = { ...this.cfg, policy: { ...this.cfg.policy, [file]: p } };
    this.rev++;
  }

  setIgnoreQuery(on: boolean) {
    this.cfg = { ...this.cfg, ignoreQuery: on };
    this.rev++;
  }

  setMaxAge(file: FileId, maxAge: number) {
    const cur = this.policyOf(file);
    this.setPolicy(file, { ...cur, kind: 'public', maxAge });
  }

  setSwr(file: FileId, swr: number) {
    const cur = this.policyOf(file);
    this.setPolicy(file, { ...cur, swr: swr || undefined });
  }

  togglePop(pop: PopId) {
    if (this.popsDown.has(pop)) {
      this.popsDown.delete(pop);
      this.fx({ kind: 'ring', at: { id: `pop:${pop}` }, color: SIG.res, dur: 1, size: 1.2 });
    } else {
      if (this.popsDown.size >= POP_IDS.length - 1) return;
      this.popsDown.add(pop);
      this.fx({ kind: 'x', at: { id: `pop:${pop}` }, color: SIG.err, dur: 1.2, size: 1.4 });
    }
    this.rev++;
  }

  isDown(pop: PopId) {
    return this.popsDown.has(pop);
  }

  /** Ship a new version of a file to the origin. */
  deploy(file: FileId) {
    this.version = { ...this.version, [file]: this.version[file] + 1 };
    if (file === 'html') this.version = { ...this.version, app: this.version.app + 1 };
    this.fx({ kind: 'ring', at: { id: 'origin' }, color: SIG.warn, dur: 1.2, size: 1.3 });
    this.say('origin', file === 'html' ? `new build: ${appPath(this.version.app).slice(1)}` : `deployed ${FILES[file].path} v${this.version[file]}`, SIG.warn, 2.2);
    this.rev++;
  }

  /** Ask every edge to forget a file (the CDN's purge API fans the call out). */
  purge(file: FileId) {
    this.purges++;
    const targets = [...this.livePops().map((p) => `pop:${p}`), ...(this.cfg.shield ? ['shield'] : [])];
    targets.forEach((node, i) => {
      this.send({
        from: 'origin',
        to: node,
        dur: 0.55 + i * 0.05,
        color: SIG.hc,
        r: 3.4,
        lane: 0,
        onArrive: () => {
          const c = this.caches.get(node);
          if (c) for (const [key, e] of [...c]) if (e.file === file) c.delete(key);
          this.fx({ kind: 'ring', at: { id: node }, color: SIG.hc, dur: 0.9 });
          this.rev++;
        },
      });
    });
    this.say('origin', `purge ${FILES[file].path}`, SIG.hc, 1.6);
    this.rev++;
  }

  /** Publish a brand-new banner, and everyone in the world asks for it at once. */
  burst() {
    if (this.bursts > 0) this.version = { ...this.version, sale: this.version.sale + 1 };
    this.bursts++;
    this.saleFetches = 0;
    this.say('origin', `new: ${pathOf('sale', this.version.sale)}`, SIG.warn, 1.8);
    CITY_IDS.forEach((city, i) => this.after(0.15 + i * 0.06, () => this.request(city, 'sale')));
    this.rev++;
  }

  /** Errors in the last `span` simulated seconds. */
  recentErrors(span: number) {
    const since = this.t - span;
    return this.errorTimes.filter((x) => x >= since).length;
  }

  /** Start the "follow one request" tour. */
  startTour() {
    const alice = 'person:0';
    const bob = 'person:1';
    const node = 'pop:SYD';
    const up = 'origin';
    const r1 = rttMs(CITIES.sydney, POPS.SYD, true);
    const r2 = rttMs(POPS.SYD, ORIGIN_PLACE, false);
    this.tour = { stage: 'toEdge', aliceMs: r1 + r2, bobMs: r1 };
    const set = (stage: TourStage) => {
      if (this.tour) this.tour = { ...this.tour, stage };
      this.rev++;
    };
    this.send({
      from: alice,
      to: node,
      dur: 1.4,
      color: SIG.req,
      tag: 'tour',
      label: 'app.3f9a.js',
      onArrive: () => {
        set('lookup');
        this.fx({ kind: 'ring', at: { id: node }, color: SIG.heavy, dur: 1 });
        this.say(node, 'MISS', SIG.heavy, 1.6);
        this.after(1.8, () => {
          set('toOrigin');
          this.send({
            from: node,
            to: up,
            dur: 2.1,
            color: SIG.heavy,
            tag: 'tour',
            onArrive: () => {
              set('atOrigin');
              this.originFetches++;
              this.after(0.9, () => {
                set('toEdgeBack');
                this.send({
                  from: up,
                  to: node,
                  dur: 2.1,
                  color: SIG.res,
                  tag: 'tour',
                  onArrive: () => {
                    this.store(node, 'app', FILES.app.path, FILES.app.path, 1);
                    this.fx({ kind: 'ring', at: { id: node }, color: SIG.res, dur: 1 });
                    set('stored');
                    this.after(1.5, () => {
                      set('toUser');
                      this.send({
                        from: node,
                        to: alice,
                        dur: 1.4,
                        color: SIG.res,
                        tag: 'tour',
                        onArrive: () => {
                          this.recordCity('sydney', r1 + r2, true);
                          this.say(alice, `${r1 + r2} ms`, SIG.heavy, 2.4);
                          this.misses++;
                          this.after(1.6, () => this.tourBob(bob, node, r1, set));
                        },
                      });
                    });
                  },
                });
              });
            },
          });
        });
      },
    });
  }

  private tourBob(bob: string, node: string, r1: number, set: (s: TourStage) => void) {
    set('bobToEdge');
    this.send({
      from: bob,
      to: node,
      dur: 1.4,
      color: SIG.req,
      tag: 'tour',
      label: 'app.3f9a.js',
      onArrive: () => {
        set('bobLookup');
        const e = this.caches.get(node)?.get(FILES.app.path);
        if (e) e.hits++;
        this.hits++;
        this.fx({ kind: 'ring', at: { id: node }, color: SIG.res, dur: 1 });
        this.say(node, 'HIT', SIG.res, 1.6);
        this.after(1.3, () => {
          set('bobToUser');
          this.send({
            from: node,
            to: bob,
            dur: 1.4,
            color: SIG.res,
            tag: 'tour',
            onArrive: () => {
              this.say(bob, `${r1} ms`, SIG.res, 3);
              this.recordCity('sydney', r1, true);
              set('done');
            },
          });
        });
      },
    });
  }

  /* ================================================================ */
  /* Queries used by the stage and the panel                          */
  /* ================================================================ */

  policyOf(file: FileId): Policy {
    return this.cfg.policy[file] ?? DEFAULT_POLICY[file];
  }

  livePops(): PopId[] {
    return this.cfg.cdn ? POP_IDS.filter((p) => !this.popsDown.has(p)) : [];
  }

  /** The PoP anycast routing delivers this place to: the nearest one that is up. */
  nearestPop(place: Place): PopId | null {
    let best: PopId | null = null;
    let bestKm = Infinity;
    for (const p of POP_IDS) {
      if (this.popsDown.has(p)) continue;
      const d = km(place, POPS[p]);
      if (d < bestKm) {
        bestKm = d;
        best = p;
      }
    }
    return best;
  }

  placeOf(id: string): Place {
    if (id === 'origin' || id === 'shield') return ORIGIN_PLACE;
    if (id.startsWith('pop:')) return POPS[id.slice(4) as PopId];
    if (id === 'guest' && this.guest) return this.guest.place;
    if (id.startsWith('user:')) return CITIES[id.slice(5) as CityId];
    if (id.startsWith('person:') && this.cfg.people) return CITIES[this.cfg.people.city];
    return ORIGIN_PLACE;
  }

  private isUserBox(id: string) {
    return id.startsWith('user:') || id.startsWith('person:') || id === 'guest';
  }

  /** One-way modeled latency in ms between two boxes. */
  oneWay(a: string, b: string) {
    return rttMs(this.placeOf(a), this.placeOf(b), this.isUserBox(a) || this.isUserBox(b)) / 2;
  }

  entry(node: string, key: string) {
    return this.caches.get(node)?.get(key) ?? null;
  }

  entries(node: string): Entry[] {
    return [...(this.caches.get(node)?.values() ?? [])];
  }

  /** Is a cached copy fresh? Returns a 0..1 fraction of its lifetime left (1 = brand new), or 0 if stale. */
  freshness(e: Entry): number {
    const p = this.policyOf(e.file);
    if (p.kind !== 'public') return 0;
    if (p.immutable || (p.maxAge ?? 0) >= DAY) return 1;
    const age = this.t - e.storedAt;
    return Math.max(0, 1 - age / Math.max(0.001, p.maxAge ?? 0));
  }

  ageOf(e: Entry) {
    return Math.max(0, this.t - e.storedAt);
  }

  /** Cache state of one file at one node, for the chips on the map. */
  chip(node: string, file: FileId): { state: 'fresh' | 'stale' | 'none'; version: number; left: number } {
    let best: Entry | null = null;
    for (const e of this.caches.get(node)?.values() ?? []) {
      if (e.file !== file) continue;
      if (file === 'app' && this.cfg.mode === 'pageviews' && e.version !== this.version.app) continue;
      if (!best || e.storedAt > best.storedAt) best = e;
    }
    if (!best) return { state: 'none', version: 0, left: 0 };
    const f = this.freshness(best);
    const p = this.policyOf(file);
    const stale = p.kind === 'no-cache' ? false : f <= 0;
    return { state: stale ? 'stale' : 'fresh', version: best.version, left: f };
  }

  avgMs(): number | null {
    const since = this.t - 12;
    const xs = this.doneLog.filter((d) => d.t >= since && d.outcome !== 'ERROR');
    if (!xs.length) return null;
    return xs.reduce((a, d) => a + d.ms, 0) / xs.length;
  }

  /** Hits and total among the last 40 requests the edges answered (the window the HUD uses). */
  recentCounts(): { hits: number; total: number } {
    const xs = this.doneLog.filter((d) => d.outcome !== 'DIRECT' && d.outcome !== 'ERROR').slice(-40);
    return { hits: xs.filter((d) => d.outcome === 'HIT' || d.outcome === 'STALE').length, total: xs.length };
  }

  hitRatio(): number | null {
    const { hits, total } = this.recentCounts();
    return total < 2 ? null : hits / total;
  }

  originRate(): number {
    const since = this.t - 4;
    return this.originTimes.filter((x) => x >= since).length / 4;
  }

  originLoad(): number {
    return this.originRate() / this.cfg.originCap;
  }

  /* ================================================================ */
  /* Layout                                                            */
  /* ================================================================ */

  private syncBoxes(first: boolean) {
    this.box('origin');
    const cdn = this.cfg.cdn && this.cfg.view === 'map';
    for (const p of POP_IDS) {
      if (cdn) this.box(`pop:${p}`);
      else this.hide(`pop:${p}`);
    }
    if (cdn && this.cfg.shield) this.box('shield');
    else this.hide('shield');
    const people = this.cfg.people;
    for (const c of CITY_IDS) {
      if (this.cfg.view === 'map' && !(people && people.city === c)) this.box(`user:${c}`);
      else this.hide(`user:${c}`);
    }
    for (let i = 0; i < 2; i++) {
      if (people && i < people.names.length && this.cfg.view === 'map') this.box(`person:${i}`);
      else this.hide(`person:${i}`);
    }
    if (this.cfg.view !== 'map') this.hide('origin');
    if (first) this.relayout();
  }

  protected layout() {
    const { w, h } = this;
    if (this.orient === 'landscape') {
      const top = 70;
      const band = 216;
      let mw = w - 20;
      let mh = mw / MAP_ASPECT;
      const maxH = Math.max(150, h - top - band);
      if (mh > maxH) {
        mh = maxH;
        mw = mh * MAP_ASPECT;
      }
      this.map = { x: (w - mw) / 2, y: top, w: mw, h: mh };
      this.k = Math.min(1.15, Math.max(0.78, mw / 940));
    } else {
      // A phone stage is tall and narrow: stretch the map vertically so it isn't a sliver.
      const mw = w - 8;
      const top = 64;
      this.map = { x: 4, y: top, w: mw, h: Math.min((mw / MAP_ASPECT) * 1.5, h * 0.44) };
      this.k = 0.5;
    }
    const k = this.k;
    const P = (p: Place) => project(this.map, p.lat, p.lon);
    const portrait = this.orient === 'portrait';
    // Only position boxes that exist: place() would create missing ones.
    const at = (id: string, x: number, y: number, s: number) => {
      if (this.boxes.has(id)) this.place(id, x, y, s, s);
    };
    const o = P(ORIGIN_PLACE);
    at('origin', o.x, o.y, portrait ? 13 : 20);
    at('shield', o.x + (portrait ? 14 : 34 * k), o.y - (portrait ? 12 : 26 * k), portrait ? 11 : 16);
    for (const p of POP_IDS) {
      const q = P(POPS[p]);
      at(`pop:${p}`, q.x, q.y, portrait ? 10 : 15);
    }
    const cdn = this.cfg.cdn;
    const um = portrait ? 8 : 12;
    const f = portrait ? 0.46 : k;
    for (const c of CITY_IDS) {
      const city = CITIES[c];
      const q = P(city);
      at(`user:${c}`, q.x + (cdn ? city.off[0] * f : 0), q.y + (cdn ? city.off[1] * f : 0), um);
    }
    const people = this.cfg.people;
    if (people) {
      const city = CITIES[people.city];
      const q = P(city);
      const sx = Math.sign(city.off[0]);
      const base = { x: q.x + (cdn ? city.off[0] * f : 0), y: q.y + (cdn ? city.off[1] * f : 0) };
      const gap = portrait ? 11 : 19;
      at('person:0', base.x - sx * (portrait ? 1 : 3), base.y - gap / 2, um);
      at('person:1', base.x + sx * (portrait ? 1 : 3), base.y + gap / 2, um);
    }
    if (this.guest) {
      const q = P(this.guest.place);
      at('guest', q.x, q.y, portrait ? 10 : 13);
    }
  }

  protected curveFor(from: string, to: string, lane: number): Curve | null {
    const a = this.boxes.get(from);
    const b = this.boxes.get(to);
    if (!a || !b || Number.isNaN(a.x) || Number.isNaN(b.x)) return null;
    return arcCurve(a, b, lane, this.orient === 'portrait' ? 0.45 : this.k);
  }

  protected wires(): WireSpec[] {
    if (this.cfg.view !== 'map' || !this.cfg.routes) return [];
    const out: WireSpec[] = [];
    const cdn = this.cfg.cdn;
    const active = new Set(this.cfg.cities);
    const people = this.cfg.people;
    const users: [string, CityId, boolean][] = [];
    for (const c of CITY_IDS) {
      if (people && people.city === c) people.names.forEach((_, i) => users.push([`person:${i}`, c, true]));
      else users.push([`user:${c}`, c, active.has(c)]);
    }
    for (const [id, c, on] of users) {
      if (!cdn) {
        out.push({ from: id, to: 'origin', state: on ? 'normal' : 'dim' });
      } else {
        const p = this.nearestPop(CITIES[c]);
        if (!p) continue;
        // A user whose own PoP is down gets rerouted: draw that route hot.
        out.push({ from: id, to: `pop:${p}`, state: p !== CITIES[c].pop ? 'hot' : on ? 'normal' : 'dim' });
      }
    }
    if (cdn) {
      const up = this.cfg.shield ? 'shield' : 'origin';
      for (const p of this.livePops()) out.push({ from: `pop:${p}`, to: up, state: 'dashed' });
      if (this.cfg.shield) out.push({ from: 'shield', to: 'origin', state: 'normal' });
    }
    if (this.guest?.pop && this.isLive('guest')) out.push({ from: 'guest', to: `pop:${this.guest.pop}`, state: 'hot' });
    return out;
  }

  /* ================================================================ */
  /* Simulation loop                                                  */
  /* ================================================================ */

  protected step(dt: number) {
    this.sampleT -= dt;
    if (this.sampleT <= 0) {
      this.sampleT = 0.5;
      const hr = this.hitRatio();
      if (hr != null) this.hitSeries = [...this.hitSeries, hr].slice(-36);
      this.originTimes = this.originTimes.filter((x) => x >= this.t - 6);
    }
    if (this.cfg.view !== 'map') return;
    const mode = this.cfg.mode;
    if (mode === 'tour' || mode === 'idle') return;
    if (mode === 'anycast') {
      this.stepGuests(dt);
      return;
    }
    if (this.cfg.rps <= 0) return;
    this.nextIn -= dt;
    let guard = 0;
    while (this.nextIn <= 0 && guard++ < 8) {
      const gap = this.cfg.poisson ? -Math.log(1 - this.rng()) / this.cfg.rps : 1 / this.cfg.rps;
      this.nextIn += gap;
      this.spawn();
    }
  }

  private spawn() {
    const mode = this.cfg.mode;
    if (mode === 'hitmiss' && !(this.game?.done && this.scripted >= HITMISS.length)) {
      const s = HITMISS[this.scripted % HITMISS.length];
      this.scripted++;
      this.request(s.city, s.file);
      return;
    }
    const cities = this.cfg.cities.length ? this.cfg.cities : CITY_IDS;
    if (mode === 'account') {
      const people = this.cfg.people;
      if (!people) return;
      const i = this.personTurn++ % people.names.length;
      this.request(people.city, 'account', { person: people.names[i], box: `person:${i}` });
      return;
    }
    const city = this.cfg.poisson ? cities[Math.floor(this.rng() * cities.length)] : cities[this.rr++ % cities.length];
    if (mode === 'pageviews') {
      this.request(city, 'html', { then: (v) => this.request(city, 'app', { version: v }) });
      return;
    }
    this.request(city, this.pickFile());
  }

  private pickFile(): FileId {
    const entries = Object.entries(this.cfg.mix) as [FileId, number][];
    if (this.cfg.cycle && entries.length) return entries[this.fileTurn++ % entries.length][0];
    const total = entries.reduce((a, [, w]) => a + w, 0);
    let r = this.rng() * total;
    for (const [f, w] of entries) {
      r -= w;
      if (r <= 0) return f;
    }
    return entries[0]?.[0] ?? 'app';
  }

  /* ---------------- requests ---------------- */

  private hop(from: string, to: string, ms: number, color: string, onArrive: () => void, label?: string, r?: number) {
    this.send({ from, to, dur: Math.max(MIN_HOP, (ms * SLOW) / 1000), color, label, lane: 2.5, r, onArrive });
  }

  request(city: CityId, file: FileId, opts: { person?: string; box?: string; version?: number; then?: (v: number) => void } = {}) {
    const user = opts.box ?? `user:${city}`;
    const version = file === 'app' ? (opts.version ?? this.version.app) : this.version[file];
    const base = pathOf(file, version);
    const q = this.cfg.utm ? `?utm_source=${['mail', 'ads', 'social'][Math.floor(this.rng() * 3)]}&utm_id=${100 + Math.floor(this.rng() * 900)}` : '';
    const req: Req = {
      id: this.seq++,
      city,
      user,
      file,
      version,
      path: base + q,
      key: base + (this.cfg.ignoreQuery ? '' : q),
      person: opts.person,
      pop: null,
      ms: 0,
      then: opts.then,
    };
    const label = this.cfg.labels ? base.slice(1) : undefined;
    if (!this.cfg.cdn) {
      const ow = this.oneWay(user, 'origin');
      this.hop(
        user,
        'origin',
        ow,
        SIG.req,
        () => {
          req.ms += ow;
          this.originServe(req, 'direct', null, (res) => {
            const bad = res.status >= 500;
            this.hop('origin', user, ow, bad ? SIG.err : SIG.res, () => {
              req.ms += ow + res.ms;
              this.finish(req, bad ? 'ERROR' : 'DIRECT', res.version, res.owner);
            });
          });
        },
        label,
      );
      return;
    }
    const pop = this.nearestPop(this.placeOf(user));
    if (!pop) return;
    req.pop = pop;
    const node = `pop:${pop}`;
    const ow = this.oneWay(user, node);
    this.hop(
      user,
      node,
      ow,
      SIG.req,
      () => {
        req.ms += ow;
        this.atEdge(req);
      },
      label,
    );
  }

  private decide(p: Policy, e: Entry | null | undefined): Outcome {
    if (p.kind === 'private') return 'BYPASS';
    if (!e) return 'MISS';
    if (p.kind === 'no-cache') return 'REVAL';
    const age = this.t - e.storedAt;
    if (p.immutable || age < (p.maxAge ?? 0)) return 'HIT';
    if (p.swr && age < (p.maxAge ?? 0) + p.swr) return 'STALE';
    return 'REVAL';
  }

  private atEdge(req: Req) {
    const pop = req.pop as PopId;
    const node = `pop:${pop}`;
    if (!this.isLive(node)) return;
    if (this.popsDown.has(pop)) {
      // The PoP went dark while this packet was on its way.
      this.fx({ kind: 'x', at: { id: node }, color: SIG.err, dur: 0.8 });
      return;
    }
    const pol = this.policyOf(req.file);
    const entry = this.entry(node, req.key);
    const outcome = this.decide(pol, entry);
    // `fixed`: serve exactly what the learner was asked about. Otherwise look
    // again once the lookup finishes: a fill may have landed in the meantime.
    const go = (fixed = false) => {
      this.after(LOOKUP, () => {
        const e = fixed ? entry : this.entry(node, req.key);
        this.serveAtEdge(req, node, fixed ? outcome : this.decide(pol, e), e, pol);
      });
    };
    if (this.game && !this.game.done && this.cfg.mode === 'hitmiss') {
      const hit = outcome === 'HIT';
      const path = req.path;
      const others = this.entries(node)
        .filter((e) => e.key !== req.key)
        .map((e) => e.path);
      const up = rttMs(POPS[pop], ORIGIN_PLACE, false);
      const local = Math.round(this.oneWay(req.user, node) * 2);
      this.game.ask({
        acceptable: [hit ? 'hit' : 'miss'],
        choices: [
          { id: 'hit', label: 'Hit: serve it locally' },
          { id: 'miss', label: 'Miss: ask the origin' },
        ],
        ask: `${pop} · ${path.slice(1)} — hit or miss?`,
        askAt: { id: node },
        explain: () =>
          hit
            ? `${pop} already holds ${path} (stored ${Math.round(this.t - (entry?.storedAt ?? this.t))} s ago), so it answers in about ${local} ms without bothering Virginia.`
            : others.length
              ? `${pop} holds ${others.join(' and ')}, but not ${path}. A cache stores individual URLs, so this is a miss: ${pop} fetches it from Virginia (+${up} ms).`
              : `${pop} has never been asked for ${path}. Each PoP keeps its own cache, so it must fetch the file from Virginia (+${up} ms) before it can answer.`,
        resolve: () => go(true),
      });
      return;
    }
    go();
  }

  private serveAtEdge(req: Req, node: string, outcome: Outcome, entry: Entry | null, pol: Policy) {
    const say = this.cfg.say;
    switch (outcome) {
      case 'HIT': {
        if (entry) entry.hits++;
        this.fx({ kind: 'ring', at: { id: node }, color: SIG.res, dur: 0.8, size: 0.8 });
        if (say) this.say(node, 'HIT', SIG.res, 1.1);
        this.toUser(req, 'HIT', entry?.version ?? 1, entry?.owner);
        return;
      }
      case 'STALE': {
        this.fx({ kind: 'ring', at: { id: node }, color: SIG.res, dur: 0.8, size: 0.8 });
        if (say) this.say(node, 'STALE → refresh', SIG.hc, 1.3);
        this.toUser(req, 'STALE', entry?.version ?? 1, entry?.owner);
        if (entry) this.revalidate(node, req, entry, null);
        return;
      }
      case 'MISS': {
        this.fx({ kind: 'ring', at: { id: node }, color: SIG.heavy, dur: 0.8, size: 0.8 });
        if (say) this.say(node, 'MISS', SIG.heavy, 1.1);
        this.fetch(node, req, 'fill', null, (res) => {
          if (res.status >= 500) {
            req.ms += res.ms;
            this.toUser(req, 'ERROR', 0);
            return;
          }
          if (pol.kind !== 'private') this.store(node, req.file, req.key, req.path, res.version, res.owner);
          req.ms += res.ms;
          this.toUser(req, 'MISS', res.version, res.owner);
        });
        return;
      }
      case 'REVAL': {
        if (say) this.say(node, pol.kind === 'no-cache' ? 'revalidate' : 'expired → revalidate', SIG.hc, 1.2);
        if (entry) this.revalidate(node, req, entry, (res) => this.toUser(req, res.status >= 500 ? 'ERROR' : 'REVAL', res.version, res.owner));
        return;
      }
      case 'BYPASS': {
        if (say) this.say(node, 'BYPASS', SIG.req, 1.1);
        this.fetch(node, req, 'pass', null, (res) => {
          req.ms += res.ms;
          this.toUser(req, res.status >= 500 ? 'ERROR' : 'BYPASS', res.version, res.owner);
        });
        return;
      }
      default:
        return;
    }
  }

  /** Conditional request upstream: "has it changed since version N?" */
  private revalidate(node: string, req: Req, entry: Entry, then: ((r: UpRes) => void) | null) {
    this.fetch(node, req, 'reval', entry.version, (res) => {
      if (res.status === 304) {
        entry.storedAt = this.t;
      } else if (res.status === 200) {
        this.store(node, req.file, req.key, req.path, res.version, res.owner);
      }
      if (then) {
        req.ms += res.ms;
        then(res.status === 304 ? { ...res, version: entry.version } : res);
      }
      this.rev++;
    });
  }

  /** Ask the next tier up (the shield, or the origin). Concurrent asks for the same key share one trip. */
  private fetch(node: string, req: Req, kind: 'fill' | 'reval' | 'pass', have: number | null, cb: (r: UpRes) => void) {
    const up = kind === 'pass' || node === 'shield' || !this.cfg.shield ? 'origin' : 'shield';
    const key = kind === 'pass' ? null : `${node}|${req.key}|${kind}`;
    if (key) {
      const waiting = this.inflight.get(key);
      if (waiting) {
        waiting.push(cb);
        return;
      }
      this.inflight.set(key, [cb]);
    }
    const done = (r: UpRes) => {
      const cbs = key ? (this.inflight.get(key) ?? [cb]) : [cb];
      if (key) this.inflight.delete(key);
      cbs.forEach((f) => f(r));
    };
    const ow = this.oneWay(node, up);
    const color = kind === 'fill' ? SIG.heavy : kind === 'reval' ? SIG.hc : SIG.req;
    this.hop(node, up, ow, color, () => {
      const back = (r: UpRes) => {
        const c = r.status >= 500 ? SIG.err : r.status === 304 ? SIG.hc : SIG.res;
        this.hop(up, node, ow, c, () => done({ ...r, ms: r.ms + 2 * ow }));
      };
      if (up === 'origin') this.originServe(req, kind, have, back);
      else this.atShield(req, kind, have, back);
    });
  }

  private atShield(req: Req, kind: 'fill' | 'reval' | 'pass', have: number | null, cb: (r: UpRes) => void) {
    const node = 'shield';
    const pol = this.policyOf(req.file);
    this.after(LOOKUP, () => {
      // Decide after the lookup, so a fill that just landed counts as a hit.
      const entry = this.entry(node, req.key);
      const outcome = this.decide(pol, entry);
      if (entry && (outcome === 'HIT' || outcome === 'STALE')) {
        entry.hits++;
        this.fx({ kind: 'ring', at: { id: node }, color: SIG.res, dur: 0.8, size: 0.8 });
        cb({ status: kind === 'reval' && have === entry.version ? 304 : 200, version: entry.version, owner: entry.owner, ms: 0 });
        return;
      }
      this.fx({ kind: 'ring', at: { id: node }, color: SIG.heavy, dur: 0.8, size: 0.8 });
      this.fetch(node, req, entry ? 'reval' : 'fill', entry?.version ?? null, (r) => {
        if (r.status >= 500) {
          cb(r);
          return;
        }
        if (r.status === 304 && entry) entry.storedAt = this.t;
        else if (pol.kind !== 'private') this.store(node, req.file, req.key, req.path, r.version, r.owner);
        const v = r.status === 304 && entry ? entry.version : r.version;
        cb({ status: kind === 'reval' && have === v ? 304 : 200, version: v, owner: r.owner, ms: r.ms });
      });
    });
  }

  private originServe(req: Req, kind: 'fill' | 'reval' | 'pass' | 'direct', have: number | null, cb: (r: UpRes) => void) {
    const now = this.t;
    this.originTimes.push(now);
    this.originFetches++;
    if (req.file === 'sale') this.saleFetches++;
    const service = 1 / Math.max(0.1, this.cfg.originCap);
    const start = Math.max(now, this.originFree);
    const wait = start - now;
    if (wait > MAX_QUEUE) {
      this.errors++;
      this.errorTimes = [...this.errorTimes.filter((x) => x >= now - 20), now];
      this.fx({ kind: 'x', at: { id: 'origin' }, color: SIG.err, dur: 0.7 });
      this.after(0.06, () => cb({ status: 503, version: 0, ms: 0 }));
      this.rev++;
      return;
    }
    this.originFree = start + service;
    const version = req.file === 'app' || req.file === 'sale' ? req.version : this.version[req.file];
    const status = kind === 'reval' && have === version ? 304 : 200;
    const owner = req.file === 'account' ? req.person : undefined;
    this.after(wait + Math.min(service, 0.12), () => cb({ status, version, owner, ms: (wait * 1000) / SLOW }));
    this.rev++;
  }

  private store(node: string, file: FileId, key: string, path: string, version: number, owner?: string) {
    let c = this.caches.get(node);
    if (!c) {
      c = new Map();
      this.caches.set(node, c);
    }
    c.set(key, { key, path, file, version, owner, storedAt: this.t, hits: 0 });
    // Keep the demo tidy: evict the oldest keys past a small capacity.
    if (c.size > 14) {
      const oldest = [...c.values()].sort((a, b) => a.storedAt - b.storedAt)[0];
      if (oldest) c.delete(oldest.key);
    }
    this.rev++;
  }

  private toUser(req: Req, outcome: Outcome, version: number, owner?: string) {
    const node = `pop:${req.pop}`;
    const ow = this.oneWay(node, req.user);
    let color: string = outcome === 'ERROR' ? SIG.err : SIG.res;
    if (req.file === 'account' && owner) color = owner === 'Carol' ? SIG.pink : SIG.teal;
    this.hop(node, req.user, ow, color, () => {
      req.ms += ow;
      this.finish(req, outcome, version, owner);
    });
  }

  private finish(req: Req, outcome: Outcome, version: number, owner?: string) {
    const ms = Math.round(req.ms);
    this.doneLog.push({ t: this.t, ms, outcome });
    if (this.doneLog.length > 240) this.doneLog = this.doneLog.slice(-200);
    if (outcome === 'HIT' || outcome === 'STALE') this.hits++;
    else if (outcome === 'MISS' || outcome === 'REVAL' || outcome === 'BYPASS') this.misses++;
    if (req.city && outcome !== 'ERROR') this.recordCity(req.city, ms, outcome !== 'DIRECT');
    if (outcome === 'ERROR') this.fx({ kind: 'x', at: { id: req.user }, color: SIG.err, dur: 0.8 });
    if (req.file === 'account' && owner && req.person && owner !== req.person) {
      this.leaks++;
      this.fx({ kind: 'ring', at: { id: req.user }, color: SIG.err, dur: 1.2, size: 1.3 });
      this.say(req.user, `${req.person} got ${owner}’s account!`, SIG.err, 2.4);
    } else if (req.file === 'style' && this.cfg.versions) {
      const old = version < this.version.style;
      this.say(req.user, old ? `old v${version}` : `v${version}`, old ? SIG.warn : SIG.res, 1.4);
    }
    const line: LogLine = {
      id: req.id,
      who: req.person ?? (req.city ? CITIES[req.city].name : 'guest'),
      path: req.path,
      outcome,
      ms,
      version,
      owner,
      person: req.person,
      pop: req.pop,
      file: req.file,
    };
    this.log = [line, ...this.log].slice(0, 8);
    req.then?.(version);
    this.rev++;
  }

  recordCity(city: CityId, ms: number, cdn: boolean) {
    const cur = this.cityMs[city];
    const k = cdn ? 'cdn' : 'direct';
    const prev = cur[k];
    this.cityMs = { ...this.cityMs, [city]: { ...cur, [k]: prev == null ? ms : prev * 0.6 + ms * 0.4, last: ms } };
  }

  /* ---------------- anycast visitors ---------------- */

  private stepGuests(dt: number) {
    this.guestT -= dt;
    if (this.guestT > 0) return;
    const g = this.guest;
    if (!g) {
      const place = GUESTS[this.guestIdx++ % GUESTS.length];
      this.guest = { place, pop: null, phase: 'arrive' };
      this.box('guest');
      this.relayout();
      this.fx({ kind: 'ring', at: { id: 'guest' }, color: SIG.warn, dur: 1, size: 1.1 });
      this.guestT = 1.1;
      this.rev++;
      return;
    }
    if (g.phase === 'arrive') {
      const best = this.nearestPop(g.place);
      if (!best) return;
      this.guest = { ...g, phase: 'ask' };
      if (this.game && !this.game.done) {
        const d = (p: PopId) => km(g.place, POPS[p]);
        this.game.ask({
          acceptable: [best],
          choices: POP_IDS.filter((p) => !this.popsDown.has(p)).map((p) => ({ id: p, label: p })),
          ask: `A visitor in ${g.place.name}: which edge?`,
          askAt: { id: 'guest' },
          explain: (picked, ok) =>
            ok
              ? `${g.place.name} → ${best}: ${fmtKm(d(best))} away, about ${rttMs(g.place, POPS[best], true)} ms round trip. Routers deliver the packets to the nearest PoP announcing the address.`
              : `It goes to ${best}, ${fmtKm(d(best))} away (about ${rttMs(g.place, POPS[best], true)} ms). ${POPS[picked as PopId] ? `${picked} is ${fmtKm(d(picked as PopId))} away.` : ''} Anycast delivers to the closest announcement.`,
          resolve: () => this.sendGuest(best),
        });
      } else this.sendGuest(best);
      return;
    }
    if (g.phase === 'leaving') {
      this.hide('guest');
      this.guest = null;
      this.guestT = 0.8;
      this.rev++;
    }
  }

  private sendGuest(pop: PopId) {
    const g = this.guest;
    if (!g) return;
    this.guest = { ...g, pop, phase: 'flying' };
    this.guestT = 99;
    const node = `pop:${pop}`;
    const ow = this.oneWay('guest', node);
    this.hop('guest', node, ow, SIG.req, () => {
      this.fx({ kind: 'ring', at: { id: node }, color: SIG.res, dur: 0.9 });
      this.hop(node, 'guest', ow, SIG.res, () => {
        this.say('guest', `${Math.round(ow * 2)} ms`, SIG.res, 1.6);
        if (this.guest) this.guest = { ...this.guest, phase: 'leaving' };
        this.guestT = 1.7;
        this.rev++;
      });
    });
    this.rev++;
  }

  /* ---------------- setup helpers ---------------- */

  private resetMetrics() {
    this.originFetches = 0;
    this.hits = 0;
    this.misses = 0;
    this.leaks = 0;
    this.errors = 0;
    this.purges = 0;
    this.log = [];
    this.doneLog = [];
    this.originTimes = [];
    this.hitSeries = [];
    this.saleFetches = 0;
    this.bursts = 0;
    this.errorTimes = [];
    this.fileTurn = 0;
    const blank = { direct: null, cdn: null, last: null };
    this.cityMs = Object.fromEntries(CITY_IDS.map((c) => [c, { ...blank }])) as Record<CityId, { direct: number | null; cdn: number | null; last: number | null }>;
  }

  private warmUp(w: WarmSpec) {
    if (w === 'cold') return;
    const plan: [string, FileId[]][] =
      w === 'all' ? POP_IDS.map((p) => [`pop:${p}`, this.cfg.warmFiles]) : Object.entries(w).map(([k, v]) => [k === 'shield' ? 'shield' : `pop:${k}`, v ?? []]);
    for (const [node, files] of plan) {
      files.forEach((f, i) => {
        const path = f === 'app' ? appPath(1) : FILES[f].path;
        this.store(node, f, path, path, 1);
        const e = this.entry(node, path);
        if (e) e.storedAt = this.t - 4 - i * 3 - (node.length % 5);
      });
    }
  }

  /** Where a person/city label should go ('left' | 'right'). */
  sideOf(id: string): 'left' | 'right' {
    if (id.startsWith('user:')) return CITIES[id.slice(5) as CityId].side;
    if (id.startsWith('person:') && this.cfg.people) return CITIES[this.cfg.people.city].side;
    if (id === 'guest' && this.guest) return this.guest.place.side;
    return 'right';
  }
}
