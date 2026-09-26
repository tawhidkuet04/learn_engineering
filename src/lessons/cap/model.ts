import { SIG } from '@/lib/sim/colors';

/* Shared vocabulary for the CAP lesson: regions, people, values, clocks. */

export type NodeId = 'va' | 'fra' | 'sg';
export const NODES: NodeId[] = ['va', 'fra', 'sg'];

export type ClientId = 'alice' | 'bob' | 'carol';
export const CLIENT_IDS: ClientId[] = ['alice', 'bob', 'carol'];

export const REGION: Record<NodeId, { city: string; code: string; short: string; ip: string }> = {
  va: { city: 'Virginia', code: 'us-east-1', short: 'VA', ip: '192.0.2.10' },
  fra: { city: 'Frankfurt', code: 'eu-central-1', short: 'FRA', ip: '198.51.100.10' },
  sg: { city: 'Singapore', code: 'ap-southeast-1', short: 'SG', ip: '203.0.113.10' },
};

export const PEOPLE: Record<ClientId, { name: string; home: NodeId; color: string }> = {
  alice: { name: 'Alice', home: 'va', color: SIG.pink },
  bob: { name: 'Bob', home: 'fra', color: SIG.teal },
  carol: { name: 'Carol', home: 'sg', color: SIG.lime },
};

export const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** Typical round-trip times between these cloud regions, in ms. */
export const RTT_MS: Record<string, number> = {
  [pairKey('va', 'fra')]: 90,
  [pairKey('fra', 'sg')]: 160,
  [pairKey('va', 'sg')]: 220,
};

/** The animation is slowed down: one simulated second shows 90 ms of network time. */
export const MS_PER_S = 90;

/** One-way trip between two regions, in simulated seconds. */
export const oneWay = (a: NodeId, b: NodeId) => RTT_MS[pairKey(a, b)] / 2 / MS_PER_S;

/** Hop between a person and their nearby replica (about 1 ms in reality; slowed so you can see it). */
export const HOP = 0.38;

/* ------------------------------------------------------------------ */

export type VV = Record<NodeId, number>;

/** One version of the value `seats_left`, as a replica stores it. */
export interface Val {
  /** Unique id of the write that produced it */
  id: number;
  seats: number;
  /** Simple version counter: v9, v10… */
  ver: number;
  /** Who wrote it (null for the initial value) */
  by: string | null;
  /** Replica that accepted the write */
  at: NodeId | null;
  /** Timestamp from the accepting replica's clock, ms after 10:00:00.000 */
  ts: number;
  /** Real time of the write (what an all-seeing observer knows), ms after 10:00:00.000 */
  real: number;
  /** Version vector: how many writes each replica has accepted in this value's history */
  vv: VV;
}

export type VVOrder = 'equal' | 'a' | 'b' | 'concurrent';

/** Compare two version vectors: does one include everything the other has seen? */
export function vvCompare(a: VV, b: VV): VVOrder {
  let aBig = false;
  let bBig = false;
  for (const k of NODES) {
    if (a[k] > b[k]) aBig = true;
    if (b[k] > a[k]) bBig = true;
  }
  if (aBig && bBig) return 'concurrent';
  if (aBig) return 'a';
  if (bBig) return 'b';
  return 'equal';
}

export const fmtVV = (v: VV) => `[${v.va}, ${v.fra}, ${v.sg}]`;

/** 10:00:01.080 style wall-clock label for a timestamp in ms after 10:00:00.000. */
export function fmtClock(ms: number, full = true) {
  const t = Math.max(0, Math.round(ms));
  const s = Math.floor(t / 1000);
  const m = Math.floor(s / 60);
  const ss = String(s % 60).padStart(2, '0');
  const mmm = String(t % 1000).padStart(3, '0');
  return full ? `10:${String(m).padStart(2, '0')}:${ss}.${mmm}` : `:${ss}.${mmm}`;
}

export const fmtMs = (ms: number) => (ms < 10 ? `${ms.toFixed(0)} ms` : `${Math.round(ms)} ms`);
