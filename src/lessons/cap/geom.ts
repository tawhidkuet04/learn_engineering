import type { Curve, Pt } from '@/lib/sim/geometry';

/** The same curve, traveled the other way. */
export function rev(c: Curve): Curve {
  return { p0: c.p3, p1: c.p2, p2: c.p1, p3: c.p0 };
}

/** Offset a curve sideways to the traveler's right, so two-way traffic uses separate lanes. */
export function shift(c: Curve, lane: number): Curve {
  if (!lane) return c;
  const dx = c.p3.x - c.p0.x;
  const dy = c.p3.y - c.p0.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * lane;
  const ny = (dx / len) * lane;
  const m = (p: Pt) => ({ x: p.x + nx, y: p.y + ny });
  return { p0: m(c.p0), p1: m(c.p1), p2: m(c.p2), p3: m(c.p3) };
}

/** A curve that leaves `a` vertically and enters `b` vertically. */
export function vertical(a: Pt, b: Pt, bend = 0.5): Curve {
  const k = Math.max(20, Math.abs(b.y - a.y) * bend);
  const s = Math.sign(b.y - a.y) || 1;
  return { p0: a, p1: { x: a.x, y: a.y + s * k }, p2: { x: b.x, y: b.y - s * k }, p3: b };
}
