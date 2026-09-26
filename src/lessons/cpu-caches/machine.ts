import { mulberry32 } from '@/lib/sim/rng';
import { NS_HIT, NS_MISS, PER_LINE } from './model';

/**
 * A toy L1 data cache in front of an array in RAM.
 *
 * - Fully associative, least-recently-used replacement (real L1s are 8–12
 *   way set-associative; the difference doesn't matter for these patterns).
 * - Whole 64-byte lines move, 8 elements of 8 bytes each.
 * - Optional next-line stream prefetcher: after two consecutive lines it
 *   requests the next `pfDist` lines in the background.
 *
 * The machine is pure logic. The sim decides when things start and how long
 * they take (in simulated seconds) and draws them.
 */

export type Order = 'row' | 'col' | 'tile' | 'random' | 'reuse' | 'quiz' | 'colquiz';

export interface Pace {
  /** Simulated seconds an L1 hit takes on screen */
  hit: number;
  /** Simulated seconds a full trip to RAM takes on screen */
  miss: number;
}

export interface SlotState {
  line: number;
  lastUse: number;
  /** Visual time the line arrived */
  vt: number;
  /** Brought in by the prefetcher and not used yet */
  pf: boolean;
  /** Bitmask of the 8 elements read since it arrived */
  used: number;
}

/** A line on its way from RAM into a slot. */
export interface Fill {
  line: number;
  slot: number;
  t0: number;
  t1: number;
  pf: boolean;
}

export interface Op {
  kind: 'hit' | 'miss' | 'wait';
  e: number;
  line: number;
  slot: number;
  t0: number;
  t1: number;
  ns: number;
}

export interface Evicted {
  line: number;
  slot: number;
  vt: number;
}

export interface PassResult {
  order: Order;
  ways: number;
  prefetch: boolean;
  hits: number;
  misses: number;
  waits: number;
  ns: number;
  n: number;
}

/* Chapter 3's quiz: [element, ask?]. Walk through it with a 4-line LRU cache. */
const QUIZ: [number, boolean][] = [
  [0, false],
  [1, false],
  [2, false],
  [5, true], // hit: same line as a[0..2]
  [8, true], // miss: first touch of a[8..15]
  [9, false],
  [3, true], // hit: line a[0..7] is still cached
  [40, true], // miss
  [41, false],
  [64, true], // miss, and now the cache is full
  [65, false],
  [100, true], // miss: evicts the least recently used line, a[8..15]
  [10, true], // miss: a[8..15] was just evicted
  [4, true], // miss: a[0..7] went out to make room for a[8..15]
  [70, true], // hit: a[64..71] survived
  [71, false],
];

export const TILE_ROWS = 4;

export class Machine {
  rows = 8;
  cols = 16;
  ways = 4;
  order: Order = 'row';
  prefetch = false;
  pfDist = 2;

  slots: (SlotState | null)[] = [];
  fills: Fill[] = [];
  seq: number[] = [];
  asks = new Set<number>();
  pos = 0;
  cur: Op | null = null;
  lastOp: Op | null = null;
  useCount = 0;
  visited = new Uint8Array(0);
  lastLine = -10;
  streak = 0;

  hits = 0;
  misses = 0;
  waits = 0;
  ns = 0;
  prefetches = 0;
  pfUsed = 0;
  evicted: Evicted[] = [];
  finished = false;
  finishedT = 0;
  passes = 0;
  lastPass: PassResult | null = null;
  private seed = 7;

  constructor(public readonly id: 'a' | 'b') {}

  get n() {
    return this.rows * this.cols;
  }

  get numLines() {
    return this.n / PER_LINE;
  }

  get accesses() {
    return this.hits + this.misses + this.waits;
  }

  lineOf(e: number) {
    return Math.floor(e / PER_LINE);
  }

  configure(o: { order: Order; ways: number; prefetch: boolean }) {
    this.order = o.order;
    this.ways = Math.max(1, Math.round(o.ways));
    this.prefetch = o.prefetch;
    this.pfDist = Math.max(1, Math.min(2, this.ways - 2));
    this.passes = 0;
    this.lastPass = null;
    this.reset();
  }

  /** Start a fresh pass: cold cache, zeroed counters, new access order. */
  reset() {
    this.slots = Array.from({ length: this.ways }, () => null);
    this.fills = [];
    this.pos = 0;
    this.cur = null;
    this.lastOp = null;
    this.useCount = 0;
    this.visited = new Uint8Array(this.n);
    this.lastLine = -10;
    this.streak = 0;
    this.hits = 0;
    this.misses = 0;
    this.waits = 0;
    this.ns = 0;
    this.prefetches = 0;
    this.pfUsed = 0;
    this.evicted = [];
    this.finished = false;
    this.finishedT = 0;
    this.buildSeq();
  }

  private buildSeq() {
    const { rows, cols } = this;
    const out: number[] = [];
    this.asks = new Set();
    const rng = mulberry32(this.seed++);
    switch (this.order) {
      case 'row':
        for (let e = 0; e < this.n; e++) out.push(e);
        break;
      case 'col':
      case 'colquiz':
        for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) out.push(r * cols + c);
        if (this.order === 'colquiz') for (let i = 1; i < out.length; i++) if (i % rows <= 1) this.asks.add(i);
        break;
      case 'tile':
        for (let r0 = 0; r0 < rows; r0 += TILE_ROWS)
          for (let c = 0; c < cols; c++) for (let r = r0; r < Math.min(rows, r0 + TILE_ROWS); r++) out.push(r * cols + c);
        break;
      case 'random':
        for (let i = 0; i < this.n; i++) out.push(Math.floor(rng() * this.n));
        break;
      case 'reuse': {
        // A hot set: four values in four different lines, read over and over.
        const hot = [3, 42, 77, 110];
        for (let i = 0; i < this.n; i++) out.push(hot[i % 4]);
        break;
      }
      case 'quiz': {
        QUIZ.forEach(([e, ask], i) => {
          out.push(e);
          if (ask) this.asks.add(i);
        });
        // Then keep going: short runs inside a line, then a jump, sometimes back to a recent line.
        const recent: number[] = [];
        let line = this.lineOf(QUIZ[QUIZ.length - 1][0]);
        while (out.length < 220) {
          const back = recent.length > 0 && rng() < 0.45;
          const next = back ? recent[Math.floor(rng() * Math.min(recent.length, 3))] : Math.floor(rng() * this.numLines);
          if (next === line) continue;
          line = next;
          recent.unshift(line);
          if (recent.length > 6) recent.pop();
          this.asks.add(out.length);
          const run = 1 + Math.floor(rng() * 3);
          const start = Math.floor(rng() * (PER_LINE - run + 1));
          for (let k = 0; k < run; k++) out.push(line * PER_LINE + start + k);
        }
        break;
      }
    }
    this.seq = out;
    this.visited = new Uint8Array(this.n);
  }

  /** Next element to access, or null when the pass is over. */
  peek(): number | null {
    return this.pos < this.seq.length ? this.seq[this.pos] : null;
  }

  shouldAsk() {
    return this.asks.has(this.pos);
  }

  find(line: number) {
    return this.slots.findIndex((s) => s?.line === line);
  }

  pendingFill(line: number) {
    return this.fills.find((f) => f.line === line) ?? null;
  }

  /** Would the next access hit? (Used to grade predictions.) */
  wouldHit(e: number) {
    return this.find(this.lineOf(e)) >= 0;
  }

  /** Slot to replace: an empty one first, else the least recently used (never one being filled or `protect`). */
  victim(protect = -1): number {
    const reserved = new Set(this.fills.map((f) => f.slot));
    for (let i = 0; i < this.ways; i++) if (!this.slots[i] && !reserved.has(i)) return i;
    let best = -1;
    let bu = Infinity;
    for (let i = 0; i < this.ways; i++) {
      const s = this.slots[i];
      if (!s || reserved.has(i) || s.line === protect) continue;
      if (s.lastUse < bu) {
        bu = s.lastUse;
        best = i;
      }
    }
    return best;
  }

  /** The slot that will be evicted next, if the cache is full. */
  nextOut(): number {
    if (this.slots.some((s) => !s)) return -1;
    return this.victim();
  }

  /** Begin the next access at simulated time t. */
  begin(t: number, p: Pace): Op | null {
    const e = this.peek();
    if (e == null) return null;
    const line = this.lineOf(e);
    const s = this.find(line);
    let op: Op;
    if (s >= 0) {
      op = { kind: 'hit', e, line, slot: s, t0: t, t1: t + p.hit, ns: NS_HIT };
    } else {
      const f = this.pendingFill(line);
      if (f) {
        const remain = Math.max(0, f.t1 - t);
        const ns = Math.max(NS_HIT, (remain / p.miss) * NS_MISS);
        op = { kind: remain > p.hit ? 'wait' : 'hit', e, line, slot: f.slot, t0: t, t1: t + Math.max(remain, p.hit), ns };
      } else {
        const v = this.victim();
        this.fills.push({ line, slot: v, t0: t, t1: t + p.miss, pf: false });
        op = { kind: 'miss', e, line, slot: v, t0: t, t1: t + p.miss, ns: NS_MISS };
      }
    }
    this.streamCheck(line, t, p);
    this.cur = op;
    return op;
  }

  /** Next-line stream prefetcher. */
  private streamCheck(line: number, t: number, p: Pace) {
    if (line !== this.lastLine) {
      this.streak = line === this.lastLine + 1 ? this.streak + 1 : 0;
      this.lastLine = line;
    }
    if (!this.prefetch || this.streak < 1) return;
    for (let d = 1; d <= this.pfDist; d++) {
      const l = line + d;
      if (l >= this.numLines) break;
      if (this.find(l) >= 0 || this.pendingFill(l)) continue;
      const v = this.victim(line);
      if (v < 0) break;
      this.fills.push({ line: l, slot: v, t0: t, t1: t + p.miss, pf: true });
      this.prefetches++;
    }
  }

  /** Install every line that has arrived by time t. Returns true if anything changed. */
  arrive(t: number, vt: number): boolean {
    let changed = false;
    for (const f of [...this.fills].sort((a, b) => a.t1 - b.t1)) {
      if (f.t1 > t) continue;
      const old = this.slots[f.slot];
      if (old) {
        this.evicted.push({ line: old.line, slot: f.slot, vt });
        if (this.evicted.length > 12) this.evicted.shift();
      }
      this.slots[f.slot] = { line: f.line, lastUse: ++this.useCount, vt, pf: f.pf, used: 0 };
      this.fills = this.fills.filter((x) => x !== f);
      changed = true;
    }
    return changed;
  }

  /** Finish the current access (its line is in the cache now). */
  complete(t: number, vt: number): Op | null {
    const op = this.cur;
    if (!op) return null;
    this.arrive(Math.max(t, op.t1), vt);
    const s = this.find(op.line);
    if (s >= 0) {
      const slot = this.slots[s]!;
      slot.lastUse = ++this.useCount;
      slot.used |= 1 << (op.e % PER_LINE);
      if (slot.pf) {
        slot.pf = false;
        this.pfUsed++;
      }
    }
    if (op.kind === 'hit') this.hits++;
    else if (op.kind === 'miss') this.misses++;
    else this.waits++;
    this.ns += op.ns;
    this.visited[op.e] = 1;
    this.pos++;
    this.lastOp = op;
    this.cur = null;
    if (this.pos >= this.seq.length) {
      this.finished = true;
      this.finishedT = t;
      this.passes++;
      this.lastPass = {
        order: this.order,
        ways: this.ways,
        prefetch: this.prefetch,
        hits: this.hits,
        misses: this.misses,
        waits: this.waits,
        ns: this.ns,
        n: this.seq.length,
      };
    }
    return op;
  }
}
