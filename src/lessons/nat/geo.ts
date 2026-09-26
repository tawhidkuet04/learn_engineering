import { clamp } from '@/lib/sim/geometry';

/* Layout of the two diagram views that aren't made of boxes. Pure functions of the stage size. */

export interface BitsGeo {
  land: boolean;
  /** Left edge of bit 0 */
  x0: number;
  pitch: number;
  cell: number;
  /** Extra gap between octets */
  oct: number;
  /** Cell height */
  ch: number;
  totalW: number;
  /** Baseline of the big dotted-decimal address */
  addrY: number;
  /** Top of the first bit row */
  top: number;
  rowGap: number;
}

export function bitsGeo(W: number, H: number, land: boolean): BitsGeo {
  if (land) {
    const labelW = 150;
    const oct = 14;
    const avail = W - 80 - labelW;
    const pitch = clamp(Math.floor((avail - 3 * oct) / 32), 14, 27);
    const totalW = 32 * pitch - 3 + 3 * oct;
    const x0 = Math.round((W - (labelW + totalW)) / 2 + labelW);
    const addrY = clamp(H * 0.23, 118, 190);
    return { land, x0, pitch, cell: pitch - 3, oct, ch: 30, totalW, addrY, top: addrY + 84, rowGap: clamp(H * 0.088, 58, 74) };
  }
  const oct = 7;
  const pitch = Math.max(8, Math.floor((W - 22 - 3 * oct) / 32));
  const totalW = 32 * pitch - 1.5 + 3 * oct;
  const x0 = Math.round((W - totalW) / 2);
  return { land, x0, pitch, cell: pitch - 1.5, oct, ch: 19, totalW, addrY: 104, top: 164, rowGap: 54 };
}

/** Left edge of bit i (0 = most significant) in a 32-bit row. */
export const bitX = (g: BitsGeo, i: number) => g.x0 + i * g.pitch + Math.floor(i / 8) * g.oct;

/** x of the divider drawn after `prefix` bits (fractional prefixes interpolate). */
export function dividerX(g: BitsGeo, prefix: number) {
  const at = (p: number) => {
    if (p <= 0) return g.x0 - Math.max(4, g.oct / 2);
    if (p >= 32) return bitX(g, 31) + g.cell + Math.max(4, g.oct / 2);
    const left = bitX(g, p - 1) + g.cell;
    const right = bitX(g, p);
    return (left + right) / 2;
  };
  const lo = Math.floor(prefix);
  const k = prefix - lo;
  return at(lo) + (at(Math.min(32, lo + 1)) - at(lo)) * k;
}

export const rowY = (g: BitsGeo, i: number) => g.top + i * g.rowGap;

/* ---------------- IPv6 ---------------- */

export interface V6Geo {
  land: boolean;
  /** Bits per line */
  per: number;
  lines: number;
  x0: number;
  pitch: number;
  cell: number;
  gap: number;
  ch: number;
  top: number;
  lineGap: number;
  addrY: number;
  totalW: number;
}

export function v6Geo(W: number, H: number, land: boolean): V6Geo {
  if (land) {
    const per = 32;
    const gap = 18;
    const pitch = clamp(Math.floor((W - 260 - gap) / per), 12, 21);
    const totalW = per * pitch - 3 + gap;
    const x0 = Math.round((W - totalW) / 2 + 40);
    const addrY = clamp(H * 0.2, 110, 170);
    return { land, per, lines: 4, x0, pitch, cell: pitch - 3, gap, ch: 24, top: addrY + 120, lineGap: clamp(H * 0.075, 48, 60), addrY, totalW };
  }
  const per = 16;
  const pitch = Math.max(10, Math.floor((W - 96) / per));
  const totalW = per * pitch - 2;
  const x0 = Math.round((W - totalW) / 2 + 26);
  return { land, per, lines: 8, x0, pitch, cell: pitch - 2, gap: 0, ch: 17, top: 160, lineGap: 29, addrY: 100, totalW };
}

export const v6BitX = (g: V6Geo, j: number) => g.x0 + j * g.pitch + (g.per === 32 && j >= 16 ? g.gap : 0);

/* ---------------- the /8 map ---------------- */

export interface MapGeo {
  land: boolean;
  pitch: number;
  cell: number;
  size: number;
  x0: number;
  y0: number;
}

export function mapGeo(W: number, H: number, land: boolean): MapGeo {
  if (land) {
    const pitch = Math.floor(Math.min((H - 190) / 16, (W - 400) / 16, 40));
    const size = pitch * 16 - 3;
    const x0 = Math.max(70, Math.round((W - 330 - size) / 2) + 44);
    const y0 = Math.round((H - size) / 2) - 8;
    return { land, pitch, cell: pitch - 3, size, x0, y0 };
  }
  const pitch = Math.floor((W - 24) / 16);
  const size = pitch * 16 - 2;
  return { land, pitch, cell: pitch - 2, size, x0: Math.round((W - size) / 2), y0: 76 };
}

export const cellXY = (g: MapGeo, n: number) => ({ x: g.x0 + (n % 16) * g.pitch, y: g.y0 + Math.floor(n / 16) * g.pitch });
