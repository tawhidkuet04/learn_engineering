/**
 * The five rate-limiting algorithms, as pure functions over a per-key state.
 * Times are seconds on the limiter's clock. The simulation calls `decide`
 * when a request reaches the limiter; the stage draws the state directly.
 */

export type Algo = 'fixed' | 'log' | 'sliding' | 'token' | 'leaky';

export const ALGOS: Algo[] = ['fixed', 'log', 'sliding', 'token', 'leaky'];

export const ALGO_NAMES: Record<Algo, string> = {
  fixed: 'fixed window',
  log: 'sliding log',
  sliding: 'sliding counter',
  token: 'token bucket',
  leaky: 'leaky bucket',
};

export const ALGO_LABELS: Record<Algo, string> = {
  fixed: 'Fixed window',
  log: 'Sliding log',
  sliding: 'Sliding counter',
  token: 'Token bucket',
  leaky: 'Leaky bucket',
};

/** Window algorithms use limit/window; the buckets use capacity/rate. */
export interface Params {
  limit: number;
  window: number;
  capacity: number;
  rate: number;
}

export interface Queued {
  id: number;
  client: string;
  at: number;
}

export interface KeyState {
  key: string;
  /** fixed + sliding counter: index of the current fixed window */
  win: number;
  count: number;
  prev: number;
  /** sliding log: accept times, oldest first */
  log: number[];
  /** token bucket */
  tokens: number;
  last: number;
  /** leaky bucket: requests waiting to drip out */
  queue: Queued[];
  nextLeak: number;
  /** visual bookkeeping (limiter clock) */
  takeAt: number;
  fillAt: number;
}

export interface Decision {
  ok: boolean;
  algo: Algo;
  key: string;
  at: number;
  /** leaky bucket: accepted into the queue rather than forwarded right away */
  queued: boolean;
  /** fixed/log: count before this request · leaky: queue length before */
  count: number;
  limit: number;
  /** sliding counter */
  prev: number;
  weight: number;
  est: number;
  /** token bucket: tokens before this request */
  tokens: number;
  /** what's left for this key after the decision */
  remaining: number;
  /** seconds until a request from this key would be allowed again */
  retryAfter: number;
  /** seconds until the key is back to its full allowance */
  resetIn: number;
  winStart: number;
}

export function freshState(key: string, now: number, p: Params): KeyState {
  return {
    key,
    win: Math.floor(now / p.window),
    count: 0,
    prev: 0,
    log: [],
    tokens: p.capacity,
    last: now,
    queue: [],
    nextLeak: now,
    takeAt: -99,
    fillAt: -99,
  };
}

function cloneState(s: KeyState): KeyState {
  return { ...s, log: [...s.log], queue: [...s.queue] };
}

/** Fixed windows: start a new count when the clock crosses a window edge. */
export function roll(s: KeyState, now: number, p: Params) {
  const w = Math.floor(now / p.window + 1e-9);
  if (w !== s.win) {
    s.prev = w === s.win + 1 ? s.count : 0;
    s.count = 0;
    s.win = w;
  }
}

/** Sliding log: forget entries older than one window. */
export function prune(s: KeyState, now: number, p: Params) {
  const cut = now - p.window;
  while (s.log.length && s.log[0] <= cut + 1e-9) s.log.shift();
}

/** Token bucket: top up for the time that passed (lazily, no timers). */
export function refill(s: KeyState, now: number, p: Params) {
  if (now <= s.last) return;
  const before = s.tokens;
  s.tokens = Math.min(p.capacity, s.tokens + (now - s.last) * p.rate);
  s.last = now;
  if (Math.floor(s.tokens + 1e-9) > Math.floor(before + 1e-9)) s.fillAt = now;
}

/** The weight of the previous window in the sliding-counter estimate. */
export function overlap(now: number, p: Params) {
  const into = now - Math.floor(now / p.window + 1e-9) * p.window;
  return Math.max(0, 1 - into / p.window);
}

/** Bring a state up to date without deciding anything (for drawing). */
export function settle(s: KeyState, now: number, p: Params, algo: Algo) {
  if (algo === 'fixed' || algo === 'sliding') roll(s, now, p);
  else if (algo === 'log') prune(s, now, p);
  else if (algo === 'token') refill(s, now, p);
}

function core(s: KeyState, now: number, p: Params, algo: Algo): { ok: boolean; queued: boolean } {
  switch (algo) {
    case 'fixed': {
      roll(s, now, p);
      if (s.count >= p.limit) return { ok: false, queued: false };
      s.count += 1;
      return { ok: true, queued: false };
    }
    case 'sliding': {
      roll(s, now, p);
      const est = s.prev * overlap(now, p) + s.count;
      if (est >= p.limit - 1e-9) return { ok: false, queued: false };
      s.count += 1;
      return { ok: true, queued: false };
    }
    case 'log': {
      prune(s, now, p);
      if (s.log.length >= p.limit) return { ok: false, queued: false };
      s.log.push(now);
      return { ok: true, queued: false };
    }
    case 'token': {
      refill(s, now, p);
      if (s.tokens < 1 - 1e-9) return { ok: false, queued: false };
      s.tokens -= 1;
      s.takeAt = now;
      return { ok: true, queued: false };
    }
    case 'leaky': {
      if (s.queue.length === 0 && s.nextLeak < now) s.nextLeak = now;
      if (s.queue.length === 0 && now >= s.nextLeak - 1e-9) {
        // Empty bucket and the drip is ready: straight through.
        s.nextLeak = now + 1 / p.rate;
        return { ok: true, queued: false };
      }
      if (s.queue.length >= p.capacity) return { ok: false, queued: false };
      return { ok: true, queued: true };
    }
  }
}

/** Would a request at `now` be allowed? (No side effects.) */
export function wouldAllow(s: KeyState, now: number, p: Params, algo: Algo) {
  return core(cloneState(s), now, p, algo).ok;
}

function waitUntilAllowed(s: KeyState, now: number, p: Params, algo: Algo) {
  if (algo === 'leaky') return Math.max(0, s.nextLeak - now);
  if (algo === 'token') return s.tokens >= 1 ? 0 : (1 - s.tokens) / p.rate;
  if (algo === 'fixed') return s.count < p.limit ? 0 : (s.win + 1) * p.window - now;
  if (algo === 'log') return s.log.length < p.limit ? 0 : s.log[0] + p.window - now;
  // sliding counter: step forward until the estimate drops under the limit
  for (let dt = 0; dt <= p.window * 2; dt += 0.05) {
    if (wouldAllow(s, now + dt, p, algo)) return dt;
  }
  return p.window;
}

/**
 * Decide one request and update the state. For the leaky bucket the caller
 * pushes the request into `s.queue` when the result says `queued`.
 */
export function decide(s: KeyState, now: number, p: Params, algo: Algo): Decision {
  settle(s, now, p, algo);
  const count = algo === 'log' ? s.log.length : algo === 'leaky' ? s.queue.length : s.count;
  const tokens = s.tokens;
  const prev = s.prev;
  const weight = overlap(now, p);
  const est = prev * weight + s.count;
  const winStart = s.win * p.window;
  const { ok, queued } = core(s, now, p, algo);

  let remaining = 0;
  let resetIn = 0;
  if (algo === 'fixed') {
    remaining = Math.max(0, p.limit - s.count);
    resetIn = (s.win + 1) * p.window - now;
  } else if (algo === 'sliding') {
    remaining = Math.max(0, Math.floor(p.limit - (s.prev * weight + s.count) + 1e-9));
    resetIn = (s.win + 1) * p.window - now;
  } else if (algo === 'log') {
    remaining = Math.max(0, p.limit - s.log.length);
    resetIn = s.log.length ? s.log[0] + p.window - now : 0;
  } else if (algo === 'token') {
    remaining = Math.max(0, Math.floor(s.tokens + 1e-9));
    resetIn = (p.capacity - s.tokens) / p.rate;
  } else {
    remaining = Math.max(0, p.capacity - s.queue.length - (queued ? 1 : 0));
    resetIn = (s.queue.length + (queued ? 1 : 0)) / p.rate;
  }
  const retryAfter = ok ? 0 : waitUntilAllowed(s, now, p, algo);
  return { ok, algo, key: s.key, at: now, queued, count, limit: algo === 'token' || algo === 'leaky' ? p.capacity : p.limit, prev, weight, est, tokens, remaining, retryAfter, resetIn, winStart };
}

/** Token bucket dry run: how many of these arrivals would get a token? */
export function countAllowed(s: KeyState, arrivals: number[], p: Params, algo: Algo) {
  const c = cloneState(s);
  let n = 0;
  for (const at of arrivals) if (core(c, at, p, algo).ok) n++;
  return n;
}

/** Most requests accepted inside any `span`-second stretch (two-pointer sweep). */
export function busiestSpan(times: number[], span: number): { count: number; start: number } {
  let best = { count: 0, start: 0 };
  let i = 0;
  for (let j = 0; j < times.length; j++) {
    while (times[j] - times[i] >= span - 1e-9) i++;
    const n = j - i + 1;
    if (n > best.count) best = { count: n, start: times[i] };
  }
  return best;
}
