/**
 * Load Balancing lesson vs. real nginx and HAProxy.
 *
 * Each test runs a lesson scenario twice: once through the lesson's own
 * simulation (the code that draws the animation) and once through the real
 * program, configured with the snippet the lesson shows. Then it compares.
 */
import { afterEach, describe, expect, test } from 'vitest';
import { CHAPTERS } from '@/lessons/load-balancing/chapters';
import { CLIENTS } from '@/lessons/load-balancing/engine/constants';
import { nginxConfig } from '@/lessons/load-balancing/panel/nginxConfig';
import type { Algo } from '@/lessons/load-balancing/engine/types';
import { haproxyCfg, nginxHttp } from './lib/confs';
import { overOneConnection, request, traffic, type Hit } from './lib/http';
import { routes, simulate } from './lib/lbsim';
import {
  freePort,
  haproxyCheck,
  haproxyVersion,
  nginxCheck,
  nginxVersion,
  sleep,
  startBackends,
  startHaproxy,
  startNginx,
  type Backend,
} from './lib/procs';
import { results, secs } from './lib/results';
import { collectSnippets, snippet } from './lib/snippets';

const LESSON = 'load-balancing';
const R = results(LESSON);
const NGINX = `nginx ${nginxVersion()}`;
const HAPROXY = `HAProxy ${haproxyVersion()}`;
const SNIPS = collectSnippets(CHAPTERS);

/** s2 -> web-2, the name both the lesson and the stand-in servers use */
const web = (id: string) => `web-${id.replace(/\D/g, '')}`;

/* ---------------- cleanup between tests ---------------- */

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!();
});

async function webs(n = 3) {
  const bs = await startBackends(Array.from({ length: n }, (_, i) => `web-${i + 1}`));
  cleanup.push(async () => {
    for (const b of bs) await b.kill();
  });
  const addresses: Record<string, string> = {};
  bs.forEach((b, i) => {
    addresses[`10.0.1.${11 + i}:8080`] = `127.0.0.1:${b.port}`;
    addresses[`10.0.1.${11 + i}:443`] = `127.0.0.1:${b.port}`;
  });
  return { bs, addresses };
}

async function nginx(httpBody: string, port: number) {
  const ng = await startNginx(httpBody, port);
  cleanup.push(ng.stop);
  return ng;
}

async function haproxy(cfg: string, port: number) {
  const hp = await startHaproxy(cfg, port);
  cleanup.push(hp.stop);
  return hp;
}

async function sequence(url: string, n: number, headers?: Record<string, string>) {
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push((await request(url, { headers })).backend ?? 'error');
  return out;
}

/* ================================================================== */

describe('every config snippet loads in the real program', () => {
  for (const s of SNIPS.filter((x) => x.lang === 'nginx')) {
    test(`nginx -t: ${s.step} / ${s.title}`, async () => {
      const port = await freePort();
      const { text } = nginxHttp(s.code, { port, front: true });
      const r = nginxCheck(text);
      R.check({ lesson: LESSON, step: s.step, title: `nginx accepts the ${s.title} snippet`, software: NGINX, real: r.ok ? 'accepted' : r.output.split('\n')[0], pass: r.ok });
      expect(r.ok, r.output).toBe(true);
      R.stamp(s.code, { lesson: LESSON, by: NGINX, kind: 'loads', note: `nginx ${nginxVersion()} loads this config (nginx -t).` });
    });
  }

  for (const s of SNIPS.filter((x) => x.lang === 'haproxy')) {
    test(`haproxy -c: ${s.step} / ${s.title}`, async () => {
      const port = await freePort();
      const { text } = haproxyCfg(s.code, { port });
      const r = haproxyCheck(text);
      R.check({ lesson: LESSON, step: s.step, title: `HAProxy accepts the ${s.title} snippet`, software: HAPROXY, real: r.ok ? 'accepted' : r.output, pass: r.ok });
      expect(r.ok, r.output).toBe(true);
      R.stamp(s.code, { lesson: LESSON, by: HAPROXY, kind: 'loads', note: `HAProxy ${haproxyVersion()} loads this config (haproxy -c).` });
    });
  }

  test('nginx -t: every config the playground can generate', () => {
    const algos: Algo[] = ['rr', 'least', 'weighted', 'iphash', 'random', 'p2c'];
    const sizes = [
      { size: 's' as const, weight: 1 },
      { size: 'm' as const, weight: 2 },
      { size: 'l' as const, weight: 4 },
    ];
    let n = 0;
    for (const algo of algos) {
      for (const hc of [false, true]) {
        for (let count = 1; count <= 6; count++) {
          const servers = Array.from({ length: count }, (_, i) => ({ label: `web-${i + 1}`, ip: `10.0.1.${11 + i}`, ...sizes[i % 3], up: i !== 1 }));
          const code = nginxConfig(algo, servers, hc);
          const r = nginxCheck(nginxHttp(code, { port: 18443 }).text);
          expect(r.ok, `${algo} hc=${hc} n=${count}\n${code}\n${r.output}`).toBe(true);
          n++;
        }
      }
    }
    R.check({ lesson: LESSON, step: 'playground', title: 'nginx accepts every config the playground generates', software: NGINX, real: `${n} variants accepted`, pass: true });
  });
});

/* ================================================================== */

describe('choosing a server', () => {
  test('round robin takes turns (round-robin, enter-the-load-balancer)', async () => {
    const { addresses } = await webs(3);
    const port = await freePort();
    const rr = snippet(SNIPS, 'round-robin', 'nginx.conf');
    await nginx(nginxHttp(rr.code, { port, addresses, front: true }).text, port);
    const real = await sequence(`http://127.0.0.1:${port}/cart`, 9);

    const sim = routes(simulate('round-robin', 60).trace).slice(0, 9).map(web);
    R.check({ lesson: LESSON, step: 'round-robin', title: 'Round robin order', software: NGINX, real: real.join(' '), lesson_says: sim.join(' '), pass: real.join() === sim.join() });
    expect(real).toEqual(sim);
    R.stamp(rr.code, { lesson: LESSON, by: NGINX, kind: 'ran', note: `Ran it on nginx ${nginxVersion()}: nine requests went ${real.slice(0, 4).join(', ')}… in turn, same as the animation.` });

    // The first snippet in the lesson, with TLS, served over HTTPS.
    const entry = snippet(SNIPS, 'enter-the-load-balancer', 'nginx.conf');
    const port2 = await freePort();
    await nginx(nginxHttp(entry.code, { port: port2, addresses }).text, port2);
    const tls = await sequence(`https://127.0.0.1:${port2}/cart`, 6, { host: 'shop.example' });
    const sim2 = routes(simulate('enter-the-load-balancer', 4).trace).slice(0, 6).map(web);
    R.check({ lesson: LESSON, step: 'enter-the-load-balancer', title: 'The whole idea: upstream + proxy_pass, over HTTPS', software: NGINX, real: tls.join(' '), lesson_says: sim2.join(' '), pass: tls.join() === sim2.join() });
    expect(tls).toEqual(sim2);
    R.stamp(entry.code, { lesson: LESSON, by: NGINX, kind: 'ran', note: `Ran it on nginx ${nginxVersion()} over HTTPS: requests were shared ${tls.slice(0, 3).join(', ')}, then around again.` });
  });

  test('X-Forwarded-For carries the visitor address (the-load-balancer-forwards-it)', async () => {
    const { bs } = await webs(3);
    const port = await freePort();
    const s = snippet(SNIPS, 'the-load-balancer-forwards-it', 'nginx.conf');
    await nginx(nginxHttp(s.code, { port, stub: `127.0.0.1:${bs[1].port}` }).text, port);
    const r = await request(`http://127.0.0.1:${port}/cart`, { headers: { host: 'shop.example' } });
    const seen = JSON.parse(r.body) as { xff: string | null; host: string | null; backend: string };
    const pass = seen.xff === '127.0.0.1' && seen.host === 'shop.example';
    R.check({
      lesson: LESSON,
      step: 'the-load-balancer-forwards-it',
      title: 'web-2 still learns who the visitor is',
      software: NGINX,
      real: `${seen.backend} saw X-Forwarded-For: ${seen.xff}, Host: ${seen.host}`,
      lesson_says: 'adds X-Forwarded-For with the visitor address',
      pass,
    });
    expect(pass).toBe(true);
    R.stamp(s.code, { lesson: LESSON, by: NGINX, kind: 'ran', note: `Ran it on nginx ${nginxVersion()}: the server received X-Forwarded-For with the visitor's address and the original Host header.` });
  });

  test('round robin piles every heavy export on web-1 (unequal-requests)', async () => {
    const { addresses } = await webs(3);
    const port = await freePort();
    const rr = snippet(SNIPS, 'round-robin', 'nginx.conf');
    await nginx(nginxHttp(rr.code, { port, addresses, front: true }).text, port);
    // Every third request is heavy, like the step's H, L, L pattern.
    const { hits } = await traffic(`http://127.0.0.1:${port}/`, 3, 4, [], { path: (i) => (i % 3 === 0 ? '/slow?ms=2500' : '/slow?ms=300') });
    const heavyReal = hits.filter((h) => h.path?.includes('ms=2500')).map((h) => h.backend);

    const run = simulate('unequal-requests', 12).trace;
    const heavySim = run.filter((e) => e.kind === 'route' && e.heavy).map((e) => (e.kind === 'route' ? web(e.server) : ''));
    const pass = heavyReal.every((b) => b === 'web-1') && heavySim.every((b) => b === 'web-1');
    R.check({
      lesson: LESSON,
      step: 'unequal-requests',
      title: 'Round robin sends every heavy request to web-1',
      software: NGINX,
      real: `heavy requests went to ${heavyReal.join(', ')}`,
      lesson_says: `heavy requests went to ${heavySim.join(', ')}`,
      pass,
    });
    expect(pass).toBe(true);
  });

  test('least connections steers around a busy server (least-connections)', async () => {
    const { addresses } = await webs(3);
    const port = await freePort();
    const s = snippet(SNIPS, 'least-connections', 'nginx.conf');
    await nginx(nginxHttp(s.code, { port, addresses, front: true }).text, port);
    const slow = request(`http://127.0.0.1:${port}/slow?ms=2500`);
    await sleep(200);
    const next = await sequence(`http://127.0.0.1:${port}/cart`, 6);
    const busy = (await slow).backend;

    // The same moment in the animation: one open connection on web-1.
    const run = simulate('least-connections', 30);
    const pass = !next.includes(busy ?? '') && next.includes('web-2') && next.includes('web-3');
    R.check({
      lesson: LESSON,
      step: 'least-connections',
      title: 'New requests avoid the server that is still busy',
      software: NGINX,
      real: `${busy} busy with a slow request; the next six went to ${next.join(', ')}`,
      lesson_says: 'new requests flow to web-2 and web-3 until web-1 catches up',
      pass,
    });
    expect(pass).toBe(true);
    expect(routes(run.trace).length).toBeGreaterThan(5);
    R.stamp(s.code, { lesson: LESSON, by: NGINX, kind: 'ran', note: `Ran it on nginx ${nginxVersion()}: while ${busy} held a slow request, new requests went only to the other two.` });
  });

  test('weighted round robin deals 4 : 1 : 1 (weighted)', async () => {
    const { addresses } = await webs(3);
    const port = await freePort();
    const s = snippet(SNIPS, 'weighted', 'nginx.conf');
    await nginx(nginxHttp(s.code, { port, addresses, front: true }).text, port);
    const real = await sequence(`http://127.0.0.1:${port}/cart`, 12);
    const sim = routes(simulate('weighted', 6).trace).slice(0, 12).map(web);
    R.check({ lesson: LESSON, step: 'weighted', title: 'Weighted order, request by request', software: NGINX, real: real.join(' '), lesson_says: sim.join(' '), pass: real.join() === sim.join() });
    expect(real).toEqual(sim);
    const share = (name: string) => real.filter((b) => b === name).length / real.length;
    R.stamp(s.code, {
      lesson: LESSON,
      by: NGINX,
      kind: 'ran',
      note: `Ran it on nginx ${nginxVersion()}: the order was ${real.slice(0, 6).join(', ')}, the same smooth pattern the animation uses (${Math.round(share('web-1') * 100)}% to web-1).`,
    });
  });

});

/* ================================================================== */

describe('sticky sessions', () => {
  /** nginx with the lesson's upstream, trusting X-Real-IP so one machine can pose as many visitors. */
  async function hashing(code: string, bs: Backend[], port: number) {
    const addresses: Record<string, string> = {};
    bs.forEach((b, i) => (addresses[`10.0.1.${11 + i}:8080`] = `127.0.0.1:${b.port}`));
    const up = nginxHttp(code, { port, addresses }).text;
    await nginx(`${up}\nserver {\n  listen 127.0.0.1:${port};\n  set_real_ip_from 127.0.0.1;\n  real_ip_header X-Real-IP;\n  location / { proxy_pass http://backend; }\n}`, port);
    return (ip: string) => request(`http://127.0.0.1:${port}/cart`, { headers: { 'x-real-ip': ip } }).then((r) => r.backend ?? 'error');
  }

  const toyHash = (ip: string, n: number) => ip.split('.').map(Number).reduce((a, b) => a + b, 0) % n;

  test('ip_hash keeps each visitor on one server (sticky-sessions)', async () => {
    const { bs } = await webs(3);
    const port = await freePort();
    const s = snippet(SNIPS, 'sticky-sessions', 'nginx.conf');
    const ask = await hashing(s.code, bs, port);
    const people = CLIENTS.slice(0, 3);
    const real: Record<string, string[]> = {};
    for (const c of people) {
      real[c.name] = [];
      for (let i = 0; i < 4; i++) real[c.name].push(await ask(c.ip));
    }
    const sticky = Object.values(real).every((list) => new Set(list).size === 1);
    const where = Object.fromEntries(people.map((c) => [c.name, real[c.name][0]]));
    const sim = Object.fromEntries(people.map((c) => [c.name, `web-${toyHash(c.ip, 3) + 1}`]));
    R.check({
      lesson: LESSON,
      step: 'sticky-sessions',
      title: 'Same IP, same server, every time',
      software: NGINX,
      real: people.map((c) => `${c.name} (${c.ip}) → ${where[c.name]}`).join('; '),
      lesson_says: people.map((c) => `${c.name} → ${sim[c.name]} (toy sum-of-numbers hash)`).join('; '),
      pass: sticky,
    });
    expect(sticky).toBe(true);
    // nginx's ip_hash only reads the first three numbers of an IPv4 address,
    // so Alice and Carol (both 198.51.100.x) always share a server. The lesson says so.
    const shared = where.Alice === where.Carol;
    R.check({
      lesson: LESSON,
      step: 'sticky-sessions',
      title: 'ip_hash groups a whole /24 together',
      software: NGINX,
      real: shared ? `Alice and Carol (same first three numbers) both went to ${where.Alice}` : 'Alice and Carol went to different servers',
      lesson_says: 'the aside notes that NGINX only hashes the first three numbers',
      pass: shared,
    });
    expect(shared).toBe(true);
    R.stamp(s.code, { lesson: LESSON, by: NGINX, kind: 'ran', note: `Ran it on nginx ${nginxVersion()}: each visitor stayed on one server, and Alice and Carol, who share 198.51.100.x, landed together.` });
  });

  test('adding a server moves most users; consistent hashing moves about 1 in N (adding-a-server-reshuffles)', async () => {
    const all = await webs(4);
    const three = all.bs.slice(0, 3);
    const s = snippet(SNIPS, 'sticky-sessions', 'nginx.conf');
    const four = s.code.replace('    server 10.0.1.13:8080;', '    server 10.0.1.13:8080;\n    server 10.0.1.14:8080;');
    const consistent = (code: string) => code.replace(/ip_hash;[^\n]*/, 'hash $remote_addr consistent;');

    // 200 visitors from different /24 networks
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const ips = Array.from({ length: 200 }, () => `${11 + Math.floor(rnd() * 200)}.${Math.floor(rnd() * 256)}.${Math.floor(rnd() * 256)}.${1 + Math.floor(rnd() * 254)}`);

    const mapAll = async (code: string, bs: Backend[]) => {
      const ask = await hashing(code, bs, await freePort());
      const out: string[] = [];
      for (const ip of ips) out.push(await ask(ip));
      return out;
    };
    const moved = (a: string[], b: string[]) => a.filter((x, i) => x !== b[i]).length / a.length;

    const ipHashMoved = moved(await mapAll(s.code, three), await mapAll(four, all.bs));
    const ringMoved = moved(await mapAll(consistent(s.code), three), await mapAll(consistent(four), all.bs));
    const toyMoved = ips.filter((ip) => toyHash(ip, 3) !== toyHash(ip, 4)).length / ips.length;
    const pct = (x: number) => `${Math.round(x * 100)}%`;
    const pass = ipHashMoved > 0.6 && toyMoved > 0.6 && ringMoved < 0.4;
    R.check({
      lesson: LESSON,
      step: 'adding-a-server-reshuffles',
      title: 'Going from 3 to 4 servers',
      software: NGINX,
      real: `ip_hash moved ${pct(ipHashMoved)} of 200 visitors; hash … consistent moved ${pct(ringMoved)}`,
      lesson_says: `toy hash moves ${pct(toyMoved)} ("almost every user"); consistent hashing about 1 in N`,
      pass,
    });
    expect(pass).toBe(true);
  });
});

/* ================================================================== */

describe('layer 4 and layer 7', () => {
  test('layer 4 keeps a whole connection on one server (layer-4)', async () => {
    const { addresses } = await webs(3);
    const port = await freePort();
    const s = snippet(SNIPS, 'layer-4', 'haproxy.cfg');
    await haproxy(haproxyCfg(s.code, { port, addresses }).text, port);
    await sleep(300);
    const oneConn = (await overOneConnection(`http://127.0.0.1:${port}/cart`, 6)).map((h) => h.backend);
    const pinned = new Set(oneConn).size === 1;

    // For contrast, the same HAProxy reading HTTP (mode http) balances each request.
    const port7 = await freePort();
    const l7 = haproxyCfg(s.code.replaceAll('mode tcp', 'mode http').replace('balance leastconn', 'balance roundrobin'), { port: port7, addresses });
    await haproxy(l7.text, port7);
    await sleep(300);
    const perRequest = (await overOneConnection(`http://127.0.0.1:${port7}/cart`, 6)).map((h) => h.backend);

    const sim = simulate('layer-4', 20).trace;
    const alice = sim.filter((e) => e.kind === 'route' && e.client === 'alice').map((e) => (e.kind === 'route' ? web(e.server) : ''));
    const pass = pinned && new Set(perRequest).size > 1 && alice.length > 1 && new Set(alice).size === 1;
    R.check({
      lesson: LESSON,
      step: 'layer-4',
      title: 'One connection, one server',
      software: HAPROXY,
      real: `mode tcp: six requests on one connection all went to ${oneConn[0]}; mode http: ${perRequest.join(', ')}`,
      lesson_says: `all of Alice's requests follow her connection (${alice[0]} ×${alice.length})`,
      pass,
    });
    expect(pass).toBe(true);
    R.stamp(s.code, { lesson: LESSON, by: HAPROXY, kind: 'ran', note: `Ran it on HAProxy ${haproxyVersion()}: six requests over one connection all reached the same server. Switched to mode http, they were spread out.` });
  });

  test('layer 7 routes by path (layer-7)', async () => {
    const { addresses } = await webs(3);
    const port = await freePort();
    const s = snippet(SNIPS, 'layer-7', 'nginx.conf');
    await nginx(nginxHttp(s.code, { port, addresses }).text, port);
    const api = await sequence(`https://127.0.0.1:${port}/api/cart`, 4);
    const media = await sequence(`https://127.0.0.1:${port}/media/hero.jpg`, 2);

    const trace = simulate('layer-7', 20).trace;
    const pools = { api: new Set<string>(), media: new Set<string>() };
    for (const e of trace) if (e.kind === 'route') pools[e.path.startsWith('/media/') ? 'media' : 'api'].add(web(e.server));
    const pass =
      new Set(api).size === 2 && api.every((b) => b === 'web-1' || b === 'web-2') && media.every((b) => b === 'web-3') && [...pools.api].sort().join() === 'web-1,web-2' && [...pools.media].join() === 'web-3';
    R.check({
      lesson: LESSON,
      step: 'layer-7',
      title: '/api/ and /media/ go to different pools',
      software: NGINX,
      real: `/api/cart → ${api.join(', ')}; /media/hero.jpg → ${media.join(', ')}`,
      lesson_says: `/api/* → ${[...pools.api].sort().join(', ')}; /media/* → ${[...pools.media].join(', ')}`,
      pass,
    });
    expect(pass).toBe(true);
    R.stamp(s.code, { lesson: LESSON, by: NGINX, kind: 'ran', note: `Ran it on nginx ${nginxVersion()} over HTTPS: /api/ requests alternated between the two API servers and /media/ went to the media server.` });
  });
});

/* ================================================================== */

/** Trace helpers for the crash scenarios. */
function statusesBetween(hits: Hit[], from: number, to: number) {
  return hits.filter((h) => h.t >= from && h.t < to);
}

describe('when servers fail', () => {
  test('HAProxy: a crash, three failed checks, recovery (health-checks, a-server-crashes, recovery)', async () => {
    const { bs, addresses } = await webs(3);
    const port = await freePort();
    const s = snippet(SNIPS, 'health-checks', 'haproxy.cfg');
    const hp = await haproxy(haproxyCfg(s.code, { port, addresses, logs: true }).text, port);
    await sleep(2500);
    const t0 = performance.now();
    const at = (t: number, run: () => Promise<void>) => ({ t, run });
    const marks: Record<string, number> = {};
    const mark = (k: string) => (marks[k] = (performance.now() - t0) / 1000);
    const { hits } = await traffic(`http://127.0.0.1:${port}/cart`, 10, 25, [
      at(2.2, async () => void (mark('crash'), await bs[1].kill())),
      at(13, async () => void (mark('revive'), await bs[1].revive())),
      at(19, async () => void (mark('all'), await Promise.all(bs.map((b) => b.kill())))),
    ]);
    const logAt = (re: RegExp, after = 0) => {
      const l = hp.logs.find((x) => re.test(x.line) && (x.at - t0) / 1000 > after);
      return l ? (l.at - t0) / 1000 : null;
    };
    const down = logAt(/Server web\/web-2 is DOWN/);
    const up = logAt(/Server web\/web-2 is UP/, marks.revive);
    const failedChecks = hp.logs.filter((l) => /\[WARNING\].*Health check for server web\/web-2 failed/.test(l.line) && (l.at - t0) / 1000 < (down ?? 0) + 0.1).length;
    const passedChecks = hp.logs.filter(
      (l) => /\[WARNING\].*Health check for server web\/web-2 succeeded/.test(l.line) && (l.at - t0) / 1000 > marks.revive && (l.at - t0) / 1000 < (up ?? 0) + 0.1,
    ).length;
    expect(down).not.toBeNull();
    expect(up).not.toBeNull();

    const beforeDown = statusesBetween(hits, marks.crash, down! - 3.2).filter((h) => h.status !== 200);
    const afterDown = statusesBetween(hits, down! + 0.1, marks.all).filter((h) => h.status !== 200);
    const whenAllDown = statusesBetween(hits, marks.all + 0.1, 99);
    const errStatus = [...new Set(beforeDown.map((h) => h.status))];
    const waited = beforeDown.length ? Math.min(...beforeDown.map((h) => h.ms)) : 0;

    // The same scenario in the animation.
    const crash = simulate('a-server-crashes', 16);
    const simDown = crash.trace.find((e) => e.kind === 'health' && !e.inRot);
    const simCrash = crash.trace.find((e) => e.kind === 'crash');
    // Requests sent to web-2 after it died (not the ones it was already serving; see the next test)
    const sentToDead = new Set(crash.trace.filter((e) => e.kind === 'route' && e.server === 's2' && simCrash && e.t > simCrash.t).map((e) => (e.kind === 'route' ? e.req : 0)));
    const simErr = [...new Set(crash.trace.filter((e) => e.kind === 'done' && sentToDead.has(e.req)).map((e) => (e.kind === 'done' ? e.status : 0)))];
    const simLate = crash.trace.filter((e) => e.kind === 'done' && e.status !== 200 && simDown && e.t > simDown.t + 4).length;
    const refusedTries = crash.trace.filter((e) => e.kind === 'refused').length;
    const rec = simulate('recovery', 12);
    const simRevive = rec.trace.find((e) => e.kind === 'revive');
    const simUp = rec.trace.find((e) => e.kind === 'health' && e.inRot);

    const tDetect = down! - marks.crash;
    const simDetect = simDown && simCrash ? simDown.t - simCrash.t : NaN;
    const tRise = up! - marks.revive;
    const simRise = simUp && simRevive ? simUp.t - simRevive.t : NaN;

    const checks = [
      {
        title: 'What users get while the dead server is still in rotation',
        real: `${beforeDown.length} requests failed with ${errStatus.join('/') || 'nothing'}, each after about ${secs(waited)} of retries`,
        lesson_says: `${simErr.join('/') || 'no errors'} (after ${refusedTries ? 'showing the retries' : 'no retries'})`,
        pass: errStatus.length === 1 && errStatus[0] === 503 && simErr.length === 1 && simErr[0] === 503 && waited > 2500,
      },
      {
        title: 'Failed checks before the server is pulled',
        real: `${failedChecks} (DOWN ${secs(tDetect * 1000)} after the crash)`,
        lesson_says: `3 (pulled ${secs(simDetect * 1000)} after the crash)`,
        pass: failedChecks === 3 && tDetect > 3.5 && tDetect < 6.6 && simDetect > 3.5 && simDetect < 7.5,
      },
      {
        title: 'Errors once the server is out of rotation',
        real: `${afterDown.length}`,
        lesson_says: `${simLate}`,
        pass: afterDown.length === 0 && simLate === 0,
      },
      {
        title: 'Passing checks before it gets traffic again',
        real: `${passedChecks} (UP ${secs(tRise * 1000)} after the reboot)`,
        lesson_says: `2 (back ${secs(simRise * 1000)} after the reboot)`,
        pass: passedChecks === 2 && tRise < 4.5 && simRise < 5,
      },
      {
        title: 'Every server down',
        real: `${[...new Set(whenAllDown.map((h) => h.status))].join('/')}`,
        lesson_says: '503 for everyone',
        pass: whenAllDown.length > 0 && whenAllDown.every((h) => h.status === 503),
      },
    ];
    for (const c of checks) R.check({ lesson: LESSON, step: 'a-server-crashes', software: HAPROXY, ...c });
    for (const c of checks) expect(c.pass, `${c.title}: real ${c.real}; lesson ${c.lesson_says}`).toBe(true);
    R.stamp(s.code, {
      lesson: LESSON,
      by: HAPROXY,
      kind: 'ran',
      note: `Ran it on HAProxy ${haproxyVersion()} and crashed web-2: requests sent its way got 503 after 3 s of retries, it was pulled after 3 failed checks, and came back after 2 passing ones.`,
    });
  });

  test('a request in progress when its server dies', async () => {
    const { bs, addresses } = await webs(3);
    const hp = snippet(SNIPS, 'health-checks', 'haproxy.cfg');
    const rr = snippet(SNIPS, 'round-robin', 'nginx.conf');
    const portH = await freePort();
    const portN = await freePort();
    await haproxy(haproxyCfg(hp.code, { port: portH, addresses }).text, portH);
    await nginx(nginxHttp(rr.code, { port: portN, addresses, front: true }).text, portN);
    await sleep(2500);

    const midway = async (url: string) => {
      const before = bs.map((b) => b.hits);
      const pending = request(url);
      await sleep(400);
      const victim = bs.find((b, i) => b.hits > before[i])!;
      await victim.kill();
      const r = await pending;
      await victim.revive();
      return { victim: victim.name, r };
    };
    const h = await midway(`http://127.0.0.1:${portH}/slow?ms=2000`);
    const n = await midway(`http://127.0.0.1:${portN}/slow?ms=2000`);

    const inFlight = (proxy: 'haproxy' | 'nginx', step: string) => {
      // The requests web-2 is working on (or has queued) at the moment it dies
      const busy = new Set<number>();
      const run = simulate(step, 16, {
        config: { proxy, rps: 1, heavyRatio: 1, healthChecks: true },
        // Crash web-2 the first moment it is working on something.
        at: Array.from({ length: 60 }, (_, i) => ({
          t: 1 + i * 0.1,
          run: (w) => {
            const s2 = w.servers.get('s2')!;
            const jobs = [...s2.slots, ...s2.queue].filter((j) => j !== null);
            if (busy.size || !s2.up || !jobs.length) return;
            for (const j of jobs) busy.add(j.reqId);
            w.crashServer('s2');
          },
        })),
      }).trace;
      expect(busy.size).toBeGreaterThan(0);
      return [...new Set(run.filter((e) => e.kind === 'done' && busy.has(e.req)).map((e) => (e.kind === 'done' ? e.status : 0)))];
    };
    const simH = inFlight('haproxy', 'health-checks');
    const simN = inFlight('nginx', 'playground');
    const checks = [
      { software: HAPROXY, title: 'A request in progress when its server dies', real: `${h.r.status} after ${secs(h.r.ms)}`, lesson_says: simH.join('/'), pass: h.r.status === 502 && simH.join() === '502' },
      {
        software: NGINX,
        title: 'A GET in progress when its server dies',
        real: `${n.r.status}, finished by ${n.r.backend} after ${secs(n.r.ms)}`,
        lesson_says: `${simN.join('/')} (retried on another server)`,
        pass: n.r.status === 200 && n.r.backend !== n.victim && simN.join() === '200',
      },
    ];
    for (const c of checks) R.check({ lesson: LESSON, step: 'a-server-crashes', ...c });
    for (const c of checks) expect(c.pass, `${c.title}: real ${c.real}; lesson ${c.lesson_says}`).toBe(true);
  });

  test('HAProxy with option redispatch retries on another server (a-server-crashes aside)', async () => {
    const { bs, addresses } = await webs(3);
    const port = await freePort();
    const s = snippet(SNIPS, 'health-checks', 'haproxy.cfg');
    const withRedispatch = s.code.replace('    balance leastconn', '    balance leastconn\n    option redispatch');
    await haproxy(haproxyCfg(withRedispatch, { port, addresses }).text, port);
    await sleep(2500);
    await bs[1].kill();
    const rs = [];
    for (let i = 0; i < 6; i++) rs.push(await request(`http://127.0.0.1:${port}/cart`));
    const pass = rs.every((r) => r.status === 200) && Math.max(...rs.map((r) => r.ms)) < 500;
    R.check({
      lesson: LESSON,
      step: 'a-server-crashes',
      title: 'With option redispatch, a refused request goes to another server',
      software: HAPROXY,
      real: `${rs.map((r) => `${r.status} ${r.backend}`).join(', ')}; slowest ${Math.round(Math.max(...rs.map((r) => r.ms)))} ms`,
      lesson_says: 'HAProxy retries on another server too if you add option redispatch',
      pass,
    });
    expect(pass).toBe(true);
  });

  test('nginx: a crash under the playground config (playground)', async () => {
    const { bs, addresses: base } = await webs(4);
    const port = await freePort();
    const code = nginxConfig('rr', bs.map((b, i) => ({ label: b.name, ip: `10.0.1.${11 + i}`, size: 's', weight: 1, up: true })), false);
    await nginx(nginxHttp(code, { port, addresses: base }).text, port);
    const t0 = performance.now();
    const marks: Record<string, number> = {};
    const mark = (k: string) => (marks[k] = (performance.now() - t0) / 1000);
    const { hits } = await traffic(`https://127.0.0.1:${port}/cart`, 10, 17, [
      { t: 2.2, run: async () => void (mark('crash'), await bs[1].kill()) },
      { t: 14, run: async () => void (mark('all'), await Promise.all(bs.map((b) => b.kill()))) },
    ]);
    const alive = statusesBetween(hits, marks.crash, marks.all - 0.05);
    const errorsAlive = alive.filter((h) => h.status !== 200).length;
    const slowest = Math.max(...alive.map((h) => h.ms));
    const allDown = statusesBetween(hits, marks.all + 0.1, 99);

    // The animation: the playground step, web-2 crashes at 2.2 s, then all of them at 14 s.
    const sim = simulate('playground', 17, {
      config: { heavyRatio: 0 },
      at: [
        { t: 2.2, run: (w) => w.crashServer('s2') },
        { t: 14, run: (w) => ['s1', 's2', 's3', 's4'].forEach((id) => w.crashServer(id)) },
      ],
    }).trace;
    const simDone = sim.filter((e) => e.kind === 'done');
    const simAlive = simDone.filter((e) => e.t > 2.2 && e.t < 13.5);
    const simErrorsAlive = simAlive.filter((e) => e.kind === 'done' && e.status !== 200).length;
    const simAllDown = simDone.filter((e) => e.t > 16);
    const simAllDownStatus = [...new Set(simAllDown.map((e) => (e.kind === 'done' ? e.status : 0)))];

    const checks = [
      {
        title: 'One server crashes, the others are fine',
        real: `${errorsAlive} errors in ${alive.length} requests; the retry cost at most ${Math.round(slowest)} ms`,
        lesson_says: `${simErrorsAlive} errors in ${simAlive.length} requests (NGINX retries the next server)`,
        pass: errorsAlive === 0 && simErrorsAlive === 0,
      },
      {
        title: 'Every server down',
        real: [...new Set(allDown.map((h) => h.status))].join('/'),
        lesson_says: simAllDownStatus.join('/'),
        pass: allDown.length > 0 && allDown.every((h) => h.status === 502) && simAllDownStatus.join() === '502',
      },
    ];
    for (const c of checks) R.check({ lesson: LESSON, step: 'playground', software: NGINX, ...c });
    for (const c of checks) expect(c.pass, `${c.title}: real ${c.real}; lesson ${c.lesson_says}`).toBe(true);
  });

  test('nginx: a dead server is skipped for 10 seconds, then tried again', async () => {
    const { bs, addresses } = await webs(3);
    const port = await freePort();
    const rr = snippet(SNIPS, 'round-robin', 'nginx.conf');
    const ng = await nginx(nginxHttp(rr.code, { port, addresses, front: true }).text, port);
    await bs[1].kill();
    const t0 = Date.now();
    await traffic(`http://127.0.0.1:${port}/cart`, 5, 13);
    const tries = ng
      .errorLog()
      .split('\n')
      .filter((l) => /connect\(\) failed/.test(l))
      .map((l) => l.match(/^(\d{4}\/\d\d\/\d\d \d\d:\d\d:\d\d)/)?.[1])
      .filter((x): x is string => !!x)
      .map((x) => new Date(x.replace(/\//g, '-').replace(' ', 'T')).getTime());
    const gaps = tries.slice(1).map((t, i) => (t - tries[i]) / 1000);
    const pass = tries.length === 2 && gaps[0] >= 9 && gaps[0] <= 12;
    R.check({
      lesson: LESSON,
      step: 'playground',
      title: 'How often NGINX tries a dead server again',
      software: NGINX,
      real: `${tries.length} attempts in 13 s at 5 req/s, ${gaps.map((g) => `${g} s`).join(', ')} apart (the first at +${((tries[0] - t0) / 1000).toFixed(0)} s)`,
      lesson_says: 'skipped for 10 s after each refusal',
      pass,
    });
    expect(pass).toBe(true);
  });
});
