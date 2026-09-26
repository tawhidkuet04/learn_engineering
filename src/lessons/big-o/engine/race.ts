import { SIG } from '@/lib/sim/colors';
import { CLASSES, commas, stepsOf, type ClassId } from '../model';
import type { BigOSim } from '../sim';

/* Race lanes: several workers run on the same input, one step per tick.
   Presets:
     machines   same code on three machines (step counts equal, clocks differ)
     double     five growth classes at n = 16, then n doubles to 32
     constants  insertion sort vs merge sort at n = 8, then n = 1,000
     space      nested-loop vs Set duplicate check, with memory meters */

export type RacePreset = 'machines' | 'double' | 'constants' | 'space';

export interface Lane {
  id: string;
  label: string;
  sub: string;
  color: string;
  total: number;
  /** Steps per simulated second */
  speed: number;
  done: number;
  finishedAt: number | null;
  place: number | null;
  /** Total hidden until the learner predicts it */
  hidden: boolean;
  /** Where the previous run's finish line sits on this track (0..1) */
  ghost: number | null;
  ratio: string | null;
  /** Stopwatch: real milliseconds for the full run (machines preset) */
  clockMs: number | null;
  /** Extra memory: fixed (two loop counters) or growing with the Set */
  mem: 'fixed' | 'grow' | null;
}

const DOUBLE_RATE = 128;
const DOUBLE_ORDER: ClassId[] = ['n2', 'logn', 'nlogn', 'n'];

export const insertionCost = (n: number) => (n * n) / 4;
export const mergeCost = (n: number) => 3 * n * Math.log2(n);

export class RaceEngine {
  preset: RacePreset = 'machines';
  lanes: Lane[] = [];
  n = 16;
  prevN: number | null = null;
  running = false;
  places = 0;
  phase: 'idle' | 'run1' | 'ask' | 'run2' | 'hold' = 'idle';
  /** Lane the open question is about */
  asking: string | null = null;
  askingVt = -10;
  private asked = new Set<string>();
  private gen = 0;

  constructor(private sim: BigOSim) {}

  /** sim.after, cancelled by the next reset/setN */
  private later(delay: number, fn: () => void) {
    const g = this.gen;
    this.sim.after(delay, () => {
      if (g === this.gen) fn();
    });
  }

  reset(preset: RacePreset, n: number) {
    this.gen++;
    this.preset = preset;
    this.prevN = null;
    this.asked.clear();
    this.asking = null;
    if (preset === 'machines') this.startMachines();
    else if (preset === 'double') this.startDouble();
    else if (preset === 'constants') this.startConstants(8);
    else this.startSpace(n);
  }

  get unit() {
    return this.preset === 'constants' ? 'units' : this.preset === 'machines' ? 'comparisons' : 'steps';
  }

  /* ---------------- presets ---------------- */

  private startMachines() {
    this.n = 10_000_000;
    const mk = (id: string, label: string, sub: string, color: string, dur: number, ms: number): Lane => ({
      ...blank(id, label, sub, color, this.n),
      speed: this.n / dur,
      clockMs: ms,
    });
    this.lanes = [
      mk('server', 'Server', '2024 · 3.8 GHz', SIG.req, 2.0, 6.1),
      mk('laptop', 'Laptop', '2019 · 2.3 GHz', SIG.teal, 4.5, 13.7),
      mk('battery', 'Same laptop', 'on battery saver', SIG.blue, 9.0, 27.4),
    ];
    this.go('run1');
  }

  private classLanes(n: number, rate: number): Lane[] {
    return (['c1', 'logn', 'n', 'nlogn', 'n2'] as ClassId[]).map((id) => {
      const c = CLASSES[id];
      const total = Math.max(1, Math.round(stepsOf(id, n)));
      return { ...blank(id, c.big, c.example, c.color, total), speed: rate };
    });
  }

  private startDouble() {
    this.asked.clear();
    this.n = 16;
    this.prevN = null;
    this.lanes = this.classLanes(16, DOUBLE_RATE);
    this.go('run1');
  }

  private prepareDoubled() {
    const old = new Map(this.lanes.map((l) => [l.id, l.total]));
    this.prevN = this.n;
    this.n = this.n * 2;
    const quiz = !!this.sim.game && !this.sim.game.done;
    this.lanes = this.classLanes(this.n, DOUBLE_RATE).map((l) => {
      const o = old.get(l.id) ?? l.total;
      const r = l.total / o;
      return {
        ...l,
        ghost: o / l.total,
        ratio: l.id === 'logn' ? `+${l.total - o}` : r === 1 ? 'same' : `×${trimRatio(r)}`,
        hidden: quiz && DOUBLE_ORDER.includes(l.id as ClassId),
      };
    });
    this.phase = 'ask';
    this.sim.rev++;
    this.askNextDouble();
  }

  private askNextDouble() {
    const game = this.sim.game;
    const next = DOUBLE_ORDER.find((id) => !this.asked.has(id));
    if (!game || game.done || !next) {
      this.revealAll();
      this.later(0.5, () => this.go('run2'));
      return;
    }
    this.asked.add(next);
    const lane = this.lanes.find((l) => l.id === next);
    if (!lane) return;
    const old = Math.round(lane.total * (lane.ghost ?? 1));
    const choices = doubleChoices(next, old);
    this.asking = next;
    this.askingVt = this.sim.vt;
    game.ask({
      acceptable: [choices.answer],
      choices: choices.list,
      ask: `${CLASSES[lane.id as ClassId].big}: ${commas(old)} steps at n = ${this.prevN}. At n = ${this.n}?`,
      explain: (picked, ok) => doubleExplain(next, ok, old, lane.total),
      resolve: () => {
        lane.hidden = false;
        this.asking = null;
        this.sim.rev++;
        this.later(0.7, () => this.askNextDouble());
      },
    });
  }

  private startConstants(n: number) {
    this.n = n;
    const rate = n <= 8 ? mergeCost(n) / 3 : insertionCost(n) / 6;
    const quiz = !!this.sim.game && !this.sim.game.done;
    this.lanes = [
      { ...blank('ins', 'Insertion sort', 'O(n²) · tiny steps', CLASSES.n2.color, Math.round(insertionCost(n))), speed: rate, hidden: quiz },
      { ...blank('merge', 'Merge sort', 'O(n log n) · heavier steps', CLASSES.nlogn.color, Math.round(mergeCost(n))), speed: rate, hidden: quiz },
    ];
    this.phase = 'ask';
    this.running = false;
    this.places = 0;
    this.sim.rev++;
    if (quiz) this.later(0.7, () => this.askConstants());
    else this.later(0.8, () => this.go(n <= 8 ? 'run1' : 'run2'));
  }

  private askConstants() {
    const game = this.sim.game;
    if (!game || game.done) {
      this.revealAll();
      this.go(this.n <= 8 ? 'run1' : 'run2');
      return;
    }
    const small = this.n <= 8;
    this.asking = 'both';
    this.askingVt = this.sim.vt;
    game.ask({
      acceptable: [small ? 'ins' : 'merge'],
      choices: [
        { id: 'ins', label: 'Insertion sort, O(n²)' },
        { id: 'merge', label: 'Merge sort, O(n log n)' },
      ],
      ask: `n = ${commas(this.n)}: which sort finishes first?`,
      explain: (_p, ok) =>
        small
          ? `${ok ? '' : 'Insertion sort wins. '}At n = 8 it needs about 16 cheap steps, merge sort about 72 heavier ones. With tiny inputs the constant factor decides.`
          : `${ok ? '' : 'Merge sort wins. '}Now it's about 250,000 units against 30,000. The n² term swamps any constant factor.`,
      resolve: () => {
        this.asking = null;
        this.revealAll();
        this.later(0.5, () => this.go(small ? 'run1' : 'run2'));
      },
    });
  }

  private startSpace(n: number) {
    this.n = n;
    const rate = (2 * n) / 1.6;
    this.lanes = [
      { ...blank('nested', 'Nested loops', 'compare every pair', CLASSES.n2.color, (n * (n - 1)) / 2), speed: rate, mem: 'fixed' },
      { ...blank('set', 'Set', 'remember what you saw', CLASSES.n.color, 2 * n), speed: rate, mem: 'grow' },
    ];
    this.go('run1');
  }

  /** Space preset: the learner picked a new n. */
  setN(n: number) {
    if (this.preset !== 'space') return;
    this.gen++;
    this.startSpace(n);
  }

  /* ---------------- running ---------------- */

  private go(phase: 'run1' | 'run2') {
    for (const l of this.lanes) {
      l.done = 0;
      l.finishedAt = null;
      l.place = null;
    }
    this.places = 0;
    this.phase = phase;
    this.running = true;
    this.sim.rev++;
  }

  private revealAll() {
    for (const l of this.lanes) l.hidden = false;
    this.sim.rev++;
  }

  update(dt: number) {
    if (!this.running) return;
    let all = true;
    for (const l of this.lanes) {
      if (l.finishedAt != null) continue;
      l.done = Math.min(l.total, l.done + l.speed * dt);
      if (l.done >= l.total) {
        l.finishedAt = this.sim.t;
        l.place = this.places++;
        this.sim.rev++;
      } else all = false;
    }
    if (all) {
      this.running = false;
      this.onAllDone();
    }
  }

  private onAllDone() {
    const p = this.preset;
    this.sim.rev++;
    if (p === 'machines' || p === 'space') {
      this.phase = 'hold';
      this.later(3.2, () => (p === 'machines' ? this.startMachines() : this.startSpace(this.n)));
    } else if (p === 'double') {
      if (this.phase === 'run1') this.later(1.4, () => this.prepareDoubled());
      else {
        this.phase = 'hold';
        this.later(4.5, () => this.startDouble());
      }
    } else if (p === 'constants') {
      if (this.phase === 'run1') this.later(2.2, () => this.startConstants(1000));
      else {
        this.phase = 'hold';
        this.later(4.5, () => this.startConstants(8));
      }
    }
  }

  /** Extra memory in use by a lane right now (space preset). */
  memUsed(l: Lane) {
    if (l.mem === 'fixed') return 2;
    if (l.mem === 'grow') return Math.min(this.n, Math.floor(l.done / 2));
    return 0;
  }
}

function blank(id: string, label: string, sub: string, color: string, total: number): Lane {
  return {
    id,
    label,
    sub,
    color,
    total,
    speed: 1,
    done: 0,
    finishedAt: null,
    place: null,
    hidden: false,
    ghost: null,
    ratio: null,
    clockMs: null,
    mem: null,
  };
}

function trimRatio(r: number) {
  const s = r.toFixed(1);
  return s.endsWith('.0') ? s.slice(0, -2) : s;
}

function doubleChoices(id: string, old: number) {
  if (id === 'n2') {
    return {
      answer: 'x4',
      list: [
        { id: 'x2', label: `${commas(old * 2)} (2×)` },
        { id: 'x4', label: `${commas(old * 4)} (4×)` },
        { id: 'x256', label: `${commas(old * old)} (${commas(old)}×)` },
      ],
    };
  }
  if (id === 'logn') {
    return {
      answer: 'plus1',
      list: [
        { id: 'same', label: `${old}, the same` },
        { id: 'plus1', label: `${old + 1}, one more` },
        { id: 'x2', label: `${old * 2}, twice as many` },
      ],
    };
  }
  if (id === 'nlogn') {
    return {
      answer: 'x2.5',
      list: [
        { id: 'x2', label: `${old * 2} (exactly 2×)` },
        { id: 'x2.5', label: `${Math.round(old * 2.5)} (a bit over 2×)` },
        { id: 'x4', label: `${old * 4} (4×)` },
      ],
    };
  }
  return {
    answer: 'x2',
    list: [
      { id: 'x1', label: `${old}, the same` },
      { id: 'x2', label: `${old * 2} (2×)` },
      { id: 'x4', label: `${old * 4} (4×)` },
    ],
  };
}

function doubleExplain(id: string, ok: boolean, old: number, now: number) {
  if (id === 'n2') return `${ok ? '' : `It's ${commas(now)}. `}(2n)² = 4n²: double the input and all-pairs work quadruples.`;
  if (id === 'logn') return `${ok ? '' : `It's ${now}. `}log₂ 32 = 5. Doubling n adds just one more halving.`;
  if (id === 'nlogn') return `${ok ? '' : `It's ${now}. `}32 × 5 = 160, 2.5× the old ${old}: the n doubles and the log n grows by one.`;
  return `${ok ? '' : `It's ${now}. `}Linear work grows exactly with n: twice the input, twice the steps.`;
}
