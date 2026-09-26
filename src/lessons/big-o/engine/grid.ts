import { mulberry32 } from '@/lib/sim/rng';
import type { BigOSim } from '../sim';

/* O(n²): the nested-loop duplicate check. Every cell (i, j) with j > i is one
   comparison; the grid fills row by row at a fixed pace, so doubling n
   visibly quadruples the time. */

export const GRID_STEP = 0.085;

export class GridEngine {
  n = 12;
  vals: number[] = [];
  pairs: [number, number][] = [];
  /** Comparisons done */
  k = 0;
  state: 'run' | 'done' = 'run';
  lastVt = -10;
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

  reset(n: number) {
    this.gen++;
    this.setup(n);
  }

  setN(n: number) {
    if (n === this.n && this.state === 'run') return;
    this.gen++;
    this.setup(n);
  }

  get total() {
    return this.pairs.length;
  }

  /** The pair being compared right now */
  get cur(): [number, number] | null {
    return this.state === 'run' && this.k > 0 ? this.pairs[this.k - 1] : null;
  }

  private setup(n: number) {
    this.n = n;
    const rng = mulberry32(300 + n);
    const pool = Array.from({ length: 89 }, (_, i) => i + 10);
    this.vals = Array.from({ length: n }, () => pool.splice(Math.floor(rng() * pool.length), 1)[0]);
    this.pairs = [];
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) this.pairs.push([i, j]);
    this.k = 0;
    this.state = 'run';
    this.t = 0;
    this.nextAt = 0.6;
    this.sim.rev++;
  }

  update(dt: number) {
    this.t += dt;
    if (this.state !== 'run' || this.t < this.nextAt) return;
    this.nextAt = this.t + GRID_STEP;
    this.k++;
    this.lastVt = this.sim.vt;
    if (this.k >= this.total) {
      this.state = 'done';
      this.later(3, () => this.setup(this.n));
    }
    this.sim.rev++;
  }
}
