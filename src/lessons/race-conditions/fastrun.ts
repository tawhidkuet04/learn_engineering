/**
 * The "run it 1,000 times" experiment: every thread runs its loop on its own
 * core at the same time. Time is counted in abstract ticks.
 *
 * Costs are illustrative, not measured, but keep the real-world ordering:
 * a plain load/add/store is cheapest, an atomic read-modify-write holds the
 * cache line for a few ticks (nobody else can touch `count` meanwhile), and
 * a contended mutex is slowest because a waiting thread sleeps and must be
 * woken up. Now and then the OS pauses a thread for a while (a context
 * switch), which is what makes every racy run come out differently.
 */

export type Strategy = 'none' | 'mutex' | 'faa' | 'cas';

type Op = 'WORK' | 'LD' | 'ADD' | 'ST' | 'LOCK' | 'UNLOCK' | 'FAA' | 'CAS' | 'WAKE';

export interface FastParams {
  strategy: Strategy;
  threads: number;
  per: number;
  /** Private work (ticks) each loop iteration does outside the critical section */
  work: number;
  start: number;
}

export interface FastSample {
  tick: number;
  count: number;
  done: number[];
  lost: number;
  waiting: number[];
  /** Thread holding the mutex (index), or -1 */
  owner: number;
}

export interface FastResult {
  params: FastParams;
  final: number;
  expected: number;
  lost: number;
  ticks: number;
  /** Share of thread-time spent blocked or stalled */
  waitShare: number;
  retries: number;
  samples: FastSample[];
}

const JITTER = 0.3;
const DESCHED = 0.003;
const WAKE = 8;

function program(s: Strategy, work: number): Op[] {
  const w: Op[] = work > 0 ? ['WORK'] : [];
  if (s === 'mutex') return [...w, 'LOCK', 'LD', 'ADD', 'ST', 'UNLOCK'];
  if (s === 'faa') return [...w, 'FAA'];
  if (s === 'cas') return [...w, 'LD', 'ADD', 'CAS'];
  return [...w, 'LD', 'ADD', 'ST'];
}

interface T {
  pc: number;
  iter: number;
  r: number;
  old: number;
  busyUntil: number;
  pending: Op | null;
  blocked: boolean;
  startAt: number;
  pauseUntil: number;
  done: boolean;
  waited: number;
  alive: number;
}

export function fastRun(p: FastParams, rng: () => number): FastResult {
  const prog = program(p.strategy, p.work);
  const casRetryTo = prog.indexOf('LD');
  const ts: T[] = Array.from({ length: p.threads }, (_, i) => ({
    pc: 0,
    iter: 0,
    r: 0,
    old: 0,
    busyUntil: 0,
    pending: null,
    blocked: false,
    // Threads start a little apart, like real thread creation.
    startAt: i === 0 ? 0 : Math.floor(rng() * 120),
    pauseUntil: 0,
    done: false,
    waited: 0,
    alive: 0,
  }));
  let count = p.start;
  let cellBusy = 0;
  let owner = -1;
  const queue: number[] = [];
  let incs = 0;
  let retries = 0;
  let tick = 0;
  let every = 1;
  let samples: FastSample[] = [];
  const snap = () => {
    samples.push({
      tick,
      count,
      done: ts.map((t) => t.iter),
      lost: incs - (count - p.start),
      waiting: ts.map((t) => (t.blocked ? 1 : 0)),
      owner,
    });
    if (samples.length > 360) {
      samples = samples.filter((_, i) => i % 2 === 0);
      every *= 2;
    }
  };

  const jitter = () => (rng() < JITTER ? 1 + Math.floor(rng() * 3) : 0);
  const cost = (op: Op) => {
    if (op === 'WORK') return p.work + Math.floor(rng() * (p.work + 1));
    if (op === 'LD' || op === 'ST') return 1 + jitter();
    if (op === 'ADD') return 1;
    if (op === 'UNLOCK') return 2;
    return 3 + jitter();
  };
  const order = ts.map((_, i) => i);
  const advance = (t: T) => {
    t.pc++;
    if (t.pc >= prog.length) {
      t.pc = 0;
      t.iter++;
      if (t.iter >= p.per) t.done = true;
    }
  };

  snap();
  for (tick = 0; tick < 4_000_000; tick++) {
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    // 1. Finish operations that complete this tick (in random order).
    for (const i of order) {
      const t = ts[i];
      if (!t.pending || t.busyUntil > tick) continue;
      const op = t.pending;
      t.pending = null;
      if (op === 'LD') {
        t.r = count;
        t.old = count;
        advance(t);
      } else if (op === 'ADD') {
        t.r += 1;
        advance(t);
      } else if (op === 'ST') {
        count = t.r;
        incs++;
        advance(t);
      } else if (op === 'FAA') {
        count += 1;
        incs++;
        advance(t);
      } else if (op === 'CAS') {
        if (count === t.old) {
          count = t.old + 1;
          incs++;
          advance(t);
        } else {
          retries++;
          t.pc = casRetryTo;
        }
      } else if (op === 'UNLOCK') {
        owner = -1;
        const n = queue.shift();
        if (n != null) {
          owner = n;
          const w = ts[n];
          w.blocked = false;
          w.pending = 'WAKE';
          w.busyUntil = tick + WAKE;
        }
        advance(t);
      } else {
        advance(t);
      }
    }
    // 2. Start the next operation on every idle core.
    let alive = false;
    for (const i of order) {
      const t = ts[i];
      if (t.done) continue;
      alive = true;
      if (tick < t.startAt) continue;
      t.alive++;
      if (t.pending === 'WAKE') {
        t.waited++;
        continue;
      }
      if (t.pending) continue;
      if (t.blocked) {
        t.waited++;
        continue;
      }
      if (tick < t.pauseUntil) continue;
      if (rng() < DESCHED) {
        t.pauseUntil = tick + 30 + Math.floor(rng() * 150);
        continue;
      }
      const op = prog[t.pc];
      if ((op === 'LD' || op === 'ST' || op === 'FAA' || op === 'CAS') && cellBusy > tick) {
        t.waited++;
        continue;
      }
      if (op === 'LOCK') {
        if (owner === -1) owner = i;
        else {
          t.blocked = true;
          queue.push(i);
          t.waited++;
          continue;
        }
      }
      const c = cost(op);
      t.pending = op;
      t.busyUntil = tick + c;
      if (op === 'FAA' || op === 'CAS') cellBusy = tick + c;
    }
    if (tick % every === 0) snap();
    if (!alive) break;
  }
  snap();

  const expected = p.start + p.threads * p.per;
  const alive = ts.reduce((a, t) => a + t.alive, 0);
  const waited = ts.reduce((a, t) => a + t.waited, 0);
  return {
    params: p,
    final: count,
    expected,
    lost: expected - count,
    ticks: tick,
    waitShare: alive ? waited / alive : 0,
    retries,
    samples,
  };
}
