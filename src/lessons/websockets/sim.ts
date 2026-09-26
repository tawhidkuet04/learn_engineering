import { SIG } from '@/lib/sim/colors';
import { bezier, clamp, damp, type Curve } from '@/lib/sim/geometry';
import { PredictGame } from '@/lib/sim/predict';
import { mulberry32 } from '@/lib/sim/rng';
import { Sim, type ScriptEvent, type WireSpec } from '@/lib/sim/Sim';
import { FRAMES, type FrameKind } from './frames';
import { fieldRect, frameGeo, raceGeo, type Rect } from './geo';
import { Race } from './race';

/* ================================================================== */
/* Cast, types and constants                                           */
/* ================================================================== */

export type PersonId = 'alice' | 'bob' | 'carol' | 'dave';
export type ServerId = 'srv1' | 'srv2';
export type Mode = 'http' | 'short' | 'long' | 'sse' | 'ws';
export type View = 'chat' | 'race' | 'seq' | 'frame' | 'choose';
export type Layout = 'relay' | 'infra';
export type PredictKind = 'bobsees' | 'status' | 'split';
export type InspKind = 'post' | 'get' | 'poll' | 'lp' | 'sse' | 'sse200' | 'event' | 'upgrade' | '101' | 'frame';
export type Leaf = 'http' | 'sse' | 'ws';

export const ALL_PEOPLE: PersonId[] = ['alice', 'bob', 'carol', 'dave'];
export const ALL_SERVERS: ServerId[] = ['srv1', 'srv2'];

export const PEOPLE: Record<PersonId, { name: string; color: string; lines: string[] }> = {
  alice: { name: 'Alice', color: SIG.pink, lines: ['Lunch at noon?', 'The demo works!', 'Coffee?', 'Pushing a fix', 'Standup moved', 'See you there', 'Did it deploy?'] },
  bob: { name: 'Bob', color: SIG.lime, lines: ['Sounds good', 'On my way', 'Nice work!', 'Which room?', 'Two minutes', 'Ha, agreed'] },
  carol: { name: 'Carol', color: SIG.blue, lines: ["I'm in", 'Save me a seat', 'Just landed', 'Great news'] },
  dave: { name: 'Dave', color: SIG.heavy, lines: ['Running late', 'Count me in', "Who's driving?", 'Done!'] },
};

export const SERVER_META: Record<ServerId, { name: string; ip: string }> = {
  srv1: { name: 'ws-1', ip: '10.0.1.11' },
  srv2: { name: 'ws-2', ip: '10.0.1.12' },
};

/** The open WebSocket, drawn as a glowing pipe */
export const PIPE = SIG.teal;
/** Empty responses: a request that came back with nothing */
export const EMPTY = '#6F7D97';

const HOP = 0.8; // one HTTP trip between a browser and the server
const FHOP = 0.7; // one WebSocket frame trip
const LEG_A = 0.42; // browser ↔ proxy
const LEG_B = 0.46; // proxy ↔ server
const RHOP = 0.55; // server ↔ redis
const PHOP = 0.55; // ping or pong
const SLOW_HS = 1.9; // handshake trips when the step wants its cards read
const BACKOFF_CAP = 30;

export interface AutoSpec {
  from: PersonId[];
  min: number;
  max: number;
  first?: number;
}

export interface Cfg {
  view: View;
  layout: Layout;
  mode: Mode;
  people: PersonId[];
  servers: 1 | 2;
  lb: boolean;
  lbName: string;
  redis: boolean;
  backplane: boolean;
  /** Short polling interval, seconds */
  interval: number;
  /** Long polling: the server gives up and answers empty after this long */
  lpTimeout: number;
  heartbeat: boolean;
  pingEvery: number;
  /** Proxy idle timeout, seconds (0 = none) */
  idle: number;
  auto: AutoSpec | null;
  /** WebSocket / SSE connections: already open, opened as the step starts, or closed */
  open: 'all' | 'connect' | 'none';
  /** People who start disconnected even when everyone else is open */
  closed: PersonId[];
  /** Who listens for messages in the HTTP modes */
  receivers: PersonId[];
  frame: FrameKind;
  /** Portrait: leave room for a readout strip at the bottom */
  strip: boolean;
  /** Windows start with a little conversation in them */
  prefill: boolean;
  /** Flight kinds that get an inspector card (the first of each kind in a step) */
  inspect: InspKind[];
  /** Slow the handshake trips so their cards can be read */
  slowHandshake: boolean;
  /** Show the Sec-WebSocket-Accept computation when the server answers */
  showAccept: boolean;
}

export const DEFAULTS: Cfg = {
  view: 'chat',
  layout: 'relay',
  mode: 'ws',
  people: ['alice', 'bob'],
  servers: 1,
  lb: false,
  lbName: 'load balancer',
  redis: false,
  backplane: false,
  interval: 3,
  lpTimeout: 20,
  heartbeat: false,
  pingEvery: 3,
  idle: 0,
  auto: null,
  open: 'all',
  closed: [],
  receivers: ['bob'],
  frame: 'hello-c',
  strip: false,
  prefill: false,
  inspect: [],
  slowHandshake: false,
  showAccept: false,
};

export interface Msg {
  id: number;
  from: PersonId;
  to: PersonId | 'room';
  text: string;
  tSent: number;
  atServer: number | null;
  /** Who should receive it */
  expect: PersonId[];
  /** Already on its way to these people (so it is not sent twice) */
  sent: Set<PersonId>;
  /** Delivered, and when */
  got: Map<PersonId, number>;
}

export interface Bubble {
  id: number;
  from: PersonId;
  text: string;
  mine: boolean;
  vt: number;
  delay: number | null;
  dm?: PersonId;
  resync?: boolean;
  /** Own message: the server has it */
  ok?: boolean;
}

export interface PState {
  id: PersonId;
  server: ServerId;
  net: boolean;
  cutAt: number;
  conn: 'closed' | 'connecting' | 'open' | 'waiting';
  /** Eased 0..1: how much of the connection pipe is drawn */
  pipe: number;
  openVt: number;
  lastHeard: number;
  attempt: number;
  retryAt: number | null;
  retryDelay: number;
  /** Backoff steps taken since the connection was lost, for the readout */
  tries: { delay: number; ok: boolean | null }[];
  /** The load balancer already routed this (still connecting) socket */
  lbPicked: boolean;
  lastId: number;
  log: Bubble[];
  outbox: Msg[];
  // HTTP modes
  nextPoll: number;
  lp: 'idle' | 'out' | 'held' | 'back';
  heldSince: number;
  sse: 'closed' | 'opening' | 'open';
  lostInTransit: number;
}

export interface Conn {
  lastTraffic: number;
  awaiting: boolean;
  nextPing: number;
  lastPong: number;
}

export interface SState {
  id: ServerId;
  up: boolean;
  downUntil: number | null;
  conns: Map<PersonId, Conn>;
}

export interface Stats {
  reqs: number;
  empty: number;
  responses: number;
  delays: number[];
  bobDelays: number[];
  delivered: number;
  expected: number;
  pings: number;
  proxyCloses: number;
  terminated: number;
  published: number;
  resynced: number;
  frames: number;
  framingBytes: number;
  httpAfterOpen: number;
  /** Live deliveries between people connected to different servers */
  crossLive: number;
}

const emptyStats = (): Stats => ({
  reqs: 0,
  empty: 0,
  responses: 0,
  delays: [],
  bobDelays: [],
  delivered: 0,
  expected: 0,
  pings: 0,
  proxyCloses: 0,
  terminated: 0,
  published: 0,
  resynced: 0,
  frames: 0,
  framingBytes: 0,
  httpAfterOpen: 0,
  crossLive: 0,
});

interface HopOpts {
  color: string;
  label?: string;
  shape?: 'dot' | 'square' | 'envelope';
  r?: number;
  lane?: number;
  dur?: number;
  tag?: string;
  /** Counts as traffic for the proxy's idle timer */
  traffic?: boolean;
  done?: () => void;
  lost?: () => void;
}

export interface InspPin {
  kind: InspKind;
  pid: PersonId;
  msg: number | null;
  at: string;
  until: number;
}

interface SplitScenario {
  from: PersonId;
  to: PersonId | 'room';
  text: string;
  ask: string;
  choices: { id: string; label: string }[];
  answer: string;
  why: string;
}

const SPLIT: SplitScenario[] = [
  {
    from: 'alice',
    to: 'room',
    text: 'Lunch at noon?',
    ask: "Who sees Alice's message?",
    choices: [
      { id: 'all', label: 'Bob, Carol and Dave' },
      { id: 'same', label: 'Only Carol' },
      { id: 'none', label: 'Nobody' },
    ],
    answer: 'same',
    why: "ws-1 only knows its own sockets, Alice's and Carol's. Bob and Dave are connected to ws-2, which never hears about the message.",
  },
  {
    from: 'bob',
    to: 'alice',
    text: 'Call me?',
    ask: 'Does Alice get Bob’s direct message?',
    choices: [
      { id: 'yes', label: 'Yes' },
      { id: 'no', label: 'No' },
    ],
    answer: 'no',
    why: "Bob's message lands on ws-2. ws-2 looks for Alice's socket in its own memory, doesn't find it, and has nowhere to send the message.",
  },
  {
    from: 'dave',
    to: 'room',
    text: 'Running late',
    ask: "Who sees Dave's message?",
    choices: [
      { id: 'all', label: 'Alice, Bob and Carol' },
      { id: 'same', label: 'Only Bob' },
      { id: 'none', label: 'Nobody' },
    ],
    answer: 'same',
    why: 'Dave is on ws-2, so only the room members connected to ws-2 hear him: Bob.',
  },
  {
    from: 'carol',
    to: 'alice',
    text: 'Save me a seat',
    ask: 'Does Alice get Carol’s direct message?',
    choices: [
      { id: 'yes', label: 'Yes' },
      { id: 'no', label: 'No' },
    ],
    answer: 'yes',
    why: 'Carol and Alice happen to share ws-1, so the server finds Alice’s socket right there.',
  },
  {
    from: 'alice',
    to: 'dave',
    text: 'Need a ride?',
    ask: 'Does Dave get Alice’s direct message?',
    choices: [
      { id: 'yes', label: 'Yes' },
      { id: 'no', label: 'No' },
    ],
    answer: 'no',
    why: 'Different servers again: ws-1 has no socket for Dave, so the message goes nowhere.',
  },
];

export const CHOOSE_APPS: { name: string; path: string[] }[] = [
  { name: 'Group chat', path: ['q1', 'q2', 'leaf:ws'] },
  { name: 'Live scores', path: ['q1', 'q2', 'leaf:sse'] },
  { name: 'Checkout form', path: ['q1', 'leaf:http'] },
  { name: 'Multiplayer game', path: ['q1', 'q2', 'leaf:ws'] },
  { name: 'AI answer stream', path: ['q1', 'q2', 'leaf:sse'] },
  { name: 'Product page', path: ['q1', 'leaf:http'] },
  { name: 'Shared whiteboard', path: ['q1', 'q2', 'leaf:ws'] },
  { name: 'Notifications', path: ['q1', 'q2', 'leaf:sse'] },
  { name: 'Search', path: ['q1', 'leaf:http'] },
];

const RACE_AUTO = [1.4, 5.2, 6.1, 11.8, 16.4];

const short = (s: string, n = 13) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function freshPerson(id: PersonId): PState {
  return {
    id,
    server: 'srv1',
    net: true,
    cutAt: -10,
    conn: 'closed',
    pipe: 0,
    openVt: -10,
    lastHeard: 0,
    attempt: 0,
    retryAt: null,
    retryDelay: 0,
    tries: [],
    lbPicked: false,
    lastId: 17,
    log: [],
    outbox: [],
    nextPoll: 0,
    lp: 'idle',
    heldSince: 0,
    sse: 'closed',
    lostInTransit: 0,
  };
}

/* ================================================================== */
/* The simulation                                                      */
/* ================================================================== */

export class WsSim extends Sim {
  cfg: Cfg = { ...DEFAULTS, people: [...DEFAULTS.people], receivers: [...DEFAULTS.receivers], closed: [], inspect: [] };
  game: PredictGame | null = null;
  pKind: PredictKind | null = null;
  ppl = new Map<PersonId, PState>();
  srv = new Map<ServerId, SState>();
  history: Msg[] = [];
  stat: Stats = emptyStats();
  race = new Race();
  insp: InspPin | null = null;
  /** When the server started computing Sec-WebSocket-Accept (visual time) */
  acceptVt = -10;
  lastLb: { pid: PersonId; sid: ServerId; vt: number; only: boolean } | null = null;
  chooseLog: Record<Leaf, string[]> = { http: [], sse: [], ws: [] };
  seqT = 0;
  frameVt = -10;
  tried = { fast: false, slow: false };
  /** The split-room question waiting for its message to reach the server */
  splitAsk: { scenario: SplitScenario; msg: number } | null = null;
  /** Bumped on every structural change (drawing caches key off it) */
  ver = 0;

  private msgSeq = 17;
  private nextAuto = 0;
  private autoIdx = 0;
  private lineIdx: Record<PersonId, number> = { alice: 0, bob: 0, carol: 0, dave: 0 };
  private inspShown = new Set<InspKind>();
  private nextFrame = 0;
  private chooseIdx = 0;
  private nextChoose = 0;
  private splitIdx = 0;
  private nextSplitAt: number | null = null;
  private raceAuto = 0;
  private raceNextRandom = 0;

  constructor() {
    super();
    for (const id of ALL_PEOPLE) this.ppl.set(id, freshPerson(id));
    for (const id of ALL_SERVERS) this.srv.set(id, { id, up: true, downUntil: null, conns: new Map() });
  }

  /* ================================================================ */
  /* Step entry                                                        */
  /* ================================================================ */

  enter(cfg: Cfg, script: ScriptEvent<WsSim>[] = [], opts: { predict?: PredictKind | null; needed?: number } = {}) {
    this.cfg = { ...cfg, people: [...cfg.people], receivers: [...cfg.receivers], closed: [...cfg.closed], inspect: [...cfg.inspect], auto: cfg.auto ? { ...cfg.auto } : null };
    this.pKind = opts.predict ?? null;
    this.game = this.pKind ? new PredictGame(this, opts.needed ?? 1) : null;
    this.resetWorld();
    this.runScript(script);
    this.syncBoxes();
    this.relayout();
    this.rev++;
  }

  private resetWorld() {
    this.clearTransient();
    this.rng = mulberry32(7);
    const c = this.cfg;
    this.history = [];
    this.msgSeq = 17;
    this.stat = emptyStats();
    this.insp = null;
    this.inspShown.clear();
    this.acceptVt = -10;
    this.lastLb = null;
    this.lineIdx = { alice: 0, bob: 0, carol: 0, dave: 0 };
    for (const s of this.srv.values()) {
      s.up = true;
      s.downUntil = null;
      s.conns = new Map();
    }
    for (const id of ALL_PEOPLE) {
      const old = this.ppl.get(id)!;
      const p = freshPerson(id);
      p.pipe = old.pipe;
      p.server = this.homeOf(id);
      this.ppl.set(id, p);
    }
    if (c.view === 'chat') {
      if (c.prefill) this.prefill();
      this.startTransport(true);
    }
    this.nextAuto = this.t + (c.auto?.first ?? 1.2);
    this.autoIdx = 0;
    this.race.reset();
    this.race.interval = c.interval;
    this.raceAuto = 0;
    this.raceNextRandom = 22;
    if (c.view === 'race') for (let k = 0; k < 300; k++) this.stepRace(0.04);
    this.seqT = 0;
    this.nextFrame = this.t + 0.5;
    this.frameVt = this.vt;
    this.chooseLog = { http: ['Checkout form'], sse: ['Live scores'], ws: ['Group chat'] };
    this.chooseIdx = 3;
    this.nextChoose = this.t + 0.5;
    this.tried = { fast: false, slow: false };
    this.splitIdx = 0;
    this.splitAsk = null;
    this.nextSplitAt = this.pKind === 'split' ? this.t + 1.2 : null;
    this.ver++;
  }

  /** Open (or start opening) whatever the current mode keeps open. */
  private startTransport(instant: boolean) {
    const c = this.cfg;
    c.people.forEach((pid) => {
      const p = this.ppl.get(pid)!;
      // Connect in a fixed order (Alice, Bob, Carol, Dave) whatever the drawing order.
      const i = ALL_PEOPLE.indexOf(pid);
      if (c.mode === 'ws') {
        if (c.closed.includes(pid)) return;
        if (c.open === 'all' && instant) this.openNow(p);
        else if (c.open === 'connect' || (c.open === 'all' && !instant)) this.after(0.3 + i * 0.45, () => this.connect(pid));
      } else if (c.mode === 'sse' && c.receivers.includes(pid)) {
        if (c.open === 'all' && instant) {
          p.sse = 'open';
          p.pipe = Math.max(p.pipe, 0.01);
        } else if (c.open !== 'none') this.after(0.3 + i * 0.5, () => this.sseOpen(p));
      } else if (c.mode === 'short') {
        p.nextPoll = this.t + 0.5;
      }
    });
  }

  private homeOf(pid: PersonId): ServerId {
    if (this.cfg.servers === 2) return pid === 'alice' || pid === 'carol' ? 'srv1' : 'srv2';
    return 'srv1';
  }

  private prefill() {
    const [a, b] = this.cfg.people;
    if (!a || !b) return;
    const old: [PersonId, string][] = [
      [a, 'Morning!'],
      [b, 'Morning :)'],
    ];
    old.forEach(([from, text], i) => {
      const id = 16 + i;
      for (const pid of this.cfg.people) {
        this.ppl.get(pid)!.log.push({ id, from, text, mine: pid === from, vt: -10, delay: null, ok: true });
      }
    });
  }

  /* ================================================================ */
  /* Boxes, layout, wires                                              */
  /* ================================================================ */

  private syncBoxes() {
    const want = new Set<string>();
    const c = this.cfg;
    if (c.view === 'chat') {
      for (const p of c.people) want.add(p);
      want.add('srv1');
      if (c.servers === 2) want.add('srv2');
      if (c.lb) {
        want.add('lb');
        for (const p of c.people) want.add(`gate:${p}`);
      }
      if (c.redis) want.add('redis');
    } else if (c.view === 'frame') {
      want.add('fcli');
      want.add('fsrv');
    } else if (c.view === 'choose') {
      for (const id of ['src', 'q1', 'q2', 'leaf:http', 'leaf:sse', 'leaf:ws']) want.add(id);
    }
    for (const id of want) this.box(id);
    for (const id of [...this.boxes.keys()]) if (!want.has(id)) this.hide(id);
  }

  /** place() only for boxes that are alive (it would resurrect deleted ones). */
  private put(id: string, x: number, y: number, w: number, h: number) {
    const b = this.boxes.get(id);
    if (b && !b.removing) this.place(id, x, y, w, h);
  }

  protected layout() {
    const v = this.cfg.view;
    if (v === 'chat') {
      if (this.cfg.layout === 'relay') this.layoutRelay();
      else this.layoutInfra();
    } else if (v === 'frame') this.layoutFrame();
    else if (v === 'choose') this.layoutChoose();
  }

  private layoutRelay() {
    const { w, h } = this;
    const c = this.cfg;
    const two = c.servers === 2;
    if (this.orient === 'landscape') {
      const top = 78;
      const bottom = 96;
      const ww = clamp(w * 0.21, 176, 226);
      const wh = clamp((h - top - bottom) * 0.6, 200, 320);
      const cy = top + (h - top - bottom) * (two && c.redis ? 0.4 : 0.46);
      this.put('alice', 22 + ww / 2, cy, ww, wh);
      this.put('bob', w - 22 - ww / 2, cy, ww, wh);
      if (two) {
        const inner = (w - 44 - ww * 2) / 2;
        this.put('srv1', 22 + ww + inner * 0.52, cy, 150, 70);
        this.put('srv2', w - 22 - ww - inner * 0.52, cy, 150, 70);
        this.put('redis', w / 2, cy + wh / 2 + 40, 116, 74);
      } else {
        this.put('srv1', w / 2, cy, 180, 74);
      }
    } else {
      const top = 66;
      const bottom = c.strip ? 150 : 84;
      const avail = h - top - bottom;
      const sh = two ? 50 : 56;
      const wh = clamp((avail - sh - 2 * 58) / 2, 82, 124);
      const ww = Math.min(w - 32, 336);
      const gap = (avail - 2 * wh - sh) / 2;
      const sy = top + wh + gap + sh / 2;
      this.put('alice', w / 2, top + wh / 2, ww, wh);
      this.put('bob', w / 2, top + avail - wh / 2, ww, wh);
      if (two) {
        this.put('srv1', w * 0.27, sy, 128, sh);
        this.put('srv2', w * 0.73, sy, 128, sh);
        this.put('redis', w / 2, sy, 74, 56);
      } else {
        this.put('srv1', w / 2, sy, 176, sh);
      }
    }
  }

  private layoutInfra() {
    const { w, h } = this;
    const c = this.cfg;
    const land = this.orient === 'landscape';
    const ppl = c.people;
    const n = ppl.length;
    const top = land ? 80 : 66;
    const bottom = land ? 96 : c.strip ? 146 : 102;
    const avail = h - top - bottom;
    const gap = land ? 14 : 8;
    const ww = land ? clamp(w * 0.2, 170, 214) : clamp(w * 0.42, 138, 164);
    const wh = clamp((avail - gap * (n - 1)) / n, land ? 120 : 74, land ? 236 : 150);
    const total = n * wh + (n - 1) * gap;
    const y0 = top + (avail - total) / 2;
    const colX = (land ? 22 : 10) + ww / 2;
    const ys = new Map<PersonId, number>();
    ppl.forEach((p, i) => {
      const y = y0 + wh / 2 + i * (wh + gap);
      ys.set(p, y);
      this.put(p, colX, y, ww, wh);
    });
    const right = colX + ww / 2;
    const lbW = land ? 30 : 16;
    const lbX = right + (land ? clamp(w * 0.11, 70, 118) : 22) + lbW / 2;
    if (c.lb) {
      this.put('lb', lbX, y0 + total / 2, lbW, total + (land ? 40 : 22));
      for (const p of ppl) this.put(`gate:${p}`, lbX, ys.get(p)!, lbW, 8);
    }
    const from = c.lb ? lbX + lbW / 2 : right;
    const sW = land ? 176 : 132;
    const sH = land ? 72 : 50;
    const sx = land ? (c.redis ? Math.min(w * 0.58, w - 380) : from + (w - from) * 0.42) : from + (w - from) / 2 + (c.lb ? 2 : 0);
    const mid = (ids: PersonId[]) => {
      const vs = ids.map((p) => ys.get(p)).filter((v): v is number => v != null);
      return vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : y0 + total / 2;
    };
    if (c.servers === 2) {
      const one = ppl.filter((p) => this.homeOf(p) === 'srv1');
      const two = ppl.filter((p) => this.homeOf(p) === 'srv2');
      let y1 = mid(one);
      let y2 = mid(two);
      if (c.lb) {
        y1 = y0 + total * 0.27;
        y2 = y0 + total * 0.73;
      }
      this.put('srv1', sx, y1, sW, sH);
      this.put('srv2', sx, y2, sW, sH);
      if (land) this.put('redis', Math.min(w - 110, sx + 250), (y1 + y2) / 2, 120, 80);
      else this.put('redis', sx, (y1 + y2) / 2, 92, 58);
    } else {
      this.put('srv1', sx, y0 + total / 2, sW, sH);
      if (land) this.put('redis', Math.min(w - 110, sx + 250), y0 + total / 2, 120, 80);
      else this.put('redis', sx, y0 + total / 2 + 90, 92, 58);
    }
  }

  private layoutFrame() {
    const g = frameGeo(this.w, this.h, this.orient === 'landscape', FRAMES[this.cfg.frame]);
    const land = g.land;
    this.put('fcli', g.cliX, g.pipeY, land ? 150 : 104, land ? 46 : 40);
    this.put('fsrv', g.srvX, g.pipeY, land ? 150 : 104, land ? 46 : 40);
  }

  private layoutChoose() {
    const { w, h } = this;
    if (this.orient === 'landscape') {
      const top = 96;
      const avail = h - top - 110;
      const rows = [top + 40, top + avail * 0.42, top + avail * 0.8];
      this.put('src', w / 2, top - 30, 10, 10);
      this.put('q1', w / 2, rows[0], 340, 58);
      this.put('leaf:http', w * 0.22, rows[1], 220, 64);
      this.put('q2', w * 0.64, rows[1], 340, 58);
      this.put('leaf:sse', w * 0.44, rows[2], 220, 64);
      this.put('leaf:ws', w * 0.82, rows[2], 220, 64);
    } else {
      const top = 70;
      const bot = h - 100;
      const step = (bot - top - 60) / 3;
      this.put('src', w / 2, top - 8, 10, 10);
      this.put('q1', w / 2, top + 26, w - 40, 50);
      this.put('leaf:http', w * 0.28, top + 26 + step, w * 0.46, 50);
      this.put('q2', w * 0.6, top + 26 + step * 2, w * 0.72, 50);
      this.put('leaf:sse', w * 0.28, top + 26 + step * 3, w * 0.46, 50);
      this.put('leaf:ws', w * 0.75, top + 26 + step * 3, w * 0.42, 50);
    }
  }

  protected wires(): WireSpec[] {
    const c = this.cfg;
    if (c.view === 'choose') {
      return [
        { from: 'q1', to: 'leaf:http' },
        { from: 'q1', to: 'q2' },
        { from: 'q2', to: 'leaf:sse' },
        { from: 'q2', to: 'leaf:ws' },
      ];
    }
    if (c.view === 'frame') return [{ from: 'fcli', to: 'fsrv', state: 'dim' }];
    if (c.view !== 'chat') return [];
    const out: WireSpec[] = [];
    const persistent = c.mode === 'ws' || c.mode === 'sse';
    for (const pid of c.people) {
      const p = this.ppl.get(pid)!;
      const state = !p.net ? 'down' : persistent ? 'dim' : 'normal';
      if (c.lb) {
        out.push({ from: pid, to: `gate:${pid}`, state });
        out.push({ from: `gate:${pid}`, to: p.server, state: 'dim' });
      } else out.push({ from: pid, to: p.server, state });
    }
    if (c.redis) {
      for (const s of this.liveServers()) out.push({ from: s, to: 'redis', state: c.backplane ? 'control' : 'dim' });
    }
    return out;
  }

  liveServers(): ServerId[] {
    return this.cfg.servers === 2 ? ['srv1', 'srv2'] : ['srv1'];
  }

  /** The curves a person's connection is drawn along (two legs through the proxy). */
  pipeCurves(pid: PersonId): Curve[] {
    const p = this.ppl.get(pid)!;
    const legs: [string, string][] = this.cfg.lb
      ? [
          [pid, `gate:${pid}`],
          [`gate:${pid}`, p.server],
        ]
      : [[pid, p.server]];
    const out: Curve[] = [];
    for (const [a, b] of legs) {
      const c = this.curveFor(a, b, 0);
      if (c) out.push(c);
    }
    return out;
  }

  /** Public access to the routed curve between two boxes (for drawing). */
  route(a: string, b: string): Curve | null {
    return this.curveFor(a, b, 0);
  }

  protected animate(dt: number) {
    const c = this.cfg;
    for (const pid of ALL_PEOPLE) {
      const p = this.ppl.get(pid)!;
      let target = 0;
      if (c.view === 'chat' && c.people.includes(pid)) {
        if (c.mode === 'ws') target = p.conn === 'open' || this.serverHas(pid) ? 1 : 0;
        else if (c.mode === 'sse') target = p.sse === 'open' ? 1 : 0;
      }
      p.pipe = damp(p.pipe, target, target ? 5 : 7, dt);
      if (p.pipe < 0.004) p.pipe = 0;
    }
  }

  serverHas(pid: PersonId) {
    for (const s of this.srv.values()) if (s.conns.has(pid)) return true;
    return false;
  }

  /* ================================================================ */
  /* Moving things between a browser and a server                      */
  /* ================================================================ */

  private tagFor(pid: PersonId, kind: InspKind | string, msg?: number) {
    const base = `${pid}|${kind}|${msg ?? ''}`;
    if (this.cfg.inspect.includes(kind as InspKind) && !this.inspShown.has(kind as InspKind)) {
      this.inspShown.add(kind as InspKind);
      return `${base}|insp`;
    }
    return base;
  }

  /** A trip between a browser and a server, through the proxy if there is one. */
  private hop(pid: PersonId, dir: 'up' | 'down', o: HopOpts, sid?: ServerId) {
    const p = this.ppl.get(pid)!;
    const srv = sid ?? p.server;
    const dur = o.dur ?? (this.cfg.lb ? LEG_A + LEG_B : HOP);
    const gate = `gate:${pid}`;
    const legs: [string, string, number][] = this.cfg.lb
      ? dir === 'up'
        ? [
            [pid, gate, dur * 0.48],
            [gate, srv, dur * 0.52],
          ]
        : [
            [srv, gate, dur * 0.52],
            [gate, pid, dur * 0.48],
          ]
      : dir === 'up'
        ? [[pid, srv, dur]]
        : [[srv, pid, dur]];
    const run = (i: number) => {
      const [a, b, d] = legs[i];
      const touches = a === pid || b === pid;
      const cut = touches && !p.net;
      if (o.traffic) this.touch(pid, srv);
      this.send({
        from: a,
        to: b,
        dur: d,
        color: o.color,
        label: o.label,
        shape: o.shape,
        r: o.r,
        lane: o.lane,
        tag: o.tag,
        lostAt: cut ? (a === pid ? 0.3 : 0.7) : null,
        onLost: () => {
          if (o.traffic) p.lostInTransit++;
          o.lost?.();
          this.rev++;
        },
        onArrive: () => {
          if (o.traffic) this.touch(pid, srv);
          if (i + 1 < legs.length) {
            run(i + 1);
            return;
          }
          if (o.tag?.endsWith('|insp')) {
            const [, kind, msg] = o.tag.split('|');
            this.insp = { kind: kind as InspKind, pid, msg: msg ? Number(msg) : null, at: b, until: this.t + 4 };
          }
          o.done?.();
        },
      });
    };
    run(0);
  }

  /** The proxy saw traffic on this connection: reset its idle timer. */
  private touch(pid: PersonId, sid: ServerId) {
    const cn = this.srv.get(sid)?.conns.get(pid);
    if (cn) cn.lastTraffic = this.t;
  }

  /**
   * Floating label for a box, kept inside the stage. People's notes appear
   * inside their chat window, under the header, where bubbles rarely reach.
   */
  note(id: string, text: string, color: string = SIG.text, dur = 1.7) {
    const b = this.boxes.get(id);
    if (!b || Number.isNaN(b.x)) return;
    const half = text.length * 3.25 + 10;
    const x = clamp(b.x, half + 6, this.w - half - 6);
    const person = (ALL_PEOPLE as string[]).includes(id);
    const hdr = b.h < 112 || b.w < 172 ? 24 : 30;
    const y = person ? b.y - b.h / 2 + hdr + 26 : b.y - b.h / 2 - 8;
    this.fx({ kind: 'text', at: { x, y }, text, color, dur });
  }

  /* ================================================================ */
  /* Chat messages                                                     */
  /* ================================================================ */

  private nextLine(pid: PersonId) {
    const lines = PEOPLE[pid].lines;
    return lines[this.lineIdx[pid]++ % lines.length];
  }

  private receives(pid: PersonId) {
    return this.cfg.mode === 'ws' || this.cfg.receivers.includes(pid);
  }

  /** Someone presses send. */
  chat(from: PersonId, text?: string, to: PersonId | 'room' = 'room'): Msg | null {
    if (this.cfg.view !== 'chat' || !this.cfg.people.includes(from)) return null;
    const p = this.ppl.get(from)!;
    const body = text ?? this.nextLine(from);
    const expect = to === 'room' ? this.cfg.people.filter((x) => x !== from && this.receives(x)) : [to];
    const m: Msg = { id: ++this.msgSeq, from, to, text: body, tSent: this.t, atServer: null, expect, sent: new Set(), got: new Map() };
    this.history.push(m);
    this.stat.expected += expect.length;
    p.log.push({ id: m.id, from, text: body, mine: true, vt: this.vt, delay: null, dm: to !== 'room' ? to : undefined, ok: false });
    this.trim(p);
    if (this.cfg.mode === 'ws') {
      if (p.conn === 'open') this.upFrame(p, m);
      else p.outbox.push(m);
    } else this.post(p, m);
    this.rev++;
    return m;
  }

  private trim(p: PState) {
    if (p.log.length > 14) p.log.splice(0, p.log.length - 14);
  }

  private markOk(p: PState, id: number) {
    const b = p.log.find((x) => x.id === id && x.mine);
    if (b) b.ok = true;
  }

  private post(p: PState, m: Msg) {
    if (p.conn === 'open') this.stat.httpAfterOpen++;
    this.stat.reqs++;
    this.hop(p.id, 'up', {
      color: SIG.req,
      label: 'POST',
      r: 4.2,
      tag: this.tagFor(p.id, 'post', m.id),
      done: () => {
        this.serverGot(m, p.server);
        this.hop(p.id, 'down', { color: SIG.res, label: '201', r: 3.6, done: () => this.markOk(p, m.id) });
      },
      lost: () => p.outbox.push(m),
    });
  }

  private upFrame(p: PState, m: Msg) {
    this.stat.frames++;
    this.stat.framingBytes += 6;
    this.hop(p.id, 'up', {
      color: SIG.req,
      shape: 'square',
      r: 4,
      lane: 3,
      label: short(m.text),
      dur: this.cfg.lb ? undefined : FHOP,
      traffic: true,
      tag: this.tagFor(p.id, 'frame', m.id),
      done: () => {
        this.markOk(p, m.id);
        this.serverGot(m, p.server);
      },
      // The socket looked open, so the frame went out and vanished. Resend after reconnecting.
      lost: () => p.outbox.push(m),
    });
  }

  private serverGot(m: Msg, sid: ServerId) {
    if (m.atServer != null) return;
    m.atServer = this.t;
    const mode = this.cfg.mode;
    if (mode === 'ws') {
      if (this.pKind === 'split' && this.splitAsk?.msg === m.id && this.game && !this.game.done) this.askSplit(m, sid);
      else this.fanOut(m, sid);
    } else if (mode === 'long') {
      for (const r of m.expect) {
        const q = this.ppl.get(r)!;
        if (q.lp === 'held') this.lpRespond(q);
      }
    } else if (mode === 'sse') {
      for (const r of m.expect) {
        const q = this.ppl.get(r)!;
        if (q.sse === 'open') this.ssePush(q, m);
      }
    } else if (mode === 'http' && this.pKind === 'bobsees' && this.game && !this.game.done && !this.game.pending) {
      this.after(1.2, () => this.askBobSees());
    }
    this.rev++;
  }

  /** Hand a message to everyone who should get it: directly, or through Redis. */
  private fanOut(m: Msg, sid: ServerId) {
    if (this.cfg.redis && this.cfg.backplane) {
      this.stat.published++;
      this.send({
        from: sid,
        to: 'redis',
        dur: RHOP,
        color: SIG.hc,
        r: 4,
        label: 'PUBLISH',
        tag: 'pub',
        onArrive: () => {
          this.fx({ kind: 'ring', at: { id: 'redis' }, color: SIG.hc, size: 0.9 });
          for (const s of this.liveServers()) {
            if (!this.srv.get(s)!.up) continue;
            this.send({ from: 'redis', to: s, dur: RHOP, color: SIG.hc, r: 3.6, tag: 'sub', onArrive: () => this.deliverLocal(m, s) });
          }
        },
      });
    } else this.deliverLocal(m, sid);
  }

  /** A server writes the message to every recipient connected to it. */
  private deliverLocal(m: Msg, sid: ServerId) {
    const s = this.srv.get(sid)!;
    const here = m.expect.filter((r) => s.conns.has(r) && !m.sent.has(r));
    here.forEach((r, i) => this.after(i * 0.08, () => this.downFrame(r, sid, m)));
    if (this.cfg.servers === 2 && !(this.cfg.redis && this.cfg.backplane)) {
      const away = m.expect.filter((r) => !s.conns.has(r) && this.srvOf(r) !== sid);
      if (away.length) this.note(sid, `${away.map((r) => PEOPLE[r].name).join(', ')}? not here`, SIG.err, 2.2);
    }
  }

  private srvOf(pid: PersonId): ServerId | null {
    for (const s of this.srv.values()) if (s.conns.has(pid)) return s.id;
    return null;
  }

  private downFrame(r: PersonId, sid: ServerId, m: Msg, resync = false) {
    const q = this.ppl.get(r)!;
    m.sent.add(r);
    this.stat.frames++;
    this.stat.framingBytes += 2;
    this.hop(
      r,
      'down',
      {
        color: SIG.req,
        shape: 'square',
        r: 4,
        lane: 3,
        label: resync ? `#${m.id}` : short(m.text),
        dur: this.cfg.lb ? undefined : FHOP,
        traffic: true,
        tag: this.tagFor(r, 'frame', m.id),
        done: () => {
          q.lastHeard = this.t;
          if (!resync && !m.got.has(r) && this.ppl.get(m.from)!.server !== q.server) this.stat.crossLive++;
          this.personGot(q, [m], resync);
        },
        lost: () => m.sent.delete(r),
      },
      sid,
    );
  }

  private personGot(q: PState, msgs: Msg[], resync = false) {
    for (const m of msgs) {
      if (m.got.has(q.id)) continue;
      m.got.set(q.id, this.t);
      const delay = this.t - m.tSent;
      this.stat.delays.push(delay);
      if (q.id === 'bob') this.stat.bobDelays.push(delay);
      this.stat.delivered++;
      if (resync) this.stat.resynced++;
      q.log.push({ id: m.id, from: m.from, text: m.text, mine: false, vt: this.vt, delay, resync, dm: m.to !== 'room' ? q.id : undefined });
      q.lastId = Math.max(q.lastId, m.id);
    }
    q.log.sort((a, b) => a.id - b.id);
    this.trim(q);
    this.rev++;
  }

  /** Messages on the server that this person should get and hasn't been sent yet. */
  pendingFor(pid: PersonId) {
    return this.history.filter((m) => m.atServer != null && m.expect.includes(pid) && !m.sent.has(pid) && !m.got.has(pid));
  }

  /** Messages this person should have by now but doesn't. */
  missingFor(pid: PersonId) {
    return this.history.filter((m) => m.atServer != null && m.expect.includes(pid) && !m.got.has(pid));
  }

  /* ================================================================ */
  /* Plain HTTP: ask, short polling, long polling                      */
  /* ================================================================ */

  /** Bob's browser asks for new messages once. */
  bobAsk() {
    const q = this.ppl.get('bob')!;
    if (!this.cfg.people.includes('bob') || this.cfg.mode !== 'http') return;
    this.stat.reqs++;
    this.hop('bob', 'up', { color: SIG.req, r: 4, label: 'GET', tag: this.tagFor('bob', 'get', q.lastId), done: () => this.respond(q, this.pendingFor('bob'), 'ask') });
    this.rev++;
  }

  private respond(q: PState, msgs: Msg[], how: 'short' | 'long' | 'ask') {
    msgs.forEach((m) => m.sent.add(q.id));
    const empty = msgs.length === 0;
    this.stat.responses++;
    if (empty) this.stat.empty++;
    this.hop(q.id, 'down', {
      color: empty ? EMPTY : SIG.res,
      r: empty ? 3.4 : 4.4,
      label: empty ? (how === 'long' ? '204' : '[ ]') : `${msgs.length} msg${msgs.length > 1 ? 's' : ''}`,
      done: () => {
        if (!empty) this.personGot(q, msgs);
        if (how === 'long') q.lp = 'idle';
        this.rev++;
      },
      lost: () => {
        msgs.forEach((m) => m.sent.delete(q.id));
        if (how === 'long') q.lp = 'idle';
      },
    });
  }

  private poll(q: PState) {
    this.stat.reqs++;
    this.hop(q.id, 'up', {
      color: SIG.req,
      r: 3.8,
      tag: this.tagFor(q.id, 'poll', q.lastId),
      done: () => this.respond(q, this.pendingFor(q.id), 'short'),
    });
    this.rev++;
  }

  private lpSend(q: PState) {
    q.lp = 'out';
    this.stat.reqs++;
    this.hop(q.id, 'up', {
      color: SIG.req,
      r: 3.8,
      label: 'GET',
      tag: this.tagFor(q.id, 'lp', q.lastId),
      done: () => {
        const ready = this.pendingFor(q.id);
        if (ready.length) {
          q.lp = 'back';
          this.respond(q, ready, 'long');
        } else {
          q.lp = 'held';
          q.heldSince = this.t;
        }
        this.rev++;
      },
      lost: () => {
        // The request failed: wait a moment before trying again.
        q.lp = 'back';
        this.after(2, () => {
          if (q.lp === 'back') q.lp = 'idle';
        });
      },
    });
    this.rev++;
  }

  private lpRespond(q: PState) {
    q.lp = 'back';
    this.respond(q, this.pendingFor(q.id), 'long');
  }

  /* ================================================================ */
  /* Server-Sent Events                                                */
  /* ================================================================ */

  private sseOpen(q: PState) {
    if (q.sse !== 'closed' || this.cfg.mode !== 'sse' || this.cfg.view !== 'chat') return;
    // EventSource retries a failed stream by itself, after about 3 seconds.
    const failed = () => {
      q.sse = 'closed';
      this.after(3, () => this.sseOpen(q));
    };
    q.sse = 'opening';
    this.stat.reqs++;
    this.hop(q.id, 'up', {
      color: SIG.req,
      r: 4,
      label: 'GET /events',
      tag: this.tagFor(q.id, 'sse'),
      done: () =>
        this.hop(q.id, 'down', {
          color: SIG.res,
          r: 4,
          label: '200 stream',
          tag: this.tagFor(q.id, 'sse200'),
          done: () => {
            q.sse = 'open';
            this.pulse(q.id);
            for (const m of this.pendingFor(q.id)) this.ssePush(q, m);
            this.rev++;
          },
          lost: failed,
        }),
      lost: failed,
    });
  }

  private ssePush(q: PState, m: Msg) {
    m.sent.add(q.id);
    this.hop(q.id, 'down', {
      color: SIG.res,
      shape: 'square',
      r: 4,
      lane: 0,
      label: short(m.text),
      dur: FHOP,
      tag: this.tagFor(q.id, 'event', m.id),
      done: () => this.personGot(q, [m]),
      lost: () => m.sent.delete(q.id),
    });
  }

  /* ================================================================ */
  /* WebSocket: handshake, heartbeats, reconnects                      */
  /* ================================================================ */

  private openNow(p: PState) {
    const s = this.srv.get(p.server)!;
    s.conns.set(p.id, { lastTraffic: this.t, awaiting: false, nextPing: this.t + 0.8 + this.cfg.people.indexOf(p.id) * 0.9, lastPong: this.t });
    p.conn = 'open';
    p.lastHeard = this.t;
    p.openVt = -10;
  }

  /** new WebSocket(...): the upgrade request, then (if all goes well) 101 and an open pipe. */
  connect(pid: PersonId) {
    const p = this.ppl.get(pid)!;
    if (this.cfg.view !== 'chat' || this.cfg.mode !== 'ws' || p.conn === 'connecting' || p.conn === 'open') return;
    p.conn = 'connecting';
    p.retryAt = null;
    p.lbPicked = false;
    const dur = this.cfg.slowHandshake ? SLOW_HS : undefined;
    const tag = this.tagFor(pid, 'upgrade');
    const atServer = (sid: ServerId) => {
      const s = this.srv.get(sid)!;
      if (!s.up) {
        this.note(sid, 'connection refused', SIG.err);
        this.connFailed(p);
        return;
      }
      if (this.pKind === 'status' && this.game && !this.game.done) this.askStatus(p, sid);
      else this.accept(p, sid);
    };
    if (this.cfg.lb) {
      this.send({
        from: pid,
        to: `gate:${pid}`,
        dur: dur ? dur * 0.48 : LEG_A,
        color: SIG.req,
        r: 4.2,
        label: 'GET Upgrade',
        tag,
        lostAt: p.net ? null : 0.3,
        onLost: () => this.connFailed(p),
        onArrive: () => {
          const sid = this.pickServer();
          if (!sid) {
            this.connFailed(p);
            return;
          }
          p.server = sid;
          p.lbPicked = true;
          this.lastLb = { pid, sid, vt: this.vt, only: this.liveServers().filter((x) => this.srv.get(x)!.up).length < 2 };
          this.note('lb', `${PEOPLE[pid].name} → ${SERVER_META[sid].name}`, SIG.warn, 1.4);
          this.ver++;
          this.send({ from: `gate:${pid}`, to: sid, dur: dur ? dur * 0.52 : LEG_B, color: SIG.req, r: 4.2, label: 'GET Upgrade', tag, onArrive: () => atServer(sid) });
        },
      });
    } else {
      const sid = p.server;
      this.send({
        from: pid,
        to: sid,
        dur: dur ?? HOP,
        color: SIG.req,
        r: 4.2,
        label: 'GET Upgrade',
        tag,
        lostAt: p.net ? null : 0.25,
        onLost: () => this.connFailed(p),
        onArrive: () => {
          if (tag.endsWith('|insp')) this.insp = { kind: 'upgrade', pid, msg: null, at: sid, until: this.t + 2.4 };
          atServer(sid);
        },
      });
    }
    this.rev++;
  }

  /** Least connections among the servers that are up (counting sockets still handshaking). */
  private pickServer(): ServerId | null {
    const ups = this.liveServers().filter((s) => this.srv.get(s)!.up);
    if (!ups.length) return null;
    const load = (sid: ServerId) => {
      const s = this.srv.get(sid)!;
      let n = s.conns.size;
      for (const q of this.ppl.values()) if (q.conn === 'connecting' && q.lbPicked && q.server === sid && !s.conns.has(q.id)) n++;
      return n;
    };
    return ups.sort((a, b) => load(a) - load(b))[0];
  }

  private accept(p: PState, sid: ServerId) {
    const answer = () => {
      this.hop(
        p.id,
        'down',
        {
          color: SIG.res,
          r: 4.4,
          label: '101',
          dur: this.cfg.slowHandshake ? SLOW_HS : undefined,
          tag: this.tagFor(p.id, '101'),
          done: () => this.opened(p, sid),
          lost: () => this.connFailed(p),
        },
        sid,
      );
    };
    if (this.cfg.showAccept) {
      this.acceptVt = this.vt;
      this.rev++;
      this.after(2.2, answer);
    } else answer();
  }

  private opened(p: PState, sid: ServerId) {
    const s = this.srv.get(sid)!;
    const hadTries = p.tries.length > 0;
    s.conns.set(p.id, { lastTraffic: this.t, awaiting: false, nextPing: this.t + this.cfg.pingEvery * 0.6, lastPong: this.t });
    p.conn = 'open';
    p.server = sid;
    p.attempt = 0;
    p.retryAt = null;
    p.lastHeard = this.t;
    p.openVt = this.vt;
    if (hadTries && p.tries.length) p.tries[p.tries.length - 1].ok = true;
    this.pulse(p.id);
    this.ver++;
    // Catch up on anything missed while away, then send what was queued.
    const missed = this.missingFor(p.id).filter((m) => !m.sent.has(p.id));
    if (missed.length) {
      this.hop(p.id, 'up', {
        color: SIG.req,
        shape: 'square',
        r: 3.6,
        lane: 3,
        label: `resume after #${p.lastId}`,
        dur: this.cfg.lb ? undefined : FHOP,
        traffic: true,
        done: () => missed.forEach((m, i) => this.after(i * 0.3, () => !m.got.has(p.id) && this.downFrame(p.id, sid, m, true))),
      });
    }
    const queued = p.outbox.splice(0);
    queued.forEach((m, i) => this.after(0.2 + i * 0.25, () => this.upFrame(p, m)));
    this.rev++;
  }

  private connFailed(p: PState) {
    if (p.tries.length) p.tries[p.tries.length - 1].ok = false;
    p.conn = 'waiting';
    this.scheduleRetry(p);
  }

  /** Exponential backoff with jitter: about 1, 2, 4, 8… seconds, capped. */
  private scheduleRetry(p: PState) {
    const base = Math.min(BACKOFF_CAP, 2 ** p.attempt);
    const delay = base * (0.5 + 0.5 * this.rng());
    p.attempt++;
    p.retryDelay = delay;
    p.retryAt = this.t + delay;
    p.conn = 'waiting';
    p.tries.push({ delay, ok: null });
    if (p.tries.length > 6) p.tries.shift();
    this.rev++;
  }

  /** The client stops trusting its connection (no heartbeat, or the proxy closed it). */
  private clientLost(p: PState, why: string) {
    p.conn = 'waiting';
    p.attempt = 0;
    p.tries = [];
    this.note(p.id, why, SIG.warn, 2);
    this.scheduleRetry(p);
  }

  private ping(sid: ServerId, pid: PersonId) {
    this.stat.pings++;
    const p = this.ppl.get(pid)!;
    const label = this.stat.pings <= 2 ? 'ping' : undefined;
    this.hop(
      pid,
      'down',
      {
        color: SIG.hc,
        r: 3.2,
        lane: -3,
        label,
        dur: this.cfg.lb ? undefined : PHOP,
        traffic: true,
        done: () => {
          if (p.conn !== 'open') return;
          p.lastHeard = this.t;
          this.hop(
            pid,
            'up',
            {
              color: SIG.hc,
              r: 3.2,
              lane: -3,
              label: label ? 'pong' : undefined,
              dur: this.cfg.lb ? undefined : PHOP,
              traffic: true,
              done: () => {
                const cn = this.srv.get(sid)!.conns.get(pid);
                if (cn) {
                  cn.awaiting = false;
                  cn.lastPong = this.t;
                }
              },
            },
            sid,
          );
        },
      },
      sid,
    );
  }

  private terminate(s: SState, pid: PersonId) {
    s.conns.delete(pid);
    this.stat.terminated++;
    this.note(s.id, `no pong from ${PEOPLE[pid].name}: closed`, SIG.err, 2.2);
    const p = this.ppl.get(pid)!;
    // If the network still works the client hears the TCP close at once.
    if (p.net && p.conn === 'open' && p.server === s.id) this.clientLost(p, 'connection closed');
    this.ver++;
    this.rev++;
  }

  private proxyClose(s: SState, pid: PersonId) {
    s.conns.delete(pid);
    this.stat.proxyCloses++;
    const gate = this.boxes.get(`gate:${pid}`);
    if (gate) this.fx({ kind: 'x', at: { id: `gate:${pid}` }, color: SIG.err, size: 1.2, dur: 1.2 });
    this.note('lb', `idle ${this.cfg.idle} s: closed`, SIG.err, 1.8);
    const p = this.ppl.get(pid)!;
    if (p.conn === 'open') this.clientLost(p, 'closed · 1006');
    this.ver++;
    this.rev++;
  }

  /* ================================================================ */
  /* The loop                                                          */
  /* ================================================================ */

  protected step(dt: number) {
    const c = this.cfg;
    if (c.view === 'race') this.stepRace(dt);
    else if (c.view === 'seq') {
      this.seqT += dt;
      if (this.seqT > 17) this.seqT = 0;
    } else if (c.view === 'frame') {
      if (this.t >= this.nextFrame) {
        this.nextFrame = this.t + 3.1;
        this.flyFrame();
      }
    } else if (c.view === 'choose') {
      if (this.t >= this.nextChoose) {
        this.nextChoose = this.t + 1.9;
        this.flyApp();
      }
    } else this.stepChat();
  }

  private stepChat() {
    const c = this.cfg;
    const t = this.t;

    // Automatic chatter
    const a = c.auto;
    const quietForGame = this.pKind === 'split' && this.game && !this.game.done;
    if (a && t >= this.nextAuto && !quietForGame) {
      const from = a.from[this.autoIdx++ % a.from.length];
      this.chat(from);
      this.nextAuto = t + a.min + this.rng() * (a.max - a.min);
    }

    // The split-room quiz sends its messages one at a time
    if (this.nextSplitAt != null && t >= this.nextSplitAt && this.game && !this.game.done && !this.game.pending) {
      this.nextSplitAt = null;
      this.sendSplit();
    }

    for (const pid of c.people) {
      const p = this.ppl.get(pid)!;
      if (c.mode === 'short' && c.receivers.includes(pid) && t >= p.nextPoll) {
        p.nextPoll = t + c.interval;
        this.poll(p);
      }
      if (c.mode === 'long' && c.receivers.includes(pid)) {
        if (p.lp === 'idle') this.lpSend(p);
        else if (p.lp === 'held' && t - p.heldSince >= c.lpTimeout) this.lpRespond(p);
      }
      if (c.mode === 'ws') {
        if (p.conn === 'waiting' && p.retryAt != null && t >= p.retryAt) this.connect(pid);
        // Client watchdog: no ping (or anything) for too long means the connection is dead.
        if (c.heartbeat && p.conn === 'open' && t - p.lastHeard > c.pingEvery * 2 + 1.2) this.clientLost(p, 'no heartbeat');
      }
    }

    if (c.mode === 'ws') {
      for (const s of this.srv.values()) {
        if (s.downUntil != null && t >= s.downUntil) {
          s.up = true;
          s.downUntil = null;
          this.note(s.id, 'back up, 0 connections', SIG.res, 2);
          this.rev++;
        }
        for (const [pid, cn] of [...s.conns]) {
          if (c.heartbeat && t >= cn.nextPing) {
            cn.nextPing = t + c.pingEvery;
            if (cn.awaiting) {
              this.terminate(s, pid);
              continue;
            }
            cn.awaiting = true;
            this.ping(s.id, pid);
          }
          if (c.lb && c.idle > 0 && t - cn.lastTraffic > c.idle) this.proxyClose(s, pid);
        }
      }
    }
  }

  /* ================================================================ */
  /* Prediction games                                                  */
  /* ================================================================ */

  private askBobSees() {
    if (!this.game || this.game.done) return;
    this.game.ask({
      acceptable: ['asks'],
      choices: [
        { id: 'push', label: 'Right away: the server sends it' },
        { id: 'asks', label: 'When Bob’s browser asks' },
        { id: 'never', label: 'Never: it’s lost' },
      ],
      ask: 'When does Bob see it?',
      askAt: { id: 'srv1' },
      explain: (picked, ok) =>
        ok
          ? 'The server can only answer requests, so Alice’s message waits until Bob’s browser sends one. Here it comes.'
          : picked === 'push'
            ? 'HTTP doesn’t work that way: a server can only answer a request, and Bob has none open. The message waits until his browser asks. Here it comes.'
            : 'It isn’t lost: the server stored it. It just can’t deliver it until Bob’s browser asks. Here it comes.',
      resolve: () => {
        this.after(0.5, () => this.bobAsk());
        // Wrong answer: play it again with a new message until it clicks.
        this.after(5.5, () => {
          if (this.game && !this.game.done) this.chat('alice');
        });
      },
    });
  }

  private askStatus(p: PState, sid: ServerId) {
    this.game!.ask({
      acceptable: ['101'],
      choices: [
        { id: '200', label: '200 OK' },
        { id: '101', label: '101 Switching Protocols' },
        { id: '301', label: '301 Moved Permanently' },
        { id: '426', label: '426 Upgrade Required' },
      ],
      ask: 'Which status code comes back?',
      askAt: { id: sid },
      explain: (picked, ok) =>
        ok
          ? '101 Switching Protocols: the server agrees, and from the next byte on, this connection speaks WebSocket instead of HTTP.'
          : picked === '200'
            ? 'A 200 is an ordinary response: the exchange ends and the connection stays HTTP. Agreeing to switch has its own code, 101 Switching Protocols.'
            : picked === '426'
              ? 'Close! 426 Upgrade Required is what a server says when you must upgrade but didn’t ask. Bob did ask, so the answer is 101 Switching Protocols.'
              : 'A redirect would send Bob somewhere else. This server is happy to switch right here: 101 Switching Protocols.',
      resolve: () => {
        this.accept(p, sid);
        // Wrong answer: Bob reloads the page and the handshake runs again.
        this.after(this.cfg.slowHandshake ? 7.5 : 4, () => {
          if (this.game && !this.game.done) this.reload(p.id);
        });
      },
    });
  }

  /** The page reloads: its socket closes and a new handshake starts. */
  private reload(pid: PersonId) {
    const p = this.ppl.get(pid)!;
    for (const s of this.srv.values()) s.conns.delete(pid);
    p.conn = 'closed';
    this.inspShown.delete('upgrade');
    this.inspShown.delete('101');
    this.note(pid, 'page reloaded', SIG.warn, 1.8);
    this.ver++;
    this.after(1.4, () => this.connect(pid));
    this.rev++;
  }

  private sendSplit() {
    const sc = SPLIT[this.splitIdx++ % SPLIT.length];
    const m = this.chat(sc.from, sc.text, sc.to);
    if (m) this.splitAsk = { scenario: sc, msg: m.id };
  }

  private askSplit(m: Msg, sid: ServerId) {
    const sc = this.splitAsk!.scenario;
    this.game!.ask({
      acceptable: [sc.answer],
      choices: sc.choices,
      ask: sc.ask,
      askAt: { id: sid },
      explain: () => sc.why,
      resolve: () => {
        this.splitAsk = null;
        this.fanOut(m, sid);
        this.nextSplitAt = this.t + 3.2;
      },
    });
  }

  /* ================================================================ */
  /* Controls the panel calls                                          */
  /* ================================================================ */

  setPollInterval(v: number) {
    if (v === this.cfg.interval) return;
    this.cfg = { ...this.cfg, interval: v };
    if (this.cfg.view === 'chat') this.stat = emptyStats();
    if (v <= 1.5) this.tried.fast = true;
    if (v >= 7.5) this.tried.slow = true;
    for (const pid of this.cfg.receivers) {
      const p = this.ppl.get(pid)!;
      p.nextPoll = Math.min(p.nextPoll, this.t + v);
    }
    this.race.setPollInterval(v);
    this.rev++;
  }

  setHeartbeat(on: boolean) {
    this.cfg = { ...this.cfg, heartbeat: on };
    for (const s of this.srv.values()) for (const cn of s.conns.values()) cn.awaiting = false;
    for (const p of this.ppl.values()) p.lastHeard = this.t;
    this.rev++;
  }

  setBackplane(on: boolean) {
    this.cfg = { ...this.cfg, backplane: on };
    this.rev++;
  }

  cutNet(pid: PersonId) {
    const p = this.ppl.get(pid)!;
    if (!p.net) return;
    p.net = false;
    p.cutAt = this.t;
    for (const f of this.flights) if (f.from === pid || f.to === pid) this.drop(f);
    this.note(pid, 'Wi-Fi drops', SIG.err, 2);
    this.rev++;
  }

  restoreNet(pid: PersonId) {
    const p = this.ppl.get(pid)!;
    if (p.net) return;
    p.net = true;
    this.note(pid, 'Wi-Fi back', SIG.res, 2);
    const c = this.cfg;
    if (c.view === 'chat' && c.mode !== 'ws') {
      // HTTP transports: send what failed while offline.
      const queued = p.outbox.splice(0);
      queued.forEach((m, i) => this.after(0.2 + i * 0.3, () => this.post(p, m)));
      // An open event stream reconnects with Last-Event-ID and catches up.
      if (c.mode === 'sse' && p.sse === 'open') {
        this.pendingFor(pid).forEach((m, i) => this.after(0.4 + i * 0.25, () => this.ssePush(p, m)));
      }
    }
    this.rev++;
  }

  restartServer(sid: ServerId) {
    const s = this.srv.get(sid)!;
    if (!s.up || this.cfg.view !== 'chat') return;
    s.up = false;
    s.downUntil = this.t + 5.5;
    for (const pid of [...s.conns.keys()]) {
      const p = this.ppl.get(pid)!;
      this.hop(
        pid,
        'down',
        {
          color: SIG.hc,
          r: 3.6,
          label: 'close 1001',
          done: () => {
            if (p.conn === 'open' && p.server === sid) {
              p.conn = 'waiting';
              p.attempt = 0;
              p.tries = [];
              this.scheduleRetry(p);
            }
          },
        },
        sid,
      );
    }
    s.conns.clear();
    this.note(sid, 'restarting…', SIG.err, 2);
    this.ver++;
    this.rev++;
  }

  /** Playground: switch transport. */
  setMode(mode: Mode) {
    if (this.cfg.mode === mode) return;
    const servers = mode === 'ws' ? this.cfg.servers : 1;
    this.cfg = { ...this.cfg, mode, servers, redis: servers === 2 && this.cfg.redis, receivers: ['alice', 'bob'] };
    this.rebuildConnections();
  }

  /** Playground: one or two chat servers (WebSocket only). */
  setServers(n: 1 | 2) {
    if (this.cfg.servers === n || this.cfg.mode !== 'ws') return;
    this.cfg = { ...this.cfg, servers: n, redis: n === 2 };
    this.rebuildConnections();
  }

  private rebuildConnections() {
    this.clearTransient();
    this.stat = emptyStats();
    for (const s of this.srv.values()) {
      s.conns = new Map();
      s.up = true;
      s.downUntil = null;
    }
    for (const pid of this.cfg.people) {
      const p = this.ppl.get(pid)!;
      p.server = this.homeOf(pid);
      p.conn = 'closed';
      p.sse = 'closed';
      p.lp = 'idle';
      p.retryAt = null;
      p.attempt = 0;
      p.tries = [];
      p.outbox = [];
      p.lastHeard = this.t;
      p.nextPoll = this.t + 0.5;
    }
    // A fresh start: whatever was still undelivered is dropped, not resynced.
    for (const m of this.history) {
      m.expect = m.expect.filter((r) => m.got.has(r));
      m.sent = new Set(m.got.keys());
    }
    this.cfg = { ...this.cfg, open: 'connect' };
    this.startTransport(false);
    this.syncBoxes();
    this.relayout();
    this.ver++;
    this.rev++;
  }

  /* ================================================================ */
  /* Race, frame and chooser views                                     */
  /* ================================================================ */

  private stepRace(dt: number) {
    const r = this.race;
    const t = r.t + dt;
    if (this.raceAuto < RACE_AUTO.length && t >= RACE_AUTO[this.raceAuto]) {
      this.raceAuto++;
      r.step(t);
      r.send();
    } else if (this.raceAuto >= RACE_AUTO.length && t >= this.raceNextRandom) {
      this.raceNextRandom = t + 5 + this.rng() * 5;
      r.step(t);
      r.send();
    }
    r.step(t);
  }

  raceSend() {
    this.race.send();
    this.raceNextRandom = Math.max(this.raceNextRandom, this.race.t + 6);
    this.rev++;
  }

  setFrame(kind: FrameKind) {
    this.cfg = { ...this.cfg, frame: kind };
    this.flights = [];
    this.nextFrame = this.t + 0.25;
    this.frameVt = this.vt;
    this.relayout();
    this.ver++;
    this.rev++;
  }

  private flyFrame() {
    const f = FRAMES[this.cfg.frame];
    const c2s = f.dir === 'c2s';
    this.send({
      from: c2s ? 'fcli' : 'fsrv',
      to: c2s ? 'fsrv' : 'fcli',
      dur: 1.3,
      color: f.opcode >= 8 ? SIG.hc : SIG.req,
      shape: 'square',
      r: 4.5,
      lane: 0,
      label: f.flight,
      onArrive: () => this.fx({ kind: 'ring', at: { id: c2s ? 'fsrv' : 'fcli' }, color: f.opcode >= 8 ? SIG.hc : SIG.req, size: 0.8 }),
    });
  }

  private flyApp() {
    const app = CHOOSE_APPS[this.chooseIdx++ % CHOOSE_APPS.length];
    const path = ['src', ...app.path];
    const go = (i: number) => {
      if (i >= path.length - 1) {
        const leaf = path[path.length - 1].slice(5) as Leaf;
        const list = this.chooseLog[leaf];
        if (!list.includes(app.name)) list.push(app.name);
        if (list.length > 3) list.shift();
        this.fx({ kind: 'ring', at: { id: path[path.length - 1] }, color: SIG.warn, size: 1 });
        this.rev++;
        return;
      }
      this.send({ from: path[i], to: path[i + 1], dur: i === 0 ? 0.5 : 0.85, color: SIG.warn, r: 4, lane: 0, label: app.name, onArrive: () => go(i + 1) });
    };
    go(0);
  }

  /* ================================================================ */
  /* Numbers and geometry for the overlay                              */
  /* ================================================================ */

  avgDelay(bobOnly = false) {
    const d = bobOnly ? this.stat.bobDelays : this.stat.delays;
    return d.length ? d.reduce((a, b) => a + b, 0) / d.length : null;
  }

  worstDelay(bobOnly = false) {
    const d = bobOnly ? this.stat.bobDelays : this.stat.delays;
    return d.length ? Math.max(...d) : null;
  }

  /** How long the oldest undelivered message has been waiting. */
  oldestWaiting(pid: PersonId) {
    const m = this.missingFor(pid)[0];
    return m ? this.t - m.tSent : null;
  }

  /** The status line in a chat window's header, with a short form for narrow windows. */
  statusOf(pid: PersonId): { text: string; short: string; color: string } | null {
    const p = this.ppl.get(pid)!;
    const c = this.cfg;
    if (c.mode === 'ws') {
      if (p.conn === 'open') return { text: 'connected', short: 'connected', color: SIG.res };
      if (p.conn === 'connecting') return { text: 'connecting…', short: 'connecting', color: SIG.warn };
      if (p.conn === 'waiting') {
        const left = p.retryAt != null ? Math.max(0, p.retryAt - this.t).toFixed(1) : null;
        return { text: left ? `retry in ${left} s` : 'waiting', short: left ? `retry ${left}s` : 'waiting', color: SIG.warn };
      }
      return { text: 'offline', short: 'offline', color: EMPTY };
    }
    if (!c.receivers.includes(pid)) return null;
    if (c.mode === 'sse') {
      if (p.sse === 'open') return { text: 'stream open', short: 'streaming', color: SIG.res };
      if (p.sse === 'opening') return { text: 'connecting…', short: 'connecting', color: SIG.warn };
      return { text: 'no stream', short: 'no stream', color: EMPTY };
    }
    if (c.mode === 'short') return { text: `polls every ${c.interval} s`, short: `every ${c.interval}s`, color: SIG.req };
    if (c.mode === 'long') return p.lp === 'held' ? { text: 'request waiting', short: 'waiting', color: SIG.req } : { text: 'asking…', short: 'asking', color: SIG.req };
    return { text: 'no request open', short: 'no request', color: EMPTY };
  }

  /** A pulse around a person's avatar (their connection just opened). */
  private pulse(pid: PersonId) {
    const b = this.boxes.get(pid);
    if (!b) return;
    const small = b.h < 112 || b.w < 172;
    const hdr = small ? 24 : 30;
    this.fx({ kind: 'ring', at: { id: pid, dx: -b.w / 2 + (small ? 14 : 17), dy: -b.h / 2 + hdr / 2 }, color: PIPE, size: 0.8 });
  }

  calloutRect(target: string): Rect | null {
    const land = this.orient === 'landscape';
    if (target.startsWith('pipe:')) {
      const cs = this.pipeCurves(target.slice(5) as PersonId);
      const c = cs[cs.length - 1];
      if (!c) return null;
      const m = bezier(c, 0.5);
      return { x: m.x, y: m.y, w: 16, h: 16 };
    }
    if (target.startsWith('held:')) {
      const pid = target.slice(5) as PersonId;
      const c = this.curveFor(pid, this.ppl.get(pid)!.server, 0);
      if (!c) return null;
      const m = bezier(c, 0.86);
      return { x: m.x, y: m.y, w: 20, h: 20 };
    }
    if (target.startsWith('lane:')) {
      const g = raceGeo(this.w, this.h, land);
      const l = g.lanes.find((x) => x.kind === target.slice(5));
      if (!l) return null;
      return { x: (g.x0 + g.x1) / 2, y: (l.ySrv + l.yBob) / 2, w: g.x1 - g.x0, h: l.yBob - l.ySrv };
    }
    if (target.startsWith('field:')) {
      const g = frameGeo(this.w, this.h, land, FRAMES[this.cfg.frame]);
      return fieldRect(g, target.slice(6) as 'fin' | 'rsv' | 'opcode' | 'mask' | 'len');
    }
    if (target === 'bytes') {
      const g = frameGeo(this.w, this.h, land, FRAMES[this.cfg.frame]);
      const xs = g.bytes.map((b) => b.x);
      if (!xs.length) return null;
      const x0 = Math.min(...xs);
      const x1 = Math.max(...xs) + g.bw;
      return { x: (x0 + x1) / 2, y: g.by + g.bh / 2, w: x1 - x0, h: g.bh };
    }
    const b = this.boxes.get(target);
    return b && !Number.isNaN(b.x) ? { x: b.x, y: b.y, w: b.w, h: b.h } : null;
  }
}
