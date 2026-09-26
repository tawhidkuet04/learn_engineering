import type { Pt } from '@/lib/sim/geometry';

export const TAU = Math.PI * 2;

const fx = (n: number) => n.toFixed(1);

/** A point on the ring: f is a fraction of the hash space, 0 at the top, growing clockwise. */
export function polar(cx: number, cy: number, r: number, f: number): Pt {
  const a = f * TAU;
  return { x: cx + r * Math.sin(a), y: cy - r * Math.cos(a) };
}

/** SVG path for the clockwise arc from fraction f0 to f1 (f1 > f0). */
export function arcD(cx: number, cy: number, r: number, f0: number, fEnd: number): string {
  const span = fEnd - f0;
  if (span <= 1e-6) return '';
  if (span >= 0.9999) {
    const a = polar(cx, cy, r, f0);
    const b = polar(cx, cy, r, f0 + 0.5);
    return `M${fx(a.x)},${fx(a.y)} A${fx(r)},${fx(r)} 0 1 1 ${fx(b.x)},${fx(b.y)} A${fx(r)},${fx(r)} 0 1 1 ${fx(a.x)},${fx(a.y)}`;
  }
  const a = polar(cx, cy, r, f0);
  const b = polar(cx, cy, r, fEnd);
  return `M${fx(a.x)},${fx(a.y)} A${fx(r)},${fx(r)} 0 ${span > 0.5 ? 1 : 0} 1 ${fx(b.x)},${fx(b.y)}`;
}

/** Clockwise distance from fraction a to fraction b, in [0, 1). */
export const cw = (a: number, b: number) => {
  let d = b - a;
  if (d < 0) d += 1;
  if (d >= 1) d -= 1;
  return d;
};

/** Signed shortest angular difference b - a, in (-0.5, 0.5]. */
export const shortest = (a: number, b: number) => {
  let d = b - a;
  while (d > 0.5) d -= 1;
  while (d <= -0.5) d += 1;
  return d;
};

export const easeInOut = (p: number) => (p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2);
export const easeOut = (p: number) => 1 - (1 - p) ** 3;

export interface CurlPoint extends Pt {
  /** Unit normal pointing to the inside of the (future) ring */
  nx: number;
  ny: number;
}

/**
 * The number line 0 … 2³²−1 bending into the hash ring. m = 0 is a straight
 * line of length L0, m = 1 is the circle (center cx, cy, radius R) with 0 at
 * the top and values growing clockwise. In between it is an arc of constant
 * curvature, kept centered on the stage.
 */
export function curlShape(cx: number, cy: number, R: number, m: number, L0: number) {
  const Lc = L0 + (TAU * R - L0) * m;
  const theta = TAU * m;
  const raw = (u: number): CurlPoint => {
    const s = u * Lc;
    if (theta < 1e-4) return { x: s, y: 0, nx: 0, ny: 1 };
    const rho = Lc / theta;
    const phi = s / rho;
    return { x: rho * Math.sin(phi), y: rho * (1 - Math.cos(phi)), nx: -Math.sin(phi), ny: Math.cos(phi) };
  };
  // Center the shape's bounding box on (cx, cy).
  const N = 96;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const pts: CurlPoint[] = [];
  for (let i = 0; i <= N; i++) {
    const p = raw(i / N);
    pts.push(p);
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const dx = cx - (minX + maxX) / 2;
  const dy = cy - (minY + maxY) / 2;
  const at = (u: number): CurlPoint => {
    const p = raw(u);
    return { x: p.x + dx, y: p.y + dy, nx: p.nx, ny: p.ny };
  };
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${fx(p.x + dx)},${fx(p.y + dy)}`).join(' ');
  return { at, d };
}
