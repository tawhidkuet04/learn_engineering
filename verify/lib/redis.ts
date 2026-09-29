/**
 * Redis helpers for the caching, hash-tables and stack-heap checks:
 * start redis-server with a lesson's redis.conf, run redis-cli exactly the
 * way the snippets show it, and replay a lesson's cache traffic against a
 * memory limit to see which keys real Redis evicts.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { freePort, redisClient, sleep, tmpDir } from './procs';

export type Redis = Awaited<ReturnType<typeof redisClient>>;

export interface RedisServer {
  port: number;
  dir: string;
  client: Redis;
  child: ChildProcess;
  logs: string[];
  /** Another connection to the same server */
  connect: () => Promise<Redis>;
  /** Stop it (SIGKILL is a crash: no shutdown save) */
  stop: (signal?: NodeJS.Signals) => Promise<void>;
}

export interface Launch {
  /** redis.conf text, loaded as the config file */
  conf?: string;
  args?: string[];
  port?: number;
  dir?: string;
  /** Keep Redis's own snapshot/AOF defaults instead of turning persistence off */
  persistence?: boolean;
}

/** Start redis-server; rejects with its output if it refuses the config. */
export async function redisServer(o: Launch = {}): Promise<RedisServer> {
  const port = o.port ?? (await freePort());
  const dir = o.dir ?? tmpDir('redis');
  const argv: string[] = [];
  if (o.conf != null) {
    const file = path.join(dir, 'redis.conf');
    writeFileSync(file, `${o.conf}\n`);
    argv.push(file);
  }
  argv.push('--port', String(port), '--bind', '127.0.0.1', '--dir', dir);
  if (!o.persistence) argv.push('--save', '', '--appendonly', 'no');
  argv.push(...(o.args ?? []));
  const child = spawn('redis-server', argv, { stdio: ['ignore', 'pipe', 'pipe'] });
  const logs: string[] = [];
  const collect = (b: Buffer) => logs.push(...b.toString().split('\n').filter((l) => l.trim()));
  child.stdout?.on('data', collect);
  child.stderr?.on('data', collect);
  const until = Date.now() + 10_000;
  for (;;) {
    if (child.exitCode != null) throw new Error(`redis-server exited (${child.exitCode}):\n${logs.join('\n')}`);
    try {
      const client = await redisClient(port);
      const stop = (signal: NodeJS.Signals = 'SIGTERM') =>
        new Promise<void>((resolve) => {
          client.close();
          if (child.exitCode != null || child.signalCode != null) return resolve();
          child.once('exit', () => resolve());
          child.kill(signal);
          setTimeout(() => child.exitCode == null && child.kill('SIGKILL'), 2000);
        });
      return { port, dir, client, child, logs, connect: () => redisClient(port), stop };
    } catch {
      if (Date.now() > until) {
        child.kill('SIGKILL');
        throw new Error(`redis-server never accepted connections:\n${logs.join('\n')}`);
      }
      await sleep(20);
    }
  }
}

/** Does redis-server start with this config file? (Redis's answer to `nginx -t`.) */
export async function redisConfCheck(conf: string): Promise<{ ok: boolean; output: string }> {
  try {
    const s = await redisServer({ conf });
    await s.stop();
    return { ok: true, output: '' };
  } catch (e) {
    return { ok: false, output: (e as Error).message };
  }
}

/** The values the running server actually uses, e.g. { maxmemory: '2147483648' }. */
export async function configGet(r: Redis, names: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const n of names) {
    const v = await r.call('CONFIG', 'GET', n);
    if (Array.isArray(v) && v.length === 2) out[n] = String(v[1]);
  }
  return out;
}

/** INFO <section> as a map of field -> value. */
export async function info(r: Redis, section: string): Promise<Record<string, string>> {
  const text = String(await r.call('INFO', section));
  const out: Record<string, string> = {};
  for (const line of text.split('\r\n')) {
    const i = line.indexOf(':');
    if (i > 0 && !line.startsWith('#')) out[line.slice(0, i)] = line.slice(i + 1);
  }
  return out;
}

export const usedMemory = async (r: Redis) => Number((await info(r, 'memory')).used_memory);

/** redis-cli as a person types it at a terminal: --no-raw keeps the (integer)/(nil) formatting. */
export function cli(port: number, args: string[]): string {
  const r = spawnSync('redis-cli', ['--no-raw', '-p', String(port), ...args], { encoding: 'utf8' });
  return `${r.stdout}${r.stderr}`;
}

/** A shell pipeline, e.g. `redis-cli -p 1234 INFO stats | grep keyspace`. */
export function shell(command: string): string {
  const r = spawnSync('/bin/sh', ['-c', command], { encoding: 'utf8' });
  return `${r.stdout}${r.stderr}`;
}

/** Run `redis-cli --latency` for a while and return its last status line. */
export async function latency(port: number, ms: number): Promise<string> {
  const child = spawn('redis-cli', ['--no-raw', '-p', String(port), '--latency'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (b: Buffer) => (out += b.toString()));
  await sleep(ms);
  await new Promise<void>((resolve) => {
    child.once('exit', () => resolve());
    child.kill('SIGTERM');
  });
  const lines = [...out.matchAll(/min: \d+, max: \d+, avg: [\d.]+ \(\d+ samples\)/g)];
  return lines.length ? lines[lines.length - 1][0] : out;
}

/* ------------------------------------------------------------------ */
/* Cache traffic against a memory limit                                */
/* ------------------------------------------------------------------ */

export interface Read {
  key: string;
  hit: boolean;
  /** Keys that were in the cache before this read (or created by it) and are gone after it */
  evicted: string[];
}

/**
 * Values are made on the server with SETRANGE (a tiny command), so no big
 * request buffer inflates used_memory and trips an extra eviction.
 */
const create = (r: Redis, key: string, bytes: number) => r.call('SETRANGE', key, bytes - 1, 'x');

/**
 * Real time, on several servers at once: read i happens at second i
 * (aligned to the middle of a wall-clock second, so each read gets its own
 * tick of Redis's 1-second LRU clock). Cache-aside: GET, and on a miss create
 * the value. Once `capacity` distinct keys are cached, maxmemory is set
 * halfway between `capacity` and `capacity + 1` values.
 */
export async function realTimeReads(servers: Redis[], reads: string[], o: { capacity: number; valueBytes: number }): Promise<Read[][]> {
  const now = Date.now();
  const t0 = now + (1000 - (now % 1000)) + 500;
  const out: Read[][] = servers.map(() => []);
  const limited = servers.map(() => false);
  const cached = servers.map(() => new Set<string>());
  for (let i = 0; i < reads.length; i++) {
    const wait = t0 + i * 1000 - Date.now();
    if (wait > 0) await sleep(wait);
    const key = reads[i];
    await Promise.all(
      servers.map(async (r, s) => {
        const before = new Set((await r.call('KEYS', '*')) as string[]);
        const hit = (await r.call('GET', key)) != null;
        let evicted: string[] = [];
        if (!hit) {
          const m0 = await usedMemory(r);
          await create(r, key, o.valueBytes);
          if (!limited[s]) {
            cached[s].add(key);
            if (cached[s].size === o.capacity) {
              const m1 = await usedMemory(r);
              await r.call('CONFIG', 'SET', 'maxmemory', Math.round(m1 + (m1 - m0) / 2));
              limited[s] = true;
            }
          }
          const after = new Set((await r.call('KEYS', '*')) as string[]);
          evicted = [...before, key].filter((k) => !after.has(k));
        }
        out[s].push({ key, hit, evicted });
      }),
    );
  }
  return out;
}

/**
 * One read on an emulated LRU clock. Redis's clock ticks once a second, far
 * too slowly to replay thousands of reads, so each read is placed
 * `secondsPerRead` apart: every cached key's idle time is set to what it
 * would be in real time (RESTORE … IDLETIME, done in Lua so the value never
 * leaves the server), then the target is touched (hit) or created (miss).
 * Redis's own eviction code still picks every victim, with its sampling and
 * its pool of remembered candidates, when the next command arrives.
 */
const LRU_STEP = `
local bytes = tonumber(ARGV[1])
local target = ARGV[2]
for i = 3, #ARGV, 2 do
  local k = ARGV[i]
  if k ~= target and redis.call('EXISTS', k) == 1 then
    redis.call('RESTORE', k, 0, redis.call('DUMP', k), 'REPLACE', 'IDLETIME', tonumber(ARGV[i + 1]))
  end
end
local hit = redis.call('EXISTS', target)
if hit == 0 then redis.call('SETRANGE', target, bytes - 1, 'x') end
redis.call('RESTORE', target, 0, redis.call('DUMP', target), 'REPLACE', 'IDLETIME', 0)
return hit`;

/**
 * Replay reads through a fresh server (the eviction pool lives for the whole
 * process, so reuse would leak one run into the next).
 *  - 'lru-clock': emulated LRU clock, `secondsPerRead` apart (for LRU policies)
 *  - 'fast': plain reads as fast as they go (LFU, random, volatile-ttl), with
 *    each new key's expiry set one second per read apart when `ttl` is on
 */
export async function replayReads(
  r: Redis,
  reads: string[],
  o: { capacity: number; valueBytes: number; mode: 'lru-clock' | 'fast'; secondsPerRead?: number; ttl?: boolean },
): Promise<Read[]> {
  const S = o.secondsPerRead ?? 10;
  const lastRead = new Map<string, number>();
  const out: Read[] = [];
  const expireBase = Date.now() + 3_600_000;
  let limited = false;
  for (let i = 0; i < reads.length; i++) {
    const key = reads[i];
    const before = limited ? new Set((await r.call('KEYS', '*')) as string[]) : new Set<string>();
    const m0 = limited ? 0 : await usedMemory(r);
    let hit: boolean;
    if (o.mode === 'lru-clock') {
      const args: (string | number)[] = [];
      for (const [k, at] of lastRead) args.push(k, S * (i - at));
      const res = await r.call('EVAL', LRU_STEP, 0, o.valueBytes, key, ...args);
      if (res instanceof Error) throw res;
      hit = res === 1;
    } else {
      // GETRANGE touches the key exactly like GET (same lookup), without shipping the value back.
      hit = (await r.call('GETRANGE', key, 0, 9)) !== '';
      if (!hit) {
        await create(r, key, o.valueBytes);
        if (o.ttl) await r.call('PEXPIREAT', key, expireBase + i * 1000);
      }
    }
    lastRead.set(key, i);
    if (!limited) {
      if (lastRead.size === o.capacity) {
        const m1 = await usedMemory(r);
        await r.call('CONFIG', 'SET', 'maxmemory', Math.round(m1 + (m1 - m0) / 2));
        limited = true;
      }
      out.push({ key, hit, evicted: [] });
      continue;
    }
    const after = new Set((await r.call('KEYS', '*')) as string[]);
    if (after.size !== o.capacity) throw new Error(`expected ${o.capacity} keys after read ${i}, found ${after.size}: the memory limit is off`);
    for (const k of [...lastRead.keys()]) if (!after.has(k)) lastRead.delete(k);
    out.push({ key, hit, evicted: [...before, key].filter((k) => !after.has(k)) });
  }
  return out;
}
