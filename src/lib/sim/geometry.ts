export interface Pt {
  x: number;
  y: number;
}

export interface Curve {
  p0: Pt;
  p1: Pt;
  p2: Pt;
  p3: Pt;
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Frame-rate independent exponential smoothing toward a target. */
export const damp = (current: number, target: number, lambda: number, dt: number) =>
  target + (current - target) * Math.exp(-lambda * dt);

/**
 * A cubic curve from `a` to `b` whose tangents run along the flow axis,
 * the way wires leave and enter ports in a node editor. `offset` shifts the
 * whole curve sideways so requests and responses travel in separate lanes.
 */
export function curveBetween(a: Pt, b: Pt, axis: 'x' | 'y', offset = 0): Curve {
  if (axis === 'x') {
    const k = Math.max(24, Math.abs(b.x - a.x) * 0.5);
    return {
      p0: { x: a.x, y: a.y + offset },
      p1: { x: a.x + k, y: a.y + offset },
      p2: { x: b.x - k, y: b.y + offset },
      p3: { x: b.x, y: b.y + offset },
    };
  }
  const k = Math.max(24, Math.abs(b.y - a.y) * 0.5);
  return {
    p0: { x: a.x + offset, y: a.y },
    p1: { x: a.x + offset, y: a.y + k },
    p2: { x: b.x + offset, y: b.y - k },
    p3: { x: b.x + offset, y: b.y },
  };
}

export function bezier(c: Curve, t: number): Pt {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const d = 3 * u * t * t;
  const e = t * t * t;
  return {
    x: a * c.p0.x + b * c.p1.x + d * c.p2.x + e * c.p3.x,
    y: a * c.p0.y + b * c.p1.y + d * c.p2.y + e * c.p3.y,
  };
}

export function curvePath(c: Curve): string {
  const f = (n: number) => n.toFixed(1);
  return `M${f(c.p0.x)},${f(c.p0.y)} C${f(c.p1.x)},${f(c.p1.y)} ${f(c.p2.x)},${f(c.p2.y)} ${f(c.p3.x)},${f(c.p3.y)}`;
}

export const smoothstep = (t: number) => t * t * (3 - 2 * t);
