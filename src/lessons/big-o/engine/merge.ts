import { mulberry32 } from '@/lib/sim/rng';
import type { BigOSim } from '../sim';

/* Merge sort as a tree: row 0 is the whole array, row L holds single items.
     split  rows appear top-down (log₂ n levels of halving)
     merge  rows fill bottom-up; every element moves once per level */

export type MergeMode = 'split' | 'merge';

export interface Pick {
  level: number;
  /** Index in row level + 1 */
  from: number;
  /** Index in row level */
  to: number;
  v: number;
}

export interface Flying {
  pick: Pick;
  /** Simulated time the token took off */
  t0: number;
}

export const FLY = 0.32;

function valuesFor(n: number) {
  const rng = mulberry32(100 + n);
  const pool = Array.from({ length: 89 }, (_, i) => i + 10);
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  return out;
}

export class MergeEngine {
  mode: MergeMode = 'split';
  n = 16;
  L = 4;
  vals: number[] = valuesFor(16);
  /* split */
  rowVt: number[] = [];
  /* merge */
  rows: (number | null)[][] = [];
  /** Cells of row ℓ + 1 already consumed by the merge into row ℓ */
  used: boolean[][] = [];
  picks: Pick[] = [];
  flying: Flying[] = [];
  moves = 0;
  levelMoves: number[] = [];
  level: number | null = null;
  doneVt = -10;
  private pi = 0;
  private t = 0;
  private nextAt = 0;
  private gen = 0;

  constructor(private sim: BigOSim) {}

  private later(delay: number, fn: () => void) {
    const g = this.gen;
    this.sim.after(delay, () => {
      if (g === this.gen) fn();
    });
  }

  reset(mode: MergeMode, n: number) {
    this.gen++;
    this.mode = mode;
    this.setup(n);
  }

  /** n = 4 / 8 / 16 toggle */
  setN(n: number) {
    if (n === this.n) return;
    this.gen++;
    this.setup(n);
  }

  private setup(n: number) {
    this.n = n;
    this.L = Math.round(Math.log2(n));
    this.vals = valuesFor(n);
    this.t = 0;
    this.doneVt = -10;
    this.flying = [];
    if (this.mode === 'split') this.startSplit();
    else this.startMerge();
    this.sim.rev++;
  }

  /* ---------------- split ---------------- */

  private startSplit() {
    this.rowVt = [];
    this.nextAt = 0.35;
  }

  get rowsShown() {
    return this.rowVt.length;
  }

  /* ---------------- merge ---------------- */

  private startMerge() {
    const { n, L } = this;
    // Full merge sort, recorded as a list of element moves.
    const final: number[][] = [];
    final[L] = [...this.vals];
    this.picks = [];
    for (let l = L - 1; l >= 0; l--) {
      const size = n >> l;
      const half = size >> 1;
      const child = final[l + 1];
      const row: number[] = new Array(n);
      for (let g = 0; g < 1 << l; g++) {
        const base = g * size;
        let i = 0;
        let j = 0;
        for (let k = 0; k < size; k++) {
          const takeA = j >= half || (i < half && child[base + i] <= child[base + half + j]);
          const from = takeA ? base + i++ : base + half + j++;
          row[base + k] = child[from];
          this.picks.push({ level: l, from, to: base + k, v: child[from] });
        }
      }
      final[l] = row;
    }
    this.rows = Array.from({ length: L + 1 }, (_, l) => (l === L ? [...this.vals] : new Array(n).fill(null)));
    this.used = Array.from({ length: L + 1 }, () => new Array(n).fill(false));
    this.levelMoves = new Array(L + 1).fill(0);
    this.moves = 0;
    this.pi = 0;
    this.level = null;
    this.nextAt = 0.9;
  }

  get pickDt() {
    return this.n >= 16 ? 0.17 : this.n >= 8 ? 0.26 : 0.36;
  }

  update(dt: number) {
    this.t += dt;
    if (this.mode === 'split') {
      if (this.rowVt.length <= this.L && this.t >= this.nextAt) {
        this.rowVt = [...this.rowVt, this.sim.vt];
        this.nextAt = this.t + 1.25;
        this.sim.rev++;
        if (this.rowVt.length > this.L) this.later(4.5, () => this.setup(this.n));
      }
      return;
    }
    // land tokens
    if (this.flying.length) {
      const keep: Flying[] = [];
      for (const f of this.flying) {
        if (this.sim.t - f.t0 >= FLY) {
          const { level, to, v } = f.pick;
          this.rows[level][to] = v;
          this.moves++;
          this.levelMoves[level]++;
          this.sim.rev++;
        } else keep.push(f);
      }
      this.flying = keep;
    }
    if (this.pi < this.picks.length && this.t >= this.nextAt) {
      const p = this.picks[this.pi++];
      if (this.level !== p.level) this.level = p.level;
      this.used[p.level + 1][p.from] = true;
      this.flying.push({ pick: p, t0: this.sim.t });
      const nxt = this.picks[this.pi];
      this.nextAt = this.t + this.pickDt + (nxt && nxt.level !== p.level ? 0.7 : 0);
      this.sim.rev++;
      if (this.pi >= this.picks.length) {
        this.later(FLY + 0.1, () => {
          this.doneVt = this.sim.vt;
          this.level = null;
          this.sim.rev++;
        });
        this.later(5.5, () => this.setup(this.n));
      }
    }
  }
}
