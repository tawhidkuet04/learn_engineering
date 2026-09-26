import { SIG } from '@/lib/sim/colors';
import { TWO32, hashOf, murmur3, scaleKeyHashes } from './hash';

/* ------------------------------------------------------------------ */
/* The cast                                                            */
/* ------------------------------------------------------------------ */

export interface ServerDef {
  id: string;
  name: string;
  ip: string;
  /** What gets hashed: the address, like ketama does ("ip:port") */
  addr: string;
  color: string;
}

/*
 * Addresses were picked so the first four servers land at a readable,
 * realistically uneven spread (cache-b owns ~44% of the ring with one token),
 * and each joiner lands inside a different server's arc.
 */
const DEFS: [string, string, string][] = [
  ['a', '10.0.1.227', SIG.pink],
  ['b', '10.0.1.91', SIG.teal],
  ['c', '10.0.1.176', SIG.lime],
  ['d', '10.0.1.224', SIG.blue],
  ['e', '10.0.1.68', SIG.heavy],
  ['f', '10.0.1.17', SIG.hc],
  ['g', '10.0.1.202', SIG.req],
];

export const SERVERS: Record<string, ServerDef> = Object.fromEntries(
  DEFS.map(([id, ip, color]) => [id, { id, name: `cache-${id}`, ip, addr: `${ip}:11211`, color }]),
);
export const SERVER_IDS = DEFS.map((d) => d[0]);

/*
 * The keys. The first 20 are the cached users in chapter 1 (hash mod 4 → 5
 * moves exactly 16 of them). The last six arrive one by one as questions.
 */
export const KEY_NAMES = [
  'alice', 'bob', 'carol', 'dave', 'abby', 'joe', 'ivan', 'eli', 'rob', 'anna',
  'sara', 'oscar', 'mia', 'will', 'mike', 'noah', 'reed', 'wade', 'seth', 'nora',
  'adam', 'lou', 'cole', 'jane', 'sean', 'opal',
];
export const keyString = (name: string) => `user:${name}`;
export const keyHash = (name: string) => hashOf(keyString(name));

/** Token i of a server: hash("ip:port") for the first, hash("ip:port#i") for the rest. */
export const tokenName = (sid: string, i: number) => (i === 0 ? SERVERS[sid].addr : `${SERVERS[sid].addr}#${i}`);
export const tokenHash = (sid: string, i: number) => hashOf(tokenName(sid, i));

/* ------------------------------------------------------------------ */
/* The ring                                                            */
/* ------------------------------------------------------------------ */

export interface Token {
  h: number;
  sid: string;
  i: number;
}

/** Sorted list of every token of every server: this array IS the ring. */
export function buildRing(counts: Map<string, number>): Token[] {
  const out: Token[] = [];
  for (const [sid, n] of counts) for (let i = 0; i < n; i++) out.push({ h: tokenHash(sid, i), sid, i });
  out.sort((a, b) => a.h - b.h || (a.sid < b.sid ? -1 : 1));
  return out;
}

/** Index of the first token at or after h (clockwise), wrapping to 0. Binary search. */
export function lookupIndex(ring: Token[], h: number): number {
  let lo = 0;
  let hi = ring.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ring[mid].h < h) lo = mid + 1;
    else hi = mid;
  }
  return lo === ring.length ? 0 : lo;
}

export function ownerOf(ring: Token[], h: number): string | null {
  return ring.length ? ring[lookupIndex(ring, h)].sid : null;
}

/** The token a key walks to (for drawing its line). */
export function ownerToken(ring: Token[], h: number): Token | null {
  return ring.length ? ring[lookupIndex(ring, h)] : null;
}

export interface PrefStep {
  token: Token;
  /** Already holds a copy: skipped so every copy lands on a different machine */
  skip: boolean;
}

/**
 * Walk clockwise from h collecting distinct servers until we have r of them
 * (Dynamo's preference list). Also returns every token passed, so the stage
 * can show the skipped ones.
 */
export function preferenceWalk(ring: Token[], h: number, r: number): { list: Token[]; steps: PrefStep[] } {
  const list: Token[] = [];
  const steps: PrefStep[] = [];
  if (!ring.length) return { list, steps };
  const distinct = new Set(ring.map((t) => t.sid)).size;
  const want = Math.min(r, distinct);
  const seen = new Set<string>();
  const start = lookupIndex(ring, h);
  for (let k = 0; k < ring.length && list.length < want; k++) {
    const t = ring[(start + k) % ring.length];
    const skip = seen.has(t.sid);
    steps.push({ token: t, skip });
    if (!skip) {
      seen.add(t.sid);
      list.push(t);
    }
  }
  return { list, steps };
}

/** Fraction of the ring (so, of all keys on average) each server owns. */
export function ringShares(ring: Token[]): Map<string, number> {
  const out = new Map<string, number>();
  if (!ring.length) return out;
  for (let i = 0; i < ring.length; i++) {
    const prev = ring[(i - 1 + ring.length) % ring.length].h;
    let len = ring[i].h - prev;
    if (len <= 0) len += TWO32;
    if (ring.length === 1) len = TWO32;
    out.set(ring[i].sid, (out.get(ring[i].sid) ?? 0) + len / TWO32);
  }
  return out;
}

export interface Interval {
  /** Start and end as fractions of the ring, a < b, never wrapping */
  a: number;
  b: number;
  sid: string;
}

/** Owned arcs as non-wrapping intervals [a, b) in fractions of the ring. */
export function ownership(ring: Token[]): Interval[] {
  if (!ring.length) return [];
  const out: Interval[] = [];
  const first = ring[0];
  // Keys from 0 up to the first token belong to the first token (the wrap).
  if (first.h > 0) out.push({ a: 0, b: first.h / TWO32, sid: first.sid });
  for (let i = 1; i < ring.length; i++) out.push({ a: ring[i - 1].h / TWO32, b: ring[i].h / TWO32, sid: ring[i].sid });
  const last = ring[ring.length - 1];
  if (last.h < TWO32) out.push({ a: last.h / TWO32, b: 1, sid: first.sid });
  // Merge neighbours with the same owner so drawing stays cheap.
  const merged: Interval[] = [];
  for (const iv of out) {
    const m = merged[merged.length - 1];
    if (m && m.sid === iv.sid && Math.abs(m.b - iv.a) < 1e-12) m.b = iv.b;
    else if (iv.b > iv.a) merged.push({ ...iv });
  }
  return merged;
}

export interface Change {
  a: number;
  b: number;
  from: string;
  to: string;
}

/** Stretches of the ring whose owner changed between two versions. */
export function diffOwnership(before: Token[], after: Token[]): Change[] {
  const A = ownership(before);
  const B = ownership(after);
  const out: Change[] = [];
  if (!A.length || !B.length) return out;
  // Both lists tile [0, 1) in order, so one merge pass finds every difference.
  let i = 0;
  let j = 0;
  let x = 0;
  while (i < A.length && j < B.length && x < 1 - 1e-12) {
    const end = Math.min(A[i].b, B[j].b);
    if (end - x > 1e-12 && A[i].sid !== B[j].sid) {
      const prev = out[out.length - 1];
      if (prev && prev.from === A[i].sid && prev.to === B[j].sid && Math.abs(prev.b - x) < 1e-12) prev.b = end;
      else out.push({ a: x, b: end, from: A[i].sid, to: B[j].sid });
    }
    x = end;
    if (A[i].b <= x + 1e-12) i++;
    if (B[j].b <= x + 1e-12) j++;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* hash mod N, the baseline                                            */
/* ------------------------------------------------------------------ */

export const modOwner = (list: string[], h: number) => (list.length ? list[h % list.length] : null);

export interface ScaleMoves {
  ring: number;
  mod: number;
  total: number;
  /** Where the ring's moved keys came from, and where they went */
  from: Map<string, number>;
  to: Map<string, number>;
}

/** Keys (of the 100,000) whose owner differs between two server sets. */
export function scaleMoves(ringBefore: Token[], ringAfter: Token[], listBefore: string[], listAfter: string[]): ScaleMoves {
  const keys = scaleKeyHashes();
  let ring = 0;
  let mod = 0;
  const from = new Map<string, number>();
  const to = new Map<string, number>();
  for (let i = 0; i < keys.length; i++) {
    const h = keys[i];
    const a = ownerOf(ringBefore, h);
    const b = ownerOf(ringAfter, h);
    if (a !== b) {
      ring++;
      if (a) from.set(a, (from.get(a) ?? 0) + 1);
      if (b) to.set(b, (to.get(b) ?? 0) + 1);
    }
    if (modOwner(listBefore, h) !== modOwner(listAfter, h)) mod++;
  }
  return { ring, mod, total: keys.length, from, to };
}

/** Fraction of the 100,000 keys that change server when mod N goes n → m. */
export function modMoveFraction(n: number, m: number) {
  const keys = scaleKeyHashes();
  let moved = 0;
  for (let i = 0; i < keys.length; i++) if (keys[i] % n !== keys[i] % m) moved++;
  return moved / keys.length;
}

/* ------------------------------------------------------------------ */
/* Rendezvous (highest random weight) hashing                          */
/* ------------------------------------------------------------------ */

export const hrwScore = (key: string, sid: string) => murmur3(`${key}|${SERVERS[sid].addr}`);

export function hrwWinner(key: string, sids: string[]): string | null {
  let best: string | null = null;
  let score = -1;
  for (const s of sids) {
    const v = hrwScore(key, s);
    if (v > score) {
      score = v;
      best = s;
    }
  }
  return best;
}
