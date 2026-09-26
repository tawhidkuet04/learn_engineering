import { SIG } from '@/lib/sim/colors';
import { clamp, type Curve } from '@/lib/sim/geometry';
import { PredictGame } from '@/lib/sim/predict';
import { mulberry32 } from '@/lib/sim/rng';
import { Sim, portCurve, type Box, type ScriptEvent, type WireSpec } from '@/lib/sim/Sim';
import { dbGeom, dbHeight } from './geom';

/* ------------------------------------------------------------------ */
/* Units and constants                                                 */
/* ------------------------------------------------------------------ */

/** Displayed time: one simulated second reads as this many milliseconds. */
export const MS_PER_S = 40;
export const toMs = (s: number) => Math.round(s * MS_PER_S);

export type Key = 'alice' | 'bob';
export const KEYS: Key[] = ['alice', 'bob'];
/** Every database starts from the same snapshot, taken at this log position. */
export const BASE_LSN = 100;
export const START: Record<Key, number> = { alice: 100, bob: 80 };

const HOP = 0.6; // app <-> database
const REPL = 0.75; // leader -> follower, before any extra delay
const ACK = 0.55; // follower -> leader flush confirmation
const CROSS = 1.9; // region <-> region (multi-leader)
const SVC = { read: 0.3, write: 0.36 };
const SLOTS = 2;
const QCAP = 8;
const HB_EVERY = 1;
export const HB_FALL = 3;
const RYW_WINDOW = 8;
const LOG_KEEP = 240;

export const WAL_WIRE = 'rgba(255,154,60,0.36)';
export const TERM_COLORS = [SIG.heavy, SIG.teal, SIG.lime, SIG.blue, SIG.pink];

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type Topo = 'single' | 'replicated' | 'naive' | 'multi' | 'leaderless' | 'seq';
export type Role = 'leader' | 'follower' | 'replica';
export type ReadFrom = 'leader' | 'followers' | 'all';
export type Ryw = 'off' | 'leader' | 'lsn';
export type Failover = 'off' | 'auto' | 'ask';
export type Scenario = 'none' | 'drift' | 'inspect' | 'stale' | 'ryw' | 'monotonic' | 'sync-down' | 'promote' | 'lost' | 'split' | 'multi' | 'quorum';

export interface ReplConfig {
  topo: Topo;
  /** Database nodes in the column (db1 starts as the leader) */
  dbs: number;
  apps: number;
  /** Background writes and reads per simulated second */
  writeRate: number;
  readRate: number;
  readFrom: ReadFrom;
  /** Which rows background writes touch */
  bgKeys: Key[];
  /** Fixed amounts for background writes (null = a random mix) */
  bgDelta: number[] | null;
  /** Synchronous replication: commits wait for a standby in syncNames */
  sync: boolean;
  syncNames: string[];
  syncMethod: 'first' | 'any';
  /** Extra one-way network delay per follower, simulated seconds */
  delays: Record<string, number>;
  /** Seconds a follower needs to replay one entry */
  applyTime: number;
  /** Is the leader streaming its log to followers? */
  ship: boolean;
  monitor: boolean;
  failover: Failover;
  fencing: boolean;
  ryw: Ryw;
  sticky: boolean;
  scenario: Scenario;
  tape: boolean;
  walLabels: boolean;
  terms: boolean;
  seqMode: 'async' | 'sync';
  quorumR: 1 | 2;
  /** Portrait: leave room at the bottom for a docked readout */
  strip: boolean;
}

export const DEFAULTS: ReplConfig = {
  topo: 'replicated',
  dbs: 3,
  apps: 1,
  writeRate: 0.8,
  readRate: 0,
  readFrom: 'followers',
  bgKeys: ['alice', 'bob'],
  bgDelta: null,
  sync: false,
  syncNames: ['db2'],
  syncMethod: 'first',
  delays: {},
  applyTime: 0.12,
  ship: true,
  monitor: false,
  failover: 'off',
  fencing: true,
  ryw: 'off',
  sticky: false,
  scenario: 'none',
  tape: true,
  walLabels: true,
  terms: false,
  seqMode: 'async',
  quorumR: 2,
  strip: false,
};

export interface Row {
  v: number;
  lsn: number;
  ts: number;
  origin: string;
  ver: number;
}

/** One record in the replication log (write-ahead log / binlog). */
export interface Entry {
  lsn: number;
  key: Key;
  /** The row's new value (row-based replication ships the new row image) */
  v: number;
  term: number;
  tw: number;
  origin: string;
  note: string;
  /** The leader decided to commit it (and sent COMMIT to the client) */
  committed: boolean;
  /** The client actually received the COMMIT */
  confirmed: boolean;
  /** Confirmed to a client, then lost in a failover */
  lost: boolean;
  /** Written but never confirmed; discarded in a failover */
  orphan: boolean;
  /** Accepted by a deposed leader during split brain */
  forked: boolean;
}

export type Who = 'bg' | 'alice' | 'app2';

export interface Req {
  id: number;
  kind: 'read' | 'write';
  app: string;
  target: string;
  key: Key;
  delta?: number;
  set?: number;
  who: Who;
  t0: number;
  label?: string;
  note?: string;
  minLsn?: number;
  color?: string;
}

export interface Db {
  id: string;
  n: number;
  label: string;
  ip: string;
  role: Role;
  up: boolean;
  term: number;
  source: string | null;
  /** Just restarted and checking who leads before accepting anything */
  fenced: boolean;
  base: Record<Key, Row>;
  baseLsn: number;
  log: Entry[];
  /** Last log position held (written or received, contiguous) */
  head: number;
  /** Last log position replayed into the table */
  applied: number;
  data: Record<Key, Row>;
  applyQ: Entry[];
  applyLeft: number;
  ooo: Map<number, Entry>;
  /** Log positions currently in flight to this follower */
  inflight: Set<number>;
  delay: number;
  linkLast: number;
  acks: Record<string, number>;
  pending: { e: Entry; req: Req }[];
  inService: { req: Req; left: number }[];
  queue: Req[];
  waiting: Req[];
  flash: Partial<Record<Key, number>>;
  conflict: Partial<Record<Key, number>>;
  tapeVt: number;
}

export interface App {
  id: string;
  label: string;
  ip: string;
  /** Explicit write target (a stale connection string); null = whoever leads */
  target: string | null;
}

export interface AliceRead {
  v: number;
  db: string;
  stale: boolean;
  back: boolean;
}

export interface Conflict {
  round: number;
  us: number;
  eu: number;
  winner: 'us' | 'eu';
  lostNote: string;
  final: number;
}

interface Metrics {
  readT: number[];
  commitT: number[];
  readLat: number[];
  commitLat: number[];
  errors: number;
  writeErrors: number;
  reads: number;
  stale: number;
  aliceReads: number;
  aliceStale: number;
  aliceLat: number | null;
  lost: number;
  backJumps: number;
  commits: number;
  backupLost: number;
  peakRead: number;
}

const newMetrics = (): Metrics => ({
  readT: [],
  commitT: [],
  readLat: [],
  commitLat: [],
  errors: 0,
  writeErrors: 0,
  reads: 0,
  stale: 0,
  aliceReads: 0,
  aliceStale: 0,
  aliceLat: null,
  lost: 0,
  backJumps: 0,
  commits: 0,
  backupLost: 0,
  peakRead: 0,
});

const startData = (t: number): Record<Key, Row> => ({
  alice: { v: START.alice, lsn: BASE_LSN, ts: t - 60, origin: 'base', ver: 7 },
  bob: { v: START.bob, lsn: BASE_LSN, ts: t - 60, origin: 'base', ver: 7 },
});

const cloneData = (d: Record<Key, Row>): Record<Key, Row> => ({ alice: { ...d.alice }, bob: { ...d.bob } });

export const money = (v: number) => `$${v}`;
export const signed = (d: number) => (d >= 0 ? `+$${d}` : `−$${-d}`);

/* ------------------------------------------------------------------ */
/* The simulation                                                      */
/* ------------------------------------------------------------------ */

/**
 * Database replication: app servers, a leader, followers and the
 * replication log that flows between them. The stage just draws this.
 */
export class ReplSim extends Sim {
  cfg: ReplConfig = { ...DEFAULTS, delays: {} };
  game: PredictGame | null = null;
  dbs = new Map<string, Db>();
  apps = new Map<string, App>();
  /** Layout order of the database column; order[0] is the leader's slot */
  order: string[] = [];
  leaderId: string | null = null;
  term = 1;
  mon = { results: [] as ('ok' | 'miss')[], missed: 0, dead: false, next: 0.3 };
  m: Metrics = newMetrics();
  alice = { lastLsn: 0, lastT: -99, expect: START.alice, round: 0, rr: 0, reads: [] as AliceRead[], lastSeen: null as number | null };
  lostEntries: Entry[] = [];
  conflicts: Conflict[] = [];
  quorum = { ver: 7, acks: 0, round: 0, result: null as null | { v: number; ver: number; stale: boolean; from: string[] } };
  /** The log entry the inspector card follows (step "streaming the log") */
  inspect: { lsn: number; from: string; to: string; flightId: number; landedAt: number | null } | null = null;
  /** Smoothed replication lag per follower, for meters that don't flicker */
  lagEma: Record<string, number> = {};
  private inspectNext = 0;
  private script0: ScriptEvent<ReplSim>[] = [];
  private seq = 1;
  private wAcc = 0.35;
  private rAcc = 0.1;
  private rr = 0;
  private flip = 0;
  private keyFlip = 0;
  private promoteN = 0;
  private sayVt: Record<string, number> = {};
  private multiRoundN = 0;

  constructor() {
    super();
    this.build();
  }

  /* ---------------- step lifecycle ---------------- */

  enter(cfg: ReplConfig, script: ScriptEvent<ReplSim>[] = [], opts: { reset?: boolean; predict?: number } = {}) {
    const topoChanged = cfg.topo !== this.cfg.topo || cfg.dbs !== this.cfg.dbs || cfg.apps !== this.cfg.apps;
    this.cfg = { ...cfg, delays: { ...cfg.delays }, syncNames: [...cfg.syncNames], bgKeys: [...cfg.bgKeys] };
    this.script0 = script;
    if (opts.reset || topoChanged || !this.dbs.size) this.build();
    else this.reconcile();
    this.game = opts.predict ? new PredictGame(this, opts.predict) : null;
    this.runScript(script);
    this.startScenario();
    this.rev++;
  }

  /** Rebuild the world with the current config and replay the step's script. */
  restart() {
    const needed = this.game?.needed;
    this.build();
    this.game = needed ? new PredictGame(this, needed) : null;
    this.runScript(this.script0);
    this.startScenario();
    this.rev++;
  }

  private build() {
    this.clearTransient();
    this.rng = mulberry32(42);
    const c = this.cfg;
    this.dbs.clear();
    this.apps.clear();
    this.term = 1;
    this.leaderId = null;
    this.m = newMetrics();
    this.lostEntries = [];
    this.conflicts = [];
    this.alice = { lastLsn: 0, lastT: -99, expect: START.alice, round: 0, rr: 0, reads: [], lastSeen: null };
    this.quorum = { ver: 7, acks: 0, round: 0, result: null };
    this.mon = { results: [], missed: 0, dead: false, next: this.t + 0.3 };
    this.inspect = null;
    this.inspectNext = 0;
    this.lagEma = {};
    this.wAcc = 0.35;
    this.rAcc = 0.1;
    this.rr = 0;
    this.flip = 0;
    this.keyFlip = 0;
    this.promoteN = 0;
    this.multiRoundN = 0;

    const want = new Set<string>();
    if (c.topo !== 'seq') {
      const n = c.topo === 'single' ? 1 : c.topo === 'multi' ? 2 : c.dbs;
      for (let i = 1; i <= n; i++) {
        const d = this.makeDb(i);
        this.dbs.set(d.id, d);
        want.add(d.id);
      }
      const na = c.topo === 'multi' ? 2 : c.apps;
      for (let i = 1; i <= na; i++) {
        const a = this.makeApp(i);
        this.apps.set(a.id, a);
        want.add(a.id);
      }
      if (c.monitor && c.topo === 'replicated') want.add('mon');
    }
    if (c.topo === 'single' || c.topo === 'replicated') {
      this.leaderId = 'db1';
      for (const d of this.dbs.values()) {
        d.role = d.id === 'db1' ? 'leader' : 'follower';
        d.source = d.id === 'db1' ? null : 'db1';
      }
    } else if (c.topo === 'multi') {
      for (const d of this.dbs.values()) d.role = 'leader';
    } else {
      for (const d of this.dbs.values()) d.role = 'replica';
    }
    this.order = [...this.dbs.keys()];
    this.applyDelays();
    for (const id of want) this.box(id);
    for (const id of [...this.boxes.keys()]) if (!want.has(id)) this.hide(id);
    this.relayout();
  }

  /** A step that keeps the world but changes knobs (no reset). */
  private reconcile() {
    const c = this.cfg;
    this.applyDelays();
    if (c.monitor && c.topo === 'replicated') this.box('mon');
    else if (this.boxes.has('mon')) this.hide('mon');
    if (c.ship) for (const f of this.followers()) this.catchUp(f);
    this.relayout();
  }

  private makeDb(i: number): Db {
    const topo = this.cfg.topo;
    const label = topo === 'multi' ? (i === 1 ? 'us-db' : 'eu-db') : topo === 'leaderless' ? `node-${i}` : `db-${i}`;
    return {
      id: `db${i}`,
      n: i,
      label,
      ip: topo === 'multi' ? (i === 1 ? '10.1.2.10' : '10.2.2.10') : `10.0.2.${10 + i}`,
      role: 'follower',
      up: true,
      term: 1,
      source: null,
      fenced: false,
      base: startData(this.t),
      baseLsn: BASE_LSN,
      log: [],
      head: BASE_LSN,
      applied: BASE_LSN,
      data: startData(this.t),
      applyQ: [],
      applyLeft: this.cfg.applyTime,
      ooo: new Map(),
      inflight: new Set(),
      delay: 0,
      linkLast: 0,
      acks: {},
      pending: [],
      inService: [],
      queue: [],
      waiting: [],
      flash: {},
      conflict: {},
      tapeVt: -10,
    };
  }

  private makeApp(i: number): App {
    const multi = this.cfg.topo === 'multi';
    return {
      id: `app${i}`,
      label: multi ? (i === 1 ? 'app · us' : 'app · eu') : `app-${i}`,
      ip: multi ? (i === 1 ? '10.1.1.11' : '10.2.1.11') : `10.0.1.${10 + i}`,
      target: null,
    };
  }

  private applyDelays() {
    for (const d of this.dbs.values()) d.delay = this.cfg.delays[d.id] ?? 0;
  }

  /* ---------------- knobs (the panel calls these) ---------------- */

  setWriteRate(v: number) {
    this.cfg = { ...this.cfg, writeRate: v };
    this.rev++;
  }

  setReadRate(v: number) {
    this.cfg = { ...this.cfg, readRate: v };
    this.rev++;
  }

  setDelay(id: string, v: number) {
    this.cfg = { ...this.cfg, delays: { ...this.cfg.delays, [id]: v } };
    const d = this.dbs.get(id);
    if (d) d.delay = v;
    this.rev++;
  }

  setReadFrom(v: ReadFrom) {
    this.cfg = { ...this.cfg, readFrom: v };
    this.rev++;
  }

  setRyw(v: Ryw) {
    this.cfg = { ...this.cfg, ryw: v };
    this.m.aliceStale = 0;
    this.m.aliceReads = 0;
    this.m.aliceLat = null;
    this.rev++;
  }

  setSticky(v: boolean) {
    this.cfg = { ...this.cfg, sticky: v };
    this.m.backJumps = 0;
    this.alice.reads = [];
    this.alice.lastSeen = null;
    this.rev++;
  }

  /** Commit policy. sync=false is plain asynchronous replication. */
  setSync(sync: boolean, names?: string[], method?: 'first' | 'any') {
    this.cfg = { ...this.cfg, sync, syncNames: names ?? this.cfg.syncNames, syncMethod: method ?? this.cfg.syncMethod };
    const L = this.leader();
    if (L) {
      if (!sync) {
        // Emptying synchronous_standby_names releases every waiting commit.
        const waiting = L.pending;
        L.pending = [];
        for (const p of waiting) this.commit(L, p.e, p.req);
      } else this.checkCommits(L);
    }
    this.rev++;
  }

  setFencing(v: boolean) {
    this.cfg = { ...this.cfg, fencing: v };
    this.rev++;
  }

  setFailover(v: Failover) {
    this.cfg = { ...this.cfg, failover: v };
    this.rev++;
  }

  setQuorumR(v: 1 | 2) {
    this.cfg = { ...this.cfg, quorumR: v };
    this.quorum.result = null;
    this.rev++;
  }

  setSeqMode(v: 'async' | 'sync') {
    this.cfg = { ...this.cfg, seqMode: v };
    this.runScript(this.script0);
    this.rev++;
  }

  /** Mode switch that replays the step from the start (e.g. async vs sync failover). */
  replayWith(patch: Partial<ReplConfig>) {
    this.cfg = { ...this.cfg, ...patch };
    this.restart();
  }

  /* ---------------- queries used by the view ---------------- */

  leader(): Db | null {
    return this.leaderId ? (this.dbs.get(this.leaderId) ?? null) : null;
  }

  followers(): Db[] {
    return this.order.map((id) => this.dbs.get(id)).filter((d): d is Db => !!d && d.role === 'follower');
  }

  followersOf(id: string): Db[] {
    return this.followers().filter((f) => f.source === id);
  }

  /** Nodes currently willing to accept writes as a leader. */
  leaderCount(): number {
    if (this.cfg.topo !== 'replicated') return this.cfg.topo === 'multi' ? 2 : 1;
    return [...this.dbs.values()].filter((d) => d.up && d.role === 'leader' && !d.fenced).length;
  }

  /** How far behind a follower is, in simulated seconds (0 when caught up). */
  lagOf(f: Db): number {
    const L = f.source ? this.dbs.get(f.source) : null;
    if (!L) return 0;
    for (const e of L.log) {
      if (e.lsn > f.applied && !e.lost && !e.orphan) return Math.max(0, this.t - e.tw);
    }
    return 0;
  }

  behind(f: Db): number {
    const L = f.source ? this.dbs.get(f.source) : null;
    return L ? Math.max(0, L.head - f.applied) : 0;
  }

  /** pg_stat_replication's sync_state for a follower. */
  syncStateOf(f: Db): 'sync' | 'potential' | 'quorum' | 'async' {
    const c = this.cfg;
    if (!c.sync || !c.syncNames.includes(f.id)) return 'async';
    if (c.syncMethod === 'any') return 'quorum';
    const L = this.leader();
    const live = c.syncNames.find((id) => {
      const x = this.dbs.get(id);
      return !!x && x.up && x.role === 'follower' && x.source === L?.id;
    });
    return live === f.id ? 'sync' : 'potential';
  }

  /** Oldest write waiting for a synchronous standby, in simulated seconds. */
  waitingFor(): number | null {
    const L = this.leader();
    if (!L || !L.pending.length) return null;
    return this.t - L.pending[0].req.t0;
  }

  rate(list: number[], win = 5) {
    const since = this.t - win;
    let n = 0;
    for (const x of list) if (x >= since) n++;
    return n / Math.min(win, Math.max(1, this.stepT));
  }

  p95(list: number[]): number | null {
    if (!list.length) return null;
    const s = [...list].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(0.95 * (s.length - 1) + 0.5))];
  }

  /** The follower the learner may click while a prediction waits. */
  canPick(id: string): boolean {
    const q = this.game?.pending;
    if (!q || q.choices) return false;
    const d = this.dbs.get(id);
    return !!d && d.up && d.role === 'follower';
  }

  truthOf(key: Key): number {
    const L = this.leader() ?? this.dbs.get('db1');
    return L ? L.data[key].v : START[key];
  }

  /* ---------------- layout ---------------- */

  /** Room to the right of the column for the replication arcs. */
  arcRoom() {
    return this.orient === 'portrait' ? 30 : 64;
  }

  protected layout() {
    const c = this.cfg;
    if (c.topo === 'seq') return;
    if (c.topo === 'multi') {
      this.layoutRegions();
      return;
    }
    const { w, h } = this;
    const P = this.orient === 'portrait';
    const ids = this.order.filter((id) => this.dbs.has(id));
    const n = Math.max(1, ids.length);
    const dbW = P ? clamp(w - 172, 150, 204) : this.compact ? 250 : 300;
    const dbH = dbHeight(P, c.tape);
    const gap = P ? 12 : n >= 4 ? 20 : 30;
    const lead = c.topo === 'replicated' && n > 1 ? (P ? 12 : 18) : 0;
    const top = P ? 80 : 92;
    const bottom = h - (P ? (c.strip ? 150 : 74) : 92);
    const total = n * dbH + (n - 1) * gap + lead;
    let y = Math.max(top, (top + bottom) / 2 - total / 2);
    const xDb = P ? w - 12 - this.arcRoom() - dbW / 2 : Math.round(w * 0.47);
    const ys: number[] = [];
    ids.forEach((id, i) => {
      this.place(id, xDb, y + dbH / 2, dbW, dbH);
      ys.push(y + dbH / 2);
      y += dbH + gap + (i === 0 ? lead : 0);
    });

    // Left column: the monitor lines up with the leader, apps sit lower.
    const appW = P ? 96 : this.compact ? 130 : 150;
    const appH = P ? 38 : 46;
    const xL = P ? 10 + appW / 2 : Math.max(20 + appW / 2, xDb - dbW / 2 - (this.compact ? 84 : 118) - appW / 2);
    const hasMon = this.boxes.has('mon') && this.isLive('mon');
    const apps = [...this.apps.keys()];
    const colTop = ys[0] ?? h / 2;
    const colBot = ys[ys.length - 1] ?? h / 2;
    if (hasMon) this.place('mon', xL, colTop, appW, appH);
    const span0 = hasMon ? colTop + dbH / 2 + 30 : colTop;
    const mid = n === 1 ? colTop : (Math.max(span0, colTop) + colBot) / 2;
    const step = P ? appH + 26 : appH + 52;
    apps.forEach((id, i) => {
      const off = (i - (apps.length - 1) / 2) * step;
      this.place(id, xL, clamp(mid + off, top + appH / 2, bottom - appH / 2), appW, appH);
    });
  }

  private layoutRegions() {
    const { w, h } = this;
    const P = this.orient === 'portrait';
    const dbW = P ? clamp(w - 172, 150, 204) : 260;
    const dbH = dbHeight(P, false);
    const appW = P ? 96 : 150;
    const appH = P ? 38 : 46;
    if (!P) {
      const yA = h * 0.3;
      const yD = h * 0.58;
      this.place('app1', w * 0.26, yA, appW, appH);
      this.place('db1', w * 0.26, yD, dbW, dbH);
      this.place('app2', w * 0.74, yA, appW, appH);
      this.place('db2', w * 0.74, yD, dbW, dbH);
    } else {
      const xD = w - 12 - dbW / 2;
      const y1 = 132;
      const y2 = h * 0.42 + 96;
      this.place('app1', 10 + appW / 2, y1, appW, appH);
      this.place('db1', xD, y1, dbW, dbH);
      this.place('app2', 10 + appW / 2, y2, appW, appH);
      this.place('db2', xD, y2, dbW, dbH);
    }
  }

  /** Where the region boundary sits (multi-leader). */
  regionLine(): number {
    return this.orient === 'portrait' ? this.h * 0.42 : this.w / 2;
  }

  /* ---------------- wires and curves ---------------- */

  protected wires(): WireSpec[] {
    const c = this.cfg;
    const out: WireSpec[] = [];
    if (c.topo === 'seq') return out;
    for (const app of this.apps.values()) {
      for (const d of this.dbs.values()) {
        if (!this.appTalksTo(app, d)) continue;
        out.push({ from: app.id, to: d.id, state: d.up ? 'normal' : 'down' });
      }
    }
    if (c.topo === 'replicated') {
      for (const f of this.dbs.values()) {
        if (f.role !== 'follower' || !f.source) continue;
        const s = this.dbs.get(f.source);
        if (!s) continue;
        const ok = f.up && s.up;
        if (!c.ship) out.push({ from: s.id, to: f.id, state: 'dim' });
        else out.push({ from: s.id, to: f.id, state: ok ? 'normal' : 'down', color: ok ? WAL_WIRE : undefined });
      }
    }
    if (c.topo === 'multi') out.push({ from: 'db1', to: 'db2', color: WAL_WIRE });
    if (c.monitor && this.leaderId && this.isLive('mon')) out.push({ from: 'mon', to: this.leaderId, state: 'control' });
    return out;
  }

  private appTalksTo(app: App, d: Db): boolean {
    const c = this.cfg;
    if (c.topo === 'naive' || c.topo === 'leaderless' || c.topo === 'single') return app.id === 'app1' || c.topo === 'naive';
    if (c.topo === 'multi') return (app.id === 'app1') === (d.id === 'db1');
    if (d.id === this.writeTarget(app)) return true;
    if (app.id !== 'app1') return false;
    const reads = c.readRate > 0 || c.scenario === 'stale' || c.scenario === 'ryw' || c.scenario === 'monotonic';
    if (!reads) return false;
    if (d.role === 'follower') return c.readFrom !== 'leader' || c.scenario === 'stale' || c.scenario === 'ryw' || c.scenario === 'monotonic';
    return c.readFrom !== 'followers';
  }

  protected curveFor(from: string, to: string, lane: number): Curve | null {
    const a = this.boxes.get(from);
    const b = this.boxes.get(to);
    if (!a || !b || Number.isNaN(a.x) || Number.isNaN(b.x)) return null;
    if (this.cfg.topo === 'replicated' && from.startsWith('db') && to.startsWith('db')) return this.arc(a, b, lane);
    if (from === 'mon' || to === 'mon') return this.monCurve(a, b, lane, from === 'mon');
    return portCurve(a, b, lane);
  }

  /** A point on the replication arc between two databases at progress k (0..1), plus how far right the arc bulges. */
  arcPoint(from: string, to: string, k: number) {
    const c = this.curveFor(from, to, 0);
    if (!c) return null;
    const u = 1 - k;
    const x = u * u * u * c.p0.x + 3 * u * u * k * c.p1.x + 3 * u * k * k * c.p2.x + k * k * k * c.p3.x;
    const y = u * u * u * c.p0.y + 3 * u * u * k * c.p1.y + 3 * u * k * k * c.p2.y + k * k * k * c.p3.y;
    return { x, y, maxX: 0.25 * c.p0.x + 0.75 * c.p1.x };
  }

  /** Replication arcs bulge out to the right of the column, plugging into the log tapes. */
  private arc(a: Box, b: Box, lane: number): Curve {
    const P = this.orient === 'portrait';
    const tape = this.cfg.tape;
    const yOf = (bx: Box) => (tape ? bx.y - bx.h / 2 + dbGeom(bx.w, P).tapeMid : bx.y);
    const ya = yOf(a);
    const yb = yOf(b);
    const xa = a.x + a.w / 2;
    const xb = b.x + b.w / 2;
    const dy = Math.abs(yb - ya);
    const bulge = clamp((P ? 9 : 20) + dy * (P ? 0.075 : 0.13), 8, this.arcRoom() - 4) + lane;
    const k = bulge / 0.75;
    return { p0: { x: xa, y: ya }, p1: { x: xa + k, y: ya }, p2: { x: xb + k, y: yb }, p3: { x: xb, y: yb } };
  }

  /** Heartbeats plug into the upper left of the node they watch. */
  private monCurve(a: Box, b: Box, lane: number, fromMon: boolean): Curve {
    const m = fromMon ? a : b;
    const d = fromMon ? b : a;
    const p0 = { x: m.x + m.w / 2, y: m.y + lane };
    const p3 = { x: d.x - d.w / 2, y: d.y - d.h * 0.24 + lane };
    const k = Math.max(20, (p3.x - p0.x) * 0.5);
    const c = { p0, p1: { x: p0.x + k, y: p0.y }, p2: { x: p3.x - k, y: p3.y }, p3 };
    return fromMon ? c : { p0: c.p3, p1: c.p2, p2: c.p1, p3: c.p0 };
  }

  /* ---------------- the clock ---------------- */

  protected step(dt: number) {
    const c = this.cfg;
    if (c.topo === 'seq') return;
    if (c.writeRate > 0) {
      this.wAcc += dt * c.writeRate;
      while (this.wAcc >= 1) {
        this.wAcc -= 0.75 + this.rng() * 0.5;
        this.bgWrite();
      }
    }
    if (c.readRate > 0) {
      this.rAcc += dt * c.readRate;
      while (this.rAcc >= 1) {
        this.rAcc -= 0.7 + this.rng() * 0.6;
        this.bgRead();
      }
    }
    for (const d of this.dbs.values()) this.work(d, dt);
    if (c.monitor && c.topo === 'replicated' && this.isLive('mon')) this.heartbeat();
    const ins = this.inspect;
    if (ins && ins.landedAt == null && !this.flights.some((f) => f.id === ins.flightId)) this.inspect = { ...ins, landedAt: this.t };
    else if (ins?.landedAt != null && this.t - ins.landedAt > 1.3) {
      this.inspect = null;
      this.inspectNext = this.t + 0.2;
    }
    this.prune();
  }

  /** Visual-only smoothing (runs while paused too). */
  protected animate(dt: number) {
    const k = 1 - Math.exp(-3.2 * dt);
    for (const f of this.dbs.values()) {
      const target = f.role === 'follower' && f.up ? this.lagOf(f) : 0;
      const cur = this.lagEma[f.id] ?? target;
      this.lagEma[f.id] = cur + (target - cur) * k;
    }
  }

  lagView(id: string) {
    return this.lagEma[id] ?? 0;
  }

  maxLagView() {
    let m = 0;
    for (const f of this.followers()) if (f.up) m = Math.max(m, this.lagView(f.id));
    return m;
  }

  private prune() {
    const since = this.t - 6;
    const m = this.m;
    if (m.readT.length > 60) m.readT = m.readT.filter((x) => x >= since);
    if (m.commitT.length > 60) m.commitT = m.commitT.filter((x) => x >= since);
    if (m.readLat.length > 40) m.readLat = m.readLat.slice(-40);
    if (m.commitLat.length > 8) m.commitLat = m.commitLat.slice(-8);
  }

  /* ---------------- traffic ---------------- */

  writeTarget(app: App): string {
    if (this.cfg.topo === 'multi') return app.id === 'app1' ? 'db1' : 'db2';
    return app.target ?? this.leaderId ?? '';
  }

  private bgWrite() {
    const c = this.cfg;
    if (c.topo === 'naive' || c.topo === 'leaderless' || c.topo === 'multi') return;
    const apps = [...this.apps.values()];
    if (!apps.length) return;
    const app = apps[this.flip++ % apps.length];
    const key = c.bgKeys[this.keyFlip++ % c.bgKeys.length];
    const target = this.writeTarget(app);
    const cur = this.dbs.get(target)?.data[key].v ?? this.truthOf(key);
    const delta = this.pickDelta(cur);
    this.request({ kind: 'write', app: app.id, target, key, delta, who: app.id === 'app2' ? 'app2' : 'bg', note: `${key} ${signed(delta)}` });
  }

  private pickDelta(cur: number) {
    const fixed = this.cfg.bgDelta;
    if (fixed?.length) return fixed[Math.floor(this.rng() * fixed.length)];
    const amounts = [10, 15, 20, 25, 30, 40];
    const a = amounts[Math.floor(this.rng() * amounts.length)];
    let sign = this.rng() < 0.42 ? -1 : 1;
    if (cur - a < 20) sign = 1;
    if (cur + a > 400) sign = -1;
    return sign * a;
  }

  private bgRead() {
    const app = this.apps.get('app1');
    if (!app) return;
    const target = this.readTarget(app);
    if (!target) return;
    const key = KEYS[this.rng() < 0.5 ? 0 : 1];
    this.request({ kind: 'read', app: app.id, target, key, who: 'bg' });
  }

  private readTarget(app: App): string {
    const c = this.cfg;
    const leader = this.writeTarget(app);
    if (c.topo === 'single') return leader;
    const fs = this.followers()
      .filter((f) => f.up)
      .map((f) => f.id);
    if (c.readFrom === 'leader' || !fs.length) return leader;
    if (c.readFrom === 'all') {
      const all = [leader, ...fs].filter(Boolean);
      return all[this.rr++ % all.length];
    }
    return fs[this.rr++ % fs.length];
  }

  private request(o: Omit<Req, 'id' | 't0'>): Req {
    const req: Req = { ...o, id: this.seq++, t0: this.t };
    if (!req.target || !this.dbs.has(req.target) || !this.isLive(req.target)) {
      this.failReq(req, 'no leader to write to');
      return req;
    }
    const bg = req.who === 'bg';
    const color = req.color ?? (req.kind === 'write' ? SIG.heavy : SIG.req);
    this.send({ from: req.app, to: req.target, dur: HOP, color, r: bg ? 3.5 : 4.6, label: req.label, onArrive: () => this.arrive(req) });
    return req;
  }

  private failReq(req: Req, why: string) {
    this.m.errors++;
    if (req.kind === 'write') this.m.writeErrors++;
    if (this.isLive(req.app)) {
      const b = this.boxes.get(req.app);
      this.fx({ kind: 'x', at: { id: req.app, dx: b ? b.w / 2 + 8 : 0 }, color: SIG.err, dur: 0.8 });
      this.sayOnce(req.app, why, SIG.err);
    }
    this.rev++;
  }

  /**
   * Floating label above a box, nudged sideways so it never leaves the stage.
   * On phones the column is tight: labels on lower app servers go below them,
   * and labels on databases hug their own lid instead of the node above.
   */
  say(id: string, text: string, color: string = SIG.text, dur = 1.4) {
    const b = this.boxes.get(id);
    const half = (text.length * 6.5 + 18) / 2;
    let dx = 0;
    let dy = -(b?.h ?? 20) / 2 - 12;
    if (b && !Number.isNaN(b.x)) {
      if (b.x - half < 8) dx = 8 + half - b.x;
      else if (b.x + half > this.w - 8) dx = this.w - 8 - half - b.x;
      if (this.orient === 'portrait') {
        const appAbove = id.startsWith('app') && [...this.apps.keys()].some((a) => a !== id && (this.boxes.get(a)?.ty ?? Infinity) < b.ty);
        if (appAbove) dy = b.h / 2 + 34;
        else if (this.dbs.has(id) && this.order.indexOf(id) > 0) dy = -b.h / 2 + 7;
      }
    }
    this.fx({ kind: 'text', at: { id, dx, dy }, text, color, dur });
  }

  /** A floating label, at most once every ~1.6 s per node (so errors don't spam). */
  private sayOnce(id: string, text: string, color: string) {
    const last = this.sayVt[id] ?? -10;
    if (this.vt - last < 1.6) return;
    this.sayVt[id] = this.vt;
    this.say(id, text, color, 1.5);
  }

  private arrive(req: Req) {
    const d = this.dbs.get(req.target);
    if (!d || !d.up) {
      const b = this.boxes.get(req.target);
      this.fx({ kind: 'x', at: { id: req.target, dx: b ? -b.w / 2 - 6 : 0 }, color: SIG.err, dur: 0.9 });
      this.failReq(req, 'connection refused');
      return;
    }
    if (req.kind === 'write' && !this.writable(d)) {
      this.rejectReadOnly(d, req);
      return;
    }
    if (d.queue.length >= QCAP) {
      const b = this.boxes.get(d.id);
      this.fx({ kind: 'x', at: { id: d.id, dx: b ? -b.w / 2 - 10 : 0 }, color: SIG.err, dur: 0.8 });
      this.failReq(req, 'too many connections');
      return;
    }
    d.queue.push(req);
  }

  private writable(d: Db) {
    const topo = this.cfg.topo;
    if (topo === 'replicated' || topo === 'single') return d.role === 'leader' && !d.fenced;
    return true;
  }

  private rejectReadOnly(d: Db, req: Req) {
    this.send({
      from: d.id,
      to: req.app,
      dur: HOP,
      color: SIG.err,
      r: 4,
      label: req.who === 'bg' ? undefined : 'read-only',
      onArrive: () => {
        this.failReq(req, 'read-only replica');
        const app = this.apps.get(req.app);
        // With fencing the app is told who leads now and reconnects there.
        if (app && app.target && this.cfg.fencing) {
          app.target = null;
          this.say(app.id, `switches to ${this.leader()?.label ?? 'the leader'}`, SIG.res, 1.8);
        }
      },
    });
  }

  /** Database work: run queries, then replay replicated entries in order. */
  private work(d: Db, dt: number) {
    if (!d.up) return;
    if (d.inService.length) {
      for (const s of d.inService) s.left -= dt;
      const done = d.inService.filter((s) => s.left <= 0);
      if (done.length) {
        d.inService = d.inService.filter((s) => s.left > 0);
        for (const s of done) this.execute(d, s.req);
      }
    }
    while (d.inService.length < SLOTS && d.queue.length) {
      const req = d.queue.shift()!;
      d.inService.push({ req, left: req.kind === 'write' ? SVC.write : SVC.read });
    }
    if (d.applyQ.length) {
      d.applyLeft -= dt;
      while (d.applyLeft <= 0 && d.applyQ.length) {
        this.applyEntry(d, d.applyQ.shift()!);
        d.applyLeft += this.cfg.applyTime;
      }
      if (!d.applyQ.length) d.applyLeft = this.cfg.applyTime;
    }
  }

  private execute(d: Db, req: Req) {
    if (req.kind === 'write') {
      this.write(d, req);
      return;
    }
    if (req.minLsn != null && d.applied < req.minLsn) {
      d.waiting.push(req);
      this.rev++;
      return;
    }
    if (this.cfg.scenario === 'stale' && req.who === 'alice' && this.game && !this.game.done) {
      this.askStale(d, req);
      return;
    }
    this.answerRead(d, req);
  }

  /* ---------------- writes, the log, commits ---------------- */

  private write(d: Db, req: Req) {
    const c = this.cfg;
    if (!this.writable(d)) {
      this.rejectReadOnly(d, req);
      return;
    }
    const row = d.data[req.key];
    const v = req.set ?? row.v + (req.delta ?? 0);
    if (c.topo === 'naive') {
      d.data[req.key] = { v, lsn: row.lsn, ts: this.t, origin: req.app, ver: row.ver + 1 };
      d.flash[req.key] = this.vt;
      this.rev++;
      return;
    }
    const e = this.append(d, req.key, v, req.note ?? `${req.key} = ${money(v)}`);
    if (c.topo === 'replicated' && c.ship) {
      this.followersOf(d.id).forEach((f, i) => {
        const fl = this.ship(d, f, e);
        if (i === 0 && fl && c.scenario === 'inspect' && !this.inspect && this.t >= this.inspectNext) {
          this.inspect = { lsn: e.lsn, from: d.id, to: f.id, flightId: fl.id, landedAt: null };
        }
      });
    }
    if (c.topo === 'multi') {
      const other = [...this.dbs.values()].find((x) => x !== d);
      if (other) this.shipRemote(d, other, e);
    }
    if (this.needsSync(d)) {
      d.pending.push({ e, req });
      this.checkCommits(d);
      if (d.pending.some((p) => p.e === e)) this.onBlocked(d);
      return;
    }
    this.commit(d, e, req);
  }

  /** The leader writes the change to its log (and its table) before anything else. */
  private append(d: Db, key: Key, v: number, note: string): Entry {
    const e: Entry = {
      lsn: d.head + 1,
      key,
      v,
      term: d.term,
      tw: this.t,
      origin: d.id,
      note,
      committed: false,
      confirmed: false,
      lost: false,
      orphan: false,
      forked: this.cfg.topo === 'replicated' && d.id !== this.leaderId,
    };
    d.log.push(e);
    d.head = e.lsn;
    this.applyEntry(d, e);
    d.tapeVt = this.vt;
    this.trim(d);
    return e;
  }

  private needsSync(d: Db) {
    const c = this.cfg;
    return c.sync && c.topo === 'replicated' && d.id === this.leaderId && c.syncNames.length > 0;
  }

  /** Highest log position a synchronous standby has confirmed (-1: none connected). */
  private syncLsn(d: Db): number {
    const c = this.cfg;
    const live = c.syncNames
      .map((id) => this.dbs.get(id))
      .filter((f): f is Db => !!f && f.up && f.role === 'follower' && f.source === d.id);
    if (!live.length) return -1;
    if (c.syncMethod === 'any') return Math.max(...live.map((f) => d.acks[f.id] ?? 0));
    return d.acks[live[0].id] ?? 0;
  }

  private checkCommits(d: Db) {
    if (!d.pending.length) return;
    const ok = this.syncLsn(d);
    while (d.pending.length && d.pending[0].e.lsn <= ok) {
      const p = d.pending.shift()!;
      this.commit(d, p.e, p.req);
    }
    this.rev++;
  }

  private commit(d: Db, e: Entry, req: Req) {
    e.committed = true;
    const bg = req.who === 'bg';
    this.send({
      from: d.id,
      to: req.app,
      dur: HOP,
      color: SIG.res,
      r: bg ? 3 : 4.2,
      label: bg || req.who === 'app2' ? undefined : 'COMMIT',
      onArrive: () => this.committed(req, e),
      // The leader died before the client heard back: the client sees an error, not a confirmation.
      onLost: () => this.failReq(req, 'connection lost'),
    });
  }

  private committed(req: Req, e: Entry) {
    e.confirmed = true;
    this.m.commitT.push(this.t);
    this.m.commitLat.push(this.t - req.t0);
    this.m.commits++;
    if (req.who === 'alice' && (this.cfg.scenario === 'stale' || this.cfg.scenario === 'ryw')) this.aliceCommitted(e);
    this.rev++;
  }

  private onBlocked(d: Db) {
    if (this.cfg.scenario !== 'sync-down' || !this.game || this.game.done || this.game.pending) return;
    if (this.syncLsn(d) >= 0) return;
    const name = this.cfg.syncNames.map((id) => this.dbs.get(id)?.label ?? id).join(', ');
    this.game.ask({
      acceptable: ['wait'],
      choices: [
        { id: 'commit', label: 'Commits right away' },
        { id: 'wait', label: `Waits for ${name}` },
        { id: 'error', label: 'Fails with an error' },
      ],
      ask: 'What happens to this write?',
      askAt: { id: d.id },
      explain: (picked) =>
        picked === 'wait'
          ? `The leader promised never to confirm a write until ${name} has it. So it wrote the change locally and now it waits. Every write after it waits too.`
          : picked === 'commit'
            ? `That's what async would do. In sync mode the leader has promised not to confirm until ${name} has a copy, so the write just waits.`
            : `Postgres doesn't give up or return an error. The write is already in the leader's log; the COMMIT just waits until ${name} confirms it.`,
    });
  }

  /* ---------------- shipping the log ---------------- */

  private ship(from: Db, to: Db, e: Entry, gap = 0.12) {
    if (!from.up || !to.up) return null;
    const senderTerm = from.term;
    to.inflight.add(e.lsn);
    const at = Math.max(this.t + REPL + to.delay, to.linkLast + gap);
    to.linkLast = at;
    return this.send({
      from: from.id,
      to: to.id,
      dur: at - this.t,
      color: SIG.heavy,
      shape: 'square',
      r: 3.6,
      lane: 0,
      tag: 'wal',
      label: this.cfg.walLabels && this.orient === 'landscape' ? `#${e.lsn}` : undefined,
      onArrive: () => {
        to.inflight.delete(e.lsn);
        this.receive(to, e, from.id, senderTerm);
      },
      onLost: () => to.inflight.delete(e.lsn),
    });
  }

  /** senderTerm is the leader's term when it shipped the entry (entries themselves may be older). */
  private receive(f: Db, e: Entry, fromId: string, senderTerm: number) {
    if (!f.up || f.role !== 'follower' || f.source !== fromId) return;
    if (this.cfg.fencing && senderTerm < f.term) {
      this.fx({ kind: 'x', at: { id: f.id }, color: SIG.err });
      return;
    }
    if (e.lsn <= f.head) return;
    if (e.lsn > f.head + 1) {
      f.ooo.set(e.lsn, e);
      return;
    }
    this.accept(f, e);
    let nx = f.ooo.get(f.head + 1);
    while (nx) {
      f.ooo.delete(nx.lsn);
      this.accept(f, nx);
      nx = f.ooo.get(f.head + 1);
    }
  }

  private accept(f: Db, e: Entry) {
    f.log.push(e);
    f.head = e.lsn;
    f.applyQ.push(e);
    f.tapeVt = this.vt;
    this.trim(f);
    const L = f.source ? this.dbs.get(f.source) : null;
    if (L && this.cfg.sync && this.cfg.syncNames.includes(f.id)) {
      const lsn = e.lsn;
      this.send({
        from: f.id,
        to: L.id,
        dur: ACK + f.delay * 0.5,
        color: SIG.res,
        r: 2.6,
        lane: -7,
        tag: 'ack',
        onArrive: () => {
          if (!L.up) return;
          L.acks[f.id] = Math.max(L.acks[f.id] ?? 0, lsn);
          this.checkCommits(L);
        },
      });
    }
    this.rev++;
  }

  private applyEntry(d: Db, e: Entry) {
    const prev = d.data[e.key];
    d.data[e.key] = { v: e.v, lsn: e.lsn, ts: e.tw, origin: e.origin, ver: prev.ver + 1 };
    d.applied = Math.max(d.applied, e.lsn);
    d.flash[e.key] = this.vt;
    if (d.waiting.length) {
      const ready = d.waiting.filter((r) => (r.minLsn ?? 0) <= d.applied);
      if (ready.length) {
        d.waiting = d.waiting.filter((r) => !ready.includes(r));
        for (const r of ready) this.answerRead(d, r);
      }
    }
    this.rev++;
  }

  /** Stream everything a follower is missing (after a restart or a failover). */
  private catchUp(f: Db) {
    const L = f.source ? this.dbs.get(f.source) : null;
    if (!L || !L.up || !f.up || !this.cfg.ship) return;
    if (f.head < L.baseLsn) {
      // Too far behind for the retained log: re-copy the base snapshot.
      f.base = cloneData(L.base);
      f.baseLsn = L.baseLsn;
      f.log = [];
      f.head = f.applied = L.baseLsn;
      f.data = cloneData(L.base);
      f.applyQ = [];
    }
    f.linkLast = Math.max(f.linkLast, this.t);
    for (const e of L.log) {
      if (e.lsn <= f.head || e.lost || e.orphan || f.inflight.has(e.lsn) || f.ooo.has(e.lsn)) continue;
      this.ship(L, f, e, 0.1);
    }
  }

  /** Throw away log entries after lsn and rebuild the table (pg_rewind, roughly). */
  private rewind(d: Db, lsn: number) {
    d.log = d.log.filter((e) => e.lsn <= lsn);
    d.applyQ = d.applyQ.filter((e) => e.lsn <= lsn);
    d.ooo.clear();
    const data = cloneData(d.base);
    const upto = Math.min(lsn, d.applied);
    for (const e of d.log) if (e.lsn <= upto) data[e.key] = { v: e.v, lsn: e.lsn, ts: e.tw, origin: e.origin, ver: data[e.key].ver + 1 };
    d.data = data;
    d.head = d.log.length ? d.log[d.log.length - 1].lsn : d.baseLsn;
    d.applied = Math.min(upto, d.head);
    d.flash.alice = this.vt;
    d.flash.bob = this.vt;
  }

  private trim(d: Db) {
    while (d.log.length > LOG_KEEP && d.log[0].lsn <= d.applied) {
      const e = d.log.shift()!;
      d.base[e.key] = { v: e.v, lsn: e.lsn, ts: e.tw, origin: e.origin, ver: d.base[e.key].ver + 1 };
      d.baseLsn = e.lsn;
    }
  }

  /* ---------------- reads ---------------- */

  private answerRead(d: Db, req: Req) {
    const row = { ...d.data[req.key] };
    const L = this.leader();
    const truth = L?.data[req.key];
    let stale = !!truth && d !== L && row.lsn < truth.lsn;
    if (req.who === 'alice' && (this.cfg.scenario === 'stale' || this.cfg.scenario === 'ryw')) stale = row.lsn < this.alice.lastLsn;
    this.send({
      from: d.id,
      to: req.app,
      dur: HOP,
      color: stale ? SIG.warn : SIG.res,
      r: req.who === 'bg' ? 3 : 4.2,
      label: req.who === 'bg' ? undefined : money(row.v),
      onArrive: () => this.readDone(req, d, row, stale),
    });
  }

  private readDone(req: Req, d: Db, row: Row, stale: boolean) {
    this.m.readT.push(this.t);
    this.m.readLat.push(this.t - req.t0);
    this.m.peakRead = Math.max(this.m.peakRead, this.t - req.t0);
    this.m.reads++;
    if (stale) this.m.stale++;
    if (req.who === 'alice') this.aliceGotRead(d, row, stale, this.t - req.t0);
    this.rev++;
  }

  /* ---------------- Alice: read-your-writes and monotonic reads ---------------- */

  private aliceDeposit() {
    const app = this.apps.get('app1');
    if (!app) return;
    this.request({ kind: 'write', app: app.id, target: this.writeTarget(app), key: 'alice', delta: 50, who: 'alice', label: '+$50', note: 'alice +$50 (deposit)' });
  }

  private aliceCommitted(e: Entry) {
    this.alice.lastLsn = e.lsn;
    this.alice.lastT = this.t;
    this.alice.expect = e.v;
    this.after(0.2, () => this.aliceRead());
  }

  private aliceReadTarget(): string {
    const c = this.cfg;
    const L = this.leaderId ?? 'db1';
    const fs = this.followers()
      .filter((f) => f.up)
      .map((f) => f.id);
    if (!fs.length) return L;
    if (c.scenario === 'stale') return this.alice.round % 2 === 0 ? (fs.includes('db3') ? 'db3' : fs[0]) : fs.includes('db2') ? 'db2' : fs[0];
    if (c.ryw === 'leader' && this.t - this.alice.lastT < RYW_WINDOW) return L;
    if (c.scenario === 'monotonic') {
      if (c.sticky) return fs.includes('db3') ? 'db3' : fs[fs.length - 1];
      return fs[Math.floor(this.rng() * fs.length)];
    }
    return fs[this.alice.rr++ % fs.length];
  }

  private aliceRead() {
    const minLsn = this.cfg.ryw === 'lsn' ? this.alice.lastLsn : undefined;
    this.request({ kind: 'read', app: 'app1', target: this.aliceReadTarget(), key: 'alice', who: 'alice', label: 'balance?', minLsn });
  }

  private aliceGotRead(d: Db, row: Row, stale: boolean, lat: number) {
    const s = this.cfg.scenario;
    if (s === 'monotonic') {
      const back = this.alice.lastSeen != null && row.v < this.alice.lastSeen;
      this.alice.reads = [...this.alice.reads, { v: row.v, db: d.label, stale, back }].slice(-5);
      this.alice.lastSeen = row.v;
      if (back) {
        this.m.backJumps++;
        this.say('app1', 'went back in time!', SIG.warn, 1.6);
      }
      this.after(1.1, () => this.aliceRead());
      return;
    }
    this.m.aliceReads++;
    this.m.aliceLat = lat;
    if (stale) this.m.aliceStale++;
    this.say('app1', stale ? `${money(row.v)}? where's my $50` : `${money(row.v)} ✓`, stale ? SIG.warn : SIG.res, 2.2);
    this.alice.round++;
    this.after(stale ? 4.2 : 3.4, () => this.aliceDeposit());
  }

  private askStale(d: Db, req: Req) {
    const lsn = this.alice.lastLsn;
    const stale = d.data.alice.lsn < lsn;
    const newV = this.alice.expect;
    const oldV = newV - 50;
    const asked = this.game!.ask({
      acceptable: [stale ? 'old' : 'new'],
      choices: [
        { id: 'new', label: `${money(newV)}, with the deposit` },
        { id: 'old', label: `${money(oldV)}, the old balance` },
      ],
      ask: `What does ${d.label} return?`,
      askAt: { id: d.id },
      explain: () =>
        stale
          ? `${d.label} has only replayed up to #${d.applied}. The deposit is #${lsn}, still on its way, so Alice sees ${money(oldV)}.`
          : `${d.label} has already replayed #${d.applied}, which includes the deposit (#${lsn}). Alice sees ${money(newV)}.`,
      resolve: () => this.answerRead(d, req),
    });
    if (!asked) this.answerRead(d, req);
  }

  /* ---------------- failures and failover ---------------- */

  crash(id: string) {
    const d = this.dbs.get(id);
    if (!d || !d.up) return;
    d.up = false;
    for (const r of [...d.queue, ...d.inService.map((s) => s.req), ...d.waiting]) this.failReq(r, 'connection lost');
    for (const p of d.pending) this.failReq(p.req, 'connection lost');
    d.queue = [];
    d.inService = [];
    d.waiting = [];
    d.pending = [];
    for (const f of this.flights) if (f.from === id) this.drop(f);
    this.fx({ kind: 'ring', at: { id }, color: SIG.err, size: 1.6 });
    this.say(id, 'crashed', SIG.err);
    if (id !== this.leaderId) {
      const L = this.leader();
      if (L) this.checkCommits(L);
    }
    this.rev++;
  }

  /** Power a node back on. What it does next depends on what happened while it was away. */
  revive(id: string) {
    const d = this.dbs.get(id);
    if (!d || d.up) return;
    d.up = true;
    d.queue = [];
    d.inService = [];
    d.linkLast = this.t;
    this.fx({ kind: 'ring', at: { id }, color: SIG.res, size: 1.4 });
    if (this.cfg.topo === 'replicated' && d.role === 'leader' && this.leaderId && this.leaderId !== id) {
      if (this.cfg.fencing) this.checkIn(d);
      else this.say(id, 'back: still the leader!', SIG.err, 2.4);
    } else if (d.role === 'follower') {
      this.say(id, 'back: catching up', SIG.res);
      this.catchUp(d);
      const L = this.leader();
      if (L) this.checkCommits(L);
    } else {
      this.say(id, 'back up', SIG.res);
      if (id === this.leaderId) {
        // The leader is back before anyone replaced it: heartbeats resume, followers pick up where they left off.
        this.mon.dead = false;
        this.mon.missed = 0;
        this.mon.results = [];
        this.mon.next = this.t + 0.3;
        for (const f of this.followersOf(id)) this.catchUp(f);
      }
    }
    this.rev++;
  }

  crashLeader() {
    if (this.leaderId) this.crash(this.leaderId);
  }

  /** Power every crashed node back on. */
  reviveDown() {
    for (const d of this.dbs.values()) if (!d.up) this.revive(d.id);
  }

  toggleDb(id: string) {
    const d = this.dbs.get(id);
    if (!d) return;
    if (d.up) this.crash(id);
    else this.revive(id);
  }

  /** A restarted ex-leader asks the coordinator who leads before accepting any write. */
  private checkIn(d: Db) {
    d.fenced = true;
    this.say(d.id, `term ${d.term}: am I leader?`, SIG.hc, 1.8);
    const reply = () => this.stepDown(d);
    if (this.isLive('mon')) {
      this.send({
        from: d.id,
        to: 'mon',
        dur: 0.55,
        color: SIG.hc,
        r: 3.4,
        lane: 3,
        label: `term ${d.term}?`,
        onArrive: () =>
          this.send({ from: 'mon', to: d.id, dur: 0.55, color: SIG.hc, r: 3.4, lane: -3, label: `term ${this.term}`, onArrive: reply }),
      });
    } else this.after(0.8, reply);
  }

  private stepDown(d: Db) {
    const L = this.leader();
    d.fenced = false;
    d.role = 'follower';
    d.term = this.term;
    d.source = L?.id ?? null;
    d.acks = {};
    d.pending = [];
    // Discard whatever the new leader never got (pg_rewind), then follow it.
    let keep = d.baseLsn;
    if (L) for (const e of d.log) if (L.log.some((x) => x.lsn === e.lsn && x.term === e.term && x.v === e.v && x.key === e.key)) keep = e.lsn;
    const dropped = d.log.filter((e) => e.lsn > keep).length;
    this.rewind(d, keep);
    this.say(d.id, dropped ? `steps down · rewinds ${dropped}` : 'steps down → follower', SIG.res, 2);
    d.linkLast = this.t;
    this.catchUp(d);
    this.rev++;
  }

  private heartbeat() {
    if (this.t < this.mon.next) return;
    this.mon.next = this.t + HB_EVERY;
    const L = this.leader();
    if (!L || this.mon.dead) return;
    const id = L.id;
    this.send({
      from: 'mon',
      to: id,
      dur: 0.42,
      color: SIG.hc,
      r: 2.6,
      lane: -3,
      tag: 'hb',
      trail: false,
      onArrive: () => {
        const d = this.dbs.get(id);
        if (d && d.up && this.leaderId === id) {
          this.send({ from: id, to: 'mon', dur: 0.42, color: SIG.hc, r: 2.6, lane: 3, tag: 'hb', trail: false, onArrive: () => this.hbResult(true) });
        } else {
          const b = this.boxes.get(id);
          this.fx({ kind: 'x', at: { id, dx: b ? -b.w / 2 - 4 : 0, dy: b ? -b.h * 0.24 : 0 }, color: SIG.hc, size: 0.7, dur: 0.8 });
          this.after(0.42, () => this.hbResult(false));
        }
      },
    });
  }

  private hbResult(ok: boolean) {
    const r = this.mon.results;
    r.push(ok ? 'ok' : 'miss');
    if (r.length > HB_FALL) r.shift();
    this.mon.missed = ok ? 0 : this.mon.missed + 1;
    if (!ok && this.mon.missed >= HB_FALL && !this.mon.dead) {
      this.mon.dead = true;
      this.leaderDead();
    }
    this.rev++;
  }

  private leaderDead() {
    const old = this.leader();
    this.say('mon', `${old?.label ?? 'leader'} declared dead`, SIG.err, 2.4);
    if (this.cfg.failover === 'off' || !old) return;
    let cands = this.followers().filter((f) => f.up && f.source === old.id);
    if (this.cfg.sync) {
      // Patroni's synchronous_mode: only a synchronous standby may be promoted.
      const syncOnes = cands.filter((f) => this.cfg.syncNames.includes(f.id));
      if (syncOnes.length) cands = syncOnes;
    }
    if (!cands.length) return;
    const max = Math.max(...cands.map((f) => f.head));
    const best = cands.filter((f) => f.head === max).map((f) => f.id);
    if (this.cfg.failover === 'ask' && this.game && !this.game.done) {
      const asked = this.game.ask({
        acceptable: best,
        ask: 'Which follower takes over?',
        askAt: { id: cands[0].id },
        explain: (picked, ok) => {
          const p = this.dbs.get(picked);
          const b = this.dbs.get(best[0])!;
          if (ok || !p) return `${b.label} has #${max}, the newest log position. Promoting it throws away the fewest writes.`;
          return `${p.label} only has #${p.head}, but ${b.label} has #${max}. Promoting ${p.label} would throw away ${max - p.head} write${max - p.head === 1 ? '' : 's'} that ${b.label} still has.`;
        },
        resolve: () => this.after(0.4, () => this.promote(best[0])),
      });
      if (asked) return;
    }
    this.after(0.9, () => this.promote(best[0]));
  }

  /** Make a follower the new leader: bump the term, repoint everyone, count what was lost. */
  promote(id: string, quiet = false) {
    const nu = this.dbs.get(id);
    const old = this.leader();
    if (!nu || !nu.up || nu === old) return;
    if (old && old.up) {
      // The leader came back before the failover finished: nothing to do.
      this.mon.dead = false;
      this.mon.missed = 0;
      return;
    }
    this.term += 1;
    while (nu.applyQ.length) this.applyEntry(nu, nu.applyQ.shift()!);
    nu.ooo.clear();
    nu.role = 'leader';
    nu.source = null;
    nu.term = this.term;
    nu.acks = {};
    nu.pending = [];
    nu.fenced = false;
    this.leaderId = id;
    this.mon.dead = false;
    this.mon.missed = 0;
    this.mon.results = [];
    this.mon.next = this.t + 0.6;
    if (old) {
      for (const e of old.log) {
        if (e.lsn <= nu.head || e.lost || e.orphan) continue;
        if (e.confirmed) {
          e.lost = true;
          this.m.lost++;
          this.lostEntries.push(e);
        } else e.orphan = true;
      }
    }
    for (const f of this.dbs.values()) {
      if (f === nu || f === old || f.role !== 'follower') continue;
      f.source = id;
      f.term = this.term;
      f.linkLast = this.t;
      f.ooo.clear();
      f.inflight.clear();
      if (f.head > nu.head) this.rewind(f, nu.head);
      this.catchUp(f);
    }
    if (this.cfg.sync) {
      // Patroni's synchronous mode re-points synchronous_standby_names at the new followers.
      const keep = this.cfg.syncNames.filter((n) => n !== id && n !== old?.id);
      const rest = this.followersOf(id)
        .map((f) => f.id)
        .filter((n) => !keep.includes(n));
      this.cfg = { ...this.cfg, syncNames: [...keep, ...rest].slice(0, Math.max(1, this.cfg.syncNames.length)) };
    }
    const i = this.order.indexOf(id);
    const j = old ? this.order.indexOf(old.id) : 0;
    if (i >= 0 && j >= 0 && i !== j) {
      const o = [...this.order];
      [o[i], o[j]] = [o[j], o[i]];
      this.order = o;
    }
    this.relayout();
    if (!quiet) {
      this.fx({ kind: 'ring', at: { id }, color: SIG.res, size: 1.8 });
      this.say(id, `promoted · term ${this.term}`, SIG.res, 2.2);
    }
    if (this.cfg.scenario === 'promote' && !quiet && old) this.after(6.5, () => this.nextPromoteRound(old.id));
    this.rev++;
  }

  /* ---------------- scenarios ---------------- */

  private startScenario() {
    const s = this.cfg.scenario;
    if (s === 'stale' || s === 'ryw') this.after(1.2, () => this.aliceDeposit());
    if (s === 'monotonic') this.after(1, () => this.aliceRead());
    if (s === 'drift') this.after(0.8, () => this.driftRound(0));
    if (s === 'promote') this.promoteRound();
    if (s === 'split') this.seedSplit();
    if (s === 'multi') this.after(1, () => this.multiRound());
    if (s === 'quorum') this.after(0.8, () => this.quorumRound());
  }

  /* Two app servers write the same row to every copy; the network reorders them. */
  private driftRound(r: number) {
    const x1 = 150 + ((r * 20) % 80);
    const x2 = 90 + ((r * 10) % 40);
    const pats = [
      [
        [0.5, 1.5, 0.9],
        [1.45, 0.5, 0.8],
      ],
      [
        [1.3, 0.55, 0.5],
        [0.5, 1.4, 1.1],
      ],
    ];
    const [p1, p2] = pats[r % 2];
    const ids = ['db1', 'db2', 'db3'];
    const go = (app: string, v: number, durs: number[], color: string) => {
      ids.forEach((id, i) => {
        if (!this.dbs.has(id)) return;
        this.send({
          from: app,
          to: id,
          dur: durs[i],
          color,
          r: 4.2,
          label: `alice=${money(v)}`,
          onArrive: () => {
            const d = this.dbs.get(id);
            if (!d) return;
            const row = d.data.alice;
            d.data.alice = { v, lsn: row.lsn, ts: this.t, origin: app, ver: row.ver + 1 };
            d.flash.alice = this.vt;
            this.rev++;
          },
        });
      });
    };
    go('app1', x1, p1, SIG.teal);
    this.after(0.15, () => go('app2', x2, p2, SIG.pink));
    this.after(2.2, () => {
      const vals = new Set([...this.dbs.values()].map((d) => d.data.alice.v));
      if (vals.size > 1) for (const d of this.dbs.values()) d.conflict.alice = this.vt;
      this.say('app1', vals.size > 1 ? 'copies disagree!' : 'copies agree', vals.size > 1 ? SIG.err : SIG.res, 2);
      this.rev++;
    });
    this.after(6.5, () => this.driftRound(r + 1));
  }

  private promoteRound() {
    const fs = this.followers();
    const pats = [
      [1.5, 0.12, 2.6],
      [2.5, 1.4, 0.12],
      [0.12, 2.6, 1.3],
    ];
    const pat = pats[this.promoteN % pats.length];
    fs.forEach((f, i) => {
      f.delay = pat[i % pat.length];
    });
    this.promoteN++;
    this.after(5.5, () => {
      if (this.leaderId) this.crash(this.leaderId);
    });
  }

  private nextPromoteRound(oldId: string) {
    this.revive(oldId);
    if (this.game && !this.game.done) this.after(1.8, () => this.promoteRound());
  }

  /** The state right after a failover: db-2 leads (term 2), db-1 is down with 2 writes nobody else has. */
  private seedSplit() {
    const d1 = this.dbs.get('db1');
    const d2 = this.dbs.get('db2');
    const d3 = this.dbs.get('db3');
    if (!d1 || !d2 || !d3) return;
    const deltas = [20, -15, 30, 10, -25, 15, 40, -10, 25, -20, 10, 15];
    const seedWrite = (L: Db, key: Key, delta: number, to: Db[], age: number) => {
      const e = this.append(L, key, L.data[key].v + delta, `${key} ${signed(delta)}`);
      e.tw = this.t - age;
      e.committed = true;
      e.confirmed = true;
      for (const f of to) {
        f.log.push(e);
        f.head = e.lsn;
        this.applyEntry(f, e);
      }
    };
    deltas.forEach((dl, i) => seedWrite(d1, KEYS[i % 2], dl, [d2, d3], 20 - i));
    seedWrite(d1, 'alice', 60, [], 5);
    seedWrite(d1, 'bob', -30, [], 4.5);
    d1.up = false;
    this.promote('db2', true);
    seedWrite(d2, 'alice', -40, [d3], 2);
    seedWrite(d2, 'bob', 25, [d3], 1);
    const app2 = this.apps.get('app2');
    if (app2) app2.target = 'db1';
    this.mon.next = this.t + 0.4;
    this.relayout();
    this.snap();
  }

  /* Multi-leader: both regions accept a deposit to the same row at nearly the same time. */
  private multiRound() {
    const r = this.multiRoundN++;
    const usFirst = r % 2 === 0;
    const us = () => this.request({ kind: 'write', app: 'app1', target: 'db1', key: 'alice', delta: 50, who: 'alice', label: '+$50', note: 'alice +$50 (us)' });
    const eu = () => this.request({ kind: 'write', app: 'app2', target: 'db2', key: 'alice', delta: 20, who: 'app2', label: '+$20', note: 'alice +$20 (eu)' });
    if (usFirst) {
      us();
      this.after(0.35, eu);
    } else {
      eu();
      this.after(0.35, us);
    }
    this.after(5.2, () => this.request({ kind: 'write', app: usFirst ? 'app2' : 'app1', target: usFirst ? 'db2' : 'db1', key: 'bob', delta: 10, who: 'bg', label: 'bob +$10', note: 'bob +$10' }));
    this.after(10, () => this.multiRound());
  }

  private shipRemote(from: Db, to: Db, e: Entry) {
    const at = Math.max(this.t + CROSS, to.linkLast + 0.15);
    to.linkLast = at;
    this.send({
      from: from.id,
      to: to.id,
      dur: at - this.t,
      color: SIG.heavy,
      shape: 'square',
      r: 3.6,
      lane: 5,
      tag: 'wal',
      label: `${e.key}=${money(e.v)}`,
      onArrive: () => this.receiveRemote(to, e),
    });
  }

  private receiveRemote(d: Db, e: Entry) {
    const local = d.data[e.key];
    const concurrent = local.origin === d.id && this.t - local.ts < CROSS + 0.4;
    const region = (id: string): 'us' | 'eu' => (id === 'db1' ? 'us' : 'eu');
    if (concurrent) {
      const remoteWins = e.tw > local.ts;
      const usV = d.id === 'db1' ? local.v : e.v;
      const euV = d.id === 'db1' ? e.v : local.v;
      const winner = remoteWins ? region(e.origin) : region(d.id);
      const round = this.multiRoundN;
      if (!this.conflicts.some((c) => c.round === round)) {
        const lostNote = winner === 'us' ? 'eu-west’s +$20' : 'us-east’s +$50';
        this.conflicts = [...this.conflicts, { round, us: usV, eu: euV, winner, lostNote, final: winner === 'us' ? usV : euV }].slice(-3);
      }
      d.conflict[e.key] = this.vt;
      if (remoteWins) {
        d.data[e.key] = { v: e.v, lsn: local.lsn, ts: e.tw, origin: e.origin, ver: local.ver + 1 };
        d.flash[e.key] = this.vt;
        this.say(d.id, 'conflict: newer write wins', SIG.warn, 2);
      } else this.say(d.id, 'conflict: keeps its own', SIG.warn, 2);
    } else {
      d.data[e.key] = { v: e.v, lsn: local.lsn, ts: e.tw, origin: e.origin, ver: local.ver + 1 };
      d.flash[e.key] = this.vt;
    }
    this.rev++;
  }

  /* Leaderless: write to every replica, wait for W acks; read from R and keep the newest. */
  private quorumRound() {
    const q = this.quorum;
    q.round++;
    q.ver++;
    q.acks = 0;
    q.result = null;
    const ver = q.ver;
    const v = 100 + q.round * 50;
    const durs: Record<string, number> = { db1: 0.6, db2: 0.75, db3: 0.9 };
    for (const d of this.dbs.values()) {
      const missed = d.id === 'db3';
      this.send({
        from: 'app1',
        to: d.id,
        dur: durs[d.id] ?? 0.8,
        color: SIG.heavy,
        r: 4.2,
        label: `v${ver}`,
        lostAt: missed ? 0.55 : null,
        onArrive: () => {
          if (ver > d.data.alice.ver) {
            d.data.alice = { v, lsn: 0, ts: this.t, origin: 'app1', ver };
            d.flash.alice = this.vt;
          }
          this.send({
            from: d.id,
            to: 'app1',
            dur: 0.55,
            color: SIG.res,
            r: 3,
            onArrive: () => {
              q.acks++;
              if (q.acks === 2 && q.ver === ver) {
                this.say('app1', 'W = 2 acks: write OK', SIG.res, 1.8);
              }
              this.rev++;
            },
          });
          this.rev++;
        },
      });
    }
    this.after(2.6, () => this.quorumRead());
    this.after(9, () => this.quorumRound());
  }

  private quorumRead() {
    const R = this.cfg.quorumR;
    // R = 1 asks a single replica: sometimes the one that missed the write, sometimes not.
    const targets = R === 2 ? ['db2', 'db3'] : [this.quorum.round % 2 === 1 ? 'db3' : 'db1'];
    const got: { id: string; v: number; ver: number }[] = [];
    for (const id of targets) {
      this.send({
        from: 'app1',
        to: id,
        dur: 0.6,
        color: SIG.req,
        r: 4.2,
        label: 'read',
        onArrive: () => {
          const d = this.dbs.get(id);
          if (!d) return;
          const row = { ...d.data.alice };
          this.send({
            from: id,
            to: 'app1',
            dur: 0.6,
            color: row.ver < this.quorum.ver ? SIG.warn : SIG.res,
            r: 4.2,
            label: `v${row.ver}`,
            onArrive: () => {
              got.push({ id, v: row.v, ver: row.ver });
              if (got.length === targets.length) this.quorumDone(got);
            },
          });
        },
      });
    }
  }

  private quorumDone(got: { id: string; v: number; ver: number }[]) {
    const best = got.reduce((a, b) => (b.ver > a.ver ? b : a));
    const stale = best.ver < this.quorum.ver;
    this.quorum.result = { v: best.v, ver: best.ver, stale, from: got.map((g) => this.dbs.get(g.id)?.label ?? g.id) };
    this.say('app1', stale ? `${money(best.v)} (v${best.ver}): stale!` : `newest: ${money(best.v)} (v${best.ver})`, stale ? SIG.warn : SIG.res, 2.2);
    for (const g of got) {
      if (g.ver >= best.ver) continue;
      this.send({
        from: 'app1',
        to: g.id,
        dur: 0.7,
        color: SIG.hc,
        r: 3.6,
        label: `repair v${best.ver}`,
        onArrive: () => {
          const d = this.dbs.get(g.id);
          if (d && best.ver > d.data.alice.ver) {
            d.data.alice = { v: best.v, lsn: 0, ts: this.t, origin: 'repair', ver: best.ver };
            d.flash.alice = this.vt;
            this.rev++;
          }
        },
      });
    }
    this.rev++;
  }

  /* ---------------- chapter 1: one database ---------------- */

  /** The disk died: bring the database back from last night's backup. */
  restoreBackup() {
    const d = this.dbs.get('db1');
    if (!d) return;
    const lostWrites = d.log.length;
    d.up = true;
    d.base = startData(this.t);
    d.baseLsn = BASE_LSN;
    d.log = [];
    d.head = d.applied = BASE_LSN;
    d.data = startData(this.t);
    d.flash.alice = this.vt;
    d.flash.bob = this.vt;
    d.queue = [];
    d.inService = [];
    this.m.backupLost += lostWrites;
    this.fx({ kind: 'ring', at: { id: 'db1' }, color: SIG.warn, size: 1.6 });
    this.say('db1', `restored: ${lostWrites} writes gone`, SIG.warn, 2.6);
    this.rev++;
  }

  /** Writes the single database has taken since the step began (they'd be lost with the disk). */
  writesSinceBackup() {
    return this.dbs.get('db1')?.log.length ?? 0;
  }
}
