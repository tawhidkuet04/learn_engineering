/**
 * The hash functions used on stage. Everything here is pure and small so the
 * narration can quote exact numbers.
 *
 *  poly   h = h × 31 + code, character by character. This is exactly Java's
 *         String.hashCode() for the short keys we use (no 32-bit overflow).
 *  first  the character code of the first letter only: a deliberately lazy hash.
 *  keyed  a stand-in for SipHash: a seeded mixing function whose output can't
 *         be predicted without the secret. Not cryptographic, just scrambled.
 *  java   Java's HashMap: hashCode(), then h ^ (h >>> 16) to fold the high
 *         bits into the low ones; the index is h & (capacity − 1).
 */

export type HashKind = 'poly' | 'first' | 'keyed' | 'java';

export const MULT = 31;

/** One line of the machine's work: h = prev × 31 + code = next. */
export interface PolyStep {
  ch: string;
  code: number;
  prev: number;
  next: number;
}

export function polySteps(key: string): PolyStep[] {
  const out: PolyStep[] = [];
  let h = 0;
  for (const ch of key) {
    const code = ch.charCodeAt(0);
    const next = h * MULT + code;
    out.push({ ch, code, prev: h, next });
    h = next;
  }
  return out;
}

export function polyHash(key: string): number {
  let h = 0;
  for (const ch of key) h = h * MULT + ch.charCodeAt(0);
  return h;
}

/** Java's String.hashCode(): the same recurrence, wrapped to a signed 32-bit int. */
export function javaHashCode(key: string): number {
  let h = 0;
  for (const ch of key) h = (Math.imul(h, MULT) + ch.charCodeAt(0)) | 0;
  return h;
}

/** java.util.HashMap.hash(): h ^ (h >>> 16), as an unsigned value for display. */
export function javaSpread(key: string): number {
  const h = javaHashCode(key);
  return (h ^ (h >>> 16)) >>> 0;
}

export function firstLetterHash(key: string): number {
  return key.length ? key.charCodeAt(0) : 0;
}

/** Seeded FNV-1a with a murmur-style finalizer. Stands in for SipHash on stage. */
export function keyedHash(key: string, seed: number): number {
  let h = (2166136261 ^ seed) >>> 0;
  for (const ch of key) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  h ^= seed >>> 7;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

export const DEFAULT_SEED = 0x5eed1e55;

export function hashOf(kind: HashKind, key: string, seed = DEFAULT_SEED): number {
  switch (kind) {
    case 'first':
      return firstLetterHash(key);
    case 'keyed':
      return keyedHash(key, seed);
    case 'java':
      return javaSpread(key);
    default:
      return polyHash(key);
  }
}

/** Bucket index. Java uses a bit mask, which equals mod for power-of-two capacities. */
export function indexOf(kind: HashKind, h: number, cap: number): number {
  if (kind === 'java') return h & (cap - 1);
  return h % cap;
}

/** Group digits so big hashes stay readable: 92903040 → "92 903 040". */
export function fmt(n: number): string {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/** The attack keys: every mix of "Aa" and "BB" has the same String.hashCode(). */
export const ATTACK_KEYS = ['AaAaAa', 'AaAaBB', 'AaBBAa', 'AaBBBB', 'BBAaAa', 'BBAaBB', 'BBBBAa', 'BBBBBB'];

/** Fictional phone numbers (555-0100 to 555-0199 are reserved for fiction). */
const PHONE: Record<string, string> = {
  alice: '555-0142',
  bob: '555-0117',
  carol: '555-0163',
  dave: '555-0108',
  erin: '555-0191',
  frank: '555-0125',
  grace: '555-0137',
  heidi: '555-0184',
  ivan: '555-0156',
  judy: '555-0179',
  kim: '555-0113',
  leo: '555-0148',
  mia: '555-0131',
  nina: '555-0172',
  walt: '555-0166',
  xena: '555-0104',
  uma: '555-0195',
  zoe: '555-0120',
};

export function phoneOf(key: string): string {
  const p = PHONE[key];
  if (p) return p;
  const n = polyHash(key) % 100;
  return `555-01${n.toString().padStart(2, '0')}`;
}

/** Chance that k random keys in n buckets include at least one collision. */
export function birthday(k: number, n: number): number {
  if (k > n) return 1;
  let p = 1;
  for (let i = 0; i < k; i++) p *= (n - i) / n;
  return 1 - p;
}
