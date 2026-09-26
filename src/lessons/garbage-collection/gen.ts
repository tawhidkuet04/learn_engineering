import { SIG } from '@/lib/sim/colors';
import type { GcSim } from './sim';

/*
 * The generational world. Every allocation lands in eden (bump pointer). Each
 * object gets a lifetime: most are short, a few are long. A dead object keeps
 * its cell until a collection finds it.
 *
 *   minor GC  eden is full: trace only the young generation (roots plus the
 *             remembered set), copy survivors to the survivor space, promote
 *             objects that survived `tenure` collections to the old generation,
 *             and wipe eden in one go.
 *   major GC  the old generation is nearly full: trace everything, free the
 *             dead, and compact the old generation.
 *   full GC   generational mode off: one big heap, every collection traces it all.
 *
 * Pause lengths in ms come from a simple cost model (a base cost plus work per
 * live object). The animation plays each pause in slow motion.
 */

export type Zone = 'eden' | 'surv' | 'old' | 'heap';
export type GcKind = 'minor' | 'major' | 'full';

export const ZONE_CELLS: Record<Zone, number> = { eden: 18, surv: 6, old: 30, heap: 54 };
export const ZONE_COLS: Record<Zone, number> = { eden: 6, surv: 6, old: 6, heap: 9 };

export interface GenObj {
  n: number;
  /** Box id: g:<n> */
  id: string;
  zone: Zone;
  cell: number;
  born: number;
  life: number;
  /** Minor collections survived */
  age: number;
  dead: boolean;
  freed: boolean;
  label?: string;
  /** Scripted objects never die on their own */
  pinned?: boolean;
  /** Only reachable through an old object (write-barrier demo) */
  viaOld?: boolean;
  /** Freed by mistake while still referenced */
  lost?: boolean;
}

export interface GenEvent {
  t: number;
  kind: GcKind;
  ms: number;
  freed: number;
  promoted: number;
}

interface PauseState {
  kind: GcKind;
  t0: number;
  t1: number;
  ms: number;
  applied: boolean;
  thenMajor: boolean;
}

const round1 = (x: number) => Math.round(x * 10) / 10;

export class GenModel {
  objs: GenObj[] = [];
  events: GenEvent[] = [];
  pause: PauseState | null = null;
  generational = true;
  allocRate = 9;
  longLived = 0.1;
  /** No automatic allocation (scripted steps) */
  paused = false;
  tenure = 2;
  allocated = 0;
  /** Age at death: < 0.5s, 0.5-1s, 1-2s, 2-5s, > 5s */
  hist = [0, 0, 0, 0, 0];
  /** Old → young references recorded by the write barrier (box ids) */
  remembered: { from: string; to: string }[] = [];
  /** Old → young references that exist (drawn as arrows) */
  links: { from: string; to: string }[] = [];
  barrier = true;
  /** Last collection's summary, for the status line */
  last: GenEvent | null = null;
  private seq = 0;
  private acc = 0;

  constructor(private sim: GcSim) {}

  reset() {
    for (const o of this.objs) this.sim.boxes.delete(o.id);
    this.objs = [];
    this.events = [];
    this.pause = null;
    this.allocated = 0;
    this.hist = [0, 0, 0, 0, 0];
    this.remembered = [];
    this.links = [];
    this.last = null;
    this.acc = 0.5;
  }

  get(id: string) {
    return this.objs.find((o) => o.id === id);
  }

  live() {
    return this.objs.filter((o) => !o.freed);
  }

  used(zone: Zone) {
    return this.objs.filter((o) => !o.freed && o.zone === zone).length;
  }

  private nextCell(zone: Zone): number {
    const taken = new Set(this.objs.filter((o) => !o.freed && o.zone === zone).map((o) => o.cell));
    for (let i = 0; i < ZONE_CELLS[zone]; i++) if (!taken.has(i)) return i;
    return -1;
  }

  /** Allocate one object; false when the allocation zone is full. */
  alloc(opts: { label?: string; pinned?: boolean; life?: number; viaOld?: boolean; zone?: Zone; age?: number } = {}): GenObj | null {
    const zone = opts.zone ?? (this.generational ? 'eden' : 'heap');
    const cell = this.nextCell(zone);
    if (cell < 0) return null;
    const long = this.sim.rng() < this.longLived;
    const life = opts.life ?? (long ? 16 + this.sim.rng() * 34 : 0.12 - Math.log(1 - this.sim.rng()) * 0.45);
    const n = ++this.seq;
    const o: GenObj = { n, id: `g:${n}`, zone, cell, born: this.sim.t, life, age: opts.age ?? 0, dead: false, freed: false, label: opts.label, pinned: opts.pinned, viaOld: opts.viaOld };
    this.objs.push(o);
    this.sim.box(o.id);
    this.allocated += 1;
    return o;
  }

  step(dt: number) {
    const t = this.sim.t;
    for (const o of this.objs) {
      if (!o.freed && !o.dead && !o.pinned && t >= o.born + o.life) {
        o.dead = true;
        const age = t - o.born;
        this.hist[age < 0.5 ? 0 : age < 1 ? 1 : age < 2 ? 2 : age < 5 ? 3 : 4] += 1;
      }
    }
    if (this.pause) {
      this.runPause(t);
      return;
    }
    if (this.paused) return;
    this.acc += dt * this.allocRate;
    while (this.acc >= 1) {
      this.acc -= 1;
      if (!this.alloc()) {
        this.acc = 0;
        this.collect();
        break;
      }
    }
  }

  /** Start the collection the current mode calls for. */
  collect() {
    if (this.pause) return;
    if (this.generational) this.startMinor();
    else this.startFull();
  }

  /** Is this young object found by a minor GC? */
  private foundByMinor(o: GenObj) {
    if (o.dead) return false;
    if (o.viaOld) return this.remembered.some((r) => r.to === o.id);
    return true;
  }

  startMinor() {
    const t = this.sim.t;
    const young = this.objs.filter((o) => !o.freed && (o.zone === 'eden' || o.zone === 'surv'));
    const found = young.filter((o) => this.foundByMinor(o));
    const ms = round1(0.5 + 0.28 * found.length + 0.15 * this.remembered.length);
    const dur = 0.5 + 0.05 * found.length;
    this.pause = { kind: 'minor', t0: t, t1: t + dur, ms, applied: false, thenMajor: false };
    for (const o of found) {
      const viaRs = o.viaOld && this.remembered.some((r) => r.to === o.id);
      this.sim.send({ from: viaRs ? 'gen:rs' : 'gen:roots', to: o.id, dur: dur * 0.42, color: viaRs ? SIG.hc : SIG.res, r: 3.2, lane: 0 });
    }
    this.sim.rev++;
  }

  startMajor() {
    const t = this.sim.t;
    const liveAll = this.objs.filter((o) => !o.freed && !o.dead).length;
    const oldUsed = this.used('old');
    const ms = round1(4 + 0.45 * liveAll + 0.15 * oldUsed);
    const dur = 1 + 0.03 * liveAll;
    this.pause = { kind: 'major', t0: t, t1: t + dur, ms, applied: false, thenMajor: false };
    const targets = this.objs.filter((o) => !o.freed && !o.dead && o.zone === 'old').slice(0, 16);
    targets.forEach((o, i) => this.sim.after(i * 0.03, () => this.sim.send({ from: 'gen:roots', to: o.id, dur: dur * 0.35, color: SIG.res, r: 3, lane: 0 })));
    this.sim.rev++;
  }

  startFull() {
    const t = this.sim.t;
    const liveAll = this.objs.filter((o) => !o.freed && !o.dead).length;
    const used = this.used('heap');
    const ms = round1(4 + 0.45 * liveAll + 0.15 * used);
    const dur = 1 + 0.03 * liveAll;
    this.pause = { kind: 'full', t0: t, t1: t + dur, ms, applied: false, thenMajor: false };
    const targets = this.objs.filter((o) => !o.freed && !o.dead).slice(0, 18);
    targets.forEach((o, i) => this.sim.after(i * 0.025, () => this.sim.send({ from: 'gen:roots', to: o.id, dur: dur * 0.35, color: SIG.res, r: 3, lane: 0 })));
    this.sim.rev++;
  }

  private free(o: GenObj) {
    o.freed = true;
    this.sim.hide(o.id);
    this.remembered = this.remembered.filter((r) => r.to !== o.id && r.from !== o.id);
  }

  private runPause(t: number) {
    const p = this.pause;
    if (!p) return;
    const k = (t - p.t0) / (p.t1 - p.t0);
    if (!p.applied && k >= 0.5) {
      p.applied = true;
      if (p.kind === 'minor') this.applyMinor(p);
      else if (p.kind === 'major') this.applyMajor(p);
      else this.applyFull(p);
      this.sim.relayout();
    }
    if (t >= p.t1) {
      this.pause = null;
      this.sim.rev++;
      if (p.thenMajor) this.startMajor();
    }
  }

  private applyMinor(p: PauseState) {
    const young = this.objs.filter((o) => !o.freed && (o.zone === 'eden' || o.zone === 'surv'));
    let freed = 0;
    let promoted = 0;
    const survivors: GenObj[] = [];
    for (const o of young) {
      if (this.foundByMinor(o)) survivors.push(o);
      else {
        if (!o.dead) {
          // Reachable, but the collector couldn't see it: freed by mistake.
          o.lost = true;
          this.sim.fx({ kind: 'ring', at: { id: o.id }, color: SIG.err, size: 1.2 });
        }
        this.free(o);
        freed += 1;
      }
    }
    // Survivors already in the survivor space go first (they're older).
    survivors.sort((a, b) => (a.zone === b.zone ? a.cell - b.cell : a.zone === 'surv' ? -1 : 1));
    const stay: GenObj[] = [];
    for (const o of survivors) {
      o.age += 1;
      const room = stay.length < ZONE_CELLS.surv;
      if (o.age >= this.tenure || !room) {
        const cell = this.nextCell('old');
        if (cell >= 0) {
          o.zone = 'old';
          o.cell = cell;
          promoted += 1;
          continue;
        }
        p.thenMajor = true;
      }
      stay.push(o);
    }
    stay.forEach((o, i) => {
      o.zone = 'surv';
      o.cell = Math.min(i, ZONE_CELLS.surv - 1);
    });
    if (this.used('old') >= ZONE_CELLS.old - 5) p.thenMajor = true;
    this.record(p, freed, promoted);
  }

  private applyMajor(p: PauseState) {
    let freed = 0;
    for (const o of this.objs) {
      if (!o.freed && o.dead && o.zone === 'old') {
        this.free(o);
        freed += 1;
      }
    }
    const olds = this.objs.filter((o) => !o.freed && o.zone === 'old').sort((a, b) => a.cell - b.cell);
    olds.forEach((o, i) => (o.cell = i));
    this.record(p, freed, 0);
  }

  private applyFull(p: PauseState) {
    let freed = 0;
    for (const o of this.objs) {
      if (!o.freed && o.dead) {
        this.free(o);
        freed += 1;
      }
    }
    const all = this.objs.filter((o) => !o.freed).sort((a, b) => a.cell - b.cell);
    all.forEach((o, i) => (o.cell = i));
    this.record(p, freed, 0);
  }

  private record(p: PauseState, freed: number, promoted: number) {
    const ev: GenEvent = { t: p.t0, kind: p.kind, ms: p.ms, freed, promoted };
    this.events.push(ev);
    if (this.events.length > 80) this.events.shift();
    this.last = ev;
    this.sim.rev++;
  }

  /** Delete objects whose fade-out finished. */
  prune() {
    if (this.objs.length > 120 || this.objs.some((o) => o.freed && !this.sim.boxes.has(o.id))) {
      this.objs = this.objs.filter((o) => !(o.freed && !this.sim.boxes.has(o.id)));
    }
  }

  /** Summary over the last `window` simulated seconds. */
  stats(window = 40) {
    const from = this.sim.t - window;
    const evs = this.events.filter((e) => e.t >= from);
    const minor = evs.filter((e) => e.kind === 'minor');
    const big = evs.filter((e) => e.kind !== 'minor');
    const longest = evs.reduce((m, e) => Math.max(m, e.ms), 0);
    const avgMinor = minor.length ? minor.reduce((s, e) => s + e.ms, 0) / minor.length : 0;
    return {
      minor: this.events.filter((e) => e.kind === 'minor').length,
      major: this.events.filter((e) => e.kind !== 'minor').length,
      recentMinor: minor.length,
      recentMajor: big.length,
      longest: round1(longest),
      avgMinor: round1(avgMinor),
      last: this.last,
    };
  }
}
