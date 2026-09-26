import type { GcMode } from './types';

/*
 * The pause timeline: two application threads and two GC threads over time.
 * Every few seconds a GC cycle runs. How it's scheduled depends on the mode:
 *   stw          one pause; a single GC thread marks then sweeps
 *   parallel     one pause; two GC threads split the work, so it's shorter
 *   incremental  the same work in small slices, app runs in between
 *   concurrent   tiny pauses to start and finish; marking runs alongside the app
 */

export type SegKind = 'pause' | 'mark' | 'sweep' | 'slice' | 'cmark' | 'csweep' | 'init' | 'remark' | 'shared';

export interface Seg {
  lane: number;
  t0: number;
  t1: number;
  kind: SegKind;
}

export interface Pause {
  t0: number;
  t1: number;
  ms: number;
}

export const LANES = ['app 1', 'app 2', 'gc 1', 'gc 2'];

/** One simulated second on this timeline is shown as this many milliseconds. */
export const MS_PER_S = 100;

export class ThreadsModel {
  mode: GcMode = 'stw';
  liveMB = 300;
  segs: Seg[] = [];
  pauses: Pause[] = [];
  /** GC cycles started so far */
  cycles = 0;
  now = 0;
  /** Seconds visible on the timeline */
  window = 14;
  period = 4.6;
  private nextAt = 1;

  reset(t: number) {
    this.segs = [];
    this.pauses = [];
    this.cycles = 0;
    this.now = t;
    this.nextAt = t + 0.9;
  }

  setMode(mode: GcMode) {
    this.mode = mode;
  }

  setLive(mb: number) {
    this.liveMB = mb;
  }

  /** Total collector work for one cycle, in simulated seconds (grows with live data). */
  work() {
    return 0.3 + this.liveMB / 360;
  }

  /** Pause length a stop-the-world collector would need right now, in ms. */
  stwMs() {
    return Math.round(this.work() * MS_PER_S);
  }

  step(t: number) {
    this.now = t;
    if (t >= this.nextAt) {
      const end = this.schedule(this.nextAt);
      this.nextAt = Math.max(this.nextAt + this.period, end + 1.4);
    }
    const cut = t - this.window - 2;
    if (this.segs.length > 200 || (this.segs[0] && this.segs[0].t1 < cut)) this.segs = this.segs.filter((s) => s.t1 >= cut);
    if (this.pauses[0] && this.pauses[0].t1 < cut) this.pauses = this.pauses.filter((p) => p.t1 >= cut);
  }

  /** True while the application threads are stopped. */
  paused(t: number) {
    return this.pauses.some((p) => p.t0 <= t && t < p.t1);
  }

  /** The GC phase happening at time t, for the status line. */
  phaseAt(t: number): SegKind | null {
    const s = this.segs.find((x) => x.lane >= 2 && x.t0 <= t && t < x.t1);
    return s ? s.kind : null;
  }

  private pause(t0: number, t1: number) {
    this.segs.push({ lane: 0, t0, t1, kind: 'pause' }, { lane: 1, t0, t1, kind: 'pause' });
    this.pauses.push({ t0, t1, ms: Math.max(1, Math.round((t1 - t0) * MS_PER_S)) });
  }

  /** Lay out one GC cycle starting at t0; returns when it ends. */
  private schedule(t0: number): number {
    this.cycles += 1;
    const W = this.work();
    switch (this.mode) {
      case 'stw': {
        const t1 = t0 + W;
        this.pause(t0, t1);
        this.segs.push({ lane: 2, t0, t1: t0 + W * 0.7, kind: 'mark' }, { lane: 2, t0: t0 + W * 0.7, t1, kind: 'sweep' });
        return t1;
      }
      case 'parallel': {
        const P = W / 2 + 0.04;
        const t1 = t0 + P;
        this.pause(t0, t1);
        for (const lane of [2, 3]) this.segs.push({ lane, t0, t1: t0 + P * 0.7, kind: 'mark' }, { lane, t0: t0 + P * 0.7, t1, kind: 'sweep' });
        return t1;
      }
      case 'incremental': {
        const n = 6;
        const slice = W / n;
        const gap = 0.34;
        let s = t0;
        for (let i = 0; i < n; i++) {
          this.pause(s, s + slice);
          this.segs.push({ lane: 2, t0: s, t1: s + slice, kind: i < 4 ? 'mark' : 'sweep' });
          s += slice + gap;
        }
        return s - gap;
      }
      case 'concurrent': {
        const init = 0.05;
        const remark = 0.08;
        const cm = W * 0.75;
        const cs = W * 0.35;
        const a = t0 + init;
        const b = a + cm;
        const c = b + remark;
        this.pause(t0, a);
        this.segs.push({ lane: 2, t0, t1: a, kind: 'init' });
        this.segs.push({ lane: 2, t0: a, t1: b, kind: 'cmark' }, { lane: 3, t0: a, t1: b, kind: 'cmark' });
        this.segs.push({ lane: 0, t0: a, t1: b, kind: 'shared' }, { lane: 1, t0: a, t1: b, kind: 'shared' });
        this.pause(b, c);
        this.segs.push({ lane: 2, t0: b, t1: c, kind: 'remark' });
        this.segs.push({ lane: 2, t0: c, t1: c + cs, kind: 'csweep' });
        return c + cs;
      }
    }
  }

  /** Stats over the visible window. */
  stats() {
    const from = this.now - this.window;
    const ps = this.pauses.filter((p) => p.t1 > from && p.t0 <= this.now);
    const longest = ps.reduce((m, p) => Math.max(m, p.ms), 0);
    const paused = ps.reduce((sum, p) => sum + Math.max(0, Math.min(p.t1, this.now) - Math.max(p.t0, from)), 0);
    return { count: ps.length, longest, pausedPct: Math.round((paused / this.window) * 100) };
  }
}
