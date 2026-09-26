import { mulberry32 } from '@/lib/sim/rng';
import { commas, worstTarget } from '../model';
import type { BigOSim } from '../sim';

/* Binary search.
     array  32 sorted numbers, lo / mid / hi pointers, the range halves
     big    a million (then a billion) items as a zooming bar + a ladder of
            range sizes; the predict step asks how many steps it takes */

export type BinaryMode = 'array' | 'big';
type Phase = 'idle' | 'mid' | 'cmp' | 'cut' | 'found' | 'missing';

function makeSorted() {
  const rng = mulberry32(21);
  const out: number[] = [];
  let v = 2;
  for (let i = 0; i < 32; i++) {
    v += 1 + Math.floor(rng() * 4);
    out.push(v);
  }
  return out;
}

export const SORTED = makeSorted();
const MISSING_VALUE = SORTED[17] + 1 < SORTED[18] ? SORTED[17] + 1 : SORTED[9] + 1;
const TARGET_PLAN = [SORTED[22], SORTED[5], MISSING_VALUE, SORTED[29], SORTED[13]];

export class BinaryEngine {
  mode: BinaryMode = 'array';

  /* ---------- array mode ---------- */
  arr = SORTED;
  target = SORTED[22];
  lo = 0;
  hi = 31;
  mid: number | null = null;
  steps = 0;
  phase: Phase = 'idle';
  phaseVt = -10;
  /** vt at which each index was thrown away (-1: still in range) */
  dead: number[] = new Array(32).fill(-1);
  sizes: number[] = [32];
  lastCmp: '<' | '>' | '=' | null = null;
  private plan = 0;
  private rng = mulberry32(5);

  /* ---------- big mode ---------- */
  N = 1_000_000;
  tgt = 0;
  bLo = 0;
  bHi = 0;
  bMid: number | null = null;
  bSteps = 0;
  ladder: number[] = [];
  zoom = { lo: 0, hi: 0, vt: -10 };
  bPhase: 'ready' | 'ask' | 'run' | 'found' = 'ready';
  foundVt = -10;

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

  reset(mode: BinaryMode) {
    this.gen++;
    this.mode = mode;
    this.t = 0;
    if (mode === 'array') {
      this.plan = 0;
      this.rng = mulberry32(5);
      this.start(TARGET_PLAN[0]);
    } else {
      this.startBig(1_000_000);
    }
  }

  /* ================= array mode ================= */

  /** "Search for another number" */
  next() {
    if (this.mode !== 'array') return;
    this.gen++;
    this.plan++;
    this.start(this.pickTarget());
  }

  private pickTarget() {
    if (this.plan < TARGET_PLAN.length) return TARGET_PLAN[this.plan];
    let v = this.arr[Math.floor(this.rng() * this.arr.length)];
    if (v === this.target) v = this.arr[(this.arr.indexOf(v) + 11) % this.arr.length];
    return v;
  }

  private start(target: number) {
    this.target = target;
    this.lo = 0;
    this.hi = this.arr.length - 1;
    this.mid = null;
    this.steps = 0;
    this.dead = new Array(this.arr.length).fill(-1);
    this.sizes = [this.arr.length];
    this.lastCmp = null;
    this.setPhase('idle');
    this.nextAt = this.t + 0.7;
  }

  private setPhase(p: Phase) {
    this.phase = p;
    this.phaseVt = this.sim.vt;
    this.sim.rev++;
  }

  private tickArray() {
    if (this.t < this.nextAt) return;
    switch (this.phase) {
      case 'idle':
      case 'cut': {
        if (this.lo > this.hi) {
          this.mid = null;
          this.setPhase('missing');
          this.afterSearch();
          return;
        }
        this.mid = (this.lo + this.hi) >> 1;
        this.lastCmp = null;
        this.setPhase('mid');
        this.nextAt = this.t + 0.55;
        return;
      }
      case 'mid': {
        const m = this.mid ?? 0;
        this.steps++;
        const v = this.arr[m];
        this.lastCmp = v === this.target ? '=' : v < this.target ? '<' : '>';
        if (this.lastCmp === '=') {
          this.setPhase('found');
          this.afterSearch();
          return;
        }
        this.setPhase('cmp');
        this.nextAt = this.t + 0.65;
        return;
      }
      case 'cmp': {
        const m = this.mid ?? 0;
        const vt = this.sim.vt;
        if (this.lastCmp === '<') {
          for (let i = this.lo; i <= m; i++) this.dead[i] = vt;
          this.lo = m + 1;
        } else {
          for (let i = m; i <= this.hi; i++) this.dead[i] = vt;
          this.hi = m - 1;
        }
        this.sizes = [...this.sizes, Math.max(0, this.hi - this.lo + 1)];
        this.setPhase('cut');
        this.nextAt = this.t + 0.55;
        return;
      }
      default:
        return;
    }
  }

  private afterSearch() {
    this.later(2.6, () => {
      this.plan++;
      this.start(this.pickTarget());
    });
  }

  /* ================= big mode ================= */

  private startBig(N: number) {
    this.N = N;
    this.tgt = worstTarget(N, Math.round(N * 0.7));
    this.bLo = 0;
    this.bHi = N - 1;
    this.bMid = null;
    this.bSteps = 0;
    this.ladder = [N];
    this.zoom = { lo: 0, hi: N - 1, vt: -10 };
    this.bPhase = 'ready';
    this.sim.rev++;
    const game = this.sim.game;
    if (game && !game.done) this.later(0.9, () => this.askBig());
    else this.later(1.1, () => this.runBig());
  }

  private askBig() {
    const game = this.sim.game;
    if (!game || game.done) {
      this.runBig();
      return;
    }
    const million = this.N === 1_000_000;
    this.bPhase = 'ask';
    game.ask({
      acceptable: ['log'],
      choices: million
        ? [
            { id: 'log', label: 'About 20' },
            { id: 'k', label: 'About 1,000' },
            { id: 'half', label: 'About 500,000' },
            { id: 'all', label: '1,000,000' },
          ]
        : [
            { id: 'log', label: 'About 30' },
            { id: 'k', label: 'About 40,000' },
            { id: 'half', label: 'About 20 million' },
            { id: 'all', label: '500 million' },
          ],
      ask: `n = ${commas(this.N)}: how many steps?`,
      explain: (_p, ok) =>
        million
          ? `${ok ? '' : 'About 20. '}2²⁰ = 1,048,576, so 20 halvings take a million down to one. A linear scan could need all 1,000,000.`
          : `${ok ? '' : 'About 30. '}2³⁰ ≈ 1.07 billion. A thousand times more data costs only about 10 more steps.`,
      resolve: () => this.later(0.4, () => this.runBig()),
    });
  }

  private runBig() {
    this.bPhase = 'run';
    this.nextAt = this.t + 0.2;
    this.sim.rev++;
  }

  private tickBig() {
    if (this.bPhase !== 'run' || this.t < this.nextAt) return;
    const mid = Math.floor((this.bLo + this.bHi) / 2);
    this.bMid = mid;
    this.bSteps++;
    if (mid === this.tgt) {
      this.bPhase = 'found';
      this.foundVt = this.sim.vt;
      this.sim.rev++;
      const million = this.N === 1_000_000;
      this.later(million ? 2.6 : 4, () => this.startBig(million ? 1_000_000_000 : 1_000_000));
      return;
    }
    this.zoom = { lo: this.bLo, hi: this.bHi, vt: this.sim.vt };
    if (mid < this.tgt) this.bLo = mid + 1;
    else this.bHi = mid - 1;
    this.ladder = [...this.ladder, this.bHi - this.bLo + 1];
    this.nextAt = this.t + (this.N > 1e7 ? 0.27 : 0.36);
    this.sim.rev++;
  }

  update(dt: number) {
    this.t += dt;
    if (this.mode === 'array') this.tickArray();
    else this.tickBig();
  }
}
