/**
 * Rate Limiting lesson vs. real nginx and Redis.
 *
 * nginx runs the lesson's `limit_req` snippets. Its access log says, for every
 * request, when it arrived, what limit_req decided and when it was let through
 * to the server. The same arrival times then go through the lesson's own
 * limiter (limiter.ts), and the two are compared request by request.
 *
 * Redis runs the lesson's Lua token bucket, its redis-cli commands and
 * gateway.js, on the timestamps of the animation's own decisions.
 */
import http from 'node:http';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { CHAPTERS } from '@/lessons/rate-limiting/chapters';
import { decide, freshState, leak, type Params } from '@/lessons/rate-limiting/limiter';
import { personOf } from '@/lessons/rate-limiting/sim';
import { raceScript } from '@/lessons/rate-limiting/stage/Race';
import { fire, handlerBody, limitReqHttp, pipelined, readLog, redisCommands, runStep, zonesIn, type LimitReqStatus, type Logged } from './lib/ratelimit';
import { freePort, nginxCheck, nginxVersion, redisClient, redisVersion, startBackends, startNginx, startRedis, tmpDir } from './lib/procs';
import { request } from './lib/http';
import { results } from './lib/results';
import { collectSnippets, plain, snippet } from './lib/snippets';

const LESSON = 'rate-limiting';
const R = results(LESSON);
const NGINX = `nginx ${nginxVersion()}`;
const REDIS = `Redis ${redisVersion()}`;
const SNIPS = collectSnippets(CHAPTERS);

const TOKEN_NGINX = snippet(SNIPS, 'burst-then-trickle', 'nginx.conf');
const LEAKY_NGINX = snippet(SNIPS, 'leaky-bucket', 'nginx.conf');
/** Zones defined anywhere in the lesson (the leaky step reuses "api" from the token step). */
const ZONES = SNIPS.filter((s) => s.lang === 'nginx').flatMap((s) => zonesIn(s.code));

/** A number the snippet's note states, e.g. "send (\d+) requests at once". */
function noteSays(note: string | undefined, re: RegExp) {
  const m = (note ?? '').match(re);
  if (!m) throw new Error(`the note no longer says ${re}: ${note}`);
  return Number(m[1].replace(/,/g, ''));
}

/** burst=, nodelay and the zone's rate, read from the snippet itself (comments aside: "# no nodelay"). */
function limitsOf(code: string) {
  const text = plain(code).replace(/#.*$/gm, '');
  const zoneName = text.match(/limit_req\s+zone=([\w-]+)/)?.[1];
  const zone = [...zonesIn(code), ...ZONES].find((z) => z.includes(`zone=${zoneName}:`));
  const rate = Number(zone?.match(/rate=(\d+)r\/s/)?.[1]);
  const burst = Number(text.match(/burst=(\d+)/)?.[1] ?? 0);
  if (!zone || !rate) throw new Error(`can't read the zone and rate for ${zoneName}`);
  return { burst, rate, nodelay: /\bnodelay\b/.test(text) };
}

/* ---------------- cleanup between tests ---------------- */

const cleanup: (() => unknown)[] = [];
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!();
});

/** nginx running a lesson snippet in front of one stand-in API server, logging every decision. */
async function limited(code: string) {
  const [api] = await startBackends(['api-1']);
  cleanup.push(() => api.kill());
  const port = await freePort();
  const log = path.join(tmpDir('rl-log'), 'access.log');
  const conf = limitReqHttp(code, { port, backend: `127.0.0.1:${api.port}`, zones: ZONES, log });
  const ng = await startNginx(conf.text, port);
  cleanup.push(ng.stop);
  return { url: `http://127.0.0.1:${port}/api/items`, log: () => readLog(log), ng };
}

/**
 * Run a request plan against a fresh nginx with the snippet. For "at once" to
 * mean at once, each group has to reach nginx within 150 ms; on a machine busy
 * enough to spread one further, the run is repeated (up to 3 times).
 */
async function scenario(code: string, plan: { at: number; n?: number }[]) {
  for (let attempt = 1; ; attempt++) {
    const ng = await limited(code);
    const sent = await fire(ng.url, plan);
    const log = ng.log();
    let start = 0;
    let spread = 0;
    for (const p of plan) {
      const group = log.filter(range(start, p.n ?? 1)).map((r) => r.arrived);
      spread = Math.max(spread, Math.max(...group) - Math.min(...group));
      start += p.n ?? 1;
    }
    if (spread < 150 || attempt === 3) return { sent, log, spread };
  }
}

async function redis() {
  const r = await startRedis();
  cleanup.push(r.stop);
  cleanup.push(() => r.client.close()); // clients close before the server stops
  const extra = async () => {
    const c = await redisClient(r.port);
    cleanup.push(() => c.close());
    return c;
  };
  return { ...r, extra };
}

/* ---------------- the lesson's limiter on nginx's clock ---------------- */

interface LessonRun {
  /** request number -> what the lesson's limiter decided */
  verdicts: Map<number, LimitReqStatus>;
  /** request number -> ms (nginx clock) it goes on to the server */
  leaves: Map<number, number>;
  /** decisions taken 1 ms off the logged time (see below) */
  nudged: number;
}

/**
 * Feed nginx's arrival times through limiter.ts (decide, plus leak for the
 * leaky bucket). nginx decides on its monotonic millisecond clock while the
 * log prints wall-clock milliseconds, so the two can be 1 ms apart. Where
 * that 1 ms flips a decision, the decision 1 ms off is used and counted.
 */
function lessonOn(reqs: Logged[], algo: 'token' | 'leaky', p: Params): LessonRun {
  let s = freshState('client', reqs[0].arrived / 1000, p);
  const verdicts = new Map<number, LimitReqStatus>();
  const leaves = new Map<number, number>();
  let nudged = 0;
  for (const r of reqs) {
    const tries = [0, -1, 1].map((dms) => {
      const st = structuredClone(s);
      const now = (r.arrived + dms) / 1000;
      const out = algo === 'leaky' ? leak(st, now, p) : [];
      const d = decide(st, now, p, algo);
      if (d.queued) st.queue.push({ id: r.i, client: 'client', at: now });
      const v: LimitReqStatus = !d.ok ? 'REJECTED' : d.queued ? 'DELAYED' : 'PASSED';
      return { st, out, v, now, dms };
    });
    const pick = tries.find((x) => x.v === r.decision) ?? tries[0];
    if (pick.dms) nudged++;
    s = pick.st;
    for (const o of pick.out) leaves.set(o.req.id, o.at * 1000);
    verdicts.set(r.i, pick.v);
    if (pick.v === 'PASSED') leaves.set(r.i, pick.now * 1000);
  }
  for (const o of leak(s, Infinity, p)) leaves.set(o.req.id, o.at * 1000);
  return { verdicts, leaves, nudged };
}

const count = <T>(xs: T[], f: (x: T) => boolean) => xs.filter(f).length;
/** How closely each simultaneous group reached nginx. */
const together = (spread: number) => (spread ? `each burst reached nginx within ${spread} ms` : 'each burst reached nginx in the same millisecond');
const range = (from: number, n: number) => (r: { i: number }) => r.i >= from && r.i < from + n;

/* ================================================================== */

describe('every nginx snippet loads', () => {
  for (const s of SNIPS.filter((x) => x.lang === 'nginx')) {
    test(`nginx -t: ${s.step} / ${s.title}`, async () => {
      const port = await freePort();
      const { text, changes } = limitReqHttp(s.code, { port, zones: ZONES });
      const r = nginxCheck(text);
      R.check({ lesson: LESSON, step: s.step, title: `nginx accepts the ${s.title} snippet`, software: NGINX, real: r.ok ? `accepted (${changes.join('; ')})` : r.output.split('\n')[0], pass: r.ok });
      expect(r.ok, r.output).toBe(true);
      R.stamp(s.code, { lesson: LESSON, by: NGINX, kind: 'loads', note: `nginx ${nginxVersion()} loads this config (nginx -t).` });
    });
  }
});

/* ================================================================== */

describe('nginx limit_req', () => {
  test('with nodelay it acts like a token bucket of burst + 1 (burst-then-trickle)', async () => {
    const { burst, rate, nodelay } = limitsOf(TOKEN_NGINX.code);
    expect(nodelay).toBe(true);
    // An idle client sends 20 at once, then 10 a second for 3 s, pauses about
    // a second, sends 10, rests 2.5 s, sends 15. Times sit halfway between
    // refills, so a few ms of scheduling jitter can't change the answer.
    const steady = Array.from({ length: 31 }, (_, j) => ({ at: 50 + 100 * j }));
    const { sent, log, spread } = await scenario(TOKEN_NGINX.code, [{ at: 0, n: 20 }, ...steady, { at: 4100, n: 10 }, { at: 6600, n: 15 }]);
    expect(log.length).toBe(sent.length);

    // The lesson's token bucket, sized the way the note says: burst + 1 tokens, refilled at the zone's rate.
    const lesson = lessonOn(log, 'token', { limit: 1, window: 1, capacity: burst + 1, rate });
    const mismatches = log.filter((r) => lesson.verdicts.get(r.i) !== r.decision);
    const passed = (f: (r: { i: number }) => boolean) => count(log, (r) => f(r) && r.status === 200);
    const lessonPassed = (f: (r: { i: number }) => boolean) => count(log, (r) => f(r) && lesson.verdicts.get(r.i) === 'PASSED');
    const first = range(0, 20);
    const trickle = range(20, 31);
    // After the burst, how far apart the requests that got through were.
    const through = log.filter((r) => trickle(r) && r.status === 200).map((r) => r.arrived);
    const gap = (through[through.length - 1] - through[0]) / (through.length - 1);
    const rejected = [...new Set(log.filter((r) => r.decision === 'REJECTED').map((r) => r.status))];
    const atOnce = noteSays(TOKEN_NGINX.note, /send (\d+) requests at once/);
    const perSecond = noteSays(TOKEN_NGINX.note, /then (\d+) per second/);

    const checks = [
      {
        title: 'An idle client sends 20 requests at once',
        real: `${passed(first)} passed, ${20 - passed(first)} rejected (${together(spread)})`,
        lesson_says: `${atOnce} (burst + 1); the lesson's token bucket on the same arrivals: ${lessonPassed(first)}`,
        pass: passed(first) === burst + 1 && atOnce === burst + 1 && lessonPassed(first) === burst + 1,
      },
      {
        title: 'Then a steady 10 requests a second',
        real: `${passed(trickle)} of 31 passed, one every ${gap.toFixed(0)} ms on average: ${(1000 / gap).toFixed(1)} per second`,
        lesson_says: `${perSecond} per second; the lesson's token bucket: ${lessonPassed(trickle)} of 31`,
        pass: passed(trickle) === lessonPassed(trickle) && Math.abs(1000 / gap - perSecond) < 0.25,
      },
      {
        title: 'Every decision, request by request',
        real: `${count(log, (r) => r.status === 200)} passed, ${count(log, (r) => r.decision === 'REJECTED')} rejected of ${log.length}; after a 1 s pause ${passed(range(51, 10))} of 10, after 2.5 s ${passed(range(61, 15))} of 15`,
        lesson_says: `token bucket of ${burst + 1} refilling at ${rate}/s: ${mismatches.length} disagreements (${lesson.nudged} decided on the 1 ms clock difference)`,
        pass: mismatches.length === 0 && lesson.nudged <= 3,
      },
      {
        title: 'Status of the rejected requests',
        real: rejected.join('/'),
        lesson_says: 'limit_req_status 429',
        pass: rejected.length === 1 && rejected[0] === 429 && sent.every((x) => x.status === 200 || x.status === 429),
      },
    ];
    for (const c of checks) R.check({ lesson: LESSON, step: 'burst-then-trickle', software: NGINX, ...c });
    for (const c of checks) expect(c.pass, `${c.title}: real ${c.real}; lesson ${c.lesson_says}`).toBe(true);
    R.stamp(TOKEN_NGINX.code, {
      lesson: LESSON,
      by: NGINX,
      kind: 'ran',
      note: `Ran it on nginx ${nginxVersion()}: an idle client got 11 of 20 simultaneous requests through and 9 got 429, then 5 per second got through. Every decision matched a token bucket of 11 tokens refilling at 5 per second.`,
    });
  });

  test('without limit_req_status, rejections are 503 (burst-then-trickle comment)', async () => {
    const line = plain(TOKEN_NGINX.code)
      .split('\n')
      .find((l) => /limit_req_status/.test(l));
    const says = Number(line?.match(/#\s*default:\s*(\d+)/)?.[1]);
    const without = plain(TOKEN_NGINX.code)
      .split('\n')
      .filter((l) => l !== line)
      .join('\n');
    const { sent } = await scenario(without, [{ at: 0, n: 15 }]);
    const statuses = [...new Set(sent.filter((x) => x.status !== 200).map((x) => x.status))];
    const pass = statuses.length === 1 && statuses[0] === says && count(sent, (x) => x.status === 200) === 11;
    R.check({
      lesson: LESSON,
      step: 'burst-then-trickle',
      title: 'The default status for a rejected request',
      software: NGINX,
      real: `${count(sent, (x) => x.status === 200)} × 200, ${count(sent, (x) => x.status !== 200)} × ${statuses.join('/')}`,
      lesson_says: `default: ${says}`,
      pass,
    });
    expect(pass).toBe(true);
  });

  test('without nodelay it is a leaky bucket that releases at exactly the rate (leaky-bucket)', async () => {
    const { burst, rate, nodelay } = limitsOf(LEAKY_NGINX.code);
    expect(nodelay).toBe(false);
    // 15 at once, then 10 a second for 2 s while the queue drains (halfway
    // between drips), then one more long after it's empty.
    const steady = Array.from({ length: 21 }, (_, j) => ({ at: 550 + 100 * j }));
    const { sent, log, spread } = await scenario(LEAKY_NGINX.code, [{ at: 0, n: 15 }, ...steady, { at: 7000 }]);
    expect(log.length).toBe(sent.length);

    // The lesson's leaky bucket: `burst` queue slots, dripping at the zone's rate.
    const lesson = lessonOn(log, 'leaky', { limit: 1, window: 1, capacity: burst, rate });
    const mismatches = log.filter((r) => lesson.verdicts.get(r.i) !== r.decision);
    const accepted = log.filter((r) => r.released != null);
    const offBy = accepted.map((r) => Math.abs(r.released! - (lesson.leaves.get(r.i) ?? Infinity)));
    const busy = accepted.filter((r) => r.arrived - log[0].arrived < 5000).map((r) => r.released!);
    busy.sort((a, b) => a - b);
    const gaps = busy.slice(1).map((t, k) => t - busy[k]);
    const avgGap = (busy[busy.length - 1] - busy[0]) / gaps.length;
    const first = log.filter(range(0, 15));
    const kinds = (rs: Logged[], f: (r: Logged) => LimitReqStatus | undefined) =>
      (['PASSED', 'DELAYED', 'REJECTED'] as const).map((k) => `${count(rs, (r) => f(r) === k)} ${k.toLowerCase()}`).join(', ');
    const rejected = [...new Set(log.filter((r) => r.decision === 'REJECTED').map((r) => r.status))];

    const checks = [
      {
        title: '15 requests at once',
        real: `${kinds(first, (r) => r.decision)} (${together(spread)})`,
        lesson_says: `leaky bucket with ${burst} slots: ${kinds(first, (r) => lesson.verdicts.get(r.i))}`,
        pass: first.every((r) => lesson.verdicts.get(r.i) === r.decision) && count(first, (r) => r.decision === 'DELAYED') === burst,
      },
      {
        // One late timer on a busy machine shifts a single release; the average can't drift.
        title: 'Held requests go to the server at a fixed pace',
        real: `${busy.length} releases, ${Math.min(...gaps)}–${Math.max(...gaps)} ms apart (average ${avgGap.toFixed(1)} ms)`,
        lesson_says: `one every ${1000 / rate} ms ("exactly the configured rate")`,
        pass: gaps.every((g) => Math.abs(g - 1000 / rate) <= 50) && Math.abs(avgGap - 1000 / rate) <= 3,
      },
      {
        title: 'Every decision and release time, request by request',
        real: `${kinds(log, (r) => r.decision)}; every release within ${Math.round(Math.max(...offBy))} ms of the lesson's`,
        lesson_says: `${mismatches.length} disagreements (${lesson.nudged} decided on the 1 ms clock difference)`,
        pass: mismatches.length === 0 && lesson.nudged <= 3 && Math.max(...offBy) <= 50,
      },
      {
        title: 'Status when the bucket is full',
        real: rejected.join('/'),
        lesson_says: '429 (limit_req_status 429)',
        pass: rejected.length === 1 && rejected[0] === 429,
      },
    ];
    for (const c of checks) R.check({ lesson: LESSON, step: 'leaky-bucket', software: NGINX, ...c });
    for (const c of checks) expect(c.pass, `${c.title}: real ${c.real}; lesson ${c.lesson_says}`).toBe(true);
    R.stamp(LEAKY_NGINX.code, {
      lesson: LESSON,
      by: NGINX,
      kind: 'ran',
      note: `Ran it on nginx ${nginxVersion()}: of 15 simultaneous requests, 1 went straight through, 10 waited and left one every 200 ms, and 4 got 429. Every decision and release matched the lesson's leaky bucket.`,
    });
  });

  test('how many client IPs a 10m zone remembers (burst-then-trickle note)', async () => {
    // The snippet's own zone line (key $binary_remote_addr, 10m), with the rate
    // slowed to 1r/m so a remembered address stays limited for the whole test.
    // One machine poses as many clients with X-Real-IP (the realip module).
    const zone = zonesIn(TOKEN_NGINX.code)[0];
    const measure = async (size: string, n: number) => {
      const port = await freePort();
      const z = zone.replace(/rate=[^;\s]+/, 'rate=1r/m').replace(/:\d+m\b/, `:${size}`);
      const ng = await startNginx(
        `${z}\nserver {\n  listen 127.0.0.1:${port};\n  set_real_ip_from 127.0.0.1;\n  real_ip_header X-Real-IP;\n  location / { limit_req zone=api; limit_req_status 429; empty_gif; }\n}`,
        port,
      );
      cleanup.push(ng.stop);
      const ip = (i: number) => `10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`;
      // Fill: one request each from n different addresses, oldest first.
      let firstTime = 0;
      for (let a = 0; a < n; a += 1000) {
        const statuses = await pipelined(port, Array.from({ length: Math.min(1000, n - a) }, (_, k) => ip(a + k)));
        firstTime += count(statuses, (s) => s === 200);
      }
      // A remembered address is refused a second request; a forgotten one is new again.
      // Binary search for the oldest address nginx still remembers.
      const remembered = async (i: number) => (await pipelined(port, [ip(i)]))[0] === 429;
      let lo = 0;
      let hi = n - 1;
      if (!(await remembered(hi)) || (await remembered(lo))) return { firstTime, kept: NaN };
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (await remembered(mid)) hi = mid;
        else lo = mid;
      }
      return { firstTime, kept: n - hi };
    };
    const ten = await measure('10m', 200_000);
    const one = await measure('1m', 20_000);
    const says = noteSays(TOKEN_NGINX.note, /holds about ([\d,]+) client IPs/);
    const pass = ten.firstTime === 200_000 && Math.abs(ten.kept - says) / ten.kept < 0.15;
    const fmt = (x: number) => x.toLocaleString('en-US');
    R.check({
      lesson: LESSON,
      step: 'burst-then-trickle',
      title: 'How many client IPs a 10m zone remembers',
      software: NGINX,
      real: `remembered the last ${fmt(ten.kept)} of ${fmt(ten.firstTime)} IPv4 addresses, forgetting the oldest first (a 1m zone: ${fmt(one.kept)})`,
      lesson_says: `about ${fmt(says)}`,
      pass,
    });
    expect(pass, `kept ${ten.kept} (fill: ${ten.firstTime} of 200000 passed), the note says ${says}`).toBe(true);
  });
});

/* ================================================================== */

describe('Redis', () => {
  const LUA = snippet(SNIPS, 'atomic-counters', 'token_bucket.lua');

  test("token_bucket.lua decides like the lesson's token bucket, in one atomic step (atomic-counters)", async () => {
    const r = await redis();
    const sha = String(await r.client.call('SCRIPT', 'LOAD', plain(LUA.code)));
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
    const bucket = async (key: string, cap: number, rate: number, nowMs: number) => r.client.call('EVALSHA', sha, 1, key, cap, rate, String(nowMs));

    // 1. The animation's own requests, in every step that uses a token bucket.
    // Times go in as whole milliseconds, the way a gateway passes Date.now().
    // (The animation's frame clock carries float noise; fed raw, a request that
    // lands exactly on a refill instant can come out a hair short of 1 token.)
    const steps = ['token-bucket', 'burst-then-trickle', 'predict-token-bucket', 'backoff-and-jitter', 'cheat-sheet'];
    let n = 0;
    let animOk = 0;
    let luaOk = 0;
    let vsAnimation = 0;
    let vsLimiter = 0;
    for (const id of steps) {
      const { sim, trace } = runStep(id, 120);
      const p: Params = { limit: 1, window: 1, capacity: sim.cfg.capacity, rate: sim.cfg.rate };
      const states = new Map<string, ReturnType<typeof freshState>>();
      for (const { d } of trace.filter((x) => x.d.algo === 'token')) {
        const ms = Math.round(d.at * 1000);
        const ok = (await bucket(`tb:${id}:${d.key}`, p.capacity, p.rate, ms)) === 1;
        // limiter.ts on the same timestamp, without the animation's frame-by-frame refills
        if (!states.has(d.key)) states.set(d.key, freshState(d.key, ms / 1000, p));
        const mine = decide(states.get(d.key)!, ms / 1000, p, 'token').ok;
        n++;
        animOk += d.ok ? 1 : 0;
        luaOk += ok ? 1 : 0;
        if (ok !== d.ok) vsAnimation++;
        if (ok !== mine) vsLimiter++;
      }
    }

    // 2. Random arrivals, including the nginx-sized bucket (11 tokens, 5 per second).
    let seed = 11;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    let randomN = 0;
    let randomOff = 0;
    for (const [cap, rate] of [
      [5, 1],
      [11, 5],
      [5, 0.5],
    ]) {
      const p: Params = { limit: 1, window: 1, capacity: cap, rate };
      let t = 1000 + rnd() * 1000;
      const s = freshState('r', t / 1000, p);
      for (let k = 0; k < 400; k++) {
        t += rnd() < 0.3 ? rnd() * 5 : (rnd() * 2000) / rate;
        const ok = (await bucket(`rnd:${cap}:${rate}`, cap, rate, t)) === 1;
        if (ok !== decide(s, t / 1000, p, 'token').ok) randomOff++;
        randomN++;
      }
    }

    // 3. The note: Redis runs the script without interleaving any other command.
    // 20 requests at the same moment, 5 through each of 4 gateways, into a full 5-token bucket.
    const gateways = await Promise.all([1, 2, 3, 4].map(() => r.extra()));
    const now = 1_790_424_600_000;
    const viaLua = await Promise.all(gateways.flatMap((g) => Array.from({ length: 5 }, () => g.call('EVALSHA', sha, 1, 'tb:lua', 5, 1, now))));
    // The same steps sent one at a time from the gateway: read, decide, write.
    const readDecideWrite = await Promise.all(
      gateways.flatMap((g) =>
        Array.from({ length: 5 }, async () => {
          const [tok, ts] = (await g.call('HMGET', 'tb:rdw', 'tokens', 'ts')) as (string | null)[];
          let tokens = Math.min(5, (tok == null ? 5 : Number(tok)) + ((now - (ts == null ? now : Number(ts))) / 1000) * 1);
          const ok = tokens >= 1;
          if (ok) tokens -= 1;
          await g.call('HSET', 'tb:rdw', 'tokens', tokens, 'ts', now);
          return ok ? 1 : 0;
        }),
      ),
    );
    const lua = count(viaLua, (x) => x === 1);
    const rdw = count(readDecideWrite, (x) => x === 1);

    const checks = [
      {
        title: "The Lua script on the animation's own request times",
        real: `EVALSHA allowed ${luaOk} and denied ${n - luaOk} of ${n} requests from ${steps.length} steps (times in whole ms)`,
        lesson_says: `the animation allowed ${animOk}: ${vsAnimation} disagreements; limiter.ts on the same times: ${vsLimiter}`,
        pass: n > 200 && vsAnimation === 0 && vsLimiter === 0,
      },
      {
        title: 'The Lua script on random arrivals',
        real: `${randomN} requests into buckets of 5 @ 1/s, 11 @ 5/s and 5 @ 0.5/s`,
        lesson_says: `limiter.ts: ${randomOff} disagreements`,
        pass: randomOff === 0,
      },
      {
        title: '20 requests at the same moment from 4 gateways, bucket of 5',
        real: `as one Lua script (EVALSHA): ${lua} allowed; as separate HMGET and HSET calls: ${rdw} allowed`,
        lesson_says: 'Redis executes the script without interleaving any other command',
        pass: lua === 5 && rdw > 5,
      },
    ];
    for (const c of checks) R.check({ lesson: LESSON, step: 'atomic-counters', software: REDIS, ...c });
    for (const c of checks) expect(c.pass, `${c.title}: real ${c.real}; lesson ${c.lesson_says}`).toBe(true);
    R.stamp(LUA.code, {
      lesson: LESSON,
      by: REDIS,
      kind: 'ran',
      note: `Ran it on Redis ${redisVersion()}: called with EVALSHA on the animation's own request times, it allowed and denied exactly what the lesson's token bucket did. 20 simultaneous calls on a 5-token bucket let exactly 5 through.`,
    });
  });

  test('GET then SET races; INCR does not (atomic-counters)', async () => {
    const r = await redis();
    const [gw1, gw2] = [await r.extra(), await r.extra()];
    const getset = raceScript(true);
    const incr = raceScript(false);
    const key = getset.key;
    const LIMIT = 5;

    // Two scraper requests reach two gateways at the same moment; the count is at 4.
    await r.client.call('SET', key, 4);
    const gs = await Promise.all(
      [gw1, gw2].map(async (g) => {
        const n = Number(await g.call('GET', key));
        const ok = n < LIMIT;
        if (ok) await g.call('SET', key, n + 1);
        return { n, ok };
      }),
    );
    const afterGs = Number(await r.client.call('GET', key));
    await r.client.call('SET', key, 4);
    const inc = await Promise.all(
      [gw1, gw2].map(async (g) => {
        const n = Number(await g.call('INCR', key));
        return { n, ok: n <= LIMIT };
      }),
    );
    const afterIncr = Number(await r.client.call('GET', key));

    // What the diagram draws, and the answer the prediction accepts.
    const replies = (sc: ReturnType<typeof raceScript>) => sc.messages.filter((m) => m.from === 'redis').map((m) => Number(m.label));
    const { sim } = runStep('atomic-counters', 4);
    const answer = sim.game?.last?.picked;
    const checks = [
      {
        title: 'GET, then SET, from two gateways at once',
        real: `both read ${gs.map((x) => x.n).join(' and ')}, ${count(gs, (x) => x.ok)} allowed, the counter says ${afterGs}`,
        lesson_says: `both read ${replies(getset).join(' and ')}, "${answer}" get through, the counter says ${getset.notes[0]?.text.replace(/\D/g, '')}`,
        pass: gs.every((x) => x.n === 4 && x.ok) && afterGs === 5 && replies(getset).join() === '4,4' && answer === 'both' && getset.notes[0]?.text === 'count = 5',
      },
      {
        title: 'INCR from two gateways at once',
        real: `replies ${inc.map((x) => x.n).sort().join(' and ')}: ${count(inc, (x) => x.ok)} allowed, ${count(inc, (x) => !x.ok)} refused; counter ${afterIncr}`,
        lesson_says: `replies ${replies(incr).join(' and ')}: gw-1 allows, gw-2 sends a 429`,
        pass: inc.map((x) => x.n).sort().join() === replies(incr).join() && count(inc, (x) => x.ok) === 1 && afterIncr === 6,
      },
    ];
    for (const c of checks) R.check({ lesson: LESSON, step: 'atomic-counters', software: REDIS, ...c });
    for (const c of checks) expect(c.pass, `${c.title}: real ${c.real}; lesson ${c.lesson_says}`).toBe(true);
  });

  test('gateway.js: local counters let the scraper through 3 times, one shared count holds (distributed-counters)', async () => {
    const GW = snippet(SNIPS, 'distributed-counters', 'gateway.js');
    const handler = handlerBody(GW.code, ['redis', 'ip', 'Date', 'res', 'tooManyRequests'], 'allowed');
    const r = await redis();
    // A multiple of 10 s, so Date.now()'s windows line up with the animation's.
    const BASE = 1_790_424_600_000;
    const LIMIT = 5;
    const out: Record<string, { perWindow: number; animPerWindow: number; off: number; n: number }> = {};
    for (const store of ['local', 'redis'] as const) {
      // local: each gateway runs the snippet against its own Redis (database 1, 2, 3); redis: one shared.
      const conns = new Map<string, Awaited<ReturnType<typeof r.extra>>>();
      for (const [k, gw] of ['gw1', 'gw2', 'gw3'].entries()) {
        const c = await r.extra();
        await c.call('SELECT', store === 'local' ? k + 1 : 0);
        conns.set(gw, c);
      }
      const { trace } = runStep('distributed-counters', 40.5, (s) => s.setStore(store));
      const decisions = [...trace].sort((a, b) => a.d.at - b.d.at);
      const real = new Map<(typeof decisions)[number], boolean>();
      for (const x of decisions) {
        const c = conns.get(x.node)!;
        const api = { incr: (k: string) => c.call('INCR', k), expire: (k: string, s: number) => c.call('EXPIRE', k, s) };
        const verdict = await handler(api, personOf(x.client).ip, { now: () => BASE + x.d.at * 1000 }, null, () => 'limited');
        real.set(x, verdict === 'allowed');
      }
      const scraper = decisions.filter((x) => x.client === 'bot');
      const most = (ok: (x: (typeof decisions)[number]) => boolean) => {
        const per = new Map<number, number>();
        for (const x of scraper) if (ok(x)) per.set(Math.floor(x.d.at / 10), (per.get(Math.floor(x.d.at / 10)) ?? 0) + 1);
        return Math.max(...per.values());
      };
      out[store] = { perWindow: most((x) => real.get(x)!), animPerWindow: most((x) => x.d.ok), off: count(decisions, (x) => real.get(x) !== x.d.ok), n: decisions.length };
    }
    const shared = await r.extra();
    const ttl = Number(await shared.call('TTL', `rl:${personOf('bot').ip}:${Math.floor(BASE / 10_000)}`));
    const checks = [
      {
        title: 'Local counters: the most the scraper got through in one 10 s window',
        real: `${out.local.perWindow} (gateway.js against a separate Redis per gateway)`,
        lesson_says: `${out.local.animPerWindow} ("15 per window, three times the limit"); ${out.local.off} of ${out.local.n} decisions differ`,
        pass: out.local.perWindow === 3 * LIMIT && out.local.animPerWindow === 3 * LIMIT && out.local.off === 0,
      },
      {
        title: 'Shared counter in Redis: the most the scraper got through in one 10 s window',
        real: `${out.redis.perWindow} (gateway.js, three gateways, one Redis); the counter's TTL was ${ttl} s`,
        lesson_says: `${out.redis.animPerWindow} ("the limit holds at 5"); ${out.redis.off} of ${out.redis.n} decisions differ`,
        pass: out.redis.perWindow === LIMIT && out.redis.animPerWindow === LIMIT && out.redis.off === 0 && ttl > 0 && ttl <= 10,
      },
    ];
    for (const c of checks) R.check({ lesson: LESSON, step: 'distributed-counters', software: REDIS, ...c });
    for (const c of checks) expect(c.pass, `${c.title}: real ${c.real}; lesson ${c.lesson_says}`).toBe(true);
    R.stamp(GW.code, {
      lesson: LESSON,
      by: REDIS,
      kind: 'ran',
      note: `Ran it on Redis ${redisVersion()}: with three gateways sharing one Redis, the scraper got 5 requests through per 10-second window, same as the animation. With a separate Redis per gateway, 15.`,
    });
  });

  test('the sliding log in a sorted set rejects the second burst in full (sliding-window-log)', async () => {
    const CLI = snippet(SNIPS, 'sliding-window-log', 'redis-cli');
    const cmds = redisCommands(CLI.code);
    expect(cmds.map((c) => c[0])).toEqual(['ZREMRANGEBYSCORE', 'ZCARD', 'ZADD', 'PEXPIRE']);
    const key = cmds[0][1];
    const cut0 = Number(cmds[0][3]);
    const now0 = Number(cmds[2][2]);
    const member0 = cmds[2][3];
    const windowMs = Number(cmds[3][2]);
    // The commands as a template: the snippet's "now" and "now - 10 s" become each request's times.
    const at = (cmd: string[], nowMs: number, member: string) =>
      cmd.map((a) => (a === String(now0) ? String(nowMs) : a === String(cut0) ? String(nowMs - (now0 - cut0)) : a === member0 ? member : a));

    const r = await redis();
    const { sim, trace } = runStep('sliding-window-log', 45);
    const limit = sim.cfg.limit;
    const base = now0 - 20_000;
    const real: boolean[] = [];
    let roomForOne = 0;
    for (const [k, { d }] of trace.entries()) {
      const t = base + d.at * 1000;
      await r.client.call(...at(cmds[0], t, `req-${k}`));
      const inWindow = Number(await r.client.call(...at(cmds[1], t, `req-${k}`)));
      const ok = inWindow < limit;
      if (ok) {
        await r.client.call(...at(cmds[2], t, `req-${k}`));
        await r.client.call(...at(cmds[3], t, `req-${k}`));
      }
      if (inWindow === limit - 1 && ok) roomForOne++;
      real.push(ok);
    }
    // Bursts: requests less than a second apart.
    const bursts: boolean[][] = [];
    trace.forEach(({ d }, k) => {
      if (k === 0 || d.at - trace[k - 1].d.at > 1) bursts.push([]);
      bursts[bursts.length - 1].push(real[k]);
    });
    const pairs = bursts.filter((_, k) => k % 2 === 1);
    const off = trace.filter(({ d }, k) => d.ok !== real[k]).length;

    // The note: without a script, two servers can both count 4 and both add.
    await r.client.call('DEL', key);
    for (let k = 0; k < 4; k++) await r.client.call('ZADD', key, now0 - 1000 * (k + 1), `old-${k}`);
    const [g1, g2] = [await r.extra(), await r.extra()];
    const both = await Promise.all(
      [g1, g2].map(async (g, k) => {
        await g.call(...at(cmds[0], now0, `race-${k}`));
        const seen = Number(await g.call(...at(cmds[1], now0, `race-${k}`)));
        if (seen < limit) await g.call(...at(cmds[2], now0, `race-${k}`));
        return seen;
      }),
    );
    const afterRace = Number(await r.client.call('ZCARD', key));

    const checks = [
      {
        title: 'The boundary attack against the sliding log',
        real: `${bursts.length} bursts; the second of each pair got ${pairs.map((b) => `${count(b, (x) => x)}/${b.length}`).join(', ')} through`,
        lesson_says: `the second burst is rejected in full; ${off} of ${trace.length} decisions differ from the animation`,
        pass: pairs.length >= 2 && pairs.every((b) => b.length === limit && b.every((x) => !x)) && bursts[0].every((x) => x) && off === 0,
      },
      {
        title: 'The two timestamps and the expiry in the snippet',
        real: `ZREMRANGEBYSCORE cuts at ${cut0}, ZADD scores ${now0}: ${now0 - cut0} ms apart; PEXPIRE ${windowMs}; ZCARD of 4 then allowed ${roomForOne} times`,
        lesson_says: '10 s window; "4 in the window: room for 1"',
        pass: now0 - cut0 === sim.cfg.window * 1000 && windowMs === sim.cfg.window * 1000 && roomForOne > 0,
      },
      {
        title: 'Two servers run the commands at once, 4 in the window',
        real: `both counted ${both.join(' and ')}, the set now holds ${afterRace}`,
        lesson_says: '"two servers can both count 4 and both add" without a Lua script',
        pass: both.every((x) => x === 4) && afterRace === 6,
      },
    ];
    for (const c of checks) R.check({ lesson: LESSON, step: 'sliding-window-log', software: REDIS, ...c });
    for (const c of checks) expect(c.pass, `${c.title}: real ${c.real}; lesson ${c.lesson_says}`).toBe(true);
    R.stamp(CLI.code, {
      lesson: LESSON,
      by: REDIS,
      kind: 'ran',
      note: `Ran it on Redis ${redisVersion()}: against the animation's boundary attack, every second burst was rejected in full, request for request what the animation shows.`,
    });
  });
});

/* ================================================================== */

describe('retrying after a 429', () => {
  const NODE = `Node ${process.versions.node}`;

  test("nginx's limit_req sends a bare 429 (response aside)", async () => {
    const ng = await limited(TOKEN_NGINX.code);
    const rs = await Promise.all(Array.from({ length: 20 }, () => request(ng.url)));
    const rejected = rs.filter((r) => r.status === 429);
    const names = [...new Set(rejected.flatMap((r) => Object.keys(r.headers ?? {})))].sort();
    const bare = rejected.length > 0 && !names.some((n) => n === 'retry-after' || n.includes('ratelimit'));
    R.check({
      lesson: LESSON,
      step: 'http-429',
      title: 'Headers on a 429 from limit_req',
      software: NGINX,
      real: `${rejected.length} × 429 with headers: ${names.join(', ')}`,
      lesson_says: 'a bare 429, no Retry-After or RateLimit headers',
      pass: bare,
    });
    expect(bare).toBe(true);
  });

  test('client.js honors Retry-After as seconds or a date, and jitters without it (backoff-and-jitter)', async () => {
    const s = snippet(SNIPS, 'backoff-and-jitter', 'client.js');
    /** The snippet exactly as shown, with `sleep` recording how long it was asked to wait. */
    const load = (wait: (ms: number) => Promise<void>) =>
      new Function('sleep', `${plain(s.code)}\nreturn fetchWithRetry;`)(wait) as (url: string) => Promise<Response>;

    /** A server that answers 429 once, with this Retry-After (or none), then 200. */
    const once = async (retryAfter: string | null) => {
      let n = 0;
      const srv = http.createServer((_req, res) => {
        if (n++ === 0) {
          res.writeHead(429, retryAfter ? { 'retry-after': retryAfter } : {});
          return res.end();
        }
        res.writeHead(200);
        res.end('ok');
      });
      const port = await freePort();
      await new Promise<void>((r) => srv.listen(port, '127.0.0.1', () => r()));
      cleanup.push(() => new Promise((r) => srv.close(r)));
      const waits: number[] = [];
      const res = await load(async (ms) => void waits.push(ms))(`http://127.0.0.1:${port}/`);
      return { status: res.status, wait: waits[0] };
    };

    const secs = await once('4');
    const date = await once(new Date(Date.now() + 3000).toUTCString());
    const none = await once(null);

    // And end to end against the lesson's own nginx limit: drain the bucket, then call it.
    const ng = await limited(TOKEN_NGINX.code);
    await Promise.all(Array.from({ length: 11 }, () => request(ng.url)));
    const waited: number[] = [];
    const real = await load((ms) => {
      waited.push(ms);
      return new Promise((r) => setTimeout(r, ms));
    })(ng.url);

    const pass =
      secs.status === 200 &&
      secs.wait === 4000 &&
      date.status === 200 &&
      date.wait > 1000 &&
      date.wait <= 3000 &&
      none.status === 200 &&
      none.wait >= 0 &&
      none.wait < 1000 &&
      real.status === 200 &&
      waited.length > 0;
    R.check({
      lesson: LESSON,
      step: 'backoff-and-jitter',
      title: 'client.js waits for Retry-After in either form, else jitters',
      software: `${NODE} & ${NGINX}`,
      real: `Retry-After: 4 → waited ${secs.wait} ms; an HTTP date 3 s ahead → ${Math.round(date.wait)} ms; no header → ${Math.round(none.wait)} ms (random); against limit_req: 200 after ${waited.length} retries`,
      lesson_says: 'honor Retry-After (seconds or HTTP date); otherwise full jitter',
      pass,
    });
    expect(pass).toBe(true);
    R.stamp(s.code, {
      lesson: LESSON,
      by: NODE,
      kind: 'ran',
      note: `Ran it on ${NODE}: it waited out Retry-After given as seconds or as a date, and without one (nginx's limit_req sends none) it waited a random, jittered time, then got through.`,
    });
  });
});
