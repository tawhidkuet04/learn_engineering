/**
 * Helpers for the Rate Limiting checks:
 * - turn the lesson's `limit_req` snippets into runnable nginx configs,
 * - read what nginx decided for each request from its access log,
 * - send numbered requests on a schedule,
 * - play the lesson's own simulation headlessly and collect its decisions,
 * - run the lesson's Redis snippets (redis-cli commands, gateway.js) as written.
 */
import { readFileSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import { CHAPTERS } from '@/lessons/rate-limiting/chapters';
import { DEFAULTS, RateSim } from '@/lessons/rate-limiting/sim';
import { nginxHttp, type Prepared } from './confs';
import { sleep } from './procs';
import { plain } from './snippets';

/* ------------------------------------------------------------------ */
/* nginx                                                               */
/* ------------------------------------------------------------------ */

/** A `limit_req_zone` statement (it can span lines). */
const ZONE = /^[ \t]*limit_req_zone\b[^;]*;[ \t]*\n?/gm;

/** The `limit_req_zone` statements a snippet defines, as written. */
export function zonesIn(code: string): string[] {
  return [...plain(code).matchAll(ZONE)].map((m) => m[0].trim().replace(/\s+/g, ' '));
}

/**
 * What nginx logs for every request in these checks: when it finished, how
 * long it took (so when it arrived), how long the backend took (so when it
 * was let through), the status, what limit_req decided, and the request number.
 */
export const LOG_FORMAT = "log_format rl '$msec $request_time $upstream_response_time $status $limit_req_status $arg_i';";

/**
 * A `limit_req` snippet made loadable inside `http {}`. Only mechanical changes:
 * - `limit_req_zone` moves to the http level (it isn't allowed in a server),
 * - a zone the snippet uses but doesn't define comes from `zones` (the lesson defined it in an earlier step),
 * - location blocks get a `server {}` on 127.0.0.1:<port>, `proxy_pass http://backend` gets a stub upstream (confs.ts),
 * - with `log`, that server writes the access log above to that file.
 */
export function limitReqHttp(code: string, opts: { port: number; backend?: string; zones?: string[]; log?: string }): Prepared {
  const changes: string[] = [];
  let body = plain(code);
  const zones = [...body.matchAll(ZONE)].map((m) => m[0].trim());
  if (zones.length) {
    body = body.replace(ZONE, '').replace(/^\n+/, '');
    changes.push('limit_req_zone moved to the http level');
  }
  for (const m of body.matchAll(/limit_req\s+zone=([\w-]+)/g)) {
    if (zones.some((z) => z.includes(`zone=${m[1]}:`))) continue;
    const borrowed = (opts.zones ?? []).find((z) => z.includes(`zone=${m[1]}:`));
    if (!borrowed) throw new Error(`the snippet uses zone "${m[1]}" but nothing defines it`);
    zones.push(borrowed);
    changes.push(`added the "${m[1]}" zone the lesson defined earlier`);
  }
  const inner = nginxHttp(body, { port: opts.port, stub: opts.backend });
  changes.push(...inner.changes);
  let text = inner.text;
  if (opts.log) {
    const listen = `listen 127.0.0.1:${opts.port};`;
    if (!text.includes(listen)) throw new Error('no server block to log from');
    text = text.replace(listen, `${listen}\n    access_log ${opts.log} rl;`);
    changes.push('access log with arrival and release times');
  }
  return { text: [opts.log ? LOG_FORMAT : '', ...zones, text].filter(Boolean).join('\n'), changes };
}

export type LimitReqStatus = 'PASSED' | 'DELAYED' | 'REJECTED';

/** One request as nginx logged it. Times are milliseconds on nginx's clock. */
export interface Logged {
  i: number;
  status: number;
  /** $limit_req_status */
  decision: LimitReqStatus;
  arrived: number;
  /** When nginx let it through to the backend, or null if it was rejected */
  released: number | null;
}

const RANK: Record<string, number> = { PASSED: 0, DELAYED: 1, REJECTED: 2 };

/**
 * The access log in the order nginx handled the requests: by arrival, and
 * within one millisecond, the ones it let through first (in the order it
 * released them), then the ones it refused. Nothing gets through after a
 * refusal in the same millisecond, so that is the order they were decided in.
 */
export function readLog(file: string): Logged[] {
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => {
      const [msec, reqTime, upTime, status, decision, i] = l.trim().split(/\s+/);
      const done = Math.round(Number(msec) * 1000);
      return {
        i: Number(i),
        status: Number(status),
        decision: decision as LimitReqStatus,
        arrived: done - Math.round(Number(reqTime) * 1000),
        released: upTime === '-' ? null : done - Math.round(Number(upTime) * 1000),
      };
    })
    .sort((a, b) => a.arrived - b.arrived || RANK[a.decision] - RANK[b.decision] || (a.released ?? 0) - (b.released ?? 0) || a.i - b.i);
}

export interface Sent {
  i: number;
  status: number;
  ms: number;
  headers: http.IncomingHttpHeaders;
  error?: string;
}

/** One GET on a fresh connection, keeping the response headers. */
export function get(url: string, timeoutMs = 8000): Promise<Omit<Sent, 'i'>> {
  const start = performance.now();
  return new Promise((resolve) => {
    const req = http.get(url, { agent: false }, (res) => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode ?? 0, ms: performance.now() - start, headers: res.headers }));
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')));
    req.on('error', (e) => resolve({ status: 0, ms: performance.now() - start, headers: {}, error: e.message }));
  });
}

/**
 * Numbered requests (`?i=0`, `?i=1`, …) sent `n` at a time at `at` ms after
 * the start, each on its own connection, like separate page loads.
 */
export async function fire(url: string, plan: { at: number; n?: number }[]): Promise<Sent[]> {
  const t0 = performance.now();
  const pending: Promise<Sent>[] = [];
  let i = 0;
  for (const step of plan) {
    const wait = t0 + step.at - performance.now();
    if (wait > 0) await sleep(wait);
    for (let k = 0; k < (step.n ?? 1); k++) {
      const id = i++;
      pending.push(get(`${url}?i=${id}`).then((r) => ({ i: id, ...r })));
    }
  }
  return Promise.all(pending);
}

/**
 * GETs written all at once on one kept-alive connection (HTTP pipelining),
 * each claiming a different client address in X-Real-IP. nginx answers them
 * in order; returns the status codes. Keep it to 1000 (keepalive_requests).
 */
export function pipelined(port: number, ips: string[], path = '/'): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const sock = net.connect(port, '127.0.0.1');
    let buf = '';
    sock.setEncoding('latin1');
    sock.on('data', (d: string) => (buf += d));
    sock.on('end', () => {
      // Responses back to back: status line, headers, then Content-Length bytes of body.
      const statuses: number[] = [];
      for (let at = 0; at < buf.length; ) {
        const end = buf.indexOf('\r\n\r\n', at);
        if (end < 0) break;
        const head = buf.slice(at, end);
        statuses.push(Number(head.match(/^HTTP\/1\.1 (\d{3})/)?.[1]));
        at = end + 4 + Number(head.match(/\r\ncontent-length:\s*(\d+)/i)?.[1] ?? 0);
      }
      resolve(statuses);
    });
    sock.on('error', reject);
    sock.write(ips.map((ip, k) => `GET ${path} HTTP/1.1\r\nHost: api\r\nX-Real-IP: ${ip}\r\n${k === ips.length - 1 ? 'Connection: close\r\n' : ''}\r\n`).join(''));
  });
}

/* ------------------------------------------------------------------ */
/* The lesson's own simulation, headless                               */
/* ------------------------------------------------------------------ */

export function findStep(id: string) {
  for (const chapter of CHAPTERS) {
    const step = chapter.steps.find((s) => s.id === id);
    if (step) return { chapter, step };
  }
  throw new Error(`no step "${id}" in the rate limiting lesson`);
}

/**
 * Enter a step the way the page does, then play it for `seconds` at 60 frames
 * a second. `setup` runs right after entering (e.g. to click a toggle).
 * Prediction prompts are answered correctly so traffic keeps flowing.
 */
export function runStep(id: string, seconds: number, setup?: (s: RateSim) => void) {
  const { chapter, step } = findStep(id);
  const sim = new RateSim();
  sim.enter({ ...DEFAULTS, ...chapter.cfg, ...step.cfg }, step.script, { reset: step.reset ?? true, predict: step.predict });
  setup?.(sim);
  sim.trace = [];
  const dt = 1 / 60;
  for (let f = 0; f < seconds * 60; f++) {
    const q = sim.game?.pending;
    if (q) sim.game!.answer(q.acceptable[0]);
    sim.advance(dt, true, 1);
  }
  return { sim, trace: sim.trace };
}

/* ------------------------------------------------------------------ */
/* Redis snippets                                                      */
/* ------------------------------------------------------------------ */

/** redis-cli lines as argument lists. redis-cli has no comments, so `# …` is dropped. */
export function redisCommands(code: string): string[][] {
  return plain(code)
    .split('\n')
    .map((l) => l.replace(/(^|\s)#.*$/, '').trim())
    .filter(Boolean)
    .map((l) => l.split(/\s+/));
}

type AsyncFn = (...args: unknown[]) => Promise<unknown>;
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (...args: string[]) => AsyncFn;

/**
 * A JS snippet that is the body of a request handler (it uses `await` and
 * `return`), compiled as written. `names` are the variables it expects from
 * its surroundings; if it doesn't return, the result is `fallthrough`.
 */
export function handlerBody(code: string, names: string[], fallthrough: string): AsyncFn {
  return new AsyncFunction(...names, `${plain(code)}\nreturn ${JSON.stringify(fallthrough)};`);
}
