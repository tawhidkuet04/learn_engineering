/**
 * Launches the real software the lessons talk about (nginx, HAProxy, Redis)
 * plus tiny stand-in web servers, all on localhost with random ports.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function tmpDir(name: string) {
  return mkdtempSync(path.join(os.tmpdir(), `verify-${name}-`));
}

export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
  });
}

export async function waitForPort(port: number, timeoutMs = 10_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const ok = await new Promise<boolean>((resolve) => {
      const s = net.connect(port, '127.0.0.1');
      s.once('connect', () => {
        s.destroy();
        resolve(true);
      });
      s.once('error', () => resolve(false));
    });
    if (ok) return;
    await sleep(50);
  }
  throw new Error(`port ${port} never opened`);
}

/** A line of output from a server process, stamped with when we saw it. */
export interface LogLine {
  at: number;
  line: string;
}

interface Proc {
  child: ChildProcess;
  logs: LogLine[];
  stop: () => Promise<void>;
}

function launch(cmd: string, args: string[], cwd?: string): Proc {
  const child = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  const logs: LogLine[] = [];
  const collect = (buf: Buffer) => {
    for (const line of buf.toString().split('\n')) if (line.trim()) logs.push({ at: performance.now(), line });
  };
  child.stdout?.on('data', collect);
  child.stderr?.on('data', collect);
  const stop = () =>
    new Promise<void>((resolve) => {
      if (child.exitCode != null) return resolve();
      child.once('exit', () => resolve());
      child.kill('SIGTERM');
      setTimeout(() => child.exitCode == null && child.kill('SIGKILL'), 2000);
    });
  return { child, logs, stop };
}

/* ------------------------------------------------------------------ */
/* nginx                                                               */
/* ------------------------------------------------------------------ */

export function nginxVersion() {
  const r = spawnSync('nginx', ['-v'], { encoding: 'utf8' });
  return (r.stderr || r.stdout).match(/nginx\/([\d.]+)/)?.[1] ?? 'unknown';
}

/** Wrap an `http {}` body in a runnable nginx.conf (one worker, private temp dirs). */
function nginxConf(dir: string, httpBody: string) {
  for (const d of ['body', 'proxy', 'fastcgi', 'uwsgi', 'scgi']) mkdirSync(path.join(dir, d), { recursive: true });
  return `worker_processes 1;
error_log ${dir}/error.log info;
pid ${dir}/nginx.pid;
events { worker_connections 1024; }
http {
  access_log off;
  client_body_temp_path ${dir}/body;
  proxy_temp_path ${dir}/proxy;
  fastcgi_temp_path ${dir}/fastcgi;
  uwsgi_temp_path ${dir}/uwsgi;
  scgi_temp_path ${dir}/scgi;
${httpBody}
}
`;
}

export async function startNginx(httpBody: string, port: number) {
  const dir = tmpDir('nginx');
  const file = path.join(dir, 'nginx.conf');
  writeFileSync(file, nginxConf(dir, httpBody));
  const test = spawnSync('nginx', ['-t', '-p', dir, '-c', file], { encoding: 'utf8' });
  if (test.status !== 0) throw new Error(`nginx rejected the config:\n${test.stderr}\n---\n${readFileSync(file, 'utf8')}`);
  const p = launch('nginx', ['-p', dir, '-c', file, '-g', 'daemon off;']);
  await waitForPort(port);
  return { ...p, dir, errorLog: () => readFileSync(path.join(dir, 'error.log'), 'utf8') };
}

/** `nginx -t` on an `http {}` body, wrapped the same way startNginx wraps it. */
export function nginxCheck(httpBody: string) {
  const dir = tmpDir('nginx-t');
  const file = path.join(dir, 'nginx.conf');
  writeFileSync(file, nginxConf(dir, httpBody));
  const r = spawnSync('nginx', ['-t', '-p', dir, '-c', file], { encoding: 'utf8' });
  return { ok: r.status === 0, output: `${r.stdout}${r.stderr}`.trim() };
}

/** `nginx -t` on a full config file body. */
export function nginxTest(fullConf: string) {
  const dir = tmpDir('nginx-t');
  for (const d of ['body', 'proxy', 'fastcgi', 'uwsgi', 'scgi']) mkdirSync(path.join(dir, d), { recursive: true });
  const file = path.join(dir, 'nginx.conf');
  writeFileSync(file, fullConf.replaceAll('$TMP', dir));
  const r = spawnSync('nginx', ['-t', '-p', dir, '-c', file], { encoding: 'utf8' });
  return { ok: r.status === 0, output: `${r.stdout}${r.stderr}`.trim() };
}

/* ------------------------------------------------------------------ */
/* HAProxy                                                             */
/* ------------------------------------------------------------------ */

export function haproxyVersion() {
  const r = spawnSync('haproxy', ['-v'], { encoding: 'utf8' });
  return r.stdout.match(/version ([\d.]+)/)?.[1] ?? 'unknown';
}

export async function startHaproxy(cfg: string, port: number) {
  const dir = tmpDir('haproxy');
  const file = path.join(dir, 'haproxy.cfg');
  writeFileSync(file, cfg);
  const test = spawnSync('haproxy', ['-c', '-f', file], { encoding: 'utf8' });
  if (test.status !== 0) throw new Error(`haproxy rejected the config:\n${test.stdout}${test.stderr}\n---\n${cfg}`);
  const p = launch('haproxy', ['-f', file, '-db']);
  await waitForPort(port);
  return p;
}

export function haproxyCheck(cfg: string) {
  const dir = tmpDir('haproxy-c');
  const file = path.join(dir, 'haproxy.cfg');
  writeFileSync(file, cfg);
  const r = spawnSync('haproxy', ['-c', '-f', file], { encoding: 'utf8' });
  return { ok: r.status === 0, output: `${r.stdout}${r.stderr}`.trim() };
}

/* ------------------------------------------------------------------ */
/* Redis                                                               */
/* ------------------------------------------------------------------ */

export function redisVersion() {
  const r = spawnSync('redis-server', ['--version'], { encoding: 'utf8' });
  return r.stdout.match(/v=([\d.]+)/)?.[1] ?? 'unknown';
}

export async function startRedis(extraArgs: string[] = []) {
  const port = await freePort();
  const dir = tmpDir('redis');
  const p = launch('redis-server', ['--port', String(port), '--save', '', '--appendonly', 'no', '--dir', dir, ...extraArgs]);
  await waitForPort(port);
  const client = await redisClient(port);
  return { ...p, port, client };
}

export type RespValue = string | number | null | RespValue[] | Error;

/** A minimal RESP client: enough for the commands the lessons use. */
export async function redisClient(port: number) {
  const sock = net.connect(port, '127.0.0.1');
  await new Promise((r, j) => {
    sock.once('connect', r);
    sock.once('error', j);
  });
  let buf = Buffer.alloc(0);
  const waiting: ((v: RespValue) => void)[] = [];

  function parse(b: Buffer, i: number): [RespValue, number] | null {
    const end = b.indexOf('\r\n', i);
    if (end < 0) return null;
    const type = String.fromCharCode(b[i]);
    const head = b.toString('utf8', i + 1, end);
    const next = end + 2;
    if (type === '+') return [head, next];
    if (type === '-') return [new Error(head), next];
    if (type === ':') return [Number(head), next];
    if (type === '$') {
      const n = Number(head);
      if (n < 0) return [null, next];
      if (b.length < next + n + 2) return null;
      return [b.toString('utf8', next, next + n), next + n + 2];
    }
    if (type === '*') {
      const n = Number(head);
      if (n < 0) return [null, next];
      const out: RespValue[] = [];
      let at = next;
      for (let k = 0; k < n; k++) {
        const r = parse(b, at);
        if (!r) return null;
        out.push(r[0]);
        at = r[1];
      }
      return [out, at];
    }
    throw new Error(`unexpected RESP type ${type}`);
  }

  sock.on('data', (d) => {
    buf = Buffer.concat([buf, d]);
    for (;;) {
      const r = parse(buf, 0);
      if (!r) break;
      buf = buf.subarray(r[1]);
      waiting.shift()?.(r[0]);
    }
  });

  function call(...args: (string | number)[]): Promise<RespValue> {
    const parts = args.map((a) => Buffer.from(String(a)));
    const msg = Buffer.concat([
      Buffer.from(`*${parts.length}\r\n`),
      ...parts.flatMap((p) => [Buffer.from(`$${p.length}\r\n`), p, Buffer.from('\r\n')]),
    ]);
    return new Promise((resolve) => {
      waiting.push(resolve);
      sock.write(msg);
    });
  }

  return { call, close: () => sock.destroy() };
}

/* ------------------------------------------------------------------ */
/* Stand-in web servers ("web-1", "web-2", …)                          */
/* ------------------------------------------------------------------ */

export interface Backend {
  name: string;
  port: number;
  up: boolean;
  hits: number;
  /** Extra time every response takes, to make a server look busy */
  delayMs: number;
  kill: () => Promise<void>;
  revive: () => Promise<void>;
}

/**
 * Tiny HTTP servers that say who they are. `kill()` closes the port, so the
 * next connection is refused, exactly like a crashed server process.
 */
export async function startBackends(names: string[]): Promise<Backend[]> {
  const out: Backend[] = [];
  for (const name of names) {
    const port = await freePort();
    let server: http.Server | null = null;
    const sockets = new Set<net.Socket>();
    const b: Backend = {
      name,
      port,
      up: false,
      hits: 0,
      delayMs: 0,
      kill: async () => {
        if (!server) return;
        const s = server;
        server = null;
        b.up = false;
        for (const so of sockets) so.destroy();
        await new Promise<void>((r) => s.close(() => r()));
      },
      revive: async () => {
        if (server) return;
        server = http.createServer((req, res) => {
          const url = new URL(req.url ?? '/', 'http://x');
          if (url.pathname === '/health') {
            res.writeHead(200, { 'content-type': 'text/plain' });
            return res.end('ok');
          }
          b.hits += 1;
          const body = JSON.stringify({ backend: name, path: url.pathname, method: req.method, xff: req.headers['x-forwarded-for'] ?? null, host: req.headers.host ?? null });
          const send = () => {
            res.writeHead(200, { 'content-type': 'application/json', 'x-backend': name });
            res.end(body);
          };
          const ms = (url.pathname === '/slow' ? Number(url.searchParams.get('ms') ?? 0) : 0) + b.delayMs;
          if (ms > 0) setTimeout(send, ms);
          else send();
        });
        server.keepAliveTimeout = 60_000;
        server.on('connection', (so) => {
          sockets.add(so);
          so.on('close', () => sockets.delete(so));
        });
        await new Promise<void>((r) => server!.listen(port, '127.0.0.1', () => r()));
        b.up = true;
      },
    };
    await b.revive();
    out.push(b);
  }
  return out;
}

export async function stopAll(backends: Backend[]) {
  for (const b of backends) await b.kill();
}
