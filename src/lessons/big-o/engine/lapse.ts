import { CLASSES, UNIVERSE_LG_NS, type ClassId } from '../model';
import type { BigOSim } from '../sim';

/* A time-lapse race at one nanosecond per step. The clock runs on a log
   scale from 1 ns to past the age of the universe, so a lane finishes when
   the playhead reaches 10^(log10 steps) ns. */

export const LAPSE_MAX = 27.4;
const SPEED = 2.2; // decades per simulated second

export const LAPSE_TICKS: { lg: number; label: string; short: string; major?: boolean }[] = [
  { lg: 0, label: '1 ns', short: '1 ns', major: true },
  { lg: 3, label: '1 µs', short: '1 µs' },
  { lg: 6, label: '1 ms', short: '1 ms', major: true },
  { lg: 9, label: '1 s', short: '1 s', major: true },
  { lg: Math.log10(60e9), label: '1 min', short: 'min' },
  { lg: Math.log10(3600e9), label: '1 hour', short: 'h' },
  { lg: Math.log10(86400e9), label: '1 day', short: 'day', major: true },
  { lg: Math.log10(365.25 * 86400e9), label: '1 year', short: 'yr', major: true },
  { lg: Math.log10(365.25 * 86400e9) + 3, label: '1,000 yr', short: 'kyr' },
  { lg: Math.log10(365.25 * 86400e9) + 6, label: '1M yr', short: 'Myr' },
  { lg: Math.log10(365.25 * 86400e9) + 9, label: '1B yr', short: 'Byr' },
  { lg: UNIVERSE_LG_NS, label: 'age of the universe', short: 'universe', major: true },
];

export class LapseEngine {
  lanes: ClassId[] = ['c1', 'logn', 'n', 'nlogn', 'n2', 'exp'];
  n = 1_000_000;
  /** Playhead, log10 nanoseconds */
  play = -0.6;
  running = false;
  loop = true;
  /** vt at which each lane finished (for the flash) */
  doneVt = new Map<ClassId, number>();
  runs = 0;
  private gen = 0;

  constructor(private sim: BigOSim) {}

  private later(delay: number, fn: () => void) {
    const g = this.gen;
    this.sim.after(delay, () => {
      if (g === this.gen) fn();
    });
  }

  reset(lanes: ClassId[], n: number, loop: boolean) {
    this.lanes = [...lanes];
    this.n = n;
    this.loop = loop;
    this.race();
  }

  /** Start the clock again from zero. */
  race() {
    this.gen++;
    this.play = -0.6;
    this.running = true;
    this.doneVt = new Map();
    this.runs++;
    this.sim.rev++;
  }

  setN(n: number) {
    this.n = n;
    this.race();
  }

  toggleLane(id: ClassId) {
    const on = this.lanes.includes(id);
    if (on && this.lanes.length <= 1) return;
    const order: ClassId[] = ['c1', 'logn', 'n', 'nlogn', 'n2', 'exp'];
    this.lanes = on ? this.lanes.filter((x) => x !== id) : order.filter((x) => x === id || this.lanes.includes(x));
    this.race();
  }

  /** log10 of the finish time in ns (= log10 of the step count at 1 ns per step) */
  finishLg(id: ClassId) {
    return CLASSES[id].lg(this.n);
  }

  isDone(id: ClassId) {
    return this.finishLg(id) <= this.play;
  }

  lastFinish() {
    return Math.max(...this.lanes.map((id) => this.finishLg(id)));
  }

  update(dt: number) {
    if (!this.running) return;
    this.play = Math.min(LAPSE_MAX, this.play + SPEED * dt);
    for (const id of this.lanes) {
      if (!this.doneVt.has(id) && this.isDone(id)) {
        this.doneVt.set(id, this.sim.vt);
        this.sim.rev++;
      }
    }
    // Stop once every lane is home, or when the clock passes the age of the universe.
    const allHome = this.lanes.every((id) => this.isDone(id));
    if (this.play >= LAPSE_MAX || (allHome && this.play >= this.lastFinish() + 0.6)) {
      this.running = false;
      this.sim.rev++;
      if (this.loop) this.later(4, () => this.race());
    }
  }
}
