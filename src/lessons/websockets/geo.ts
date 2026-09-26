import type { FrameSample } from './frames';
import type { LaneKind } from './race';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/* ------------------------------------------------------------------ */
/* Race view: three lanes, each a sequence diagram turned on its side   */
/* ------------------------------------------------------------------ */

export interface RaceLaneGeo {
  kind: LaneKind;
  y: number;
  h: number;
  /** The server's track (top) and Bob's track (bottom) */
  ySrv: number;
  yBob: number;
}

export interface RaceGeo {
  land: boolean;
  x0: number;
  /** "now": the right end of the timeline */
  x1: number;
  sumX: number;
  sumW: number;
  lanes: RaceLaneGeo[];
  /** Seconds visible */
  span: number;
  pps: number;
}

export function raceGeo(w: number, h: number, land: boolean): RaceGeo {
  const x0 = land ? 118 : 16;
  const sumW = land ? 176 : 0;
  const x1 = land ? w - 24 - sumW - 26 : w - 16;
  const top = land ? 92 : 72;
  const bottom = land ? 112 : 92;
  const gap = land ? 24 : 12;
  const laneH = Math.min(land ? 150 : 124, (h - top - bottom - gap * 2) / 3);
  const head = land ? 26 : 40;
  const lanes = (['short', 'long', 'ws'] as LaneKind[]).map((kind, i) => {
    const y = top + i * (laneH + gap);
    return { kind, y, h: laneH, ySrv: y + head + 6, yBob: y + laneH - (land ? 14 : 20) };
  });
  const span = land ? 21 : 13;
  return { land, x0, x1, sumX: w - 24 - sumW, sumW, lanes, span, pps: (x1 - x0) / span };
}

/* ------------------------------------------------------------------ */
/* Frame view: the mini pipe, the 16 header bits, and the byte strip    */
/* ------------------------------------------------------------------ */

export interface FieldGeo {
  id: 'fin' | 'rsv' | 'opcode' | 'mask' | 'len';
  /** First bit (0–15) and number of bits */
  from: number;
  n: number;
  name: string;
}

export const FIELDS: FieldGeo[] = [
  { id: 'fin', from: 0, n: 1, name: 'FIN' },
  { id: 'rsv', from: 1, n: 3, name: 'RSV1-3' },
  { id: 'opcode', from: 4, n: 4, name: 'opcode' },
  { id: 'mask', from: 8, n: 1, name: 'MASK' },
  { id: 'len', from: 9, n: 7, name: 'payload len' },
];

export interface ByteCell {
  x: number;
  y: number;
  group: 'ext' | 'key' | 'payload' | 'more';
  i: number;
}

export interface FrameGeo {
  land: boolean;
  pipeY: number;
  cliX: number;
  srvX: number;
  /** Bit grid */
  gx: number;
  gy: number;
  cell: number;
  cellH: number;
  /** Byte strip */
  bx: number;
  by: number;
  bw: number;
  bh: number;
  bytes: ByteCell[];
  /** Where each group of the byte strip starts and ends */
  groups: { group: ByteCell['group']; x0: number; x1: number; y: number }[];
  sumY: number;
}

export function frameGeo(w: number, h: number, land: boolean, f: FrameSample): FrameGeo {
  const cell = land ? 36 : 20;
  const cellH = land ? 42 : 30;
  const gx = (w - cell * 16) / 2;
  const pipeY = land ? 124 : 104;
  const gy = land ? 262 : 196;
  const bw = land ? 46 : 32;
  const bh = land ? 36 : 28;
  const gapB = land ? 5 : 4;
  const by = gy + cellH + (land ? 104 : 112);
  // Lay out the bytes after the first two: extended length, masking key, payload.
  const items: { group: ByteCell['group']; i: number }[] = [];
  f.ext.forEach((_, i) => items.push({ group: 'ext', i }));
  (f.key ?? []).forEach((_, i) => items.push({ group: 'key', i }));
  const shownPayload = Math.min(f.payload.length, land ? 6 : 5);
  for (let i = 0; i < shownPayload; i++) items.push({ group: 'payload', i });
  if (f.more > 0 || f.payload.length > shownPayload) items.push({ group: 'more', i: 0 });
  const perRow = Math.max(1, Math.floor((w - (land ? 80 : 24) + gapB) / (bw + gapB)));
  const rows = Math.ceil(items.length / perRow) || 1;
  const rowW = (n: number) => n * bw + (n - 1) * gapB;
  const bytes: ByteCell[] = items.map((it, k) => {
    const r = Math.floor(k / perRow);
    const inRow = Math.min(perRow, items.length - r * perRow);
    const x0 = (w - rowW(inRow)) / 2;
    return { ...it, x: x0 + (k % perRow) * (bw + gapB), y: by + r * (bh + 30) };
  });
  const groups: FrameGeo['groups'] = [];
  for (const b of bytes) {
    const last = groups[groups.length - 1];
    if (last && last.group === b.group && last.y === b.y) last.x1 = b.x + bw;
    else groups.push({ group: b.group, x0: b.x, x1: b.x + bw, y: b.y });
  }
  const sumY = by + rows * (bh + 30) + (land ? 10 : 4);
  return { land, pipeY, cliX: land ? w * 0.2 : 62, srvX: land ? w * 0.8 : w - 62, gx, gy, cell, cellH, bx: 0, by, bw, bh, bytes, groups, sumY };
}

/** Rectangle around one header field in the bit grid. */
export function fieldRect(g: FrameGeo, id: FieldGeo['id']): Rect {
  const f = FIELDS.find((x) => x.id === id)!;
  return { x: g.gx + (f.from + f.n / 2) * g.cell, y: g.gy + g.cellH / 2, w: f.n * g.cell, h: g.cellH };
}
