import { readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { testCert } from './confs';

export interface Hit {
  /** Seconds since the traffic run started */
  t: number;
  status: number;
  /** Which stand-in server answered (x-backend header), if any */
  backend: string | null;
  ms: number;
  body: string;
  /** Response headers (lower-case names) */
  headers?: http.IncomingHttpHeaders;
  error?: string;
  path?: string;
}

/**
 * One request on a fresh TCP connection unless an agent is given. HTTPS
 * trusts the throwaway test certificate (and nothing else).
 */
export function request(
  url: string,
  opts: { method?: string; headers?: Record<string, string>; agent?: http.Agent | false; timeoutMs?: number } = {},
): Promise<Omit<Hit, 't'>> {
  const start = performance.now();
  const secure = url.startsWith('https:');
  const mod = secure ? https : http;
  return new Promise((resolve) => {
    const options = { method: opts.method ?? 'GET', headers: opts.headers, agent: opts.agent ?? false, ...(secure ? { ca: readFileSync(testCert().crt) } : {}) };
    const req = mod.request(url, options, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (body += c));
      res.on('end', () =>
        resolve({ status: res.statusCode ?? 0, backend: (res.headers['x-backend'] as string) ?? null, ms: performance.now() - start, body, headers: res.headers }),
      );
    });
    req.setTimeout(opts.timeoutMs ?? 8000, () => req.destroy(new Error('timeout')));
    req.on('error', (e) => resolve({ status: 0, backend: null, ms: performance.now() - start, body: '', error: e.message }));
    if (opts.method && opts.method !== 'GET') req.end('{}');
    else req.end();
  });
}

/**
 * Steady traffic: `rps` requests per second for `seconds`, each on its own
 * connection. `at` lets a scenario act at given moments (e.g. crash a server).
 */
export async function traffic(
  url: string,
  rps: number,
  seconds: number,
  at: { t: number; run: () => unknown }[] = [],
  opts: { method?: string; path?: (i: number) => string } = {},
): Promise<{ hits: Hit[]; marks: Record<string, number> }> {
  const hits: Hit[] = [];
  const marks: Record<string, number> = {};
  const t0 = performance.now();
  const pending: Promise<void>[] = [];
  const events = [...at].sort((a, b) => a.t - b.t);
  const total = Math.round(rps * seconds);
  for (let i = 0; i < total; i++) {
    const due = (i / rps) * 1000;
    while (events.length && events[0].t * 1000 <= due) {
      const e = events.shift()!;
      const wait = t0 + e.t * 1000 - performance.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      await e.run();
    }
    const wait = t0 + due - performance.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    const t = (performance.now() - t0) / 1000;
    const target = opts.path ? new URL(opts.path(i), url).toString() : url;
    pending.push(request(target, { method: opts.method }).then((h) => void hits.push({ ...h, t, path: target })));
  }
  for (const e of events) {
    const wait = t0 + e.t * 1000 - performance.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    await e.run();
  }
  await Promise.all(pending);
  hits.sort((a, b) => a.t - b.t);
  marks.t0 = t0;
  return { hits, marks };
}

/** Fire `n` requests at the same moment (a burst), each on its own connection. */
export async function burst(url: string, n: number, headers?: Record<string, string>) {
  return Promise.all(Array.from({ length: n }, () => request(url, { headers })));
}

/** Several requests over one kept-alive connection, one after another. */
export async function overOneConnection(url: string, n: number) {
  const agent = new (url.startsWith('https:') ? https : http).Agent({ keepAlive: true, maxSockets: 1 });
  const out: Omit<Hit, 't'>[] = [];
  for (let i = 0; i < n; i++) out.push(await request(url, { agent }));
  agent.destroy();
  return out;
}
