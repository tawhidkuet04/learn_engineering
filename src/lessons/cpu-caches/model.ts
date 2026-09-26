/* Numbers the whole lesson shares. Latencies are load-to-use times for a
   typical 4–5 GHz desktop core (think Zen 4 or Raptor Lake), rounded. */

export const NS_HIT = 1;
export const NS_MISS = 100;
export const CYCLES_PER_NS = 4;

export const LINE_BYTES = 64;
export const ELEM_BYTES = 8;
export const PER_LINE = LINE_BYTES / ELEM_BYTES;
/** Where our toy array starts in memory (64-byte aligned). */
export const BASE_ADDR = 0x1000;

export type LevelId = 'l1' | 'l2' | 'l3' | 'ram';
export const LEVEL_IDS: LevelId[] = ['l1', 'l2', 'l3', 'ram'];

export interface Level {
  id: LevelId;
  name: string;
  size: string;
  where: string;
  short: string;
  /** The model's single number… */
  ns: number;
  /** …and the honest range */
  range: string;
  /** Capacity in bytes for the model (typical desktop) */
  bytes: number;
}

export const LEVELS: Record<LevelId, Level> = {
  l1: { id: 'l1', name: 'L1', size: '32–64 KB', where: 'per core', short: 'per core', ns: 1, range: '~1 ns', bytes: 32 * 1024 },
  l2: { id: 'l2', name: 'L2', size: '1–2 MB', where: 'per core', short: 'per core', ns: 4, range: '3–5 ns', bytes: 1024 * 1024 },
  l3: { id: 'l3', name: 'L3', size: 'tens of MB', where: 'shared by all cores', short: 'shared', ns: 15, range: '10–20 ns', bytes: 32 * 1024 * 1024 },
  ram: { id: 'ram', name: 'RAM', size: '16–64 GB', where: 'off-chip', short: 'off-chip', ns: 100, range: '80–100 ns', bytes: Infinity },
};

/** The "latency numbers" table, with the human-scale column (1 ns → 1 s). */
export const HUMAN_ROWS: { name: string; ns: number; note?: string }[] = [
  { name: 'Register', ns: 0.3 },
  { name: 'L1 hit', ns: 1 },
  { name: 'L2 hit', ns: 4 },
  { name: 'L3 hit', ns: 15 },
  { name: 'RAM', ns: 100 },
  { name: 'SSD read', ns: 100_000 },
  { name: 'Datacenter round trip', ns: 500_000 },
  { name: 'Across an ocean', ns: 100_000_000 },
];

const commas = (n: number) => Math.round(n).toLocaleString('en-US');

/** 1712 → "1,712 ns"; 12800 → "12,800 ns"; 100000 → "100 µs". */
export function fmtNs(ns: number, forceNs = false): string {
  if (ns < 1 && ns > 0) return `${ns.toFixed(1)} ns`;
  if (forceNs || ns < 100_000) return `${commas(ns)} ns`;
  if (ns < 1e6) return `${trim(ns / 1000)} µs`;
  if (ns < 1e9) return `${trim(ns / 1e6)} ms`;
  return `${trim(ns / 1e9)} s`;
}

function trim(v: number) {
  return v >= 100 ? String(Math.round(v)) : v >= 10 ? v.toFixed(1).replace(/\.0$/, '') : v.toFixed(2).replace(/\.?0+$/, '');
}

/** Human scale: treat every nanosecond as a second. */
export function human(ns: number): string {
  const s = ns;
  if (s < 1) return `${s.toFixed(1)} s`;
  if (s < 60) return `${Math.round(s)} s`;
  if (s < 3600) {
    const m = Math.floor(s / 60);
    const r = Math.round(s - m * 60);
    return r ? `${m} min ${r} s` : `${m} min`;
  }
  if (s < 48 * 3600) return `${Math.round(s / 3600)} hours`;
  if (s < 365 * 86400) return `${(s / 86400).toFixed(1).replace(/\.0$/, '')} days`;
  return `${(s / (365.25 * 86400)).toFixed(1).replace(/\.0$/, '')} years`;
}

export const hex = (n: number) => `0x${n.toString(16)}`;

/* ------------------------------------------------------------------ */
/* Capacity model (chapter 6): random reads over a working set          */
/* ------------------------------------------------------------------ */

/** Working-set sizes on the slider: 4 KB … 1 GB, doubling. */
export const WS_STEPS: number[] = Array.from({ length: 19 }, (_, i) => 2 ** (12 + i));

export function fmtBytes(b: number): string {
  if (b >= 1024 ** 3) return `${trim(b / 1024 ** 3)} GB`;
  if (b >= 1024 ** 2) return `${trim(b / 1024 ** 2)} MB`;
  return `${trim(b / 1024)} KB`;
}

/**
 * Where a random read over `ws` bytes is served from, assuming each level
 * keeps as much of the working set as fits: [L1, L2, L3, RAM] fractions.
 */
export function levelMix(ws: number): [number, number, number, number] {
  const f1 = Math.min(1, LEVELS.l1.bytes / ws);
  const f2 = Math.min(1, LEVELS.l2.bytes / ws);
  const f3 = Math.min(1, LEVELS.l3.bytes / ws);
  return [f1, f2 - f1, f3 - f2, 1 - f3];
}

export function avgNs(ws: number): number {
  const [a, b, c, d] = levelMix(ws);
  return a * LEVELS.l1.ns + b * LEVELS.l2.ns + c * LEVELS.l3.ns + d * LEVELS.ram.ns;
}

/** The smallest level the working set fits in. */
export function fitsIn(ws: number): LevelId {
  if (ws <= LEVELS.l1.bytes) return 'l1';
  if (ws <= LEVELS.l2.bytes) return 'l2';
  if (ws <= LEVELS.l3.bytes) return 'l3';
  return 'ram';
}
