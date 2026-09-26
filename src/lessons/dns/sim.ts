import { SIG } from '@/lib/sim/colors';
import type { Curve } from '@/lib/sim/geometry';
import { PredictGame } from '@/lib/sim/predict';
import { mulberry32 } from '@/lib/sim/rng';
import { Sim, portCurve, type FlightShape, type ScriptEvent, type WireSpec } from '@/lib/sim/Sim';
import {
  IP_NEW,
  IP_OLD,
  RESOLVER_IP,
  SERVERS,
  SERVER_IDS,
  STUB_RTT,
  ZONE_SERVER,
  answerFrom,
  buildZones,
  negTtl,
  parent,
  target,
  wireSize,
  type RR,
  type RRType,
  type Resp,
  type ServerId,
  type Zone,
} from './zones';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type View = 'flow' | 'tree' | 'seq' | 'move';
export type Transport = 'udp' | 'dot' | 'doh';
export type MsgKind = 'query' | 'referral' | 'answer' | 'cname' | 'nxdomain' | 'nodata' | 'trunc' | 'tcp' | 'http' | 'httpres';

export const USERS = ['u1', 'u2', 'u3'] as const;
export const MOVE_RESOLVERS = ['r1', 'r2', 'r3'] as const;
export const ALL_BOXES = ['laptop', 'bob', 'wifi', 'resolver', 'root', 'tld', 'auth', 'cdn', 'web', 'web2', 'com', 'org', 'dev', ...USERS, ...MOVE_RESOLVERS];
const CLIENTS = new Set(['laptop', 'bob', ...USERS]);
const RESOLVERS = new Set(['resolver', ...MOVE_RESOLVERS]);

export interface AutoItem {
  c: string;
  q: string;
  t?: RRType;
}

export interface AutoSpec {
  list: AutoItem[];
  /** Seconds between lookups (idle gap when `seq`) */
  every: number;
  first?: number;
  /** Wait for the previous lookup to finish */
  seq?: boolean;
  loop?: boolean;
  /** Empty the resolver's cache before each lookup */
  flush?: boolean;
  /** Pick randomly from the list instead of in order */
  random?: boolean;
  /** When the list wraps around, forget final answers (keep referrals) */
  wrapFlushAnswers?: boolean;
}

export interface DnsConfig {
  view: View;
  cast: string[];
  /** Slow motion multiplier for hops */
  pace: number;
  /** Pause at the resolver between steps of a lookup */
  think: number;
  resCache: boolean;
  stubCache: boolean;
  /** Hide the upstream walk: the resolver just thinks, then answers */
  blackBox: boolean;
  /** Message kinds that wait at their destination until released */
  holdKinds: MsgKind[];
  /** Follow every A answer with an HTTP request to that address */
  http: boolean;
  transport: Transport;
  clickDrop: boolean;
  predict: 'none' | 'hops' | 'first';
  labels: boolean;
  dig: boolean;
  /** Dig card shows transport details (ports, bytes) */
  wire: boolean;
  cacheTable: boolean;
  stubTable: boolean;
  /** What the phone's bottom dock shows */
  dock: 'dig' | 'cache' | 'zone' | 'snoop' | 'none';
  /** Show the authoritative server's zone file, highlighting the line that answers */
  zoneFile: boolean;
  auto: AutoSpec | null;
  resolverTitle: string;
  rootLetters: boolean;
  /** Stub resolver uses EDNS (bigger UDP answers, 11 more bytes per message); plain OS stubs usually don't */
  stubEdns: boolean;
  /** Seconds between each user's page loads in the move view */
  userEvery: number;
  /** The step shows HUD chips (the phone layout leaves room for them) */
  hasHud: boolean;
}

export const DEFAULTS: DnsConfig = {
  view: 'flow',
  cast: ['laptop', 'resolver', 'root', 'tld', 'auth'],
  pace: 1,
  think: 0.3,
  resCache: true,
  stubCache: false,
  blackBox: false,
  holdKinds: [],
  http: false,
  transport: 'udp',
  clickDrop: false,
  predict: 'none',
  labels: true,
  dig: false,
  wire: false,
  cacheTable: false,
  stubTable: false,
  dock: 'none',
  zoneFile: false,
  auto: null,
  resolverTitle: 'Recursive resolver',
  rootLetters: false,
  stubEdns: false,
  userEvery: 2.6,
  hasHud: false,
};

export interface Msg {
  seq: number;
  /** Position within its lookup (1-based) */
  n: number;
  lookup: number;
  kind: MsgKind;
  from: string;
  to: string;
  dnsId: number;
  qname: string;
  qtype: RRType;
  flags: string[];
  status: 'NOERROR' | 'NXDOMAIN';
  answer: RR[];
  authority: RR[];
  additional: RR[];
  /** TTLs as sent (cached copies count down) */
  ttls: number[];
  bytes: number;
  proto: 'udp' | 'tcp' | 'dot' | 'doh';
  sport: number;
  dport: number;
  ms?: number;
  cached?: boolean;
  label?: string;
}

export interface CacheEntry {
  id: number;
  name: string;
  /** 'ANY' for a cached NXDOMAIN */
  type: RRType | 'ANY';
  data: string;
  ttl: number;
  /** Simulated time the entry expires */
  exp: number;
  born: number;
  kind: 'ref' | 'glue' | 'ans' | 'cname' | 'nx' | 'nodata';
}

export interface Lookup {
  id: number;
  client: string;
  res: string;
  qname: string;
  qtype: RRType;
  cur: string;
  chain: RR[];
  ms: number;
  hops: ServerId[];
  upstream: number;
  n: number;
  stubId: number;
  sport: number;
  asked: boolean;
  done: boolean;
  /** Zones learned during this lookup (usable even with caching off) */
  learned: Map<string, RR[]>;
  via: 'udp' | 'tcp';
  answer: RR[];
  status: 'NOERROR' | 'NXDOMAIN';
  onDone?: (r: LookupResult) => void;
}

export interface LookupResult {
  id: number;
  client: string;
  qname: string;
  qtype: RRType;
  status: 'NOERROR' | 'NXDOMAIN';
  answer: RR[];
  ttls: number[];
  ms: number;
  upstream: number;
  hops: ServerId[];
  from: 'stub' | 'resolver' | 'network';
  negCache: boolean;
}

interface UserState {
  next: number;
  busy: boolean;
  ip: string | null;
  ok: boolean | null;
}

export interface SnoopLine {
  id: number;
  text: string;
  secret: boolean;
}

const COLOR: Record<MsgKind, string> = {
  query: SIG.req,
  referral: SIG.hc,
  answer: SIG.res,
  cname: SIG.heavy,
  nxdomain: SIG.err,
  nodata: SIG.warn,
  trunc: SIG.warn,
  tcp: SIG.text2,
  http: SIG.blue,
  httpres: SIG.res,
};


/** Where a lookup goes first, as offered in the "first stop" prediction. */
export const FIRST_CHOICES = [
  { id: 'root', label: 'A root server' },
  { id: 'tld', label: '.example TLD' },
  { id: 'auth', label: 'ns1.shop.example' },
  { id: 'cdn', label: 'ns1.cdn.example' },
  { id: 'cache', label: 'No one: cached' },
];

type CacheHit = { kind: 'hit'; entries: CacheEntry[] } | { kind: 'cname'; entry: CacheEntry } | { kind: 'nx'; entry: CacheEntry } | { kind: 'nodata'; entry: CacheEntry };

/* ------------------------------------------------------------------ */
/* The simulation                                                      */
/* ------------------------------------------------------------------ */

export class DnsSim extends Sim {
  cfg: DnsConfig = { ...DEFAULTS };
  game: PredictGame | null = null;

  /* the world's DNS data (what the authoritative servers hold) */
  shopIp = IP_OLD;
  ttlA = 300;
  wwwTarget = 'shop.cdn.example.';
  bigTxt = false;
  zones: Record<ServerId, Zone> = buildZones({ shopIp: IP_OLD, ttlA: 300, wwwTarget: 'shop.cdn.example.', bigTxt: false });
  /** Record the zone view is pointing at: [name, type] */
  zoneHit: { name: string; type: RRType | 'SOA'; vt: number } | null = null;

  caches = new Map<string, CacheEntry[]>();
  lookups: Lookup[] = [];
  dig: Msg | null = null;
  /** The last completed lookup */
  last: LookupResult | null = null;
  /** Per-client last result (for "Alice vs Bob" comparisons) */
  byClient = new Map<string, LookupResult>();
  stats = { lookups: 0, answered: 0, resHits: 0, stubHits: 0, misses: 0, upstream: 0, authQueries: 0, rootQueries: 0, negHits: 0, lost: 0, retries: 0, errors: 0, httpOk: 0 };

  /* move-the-site scenario */
  users = new Map<string, UserState>();
  webDown = false;
  movedAt: number | null = null;
  allMovedAt: number | null = null;

  /** Playground challenges completed */
  achieved = new Set<string>();

  /* snooper (DoT / DoH step) */
  snoop: SnoopLine[] = [];
  /** Names the resolver has seen (it always sees them) */
  resolverLog: string[] = [];

  busyUntil = new Map<string, number>();

  private seq = 0;
  private lkSeq = 0;
  private entrySeq = 0;
  private autoIn = 0;
  private autoIdx = 0;
  private snoopSeq = 0;
  private msgOf = new Map<number, Msg>();
  private treePhase = -1;

  constructor() {
    super();
    for (const id of DEFAULTS.cast) this.box(id);
  }

  /* ================================================================ */
  /* Step lifecycle                                                   */
  /* ================================================================ */

  enter(cfg: DnsConfig, opts: { reset?: boolean; predict?: number; setup?: (s: DnsSim) => void; script?: ScriptEvent<DnsSim>[] } = {}) {
    this.cfg = { ...cfg };
    this.clearTransient();
    this.lookups = [];
    this.msgOf.clear();
    this.busyUntil.clear();
    if (opts.reset !== false) this.resetWorld();
    this.game = opts.predict ? new PredictGame(this, opts.predict) : null;
    this.syncCast();
    // Layouts depend on the config too (dig card, HUD, docks), not just on which boxes exist.
    this.relayout();
    opts.setup?.(this);
    this.treePhase = -1;
    this.autoIn = cfg.auto?.first ?? 0.6;
    this.autoIdx = 0;
    this.runScript(opts.script ?? []);
    this.rev++;
  }

  private resetWorld() {
    this.rng = mulberry32(7);
    this.shopIp = IP_OLD;
    this.ttlA = 300;
    this.wwwTarget = 'shop.cdn.example.';
    this.bigTxt = false;
    this.rebuildZones();
    this.caches.clear();
    this.dig = null;
    this.last = null;
    this.byClient.clear();
    this.stats = { lookups: 0, answered: 0, resHits: 0, stubHits: 0, misses: 0, upstream: 0, authQueries: 0, rootQueries: 0, negHits: 0, lost: 0, retries: 0, errors: 0, httpOk: 0 };
    this.users.clear();
    this.webDown = false;
    this.movedAt = null;
    this.allMovedAt = null;
    this.snoop = [];
    this.resolverLog = [];
    this.zoneHit = null;
    this.achieved = new Set();
  }

  private syncCast() {
    const want = new Set(this.cfg.cast);
    for (const id of ALL_BOXES) {
      if (want.has(id)) this.box(id);
      else if (this.boxes.has(id)) this.hide(id);
    }
  }

  private rebuildZones() {
    this.zones = buildZones({ shopIp: this.shopIp, ttlA: this.ttlA, wwwTarget: this.wwwTarget, bigTxt: this.bigTxt });
  }

  /* ================================================================ */
  /* Methods the panel calls                                          */
  /* ================================================================ */

  setTtlA(v: number) {
    this.ttlA = Math.round(v);
    this.rebuildZones();
    this.rev++;
  }

  setWwwTarget(t: string) {
    this.wwwTarget = t;
    this.rebuildZones();
    this.forget('www.shop.example');
    this.forget('shop.cdn.example');
    this.forget('shop.example', 'A');
    this.forgetZone('cdn.example');
    this.rev++;
  }

  setBigTxt(on: boolean) {
    this.bigTxt = on;
    this.rebuildZones();
  }

  /** Ask for the big TXT answer again, with or without EDNS on the stub. */
  retryBig(edns: boolean) {
    this.cfg = { ...this.cfg, stubEdns: edns };
    this.clearTransient();
    this.lookups = [];
    this.flushAnswers();
    this.query('shop.example', 'TXT');
  }

  setTransport(t: Transport) {
    this.cfg = { ...this.cfg, transport: t };
    this.snoop = [];
    this.rev++;
  }

  setStubCache(on: boolean) {
    this.cfg = { ...this.cfg, stubCache: on };
    if (!on) this.caches.delete('laptop');
    this.rev++;
  }

  setResCache(on: boolean) {
    this.cfg = { ...this.cfg, resCache: on };
    if (!on) this.caches.delete('resolver');
    this.rev++;
  }

  flushResolver(fx = true) {
    this.caches.delete('resolver');
    if (fx && this.isLive('resolver')) this.say('resolver', 'cache flushed', SIG.warn);
    this.rev++;
  }

  flushStub() {
    this.caches.delete('laptop');
    if (this.isLive('laptop')) this.say('laptop', 'OS cache flushed', SIG.warn);
    this.rev++;
  }

  /** Forget cached answers but keep what the resolver knows about delegations. */
  flushAnswers(owner = 'resolver') {
    const list = this.caches.get(owner);
    if (list) this.caches.set(owner, list.filter((e) => e.kind === 'ref' || e.kind === 'glue'));
    this.rev++;
  }

  /** Alice runs `dig name type` (or her browser needs it). */
  query(name: string, type: RRType = 'A', client = 'laptop') {
    return this.startLookup(client, name, type);
  }

  /** Release every message waiting at its destination. */
  releaseHeld() {
    const list = this.flights.filter((f) => f.held);
    for (const f of list) this.release(f);
    this.rev++;
  }

  get holding() {
    return this.flights.some((f) => f.held);
  }

  dropFlight(id: number) {
    if (!this.cfg.clickDrop) return;
    const f = this.flights.find((x) => x.id === id);
    if (!f || f.lostAt != null) return;
    this.drop(f);
    this.stats.lost++;
    this.rev++;
  }

  /** Drop the first DNS message in flight (touch-friendly alternative to clicking one). */
  dropNext() {
    const f = this.flights.find((x) => x.lostAt == null && this.msgOf.has(x.id) && !x.held);
    if (f) this.dropFlight(f.id);
  }

  /** Change the shop's A record on the authoritative server. */
  moveSite() {
    if (this.shopIp === IP_NEW) return;
    this.shopIp = IP_NEW;
    this.rebuildZones();
    this.movedAt = this.t;
    this.allMovedAt = null;
    this.fx({ kind: 'ring', at: { id: 'auth' }, color: SIG.res, size: 1.6 });
    this.say('auth', `A → ${IP_NEW}`, SIG.res, 2.2);
    this.rev++;
  }

  setWebDown(down: boolean) {
    this.webDown = down;
    if (down) this.fx({ kind: 'x', at: { id: 'web' }, color: SIG.err, size: 1.6 });
    this.rev++;
  }

  resetMove() {
    this.shopIp = IP_OLD;
    this.ttlA = 30;
    this.rebuildZones();
    this.movedAt = null;
    this.allMovedAt = null;
    this.webDown = false;
    this.clearTransient();
    this.lookups = [];
    this.stats.errors = 0;
    this.seedMove();
    this.rev++;
  }

  /* ================================================================ */
  /* Seeding (the state a step starts from)                           */
  /* ================================================================ */

  /** Put a record in someone's cache with `left` seconds to live. */
  seed(owner: string, r: RR, kind: CacheEntry['kind'], left = r.ttl) {
    this.put(owner, { name: r.name, type: r.type, data: r.data, ttl: r.ttl, kind }, left);
  }

  /** Cache the referrals for a zone (as if learned a while ago). */
  seedZone(zone: string, owner = 'resolver') {
    const holder = zone === 'example' ? this.zones.root : this.zones.tld;
    const cut = holder.cuts.find((c) => c.zone === zone);
    if (!cut) return;
    for (const r of cut.ns) this.seed(owner, r, 'ref', r.ttl - 1200);
    for (const r of cut.glue) this.seed(owner, r, 'glue', r.ttl - 1200);
  }

  seedAnswer(name: string, type: RRType, left: number, owner = 'resolver') {
    for (const z of Object.values(this.zones)) {
      for (const r of z.records) if (r.name === name && r.type === type) this.seed(owner, r, 'ans', left);
    }
  }

  seedMove() {
    this.users.clear();
    const lefts = [7, 16, 25];
    MOVE_RESOLVERS.forEach((r, i) => {
      this.caches.delete(r);
      this.seedZone('example', r);
      this.seedZone('shop.example', r);
      this.put(r, { name: 'shop.example', type: 'A', data: this.shopIp, ttl: this.ttlA, kind: 'ans' }, lefts[i]);
    });
    USERS.forEach((u, i) => this.users.set(u, { next: 0.4 + i * 0.85, busy: false, ip: IP_OLD, ok: true }));
  }

  /* ================================================================ */
  /* Caches                                                           */
  /* ================================================================ */

  private put(owner: string, e: Omit<CacheEntry, 'id' | 'exp' | 'born'>, left = e.ttl) {
    const list = this.caches.get(owner) ?? [];
    const i = list.findIndex((x) => x.name === e.name && x.type === e.type && (x.data === e.data || e.kind === 'nx' || e.kind === 'nodata' || x.kind === 'nodata' || x.kind === 'nx'));
    const entry: CacheEntry = { ...e, id: ++this.entrySeq, exp: this.t + left, born: this.t };
    if (i >= 0) list[i] = entry;
    else list.push(entry);
    this.caches.set(owner, list);
    this.rev++;
  }

  /** Fresh entries only (an expired entry lingers briefly on screen but is never used). */
  entries(owner: string, name?: string) {
    const t = this.t;
    return (this.caches.get(owner) ?? []).filter((e) => e.exp > t && (name == null || e.name === name));
  }

  /** The table the readout draws: everything, including just-expired rows. */
  table(owner: string) {
    return this.caches.get(owner) ?? [];
  }

  ttlLeft(e: CacheEntry) {
    return Math.max(0, Math.ceil(e.exp - this.t - 1e-6));
  }

  private forget(name: string, type?: RRType) {
    for (const [k, list] of this.caches) this.caches.set(k, list.filter((e) => !(e.name === name && (type == null || e.type === type))));
  }

  private forgetZone(zone: string) {
    for (const [k, list] of this.caches) this.caches.set(k, list.filter((e) => !((e.kind === 'ref' || e.kind === 'glue') && (e.name === zone || e.name.endsWith(`.${zone}`)))));
  }

  private cacheCheck(owner: string, name: string, type: RRType): CacheHit | null {
    const list = this.entries(owner, name);
    const nx = list.find((e) => e.kind === 'nx');
    if (nx) return { kind: 'nx', entry: nx };
    const exact = list.filter((e) => e.type === type && (e.kind === 'ans' || e.kind === 'cname' || e.kind === 'nodata'));
    const nodata = exact.find((e) => e.kind === 'nodata');
    if (nodata) return { kind: 'nodata', entry: nodata };
    if (exact.length) return { kind: 'hit', entries: exact };
    const cname = list.find((e) => e.type === 'CNAME' && e.kind === 'cname');
    if (cname && type !== 'CNAME') return { kind: 'cname', entry: cname };
    return null;
  }

  /** The closest zone the resolver knows how to reach, starting from `name` and walking up. */
  private closestServer(owner: string, name: string): ServerId {
    let n = name;
    for (;;) {
      if (n === '') return 'root';
      const sid = ZONE_SERVER[n];
      if (sid && this.entries(owner, n).some((e) => e.type === 'NS' && e.kind === 'ref')) return sid;
      n = parent(n);
    }
  }

  /** Where the resolver will go first for this name, following cached aliases. */
  firstStop(owner: string, name: string, type: RRType): ServerId | 'cache' {
    let cur = name;
    for (let i = 0; i < 6; i++) {
      const c = this.cacheCheck(owner, cur, type);
      if (!c) return this.closestServer(owner, cur);
      if (c.kind !== 'cname') return 'cache';
      cur = target(c.entry.data);
    }
    return 'cache';
  }

  /* ================================================================ */
  /* Lookups                                                          */
  /* ================================================================ */

  private rid() {
    return Math.floor(this.rng() * 65536);
  }

  private port() {
    return 1024 + Math.floor(this.rng() * 64000);
  }

  resolverOf(client: string) {
    const i = (USERS as readonly string[]).indexOf(client);
    return i >= 0 ? MOVE_RESOLVERS[i] : 'resolver';
  }

  startLookup(client: string, qname: string, qtype: RRType = 'A', onDone?: (r: LookupResult) => void) {
    const lk: Lookup = {
      id: ++this.lkSeq,
      client,
      res: this.resolverOf(client),
      qname,
      qtype,
      cur: qname,
      chain: [],
      ms: 0,
      hops: [],
      upstream: 0,
      n: 0,
      stubId: this.rid(),
      sport: this.port(),
      asked: false,
      done: false,
      learned: new Map(),
      via: 'udp',
      answer: [],
      status: 'NOERROR',
      onDone,
    };
    this.stats.lookups++;
    this.lookups.push(lk);

    // The OS answers from its own cache without sending anything.
    if (this.cfg.stubCache && client === 'laptop') {
      const hit = this.stubHit(qname, qtype);
      if (hit) {
        this.stats.stubHits++;
        this.fx({ kind: 'ring', at: { id: client }, color: SIG.res });
        this.say(client, 'OS cache hit · 0 ms', SIG.res);
        this.finish(lk, { status: hit.status, answer: hit.answer, ttls: hit.ttls, from: 'stub', neg: hit.status === 'NXDOMAIN' });
        return lk;
      }
    }
    this.sendStub(lk);
    return lk;
  }

  private stubHit(qname: string, qtype: RRType): { status: 'NOERROR' | 'NXDOMAIN'; answer: RR[]; ttls: number[] } | null {
    const answer: RR[] = [];
    const ttls: number[] = [];
    let cur = qname;
    for (let i = 0; i < 6; i++) {
      const c = this.cacheCheck('laptop', cur, qtype);
      if (!c) return null;
      if (c.kind === 'nx') return { status: 'NXDOMAIN', answer, ttls };
      if (c.kind === 'nodata') return { status: 'NOERROR', answer, ttls };
      if (c.kind === 'hit') {
        for (const e of c.entries) {
          answer.push({ name: e.name, ttl: e.ttl, type: e.type as RRType, data: e.data });
          ttls.push(this.ttlLeft(e));
        }
        return { status: 'NOERROR', answer, ttls };
      }
      answer.push({ name: c.entry.name, ttl: c.entry.ttl, type: 'CNAME', data: c.entry.data });
      ttls.push(this.ttlLeft(c.entry));
      cur = target(c.entry.data);
    }
    return null;
  }

  private msg(lk: Lookup, m: Partial<Msg> & Pick<Msg, 'kind' | 'from' | 'to'>): Msg {
    lk.n++;
    const answer = m.answer ?? [];
    const authority = m.authority ?? [];
    const additional = m.additional ?? [];
    const qname = m.qname ?? lk.cur;
    return {
      seq: ++this.seq,
      n: lk.n,
      lookup: lk.id,
      dnsId: m.dnsId ?? this.rid(),
      qname,
      qtype: m.qtype ?? lk.qtype,
      flags: m.flags ?? [],
      status: m.status ?? 'NOERROR',
      answer,
      authority,
      additional,
      ttls: m.ttls ?? answer.map((r) => r.ttl),
      // Resolver <-> server traffic always uses EDNS; the stub's legs only when it's switched on.
      bytes: m.bytes ?? wireSize(qname, [...answer, ...authority, ...additional], CLIENTS.has(m.from) || CLIENTS.has(m.to) ? this.cfg.stubEdns : true),
      proto: m.proto ?? 'udp',
      sport: m.sport ?? this.port(),
      dport: m.dport ?? 53,
      ...m,
    } as Msg;
  }

  private hopDur(a: string, b: string) {
    const A = this.boxes.get(a);
    const B = this.boxes.get(b);
    const d = A && B ? Math.hypot(A.tx - B.tx, A.ty - B.ty) : 300;
    const base = Math.min(1.15, Math.max(0.55, d / 340));
    return base * this.cfg.pace;
  }

  private label(m: Msg): string | undefined {
    if (!this.cfg.labels) return undefined;
    const small = this.orient === 'portrait';
    switch (m.kind) {
      case 'query':
        return small ? `${m.qtype}?` : `${m.qname}${m.qtype === 'A' ? '' : ` ${m.qtype}`}?`;
      case 'referral': {
        const z = m.authority[0]?.name ?? '';
        return `→ ${z.includes('.') ? z : `.${z}`}`;
      }
      case 'answer':
        return m.answer.length ? (small ? m.answer[m.answer.length - 1].type : shortAnswer(m.answer[m.answer.length - 1])) : 'NOERROR';
      case 'cname':
        return small ? 'CNAME' : `CNAME → ${target(m.answer[0].data)}`;
      case 'nxdomain':
        return 'NXDOMAIN';
      case 'nodata':
        return 'no data';
      case 'trunc':
        return 'TC: truncated';
      default:
        return m.label;
    }
  }

  /** Put a DNS message on the wire. */
  private fly(m: Msg, o: { onArrive?: () => void; onLost?: () => void; dur?: number } = {}) {
    const encrypted = (m.proto === 'dot' || m.proto === 'doh') && m.kind !== 'tcp';
    const hold = this.cfg.holdKinds.includes(m.kind);
    let shape: FlightShape = 'dot';
    if (m.proto === 'tcp' || m.kind === 'tcp') shape = 'square';
    if (encrypted) shape = 'envelope';
    const f = this.send({
      from: m.from,
      to: m.to,
      dur: o.dur ?? this.hopDur(m.from, m.to),
      color: COLOR[m.kind],
      label: hold ? undefined : encrypted ? (m.kind === 'query' ? '🔒 query' : '🔒 answer') : this.label(m),
      shape,
      r: m.kind === 'tcp' ? 3.4 : m.bytes > 512 ? 6 : 4.6,
      hold,
      tag: m.kind,
      onArrive: () => {
        this.flashWire(m.from, m.to);
        o.onArrive?.();
      },
      onLost: () => {
        o.onLost?.();
      },
    });
    this.msgOf.set(f.id, m);
    if (m.kind !== 'http' && m.kind !== 'httpres') {
      this.dig = m;
    }
    this.rev++;
    return f;
  }

  /** Floating label; on phones, boxes in the top row get it underneath (the HUD lives above). */
  say(id: string, text: string, color: string = SIG.text, dur = 1.4) {
    const b = this.boxes.get(id);
    const h = b?.h ?? 20;
    if (this.orient === 'portrait' && this.cfg.view === 'flow' && b && (id === 'laptop' || id === 'bob') && this.isLive('bob')) {
      // Alice and Bob are stacked: put their labels in the free space to the right of Bob.
      this.fx({ kind: 'text', at: { id, dx: this.w * 0.42, dy: id === 'laptop' ? 62 : 10 }, text, color, dur });
      return;
    }
    const below = this.orient === 'portrait' && !!b && b.ty < 150 && this.cfg.view === 'flow';
    // Keep the pill on the stage: estimate its width and nudge it inward.
    const half = text.length * 3.3 + 10;
    const x = b ? b.tx : this.w / 2;
    const dx = Math.min(Math.max(x, 10 + half), this.w - 10 - half) - x;
    this.fx({ kind: 'text', at: { id, dx, dy: below ? h / 2 + 36 : -h / 2 - 12 }, text, color, dur });
  }

  private sendStub(lk: Lookup) {
    const proto = this.cfg.transport === 'udp' ? lk.via : this.cfg.transport;
    const m = this.msg(lk, {
      kind: 'query',
      from: lk.client,
      to: lk.res,
      qname: lk.qname,
      dnsId: lk.stubId,
      flags: ['rd'],
      sport: lk.sport,
      proto,
      dport: proto === 'dot' ? 853 : proto === 'doh' ? 443 : 53,
    });
    if (this.viaWifi()) {
      this.fly(
        { ...m, to: 'wifi' },
        {
          onArrive: () => {
            this.seenByWifi(lk, m, true);
            this.fly({ ...m, from: 'wifi' }, { onArrive: () => this.atResolver(lk), onLost: () => this.stubTimeout(lk) });
          },
          onLost: () => this.stubTimeout(lk),
        },
      );
    } else {
      this.fly(m, { onArrive: () => this.atResolver(lk), onLost: () => this.stubTimeout(lk) });
    }
  }

  private viaWifi() {
    return this.isLive('wifi');
  }

  private seenByWifi(lk: Lookup, m: Msg, out: boolean) {
    const t = this.cfg.transport;
    const port = t === 'udp' ? 53 : t === 'dot' ? 853 : 443;
    const a = m.answer[m.answer.length - 1];
    const plain = out ? `${m.qtype}? ${m.qname}` : m.status === 'NXDOMAIN' ? `NXDOMAIN ${m.qname}` : a ? `${m.qname} ${shortAnswer(a)}` : `${m.qname} (no data)`;
    const body = t === 'udp' ? plain : `${t === 'dot' ? 'TLS' : 'HTTPS'} · ${m.bytes + (t === 'dot' ? 29 : 61)} bytes`;
    const text = out ? `→ ${RESOLVER_IP}:${port}  ${body}` : `← ${RESOLVER_IP}:${port}  ${body}`;
    this.snoop = [...this.snoop, { id: ++this.snoopSeq, text, secret: t !== 'udp' }].slice(-6);
    if (out) {
      if (t === 'udp') this.say('wifi', `reads “${m.qname}”`, SIG.heavy);
      else this.say('wifi', 'sees 🔒 only', SIG.text2);
    }
    this.rev++;
  }

  private stubTimeout(lk: Lookup) {
    this.after(1.6 * this.cfg.pace, () => {
      if (lk.done) return;
      this.stats.retries++;
      lk.ms += 2000;
      this.say(lk.client, 'no answer in 2 s · retry', SIG.warn);
      lk.stubId = this.rid();
      this.sendStub(lk);
    });
  }

  private atResolver(lk: Lookup) {
    if (lk.done) return;
    if (!this.resolverLog.includes(lk.qname)) this.resolverLog = [...this.resolverLog, lk.qname].slice(-6);

    if (this.cfg.blackBox) {
      this.busyUntil.set(lk.res, this.t + 1.5 * this.cfg.pace);
      this.after(1.5 * this.cfg.pace, () => {
        const r = this.resolveInstant(lk.qname, lk.qtype);
        lk.ms = r.ms;
        lk.hops = r.hops;
        lk.upstream = r.hops.length;
        this.reply(lk, r.status, r.answer, r.answer.map((x) => x.ttl), r.soa);
      });
      this.rev++;
      return;
    }

    if (this.game && !this.game.done && this.cfg.predict === 'first' && !lk.asked) {
      lk.asked = true;
      const where = this.firstStop(lk.res, lk.cur, lk.qtype);
      this.game.ask({
        acceptable: [where],
        choices: FIRST_CHOICES,
        ask: `${lk.qname}: first stop?`,
        askAt: { id: lk.res },
        explain: (picked) => this.explainFirst(lk, where, picked),
        resolve: () => this.after(0.15, () => this.proceed(lk)),
      });
      return;
    }
    this.after(this.cfg.think, () => this.proceed(lk));
  }

  /** One decision of the iterative algorithm: answer from cache, follow an alias, or ask the closest server. */
  private proceed(lk: Lookup) {
    if (lk.done) return;
    const c = this.cfg.resCache ? this.cacheCheck(lk.res, lk.cur, lk.qtype) : null;
    if (c) {
      if (lk.upstream === 0 && lk.chain.length === 0) {
        this.stats.resHits++;
        if (c.kind === 'nx' || c.kind === 'nodata') this.stats.negHits++;
        this.say(lk.res, c.kind === 'nx' ? 'cached NXDOMAIN' : 'cache hit', c.kind === 'nx' ? SIG.err : SIG.res);
      }
      if (c.kind === 'hit') {
        const answer = [...lk.chain, ...c.entries.map((e) => ({ name: e.name, ttl: e.ttl, type: e.type as RRType, data: e.data }))];
        const ttls = [...lk.chain.map((r) => r.ttl), ...c.entries.map((e) => this.ttlLeft(e))];
        this.reply(lk, 'NOERROR', answer, ttls);
        return;
      }
      if (c.kind === 'nx' || c.kind === 'nodata') {
        const soa = this.soaFor(lk.cur);
        this.reply(lk, c.kind === 'nx' ? 'NXDOMAIN' : 'NOERROR', lk.chain, lk.chain.map((r) => r.ttl), soa ? { ...soa, ttl: this.ttlLeft(c.entry) } : undefined);
        return;
      }
      lk.chain.push({ name: c.entry.name, ttl: this.ttlLeft(c.entry), type: 'CNAME', data: c.entry.data });
      lk.cur = target(c.entry.data);
      this.proceed(lk);
      return;
    }
    if (lk.upstream === 0 && lk.chain.length === 0) {
      this.stats.misses++;
      this.say(lk.res, 'cache miss', SIG.heavy);
    }
    const server = this.cfg.resCache ? this.closestServer(lk.res, lk.cur) : this.closestLearned(lk);
    const go = () => this.queryServer(lk, server);
    if (this.game && !this.game.done && this.cfg.predict === 'hops') {
      this.game.ask({
        acceptable: [server],
        ask: 'Which server does it ask next?',
        askAt: { id: lk.res },
        explain: (picked) => this.explainHop(server, picked),
        resolve: () => this.after(0.1, go),
      });
      return;
    }
    go();
  }

  private closestLearned(lk: Lookup): ServerId {
    let n = lk.cur;
    for (;;) {
      if (n === '') return 'root';
      const sid = ZONE_SERVER[n];
      if (sid && lk.learned.has(n)) return sid;
      n = parent(n);
    }
  }

  private queryServer(lk: Lookup, server: ServerId, retry = false) {
    if (lk.done) return;
    if (!retry) {
      lk.hops.push(server);
      lk.upstream++;
      this.stats.upstream++;
      if (server === 'root') this.stats.rootQueries++;
      if (server === 'auth') this.stats.authQueries++;
    }
    const m = this.msg(lk, { kind: 'query', from: lk.res, to: server, flags: [], proto: 'udp', sport: this.port(), dport: 53 });
    this.fly(m, {
      onArrive: () => this.atServer(lk, server),
      onLost: () => this.resolverTimeout(lk, server),
    });
  }

  private resolverTimeout(lk: Lookup, server: ServerId) {
    this.after(1.1 * this.cfg.pace, () => {
      if (lk.done) return;
      this.stats.retries++;
      lk.ms += 400;
      this.say(lk.res, 'no reply · retry', SIG.warn);
      this.queryServer(lk, server, true);
    });
  }

  private atServer(lk: Lookup, server: ServerId) {
    if (lk.done) return;
    const resp = answerFrom(this.zones[server], lk.cur, lk.qtype);
    if (server === 'auth') {
      const type = resp.kind === 'answer' || resp.kind === 'cname' ? resp.answer[0].type : 'SOA';
      const name = type === 'SOA' ? 'shop.example' : resp.answer[0].name;
      this.zoneHit = { name, type, vt: this.vt };
    }
    this.after(0.12 * this.cfg.pace, () => {
      const m = this.msg(lk, {
        kind: resp.kind,
        from: server,
        to: lk.res,
        flags: resp.aa ? ['qr', 'aa'] : ['qr'],
        status: resp.status,
        answer: resp.answer,
        authority: resp.authority,
        additional: resp.additional,
        sport: 53,
        dport: this.port(),
      });
      this.fly(m, { onArrive: () => this.gotResponse(lk, server, resp), onLost: () => this.resolverTimeout(lk, server) });
    });
  }

  private gotResponse(lk: Lookup, server: ServerId, resp: Resp) {
    if (lk.done) return;
    lk.ms += SERVERS[server].rtt;
    this.learn(lk, resp);
    const next = () => this.after(this.cfg.think, () => this.proceedAfter(lk, resp));
    next();
  }

  private proceedAfter(lk: Lookup, resp: Resp) {
    if (lk.done) return;
    switch (resp.kind) {
      case 'referral':
        this.proceed(lk);
        return;
      case 'answer':
        this.reply(lk, 'NOERROR', [...lk.chain, ...resp.answer], [...lk.chain.map((r) => r.ttl), ...resp.answer.map((r) => r.ttl)]);
        return;
      case 'cname': {
        const [cn, ...rest] = resp.answer;
        lk.chain.push(cn);
        if (rest.length) {
          this.reply(lk, 'NOERROR', [...lk.chain, ...rest], [...lk.chain.map((r) => r.ttl), ...rest.map((r) => r.ttl)]);
          return;
        }
        lk.cur = target(cn.data);
        this.say(lk.res, `alias → ${lk.cur}`, SIG.heavy);
        this.proceed(lk);
        return;
      }
      case 'nxdomain':
      case 'nodata':
        this.reply(lk, resp.status, lk.chain, lk.chain.map((r) => r.ttl), resp.authority[0]);
        return;
    }
  }

  /** Cache what a response taught the resolver. */
  private learn(lk: Lookup, resp: Resp) {
    if (resp.kind === 'referral') {
      const zone = resp.authority[0]?.name ?? '';
      lk.learned.set(zone, resp.authority);
    }
    if (!this.cfg.resCache) return;
    const owner = lk.res;
    if (resp.kind === 'referral') {
      for (const r of resp.authority) this.put(owner, { name: r.name, type: r.type, data: r.data, ttl: r.ttl, kind: 'ref' });
      for (const r of resp.additional) this.put(owner, { name: r.name, type: r.type, data: r.data, ttl: r.ttl, kind: 'glue' });
    } else if (resp.kind === 'answer' || resp.kind === 'cname') {
      for (const r of resp.answer) this.put(owner, { name: r.name, type: r.type, data: r.data, ttl: r.ttl, kind: r.type === 'CNAME' && lk.qtype !== 'CNAME' ? 'cname' : 'ans' });
    } else if (resp.kind === 'nxdomain') {
      const soa = resp.authority[0];
      this.put(owner, { name: lk.cur, type: 'ANY', data: 'NXDOMAIN', ttl: negTtl(soa), kind: 'nx' });
    } else if (resp.kind === 'nodata') {
      const soa = resp.authority[0];
      this.put(owner, { name: lk.cur, type: lk.qtype, data: 'NODATA', ttl: negTtl(soa), kind: 'nodata' });
    }
  }

  private soaFor(name: string): RR | null {
    for (const sid of ['cdn', 'auth', 'tld', 'root'] as ServerId[]) {
      const z = this.zones[sid];
      if (sid === 'root' || name === z.apex || name.endsWith(`.${z.apex}`)) return z.soa;
    }
    return null;
  }

  /** Final answer: resolver → client. */
  private reply(lk: Lookup, status: 'NOERROR' | 'NXDOMAIN', answer: RR[], ttls: number[], soa?: RR) {
    if (lk.done) return;
    lk.ms += STUB_RTT;
    lk.answer = answer;
    lk.status = status;
    const authority = status === 'NXDOMAIN' || !answer.length ? (soa ? [soa] : []) : [];
    const kind: MsgKind = status === 'NXDOMAIN' ? 'nxdomain' : answer.length ? 'answer' : 'nodata';
    const proto = this.cfg.transport === 'udp' ? lk.via : this.cfg.transport;
    const full = this.msg(lk, {
      kind,
      from: lk.res,
      to: lk.client,
      qname: lk.qname,
      dnsId: lk.stubId,
      flags: ['qr', 'rd', 'ra'],
      status,
      answer,
      authority,
      ttls,
      sport: 53,
      dport: lk.sport,
      proto,
      ms: lk.ms,
      cached: lk.upstream === 0,
    });
    // A stub without EDNS can only take 512 bytes over UDP.
    if (proto === 'udp' && !this.cfg.stubEdns && full.bytes > 512) {
      const tc = { ...full, kind: 'trunc' as MsgKind, flags: ['qr', 'tc', 'rd', 'ra'], answer: [], ttls: [], bytes: wireSize(lk.qname, []) };
      this.fly(tc, { onArrive: () => this.retryOverTcp(lk) });
      return;
    }
    const toWifi = this.viaWifi() && CLIENTS.has(lk.client);
    const land = () => this.finish(lk, { status, answer, ttls: full.ttls, from: lk.upstream === 0 ? 'resolver' : 'network', neg: status === 'NXDOMAIN' && lk.upstream === 0 });
    if (toWifi) {
      this.fly(
        { ...full, to: 'wifi' },
        {
          onArrive: () => {
            this.seenByWifi(lk, full, false);
            this.fly({ ...full, from: 'wifi' }, { onArrive: land, onLost: () => this.stubTimeout(lk) });
          },
          onLost: () => this.stubTimeout(lk),
        },
      );
    } else {
      this.fly(full, { onArrive: land, onLost: () => this.stubTimeout(lk) });
    }
  }

  /** TC=1: open a TCP connection and ask again. */
  private retryOverTcp(lk: Lookup) {
    if (lk.done) return;
    this.say(lk.client, 'truncated → retry over TCP', SIG.warn, 1.8);
    lk.via = 'tcp';
    lk.ms += STUB_RTT;
    const base = { qname: lk.qname, dnsId: lk.stubId, proto: 'tcp' as const, bytes: 0 };
    const syn = this.msg(lk, { ...base, kind: 'tcp', from: lk.client, to: lk.res, label: 'SYN', sport: lk.sport, dport: 53 });
    this.fly(syn, {
      dur: this.hopDur(lk.client, lk.res) * 0.8,
      onArrive: () => {
        const synack = this.msg(lk, { ...base, kind: 'tcp', from: lk.res, to: lk.client, label: 'SYN-ACK', sport: 53, dport: lk.sport });
        this.fly(synack, {
          dur: this.hopDur(lk.client, lk.res) * 0.8,
          onArrive: () => {
            const q = this.msg(lk, { kind: 'query', from: lk.client, to: lk.res, qname: lk.qname, dnsId: lk.stubId, flags: ['rd'], proto: 'tcp', sport: lk.sport, dport: 53, label: 'ACK + query' });
            this.fly(q, { onArrive: () => this.after(this.cfg.think, () => this.proceed(lk)) });
          },
        });
      },
    });
  }

  private finish(lk: Lookup, o: { status: 'NOERROR' | 'NXDOMAIN'; answer: RR[]; ttls: number[]; from: LookupResult['from']; neg: boolean }) {
    if (lk.done) return;
    lk.done = true;
    this.lookups = this.lookups.filter((l) => l !== lk);
    const res: LookupResult = {
      id: lk.id,
      client: lk.client,
      qname: lk.qname,
      qtype: lk.qtype,
      status: o.status,
      answer: o.answer,
      ttls: o.ttls,
      ms: o.from === 'stub' ? 0 : lk.ms,
      upstream: lk.upstream,
      hops: lk.hops,
      from: o.from,
      negCache: o.neg,
    };
    this.stats.answered++;
    if (lk.hops[0] === 'auth' || lk.hops[0] === 'cdn') this.achieved.add('source');
    if (o.from === 'resolver' && lk.upstream === 0 && o.status === 'NOERROR') this.achieved.add('nocall');
    if (o.neg) this.achieved.add('no');
    if (new Set(lk.hops).size >= 4) this.achieved.add('long');
    this.last = res;
    this.byClient.set(lk.client, res);

    // The client's own cache keeps a copy.
    if (this.cfg.stubCache && lk.client === 'laptop' && o.from !== 'stub') {
      o.answer.forEach((r, i) => this.put('laptop', { name: r.name, type: r.type, data: r.data, ttl: r.ttl, kind: r.type === 'CNAME' ? 'cname' : 'ans' }, o.ttls[i] ?? r.ttl));
      if (o.status === 'NXDOMAIN') this.put('laptop', { name: lk.cur, type: 'ANY', data: 'NXDOMAIN', ttl: 60, kind: 'nx' }, 60);
    }

    if (o.from !== 'stub' && CLIENTS.has(lk.client) && this.cfg.view !== 'move') {
      const a = o.answer[o.answer.length - 1];
      const txt =
        o.status === 'NXDOMAIN'
          ? 'NXDOMAIN'
          : !a
            ? `no ${lk.qtype} record`
            : this.cfg.blackBox
              ? `${lk.qname} → ${shortAnswer(a)}`
              : `${shortAnswer(a)} · ${res.ms} ms`;
      this.say(lk.client, txt, o.status === 'NXDOMAIN' ? SIG.err : SIG.res, 1.8);
    }
    if (this.cfg.http && o.status === 'NOERROR') {
      const a = o.answer.find((r) => r.type === 'A');
      if (a) this.http(lk.client, a.data);
    }
    this.rev++;
    lk.onDone?.(res);
  }

  /** Resolve instantly from the zone data (used when the resolver is a black box). */
  resolveInstant(qname: string, qtype: RRType) {
    let server: ServerId = 'root';
    let cur = qname;
    const answer: RR[] = [];
    const hops: ServerId[] = [];
    let ms = 0;
    for (let i = 0; i < 12; i++) {
      hops.push(server);
      ms += SERVERS[server].rtt;
      const r = answerFrom(this.zones[server], cur, qtype);
      if (r.kind === 'referral') {
        server = ZONE_SERVER[r.authority[0].name] ?? 'root';
        continue;
      }
      if (r.kind === 'cname') {
        answer.push(r.answer[0]);
        if (r.answer.length > 1) return { status: 'NOERROR' as const, answer: [...answer, ...r.answer.slice(1)], ms, hops, soa: undefined };
        cur = target(r.answer[0].data);
        server = this.closestServer('__none__', cur);
        continue;
      }
      if (r.kind === 'answer') return { status: 'NOERROR' as const, answer: [...answer, ...r.answer], ms, hops, soa: undefined };
      return { status: r.status, answer, ms, hops, soa: r.authority[0] };
    }
    return { status: 'NOERROR' as const, answer, ms, hops, soa: undefined };
  }

  /* ================================================================ */
  /* HTTP (what the address is for)                                   */
  /* ================================================================ */

  private http(client: string, ip: string) {
    const box = ip === IP_NEW ? 'web2' : 'web';
    if (!this.isLive(box)) return;
    const down = box === 'web' && this.webDown;
    const color = this.cfg.view === 'move' ? (box === 'web' ? SIG.heavy : SIG.res) : SIG.blue;
    this.send({
      from: client,
      to: box,
      dur: this.hopDur(client, box) * 0.9,
      color,
      shape: 'square',
      r: 4,
      label: this.cfg.view === 'move' || this.orient === 'portrait' ? undefined : 'GET /',
      lostAt: down ? 0.92 : null,
      tag: 'http',
      onLost: () => {
        this.stats.errors++;
        this.say(client, 'connection failed', SIG.err);
        const u = this.users.get(client);
        if (u) {
          u.ok = false;
          u.busy = false;
        }
        this.rev++;
      },
      onArrive: () => {
        this.send({
          from: box,
          to: client,
          dur: this.hopDur(client, box) * 0.9,
          color: this.cfg.view === 'move' ? color : SIG.res,
          shape: 'square',
          r: 3.6,
          label: this.cfg.view === 'move' || this.orient === 'portrait' ? undefined : '200 OK',
          tag: 'http',
          onArrive: () => {
            this.stats.httpOk++;
            const u = this.users.get(client);
            if (u) {
              u.ok = true;
              u.busy = false;
            }
            this.rev++;
          },
        });
      },
    });
  }

  /* ================================================================ */
  /* Predict explanations                                             */
  /* ================================================================ */

  private explainHop(correct: ServerId, picked: string) {
    const why: Record<ServerId, string> = {
      root: 'Its cache is empty, so it starts at the top: a root server. Every resolver knows the root servers’ addresses in advance, from its root hints file.',
      tld: 'The root’s referral named the .example servers and included a.nic.example’s address as glue, so that’s the next stop.',
      auth: 'The .example servers referred it to ns1.shop.example, the authoritative server. Only that one holds shop.example’s records.',
      cdn: 'The referral pointed at ns1.cdn.example, the authoritative server for cdn.example.',
    };
    if (picked === correct) return why[correct];
    const order: ServerId[] = ['root', 'tld', 'auth'];
    const p = order.indexOf(picked as ServerId);
    const c = order.indexOf(correct);
    let lead = '';
    if (picked === 'cdn') lead = 'ns1.cdn.example has nothing to do with shop.example. ';
    else if (p >= 0 && p < c) lead = picked === 'root' ? 'It never goes back to the root once it has a referral. ' : 'It already asked the .example servers, and they pointed it onward. ';
    else if (p > c) lead = picked === 'tld' ? 'It can’t skip ahead: it doesn’t know where the .example servers are yet. ' : 'It can’t skip ahead: it hasn’t learned where ns1.shop.example is yet. ';
    return `${lead}${why[correct]}`;
  }

  private explainFirst(lk: Lookup, where: ServerId | 'cache', picked: string) {
    const name = lk.qname;
    const zone = name.endsWith('cdn.example') ? 'cdn.example' : 'shop.example';
    const text: Record<ServerId | 'cache', string> = {
      cache: `${name} is still in the cache with its TTL counting down, so the resolver answers on the spot. Zero queries sent.`,
      root: `Nothing useful is cached for ${name}, so it has to start at the root.`,
      tld: `It already knows the .example servers (that referral is cached for 2 days) but not ${zone}’s, so it skips the root and starts at the TLD.`,
      auth: `It has shop.example’s NS records (and their glue) cached, so it goes straight to ns1.shop.example. No root, no TLD.`,
      cdn: `An earlier cdn.example lookup taught it where ns1.cdn.example is, so it goes straight there.`,
    };
    const wrong = picked !== where && picked === 'root' ? 'The root referral for .example is cached, so there’s no need to start at the top. ' : '';
    return `${wrong}${text[where]}`;
  }

  /* ================================================================ */
  /* Clock                                                            */
  /* ================================================================ */

  protected step(dt: number) {
    // Expired entries linger for a moment (struck through), then disappear.
    for (const [owner, list] of this.caches) {
      const keep = list.filter((e) => this.t < e.exp + 1.6);
      if (keep.length !== list.length) {
        this.caches.set(owner, keep);
        this.rev++;
      }
      if (list.some((e) => e.exp <= this.t && e.exp > this.t - dt)) {
        this.rev++;
        if (owner === 'resolver' && this.cfg.cacheTable) {
          const e = list.find((x) => x.exp <= this.t && x.exp > this.t - dt);
          if (e && (e.kind === 'ans' || e.kind === 'nx' || e.kind === 'cname')) this.say('resolver', `${e.name} expired`, SIG.warn);
        }
      }
    }

    const a = this.cfg.auto;
    if (a && !(this.game?.pending ?? false)) {
      const busy = this.lookups.some((l) => !l.done);
      if (!(a.seq && busy)) {
        this.autoIn -= dt;
        if (this.autoIn <= 0 && (a.loop || this.autoIdx < a.list.length)) {
          const i = a.random ? Math.floor(this.rng() * a.list.length) : this.autoIdx % a.list.length;
          if (!a.random && this.autoIdx > 0 && i === 0 && a.wrapFlushAnswers) this.flushAnswers();
          const item = a.list[i];
          this.autoIdx++;
          if (a.flush) this.flushResolver(this.autoIdx > 1);
          this.startLookup(item.c, item.q, item.t ?? 'A');
          this.autoIn = a.every;
        }
      }
    }

    if (this.cfg.view === 'move') this.moveTick(dt);
    if (this.cfg.view === 'tree') this.treeTick();
  }

  /** Which label of shop.example. is being read: 0 = the root dot, 1 = example, 2 = shop. */
  get treeLit() {
    return Math.floor(this.stepT / 1.7) % 3;
  }

  private treeTick() {
    const k = Math.floor(this.stepT / 1.7);
    if (k === this.treePhase) return;
    this.treePhase = k;
    const p = k % 3;
    if (p === 1 && this.isLive('tld')) this.send({ from: 'root', to: 'tld', dur: 1.1, color: SIG.warn, r: 4, label: 'example' });
    if (p === 2 && this.isLive('auth')) this.send({ from: 'tld', to: 'auth', dur: 1.1, color: SIG.warn, r: 4, label: 'shop' });
  }

  private moveTick(dt: number) {
    for (const u of USERS) {
      const st = this.users.get(u);
      if (!st || !this.isLive(u)) continue;
      if (st.busy) continue;
      st.next -= dt;
      if (st.next <= 0) {
        st.busy = true;
        st.next = this.cfg.userEvery;
        this.startLookup(u, 'shop.example', 'A', (r) => {
          const a = r.answer.find((x) => x.type === 'A');
          st.ip = a?.data ?? st.ip;
          if (!a) st.busy = false;
          this.rev++;
        });
      }
    }
    if (this.movedAt != null && this.allMovedAt == null && USERS.every((u) => this.users.get(u)?.ip === IP_NEW)) {
      this.allMovedAt = this.t;
      this.rev++;
    }
  }

  /** How long until every resolver has dropped the old address (0 once they all have). */
  staleLeft() {
    let m = 0;
    for (const r of MOVE_RESOLVERS) {
      for (const e of this.entries(r, 'shop.example')) if (e.type === 'A' && e.data !== this.shopIp) m = Math.max(m, e.exp - this.t);
    }
    return m;
  }

  /** The longest any resolver may keep its current copy of shop.example. */
  maxCached() {
    let m = 0;
    for (const r of MOVE_RESOLVERS) for (const e of this.entries(r, 'shop.example')) if (e.type === 'A') m = Math.max(m, e.exp - this.t);
    return m;
  }

  onNew() {
    return USERS.filter((u) => this.users.get(u)?.ip === IP_NEW).length;
  }

  /* ================================================================ */
  /* Layout                                                           */
  /* ================================================================ */

  /** Where the docked dig card goes (landscape: top-left; portrait: under the servers). */
  digRect() {
    const { w, h } = this;
    if (this.orient === 'landscape' && this.cfg.zoneFile) return { x: 26, y: h * 0.2 + 52, w: Math.min(410, w * 0.5) };
    if (this.orient === 'landscape') {
      const r = this.boxes.get('resolver');
      const right = r && this.isLive('resolver') ? r.tx + r.w / 2 : w * 0.46;
      const width = Math.min(420, Math.max(330, right - 30));
      return { x: 26, y: 76, w: width };
    }
    const lows = SERVER_IDS.filter((s) => this.isLive(s)).map((s) => this.boxes.get(s)!);
    const bottom = lows.length ? Math.max(...lows.map((b) => b.ty + b.h / 2)) : h * 0.45;
    return { x: 10, y: bottom + 14, w: w - 20 };
  }

  /** Where a "your turn" pill goes: above the resolver on desktop, above the server row on phones. */
  promptAt(): { x: number; y: number } | null {
    const r = this.boxes.get('resolver');
    if (!r) return null;
    if (this.orient === 'landscape') return { x: r.x, y: r.y - r.h / 2 - 12 };
    const lows = SERVER_IDS.filter((s) => this.isLive(s)).map((s) => this.boxes.get(s)!);
    const top = lows.length ? Math.min(...lows.map((b) => b.y - b.h / 2)) : r.y + r.h / 2 + 50;
    return { x: this.w / 2, y: top - 9 };
  }

  protected layout() {
    const { w, h } = this;
    const L = this.orient === 'landscape';
    const live = (id: string) => this.isLive(id);
    const P = (id: string, x: number, y: number, bw: number, bh: number) => {
      if (live(id)) this.place(id, x, y, bw, bh);
    };
    const v = this.cfg.view;

    if (v === 'tree') {
      const tlds = ['com', 'org', 'tld', 'dev'];
      if (L) {
        const nw = this.compact ? 130 : 150;
        P('root', w * 0.5, h * 0.2, 210, 56);
        tlds.forEach((id, i) => P(id, w * (0.16 + i * 0.225), h * 0.43, nw, 50));
        const tx = w * (0.16 + 2 * 0.225);
        P('auth', tx - w * 0.12, h * 0.64, 170, 50);
        P('cdn', tx + w * 0.12, h * 0.64, 170, 50);
      } else {
        const nw = (w - 24 - 18) / 4;
        P('root', w * 0.5, h * 0.19, 190, 52);
        tlds.forEach((id, i) => P(id, 12 + nw / 2 + i * (nw + 6), h * 0.38, nw, 46));
        const tx = 12 + nw / 2 + 2 * (nw + 6);
        P('auth', Math.min(tx - 20, w * 0.3), h * 0.58, 150, 46);
        P('cdn', Math.max(tx + 60, w * 0.72), h * 0.58, 150, 46);
      }
      return;
    }

    if (v === 'move') {
      if (L) {
        const ys = [0.27, 0.47, 0.67].map((k) => h * k);
        P('auth', w * 0.11, h * 0.47, 176, 60);
        MOVE_RESOLVERS.forEach((r, i) => P(r, w * 0.36, ys[i], 186, 64));
        USERS.forEach((u, i) => P(u, w * 0.6, ys[i], 132, 44));
        P('web', w * 0.86, h * 0.33, 170, 56);
        P('web2', w * 0.86, h * 0.62, 170, 56);
      } else {
        const cw = (w - 24 - 12) / 3;
        const xs = [0, 1, 2].map((i) => 12 + cw / 2 + i * (cw + 6));
        P('auth', w * 0.5, 96, 176, 50);
        MOVE_RESOLVERS.forEach((r, i) => P(r, xs[i], h * 0.36, cw, 66));
        USERS.forEach((u, i) => P(u, xs[i], h * 0.56, cw, 38));
        P('web', w * 0.27, h * 0.76, (w - 36) / 2, 48);
        P('web2', w * 0.73, h * 0.76, (w - 36) / 2, 48);
      }
      return;
    }

    if (v === 'seq') return;

    // ---------------- flow view ----------------
    const servers = SERVER_IDS.filter((s) => live(s));
    const hasWifi = live('wifi');
    const hasBob = live('bob');
    if (L) {
      const pad = this.compact ? 22 : 34;
      const sw = this.compact ? 176 : 200;
      const sx = w - pad - sw / 2;
      const midY = h * (this.cfg.dig ? (servers.length >= 4 ? 0.5 : 0.53) : 0.47);
      const lw = hasWifi ? 146 : this.compact ? 150 : 162;
      const rx = hasWifi ? w * 0.55 : w * 0.43;
      const ry = midY;
      const cx = pad + lw / 2;
      if (this.cfg.zoneFile) {
        // The zone file hangs under the authoritative server, so everything sits high.
        const y = h * 0.2;
        P('laptop', cx, y, lw, 50);
        P('resolver', w * 0.4, y, 200, 64);
        P('auth', sx - 20, y, sw, 60);
        return;
      }
      if (live('web') && !servers.length) {
        // Chapter 1: laptop, "DNS" and the shop's web server.
        P('laptop', w * 0.2, h * 0.58, 180, 56);
        P('resolver', w * 0.5, h * 0.3, 230, 74);
        P('web', w * 0.8, h * 0.58, 200, 62);
        return;
      }
      P('laptop', cx, hasBob ? ry - 44 : ry, lw, 50);
      P('bob', cx, ry + 48, lw, 50);
      if (hasWifi) P('wifi', (cx + lw / 2 + rx - 95) / 2, ry, 132, 50);
      P('resolver', rx, ry, hasWifi ? 190 : 200, 64);
      const n = servers.length;
      const span = n >= 4 ? 0.58 : 0.5;
      const top = midY - (h * span) / 2;
      servers.forEach((s, i) => P(s, sx, n === 1 ? midY : top + (i * h * span) / (n - 1), sw, 60));
      P('web', sx, h * 0.8, sw - 10, 54);
    } else {
      const half = (w - 34) / 2;
      if (live('web') && !servers.length) {
        P('laptop', 12 + half / 2, h * 0.6, half, 46);
        P('resolver', w * 0.5, h * 0.3, 210, 66);
        P('web', w - 12 - half / 2, h * 0.6, half, 50);
        return;
      }
      // Leave room for the HUD; with nothing docked below, sit a little lower.
      const docked = this.cfg.dig || this.cfg.dock !== 'none';
      const top = (this.cfg.hasHud ? 102 : 86) + (docked ? 0 : 56);
      if (hasWifi) {
        const cw = (w - 24 - 12) / 3;
        P('laptop', 12 + cw / 2, top, cw, 44);
        P('wifi', w * 0.5, top, cw, 44);
        P('resolver', w - 12 - cw / 2, top, cw, 50);
      } else {
        P('laptop', 12 + half / 2, top, half, 44);
        P('resolver', w - 12 - half / 2, top, half, 50);
      }
      P('bob', 12 + half / 2, top + 52, half, 40);
      const rowY = top + (hasBob ? 146 : 108);
      const n = servers.length;
      if (n <= 3) {
        const cw = (w - 24 - 2 * 8) / 3;
        servers.forEach((s, i) => P(s, 12 + cw / 2 + i * (cw + 8) + ((3 - n) * (cw + 8)) / 2, rowY, cw, 52));
      } else {
        const cw = (w - 24 - 8) / 2;
        servers.forEach((s, i) => P(s, 12 + cw / 2 + (i % 2) * (cw + 8), rowY - 22 + Math.floor(i / 2) * 60, cw, 50));
      }
      P('web', w * 0.5, h * 0.62, w * 0.6, 44);
    }
  }

  protected wires(): WireSpec[] {
    const v = this.cfg.view;
    const out: WireSpec[] = [];
    const has = (id: string) => this.isLive(id);
    if (v === 'seq') return out;
    if (v === 'tree') {
      for (const t of ['com', 'org', 'tld', 'dev']) if (has(t)) out.push({ from: 'root', to: t, state: t === 'tld' ? 'normal' : 'dim' });
      if (has('auth')) out.push({ from: 'tld', to: 'auth' });
      if (has('cdn')) out.push({ from: 'tld', to: 'cdn', state: 'dim' });
      return out;
    }
    if (v === 'move') {
      USERS.forEach((u, i) => {
        const r = MOVE_RESOLVERS[i];
        out.push({ from: r, to: u });
        out.push({ from: 'auth', to: r, state: 'dashed' });
        const st = this.users.get(u);
        const box = st?.ip === IP_NEW ? 'web2' : 'web';
        if (has(box)) out.push({ from: u, to: box, state: box === 'web' && this.webDown ? 'down' : 'dim' });
      });
      return out;
    }
    for (const c of ['laptop', 'bob']) {
      if (!has(c) || !has('resolver')) continue;
      if (has('wifi') && c === 'laptop') {
        out.push({ from: 'laptop', to: 'wifi', state: this.cfg.transport === 'udp' ? 'normal' : 'control' });
        out.push({ from: 'wifi', to: 'resolver', state: this.cfg.transport === 'udp' ? 'normal' : 'control' });
      } else out.push({ from: c, to: 'resolver' });
    }
    if (!this.cfg.blackBox) for (const s of SERVER_IDS) if (has(s) && has('resolver')) out.push({ from: 'resolver', to: s, state: 'dashed' });
    if (has('web') && has('laptop')) out.push({ from: 'laptop', to: 'web', state: 'dim' });
    return out;
  }

  protected curveFor(from: string, to: string, lane: number): Curve | null {
    const a = this.boxes.get(from);
    const b = this.boxes.get(to);
    if (!a || !b || Number.isNaN(a.x) || Number.isNaN(b.x)) return null;
    // Phone: the resolver sits beside the laptop, servers below; route those hops vertically.
    if (this.orient === 'portrait' && this.cfg.view === 'flow' && (RESOLVERS.has(from) || RESOLVERS.has(to))) {
      const other = RESOLVERS.has(from) ? b : a;
      if (SERVER_IDS.includes(other.id as ServerId)) {
        const res = RESOLVERS.has(from) ? a : b;
        const down = res === a;
        const p0 = down ? { x: a.x - lane, y: a.y + a.h / 2 } : { x: a.x + lane, y: a.y - a.h / 2 };
        const p3 = down ? { x: b.x - lane, y: b.y - b.h / 2 } : { x: b.x + lane, y: b.y + b.h / 2 };
        const k = Math.max(20, Math.abs(p3.y - p0.y) * 0.55);
        return { p0, p1: { x: p0.x, y: p0.y + (down ? k : -k) }, p2: { x: p3.x, y: p3.y - (down ? k : -k) }, p3 };
      }
    }
    return portCurve(a, b, lane);
  }
}

export function shortAnswer(r: RR) {
  if (r.type === 'MX') return `MX ${r.data.replace(/\.$/, '')}`;
  if (r.type === 'TXT') return 'TXT "…"';
  if (r.type === 'CNAME') return `CNAME ${target(r.data)}`;
  if (r.type === 'NS') return `NS ${target(r.data)}`;
  return `${r.type === 'A' ? '' : `${r.type} `}${r.data}`;
}
