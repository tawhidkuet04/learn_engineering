import { SIG } from '@/lib/sim/colors';

/* ------------------------------------------------------------------ */
/* Cast                                                                */
/* ------------------------------------------------------------------ */

export interface User {
  id: string;
  name: string;
  email: string;
  ip: string;
  color: string;
}

export const USERS: User[] = [
  { id: 'alice', name: 'Alice', email: 'alice@example.com', ip: '198.51.100.42', color: SIG.pink },
  { id: 'bob', name: 'Bob', email: 'bob@example.com', ip: '192.0.2.7', color: SIG.teal },
  { id: 'carol', name: 'Carol', email: 'carol@example.com', ip: '198.51.100.73', color: SIG.lime },
  { id: 'dave', name: 'Dave', email: 'dave@example.com', ip: '192.0.2.150', color: SIG.blue },
];

export const userOf = (id: string | null | undefined) => USERS.find((u) => u.id === id) ?? USERS[0];

export type SvcId = 'email' | 'thumbs' | 'analytics';

/** The three follow-up calls the signup handler makes. Times are what a real call might take. */
export const SERVICES: { id: SvcId; name: string; call: string; ms: [number, number] }[] = [
  { id: 'email', name: 'email-svc', call: 'email.sendWelcome', ms: [480, 720] },
  { id: 'thumbs', name: 'thumbnail-svc', call: 'thumbs.resize', ms: [620, 940] },
  { id: 'analytics', name: 'analytics-svc', call: 'analytics.track', ms: [80, 150] },
];

/** The HTTP client timeout the signup handler uses for each call. */
export const CALL_TIMEOUT_MS = 3000;

/**
 * Animation seconds for something that really takes `ms` milliseconds.
 * The stage is slowed down so you can watch it; readouts show the real numbers.
 */
export const vis = (ms: number) => 0.16 + ms / 800;

/** Hop durations, in simulated seconds. */
export const HOP = {
  user: 0.55,
  svc: 0.24,
  send: 0.42,
  sendAck: 0.22,
  recv: 0.5,
  ack: 0.42,
  dlq: 0.75,
  ex: 0.42,
  fan: 0.45,
  log: 0.5,
  commit: 0.32,
};

/** Fraction of the work at which a charge job actually charges the card. */
export const EFFECT_AT = 0.55;

export const AMOUNTS = [20, 35, 12, 49];

/** Toy partitioner: add up the character codes. Kafka really uses murmur2. */
export const toyHash = (key: string) => [...key].reduce((s, ch) => s + ch.charCodeAt(0), 0);

export const fmtMs = (ms: number) => `${Math.round(ms).toLocaleString('en-US')} ms`;

/** '#B59BFF' + 0.5 → 'rgba(181,155,255,0.5)' */
export function withAlpha(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/* ------------------------------------------------------------------ */
/* Configuration: every step reconfigures the same world               */
/* ------------------------------------------------------------------ */

export type Mode = 'sync' | 'queue' | 'fanout' | 'log';
export type Job = 'signup' | 'charge' | 'plan';
export type PredictKind = 'crash' | 'double' | 'partition' | null;

export interface SubSpec {
  id: string;
  /** Queue name */
  name: string;
  /** Name of the worker that drains it */
  worker: string;
  /** What its worker does, shown on the card */
  does: string;
  /** Seconds per message */
  work: number;
}

export interface GroupSpec {
  id: string;
  members: number;
  color: string;
}

export interface MQConfig {
  mode: Mode;
  /** Draw Alice, Bob and Carol sending signups to the API */
  users: boolean;
  producer: string;
  producerSub: string;
  queue: string;
  job: Job;
  /** Messages (or signups) per second */
  rate: number;
  poisson: boolean;
  /** Sync mode: health of the email service */
  email: 'ok' | 'down' | 'slow';
  workers: number;
  /** Seconds of work per message */
  work: number;
  jitter: number;
  /** Visibility timeout, seconds */
  visibility: number;
  /** Draw the "in flight" shelf above the rail */
  shelf: boolean;
  dlq: boolean;
  maxReceives: number;
  idempotent: boolean;
  /** Delete on receipt (at-most-once) instead of after the work (at-least-once) */
  ackBefore: boolean;
  /** Bounded queue: reject sends beyond this many ready messages */
  maxDepth: number | null;
  autoscale: boolean;
  /** Chance a delivery crashes its worker */
  crashRate: number;
  poisonRate: number;
  /** Seconds before a crashed worker restarts (0 = stays down until clicked) */
  restart: number;
  subs: SubSpec[];
  /** Fan-out: subscriber id that is slowed down */
  slowSub: string | null;
  partitions: number;
  groups: GroupSpec[];
  clickWorkers: boolean;
  tour: boolean;
  predict: PredictKind;
  /** Messages already waiting when the step starts */
  backlog: number;
  /** The poison-message bug has been fixed */
  fixed: boolean;
  /** Label ack flights with "delete #n" */
  ackLabels: boolean;
  /** Which state panel the stage shows (it also reserves room for it) */
  readout: ReadoutKind;
}

export const SUBS: SubSpec[] = [
  { id: 'email', name: 'email', worker: 'mailer', does: 'sending email', work: 1.3 },
  { id: 'thumbs', name: 'thumbnails', worker: 'resizer', does: 'resizing avatar', work: 1.6 },
  { id: 'analytics', name: 'analytics', worker: 'tracker', does: 'tracking signup', work: 0.8 },
];

export const FRAUD: SubSpec = { id: 'fraud', name: 'fraud-check', worker: 'scorer', does: 'scoring signup', work: 1.1 };

/** Portrait strip readouts need room at the bottom of the stage. */
export type ReadoutKind = 'none' | 'waterfall' | 'ledger' | 'plans' | 'hash' | 'offsets' | 'tour';

export const DEFAULTS: MQConfig = {
  mode: 'queue',
  users: false,
  producer: 'signup-api',
  producerSub: 'POST /signup',
  queue: 'signups',
  job: 'signup',
  rate: 0.6,
  poisson: false,
  email: 'ok',
  workers: 2,
  work: 1.8,
  jitter: 0.25,
  visibility: 6,
  shelf: true,
  dlq: false,
  maxReceives: 3,
  idempotent: false,
  ackBefore: false,
  maxDepth: null,
  autoscale: false,
  crashRate: 0,
  poisonRate: 0,
  restart: 4,
  subs: SUBS,
  slowSub: null,
  partitions: 3,
  groups: [{ id: 'billing', members: 3, color: SIG.hc }],
  clickWorkers: false,
  tour: false,
  predict: null,
  backlog: 0,
  fixed: false,
  ackLabels: false,
  readout: 'none',
};

/* ------------------------------------------------------------------ */
/* World state                                                         */
/* ------------------------------------------------------------------ */

export interface Msg {
  id: number;
  label: string;
  color: string;
  user: string;
  /** Partition / ordering key */
  key: string;
  poison: boolean;
  order: number;
  amount: number;
  plan: 'pro' | 'free' | null;
  /** Per-key sequence number (ordering demo) */
  seq: number;
  /** Fixed work time (scripted demos) */
  work: number | null;
  sentAt: number;
  /** SQS ApproximateReceiveCount */
  receives: number;
  /** In flight: becomes visible again at this time */
  visibleAt: number;
  /** Chip position, eased every frame */
  x: number;
  y: number;
  alpha: number;
}

export interface Queue {
  id: string;
  name: string;
  /** Ready messages; [0] is the head */
  visible: Msg[];
  /** Received but not deleted: hidden until the visibility timeout */
  inflight: Msg[];
  dead: boolean;
  shelf: boolean;
  /** vt of the last rejected send */
  flash: number;
}

export type WState = 'idle' | 'fetching' | 'working' | 'error' | 'down';

export interface Worker {
  id: string;
  name: string;
  queue: string;
  /** Fan-out subscriber this worker serves */
  sub: string | null;
  state: WState;
  msg: Msg | null;
  p: number;
  dur: number;
  /** The side effect (charge) already happened for this delivery */
  effect: boolean;
  /** Crash when progress reaches this fraction */
  crashAt: number | null;
  downUntil: number | null;
  errorUntil: number;
  status: string;
  tone: 'normal' | 'ok' | 'bad' | 'warn';
  retiring: boolean;
  served: number;
  flash: { color: string; vt: number } | null;
  /** How this delivery's side effect went */
  note: 'charged' | 'skipped' | 'double' | null;
  /** This delivery was already deleted on receipt (at-most-once) */
  acked: boolean;
}

export interface LedgerRow {
  order: number;
  user: string;
  amount: number;
  kind: 'ok' | 'dup' | 'skip' | 'lost';
  msg: string;
  vt: number;
}

export interface PlanRow {
  user: string;
  /** What the users table says now */
  plan: 'pro' | 'free' | null;
  /** What the newest event said */
  latest: 'pro' | 'free' | null;
  latestSeq: number;
  /** Highest sequence number applied so far */
  maxApplied: number;
  /** Messages for this user still in the pipeline */
  pending: number;
  /** An older event overwrote a newer one */
  stale: boolean;
  vt: number;
}

export type PhaseKey = 'db' | SvcId | 'send';

export interface Phase {
  key: PhaseKey;
  label: string;
  ms: number;
  t0: number;
  dur: number;
  state: 'run' | 'ok' | 'fail';
  note?: string;
}

export interface SignupReq {
  id: number;
  user: User;
  mode: 'sync' | 'queue';
  phases: Phase[];
  outcome: 'pending' | 'ok' | 'fail';
  total: number | null;
  status: number | null;
}

export interface SvcCall {
  req: SignupReq;
  t0: number;
  dur: number;
}

export interface Rec {
  offset: number;
  id: number;
  key: string;
  label: string;
  color: string;
  x: number;
  y: number;
  alpha: number;
}

export interface Part {
  idx: number;
  log: Rec[];
}

export interface Consumer {
  id: string;
  name: string;
  group: string;
  state: 'idle' | 'fetching' | 'working' | 'down';
  cur: { p: number; rec: Rec } | null;
  p: number;
  dur: number;
  rr: number;
  status: string;
}

export interface Group {
  id: string;
  color: string;
  /** Next offset to read, per partition, as last committed */
  committed: number[];
  /** Next offset to fetch, per partition */
  position: number[];
  members: string[];
  assign: (string | null)[];
  rebalanceUntil: number;
  needsAssign: boolean;
}

export type TourStage = 'wait' | 'send' | 'stored' | 'fetch' | 'hidden' | 'delete' | 'gone';

export interface Tour {
  stage: TourStage;
  msg: Msg | null;
  since: number;
  allow: boolean;
  flight: number | null;
  x: number;
  y: number;
}

export interface HashInfo {
  key: string;
  label: string;
  color: string;
  hash: number;
  n: number;
  p: number;
  asking: boolean;
}

export interface Metrics {
  sent: number;
  processed: number;
  okSignups: number;
  failedSignups: number;
  resp: number[];
  charges: number;
  dupes: number;
  skipped: number;
  lost: number;
  rejected: number;
  dlq: number;
  crashes: number;
  redelivered: number;
  wrongOrder: number;
  poisonTries: number;
  arr: number[];
  done: number[];
  depth: number[];
}

export const freshMetrics = (): Metrics => ({
  sent: 0,
  processed: 0,
  okSignups: 0,
  failedSignups: 0,
  resp: [],
  charges: 0,
  dupes: 0,
  skipped: 0,
  lost: 0,
  rejected: 0,
  dlq: 0,
  crashes: 0,
  redelivered: 0,
  wrongOrder: 0,
  poisonTries: 0,
  arr: [],
  done: [],
  depth: [],
});
