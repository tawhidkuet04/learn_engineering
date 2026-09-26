/**
 * MurmurHash3, x86 32-bit variant (seed 0), the same function Cassandra's
 * partitioner family and many client libraries are built on. Keys here are
 * ASCII, so one UTF-16 code unit is one byte.
 *
 * Checked against the reference vectors: "hello" → 613153351,
 * "The quick brown fox jumps over the lazy dog" → 776992547.
 */
export function murmur3(key: string, seed = 0): number {
  let h = seed >>> 0;
  const len = key.length;
  const nblocks = len >> 2;
  const c1 = 0xcc9e2d51;
  const c2 = 0x1b873593;
  for (let i = 0; i < nblocks; i++) {
    const j = i * 4;
    let k = (key.charCodeAt(j) & 0xff) | ((key.charCodeAt(j + 1) & 0xff) << 8) | ((key.charCodeAt(j + 2) & 0xff) << 16) | ((key.charCodeAt(j + 3) & 0xff) << 24);
    k = Math.imul(k, c1);
    k = (k << 15) | (k >>> 17);
    k = Math.imul(k, c2);
    h ^= k;
    h = (h << 13) | (h >>> 19);
    h = (Math.imul(h, 5) + 0xe6546b64) | 0;
  }
  const tail = nblocks * 4;
  const rem = len & 3;
  let k = 0;
  if (rem >= 3) k ^= (key.charCodeAt(tail + 2) & 0xff) << 16;
  if (rem >= 2) k ^= (key.charCodeAt(tail + 1) & 0xff) << 8;
  if (rem >= 1) {
    k ^= key.charCodeAt(tail) & 0xff;
    k = Math.imul(k, c1);
    k = (k << 15) | (k >>> 17);
    k = Math.imul(k, c2);
    h ^= k;
  }
  h ^= len;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

export const TWO32 = 4294967296;

/** 1500882790 → "1,500,882,790" */
export const commas = (n: number) => Math.round(n).toLocaleString('en-US');

/** 1500882790 → "1.50B" */
export const billions = (n: number) => `${(n / 1e9).toFixed(2)}B`;

/** 0.349 → "34.9%" (or "35%" with digits = 0) */
export const pct = (f: number, digits = 1) => `${(f * 100).toFixed(digits)}%`;

const memo = new Map<string, number>();
/** Memoized murmur3 for strings we hash over and over (token names). */
export function hashOf(s: string): number {
  let h = memo.get(s);
  if (h === undefined) {
    h = murmur3(s);
    memo.set(s, h);
  }
  return h;
}

let scaleKeys: Uint32Array | null = null;
/** 100,000 synthetic keys ("key:0" … "key:99999") for the at-scale counts. */
export function scaleKeyHashes(): Uint32Array {
  if (!scaleKeys) {
    scaleKeys = new Uint32Array(100_000);
    for (let i = 0; i < scaleKeys.length; i++) scaleKeys[i] = murmur3(`key:${i}`);
  }
  return scaleKeys;
}
