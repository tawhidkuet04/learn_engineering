import { SIG } from '@/lib/sim/colors';
import { damp } from '@/lib/sim/geometry';
import { CLASSES, CLASS_IDS } from '../model';
import type { BigOSim } from '../sim';

/* Steps vs n for several curves, with a zoom (n) and a linear ↔ log-log morph.
     classes  the six growth classes
     rules    n² + 100n vs n², 3n vs n (drop small terms and constants)
     cheat    the six classes, log-log, sweeping out to a million */

export type ChartMode = 'classes' | 'rules' | 'cheat';

export interface Curve {
  id: string;
  label: string;
  color: string;
  dashed?: boolean;
  /** log10 of the value at n */
  lg: (n: number) => number;
}

const L10 = Math.log10;

export const RULE_CURVES: Curve[] = [
  { id: 'n2+100n', label: 'n² + 100n', color: SIG.heavy, dashed: true, lg: (n) => L10(Math.max(1, n * n + 100 * n)) },
  { id: 'n2', label: 'n²', color: SIG.heavy, lg: (n) => 2 * L10(Math.max(1, n)) },
  { id: '3n', label: '3n', color: SIG.req, dashed: true, lg: (n) => L10(Math.max(1, 3 * n)) },
  { id: 'n', label: 'n', color: SIG.req, lg: (n) => L10(Math.max(1, n)) },
];

export const CLASS_CURVES: Curve[] = CLASS_IDS.map((id) => ({ id, label: CLASSES[id].short, color: CLASSES[id].color, lg: CLASSES[id].lg }));

/** Slider stops for n. */
export const N_STOPS = [10, 20, 50, 100, 200, 500, 1_000, 2_000, 5_000, 10_000, 20_000, 50_000, 100_000, 200_000, 500_000, 1_000_000];
export const RULE_STOPS = [10, 20, 50, 100, 200, 500, 1_000, 2_000, 5_000, 10_000];

export class ChartEngine {
  mode: ChartMode = 'classes';
  N = 20;
  log = false;
  /** Displayed log10(N), eased toward the target */
  lgN = Math.log10(20);
  /** 0 = linear axes, 1 = log-log, eased */
  mix = 0;

  constructor(private sim: BigOSim) {}

  get curves() {
    return this.mode === 'rules' ? RULE_CURVES : CLASS_CURVES;
  }

  /** The curve that defines the top of the chart */
  topLg(n: number) {
    return this.mode === 'rules' ? RULE_CURVES[0].lg(n) : 2 * L10(Math.max(1, n));
  }

  reset(mode: ChartMode, N: number, log: boolean) {
    this.mode = mode;
    this.N = N;
    this.log = log;
    this.mix = log ? 1 : 0;
    this.lgN = mode === 'cheat' ? 1 : L10(N);
    this.sim.rev++;
  }

  setN(N: number) {
    this.N = N;
    this.sim.rev++;
  }

  setLog(log: boolean) {
    this.log = log;
    this.sim.rev++;
  }

  /** Visual easing; runs while paused too. */
  animate(dt: number) {
    const target = L10(this.N);
    const speed = this.mode === 'cheat' ? 1.6 : 5;
    this.lgN = Math.abs(this.lgN - target) < 1e-4 ? target : damp(this.lgN, target, speed, dt);
    const m = this.log ? 1 : 0;
    this.mix = Math.abs(this.mix - m) < 1e-4 ? m : damp(this.mix, m, 5, dt);
  }

  /** n currently under the cursor (eased) */
  get nNow() {
    return 10 ** this.lgN;
  }
}
