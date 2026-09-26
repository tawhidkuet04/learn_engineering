import { SIG } from './colors';
import { bezier, clamp, damp, type Curve, type Pt } from './geometry';
import { mulberry32, type Rng } from './rng';

export type Orient = 'landscape' | 'portrait';

/** Anything placed on the stage. It eases from (x, y) toward its target (tx, ty). */
export interface Box {
  id: string;
  x: number;
  y: number;
  tx: number;
  ty: number;
  w: number;
  h: number;
  alpha: number;
  talpha: number;
  removing: boolean;
}

export type FlightShape = 'dot' | 'envelope' | 'square';

/** Something traveling between two boxes: a packet, message, token… */
export interface Flight {
  id: number;
  from: string;
  to: string;
  t0: number;
  dur: number;
  color: string;
  r: number;
  shape: FlightShape;
  label?: string;
  /** Sideways offset in px so two-way traffic uses separate lanes ("keep right") */
  lane: number;
  trail: boolean;
  /** Stop at the destination instead of arriving (released later with sim.release) */
  hold: boolean;
  held: boolean;
  /** Fraction of the trip at which it is lost, or null */
  lostAt: number | null;
  /** Free-form marker for the lesson */
  tag?: string;
  onArrive?: (f: Flight) => void;
  onLost?: (f: Flight) => void;
}

export interface SendOpts {
  from: string;
  to: string;
  /** Travel time in simulated seconds */
  dur: number;
  color?: string;
  r?: number;
  shape?: FlightShape;
  label?: string;
  lane?: number;
  trail?: boolean;
  hold?: boolean;
  lostAt?: number | null;
  tag?: string;
  onArrive?: (f: Flight) => void;
  onLost?: (f: Flight) => void;
}

export type Anchor = { id: string; dx?: number; dy?: number } | { x: number; y: number };

export interface Effect {
  kind: 'ring' | 'x' | 'text';
  at: Anchor;
  color: string;
  text?: string;
  vt: number;
  dur: number;
  size: number;
}

export type WireState = 'normal' | 'dim' | 'down' | 'dashed' | 'hot' | 'control';

export interface WireSpec {
  from: string;
  to: string;
  state?: WireState;
  /** Override the stroke color */
  color?: string;
}

export interface FlightView {
  id: number;
  x: number;
  y: number;
  /** Tail of the motion trail */
  tx: number;
  ty: number;
  angle: number;
  progress: number;
  color: string;
  r: number;
  shape: FlightShape;
  label?: string;
  trail: boolean;
  tag?: string;
}

export interface WireView {
  key: string;
  d: string;
  alpha: number;
  state: WireState;
  color?: string;
  flash: number;
  mid: Pt;
}

export interface EffectView {
  kind: Effect['kind'];
  x: number;
  y: number;
  color: string;
  text?: string;
  k: number;
  size: number;
}

export interface ScriptEvent<S> {
  /** Seconds (simulated) after the step started */
  at: number;
  run: (sim: S) => void;
}

interface WireLive {
  spec: WireSpec;
  d: string;
  alpha: number;
  target: number;
  flashVt: number;
  mid: Pt;
}

/**
 * A cubic curve between two boxes that leaves and enters through the sides
 * facing each other. `lane` shifts the curve to the traveler's right, so
 * A→B and B→A traffic never overlap. Reversing from/to gives the same shape.
 */
export function portCurve(a: Box, b: Box, lane = 0): Curve {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const horizontal = Math.abs(dx) - (a.w + b.w) / 2 >= Math.abs(dy) - (a.h + b.h) / 2;
  if (horizontal) {
    const s = Math.sign(dx) || 1;
    const p0 = { x: a.x + (s * a.w) / 2, y: a.y };
    const p3 = { x: b.x - (s * b.w) / 2, y: b.y };
    const k = Math.max(18, Math.abs(p3.x - p0.x) * 0.5);
    const off = lane * s;
    return {
      p0: { x: p0.x, y: p0.y + off },
      p1: { x: p0.x + s * k, y: p0.y + off },
      p2: { x: p3.x - s * k, y: p3.y + off },
      p3: { x: p3.x, y: p3.y + off },
    };
  }
  const s = Math.sign(dy) || 1;
  const p0 = { x: a.x, y: a.y + (s * a.h) / 2 };
  const p3 = { x: b.x, y: b.y - (s * b.h) / 2 };
  const k = Math.max(18, Math.abs(p3.y - p0.y) * 0.5);
  const off = -lane * s;
  return {
    p0: { x: p0.x + off, y: p0.y },
    p1: { x: p0.x + off, y: p0.y + s * k },
    p2: { x: p3.x + off, y: p3.y - s * k },
    p3: { x: p3.x + off, y: p3.y },
  };
}

export function curvePathD(c: Curve): string {
  const f = (n: number) => n.toFixed(1);
  return `M${f(c.p0.x)},${f(c.p0.y)} C${f(c.p1.x)},${f(c.p1.y)} ${f(c.p2.x)},${f(c.p2.y)} ${f(c.p3.x)},${f(c.p3.y)}`;
}

/**
 * Base class for every lesson simulation.
 *
 * Two clocks run side by side:
 *  - `t`, simulated time: only advances while playing and not frozen, scaled by speed.
 *  - `vt`, visual time: always advances, so easing and effects finish even when paused.
 *
 * Subclasses implement `layout()` (where things go for the current size) and
 * usually `step(dt)` (the simulation logic) and `wires()` (the topology).
 */
export abstract class Sim {
  t = 0;
  vt = 0;
  stepT = 0;
  /** Frozen while waiting for the learner (e.g. a prediction) */
  frozen = false;
  /** Bump whenever UI-facing state changes; side-panel cards poll it */
  rev = 0;

  w = 960;
  h = 600;
  orient: Orient = 'landscape';
  /** Landscape narrower than 900px, or any portrait stage */
  compact = false;
  sized = false;
  rng: Rng = mulberry32(42);

  boxes = new Map<string, Box>();
  flights: Flight[] = [];
  effects: Effect[] = [];

  private timers: { at: number; fn: () => void }[] = [];
  private script: ScriptEvent<Sim>[] = [];
  private fired = new Set<number>();
  private wireLive = new Map<string, WireLive>();
  private flightSeq = 1;
  private dirty = false;

  /** Set target position and size (tx, ty, w, h) for every live box. */
  protected abstract layout(): void;
  /** Advance the simulation logic by dt simulated seconds. */
  protected step(dt: number): void {
    void dt;
  }
  /** Wires to draw right now. They fade in and out as this list changes. */
  protected wires(): WireSpec[] {
    return [];
  }
  /** Extra per-frame easing for lesson-specific visuals (runs while paused too). */
  protected animate(dt: number): void {
    void dt;
  }
  /** Override to route specific flights/wires along custom curves. */
  protected curveFor(from: string, to: string, lane: number): Curve | null {
    const a = this.boxes.get(from);
    const b = this.boxes.get(to);
    if (!a || !b || Number.isNaN(a.x) || Number.isNaN(b.x)) return null;
    return portCurve(a, b, lane);
  }

  /* ---------------- boxes ---------------- */

  /** Get or create a box. New boxes fade in at their laid-out position. */
  box(id: string): Box {
    let b = this.boxes.get(id);
    if (!b) {
      b = { id, x: NaN, y: NaN, tx: 0, ty: 0, w: 0, h: 0, alpha: 0, talpha: 1, removing: false };
      this.boxes.set(id, b);
      this.dirty = true;
    }
    if (b.removing) this.dirty = true;
    b.removing = false;
    b.talpha = 1;
    return b;
  }

  /** Convenience for layout(): set a box's target center and size. */
  place(id: string, x: number, y: number, w: number, h: number): Box {
    const b = this.boxes.get(id) ?? this.box(id);
    b.tx = x;
    b.ty = y;
    b.w = w;
    b.h = h;
    return b;
  }

  /** Fade a box out; it is deleted once invisible. */
  hide(id: string) {
    const b = this.boxes.get(id);
    if (b && !b.removing) {
      b.removing = true;
      b.talpha = 0;
      this.dirty = true;
    }
  }

  isLive(id: string) {
    const b = this.boxes.get(id);
    return !!b && !b.removing;
  }

  /* ---------------- sizing ---------------- */

  setSize(w: number, h: number) {
    if (w < 10 || h < 10) return;
    this.w = w;
    this.h = h;
    this.orient = w >= 700 && w >= h * 0.95 ? 'landscape' : 'portrait';
    this.compact = this.orient === 'landscape' ? w < 900 : true;
    this.relayout();
    if (!this.sized) {
      this.sized = true;
      this.snap();
    }
  }

  /** Recompute the layout now (call after adding or removing boxes mid-frame if needed). */
  relayout() {
    this.dirty = false;
    this.layout();
    for (const b of this.boxes.values()) {
      if (Number.isNaN(b.x)) {
        b.x = b.tx;
        b.y = b.ty;
        b.alpha = 0;
      }
    }
  }

  /** Jump every box straight to its target (no easing). */
  snap() {
    for (const b of this.boxes.values()) {
      b.x = b.tx;
      b.y = b.ty;
      b.alpha = b.talpha;
    }
  }

  /* ---------------- clock ---------------- */

  advance(realDt: number, playing: boolean, speed: number) {
    const dt = Math.min(Math.max(realDt, 0), 0.1);
    this.vt += dt;
    if (this.dirty) this.relayout();
    if (playing && !this.frozen) {
      let left = dt * speed;
      while (left > 1e-6 && !this.frozen) {
        const h = Math.min(left, 0.04);
        this.tick(h);
        left -= h;
      }
    }
    this.ease(dt);
  }

  private tick(dt: number) {
    this.t += dt;
    this.stepT += dt;

    this.script.forEach((ev, i) => {
      if (!this.fired.has(i) && this.stepT >= ev.at) {
        this.fired.add(i);
        ev.run(this);
        this.rev++;
      }
    });

    if (this.timers.length) {
      const due = this.timers.filter((tm) => tm.at <= this.t).sort((a, b) => a.at - b.at);
      if (due.length) {
        this.timers = this.timers.filter((tm) => tm.at > this.t);
        for (const tm of due) tm.fn();
      }
    }

    if (this.flights.length) {
      const keep: Flight[] = [];
      const arrived: Flight[] = [];
      const lost: Flight[] = [];
      for (const f of this.flights) {
        if (f.held) {
          keep.push(f);
          continue;
        }
        const p = (this.t - f.t0) / f.dur;
        if (f.lostAt != null && p >= f.lostAt) lost.push(f);
        else if (p >= 1) arrived.push(f);
        else keep.push(f);
      }
      this.flights = keep;
      for (const f of lost) {
        const pt = this.flightPoint(f, f.lostAt ?? 0.5);
        if (pt) this.fx({ kind: 'x', at: pt, color: SIG.err, dur: 0.9 });
        f.onLost?.(f);
      }
      arrived.sort((a, b) => a.t0 + a.dur - (b.t0 + b.dur));
      for (let i = 0; i < arrived.length; i++) {
        const f = arrived[i];
        if (this.frozen) {
          this.flights.push(...arrived.slice(i));
          break;
        }
        if (f.hold) {
          f.held = true;
          this.flights.push(f);
          continue;
        }
        f.onArrive?.(f);
      }
    }

    this.step(dt);
  }

  /** Run fn after `delay` simulated seconds. */
  after(delay: number, fn: () => void) {
    this.timers.push({ at: this.t + delay, fn });
  }

  /** Start a step's timed script. Times are seconds since the step began. */
  runScript<S extends Sim>(this: S, events: ScriptEvent<S>[] = []) {
    const self = this as Sim;
    self.script = events as unknown as ScriptEvent<Sim>[];
    self.fired.clear();
    self.stepT = 0;
  }

  /** Clear everything in motion: flights, timers, effects, freeze. */
  clearTransient() {
    this.flights = [];
    this.timers = [];
    this.effects = [];
    this.frozen = false;
  }

  /* ---------------- flights ---------------- */

  send(o: SendOpts): Flight {
    const f: Flight = {
      id: this.flightSeq++,
      from: o.from,
      to: o.to,
      t0: this.t,
      dur: Math.max(0.01, o.dur),
      color: o.color ?? SIG.req,
      r: o.r ?? 4.6,
      shape: o.shape ?? 'dot',
      label: o.label,
      lane: o.lane ?? 4,
      trail: o.trail ?? true,
      hold: !!o.hold,
      held: false,
      lostAt: o.lostAt ?? null,
      tag: o.tag,
      onArrive: o.onArrive,
      onLost: o.onLost,
    };
    this.flights.push(f);
    return f;
  }

  /** Let a held flight arrive. */
  release(f: Flight) {
    if (!f.held && !f.hold) return;
    this.flights = this.flights.filter((x) => x !== f);
    f.held = false;
    f.hold = false;
    f.onArrive?.(f);
  }

  /** Lose a flight right where it is now (e.g. the learner clicked it). */
  drop(f: Flight) {
    f.lostAt = Math.max(0, this.progressOf(f));
    f.hold = false;
    f.held = false;
  }

  progressOf(f: Flight) {
    return f.held ? 1 : clamp((this.t - f.t0) / f.dur, 0, 1);
  }

  flightPoint(f: Flight, progress: number): Pt | null {
    const c = this.curveFor(f.from, f.to, f.lane);
    return c ? bezier(c, clamp(progress, 0, 1)) : null;
  }

  /* ---------------- effects ---------------- */

  fx(e: { kind: Effect['kind']; at: Anchor; color: string; text?: string; dur?: number; size?: number }) {
    this.effects.push({ kind: e.kind, at: e.at, color: e.color, text: e.text, dur: e.dur ?? 1, size: e.size ?? 1, vt: this.vt });
  }

  /** Floating label above a box. */
  say(id: string, text: string, color: string = SIG.text, dur = 1.4) {
    const b = this.boxes.get(id);
    this.fx({ kind: 'text', at: { id, dy: -(b?.h ?? 20) / 2 - 12 }, text, color, dur });
  }

  flashWire(from: string, to: string) {
    const w = this.wireLive.get(`${from}>${to}`) ?? this.wireLive.get(`${to}>${from}`);
    if (w) w.flashVt = this.vt;
  }

  anchorPoint(a: Anchor): Pt | null {
    if ('id' in a) {
      const b = this.boxes.get(a.id);
      if (!b || Number.isNaN(b.x)) return null;
      return { x: b.x + (a.dx ?? 0), y: b.y + (a.dy ?? 0) };
    }
    return a;
  }

  /* ---------------- per-frame views ---------------- */

  flightViews(): FlightView[] {
    const out: FlightView[] = [];
    for (const f of this.flights) {
      const c = this.curveFor(f.from, f.to, f.lane);
      if (!c) continue;
      const p = this.progressOf(f);
      const pos = bezier(c, p);
      const tail = bezier(c, clamp(p - 0.075, 0, 1));
      const ahead = bezier(c, clamp(p + 0.02, 0, 1));
      const back = bezier(c, clamp(p - 0.02, 0, 1));
      out.push({
        id: f.id,
        x: pos.x,
        y: pos.y,
        tx: tail.x,
        ty: tail.y,
        angle: Math.atan2(ahead.y - back.y, ahead.x - back.x),
        progress: p,
        color: f.color,
        r: f.r,
        shape: f.shape,
        label: f.label,
        trail: f.trail,
        tag: f.tag,
      });
    }
    return out;
  }

  wireViews(): WireView[] {
    return [...this.wireLive.entries()].map(([key, w]) => ({
      key,
      d: w.d,
      alpha: w.alpha,
      state: w.spec.state ?? 'normal',
      color: w.spec.color,
      flash: clamp(1 - (this.vt - w.flashVt) / 0.5, 0, 1),
      mid: w.mid,
    }));
  }

  effectViews(): EffectView[] {
    const out: EffectView[] = [];
    for (const e of this.effects) {
      const pt = this.anchorPoint(e.at);
      if (!pt) continue;
      out.push({ kind: e.kind, x: pt.x, y: pt.y, color: e.color, text: e.text, k: clamp((this.vt - e.vt) / e.dur, 0, 1), size: e.size });
    }
    return out;
  }

  /* ---------------- easing ---------------- */

  private ease(dt: number) {
    for (const b of this.boxes.values()) {
      b.x = damp(b.x, b.tx, 6.5, dt);
      b.y = damp(b.y, b.ty, 6.5, dt);
      b.alpha = damp(b.alpha, b.talpha, 8, dt);
    }
    for (const [id, b] of this.boxes) if (b.removing && b.alpha < 0.02) this.boxes.delete(id);

    const specs = this.wires();
    const live = new Set<string>();
    for (const spec of specs) {
      const key = `${spec.from}>${spec.to}`;
      const c = this.curveFor(spec.from, spec.to, 0);
      if (!c) continue;
      live.add(key);
      const d = curvePathD(c);
      const mid = bezier(c, 0.5);
      const cur = this.wireLive.get(key);
      if (cur) {
        cur.spec = spec;
        cur.d = d;
        cur.mid = mid;
        cur.target = 1;
      } else {
        this.wireLive.set(key, { spec, d, mid, alpha: 0, target: 1, flashVt: -10 });
      }
    }
    for (const [key, w] of this.wireLive) {
      if (!live.has(key)) w.target = 0;
      w.alpha = damp(w.alpha, w.target, 7, dt);
      if (w.target === 0 && w.alpha < 0.01) this.wireLive.delete(key);
    }

    this.effects = this.effects.filter((e) => this.vt - e.vt < e.dur);
    this.animate(dt);
  }
}
