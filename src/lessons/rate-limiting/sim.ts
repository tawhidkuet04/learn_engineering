import { PALETTE, SIG } from '@/lib/sim/colors';
import type { Curve } from '@/lib/sim/geometry';
import { PredictGame } from '@/lib/sim/predict';
import { mulberry32 } from '@/lib/sim/rng';
import { Sim, portCurve, type ScriptEvent, type WireSpec } from '@/lib/sim/Sim';
import { limiterCard, singleBucket } from './geo';
import { ALGO_NAMES, busiestSpan, countAllowed, decide, freshState, leak, settle, type Algo, type Decision, type KeyState, type Params } from './limiter';

/* ------------------------------------------------------------------ */
/* Config                                                              */
/* ------------------------------------------------------------------ */

export type SceneKind = 'flow' | 'dist' | 'race' | 'storm';
export type Traffic = 'off' | 'steady' | 'flood' | 'bursty' | 'boundary' | 'bursts';
export type Retry = 'immediate' | 'backoff' | 'jitter';
export type StripMode = 'off' | 'hist' | 'flow';
export type KeyMode = 'client' | 'global';
export type Store = 'local' | 'redis';
export type RaceMode = 'getset' | 'incr';
export type PredictKind = 'fixed' | 'bucket' | 'race';
export type Pattern = 'steady' | 'bursty' | 'abusive';

export interface ClientCfg {
  id: string;
  traffic: Traffic;
  /** steady/flood: requests per second */
  rate?: number;
  /** bursty: requests per burst and seconds between bursts */
  burst?: number;
  every?: number;
  /** Seconds before the first request (default: a random 0.25 to 0.75) */
  delay?: number;
}

export interface RateConfig {
  scene: SceneKind;
  clients: ClientCfg[];
  algo: Algo | 'none';
  key: KeyMode;
  limit: number;
  window: number;
  capacity: number;
  rate: number;
  /** API server: worker slots, seconds per request, waiting room */
  workers: number;
  service: number;
  queueCap: number;
  strip: StripMode;
  /** Track and draw the busiest window-length stretch on the strip */
  span: boolean;
  store: Store;
  retry: Retry;
  race: RaceMode;
  predict?: PredictKind;
  /** Client → limiter travel time (s) */
  hop: number;
  /** Limiter clock at the start of the step (shifts where window edges fall) */
  clockStart: number;
  /** Attach HTTP headers to responses (drawn by an inspector card) */
  inspect: boolean;
  /** Storm scene: number of devices */
  devices: number;
}

export const DEFAULTS: RateConfig = {
  scene: 'flow',
  clients: [{ id: 'alice', traffic: 'steady', rate: 0.8 }],
  algo: 'fixed',
  key: 'client',
  limit: 5,
  window: 10,
  capacity: 5,
  rate: 1,
  workers: 3,
  service: 0.35,
  queueCap: 8,
  strip: 'hist',
  span: false,
  store: 'local',
  retry: 'immediate',
  race: 'getset',
  hop: 0.75,
  clockStart: 0,
  inspect: false,
  devices: 6,
};

export interface Person {
  name: string;
  ip: string;
  color: string;
}

export const CAST: Record<string, Person> = {
  alice: { name: 'Alice', ip: '198.51.100.42', color: SIG.pink },
  bob: { name: 'Bob', ip: '198.51.100.77', color: SIG.teal },
  bot: { name: 'Scraper', ip: '203.0.113.66', color: SIG.heavy },
};

const DEVICE_COLORS = [SIG.pink, SIG.teal, SIG.lime, SIG.blue, SIG.heavy, SIG.req, SIG.hc, PALETTE[7]];

export function personOf(id: string): Person {
  if (CAST[id]) return CAST[id];
  const n = Number(id.replace(/\D/g, '')) || 1;
  return { name: `app ${n}`, ip: `192.0.2.${10 + n}`, color: DEVICE_COLORS[(n - 1) % DEVICE_COLORS.length] };
}

export const GATEWAYS = ['gw1', 'gw2', 'gw3'];

export function fmtClock(t: number) {
  const s = Math.max(0, Math.round(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/* ------------------------------------------------------------------ */
/* Runtime state                                                       */
/* ------------------------------------------------------------------ */

export interface ClientState extends Person {
  id: string;
  cfg: ClientCfg;
  next: number;
  /** Scheduled fire times (boundary attack) */
  plan: number[];
  sent: number;
  ok: number;
  limited: number;
  failed: number;
  /** vt of the last response, and its color, for a small pulse */
  pulseVt: number;
  pulseColor: string;
  /** storm scene */
  waiting: boolean;
  attempt: number;
}

interface Req {
  id: number;
  client: string;
  attempt: number;
  burst?: number;
  first?: boolean;
}

export interface StripEvent {
  t: number;
  ok: boolean;
  client: string;
}

export interface Job {
  req: Req;
  via: string;
  start: number;
  end: number;
  color: string;
}

export interface LastDecision {
  d: Decision;
  client: string;
  node: string;
  vt: number;
}

export interface Storm {
  id: number;
  start: number;
  attempts: number;
  rejected: number;
  left: number;
  doneAt: number | null;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FlightNote {
  head: string;
  tone: 'res' | 'err';
  lines: string[];
}

const STAGGER = 0.12;

/** Bursts for the token-bucket predictions: [fire at (limiter clock), size]. Tuned so no answer is a coin flip. */
export const PREDICT_BURSTS: [number, number][] = [
  [0.8, 4],
  [5.1, 6],
  [9.1, 5],
  [18.8, 6],
  [21.8, 4],
  [29.1, 6],
  [33.1, 5],
  [39.1, 6],
];
const PREDICT_LOOP = 50;

export class RateSim extends Sim {
  cfg: RateConfig = { ...DEFAULTS };
  game: PredictGame | null = null;

  clients = new Map<string, ClientState>();
  /** Limiter state per key: the single limiter, or Redis in the distributed scene */
  keys = new Map<string, KeyState>();
  /** Per-gateway local state in the distributed scene */
  gwKeys = new Map<string, Map<string, KeyState>>();

  jobs: (Job | null)[] = [];
  waiting: { req: Req; via: string; color: string }[] = [];
  served = 0;
  errors = 0;

  events: StripEvent[] = [];
  outs: number[] = [];
  markers: { t: number; label: string }[] = [];
  /** Busiest window-length stretch in recent history, and the most ever this step */
  best = { count: 0, start: 0 };
  bestEver = 0;
  accepted = 0;
  rejected = 0;
  maxWait = 0;
  last: LastDecision | null = null;
  /** Every limiter decision, in order, when set (headless checks in verify/). */
  trace: { d: Decision; client: string; node: string }[] | null = null;
  notes = new Map<number, FlightNote>();

  /** Limiter clock origin: lt = t - origin */
  origin = 0;
  /** Limiter clock at which the strip's history starts */
  stripStart = 0;
  /** Headers of the most recent response (for the docked readout on phones) */
  lastNote: FlightNote | null = null;
  /** Where the strip is drawn (set in layout) */
  strip: Rect | null = null;

  redisOps = 0;

  /** race scene: its own clock so the diagram can loop and freeze */
  raceT = 0;
  raceRuns = 0;

  /** storm scene */
  storms: Storm[] = [];

  private rr = 0;
  private raceAsked = false;
  private nextStorm = 1;
  private seq = 1;
  private burstSeq = 1;
  private predictIdx = 0;
  private held = new Map<number, Req>();
  private jitterRng = mulberry32(7);
  private askedDenyWin = -1;
  private last429Label = -10;

  constructor() {
    super();
    this.enter({ ...DEFAULTS }, [], { reset: true });
  }

  /* ---------------- derived ---------------- */

  get lt() {
    return this.t - this.origin;
  }

  get params(): Params {
    const c = this.cfg;
    return { limit: c.limit, window: c.window, capacity: c.capacity, rate: c.rate };
  }

  /** Keys in drawing order (the clients' order, or the single global key) */
  keyOrder(): string[] {
    if (this.cfg.key === 'global') return ['*'];
    return [...this.clients.keys()];
  }

  keyLabel(key: string) {
    if (key === '*') return 'everyone';
    return this.clients.get(key)?.name ?? key;
  }

  keyColor(key: string) {
    if (key === '*') return SIG.text2;
    return this.clients.get(key)?.color ?? SIG.req;
  }

  stateOf(key: string): KeyState {
    let s = this.keys.get(key);
    if (!s) {
      s = freshState(key, this.lt, this.params);
      this.keys.set(key, s);
    }
    return s;
  }

  gwStateOf(gw: string, key: string): KeyState {
    let m = this.gwKeys.get(gw);
    if (!m) {
      m = new Map();
      this.gwKeys.set(gw, m);
    }
    let s = m.get(key);
    if (!s) {
      s = freshState(key, this.lt, this.params);
      m.set(key, s);
    }
    return s;
  }

  /** Accepted requests from one client in the current fixed window. */
  allowedThisWindow(client: string) {
    const w0 = Math.floor(this.lt / this.cfg.window + 1e-9) * this.cfg.window;
    let n = 0;
    for (const e of this.events) if (e.ok && e.client === client && e.t >= w0 - 1e-9) n++;
    return n;
  }

  /** Requests per client over the last `span` seconds. */
  recent(client: string, span: number) {
    const from = this.lt - span;
    let ok = 0;
    let no = 0;
    for (const e of this.events) {
      if (e.t < from || e.client !== client) continue;
      if (e.ok) ok++;
      else no++;
    }
    return { ok, no };
  }

  get multiColor() {
    return this.cfg.scene !== 'storm' && this.clients.size > 1;
  }

  reqColor(client: string) {
    return this.multiColor ? personOf(client).color : SIG.req;
  }

  /** Visible limiter state for drawing (kept current every tick). */
  liveState(key: string) {
    return this.keys.get(key) ?? null;
  }

  /* ---------------- lesson API (components call these) ---------------- */

  enter(cfg: RateConfig, script: ScriptEvent<RateSim>[] = [], opts: { reset?: boolean; predict?: number } = {}) {
    const prevScene = this.cfg.scene;
    this.cfg = { ...cfg, clients: cfg.clients.map((c) => ({ ...c })) };
    if (opts.reset) this.resetWorld();
    else this.syncClients();
    this.game = opts.predict ? new PredictGame(this, opts.predict) : null;
    this.raceAsked = false;
    this.syncBoxes(prevScene !== cfg.scene);
    this.runScript(script);
    this.rev++;
  }

  setAlgo(algo: Algo) {
    if (this.cfg.algo === algo) return;
    this.cfg = { ...this.cfg, algo };
    this.resetLimiter(ALGO_NAMES[algo]);
  }

  setKeyMode(key: KeyMode, limit?: number) {
    if (this.cfg.key === key && (limit == null || limit === this.cfg.limit)) return;
    this.cfg = { ...this.cfg, key, limit: limit ?? this.cfg.limit };
    this.resetLimiter(key === 'global' ? 'one global limit' : 'per client');
  }

  setParam(name: 'limit' | 'window' | 'capacity' | 'rate', v: number) {
    this.cfg = { ...this.cfg, [name]: v };
    const lt = this.lt;
    for (const s of this.allStates()) {
      if (name === 'capacity') s.tokens = Math.min(s.tokens, v);
      if (name === 'window') {
        s.win = Math.floor(lt / v);
        s.count = 0;
        s.prev = 0;
      }
      if (name === 'rate' && s.nextLeak > lt + 1 / v) s.nextLeak = lt + 1 / v;
    }
    this.best = { count: 0, start: 0 };
    this.rev++;
  }

  setStore(store: Store) {
    if (this.cfg.store === store) return;
    this.cfg = { ...this.cfg, store };
    this.clearTransient();
    this.keys.clear();
    this.gwKeys.clear();
    this.events = [];
    this.last = null;
    this.redisOps = 0;
    this.origin = this.t;
    this.stripStart = 0;
    for (const c of this.clients.values()) {
      c.next = 0.2 + this.rng() * 0.3;
      c.ok = c.limited = c.failed = c.sent = 0;
    }
    this.jobs = this.jobs.map(() => null);
    this.waiting = [];
    this.syncBoxes(false);
    this.rev++;
  }

  setRetry(retry: Retry) {
    this.cfg = { ...this.cfg, retry };
    this.clearTransient();
    this.keys.clear();
    this.events = [];
    this.outs = [];
    this.storms = [];
    this.markers = [];
    this.origin = this.t;
    this.stripStart = 0;
    this.nextStorm = 0.8;
    this.jitterRng = mulberry32(7);
    for (const c of this.clients.values()) {
      c.waiting = false;
      c.attempt = 0;
      c.ok = c.limited = c.failed = c.sent = 0;
    }
    this.accepted = this.rejected = 0;
    this.jobs = this.jobs.map(() => null);
    this.waiting = [];
    this.rev++;
  }

  setRace(mode: RaceMode) {
    this.cfg = { ...this.cfg, race: mode };
    if (this.game?.pending) this.game.skip();
    this.raceT = 0;
    this.raceAsked = !!this.game?.done;
    this.rev++;
  }

  /** Traffic presets for the playground. */
  setPattern(p: Pattern) {
    this.cfg = { ...this.cfg, clients: patternClients(p) };
    this.syncClients();
    this.syncBoxes(false);
    this.markers.push({ t: this.lt, label: p === 'abusive' ? 'scraper joins' : `${p} traffic` });
    this.rev++;
  }

  startScraper() {
    const c = this.clients.get('bot');
    if (!c) return;
    c.cfg = { ...c.cfg, traffic: 'flood', rate: c.cfg.rate ?? 5 };
    c.next = this.lt;
    this.note('bot', 'starts scraping', SIG.heavy);
    this.rev++;
  }

  stopScraper() {
    const c = this.clients.get('bot');
    if (!c) return;
    c.cfg = { ...c.cfg, traffic: 'off' };
    this.note('bot', 'stops', SIG.text2);
    this.rev++;
  }

  get scraperRunning() {
    return this.clients.get('bot')?.cfg.traffic === 'flood';
  }

  /** A floating label next to a box: above it, or below it on phones where the HUD sits above. */
  note(id: string, text: string, color: string) {
    const b = this.boxes.get(id);
    if (this.orient === 'landscape' || !b) this.say(id, text, color);
    else this.fx({ kind: 'text', at: { id, dy: b.h / 2 + 30 }, text, color, dur: 1.4 });
  }

  /** Fire n requests from one client right now (a tight burst). */
  burst(client: string, n: number) {
    const c = this.clients.get(client);
    if (!c) return;
    this.fireBurst(c, n, 0.06);
    this.rev++;
  }

  /* ---------------- world management ---------------- */

  private resetWorld() {
    this.clearTransient();
    this.origin = this.t - this.cfg.clockStart;
    this.stripStart = this.cfg.clockStart;
    this.lastNote = null;
    this.keys.clear();
    this.gwKeys.clear();
    this.clients.clear();
    this.jobs = Array.from({ length: this.cfg.workers }, () => null);
    this.waiting = [];
    this.served = 0;
    this.errors = 0;
    this.events = [];
    this.outs = [];
    this.markers = [];
    this.best = { count: 0, start: 0 };
    this.bestEver = 0;
    this.accepted = 0;
    this.rejected = 0;
    this.maxWait = 0;
    this.last = null;
    this.notes.clear();
    this.held.clear();
    this.rr = 0;
    this.redisOps = 0;
    this.raceT = 0;
    this.raceRuns = 0;
    this.storms = [];
    this.nextStorm = 0.8;
    this.predictIdx = 0;
    this.askedDenyWin = -1;
    this.jitterRng = mulberry32(7);
    this.rng = mulberry32(42);
    this.syncClients();
  }

  private syncClients() {
    const want: ClientCfg[] =
      this.cfg.scene === 'storm' ? Array.from({ length: this.cfg.devices }, (_, i) => ({ id: `d${i + 1}`, traffic: 'off' as Traffic })) : this.cfg.clients;
    const ids = new Set(want.map((c) => c.id));
    for (const id of [...this.clients.keys()]) if (!ids.has(id)) this.clients.delete(id);
    for (const cc of want) {
      const cur = this.clients.get(cc.id);
      if (cur) {
        const changed = cur.cfg.traffic !== cc.traffic || cur.cfg.rate !== cc.rate || cur.cfg.burst !== cc.burst;
        cur.cfg = { ...cc };
        if (changed) {
          cur.next = this.lt + 0.3 + this.rng() * 0.6;
          cur.plan = [];
        }
        continue;
      }
      this.clients.set(cc.id, {
        ...personOf(cc.id),
        id: cc.id,
        cfg: { ...cc },
        next: this.lt + (cc.delay ?? 0.25 + this.rng() * 0.5),
        plan: [],
        sent: 0,
        ok: 0,
        limited: 0,
        failed: 0,
        pulseVt: -10,
        pulseColor: SIG.res,
        waiting: false,
        attempt: 0,
      });
    }
    // Keep the insertion order equal to the config order (drawing order).
    const ordered = new Map<string, ClientState>();
    for (const cc of want) ordered.set(cc.id, this.clients.get(cc.id)!);
    this.clients = ordered;
    if (this.jobs.length !== this.cfg.workers) this.jobs = Array.from({ length: this.cfg.workers }, (_, i) => this.jobs[i] ?? null);
  }

  /** Create or hide boxes to match the scene. */
  private syncBoxes(sceneChanged: boolean) {
    const want = new Set<string>();
    const sc = this.cfg.scene;
    if (sc !== 'race') {
      for (const id of this.clients.keys()) want.add(id);
      want.add('server');
    }
    if ((sc === 'flow' || sc === 'storm') && this.cfg.algo !== 'none') {
      want.add('limiter');
      if (this.cfg.algo === 'leaky') want.add('hole');
    }
    if (sc === 'dist') {
      want.add('lb');
      for (const g of GATEWAYS) want.add(g);
      if (this.cfg.store === 'redis') want.add('redis');
    }
    for (const id of [...this.boxes.keys()]) if (!want.has(id)) this.hide(id);
    for (const id of want) this.box(id);
    this.relayout();
    if (sceneChanged) {
      // Boxes that are new to this scene appear in place rather than flying in.
      for (const id of want) {
        const b = this.boxes.get(id);
        if (b && b.alpha < 0.05) {
          b.x = b.tx;
          b.y = b.ty;
        }
      }
    }
  }

  private allStates(): KeyState[] {
    const out = [...this.keys.values()];
    for (const m of this.gwKeys.values()) out.push(...m.values());
    return out;
  }

  private resetLimiter(label: string) {
    // Anything waiting in a leaky bucket goes on to the server so nothing is lost.
    for (const s of this.keys.values()) for (const q of s.queue) this.forwardQueued(q.id, q.client);
    this.keys.clear();
    this.gwKeys.clear();
    this.markers.push({ t: this.lt, label });
    this.best = { count: 0, start: 0 };
    this.syncBoxes(false);
    this.rev++;
  }

  /* ---------------- layout ---------------- */

  /** Place a box only if it exists (never resurrect hidden ones by accident). */
  private put(id: string, x: number, y: number, w: number, h: number) {
    if (this.boxes.has(id)) this.place(id, x, y, w, h);
  }

  protected layout() {
    const sc = this.cfg.scene;
    this.strip = null;
    if (sc === 'race') return;
    if (sc === 'dist') this.layoutDist();
    else this.layoutFlow();
  }

  private layoutFlow() {
    const { w, h } = this;
    const L = this.orient === 'landscape';
    const stripOn = this.cfg.strip !== 'off';
    const ids = [...this.clients.keys()];
    const n = ids.length;
    const storm = this.cfg.scene === 'storm';
    const hasLimiter = this.cfg.algo !== 'none';
    const lim = this.limiterSize();
    const sh = this.serverHeight();

    if (L) {
      const pad = this.compact ? 20 : 30;
      const top = 84;
      const flowBottom = stripOn ? h - 268 : h - 120;
      const mid = (top + flowBottom) / 2;
      if (stripOn) this.strip = { x: 34, y: h - 104 - 140, w: w - 68, h: 140 };

      const cw = storm ? 112 : 148;
      const ch = storm ? 30 : 42;
      const spacing = storm ? Math.min(44, (flowBottom - top) / Math.max(1, n)) : Math.min(104, (flowBottom - top + 30) / Math.max(1, n));
      ids.forEach((id, i) => this.put(id, pad + cw / 2, mid + (i - (n - 1) / 2) * spacing, cw, ch));

      const sw = 164;
      const sx = w - pad - sw / 2;
      // With the header inspector on, leave room for it between client and limiter.
      const lx = this.cfg.inspect ? sx - sw / 2 - 64 - lim.w / 2 : Math.min(w * 0.47, sx - sw / 2 - 150 - lim.w / 2);
      this.put('limiter', lx, mid, lim.w, lim.h);
      this.put('server', sx, mid, sw, sh);
      this.put('hole', lx - lim.w / 2 + this.holeX(lim.w, lim.h), mid + lim.h / 2, 2, 2);
    } else {
      const top = 72;
      const ch = storm ? 32 : 36;
      const gap = storm ? 5 : 8;
      const cw = Math.min(storm ? 60 : 116, (w - 20 - (n - 1) * gap) / Math.max(1, n));
      const cy = top + ch / 2;
      ids.forEach((id, i) => this.put(id, w / 2 + (i - (n - 1) / 2) * (cw + gap), cy, cw, ch));
      const clientsBottom = cy + ch / 2 + (storm ? 4 : 16);

      let serverY: number;
      if (stripOn && !this.cfg.inspect) {
        const sy = h - 62 - 12 - 92;
        this.strip = { x: 10, y: sy, w: w - 20, h: 92 };
        serverY = sy - 16 - sh / 2;
      } else {
        serverY = h - (this.cfg.inspect ? 178 : 150) - sh / 2;
      }
      const limY = (clientsBottom + serverY - sh / 2) / 2;
      this.put('limiter', w / 2, hasLimiter ? limY : serverY, lim.w, lim.h);
      this.put('server', w / 2, serverY, 150, sh);
      this.put('hole', w / 2 - lim.w / 2 + this.holeX(lim.w, lim.h), limY + lim.h / 2, 2, 2);
    }
  }

  private layoutDist() {
    const { w, h } = this;
    const L = this.orient === 'landscape';
    const ids = [...this.clients.keys()];
    const n = ids.length;
    const redis = this.cfg.store === 'redis';
    const sh = this.serverHeight();
    if (L) {
      const top = 84;
      const bottom = h - 120;
      const mid = (top + bottom) / 2;
      ids.forEach((id, i) => this.put(id, 30 + 74, mid + (i - (n - 1) / 2) * 100, 148, 42));
      this.put('lb', w * 0.29, mid, 150, 52);
      const gx = w * 0.53;
      GATEWAYS.forEach((g, i) => this.put(g, gx, mid + (i - 1) * 124, 184, 92));
      const sx = w - 30 - 82;
      this.put('server', sx, redis ? mid - 120 : mid, 164, sh);
      this.put('redis', sx, mid + 116, 164, 124);
    } else {
      const cy = 90;
      ids.forEach((id, i) => this.put(id, w / 2 + (i - (n - 1) / 2) * 124, cy, 116, 36));
      this.put('lb', w / 2, 158, 150, 36);
      const gw = (w - 20 - 12) / 3;
      GATEWAYS.forEach((g, i) => this.put(g, w / 2 + (i - 1) * (gw + 6), 236, gw, 70));
      const rowY = Math.min(h - 170 - 44, 346);
      this.put('server', redis ? w * 0.27 : w / 2, rowY, 150, sh);
      this.put('redis', w * 0.74, rowY, 150, 76);
    }
  }

  limiterSize() {
    return limiterCard(this.orient === 'landscape', this.cfg.algo, this.keyOrder().length, this.cfg.capacity, this.w);
  }

  /** x of the leak hole inside the limiter card. */
  holeX(cardW: number, cardH: number) {
    if (this.keyOrder().length > 1) return cardW / 2;
    return singleBucket(this.orient === 'landscape', this.cfg.capacity, cardH).cx;
  }

  serverHeight() {
    const unit = this.orient === 'landscape' ? 14 : 12;
    return 22 + this.cfg.workers * unit + 4;
  }

  protected wires(): WireSpec[] {
    const sc = this.cfg.scene;
    const out: WireSpec[] = [];
    if (sc === 'race') return out;
    if (sc === 'dist') {
      for (const id of this.clients.keys()) out.push({ from: id, to: 'lb' });
      for (const g of GATEWAYS) {
        out.push({ from: 'lb', to: g });
        out.push({ from: g, to: 'server' });
        if (this.cfg.store === 'redis') out.push({ from: g, to: 'redis', state: 'control' });
      }
      return out;
    }
    const hub = this.cfg.algo === 'none' ? 'server' : 'limiter';
    for (const id of this.clients.keys()) out.push({ from: id, to: hub });
    if (hub === 'limiter') out.push({ from: this.cfg.algo === 'leaky' ? 'hole' : 'limiter', to: 'server' });
    return out;
  }

  protected curveFor(from: string, to: string, lane: number): Curve | null {
    const a = this.boxes.get(from);
    const b = this.boxes.get(to);
    if (!a || !b || Number.isNaN(a.x) || Number.isNaN(b.x)) return null;
    // Leaky bucket: requests drip out of the hole, then flow to the server.
    if (from === 'hole' && to === 'server') {
      if (this.orient === 'landscape') {
        const p3 = { x: b.x - b.w / 2, y: b.y };
        return { p0: { x: a.x, y: a.y }, p1: { x: a.x, y: a.y + 60 }, p2: { x: p3.x - 110, y: p3.y }, p3 };
      }
      const p3 = { x: b.x, y: b.y - b.h / 2 };
      return { p0: { x: a.x, y: a.y }, p1: { x: a.x, y: a.y + 14 }, p2: { x: p3.x, y: p3.y - 14 }, p3 };
    }
    // Distributed, landscape: gateways reach Redis (below the server) from their right side.
    if (this.cfg.scene === 'dist' && (to === 'redis' || from === 'redis') && this.orient === 'landscape') {
      const g = to === 'redis' ? a : b;
      const r = to === 'redis' ? b : a;
      const off = to === 'redis' ? lane : -lane;
      const p0 = { x: g.x + g.w / 2, y: g.y + 22 + off };
      const p3 = { x: r.x - r.w / 2, y: r.y + 10 + off };
      const k = Math.max(40, (p3.x - p0.x) * 0.55);
      const c = { p0, p1: { x: p0.x + k, y: p0.y }, p2: { x: p3.x - k, y: p3.y }, p3 };
      return to === 'redis' ? c : { p0: c.p3, p1: c.p2, p2: c.p1, p3: c.p0 };
    }
    return portCurve(a, b, lane);
  }

  /* ---------------- simulation ---------------- */

  protected step(dt: number) {
    const lt = this.lt;
    const sc = this.cfg.scene;
    if (sc === 'race') {
      this.stepRace(dt);
      return;
    }

    if (sc === 'storm') this.stepStorm(lt);
    else for (const c of this.clients.values()) this.stepClient(c, lt);

    // Keep every limiter state current so the stage shows the true state.
    const algo = this.cfg.algo;
    if (algo !== 'none') {
      const p = this.params;
      for (const s of this.keys.values()) {
        settle(s, lt, p, sc === 'dist' ? 'fixed' : algo);
        if (algo === 'leaky') {
          for (const { req: q } of leak(s, lt, p)) {
            this.maxWait = Math.max(this.maxWait, lt - q.at);
            s.takeAt = lt;
            this.forwardQueued(q.id, q.client);
            this.rev++;
          }
        }
      }
      for (const m of this.gwKeys.values()) for (const s of m.values()) settle(s, lt, p, 'fixed');
    }

    // Server workers
    for (let i = 0; i < this.jobs.length; i++) {
      const j = this.jobs[i];
      if (j && this.t >= j.end) {
        this.jobs[i] = null;
        this.served++;
        this.respond(j.req, j.via, 200);
        this.pullWork();
      }
    }

    // Keep history bounded
    const keepFrom = lt - 60;
    if (this.events.length > 500 || (this.events.length && this.events[0].t < keepFrom)) this.events = this.events.filter((e) => e.t >= keepFrom).slice(-500);
    if (this.outs.length > 400 || (this.outs.length && this.outs[0] < keepFrom)) this.outs = this.outs.filter((t) => t >= keepFrom).slice(-400);
    if (this.markers.length && this.markers[0].t < keepFrom) this.markers = this.markers.filter((m) => m.t >= keepFrom);
  }

  private stepClient(c: ClientState, lt: number) {
    const cc = c.cfg;
    switch (cc.traffic) {
      case 'steady':
      case 'flood': {
        const rate = cc.rate ?? 1;
        if (lt >= c.next) {
          this.emit(c);
          const jitter = cc.traffic === 'flood' ? 0.55 + this.rng() * 0.9 : 0.8 + this.rng() * 0.4;
          c.next = Math.max(c.next, lt - 0.5) + jitter / rate;
        }
        break;
      }
      case 'bursty': {
        if (lt >= c.next) {
          this.fireBurst(c, cc.burst ?? 4);
          c.next = lt + (cc.every ?? 5) * (0.88 + this.rng() * 0.24);
        }
        break;
      }
      case 'boundary': {
        // Two bursts of `limit` requests around every other window edge:
        // one lands just before the edge, the other just after it.
        if (!c.plan.length) {
          const W = this.cfg.window;
          let k = 0;
          while ((2 * k + 1) * W - 1.4 - this.cfg.hop < lt + 0.4) k++;
          const edge = (2 * k + 1) * W;
          c.plan = [edge - 1.4 - this.cfg.hop, edge + 0.25 - this.cfg.hop];
        }
        if (lt >= c.plan[0]) {
          c.plan.shift();
          this.fireBurst(c, this.cfg.limit);
        }
        break;
      }
      case 'bursts': {
        const i = this.predictIdx;
        const [at0, size] = PREDICT_BURSTS[i % PREDICT_BURSTS.length];
        const at = at0 + Math.floor(i / PREDICT_BURSTS.length) * PREDICT_LOOP;
        if (lt >= at) {
          this.fireBurst(c, size);
          this.predictIdx++;
        }
        break;
      }
      default:
        break;
    }
  }

  private fireBurst(c: ClientState, n: number, stagger = STAGGER) {
    const id = this.burstSeq++;
    for (let i = 0; i < n; i++) this.after(i * stagger, () => this.emit(c, { burst: id, first: i === 0 }));
  }

  private emit(c: ClientState, opts: { burst?: number; first?: boolean; attempt?: number } = {}) {
    if (!this.clients.has(c.id)) return;
    const req: Req = { id: this.seq++, client: c.id, attempt: opts.attempt ?? 0, burst: opts.burst, first: opts.first };
    c.sent++;
    const color = this.reqColor(c.id);
    if (this.cfg.scene === 'dist') {
      this.send({ from: c.id, to: 'lb', dur: 0.6, color, tag: `q${req.id}`, onArrive: () => this.atLB(req) });
    } else if (this.cfg.algo === 'none') {
      this.send({ from: c.id, to: 'server', dur: 1.1, color, tag: `q${req.id}`, onArrive: () => this.atServer(req, c.id) });
    } else {
      this.send({ from: c.id, to: 'limiter', dur: this.cfg.hop, color, tag: req.burst != null ? `b${req.burst}` : `q${req.id}`, onArrive: () => this.atLimiter(req) });
    }
    this.rev++;
  }

  /* ---------------- the limiter ---------------- */

  private keyFor(req: Req) {
    return this.cfg.key === 'global' ? '*' : req.client;
  }

  private atLimiter(req: Req) {
    const algo = this.cfg.algo;
    if (algo === 'none') return;
    const s = this.stateOf(this.keyFor(req));
    const p = this.params;
    const lt = this.lt;
    settle(s, lt, p, algo);

    const g = this.game;
    if (g && !g.done && !g.pending) {
      if (this.cfg.predict === 'fixed' && algo === 'fixed') {
        // Ask about the interesting moments only: the last free slot, the first
        // request over the limit, and the first request after a full window resets.
        const into = lt - s.win * p.window;
        const lastSlot = s.count === p.limit - 1;
        const firstOver = s.count >= p.limit && this.askedDenyWin !== s.win;
        const fresh = s.count === 0 && s.prev >= p.limit && into < 4;
        if (lastSlot || firstOver || fresh) {
          if (firstOver) this.askedDenyWin = s.win;
          const ok = s.count < p.limit;
          const count = s.count;
          const resetIn = (s.win + 1) * p.window - lt;
          const start = fmtClock(s.win * p.window);
          g.ask({
            acceptable: [ok ? 'allow' : 'deny'],
            choices: [
              { id: 'allow', label: 'Allowed' },
              { id: 'deny', label: '429 Too Many Requests' },
            ],
            ask: 'Allowed, or 429?',
            askAt: { id: 'limiter' },
            explain: () =>
              count === 0
                ? `A new window started at ${start}, so the count is back to 0. This is request 1 of ${p.limit}: allowed.`
                : ok
                  ? `The count was ${count} of ${p.limit}, so there was room for one more. Allowed, and the count is now ${count + 1}/${p.limit}.`
                  : `The count is already ${count} of ${p.limit}, and this window runs for another ${resetIn.toFixed(1)} s. Everything until the reset gets a 429.`,
            resolve: () => this.decideAndAct(req, 'limiter', s),
          });
          return;
        }
      }
      if (this.cfg.predict === 'bucket' && algo === 'token' && req.first && req.burst != null) {
        const tag = `b${req.burst}`;
        const arrivals = [lt, ...this.flights.filter((f) => f.tag === tag).map((f) => lt + (f.t0 + f.dur - this.t))].sort((a, b) => a - b);
        const size = arrivals.length;
        const n = countAllowed(s, arrivals, p, 'token');
        const tokens = s.tokens;
        g.ask({
          acceptable: [String(n)],
          choices: Array.from({ length: size + 1 }, (_, i) => ({ id: String(i), label: String(i) })),
          ask: `A burst of ${size}: how many get a token?`,
          askAt: { id: 'limiter' },
          explain: () => {
            const whole = Math.floor(tokens + 1e-9);
            if (n >= size) return `The bucket held ${tokens.toFixed(1)} tokens, enough for all ${size}. Every request took one.`;
            const extra = n - whole;
            return `The bucket held ${tokens.toFixed(1)} tokens, so ${whole} whole ${whole === 1 ? 'token' : 'tokens'}${extra > 0 ? ', and one more dripped in while the burst was arriving' : ''}. ${n} got through; the other ${size - n} got a 429.`;
          },
          resolve: () => this.decideAndAct(req, 'limiter', s),
        });
        return;
      }
    }
    this.decideAndAct(req, 'limiter', s);
  }

  private decideAndAct(req: Req, node: string, s: KeyState) {
    const algo = this.cfg.algo;
    if (algo === 'none') return;
    const d = decide(s, this.lt, this.params, algo);
    this.record(req, d, node);
    if (d.ok) {
      if (d.queued) {
        s.queue.push({ id: req.id, client: req.client, at: this.lt });
        this.held.set(req.id, req);
      } else this.forward(req, node);
    } else this.reject(req, node, d);
  }

  private record(req: Req, d: Decision, node: string) {
    this.events.push({ t: this.lt, ok: d.ok, client: req.client });
    if (d.ok) this.accepted++;
    else this.rejected++;
    if (d.ok && this.cfg.span) {
      const times: number[] = [];
      for (const e of this.events) if (e.ok) times.push(e.t);
      this.best = busiestSpan(times, this.cfg.window);
      this.bestEver = Math.max(this.bestEver, this.best.count);
    }
    this.last = { d, client: req.client, node, vt: this.vt };
    this.trace?.push({ d, client: req.client, node });
    if (this.cfg.scene === 'storm') {
      const st = this.storms[this.storms.length - 1];
      if (st) {
        st.attempts++;
        if (!d.ok) st.rejected++;
      }
    }
    this.rev++;
  }

  private forwardQueued(id: number, client: string) {
    const req = this.held.get(id) ?? { id, client, attempt: 0 };
    this.held.delete(id);
    this.outs.push(this.lt);
    const from = this.boxes.has('hole') && this.cfg.algo === 'leaky' ? 'hole' : 'limiter';
    this.send({ from, to: 'server', dur: from === 'hole' ? 0.8 : 0.5, color: this.reqColor(client), tag: `q${id}`, onArrive: () => this.atServer(req, 'limiter') });
  }

  private forward(req: Req, node: string) {
    this.outs.push(this.lt);
    const from = node === 'limiter' && this.cfg.algo === 'leaky' && this.boxes.has('hole') ? 'hole' : node;
    this.send({ from, to: 'server', dur: from === 'hole' ? 0.8 : 0.5, color: this.reqColor(req.client), tag: `q${req.id}`, onArrive: () => this.atServer(req, node) });
  }

  private reject(req: Req, node: string, d: Decision) {
    const color = SIG.err;
    const label = this.t - this.last429Label > 0.45 ? '429' : undefined;
    if (label) this.last429Label = this.t;
    const f =
      this.cfg.scene === 'dist'
        ? this.send({
            from: node,
            to: 'lb',
            dur: 0.45,
            color,
            label,
            r: 4,
            onArrive: () => this.send({ from: 'lb', to: req.client, dur: 0.6, color, label, r: 4, onArrive: () => this.gotResponse(req, 429) }),
          })
        : this.send({ from: node, to: req.client, dur: 0.7, color, label, r: 4, onArrive: () => this.gotResponse(req, 429) });
    if (this.cfg.inspect) {
      const n = headers(429, d.limit, 0, d.resetIn, d.retryAfter);
      this.notes.set(f.id, n);
      this.lastNote = n;
    }
    const b = this.boxes.get(node);
    if (b) this.fx({ kind: 'x', at: { id: node, dx: this.orient === 'landscape' || this.cfg.scene === 'dist' ? -b.w / 2 - 9 : 0, dy: this.orient === 'landscape' || this.cfg.scene === 'dist' ? 0 : -b.h / 2 - 9 }, color: SIG.err, dur: 0.6 });
  }

  /* ---------------- distributed scene ---------------- */

  private atLB(req: Req) {
    const gw = GATEWAYS[this.rr++ % GATEWAYS.length];
    this.send({ from: 'lb', to: gw, dur: 0.45, color: this.reqColor(req.client), tag: `q${req.id}`, onArrive: () => this.atGateway(req, gw) });
  }

  private atGateway(req: Req, gw: string) {
    const key = this.keyFor(req);
    if (this.cfg.store === 'redis') {
      this.redisOps++;
      this.send({
        from: gw,
        to: 'redis',
        dur: 0.3,
        color: SIG.hc,
        r: 3.2,
        trail: false,
        lane: 4,
        onArrive: () => {
          const s = this.stateOf(key);
          const d = decide(s, this.lt, this.params, 'fixed');
          this.rev++;
          this.send({ from: 'redis', to: gw, dur: 0.3, color: SIG.hc, r: 3.2, trail: false, lane: 4, onArrive: () => this.gwAct(req, gw, d) });
        },
      });
      return;
    }
    const d = decide(this.gwStateOf(gw, key), this.lt, this.params, 'fixed');
    this.gwAct(req, gw, d);
  }

  private gwAct(req: Req, gw: string, d: Decision) {
    this.record(req, d, gw);
    if (d.ok) this.forward(req, gw);
    else this.reject(req, gw, d);
  }

  /* ---------------- the API server ---------------- */

  private atServer(req: Req, via: string) {
    const color = this.reqColor(req.client);
    const free = this.jobs.findIndex((j) => j === null);
    if (free >= 0) this.startJob(free, req, via, color);
    else if (this.waiting.length < this.cfg.queueCap) this.waiting.push({ req, via, color });
    else {
      this.errors++;
      this.respond(req, via, 503);
    }
    this.rev++;
  }

  private startJob(i: number, req: Req, via: string, color: string) {
    const dur = this.cfg.service * (0.8 + this.rng() * 0.4);
    this.jobs[i] = { req, via, start: this.t, end: this.t + dur, color };
  }

  private pullWork() {
    while (this.waiting.length) {
      const free = this.jobs.findIndex((j) => j === null);
      if (free < 0) return;
      const w = this.waiting.shift()!;
      this.startJob(free, w.req, w.via, w.color);
    }
  }

  private respond(req: Req, via: string, status: 200 | 503) {
    const color = status === 200 ? SIG.res : SIG.err;
    const label = status === 503 ? '503' : undefined;
    const done = () => this.gotResponse(req, status);
    if (!this.clients.has(req.client)) return;
    if (via === req.client || !this.boxes.has(via)) {
      this.send({ from: 'server', to: req.client, dur: 1.0, color, label, r: 4, onArrive: done });
      return;
    }
    if (this.cfg.scene === 'dist') {
      this.send({
        from: 'server',
        to: via,
        dur: 0.45,
        color,
        r: 4,
        onArrive: () => this.send({ from: via, to: 'lb', dur: 0.45, color, r: 4, onArrive: () => this.send({ from: 'lb', to: req.client, dur: 0.6, color, label, r: 4, onArrive: done }) }),
      });
      return;
    }
    this.send({
      from: 'server',
      to: 'limiter',
      dur: 0.5,
      color,
      r: 4,
      onArrive: () => {
        const f = this.send({ from: 'limiter', to: req.client, dur: 0.7, color, label, r: 4, onArrive: done });
        const algo = this.cfg.algo;
        if (this.cfg.inspect && status === 200 && algo !== 'none') {
          const s = this.stateOf(this.keyFor(req));
          settle(s, this.lt, this.params, algo);
          const p = this.params;
          const remaining = algo === 'token' ? Math.floor(s.tokens + 1e-9) : Math.max(0, p.limit - s.count);
          const n = headers(200, algo === 'token' ? p.capacity : p.limit, remaining, (s.win + 1) * p.window - this.lt, 0);
          this.notes.set(f.id, n);
          this.lastNote = n;
        }
      },
    });
  }

  private gotResponse(req: Req, status: 200 | 429 | 503) {
    const c = this.clients.get(req.client);
    if (!c) return;
    if (status === 200) c.ok++;
    else if (status === 429) c.limited++;
    else c.failed++;
    c.pulseVt = this.vt;
    c.pulseColor = status === 200 ? SIG.res : SIG.err;
    if (this.cfg.scene === 'storm') this.stormResponse(c, req, status);
    this.rev++;
  }

  /* ---------------- retry storm ---------------- */

  private stepStorm(lt: number) {
    // The next reconnect comes a few seconds after everyone from the last one got through.
    const cur = this.storms[this.storms.length - 1];
    if (cur && cur.doneAt != null) this.nextStorm = Math.min(this.nextStorm, Math.max(cur.start + 18, cur.doneAt + 4));
    if (lt < this.nextStorm) return;
    const st: Storm = { id: (this.storms[this.storms.length - 1]?.id ?? 0) + 1, start: lt, attempts: 0, rejected: 0, left: this.clients.size, doneAt: null };
    this.storms.push(st);
    if (this.storms.length > 6) this.storms.shift();
    this.markers.push({ t: lt, label: 'all reconnect' });
    [...this.clients.values()].forEach((c, i) => {
      c.waiting = true;
      c.attempt = 0;
      this.after(i * 0.03, () => this.emit(c, { attempt: 0 }));
    });
    this.nextStorm = lt + 40;
    this.rev++;
  }

  private stormResponse(c: ClientState, req: Req, status: 200 | 429 | 503) {
    const st = this.storms[this.storms.length - 1];
    if (status === 200) {
      c.waiting = false;
      if (st) {
        st.left = Math.max(0, st.left - 1);
        if (st.left === 0 && st.doneAt == null) st.doneAt = this.lt;
      }
      return;
    }
    const attempt = req.attempt + 1;
    c.attempt = attempt;
    const cap = Math.min(4, 2 ** (attempt - 1));
    const wait = this.cfg.retry === 'immediate' ? 0.1 : this.cfg.retry === 'backoff' ? cap : this.jitterRng() * cap;
    this.after(wait, () => this.emit(c, { attempt }));
  }

  /* ---------------- race diagram ---------------- */

  static RACE_LEN = 5.4;

  private stepRace(dt: number) {
    this.raceT += dt;
    if (this.cfg.race === 'getset' && !this.raceAsked && this.raceT >= 2.5 && this.game && !this.game.done) {
      this.raceAsked = true;
      this.game.ask({
        acceptable: ['both'],
        choices: [
          { id: 'one', label: 'Just one' },
          { id: 'both', label: 'Both' },
        ],
        ask: 'Both read 4. How many get through?',
        explain: (picked) =>
          picked === 'both'
            ? 'Each gateway saw 4, checked 4 < 5 and said yes. Then both wrote 5. Six requests got through a limit of 5, and the counter says 5.'
            : "Each gateway only knows what it read: 4. Both check 4 < 5 and allow. Neither sees the other's request, so both get through: six in total, while the counter says 5.",
      });
    }
    if (this.raceT > RateSim.RACE_LEN + 3) {
      this.raceT = 0;
      this.raceRuns++;
      // "Practice again" restarts the game: ask again on the next run.
      this.raceAsked = !!this.game?.done;
    }
  }
}

export function patternClients(p: Pattern): ClientCfg[] {
  if (p === 'steady')
    return [
      { id: 'alice', traffic: 'steady', rate: 0.45 },
      { id: 'bob', traffic: 'steady', rate: 0.3 },
    ];
  if (p === 'bursty')
    return [
      { id: 'alice', traffic: 'bursty', burst: 8, every: 12 },
      { id: 'bob', traffic: 'steady', rate: 0.3 },
    ];
  return [
    { id: 'alice', traffic: 'steady', rate: 0.35 },
    { id: 'bob', traffic: 'steady', rate: 0.3 },
    { id: 'bot', traffic: 'flood', rate: 4 },
  ];
}

/** Response headers a limiter would attach (drawn in the inspector card). */
export function headers(status: 200 | 429, limit: number, remaining: number, resetIn: number, retryAfter: number): FlightNote {
  const reset = Math.max(1, Math.ceil(resetIn - 1e-6));
  if (status === 429) {
    return {
      head: 'response · rejected',
      tone: 'err',
      lines: ['HTTP/1.1 429 Too Many Requests', `Retry-After: ${Math.max(1, Math.ceil(retryAfter - 1e-6))}`, `RateLimit-Limit: ${limit}`, 'RateLimit-Remaining: 0', `RateLimit-Reset: ${reset}`],
    };
  }
  return {
    head: 'response · allowed',
    tone: 'res',
    lines: ['HTTP/1.1 200 OK', `RateLimit-Limit: ${limit}`, `RateLimit-Remaining: ${remaining}`, `RateLimit-Reset: ${reset}`],
  };
}
