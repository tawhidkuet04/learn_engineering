import { SIG } from '@/lib/sim/colors';
import { clamp, damp, type Pt } from '@/lib/sim/geometry';
import { PredictGame } from '@/lib/sim/predict';
import { mulberry32 } from '@/lib/sim/rng';
import { Sim, type Flight, type FlightView, type ScriptEvent } from '@/lib/sim/Sim';
import { ep, intToIp, ipToInt, maskOf, netOf, sameAddr, sameNet, type Addr } from './ip';

/* ------------------------------------------------------------------ */
/* Config                                                              */
/* ------------------------------------------------------------------ */

export type View = 'bits' | 'map' | 'net';
export type Topo = 'home' | 'two' | 'cgnat';
export type BitRow = 'addr' | 'mask' | 'net' | 'bcast';
export type MapMode = 'fill' | 'private';
export type Scenario =
  | 'idle'
  | 'arp'
  | 'gateway'
  | 'predict-gw'
  | 'no-nat'
  | 'rewrite'
  | 'reply'
  | 'many'
  | 'predict-nat'
  | 'inbound'
  | 'forward'
  | 'p2p'
  | 'cgnat'
  | 'cheat'
  | 'play';
export type PredictKind = 'gw' | 'nat';

export interface Cfg {
  view: View;
  /* bits view */
  addr: string;
  prefix: number;
  rows: BitRow[];
  /** Click a bit to flip it */
  flip: boolean;
  /** Place values (128 … 1) under the address bits */
  places: boolean;
  /** Reveal the mask row, then sweep the AND into the network row */
  andAnim: boolean;
  v6: boolean;
  /* map view */
  map: MapMode;
  /* network view */
  topo: Topo;
  devices: string[];
  hosts: string[];
  scenario: Scenario;
  /** Port forward :8080 → laptop:8080 in place when the step starts */
  forward: boolean;
  /** NAT idle timeout, simulated seconds */
  timeout: number;
  /** Box ids in focus; everything else is dimmed */
  focus: string[];
  /** Height of the main line, as a fraction of the stage (landscape) */
  midY: number;
}

export const DEFAULTS: Cfg = {
  view: 'net',
  addr: '192.168.1.23',
  prefix: 24,
  rows: ['addr'],
  flip: false,
  places: false,
  andAnim: false,
  v6: false,
  map: 'fill',
  topo: 'home',
  devices: ['laptop', 'phone', 'tv'],
  hosts: ['server'],
  scenario: 'idle',
  forward: false,
  timeout: 40,
  focus: [],
  midY: 0.4,
};

/* ------------------------------------------------------------------ */
/* The cast                                                            */
/* ------------------------------------------------------------------ */

export type Glyph = 'laptop' | 'phone' | 'tv' | 'printer' | 'nas' | 'router' | 'server' | 'person' | 'isp' | 'stun';

export interface NodeLabel {
  name: string;
  ip: string;
  /** Routers: the address on the internet side */
  wan?: string;
  glyph: Glyph;
  /** Drawn as a dashed placeholder (the "another host" slot) */
  ghost?: boolean;
  /** Small badge, e.g. "serving :8080" */
  badge?: string;
}

export const HOME_DEVS = ['laptop', 'phone', 'tv', 'guest'];
const NAT_IDS = ['router', 'routerB', 'cgnat'];
const HOST_IDS = ['server', 'carol', 'stun'];

const BASE: Record<string, NodeLabel> = {
  laptop: { name: 'laptop', ip: '192.168.1.23', glyph: 'laptop' },
  phone: { name: 'phone', ip: '192.168.1.31', glyph: 'phone' },
  tv: { name: 'TV', ip: '192.168.1.40', glyph: 'tv' },
  guest: { name: 'another host', ip: '', glyph: 'printer', ghost: true },
  router: { name: 'home router', ip: '192.168.1.1', wan: '203.0.113.7', glyph: 'router' },
  routerB: { name: "Bob's router", ip: '10.0.0.1', wan: '198.51.100.77', glyph: 'router' },
  bob: { name: "Bob's laptop", ip: '10.0.0.5', glyph: 'laptop' },
  cgnat: { name: 'ISP CGNAT', ip: '100.64.0.1', wan: '203.0.113.99', glyph: 'isp' },
  server: { name: 'web server', ip: '198.51.100.20', glyph: 'server' },
  carol: { name: 'Carol', ip: '192.0.2.50', glyph: 'person' },
  stun: { name: 'STUN server', ip: '192.0.2.10', glyph: 'stun' },
  cloud: { name: 'internet', ip: '', glyph: 'server' },
};

/** Documentation MAC addresses (RFC 7042: 00-00-5E-00-53-xx). */
export const MAC: Record<string, string> = {
  laptop: '00:00:5e:00:53:23',
  phone: '00:00:5e:00:53:31',
  tv: '00:00:5e:00:53:40',
  guest: '00:00:5e:00:53:c8',
  router: '00:00:5e:00:53:01',
};
export const BROADCAST_MAC = 'ff:ff:ff:ff:ff:ff';

export const PUBLIC_IP = '203.0.113.7';
export const SERVER_IP = '198.51.100.20';

/* ------------------------------------------------------------------ */
/* Packets, NAT rows, readout state                                    */
/* ------------------------------------------------------------------ */

export type Proto = 'tcp' | 'udp';

export interface Pkt {
  id: number;
  proto: Proto | 'arp' | 'eth';
  head: string;
  src: Addr;
  dst: Addr;
  /** Layer-2 view, shown in the delivery chapter */
  eth?: { dst: string; dstName: string };
  arp?: { op: 'request' | 'reply'; who: string; tell: string; mac?: string };
  /** Values before the last NAT rewrite */
  was: { src?: Addr; dst?: Addr };
  changed: 'src' | 'dst' | null;
  color: string;
  label?: string;
  inspect: boolean;
  /** Carries a question: called on arrival at a NAT box instead of processing */
  gate?: (resume: () => void) => void;
  app: 'web' | 'data' | 'stun' | 'p2p' | 'stream' | 'carol' | 'lan' | 'probe';
  /** STUN answer: the address the STUN server saw */
  mapped?: Addr;
  /** Which device opened the conversation (for stats) */
  owner?: string;
  outcome?: 'dropped' | 'delivered';
  /** Carol's connection attempt this packet belongs to */
  attempt?: number;
}

export interface Rest {
  p: Pkt;
  at: string;
  vt0: number;
  /** Waiting for the learner */
  held: boolean;
}

export interface Mapping {
  id: number;
  box: string;
  proto: Proto;
  inside: Addr;
  outside: Addr;
  /** null = any remote (a port forward) */
  remote: Addr | null;
  /** Box that receives inbound packets for this row */
  dev: string;
  static: boolean;
  last: number;
  bornVt: number;
  hitVt: number;
  goneVt: number | null;
  pkts: number;
}

export interface NatBox {
  id: string;
  on: boolean;
  pub: string;
  lanNet: number;
  lanPrefix: number;
  next: number;
  rows: Mapping[];
  /** A different public port for every destination (breaks hole punching) */
  symmetric: boolean;
  lookup: { vt: number; port: number; ok: boolean; from: Addr; proto: Proto } | null;
}

export interface Decision {
  dst: string;
  prefix: number;
  local: boolean;
  revealed: boolean;
  vt: number;
}

export interface LogLine {
  text: string;
  tone: 'ok' | 'bad' | 'dim';
  vt: number;
  /** Carol's attempts: the packet this line is about, so its status can be updated */
  pid?: number;
  status?: string;
}

export interface Stats {
  conns: number;
  inTries: number;
  inOk: number;
  inDrop: number;
  drops: number;
  expiredDrops: number;
  lostNoRoute: number;
  punched: boolean;
}

export interface Asking {
  kind: string;
  at: string;
  text: string;
}

interface GwQ {
  prefix: number;
  dst: string;
  local: boolean;
  guest?: { name: string; glyph: Glyph };
}

const GW_QUESTIONS: GwQ[] = [
  { prefix: 24, dst: '192.168.1.200', local: true, guest: { name: 'printer', glyph: 'printer' } },
  { prefix: 26, dst: '192.168.1.70', local: false },
  { prefix: 16, dst: '192.168.7.9', local: true, guest: { name: 'NAS', glyph: 'nas' } },
  { prefix: 24, dst: '192.168.2.23', local: false },
  { prefix: 24, dst: '203.0.113.50', local: false },
];

const NAT_QUESTIONS = ['seen', 'who', 'clash', 'back', 'stray'] as const;
type NatQ = (typeof NAT_QUESTIONS)[number];

/* ------------------------------------------------------------------ */
/* Map view: the IPv4 address space in /8 blocks                       */
/* ------------------------------------------------------------------ */

export type BlockKind = 'unicast' | 'zero' | 'private' | 'loopback' | 'multicast' | 'future';

export function blockKind(n: number): BlockKind {
  if (n === 0) return 'zero';
  if (n === 10) return 'private';
  if (n === 127) return 'loopback';
  if (n >= 224 && n <= 239) return 'multicast';
  if (n >= 240) return 'future';
  return 'unicast';
}

/** The last blocks IANA handed out: two to APNIC in January 2011, then one to each RIR on 3 February 2011. */
export const LAST_BLOCKS = [39, 106, 102, 103, 104, 179, 185];

/** Illustrative fill order for the allocatable /8s, ending with the real final allocations. */
export const FILL_ORDER: number[] = (() => {
  const rng = mulberry32(2011);
  const rest = Array.from({ length: 256 }, (_, i) => i).filter((n) => blockKind(n) === 'unicast' && !LAST_BLOCKS.includes(n));
  // Roughly ascending with plenty of shuffle, the way early class A grants and later RIR blocks interleave.
  const keyed = rest.map((n) => ({ n, k: n / 255 + rng() * 0.9 }));
  keyed.sort((a, b) => a.k - b.k);
  return [...keyed.map((x) => x.n), ...LAST_BLOCKS];
})();

export const FILL_START = 0.8;
export const FILL_DUR = 8.5;

/* ------------------------------------------------------------------ */
/* Polyline helpers                                                    */
/* ------------------------------------------------------------------ */

function polyLen(pts: Pt[]) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return L;
}

function polyAt(pts: Pt[], s: number): Pt {
  let left = s;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (left <= seg || i === pts.length - 1) {
      const k = seg > 0 ? clamp(left / seg, 0, 1) : 0;
      return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
    }
    left -= seg;
  }
  return pts[pts.length - 1];
}

/* ------------------------------------------------------------------ */
/* The simulation                                                      */
/* ------------------------------------------------------------------ */

const LAN_HOP = 0.85;
const WAN_HOP = 1.25;

export class NatSim extends Sim {
  cfg: Cfg = { ...DEFAULTS };
  game: PredictGame | null = null;
  pKind: PredictKind | null = null;
  asking: Asking | null = null;

  /* bits view */
  addr = ipToInt('192.168.1.23');
  prefix = 24;
  prefixVis = 24;
  flipVt: number[] = Array.from({ length: 32 }, () => -10);
  lastFlip: number | null = null;

  /* network view */
  labels: Record<string, NodeLabel> = { ...BASE };
  nats = new Map<string, NatBox>();
  rests: Rest[] = [];
  /** Packet riding each flight */
  pk = new Map<number, Pkt>();
  inspectId: number | null = null;
  lanPrefix = 24;
  decision: Decision | null = null;
  arp = new Map<string, { mac: string; vt: number }>();
  route: { dst: string; row: number; vt: number } | null = null;
  serverLog: LogLine[] = [];
  carolLog: LogLine[] = [];
  peerLog: LogLine[] = [];
  stats: Stats = { conns: 0, inTries: 0, inOk: 0, inDrop: 0, drops: 0, expiredDrops: 0, lostNoRoute: 0, punched: false };
  /** Public ports whose mapping timed out (box:proto:port) */
  expired = new Set<string>();
  /** "No route: which 192.168.1.23?" marker in the internet */
  noRoute: { vt: number; ip: string } | null = null;
  /** Live devices in the playground */
  active = new Set<string>();
  stream: { dev: string; seenAs: Addr | null; nextPush: number; lastData: number; stalled: boolean; stallVt: number } | null = null;
  /** Hole-punching progress, for the readout */
  p2p: { alice: Addr | null; bob: Addr | null; exchanged: boolean; phase: string } = { alice: null, bob: null, exchanged: false, phase: '' };

  private pseq = 1;
  private mseq = 1;
  private portSeq = new Map<string, number>();
  private nextOpen = new Map<string, number>();
  private qIdx = 0;
  private pNextAt = 0;

  /* ================================================================ */
  /* Step entry                                                        */
  /* ================================================================ */

  enter(cfg: Cfg, script: ScriptEvent<NatSim>[] = [], opts: { predict?: PredictKind | null; needed?: number } = {}) {
    const prev = this.cfg;
    const snap = !this.sized || prev.view !== cfg.view || prev.topo !== cfg.topo;
    this.cfg = { ...cfg, rows: [...cfg.rows], devices: [...cfg.devices], hosts: [...cfg.hosts], focus: [...cfg.focus] };
    this.resetWorld();
    this.pKind = opts.predict ?? null;
    this.game = this.pKind ? new PredictGame(this, opts.needed ?? 3) : null;
    this.asking = null;
    this.qIdx = 0;
    this.pNextAt = this.t + 1.0;
    this.runScript(script);
    this.syncBoxes();
    this.relayout();
    if (snap) this.snap();
    this.startScenario();
    this.rev++;
  }

  private resetWorld() {
    this.clearTransient();
    this.pk.clear();
    this.rests = [];
    this.inspectId = null;
    this.rng = mulberry32(7);
    const c = this.cfg;
    this.addr = ipToInt(c.addr);
    this.prefix = c.prefix;
    this.prefixVis = c.prefix;
    this.flipVt = Array.from({ length: 32 }, () => -10);
    this.lastFlip = null;
    this.labels = Object.fromEntries(Object.entries(BASE).map(([k, v]) => [k, { ...v }]));
    this.lanPrefix = 24;
    this.decision = null;
    this.arp = new Map();
    this.route = null;
    this.serverLog = [];
    this.carolLog = [];
    this.peerLog = [];
    this.stats = { conns: 0, inTries: 0, inOk: 0, inDrop: 0, drops: 0, expiredDrops: 0, lostNoRoute: 0, punched: false };
    this.noRoute = null;
    this.expired = new Set();
    this.inspectNextReply = false;
    this.stream = null;
    this.p2p = { alice: null, bob: null, exchanged: false, phase: '' };
    this.portSeq = new Map([
      ['laptop', 51000],
      ['phone', 51000],
      ['tv', 50522],
      ['bob', 50000],
      ['carol', 53211],
    ]);
    this.nextOpen = new Map();
    this.active = new Set(c.devices.filter((d) => d !== 'guest'));

    // NAT boxes
    this.nats = new Map();
    const lan = ipToInt('192.168.1.0');
    this.nats.set('router', {
      id: 'router',
      on: true,
      pub: c.topo === 'cgnat' ? '100.64.12.34' : PUBLIC_IP,
      lanNet: lan,
      lanPrefix: 24,
      next: 40001,
      rows: [],
      symmetric: false,
      lookup: null,
    });
    this.nats.set('routerB', { id: 'routerB', on: true, pub: '198.51.100.77', lanNet: ipToInt('10.0.0.0'), lanPrefix: 24, next: 62000, rows: [], symmetric: false, lookup: null });
    this.nats.set('cgnat', { id: 'cgnat', on: true, pub: '203.0.113.99', lanNet: ipToInt('100.64.0.0'), lanPrefix: 10, next: 61234, rows: [], symmetric: false, lookup: null });
    if (c.topo === 'cgnat') this.labels.router.wan = '100.64.12.34';

    if (c.scenario === 'no-nat') {
      this.nats.get('router')!.on = false;
      this.nats.get('routerB')!.on = false;
      this.labels.laptop = { name: "Alice's laptop", ip: '192.168.1.23', glyph: 'laptop' };
      this.labels.bob = { name: "Bob's laptop", ip: '192.168.1.23', glyph: 'laptop' };
      this.labels.router = { name: "Alice's router", ip: '192.168.1.1', wan: PUBLIC_IP, glyph: 'router' };
      this.labels.routerB = { name: "Bob's router", ip: '192.168.1.1', wan: '198.51.100.77', glyph: 'router' };
      this.nats.get('routerB')!.lanNet = lan;
    }
    if (c.scenario === 'p2p') {
      this.labels.laptop = { name: "Alice's laptop", ip: '192.168.1.23', glyph: 'laptop' };
      this.labels.router = { name: "Alice's router", ip: '192.168.1.1', wan: PUBLIC_IP, glyph: 'router' };
      this.labels.server = { name: 'app server', ip: SERVER_IP, glyph: 'server' };
    }
    if (c.scenario === 'inbound' || c.scenario === 'forward' || c.scenario === 'cgnat' || c.scenario === 'cheat' || c.scenario === 'play') {
      this.labels.laptop.badge = 'serving :8080';
    }
    if (c.forward) this.addForward(false);
  }

  /* ================================================================ */
  /* Boxes and layout                                                  */
  /* ================================================================ */

  private wanted(): string[] {
    const c = this.cfg;
    if (c.view !== 'net') return [];
    const want: string[] = ['cloud', ...c.hosts];
    if (c.topo === 'two') want.push('laptop', 'router', 'bob', 'routerB');
    else {
      want.push('router', ...c.devices);
      if (c.topo === 'cgnat') want.push('cgnat');
    }
    return want;
  }

  private syncBoxes() {
    const want = new Set(this.wanted());
    for (const id of want) this.box(id);
    for (const id of [...this.boxes.keys()]) if (!want.has(id)) this.hide(id);
  }

  /** Home devices currently on the stage, in slot order. */
  homeDevs(): string[] {
    return HOME_DEVS.filter((id) => this.boxes.has(id) && this.isLive(id));
  }

  protected layout() {
    if (this.cfg.view !== 'net') return;
    const { w: W, h: H } = this;
    const land = this.orient === 'landscape';
    const put = (id: string, x: number, y: number, bw: number, bh: number) => {
      if (this.boxes.has(id)) this.place(id, x, y, bw, bh);
    };
    const hosts = this.cfg.hosts;
    const devs = this.homeDevs();
    const topo = this.cfg.topo;

    if (land) {
      const big = W >= 900;
      const dw = big ? 152 : 136;
      const dh = 48;
      if (topo === 'two') {
        const cy = clamp(H * 0.5, 300, 440);
        const devX = clamp(W * 0.1, 86, 128);
        const rX = devX + (big ? 192 : 172);
        put('laptop', devX, cy, dw, dh);
        put('router', rX, cy, 148, 78);
        put('bob', W - devX, cy, dw, dh);
        put('routerB', W - rX, cy, 148, 78);
        put('cloud', W / 2, cy, 146, 96);
        const hy = cy - clamp(H * 0.25, 150, 210);
        if (hosts.includes('server') && hosts.includes('stun')) {
          put('server', W / 2 - 150, hy, 150, 52);
          put('stun', W / 2 + 150, hy, 150, 52);
        } else {
          put('server', W / 2, hy, 150, 52);
          put('stun', W / 2, hy, 150, 52);
        }
        return;
      }
      const cy = clamp(H * this.cfg.midY, 230, 420);
      const devX = clamp(W * 0.105, 86, 132);
      const n = devs.length;
      const gap = n >= 4 ? 88 : 96;
      devs.forEach((id, i) => put(id, devX, cy + (i - (n - 1) / 2) * gap, dw, dh));
      const serverX = W - clamp(W * 0.105, 84, 130);
      const hostW = big ? 150 : 136;
      if (topo === 'cgnat') {
        const rX = devX + (big ? 215 : 190);
        const cgX = rX + (big ? 190 : 160);
        put('router', rX, cy, 140, 78);
        put('cgnat', cgX, cy, 146, 78);
        put('cloud', (cgX + serverX) / 2, cy, 140, 92);
        put('server', serverX, cy, hostW - 10, 52);
        put('carol', serverX, cy - 170, hostW - 10, 50);
        return;
      }
      const rX = devX + (big ? 248 : 220);
      put('router', rX, cy, 150, 82);
      put('cloud', (rX + serverX) / 2 + 8, cy, big ? 184 : 160, 104);
      put('server', serverX, cy, hostW, 52);
      put('carol', serverX, cy - 172, hostW, 50);
      put('stun', serverX, cy - 172, hostW, 50);
      return;
    }

    /* portrait: internet on top, home at the bottom */
    const cw = Math.min(172, W - 40);
    if (topo === 'two') {
      const hy = 120;
      if (hosts.includes('server') && hosts.includes('stun')) {
        put('server', W * 0.28, hy, Math.min(150, W * 0.46), 44);
        put('stun', W * 0.72, hy, Math.min(150, W * 0.46), 44);
      } else {
        put('server', W / 2, hy, 150, 44);
        put('stun', W / 2, hy, 150, 44);
      }
      put('cloud', W / 2, 196, 132, 54);
      const rw = Math.min(156, W * 0.44);
      put('router', W * 0.27, 282, rw, 58);
      put('routerB', W * 0.73, 282, rw, 58);
      put('laptop', W * 0.27, 372, rw, 44);
      put('bob', W * 0.73, 372, rw, 44);
      return;
    }
    const n = devs.length;
    const dw = n >= 4 ? Math.min(84, (W - 20 - 3 * 6) / 4) : Math.min(110, (W - 24 - (n - 1) * 8) / Math.max(1, n));
    const stepX = dw + (n >= 4 ? 6 : 8);
    const twoHosts = hosts.includes('carol') || hosts.includes('stun');
    const hw = Math.min(150, W * 0.44);
    if (topo === 'cgnat') {
      put('server', twoHosts ? W * 0.72 : W / 2, 108, hw, 42);
      put('carol', W * 0.28, 108, hw, 42);
      put('cloud', W / 2, 172, 128, 48);
      put('cgnat', W / 2, 238, cw, 52);
      put('router', W / 2, 304, cw, 52);
      devs.forEach((id, i) => put(id, W / 2 + (i - (n - 1) / 2) * stepX, 392, dw, 44));
      return;
    }
    put('server', twoHosts ? W * 0.72 : W / 2, 124, hw, 44);
    put('carol', W * 0.28, 124, hw, 44);
    put('stun', W * 0.28, 124, hw, 44);
    put('cloud', W / 2, 198, 136, 56);
    put('router', W / 2, 276, cw, 56);
    devs.forEach((id, i) => put(id, W / 2 + (i - (n - 1) / 2) * stepX, 378, dw, 46));
  }

  /* ---------------- ports, the LAN bus and packet paths ---------------- */

  private edge(id: string, side: 'l' | 'r' | 't' | 'b'): Pt | null {
    const b = this.boxes.get(id);
    if (!b || Number.isNaN(b.x)) return null;
    if (side === 'l') return { x: b.x - b.w / 2, y: b.y };
    if (side === 'r') return { x: b.x + b.w / 2, y: b.y };
    if (side === 't') return { x: b.x, y: b.y - b.h / 2 };
    return { x: b.x, y: b.y + b.h / 2 };
  }

  private center(id: string): Pt | null {
    const b = this.boxes.get(id);
    return b && !Number.isNaN(b.x) ? { x: b.x, y: b.y } : null;
  }

  /** The shared LAN segment of the home network (null in the two-homes view). */
  bus(): { x1: number; y1: number; x2: number; y2: number; vertical: boolean } | null {
    if (this.cfg.view !== 'net' || this.cfg.topo === 'two') return null;
    const devs = this.homeDevs().map((id) => this.boxes.get(id)!).filter((b) => !Number.isNaN(b.x));
    const r = this.boxes.get('router');
    if (!r || Number.isNaN(r.x) || !devs.length) return null;
    if (this.orient === 'landscape') {
      const right = Math.max(...devs.map((b) => b.x + b.w / 2));
      const x = (right + (r.x - r.w / 2)) / 2;
      const ys = [...devs.map((b) => b.y), r.y];
      return { x1: x, y1: Math.min(...ys) - 14, x2: x, y2: Math.max(...ys) + 14, vertical: true };
    }
    const top = Math.min(...devs.map((b) => b.y - b.h / 2));
    const y = (top + (r.y + r.h / 2)) / 2;
    const xs = [...devs.map((b) => b.x), r.x];
    return { x1: Math.min(...xs) - 16, y1: y, x2: Math.max(...xs) + 16, y2: y, vertical: false };
  }

  private busPt(id: string): Pt | null {
    const bus = this.bus();
    const c = this.center(id);
    if (!bus || !c) return null;
    return bus.vertical ? { x: bus.x1, y: c.y } : { x: c.x, y: bus.y1 };
  }

  /** Where a box connects to its LAN. */
  lanPort(id: string): Pt | null {
    const land = this.orient === 'landscape';
    if (this.cfg.topo === 'two') {
      if (id === 'bob') return this.edge(id, land ? 'l' : 't');
      if (id === 'routerB') return this.edge(id, land ? 'r' : 'b');
      if (id === 'router') return this.edge(id, land ? 'l' : 'b');
      return this.edge(id, land ? 'r' : 't');
    }
    if (id === 'router') return this.edge(id, land ? 'l' : 'b');
    return this.edge(id, land ? 'r' : 't');
  }

  /** Where a box connects toward the internet. */
  wanPort(id: string): Pt | null {
    const land = this.orient === 'landscape';
    if (HOST_IDS.includes(id)) {
      if (this.cfg.topo === 'two') return this.edge(id, 'b');
      return this.edge(id, land ? 'l' : 'b');
    }
    if (id === 'routerB') return this.edge(id, land ? 'l' : 't');
    return this.edge(id, land ? 'r' : 't');
  }

  private isHomeDev(id: string) {
    return HOME_DEVS.includes(id) || id === 'bob';
  }

  /** The polyline a packet follows between two boxes. */
  pathPoints(a: string, b: string): Pt[] | null {
    const direct = this.pathOneWay(a, b);
    if (direct) return direct;
    const rev = this.pathOneWay(b, a);
    return rev ? [...rev].reverse() : null;
  }

  private pathOneWay(a: string, b: string): Pt[] | null {
    const topo = this.cfg.topo;
    const ok = (pts: (Pt | null)[]) => (pts.every(Boolean) ? (pts as Pt[]) : null);
    // Home devices on the same LAN
    if (HOME_DEVS.includes(a) && HOME_DEVS.includes(b)) return ok([this.lanPort(a), this.busPt(a), this.busPt(b), this.lanPort(b)]);
    if (HOME_DEVS.includes(a) && b === 'router') {
      if (topo === 'two') return ok([this.lanPort(a), this.lanPort('router')]);
      return ok([this.lanPort(a), this.busPt(a), this.busPt('router'), this.lanPort('router')]);
    }
    if (a === 'bob' && b === 'routerB') return ok([this.lanPort('bob'), this.lanPort('routerB')]);
    if (a === 'router' && b === 'cgnat') return ok([this.wanPort('router'), this.edge('cgnat', this.orient === 'landscape' ? 'l' : 'b')]);
    const cloud = this.center('cloud');
    const outer = (id: string) => (id === 'cgnat' ? this.edge('cgnat', this.orient === 'landscape' ? 'r' : 't') : this.wanPort(id));
    const internetSide = (id: string) => NAT_IDS.includes(id) || HOST_IDS.includes(id);
    if (internetSide(a) && internetSide(b)) return ok([outer(a), cloud, outer(b)]);
    if (internetSide(a) && b === 'cloud') return ok([outer(a), cloud]);
    return null;
  }

  /* Flights follow our polylines instead of the kit's curves. */
  private viewOf(f: Flight): FlightView | null {
    const pts = this.pathPoints(f.from, f.to);
    if (!pts) return null;
    const L = polyLen(pts);
    const p = this.progressOf(f);
    const s = p * L;
    const pos = polyAt(pts, s);
    const tail = polyAt(pts, Math.max(0, s - 22));
    const ahead = polyAt(pts, Math.min(L, s + 1.5));
    const back = polyAt(pts, Math.max(0, s - 1.5));
    return {
      id: f.id,
      x: pos.x,
      y: pos.y,
      tx: tail.x,
      ty: tail.y,
      angle: Math.atan2(ahead.y - back.y, ahead.x - back.x),
      progress: p,
      color: f.color,
      r: f.r,
      shape: f.shape,
      label: f.label,
      trail: f.trail,
      tag: f.tag,
    };
  }

  flightViews(): FlightView[] {
    const out: FlightView[] = [];
    for (const f of this.flights) {
      const v = this.viewOf(f);
      if (v) out.push(v);
    }
    return out;
  }

  flightPoint(f: Flight, progress: number): Pt | null {
    const pts = this.pathPoints(f.from, f.to);
    if (!pts) return null;
    return polyAt(pts, clamp(progress, 0, 1) * polyLen(pts));
  }

  /** Where a packet waiting inside a box is drawn. */
  restPoint(id: string): Pt | null {
    const b = this.boxes.get(id);
    if (!b || Number.isNaN(b.x)) return null;
    if (NAT_IDS.includes(id)) return { x: b.x + b.w / 2 - 20, y: b.y - b.h / 2 + 15 };
    return { x: b.x + b.w / 2 - 12, y: b.y - b.h / 2 + 11 };
  }

  /** The inspected packet and where it is right now. */
  inspected(): { p: Pkt; x: number; y: number; resting: boolean } | null {
    if (this.inspectId == null) return null;
    for (const f of this.flights) {
      const p = this.pk.get(f.id);
      if (p && p.id === this.inspectId) {
        const v = this.viewOf(f);
        if (v) return { p, x: v.x, y: v.y, resting: false };
      }
    }
    const r = this.rests.find((x) => x.p.id === this.inspectId);
    if (r) {
      const pt = this.restPoint(r.at);
      if (pt) return { p: r.p, x: pt.x, y: pt.y, resting: true };
    }
    return null;
  }

  /** Callout targets: box ids, plus a few named spots. */
  calloutRect(target: string): { x: number; y: number; w: number; h: number } | null {
    if (target.startsWith('wide:')) {
      if (this.orient !== 'landscape') return null;
      return this.calloutRect(target.slice(5));
    }
    if (target === 'bus') {
      const bus = this.bus();
      if (!bus) return null;
      return { x: (bus.x1 + bus.x2) / 2, y: (bus.y1 + bus.y2) / 2, w: 8, h: 8 };
    }
    if (target === 'router:nat') {
      const p = this.restPoint('router');
      return p ? { x: p.x, y: p.y, w: 30, h: 16 } : null;
    }
    if (target === 'router:wan') {
      const b = this.boxes.get('router');
      return b ? { x: b.x, y: b.y + b.h / 2 - 12, w: b.w, h: 14 } : null;
    }
    const b = this.boxes.get(target);
    return b && !Number.isNaN(b.x) ? { x: b.x, y: b.y, w: b.w, h: b.h } : null;
  }

  /** Floating label above a box, kept inside the stage. */
  note(id: string, text: string, color: string = SIG.text, dur = 1.6, below = false) {
    const b = this.boxes.get(id);
    if (!b || Number.isNaN(b.tx)) return;
    const half = text.length * 3.4 + 12;
    const x = clamp(b.tx, half + 6, this.w - half - 6);
    const y = below ? b.ty + b.h / 2 + 26 : b.ty - b.h / 2 - 8;
    this.fx({ kind: 'text', at: { x, y }, text, color, dur });
  }

  /* ================================================================ */
  /* Bits view                                                          */
  /* ================================================================ */

  flipBit(i: number) {
    if (!this.cfg.flip) return;
    this.addr = (this.addr ^ (1 << (31 - i))) >>> 0;
    this.flipVt[i] = this.vt;
    this.lastFlip = i;
    this.rev++;
  }

  setAddr(s: string) {
    this.addr = ipToInt(s);
    this.flipVt = this.flipVt.map(() => this.vt);
    this.lastFlip = null;
    this.rev++;
  }

  setPrefix(p: number) {
    this.prefix = clamp(Math.round(p), 0, 32);
    this.rev++;
  }

  /* ================================================================ */
  /* Packets                                                            */
  /* ================================================================ */

  private mk(p: Omit<Pkt, 'id' | 'was' | 'changed' | 'inspect'> & Partial<Pick<Pkt, 'inspect'>>): Pkt {
    return { was: {}, changed: null, inspect: false, ...p, id: this.pseq++ };
  }

  private hop(p: Pkt, from: string, to: string, dur: number, onArrive: () => void, lostAt: number | null = null, onLost?: () => void) {
    const f = this.send({
      from,
      to,
      dur,
      color: p.color,
      shape: p.proto === 'arp' ? 'square' : 'dot',
      r: p.proto === 'arp' ? 4.2 : 4.6,
      label: p.label,
      lostAt,
      onArrive: () => {
        this.pk.delete(f.id);
        onArrive();
      },
      onLost: () => {
        this.pk.delete(f.id);
        onLost?.();
      },
    });
    this.pk.set(f.id, p);
    return f;
  }

  /** Park a packet in a box for `dur` seconds (drawn there), then continue. */
  private rest(p: Pkt, at: string, dur: number, then: () => void) {
    const r: Rest = { p, at, vt0: this.vt, held: false };
    this.rests.push(r);
    this.after(dur, () => {
      this.rests = this.rests.filter((x) => x !== r);
      then();
    });
  }

  /** Park a packet until `release` is called. */
  private hold(p: Pkt, at: string): () => void {
    const r: Rest = { p, at, vt0: this.vt, held: true };
    this.rests.push(r);
    return () => {
      this.rests = this.rests.filter((x) => x !== r);
    };
  }

  private dropAt(p: Pkt, at: string, text: string) {
    p.outcome = 'dropped';
    this.stats.drops++;
    this.fx({ kind: 'x', at: this.restPoint(at) ?? { id: at }, color: SIG.err, size: 1.5, dur: 1.1 });
    this.note(at, text, SIG.err, 2.2);
    if (this.inspectId === p.id) this.after(1.4, () => this.inspectId === p.id && (this.inspectId = null));
    this.rev++;
  }

  private label(id: string) {
    return this.labels[id]?.name ?? id;
  }

  private ipOf(id: string) {
    return this.labels[id]?.ip ?? '';
  }

  /** Which box answers to a public address. */
  private ownerOf(ip: string): string | null {
    for (const id of NAT_IDS) {
      if (!this.boxes.has(id)) continue;
      const n = this.nats.get(id);
      if (!n) continue;
      if (id === 'router' && this.cfg.topo === 'cgnat') continue;
      if (n.pub === ip) return id;
    }
    for (const id of HOST_IDS) if (this.boxes.has(id) && this.ipOf(id) === ip) return id;
    return null;
  }

  private devByIp(natId: string, ip: string): string | null {
    if (natId === 'routerB') return this.ipOf('bob') === ip ? 'bob' : null;
    if (natId === 'cgnat') return this.nats.get('router')?.pub === ip ? 'router' : null;
    for (const id of HOME_DEVS) if (this.boxes.has(id) && this.ipOf(id) === ip && !this.labels[id]?.ghost) return id;
    return null;
  }

  private hopDur(a: string, b: string) {
    if (HOME_DEVS.includes(a) || HOME_DEVS.includes(b) || a === 'bob' || b === 'bob') return LAN_HOP;
    if ((a === 'router' && b === 'cgnat') || (a === 'cgnat' && b === 'router')) return 0.75;
    if ((a === 'router' && b === 'routerB') || (a === 'routerB' && b === 'router')) return 1.6;
    return WAN_HOP;
  }

  /* ---------------- sending ---------------- */

  /** A device (or internet host) puts a packet on the wire toward its first hop. */
  private emit(p: Pkt, from: string) {
    if (this.isHomeDev(from)) {
      const gw = from === 'bob' ? 'routerB' : 'router';
      const my = ipToInt(this.ipOf(from));
      const dst = p.dst.ip;
      const local = from !== 'bob' && sameNet(ipToInt(dst), my, this.lanPrefix) && this.devByIp('router', dst);
      const next = local ? (this.devByIp('router', dst) as string) : gw;
      this.hop(p, from, next, this.hopDur(from, next), () => this.arrive(p, next, from));
      return;
    }
    // internet host
    const owner = this.ownerOf(p.dst.ip);
    if (!owner) {
      this.hop(
        p,
        from,
        'cloud',
        0.9,
        () => {},
        0.999,
        () => this.lostInInternet(p),
      );
      return;
    }
    this.hop(p, from, owner, this.hopDur(from, owner), () => this.arrive(p, owner, from));
  }

  private lostInInternet(p: Pkt) {
    p.outcome = 'dropped';
    this.stats.lostNoRoute++;
    this.stats.drops++;
    this.noRoute = { vt: this.vt, ip: p.dst.ip };
    this.note('cloud', `no route to ${p.dst.ip}`, SIG.err, 2.6);
    this.rev++;
  }

  /* ---------------- receiving ---------------- */

  private arrive(p: Pkt, at: string, from: string) {
    if (NAT_IDS.includes(at)) {
      if (p.gate) {
        const gate = p.gate;
        p.gate = undefined;
        const release = this.hold(p, at);
        gate(() => {
          release();
          this.natProcess(p, at, from);
        });
        return;
      }
      this.natProcess(p, at, from);
      return;
    }
    if (this.isHomeDev(at)) {
      this.deviceGot(p, at);
      return;
    }
    this.hostGot(p, at);
  }

  private fromInside(natId: string, from: string) {
    if (natId === 'cgnat') return from === 'router';
    if (natId === 'routerB') return from === 'bob';
    return HOME_DEVS.includes(from);
  }

  /** A router or NAT box handles a packet: translate, then forward. */
  private natProcess(p: Pkt, at: string, from: string) {
    const n = this.nats.get(at)!;
    const slow = p.inspect;
    const d1 = slow ? 0.75 : 0.18;
    const d2 = slow ? 1.0 : 0.22;
    if (this.fromInside(at, from)) {
      this.rest(p, at, d1, () => {
        if (n.on) this.natOut(n, p, from);
        else this.note(at, 'forwarded unchanged', SIG.text2, 1.6);
        this.rest(p, at, d2, () => {
          const next = at === 'router' && this.cfg.topo === 'cgnat' ? 'cgnat' : this.ownerOf(p.dst.ip);
          if (!next) {
            this.hop(
              p,
              at,
              'cloud',
              0.8,
              () => {},
              0.999,
              () => this.lostInInternet(p),
            );
            return;
          }
          this.hop(p, at, next, this.hopDur(at, next), () => this.arrive(p, next, at));
        });
      });
      return;
    }
    // inbound
    this.rest(p, at, d1, () => {
      let dev: string | null;
      if (n.on) {
        const m = this.natIn(n, p);
        if (!m) {
          this.inboundDropped(p, at);
          return;
        }
        dev = m.dev;
      } else {
        dev = this.devByIp(at, p.dst.ip);
      }
      if (!dev) {
        this.dropAt(p, at, 'no such host');
        return;
      }
      const target = dev;
      this.rest(p, at, d2, () => this.hop(p, at, target, this.hopDur(at, target), () => this.arrive(p, target, at)));
    });
  }

  private inboundDropped(p: Pkt, at: string) {
    const expired = this.expired.has(`${at}:${p.proto}:${p.dst.port}`);
    if (expired) this.stats.expiredDrops++;
    if (p.app === 'carol') this.stats.inDrop++;
    if (p.app === 'carol') this.carolStatus(p, at === 'cgnat' ? 'dropped by the ISP' : 'dropped · timed out', 'bad');
    if (p.app === 'stream' && this.stream) {
      this.stream.stalled = true;
      this.stream.stallVt = this.vt;
      this.stream.seenAs = null;
    }
    const why = expired ? 'mapping expired · dropped' : p.app === 'p2p' ? 'no hole yet · dropped' : `no mapping for :${p.dst.port} · dropped`;
    this.dropAt(p, at, why);
  }

  /* ---------------- NAT ---------------- */

  private allocPort(n: NatBox) {
    let port = n.next++;
    while (n.rows.some((m) => m.goneVt == null && m.outside.port === port)) port = n.next++;
    return port;
  }

  /** The public port natOut would use for this packet, without changing anything. */
  peekPort(n: NatBox, src: Addr, dst: Addr): number {
    const live = n.rows.filter((m) => m.goneVt == null && m.proto === 'tcp');
    const same = live.find((r) => !r.static && sameAddr(r.inside, src) && sameAddr(r.remote, dst));
    if (same) return same.outside.port ?? 0;
    const sib = n.symmetric ? null : live.find((r) => sameAddr(r.inside, src));
    if (sib) return sib.outside.port ?? 0;
    let port = n.next;
    while (n.rows.some((m) => m.goneVt == null && m.outside.port === port)) port++;
    return port;
  }

  private natOut(n: NatBox, p: Pkt, dev: string): Mapping | null {
    if (p.proto !== 'tcp' && p.proto !== 'udp') return null;
    const proto = p.proto;
    const live = n.rows.filter((m) => m.goneVt == null && m.proto === proto);
    let m = live.find((r) => !r.static && sameAddr(r.inside, p.src) && sameAddr(r.remote, p.dst));
    if (!m) {
      // Endpoint-independent mapping: the same inside ip:port keeps its public port (RFC 4787).
      const sib = n.symmetric ? null : live.find((r) => sameAddr(r.inside, p.src));
      const port = sib?.outside.port ?? this.allocPort(n);
      m = {
        id: this.mseq++,
        box: n.id,
        proto,
        inside: { ...p.src },
        outside: { ip: n.pub, port },
        remote: { ...p.dst },
        dev,
        static: false,
        last: this.t,
        bornVt: this.vt,
        hitVt: -10,
        goneVt: null,
        pkts: 0,
      };
      n.rows.push(m);
    } else m.hitVt = this.vt;
    m.last = this.t;
    m.pkts++;
    p.was = { src: { ...p.src } };
    p.src = { ...m.outside };
    p.changed = 'src';
    if (p.label) p.label = `:${p.src.port}`;
    this.rev++;
    return m;
  }

  private natIn(n: NatBox, p: Pkt): Mapping | null {
    if (p.proto !== 'tcp' && p.proto !== 'udp') return null;
    const proto = p.proto;
    const live = n.rows.filter((m) => m.goneVt == null && m.proto === proto && m.outside.port === p.dst.port);
    let m = live.find((r) => !r.static && sameAddr(r.remote, p.src));
    const st = live.find((r) => r.static);
    n.lookup = { vt: this.vt, port: p.dst.port ?? 0, ok: !!(m || st), from: { ...p.src }, proto };
    if (!m && st) {
      // A port forward: track this new connection like any other.
      m = {
        id: this.mseq++,
        box: n.id,
        proto,
        inside: { ...st.inside },
        outside: { ...st.outside },
        remote: { ...p.src },
        dev: st.dev,
        static: false,
        last: this.t,
        bornVt: this.vt,
        hitVt: this.vt,
        goneVt: null,
        pkts: 0,
      };
      n.rows.push(m);
      st.hitVt = this.vt;
    }
    if (!m) {
      this.rev++;
      return null;
    }
    m.hitVt = this.vt;
    m.last = this.t;
    m.pkts++;
    p.was = { dst: { ...p.dst } };
    p.dst = { ...m.inside };
    p.changed = 'dst';
    if (p.label) p.label = `:${p.dst.port}`;
    this.rev++;
    return m;
  }

  addForward(announce = true) {
    const n = this.nats.get(this.cfg.topo === 'cgnat' ? 'router' : 'router');
    if (!n || n.rows.some((m) => m.static && m.goneVt == null)) return;
    n.rows.unshift({
      id: this.mseq++,
      box: n.id,
      proto: 'tcp',
      inside: { ip: '192.168.1.23', port: 8080 },
      outside: { ip: n.pub, port: 8080 },
      remote: null,
      dev: 'laptop',
      static: true,
      last: this.t,
      bornVt: announce ? this.vt : -10,
      hitVt: -10,
      goneVt: null,
      pkts: 0,
    });
    if (announce) this.note('router', 'port forward :8080 → laptop', SIG.warn, 2);
    this.rev++;
  }

  removeForward() {
    const n = this.nats.get('router');
    if (!n) return;
    for (const m of n.rows) if (m.static && m.goneVt == null) m.goneVt = this.vt;
    this.rev++;
  }

  hasForward() {
    return !!this.nats.get('router')?.rows.some((m) => m.static && m.goneVt == null);
  }

  /** Live rows of a NAT box, newest last. */
  rowsOf(id: string) {
    return this.nats.get(id)?.rows ?? [];
  }

  liveMappings(id = 'router') {
    return this.rowsOf(id).filter((m) => m.goneVt == null && !m.static).length;
  }

  /* ---------------- endpoints ---------------- */

  private deviceGot(p: Pkt, at: string) {
    p.outcome = 'delivered';
    if (this.inspectId === p.id) this.after(0.9, () => this.inspectId === p.id && (this.inspectId = null));
    // Someone connecting to the laptop's web server
    if (at === 'laptop' && p.dst.port === 8080 && p.app === 'carol') {
      this.stats.inOk++;
      this.note('laptop', 'GET / on :8080', SIG.res, 1.6);
      this.after(0.3, () => {
        const res = this.mk({
          proto: 'tcp',
          head: 'laptop → Carol',
          src: { ...p.dst },
          dst: { ...p.src },
          color: SIG.res,
          app: 'carol',
          inspect: p.inspect,
        });
        res.attempt = p.attempt;
        if (res.inspect) this.inspectId = res.id;
        this.emit(res, 'laptop');
      });
      this.rev++;
      return;
    }
    if (p.app === 'stream' && this.stream && this.stream.dev === at) {
      this.stream.lastData = this.t;
      this.stream.stalled = false;
    }
    if (p.app === 'stun' && p.mapped) {
      if (at === 'laptop') this.p2p.alice = { ...p.mapped };
      if (at === 'bob') this.p2p.bob = { ...p.mapped };
      this.note(at, `I'm ${ep(p.mapped)}`, SIG.hc, 2.2);
    }
    if (p.app === 'p2p') {
      this.stats.punched = true;
      this.peerLog.unshift({ text: `${at === 'bob' ? 'Bob' : 'Alice'} got a packet from ${ep(p.src)}`, tone: 'ok', vt: this.vt });
      this.peerLog = this.peerLog.slice(0, 4);
    }
    this.rev++;
  }

  private hostGot(p: Pkt, at: string) {
    if (this.inspectId === p.id) this.after(1.0, () => this.inspectId === p.id && (this.inspectId = null));
    if (at === 'carol') {
      p.outcome = 'delivered';
      if (p.app === 'carol') {
        this.carolStatus(p, 'connected ✓', 'ok');
        this.note('carol', 'connected ✓', SIG.res, 1.8);
      }
      this.rev++;
      return;
    }
    if (at === 'stun') {
      this.after(0.3, () => {
        const res = this.mk({
          proto: 'udp',
          head: 'STUN response',
          src: { ...p.dst },
          dst: { ...p.src },
          color: SIG.hc,
          app: 'stun',
          mapped: { ...p.src },
          inspect: p.inspect,
        });
        if (res.inspect) this.inspectId = res.id;
        this.emit(res, 'stun');
      });
      return;
    }
    // the web server
    p.outcome = 'delivered';
    if (p.app !== 'p2p') {
      this.serverLog.unshift({ text: `${ep(p.src)}`, tone: 'ok', vt: this.vt });
      this.serverLog = this.serverLog.slice(0, 4);
    }
    if (p.app === 'stream' && this.stream) {
      this.stream.seenAs = { ...p.src };
      this.stream.nextPush = this.t + 4;
    }
    this.rev++;
    if (p.app === 'probe') return;
    this.after(0.32, () => {
      const res = this.mk({
        proto: p.proto,
        head: `web server → ${p.owner ? this.label(p.owner) : 'client'}`,
        src: { ...p.dst },
        dst: { ...p.src },
        color: SIG.res,
        label: p.label ? `:${p.src.port}` : undefined,
        app: p.app === 'stream' ? 'stream' : 'data',
        owner: p.owner,
        inspect: this.inspectNextReply,
      });
      if (res.inspect) {
        this.inspectId = res.id;
        this.inspectNextReply = false;
      }
      this.emit(res, at);
    });
  }

  /** The next response the server sends gets the inspector. */
  private inspectNextReply = false;

  /* ---------------- connections ---------------- */

  private nextPort(dev: string) {
    const v = this.portSeq.get(dev) ?? 50000;
    this.portSeq.set(dev, v + 1);
    return v;
  }

  /** A device opens a connection to the web server and sends one request. */
  openConn(dev: string, opts: { inspect?: boolean; inspectReply?: boolean; port?: number; label?: boolean; gate?: Pkt['gate']; app?: Pkt['app'] } = {}) {
    if (!this.boxes.has(dev)) return null;
    const port = opts.port ?? this.nextPort(dev);
    const p = this.mk({
      proto: opts.app === 'stream' ? 'udp' : 'tcp',
      head: `${this.label(dev)} → web server`,
      src: { ip: this.ipOf(dev), port },
      dst: { ip: SERVER_IP, port: 443 },
      color: SIG.req,
      label: opts.label ? `:${port}` : undefined,
      app: opts.app ?? 'web',
      owner: dev,
      inspect: !!opts.inspect,
      gate: opts.gate,
    });
    if (p.inspect) this.inspectId = p.id;
    if (opts.inspectReply) this.inspectNextReply = true;
    this.stats.conns++;
    this.emit(p, dev);
    return p;
  }

  /** Carol tries to reach the laptop's web server through the router's public address. */
  carolConnect() {
    if (!this.boxes.has('carol')) return;
    const target = this.cfg.topo === 'cgnat' ? this.nats.get('cgnat')!.pub : this.nats.get('router')!.pub;
    const port = this.nextPort('carol');
    const p = this.mk({
      proto: 'tcp',
      head: 'Carol → your address',
      src: { ip: this.ipOf('carol'), port },
      dst: { ip: target, port: 8080 },
      color: SIG.heavy,
      app: 'carol',
      inspect: this.cfg.scenario === 'forward' || this.cfg.scenario === 'inbound' || this.cfg.scenario === 'cgnat',
    });
    p.attempt = p.id;
    if (p.inspect) this.inspectId = p.id;
    this.stats.inTries++;
    this.carolLog.unshift({ text: ep(p.dst), status: 'connecting…', tone: 'dim', vt: this.vt, pid: p.id });
    this.carolLog = this.carolLog.slice(0, 3);
    this.emit(p, 'carol');
    this.rev++;
  }

  private carolStatus(p: Pkt, status: string, tone: LogLine['tone']) {
    const line = this.carolLog.find((l) => l.pid != null && l.pid === p.attempt);
    if (line) {
      line.status = status;
      line.tone = tone;
      line.vt = this.vt;
    }
    this.rev++;
  }

  /* ================================================================ */
  /* Scenarios                                                         */
  /* ================================================================ */

  private startScenario() {
    const s = this.cfg.scenario;
    if (s === 'arp') this.scArp();
    else if (s === 'gateway') this.scGateway();
    else if (s === 'no-nat') this.scNoNat();
    else if (s === 'rewrite') this.scRewrite(false);
    else if (s === 'reply') this.scRewrite(true);
    else if (s === 'many') this.scMany();
    else if (s === 'predict-nat') this.seedTable();
    else if (s === 'inbound') this.scInbound();
    else if (s === 'forward') this.scForward();
    else if (s === 'p2p') this.scP2p();
    else if (s === 'cgnat') this.scCgnat();
    else if (s === 'cheat' || s === 'play') this.scPlay();
  }

  /* ---------- chapter 3: same network → ARP, else → gateway ---------- */

  private decide(dst: string, reveal = true) {
    const local = sameNet(ipToInt(dst), ipToInt(this.ipOf('laptop')), this.lanPrefix);
    this.decision = { dst, prefix: this.lanPrefix, local, revealed: reveal, vt: this.vt };
    this.rev++;
    return local;
  }

  /** Broadcast an ARP request from the laptop and let `target` answer. */
  private arpFor(ip: string, target: string, inspect: boolean, then: () => void) {
    const others = this.homeDevs().filter((id) => id !== 'laptop' && !this.labels[id]?.ghost);
    const recipients = [...others, 'router'];
    const req = this.mk({
      proto: 'arp',
      head: 'ARP request · broadcast',
      src: { ip: this.ipOf('laptop') },
      dst: { ip },
      arp: { op: 'request', who: ip, tell: this.ipOf('laptop') },
      color: SIG.hc,
      label: 'who has?',
      app: 'lan',
      inspect,
    });
    if (inspect) this.inspectId = req.id;
    recipients.forEach((to, i) => {
      const copy = i === 0 ? req : { ...req, label: undefined };
      this.hop(copy, 'laptop', to, 0.9, () => {
        if (to !== target) {
          this.note(to, 'not me', SIG.dim, 1.2);
          return;
        }
        this.note(to, "that's me", SIG.hc, 1.3);
        this.after(0.35, () => {
          const rep = this.mk({
            proto: 'arp',
            head: 'ARP reply · unicast',
            src: { ip },
            dst: { ip: this.ipOf('laptop') },
            arp: { op: 'reply', who: ip, tell: this.ipOf('laptop'), mac: MAC[target] },
            color: SIG.hc,
            label: 'is at',
            app: 'lan',
            inspect,
          });
          if (inspect) this.inspectId = rep.id;
          this.hop(rep, target, 'laptop', 0.9, () => {
            this.arp.set(ip, { mac: MAC[target], vt: this.vt });
            this.note('laptop', 'cached', SIG.hc, 1.1);
            this.rev++;
            then();
          });
        });
      });
    });
  }

  /** An Ethernet frame on the LAN, addressed by MAC. */
  private frame(to: string, dstIp: string, inspect: boolean, then?: () => void) {
    const p = this.mk({
      proto: 'eth',
      head: `frame · laptop → ${this.label(to)}`,
      src: { ip: this.ipOf('laptop') },
      dst: { ip: dstIp },
      eth: { dst: MAC[to] ?? '', dstName: this.label(to) },
      color: SIG.req,
      app: 'lan',
      inspect,
    });
    if (inspect) this.inspectId = p.id;
    this.hop(p, 'laptop', to, 0.95, () => {
      // An inspected frame lingers at a device so its card can be read.
      if (inspect && to !== 'router') this.rest(p, to, 0.9, () => {});
      then?.();
    });
    return p;
  }

  private scArp() {
    this.after(0.4, () => this.decide('192.168.1.40'));
    this.after(1.4, () =>
      this.arpFor('192.168.1.40', 'tv', true, () =>
        this.after(0.5, () => {
          let n = 0;
          const loop = () => {
            this.frame('tv', '192.168.1.40', n++ === 0, () => {
              this.after(0.25, () => {
                const back = this.mk({ proto: 'eth', head: 'frame · TV → laptop', src: { ip: '192.168.1.40' }, dst: { ip: '192.168.1.23' }, color: SIG.res, app: 'lan' });
                this.hop(back, 'tv', 'laptop', 0.95, () => {});
              });
            });
            this.after(2.8, loop);
          };
          loop();
        }),
      ),
    );
  }

  private scGateway() {
    this.after(0.4, () => this.decide(SERVER_IP));
    this.after(1.5, () =>
      this.arpFor('192.168.1.1', 'router', true, () =>
        this.after(0.5, () => {
          const loop = (first: boolean) => {
            const p = this.frame('router', SERVER_IP, first, () => {
              p.eth = { dst: '(next hop, ISP)', dstName: 'ISP' };
              this.route = { dst: SERVER_IP, row: 1, vt: this.vt };
              this.rev++;
              this.rest(p, 'router', first ? 1.3 : 0.3, () => {
                const q = this.mk({ proto: 'tcp', head: 'onward', src: { ip: '' }, dst: { ip: SERVER_IP }, color: SIG.req, app: 'lan' });
                this.hop(q, 'router', 'server', WAN_HOP, () => {
                  this.after(0.3, () => {
                    const r = this.mk({ proto: 'tcp', head: 'reply', src: { ip: SERVER_IP }, dst: { ip: '' }, color: SIG.res, app: 'lan' });
                    this.hop(r, 'server', 'router', WAN_HOP, () => this.rest(r, 'router', 0.25, () => this.hop(r, 'router', 'laptop', LAN_HOP, () => {})));
                  });
                });
              });
            });
            this.after(first ? 6.5 : 5.2, () => loop(false));
          };
          loop(true);
        }),
      ),
    );
  }

  /* Predict: direct or via the gateway? */
  private gwRound(auto: boolean) {
    const q = GW_QUESTIONS[this.qIdx++ % GW_QUESTIONS.length];
    this.lanPrefix = q.prefix;
    const g = this.labels.guest;
    g.ghost = true;
    g.name = 'another host';
    g.ip = '';
    this.decision = { dst: q.dst, prefix: q.prefix, local: q.local, revealed: false, vt: this.vt };
    const p = this.mk({
      proto: 'tcp',
      head: `packet · laptop → ${q.dst}`,
      src: { ip: this.ipOf('laptop') },
      dst: { ip: q.dst },
      color: SIG.req,
      app: 'lan',
      inspect: false,
    });
    const release = this.hold(p, 'laptop');
    this.rev++;
    const go = () => {
      release();
      if (this.decision) this.decision = { ...this.decision, revealed: true, vt: this.vt };
      if (q.local && q.guest) {
        g.ghost = false;
        g.name = q.guest.name;
        g.glyph = q.guest.glyph;
        g.ip = q.dst;
        this.fx({ kind: 'ring', at: { id: 'guest' }, color: SIG.res, size: 1.2 });
        this.after(0.35, () =>
          this.hop(p, 'laptop', 'guest', 1.0, () => {
            this.note('guest', 'delivered directly', SIG.res, 1.8);
            this.rev++;
          }),
        );
      } else {
        this.hop(p, 'laptop', 'router', 1.0, () => {
          this.note('router', 'gateway takes it from here', SIG.req, 2);
          this.rev++;
        });
      }
      this.pNextAt = this.t + 3.6;
      this.asking = null;
      this.rev++;
    };
    if (auto) {
      this.after(1.4, go);
      this.pNextAt = this.t + 99;
      return;
    }
    const answer = q.local ? 'direct' : 'gateway';
    const me = this.ipOf('laptop');
    this.asking = { kind: 'gw', at: 'laptop', text: `${q.dst} from ${me}/${q.prefix}: direct or gateway?` };
    this.game?.ask({
      acceptable: [answer],
      choices: [
        { id: 'direct', label: 'Deliver it directly' },
        { id: 'gateway', label: 'Send it to the gateway' },
      ],
      ask: `To ${q.dst}, with /${q.prefix}?`,
      explain: () => {
        const mask = intToIp(maskOf(q.prefix));
        const a = intToIp(netOf(ipToInt(q.dst), q.prefix));
        const b = intToIp(netOf(ipToInt(me), q.prefix));
        return q.local
          ? `${q.dst} AND ${mask} = ${a}, the laptop's own network. It's a neighbor: ARP for its MAC and deliver directly.`
          : `${q.dst} AND ${mask} = ${a}, but the laptop is on ${b}. Different networks, so the packet goes to the gateway, 192.168.1.1.`;
      },
      resolve: go,
    });
  }

  /* ---------- chapter 4: two homes, no NAT ---------- */

  private scNoNat() {
    const once = (first: boolean) => {
      const p = this.openConn('laptop', { inspect: first, inspectReply: first, port: 51000 });
      if (p) p.head = "Alice's laptop → web server";
    };
    this.after(0.6, () => once(true));
    const loop = () => {
      once(false);
      this.after(8, loop);
    };
    this.after(9, loop);
  }

  /* ---------- chapter 5: NAT ---------- */

  private scRewrite(reply: boolean) {
    // One connection: the first packet is inspected, later ones reuse the same row.
    this.after(reply ? 0.3 : 0.6, () => this.openConn('laptop', { inspect: !reply, inspectReply: reply, port: 51000, label: true }));
    const loop = () => {
      this.openConn('laptop', { port: 51000, label: true });
      this.after(4.2, loop);
    };
    this.after(reply ? 8.5 : 9, loop);
  }

  private scMany() {
    const plan: [number, string, number?][] = [
      [0.4, 'laptop', 51000],
      [1.5, 'phone', 51000],
      [2.7, 'tv', 50522],
      [4.0, 'laptop', 51001],
    ];
    for (const [at, dev, port] of plan) this.after(at, () => this.openConn(dev, { port, label: true }));
    this.after(5.2, () => {
      this.portSeq.set('laptop', 51002);
      this.portSeq.set('phone', 51001);
      this.portSeq.set('tv', 50523);
      for (const d of ['laptop', 'phone', 'tv']) this.nextOpen.set(d, this.t + 1.2 + this.rng() * 3);
    });
  }

  /** Two rows already in the table when the NAT quiz starts. */
  private seedTable() {
    const n = this.nats.get('router')!;
    const mkRow = (dev: string, port: number, outPort: number) => {
      n.rows.push({
        id: this.mseq++,
        box: 'router',
        proto: 'tcp',
        inside: { ip: this.ipOf(dev), port },
        outside: { ip: n.pub, port: outPort },
        remote: { ip: SERVER_IP, port: 443 },
        dev,
        static: false,
        last: this.t,
        bornVt: -10,
        hitVt: -10,
        goneVt: null,
        pkts: 2,
      });
    };
    mkRow('laptop', 51000, 40001);
    mkRow('tv', 50522, 40002);
    n.next = 40003;
    // The first quiz round hard-codes the phone's 51000; later rounds take fresh ports.
    this.portSeq.set('laptop', 51001);
    this.portSeq.set('phone', 51001);
    this.portSeq.set('tv', 50523);
  }

  private natRound(auto: boolean) {
    const kind: NatQ = NAT_QUESTIONS[this.qIdx++ % NAT_QUESTIONS.length];
    if (auto) {
      this.backgroundConn();
      this.pNextAt = this.t + 3.2;
      return;
    }
    // The question opens when the packet reaches the router; no new round until it's answered.
    this.pNextAt = this.t + 1e9;
    const ask = (q: Parameters<PredictGame['ask']>[0], text: string, resume: () => void) => {
      this.asking = { kind, at: 'router', text };
      const ok = this.game?.ask({
        ...q,
        resolve: (picked, good) => {
          this.asking = null;
          q.resolve?.(picked, good);
          resume();
          this.pNextAt = this.t + 4.6;
          this.rev++;
        },
      });
      if (!ok) {
        this.asking = null;
        resume();
        this.pNextAt = this.t + 3;
      }
    };
    const n = this.nats.get('router')!;
    if (kind === 'seen' || kind === 'clash') {
      const dev = kind === 'seen' ? 'phone' : 'tv';
      const phoneRow = [...n.rows].reverse().find((m) => m.goneVt == null && !m.static && m.dev === 'phone');
      // First round the phone picks 51000, the laptop's port too. Later the TV copies the phone's port.
      const firstLap = this.qIdx <= NAT_QUESTIONS.length;
      const port = kind === 'seen' ? (firstLap ? 51000 : this.nextPort('phone')) : (phoneRow?.inside.port ?? 51000);
      const dst = { ip: SERVER_IP, port: 443 };
      this.openConn(dev, {
        port,
        inspect: true,
        label: true,
        gate: (resume) => {
          const nextPort = this.peekPort(n, { ip: this.ipOf(dev), port }, dst);
          if (kind === 'seen') {
            ask(
              {
                acceptable: ['pub'],
                choices: [
                  { id: 'own', label: `${this.ipOf('phone')}:${port}` },
                  { id: 'pub', label: `${n.pub}:${nextPort}` },
                  { id: 'lan', label: `192.168.1.1:${port}` },
                ],
                ask: 'What source will the server see?',
                explain: (_p, good) =>
                  `${good ? '' : 'The server never sees private addresses. '}The router swaps the phone's ${this.ipOf('phone')}:${port} for its own public ${n.pub}:${nextPort} and notes the pair in its table.`,
              },
              'What source will the server see?',
              resume,
            );
          } else {
            const taken = phoneRow ? `:${phoneRow.outside.port}` : `:${nextPort}`;
            ask(
              {
                acceptable: ['own'],
                choices: [
                  { id: 'own', label: 'A public port of its own' },
                  { id: 'share', label: `Reuse the phone's ${taken}` },
                  { id: 'drop', label: 'Drop it: port taken' },
                ],
                ask: `Same inside port as the phone (${port}). Now what?`,
                explain: () =>
                  `Inside ports only need to be unique per device. The router gives the TV's connection its own public port, :${nextPort}, so replies for the two can never be confused.`,
              },
              `The TV also chose port ${port}. Now what?`,
              resume,
            );
          }
        },
      });
      return;
    }
    if (kind === 'who' || kind === 'back') {
      const row = kind === 'who' ? n.rows.find((m) => m.goneVt == null && !m.static && m.dev === 'tv') : n.rows.find((m) => m.goneVt == null && !m.static && m.dev === 'laptop');
      if (!row) {
        this.backgroundConn();
        this.pNextAt = this.t + 3;
        return;
      }
      const res = this.mk({
        proto: 'tcp',
        head: 'web server → ?',
        src: { ip: SERVER_IP, port: 443 },
        dst: { ...row.outside },
        color: SIG.res,
        label: `:${row.outside.port}`,
        app: 'data',
        owner: row.dev,
        inspect: true,
      });
      this.inspectId = res.id;
      res.gate = (resume) => {
        if (kind === 'who') {
          ask(
            {
              acceptable: [row.dev],
              choices: [
                { id: 'laptop', label: 'laptop' },
                { id: 'phone', label: 'phone' },
                { id: 'tv', label: 'TV' },
                { id: 'none', label: 'Nobody: drop it' },
              ],
              ask: `A reply for :${row.outside.port}. Whose is it?`,
              explain: () => `The table row with outside port :${row.outside.port} says ${ep(row.inside)}: the ${this.label(row.dev)}. The router rewrites the destination and sends it there.`,
            },
            `Reply for :${row.outside.port}. Whose is it?`,
            resume,
          );
        } else {
          ask(
            {
              acceptable: ['server'],
              choices: [
                { id: 'server', label: `${SERVER_IP}:443` },
                { id: 'pub', label: `${n.pub}:${row.outside.port}` },
                { id: 'lan', label: '192.168.1.1:443' },
              ],
              ask: 'After the rewrite: source the laptop sees?',
              explain: () =>
                `The router only rewrites its own side of the conversation. The source stays ${SERVER_IP}:443, so the laptop believes it talked to the server directly.`,
            },
            'After the rewrite, what source does the laptop see?',
            resume,
          );
        }
      };
      res.head = 'TCP · web server → your router';
      this.emit(res, 'server');
      return;
    }
    // stray: nothing in the table matches
    const p = this.mk({
      proto: 'tcp',
      head: 'Carol → 203.0.113.7:40009',
      src: { ip: this.ipOf('carol'), port: 53211 },
      dst: { ip: n.pub, port: 40009 },
      color: SIG.heavy,
      label: ':40009',
      app: 'probe',
      inspect: true,
    });
    this.inspectId = p.id;
    p.gate = (resume) =>
      ask(
        {
          acceptable: ['drop'],
          choices: [
            { id: 'drop', label: 'The router drops it' },
            { id: 'all', label: 'Every device gets a copy' },
            { id: 'laptop', label: 'It goes to the laptop' },
          ],
          ask: 'No row for :40009. What happens?',
          explain: () => 'No row, no destination. The router has no idea which device (if any) should get it, so it drops the packet.',
        },
        'No row mentions :40009. What happens?',
        resume,
      );
    this.emit(p, 'carol');
  }

  private backgroundConn() {
    const devs = ['laptop', 'phone', 'tv'].filter((d) => this.boxes.has(d) && this.active.has(d));
    if (!devs.length) return;
    const dev = devs[Math.floor(this.rng() * devs.length)];
    this.openConn(dev, { label: true });
  }

  /* ---------- chapter 6: inbound ---------- */

  private scInbound() {
    this.after(0.5, () => this.openConn('laptop', { label: true }));
    this.after(2.4, () => this.carolConnect());
    this.nextOpen.set('laptop', this.t + 6);
  }

  private scForward() {
    this.after(0.4, () => this.openConn('laptop', { label: true }));
    this.after(1.6, () => this.carolConnect());
    this.nextOpen.set('laptop', this.t + 7);
  }

  /* ---------- chapter 6: peer to peer ---------- */

  private scP2p() {
    const stunReq = (dev: 'laptop' | 'bob', inspect: boolean) => {
      const p = this.mk({
        proto: 'udp',
        head: `STUN request · ${dev === 'laptop' ? 'Alice' : 'Bob'}`,
        src: { ip: this.ipOf(dev), port: 50000 },
        dst: { ip: this.ipOf('stun'), port: 3478 },
        color: SIG.hc,
        app: 'stun',
        inspect,
      });
      if (inspect) this.inspectId = p.id;
      this.emit(p, dev);
    };
    this.p2p.phase = 'Step 1 · ask STUN: "what address do you see?"';
    this.after(0.6, () => stunReq('laptop', true));
    this.after(2.0, () => stunReq('bob', false));
    this.after(7.6, () => {
      this.p2p.phase = 'Step 2 · swap addresses through the app server';
      this.rev++;
      // Each side sends its public address to the other through the app's server (the signaling channel).
      const env = (from: 'laptop' | 'bob', text: string) => {
        const gw = from === 'laptop' ? 'router' : 'routerB';
        const to = from === 'laptop' ? 'bob' : 'laptop';
        const gw2 = to === 'laptop' ? 'router' : 'routerB';
        const p = this.mk({ proto: 'tcp', head: text, src: { ip: '' }, dst: { ip: '' }, color: SIG.hc, app: 'lan', label: text });
        const legs: [string, string, number][] = [
          [from, gw, 0.55],
          [gw, 'server', 0.95],
          ['server', gw2, 0.95],
          [gw2, to, 0.55],
        ];
        const run = (i: number) => {
          if (i >= legs.length) {
            this.note(to, 'got the address', SIG.hc, 1.4);
            return;
          }
          const [a, b, d] = legs[i];
          this.hop(p, a, b, d, () => run(i + 1));
        };
        run(0);
      };
      env('laptop', '203.0.113.7:40001');
      this.after(0.7, () => env('bob', '198.51.100.77:62000'));
    });
    this.after(11.6, () => {
      this.p2p.exchanged = true;
      this.p2p.phase = 'Step 3 · both send at once: hole punching';
      this.rev++;
      this.peerSend('laptop', true);
    });
    this.after(12.3, () => this.peerSend('bob', false));
    this.after(15.4, () => {
      this.p2p.phase = 'Connected: packets flow directly, peer to peer';
      this.rev++;
      const loop = (who: 'laptop' | 'bob') => {
        this.peerSend(who, false);
        this.after(1.7, () => loop(who === 'laptop' ? 'bob' : 'laptop'));
      };
      loop('laptop');
    });
  }

  private peerSend(dev: 'laptop' | 'bob', inspect: boolean) {
    const dst = dev === 'laptop' ? { ip: '198.51.100.77', port: 62000 } : { ip: PUBLIC_IP, port: 40001 };
    const p = this.mk({
      proto: 'udp',
      head: dev === 'laptop' ? 'Alice → Bob' : 'Bob → Alice',
      src: { ip: this.ipOf(dev), port: 50000 },
      dst,
      color: SIG.req,
      app: 'p2p',
      inspect,
    });
    if (inspect) this.inspectId = p.id;
    this.emit(p, dev);
  }

  /* ---------- chapter 7: carrier-grade NAT ---------- */

  private scCgnat() {
    this.after(0.6, () => this.openConn('laptop', { inspect: true, port: 51000 }));
    this.nextOpen.set('laptop', this.t + 12);
    if (this.boxes.has('phone')) this.nextOpen.set('phone', this.t + 9);
  }

  /* ---------- recap and playground ---------- */

  private scPlay() {
    for (const d of ['laptop', 'phone', 'tv']) this.nextOpen.set(d, this.t + 0.5 + this.rng() * 2.5);
    if (this.cfg.scenario === 'play' && this.boxes.has('tv')) {
      this.stream = { dev: 'tv', seenAs: null, nextPush: 0, lastData: this.t, stalled: false, stallVt: -10 };
      this.after(1.2, () => this.openConn('tv', { app: 'stream', port: 50600, label: true }));
    }
    if (this.cfg.scenario === 'cheat') {
      const loop = () => {
        this.carolConnect();
        this.after(9, loop);
      };
      this.after(4, loop);
    }
  }

  /* Playground knobs */
  setActive(dev: string, on: boolean) {
    if (on) {
      this.active.add(dev);
      this.nextOpen.set(dev, this.t + 0.3);
    } else this.active.delete(dev);
    this.rev++;
  }

  setNatTimeout(s: number) {
    this.cfg = { ...this.cfg, timeout: s };
    this.rev++;
  }

  setForward(on: boolean) {
    if (on) this.addForward(true);
    else this.removeForward();
  }

  /* ================================================================ */
  /* Per-tick logic                                                    */
  /* ================================================================ */

  protected step(dt: number) {
    void dt;
    const c = this.cfg;
    if (c.view !== 'net') return;

    // Expire idle NAT rows.
    for (const n of this.nats.values()) {
      for (const m of n.rows) {
        if (m.goneVt == null && !m.static && this.t - m.last > c.timeout) {
          m.goneVt = this.vt;
          this.expired.add(`${n.id}:${m.proto}:${m.outside.port}`);
          this.rev++;
        }
      }
      if (n.rows.some((m) => m.goneVt != null && this.vt - m.goneVt > 1.1)) n.rows = n.rows.filter((m) => m.goneVt == null || this.vt - m.goneVt <= 1.1);
    }

    // Background connections.
    const bg = c.scenario === 'many' || c.scenario === 'cheat' || c.scenario === 'play' || c.scenario === 'inbound' || c.scenario === 'forward' || c.scenario === 'cgnat';
    if (bg) {
      for (const [dev, at] of this.nextOpen) {
        if (this.t < at) continue;
        const on = this.boxes.has(dev) && (c.scenario !== 'play' || this.active.has(dev));
        const gap =
          c.scenario === 'many' ? 3.4 + this.rng() * 2.6 : c.scenario === 'cgnat' ? 9 + this.rng() * 3 : c.scenario === 'inbound' || c.scenario === 'forward' ? 6.5 + this.rng() * 3 : 2.6 + this.rng() * 2.8;
        this.nextOpen.set(dev, this.t + gap);
        if (on && !(dev === 'tv' && this.stream)) this.openConn(dev, { label: c.scenario !== 'cgnat' });
      }
    }

    // The TV's video stream: the server pushes data every 8 s to the address it saw.
    const st = this.stream;
    if (st && st.seenAs && this.t >= st.nextPush) {
      st.nextPush = this.t + 8;
      const p = this.mk({
        proto: 'udp',
        head: 'video server → TV',
        src: { ip: SERVER_IP, port: 443 },
        dst: { ...st.seenAs },
        color: SIG.res,
        label: `:${st.seenAs.port}`,
        app: 'stream',
      });
      this.emit(p, 'server');
    }
    if (st && st.stalled && this.t - st.stallVt > 3 && this.active.has('tv')) {
      st.stalled = false;
      st.stallVt = this.t + 99;
      this.openConn('tv', { app: 'stream', port: this.nextPort('tv'), label: true });
    }

    // Predictions
    const g = this.game;
    if (g && !g.pending && !this.asking && this.t >= this.pNextAt && this.rests.every((r) => !r.held)) {
      if (this.pKind === 'gw') this.gwRound(g.done);
      else if (this.pKind === 'nat') this.natRound(g.done);
    }
  }

  protected animate(dt: number) {
    this.prefixVis = damp(this.prefixVis, this.prefix, 12, dt);
  }
}
