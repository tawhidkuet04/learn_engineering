import { mulberry32 } from '@/lib/sim/rng';
import type { BigOSim } from '../sim';

/* A pointer walks an array one cell per step.
     max     findMax: compare every element, keep the largest (count-the-steps)
     search  linear search for a target (includes / indexOf)
     cases   search on demand: best, average and worst case */

export type ScanMode = 'max' | 'search' | 'cases';
export type CaseKind = 'best' | 'avg' | 'worst';

/** The unsorted array the search steps use (16 distinct values). */
export const SEARCH_ARR = [17, 3, 88, 42, 9, 61, 25, 70, 5, 94, 33, 12, 58, 81, 46, 29];
const LOOP_TARGETS = [46, 50, 88];
const MISSING = 50;

export interface ScanRun {
  kind: CaseKind | 'run';
  target: number | null;
  steps: number;
  found: boolean;
  vt: number;
}

export class ScanEngine {
  mode: ScanMode = 'max';
  n = 8;
  arr: number[] = [];
  /** Index being compared right now (-1 before the first step) */
  i = -1;
  steps = 0;
  best = -Infinity;
  bestIdx = -1;
  target: number | null = null;
  foundIdx: number | null = null;
  state: 'idle' | 'run' | 'done' = 'idle';
  kind: CaseKind | null = null;
  /** One dot per finished findMax run: (n, steps) */
  dots: { n: number; steps: number; vt: number }[] = [];
  history: ScanRun[] = [];
  /** vt of the last comparison, for the flash */
  hitVt = -10;
  private sweep: number[] = [];
  private loopIdx = 0;
  private t = 0;
  private nextAt = 0;
  private gen = 0;
  private rng = mulberry32(7);
  private lastAvg = -1;

  constructor(private sim: BigOSim) {}

  private later(delay: number, fn: () => void) {
    const g = this.gen;
    this.sim.after(delay, () => {
      if (g === this.gen) fn();
    });
  }

  get stepDur() {
    return this.mode === 'max' ? 0.3 : 0.27;
  }

  reset(mode: ScanMode, n: number, sweep: boolean) {
    this.gen++;
    this.mode = mode;
    this.rng = mulberry32(7);
    this.dots = [];
    this.history = [];
    this.loopIdx = 0;
    this.lastAvg = -1;
    this.sweep = [];
    if (mode === 'max') {
      this.sweep = sweep ? [4, 8, 12, 16] : [];
      this.startMax(this.sweep.shift() ?? n);
    } else {
      this.n = SEARCH_ARR.length;
      this.arr = [...SEARCH_ARR];
      if (mode === 'search') this.startSearch(LOOP_TARGETS[0], null);
      else this.startSearch(MISSING, 'worst');
    }
  }

  /** The learner moved the size slider (count-the-steps). */
  setN(n: number) {
    if (this.mode !== 'max') return;
    this.gen++;
    this.sweep = [];
    this.startMax(n);
  }

  /** Best / average / worst case buttons. */
  runCase(kind: CaseKind) {
    if (this.mode === 'max') return;
    this.gen++;
    let target = MISSING;
    if (kind === 'best') target = this.arr[0];
    else if (kind === 'avg') {
      let idx = Math.floor(this.rng() * this.n);
      if (idx === this.lastAvg) idx = (idx + 5) % this.n;
      this.lastAvg = idx;
      target = this.arr[idx];
    }
    this.startSearch(target, kind);
  }

  private startMax(n: number) {
    this.n = n;
    this.arr = Array.from({ length: n }, () => 10 + Math.floor(this.rng() * 90));
    this.best = -Infinity;
    this.bestIdx = -1;
    this.target = null;
    this.foundIdx = null;
    this.kind = null;
    this.begin();
  }

  private startSearch(target: number, kind: CaseKind | null) {
    this.target = target;
    this.kind = kind;
    this.foundIdx = null;
    this.begin();
  }

  private begin() {
    this.i = -1;
    this.steps = 0;
    this.state = 'run';
    this.nextAt = this.t + 0.45;
    this.sim.rev++;
  }

  update(dt: number) {
    this.t += dt;
    if (this.state !== 'run' || this.t < this.nextAt) return;
    this.nextAt = this.t + this.stepDur;
    this.i++;
    this.steps++;
    this.hitVt = this.sim.vt;
    const v = this.arr[this.i];
    if (this.mode === 'max') {
      if (v > this.best) {
        this.best = v;
        this.bestIdx = this.i;
      }
      if (this.i >= this.n - 1) this.finish(true);
    } else if (v === this.target) {
      this.foundIdx = this.i;
      this.finish(true);
    } else if (this.i >= this.n - 1) {
      this.finish(false);
    }
    this.sim.rev++;
  }

  private finish(found: boolean) {
    this.state = 'done';
    if (this.mode === 'max') {
      this.dots = [...this.dots.filter((d) => d.n !== this.n), { n: this.n, steps: this.steps, vt: this.sim.vt }];
      const next = this.sweep.shift();
      if (next != null) this.later(1.3, () => this.startMax(next));
      return;
    }
    const run: ScanRun = { kind: this.kind ?? 'run', target: this.target, steps: this.steps, found, vt: this.sim.vt };
    this.history = [...this.history, run].slice(-8);
    if (this.mode === 'search') {
      this.loopIdx = (this.loopIdx + 1) % LOOP_TARGETS.length;
      this.later(2.2, () => this.startSearch(LOOP_TARGETS[this.loopIdx], null));
    }
  }

  /** Average steps over the 'avg' runs so far. */
  avgSteps() {
    const runs = this.history.filter((h) => h.kind === 'avg');
    return runs.length ? runs.reduce((s, h) => s + h.steps, 0) / runs.length : null;
  }

  lastOf(kind: CaseKind) {
    for (let k = this.history.length - 1; k >= 0; k--) if (this.history[k].kind === kind) return this.history[k];
    return null;
  }
}
