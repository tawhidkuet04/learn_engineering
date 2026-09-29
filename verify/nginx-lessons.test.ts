/**
 * nginx in seven lessons, against real nginx.
 *
 * The CDN, TLS, HTTP versions, WebSockets, Life of a request, Processes &
 * threads and Consistent hashing lessons all show nginx configs. Each test
 * loads the snippet the reader sees (only the mechanical changes listed in
 * lib/nginxkit.ts), runs what the lesson says happens next, and, where the
 * lesson has a simulation, runs the same scenario through it and compares.
 *
 * Clients: curl (HTTP/2, HSTS), openssl s_client (sessions, 0-RTT, ECH),
 * Node's TLS, HTTP/2 and WebSocket clients. HTTP/3 is only config-checked:
 * there is no HTTP/3 client on this machine.
 */
import crypto from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { CHAPTERS as CDN } from '@/lessons/cdn/chapters';
import { CdnSim, DEFAULT_POLICY, DEFAULTS as CDN_DEFAULTS, headerOf, type CdnConfig, type FileId } from '@/lessons/cdn/sim';
import { CHAPTERS as CH } from '@/lessons/consistent-hashing/chapters';
import { buildRing, scaleMoves } from '@/lessons/consistent-hashing/ring';
import { CHAPTERS as HTTPV } from '@/lessons/http-versions/chapters';
import { MS, PageLoad, type Proto } from '@/lessons/http-versions/engine';
import { nginxFor } from '@/lessons/http-versions/nginxConf';
import { makePage, sizeKb } from '@/lessons/http-versions/page';
import { CHAPTERS as LOR } from '@/lessons/life-of-a-request/chapters';
import { NGINX as PT_NGINX, CHAPTERS as PT } from '@/lessons/processes-threads/chapters';
import { CHAPTERS as TLS } from '@/lessons/tls/chapters';
import { liveNginxConf } from '@/lessons/tls/panel/nginxConf';
import type { Resume, ShakeCfg, ShakeProto } from '@/lessons/tls/sim/shake';
import { TlsSim } from '@/lessons/tls/sim/TlsSim';
import { CHAPTERS as WS } from '@/lessons/websockets/chapters';
import { DEFAULTS as WS_DEFAULTS, WsSim } from '@/lessons/websockets/sim';
import { testCert } from './lib/confs';
import { nginxCheckMain, nginxProcesses, prepareNginx, startNginxMain, statements, type PrepareOpts } from './lib/nginxkit';
import {
  delayProxy,
  echKeys,
  get,
  h2All,
  httpsOrigin,
  lessonPki,
  memcachedServers,
  opensslVersion,
  rawHttp,
  recordingApp,
  run,
  sClient,
  tlsRequest,
  type Answer,
  type OriginRoute,
  type Relayed,
} from './lib/nginxnet';
import { freePort, nginxCheck, nginxVersion, sleep, startNginx, tmpDir, waitForPort } from './lib/procs';
import { results } from './lib/results';
import { collectSnippets, plain, snippet, type Found } from './lib/snippets';
import { acceptKey, wsBackends, type WsBackend } from './lib/wsserver';

const R = results('nginx-lessons');
const V = nginxVersion();
const NGINX = `nginx ${V}`;
const OSSL = opensslVersion();

const SN = {
  cdn: collectSnippets(CDN),
  tls: collectSnippets(TLS),
  'http-versions': collectSnippets(HTTPV),
  websockets: collectSnippets(WS),
  'life-of-a-request': collectSnippets(LOR),
  'processes-threads': collectSnippets(PT),
  'consistent-hashing': collectSnippets(CH),
};
type Lesson = keyof typeof SN;

const EDGE = snippet(SN.cdn, 'hit-ratio', 'nginx.conf · edge server');
const CACHE_PATH = statements(plain(EDGE.code)).find((s) => s.name === 'proxy_cache_path')!.text;
const TLS_SERVER = snippet(SN.tls, 'one-round-trip', 'nginx.conf');

/* ---------------- cleanup between tests ---------------- */

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!();
});
const later = <T extends { close: () => Promise<unknown> }>(x: T) => (cleanup.push(x.close), x);

async function nginx(httpBody: string, port: number) {
  const ng = await startNginx(httpBody, port);
  cleanup.push(ng.stop);
  return ng;
}

/** Put files in nginx's default root (html/ under its prefix). */
function serveFiles(dir: string, files: Record<string, string | Buffer>) {
  mkdirSync(path.join(dir, 'html'), { recursive: true });
  for (const [name, body] of Object.entries(files)) writeFileSync(path.join(dir, 'html', name), body);
}

async function waitFor(cond: () => boolean, ms = 5000) {
  const until = Date.now() + ms;
  while (!cond() && Date.now() < until) await sleep(20);
  return cond();
}

const round = (x: number) => Math.round(x * 10) / 10;
const derOf = (pemFile: string) => Buffer.from(readFileSync(pemFile, 'utf8').replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''), 'base64');
/** TLS record headers in a byte stream: content type and record-layer version. */
function tlsRecords(buf: Buffer) {
  const out: { type: number; version: number }[] = [];
  for (let i = 0; i + 5 <= buf.length; i += 5 + buf.readUInt16BE(i + 3)) out.push({ type: buf[i], version: buf.readUInt16BE(i + 1) });
  return out;
}
const upBytes = (r: Relayed) => Buffer.concat(r.up.map((c) => c.b));
const downBytes = (r: Relayed) => Buffer.concat(r.down.map((c) => c.b));
/** What the client sent before any answer could reach it: its first flight. */
const firstFlight = (r: Relayed) => Buffer.concat(r.up.filter((c) => c.t < (r.down[0]?.t ?? Infinity)).map((c) => c.b));

/* ================================================================== */
/* 1. Every snippet, every generated config: does nginx load it?      */
/* ================================================================== */

/** The snippet as nginx input, with the context the lesson gives it elsewhere. */
async function loadable(s: Found) {
  const port = await freePort();
  if (s.step === 'databases-and-web-servers') return nginxCheckMain(s.code, `server { listen 127.0.0.1:${port}; return 200; }`);
  const opts: PrepareOpts = { port };
  if (s.step === 'downgrade-hsts') opts.port = { 80: port, 443: await freePort() };
  if (s.step === 'resumption') opts.inside = TLS_SERVER.code;
  if (s.step === 'cache-keys') opts.context = [CACHE_PATH];
  return nginxCheck(prepareNginx(s.code, opts).text);
}

const emerg = (out: string) => out.split('\n').find((l) => l.includes('[emerg]'))?.replace(/ in \S+nginx\.conf:\d+/, '') ?? out.split('\n')[0];

describe('every nginx snippet loads (nginx -t)', () => {
  for (const [lesson, all] of Object.entries(SN) as [Lesson, Found[]][]) {
    for (const s of all.filter((x) => x.lang === 'nginx')) {
      test(`${lesson} / ${s.step} / ${s.title}`, async () => {
        const r = await loadable(s);
        R.check({ lesson, step: s.step, title: `nginx accepts the ${s.title} snippet`, software: NGINX, real: r.ok ? 'accepted' : emerg(r.output), pass: r.ok });
        expect(r.ok, r.output).toBe(true);
        R.stamp(s.code, { lesson, by: NGINX, kind: 'loads', note: `nginx ${V} loads this config (nginx -t).` });
      });
    }
  }

  test('TLS playground: every "nginx.conf · live" it can print', () => {
    const bad: string[] = [];
    let n = 0;
    for (const proto of ['http', 'tls12', 'tls13'] as ShakeProto[]) {
      for (const resume of ['full', 'ticket', '0rtt'] as Resume[]) {
        for (const ech of [false, true]) {
          const code = liveNginxConf({ proto, resume, ech });
          const r = nginxCheck(prepareNginx(code, { port: 18443 }).text);
          if (!r.ok) bad.push(`${proto}/${resume}/ech=${ech}: ${emerg(r.output)}`);
          n++;
        }
      }
    }
    R.check({ lesson: 'tls', step: 'playground', title: 'nginx accepts every config the playground prints', software: NGINX, real: bad.length ? bad.join('; ') : `${n} variants accepted`, pass: !bad.length });
    expect(bad).toEqual([]);
  });

  test('HTTP versions playground: every "nginx.conf · live" it can print', () => {
    const bad: string[] = [];
    let n = 0;
    for (const proto of ['h1.0', 'h1.1', 'h2', 'h3'] as Proto[]) {
      for (const zeroRtt of [false, true]) {
        const r = nginxCheck(prepareNginx(nginxFor(proto, zeroRtt), { port: 18443 }).text);
        if (!r.ok) bad.push(`${proto}${zeroRtt ? '+0rtt' : ''}: ${emerg(r.output)}`);
        n++;
      }
    }
    R.check({ lesson: 'http-versions', step: 'playground', title: 'nginx accepts every config the playground prints', software: NGINX, real: bad.length ? bad.join('; ') : `${n} variants accepted`, pass: !bad.length });
    expect(bad).toEqual([]);
  });
});

/* ================================================================== */
/* 2. CDN                                                              */
/* ================================================================== */

function cdnStep(id: string): CdnConfig {
  for (const ch of CDN) {
    const st = ch.steps.find((s) => s.id === id);
    if (st) return { ...CDN_DEFAULTS, ...ch.cfg, ...st.cfg };
  }
  throw new Error(`no CDN step ${id}`);
}

/** The CDN animation, headless: London asks for `file` at these simulated times. What did its edge answer? */
function cdnSim(cfg: CdnConfig, file: FileId, at: number[]): string[] {
  const sim = new CdnSim();
  sim.enter({ ...cfg, cdn: true, rps: 0, mode: 'traffic', cities: ['london'], warm: 'cold', utm: false }, [], { reset: true });
  const due = [...at];
  while (sim.t < Math.max(...at) + 6) {
    while (due.length && due[0] <= sim.t) {
      due.shift();
      sim.request('london', file);
    }
    sim.advance(0.05, true, 1);
  }
  return [...sim.log].reverse().map((l) => l.outcome);
}

/** Run a CDN step for `seconds` of lesson time. */
function cdnRun(sim: CdnSim, seconds: number) {
  for (let t = 0; t < seconds; t += 0.05) sim.advance(0.05, true, 1);
}

/** nginx's $upstream_cache_status in the lesson's words. */
const lessonWord = (s: string) => (s === 'REVALIDATED' ? 'REVAL' : s);

describe('CDN', () => {
  const LESSON = 'cdn';

  async function edge(routes: Record<string, OriginRoute>, code = EDGE.code, extra: Partial<PrepareOpts> = {}) {
    const origin = later(await httpsOrigin(routes));
    const port = await freePort();
    const { text } = prepareNginx(code, { port, upstreams: { 'origin.shop.example': `127.0.0.1:${origin.port}` }, ...extra });
    await nginx(text, port);
    const scheme = /listen [^;]*\bssl\b/.test(text) ? 'https' : 'http';
    const ask = (p: string, headers: Record<string, string> = {}) => get(`${scheme}://127.0.0.1:${port}${p}`, { headers: { host: 'cdn.shop.example', ...headers } });
    return { origin, ask };
  }
  const xc = (a: Answer) => String(a.headers['x-cache'] ?? '-');
  const seq = async (ask: (p: string, h?: Record<string, string>) => Promise<Answer>, p: string, n: number) => {
    const out: Answer[] = [];
    for (let i = 0; i < n; i++) out.push(await ask(p));
    return out;
  };

  test('a MISS, then HITs, and what Cache-Control lets the edge keep (first-request-misses, hit-ratio, cache-control)', async () => {
    const { origin, ask } = await edge({
      '/app.3f9a.js': { cacheControl: headerOf(DEFAULT_POLICY.app) },
      '/index.html': { cacheControl: headerOf(DEFAULT_POLICY.html), etag: true },
      '/account': { cacheControl: headerOf(DEFAULT_POLICY.account), personal: true },
      '/plain.css': {},
      '/shared.png': { cacheControl: 'public, max-age=0, s-maxage=60' },
      '/nostore.png': { cacheControl: 'no-store' },
    });
    const fetched = (p: string) => origin.hits.filter((h) => h.path === p);
    const app = await seq(ask, '/app.3f9a.js', 3);
    const html = await seq(ask, '/index.html', 3);
    const plainCss = await seq(ask, '/plain.css', 3);
    const shared = await seq(ask, '/shared.png', 3);
    const nostore = await seq(ask, '/nostore.png', 3);
    const acct = [await ask('/account', { 'x-user': 'Carol' }), await ask('/account', { 'x-user': 'Dave' }), await ask('/account', { 'x-user': 'Carol' })];

    // The animation: Alice and Bob in Sydney, then London asking three times for each file.
    const tour = new CdnSim();
    const tourStep = CDN.flatMap((c) => c.steps).find((s) => s.id === 'first-request-misses')!;
    tour.enter(cdnStep('first-request-misses'), [], { reset: true });
    tourStep.onEnter?.(tour);
    cdnRun(tour, 40);
    const cfg = cdnStep('cache-control');
    const simApp = cdnSim(cfg, 'app', [0, 3, 6]);
    const simHtml = cdnSim(cfg, 'html', [0, 3, 6]);
    const simAcct = cdnSim(cfg, 'account', [0, 3, 6]);
    const words = (xs: Answer[]) => xs.map(xc).join(' ');

    const checks = [
      {
        step: 'first-request-misses',
        title: 'Alice misses, Bob hits',
        real: `${words(app.slice(0, 2))}; the origin was asked ${fetched('/app.3f9a.js').length} time(s) for three requests`,
        lesson_says: `${tour.misses} miss then ${tour.hits} hit; origin fetches: ${tour.originFetches}`,
        pass: xc(app[0]) === 'MISS' && app.slice(1).every((a) => xc(a) === 'HIT') && fetched('/app.3f9a.js').length === 1 && tour.misses === 1 && tour.hits === 1 && tour.originFetches === 1,
      },
      {
        step: 'cache-control',
        title: `${headerOf(DEFAULT_POLICY.app)}: kept`,
        real: words(app),
        lesson_says: simApp.join(' '),
        pass: words(app) === 'MISS HIT HIT' && simApp.join(' ') === 'MISS HIT HIT',
      },
      {
        step: 'hit-ratio',
        title: 'No Cache-Control: proxy_cache_valid decides',
        real: words(plainCss),
        lesson_says: 'proxy_cache_valid 200 10m applies "when the origin doesn\'t say"',
        pass: words(plainCss) === 'MISS HIT HIT',
      },
      {
        step: 'cache-control',
        title: 's-maxage is for shared caches',
        real: `max-age=0, s-maxage=60: ${words(shared)}`,
        lesson_says: 's-maxage: a max-age just for shared caches like CDNs',
        pass: words(shared) === 'MISS HIT HIT' && fetched('/shared.png').length === 1,
      },
      {
        step: 'cache-control',
        title: 'no-cache at an nginx edge',
        real: `${words(html)}: never stored, ${fetched('/index.html').length} full fetches (${fetched('/index.html').filter((h) => h.ifNoneMatch).length} conditional)`,
        lesson_says: `the animation's edge keeps it and revalidates (${simHtml.join(' ')}); the aside says nginx won't store no-cache at all`,
        pass: words(html) === 'MISS MISS MISS' && fetched('/index.html').length === 3 && simHtml.join(' ') === 'MISS REVAL REVAL',
      },
      {
        step: 'cache-control',
        title: 'private passes straight through',
        real: `${words(acct)}; ${acct.map((a) => a.body.trim()).join(' / ')}`,
        lesson_says: `${simAcct.join(' ')}: only the browser may keep it`,
        pass: fetched('/account').length === 3 && acct[1].body.includes('Dave') && acct[2].body.includes('Carol') && simAcct.every((x) => x === 'BYPASS'),
      },
      {
        step: 'cache-control',
        title: 'no-store: nobody keeps a copy',
        real: words(nostore),
        lesson_says: 'no-store: nobody keeps a copy, anywhere',
        pass: words(nostore) === 'MISS MISS MISS' && fetched('/nostore.png').length === 3,
      },
    ];
    for (const c of checks) R.check({ lesson: LESSON, software: NGINX, ...c });
    for (const c of checks) expect(c.pass, `${c.title}: real ${c.real}; lesson ${c.lesson_says}`).toBe(true);
  });

  test('stale copies: revalidated, or served while revalidating (fresh-then-stale, stale-while-revalidate)', async () => {
    const { origin, ask } = await edge({
      '/logo.png': { cacheControl: 'public, max-age=2', etag: true, delayMs: 150 },
      '/swr.png': { cacheControl: 'public, max-age=2, stale-while-revalidate=30', etag: true, delayMs: 150 },
    });
    const logo = [await ask('/logo.png'), await ask('/logo.png')];
    const swr = [await ask('/swr.png'), await ask('/swr.png')];
    await sleep(3300); // both copies are stale now (max-age=2; nginx counts whole seconds)
    logo.push(await ask('/logo.png'));
    swr.push(await ask('/swr.png'));
    await sleep(400);
    logo.push(await ask('/logo.png'));
    swr.push(await ask('/swr.png'));
    const trips = (p: string) => origin.hits.filter((h) => h.path === p).map((h) => (h.ifNoneMatch ? `If-None-Match ${h.ifNoneMatch} → ${h.status}` : `GET → ${h.status}`));

    const simStale = cdnSim(cdnStep('fresh-then-stale'), 'logo', [0, 3, 12, 15]);
    const swrCfg = cdnStep('stale-while-revalidate');
    const simSwr = cdnSim({ ...swrCfg, policy: { logo: { kind: 'public', maxAge: 5, swr: 30 } } }, 'logo', [0, 3, 8, 11]);
    const realLogo = logo.map((a) => lessonWord(xc(a)));
    const realSwr = swr.map((a) => lessonWord(xc(a)));
    const checks = [
      {
        step: 'fresh-then-stale',
        title: 'A stale copy is checked with the origin, not fetched again',
        real: `${realLogo.join(' ')}; origin saw: ${trips('/logo.png').join(', ')}; the stale request took ${Math.round(logo[2].ms)} ms`,
        lesson_says: `${simStale.join(' ')}: If-None-Match "a1b2", 304 Not Modified`,
        pass: realLogo.join() === simStale.join() && trips('/logo.png').join() === 'GET → 200,If-None-Match "a1b2" → 304' && logo[2].ms >= 140,
      },
      {
        step: 'stale-while-revalidate',
        title: 'stale-while-revalidate answers at once and refreshes behind the scenes',
        real: `${realSwr.join(' ')}; the stale answer took ${Math.round(swr[2].ms)} ms; origin saw: ${trips('/swr.png').join(', ')}`,
        lesson_says: `${simSwr.join(' ')}: the stale copy goes out at once while the edge refreshes`,
        pass: realSwr.join() === simSwr.join() && swr[2].ms < 100 && trips('/swr.png').join() === 'GET → 200,If-None-Match "a1b2" → 304',
      },
    ];
    for (const c of checks) R.check({ lesson: LESSON, software: NGINX, ...c });
    for (const c of checks) expect(c.pass, `${c.title}: real ${c.real}; lesson ${c.lesson_says}`).toBe(true);
    R.stamp(EDGE.code, {
      lesson: LESSON,
      by: NGINX,
      kind: 'ran',
      note: `Ran it on nginx ${V}: the first request was a MISS and the next ones were HITs from disk. A stale copy was checked with If-None-Match (304), and with stale-while-revalidate the old copy went out at once.`,
    });
  });

  test('an account page: private stays private, public leaks (private-pages, even-uncacheable)', async () => {
    const routes: Record<string, OriginRoute> = { '/account': { cacheControl: 'private', personal: true } };
    const { origin, ask } = await edge(routes);
    const priv = [await ask('/account', { 'x-user': 'Carol' }), await ask('/account', { 'x-user': 'Dave' })];
    routes['/account'].cacheControl = 'public, max-age=60';
    const pub = [await ask('/account', { 'x-user': 'Carol' }), await ask('/account', { 'x-user': 'Dave' })];
    const ports = new Set(origin.hits.map((h) => h.remotePort));

    const sim = new CdnSim();
    sim.enter(cdnStep('private-pages'), [], { reset: true });
    cdnRun(sim, 20);
    const simPrivLeaks = sim.leaks;
    sim.setPolicy('account', { kind: 'public', maxAge: 60 });
    cdnRun(sim, 20);
    const simPubLeaks = sim.leaks - simPrivLeaks;
    const show = (xs: Answer[]) => xs.map((a) => `${a.body.trim()} (${xc(a)})`).join(', ');
    const checks = [
      {
        step: 'private-pages',
        title: 'private: Carol and Dave each get their own page',
        real: show(priv),
        lesson_says: `${simPrivLeaks} leaks: every request goes to the origin`,
        pass: priv[0].body.includes('Carol') && priv[1].body.includes('Dave') && simPrivLeaks === 0,
      },
      {
        step: 'private-pages',
        title: 'public, max-age=60: Dave gets Carol\'s orders',
        real: show(pub),
        lesson_says: `${simPubLeaks} leaks in 20 s: the edge serves the first page it saw to both`,
        pass: pub[1].body.includes('Carol') && xc(pub[1]) === 'HIT' && simPubLeaks > 0,
      },
      {
        step: 'even-uncacheable',
        title: 'The edge keeps a warm connection to the origin',
        real: `${origin.hits.length} origin fetches over ${ports.size} connection(s)`,
        lesson_says: 'the edge keeps warm connections open to your origin',
        pass: origin.hits.length === 3 && ports.size === 1,
      },
    ];
    for (const c of checks) R.check({ lesson: LESSON, software: NGINX, ...c });
    for (const c of checks) expect(c.pass, `${c.title}: real ${c.real}; lesson ${c.lesson_says}`).toBe(true);
  });

  test('cache keys: the query string splits copies, $uri joins them (cache-keys)', async () => {
    const routes = { '/logo.png': { cacheControl: 'public, max-age=86400' }, '/vary.png': { cacheControl: 'public, max-age=86400', vary: 'User-Agent' } };
    const a = '/logo.png?utm_source=mail&utm_id=412';
    const b = '/logo.png?utm_source=ads&utm_id=100';
    const plainEdge = await edge(routes);
    const byDefault = [await plainEdge.ask(a), await plainEdge.ask(b), await plainEdge.ask(a)].map(xc);
    const uas = ['Firefox/131', 'Chrome/129', 'Safari/18', 'Edg/129'];
    const vary: string[] = [];
    for (const ua of [...uas, ...uas]) vary.push(xc(await plainEdge.ask('/vary.png', { 'user-agent': ua })));

    // This snippet adds no X-Cache header, so count what reached the origin instead.
    const ck = snippet(SN.cdn, 'cache-keys', 'nginx.conf · edge');
    const keyed = await edge(routes, ck.code, { context: [CACHE_PATH] });
    const byPath: string[] = [];
    for (const p of [a, b, '/logo.png?utm_source=social&utm_id=7']) {
      const n = keyed.origin.hits.length;
      await keyed.ask(p);
      byPath.push(keyed.origin.hits.length > n ? 'MISS' : 'HIT');
    }

    // The animation: London's /logo.png with tracking tags, full-URL key vs ignoring the query.
    const ratio = (ignore: boolean) => {
      const sim = new CdnSim();
      sim.enter(cdnStep('cache-keys'), [], { reset: true });
      sim.setIgnoreQuery(ignore);
      cdnRun(sim, 40);
      return sim.hits / Math.max(1, sim.hits + sim.misses);
    };
    const simFull = ratio(false);
    const simPath = ratio(true);
    const checks = [
      {
        title: 'Default key ($scheme$proxy_host$request_uri): every tracking tag is a new copy',
        real: byDefault.join(' '),
        lesson_says: `each variation misses (hit ratio ${Math.round(simFull * 100)}% in the animation)`,
        pass: byDefault.join(' ') === 'MISS MISS HIT' && simFull < 0.2,
      },
      {
        title: 'proxy_cache_key $scheme$proxy_host$uri: the variants share one copy',
        real: `${byPath.join(' ')} (judged by what reached the origin: ${keyed.origin.hits.length} request(s) for 3)`,
        lesson_says: `all variants share one key (hit ratio ${Math.round(simPath * 100)}%)`,
        pass: byPath.join(' ') === 'MISS HIT HIT' && keyed.origin.hits.length === 1 && simPath > 0.8,
      },
      {
        title: 'Vary: User-Agent keeps one copy per browser',
        real: `${uas.length} user agents, twice each: ${vary.join(' ')}`,
        lesson_says: 'Vary: User-Agent can split one file into thousands of copies',
        pass: vary.slice(0, uas.length).every((x) => x === 'MISS') && vary.slice(uas.length).every((x) => x === 'HIT'),
      },
    ];
    for (const c of checks) R.check({ lesson: LESSON, step: 'cache-keys', software: NGINX, ...c });
    for (const c of checks) expect(c.pass, `${c.title}: real ${c.real}; lesson ${c.lesson_says}`).toBe(true);
    R.stamp(ck.code, { lesson: LESSON, by: NGINX, kind: 'ran', note: `Ran it on nginx ${V}: with the default key each ?utm_ variant was a separate MISS; with $uri as the key they all shared one copy.` });
  });

  test('fingerprinted files get a year, the HTML gets no-cache (fingerprinting)', async () => {
    const s = snippet(SN.cdn, 'fingerprinting', 'nginx.conf · origin');
    const port = await freePort();
    const ng = await nginx(prepareNginx(s.code, { port }).text, port);
    serveFiles(ng.dir, { 'index.html': '<script src="/app.3f9a.js"></script>\n', 'app.3f9a.js': 'v1\n', 'app.8c1e.js': 'v2\n', 'style.css': 'body{}\n' });
    const url = (p: string) => `http://127.0.0.1:${port}${p}`;
    const js = await get(url('/app.3f9a.js'));
    const next = await get(url('/app.8c1e.js'));
    const html = await get(url('/'));
    const again = await get(url('/index.html'), { headers: { 'if-none-match': String(html.headers.etag) } });
    const cc = (a: Answer) => String(a.headers['cache-control']);
    const checks = [
      {
        title: 'name.hash.js: cached for a year',
        real: `app.3f9a.js and app.8c1e.js: Cache-Control: ${cc(js)} / ${cc(next)}`,
        lesson_says: headerOf(DEFAULT_POLICY.app),
        pass: cc(js) === headerOf(DEFAULT_POLICY.app) && cc(next) === headerOf(DEFAULT_POLICY.app),
      },
      {
        title: 'The HTML: always check',
        real: `Cache-Control: ${cc(html)}; a check with its ETag got ${again.status}`,
        lesson_says: `${headerOf(DEFAULT_POLICY.html)}: checked with the origin on every visit`,
        pass: cc(html) === headerOf(DEFAULT_POLICY.html) && again.status === 304,
      },
    ];
    for (const c of checks) R.check({ lesson: LESSON, step: 'fingerprinting', software: NGINX, ...c });
    for (const c of checks) expect(c.pass, `${c.title}: real ${c.real}; lesson ${c.lesson_says}`).toBe(true);
    R.stamp(s.code, { lesson: LESSON, by: NGINX, kind: 'ran', note: `Ran it on nginx ${V}: app.3f9a.js came back with the one-year immutable header, and the HTML with no-cache.` });
  });

  test('only the CDN may talk to the origin (flash-crowd)', async () => {
    const s = snippet(SN.cdn, 'flash-crowd', 'nginx.conf · origin');
    const app = later(await recordingApp('app'));
    const port = await freePort();
    // Trust X-Real-IP from localhost so one machine can knock from several addresses.
    const text = `set_real_ip_from 127.0.0.1;\nreal_ip_header X-Real-IP;\n${prepareNginx(s.code, { port, upstreams: { app: `127.0.0.1:${app.port}` } }).text}`;
    await nginx(text, port);
    const from = (ip?: string) => get(`http://127.0.0.1:${port}/products`, { headers: ip ? { 'x-real-ip': ip } : {} }).then((a) => a.status);
    const cdnEdge = await from('198.51.100.7');
    const stranger = await from('203.0.113.99');
    const local = await from();
    const pass = cdnEdge === 200 && stranger === 403 && local === 403 && app.seen.length === 1;
    R.check({
      lesson: LESSON,
      step: 'flash-crowd',
      title: 'Requests that skip the CDN are refused',
      software: NGINX,
      real: `from 198.51.100.7 (the CDN): ${cdnEdge}; from 203.0.113.99: ${stranger}; from 127.0.0.1: ${local}; the app saw ${app.seen.length}`,
      lesson_says: 'only the CDN\'s published ranges get through',
      pass,
    });
    expect(pass).toBe(true);
    R.stamp(s.code, { lesson: LESSON, by: NGINX, kind: 'ran', note: `Ran it on nginx ${V}: a request from 198.51.100.7 reached the app; anyone else got 403 Forbidden.` });
  });
});

/* ================================================================== */
/* 3. TLS                                                              */
/* ================================================================== */

function shake(cfg: Partial<ShakeCfg>) {
  const sim = new TlsSim();
  sim.enter({ scene: 'shake', shake: { tcp: true, ...cfg } }, { reset: true });
  return sim.shake;
}

describe('TLS', () => {
  const LESSON = 'tls';
  const ONE_WAY = 100;

  test('the server block: versions, round trips, and what travels in the clear (one-round-trip)', async () => {
    const port = await freePort();
    await nginx(prepareNginx(TLS_SERVER.code, { port }).text, port);
    const def = await sClient(port, [], 'GET / HTTP/1.1\r\nHost: shop.example\r\nConnection: close\r\n\r\n');
    const relay = later(await delayProxy(port, ONE_WAY));
    const t13 = await tlsRequest(relay.port, { minVersion: 'TLSv1.3', maxVersion: 'TLSv1.3' });
    const c13 = relay.conns.at(-1)!;
    const t12 = await tlsRequest(relay.port, { minVersion: 'TLSv1.2', maxVersion: 'TLSv1.2' });
    const c12 = relay.conns.at(-1)!;
    const rtts = (ms: number) => round(ms / relay.rtt);
    const der = derOf(testCert().crt);
    const clear12 = downBytes(c12).includes(der);
    const clear13 = downBytes(c13).includes(der);
    const sni = upBytes(c13).includes('shop.example') && upBytes(c12).includes('shop.example');
    // Records nginx sent over TLS 1.3: ServerHello (22), a compatibility ChangeCipherSpec (20), then only "application data" (23).
    const recs = tlsRecords(downBytes(c13));
    const afterHello = recs.slice(recs.findIndex((r) => r.type === 23));
    const typeNames = [...new Set(recs.map((r) => r.type))].join(', ');

    const s13 = shake({ proto: 'tls13' });
    const s12 = shake({ proto: 'tls12' });
    const certEnc = (s: ReturnType<typeof shake>) => s.flights.flatMap((f) => f.msgs).find((m) => m.id === 'cert')?.enc;
    const checks = [
      {
        title: 'TLS 1.3 by default, TLS 1.2 still allowed',
        real: `${def.match(/^Protocol: .*/m)?.[0]}; ${def.match(/^New, .*/m)?.[0]}; a TLS 1.2-only client got ${t12.protocol}`,
        lesson_says: 'ssl_protocols TLSv1.2 TLSv1.3',
        pass: /^Protocol: TLSv1\.3$/m.test(def) && t12.protocol === 'TLSv1.2' && t13.protocol === 'TLSv1.3',
      },
      {
        title: 'Round trips before the request can leave (after TCP)',
        real: `TLS 1.3: ${rtts(t13.handshake)}, TLS 1.2: ${rtts(t12.handshake)} (at ${relay.rtt} ms per round trip)`,
        lesson_says: `TLS 1.3: ${s13.tlsRtts}, TLS 1.2: ${s12.tlsRtts}`,
        pass: Math.round(t13.handshake / relay.rtt) === s13.tlsRtts && Math.round(t12.handshake / relay.rtt) === s12.tlsRtts && s13.tlsRtts === 1 && s12.tlsRtts === 2,
      },
      {
        title: 'First byte of the response (after TCP)',
        real: `TLS 1.3: ${rtts(t13.firstByte)} round trips, TLS 1.2: ${rtts(t12.firstByte)}`,
        lesson_says: `TLS 1.3: ${s13.firstByteRtts - 1}, TLS 1.2: ${s12.firstByteRtts - 1}`,
        pass: Math.round(t13.firstByte / relay.rtt) === s13.firstByteRtts - 1 && Math.round(t12.firstByte / relay.rtt) === s12.firstByteRtts - 1,
      },
      {
        title: 'TLS 1.2 sends the certificate in the clear, TLS 1.3 encrypts it',
        real: `server's certificate readable on the wire: TLS 1.2 ${clear12 ? 'yes' : 'no'}, TLS 1.3 ${clear13 ? 'yes' : 'no'}`,
        lesson_says: `Certificate is "${certEnc(s12)}" in TLS 1.2, "${certEnc(s13)}" in TLS 1.3`,
        pass: clear12 && !clear13 && certEnc(s12) === 'clear' && certEnc(s13) === 'hs',
      },
      {
        step: 'three-goals',
        title: 'Every encrypted TLS 1.3 record says "application data"',
        real: `${recs.length} records from nginx, types ${typeNames}; after the ServerHello: ${afterHello.length} records, all type 23: ${afterHello.every((r) => r.type === 23)}, all version 0x0303: ${recs.every((r) => r.version === 0x0303)}`,
        lesson_says: '17 03 03 …: type 23, and the real type is hidden inside',
        pass: recs[0]?.type === 22 && afterHello.length > 2 && afterHello.every((r) => r.type === 23) && recs.every((r) => r.version === 0x0303),
      },
      {
        step: 'client-hello',
        title: 'The SNI travels in the clear',
        real: sni ? '"shop.example" readable in both ClientHellos' : 'not found on the wire',
        lesson_says: 'server_name shop.example   # the SNI (in the clear)',
        pass: sni,
      },
    ];
    for (const c of checks) R.check({ lesson: LESSON, step: 'one-round-trip', software: NGINX, ...c });
    for (const c of checks) expect(c.pass, `${c.title}: real ${c.real}; lesson ${c.lesson_says}`).toBe(true);
    R.stamp(TLS_SERVER.code, {
      lesson: LESSON,
      by: NGINX,
      kind: 'ran',
      note: `Ran it on nginx ${V}: clients got TLS 1.3 by default and TLS 1.2 on request. TLS 1.3 was ready after one round trip, TLS 1.2 after two, and only TLS 1.2 showed the certificate on the wire.`,
    });
  });

  test('resumption, 0-RTT and a replayed first flight (resumption)', async () => {
    const s = snippet(SN.tls, 'resumption', 'nginx.conf');
    const app = later(
      await recordingApp('app', (req, res) => {
        const early = req.headers['early-data'] === '1';
        res.writeHead(early && req.method !== 'GET' ? 425 : 200, { 'content-type': 'text/plain' });
        res.end(early && req.method !== 'GET' ? 'Too Early\n' : 'ok\n');
      }),
    );
    const port = await freePort();
    await nginx(prepareNginx(s.code, { port, inside: TLS_SERVER.code, upstreams: { app: `127.0.0.1:${app.port}` } }).text, port);
    const relay = later(await delayProxy(port, ONE_WAY));
    const dir = tmpDir('tls-sess');
    const sess = path.join(dir, 'sess.pem');
    const req = (method: string, p: string) => `${method} ${p} HTTP/1.1\r\nHost: shop.example\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`;
    const hasCert = (out: string) => /^<<< TLS 1\.3, Handshake \[length [0-9a-f]+\], Certificate$/m.test(out);

    const full = await sClient(relay.port, ['-msg', '-sess_out', sess], req('GET', '/'));
    const resumed = await sClient(relay.port, ['-msg', '-sess_in', sess, '-sess_out', sess], req('GET', '/'));
    const plainResume = relay.conns.at(-1)!;
    writeFileSync(path.join(dir, 'get.txt'), req('GET', '/account'));
    const seenBefore = app.seen.length;
    const early = await sClient(relay.port, ['-sess_in', sess, '-sess_out', sess, '-early_data', path.join(dir, 'get.txt')]);
    const earlyConn = relay.conns.at(-1)!;
    const earlyHit = app.seen[seenBefore];
    const reachedAfter = earlyHit ? round((earlyHit.t - earlyConn.t0) / relay.rtt) : NaN;
    writeFileSync(path.join(dir, 'post.txt'), req('POST', '/buy'));
    const post = await sClient(relay.port, ['-sess_in', sess, '-early_data', path.join(dir, 'post.txt')]);

    // Mallory replays what Alice sent before any answer came back.
    const replay = async (bytes: Buffer) => {
      const n = app.seen.length;
      const sock = net.connect(port, '127.0.0.1');
      sock.on('error', () => {});
      sock.on('data', () => {});
      await new Promise((r) => sock.once('connect', r));
      sock.write(bytes);
      await sleep(700);
      sock.destroy();
      return app.seen.slice(n);
    };
    const replayedEarly = await replay(firstFlight(earlyConn));
    const replayedPlain = await replay(firstFlight(plainResume));

    const z = shake({ proto: 'tls13', resume: '0rtt', early: 'get' });
    z.replay();
    const t = shake({ proto: 'tls13', resume: 'ticket' });
    t.replay();
    const checks = [
      {
        title: 'Coming back: resumed, and no certificate this time',
        real: `${resumed.match(/^(New|Reused), TLSv1\.3/m)?.[0]}; certificate sent: first visit ${hasCert(full) ? 'yes' : 'no'}, return ${hasCert(resumed) ? 'yes' : 'no'}`,
        lesson_says: 'both sides skip the certificate: that\'s resumption',
        pass: /^Reused, TLSv1\.3/m.test(resumed) && hasCert(full) && !hasCert(resumed),
      },
      {
        title: '0-RTT: the request rides along with the ClientHello',
        real: `${early.match(/Early data was \w+/)?.[0]}; the app got ${earlyHit?.method} ${earlyHit?.url} with Early-Data: ${earlyHit?.headers['early-data']} ${reachedAfter} round trips after connecting`,
        lesson_says: `request leaves after ${z.tlsRtts} TLS round trips; the answer comes in the server's first flight`,
        pass: /Early data was accepted/.test(early) && earlyHit?.headers['early-data'] === '1' && Math.abs(reachedAfter - 0.5) < 0.25 && z.tlsRtts === 0,
      },
      {
        title: 'Only safe requests as early data',
        real: `POST /buy as early data: the app saw Early-Data: ${app.seen.find((x) => x.method === 'POST')?.headers['early-data']} and answered ${post.match(/HTTP\/1\.1 (\d+)/)?.[1]}`,
        lesson_says: 'the app answers 425 Too Early if unsafe',
        pass: /HTTP\/1\.1 425/.test(post),
      },
      {
        title: 'A replayed 0-RTT first flight runs the request again',
        real: `replaying Alice's first flight: the app ran ${replayedEarly.map((x) => `${x.method} ${x.url} (Early-Data: ${x.headers['early-data']})`).join(', ') || 'nothing'}`,
        lesson_says: z.notes.map((n) => n.text).join('; '),
        pass: replayedEarly.length === 1 && replayedEarly[0].url === '/account' && replayedEarly[0].headers['early-data'] === '1' && z.notes.some((n) => /served again/.test(n.text)),
      },
      {
        title: 'Without early data, a replayed hello runs nothing',
        real: `replaying a resumed hello without early data: the app ran ${replayedPlain.length} request(s)`,
        lesson_says: t.notes.map((n) => n.text).join('; '),
        pass: replayedPlain.length === 0 && t.notes.some((n) => /nothing runs/.test(n.text)),
      },
    ];
    for (const c of checks) R.check({ lesson: LESSON, step: 'resumption', software: NGINX, ...c });
    for (const c of checks) expect(c.pass, `${c.title}: real ${c.real}; lesson ${c.lesson_says}`).toBe(true);
    R.stamp(s.code, {
      lesson: LESSON,
      by: NGINX,
      kind: 'ran',
      note: `Ran it on nginx ${V}: a returning client resumed with its ticket, its 0-RTT GET reached the app with Early-Data: 1 before the handshake finished, and a replayed copy of that first flight ran the GET again.`,
    });
  });

  test('the playground\'s live config does what the diagram shows (playground)', async () => {
    const rows: string[] = [];
    const bad: string[] = [];
    const modes: [ShakeProto, Resume][] = [
      ['http', 'full'],
      ['tls12', 'full'],
      ['tls12', 'ticket'],
      ['tls13', 'full'],
      ['tls13', 'ticket'],
      ['tls13', '0rtt'],
    ];
    for (const [proto, resume] of modes) {
      const port = await freePort();
      await nginx(prepareNginx(liveNginxConf({ proto, resume, ech: false }), { port }).text, port);
      const relay = later(await delayProxy(port, ONE_WAY));
      const sim = shake({ proto, resume });
      let real: string;
      let ok: boolean;
      if (proto === 'http') {
        const a = await get(`http://127.0.0.1:${relay.port}/`);
        const rtt = Math.round(a.ms / relay.rtt);
        real = `first byte after ${rtt} round trip(s)`;
        ok = rtt === sim.firstByteRtts - 1 && sim.tlsRtts === 0;
      } else if (resume === '0rtt') {
        const dir = tmpDir('tls-pg');
        const sess = path.join(dir, 's.pem');
        writeFileSync(path.join(dir, 'r.txt'), 'GET / HTTP/1.1\r\nHost: shop.example\r\nConnection: close\r\n\r\n');
        await sClient(port, ['-sess_out', sess], 'GET / HTTP/1.1\r\nHost: shop.example\r\nConnection: close\r\n\r\n');
        const out = await sClient(port, ['-sess_in', sess, '-early_data', path.join(dir, 'r.txt')]);
        real = out.match(/Early data was \w+/)?.[0] ?? 'no early data';
        ok = real === 'Early data was accepted' && sim.tlsRtts === 0;
      } else {
        const v = proto === 'tls13' ? 'TLSv1.3' : 'TLSv1.2';
        const first = await tlsRequest(relay.port, { minVersion: v, maxVersion: v });
        const back = await tlsRequest(relay.port, { minVersion: v, maxVersion: v, session: first.session ?? undefined });
        const run = resume === 'ticket' ? back : first;
        const rtt = Math.round(run.handshake / relay.rtt);
        real = `${run.protocol}, return visit resumed: ${back.reused}, handshake ${rtt} round trip(s)`;
        ok = rtt === sim.tlsRtts && back.reused === (resume === 'ticket');
      }
      rows.push(`${proto}/${resume}: ${real} (diagram: ${sim.tlsRtts} TLS round trips)`);
      if (!ok) bad.push(`${proto}/${resume}`);
    }
    R.check({ lesson: LESSON, step: 'playground', title: 'Each live config against the diagram\'s round trips', software: NGINX, real: rows.join('; '), lesson_says: 'New: tickets off; Resumed: tickets on; 0-RTT: ssl_early_data on', pass: !bad.length });
    expect(bad, rows.join('\n')).toEqual([]);
  });

  test('HSTS: redirect once, then https:// before anything is sent (downgrade-hsts)', async () => {
    const s = snippet(SN.tls, 'downgrade-hsts', 'nginx.conf');
    const p80 = await freePort();
    const p443 = await freePort();
    await nginx(prepareNginx(s.code, { port: { 80: p80, 443: p443 } }).text, p443);
    await waitForPort(p80);
    const hsts = path.join(tmpDir('hsts'), 'hsts.txt');
    const curl = (extra: string[]) =>
      run('curl', ['-sv', '--hsts', hsts, '--cacert', testCert().crt, '--connect-to', `shop.example:80:127.0.0.1:${p80}`, '--connect-to', `shop.example:443:127.0.0.1:${p443}`, '-o', '/dev/null', ...extra, 'http://shop.example/login']);
    const first = (await curl(['-L'])).err;
    const stored = readFileSync(hsts, 'utf8');
    const second = (await curl([])).err;
    const expiry = stored.match(/\.shop\.example "(\d{4})(\d\d)(\d\d) /);
    const days = expiry ? Math.round((Date.UTC(+expiry[1], +expiry[2] - 1, +expiry[3]) - Date.now()) / 86_400_000) : NaN;
    const checks = [
      {
        title: 'Plain http only ever redirects',
        real: `${first.match(/^< HTTP\/1\.1 3\d\d.*$/m)?.[0]?.trim()}, ${first.match(/^< Location: .*$/im)?.[0]?.trim()}`,
        lesson_says: 'return 301 https://$host$request_uri',
        pass: /^< HTTP\/1\.1 301/m.test(first) && /^< Location: https:\/\/shop\.example\/login\s*$/im.test(first),
      },
      {
        title: 'Every HTTPS answer carries the header, even an error',
        real: `${first.match(/^< HTTP\/1\.1 [45]\d\d.*$/m)?.[0]?.trim() ?? 'a 2xx'} with ${first.match(/^< Strict-Transport-Security: .*$/im)?.[0]?.trim()}`,
        lesson_says: 'add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always',
        pass: /^< Strict-Transport-Security: max-age=63072000; includeSubDomains; preload\s*$/im.test(first) && /^< HTTP\/1\.1 404/m.test(first),
      },
      {
        title: 'Once seen, http:// becomes https:// before anything is sent',
        real: `${second.match(/Switched from HTTP to HTTPS[^\n]*/)?.[0] ?? 'no switch'}; connections to the port-80 server: ${second.split(`port ${p80}`).length - 1}; remembered for ${days} days, subdomains too`,
        lesson_says: 'the browser rewrites every http:// to https:// before sending anything; max-age=63072000 is two years',
        pass: /Switched from HTTP to HTTPS due to HSTS/.test(second) && !second.includes(`port ${p80}`) && days >= 729 && days <= 731 && stored.includes('.shop.example'),
      },
    ];
    for (const c of checks) R.check({ lesson: LESSON, step: 'downgrade-hsts', software: NGINX, ...c });
    for (const c of checks) expect(c.pass, `${c.title}: real ${c.real}; lesson ${c.lesson_says}`).toBe(true);
    R.stamp(s.code, {
      lesson: LESSON,
      by: NGINX,
      kind: 'ran',
      note: `Ran it on nginx ${V}: http:// got a 301 to https://, every HTTPS answer (even a 404) carried the header, and curl, having seen it once, went straight to https:// the next time.`,
    });
  });

  test('what openssl s_client prints: the chain, and Mallory\'s fakes (chain-of-trust, fake-certificates)', async () => {
    const pki = lessonPki();
    const ports = { good: await freePort(), selfSigned: await freePort(), otherName: await freePort(), expired: await freePort() };
    const servers = (Object.keys(ports) as (keyof typeof ports)[])
      .map((k) => `server { listen 127.0.0.1:${ports[k]} ssl; server_name shop.example; ssl_certificate ${pki[k].crt}; ssl_certificate_key ${pki[k].key}; }`)
      .join('\n');
    await nginx(servers, ports.good);
    const out = (await run('openssl', ['s_client', '-connect', `127.0.0.1:${ports.good}`, '-servername', 'shop.example', '-CAfile', pki.root], { input: '', merged: true })).out;
    const outLines = out.split('\n').map((l) => l.trim());
    const chain = snippet(SN.tls, 'chain-of-trust', 'openssl s_client (abridged)');
    const expected = plain(chain.code)
      .split('\n')
      .filter((l) => !l.startsWith('$') && !/^\s+-/.test(l) && l.trim() !== '---')
      .map((l) => l.trim());
    let at = 0;
    const missing: string[] = [];
    for (const want of expected) {
      const i = outLines.indexOf(want, at);
      if (i < 0) missing.push(want);
      else at = i + 1;
    }

    const fake = snippet(SN.tls, 'fake-certificates', 'the same checks in OpenSSL');
    const errors = plain(fake.code)
      .split('\n')
      .filter((l) => l.startsWith('verify error:'));
    const got: string[] = [];
    for (const k of ['selfSigned', 'otherName', 'expired'] as const) {
      const r = await run('openssl', ['s_client', '-connect', `127.0.0.1:${ports[k]}`, '-servername', 'shop.example', '-CAfile', pki.root, '-verify_hostname', 'shop.example', '-verify_return_error'], { input: '' });
      got.push(`${r.out}${r.err}`.match(/verify error:[^\n]*/)?.[0] ?? 'no error');
    }
    const checks = [
      {
        step: 'chain-of-trust',
        title: 'The abridged s_client output, line by line',
        real: missing.length ? `missing or out of order: ${missing.join(' | ')}` : `all ${expected.length} lines, in order (OpenSSL ${OSSL})`,
        lesson_says: `${expected.length} lines of OpenSSL output`,
        pass: missing.length === 0,
      },
      {
        step: 'fake-certificates',
        title: 'Mallory\'s three certificates',
        real: got.join(' | '),
        lesson_says: errors.join(' | '),
        pass: got.join('|') === errors.join('|'),
      },
    ];
    for (const c of checks) R.check({ lesson: LESSON, software: `${NGINX}, OpenSSL ${OSSL}`, ...c });
    for (const c of checks) expect(c.pass, `${c.title}: real ${c.real}; lesson ${c.lesson_says}`).toBe(true);
    R.stamp(chain.code, { lesson: LESSON, by: NGINX, kind: 'ran', note: `Ran it on nginx ${V}: with a leaf + intermediate chain like this one, OpenSSL ${OSSL} printed every line shown here.` });
    R.stamp(fake.code, { lesson: LESSON, by: NGINX, kind: 'ran', note: `Ran it on nginx ${V}: serving each of Mallory's certificates in turn, OpenSSL ${OSSL} stopped with exactly these errors.` });
  });

  test('ECH hides the site name (what-eve-sees)', async () => {
    const ech = echKeys('cdn.example');
    const port = await freePort();
    const c = testCert();
    await nginx(
      `server {\n  listen 127.0.0.1:${port} ssl;\n  server_name shop.example;\n  ssl_certificate ${c.crt};\n  ssl_certificate_key ${c.key};\n  ssl_ech_file ${ech.file};\n  location / { return 200 "ech=$ssl_ech_status outer=$ssl_ech_outer_server_name name=$ssl_server_name\\n"; }\n}`,
      port,
    );
    const relay = later(await delayProxy(port, 0));
    const request = 'GET / HTTP/1.1\r\nHost: shop.example\r\nConnection: close\r\n\r\n';
    const withEch = await sClient(relay.port, ['-ech_config_list', ech.configList], request);
    const sealed = relay.conns.at(-1)!;
    const without = await sClient(relay.port, [], request);
    const open = relay.conns.at(-1)!;
    const seen = (r: Relayed, name: string) => upBytes(r).includes(name);
    const simEve = (e: boolean) => shake({ proto: 'tls13', ech: e }).flights.flatMap((f) => f.msgs).find((m) => m.id === 'ch')?.eve ?? '';
    const pass =
      /ech=SUCCESS outer=cdn\.example name=shop\.example/.test(withEch) && !seen(sealed, 'shop.example') && seen(sealed, 'cdn.example') && seen(open, 'shop.example') && /cdn\.example/.test(simEve(true)) && /SNI shop\.example/.test(simEve(false));
    R.check({
      lesson: LESSON,
      step: 'what-eve-sees',
      title: 'With ECH, the wire shows only the front server\'s name',
      software: `${NGINX} (ssl_ech_file), OpenSSL ${OSSL}`,
      real: `with ECH: ${withEch.match(/ech=\S+ outer=\S+ name=\S+/)?.[0]}, without: ${without.match(/ech=\S+/)?.[0]}; "shop.example" on the wire: with ECH ${seen(sealed, 'shop.example') ? 'yes' : 'no'}, without ${seen(open, 'shop.example') ? 'yes' : 'no'}`,
      lesson_says: `${simEve(true)} (ECH off: ${simEve(false)})`,
      pass,
    });
    expect(pass).toBe(true);
  });
});

/* ================================================================== */
/* 4. HTTP versions                                                    */
/* ================================================================== */

describe('HTTP versions', () => {
  const LESSON = 'http-versions';
  const ALT = snippet(SN['http-versions'], 'alt-svc', 'nginx.conf');
  const page = makePage(12);
  const crt = () => testCert().crt;

  async function server(code: string) {
    const port = await freePort();
    const ng = await nginx(prepareNginx(code, { port }).text, port);
    serveFiles(ng.dir, Object.fromEntries(page.map((f, i) => [f.name, Buffer.alloc(sizeKb(f, i) * 1024, 97)])));
    const curl = (args: string[], p = port) => run('curl', ['--cacert', crt(), '--connect-to', `shop.example:443:127.0.0.1:${p}`, ...args]);
    const udp = async () => (await run('lsof', ['-nP', `-iUDP@127.0.0.1:${port}`])).out;
    return { port, curl, udp };
  }

  test('HTTP/2 through ALPN, the Alt-Svc header, and a UDP port for QUIC (alt-svc)', async () => {
    const sv = await server(ALT.code);
    const head = (await sv.curl(['-sI', '--http2', 'https://shop.example/'])).out;
    const verbose = (await sv.curl(['-sv', '--http2', '-o', '/dev/null', 'https://shop.example/'])).err;
    const h1 = (await sv.curl(['-sI', '--http1.1', 'https://shop.example/'])).out;
    const udp = await sv.udp();
    const names = head.split('\r\n').slice(1).filter(Boolean).map((l) => l.split(':')[0]);
    // A second site on the same address: both saying reuseport, then only the first.
    const www = ALT.code.replace('server_name shop.example;', 'server_name www.shop.example;');
    const twice = nginxCheck(prepareNginx(`${ALT.code}\n${www}`, { port: 18443 }).text);
    const once = nginxCheck(prepareNginx(`${ALT.code}\n${www.replace(' reuseport', '')}`, { port: 18443 }).text);
    const checks = [
      {
        step: 'alt-svc',
        title: 'curl --http2 gets HTTP/2, chosen in the TLS handshake',
        real: `${head.split('\r\n')[0].trim()}; ${verbose.match(/ALPN: server accepted \S+/)?.[0]}; the same port also answered ${h1.split('\r\n')[0].trim()}`,
        lesson_says: 'listen 443 ssl + http2 on: HTTP/1.1 and HTTP/2 over TCP',
        pass: /^HTTP\/2 200/.test(head) && /ALPN: server accepted h2/.test(verbose) && /^HTTP\/1\.1 200/.test(h1),
      },
      {
        step: 'alt-svc',
        title: 'The response advertises HTTP/3',
        real: head.match(/^alt-svc: .*$/m)?.[0]?.trim() ?? 'no alt-svc',
        lesson_says: 'alt-svc: h3=":443"; ma=86400',
        pass: /^alt-svc: h3=":443"; ma=86400\s*$/m.test(head),
      },
      {
        step: 'alt-svc',
        title: 'nginx listens on UDP for QUIC (HTTP/3 itself not tested: no HTTP/3 client here)',
        real: udp.includes('nginx') ? 'nginx holds the same port number over UDP' : 'no UDP socket',
        lesson_says: 'listen 443 quic reuseport;   # HTTP/3 over UDP',
        pass: udp.includes('nginx'),
      },
      {
        step: 'alt-svc',
        title: 'Only one listen line per address and port may say reuseport',
        real: `two servers both saying reuseport: ${twice.ok ? 'accepted' : emerg(twice.output)}; only the first: ${once.ok ? 'accepted' : emerg(once.output)}`,
        lesson_says: 'only one listen line per address and port may say reuseport',
        pass: !twice.ok && /duplicate listen options/.test(twice.output) && once.ok,
      },
      {
        step: 'multiplexing',
        title: 'HTTP/2 header names are lowercase',
        real: names.join(', '),
        lesson_says: 'HTTP/2 header names are always lowercase',
        pass: names.length > 3 && names.every((n) => n === n.toLowerCase()),
      },
    ];
    for (const c of checks) R.check({ lesson: LESSON, software: NGINX, ...c });
    for (const c of checks) expect(c.pass, `${c.title}: real ${c.real}; lesson ${c.lesson_says}`).toBe(true);
    R.stamp(ALT.code, {
      lesson: LESSON,
      by: NGINX,
      kind: 'ran',
      note: `Ran it on nginx ${V}: curl got HTTP/2 through ALPN with the Alt-Svc header, and nginx opened the UDP port for QUIC. HTTP/3 itself wasn't tested: there's no HTTP/3 client here.`,
    });
  });

  test('one connection, every file at once, slices interleaved (multiplexing, frames)', async () => {
    const sv = await server(ALT.code);
    const relay = later(await delayProxy(sv.port, 0));
    const r = await h2All(relay.port, page.map((f) => `/${f.name}`));
    const ids = r.streams.map((s) => s.id).sort((a, b) => a - b);
    const interleaved = r.streams.filter((s) => {
      const at = r.order.map((o, i) => (o.stream === s.id ? i : -1)).filter((i) => i >= 0);
      return at.length > 1 && r.order.slice(at[0], at.at(-1)).some((o) => o.stream !== s.id);
    }).length;
    const sim = (proto: Proto) => new PageLoad({ proto, rttMs: 100, loss: 0, files: page, conns: 6, zeroRtt: false, seed: 1 }).runToEnd();
    const h2 = sim('h2');
    const h11 = sim('h1.1');
    const checks = [
      {
        step: 'multiplexing',
        title: 'Twelve files, one connection',
        real: `${r.streams.length} responses (${new Set(r.streams.map((s) => s.status)).size === 1 ? r.streams[0].status : 'mixed'}) over ${relay.conns.length} TCP connection(s), ALPN ${r.alpn}`,
        lesson_says: `HTTP/2: ${h2.conns.length} connection; HTTP/1.1: ${h11.conns.length}`,
        pass: r.streams.length === page.length && r.streams.every((s) => s.status === 200) && relay.conns.length === 1 && h2.conns.length === 1 && h11.conns.length === 6,
      },
      {
        step: 'multiplexing',
        title: 'Slices of different files arrive interleaved',
        real: `${interleaved} of ${page.length} files had other files' data arrive in the middle of them`,
        lesson_says: 'the server interleaves slices of all the responses on the same connection',
        pass: interleaved >= 2,
      },
      {
        step: 'frames',
        title: 'The browser numbers its streams 1, 3, 5…',
        real: ids.join(', '),
        lesson_says: 'odd numbers from the browser, even ones belong to the server',
        pass: ids.every((id, i) => id === 1 + 2 * i),
      },
    ];
    for (const c of checks) R.check({ lesson: LESSON, software: NGINX, ...c });
    for (const c of checks) expect(c.pass, `${c.title}: real ${c.real}; lesson ${c.lesson_says}`).toBe(true);
  });

  test('curl\'s timings: one round trip for TLS, one for the request (handshakes)', async () => {
    const sv = await server(ALT.code);
    const relay = later(await delayProxy(sv.port, 100));
    const w = (await sv.curl(['-so', '/dev/null', '--http2', 'https://shop.example/', '-w', 'tcp %{time_connect}  tls %{time_appconnect}  first byte %{time_starttransfer}\n'], relay.port)).out;
    const [tcp, tlsDone, first] = [...w.matchAll(/[\d.]+/g)].map((m) => Number(m[0]) * 1000);
    const tlsR = round((tlsDone - tcp) / relay.rtt);
    const reqR = round((first - tlsDone) / relay.rtt);
    const load = new PageLoad({ proto: 'h2', rttMs: 100, loss: 0, files: page, conns: 6, zeroRtt: false, seed: 1 });
    const ready = (load.conns[0].tReady * MS) / 100; // round trips until the first request may leave (TCP + TLS)
    const pass = Math.round(tlsR) === 1 && Math.round(reqR) === 1 && ready === 2;
    R.check({
      lesson: LESSON,
      step: 'handshakes',
      title: 'TLS takes one round trip, the request another',
      software: NGINX,
      real: `${w.trim()} at ${relay.rtt} ms per round trip: TLS ${tlsR}, request ${reqR} (the relay can't slow down TCP's own handshake)`,
      lesson_says: `tcp 0.101  tls 0.203  first byte 0.305 at 100 ms; the animation opens the connection after ${ready} (TCP + TLS)`,
      pass,
    });
    expect(pass, w).toBe(true);
  });

  test('the playground\'s live config, version by version (playground)', async () => {
    const rows: string[] = [];
    const bad: string[] = [];
    for (const proto of ['h1.0', 'h1.1', 'h2', 'h3'] as Proto[]) {
      const sv = await server(nginxFor(proto, proto === 'h3'));
      const two = (await sv.curl(['-sv', '--http2', '-o', '/dev/null', '-o', '/dev/null', 'https://shop.example/', 'https://shop.example/logo.svg'])).err;
      const head = (await sv.curl(['-sI', '--http2', 'https://shop.example/'])).out;
      const conns = two.split('\n').filter((l) => /^\* Connected to /.test(l)).length;
      const version = head.split('\r\n')[0].trim();
      const alt = /^alt-svc: h3=":443"; ma=86400/m.test(head);
      const udp = (await sv.udp()).includes('nginx');
      const load = new PageLoad({ proto, rttMs: 100, loss: 0, files: page.slice(0, 2), conns: 6, zeroRtt: false, seed: 1 }).runToEnd();
      const want = { 'h1.0': ['HTTP/1.1 200', 2], 'h1.1': ['HTTP/1.1 200', 1], h2: ['HTTP/2 200', 1], h3: ['HTTP/2 200', 1] }[proto] as [string, number];
      const ok = version.startsWith(want[0]) && conns === want[1] && alt === (proto === 'h3') && udp === (proto === 'h3') && (proto === 'h1.0' ? load.handshakes === 2 : load.handshakes === 1);
      rows.push(`${proto}: ${version}, two files over ${conns} connection(s)${alt ? ', Alt-Svc h3' : ''}${udp ? ', UDP open' : ''} (animation: ${load.handshakes} handshake(s))`);
      if (!ok) bad.push(proto);
    }
    R.check({ lesson: LESSON, step: 'playground', title: 'What each live config does with two requests from curl --http2', software: NGINX, real: rows.join('; '), lesson_says: 'h1.0 closes after each response; h1.1 stays on HTTP/1.1; h2 and h3 speak HTTP/2 over TCP; h3 adds Alt-Svc and QUIC', pass: !bad.length });
    expect(bad, rows.join('\n')).toEqual([]);
  });
});

/* ================================================================== */
/* 5. WebSockets                                                       */
/* ================================================================== */

interface WsClient {
  ws: WebSocket;
  messages: string[];
  opened: Promise<boolean>;
  closed: Promise<{ code: number; at: number }>;
}

function wsClient(url: string): WsClient {
  const ws = new WebSocket(url);
  const messages: string[] = [];
  let onClosed: (x: { code: number; at: number }) => void = () => {};
  const closed = new Promise<{ code: number; at: number }>((r) => (onClosed = r));
  const opened = new Promise<boolean>((resolve) => {
    ws.onopen = () => resolve(true);
    ws.onerror = () => resolve(false);
    ws.onclose = (e) => {
      resolve(false);
      onClosed({ code: e.code, at: performance.now() });
    };
  });
  ws.onmessage = (e) => messages.push(String(e.data));
  return { ws, messages, opened, closed };
}

/** A raw upgrade request: status and headers of the answer. */
function upgrade(port: number) {
  const key = crypto.randomBytes(16).toString('base64');
  return new Promise<{ status: number; accept: unknown; expected: string; upgradeHeader: unknown }>((resolve) => {
    const req = http.request({ host: '127.0.0.1', port, path: '/ws', headers: { host: 'chat.example', connection: 'Upgrade', upgrade: 'websocket', 'sec-websocket-key': key, 'sec-websocket-version': '13' } });
    const done = (res: http.IncomingMessage) => resolve({ status: res.statusCode ?? 0, accept: res.headers['sec-websocket-accept'], expected: acceptKey(key), upgradeHeader: res.headers.upgrade });
    req.on('upgrade', (res, socket) => {
      socket.destroy();
      done(res);
    });
    req.on('response', (res) => {
      res.resume();
      done(res);
    });
    req.on('error', () => resolve({ status: 0, accept: null, expected: acceptKey(key), upgradeHeader: null }));
    req.end();
  });
}

describe('WebSockets', () => {
  const LESSON = 'websockets';
  const WSN = snippet(SN.websockets, 'one-server-per-socket', 'nginx.conf');

  async function chat(code = WSN.code) {
    const backends = await wsBackends(['ws-1', 'ws-2']);
    cleanup.push(async () => {
      for (const b of backends) await b.kill();
    });
    const port = await freePort();
    await nginx(prepareNginx(code, { port, addresses: { '10.0.1.11:8080': `127.0.0.1:${backends[0].port}`, '10.0.1.12:8080': `127.0.0.1:${backends[1].port}` } }).text, port);
    const clients: WsClient[] = [];
    cleanup.push(async () => clients.forEach((c) => c.ws.close()));
    const connect = () => {
      const c = wsClient(`ws://127.0.0.1:${port}/ws`);
      clients.push(c);
      return c;
    };
    return { backends, port, connect };
  }
  const where = (c: WsClient) => c.messages[0]?.replace('hello from ', '') ?? 'none';

  test('the upgrade through nginx: 101, then messages both ways (one-server-per-socket)', async () => {
    const { backends, port, connect } = await chat();
    const up = await upgrade(port);
    const c = connect();
    const opened = await c.opened;
    await waitFor(() => c.messages.length > 0);
    c.ws.send('hi');
    await waitFor(() => c.messages.length > 1);
    for (const b of backends) b.pingAll();
    await waitFor(() => backends.some((b) => b.pongs > 0));
    const pongs = backends.reduce((n, b) => n + b.pongs, 0);

    const stripped = WSN.code
      .split('\n')
      .filter((l) => !/proxy_set_header (Upgrade|Connection)/.test(l))
      .join('\n');
    const bare = await chat(stripped);
    const b = bare.connect();
    const bareOpened = await b.opened;
    const plainSeen = bare.backends.flatMap((x) => x.plain);
    const checks = [
      {
        title: 'The handshake: 101 Switching Protocols',
        real: `${up.status}, Upgrade: ${up.upgradeHeader}, Sec-WebSocket-Accept ${up.accept === up.expected ? 'correct' : 'wrong'}`,
        lesson_says: 'the upgrade request passes through; the server answers 101',
        pass: up.status === 101 && up.accept === up.expected,
      },
      {
        title: 'Messages both ways, and a ping answered by a pong',
        real: `opened: ${opened}; server said "${c.messages[0]}", then "${c.messages[1]}"; pongs back: ${pongs}`,
        lesson_says: 'a two-way pipe; the browser answers pings with pongs on its own',
        pass: opened && /^hello from ws-\d$/.test(c.messages[0] ?? '') && /^echo: hi \(ws-\d\)$/.test(c.messages[1] ?? '') && pongs >= 1,
      },
      {
        title: 'Without the Upgrade and Connection lines',
        real: `the handshake ${bareOpened ? 'worked' : 'failed'}; the chat server got a plain GET (Upgrade header: ${plainSeen[0]?.upgrade ?? 'none'}) and answered 426`,
        lesson_says: 'nginx drops them (they are hop-by-hop) and the handshake fails',
        pass: !bareOpened && plainSeen.length === 1 && plainSeen[0].upgrade === undefined,
      },
    ];
    for (const c2 of checks) R.check({ lesson: LESSON, step: 'one-server-per-socket', software: NGINX, ...c2 });
    for (const c2 of checks) expect(c2.pass, `${c2.title}: real ${c2.real}; lesson ${c2.lesson_says}`).toBe(true);
    R.stamp(WSN.code, {
      lesson: LESSON,
      by: NGINX,
      kind: 'ran',
      note: `Ran it on nginx ${V}: the upgrade got 101 and messages flowed both ways. With the Upgrade and Connection lines removed, the chat server got a plain GET and the handshake failed.`,
    });
  });

  test('least_conn picks once; a restart does not rebalance (one-server-per-socket)', async () => {
    const { backends, connect } = await chat();
    const first: WsClient[] = [];
    for (let i = 0; i < 4; i++) {
      const c = connect();
      await c.opened;
      await waitFor(() => c.messages.length > 0);
      first.push(c);
    }
    const count = () => backends.map((b) => `${b.name}: ${b.open.size}`).join(', ');
    const before = count();
    const onOne = first.filter((c) => where(c) === 'ws-1');
    await backends[0].kill(1001);
    const codes = await Promise.all(onOne.map((c) => c.closed.then((x) => x.code)));
    const again: WsClient[] = [];
    for (let i = 0; i < onOne.length; i++) {
      const c = connect();
      await c.opened;
      await waitFor(() => c.messages.length > 0);
      again.push(c);
    }
    await backends[0].revive();
    await sleep(1500);
    const after = count();

    // The animation: the same step, with ws-1 restarted once everyone is connected.
    const step = WS.flatMap((ch) => ch.steps.map((st) => ({ ch, st }))).find((x) => x.st.id === 'one-server-per-socket')!;
    const sim = new WsSim();
    sim.enter({ ...WS_DEFAULTS, ...step.ch.cfg, ...step.st.cfg, strip: !!step.st.strip }, step.st.script ?? [], {});
    const play = (s: number) => {
      for (let t = 0; t < s; t += 0.05) sim.advance(0.05, true, 1);
    };
    const simCount = () => [...sim.srv.values()].map((s) => s.conns.size);
    play(15);
    const simBefore = simCount();
    sim.restartServer('srv1');
    play(30);
    const simAfter = simCount();
    const pass =
      onOne.length === 2 &&
      codes.every((c) => c === 1001) &&
      again.every((c) => where(c) === 'ws-2') &&
      backends[0].open.size === 0 &&
      backends[1].open.size === 4 &&
      simBefore.join() === '2,2' &&
      simAfter.join() === '0,4';
    R.check({
      lesson: LESSON,
      step: 'one-server-per-socket',
      title: 'Restart ws-1: its users move to ws-2 and stay there',
      software: NGINX,
      real: `before: ${before}; ws-1 closed its sockets with ${codes.join(', ')}; they reconnected to ${again.map(where).join(', ')}; after ws-1 came back: ${after}`,
      lesson_says: `before: ws-1 ${simBefore[0]}, ws-2 ${simBefore[1]}; after the restart: ws-1 ${simAfter[0]}, ws-2 ${simAfter[1]}`,
      pass,
    });
    expect(pass).toBe(true);
  });
});

/* ================================================================== */
/* 6. Consistent hashing                                               */
/* ================================================================== */

describe('Consistent hashing', () => {
  const LESSON = 'consistent-hashing';

  test('hash $uri consistent moves about 1/N; without it, about 4 in 5 (a-server-leaves)', async () => {
    const s = snippet(SN['consistent-hashing'], 'a-server-leaves', 'nginx.conf');
    const lines = plain(s.code).match(/server 10\.0\.1\.\d+:11211;/g)!;
    const addrs = lines.map((l) => l.slice(7, -1));
    const mcs = await memcachedServers(['cache-a', 'cache-b', 'cache-c', 'cache-d', 'cache-e']);
    cleanup.push(async () => {
      for (const m of mcs) await m.kill().catch(() => {});
    });
    const addresses = Object.fromEntries(addrs.map((a, i) => [a, `127.0.0.1:${mcs[i].port}`]));
    const uris = Array.from({ length: 600 }, (_, i) => `/profile/u${i}`);

    const mapAll = async (code: string) => {
      const port = await freePort();
      const ng = await nginx(prepareNginx(code, { port, addresses }).text, port);
      const out: string[] = [];
      for (let i = 0; i < uris.length; i += 30) {
        const batch = await Promise.all(uris.slice(i, i + 30).map((u) => get(`http://127.0.0.1:${port}${u}`)));
        out.push(...batch.map((a) => (a.status === 200 ? a.body.trim() : `error ${a.status}`)));
      }
      await ng.stop();
      return out;
    };
    const moved = (a: string[], b: string[]) => a.filter((x, i) => x !== b[i]).length / a.length;
    const without = (code: string, k: number) => code.replace(`\n    ${lines[k]}`, '');
    const modN = s.code.replace('hash $uri consistent;', 'hash $uri;');

    const ring = await mapAll(s.code);
    const ringMoves: number[] = [];
    for (let k = 0; k < lines.length; k++) ringMoves.push(moved(ring, await mapAll(without(s.code, k))));
    const mod = await mapAll(modN);
    const modMoves: number[] = [];
    for (let k = 0; k < lines.length; k++) modMoves.push(moved(mod, await mapAll(without(modN, k))));
    // cache-b crashes but stays in the list
    await mcs[1].kill();
    const ringCrash = await mapAll(s.code);
    const modCrash = await mapAll(modN);
    await mcs[1].revive();
    const strays = (base: string[], after: string[]) => base.filter((x, i) => x !== after[i] && x !== 'cache-b').length;

    // The lesson's own ring (one seat per server in this step) and its hash mod N.
    const five = CH.flatMap((c) => c.steps).find((x) => x.id === 'a-server-leaves')!.cfg!.servers as string[];
    const full = buildRing(new Map(five.map((id) => [id, 1])));
    const lessonMoves = five.map((gone) => {
      const rest = five.filter((x) => x !== gone);
      const m = scaleMoves(full, buildRing(new Map(rest.map((id) => [id, 1]))), five, rest);
      return { ring: m.ring / m.total, mod: m.mod / m.total };
    });
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const pct = (x: number) => `${Math.round(x * 100)}%`;
    const checks = [
      {
        title: 'Remove one of five servers: hash $uri consistent',
        real: `moved ${ringMoves.map(pct).join(', ')} of ${uris.length} URIs (one run per server removed)`,
        lesson_says: `about 1/N = 20%; the lesson's one-seat ring moves ${lessonMoves.map((m) => pct(m.ring)).join(', ')} (average ${pct(avg(lessonMoves.map((m) => m.ring)))})`,
        pass: ringMoves.every((x) => x > 0.1 && x < 0.3) && Math.abs(avg(lessonMoves.map((m) => m.ring)) - 0.2) < 0.02,
      },
      {
        title: 'Remove one of five servers: plain hash $uri (mod N)',
        real: `moved ${modMoves.map(pct).join(', ')}`,
        lesson_says: `about 4 in 5; the lesson's hash mod N moves ${pct(avg(lessonMoves.map((m) => m.mod)))}`,
        pass: modMoves.every((x) => x > 0.7 && x < 0.9) && Math.abs(avg(lessonMoves.map((m) => m.mod)) - 0.8) < 0.03,
      },
      {
        title: 'cache-b crashes but stays in the list',
        real: `consistent: ${pct(moved(ring, ringCrash))} moved, ${strays(ring, ringCrash)} of them not cache-b's; plain hash: ${pct(moved(mod, modCrash))} moved, ${strays(mod, modCrash)} not cache-b's; errors: ${[...ringCrash, ...modCrash].filter((x) => x.startsWith('error')).length}`,
        lesson_says: 'its keys continue to the next server; every other key stays (the note: a crashed server that stays listed only loses its own keys)',
        pass: strays(ring, ringCrash) === 0 && strays(mod, modCrash) === 0 && moved(ring, ringCrash) > 0.1 && moved(mod, modCrash) > 0.1 && ![...ringCrash, ...modCrash].some((x) => x.startsWith('error')),
      },
    ];
    for (const c of checks) R.check({ lesson: LESSON, step: 'a-server-leaves', software: NGINX, ...c });
    for (const c of checks) expect(c.pass, `${c.title}: real ${c.real}; lesson ${c.lesson_says}`).toBe(true);
    R.stamp(s.code, {
      lesson: LESSON,
      by: NGINX,
      kind: 'ran',
      note: `Ran it on nginx ${V}: removing any one of the five servers moved about a fifth of the URIs. With plain hash $uri, about four in five moved.`,
    });
  });
});

/* ================================================================== */
/* 7. Processes and threads                                            */
/* ================================================================== */

describe('Processes and threads', () => {
  test('a master and one single-threaded worker per core (databases-and-web-servers)', async () => {
    const s = snippet(SN['processes-threads'], 'databases-and-web-servers', 'nginx.conf');
    const port = await freePort();
    const ng = await startNginxMain(s.code, `server { listen 127.0.0.1:${port}; return 200 "ok\\n"; }`, port);
    cleanup.push(ng.stop);
    const ps = await nginxProcesses(ng.child.pid!);
    const cores = os.availableParallelism();
    const method = ng.errorLog().match(/using the "(\w+)" event method/)?.[1];
    // The animation's nginx: a master plus workers, on a 2-core machine.
    const simWorkers = PT_NGINX.filter((p) => p.name === 'worker');
    const simMaster = PT_NGINX.filter((p) => p.name === 'master');
    const pass =
      !!ps.master &&
      ps.master.threads === 1 &&
      ps.workers.length === cores &&
      ps.workers.every((w) => w.threads === 1 && /worker process/.test(w.command)) &&
      simMaster.length === 1 &&
      simWorkers.length === 2 &&
      simWorkers.every((w) => w.threads.length === 1);
    R.check({
      lesson: 'processes-threads',
      step: 'databases-and-web-servers',
      title: 'worker_processes auto',
      software: NGINX,
      real: `1 master (${ps.master?.threads} thread) + ${ps.workers.length} workers on ${cores} cores, ${[...new Set(ps.workers.map((w) => w.threads))].join('/')} thread each; event method ${method}`,
      lesson_says: `a master and one single-threaded worker per core (the animation: ${simMaster.length} master + ${simWorkers.length} workers on 2 cores)`,
      pass,
    });
    expect(pass, JSON.stringify(ps)).toBe(true);
    R.stamp(s.code, { lesson: 'processes-threads', by: NGINX, kind: 'ran', note: `Ran it on nginx ${V}: one master process plus one worker per core, each worker with a single thread.` });
  });
});

/* ================================================================== */
/* 8. Life of a request                                                */
/* ================================================================== */

const LOR_SNIP = snippet(SN['life-of-a-request'], 'why-its-faster', 'nginx.conf');

async function lorServer() {
  const port = await freePort();
  const ng = await nginx(prepareNginx(LOR_SNIP.code, { port }).text, port);
  serveFiles(ng.dir, { cart: '<h1>Your cart</h1>\n', 'app.3f9a1c.css': 'body{}\n', 'app.js': 'console.log(1)\n' });
  return port;
}

describe('Life of a request', () => {
  test('the cart is never cached, hashed files are cached for a year (why-its-faster)', async () => {
    const port = await lorServer();
    const cart = await get(`http://127.0.0.1:${port}/cart`);
    const css = await get(`http://127.0.0.1:${port}/app.3f9a1c.css`);
    const js = await get(`http://127.0.0.1:${port}/app.js`);
    const cc = (a: Answer) => String(a.headers['cache-control']);
    const pass = cart.status === 200 && cc(cart) === 'no-store' && cc(css) === 'public, max-age=31536000, immutable' && cc(js) === cc(css);
    R.check({
      lesson: 'life-of-a-request',
      step: 'why-its-faster',
      title: 'Cache-Control on the cart and on the assets',
      software: NGINX,
      real: `/cart: ${cc(cart)}; /app.3f9a1c.css: ${cc(css)}; /app.js: ${cc(js)}`,
      lesson_says: 'Cache-Control: no-store on /cart; max-age=31536000, immutable on app.css and app.js',
      pass,
    });
    expect(pass).toBe(true);
  });
});

/* ================================================================== */
/* 9. Idle connections (one long wait for all of them)                 */
/* ================================================================== */

describe('idle connections', () => {
  test('a minute of silence: keep-alive, proxy_read_timeout and heartbeats (why-its-faster, one-server-per-socket, heartbeats)', { timeout: 150_000 }, async () => {
    // Life of a request: an idle keep-alive connection.
    const lor = await lorServer();
    const keep = rawHttp(lor);
    await keep.ready;
    const firstVisit = await keep.get('/cart');

    // WebSockets: the lesson's config, the same without proxy_read_timeout, and that one with a heartbeat.
    const WSN = snippet(SN.websockets, 'one-server-per-socket', 'nginx.conf');
    const noTimeout = WSN.code
      .split('\n')
      .filter((l) => !l.includes('proxy_read_timeout'))
      .join('\n');
    const setups: { name: string; code: string; ping: boolean }[] = [
      { name: 'lesson (3600s)', code: WSN.code, ping: false },
      { name: 'default timeout', code: noTimeout, ping: false },
      { name: 'default + pings every 20 s', code: noTimeout, ping: true },
    ];
    const runs: { name: string; client: WsClient; backends: WsBackend[]; quietSince: number; closedAt: number | null; code: number | null }[] = [];
    for (const st of setups) {
      const backends = await wsBackends(['ws-1', 'ws-2']);
      cleanup.push(async () => {
        for (const b of backends) await b.kill();
      });
      const port = await freePort();
      await nginx(prepareNginx(st.code, { port, addresses: { '10.0.1.11:8080': `127.0.0.1:${backends[0].port}`, '10.0.1.12:8080': `127.0.0.1:${backends[1].port}` } }).text, port);
      const client = wsClient(`ws://127.0.0.1:${port}/ws`);
      cleanup.push(async () => client.ws.close());
      await client.opened;
      await waitFor(() => client.messages.length > 0);
      // The server's hello is the last traffic on this socket.
      const r = { name: st.name, client, backends, quietSince: performance.now(), closedAt: null as number | null, code: null as number | null };
      void client.closed.then((x) => {
        r.closedAt = x.at;
        r.code = x.code;
      });
      runs.push(r);
    }
    const heartbeat = setInterval(() => runs.filter((_, i) => setups[i].ping).forEach((r) => r.backends.forEach((b) => b.pingAll())), 20_000);
    await sleep(64_000);
    clearInterval(heartbeat);
    const secondVisit = keep.closedAt == null ? await keep.get('/app.3f9a1c.css') : '';
    keep.close();

    const [lesson, bare, pinged] = runs;
    const idleSecs = (r: (typeof runs)[number]) => (r.closedAt == null ? NaN : (r.closedAt - r.quietSince) / 1000);
    const at = (r: (typeof runs)[number]) => (r.closedAt == null ? 'still open' : `closed after ${Math.round(idleSecs(r))} s of silence, code ${r.code}`);
    const pongs = pinged.backends.reduce((n, b) => n + b.pongs, 0);
    const cc = (raw: string) => raw.match(/^Cache-Control: (.*)$/im)?.[1]?.trim();
    const checks = [
      {
        lesson: 'life-of-a-request',
        step: 'why-its-faster',
        title: 'A minute later, the connection is still open',
        real: `/cart: ${cc(firstVisit)}; after 64 s idle, the same connection ${keep.closedAt == null && /200 OK/.test(secondVisit) ? `answered again: /app.3f9a1c.css with ${cc(secondVisit)}` : 'was closed'}`,
        lesson_says: 'keepalive_timeout 75s: the server hasn\'t closed it yet',
        pass: /200 OK/.test(firstVisit) && cc(firstVisit) === 'no-store' && keep.closedAt == null && /200 OK/.test(secondVisit) && cc(secondVisit) === 'public, max-age=31536000, immutable',
      },
      {
        lesson: 'websockets',
        step: 'one-server-per-socket',
        title: 'proxy_read_timeout 3600s keeps an idle socket open',
        real: at(lesson),
        lesson_says: 'the load balancer must allow long idle times',
        pass: lesson.closedAt == null,
      },
      {
        lesson: 'websockets',
        step: 'heartbeats',
        title: 'Without it, nginx cuts an idle socket at 60 s',
        real: at(bare),
        lesson_says: 'the 60-second default of nginx\'s proxy_read_timeout; the browser sees code 1006',
        pass: bare.code === 1006 && idleSecs(bare) > 59 && idleSecs(bare) < 62,
      },
      {
        lesson: 'websockets',
        step: 'heartbeats',
        title: 'Pings every 20 s keep it open under the 60 s default',
        real: `${at(pinged)}; ${pongs} pongs came back`,
        lesson_says: 'real servers ping every 20 to 30 seconds, comfortably inside the 60-second default',
        pass: pinged.closedAt == null && pongs >= 3,
      },
    ];
    for (const c of checks) R.check({ software: NGINX, ...c });
    for (const c of checks) expect(c.pass, `${c.title}: real ${c.real}; lesson ${c.lesson_says}`).toBe(true);
    R.stamp(LOR_SNIP.code, {
      lesson: 'life-of-a-request',
      by: NGINX,
      kind: 'ran',
      note: `Ran it on nginx ${V}: /cart came back with no-store and the hashed CSS with the one-year immutable header, over a connection that was still open after a minute of silence.`,
    });
  });
});
