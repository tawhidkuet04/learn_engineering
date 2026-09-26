import { DEFAULT_SEED, hashOf, indexOf, type HashKind } from './hashing';

/**
 * A plain hash table model (no animation). The sim animates the *plans* this
 * class produces, then applies them, so what you see is exactly what the
 * data structure does.
 */

export type Mode = 'chain' | 'probe';

/** Marks a deleted slot in open addressing. Keys are letters, so this can't clash. */
export const TOMB = '†';

export interface ProbeVisit {
  slot: number;
  /** What was in the slot when we looked */
  seen: string | null;
}

export interface PutPlan {
  home: number;
  /** Chaining: keys compared on the way down the chain. Probing: slots visited, in order. */
  visits: ProbeVisit[];
  /** Final slot (probing) or bucket (chaining) */
  at: number;
  /** Chain position the key ends up at (chaining) */
  depth: number;
  exists: boolean;
  full: boolean;
}

export interface GetPlan {
  home: number;
  visits: ProbeVisit[];
  found: boolean;
  at: number;
  depth: number;
}

export class Table {
  chains: string[][];
  slots: (string | null)[];
  /** Live keys in insertion order */
  order: string[] = [];
  /** Buckets drawn and searched as balanced trees (Java's defense) */
  trees = new Set<number>();

  constructor(
    public cap: number,
    public mode: Mode,
    public hash: HashKind,
    public seed = DEFAULT_SEED,
    public gen = 0,
  ) {
    this.chains = Array.from({ length: cap }, () => []);
    this.slots = Array.from({ length: cap }, () => null);
  }

  h(key: string) {
    return hashOf(this.hash, key, this.seed);
  }

  home(key: string) {
    return indexOf(this.hash, this.h(key), this.cap);
  }

  get count() {
    return this.order.length;
  }

  get load() {
    return this.order.length / this.cap;
  }

  has(key: string) {
    return this.order.includes(key);
  }

  tombstones() {
    return this.mode === 'probe' ? this.slots.filter((s) => s === TOMB).length : 0;
  }

  /* ---------------- plans ---------------- */

  planPut(key: string): PutPlan {
    const home = this.home(key);
    if (this.mode === 'chain') {
      const chain = this.chains[home];
      const visits: ProbeVisit[] = [];
      for (let d = 0; d < chain.length; d++) {
        visits.push({ slot: home, seen: chain[d] });
        if (chain[d] === key) return { home, visits, at: home, depth: d, exists: true, full: false };
      }
      return { home, visits, at: home, depth: chain.length, exists: false, full: false };
    }
    const visits: ProbeVisit[] = [];
    let firstTomb = -1;
    for (let n = 0; n < this.cap; n++) {
      const i = (home + n) % this.cap;
      const s = this.slots[i];
      visits.push({ slot: i, seen: s });
      if (s === null) return { home, visits, at: firstTomb >= 0 ? firstTomb : i, depth: 0, exists: false, full: false };
      if (s === TOMB) {
        if (firstTomb < 0) firstTomb = i;
        continue;
      }
      if (s === key) return { home, visits, at: i, depth: 0, exists: true, full: false };
    }
    if (firstTomb >= 0) return { home, visits, at: firstTomb, depth: 0, exists: false, full: false };
    return { home, visits, at: -1, depth: 0, exists: false, full: true };
  }

  /** Lookups step over tombstones and stop at the first truly empty slot. */
  planGet(key: string): GetPlan {
    const home = this.home(key);
    if (this.mode === 'chain') {
      if (this.trees.has(home)) {
        const path = this.treePath(home, key);
        const found = path.length > 0 && path[path.length - 1] === key;
        return { home, visits: path.map((k) => ({ slot: home, seen: k })), found, at: home, depth: found ? this.chains[home].indexOf(key) : -1 };
      }
      const chain = this.chains[home];
      const visits: ProbeVisit[] = [];
      for (let d = 0; d < chain.length; d++) {
        visits.push({ slot: home, seen: chain[d] });
        if (chain[d] === key) return { home, visits, found: true, at: home, depth: d };
      }
      return { home, visits, found: false, at: home, depth: -1 };
    }
    const visits: ProbeVisit[] = [];
    for (let n = 0; n < this.cap; n++) {
      const i = (home + n) % this.cap;
      const s = this.slots[i];
      visits.push({ slot: i, seen: s });
      if (s === null) return { home, visits, found: false, at: i, depth: 0 };
      if (s === key) return { home, visits, found: true, at: i, depth: 0 };
    }
    return { home, visits, found: false, at: -1, depth: 0 };
  }

  /* ---------------- mutations ---------------- */

  applyPut(key: string, plan: PutPlan) {
    if (plan.exists || plan.full) return;
    if (this.mode === 'chain') this.chains[plan.at].push(key);
    else this.slots[plan.at] = key;
    this.order.push(key);
  }

  /** Insert without animation. Returns false if the table is full. */
  put(key: string) {
    const plan = this.planPut(key);
    this.applyPut(key, plan);
    return !plan.full;
  }

  /** Remove a key. With `tomb`, open addressing leaves a tombstone behind. */
  remove(key: string, tomb = true) {
    if (!this.has(key)) return false;
    this.order = this.order.filter((k) => k !== key);
    if (this.mode === 'chain') {
      for (const c of this.chains) {
        const i = c.indexOf(key);
        if (i >= 0) c.splice(i, 1);
      }
      return true;
    }
    const i = this.slots.indexOf(key);
    if (i >= 0) this.slots[i] = tomb ? TOMB : null;
    return true;
  }

  /** Where a key currently lives. */
  locate(key: string): { at: number; depth: number } | null {
    if (this.mode === 'chain') {
      for (let b = 0; b < this.cap; b++) {
        const d = this.chains[b].indexOf(key);
        if (d >= 0) return { at: b, depth: d };
      }
      return null;
    }
    const i = this.slots.indexOf(key);
    return i >= 0 ? { at: i, depth: 0 } : null;
  }

  /** Live keys in storage order (bucket by bucket), the order a resize walks them. */
  storageOrder(): string[] {
    if (this.mode === 'chain') return this.chains.flat();
    return this.slots.filter((s): s is string => s !== null && s !== TOMB);
  }

  /* ---------------- trees (Java's treeified bins) ---------------- */

  /** Keys of a bucket sorted the way Java orders a tree bin: by hash, then by key. */
  treeOrder(b: number): string[] {
    return [...this.chains[b]].sort((a, c) => this.h(a) - this.h(c) || (a < c ? -1 : a > c ? 1 : 0));
  }

  /** Balanced-tree shape for a bucket: in-order index and depth for each key. */
  treeShape(b: number): Map<string, { order: number; level: number; parent: string | null }> {
    const sorted = this.treeOrder(b);
    const out = new Map<string, { order: number; level: number; parent: string | null }>();
    const build = (lo: number, hi: number, level: number, parent: string | null) => {
      if (lo > hi) return;
      const mid = Math.floor((lo + hi + 1) / 2);
      out.set(sorted[mid], { order: mid, level, parent });
      build(lo, mid - 1, level + 1, sorted[mid]);
      build(mid + 1, hi, level + 1, sorted[mid]);
    };
    build(0, sorted.length - 1, 0, null);
    return out;
  }

  /** Keys compared while searching a tree bucket, root first. */
  treePath(b: number, key: string): string[] {
    const sorted = this.treeOrder(b);
    const path: string[] = [];
    let lo = 0;
    let hi = sorted.length - 1;
    const hk = this.h(key);
    while (lo <= hi) {
      const mid = Math.floor((lo + hi + 1) / 2);
      const k = sorted[mid];
      path.push(k);
      if (k === key) break;
      const hm = this.h(k);
      const less = hk < hm || (hk === hm && key < k);
      if (less) hi = mid - 1;
      else lo = mid + 1;
    }
    return path;
  }

  /* ---------------- stats ---------------- */

  /** Average key comparisons to find each stored key. */
  avgHit(): number {
    if (!this.order.length) return 0;
    let sum = 0;
    for (const k of this.order) sum += this.planGet(k).visits.filter((v) => v.seen !== null && v.seen !== TOMB).length;
    return sum / this.order.length;
  }

  /** Average key comparisons to learn a key is missing, over every home bucket. */
  avgMiss(): number {
    let sum = 0;
    for (let b = 0; b < this.cap; b++) {
      if (this.mode === 'chain') {
        sum += this.chains[b].length;
        continue;
      }
      let c = 0;
      for (let n = 0; n < this.cap; n++) {
        const s = this.slots[(b + n) % this.cap];
        if (s === null) break;
        if (s !== TOMB) c++;
      }
      sum += c;
    }
    return sum / this.cap;
  }

  longestChain(): number {
    if (this.mode === 'chain') return Math.max(0, ...this.chains.map((c) => c.length));
    return this.longestRun();
  }

  /** Longest run of occupied slots (a cluster), counting wrap-around. */
  longestRun(): number {
    if (this.mode !== 'probe') return 0;
    let best = 0;
    for (let s = 0; s < this.cap; s++) {
      let n = 0;
      while (n < this.cap && this.slots[(s + n) % this.cap] !== null) n++;
      best = Math.max(best, n);
    }
    return best;
  }

  /** Buckets holding at least one key */
  usedBuckets(): number {
    if (this.mode === 'chain') return this.chains.filter((c) => c.length).length;
    return this.slots.filter((s) => s !== null && s !== TOMB).length;
  }
}
