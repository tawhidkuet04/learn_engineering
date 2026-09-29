/**
 * The cache itself: a fixed number of slots, a TTL per key, and an eviction
 * policy. Pure data, no drawing, so the same code drives the live stage and
 * the offline "hit ratio vs cache size" curves.
 */

export type Policy = 'lru' | 'lfu' | 'fifo';

export const POLICY_NAMES: Record<Policy, string> = { lru: 'LRU', lfu: 'LFU', fifo: 'FIFO' };

export interface Entry {
  key: number;
  price: number;
  /** Simulated time the key was written (FIFO order) */
  insertedAt: number;
  /** Last read or write (LRU order) */
  lastUsed: number;
  /** Reads since it was cached (LFU order) */
  freq: number;
  /** TTL it was set with, seconds; 0 = never expires */
  ttl: number;
  expiresAt: number;
  /** Write-back: written to the cache but not yet to the database */
  dirty: boolean;
  /** Which version of the row this copy holds (every committed write bumps it) */
  version: number;
  seq: number;
  /** Fixed position in memory (0..capacity-1), for drawing rows that don't reorder */
  slot: number;
  /* ---- visuals, eased by the sim ---- */
  /** Row position, in rows (animated toward the entry's rank) */
  ry: number;
  alpha: number;
  flash: { kind: 'hit' | 'set' | 'refresh'; vt: number } | null;
}

export type GoneKind = 'evict' | 'expire' | 'del' | 'lost';

/** A row on its way out, drawn fading where it was. */
export interface Ghost {
  key: number;
  price: number;
  ry: number;
  kind: GoneKind;
  vt: number;
  dirty: boolean;
}

export class Cache {
  entries = new Map<number, Entry>();
  capacity: number;
  policy: Policy;
  private seq = 0;

  constructor(capacity: number, policy: Policy) {
    this.capacity = capacity;
    this.policy = policy;
  }

  get size() {
    return this.entries.size;
  }

  has(key: number, now: number) {
    const e = this.entries.get(key);
    return !!e && e.expiresAt > now;
  }

  peek(key: number): Entry | undefined {
    return this.entries.get(key);
  }

  /** A read: returns the entry (and records the use) or null on a miss. */
  get(key: number, now: number): Entry | null {
    const e = this.entries.get(key);
    if (!e || e.expiresAt <= now) return null;
    e.lastUsed = now;
    e.freq += 1;
    return e;
  }

  /** The key this policy would throw out next. */
  victim(): Entry | null {
    let v: Entry | null = null;
    for (const e of this.entries.values()) {
      if (!v || worse(e, v, this.policy)) v = e;
    }
    return v;
  }

  /**
   * Write a key. If it's new and the cache is full, evict first (or evict
   * `force`, when the caller already decided which key goes).
   */
  set(key: number, price: number, now: number, ttl: number, opts: { dirty?: boolean; force?: number | null; version?: number } = {}): { entry: Entry; evicted: Entry | null } {
    const cur = this.entries.get(key);
    if (cur) {
      cur.price = price;
      if (opts.version != null) cur.version = opts.version;
      cur.lastUsed = now;
      cur.ttl = ttl;
      cur.expiresAt = ttl > 0 ? now + ttl : Infinity;
      cur.dirty = !!opts.dirty;
      return { entry: cur, evicted: null };
    }
    let evicted: Entry | null = null;
    if (this.entries.size >= this.capacity) {
      const forced = opts.force != null ? this.entries.get(opts.force) : undefined;
      evicted = forced ?? this.victim();
      if (evicted) this.entries.delete(evicted.key);
    }
    const entry: Entry = {
      key,
      price,
      insertedAt: now,
      lastUsed: now,
      freq: 1,
      ttl,
      expiresAt: ttl > 0 ? now + ttl : Infinity,
      dirty: !!opts.dirty,
      version: opts.version ?? 0,
      seq: ++this.seq,
      slot: this.freeSlot(),
      ry: 0,
      alpha: 0,
      flash: null,
    };
    this.entries.set(key, entry);
    return { entry, evicted };
  }

  /** Lowest memory slot not in use. */
  private freeSlot(): number {
    const used = new Set([...this.entries.values()].map((e) => e.slot));
    let i = 0;
    while (used.has(i)) i += 1;
    return i;
  }

  del(key: number): Entry | null {
    const e = this.entries.get(key);
    if (!e) return null;
    this.entries.delete(key);
    return e;
  }

  /** Remove every expired key and return them. */
  expire(now: number): Entry[] {
    const out: Entry[] = [];
    for (const e of this.entries.values()) if (e.expiresAt <= now) out.push(e);
    for (const e of out) this.entries.delete(e.key);
    return out;
  }

  clear(): Entry[] {
    const all = [...this.entries.values()];
    this.entries.clear();
    return all;
  }

  /** Shrink to a new capacity, evicting by policy. */
  resize(capacity: number): Entry[] {
    this.capacity = capacity;
    const out: Entry[] = [];
    while (this.entries.size > capacity) {
      const v = this.victim();
      if (!v) break;
      this.entries.delete(v.key);
      out.push(v);
    }
    // Keep every survivor inside the smaller memory.
    for (const e of this.entries.values()) {
      if (e.slot >= capacity) {
        e.slot = -1;
        e.slot = this.freeSlot();
      }
    }
    return out;
  }

  /** Display order: the next victim is always last. */
  ordered(): Entry[] {
    return [...this.entries.values()].sort((a, b) => (worse(a, b, this.policy) ? 1 : worse(b, a, this.policy) ? -1 : 0));
  }
}

/** Is `a` a better eviction candidate than `b` under this policy? */
function worse(a: Entry, b: Entry, policy: Policy): boolean {
  if (policy === 'fifo') return a.seq < b.seq;
  if (policy === 'lfu') return a.freq < b.freq || (a.freq === b.freq && (a.lastUsed < b.lastUsed || (a.lastUsed === b.lastUsed && a.seq < b.seq)));
  return a.lastUsed < b.lastUsed || (a.lastUsed === b.lastUsed && a.seq < b.seq);
}

/* ------------------------------------------------------------------ */
/* Workload: a few products get most of the reads (Zipf-like)          */
/* ------------------------------------------------------------------ */

/** Probability of each popularity rank (0 = most popular). */
export function zipfWeights(n: number, s: number): number[] {
  const w = Array.from({ length: n }, (_, i) => 1 / Math.pow(i + 1, s));
  const sum = w.reduce((a, b) => a + b, 0);
  return w.map((x) => x / sum);
}

export function sampleRank(weights: number[], r: number): number {
  let x = r;
  for (let i = 0; i < weights.length; i++) {
    x -= weights[i];
    if (x <= 0) return i;
  }
  return weights.length - 1;
}

/** Seeded PRNG (same as the kit's) so offline curves are reproducible. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The synthetic read trace behind the long-run numbers: `n` reads, each a
 * popularity rank (0 = most popular), drawn from the Zipf weights.
 */
export function zipfTrace(keys: number, skew: number, n = 12000, seed = 7): number[] {
  const w = zipfWeights(keys, skew);
  const rnd = mulberry32(seed);
  return Array.from({ length: n }, () => sampleRank(w, rnd()));
}

/** Reads skipped before counting hits, so a cold cache doesn't drag the long-run ratio down. */
export const WARMUP_SHARE = 0.15;

/**
 * Long-run hit ratio of a policy on the Zipf workload, measured by running
 * the real Cache over a long synthetic trace (after a warm-up).
 */
export function longRunHitRatio(policy: Policy, size: number, keys: number, skew: number, n = 12000, seed = 7): number {
  const trace = zipfTrace(keys, skew, n, seed);
  const c = new Cache(size, policy);
  const warm = Math.floor(n * WARMUP_SHARE);
  let hits = 0;
  let count = 0;
  for (let i = 0; i < n; i++) {
    const k = trace[i];
    const hit = c.get(k, i) != null;
    if (!hit) c.set(k, 0, i, 0);
    if (i >= warm) {
      count += 1;
      if (hit) hits += 1;
    }
  }
  return count ? hits / count : 0;
}
