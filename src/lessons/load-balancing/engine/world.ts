import { decide, explain, type Decision } from './algorithms';
import {
  API_PATHS,
  C,
  DEFAULT_CONFIG,
  GATEWAY_TIMEOUT,
  HB,
  HC,
  HEAVY_PATHS,
  HOP,
  LIGHT_PATHS,
  MEDIA_PATHS,
  MS_PER_S,
  RETRY,
  SIZE_WEIGHT,
  SIZE_WORKERS,
  VIP,
  WORK,
  serverIp,
  serverLabel,
} from './constants';
import type { Box, Client, HealthState, Job, LB, RedisNode, Server } from './entities';
import { bezier, clamp, curveBetween, curvePath, damp, lerp, type Curve, type Pt } from '@/lib/sim/geometry';
import { layoutWorld } from './layout';
import { mulberry32 } from '@/lib/sim/rng';
import type { ClientSpec, LBId, Orient, Pool, ScriptEvent, ServerSpec, WorldConfig } from './types';

/* ------------------------------------------------------------------ */
/* Internal state types                                                */
/* ------------------------------------------------------------------ */

export interface Req {
  id: number;
  clientId: string;
  heavy: boolean;
  path: string;
  pool: Pool;
  t0: number;
  lb: LBId | null;
  server: string | null;
  tour: boolean;
  done: boolean;
  forceServer?: string;
  /** Servers that refused this request (NGINX tries each one once) */
  tried?: string[];
  /** Connection attempts that failed on req.server (HAProxy retries) */
  fails?: number;
}

type PacketKind = 'req' | 'res' | 'hc' | 'hcack' | 'hb' | 'sess';

interface Probe {
  acked: boolean;
}

interface Packet {
  id: number;
  kind: PacketKind;
  reqId: number;
  from: string;
  to: string;
  t0: number;
  dur: number;
  status: number;
  warn: boolean;
  color: string;
  r: number;
  sealed: boolean;
  heavy: boolean;
  hold: boolean;
  held: boolean;
  probe?: Probe;
}

type Anchor = { key: string; dx?: number; dy?: number } | { x: number; y: number };

interface Effect {
  kind: 'ring' | 'text' | 'x';
  at: Anchor;
  color: string;
  text?: string;
  vt: number;
  dur: number;
  size?: number;
}

interface Timer {
  at: number;
  fn: () => void;
}

/** Events recorded when `world.trace` is set (headless checks in verify/). */
export type TraceEvent =
  | { t: number; kind: 'route'; req: number; server: string; client: string; heavy: boolean; path: string }
  | { t: number; kind: 'done'; req: number; server: string | null; status: number }
  | { t: number; kind: 'health'; server: string; inRot: boolean }
  | { t: number; kind: 'refused'; req: number; server: string }
  | { t: number; kind: 'crash' | 'revive'; server: string };

export type TourStage = 'toLb' | 'atLb' | 'toServer' | 'atServer' | 'processing' | 'toLbBack' | 'toClient' | 'done';

export interface Tour {
  reqId: number;
  stage: TourStage;
  lat: number | null;
  holdLb: boolean;
  holdServer: boolean;
}

export interface Predict {
  needed: number;
  correct: number;
  attempts: number;
  pending: { reqId: number; lbId: LBId; decision: Decision; clientId: string } | null;
  last: { ok: boolean; picked: string; chosen: string; text: string; vt: number } | null;
  /** While predicting, requests arrive one at a time: the next one leaves its client at this time */
  nextSpawnAt: number;
  done: boolean;
}

interface WireState {
  d: string;
  alpha: number;
  target: number;
  kind: 'req' | 'hb' | 'redis';
  state: 'normal' | 'down' | 'out' | 'standby';
  flashVt: number;
  mid: Pt;
}

/* ------------------------------------------------------------------ */
/* View model: a plain snapshot the renderer draws each frame          */
/* ------------------------------------------------------------------ */

export interface ClientView {
  id: string;
  name: string;
  ip: string;
  color: string;
  x: number;
  y: number;
  w: number;
  h: number;
  alpha: number;
  pulse: { color: string; k: number } | null;
  cart: 'home' | null;
}

export interface UnitView {
  busy: boolean;
  p: number;
  color: string;
}

export interface ServerView {
  id: string;
  label: string;
  ip: string;
  x: number;
  y: number;
  w: number;
  h: number;
  alpha: number;
  up: boolean;
  workers: number;
  weight: number;
  pool: Pool | null;
  units: UnitView[];
  queue: { x: number; y: number; color: string }[];
  capSlots: Pt[];
  overflow: number;
  inRot: boolean | null;
  tally: ('ok' | 'fail')[] | null;
  served: number;
  share: number;
  carts: string[];
  util: number;
  mark: { kind: 'ok' | 'bad' | 'answer'; k: number } | null;
  pickable: boolean;
}

export interface LBView {
  id: LBId;
  label: string;
  ip: string;
  x: number;
  y: number;
  w: number;
  h: number;
  alpha: number;
  up: boolean;
  active: boolean;
  pair: boolean;
  flash: number;
}

export interface PacketView {
  id: number;
  kind: PacketKind;
  x: number;
  y: number;
  tx: number;
  ty: number;
  color: string;
  r: number;
  sealed: boolean;
  heavy: boolean;
  status: number;
  warn: boolean;
}

export interface EffectView {
  kind: Effect['kind'];
  x: number;
  y: number;
  color: string;
  text?: string;
  k: number;
  size: number;
}

export interface WireView {
  key: string;
  d: string;
  alpha: number;
  kind: WireState['kind'];
  state: WireState['state'];
  flash: number;
  mid: Pt;
}

export interface BrainView {
  x: number;
  y: number;
  anchor: 'below' | 'strip';
  algo: WorldConfig['algorithm'];
  layer: WorldConfig['layer'];
  routeByPath: boolean;
  decision: Decision | null;
  age: number;
  pending: Decision | null;
  pendingClient: { name: string; ip: string; color: string } | null;
  hideNext: boolean;
  next: string | null;
  conns: { id: string; label: string; n: number }[];
  labels: Record<string, string>;
  pools: Record<string, string[]>;
}

export interface TourView {
  x: number;
  y: number;
  stage: TourStage;
  lat: number | null;
}

export interface HudView {
  throughput: number;
  p95: number | null;
  errRate: number;
  series: number[];
  drops: number;
  served: { id: string; label: string; n: number; share: number }[];
}

export interface View {
  w: number;
  h: number;
  orient: Orient;
  compact: boolean;
  unitCompact: boolean;
  boundary: number | null;
  showZones: boolean;
  wires: WireView[];
  clients: ClientView[];
  servers: ServerView[];
  lbs: LBView[];
  redis: (Box & { carts: string[] }) | null;
  packets: PacketView[];
  pending: { x: number; y: number; color: string } | null;
  effects: EffectView[];
  brain: BrainView | null;
  tour: TourView | null;
  hud: HudView;
  cfg: WorldConfig;
}

/* ------------------------------------------------------------------ */
/* Metrics                                                             */
/* ------------------------------------------------------------------ */

class Metrics {
  log: { t: number; lat: number; kind: 'ok' | 'warn' | 'err' }[] = [];
  served = new Map<string, number>();
  drops = 0;
  errors = 0;
  series: number[] = [];
  private sampleIn = 0;

  reset() {
    this.log = [];
    this.served.clear();
    this.drops = 0;
    this.errors = 0;
    this.series = [];
    this.sampleIn = 0;
  }

  push(t: number, lat: number, kind: 'ok' | 'warn' | 'err') {
    this.log.push({ t, lat, kind });
    if (kind === 'err') this.errors += 1;
    if (this.log.length > 800) this.log.splice(0, this.log.length - 500);
  }

  private since(t: number, span: number) {
    return this.log.filter((e) => e.t >= t - span);
  }

  throughput(t: number) {
    return this.since(t, 5).filter((e) => e.kind !== 'err').length / 5;
  }

  p95(t: number) {
    const lats = this.since(t, 8)
      .filter((e) => e.kind !== 'err')
      .map((e) => e.lat)
      .sort((a, b) => a - b);
    if (!lats.length) return null;
    return lats[Math.min(lats.length - 1, Math.floor(lats.length * 0.95))];
  }

  errRate(t: number) {
    const w = this.since(t, 8);
    if (!w.length) return 0;
    return w.filter((e) => e.kind === 'err').length / w.length;
  }

  sample(t: number, dt: number) {
    this.sampleIn -= dt;
    if (this.sampleIn > 0) return;
    this.sampleIn = 0.5;
    const lats = this.since(t, 3)
      .filter((e) => e.kind !== 'err')
      .map((e) => e.lat)
      .sort((a, b) => a - b);
    const v = lats.length ? lats[Math.floor(lats.length * 0.5)] : this.series.at(-1) ?? 0;
    this.series.push(v);
    if (this.series.length > 48) this.series.shift();
  }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const ck = (id: string) => `c:${id}`;
const sk = (id: string) => `s:${id}`;
const lk = (id: LBId) => `lb:${id}`;

function rankOf(key: string) {
  if (key.startsWith('c:')) return 0;
  if (key.startsWith('lb:')) return 1;
  if (key.startsWith('s:')) return 2;
  return 3;
}

function box(): Box {
  return { x: NaN, y: NaN, tx: 0, ty: 0, w: 0, h: 0, alpha: 0, talpha: 1, removing: false };
}

/* ------------------------------------------------------------------ */
/* World                                                               */
/* ------------------------------------------------------------------ */

export class World {
  cfg: WorldConfig = structuredClone(DEFAULT_CONFIG);
  /** Simulated time */
  t = 0;
  /** Visual (wall-clock) time, keeps running while paused */
  vt = 0;
  /** Simulated time since the current step began */
  stepT = 0;
  rng = mulberry32(42);

  w = 960;
  h = 600;
  orient: Orient = 'landscape';
  compact = false;
  unitCompact = false;
  boundary: number | null = null;
  sized = false;

  clients = new Map<string, Client>();
  servers = new Map<string, Server>();
  lbs = new Map<LBId, LB>();
  redis: RedisNode | null = null;

  reqs = new Map<number, Req>();
  metrics = new Metrics();
  predict: Predict | null = null;
  tour: Tour | null = null;
  /** Frozen while waiting for the learner to answer a prediction */
  frozen = false;
  /** Bumped whenever UI-facing state changes; panels poll it */
  rev = 0;
  /** Set to [] to record routing, responses and health changes (verify/ uses this). */
  trace: TraceEvent[] | null = null;

  private packets: Packet[] = [];
  private timers: Timer[] = [];
  private effects: Effect[] = [];
  private wires = new Map<string, WireState>();
  private script: ScriptEvent[] = [];
  private fired = new Set<number>();
  private ramp: { from: number; to: number; t0: number; dur: number } | null = null;
  private nextId = 1;
  private arrivalIn = 0.35;
  private reqCount = 0;
  private clientCursor = 0;
  private hcIn = 0.4;
  private hbIn = 0.3;
  private chaosIn = 7;
  private chaosVictim: string | null = null;

  constructor(cfg?: Partial<WorldConfig>) {
    if (cfg) this.enter({ ...DEFAULT_CONFIG, ...cfg }, { reset: true });
  }

  /* ---------------- configuration ---------------- */

  /** Start a lesson step: apply its full config and put machines back in their starting state. */
  enter(cfg: WorldConfig, opts: { reset?: boolean; script?: ScriptEvent[]; seed?: number } = {}) {
    if (opts.reset) this.reset(opts.seed);
    this.metrics.reset();
    this.predict = null;
    this.frozen = false;
    this.tour = null;
    this.ramp = null;
    this.script = opts.script ?? [];
    this.fired.clear();
    this.stepT = 0;
    this.reqCount = 0;
    this.clientCursor = 0;
    this.applyConfig(cfg, true);
    for (const lb of this.lbs.values()) {
      lb.rr = 0;
      lb.wrr = new Map();
      lb.benched.clear();
      lb.lastPick = null;
      lb.decision = null;
    }
    for (const s of this.servers.values()) s.mark = null;
    this.rev++;
  }

  /** Change settings mid-flight (playground) without reviving crashed machines. */
  update(partial: Partial<WorldConfig>) {
    this.applyConfig({ ...this.cfg, ...partial }, false);
    this.rev++;
  }

  reset(seed = 42) {
    this.rng = mulberry32(seed);
    this.packets = [];
    this.timers = [];
    this.effects = [];
    this.reqs.clear();
    this.metrics.reset();
    this.arrivalIn = 0.35;
    this.hcIn = 0.4;
    this.hbIn = 0.3;
    for (const s of this.servers.values()) {
      s.slots = s.slots.map(() => null);
      s.queue = [];
      s.served = 0;
      s.util = 0;
    }
    for (const lb of this.lbs.values()) {
      lb.conns.clear();
      lb.benched.clear();
      lb.decision = null;
    }
  }

  private applyConfig(cfg: WorldConfig, fresh: boolean) {
    const prevRps = this.cfg.rps;
    this.cfg = cfg;

    // Clients
    const clients = new Map<string, Client>();
    for (const spec of cfg.clients) {
      const c = this.clients.get(spec.id) ?? this.makeClient(spec);
      Object.assign(c, { name: spec.name, ip: spec.ip, color: spec.color, removing: false, talpha: 1 });
      if (fresh) {
        c.cartHome = null;
        c.conn = null;
      }
      clients.set(spec.id, c);
    }
    for (const [id, c] of this.clients) {
      if (!clients.has(id)) {
        c.removing = true;
        c.talpha = 0;
        clients.set(id, c);
      }
    }
    this.clients = clients;

    // Servers
    const servers = new Map<string, Server>();
    for (const spec of cfg.servers) {
      const existing = this.servers.get(spec.id);
      const s = existing ?? this.makeServer(spec);
      const size = spec.size ?? 's';
      s.label = spec.label ?? serverLabel(spec.id);
      s.size = size;
      s.weight = spec.weight ?? SIZE_WEIGHT[size];
      s.pool = spec.pool ?? null;
      this.resizeSlots(s, SIZE_WORKERS[size]);
      if (fresh) {
        s.up = !spec.down;
        s.served = 0;
        if (!s.up) {
          s.slots = s.slots.map(() => null);
          s.queue = [];
        }
      } else if (!existing || existing.removing) {
        s.up = !spec.down;
      }
      s.removing = false;
      s.talpha = 1;
      servers.set(spec.id, s);
    }
    for (const [id, s] of this.servers) {
      if (!servers.has(id)) {
        this.retireServer(s);
        servers.set(id, s);
      }
    }
    this.servers = servers;

    // Load balancers
    const want: LBId[] = cfg.lb === 'none' ? [] : cfg.lb === 'single' ? ['A'] : ['A', 'B'];
    for (const id of ['A', 'B'] as LBId[]) {
      let lb = this.lbs.get(id);
      if (want.includes(id)) {
        if (!lb) {
          lb = this.makeLB(id);
          this.lbs.set(id, lb);
        }
        const wasRemoving = lb.removing;
        lb.removing = false;
        lb.talpha = 1;
        if (fresh || wasRemoving) {
          lb.up = true;
          lb.active = id === 'A';
          lb.lastHb = this.t;
        }
      } else if (lb) {
        lb.removing = true;
        lb.talpha = 0;
        lb.active = false;
      }
    }
    if (cfg.lb === 'single') {
      const a = this.lbs.get('A');
      if (a) a.active = true;
    }

    // Health tables
    for (const lb of this.lbs.values()) {
      for (const s of this.servers.values()) {
        let hs = lb.health.get(s.id);
        if (!hs) {
          hs = { inRot: true, fails: 0, passes: 0, hist: [] };
          lb.health.set(s.id, hs);
        }
        if (fresh) {
          hs.inRot = !(cfg.healthChecks && !s.up);
          hs.fails = 0;
          hs.passes = 0;
          hs.hist = [];
        }
        if (!cfg.healthChecks) hs.inRot = true;
      }
    }

    // Shared session store
    if (cfg.sessionStore) {
      if (!this.redis) this.redis = box();
      this.redis.removing = false;
      this.redis.talpha = 1;
    } else if (this.redis) {
      this.redis.removing = true;
      this.redis.talpha = 0;
    }

    if (cfg.rps !== prevRps && cfg.rps > 0) this.arrivalIn = Math.min(this.arrivalIn, 1 / cfg.rps);
    this.layout();
  }

  private makeClient(spec: ClientSpec): Client {
    return {
      ...box(),
      id: spec.id,
      name: spec.name,
      ip: spec.ip,
      color: spec.color,
      port: 49152 + Math.floor(this.rng() * 16000),
      cartHome: null,
      conn: null,
      pulse: null,
    };
  }

  private makeServer(spec: ServerSpec): Server {
    const size = spec.size ?? 's';
    return {
      ...box(),
      id: spec.id,
      label: spec.label ?? serverLabel(spec.id),
      ip: serverIp(spec.id),
      size,
      workers: SIZE_WORKERS[size],
      weight: spec.weight ?? SIZE_WEIGHT[size],
      pool: spec.pool ?? null,
      up: !spec.down,
      slots: Array.from({ length: SIZE_WORKERS[size] }, () => null),
      queue: [],
      served: 0,
      util: 0,
      mark: null,
    };
  }

  private makeLB(id: LBId): LB {
    return {
      ...box(),
      id,
      label: id === 'A' ? 'lb-a' : 'lb-b',
      ip: id === 'A' ? '10.0.0.2' : '10.0.0.3',
      up: true,
      active: id === 'A',
      rr: 0,
      wrr: new Map(),
      conns: new Map(),
      health: new Map(),
      benched: new Map(),
      lastPick: null,
      decision: null,
      decisionVt: -10,
      lastHb: this.t,
    };
  }

  private resizeSlots(s: Server, workers: number) {
    s.workers = workers;
    if (s.slots.length === workers) return;
    if (s.slots.length < workers) {
      s.slots = [...s.slots, ...Array.from({ length: workers - s.slots.length }, () => null)];
      this.fillSlots(s);
    } else {
      const bumped = s.slots.slice(workers).filter((j): j is Job => !!j);
      s.slots = s.slots.slice(0, workers);
      s.queue = [...bumped, ...s.queue];
    }
  }

  private retireServer(s: Server) {
    s.removing = true;
    s.talpha = 0;
    const jobs = [...s.slots, ...s.queue].filter((j): j is Job => !!j);
    for (const j of jobs) this.reqs.delete(j.reqId);
    s.slots = s.slots.map(() => null);
    s.queue = [];
    for (const p of this.packets) if (p.to === sk(s.id) || p.from === sk(s.id)) this.reqs.delete(p.reqId);
    this.packets = this.packets.filter((p) => p.to !== sk(s.id) && p.from !== sk(s.id));
  }

  setSize(w: number, h: number) {
    if (w < 10 || h < 10) return;
    this.w = w;
    this.h = h;
    this.orient = w >= 700 && w >= h * 0.95 ? 'landscape' : 'portrait';
    this.compact = this.orient === 'landscape' ? w < 900 : true;
    this.layout();
    if (!this.sized) {
      this.sized = true;
      this.snap();
    }
  }

  private layout() {
    layoutWorld(this);
    // Newly created nodes appear at their spot (servers slide in from the right).
    for (const n of this.allBoxes()) {
      if (Number.isNaN(n.x)) {
        const isServer = (n as Server).slots !== undefined;
        n.x = n.tx + (isServer ? 26 : 0);
        n.y = n.ty;
        n.alpha = 0;
      }
    }
  }

  /** Jump every node straight to its target (first paint). */
  snap() {
    for (const n of this.allBoxes()) {
      n.x = n.tx;
      n.y = n.ty;
      n.alpha = n.talpha;
    }
  }

  private *allBoxes(): Generator<Box> {
    yield* this.clients.values();
    yield* this.servers.values();
    yield* this.lbs.values();
    if (this.redis) yield this.redis;
  }

  label(id: string) {
    return this.servers.get(id)?.label ?? id;
  }

  /* ---------------- scripting helpers ---------------- */

  after(delay: number, fn: () => void) {
    this.timers.push({ at: this.t + delay, fn });
  }

  rampRps(to: number, dur: number) {
    this.ramp = { from: this.cfg.rps, to, t0: this.t, dur };
  }

  setRps(rps: number) {
    this.ramp = null;
    this.update({ rps });
  }

  /* ---------------- the clock ---------------- */

  advance(realDt: number, playing: boolean, speed: number) {
    const dt = Math.min(realDt, 0.1);
    this.vt += dt;
    if (playing && !this.frozen) {
      let sim = dt * speed;
      while (sim > 1e-6 && !this.frozen) {
        const h = Math.min(sim, 0.04);
        this.tick(h);
        sim -= h;
      }
    }
    this.animate(dt);
  }

  private tick(dt: number) {
    this.t += dt;
    this.stepT += dt;

    this.script.forEach((ev, i) => {
      if (!this.fired.has(i) && this.stepT >= ev.at) {
        this.fired.add(i);
        ev.run(this);
        this.rev++;
      }
    });

    if (this.ramp) {
      const k = clamp((this.t - this.ramp.t0) / this.ramp.dur, 0, 1);
      this.cfg.rps = lerp(this.ramp.from, this.ramp.to, k);
      if (k >= 1) this.ramp = null;
      this.rev++;
    }

    const pr = this.predict;
    if (pr && !pr.done) {
      // Quiz pacing: one request at a time, so every routing decision gets asked.
      if (!pr.pending && this.t >= pr.nextSpawnAt) {
        this.spawnRequest();
        pr.nextSpawnAt = this.t + 6;
      }
    } else if (this.cfg.rps > 0.01) {
      this.arrivalIn -= dt;
      let guard = 0;
      while (this.arrivalIn <= 0 && guard++ < 20) {
        this.spawnRequest();
        this.arrivalIn += this.nextInterval();
      }
    }

    if (this.timers.length) {
      const due = this.timers.filter((tm) => tm.at <= this.t).sort((a, b) => a.at - b.at);
      if (due.length) {
        this.timers = this.timers.filter((tm) => tm.at > this.t);
        for (const tm of due) tm.fn();
      }
    }

    const arrived: Packet[] = [];
    const flying: Packet[] = [];
    for (const p of this.packets) {
      if (!p.held && this.t >= p.t0 + p.dur) arrived.push(p);
      else flying.push(p);
    }
    if (arrived.length) {
      arrived.sort((a, b) => a.t0 + a.dur - (b.t0 + b.dur));
      this.packets = flying;
      for (let i = 0; i < arrived.length; i++) {
        const p = arrived[i];
        if (this.frozen) {
          this.packets.push(...arrived.slice(i));
          break;
        }
        if (p.hold) {
          p.held = true;
          this.packets.push(p);
          this.onHeld(p);
          continue;
        }
        this.arrive(p);
      }
    }

    for (const s of this.servers.values()) {
      if (s.removing || !s.up) continue;
      for (let i = 0; i < s.slots.length; i++) {
        const job = s.slots[i];
        if (!job) continue;
        job.done += dt;
        if (job.done >= job.work) {
          s.slots[i] = null;
          this.finishJob(s, job);
        }
      }
      this.fillSlots(s);
    }

    if (this.cfg.healthChecks && this.cfg.lb !== 'none') {
      this.hcIn -= dt;
      if (this.hcIn <= 0) {
        this.hcIn += HC.interval;
        this.sendHealthChecks();
      }
    }
    if (this.cfg.lb === 'pair') this.tickVrrp(dt);
    if (this.cfg.chaos) this.tickChaos(dt);
    this.metrics.sample(this.t, dt);
  }

  private nextInterval() {
    const rps = Math.max(0.05, this.cfg.rps);
    if (this.cfg.arrival === 'poisson') return -Math.log(1 - this.rng()) / rps;
    return 1 / rps;
  }

  /* ---------------- requests ---------------- */

  private liveClients() {
    return [...this.clients.values()].filter((c) => !c.removing);
  }

  private liveServers() {
    return [...this.servers.values()].filter((s) => !s.removing);
  }

  private liveLBs() {
    return [...this.lbs.values()].filter((l) => !l.removing);
  }

  private pick<T>(arr: T[]): T {
    return arr[Math.floor(this.rng() * arr.length)];
  }

  spawnRequest(clientId?: string): Req | null {
    const clients = this.liveClients();
    if (!clients.length) return null;
    const client = clientId
      ? this.clients.get(clientId) ?? clients[0]
      : this.cfg.clientOrder === 'random'
        ? this.pick(clients)
        : clients[this.clientCursor++ % clients.length];
    const heavy = this.cfg.pattern
      ? this.cfg.pattern[this.reqCount % this.cfg.pattern.length] === 'H'
      : this.rng() < this.cfg.heavyRatio;
    this.reqCount++;

    let pool: Pool = 'api';
    let path: string;
    if (this.cfg.routeByPath) {
      pool = this.rng() < 0.4 ? 'media' : 'api';
      path = this.pick(pool === 'api' ? API_PATHS : MEDIA_PATHS);
    } else {
      path = heavy ? this.pick(HEAVY_PATHS) : this.pick(LIGHT_PATHS);
    }

    const req: Req = { id: this.nextId++, clientId: client.id, heavy, path, pool, t0: this.t, lb: null, server: null, tour: false, done: false };
    this.reqs.set(req.id, req);
    const entry = this.entryKey();
    if (!entry) return req;
    this.emit({
      kind: 'req',
      reqId: req.id,
      from: ck(client.id),
      to: entry,
      dur: entry.startsWith('lb') ? HOP.clientLb : HOP.clientServer,
      color: this.reqColor(req, client),
      heavy: req.heavy,
      sealed: this.cfg.layer === 'l4' && this.cfg.lb !== 'none',
    });
    return req;
  }

  private entryKey(): string | null {
    if (this.cfg.lb !== 'none') {
      const lbs = this.liveLBs();
      const active = lbs.find((l) => l.active) ?? lbs[0];
      return active ? lk(active.id) : null;
    }
    const direct = this.cfg.directTo ? this.servers.get(this.cfg.directTo) : null;
    if (direct && !direct.removing) return sk(direct.id);
    const first = this.liveServers()[0];
    return first ? sk(first.id) : null;
  }

  private reqColor(req: Req, client: Client) {
    if (this.cfg.colorBy === 'client') return client.color;
    if (this.cfg.colorBy === 'path') return req.pool === 'media' ? C.media : C.api;
    return req.heavy ? C.heavy : C.req;
  }

  private emit(p: Partial<Packet> & Pick<Packet, 'kind' | 'from' | 'to' | 'dur'>): Packet {
    const packet: Packet = {
      id: this.nextId++,
      reqId: 0,
      t0: this.t,
      status: 200,
      warn: false,
      color: C.req,
      r: 4.6,
      sealed: false,
      heavy: false,
      hold: false,
      held: false,
      ...p,
    };
    if (packet.heavy) packet.r = 6.2;
    this.packets.push(packet);
    if (this.tour && packet.reqId === this.tour.reqId) this.onTourPacket(packet);
    return packet;
  }

  private arrive(p: Packet) {
    switch (p.kind) {
      case 'req':
        return this.arriveReq(p);
      case 'res':
        return this.arriveRes(p);
      case 'hc':
        return this.arriveHc(p);
      case 'hcack':
        return this.arriveHcAck(p);
      case 'hb':
        return this.arriveHb(p);
      default:
        return;
    }
  }

  private arriveReq(p: Packet) {
    const req = this.reqs.get(p.reqId);
    if (!req) return;
    if (p.to.startsWith('lb:')) {
      const lb = this.lbs.get(p.to.slice(3) as LBId);
      if (!lb || lb.removing) return void this.reqs.delete(req.id);
      if (!lb.up) {
        this.fx({ kind: 'x', at: { key: p.to }, color: C.err, dur: 0.8 });
        return this.timeoutAtClient(req);
      }
      req.lb = lb.id;
      this.route(lb, req);
      return;
    }
    const s = this.servers.get(p.to.slice(2));
    if (!s || s.removing) return void this.reqs.delete(req.id);
    this.serverReceive(s, req, p);
  }

  /** Would this balancer send new traffic to the server right now? */
  private inRotation(lb: LB, id: string) {
    if (!(lb.health.get(id)?.inRot ?? true)) return false;
    return this.cfg.proxy !== 'nginx' || (lb.benched.get(id) ?? -Infinity) <= this.t;
  }

  private candidates(lb: LB, req: Req) {
    let cands = this.liveServers().filter((s) => this.inRotation(lb, s.id) && !req.tried?.includes(s.id));
    let route: Decision['route'];
    if (this.cfg.routeByPath && this.cfg.layer === 'l7') {
      cands = cands.filter((s) => s.pool === req.pool);
      route = { path: req.path, pool: req.pool };
    }
    return { cands, route };
  }

  private route(lb: LB, req: Req) {
    const client = this.clients.get(req.clientId);
    if (!client) return void this.reqs.delete(req.id);
    const { cands, route } = this.candidates(lb, req);
    if (!cands.length) {
      // What each one answers when it has nowhere left to send the request
      const [status, text] = this.cfg.proxy === 'nginx' ? [502, '502 · no live upstreams'] : [503, '503 · no server available'];
      this.fx({ kind: 'text', at: { key: lk(lb.id), dy: -lb.h / 2 - 14 }, text, color: C.err, dur: 1.4 });
      this.sendFromLB(lb, req, status, false);
      return;
    }

    let decision: Decision;
    if (req.forceServer && cands.some((s) => s.id === req.forceServer)) {
      const chosen = req.forceServer;
      decision = { chosen, acceptable: [chosen], algo: 'forced', detail: { kind: 'forced' }, commit: () => {} };
    } else if (this.cfg.layer === 'l4') {
      decision = this.decideL4(lb, cands, client);
    } else {
      decision = decide(lb, this.cfg.algorithm, cands, client, this.rng);
    }
    decision.route = route;

    const pr = this.predict;
    if (pr && !pr.done && !pr.pending && !req.tour && !req.tried) {
      pr.pending = { reqId: req.id, lbId: lb.id, decision, clientId: client.id };
      this.frozen = true;
      this.rev++;
      return;
    }
    this.dispatch(lb, req, decision, decision.chosen);
  }

  private decideL4(lb: LB, cands: Server[], client: Client): Decision {
    const pinned = client.conn && cands.some((s) => s.id === client.conn) ? client.conn : null;
    let chosen = pinned;
    if (!chosen) {
      const least = decide(lb, 'least', cands, client, this.rng);
      least.commit(least.chosen);
      chosen = least.chosen;
      client.conn = chosen;
    }
    return {
      chosen,
      acceptable: [chosen],
      algo: 'l4',
      detail: { kind: 'l4', ip: client.ip, port: client.port, reused: !!pinned },
      commit: () => {},
    };
  }

  private dispatch(lb: LB, req: Req, decision: Decision, chosen: string) {
    decision.commit(chosen);
    lb.lastPick = chosen;
    lb.decision = { ...decision, chosen };
    lb.decisionVt = this.vt;
    lb.conns.set(chosen, (lb.conns.get(chosen) ?? 0) + 1);
    req.server = chosen;
    this.trace?.push({ t: this.t, kind: 'route', req: req.id, server: chosen, client: req.clientId, heavy: req.heavy, path: req.path });
    this.flashWire(`${lk(lb.id)}>${sk(chosen)}`);
    const client = this.clients.get(req.clientId);
    this.emit({
      kind: 'req',
      reqId: req.id,
      from: lk(lb.id),
      to: sk(chosen),
      dur: HOP.lbServer,
      color: client ? this.reqColor(req, client) : C.req,
      heavy: req.heavy,
      sealed: this.cfg.layer === 'l4',
      hold: req.tour && !!this.tour?.holdServer,
    });
  }

  private serverReceive(s: Server, req: Req, p: Packet) {
    if (!s.up) {
      this.fx({ kind: 'x', at: { key: sk(s.id), dx: -s.w / 2 - 6 }, color: C.err, dur: 0.8 });
      if (req.lb) this.refused(req, s);
      else this.timeoutAtClient(req);
      return;
    }
    const port = this.inPort(s);
    const job: Job = {
      reqId: req.id,
      work: req.tour ? WORK.tour : req.heavy ? WORK.heavy : WORK.light,
      done: 0,
      color: p.color,
      heavy: req.heavy,
      x: port.x,
      y: port.y,
    };
    const free = s.slots.indexOf(null);
    if (free >= 0) {
      s.slots[free] = job;
      this.onJobStart(s, job);
    } else if (s.queue.length < this.cfg.queueCap) {
      s.queue.push(job);
    } else {
      this.metrics.drops += 1;
      this.fx({ kind: 'text', at: { key: sk(s.id), dx: -s.w / 2 - 40, dy: -18 }, text: '503 queue full', color: C.err, dur: 1.1 });
      this.fx({ kind: 'ring', at: port, color: C.err, dur: 0.6 });
      this.sendFromServer(s, req, 503, false);
    }
  }

  private fillSlots(s: Server) {
    if (!s.up) return;
    for (let i = 0; i < s.slots.length && s.queue.length; i++) {
      if (!s.slots[i]) {
        const job = s.queue.shift()!;
        s.slots[i] = job;
        this.onJobStart(s, job);
      }
    }
  }

  private onJobStart(s: Server, job: Job) {
    if (this.tour && job.reqId === this.tour.reqId) this.tour.stage = 'processing';
    if (this.cfg.sessionStore && this.redis && !this.redis.removing) {
      this.emit({ kind: 'sess', from: sk(s.id), to: 'redis', dur: HOP.serverRedis, color: C.hc, r: 2.4 });
      this.after(HOP.serverRedis, () => {
        if (this.redis && !s.removing) this.emit({ kind: 'sess', from: 'redis', to: sk(s.id), dur: HOP.serverRedis, color: C.hc, r: 2.4 });
      });
    }
  }

  private finishJob(s: Server, job: Job) {
    const req = this.reqs.get(job.reqId);
    if (!req) return;
    s.served += 1;
    this.metrics.served.set(s.id, (this.metrics.served.get(s.id) ?? 0) + 1);
    let warn = false;
    if (this.cfg.sessions && !this.cfg.sessionStore) {
      const c = this.clients.get(req.clientId);
      if (c) {
        if (!c.cartHome) c.cartHome = s.id;
        else if (c.cartHome !== s.id) warn = true;
      }
    }
    this.sendFromServer(s, req, 200, warn);
  }

  private sendFromServer(s: Server, req: Req, status: number, warn: boolean) {
    const toLb = req.lb ? this.lbs.get(req.lb) : null;
    const color = status >= 500 ? C.err : warn ? C.warn : C.res;
    this.emit({
      kind: 'res',
      reqId: req.id,
      from: sk(s.id),
      to: toLb ? lk(toLb.id) : ck(req.clientId),
      dur: toLb ? HOP.lbServer : HOP.clientServer,
      status,
      warn,
      color,
      r: 4,
      sealed: this.cfg.layer === 'l4' && !!toLb,
    });
  }

  private sendFromLB(lb: LB, req: Req, status: number, warn: boolean) {
    this.emit({
      kind: 'res',
      reqId: req.id,
      from: lk(lb.id),
      to: ck(req.clientId),
      dur: HOP.clientLb,
      status,
      warn,
      color: status >= 500 ? C.err : warn ? C.warn : C.res,
      r: 4,
      sealed: this.cfg.layer === 'l4',
    });
  }

  private release(lb: LB, serverId: string | null) {
    if (!serverId) return;
    lb.conns.set(serverId, Math.max(0, (lb.conns.get(serverId) ?? 0) - 1));
  }

  private arriveRes(p: Packet) {
    const req = this.reqs.get(p.reqId);
    if (!req) return;
    if (p.to.startsWith('lb:')) {
      const lb = this.lbs.get(p.to.slice(3) as LBId);
      if (!lb || lb.removing) return void this.reqs.delete(req.id);
      this.release(lb, req.server);
      if (!lb.up) return this.timeoutAtClient(req);
      this.sendFromLB(lb, req, p.status, p.warn);
      return;
    }
    this.complete(req, p.status, p.warn);
  }

  /** The balancer's connection to a crashed server was refused. */
  private refused(req: Req, s: Server) {
    const lb = req.lb ? this.lbs.get(req.lb) : null;
    if (!lb || lb.removing) return void this.reqs.delete(req.id);
    if (!lb.up) return this.timeoutAtClient(req);
    this.trace?.push({ t: this.t, kind: 'refused', req: req.id, server: s.id });
    const at = { key: lk(lb.id), dy: -lb.h / 2 - 14 };

    if (this.cfg.proxy === 'nginx') {
      // NGINX: bench the server for fail_timeout and try the next one right away.
      this.release(lb, s.id);
      lb.benched.set(s.id, this.t + RETRY.nginxBench);
      (req.tried ??= []).push(s.id);
      this.fx({ kind: 'text', at, text: `refused · trying the next server`, color: C.warn, dur: 1.2 });
      this.fx({ kind: 'text', at: { key: sk(s.id), dy: -s.h / 2 - 26 }, text: `skipped for ${RETRY.nginxBench} s`, color: C.warn, dur: 1.6 });
      this.route(lb, req);
      return;
    }

    // HAProxy: retry the same server, a second apart, then give up with 503.
    req.fails = (req.fails ?? 0) + 1;
    if (req.fails <= RETRY.haproxyTries) {
      const n = req.fails;
      this.after(Math.max(0, RETRY.haproxyGap - HOP.lbServer), () => {
        if (req.done || !lb.up) return;
        this.fx({ kind: 'text', at, text: `retry ${n}/${RETRY.haproxyTries}`, color: C.warn, dur: HOP.lbServer });
        this.resend(lb, req, s.id);
      });
      return;
    }
    this.release(lb, s.id);
    this.fx({ kind: 'text', at: { key: lk(lb.id), dy: -lb.h / 2 - 32 }, text: '503 · gave up', color: C.err, dur: 1.2 });
    this.sendFromLB(lb, req, 503, false);
  }

  /** Send the same request to the same server again (no new routing decision). */
  private resend(lb: LB, req: Req, sid: string) {
    const client = this.clients.get(req.clientId);
    this.flashWire(`${lk(lb.id)}>${sk(sid)}`);
    this.emit({
      kind: 'req',
      reqId: req.id,
      from: lk(lb.id),
      to: sk(sid),
      dur: HOP.lbServer,
      color: client ? this.reqColor(req, client) : C.req,
      heavy: req.heavy,
      sealed: this.cfg.layer === 'l4',
    });
  }

  private gatewayError(req: Req, status: number) {
    if (req.done) return;
    const lb = req.lb ? this.lbs.get(req.lb) : null;
    if (!lb || lb.removing) return void this.reqs.delete(req.id);
    this.release(lb, req.server);
    if (!lb.up) return this.timeoutAtClient(req);
    this.sendFromLB(lb, req, status, false);
  }

  private timeoutAtClient(req: Req) {
    this.after(GATEWAY_TIMEOUT, () => this.complete(req, 0, false));
  }

  private complete(req: Req, status: number, warn: boolean) {
    if (req.done) return;
    req.done = true;
    this.reqs.delete(req.id);
    const c = this.clients.get(req.clientId);
    const ok = status > 0 && status < 500;
    const lat = (this.t - req.t0) * MS_PER_S;
    this.metrics.push(this.t, lat, ok ? (warn ? 'warn' : 'ok') : 'err');
    this.trace?.push({ t: this.t, kind: 'done', req: req.id, server: req.server, status });
    if (c) {
      c.pulse = { color: ok ? (warn ? C.warn : C.res) : C.err, vt: this.vt };
      const dy = -c.h / 2 - 12;
      if (!ok) this.fx({ kind: 'text', at: { key: ck(c.id), dy }, text: status === 0 ? 'timed out' : `${status} error`, color: C.err, dur: 1.2 });
      else if (warn) this.fx({ kind: 'text', at: { key: ck(c.id), dy }, text: 'my cart is empty?!', color: C.warn, dur: 1.5 });
    }
    if (this.tour && req.id === this.tour.reqId) {
      this.tour.stage = 'done';
      this.tour.lat = lat;
      this.rev++;
    }
  }

  /* ---------------- health checks ---------------- */

  private sendHealthChecks() {
    for (const lb of this.liveLBs()) {
      if (!lb.up || !lb.active) continue;
      for (const s of this.liveServers()) {
        const probe: Probe = { acked: false };
        this.emit({ kind: 'hc', from: lk(lb.id), to: sk(s.id), dur: HOP.lbServer, color: C.hc, r: 2.8, probe });
        this.after(HC.timeout, () => {
          if (!probe.acked) this.healthResult(lb, s.id, false);
        });
      }
    }
  }

  private arriveHc(p: Packet) {
    const s = this.servers.get(p.to.slice(2));
    if (!s || s.removing) return;
    if (s.up) {
      this.emit({ kind: 'hcack', from: p.to, to: p.from, dur: HOP.lbServer, color: C.res, r: 2.6, probe: p.probe });
    } else {
      this.fx({ kind: 'x', at: { key: p.to, dx: -s.w / 2 - 6 }, color: C.hc, dur: 0.6, size: 0.7 });
    }
  }

  private arriveHcAck(p: Packet) {
    const lb = this.lbs.get(p.to.slice(3) as LBId);
    if (!lb || !p.probe) return;
    p.probe.acked = true;
    this.healthResult(lb, p.from.slice(2), true);
  }

  private healthResult(lb: LB, sid: string, ok: boolean) {
    const hs: HealthState | undefined = lb.health.get(sid);
    const s = this.servers.get(sid);
    if (!hs || !s || s.removing || !this.cfg.healthChecks) return;
    hs.hist.push(ok ? 'ok' : 'fail');
    if (hs.hist.length > 3) hs.hist.shift();
    if (ok) {
      hs.passes += 1;
      hs.fails = 0;
      if (!hs.inRot && hs.passes >= HC.rise) {
        hs.inRot = true;
        this.trace?.push({ t: this.t, kind: 'health', server: sid, inRot: true });
        this.fx({ kind: 'text', at: { key: sk(sid), dy: -s.h / 2 - 26 }, text: 'back in rotation', color: C.res, dur: 1.6 });
      }
    } else {
      hs.fails += 1;
      hs.passes = 0;
      if (hs.inRot && hs.fails >= HC.fall) {
        hs.inRot = false;
        this.trace?.push({ t: this.t, kind: 'health', server: sid, inRot: false });
        this.fx({ kind: 'text', at: { key: sk(sid), dy: -s.h / 2 - 26 }, text: 'removed from rotation', color: C.err, dur: 1.8 });
      }
    }
    this.rev++;
  }

  /* ---------------- LB failover (VRRP) ---------------- */

  private tickVrrp(dt: number) {
    const lbs = this.liveLBs();
    const active = lbs.find((l) => l.active);
    const standby = lbs.find((l) => !l.active);
    if (!standby) return;
    this.hbIn -= dt;
    if (this.hbIn <= 0) {
      this.hbIn += HB.interval;
      if (active && active.up && standby.up) {
        this.emit({ kind: 'hb', from: lk(active.id), to: lk(standby.id), dur: HOP.lbLb, color: C.hc, r: 2.8 });
      }
    }
    if (standby.up && this.t - standby.lastHb > HB.dead) {
      if (active) active.active = false;
      standby.active = true;
      standby.lastHb = this.t;
      this.fx({ kind: 'text', at: { key: lk(standby.id), dy: -standby.h / 2 - 16 }, text: `took over ${VIP}`, color: C.warn, dur: 2.2 });
      this.fx({ kind: 'ring', at: { key: lk(standby.id) }, color: C.warn, dur: 0.9, size: 2 });
      this.rev++;
    }
  }

  private arriveHb(p: Packet) {
    const lb = this.lbs.get(p.to.slice(3) as LBId);
    if (lb) lb.lastHb = this.t;
  }

  /* ---------------- chaos (ambient mode) ---------------- */

  private tickChaos(dt: number) {
    this.chaosIn -= dt;
    if (this.chaosIn > 0) return;
    if (this.chaosVictim) {
      this.reviveServer(this.chaosVictim);
      this.chaosVictim = null;
      this.chaosIn = 10 + this.rng() * 6;
      return;
    }
    const up = this.liveServers().filter((s) => s.up);
    if (up.length > 2) {
      const victim = this.pick(up);
      this.crashServer(victim.id);
      this.chaosVictim = victim.id;
      this.chaosIn = 11;
    } else {
      this.chaosIn = 5;
    }
  }

  /* ---------------- actions ---------------- */

  crashServer(id: string) {
    const s = this.servers.get(id);
    if (!s || !s.up || s.removing) return;
    s.up = false;
    this.trace?.push({ t: this.t, kind: 'crash', server: id });
    const jobs = [...s.slots, ...s.queue].filter((j): j is Job => !!j);
    s.slots = s.slots.map(() => null);
    s.queue = [];
    for (const job of jobs) {
      const req = this.reqs.get(job.reqId);
      if (!req) continue;
      if (!req.lb) this.timeoutAtClient(req);
      // The connection drops mid-request. NGINX retries a GET on another
      // server; HAProxy passes the failure on as 502 Bad Gateway.
      else if (this.cfg.proxy === 'nginx') this.after(0.3, () => this.retryElsewhere(req, id));
      else this.after(GATEWAY_TIMEOUT, () => this.gatewayError(req, 502));
    }
    this.fx({ kind: 'ring', at: { key: sk(id) }, color: C.err, dur: 0.9, size: 2.4 });
    this.fx({ kind: 'text', at: { key: sk(id), dy: -s.h / 2 - 26 }, text: 'crashed', color: C.err, dur: 1.4 });
    this.rev++;
  }

  private retryElsewhere(req: Req, sid: string) {
    if (req.done) return;
    const lb = req.lb ? this.lbs.get(req.lb) : null;
    if (!lb || lb.removing) return void this.reqs.delete(req.id);
    if (!lb.up) return this.timeoutAtClient(req);
    this.release(lb, sid);
    lb.benched.set(sid, this.t + RETRY.nginxBench);
    (req.tried ??= []).push(sid);
    this.route(lb, req);
  }

  reviveServer(id: string) {
    const s = this.servers.get(id);
    if (!s || s.up || s.removing) return;
    s.up = true;
    this.trace?.push({ t: this.t, kind: 'revive', server: id });
    this.fx({ kind: 'ring', at: { key: sk(id) }, color: C.res, dur: 0.9, size: 2.4 });
    this.fx({ kind: 'text', at: { key: sk(id), dy: -s.h / 2 - 26 }, text: 'rebooted', color: C.res, dur: 1.2 });
    this.rev++;
  }

  toggleServer(id: string) {
    const s = this.servers.get(id);
    if (!s) return;
    if (s.up) this.crashServer(id);
    else this.reviveServer(id);
  }

  crashLB(id: LBId = 'A') {
    const lb = this.lbs.get(id);
    if (!lb || !lb.up) return;
    lb.up = false;
    lb.conns.clear();
    lb.decision = null;
    this.fx({ kind: 'ring', at: { key: lk(id) }, color: C.err, dur: 0.9, size: 2.4 });
    this.fx({ kind: 'text', at: { key: lk(id), dy: -lb.h / 2 - 16 }, text: 'crashed', color: C.err, dur: 1.4 });
    this.rev++;
  }

  reviveLB(id: LBId = 'A') {
    const lb = this.lbs.get(id);
    if (!lb || lb.up) return;
    lb.up = true;
    lb.lastHb = this.t;
    const otherActive = this.liveLBs().some((l) => l !== lb && l.active && l.up);
    lb.active = this.cfg.lb === 'single' || !otherActive;
    if (lb.active) for (const l of this.lbs.values()) if (l !== lb) l.active = false;
    this.fx({ kind: 'ring', at: { key: lk(id) }, color: C.res, dur: 0.9, size: 2.4 });
    this.fx({ kind: 'text', at: { key: lk(id), dy: -lb.h / 2 - 16 }, text: lb.active ? 'back online' : 'back as standby', color: C.res, dur: 1.4 });
    this.rev++;
  }

  /** Forget every user's cart (the app restarted with a new algorithm). */
  clearSessions() {
    for (const c of this.clients.values()) c.cartHome = null;
    this.rev++;
  }

  activeLB(): LB | null {
    const lbs = this.liveLBs();
    return lbs.find((l) => l.active) ?? lbs[0] ?? null;
  }

  healthOf(id: string): HealthState | null {
    return this.activeLB()?.health.get(id) ?? null;
  }

  /* ---------------- prediction game ---------------- */

  startPredict(needed: number) {
    this.predict = { needed, correct: 0, attempts: 0, pending: null, last: null, nextSpawnAt: this.t + 0.4, done: false };
    this.rev++;
  }

  answerPredict(serverId: string) {
    const pr = this.predict;
    if (!pr?.pending) return;
    const { decision, reqId, lbId } = pr.pending;
    const ok = decision.acceptable.includes(serverId);
    const chosen = ok ? serverId : decision.chosen;
    pr.attempts += 1;
    if (ok) pr.correct += 1;
    pr.last = { ok, picked: serverId, chosen, text: explain({ ...decision, chosen }, (id) => this.label(id)), vt: this.vt };
    const picked = this.servers.get(serverId);
    if (picked) picked.mark = { kind: ok ? 'ok' : 'bad', vt: this.vt };
    if (!ok) {
      const right = this.servers.get(chosen);
      if (right) right.mark = { kind: 'answer', vt: this.vt };
    }
    if (picked) this.fx({ kind: 'ring', at: { key: sk(serverId) }, color: ok ? C.res : C.err, dur: 0.8, size: 2 });
    pr.pending = null;
    this.frozen = false;
    pr.nextSpawnAt = this.t + 0.9;
    if (pr.correct >= pr.needed) pr.done = true;
    const lb = this.lbs.get(lbId);
    const req = this.reqs.get(reqId);
    if (lb && req) this.dispatch(lb, req, decision, chosen);
    this.rev++;
  }

  endPredict() {
    const pr = this.predict;
    if (!pr) return;
    pr.done = true;
    if (pr.pending) {
      const { decision, reqId, lbId } = pr.pending;
      pr.pending = null;
      const lb = this.lbs.get(lbId);
      const req = this.reqs.get(reqId);
      if (lb && req) this.dispatch(lb, req, decision, decision.chosen);
    }
    this.frozen = false;
    this.rev++;
  }

  /* ---------------- guided tour of a single request ---------------- */

  /** Place Alice's /cart request at a given point of its journey. */
  startTour(from: 'client' | 'lb' | 'server') {
    const alice = this.clients.get('alice') ?? this.liveClients()[0];
    const lb = this.lbs.get('A');
    if (!alice || !lb) return;
    const req: Req = {
      id: this.nextId++,
      clientId: alice.id,
      heavy: false,
      path: '/cart',
      pool: 'api',
      t0: this.t,
      lb: null,
      server: null,
      tour: true,
      done: false,
      forceServer: 's2',
    };
    this.reqs.set(req.id, req);

    if (from === 'client') {
      this.tour = { reqId: req.id, stage: 'toLb', lat: null, holdLb: true, holdServer: false };
      this.emit({ kind: 'req', reqId: req.id, from: ck(alice.id), to: lk('A'), dur: HOP.clientLb * 1.6, color: C.req, hold: true });
    } else if (from === 'lb') {
      req.t0 = this.t - HOP.clientLb;
      this.tour = { reqId: req.id, stage: 'atLb', lat: null, holdLb: false, holdServer: true };
      const p = this.emit({ kind: 'req', reqId: req.id, from: ck(alice.id), to: lk('A'), dur: HOP.clientLb, color: C.req, hold: true });
      p.t0 = this.t - p.dur;
      p.held = true;
      this.tour.stage = 'atLb';
    } else {
      const s = this.servers.get('s2');
      if (!s) return;
      req.t0 = this.t - HOP.clientLb - HOP.lbServer;
      req.lb = 'A';
      req.server = 's2';
      lb.conns.set('s2', 1);
      lb.lastPick = 's2';
      this.tour = { reqId: req.id, stage: 'processing', lat: null, holdLb: false, holdServer: false };
      const port = this.inPort(s);
      s.slots[0] = { reqId: req.id, work: WORK.tour, done: 0, color: C.req, heavy: false, x: port.x, y: port.y };
    }
    this.rev++;
  }

  /** Let a held tour packet continue its journey. */
  releaseTour() {
    const p = this.packets.find((q) => q.held && this.tour && q.reqId === this.tour.reqId);
    if (!p) return;
    this.packets = this.packets.filter((q) => q !== p);
    p.hold = false;
    p.held = false;
    this.arrive(p);
    this.rev++;
  }

  private onTourPacket(p: Packet) {
    if (!this.tour) return;
    if (p.kind === 'req') this.tour.stage = p.from.startsWith('c:') ? 'toLb' : 'toServer';
    else if (p.kind === 'res') this.tour.stage = p.from.startsWith('s:') ? 'toLbBack' : 'toClient';
    this.rev++;
  }

  private onHeld(p: Packet) {
    if (this.tour && p.reqId === this.tour.reqId) {
      this.tour.stage = p.to.startsWith('lb:') ? 'atLb' : 'atServer';
      this.rev++;
    }
  }

  /* ---------------- visuals ---------------- */

  private fx(e: Omit<Effect, 'vt'>) {
    this.effects.push({ ...e, vt: this.vt });
  }

  private flashWire(key: string) {
    const w = this.wires.get(key);
    if (w) w.flashVt = this.vt;
  }

  private nodeBox(key: string): Box | null {
    if (key === 'redis') return this.redis;
    const i = key.indexOf(':');
    const kind = key.slice(0, i);
    const id = key.slice(i + 1);
    if (kind === 'c') return this.clients.get(id) ?? null;
    if (kind === 's') return this.servers.get(id) ?? null;
    if (kind === 'lb') return this.lbs.get(id as LBId) ?? null;
    return null;
  }

  private curve(uKey: string, dKey: string, offset: number): Curve | null {
    const u = this.nodeBox(uKey);
    const d = this.nodeBox(dKey);
    if (!u || !d) return null;
    const land = this.orient === 'landscape';
    if (uKey.startsWith('lb:') && dKey.startsWith('lb:')) {
      return land
        ? curveBetween({ x: u.x, y: u.y + u.h / 2 }, { x: d.x, y: d.y - d.h / 2 }, 'y', offset)
        : curveBetween({ x: u.x + u.w / 2, y: u.y }, { x: d.x - d.w / 2, y: d.y }, 'x', offset);
    }
    return land
      ? curveBetween({ x: u.x + u.w / 2, y: u.y }, { x: d.x - d.w / 2, y: d.y }, 'x', offset)
      : curveBetween({ x: u.x, y: u.y + u.h / 2 }, { x: d.x, y: d.y - d.h / 2 }, 'y', offset);
  }

  inPort(s: Box): Pt {
    return this.orient === 'landscape' ? { x: s.x - s.w / 2, y: s.y } : { x: s.x, y: s.y - s.h / 2 };
  }

  private queueSlot(s: Server, i: number): Pt {
    const p = this.inPort(s);
    const off = 12 + i * 10;
    return this.orient === 'landscape' ? { x: p.x - off, y: p.y } : { x: p.x, y: p.y - off };
  }

  private anchorPt(a: Anchor): Pt | null {
    if ('key' in a) {
      const b = this.nodeBox(a.key);
      if (!b) return null;
      return { x: b.x + (a.dx ?? 0), y: b.y + (a.dy ?? 0) };
    }
    return a;
  }

  private wireSet() {
    const out: { key: string; u: string; d: string; kind: WireState['kind']; state: WireState['state'] }[] = [];
    const servers = this.liveServers();
    const lbs = this.liveLBs();
    if (this.cfg.lb === 'none') {
      const entry = this.entryKey();
      if (entry) {
        const s = this.servers.get(entry.slice(2));
        for (const c of this.liveClients()) {
          out.push({ key: `${ck(c.id)}>${entry}`, u: ck(c.id), d: entry, kind: 'req', state: s && !s.up ? 'down' : 'normal' });
        }
      }
    } else {
      const active = lbs.find((l) => l.active) ?? lbs[0];
      if (active) {
        for (const c of this.liveClients()) {
          out.push({ key: `${ck(c.id)}>${lk(active.id)}`, u: ck(c.id), d: lk(active.id), kind: 'req', state: active.up ? 'normal' : 'down' });
        }
      }
      for (const lb of lbs) {
        for (const s of servers) {
          const state: WireState['state'] = !lb.up || !s.up ? 'down' : !this.inRotation(lb, s.id) ? 'out' : lb.active ? 'normal' : 'standby';
          out.push({ key: `${lk(lb.id)}>${sk(s.id)}`, u: lk(lb.id), d: sk(s.id), kind: 'req', state });
        }
      }
      if (lbs.length === 2) out.push({ key: 'lb:A>lb:B', u: 'lb:A', d: 'lb:B', kind: 'hb', state: 'normal' });
    }
    if (this.redis && !this.redis.removing) {
      for (const s of servers) out.push({ key: `${sk(s.id)}>redis`, u: sk(s.id), d: 'redis', kind: 'redis', state: 'normal' });
    }
    return out;
  }

  private animate(dt: number) {
    const moveL = 6.5;
    for (const n of this.allBoxes()) {
      n.x = damp(n.x, n.tx, moveL, dt);
      n.y = damp(n.y, n.ty, moveL, dt);
      n.alpha = damp(n.alpha, n.talpha, 8, dt);
    }

    // Drop faded-out nodes
    for (const [id, c] of this.clients) if (c.removing && c.alpha < 0.02) this.clients.delete(id);
    for (const [id, s] of this.servers) {
      if (s.removing && s.alpha < 0.02) {
        this.servers.delete(id);
        for (const lb of this.lbs.values()) {
          lb.health.delete(id);
          lb.conns.delete(id);
        }
      }
    }
    for (const [id, lb] of this.lbs) if (lb.removing && lb.alpha < 0.02) this.lbs.delete(id);
    if (this.redis?.removing && this.redis.alpha < 0.02) this.redis = null;

    // Queues and utilisation
    for (const s of this.servers.values()) {
      const busy = s.slots.filter(Boolean).length;
      s.util = damp(s.util, s.up ? busy / s.workers : 0, 3, dt);
      s.queue.forEach((job, i) => {
        const target = this.queueSlot(s, Math.min(i, 13));
        job.x = damp(job.x, target.x, 12, dt);
        job.y = damp(job.y, target.y, 12, dt);
      });
      if (s.mark && this.vt - s.mark.vt > 1.6) s.mark = null;
    }

    // Wires fade in and out as the topology changes
    const set = this.wireSet();
    const live = new Set<string>();
    for (const w of set) {
      const c = this.curve(w.u, w.d, 0);
      if (!c) continue;
      live.add(w.key);
      const cur = this.wires.get(w.key);
      const mid = bezier(c, 0.5);
      if (cur) {
        cur.d = curvePath(c);
        cur.target = 1;
        cur.state = w.state;
        cur.kind = w.kind;
        cur.mid = mid;
      } else {
        this.wires.set(w.key, { d: curvePath(c), alpha: 0, target: 1, kind: w.kind, state: w.state, flashVt: -10, mid });
      }
    }
    for (const [key, w] of this.wires) {
      if (!live.has(key)) w.target = 0;
      w.alpha = damp(w.alpha, w.target, 7, dt);
      if (w.target === 0 && w.alpha < 0.01) this.wires.delete(key);
    }

    this.effects = this.effects.filter((e) => this.vt - e.vt < e.dur);
    for (const c of this.clients.values()) if (c.pulse && this.vt - c.pulse.vt > 0.9) c.pulse = null;
  }

  private packetPos(p: Packet, offsetBack = 0): Pt | null {
    const fwd = p.from.startsWith('lb:') && p.to.startsWith('lb:') ? p.from === 'lb:A' : rankOf(p.from) < rankOf(p.to);
    const u = fwd ? p.from : p.to;
    const d = fwd ? p.to : p.from;
    const lane = p.kind === 'req' ? -4 : p.kind === 'res' ? 4 : p.kind === 'hc' || p.kind === 'hcack' ? -11 : 0;
    const c = this.curve(u, d, lane);
    if (!c) return null;
    const prog = p.held ? 1 : clamp((this.t - p.t0) / p.dur, 0, 1);
    const s = clamp(fwd ? prog - offsetBack : 1 - prog + offsetBack, 0, 1);
    return bezier(c, s);
  }

  view(): View {
    const cfg = this.cfg;
    const lbA = this.activeLB();
    const pr = this.predict;
    const pickable = !!pr?.pending;

    const totalServed = [...this.servers.values()].reduce((a, s) => a + s.served, 0);

    const clients: ClientView[] = [...this.clients.values()].map((c) => ({
      id: c.id,
      name: c.name,
      ip: c.ip,
      color: c.color,
      x: c.x,
      y: c.y,
      w: c.w,
      h: c.h,
      alpha: c.alpha,
      pulse: c.pulse ? { color: c.pulse.color, k: clamp((this.vt - c.pulse.vt) / 0.9, 0, 1) } : null,
      cart: cfg.sessions && c.cartHome ? 'home' : null,
    }));

    const cartOwners = new Map<string, string[]>();
    if (cfg.sessions && !cfg.sessionStore) {
      for (const c of this.clients.values()) {
        if (!c.cartHome) continue;
        const list = cartOwners.get(c.cartHome) ?? [];
        list.push(c.color);
        cartOwners.set(c.cartHome, list);
      }
    }

    const servers: ServerView[] = [...this.servers.values()].map((s) => {
      const hs = lbA?.health.get(s.id);
      const cap = Math.min(cfg.queueCap, 14);
      return {
        id: s.id,
        label: s.label,
        ip: s.ip,
        x: s.x,
        y: s.y,
        w: s.w,
        h: s.h,
        alpha: s.alpha,
        up: s.up,
        workers: s.workers,
        weight: s.weight,
        pool: s.pool,
        units: s.slots.map((j) => (j ? { busy: true, p: clamp(j.done / j.work, 0, 1), color: j.color } : { busy: false, p: 0, color: '' })),
        queue: s.queue.slice(0, 14).map((j) => ({ x: j.x, y: j.y, color: j.color })),
        capSlots: Array.from({ length: cap }, (_, i) => this.queueSlot(s, i)),
        overflow: Math.max(0, s.queue.length - 14),
        inRot: cfg.lb === 'none' ? null : lbA ? this.inRotation(lbA, s.id) : true,
        tally: cfg.healthChecks && cfg.lb !== 'none' && hs ? hs.hist : null,
        served: s.served,
        share: totalServed ? s.served / totalServed : 0,
        carts: cartOwners.get(s.id) ?? [],
        util: s.util,
        mark: s.mark ? { kind: s.mark.kind, k: clamp((this.vt - s.mark.vt) / 1.6, 0, 1) } : null,
        pickable: pickable && s.up && !s.removing && (lbA ? this.inRotation(lbA, s.id) : true),
      };
    });

    const lbs: LBView[] = [...this.lbs.values()].map((l) => ({
      id: l.id,
      label: l.label,
      ip: l.ip,
      x: l.x,
      y: l.y,
      w: l.w,
      h: l.h,
      alpha: l.alpha,
      up: l.up,
      active: l.active,
      pair: cfg.lb === 'pair',
      flash: clamp(1 - (this.vt - l.decisionVt) / 0.5, 0, 1),
    }));

    const packets: PacketView[] = [];
    for (const p of this.packets) {
      const pos = this.packetPos(p);
      if (!pos) continue;
      const tail = this.packetPos(p, p.kind === 'req' || p.kind === 'res' ? 0.075 : 0.05) ?? pos;
      packets.push({ id: p.id, kind: p.kind, x: pos.x, y: pos.y, tx: tail.x, ty: tail.y, color: p.color, r: p.r, sealed: p.sealed, heavy: p.heavy, status: p.status, warn: p.warn });
    }

    let pending: View['pending'] = null;
    if (pr?.pending) {
      const lb = this.lbs.get(pr.pending.lbId);
      const client = this.clients.get(pr.pending.clientId);
      if (lb) pending = { x: lb.x, y: lb.y, color: client ? (cfg.colorBy === 'client' ? client.color : C.req) : C.req };
    }

    const effects: EffectView[] = [];
    for (const e of this.effects) {
      const pt = this.anchorPt(e.at);
      if (!pt) continue;
      effects.push({ kind: e.kind, x: pt.x, y: pt.y, color: e.color, text: e.text, k: clamp((this.vt - e.vt) / e.dur, 0, 1), size: e.size ?? 1 });
    }

    const wires: WireView[] = [...this.wires.entries()].map(([key, w]) => ({
      key,
      d: w.d,
      alpha: w.alpha,
      kind: w.kind,
      state: w.state,
      flash: clamp(1 - (this.vt - w.flashVt) / 0.5, 0, 1),
      mid: w.mid,
    }));

    let brain: BrainView | null = null;
    if (cfg.showBrain && lbA && !lbA.removing && cfg.lb !== 'none') {
      const labels: Record<string, string> = {};
      for (const s of this.servers.values()) labels[s.id] = s.label;
      const live = this.liveServers().filter((s) => this.inRotation(lbA, s.id));
      const pools: Record<string, string[]> = {};
      for (const s of this.liveServers()) if (s.pool) (pools[s.pool] ??= []).push(s.label);
      const land = this.orient === 'landscape';
      brain = {
        x: lbA.x,
        y: lbA.y + lbA.h / 2 + 14,
        anchor: land ? 'below' : 'strip',
        algo: cfg.algorithm,
        layer: cfg.layer,
        routeByPath: cfg.routeByPath,
        decision: lbA.decision,
        age: this.vt - lbA.decisionVt,
        pending: pr?.pending?.decision ?? null,
        pendingClient: (() => {
          const c = pr?.pending ? this.clients.get(pr.pending.clientId) : null;
          return c ? { name: c.name, ip: c.ip, color: c.color } : null;
        })(),
        hideNext: cfg.hideNext,
        next: cfg.algorithm === 'rr' && live.length ? live[lbA.rr % live.length].label : null,
        conns: live.map((s) => ({ id: s.id, label: s.label, n: lbA.conns.get(s.id) ?? 0 })),
        labels,
        pools,
      };
    }

    let tour: TourView | null = null;
    if (this.tour) {
      const tr = this.tour;
      let pt: Pt | null = null;
      const p = this.packets.find((q) => q.reqId === tr.reqId && (q.kind === 'req' || q.kind === 'res'));
      if (p) pt = this.packetPos(p);
      else if (tr.stage === 'processing') {
        const s = this.servers.get('s2');
        if (s) pt = { x: s.x, y: s.y - s.h / 2 };
      } else if (tr.stage === 'done') {
        const c = this.clients.get('alice');
        if (c) pt = { x: c.x, y: c.y - c.h / 2 };
      }
      if (pt) tour = { x: pt.x, y: pt.y, stage: tr.stage, lat: tr.lat };
    }

    const served = [...this.servers.values()]
      .filter((s) => !s.removing)
      .map((s) => ({ id: s.id, label: s.label, n: s.served, share: totalServed ? s.served / totalServed : 0 }));

    let redis: View['redis'] = null;
    if (this.redis) {
      redis = { ...this.redis, carts: cfg.sessions ? this.liveClients().map((c) => c.color) : [] };
    }

    return {
      w: this.w,
      h: this.h,
      orient: this.orient,
      compact: this.compact,
      unitCompact: this.unitCompact,
      boundary: this.boundary,
      showZones: cfg.showZones,
      wires,
      clients,
      servers,
      lbs,
      redis,
      packets,
      pending,
      effects,
      brain,
      tour,
      hud: {
        throughput: this.metrics.throughput(this.t),
        p95: this.metrics.p95(this.t),
        errRate: this.metrics.errRate(this.t),
        series: this.metrics.series,
        drops: this.metrics.drops,
        served,
      },
      cfg,
    };
  }
}
