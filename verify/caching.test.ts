/**
 * Caching lesson vs. real Redis, plus the Redis parts of the Hash Tables and
 * Stack vs Heap lessons (recorded under their own slugs).
 *
 * Each test runs what a lesson shows twice: once through the lesson's own
 * code (the Cache and CacheSim that draw the animation) and once through
 * real Redis, configured with the snippet the reader sees. Then it compares.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { CHAPTERS } from '@/lessons/caching/chapters';
import { Cache, WARMUP_SHARE, zipfTrace, type Policy } from '@/lessons/caching/cache';
import { PRODUCTS, product } from '@/lessons/caching/products';
import { KEYS as PLAYGROUND_KEYS } from '@/lessons/caching/panel/Playground';
import { redisConf, redisPolicy } from '@/lessons/caching/panel/redisConf';
import { CacheSim, DEFAULTS, type CacheConfig } from '@/lessons/caching/sim';
import { CHAPTERS as HT_CHAPTERS } from '@/lessons/hash-tables/chapters';
import { CHAPTERS as SH_CHAPTERS } from '@/lessons/stack-heap/chapters';
import { redisVersion, sleep } from './lib/procs';
import { cli, configGet, info, latency, realTimeReads, redisServer, replayReads, shell, usedMemory, type Launch, type Read, type RedisServer } from './lib/redis';
import { results } from './lib/results';
import { collectSnippets, plain, snippet, type Found } from './lib/snippets';

const LESSON = 'caching';
const R = results('caching');
const V = redisVersion();
const REDIS = `Redis ${V}`;
const ran = (text: string) => `Ran it on Redis ${V}: ${text}`;
const SNIPS = collectSnippets(CHAPTERS);
const HT_SNIPS = collectSnippets(HT_CHAPTERS);
const SH_SNIPS = collectSnippets(SH_CHAPTERS);

const key = (id: number) => `product:${id}`;
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
/** Large values, made on the server, so the memory limit counts keys cleanly */
const VALUE_BYTES = 200_000;

/* ---------------- servers: all killed at the end ---------------- */

const started: RedisServer[] = [];
async function server(o: Launch = {}) {
  const s = await redisServer(o);
  started.push(s);
  return s;
}
afterAll(async () => {
  await Promise.all(started.map((s) => s.stop('SIGKILL')));
});

/** A snippet's config text with some directives changed (mechanical, for side-by-side runs). */
function withDirectives(code: string, set: Record<string, string>) {
  let text = plain(code);
  for (const [k, v] of Object.entries(set)) text = new RegExp(`^${k}\\s`, 'm').test(text) ? text.replace(new RegExp(`^${k}\\s.*$`, 'm'), `${k} ${v}`) : `${text}\n${k} ${v}`;
  return text;
}

/** The directives of a redis.conf snippet: [name, value] for every non-comment line. */
function directives(code: string): [string, string][] {
  return plain(code)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const [name, ...rest] = l.split(/\s+/);
      return [name, rest.join(' ')];
    });
}

/** "2gb" → "2147483648", the way CONFIG GET reports memory sizes. */
function normalize(name: string, value: string) {
  const m = value.match(/^(\d+)(k|kb|m|mb|g|gb)$/i);
  if (!m || !/maxmemory$/.test(name)) return value;
  const unit = m[2].toLowerCase();
  const mult = unit === 'k' ? 1000 : unit === 'kb' ? 1024 : unit === 'm' ? 1e6 : unit === 'mb' ? 1024 ** 2 : unit === 'g' ? 1e9 : 1024 ** 3;
  return String(Number(m[1]) * mult);
}

/**
 * A snippet that shows part of a command's output, with "…" for skipped
 * lines, against the real output: same fields, same order, and every "…"
 * really stands for skipped lines (and nothing is skipped without one).
 */
function excerptMatches(shown: string[], real: string[]) {
  const problems: string[] = [];
  let prev = -1;
  let gap = false;
  for (const line of shown) {
    if (line === '…') {
      gap = true;
      continue;
    }
    const field = line.split(':')[0];
    const at = real.findIndex((l, i) => i > prev && l.startsWith(`${field}:`));
    if (at < 0) problems.push(`${field} missing or out of order`);
    else if (gap && at === prev + 1) problems.push(`"…" before ${field}, but nothing is skipped there`);
    else if (!gap && at !== prev + 1) problems.push(`${field} shown right after the previous line, but ${at - prev - 1} lines are skipped`);
    prev = at;
    gap = false;
  }
  if (!gap && prev !== real.length - 1) problems.push('the output goes on after the last line shown, with no "…"');
  if (gap && prev === real.length - 1) problems.push('"…" at the end, but nothing follows');
  return problems;
}

const lines = (text: string) =>
  text
    .replace(/\r/g, '')
    .split('\n')
    .filter((l) => l.length);

/* ---------------- the lesson's own simulation, headless ---------------- */

function findStep(id: string) {
  for (const chapter of CHAPTERS) {
    const step = chapter.steps.find((s) => s.id === id);
    if (step) return { chapter, step };
  }
  throw new Error(`no step "${id}" in the caching lesson`);
}

interface SimEvent {
  t: number;
  kind: 'get' | 'set';
  key: number;
  hit?: boolean;
  evicted?: number | null;
}

/**
 * Enter a step the way the page does and play it, answering predictions
 * correctly, until `done` says stop. Every read and write of the cache is logged.
 */
function simulate(stepId: string, done: (sim: CacheSim, log: SimEvent[]) => boolean, maxSeconds = 900, each?: (sim: CacheSim) => void) {
  const { chapter, step } = findStep(stepId);
  const sim = new CacheSim();
  sim.setSize(1280, 720);
  sim.enter({ ...DEFAULTS, ...chapter.cfg, ...step.cfg } as CacheConfig, step.script ?? [], { reset: step.reset, predict: step.predict?.rounds });
  const log: SimEvent[] = [];
  const c = sim.cache;
  const get = c.get.bind(c);
  const set = c.set.bind(c);
  c.get = (k, now) => {
    const e = get(k, now);
    log.push({ t: sim.t, kind: 'get', key: k, hit: !!e });
    return e;
  };
  c.set = (k, price, now, ttl, opts) => {
    const r = set(k, price, now, ttl, opts);
    log.push({ t: sim.t, kind: 'set', key: k, evicted: r.evicted?.key ?? null });
    return r;
  };
  for (let t = 0; t < maxSeconds && !done(sim, log); t += 0.05) {
    const q = sim.game?.pending;
    if (q) sim.game!.answer(q.acceptable[0]);
    sim.advance(0.05, true, 1);
    each?.(sim);
  }
  return { sim, log };
}

/** Pair each read with the eviction its miss caused, like the Redis runs report them. */
function simReads(log: SimEvent[], n: number): Read[] {
  const out: Read[] = [];
  for (let i = 0; i < log.length && out.length < n; i++) {
    const e = log[i];
    if (e.kind !== 'get') continue;
    const set = e.hit ? undefined : log.slice(i + 1).find((x) => x.kind === 'set' && x.key === e.key);
    out.push({ key: key(e.key), hit: !!e.hit, evicted: set?.evicted != null ? [key(set.evicted)] : [] });
  }
  return out;
}

const fmt = (reads: Read[]) => reads.map((r) => (r.hit ? `${r.key.slice(8)} hit` : `${r.key.slice(8)} miss${r.evicted.length ? `→${r.evicted.map((k) => k.slice(8)).join('+')}` : ''}`)).join(', ');
const victims = (reads: Read[]) => reads.flatMap((r) => r.evicted.map((k) => k.slice(8))).join(' ');

/* ---------------- slow clocks: started once, awaited by their tests ---------------- */

type Settled<T> = { ok: true; value: T } | { ok: false; error: Error };
const settle = <T>(p: Promise<T>): Promise<Settled<T>> =>
  p.then(
    (value) => ({ ok: true as const, value }),
    (error: Error) => ({ ok: false as const, error }),
  );
function unwrap<T>(s: Settled<T>): T {
  if (!s.ok) throw s.error;
  return s.value;
}

/** ttl step: SET … EX 60, TTL 18 s later, GET after the minute. */
async function ttlRun() {
  const s = await server();
  const t0 = performance.now();
  const set = lines(cli(s.port, ['SET', 'product:42', '{…}', 'EX', '60']));
  const first = lines(cli(s.port, ['TTL', 'product:42']));
  await sleep(18_000 - (performance.now() - t0));
  const at18 = (performance.now() - t0) / 1000;
  const ttl18 = lines(cli(s.port, ['TTL', 'product:42']));
  await sleep(60_500 - (performance.now() - t0));
  const get = lines(cli(s.port, ['GET', 'product:42']));
  await s.client.call('SET', 'forever', 'x');
  const noExpiry = lines(cli(s.port, ['TTL', 'forever']));
  const missing = lines(cli(s.port, ['TTL', 'nothing-here']));
  return { set, first, at18, ttl18, get, noExpiry, missing };
}

/** lru-lfu-fifo snippet: an idle key's LFU count, before and after the minute turns. */
async function lfuDecayRun(conf: string) {
  const s = await server({ conf });
  await s.client.call('SET', 'idle', 'x');
  const LOOP = "for i = 1, tonumber(ARGV[1]) do redis.call('GET', KEYS[1]) end return redis.call('OBJECT', 'FREQ', KEYS[1])";
  const clock = async () => Number(((await s.client.call('TIME')) as string[])[0]);
  const t0 = await clock();
  const before = Number(await s.client.call('EVAL', LOOP, 1, 'idle', 3000));
  const now = await clock();
  await sleep((60 - (now % 60)) * 1000 + 1500);
  const after1 = Number(await s.client.call('OBJECT', 'FREQ', 'idle'));
  const minutes = Math.floor((await clock()) / 60) - Math.floor(t0 / 60);
  return { before, after1, minutes };
}

/** write-back aside: what a default-config Redis keeps across a crash. */
async function snapshotRun() {
  const s = await server({ persistence: true });
  const conf = await configGet(s.client, ['save', 'appendonly', 'appendfsync']);
  const t0 = performance.now();
  const lastsave = await s.client.call('LASTSAVE');
  await Promise.all(Array.from({ length: 10_000 }, (_, i) => s.client.call('SET', `product:${i}`, 'v')));
  let savedAt: number | null = null;
  while (performance.now() - t0 < 80_000) {
    await sleep(500);
    if ((await s.client.call('LASTSAVE')) !== lastsave && /rdb_bgsave_in_progress:0/.test(String(await s.client.call('INFO', 'persistence')))) {
      savedAt = (performance.now() - t0) / 1000;
      break;
    }
  }
  for (let i = 0; i < 100; i++) await s.client.call('SET', `late:${i}`, 'v');
  await s.stop('SIGKILL');
  const again = await server({ persistence: true, port: s.port, dir: s.dir });
  const kept = ((await again.client.call('KEYS', 'product:*')) as string[]).length;
  const late = ((await again.client.call('KEYS', 'late:*')) as string[]).length;
  return { conf, savedAt, kept, late };
}

/** taming-the-herd aside: a lock with SET NX PX 5000. */
async function lockRun() {
  const s = await server();
  const other = await s.connect();
  const first = await s.client.call('SET', 'lock:product:42', 'token-a', 'NX', 'PX', 5000);
  const second = await other.call('SET', 'lock:product:42', 'token-b', 'NX', 'PX', 5000);
  const pttl = Number(await s.client.call('PTTL', 'lock:product:42'));
  await sleep(5100);
  const later = await other.call('SET', 'lock:product:42', 'token-b', 'NX', 'PX', 5000);
  other.close();
  return { first, second, pttl, later };
}

let slow: {
  ttl: Promise<Settled<Awaited<ReturnType<typeof ttlRun>>>>;
  lfu: Promise<Settled<Awaited<ReturnType<typeof lfuDecayRun>>>>;
  snapshot: Promise<Settled<Awaited<ReturnType<typeof snapshotRun>>>>;
  lock: Promise<Settled<Awaited<ReturnType<typeof lockRun>>>>;
};

beforeAll(() => {
  slow = {
    ttl: settle(ttlRun()),
    lfu: settle(lfuDecayRun(plain(snippet(SNIPS, 'lru-lfu-fifo', 'redis.conf').code))),
    snapshot: settle(snapshotRun()),
    lock: settle(lockRun()),
  };
});

/* ================================================================== */

describe('every Redis config the lessons show loads in redis-server', () => {
  const confs: { lesson: string; s: Found }[] = [
    ...SNIPS.filter((s) => s.title === 'redis.conf').map((s) => ({ lesson: LESSON, s })),
    ...HT_SNIPS.filter((s) => s.title === 'redis.conf').map((s) => ({ lesson: 'hash-tables', s })),
  ];

  test('there are three redis.conf snippets', () => {
    expect(confs.map((c) => c.s.step)).toEqual(['out-of-room', 'lru-lfu-fifo', 'lookup-race']);
  });

  for (const { lesson, s } of confs) {
    test(`redis-server + CONFIG GET: ${lesson} / ${s.step}`, async () => {
      const r = await server({ conf: plain(s.code) });
      const want = directives(s.code);
      const got = await configGet(
        r.client,
        want.map(([n]) => n),
      );
      const wrong = want.filter(([n, v]) => got[n] !== normalize(n, v));
      R.check({
        lesson,
        step: s.step,
        title: `redis-server starts with the ${s.title} snippet and reads back every value`,
        software: REDIS,
        real: wrong.length ? `differs: ${wrong.map(([n]) => `${n}=${got[n]}`).join(', ')}` : want.map(([n]) => `${n} ${got[n]}`).join(', '),
        lesson_says: want.map(([n, v]) => `${n} ${v}`).join(', '),
        pass: wrong.length === 0,
      });
      expect(wrong).toEqual([]);
      R.stamp(s.code, { lesson, by: REDIS, kind: 'loads', note: `Redis ${V} starts with this config, and CONFIG GET reads back every value.` });
    });
  }

  test('every config the playground generates (playground)', async () => {
    const variants: { cfg: Pick<CacheConfig, 'slots' | 'policy' | 'ttl' | 'writeMode' | 'coalesce'>; text: string }[] = [];
    for (let slots = 1; slots <= PLAYGROUND_KEYS; slots++)
      for (const policy of ['lru', 'lfu', 'fifo'] as Policy[])
        for (const ttl of [0, 1, 10, 60])
          for (const writeMode of ['none', 'around'] as const)
            for (const coalesce of [false, true]) {
              const cfg = { slots, policy, ttl, writeMode, coalesce };
              variants.push({ cfg, text: plain(redisConf(cfg)) });
            }
    const failures: string[] = [];
    const policies = new Set<string>();
    for (let i = 0; i < variants.length; i += 12) {
      await Promise.all(
        variants.slice(i, i + 12).map(async ({ cfg, text }) => {
          try {
            const r = await redisServer({ conf: text });
            const got = await configGet(r.client, ['maxmemory', 'maxmemory-policy']);
            await r.stop('SIGKILL');
            policies.add(got['maxmemory-policy']);
            if (got['maxmemory-policy'] !== redisPolicy(cfg) || got.maxmemory !== String(64 * 1024 ** 2)) failures.push(`${JSON.stringify(cfg)} → ${JSON.stringify(got)}`);
          } catch (e) {
            failures.push(`${JSON.stringify(cfg)}: ${(e as Error).message.split('\n').slice(0, 4).join(' ')}`);
          }
        }),
      );
    }
    R.check({
      lesson: LESSON,
      step: 'playground',
      title: 'redis-server starts with every config the playground generates',
      software: REDIS,
      real: failures.length ? `${failures.length} of ${variants.length} rejected, e.g. ${failures[0]}` : `${variants.length} variants accepted; policies used: ${[...policies].sort().join(', ')}`,
      lesson_says: 'the "your settings · live" block is a redis.conf',
      pass: failures.length === 0,
    });
    expect(failures).toEqual([]);
  });
});

/* ================================================================== */

describe('defaults, policies and errors', () => {
  test('the defaults the lessons quote', async () => {
    const plainRedis = await server();
    const d = await configGet(plainRedis.client, ['maxmemory', 'maxmemory-policy', 'maxmemory-samples', 'lfu-log-factor', 'lfu-decay-time', 'hz', 'hash-max-listpack-entries', 'hash-max-listpack-value']);
    const rows = [
      { step: 'out-of-room', title: 'Default eviction policy', real: d['maxmemory-policy'], lesson_says: 'noeviction', pass: d['maxmemory-policy'] === 'noeviction' },
      { step: 'out-of-room', title: 'Keys sampled per eviction by default', real: d['maxmemory-samples'], lesson_says: '5', pass: d['maxmemory-samples'] === '5' },
      { step: 'lru-lfu-fifo', title: 'Default lfu-log-factor and lfu-decay-time', real: `${d['lfu-log-factor']}, ${d['lfu-decay-time']}`, lesson_says: '10, 1', pass: d['lfu-log-factor'] === '10' && d['lfu-decay-time'] === '1' },
      { step: 'ttl', title: 'How often the background expiry job runs (hz)', real: `${d.hz} times a second`, lesson_says: 'about 10 times a second', pass: d.hz === '10' },
    ];
    for (const row of rows) R.check({ lesson: LESSON, software: REDIS, ...row });
    const ht = { lesson: 'hash-tables', step: 'lookup-race', software: REDIS, title: 'Default listpack limits for hashes', real: `${d['hash-max-listpack-entries']} entries, ${d['hash-max-listpack-value']} bytes` };
    const htSnip = directives(snippet(HT_SNIPS, 'lookup-race', 'redis.conf').code);
    const htSays = Object.fromEntries(htSnip);
    const htPass = htSays['hash-max-listpack-entries'] === d['hash-max-listpack-entries'] && htSays['hash-max-listpack-value'] === d['hash-max-listpack-value'];
    R.check({ ...ht, lesson_says: `${htSays['hash-max-listpack-entries']} entries, ${htSays['hash-max-listpack-value']} bytes ("these are the defaults")`, pass: htPass });
    for (const row of rows) expect(row.pass, `${row.title}: ${row.real}`).toBe(true);
    expect(htPass).toBe(true);
  });

  test('noeviction: when memory is full, writes fail with an OOM error (out-of-room)', async () => {
    const r = await server();
    const c = r.client;
    await c.call('SETRANGE', 'product:1', VALUE_BYTES - 1, 'x');
    const used = await usedMemory(c);
    await c.call('CONFIG', 'SET', 'maxmemory', used + VALUE_BYTES * 1.5);
    const writes: string[] = [];
    for (let i = 2; i <= 5; i++) {
      const res = await c.call('SETRANGE', `product:${i}`, VALUE_BYTES - 1, 'x');
      writes.push(res instanceof Error ? res.message : String(res));
    }
    const read = await c.call('STRLEN', 'product:1');
    const del = await c.call('DEL', 'product:1');
    const oom = writes.find((w) => w.startsWith('OOM'));
    const evicted = (await info(c, 'stats')).evicted_keys;
    const pass = !!oom && oom === "OOM command not allowed when used memory > 'maxmemory'." && read === VALUE_BYTES && del === 1 && evicted === '0';
    R.check({
      lesson: LESSON,
      step: 'out-of-room',
      title: 'Default policy with memory full',
      software: REDIS,
      real: `writes: ${writes.join(' | ')}; reads still work, DEL still works; evicted_keys ${evicted}`,
      lesson_says: 'noeviction: when memory is full, writes fail with an OOM error',
      pass,
    });
    expect(pass).toBe(true);
  });

  test('the policies Redis has: no FIFO; volatile-lru only evicts keys with a TTL (out-of-room, lru-lfu-fifo)', async () => {
    const r = await server();
    const c = r.client;
    const named = ['volatile-lru', 'allkeys-lru', 'volatile-lfu', 'allkeys-lfu', 'volatile-random', 'allkeys-random', 'volatile-ttl', 'noeviction'];
    const accepted = [];
    for (const p of named) if ((await c.call('CONFIG', 'SET', 'maxmemory-policy', p)) === 'OK') accepted.push(p);
    const fifo = await c.call('CONFIG', 'SET', 'maxmemory-policy', 'allkeys-fifo');
    const listed = fifo instanceof Error ? fifo.message.replace(/^.*one of the following: /, '') : '';
    const noFifo = accepted.length === 8 && fifo instanceof Error && !/fifo/i.test(listed);
    R.check({
      lesson: LESSON,
      step: 'lru-lfu-fifo',
      title: 'Redis has no FIFO policy',
      software: REDIS,
      real: `allkeys-fifo rejected; the only choices: ${listed}`,
      lesson_says: 'Redis has no FIFO policy',
      pass: noFifo,
    });

    // volatile-lru: three keys with a TTL, three without, then keep writing.
    const v = await server({ args: ['--maxmemory-policy', 'volatile-lru'] });
    for (let i = 0; i < 3; i++) {
      await v.client.call('SETRANGE', `ttl:${i}`, VALUE_BYTES - 1, 'x');
      await v.client.call('EXPIRE', `ttl:${i}`, 3600);
    }
    let prev = 0;
    for (let i = 0; i < 3; i++) {
      prev = await usedMemory(v.client);
      await v.client.call('SETRANGE', `plain:${i}`, VALUE_BYTES - 1, 'x');
    }
    const used = await usedMemory(v.client);
    await v.client.call('CONFIG', 'SET', 'maxmemory', Math.round(used + (used - prev) / 2));
    const results: string[] = [];
    for (let i = 3; i < 8; i++) {
      const res = await v.client.call('SETRANGE', `plain:${i}`, VALUE_BYTES - 1, 'x');
      results.push(res instanceof Error ? 'OOM' : 'OK');
      await v.client.call('PING');
    }
    const left = ((await v.client.call('KEYS', '*')) as string[]).sort();
    const onlyTtlGone = left.every((k) => k.startsWith('plain:')) && left.length === 7 && results.includes('OOM');

    // volatile-ttl with no TTLs at all: nothing it may evict (why the playground falls back to random).
    const t = await server({ args: ['--maxmemory-policy', 'volatile-ttl'] });
    await t.client.call('SETRANGE', 'plain:0', VALUE_BYTES - 1, 'x');
    await t.client.call('CONFIG', 'SET', 'maxmemory', (await usedMemory(t.client)) + VALUE_BYTES / 2);
    const tWrites: string[] = [];
    for (let i = 1; i <= 3; i++) {
      const res = await t.client.call('SETRANGE', `plain:${i}`, VALUE_BYTES - 1, 'x');
      tWrites.push(res instanceof Error ? 'OOM' : 'OK');
    }
    const ttlStuck = tWrites.includes('OOM') && (await info(t.client, 'stats')).evicted_keys === '0';
    R.check({
      lesson: LESSON,
      step: 'playground',
      title: 'volatile-ttl when no key has a TTL',
      software: REDIS,
      real: `writes ${tWrites.join(' ')}, evicted_keys 0: nothing it may evict`,
      lesson_says: 'FIFO without TTLs maps to allkeys-random',
      pass: ttlStuck,
    });
    R.check({
      lesson: LESSON,
      step: 'out-of-room',
      title: 'volatile-lru only evicts keys that have a TTL',
      software: REDIS,
      real: `writes ${results.join(' ')}; left: ${left.join(', ')} (all three TTL keys evicted, then OOM)`,
      lesson_says: 'volatile-lru (only keys that have a TTL)',
      pass: onlyTtlGone,
    });
    expect(noFifo).toBe(true);
    expect(onlyTtlGone).toBe(true);
    expect(ttlStuck).toBe(true);
  });

  test('LRU needs no extra memory per key (out-of-room aside)', async () => {
    const used: Record<string, number> = {};
    for (const policy of ['noeviction', 'allkeys-lru']) {
      const r = await server({ args: ['--maxmemory-policy', policy, '--enable-debug-command', 'yes'] });
      await r.client.call('DEBUG', 'POPULATE', 100_000, 'product', 40);
      used[policy] = Number((await info(r.client, 'memory')).used_memory_dataset);
      await r.stop('SIGKILL');
    }
    const pass = Math.abs(used.noeviction - used['allkeys-lru']) <= used.noeviction * 0.001;
    R.check({
      lesson: LESSON,
      step: 'out-of-room',
      title: 'Memory for 100,000 keys, with and without LRU eviction',
      software: REDIS,
      real: `dataset ${used.noeviction} bytes under noeviction, ${used['allkeys-lru']} under allkeys-lru`,
      lesson_says: 'it needs no extra memory per key',
      pass,
    });
    expect(pass).toBe(true);
  });
});

/* ================================================================== */

describe('reads, hits and TTLs', () => {
  test('memory-is-faster terminal: --latency and GET, as shown', async () => {
    const s = snippet(SNIPS, 'memory-is-faster', 'terminal');
    const r = await server({ args: ['--enable-debug-command', 'yes'] });
    const p = product(42);
    await r.client.call('SET', 'product:42', JSON.stringify({ name: p.name, price: p.price }));
    const shown = lines(plain(s.code));
    const latencyShown = shown[shown.indexOf('$ redis-cli -h 10.0.2.6 --latency') + 1];
    const getShown = shown[shown.indexOf('$ redis-cli -h 10.0.2.6 GET product:42') + 1];
    const lat = await latency(r.port, 2500);
    const pings = Number((await info(r.client, 'commandstats')).cmdstat_ping?.match(/calls=(\d+)/)?.[1] ?? 0);
    const get = lines(cli(r.port, ['GET', 'product:42']))[0];
    const shape = /^min: \d+, max: \d+, avg: \d+\.\d\d \(\d+ samples\)$/;
    for (let i = 0; i < 2000; i++) await r.client.call('GET', 'product:42');
    const perGet = Number((await info(r.client, 'commandstats')).cmdstat_get.match(/usec_per_call=([\d.]+)/)?.[1]);
    const table = String(await r.client.call('DEBUG', 'HTSTATS', 0));
    const checks = [
      { title: '--latency output', real: `${lat} (Redis counted ${pings} PINGs)`, lesson_says: `${latencyShown}; the note: --latency pings Redis over and over`, pass: shape.test(lat) && shape.test(latencyShown) && pings > 50 },
      { title: 'GET product:42 in redis-cli', real: get, lesson_says: getShown, pass: get === getShown },
      {
        title: 'Redis’s own time per GET',
        real: `${perGet} µs per GET inside Redis (INFO commandstats); the keyspace is a hash table (${table.split('\n').find((l) => /main hash table/.test(l))?.trim()})`,
        lesson_says: 'about 1 ms, most of that is the network hop; Redis looks the key up in an in-memory hash table',
        pass: perGet < 20 && /main hash table/.test(table),
      },
    ];
    for (const c of checks) R.check({ lesson: LESSON, step: 'memory-is-faster', software: REDIS, ...c });
    for (const c of checks) expect(c.pass, `${c.title}: ${c.real}`).toBe(true);
    R.stamp(s.code, { lesson: LESSON, by: REDIS, kind: 'ran', note: ran('against localhost instead of 10.0.2.6, --latency printed the same min/max/avg line, and GET returned the JSON exactly as shown.') });
  });

  test('hit-or-miss: SCAN finds the cached keys; KEYS blocks, SCAN doesn’t', async () => {
    const s = snippet(SNIPS, 'hit-or-miss', 'redis-cli');
    const r = await server({ args: ['--enable-debug-command', 'yes'] });
    const warm = findStep('hit-or-miss').step.cfg?.prewarm ?? [];
    for (const id of warm) await r.client.call('SET', key(id), '{…}');
    const shown = lines(plain(s.code)).slice(1);
    const cmd = plain(s.code).split('\n').find((l) => l.startsWith('127.0.0.1:6379> '))!.replace('127.0.0.1:6379> ', '');
    const real = lines(cli(r.port, cmd.split(' ')));
    const keysOf = (ls: string[]) => ls.slice(1).map((l) => l.match(/"(.*)"/)?.[1] ?? '').sort();
    const shapeOf = (ls: string[]) => ls.map((l) => l.replace(/"[^"]*"/, '"…"'));
    const sameKeys = keysOf(real).join() === keysOf(shown).join() && keysOf(real).join() === warm.map(key).sort().join();
    const sameShape = shapeOf(real).join('\n') === shapeOf(shown).join('\n');

    // The note: KEYS walks everything in one go and blocks every other client; SCAN takes small steps.
    await r.client.call('DEBUG', 'POPULATE', 1_000_000, 'product', 40);
    const other = await r.connect();
    const t0 = performance.now();
    const keysDone = r.client.call('KEYS', '*nomatch*').then(() => performance.now() - t0);
    await sleep(10);
    const p0 = performance.now();
    const pingWait = await other.call('PING').then(() => performance.now() - p0);
    const keysMs = await keysDone;
    let cursor = '0';
    let scanned = 0;
    for (let i = 0; i < 200; i++) {
      const [next, batch] = (await r.client.call('SCAN', cursor, 'MATCH', 'product:*', 'COUNT', 100)) as [string, string[]];
      cursor = String(next);
      scanned += batch.length;
    }
    const stats = await info(r.client, 'commandstats');
    const usec = (name: string) => Number(stats[`cmdstat_${name}`].match(/usec_per_call=([\d.]+)/)?.[1]);
    other.close();
    const blocks = pingWait > keysMs * 0.5 && pingWait > 50 && usec('scan') * 20 < usec('keys') && scanned / 200 > 50 && scanned / 200 < 200;
    const checks = [
      { title: 'SCAN output', real: real.join(' / '), lesson_says: shown.join(' / '), pass: sameKeys && sameShape },
      {
        title: 'KEYS blocks, SCAN doesn’t (1,000,000 keys)',
        real: `KEYS took ${(usec('keys') / 1000).toFixed(0)} ms inside Redis and a PING sent meanwhile waited ${pingWait.toFixed(0)} ms; each SCAN COUNT 100 took ${usec('scan').toFixed(0)} µs and returned ${(scanned / 200).toFixed(0)} keys on average`,
        lesson_says: 'Avoid KEYS in production: it blocks Redis while it scans everything',
        pass: blocks,
      },
    ];
    for (const c of checks) R.check({ lesson: LESSON, step: 'hit-or-miss', software: REDIS, ...c });
    for (const c of checks) expect(c.pass, `${c.title}: ${c.real}`).toBe(true);
    R.stamp(s.code, { lesson: LESSON, by: REDIS, kind: 'ran', note: ran('SCAN returned the three cached keys in one batch with cursor 0 (their order varies). On a million keys, KEYS held up every other client; SCAN never did.') });
  });

  test('hit-ratio terminal: keyspace_hits and keyspace_misses count the cache’s hits and misses', async () => {
    const s = snippet(SNIPS, 'hit-ratio', 'terminal');
    const cfg = findStep('hit-or-miss').step.cfg!;
    const seq = cfg.sequence!;
    // The lesson: the hit-or-miss step's first pass through its sequence.
    const { log } = simulate('hit-or-miss', (_s, l) => l.filter((e) => e.kind === 'get').length >= seq.length);
    const gets = log.filter((e) => e.kind === 'get').slice(0, seq.length);
    const simHits = gets.filter((e) => e.hit).length;
    // Real Redis: the same reads, cache-aside.
    const r = await server();
    for (const id of cfg.prewarm ?? []) await r.client.call('SET', key(id), '{…}');
    let hits = 0;
    for (const id of seq) {
      if ((await r.client.call('GET', key(id))) != null) hits++;
      else await r.client.call('SET', key(id), '{…}', 'EX', 60);
    }
    const cmd = lines(plain(s.code))[0].replace(/^\$ /, '').replace('redis-cli', `redis-cli -p ${r.port}`);
    const out = lines(shell(cmd));
    const shownFields = lines(plain(s.code))
      .filter((l) => /^keyspace_/.test(l))
      .map((l) => l.split(':')[0]);
    const n = (f: string) => Number(out.find((l) => l.startsWith(`${f}:`))?.split(':')[1]);
    const [a, b] = lines(plain(s.code))
      .filter((l) => /^keyspace_/.test(l))
      .map((l) => Number(l.split(':')[1]));
    const mathOk = Math.round((a / (a + b)) * 100) === 95;
    const pass = out.map((l) => l.split(':')[0]).join() === shownFields.join() && n('keyspace_hits') === simHits && n('keyspace_misses') === seq.length - simHits && hits === simHits && mathOk;
    R.check({
      lesson: LESSON,
      step: 'hit-ratio',
      title: 'INFO stats | grep keyspace after the hit-or-miss reads',
      software: REDIS,
      real: out.join(', '),
      lesson_says: `the same reads in the animation: ${simHits} hits, ${seq.length - simHits} misses; the snippet's math: ${pct(a / (a + b))}`,
      pass,
    });
    expect(pass, out.join(', ')).toBe(true);
    R.stamp(s.code, { lesson: LESSON, by: REDIS, kind: 'ran', note: ran('after the ten reads from the hit-or-miss step, grep printed just these two counters, with the same hits and misses as the animation.') });
  });

  test('ttl: SET … EX 60 counts down, then the key is gone', async () => {
    const s = snippet(SNIPS, 'ttl', 'redis-cli');
    const t = unwrap(await slow.ttl);
    const shown = lines(plain(s.code));
    const after = (cmd: string) => shown[shown.findIndex((l) => l.endsWith(cmd)) + 1];
    const ttl18 = Number(t.ttl18[0]?.match(/\(integer\) (-?\d+)/)?.[1]);
    const checks = [
      { title: 'SET … EX 60', real: t.set.join(' '), lesson_says: after('SET product:42 "{…}" EX 60'), pass: t.set[0] === 'OK' },
      {
        title: 'TTL counts down',
        real: `${t.first[0]} right away, ${t.ttl18[0]} after ${t.at18.toFixed(1)} s`,
        lesson_says: `${after('TTL product:42')} (18 s after the SET)`,
        pass: t.first[0] === '(integer) 60' && Math.abs(ttl18 - (60 - t.at18)) <= 1 && (Math.abs(t.at18 - 18) > 0.4 || t.ttl18[0] === after('TTL product:42')),
      },
      { title: 'GET a minute later', real: t.get.join(' '), lesson_says: after('GET product:42'), pass: t.get[0] === '(nil)' && after('GET product:42') === '(nil)' },
      { title: 'TTL of a key with no expiry, and of a missing key', real: `${t.noExpiry[0]}, ${t.missing[0]}`, lesson_says: '-1 and -2', pass: t.noExpiry[0] === '(integer) -1' && t.missing[0] === '(integer) -2' },
    ];
    for (const c of checks) R.check({ lesson: LESSON, step: 'ttl', software: REDIS, ...c });
    for (const c of checks) expect(c.pass, `${c.title}: ${c.real}`).toBe(true);
    R.stamp(s.code, { lesson: LESSON, by: REDIS, kind: 'ran', note: ran('TTL started at 60 and dropped one a second (42 after 18 s); a minute after the SET, GET returned (nil).') });
  });

  test('ttl aside: an expired key is deleted when touched, or by the background job', async () => {
    const r = await server({ args: ['--enable-debug-command', 'yes'] });
    const c = r.client;
    await c.call('DEBUG', 'SET-ACTIVE-EXPIRE', 0);
    await c.call('SET', 'product:42', '{…}', 'PX', 100);
    await sleep(300);
    const untouched = await c.call('DBSIZE');
    const get = await c.call('GET', 'product:42');
    const touched = await c.call('DBSIZE');
    await c.call('DEBUG', 'SET-ACTIVE-EXPIRE', 1);
    for (let i = 0; i < 1000; i++) void c.call('SET', `ttl:${i}`, 'x', 'PX', 200);
    for (let i = 0; i < 100; i++) void c.call('SET', `keep:${i}`, 'x');
    const t0 = performance.now();
    await c.call('PING');
    let size = Number(await c.call('DBSIZE'));
    while (size > 100 && performance.now() - t0 < 5000) {
      await sleep(10);
      size = Number(await c.call('DBSIZE'));
    }
    const sweptAfter = performance.now() - t0 - 200;
    const pass = untouched === 1 && get === null && touched === 0 && size === 100 && sweptAfter < 1000;
    R.check({
      lesson: LESSON,
      step: 'ttl',
      title: 'How expired keys disappear',
      software: REDIS,
      real: `background job off: the expired key stayed (DBSIZE ${untouched}) until GET touched it (then ${touched}); job on: 1,000 expired keys that nobody touched were gone ${Math.max(0, sweptAfter).toFixed(0)} ms after expiring`,
      lesson_says: 'deleted when something touches it; a background job cleans up the rest about 10 times a second',
      pass,
    });
    expect(pass).toBe(true);
  });

  test('taming-the-herd aside: a lock with SET NX PX 5000', async () => {
    const l = unwrap(await slow.lock);
    const pass = l.first === 'OK' && l.second === null && l.pttl > 4900 && l.later === 'OK';
    R.check({
      lesson: LESSON,
      step: 'taming-the-herd',
      title: 'SET lock:product:42 <token> NX PX 5000 from two app servers',
      software: REDIS,
      real: `first ${l.first}, second ${l.second === null ? '(nil)' : l.second}; after 5.1 s the second got ${l.later}`,
      lesson_says: 'the winner runs the query; the others wait briefly and retry',
      pass,
    });
    expect(pass).toBe(true);
  });

  test('a-race-you-can-lose: GET misses with (nil), DEL of a missing key answers 0', async () => {
    const r = await server();
    const miss = lines(cli(r.port, ['GET', 'product:42']))[0];
    const del0 = lines(cli(r.port, ['DEL', 'product:42']))[0];
    await r.client.call('SET', 'product:42', '{…}');
    const del1 = lines(cli(r.port, ['DEL', 'product:42']))[0];
    const pass = miss === '(nil)' && del0 === '(integer) 0' && del1 === '(integer) 1';

    // caches-all-the-way-down: "You can delete a Redis key in a millisecond"
    for (let i = 0; i < 1000; i++) await r.client.call('SET', `product:${i}`, '{…}');
    const t0 = performance.now();
    for (let i = 0; i < 1000; i++) await r.client.call('DEL', `product:${i}`);
    const perDel = (performance.now() - t0) / 1000;
    R.check({
      lesson: LESSON,
      step: 'caches-all-the-way-down',
      title: 'Deleting a Redis key',
      software: REDIS,
      real: `${perDel.toFixed(2)} ms per DEL, round trip included (localhost)`,
      lesson_says: 'You can delete a Redis key in a millisecond',
      pass: perDel < 1,
    });
    expect(perDel).toBeLessThan(1);
    R.check({
      lesson: LESSON,
      step: 'a-race-you-can-lose',
      title: 'GET and DEL replies in the race diagram',
      software: REDIS,
      real: `GET → ${miss}; DEL → ${del0} when not cached, ${del1} when cached`,
      lesson_says: '(nil): a miss; DEL → 0: nothing to delete',
      pass,
    });
    expect(pass).toBe(true);
  });
});

/* ================================================================== */

describe('eviction', () => {
  const lruConf = () => plain(snippet(SNIPS, 'out-of-room', 'redis.conf').code);
  /** The eviction chapter's traffic: the long-run readouts' 12,000 reads (16 products, 6 fit) */
  const eviction = { ...DEFAULTS, ...CHAPTERS.find((c) => c.id === 'eviction')!.cfg } as CacheConfig;
  const trace = zipfTrace(eviction.keys, eviction.skew);
  const warmup = Math.floor(trace.length * WARMUP_SHARE);
  const ratio = (hits: boolean[]) => hits.slice(warmup).filter(Boolean).length / (hits.length - warmup);
  const traceReads = trace.map((rank) => key(PRODUCTS[rank].id));

  /** The lesson's own Cache over the trace (the same code the readouts use) */
  const exact = (policy: Policy) => {
    const c = new Cache(eviction.slots, policy);
    const evicted: string[] = [];
    const hits = trace.map((k, i) => {
      const hit = c.get(k, i) != null;
      if (!hit) {
        const v = c.set(k, 0, i, 0).evicted;
        if (v) evicted.push(key(PRODUCTS[v.key].id));
      }
      return hit;
    });
    return { hitRatio: ratio(hits), hot: evicted.filter((k) => k === key(42)).length, evicted };
  };

  /** Real Redis, with the snippet's config, samples 5 and 10 (run once, shared by two tests) */
  let lruRuns: Promise<{ samples: number; hitRatio: number; hot: number; evicted: number; evictions: number }[]> | null = null;
  const redisLru = () =>
    (lruRuns ??= Promise.all(
      [5, 10].map(async (samples) => {
        const r = await server({ conf: withDirectives(lruConf(), { 'maxmemory-samples': String(samples) }) });
        const out = await replayReads(r.client, traceReads, { capacity: eviction.slots, valueBytes: VALUE_BYTES, mode: 'lru-clock' });
        const evicted = Number((await info(r.client, 'stats')).evicted_keys);
        await r.stop('SIGKILL');
        return { samples, hitRatio: ratio(out.map((x) => x.hit)), hot: out.filter((x) => x.evicted.includes(key(42))).length, evicted, evictions: out.filter((o) => o.evicted.length).length };
      }),
    ));

  test('which-key-goes: the animation vs real Redis, read by read, in real time', async () => {
    const step = findStep('which-key-goes').step;
    const seq = step.cfg!.sequence!;
    const warm = step.cfg!.prewarm!;
    // The lesson: the step's first pass through its ten reads.
    const { log } = simulate('which-key-goes', (_s, l) => l.filter((e) => e.kind === 'get').length > seq.length);
    const sim = simReads(log, seq.length);
    const reads = [...[...warm].reverse(), ...seq].map(key);

    // Real Redis, one read per second: 10 servers with maxmemory-samples 10 and 30 with the snippet's 5.
    const fives = await Promise.all(Array.from({ length: 30 }, () => server({ conf: lruConf() })));
    const tens = await Promise.all(Array.from({ length: 10 }, () => server({ conf: withDirectives(lruConf(), { 'maxmemory-samples': '10' }) })));
    const all = [...fives, ...tens];
    const runs = (await realTimeReads(
      all.map((s) => s.client),
      reads,
      { capacity: 6, valueBytes: VALUE_BYTES },
    )).map((r) => r.slice(warm.length));
    const five = runs.slice(0, fives.length);
    const ten = runs.slice(fives.length);

    // IDLETIME right after: a key just read is 0; an untouched key counts seconds.
    const probe = tens[0];
    await probe.client.call('GET', key(42));
    const idle42 = lines(cli(probe.port, ['OBJECT', 'IDLETIME', key(42)]))[0];
    const others = ((await probe.client.call('KEYS', '*')) as string[]).filter((k) => k !== key(42));
    const lastRead = (k: string) => reads.lastIndexOf(k);
    const oldest = others.sort((a, b) => lastRead(a) - lastRead(b))[0];
    const idleOld = Number(lines(cli(probe.port, ['OBJECT', 'IDLETIME', oldest]))[0].match(/\d+/)?.[0]);
    const expectedOld = reads.length - 1 - lastRead(oldest);

    const tally = (rs: Read[][]) => {
      const m = new Map<string, number>();
      for (const r of rs) m.set(fmt(r), (m.get(fmt(r)) ?? 0) + 1);
      return [...m.entries()].sort((a, b) => b[1] - a[1]);
    };
    const same = (r: Read[]) => fmt(r) === fmt(sim);
    /** The aside's case: product:5 evicted by the very write that brought it back */
    const wroteThenEvicted = (r: Read[]) => r.some((x) => x.key === key(5) && !x.hit && x.evicted.includes(key(5)));
    const tenTally = tally(ten);
    const checks = [
      {
        title: 'Which keys LRU evicts, read by read (maxmemory-samples 10)',
        real: `${tenTally[0][1]} of ${ten.length} runs: ${tenTally[0][0]}${tenTally.length > 1 ? `; others: ${tenTally.slice(1).map(([o, n]) => `${o} (${n}×)`).join('; ')}` : ''}`,
        lesson_says: fmt(sim),
        pass: tenTally[0][1] >= ten.length * 0.8 && tenTally[0][0] !== fmt(sim) && /\b5 miss→5\b/.test(tenTally[0][0]) && victims(ten.find((r) => fmt(r) === tenTally[0][0])!).startsWith(victims(sim).split(' ').slice(0, 3).join(' ')),
      },
      {
        title: 'Which keys LRU evicts, read by read (maxmemory-samples 5, the snippet)',
        real: `${tally(five).length} different outcomes in ${five.length} runs; ${five.filter(same).length} matched the animation; ${five.filter(wroteThenEvicted).length} evicted product:5 the moment they wrote it; most common: ${tally(five)[0][0]} (${tally(five)[0][1]}×)`,
        lesson_says: `${fmt(sim)} (the aside: real Redis doesn’t always agree, and sometimes evicts product:5 the moment it’s written)`,
        pass: tally(five).length > 1 && five.filter(same).length < five.length / 2 && five.some(wroteThenEvicted),
      },
      {
        title: 'Hits on these ten reads',
        real: `${Math.min(...runs.map((r) => r.filter((x) => x.hit).length))} to ${Math.max(...runs.map((r) => r.filter((x) => x.hit).length))} hits across all runs`,
        lesson_says: `${sim.filter((x) => x.hit).length} hits`,
        pass: true,
      },
      {
        title: 'OBJECT IDLETIME',
        real: `a key just read: ${idle42}; ${oldest}, last read ${expectedOld} s earlier: ${idleOld}`,
        lesson_says: 'seconds since a key was last read or written (0 right after a read)',
        pass: idle42 === '(integer) 0' && Math.abs(idleOld - expectedOld) <= 1,
      },
    ];
    for (const c of checks) R.check({ lesson: LESSON, step: 'which-key-goes', software: REDIS, ...c });
    for (const c of checks) expect(c.pass, `${c.title}: ${c.real}`).toBe(true);
    R.stamp(snippet(SNIPS, 'which-key-goes', 'redis-cli').code, {
      lesson: LESSON,
      by: REDIS,
      kind: 'ran',
      note: ran('a key just read showed 0, and a key left alone counted up one per second.'),
    });
    await Promise.all(all.map((s) => s.stop('SIGKILL')));
  });

  test('out-of-room: 12,000 reads through exact LRU and through Redis', async () => {
    const exactLru = exact('lru');
    const runs = await redisLru();

    // The live animation of this step, for ten minutes: where does product:42 sit?
    let atBottom = 0;
    let frames = 0;
    const { sim, log } = simulate(
      'out-of-room',
      (s) => s.t >= 600,
      700,
      (s) => {
        const rows = s.rows();
        frames++;
        if (rows.length && rows[rows.length - 1].key === 42) atBottom++;
      },
    );
    const hotEvictions = log.filter((e) => e.kind === 'set' && e.evicted === 42).length;
    const backNext = log.every((e, i) => {
      if (e.kind !== 'set' || e.evicted !== 42) return true;
      const next = log.slice(i + 1).find((x) => x.key === 42);
      return !next || (next.kind === 'get' && next.hit === false);
    });

    const five = runs.find((x) => x.samples === 5)!;
    const close = runs.every((x) => Math.abs(x.hitRatio - exactLru.hitRatio) <= 0.025);
    const checks = [
      {
        title: 'Hit ratio over 12,000 reads (6 of 16 products fit)',
        real: runs.map((x) => `maxmemory-samples ${x.samples}: ${pct(x.hitRatio)}`).join('; ') + ` (reads placed 10 s apart on Redis’s LRU clock); evicted_keys ${runs.map((x) => x.evicted).join(' / ')}`,
        lesson_says: `exact LRU (the animation’s cache): ${pct(exactLru.hitRatio)}; the aside: within about two points of exact LRU’s 66%`,
        pass: close && Math.round(exactLru.hitRatio * 100) === 66 && runs.every((x) => x.evicted === x.evictions),
      },
      {
        title: 'How often the hot key product:42 gets evicted',
        real: `Redis: ${runs.map((x) => `${x.hot}× (samples ${x.samples})`).join(', ')} in 12,000 reads`,
        lesson_says: `exact LRU: ${exactLru.hot}× in 12,000 reads; the animation, 10 minutes: evicted ${hotEvictions}×, at the very bottom ${pct(atBottom / frames)} of the time, back on its next read: ${backNext ? 'always' : 'no'}`,
        pass: five.hot > 0 && exactLru.hot > 0 && hotEvictions > 0 && atBottom / frames < 0.1 && backNext && sim.hotEvictions === hotEvictions,
      },
    ];
    for (const ch of checks) R.check({ lesson: LESSON, step: 'out-of-room', software: REDIS, ...ch });
    for (const ch of checks) expect(ch.pass, `${ch.title}: ${ch.real} vs ${ch.lesson_says}`).toBe(true);
    R.stamp(snippet(SNIPS, 'out-of-room', 'redis.conf').code, {
      lesson: LESSON,
      by: REDIS,
      kind: 'ran',
      note: ran('with maxmemory scaled down so six values fit, it evicted by idle time; over this lesson’s 12,000 reads its hit ratio stayed within about two points of exact LRU.'),
    });
  });

  test('lru-lfu-fifo: the same 12,000 reads under Redis’s LFU, random and volatile-ttl', async () => {
    const lfuConf = plain(snippet(SNIPS, 'lru-lfu-fifo', 'redis.conf').code);
    // Redis's LFU samples and counts approximately, so it varies run to run: six runs.
    const [random, ttl, ...lfus] = await Promise.all(
      [
        { name: 'allkeys-random', conf: `maxmemory-policy allkeys-random`, ttl: false },
        { name: 'volatile-ttl', conf: `maxmemory-policy volatile-ttl`, ttl: true },
        ...Array.from({ length: 6 }, () => ({ name: 'allkeys-lfu', conf: lfuConf, ttl: false })),
      ].map(async (p) => {
        const r = await server({ conf: p.conf });
        const out = await replayReads(r.client, traceReads, { capacity: eviction.slots, valueBytes: VALUE_BYTES, mode: 'fast', ttl: p.ttl });
        await r.stop('SIGKILL');
        return { name: p.name, hitRatio: ratio(out.map((x) => x.hit)), hot: out.filter((x) => x.evicted.includes(key(42))).length, evicted: out.flatMap((x) => x.evicted) };
      }),
    );
    const eLfu = exact('lfu');
    const eFifo = exact('fifo');
    const lruRedis = (await redisLru()).find((x) => x.samples === 5)!;
    const sameVictims = ttl.evicted.filter((k, i) => eFifo.evicted[i] === k).length / eFifo.evicted.length;
    const beatLru = lfus.filter((x) => x.hitRatio > lruRedis.hitRatio).length;
    const checks = [
      {
        title: 'LFU on stable popularity',
        real: `allkeys-lfu, six runs: ${lfus.map((x) => `${pct(x.hitRatio)}${x.hot ? ` (product:42 evicted ${x.hot}×)` : ''}`).join(', ')}; allkeys-lru: ${pct(lruRedis.hitRatio)}`,
        lesson_says: `LFU wins when popularity is stable (the readout’s exact LFU: ${pct(eLfu.hitRatio)}); Redis’s LFU scores below that, though it usually still beats LRU`,
        pass: lfus.every((x) => x.hitRatio < eLfu.hitRatio) && beatLru >= 4 && eLfu.hitRatio > exact('lru').hitRatio,
      },
      {
        title: 'FIFO in Redis: volatile-ttl with one TTL on every key',
        real: `volatile-ttl: ${pct(ttl.hitRatio)} hits, product:42 evicted ${ttl.hot}×, ${pct(sameVictims)} of evictions the same key, read for read, as FIFO`,
        lesson_says: `the animation’s FIFO: ${pct(eFifo.hitRatio)}, product:42 evicted ${eFifo.hot}×; the note: volatile-ttl acts much like FIFO when every key has the same TTL`,
        pass: Math.abs(ttl.hitRatio - eFifo.hitRatio) < 0.005 && Math.abs(ttl.hot - eFifo.hot) < eFifo.hot * 0.1,
      },
      {
        title: 'Without TTLs the playground falls back to allkeys-random',
        real: `allkeys-random: ${pct(random.hitRatio)} hits, product:42 evicted ${random.hot}× (the pick depends on the hash table's layout, so this varies from run to run)`,
        lesson_says: 'no FIFO in Redis; without TTLs, this evicts at random instead',
        pass: random.evicted.length > 1000 && random.hot > 0,
      },
    ];
    for (const ch of checks) R.check({ lesson: LESSON, step: 'lru-lfu-fifo', software: REDIS, ...ch });
    for (const ch of checks) expect(ch.pass, `${ch.title}: ${ch.real} vs ${ch.lesson_says}`).toBe(true);
  });

  test('lru-lfu-fifo snippet: LFU counts grow ever more slowly, top out at 255, and decay', async () => {
    const s = snippet(SNIPS, 'lru-lfu-fifo', 'redis.conf');
    const r = await server({ conf: plain(s.code) });
    await r.client.call('SET', 'product:42', 'x');
    const LOOP = "for i = 1, tonumber(ARGV[1]) do redis.call('GET', KEYS[1]) end return redis.call('OBJECT', 'FREQ', KEYS[1])";
    const counts: [number, number][] = [];
    let done = 0;
    for (const n of [100, 1000, 10_000, 100_000, 1_000_000]) {
      counts.push([n, Number(await r.client.call('EVAL', LOOP, 1, 'product:42', n - done))]);
      done = n;
    }
    const at = (n: number) => counts.find((c) => c[0] === n)![1];
    const slower = at(1000) - at(100) < at(100) * 10 && at(1_000_000) / at(100) < 100;
    const decay = unwrap(await slow.lfu);
    const checks = [
      {
        title: 'LFU count after N reads (lfu-log-factor 10)',
        real: counts.map(([n, c]) => `${n.toLocaleString('en-US')}: ${c}`).join(', '),
        lesson_says: 'grow ever more slowly: about 10 after 100 reads, 255 (the max) by a million',
        pass: at(100) >= 7 && at(100) <= 13 && at(1_000_000) === 255 && slower,
      },
      {
        title: 'An idle key’s count when a minute passes (lfu-decay-time 1)',
        real: `${decay.before} → ${decay.after1} after ${decay.minutes} minute boundary`,
        lesson_says: 'drops by 1 each minute',
        pass: decay.minutes === 1 && decay.after1 === decay.before - 1,
      },
    ];
    for (const c of checks) R.check({ lesson: LESSON, step: 'lru-lfu-fifo', software: REDIS, ...c });
    for (const c of checks) expect(c.pass, `${c.title}: ${c.real}`).toBe(true);
    R.stamp(s.code, {
      lesson: LESSON,
      by: REDIS,
      kind: 'ran',
      note: ran('a key’s count grew ever more slowly and stopped at 255 by a million reads; left idle, it dropped by one when the minute turned.'),
    });
  });

  test('working-set terminal: INFO memory and evicted_keys', async () => {
    const s = snippet(SNIPS, 'working-set', 'terminal');
    const r = await server({ conf: lruConf() });
    const trace = zipfTrace(16, DEFAULTS.skew, 300);
    const out = await replayReads(
      r.client,
      trace.map((rank) => key(PRODUCTS[rank].id)),
      { capacity: 6, valueBytes: VALUE_BYTES, mode: 'lru-clock' },
    );
    const evictions = out.filter((x) => x.evicted.length).length;
    await r.client.call('CONFIG', 'SET', 'maxmemory', '2gb');
    const code = plain(s.code).split('\n');
    const cmds = code.map((l, i) => ({ l, i })).filter((x) => x.l.startsWith('$ '));
    const shownFor = (k: number) => code.slice(cmds[k].i + 1, cmds[k + 1]?.i ?? code.length);
    const run = (k: number) => lines(shell(cmds[k].l.slice(2).replace('redis-cli', `redis-cli -p ${r.port}`)));
    const memReal = run(0);
    const memProblems = excerptMatches(shownFor(0), memReal);
    const human = (l: string) => /^\d+\.\d\d[BKMGT]$/.test(l.split(':')[1] ?? '');
    const maxShown = shownFor(0).find((l) => l.startsWith('maxmemory_human:'));
    const maxReal = memReal.find((l) => l.startsWith('maxmemory_human:'));
    const evReal = run(1);
    const checks = [
      {
        title: 'INFO memory: the fields shown, in order, "…" where lines are skipped',
        real: memProblems.length ? memProblems.join('; ') : `${memReal.find((l) => l.startsWith('used_memory_human:'))}, ${maxReal} (maxmemory 2gb)`,
        lesson_says: shownFor(0).filter((l) => l !== '…').join(', '),
        pass: memProblems.length === 0 && maxReal === maxShown && shownFor(0).filter((l) => l !== '…').every(human),
      },
      {
        title: 'INFO stats | grep evicted_keys',
        real: `${evReal.join(', ')} after ${evictions} evictions`,
        lesson_says: shownFor(1).join(', '),
        pass: evReal.length === 1 && evReal[0] === `evicted_keys:${evictions}` && evictions > 0,
      },
    ];
    for (const c of checks) R.check({ lesson: LESSON, step: 'working-set', software: REDIS, ...c });
    for (const c of checks) expect(c.pass, `${c.title}: ${c.real}`).toBe(true);
    R.stamp(s.code, { lesson: LESSON, by: REDIS, kind: 'ran', note: ran('INFO memory printed these fields in this order (with maxmemory 2gb, 2.00G), and grep evicted_keys printed one line counting every eviction.') });
  });
});

/* ================================================================== */

describe('writes', () => {
  test('three-ways-to-write: what survives a crash', async () => {
    const snap = unwrap(await slow.snapshot);
    // Append-only file on (appendfsync left at its default)
    const aof = await server({ persistence: true, args: ['--appendonly', 'yes', '--save', ''] });
    const fsync = (await configGet(aof.client, ['appendfsync'])).appendfsync;
    const acks = await Promise.all(Array.from({ length: 20_000 }, (_, i) => aof.client.call('SET', `w:${i}`, 'v')));
    await aof.stop('SIGKILL');
    const aofAgain = await server({ persistence: true, port: aof.port, dir: aof.dir, args: ['--appendonly', 'yes', '--save', ''] });
    const aofKept = Number(await aofAgain.client.call('DBSIZE'));
    // No persistence at all, like the animation's Redis
    const bare = await server();
    await Promise.all(Array.from({ length: 1000 }, (_, i) => bare.client.call('SET', `w:${i}`, 'v')));
    await bare.stop('SIGKILL');
    const bareAgain = await server({ port: bare.port, dir: bare.dir });
    const bareKept = Number(await bareAgain.client.call('DBSIZE'));
    const acked = acks.filter((a) => a === 'OK').length;
    const checks = [
      {
        title: 'Out of the box: snapshots, and a crash after one',
        real: `save "${snap.conf.save}", appendonly ${snap.conf.appendonly}; after 10,000 writes a snapshot came ${snap.savedAt?.toFixed(0)} s after startup; killed with 100 more writes, it restarted with ${snap.kept} keys and ${snap.late} of the 100`,
        lesson_says: 'snapshots at most once a minute, and a crash loses every write since the last snapshot',
        pass: snap.conf.save === '3600 1 300 100 60 10000' && snap.conf.appendonly === 'no' && snap.savedAt != null && snap.savedAt > 55 && snap.kept === 10_000 && snap.late === 0,
      },
      {
        title: 'Append-only file on, then kill -9',
        real: `appendfsync ${fsync}; ${acked} writes acknowledged, ${aofKept} there after the restart`,
        lesson_says: 'a killed Redis came back with every write it had acknowledged, though by default it syncs that file to disk only once a second',
        pass: fsync === 'everysec' && acked === 20_000 && aofKept === acked,
      },
      {
        title: 'No snapshot to reload',
        real: `killed with 1,000 keys, restarted with ${bareKept}`,
        lesson_says: 'Redis comes back cold, because this one has no snapshot to reload',
        pass: bareKept === 0,
      },
    ];
    for (const c of checks) R.check({ lesson: LESSON, step: 'three-ways-to-write', software: REDIS, ...c });
    for (const c of checks) expect(c.pass, `${c.title}: ${c.real}`).toBe(true);
  });
});

/* ================================================================== */

describe('hash-tables: small hashes are a flat list', () => {
  test('lookup-race redis.conf: the switch at 512 entries and 64 bytes, a third of the memory', async () => {
    const s = snippet(HT_SNIPS, 'lookup-race', 'redis.conf');
    const r = await server({ conf: plain(s.code) });
    const c = r.client;
    const hash = async (fields: number, value = 'v') => {
      await c.call('DEL', 'h');
      const args: (string | number)[] = ['HSET', 'h'];
      for (let i = 0; i < fields; i++) args.push(`field${i}`, value);
      await c.call(...args);
      return { enc: String(await c.call('OBJECT', 'ENCODING', 'h')), bytes: Number(await c.call('MEMORY', 'USAGE', 'h', 'SAMPLES', 0)) };
    };
    const at512 = await hash(512);
    const at513 = await hash(513);
    const v64 = await hash(1, 'x'.repeat(64));
    const v65 = await hash(1, 'x'.repeat(65));
    const switches = at512.enc === 'listpack' && at513.enc === 'hashtable' && v64.enc === 'listpack' && v65.enc === 'hashtable';

    // Memory and lookup cost, flat list vs hash table, for a few entries and for many.
    const flat = await server();
    const table = await server({ args: ['--hash-max-listpack-entries', '0'] });
    const measure = async (srv: RedisServer, fields: number) => {
      const cl = srv.client;
      await cl.call('DEL', 'h');
      await cl.call('CONFIG', 'RESETSTAT');
      const args: (string | number)[] = ['HSET', 'h'];
      for (let i = 0; i < fields; i++) args.push(`field${i}`, `value${i}`);
      await cl.call(...args);
      const N = 30_000;
      for (let i = 0; i < N; i += 1000) await Promise.all(Array.from({ length: 1000 }, (_, j) => cl.call('HGET', 'h', `field${(i + j) % fields}`)));
      const us = Number((await info(cl, 'commandstats')).cmdstat_hget.match(/usec=(\d+)/)?.[1]);
      return { enc: String(await cl.call('OBJECT', 'ENCODING', 'h')), bytes: Number(await cl.call('MEMORY', 'USAGE', 'h', 'SAMPLES', 0)), ns: (us / N) * 1000 };
    };
    const rows = [];
    for (const fields of [4, 512]) rows.push({ fields, flat: await measure(flat, fields), table: await measure(table, fields) });
    const third = rows.every((x) => x.flat.bytes / x.table.bytes > 0.2 && x.flat.bytes / x.table.bytes < 0.45);
    const slowsDown = rows[1].flat.ns > rows[0].flat.ns * 3;
    const checks = [
      {
        title: 'When a hash stops being a flat list',
        real: `512 fields: ${at512.enc}, 513: ${at513.enc}; a 64-byte value: ${v64.enc}, 65 bytes: ${v65.enc}`,
        lesson_says: 'hash-max-listpack-entries 512, hash-max-listpack-value 64',
        pass: switches,
      },
      {
        title: 'Flat list vs hash table',
        real: rows.map((x) => `${x.fields} fields: ${x.flat.bytes} vs ${x.table.bytes} bytes, ${x.flat.ns.toFixed(0)} vs ${x.table.ns.toFixed(0)} ns per HGET inside Redis`).join('; '),
        lesson_says: 'the flat list takes about a third of the memory, but lookups slow down as it grows',
        pass: third && slowsDown && rows.every((x) => x.flat.enc === 'listpack' && x.table.enc === 'hashtable'),
      },
    ];
    for (const ch of checks) R.check({ lesson: 'hash-tables', step: 'lookup-race', software: REDIS, ...ch });
    for (const ch of checks) expect(ch.pass, `${ch.title}: ${ch.real}`).toBe(true);
    R.stamp(s.code, { lesson: 'hash-tables', by: REDIS, kind: 'ran', note: ran('these are its defaults. A hash of 512 small fields stayed a flat list and the 513th made it a hash table; the flat list took about a third of the memory.') });
  });
});

/* ================================================================== */

describe('stack-heap: a fragmented heap', () => {
  test('fragmentation: INFO memory after deleting every other key', async () => {
    const s = snippet(SH_SNIPS, 'fragmentation', 'redis-cli: a fragmented heap in production');
    const r = await server({ args: ['--enable-debug-command', 'yes'] });
    const c = r.client;
    const read = async () => {
      await sleep(1200); // RSS is sampled by Redis's once-a-second-ish cron
      const m = await info(c, 'memory');
      return { used: Number(m.used_memory), rss: Number(m.used_memory_rss), ratio: Number(m.mem_fragmentation_ratio), allocator: m.mem_allocator };
    };
    await c.call('DEBUG', 'POPULATE', 1_000_000, 'k', 100);
    const full = await read();
    const DEL = "for i = tonumber(ARGV[1]), tonumber(ARGV[2]), 2 do redis.call('DEL', 'k:' .. i) end return 1";
    for (let i = 0; i < 1_000_000; i += 100_000) await c.call('EVAL', DEL, 0, i, i + 99_999);
    const holes = await read();
    const ADD = "for i = tonumber(ARGV[1]), tonumber(ARGV[2]) do redis.call('SET', 'n:' .. i, string.rep('v', 100)) end return 1";
    for (let i = 0; i < 500_000; i += 100_000) await c.call('EVAL', ADD, 0, i, i + 99_999);
    const refilled = await read();
    const shown = lines(plain(s.code));
    const cmd = shown[0].replace('127.0.0.1:6379> ', '');
    const real = lines(shell(`redis-cli -p ${r.port} ${cmd}`));
    const problems = excerptMatches(shown.slice(1), real);
    const [usedShown, rssShown, ratioShown] = ['used_memory_human', 'used_memory_rss_human', 'mem_fragmentation_ratio'].map((f) => shown.find((l) => l.startsWith(`${f}:`))!.split(':')[1]);
    const mb = (b: number) => `${(b / 2 ** 20).toFixed(0)} MB`;
    const checks = [
      {
        title: 'INFO memory: the fields shown, in order, "…" where lines are skipped',
        real: problems.length ? problems.join('; ') : `ok (mem_allocator:${holes.allocator})`,
        lesson_says: shown.slice(1).join(' '),
        pass: problems.length === 0,
      },
      {
        title: 'Deleting every other key of a million',
        real: `used_memory ${mb(full.used)} → ${mb(holes.used)}, RSS ${mb(full.rss)} → ${mb(holes.rss)}, ratio ${full.ratio} → ${holes.ratio}; 500,000 new keys: used ${mb(refilled.used)}, RSS ${mb(refilled.rss)}`,
        lesson_says: `${usedShown} used, ${rssShown} held, ratio ${ratioShown}: "45% overhead, mostly holes"`,
        pass: holes.used < full.used * 0.6 && holes.rss > full.rss * 0.9 && holes.ratio > 1.4 && refilled.rss < holes.rss * 1.05 && refilled.ratio < 1.2,
      },
      {
        title: 'mem_fragmentation_ratio is RSS divided by used memory',
        real: `${holes.ratio} reported, ${(holes.rss / holes.used).toFixed(2)} computed`,
        lesson_says: `${ratioShown} = ${rssShown} / ${usedShown} (${(parseFloat(rssShown) / parseFloat(usedShown)).toFixed(2)})`,
        pass: Math.abs(holes.ratio - holes.rss / holes.used) < 0.05 && (parseFloat(rssShown) / parseFloat(usedShown)).toFixed(2) === ratioShown,
      },
    ];
    for (const ch of checks) R.check({ lesson: 'stack-heap', step: 'fragmentation', software: REDIS, ...ch });
    for (const ch of checks) expect(ch.pass, `${ch.title}: ${ch.real}`).toBe(true);
    R.stamp(s.code, {
      lesson: 'stack-heap',
      by: REDIS,
      kind: 'ran',
      note: ran(`with ${holes.allocator} malloc, deleting every other key of a million halved used memory but not RSS, so the ratio (RSS ÷ used) doubled; new keys then filled the holes without growing RSS.`),
    });
  });
});

