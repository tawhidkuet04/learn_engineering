import type { BigOSim } from '../sim';

/* O(1): arr[6] jumps straight to an address; set.has("carol") hashes to one
   bucket. The animation loops; the step counters never change with n. */

export const CONST_INDEX = 6;
export const CONST_KEY = 'carol';
export const CYCLE = 4.6;

/** 32-bit FNV-1a, the kind of string hash a hash table uses. */
export function fnv1a(s: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Buckets a table keeps for n entries (load factor ≤ 0.75, power of two). */
export function bucketsFor(n: number) {
  let b = 8;
  while (n / b > 0.75) b *= 2;
  return b;
}

export class ConstEngine {
  n = 10;
  /** Seconds into the current animation loop */
  t = 0;
  loops = 0;
  /** vt when n last changed (for the resize flash) */
  changedVt = -10;

  constructor(private sim: BigOSim) {}

  reset(n: number) {
    this.n = n;
    this.t = 0;
    this.loops = 0;
  }

  setN(n: number) {
    if (n === this.n) return;
    this.n = n;
    this.t = 0;
    this.changedVt = this.sim.vt;
    this.sim.rev++;
  }

  update(dt: number) {
    this.t += dt;
    if (this.t >= CYCLE) {
      this.t -= CYCLE;
      this.loops++;
      this.sim.rev++;
    }
  }

  get buckets() {
    return bucketsFor(this.n);
  }

  get hash() {
    return fnv1a(CONST_KEY);
  }

  get bucket() {
    return this.hash % this.buckets;
  }

  /* phases, as 0..1 progress */
  get arrJump() {
    return prog(this.t, 0.35, 0.85);
  }
  get hashIn() {
    return prog(this.t, 1.55, 0.55);
  }
  get hashJump() {
    return prog(this.t, 2.2, 0.8);
  }
  /** Step counters: 1 once the jump has landed this loop, or after the first loop */
  arrSteps() {
    return this.arrJump >= 1 || this.loops > 0 ? 1 : 0;
  }
  hashSteps() {
    return this.hashJump >= 1 || this.loops > 0 ? 1 : 0;
  }
}

const prog = (t: number, t0: number, d: number) => Math.min(1, Math.max(0, (t - t0) / d));
