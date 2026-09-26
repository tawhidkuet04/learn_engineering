import type { FibArea } from './engine/fib';
import type { BigOSim } from './sim';

/* Geometry for every view, shared by the scene, the overlays and callouts.
   Landscape keeps ~80px clear at the top (HUD) and ~96px at the bottom
   (controls, legend, title block). Portrait docks a readout strip above the
   controls, so content ends above it. */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Frame {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  land: boolean;
}

/** Height of the docked readout strip on phones, per view (0 = none). */
export function stripH(sim: BigOSim) {
  if (sim.orient === 'landscape') return 0;
  switch (sim.cfg.view) {
    case 'scan':
      return sim.cfg.scan === 'cases' ? 76 : 58;
    case 'binary':
      return sim.cfg.binary === 'array' ? 58 : 0;
    case 'merge':
    case 'grid':
    case 'fib':
      return 58;
    case 'chart':
      return 92;
    case 'classify':
      return 0;
    default:
      return 0;
  }
}

/** Rows the kit legend needs on a phone (it wraps at the stage width). */
export function legendRows(sim: BigOSim) {
  if (!sim.legendLabels.length) return 0;
  const avail = sim.w - 28;
  let rows = 1;
  let x = 0;
  for (const l of sim.legendLabels) {
    const iw = l.length * 5.9 + 26;
    if (x > 0 && x + iw > avail) {
      rows++;
      x = 0;
    }
    x += iw;
  }
  return rows;
}

export function frame(sim: BigOSim): Frame {
  const { w, h } = sim;
  if (sim.orient === 'landscape') return { x0: 28, y0: 82, x1: w - 28, y1: h - 98, land: true };
  const s = stripH(sim);
  const leg = s ? 0 : legendRows(sim) * 17;
  return { x0: 12, y0: 74, x1: w - 12, y1: h - 60 - (s ? s + 8 : leg ? leg + 6 : 0), land: false };
}

/** Width of the right-hand readout column in landscape. */
export const SIDE_W = 262;

/* ------------------------------------------------------------------ */
/* Race lanes                                                          */
/* ------------------------------------------------------------------ */

export interface LaneGeo {
  y: number;
  h: number;
  labelX: number;
  tx0: number;
  tx1: number;
  ty: number;
  valX: number;
}

export function raceGeo(sim: BigOSim, count: number): LaneGeo[] {
  const f = frame(sim);
  const space = sim.cfg.race === 'space';
  if (f.land) {
    const laneH = space ? 84 : 60;
    const gap = count <= 3 ? 30 : 18;
    const total = count * laneH + (count - 1) * gap;
    const top = f.y0 + Math.max(0, (f.y1 - f.y0 - total) / 2);
    const labelW = 184;
    const valW = 178;
    return Array.from({ length: count }, (_, i) => {
      const y = top + i * (laneH + gap);
      return { y, h: laneH, labelX: f.x0, tx0: f.x0 + labelW, tx1: f.x1 - valW, ty: y + (space ? 30 : laneH / 2), valX: f.x1 };
    });
  }
  const laneH = space ? 92 : 64;
  const gap = count <= 3 ? 22 : 10;
  const total = count * laneH + (count - 1) * gap;
  const top = f.y0 + Math.max(0, (f.y1 - f.y0 - total) / 2);
  return Array.from({ length: count }, (_, i) => {
    const y = top + i * (laneH + gap);
    return { y, h: laneH, labelX: f.x0 + 2, tx0: f.x0 + 4, tx1: f.x1 - 4, ty: y + 30, valX: f.x1 - 2 };
  });
}

/* ------------------------------------------------------------------ */
/* Array scan                                                          */
/* ------------------------------------------------------------------ */

export interface ScanGeo {
  cells: Rect[];
  cw: number;
  ch: number;
  arrY: number;
  /** Register / target chip */
  reg: { x: number; y: number };
  /** Bottom panel: dots chart (max) or cost bars (cases) */
  panel: { x0: number; y0: number; x1: number; y1: number };
  land: boolean;
}

export function scanGeo(sim: BigOSim, n: number): ScanGeo {
  const f = frame(sim);
  const cases = sim.cfg.scan === 'cases';
  const search = sim.cfg.scan === 'search';
  if (f.land) {
    const gap = 6;
    const cw = Math.min(48, (f.x1 - f.x0 - 40 - (n - 1) * gap) / n);
    const ch = 44;
    const arrY = search ? f.y0 + (f.y1 - f.y0) / 2 - 110 : f.y0 + 58;
    const total = n * cw + (n - 1) * gap;
    const x0 = (f.x0 + f.x1) / 2 - total / 2;
    const cells = Array.from({ length: n }, (_, i) => ({ x: x0 + i * (cw + gap), y: arrY, w: cw, h: ch }));
    const panelTop = arrY + ch + 104;
    const pw = cases ? 470 : 400;
    return {
      cells,
      cw,
      ch,
      arrY,
      reg: { x: (f.x0 + f.x1) / 2, y: arrY + ch + 46 },
      panel: { x0: f.x0 + 60, y0: panelTop, x1: f.x0 + 60 + pw, y1: Math.min(f.y1, panelTop + 250) },
      land: true,
    };
  }
  const gap = n > 12 ? 3 : 5;
  const cw = Math.min(40, (f.x1 - f.x0 - (n - 1) * gap) / n);
  const ch = 28;
  const arrY = search ? f.y0 + 70 : f.y0 + 34;
  const total = n * cw + (n - 1) * gap;
  const x0 = (f.x0 + f.x1) / 2 - total / 2;
  const cells = Array.from({ length: n }, (_, i) => ({ x: x0 + i * (cw + gap), y: arrY, w: cw, h: ch }));
  const panelTop = arrY + ch + 92;
  return {
    cells,
    cw,
    ch,
    arrY,
    reg: { x: (f.x0 + f.x1) / 2, y: arrY + ch + 34 },
    panel: { x0: f.x0 + 34, y0: panelTop, x1: f.x1 - 10, y1: Math.max(panelTop + 110, f.y1) },
    land: false,
  };
}

/* ------------------------------------------------------------------ */
/* Binary search                                                       */
/* ------------------------------------------------------------------ */

export function binaryCells(sim: BigOSim, count = 32): { cells: Rect[]; cw: number; ch: number; rows: number } {
  const f = frame(sim);
  if (f.land) {
    const gap = 3;
    const cw = Math.min(30, (f.x1 - f.x0 - 20 - (count - 1) * gap) / count);
    const ch = 36;
    const total = count * cw + (count - 1) * gap;
    const x0 = (f.x0 + f.x1) / 2 - total / 2;
    const y = f.y0 + 96;
    return { cells: Array.from({ length: count }, (_, i) => ({ x: x0 + i * (cw + gap), y, w: cw, h: ch })), cw, ch, rows: 1 };
  }
  const per = 8;
  const gap = 5;
  const cw = Math.min(40, (f.x1 - f.x0 - (per - 1) * gap) / per);
  const ch = 30;
  const pitch = 58;
  const total = per * cw + (per - 1) * gap;
  const x0 = (f.x0 + f.x1) / 2 - total / 2;
  const y0 = f.y0 + 34;
  return {
    cells: Array.from({ length: count }, (_, i) => ({ x: x0 + (i % per) * (cw + gap), y: y0 + Math.floor(i / per) * pitch, w: cw, h: ch })),
    cw,
    ch,
    rows: Math.ceil(count / per),
  };
}

export interface BigGeo {
  bx0: number;
  bx1: number;
  by: number;
  bh: number;
  oy: number;
  ladder: { x0: number; x1: number; y: number; per: number; cw: number; chH: number; gap: number };
}

export function bigGeo(sim: BigOSim): BigGeo {
  const f = frame(sim);
  if (f.land) {
    const bx0 = f.x0 + 40;
    const bx1 = f.x1 - 40;
    return { bx0, bx1, by: f.y0 + 96, bh: 38, oy: f.y0 + 204, ladder: { x0: bx0, x1: bx1, y: f.y0 + 290, per: 8, cw: (bx1 - bx0 - 7 * 10) / 8, chH: 26, gap: 10 } };
  }
  const bx0 = f.x0 + 8;
  const bx1 = f.x1 - 8;
  const per = 5;
  const gap = 6;
  return { bx0, bx1, by: f.y0 + 62, bh: 30, oy: f.y0 + 150, ladder: { x0: bx0, x1: bx1, y: f.y0 + 196, per, cw: (bx1 - bx0 - (per - 1) * gap) / per, chH: 22, gap } };
}

/* ------------------------------------------------------------------ */
/* Merge sort tree                                                     */
/* ------------------------------------------------------------------ */

export interface MergeGeo {
  cell: number;
  ch: number;
  rowY: (l: number) => number;
  cellX: (l: number, i: number) => number;
  labelX: number;
  rightX: number;
  land: boolean;
}

export function mergeGeo(sim: BigOSim, n: number, L: number): MergeGeo {
  const f = frame(sim);
  const land = f.land;
  const labelW = land ? 128 : 0;
  const rightW = land ? 132 : 0;
  const ax0 = f.x0 + labelW;
  const ax1 = f.x1 - rightW;
  const areaW = ax1 - ax0;
  const gapDeep = land ? 14 : 4;
  const cell = Math.min(land ? 38 : 30, (areaW - (n - 1) * gapDeep) / n);
  const inner = land ? 2 : 1.5;
  const ch = land ? Math.min(34, cell) : 24;
  const W = Math.min(areaW, n * cell + (n - 1) * gapDeep + (land ? 0 : 0));
  const X0 = (ax0 + ax1) / 2 - W / 2;
  const pitch = Math.min(land ? 94 : 76, (f.y1 - f.y0 - ch - (land ? 20 : 8)) / Math.max(1, L));
  const top = f.y0 + (land ? 18 : 6) + Math.max(0, (f.y1 - f.y0 - (land ? 20 : 8) - ch - pitch * L) / 2);
  return {
    cell,
    ch,
    rowY: (l) => top + l * pitch,
    cellX: (l, i) => {
      const size = n >> l;
      const g = Math.floor(i / size);
      const k = i % size;
      const segW = W / (1 << l);
      const groupW = size * cell + (size - 1) * inner;
      return X0 + g * segW + (segW - groupW) / 2 + k * (cell + inner);
    },
    labelX: f.x0,
    rightX: f.x1,
    land,
  };
}

/* ------------------------------------------------------------------ */
/* n × n grid                                                          */
/* ------------------------------------------------------------------ */

export interface GridGeo {
  gx: number;
  gy: number;
  cell: number;
  hs: number;
}

export function gridGeo(sim: BigOSim, n: number): GridGeo {
  const f = frame(sim);
  if (f.land) {
    const areaX1 = f.x1 - SIDE_W - 30;
    const hs = 30;
    const S = Math.min(f.y1 - f.y0 - hs - 10, areaX1 - f.x0 - hs - 20, 16 * 36);
    const cell = S / n;
    const gx = f.x0 + hs + 16 + (areaX1 - f.x0 - hs - 16 - S) / 2;
    const gy = f.y0 + hs + 4 + (f.y1 - f.y0 - hs - 4 - S) / 2;
    return { gx, gy, cell, hs };
  }
  const hs = 20;
  const S = Math.min(f.x1 - f.x0 - hs - 6, f.y1 - f.y0 - hs - 6, 16 * 22);
  const cell = S / n;
  const gx = f.x0 + hs + 4 + (f.x1 - f.x0 - hs - 4 - S) / 2;
  const gy = f.y0 + hs + 2 + Math.max(0, (f.y1 - f.y0 - hs - 2 - S) / 2);
  return { gx, gy, cell, hs };
}

/* ------------------------------------------------------------------ */
/* Fib call tree                                                       */
/* ------------------------------------------------------------------ */

export function fibArea(sim: BigOSim): FibArea {
  const f = frame(sim);
  if (f.land) return { x0: f.x0 + 30, y0: f.y0 + 22, x1: f.x1 - SIDE_W - 40, y1: f.y1 - 12, r: 16 };
  return { x0: f.x0 + 12, y0: f.y0 + 14, x1: f.x1 - 12, y1: f.y1 - 6, r: 11 };
}

/* ------------------------------------------------------------------ */
/* Chart                                                               */
/* ------------------------------------------------------------------ */

export interface PlotGeo {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function plotGeo(sim: BigOSim): PlotGeo {
  const f = frame(sim);
  if (f.land) return { x0: f.x0 + 62, y0: f.y0 + 8, x1: f.x1 - SIDE_W - 44, y1: f.y1 - 30 };
  return { x0: f.x0 + 40, y0: f.y0 + 6, x1: f.x1 - 12, y1: f.y1 - 24 };
}

/* ------------------------------------------------------------------ */
/* Time-lapse race                                                     */
/* ------------------------------------------------------------------ */

export interface LapseGeo {
  rulerY: number;
  lanes: LaneGeo[];
  tx0: number;
  tx1: number;
}

export function lapseGeo(sim: BigOSim, count: number): LapseGeo {
  const f = frame(sim);
  if (f.land) {
    const laneH = 52;
    const gap = 14;
    const total = count * laneH + (count - 1) * gap;
    const top = f.y0 + 58 + Math.max(0, (f.y1 - f.y0 - 58 - total) / 2);
    const tx0 = f.x0 + 150;
    const tx1 = f.x1 - 176;
    const lanes = Array.from({ length: count }, (_, i) => {
      const y = top + i * (laneH + gap);
      return { y, h: laneH, labelX: f.x0, tx0, tx1, ty: y + laneH / 2, valX: f.x1 };
    });
    return { rulerY: top - 26, lanes, tx0, tx1 };
  }
  const laneH = 50;
  const gap = count > 4 ? 6 : 14;
  const total = count * laneH + (count - 1) * gap;
  const top = f.y0 + 40 + Math.max(0, (f.y1 - f.y0 - 40 - total) / 2);
  const tx0 = f.x0 + 4;
  const tx1 = f.x1 - 4;
  const lanes = Array.from({ length: count }, (_, i) => {
    const y = top + i * (laneH + gap);
    return { y, h: laneH, labelX: f.x0 + 2, tx0, tx1, ty: y + 26, valX: f.x1 - 2 };
  });
  return { rulerY: top - 20, lanes, tx0, tx1 };
}

/* ------------------------------------------------------------------ */
/* Classify                                                            */
/* ------------------------------------------------------------------ */

export interface ClassifyGeo {
  code: { x: number; y: number; w: number };
  test: { x0: number; y0: number; x1: number; y1: number };
}

export function classifyGeo(sim: BigOSim): ClassifyGeo {
  const f = frame(sim);
  if (f.land) {
    const w = Math.min(560, f.x1 - f.x0 - 40);
    const x = (f.x0 + f.x1) / 2 - w / 2;
    return { code: { x, y: f.y0 + 6, w }, test: { x0: x, y0: f.y0 + 214, x1: x + w, y1: Math.min(f.y1, f.y0 + 470) } };
  }
  return { code: { x: f.x0, y: f.y0 - 2, w: f.x1 - f.x0 }, test: { x0: f.x0 + 4, y0: f.y0 + 178, x1: f.x1 - 4, y1: f.y1 - 4 } };
}

/* ------------------------------------------------------------------ */
/* Callouts                                                            */
/* ------------------------------------------------------------------ */

export function calloutRect(sim: BigOSim, target: string): Rect | null {
  const land = sim.orient === 'landscape';
  if (target.startsWith('wide:')) return land ? calloutRect(sim, target.slice(5)) : null;
  const v = sim.cfg.view;
  if (v === 'race' && target.startsWith('lane:')) {
    const idx = sim.race.lanes.findIndex((l) => l.id === target.slice(5));
    const g = raceGeo(sim, sim.race.lanes.length)[idx];
    return g ? { x: (g.tx0 + g.tx1) / 2, y: g.ty, w: g.tx1 - g.tx0, h: 18 } : null;
  }
  if (v === 'race' && target === 'steps') {
    const gs = raceGeo(sim, sim.race.lanes.length);
    const a = gs[0];
    const b = gs[gs.length - 1];
    if (!a || !b) return null;
    return land ? { x: a.valX - 70, y: (a.y + b.y + b.h) / 2, w: 150, h: b.y + b.h - a.y } : { x: a.valX - 50, y: b.y + b.h, w: 100, h: 10 };
  }
  if (v === 'scan' && target === 'dots') {
    const g = scanGeo(sim, sim.scan.n);
    const p = g.panel;
    return { x: (p.x0 + p.x1) / 2, y: (p.y0 + p.y1) / 2, w: p.x1 - p.x0, h: p.y1 - p.y0 };
  }
  if (v === 'binary' && target === 'mid') {
    const m = sim.bin.mid ?? 15;
    const c = binaryCells(sim).cells[m];
    return c ? { x: c.x + c.w / 2, y: c.y + c.h / 2, w: c.w, h: c.h } : null;
  }
  if (v === 'grid' && target === 'grid') {
    const g = gridGeo(sim, sim.grid.n);
    const S = g.cell * sim.grid.n;
    return { x: g.gx + S / 2, y: g.gy + S / 2, w: S, h: S };
  }
  if (v === 'merge' && target.startsWith('level:')) {
    const l = Number(target.slice(6));
    const g = mergeGeo(sim, sim.merge.n, sim.merge.L);
    const x0 = g.cellX(l, 0);
    const x1 = g.cellX(l, sim.merge.n - 1) + g.cell;
    return { x: (x0 + x1) / 2, y: g.rowY(l) + g.ch / 2, w: x1 - x0, h: g.ch };
  }
  if (v === 'fib' && target === 'root') {
    const b = sim.boxes.get('fib:root');
    return b ? { x: b.x, y: b.y, w: b.w, h: b.h } : null;
  }
  if (v === 'chart' && target === 'plot') {
    const p = plotGeo(sim);
    return { x: (p.x0 + p.x1) / 2, y: (p.y0 + p.y1) / 2, w: p.x1 - p.x0, h: p.y1 - p.y0 };
  }
  return null;
}
