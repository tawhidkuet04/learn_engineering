import { SIG } from '@/lib/sim/colors';

/* ------------------------------------------------------------------ */
/* Growth classes                                                      */
/* ------------------------------------------------------------------ */

export type ClassId = 'c1' | 'logn' | 'n' | 'nlogn' | 'n2' | 'exp';

export interface ClassSpec {
  id: ClassId;
  /** "O(n log n)" */
  big: string;
  /** "n log n" */
  short: string;
  name: string;
  example: string;
  color: string;
  /** log10 of the step count for input size n (at least one step) */
  lg: (n: number) => number;
}

const LOG10_2 = Math.log10(2);
const log2 = (n: number) => Math.log2(Math.max(1, n));

export const CLASSES: Record<ClassId, ClassSpec> = {
  c1: { id: 'c1', big: 'O(1)', short: '1', name: 'constant', example: 'arr[i], set.has(x)', color: SIG.res, lg: () => 0 },
  logn: { id: 'logn', big: 'O(log n)', short: 'log n', name: 'logarithmic', example: 'binary search', color: SIG.lime, lg: (n) => Math.log10(Math.max(1, log2(n))) },
  n: { id: 'n', big: 'O(n)', short: 'n', name: 'linear', example: 'linear scan', color: SIG.req, lg: (n) => Math.log10(Math.max(1, n)) },
  nlogn: {
    id: 'nlogn',
    big: 'O(n log n)',
    short: 'n log n',
    name: 'linearithmic',
    example: 'merge sort',
    color: SIG.hc,
    lg: (n) => Math.log10(Math.max(1, n * log2(n))),
  },
  n2: { id: 'n2', big: 'O(n²)', short: 'n²', name: 'quadratic', example: 'all pairs', color: SIG.heavy, lg: (n) => 2 * Math.log10(Math.max(1, n)) },
  exp: { id: 'exp', big: 'O(2ⁿ)', short: '2ⁿ', name: 'exponential', example: 'every subset', color: SIG.err, lg: (n) => n * LOG10_2 },
};

export const CLASS_IDS: ClassId[] = ['c1', 'logn', 'n', 'nlogn', 'n2', 'exp'];

/** Step count as a plain number (Infinity when it overflows a double). */
export function stepsOf(id: ClassId, n: number): number {
  const lg = CLASSES[id].lg(n);
  return lg > 300 ? Infinity : 10 ** lg;
}

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';
export const sup = (k: number) =>
  String(k)
    .split('')
    .map((c) => (c >= '0' && c <= '9' ? SUP[+c] : c))
    .join('');

export const commas = (x: number) => Math.round(x).toLocaleString('en-US');

/** "1,000" · "19.9 million" · "1 trillion" · "10³⁰¹⁰²⁹" from log10 of a count. */
export function fmtCountLg(lg: number): string {
  if (lg < 7) return commas(10 ** lg);
  if (lg < 15) {
    const x = 10 ** lg;
    const [div, word] = lg < 9 ? [1e6, 'million'] : lg < 12 ? [1e9, 'billion'] : [1e12, 'trillion'];
    const v = x / div;
    return `${v >= 100 ? Math.round(v) : trim(v, 1)} ${word}`;
  }
  return `10${sup(Math.floor(lg))}`;
}

export const fmtCount = (x: number) => (x <= 0 ? '0' : fmtCountLg(Math.log10(x)));

function trim(v: number, d: number) {
  const s = v.toFixed(d);
  return s.endsWith('.0') ? s.slice(0, -2) : s;
}

const YEAR_S = 365.25 * 86400;
/** Age of the universe, 13.8 billion years, in log10 nanoseconds. */
export const UNIVERSE_LG_NS = Math.log10(13.8e9 * YEAR_S * 1e9);

/** Human time for 10^lgNs nanoseconds: "20 ns", "1 ms", "16.7 min", "10³⁰¹⁰¹³ years". */
export function fmtTimeLg(lgNs: number): string {
  if (lgNs < 3) return `${Math.round(10 ** lgNs)} ns`;
  const s = 10 ** (lgNs - 9);
  if (lgNs < 6) return `${num(s * 1e6)} µs`;
  if (lgNs < 9) return `${num(s * 1e3)} ms`;
  if (s < 60) return `${num(s)} s`;
  if (s < 3600) return `${num(s / 60)} min`;
  if (s < 86400) return `${num(s / 3600)} hours`;
  if (s < YEAR_S) return `${num(s / 86400)} days`;
  const lgY = lgNs - 9 - Math.log10(YEAR_S);
  if (lgY < 3) return `${num(10 ** lgY)} years`;
  if (lgY < 6) return `${num(10 ** (lgY - 3))} thousand years`;
  if (lgY < 9) return `${num(10 ** (lgY - 6))} million years`;
  if (lgY < 12) return `${num(10 ** (lgY - 9))} billion years`;
  return `10${sup(Math.floor(lgY))} years`;
}

/** 3 significant-ish digits: 1, 20, 16.7, 1.4 */
function num(v: number) {
  if (v >= 100) return commas(v);
  if (v >= 10) return trim(v, 1);
  return trim(v, 1);
}

/* ------------------------------------------------------------------ */
/* Fibonacci                                                           */
/* ------------------------------------------------------------------ */

export function fibNum(n: number) {
  let a = 0;
  let b = 1;
  for (let i = 0; i < n; i++) [a, b] = [b, a + b];
  return a;
}

/** Calls made by the naive recursive fib(n): 2·F(n+1) − 1. */
export const fibCalls = (n: number) => 2 * fibNum(n + 1) - 1;
/** Calls made by the memoized version: 2n − 1 (n ≥ 1). */
export const memoCalls = (n: number) => Math.max(1, 2 * n - 1);

/* ------------------------------------------------------------------ */
/* Binary search                                                       */
/* ------------------------------------------------------------------ */

/** Loop iterations binary search needs to find index t in [0, n). */
export function bsIterations(n: number, t: number) {
  let lo = 0;
  let hi = n - 1;
  let k = 0;
  while (lo <= hi) {
    k++;
    const mid = Math.floor((lo + hi) / 2);
    if (mid === t) return k;
    if (mid < t) lo = mid + 1;
    else hi = mid - 1;
  }
  return k;
}

/** Worst case: ⌊log₂ n⌋ + 1 iterations. */
export const bsWorst = (n: number) => Math.floor(Math.log2(n)) + 1;

/** A target index near `near` that takes the worst-case number of iterations. */
export function worstTarget(n: number, near: number) {
  const want = bsWorst(n);
  for (let d = 0; d < 4096; d++) {
    for (const t of [near + d, near - d]) if (t >= 0 && t < n && bsIterations(n, t) === want) return t;
  }
  return near;
}

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

export const ease = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
export const easeOut = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : 1 - (1 - t) * (1 - t) * (1 - t));
export const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);
export const place = (i: number) => (i === 0 ? '1st' : i === 1 ? '2nd' : i === 2 ? '3rd' : `${i + 1}th`);
