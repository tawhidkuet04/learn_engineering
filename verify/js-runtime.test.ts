/**
 * The JavaScript lessons vs. real Node.js and Chrome.
 *
 * The Event Loop lesson animates a JavaScript runtime. Each test here runs a
 * program or snippet from the lesson twice: once through the lesson's own
 * simulation (the code that draws the stage) and once for real, in headless
 * Chrome and/or fresh Node.js processes, then compares. The other lessons'
 * JavaScript snippets are run as written and compared with what their
 * comments and prose say.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { CHAPTERS as BIGO } from '@/lessons/big-o/chapters';
import { fibCalls } from '@/lessons/big-o/model';
import type { Program } from '@/lessons/event-loop/engine';
import { CHAPTERS as EL } from '@/lessons/event-loop/chapters';
import { PAGE_CODE } from '@/lessons/event-loop/Overlay';
import * as P from '@/lessons/event-loop/programs';
import { buildProgram, PG_MAX_BLOCKS, PG_MAX_LINES, PG_START, type BlockKind } from '@/lessons/event-loop/programs';
import type { ThreadMode } from '@/lessons/event-loop/thread';
import { CHAPTERS as GC } from '@/lessons/garbage-collection/chapters';
import { CHAPTERS as HT } from '@/lessons/hash-tables/chapters';
import { CHAPTERS as MQ } from '@/lessons/message-queues/chapters';
import { CHAPTERS as PT } from '@/lessons/processes-threads/chapters';
import { CHAPTERS as RC } from '@/lessons/race-conditions/chapters';
import { CHAPTERS as WS } from '@/lessons/websockets/chapters';
import { centerOf, clickAt, launchChrome, openTab, pageHtml, sleep, startSite, until, type Chrome, type Site } from './lib/jschrome';
import { fmtTally, NODE, NODE_VERSION, nodeCode, nodeRun, nodeTally } from './lib/jsnode';
import { simulateProgram, simulateThread, stepOf } from './lib/jssim';
import { accept101, closeFrame, frame, OP, parseFrames } from './lib/jsws';
import { results } from './lib/results';
import { collectSnippets, plain, snippet } from './lib/snippets';

const R = results('js-runtime');
const EVENT_LOOP = 'event-loop';

let chrome: Chrome;
let site: Site;
/** "Chrome 154": set once the browser is up */
let CHROME = 'Chrome';

beforeAll(async () => {
  [chrome, site] = await Promise.all([launchChrome(), startSite()]);
  CHROME = chrome.by;
}, 60_000);

afterAll(async () => {
  await chrome?.close();
  await site?.close();
});

const inChrome = (text: string) => `Ran it in ${CHROME}: ${text}`;
const onNode = (text: string) => `Ran it on Node ${NODE_VERSION}: ${text}`;
const same = (a: string[], b: string[]) => a.join('\n') === b.join('\n');
const uniq = <T,>(xs: T[]) => [...new Set(xs)];
const ms = (x: number) => `${Math.round(x)} ms`;

/* ================================================================== */
/* The Event Loop: the programs on the stage                           */
/* ================================================================== */

/** A page that runs one stage program as its script, with the elements the program looks for. */
function programPage(p: Program, extra = '') {
  const dir = `/el/${p.id}/`;
  site.file(dir + p.file, p.code);
  site.file(
    dir,
    pageHtml({
      body: '<button id="buy" style="width:120px;height:40px">Buy</button><div class="box" style="position:absolute;top:80px;left:0;width:20px;height:20px;background:#3c9"></div>',
      prelude: `window.__t0 = performance.now();${extra}`,
      src: p.file,
    }),
  );
  return site.url(dir);
}

async function chromeRuns(p: Program, runs: number, wait = 1500): Promise<string[][]> {
  const url = programPage(p);
  const outs: string[][] = [];
  for (let i = 0; i < runs; i++) {
    const tab = await openTab(chrome.browser, url);
    await until(() => tab.logs.length >= (p.expect?.length ?? 1), wait);
    await sleep(60); // anything printed late would show up here
    outs.push([...tab.logs]);
    await tab.close();
  }
  return outs;
}

/** Run tasks with at most `n` in flight. */
async function pool<T, U>(items: T[], n: number, fn: (x: T) => Promise<U>): Promise<U[]> {
  const out: U[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

describe('The Event Loop: the programs on the stage', () => {
  const STAGE: Program[] = [
    P.CALL_STACK,
    P.HAND_OFF,
    ...P.ZERO_ROUNDS,
    P.PROMISE_QUEUE,
    ...P.CLASSIC_ROUNDS,
    P.DRAIN,
    P.RENDER,
    P.AWAIT_SPLIT,
    P.AWAIT_FETCH,
    ...P.ASYNC_ROUNDS,
  ];
  /** Programs that don't need a page (no DOM, no relative fetch) also run in Node. */
  const NODE_OK = (p: Program) => !/document\.|requestAnimationFrame|fetch\(/.test(p.code);

  test('every program prints, in Chrome and Node, what the animation prints', async () => {
    site.route('/api/cart', (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"items":[]}');
    });
    const sims = STAGE.map((p) => simulateProgram(p));
    const real = await pool(STAGE, 5, (p) => chromeRuns(p, p === P.HAND_OFF ? 2 : 3, p === P.HAND_OFF ? 3000 : 1500));
    const node: (Record<string, number> | null)[] = [];
    for (const p of STAGE) node.push(NODE_OK(p) ? await nodeTally(p.code, 8, `${p.id}.cjs`) : null);
    const rows = STAGE.map((p, i) => {
      const sim = sims[i].out;
      const chromeOut = uniq(real[i].map((o) => o.join(' | ')));
      const nodeOut = node[i] ? Object.keys(node[i]!) : [];
      const ask = p.ask ? p.ask.choices[p.ask.answer] : null;
      const pass =
        sims[i].finished &&
        (!p.expect || same(sim, p.expect)) &&
        chromeOut.length === 1 &&
        chromeOut[0] === sim.join(' | ') &&
        (!node[i] || (nodeOut.length === 1 && nodeOut[0] === sim.join(' | '))) &&
        (!ask || ask === sim.join(' '));
      R.check({
        lesson: EVENT_LOOP,
        step: stepOf(p),
        title: `${p.file}: console output`,
        software: node[i] ? `${CHROME}, ${NODE}` : CHROME,
        real: `Chrome ×${real[i].length}: ${chromeOut.join(' / ')}${node[i] ? `; Node: ${fmtTally(node[i]!)}` : ''}`,
        lesson_says: `${sim.join(' | ')}${ask ? ` (quiz answer "${ask}")` : ''}`,
        pass,
      });
      return { p, pass, sim, chromeOut, nodeOut };
    });
    for (const r of rows) expect(r.pass, `${r.p.id}: sim ${r.sim.join(' | ')}; chrome ${r.chromeOut.join(' / ')}; node ${r.nodeOut.join(' / ')}`).toBe(true);
  });

  test('a 300 ms busy loop delays a 100 ms timer (timers-are-a-minimum)', async () => {
    const sim = simulateProgram(P.MINIMUM);
    const chromeOut: string[] = [];
    for (const run of await chromeRuns(P.MINIMUM, 4)) chromeOut.push(run.join(' | '));
    const nodeOut: string[] = [];
    for (let i = 0; i < 4; i++) nodeOut.push((await nodeCode(P.MINIMUM.code)).lines.join(' | '));
    const value = (s: string) => Number(/timer (\d+)/.exec(s)?.[1]);
    const all = [...chromeOut, ...nodeOut];
    const ok = (s: string) => s.startsWith('loop done | timer ') && value(s) >= 300 && value(s) <= 320;
    const pass = all.every(ok) && sim.out.join(' | ') === 'loop done | timer 300';
    R.check({
      lesson: EVENT_LOOP,
      step: 'timers-are-a-minimum',
      title: 'What late.js prints after the 300 ms busy loop',
      software: `${CHROME}, ${NODE}`,
      real: `Chrome: ${uniq(chromeOut.map(value)).join(', ')}; Node: ${uniq(nodeOut.map(value)).join(', ')} (always after "loop done")`,
      lesson_says: `the animation prints "${sim.out.join('", "')}"; the text says timer 300 or a few ms more, never timer 100`,
      pass,
    });
    expect(pass, all.join('\n')).toBe(true);

    // The quiz: a click 50 ms into the busy loop runs only once the loop is done.
    site.file(
      '/el/quiz/',
      `<!doctype html><button id="run" style="width:100px;height:40px">run</button><button id="buy" style="width:100px;height:40px">buy</button><script>
      window.ev = [];
      document.querySelector('#buy').addEventListener('click', () => ev.push(['click', performance.now() - window.t0]));
      document.querySelector('#run').addEventListener('click', () => {
        window.t0 = performance.now();
        const start = Date.now();
        setTimeout(() => ev.push(['timer', performance.now() - window.t0]), 100);
        while (Date.now() - start < 300) {}
        ev.push(['loop done', performance.now() - window.t0]);
      });</script>`,
    );
    const tab = await openTab(chrome.browser, site.url('/el/quiz/'));
    const run = await centerOf(tab.page, '#run');
    const buy = await centerOf(tab.page, '#buy');
    await clickAt(tab.page, run);
    await sleep(50);
    await clickAt(tab.page, buy);
    await until(() => tab.page.evaluate(() => (window as unknown as { ev: unknown[] }).ev.length >= 3), 3000);
    const ev = (await tab.page.evaluate(() => (window as unknown as { ev: [string, number][] }).ev)) as [string, number][];
    await tab.close();
    const click = ev.find((e) => e[0] === 'click');
    const done = ev.find((e) => e[0] === 'loop done');
    const quiz = !!click && !!done && ev.indexOf(click) > ev.indexOf(done) && click[1] >= 300;
    R.check({
      lesson: EVENT_LOOP,
      step: 'timers-are-a-minimum',
      title: 'Quiz: a click 50 ms into the busy loop',
      software: CHROME,
      real: ev.map(([k, t]) => `${k} at ${ms(t)}`).join(', '),
      lesson_says: 'the handler runs after the loop ends',
      pass: quiz,
    });
    expect(quiz).toBe(true);
  });
});

/* ================================================================== */
/* Rendering and input                                                 */
/* ================================================================== */

describe('The Event Loop: rendering and input', () => {
  test('requestAnimationFrame runs once per frame; the timer usually beats the first frame (where-rendering-fits)', async () => {
    const sim = simulateProgram(P.RENDER);
    const simOrder = sim.events.join(', ');
    // Log each rAF callback and where the box is, without changing the program.
    const spy = `window.__o=[];const __raf=window.requestAnimationFrame.bind(window);window.requestAnimationFrame=(cb)=>__raf((t)=>{cb(t);__o.push('frame:'+document.querySelector('.box').style.left)});const __log=console.log;console.log=(...a)=>{__o.push(a.join(' '));__log(...a)};`;
    const atLoad = programPage(P.RENDER, spy);
    // The same program run from a click handler instead of at page load.
    site.file(
      '/el/render-click/',
      pageHtml({
        body: '<button id="buy" style="width:120px;height:40px">Buy</button><div class="box" style="position:absolute;top:80px;left:0;width:20px;height:20px;background:#3c9"></div>',
        prelude: `${spy}document.querySelector('#buy').addEventListener('click', () => (0, eval)(${JSON.stringify(P.RENDER.code)}));`,
        src: 'none.js',
      }),
    );
    site.file('/el/render-click/none.js', '');
    // One tab at a time: a headless tab in the background doesn't render at all.
    const order = async (url: string, click: boolean) => {
      const tab = await openTab(chrome.browser, url);
      if (click) {
        await sleep(100);
        await clickAt(tab.page, await centerOf(tab.page, '#buy'));
      }
      await until(() => tab.page.evaluate(() => (window as unknown as { __o: string[] }).__o.length >= 4), 1500);
      const o = (await tab.page.evaluate(() => (window as unknown as { __o: string[] }).__o)) as string[];
      await tab.close();
      return o.join(', ');
    };
    const loads: string[] = [];
    for (let i = 0; i < 10; i++) loads.push(await order(atLoad, false));
    const clicks: string[] = [];
    for (let i = 0; i < 6; i++) clicks.push(await order(site.url('/el/render-click/'), true));
    const tallyOf = (xs: string[]) => {
      const t: Record<string, number> = {};
      for (const x of xs) t[x] = (t[x] ?? 0) + 1;
      return t;
    };
    const taskFirst = loads.filter((r) => r.startsWith('task')).length;
    const frameFirst = clicks.filter((r) => r.startsWith('frame')).length;
    const boxOk = [...loads, ...clicks].every((r) => r.replace('task, ', '').replace(', task', '') === 'frame:50px, frame:100px, frame:150px');

    // Frame cadence
    site.file('/el/cadence/', `<!doctype html><script>window.ts=[];(function f(t){ts.push(t);if(ts.length<40)requestAnimationFrame(f)})(performance.now())</script>`);
    const tab = await openTab(chrome.browser, site.url('/el/cadence/'));
    await until(() => tab.page.evaluate(() => (window as unknown as { ts: number[] }).ts.length >= 40), 2000);
    const ts = (await tab.page.evaluate(() => (window as unknown as { ts: number[] }).ts)) as number[];
    await tab.close();
    const gaps = ts.slice(2).map((t, i) => t - ts[i + 1]);
    const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;

    const pass =
      sim.out.join() === 'task' && sim.frames === 3 && simOrder === 'task, frame, frame, frame' && boxOk && taskFirst >= 8 && frameFirst >= 5 && Math.abs(avg - 1000 / 60) < 0.5;
    R.check({
      lesson: EVENT_LOOP,
      step: 'where-rendering-fits',
      title: 'animate.js (stage): three rAF frames move the box 50 px each; the timer vs the first frame',
      software: CHROME,
      real: `at page load: ${fmtTally(tallyOf(loads))}; from a click handler: ${fmtTally(tallyOf(clicks))}; rAF every ${avg.toFixed(2)} ms`,
      lesson_says: `animation: ${simOrder}, ${sim.frames} frames painted; aside: the timer usually runs first, but from a click handler Chrome paints the frame first`,
      pass,
    });
    expect(pass, JSON.stringify({ loads, clicks, simOrder, avg })).toBe(true);
  });

  test('clicks are tasks, and Chrome runs a waiting click before an expired timer (every-click-is-a-task)', async () => {
    // Real: three quick clicks, then hold the main thread across the moment the
    // 3 s interval is due and click during the hold.
    const url = programPage(P.CLICKS);
    const tab = await openTab(chrome.browser, url);
    const at = await centerOf(tab.page, '#buy');
    for (let i = 0; i < 3; i++) await clickAt(tab.page, at);
    await until(() => tab.logs.length >= 3, 1500);
    const quick = [...tab.logs];
    const now = (await tab.page.evaluate(() => {
      const w = window as unknown as { __t0: number };
      setTimeout(
        () => {
          const s = performance.now();
          while (performance.now() - s < 500) {}
        },
        w.__t0 + 2800 - performance.now(),
      );
      return performance.now() - w.__t0;
    })) as number;
    await sleep(3150 - now);
    await clickAt(tab.page, at);
    await until(() => tab.logs.includes('tick'), 3000);
    await sleep(100);
    const later = tab.logs.slice(3);
    await tab.close();

    // The animation: three quick clicks, then a click while the tick waits in the queue.
    let phase = 0;
    const sim = simulateProgram(P.CLICKS, {
      seconds: 120,
      keepGoing: true,
      each: (s) => {
        const m = s.m;
        if (phase === 0 && m.hasListener() && !m.busy) {
          s.clickBuy();
          s.clickBuy();
          s.clickBuy();
          phase = 1;
        } else if (phase === 1 && m.queues.task.some((j) => j.icon === 'timer')) {
          s.clickBuy();
          phase = 2;
        } else if (phase === 2 && m.out.some((o) => o.text === 'tick')) return true;
      },
    });
    const pass = same(quick, ['click 1', 'click 2', 'click 3']) && same(later.slice(0, 2), ['click 4', 'tick']) && same(sim.out, ['click 1', 'click 2', 'click 3', 'click 4', 'tick']);
    R.check({
      lesson: EVENT_LOOP,
      step: 'every-click-is-a-task',
      title: 'A click that arrives while the tick waits runs first',
      software: CHROME,
      real: `quick clicks: ${quick.join(', ')}; tick came due during a busy 500 ms, a click arrived after it: ${later.join(', ')}`,
      lesson_says: sim.out.join(', '),
      pass,
    });
    expect(pass, JSON.stringify({ quick, later, sim: sim.out })).toBe(true);
  });
});

/* ================================================================== */
/* Blocking the loop: the stage's page code, and the snippets          */
/* ================================================================== */

const SHARED_PRELUDE = `
window.__n = 0; window.__clicks = []; window.__frames = []; window.__long = [];
const orders = Array.from({ length: 3000 }, (_, i) => ({ id: i }));
function process(order) { const t = performance.now(); while (performance.now() - t < 0.5) {} if (++window.__n === orders.length) window.__t1 = performance.now(); return order.id; }
const processBtn = document.querySelector('#process');
const cartBtn = document.querySelector('#cart');
const status = document.querySelector('#status');
const bar = document.querySelector('#bar');
function addToCart(e) { window.__clicks.push(performance.now() - e.timeStamp); }
new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push(e.duration); }).observe({ type: 'longtask' });
(function spin() { window.__frames.push(performance.now()); requestAnimationFrame(spin); })();
processBtn.addEventListener('click', () => { window.__t0 = performance.now(); });
new MutationObserver(() => { if (status.textContent === 'Done' && !window.__t1) window.__t1 = performance.now(); }).observe(status, { childList: true, characterData: true, subtree: true });
`;
const PAGE_BODY =
  '<button id="process" style="width:160px;height:36px">Process orders</button> <progress id="bar"></progress> <span id="status">Ready</span><br><button id="cart" style="width:160px;height:36px">Add to cart</button>';
/** Progress every ~150 ms, then done: what the stage's worker lane models. */
const STAGE_WORKER = `function process(order) { const t = performance.now(); while (performance.now() - t < 0.5) {} return order.id; }
onmessage = (e) => { let last = performance.now(); e.data.forEach((o, i) => { process(o); if (performance.now() - last > 150) { postMessage({ progress: i / e.data.length }); last = performance.now(); } }); postMessage({ done: true }); };`;

interface PageRun {
  job: number;
  painted: number;
  slots: number;
  longest: number;
  delays: number[];
  extra: unknown;
}

/**
 * Load a page, press Process at 0 (unless the script starts the work itself),
 * click Add to cart at 450, 850 and 1250 ms, like the lesson's demo, and
 * measure what the main thread did.
 */
async function blockingRun(dir: string, code: string, o: { worker?: string; press?: boolean; postlude?: string; extra?: string } = {}): Promise<PageRun> {
  site.file(`${dir}page.js`, code);
  if (o.worker) site.file(`${dir}orders-worker.js`, o.worker);
  site.file(dir, pageHtml({ body: PAGE_BODY, prelude: SHARED_PRELUDE, src: 'page.js', postlude: o.postlude }));
  const tab = await openTab(chrome.browser, site.url(dir));
  await sleep(300);
  const cart = await centerOf(tab.page, '#cart');
  const proc = await centerOf(tab.page, '#process');
  const T = Date.now();
  if (o.press !== false) await clickAt(tab.page, proc);
  for (const d of [450, 850, 1250]) {
    await sleep(d - (Date.now() - T));
    await clickAt(tab.page, cart);
  }
  const done = await until(() => tab.page.evaluate(() => !!(window as unknown as { __t1?: number }).__t1), 6000, 50);
  await sleep(150);
  const r = (await tab.page.evaluate((extra) => {
    const w = window as unknown as { __t0: number; __t1: number; __frames: number[]; __long: number[]; __clicks: number[] };
    const fr = w.__frames.filter((t) => t > w.__t0 && t < w.__t1);
    return {
      job: w.__t1 - w.__t0,
      painted: fr.length,
      slots: Math.round((w.__t1 - w.__t0) / (1000 / 60)),
      longest: Math.max(0, ...w.__long),
      delays: w.__clicks,
      extra: extra ? (0, eval)(extra) : null,
    };
  }, o.extra ?? '')) as PageRun;
  await tab.close();
  if (!done) throw new Error(`${dir}: the work never finished`);
  return r;
}

const fmtRun = (r: { job: number; painted: number; slots: number; longest: number; delays: number[] }, real = true) =>
  `work ${ms(r.job)}, ${r.painted}/${r.slots} frames painted, ${real && r.longest === 0 ? 'no task over 50 ms' : `longest task ${ms(r.longest)}`}, clicks waited ${r.delays.map((d) => Math.round(d)).join('/')} ms`;

describe('The Event Loop: blocking the loop', () => {
  const EL_SNIPS = collectSnippets(EL);
  const DEMO = { start: 300, clicks: [450, 850, 1250], until: 4500 };
  const MODE_STEP: Record<ThreadMode, string> = { long: 'a-long-task', chunk: 'break-it-up', micro: 'microtasks-cant-yield', worker: 'web-workers' };
  const real: Partial<Record<ThreadMode, PageRun>> = {};

  test('the stage page code, run for real, matches the timeline for every strategy', async () => {
    for (const mode of ['long', 'chunk', 'micro', 'worker'] as ThreadMode[]) {
      let code = PAGE_CODE[mode].code;
      if (!code.includes('addToCart')) code += `\ncartBtn.addEventListener('click', addToCart);`;
      real[mode] = await blockingRun(`/blk/stage-${mode}/`, code, { worker: mode === 'worker' ? STAGE_WORKER : undefined });
    }
    const sim = Object.fromEntries((['long', 'chunk', 'micro', 'worker'] as ThreadMode[]).map((m) => [m, simulateThread(m, DEMO)])) as Record<ThreadMode, ReturnType<typeof simulateThread>>;
    const frozen = (r: { painted: number; slots: number }) => r.painted <= 3;
    const smooth = (r: { painted: number; slots: number }) => r.painted >= 0.9 * r.slots;
    const quick = (r: { delays: number[] }) => r.delays.length === 3 && Math.max(...r.delays) < 50;
    const near = (a: number[], b: number[], tol: number) => a.length === b.length && a.every((x, i) => Math.abs(x - b[i]) <= tol);
    const rules: Record<ThreadMode, (r: PageRun | ReturnType<typeof simulateThread>) => boolean> = {
      long: (r) => frozen(r) && r.longest > 1400,
      micro: (r) => frozen(r) && r.longest > 1400,
      chunk: (r) => smooth(r) && r.longest < 50 && quick(r),
      worker: (r) => smooth(r) && r.longest < 50 && quick(r),
    };
    const checks = (['long', 'chunk', 'micro', 'worker'] as ThreadMode[]).map((mode) => {
      const r = real[mode]!;
      const s = sim[mode];
      const waits = mode === 'long' || mode === 'micro' ? near(r.delays, s.delays, 60) : true;
      const pass = rules[mode](r) && rules[mode](s) && waits && Math.abs(r.job - s.job) / s.job < 0.1;
      R.check({ lesson: EVENT_LOOP, step: MODE_STEP[mode], title: `The "${mode}" strategy: frames, longest task, click delay`, software: CHROME, real: fmtRun(r), lesson_says: fmtRun(s, false), pass });
      return { mode, pass, r, s };
    });
    for (const c of checks) expect(c.pass, `${c.mode}: real ${fmtRun(c.r)}; sim ${fmtRun(c.s, false)}`).toBe(true);

    // "it even takes about a third longer"
    const ratio = { real: real.chunk!.job / real.long!.job, sim: sim.chunk.job / sim.long.job };
    const slower = ratio.real > 1.2 && ratio.real < 1.5 && ratio.sim > 1.2 && ratio.sim < 1.5;
    R.check({
      lesson: EVENT_LOOP,
      step: 'break-it-up',
      title: 'Chunks with setTimeout take longer than one long task',
      software: CHROME,
      real: `${ms(real.chunk!.job)} vs ${ms(real.long!.job)} (×${ratio.real.toFixed(2)})`,
      lesson_says: `about a third longer; the timeline shows ×${ratio.sim.toFixed(2)}`,
      pass: slower,
    });
    expect(slower).toBe(true);

    // yield.js holds the exact lines the stage's micro and chunk code yield with.
    const y = snippet(EL_SNIPS, 'microtasks-cant-yield', 'yield.js');
    const lines = plain(y.code)
      .split('\n')
      .filter((l) => l.startsWith('await'));
    const usesLines = PAGE_CODE.micro.code.includes(lines[0]) && PAGE_CODE.chunk.code.includes(lines[1]);
    const yieldPass = usesLines && frozen(real.micro!) && smooth(real.chunk!) && quick(real.chunk!) && !quick(real.micro!);
    R.check({
      lesson: EVENT_LOOP,
      step: 'microtasks-cant-yield',
      title: 'yield.js: a microtask yield vs a task yield between 12 ms chunks',
      software: CHROME,
      real: `${lines[0]} → ${real.micro!.painted} frames, clicks waited up to ${ms(Math.max(...real.micro!.delays))}; ${lines[1]} → ${real.chunk!.painted}/${real.chunk!.slots} frames, clicks within ${ms(Math.max(...real.chunk!.delays))}`,
      lesson_says: 'a microtask: no frame, no click in between; a task: the loop gets a turn',
      pass: yieldPass,
    });
    expect(yieldPass).toBe(true);
    R.stamp(y.code, { lesson: EVENT_LOOP, by: CHROME, kind: 'ran', note: inChrome('between 12 ms chunks of work, await Promise.resolve() let no frame paint and no click in until the end; the setTimeout version painted every frame and handled clicks within milliseconds.') });
  });

  test('a timer, a message and scheduler.yield() are all task boundaries (microtasks-cant-yield)', async () => {
    // The stage's chunk code, yielding through a MessageChannel message instead of a timer.
    const timerYield = 'await new Promise((r) => setTimeout(r));';
    expect(PAGE_CODE.chunk.code).toContain(timerYield);
    const code = `${PAGE_CODE.chunk.code.replace(timerYield, 'await new Promise((r) => { const c = new MessageChannel(); c.port1.onmessage = r; c.port2.postMessage(0); });')}\ncartBtn.addEventListener('click', addToCart);`;
    const r = await blockingRun('/blk/message/', code);
    const chunk = real.chunk!;
    const pass = r.painted >= 0.9 * r.slots && r.longest < 50 && Math.max(...r.delays) < 50 && chunk.painted >= 0.9 * chunk.slots && Math.max(...chunk.delays) < 50;
    R.check({
      lesson: EVENT_LOOP,
      step: 'microtasks-cant-yield',
      title: 'Yielding with a message instead of a timer',
      software: CHROME,
      real: `MessageChannel: ${fmtRun(r)}; setTimeout: ${fmtRun(chunk)}`,
      lesson_says: 'a real task boundary (a timer, a message, or scheduler.yield()) gives rendering and input a turn',
      pass,
    });
    expect(pass, fmtRun(r)).toBe(true);
  });

  test('orders.js: 3,000 orders in one click handler (a-long-task)', async () => {
    const s = snippet(EL_SNIPS, 'a-long-task', 'orders.js');
    const r = await blockingRun('/blk/long-snippet/', `${plain(s.code)}\ncartBtn.addEventListener('click', addToCart);`);
    const pass = r.longest > 1400 && r.longest < 1800 && r.painted <= 3 && r.delays.length === 3 && Math.min(...r.delays) > 150;
    R.check({ lesson: EVENT_LOOP, step: 'a-long-task', title: 'orders.js runs as one long task', software: CHROME, real: fmtRun(r), lesson_says: '3,000 × 0.5 ms = 1.5 s in one task: no frames, clicks wait', pass });
    expect(pass, fmtRun(r)).toBe(true);
    R.stamp(s.code, { lesson: EVENT_LOOP, by: CHROME, kind: 'ran', note: inChrome('with 3,000 orders at 0.5 ms each it ran as one long task. No frame was painted and no click was handled until it ended.') });
  });

  test('orders.js: processAll with yieldToLoop (break-it-up)', async () => {
    const s = snippet(EL_SNIPS, 'break-it-up', 'orders.js');
    const r = await blockingRun('/blk/yield-snippet/', `${plain(s.code)}\nprocessBtn.addEventListener('click', () => processAll(orders));\ncartBtn.addEventListener('click', addToCart);`, {
      extra: 'typeof scheduler !== "undefined" && typeof scheduler.yield',
    });
    const chunk = real.chunk!;
    const usedYield = r.extra === 'function';
    // Claims: front of the queue (checked below), clicks still get in, finishes sooner, but fewer frames.
    const pass = usedYield && r.longest < 50 && Math.max(...r.delays) < 50 && r.job < chunk.job * 0.85 && r.painted / r.slots < chunk.painted / chunk.slots - 0.2;

    site.file(
      '/blk/front/',
      `<!doctype html><script>window.o=[];(async()=>{await new Promise(r=>setTimeout(r,20));setTimeout(()=>o.push('setTimeout queued first'),0);await scheduler.yield();o.push('scheduler.yield continuation');setTimeout(()=>o.push('setTimeout queued first'),0);await new Promise(r=>setTimeout(r,0));o.push('setTimeout continuation')})()</script>`,
    );
    const tab = await openTab(chrome.browser, site.url('/blk/front/'));
    await until(() => tab.page.evaluate(() => (window as unknown as { o: string[] }).o.length >= 4), 1000);
    const order = (await tab.page.evaluate(() => (window as unknown as { o: string[] }).o)) as string[];
    await tab.close();
    const front = same(order, ['scheduler.yield continuation', 'setTimeout queued first', 'setTimeout queued first', 'setTimeout continuation']);

    R.check({
      lesson: EVENT_LOOP,
      step: 'break-it-up',
      title: 'scheduler.yield(): front of the queue, clicks fast, fewer frames',
      software: CHROME,
      real: `${fmtRun(r)}; setTimeout chunks: ${chunk.painted}/${chunk.slots} frames in ${ms(chunk.job)}; order: ${order.join(' → ')}`,
      lesson_says: 'continuation goes to the front; clicks still get in and the work finishes sooner, but frames are painted less often',
      pass: pass && front,
    });
    expect(pass && front, `${fmtRun(r)} | ${order.join(', ')}`).toBe(true);
    R.stamp(s.code, {
      lesson: EVENT_LOOP,
      by: CHROME,
      kind: 'ran',
      note: inChrome('it took the scheduler.yield() path. No task passed 50 ms and clicks were handled within milliseconds, but fewer frames were painted than with setTimeout chunks.'),
    });
  });

  test('main.js + orders-worker.js: the work moves off the main thread (web-workers)', async () => {
    const s = snippet(EL_SNIPS, 'web-workers', 'main.js + orders-worker.js');
    const [main, worker] = plain(s.code).split('// orders-worker.js');
    const r = await blockingRun(
      '/blk/worker-snippet/',
      `window.__t0 = performance.now();\nfunction show(data) { window.__result = data; window.__t1 = performance.now(); }\ncartBtn.addEventListener('click', addToCart);\n${main}\norders[0].id = -1; // after posting: the worker has its own copy`,
      {
        press: false,
        worker: `function process(order) { const t = performance.now(); while (performance.now() - t < 0.5) {} return order.id; }\n${worker}`,
        extra: 'JSON.stringify({ first: window.__result[0], n: window.__result.length })',
      },
    );
    const got = JSON.parse(r.extra as string) as { first: number; n: number };
    site.file('/blk/dom-worker.js', `postMessage(typeof document);`);
    site.file('/blk/dom/', `<!doctype html><script>new Worker('/blk/dom-worker.js').onmessage = (e) => { window.doc = e.data; };</script>`);
    const tab = await openTab(chrome.browser, site.url('/blk/dom/'));
    await until(() => tab.page.evaluate(() => !!(window as unknown as { doc?: string }).doc), 2000);
    const doc = await tab.page.evaluate(() => (window as unknown as { doc?: string }).doc);
    await tab.close();
    const pass = r.painted >= 0.9 * r.slots && r.longest < 50 && Math.max(...r.delays) < 50 && got.n === 3000 && got.first === 0 && doc === 'undefined';
    R.check({
      lesson: EVENT_LOOP,
      step: 'web-workers',
      title: 'A worker crunches 3,000 orders; the main thread stays free',
      software: CHROME,
      real: `${fmtRun(r)}; result had ${got.n} items, first ${got.first} although main set orders[0].id = -1 after posting; typeof document in a worker: ${doc}`,
      lesson_says: 'frames keep painting, clicks handled instantly, data is copied, workers have no DOM',
      pass,
    });
    expect(pass, fmtRun(r)).toBe(true);
    R.stamp(s.code, { lesson: EVENT_LOOP, by: CHROME, kind: 'ran', note: inChrome('with 3,000 orders at 0.5 ms each, frames kept painting and clicks stayed instant while the worker worked, and the worker got its own copy of the orders.') });
  });

  test('during a long task, CSS transform and opacity animations keep moving, a JS-driven one freezes (a-long-task aside)', async () => {
    site.file(
      '/blk/css/',
      `<!doctype html><style>
@keyframes slide { from { transform: translateX(0) } to { transform: translateX(300px) } }
@keyframes fade { from { opacity: 1 } to { opacity: 0.1 } }
body { margin: 0; background: #fff }
#css { position: absolute; top: 10px; left: 0; width: 20px; height: 20px; background: rgb(255, 0, 0); animation: slide 1s linear infinite }
#fade { position: absolute; top: 90px; left: 20px; width: 20px; height: 20px; background: rgb(0, 160, 0); animation: fade 0.7s linear infinite alternate }
#js { position: absolute; top: 50px; left: 0; width: 20px; height: 20px; background: rgb(0, 0, 255) }
</style><div id="css"></div><div id="js"></div><div id="fade"></div><script>
const js = document.querySelector('#js');
(function f(t) { js.style.transform = 'translateX(' + ((t / 1000) * 300) % 300 + 'px)'; requestAnimationFrame(f); })(0);
window.block = () => setTimeout(() => { const s = performance.now(); while (performance.now() - s < 1500) {} }, 0);
</script>`,
    );
    const tab = await openTab(chrome.browser);
    await tab.page.setViewport({ width: 400, height: 120 });
    await tab.page.goto(site.url('/blk/css/'));
    await sleep(300);
    // A screencast receives frames straight from the compositor (a screenshot would wait for the main thread).
    const cdp = await tab.page.createCDPSession();
    const frames: { t: number; data: string }[] = [];
    cdp.on('Page.screencastFrame', (f) => {
      frames.push({ t: f.metadata.timestamp ?? 0, data: f.data });
      void cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
    });
    await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
    await sleep(300);
    const t0 = Date.now() / 1000;
    await tab.page.evaluate(() => (window as unknown as { block: () => void }).block());
    await sleep(1450);
    await cdp.send('Page.stopScreencast');
    const during = frames.filter((f) => f.t > t0 + 0.1 && f.t < t0 + 1.4);
    const sample = during.filter((_, i) => i % Math.max(1, Math.floor(during.length / 12)) === 0);
    const decoder = await openTab(chrome.browser, 'about:blank');
    const seen = (await decoder.page.evaluate(async (list: string[]) => {
      const out: { css: number; js: number; fade: number }[] = [];
      for (const b64 of list) {
        const img = new Image();
        img.src = `data:image/png;base64,${b64}`;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        const g = c.getContext('2d')!;
        g.drawImage(img, 0, 0);
        const row = (y: number) => g.getImageData(0, y, c.width, 1).data;
        const xOf = (y: number, hit: (r: number, gg: number, b: number) => boolean) => {
          const d = row(y);
          for (let x = 0; x < c.width; x++) if (hit(d[4 * x], d[4 * x + 1], d[4 * x + 2])) return x;
          return -1;
        };
        out.push({ css: xOf(20, (r, gg, b) => r > 200 && gg < 80 && b < 80), js: xOf(60, (r, gg, b) => b > 200 && r < 80 && gg < 80), fade: row(100)[4 * 30] });
      }
      return out;
    }, sample.map((f) => f.data))) as { css: number; js: number; fade: number }[];
    await decoder.close();
    await tab.close();
    const distinct = (k: 'css' | 'js' | 'fade') => uniq(seen.map((x) => x[k])).length;
    const pass = during.length > 30 && distinct('css') >= 5 && distinct('fade') >= 3 && distinct('js') === 1;
    R.check({
      lesson: EVENT_LOOP,
      step: 'a-long-task',
      title: 'Compositor animations during a 1.5 s long task',
      software: CHROME,
      real: `${during.length} frames reached the screen during the task; in ${seen.length} of them the CSS transform box was at ${distinct('css')} different places and the CSS opacity box had ${distinct('fade')} shades, the rAF-driven box at ${distinct('js')}`,
      lesson_says: 'CSS animations of transform and opacity can keep running on the compositor thread; anything your code renders needs the main thread',
      pass,
    });
    expect(pass, JSON.stringify({ n: during.length, seen })).toBe(true);
  });

  test('Chrome counts tasks over 50 ms as long tasks (a-long-task aside)', async () => {
    site.file(
      '/blk/lt/',
      `<!doctype html><script>window.lt=[];new PerformanceObserver((l)=>{for(const e of l.getEntries())lt.push(Math.round(e.duration))}).observe({type:'longtask'});const busy=(n)=>{const s=performance.now();while(performance.now()-s<n){}};setTimeout(()=>busy(40),50);setTimeout(()=>busy(47),150);setTimeout(()=>busy(55),250);setTimeout(()=>busy(70),350);</script>`,
    );
    const tab = await openTab(chrome.browser, site.url('/blk/lt/'));
    await sleep(700);
    const lt = (await tab.page.evaluate(() => (window as unknown as { lt: number[] }).lt)) as number[];
    await tab.close();
    const pass = lt.length === 2 && lt.every((d) => d > 50);
    R.check({ lesson: EVENT_LOOP, step: 'a-long-task', title: 'Which tasks Chrome reports as long tasks', software: CHROME, real: `tasks of 40, 47, 55, 70 ms → long tasks reported: ${lt.join(', ')} ms`, lesson_says: 'any task over 50 ms', pass });
    expect(pass, lt.join()).toBe(true);
  });
});

/* ================================================================== */
/* The Event Loop's code snippets                                      */
/* ================================================================== */

describe('The Event Loop: code snippets', () => {
  const EL_SNIPS = collectSnippets(EL);

  test('DevTools console: the stack trace of greet.js (call-stack)', async () => {
    const s = snippet(EL_SNIPS, 'call-stack', 'DevTools console');
    // The stage's greet.js, with greet() throwing on line 2 instead of returning.
    const code = P.CALL_STACK.code.replace("  return 'Hi, ' + name;", "  throw new Error('out of greetings');");
    expect(code).not.toBe(P.CALL_STACK.code);
    site.file('/el/stack/greet.js', code);
    site.file('/el/stack/', pageHtml({ src: 'greet.js' }));
    const tab = await openTab(chrome.browser);
    const cdp = await tab.page.createCDPSession();
    await cdp.send('Runtime.enable');
    const thrown = new Promise<{ text: string; exception?: { description?: string } }>((resolve) => cdp.on('Runtime.exceptionThrown', (e) => resolve(e.exceptionDetails)));
    await tab.page.goto(site.url('/el/stack/'));
    const d = await thrown;
    await tab.close();
    const shown = `${d.text} ${d.exception?.description ?? ''}`.replaceAll(site.url('/el/stack/'), '');
    const pass = shown === plain(s.code);
    R.check({ lesson: EVENT_LOOP, step: 'call-stack', title: 'The stack trace DevTools shows', software: CHROME, real: shown, lesson_says: plain(s.code), pass });
    expect(shown).toBe(plain(s.code));
    R.stamp(s.code, { lesson: EVENT_LOOP, by: CHROME, kind: 'ran', note: inChrome("made the stage's greet() throw on line 2, and DevTools reported exactly this stack, top frame first.") });
  });

  test('timers.js: setTimeout returns an id at once, clearTimeout cancels it (hand-it-off)', async () => {
    const s = snippet(EL_SNIPS, 'hand-it-off', 'timers.js');
    site.file('/el/timers/timers.js', plain(s.code));
    site.file(
      '/el/timers/',
      pageHtml({ prelude: 'window.sent = false; function sendEmail() { window.sent = true; } window.__t = performance.now();', src: 'timers.js', postlude: 'window.r = { took: performance.now() - window.__t, id };' }),
    );
    const tab = await openTab(chrome.browser, site.url('/el/timers/'));
    await sleep(1300);
    const r = (await tab.page.evaluate(() => ({ ...(window as unknown as { r: { took: number; id: unknown } }).r, sent: (window as unknown as { sent: boolean }).sent }))) as { took: number; id: unknown; sent: boolean };
    await tab.close();
    const pass = Number.isInteger(r.id) && (r.id as number) > 0 && r.took < 5 && r.sent === false;
    R.check({ lesson: EVENT_LOOP, step: 'hand-it-off', title: 'setTimeout returns at once with an id; clearTimeout cancels', software: CHROME, real: `id ${r.id}, both lines took ${r.took.toFixed(2)} ms; after 1.3 s sendEmail ran: ${r.sent}`, lesson_says: 'returns at once, with an id; cancelled before it fires', pass });
    expect(pass, JSON.stringify(r)).toBe(true);
    R.stamp(s.code, { lesson: EVENT_LOOP, by: CHROME, kind: 'ran', note: inChrome('setTimeout returned a numeric id straight away, and after clearTimeout, sendEmail never ran.') });
  });

  test('focus.js: a 0 ms timer runs after the current code; nested timers clamp to 4 ms (zero-is-not-now)', async () => {
    const s = snippet(EL_SNIPS, 'zero-is-not-now', 'focus.js');
    site.file('/el/focus/focus.js', plain(s.code));
    site.file(
      '/el/focus/',
      pageHtml({
        body: '<input id="q">',
        prelude: "const input = document.querySelector('#q'); window.seen = [];",
        src: 'focus.js',
        // The chain starts from a message event, a task that isn't a timer, once the page has settled.
        postlude: `seen.push(document.activeElement === input); setTimeout(() => seen.push(document.activeElement === input), 20);
        window.d = []; let last = 0; function f() { const now = performance.now(); d.push(now - last); last = now; if (d.length < 12) setTimeout(f, 0); }
        setTimeout(() => { const ch = new MessageChannel(); ch.port1.onmessage = () => { last = performance.now(); setTimeout(f, 0); }; ch.port2.postMessage(0); }, 150);`,
      }),
    );
    const tab = await openTab(chrome.browser, site.url('/el/focus/'));
    await sleep(500);
    const r = (await tab.page.evaluate(() => ({ seen: (window as unknown as { seen: boolean[] }).seen, d: (window as unknown as { d: number[] }).d }))) as { seen: boolean[]; d: number[] };
    await tab.close();
    const unclamped = r.d.slice(0, 6).every((x) => x < 3);
    const clamped = r.d.slice(6).every((x) => x >= 4);
    const pass = same(r.seen.map(String), ['false', 'true']) && unclamped && clamped;
    R.check({
      lesson: EVENT_LOOP,
      step: 'zero-is-not-now',
      title: 'Focus waits for the script; the 4 ms clamp after 5 levels of nesting',
      software: CHROME,
      real: `focused during the script: ${r.seen[0]}, after: ${r.seen[1]}; chained setTimeout(…, 0) delays: ${r.d.map((x) => x.toFixed(1)).join(', ')} ms`,
      lesson_says: 'after the current code is done; after 5 levels of nesting the minimum becomes 4 ms',
      pass,
    });
    expect(pass, JSON.stringify(r)).toBe(true);
    R.stamp(s.code, { lesson: EVENT_LOOP, by: CHROME, kind: 'ran', note: inChrome('the input got focus only after the script had finished. Chained setTimeout(…, 0) calls ran at once 6 times (the first, then 5 levels of nesting), then waited at least 4 ms each.') });
  });

  test('cart.js: a real click runs the handler as a task, on an empty stack (every-click-is-a-task)', async () => {
    const s = snippet(EL_SNIPS, 'every-click-is-a-task', 'cart.js');
    site.file('/el/cart-click/cart.js', plain(s.code));
    site.file(
      '/el/cart-click/',
      pageHtml({
        body: '<button id="b" data-sku="A-42" style="width:120px;height:40px">Buy</button>',
        prelude: "const button = document.querySelector('#b'); window.got = []; function addToCart(sku) { got.push({ sku, frames: new Error().stack.split('\\n').slice(1).map((l) => l.trim().split(' ')[1]) }); }",
        src: 'cart.js',
      }),
    );
    const tab = await openTab(chrome.browser, site.url('/el/cart-click/'));
    await clickAt(tab.page, await centerOf(tab.page, '#b'));
    await until(() => tab.page.evaluate(() => (window as unknown as { got: unknown[] }).got.length > 0), 1000);
    const got = (await tab.page.evaluate(() => (window as unknown as { got: { sku: string; frames: string[] }[] }).got)) as { sku: string; frames: string[] }[];
    await tab.close();
    const pass = got.length === 1 && got[0].sku === 'A-42' && got[0].frames.length === 2 && got[0].frames[0] === 'addToCart';
    R.check({ lesson: EVENT_LOOP, step: 'every-click-is-a-task', title: 'What is on the stack when the click handler runs', software: CHROME, real: `addToCart('${got[0]?.sku}') with stack: ${got[0]?.frames.join(' ← ')}`, lesson_says: 'runs later, as a task, on an empty stack', pass });
    expect(pass, JSON.stringify(got)).toBe(true);
    R.stamp(s.code, { lesson: EVENT_LOOP, by: CHROME, kind: 'ran', note: inChrome('a real click ran the handler with nothing below it on the stack, and addToCart got the button’s data-sku.') });
  });

  test('late.js: the delay is a minimum (timers-are-a-minimum)', async () => {
    const s = snippet(EL_SNIPS, 'timers-are-a-minimum', 'late.js');
    site.file('/el/late/late.js', plain(s.code));
    site.file('/el/late/', pageHtml({ src: 'late.js' }));
    const lateOf = (line: string) => Number(/late by (-?[\d.e-]+) ms/.exec(line)?.[1]);
    const chromeLate: number[] = [];
    for (let i = 0; i < 4; i++) {
      const tab = await openTab(chrome.browser, site.url('/el/late/'));
      await until(() => tab.logs.length > 0, 1000);
      chromeLate.push(lateOf(tab.logs[0]));
      await tab.close();
    }
    const nodeLate = (await Promise.all([1, 2, 3, 4].map(() => nodeCode(plain(s.code))))).map((r) => lateOf(r.lines[0]));
    const all = [...chromeLate, ...nodeLate];
    // performance.now() is coarsened a little in browsers, so allow a hair below zero.
    const pass = all.every((x) => Number.isFinite(x) && x > -0.2 && x < 25);
    R.check({ lesson: EVENT_LOOP, step: 'timers-are-a-minimum', title: 'How late a 100 ms timer fires on an idle thread', software: `${CHROME}, ${NODE}`, real: `Chrome: ${chromeLate.map((x) => x.toFixed(2)).join(', ')} ms; Node: ${nodeLate.map((x) => x.toFixed(2)).join(', ')} ms`, lesson_says: 'a minimum, never early', pass });
    expect(pass, all.join()).toBe(true);
    R.stamp(s.code, { lesson: EVENT_LOOP, by: CHROME, kind: 'ran', note: inChrome('on an idle page the callback came a little late, never early.') });
    R.stamp(s.code, { lesson: EVENT_LOOP, by: NODE, kind: 'ran', note: onNode('the callback came a little late, never early.') });
  });

  test('microtasks.js: all four run their callbacks as microtasks (the-microtask-queue)', async () => {
    const s = snippet(EL_SNIPS, 'the-microtask-queue', 'microtasks.js');
    // A module (the snippet uses a top-level await). The prelude defines what the
    // snippet names and queues a task first; the postlude changes the watched list.
    const prelude = `window.order = [];
setTimeout(() => order.push('task queued first'), 0);
const list = document.querySelector('#list');
const flushUpdates = () => order.push('queueMicrotask');
const promise = Promise.resolve();
const onDone = () => order.push('then');
const onError = () => order.push('catch');
const somePromise = Promise.resolve();
const onChange = () => order.push('MutationObserver');
order.push('script');`;
    site.file('/el/micro/microtasks.js', `${prelude}\n${plain(s.code)}\norder.push('after await');\nlist.append(document.createElement('li'));`);
    site.file('/el/micro/', pageHtml({ body: '<ul id="list"></ul>', src: 'microtasks.js', module: true }));
    const tab = await openTab(chrome.browser, site.url('/el/micro/'));
    await sleep(300);
    const order = (await tab.page.evaluate(() => (window as unknown as { order: string[] }).order)) as string[];
    await tab.close();
    const pass = same(order, ['script', 'queueMicrotask', 'then', 'after await', 'MutationObserver', 'task queued first']);
    R.check({
      lesson: EVENT_LOOP,
      step: 'the-microtask-queue',
      title: 'queueMicrotask, .then, await and MutationObserver all run before a task queued first',
      software: CHROME,
      real: order.join(' → '),
      lesson_says: 'all four run their callbacks as microtasks',
      pass,
    });
    expect(pass, order.join(', ')).toBe(true);
    R.stamp(s.code, { lesson: EVENT_LOOP, by: CHROME, kind: 'ran', note: inChrome('in a module, all four callbacks ran before a setTimeout(…, 0) task queued ahead of them: queueMicrotask, then, the code after await, then the MutationObserver.') });
  });

  test('animate.js: requestAnimationFrame calls tick once per frame (where-rendering-fits)', async () => {
    const s = snippet(EL_SNIPS, 'where-rendering-fits', 'animate.js');
    site.file('/el/animate/animate.js', plain(s.code));
    site.file(
      '/el/animate/',
      pageHtml({
        body: '<div id="box" style="width:20px;height:20px;background:#3c9"></div>',
        prelude: "const box = document.querySelector('#box'); window.calls = []; const __raf = requestAnimationFrame.bind(window); window.requestAnimationFrame = (cb) => __raf((t) => { cb(t); calls.push([t, box.style.transform]); });",
        src: 'animate.js',
      }),
    );
    const tab = await openTab(chrome.browser, site.url('/el/animate/'));
    await sleep(600);
    const calls = (await tab.page.evaluate(() => (window as unknown as { calls: [number, string][] }).calls)) as [number, string][];
    await tab.close();
    const gaps = calls.slice(2).map((c, i) => c[0] - calls[i + 1][0]);
    const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    const moves = calls.every(([t, tr]) => Math.abs(parseFloat(/translateX\(([-\d.e]+)px\)/.exec(tr)?.[1] ?? 'NaN') - ((t / 10) % 300)) < 0.01);
    const pass = calls.length >= 30 && Math.abs(avg - 1000 / 60) < 0.5 && Math.max(...gaps) < 20 && moves;
    R.check({ lesson: EVENT_LOOP, step: 'where-rendering-fits', title: 'rAF runs tick once per frame', software: CHROME, real: `${calls.length} calls in 600 ms, ${avg.toFixed(2)} ms apart; transform set from the frame time each call: ${moves}`, lesson_says: 'once per frame', pass });
    expect(pass, `${calls.length} ${avg}`).toBe(true);
    R.stamp(s.code, { lesson: EVENT_LOOP, by: CHROME, kind: 'ran', note: inChrome('tick ran once per frame, 16.7 ms apart on a 60 Hz display, and moved the box by the frame’s timestamp each time.') });
  });

  test('checkout.js: the promise version orders exactly like await (await-splits-a-function)', async () => {
    const s = snippet(EL_SNIPS, 'await-splits-a-function', 'checkout.js');
    const asyncVersion = P.AWAIT_SPLIT.code.split('\ncheckout();')[0];
    const scenarios = [
      `checkout();\nconsole.log('2 · back in the script');`,
      `queueMicrotask(() => console.log('m1'));\ncheckout().then(() => console.log('done'));\nqueueMicrotask(() => console.log('m2'));\nPromise.resolve().then(() => console.log('p1')).then(() => console.log('p2')).then(() => console.log('p3'));\nsetTimeout(() => console.log('task'), 0);\nconsole.log('sync');`,
      `(async () => { await checkout(); console.log('awaited'); })();\nPromise.resolve().then(() => console.log('p1')).then(() => console.log('p2')).then(() => console.log('p3')).then(() => console.log('p4'));`,
    ];
    const runs = await Promise.all(scenarios.flatMap((sc) => [nodeCode(`${plain(s.code)}\n${sc}`), nodeCode(`${asyncVersion}\n${sc}`)]));
    const pairs = scenarios.map((_, i) => ({ promise: runs[2 * i].lines, async: runs[2 * i + 1].lines }));
    const pass = pairs.every((p) => same(p.promise, p.async)) && same(pairs[0].promise, P.AWAIT_SPLIT.expect!);
    R.check({
      lesson: EVENT_LOOP,
      step: 'await-splits-a-function',
      title: 'checkout.js (promises) vs the async checkout() on the stage, in 3 interleavings',
      software: NODE,
      real: pairs.map((p) => `${same(p.promise, p.async) ? 'same' : 'DIFFERENT'}: ${p.promise.join(', ')}`).join('; '),
      lesson_says: 'the ordering is exactly this',
      pass,
    });
    expect(pass, JSON.stringify(pairs)).toBe(true);
    R.stamp(s.code, { lesson: EVENT_LOOP, by: NODE, kind: 'ran', note: onNode('this promise version and the async checkout() printed the same order in three interleavings with other microtasks and a timer.') });
  });

  test('cart.js: await fetch resumes at the headers, await res.json() at the body (awaiting-the-network)', async () => {
    const s = snippet(EL_SNIPS, 'awaiting-the-network', 'cart.js');
    site.route('/api/cart', (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.flushHeaders();
      setTimeout(() => res.end('{"items":["book","lamp"]}'), 300);
    });
    site.file('/el/net/cart.js', plain(s.code));
    site.file(
      '/el/net/',
      pageHtml({
        prelude: `window.ev = []; const t0 = performance.now();
const __fetch = window.fetch.bind(window); window.fetch = (...a) => __fetch(...a).then((r) => { ev.push(['headers', performance.now() - t0]); return r; });
function renderCart(cart) { ev.push(['renderCart', performance.now() - t0, JSON.stringify(cart)]); }
setTimeout(() => ev.push(['a timer ran', performance.now() - t0, new Error().stack.split('\\n').length - 1]), 120);`,
        src: 'cart.js',
        postlude: 'loadCart();',
      }),
    );
    const tab = await openTab(chrome.browser, site.url('/el/net/'));
    await until(() => tab.page.evaluate(() => (window as unknown as { ev: unknown[] }).ev.length >= 3), 3000);
    const ev = (await tab.page.evaluate(() => (window as unknown as { ev: [string, number, unknown?][] }).ev)) as [string, number, unknown?][];
    await tab.close();
    const at = (k: string) => ev.find((e) => e[0] === k);
    const headers = at('headers');
    const render = at('renderCart');
    const timer = at('a timer ran');
    const pass = !!headers && !!render && !!timer && headers[1] < 250 && render[1] >= 290 && render[2] === '{"items":["book","lamp"]}' && timer[1] < render[1] && timer[2] === 1;
    R.check({
      lesson: EVENT_LOOP,
      step: 'awaiting-the-network',
      title: 'Two awaits: headers first, then the body',
      software: CHROME,
      real: ev.map((e) => `${e[0]} at ${ms(e[1])}${e[0] === 'a timer ran' ? ` (stack depth ${e[2]})` : ''}`).join(', '),
      lesson_says: 'the body streams in later, so await again; while waiting the stack is empty and the loop is free',
      pass,
    });
    expect(pass, JSON.stringify(ev)).toBe(true);
    R.stamp(s.code, { lesson: EVENT_LOOP, by: CHROME, kind: 'ran', note: inChrome('against a server that sent the headers at once and the body 300 ms later, the first await resumed with the headers and the second once the body arrived. A timer ran in between, on an otherwise empty stack.') });
    site.route('/api/cart', (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"items":[]}');
    });
  });
});

/* ================================================================== */
/* Node.js                                                             */
/* ================================================================== */

describe('The Event Loop: Node.js', () => {
  const EL_SNIPS = collectSnippets(EL);

  test('libuv does file I/O on a thread pool (hand-it-off aside)', async () => {
    // A FIFO blocks the pool thread that opens it until someone writes. With a
    // pool of one thread, an ordinary readFile has to wait for that.
    const code = `const fs = require('node:fs');
const { execFileSync, spawn } = require('node:child_process');
execFileSync('mkfifo', ['pipe']);
const t0 = performance.now();
fs.readFile('pipe', () => {});
fs.readFile(__filename, () => console.log(Math.round(performance.now() - t0)));
spawn('sh', ['-c', 'sleep 0.3; printf x > pipe']);`;
    const [one, four] = await Promise.all([nodeCode(code, 'io.cjs', { env: { UV_THREADPOOL_SIZE: '1' } }), nodeCode(code, 'io.cjs', { env: { UV_THREADPOOL_SIZE: '4' } })]);
    const [a, b] = [Number(one.lines[0]), Number(four.lines[0])];
    const pass = a >= 280 && b < 100;
    R.check({ lesson: EVENT_LOOP, step: 'hand-it-off', title: 'Node reads files on libuv’s thread pool', software: NODE, real: `a readFile queued behind a blocked FIFO read finished after ${a} ms with a pool of 1 thread, ${b} ms with 4`, lesson_says: 'libuv has a thread pool for file I/O', pass });
    expect(pass, `${a} ${b} ${one.stderr}`).toBe(true);
  });

  test('promise2 is queued only when promise1’s callback returns (task-or-microtask aside)', async () => {
    const r = await nodeCode(`Promise.resolve()
  .then(() => { console.log('promise1'); queueMicrotask(() => console.log('queued inside promise1')); })
  .then(() => console.log('promise2'));`);
    const pass = same(r.lines, ['promise1', 'queued inside promise1', 'promise2']);
    R.check({ lesson: EVENT_LOOP, step: 'task-or-microtask', title: 'When the second .then joins the queue', software: NODE, real: r.lines.join(' → '), lesson_says: 'promise2 isn’t queued until promise1’s callback returns', pass });
    expect(pass, r.lines.join()).toBe(true);
  });

  test('inside an I/O callback, setImmediate always beats setTimeout 0 (node-js)', async () => {
    const labels = new Set<string>();
    const sim = simulateProgram(P.NODE_IO, { each: (x) => void x.m.apis.forEach((a) => labels.add(a.label)) });
    const t = await nodeTally(P.NODE_IO.code, 60, 'app.js', 15);
    const pass = same(sim.out, ['immediate', 'timeout']) && Object.keys(t).length === 1 && Object.keys(t)[0] === 'immediate | timeout';
    R.check({ lesson: EVENT_LOOP, step: 'node-js', title: 'app.js on the stage: readFile callback schedules both', software: NODE, real: fmtTally(t), lesson_says: sim.out.join(' | '), pass });
    expect(pass, fmtTally(t)).toBe(true);
    // The animation labels Node's 0 ms timer as 1 ms: so does Node.
    const one = (await nodeCode(`console.log(setTimeout(() => {}, 0)._idleTimeout)`)).lines[0];
    const card = [...labels].find((l) => l.startsWith('setTimeout'));
    R.check({ lesson: EVENT_LOOP, step: 'node-js', title: 'setTimeout(…, 0) is a 1 ms timer in Node', software: NODE, real: `_idleTimeout = ${one}`, lesson_says: `the timer card reads "${card}"`, pass: one === '1' && card === 'setTimeout · 0 → 1 ms' });
    expect(one === '1' && card === 'setTimeout · 0 → 1 ms', `${one} ${card}`).toBe(true);
  });

  test('main.js: from the main module the order can flip (node-js)', async () => {
    const s = snippet(EL_SNIPS, 'node-js', 'main.js');
    const tally: Record<string, number> = {};
    // Stop as soon as both orders have shown up (it can take a few hundred runs on an idle machine).
    for (let i = 0; i < 20 && Object.keys(tally).length < 2; i++) {
      const t = await nodeTally(plain(s.code), 60, 'main.js', 30);
      for (const [k, v] of Object.entries(t)) tally[k] = (tally[k] ?? 0) + v;
    }
    const flips = Object.keys(tally).length === 2 && !!tally['timeout | immediate'] && !!tally['immediate | timeout'];
    // The aside's reason: once 1 ms has passed before the loop starts, the timer always wins.
    const waited = await nodeTally(`${plain(s.code)}\nconst __t = performance.now(); while (performance.now() - __t < 2) {}`, 30, 'main.js', 15);
    const reason = Object.keys(waited).length === 1 && Object.keys(waited)[0] === 'timeout | immediate';
    R.check({
      lesson: EVENT_LOOP,
      step: 'node-js',
      title: 'setTimeout 0 vs setImmediate from the main module',
      software: NODE,
      real: `${fmtTally(tally)}; after a 2 ms busy wait in the module: ${fmtTally(waited)}`,
      lesson_says: 'the order can flip: it depends on whether 1 ms has passed when the loop first checks its timers',
      pass: flips && reason,
    });
    expect(flips && reason, `${fmtTally(tally)} / ${fmtTally(waited)}`).toBe(true);
    R.stamp(s.code, { lesson: EVENT_LOOP, by: NODE, kind: 'ran', note: onNode('over many runs both orders showed up. Busy-waiting 2 ms at the end of the module made timeout win every time.') });
  });

  test('ticks.cjs: nextTick first in CommonJS, promise first in an ES module (node-js)', async () => {
    const s = snippet(EL_SNIPS, 'node-js', 'ticks.cjs');
    const cjs = await nodeTally(plain(s.code), 6, 'ticks.cjs', 6);
    const mjs = await nodeTally(plain(s.code), 6, 'ticks.mjs', 6);
    const pass = fmtTally(cjs) === 'nextTick | promise ×6' && fmtTally(mjs) === 'promise | nextTick ×6';
    R.check({ lesson: EVENT_LOOP, step: 'node-js', title: 'process.nextTick vs a promise', software: NODE, real: `ticks.cjs: ${fmtTally(cjs)}; same code as .mjs: ${fmtTally(mjs)}`, lesson_says: 'CommonJS prints nextTick, promise; in an ES module the promise prints first', pass });
    expect(pass, `${fmtTally(cjs)} / ${fmtTally(mjs)}`).toBe(true);
    R.stamp(s.code, { lesson: EVENT_LOOP, by: NODE, kind: 'ran', note: onNode('as a .cjs file it printed nextTick, then promise. The same lines as an ES module printed promise first.') });
  });

  test('cheat sheet: nextTick runs ahead of promises once control returns to Node', async () => {
    const both = `process.nextTick(() => console.log('nextTick')); Promise.resolve().then(() => console.log('promise'));`;
    const cases: [string, string, string, string][] = [
      ['CommonJS main module', 'main.cjs', both, 'nextTick'],
      ['ES module body', 'main.mjs', both, 'promise'],
      ['setTimeout callback', 'main.cjs', `setTimeout(() => { ${both} }, 0);`, 'nextTick'],
      ['setImmediate callback', 'main.cjs', `setImmediate(() => { ${both} });`, 'nextTick'],
      ['fs.readFile callback', 'main.cjs', `require('node:fs').readFile(__filename, () => { ${both} });`, 'nextTick'],
      ['inside a .then callback', 'main.cjs', `Promise.resolve().then(() => { ${both} });`, 'promise'],
    ];
    const got = await Promise.all(cases.map(([, name, code]) => nodeCode(code, name)));
    const rows = cases.map(([label, , , want], i) => ({ label, first: got[i].lines[0], want }));
    const pass = rows.every((r) => r.first === r.want);
    R.check({
      lesson: EVENT_LOOP,
      step: 'cheat-sheet',
      title: 'Who goes first: process.nextTick or a promise?',
      software: NODE,
      real: rows.map((r) => `${r.label}: ${r.first}`).join('; '),
      lesson_says: 'as soon as control returns to Node, ahead of promises',
      pass,
    });
    expect(pass, JSON.stringify(rows)).toBe(true);

    // "Between callbacks, Node drains microtasks, just as a browser does after each task."
    const between = await nodeCode(
      `setTimeout(() => { console.log('t1'); Promise.resolve().then(() => console.log('p1')); }, 0);
setTimeout(() => { console.log('t2'); Promise.resolve().then(() => console.log('p2')); }, 0);
setTimeout(() => setImmediate(() => { console.log('i1'); Promise.resolve().then(() => console.log('q1')); }), 5);
setTimeout(() => setImmediate(() => { console.log('i2'); Promise.resolve().then(() => console.log('q2')); }), 5);`,
    );
    const drains = same(between.lines, ['t1', 'p1', 't2', 'p2', 'i1', 'q1', 'i2', 'q2']);
    R.check({ lesson: EVENT_LOOP, step: 'node-js', title: 'Microtasks drain between callbacks of the same phase', software: NODE, real: between.lines.join(' '), lesson_says: 'between callbacks, Node drains microtasks', pass: drains });
    expect(drains, between.lines.join(' ')).toBe(true);
  });
});

/* ================================================================== */
/* The playground                                                      */
/* ================================================================== */

describe('The Event Loop: playground', () => {
  test('every block program prints in Chrome what the animation prints', async () => {
    const fast: BlockKind[] = ['log', 'timeout', 'then', 'micro', 'async'];
    const every: BlockKind[] = [...fast, 'timeout100', 'fetch'];
    const progs: BlockKind[][] = [PG_START];
    const grow = (cur: BlockKind[]) => {
      if (cur.length) progs.push(cur);
      if (cur.length < 3) for (const k of fast) grow([...cur, k]);
    };
    grow([]);
    for (const a of every) for (const b of every) if (!fast.includes(a) || !fast.includes(b)) progs.push([a, b]);
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let i = 0; i < 16; i++) progs.push(Array.from({ length: 4 + Math.floor(rnd() * 3) }, () => every[Math.floor(rnd() * every.length)]));
    const built = progs
      .map((b) => ({ blocks: b, ...buildProgram(b.map((kind, id) => ({ id, kind }))) }))
      .filter((b) => b.blocks.length <= PG_MAX_BLOCKS && b.program.code.split('\n').length <= PG_MAX_LINES);
    const sims = built.map((b) => simulateProgram(b.program).out);

    // A fetch takes 120 ms in the animation: make the real one take that long too.
    site.route('/api/cart', (_req, res) => {
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{}');
      }, 120);
    });
    site.file(
      '/pg/',
      `<!doctype html><script>
      window.__out = null;
      console.log = (...a) => { if (window.__out) window.__out.push(a.join(' ')); };
      window.runProg = (code, n) => new Promise((done) => {
        const out = []; window.__out = out;
        setTimeout(() => { const s = document.createElement('script'); s.textContent = code; document.body.append(s); }, 0);
        const t = performance.now();
        (function poll() { if (out.length >= n || performance.now() - t > 1500) setTimeout(() => done(out), 8); else setTimeout(poll, 2); })();
      });
    </script><body></body>`,
    );
    // Two browser contexts: two renderer processes, two independent event loops.
    const halves = [0, 1];
    const contexts = await Promise.all(halves.map(() => chrome.browser.createBrowserContext()));
    const real: string[][] = new Array(built.length);
    await Promise.all(
      halves.map(async (h) => {
        const tab = await openTab(contexts[h], site.url('/pg/'));
        for (let i = h; i < built.length; i += 2) {
          real[i] = (await tab.page.evaluate((code, n) => (window as unknown as { runProg: (c: string, n: number) => Promise<string[]> }).runProg(code, n), built[i].program.code, built[i].letters.flat().length)) as string[];
        }
        await tab.close();
      }),
    );
    await Promise.all(contexts.map((c) => c.close()));
    const diffs = built.map((b, i) => ({ blocks: b.blocks.join(', '), real: real[i].join(' '), sim: sims[i].join(' ') })).filter((d) => d.real !== d.sim);
    const pass = diffs.length === 0;
    R.check({
      lesson: EVENT_LOOP,
      step: 'playground',
      title: 'Block programs: console order, animation vs Chrome',
      software: CHROME,
      real: pass ? `${built.length} programs (every 1–3 block mix of log, timeout, then, microtask and async, every pair with setTimeout 100 or fetch, 16 longer ones) printed the same order` : diffs.map((d) => `[${d.blocks}] real ${d.real}`).join('; '),
      lesson_says: pass ? 'same order in every program' : diffs.map((d) => `[${d.blocks}] ${d.sim}`).join('; '),
      pass,
    });
    expect(diffs).toEqual([]);
  });
});

/* ================================================================== */
/* Hash tables                                                         */
/* ================================================================== */

function javaHashCodes(keys: string[]): { version: string; codes: number[] } {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'verify-java-'));
  writeFileSync(path.join(dir, 'keys.txt'), keys.join('\n'));
  writeFileSync(
    path.join(dir, 'H.java'),
    'import java.nio.file.*;\npublic class H { public static void main(String[] a) throws Exception { for (String s : Files.readAllLines(Path.of("keys.txt"))) System.out.println(s.hashCode()); } }\n',
  );
  execFileSync('javac', ['H.java'], { cwd: dir });
  const codes = execFileSync('java', ['H'], { cwd: dir, encoding: 'utf8' }).trim().split('\n').map(Number);
  const version = /version "([^"]+)"/.exec(execFileSync('sh', ['-c', 'java -version 2>&1'], { encoding: 'utf8' }))?.[1] ?? '?';
  rmSync(dir, { recursive: true, force: true });
  return { version, codes };
}

describe('Hash tables', () => {
  const LESSON = 'hash-tables';
  const SN = collectSnippets(HT);
  const hashJs = snippet(SN, 'hash-function', 'hash.js');
  const hashFn = plain(hashJs.code).split('\n\nhash(')[0];
  /** Run code that ends by setting `out`, print it as JSON. */
  const run = async (code: string) => {
    const r = await nodeCode(`let out;\n${code}\nconsole.log(JSON.stringify(out));`);
    if (r.code !== 0) throw new Error(r.stderr);
    return JSON.parse(r.lines[r.lines.length - 1]);
  };

  test('hash.js: bob is 97717 every time, exactly Java’s String.hashCode() for short keys', async () => {
    const KEYS = ['alice', 'bob', 'carol', 'dave', 'erin', 'frank', 'grace', 'heidi', 'ivan', 'joe', 'judy', 'kim', 'nina', 'uma', 'walt', 'xena', 'zoe'];
    const LONG = ['hello world', 'the quick brown fox jumps over the lazy dog', 'xfjfxtz'];
    const note = hashJs.note ?? '';
    const expr = /h = (.+?) reproduces/.exec(note)?.[1] ?? '';
    const js = (await run(`${plain(hashJs.code)}
out = { bob: [hash('bob'), hash('bob')], keys: ${JSON.stringify([...KEYS, ...LONG])}.map((k) => hash(k)),
  note: ${JSON.stringify([...KEYS, ...LONG])}.map((key) => { let h = 0; for (const ch of key) h = ${expr}; return h; }),
  imulOnly: ${JSON.stringify([...KEYS, ...LONG])}.map((key) => { let h = 0; for (const ch of key) h = Math.imul(h, 31) + ch.charCodeAt(0); return h; }) };`)) as { bob: number[]; keys: number[]; note: number[]; imulOnly: number[] };
    const java = javaHashCodes([...KEYS, ...LONG]);
    const n = KEYS.length;
    const shortSame = KEYS.every((_, i) => js.keys[i] === java.codes[i]);
    const longDiffer = LONG.every((_, i) => js.keys[n + i] !== java.codes[n + i]);
    const noteSame = js.note.every((v, i) => v === java.codes[i]);
    const imulOnlyWrong = js.imulOnly[n + 2] !== java.codes[n + 2];
    const pass = js.bob[0] === 97717 && js.bob[1] === 97717 && shortSame && longDiffer && noteSame && imulOnlyWrong && expr.length > 0;
    R.check({
      lesson: LESSON,
      step: 'hash-function',
      title: "hash() vs Java's String.hashCode()",
      software: `${NODE}, OpenJDK ${java.version}`,
      real: `hash('bob') = ${js.bob.join(', ')}; ${KEYS.length} short keys: ${shortSame ? 'identical to Java' : 'DIFFERENT'}; long strings: plain hash ${longDiffer ? 'differs (no wrap)' : 'same?'}; the note's ${expr}: ${noteSame ? 'matches Java on all' : 'DIFFERS'}; Math.imul without | 0 on "xfjfxtz": ${js.imulOnly[n + 2]} vs Java ${java.codes[n + 2]}`,
      lesson_says: "97717 every time; exactly Java's String.hashCode() for short keys; the note's expression reproduces Java's wrap-around",
      pass,
    });
    expect(pass, JSON.stringify({ js, java })).toBe(true);
    R.stamp(hashJs.code, { lesson: LESSON, by: NODE, kind: 'ran', note: onNode(`hash('bob') gave 97717 both times, the same number Java ${java.version}'s "bob".hashCode() returns.`) });
  });

  test('table.js, phone.js, lazy.js, order.js: the numbers in the comments', async () => {
    const table = snippet(SN, 'hash-to-bucket', 'table.js');
    const phone = snippet(SN, 'lookups', 'phone.js');
    const lazy = snippet(SN, 'lazy-hash', 'lazy.js');
    const order = snippet(SN, 'python-dict', 'order.js');
    const got = await Promise.all([
      run(`${hashFn}\n${plain(table.code)}\nout = [hash('alice'), i, buckets[i]];`),
      run(`${plain(phone.code)}\nout = [phone.get('dave'), phone.get('zoe') === undefined, phone.has('alice')];`),
      run(`${plain(lazy.code)}\nout = [lazyHash('jack') % 10, lazyHash('jill') % 10];`),
      run(`${plain(order.code)}\nout = [...phone.keys()];`),
    ]);
    const rows = [
      { s: table, step: 'hash-to-bucket', real: `hash('alice') = ${got[0][0]}, bucket ${got[0][1]}`, says: '92903040 % 10 = 0', pass: got[0][0] === 92903040 && got[0][1] === 0 && same(got[0][2], ['alice', '555-0142']) },
      { s: phone, step: 'lookups', real: `get('dave') = ${got[1][0]}, get('zoe') undefined: ${got[1][1]}, has('alice') = ${got[1][2]}`, says: "'555-0108', undefined, true", pass: got[1][0] === '555-0108' && got[1][1] === true && got[1][2] === true },
      { s: lazy, step: 'lazy-hash', real: `jack → ${got[2][0]}, jill → ${got[2][1]}`, says: '6, 6', pass: got[2][0] === 6 && got[2][1] === 6 },
      { s: order, step: 'python-dict', real: JSON.stringify(got[3]), says: "['carol', 'alice', 'bob']", pass: same(got[3], ['carol', 'alice', 'bob']) },
    ];
    for (const r of rows) R.check({ lesson: LESSON, step: r.step, title: `${r.s.title}: the values in the comments`, software: NODE, real: r.real, lesson_says: r.says, pass: r.pass });
    for (const r of rows) expect(r.pass, `${r.s.title}: ${r.real}`).toBe(true);
    R.stamp(table.code, { lesson: LESSON, by: NODE, kind: 'ran', note: onNode("hash('alice') is 92903040, so alice lands in bucket 0.") });
    R.stamp(phone.code, { lesson: LESSON, by: NODE, kind: 'ran', note: onNode("get('dave') returned '555-0108', get('zoe') undefined and has('alice') true.") });
    R.stamp(lazy.code, { lesson: LESSON, by: NODE, kind: 'ran', note: onNode('both jack and jill land in bucket 6.') });

    // "objects start with fixed shapes in V8, and turn into hash tables after many adds and deletes"
    const v8 = await nodeCode(
      `const obj = {};\nobj.carol = '…';\nconst out = [%HasFastProperties(obj)];\nlet n = 0; const o2 = {}; while (%HasFastProperties(o2) && n < 5000) { o2['k' + n] = n; n++; } out.push(n);\nconst o3 = { a: 1, b: 2, c: 3 }; delete o3.a; out.push(%HasFastProperties(o3));\nconsole.log(JSON.stringify(out));`,
      'shape.cjs',
      { args: ['--allow-natives-syntax'] },
    );
    const [fast, adds, afterDelete] = JSON.parse(v8.lines[0]) as [boolean, number, boolean];
    const shapes = fast === true && adds > 5 && adds < 1100 && afterDelete === false;
    R.check({ lesson: LESSON, step: 'python-dict', title: 'V8 objects: fixed shapes, then dictionary mode', software: NODE, real: `new object fast: ${fast}; dictionary mode after ${adds} computed-key adds; after one delete fast: ${afterDelete}`, lesson_says: 'objects start with fixed "shapes" and turn into hash tables after many adds and deletes', pass: shapes && rows[3].pass });
    expect(shapes, v8.lines.join()).toBe(true);
    R.stamp(order.code, { lesson: LESSON, by: NODE, kind: 'ran', note: onNode('the Map listed carol, alice, bob. A plain object stayed in fast mode until a delete, or a couple dozen added keys, turned it into a dictionary.') });
  });

  test('contacts.js and chained-table.js: the comparisons the lesson counts', async () => {
    const contacts = snippet(SN, 'scan-a-list', 'contacts.js');
    const chain = snippet(SN, 'separate-chaining', 'chained-table.js');
    const list = (HT.flatMap((c) => c.steps).find((s) => s.id === 'scan-a-list')?.cfg?.list ?? []) as string[];
    // Count the predicate calls Array.prototype.find makes.
    const counting = `let calls = 0; const __find = Array.prototype.find; Array.prototype.find = function (fn, t) { return __find.call(this, (...a) => { calls++; return fn.apply(t, a); }); };`;
    const scan = await run(
      `${counting}\n${plain(contacts.code).replace(/const contacts = \[[\s\S]*?\];/, `const contacts = ${JSON.stringify(list.map((name) => ({ name, phone: '555-0100' })))};`)}\nconst dave = calls; calls = 0; contacts.find((c) => c.name === 'zoe'); out = [dave, calls];`,
    );
    const chained = await run(
      `${hashFn}\n${plain(chain.code)}\nconst t = new ChainedTable(); t.set('alice', 1); t.set('erin', 2); t.set('frank', 3); t.set('erin', 20);\n${counting}\nconst v = t.get('frank');\nout = [t.buckets[0].map((e) => e.key), v, calls, t.get('erin'), t.get('zoe')];`,
    );
    const scanPass = scan[0] === 9 && scan[1] === 10;
    const chainPass = same(chained[0], ['alice', 'erin', 'frank']) && chained[1] === 3 && chained[2] === 3 && chained[3] === 20 && chained[4] === null;
    R.check({ lesson: LESSON, step: 'scan-a-list', title: 'contacts.find() over the lesson’s 10 contacts', software: NODE, real: `dave: ${scan[0]} comparisons, zoe: ${scan[1]}`, lesson_says: 'dave is 9th: 9 comparisons; zoe: all 10', pass: scanPass });
    R.check({ lesson: LESSON, step: 'separate-chaining', title: 'ChainedTable: bucket 0 and the lookup for frank', software: NODE, real: `bucket 0: ${chained[0].join(', ')}; get('frank') = ${chained[1]} after ${chained[2]} comparisons; set('erin') again updated it to ${chained[3]}`, lesson_says: 'erin and frank join alice’s chain; looking up frank: 3 comparisons', pass: chainPass });
    expect(scanPass && chainPass, JSON.stringify({ scan, chained })).toBe(true);
    R.stamp(contacts.code, { lesson: LESSON, by: NODE, kind: 'ran', note: onNode('over the lesson’s 10 contacts, finding dave took 9 comparisons and missing zoe took all 10.') });
    R.stamp(chain.code, { lesson: LESSON, by: NODE, kind: 'ran', note: onNode('alice, erin and frank all chained in bucket 0, and get(\'frank\') compared 3 keys.') });
  });
});

/* ================================================================== */
/* Big-O                                                               */
/* ================================================================== */

describe('Big-O', () => {
  const LESSON = 'big-o';
  const SN = collectSnippets(BIGO);
  const run = async (code: string) => {
    const r = await nodeCode(`let out;\n${code}\nconsole.log(JSON.stringify(out));`);
    if (r.code !== 0) throw new Error(r.stderr);
    return { out: JSON.parse(r.lines[r.lines.length - 1]), lines: r.lines };
  };

  test('findMax.js: timing 10 million numbers (why-not-seconds)', async () => {
    const s = snippet(SN, 'why-not-seconds', 'findMax.js');
    const r = await nodeCode(`const numbers = Array.from({ length: 10_000_000 }, () => Math.random());\n${plain(s.code)}`);
    const t = Number(/findMax: ([\d.]+)ms/.exec(r.lines.join('\n'))?.[1]);
    const pass = t > 15 && t < 150;
    R.check({ lesson: LESSON, step: 'why-not-seconds', title: 'One timed findMax over 10 million numbers', software: NODE, real: `console.timeEnd printed ${t.toFixed(1)} ms (${os.cpus()[0]?.model ?? 'this CPU'})`, lesson_says: '~50 ms on one laptop; yours will differ', pass });
    expect(pass, r.lines.join('\n')).toBe(true);
    R.stamp(s.code, { lesson: LESSON, by: NODE, kind: 'ran', note: onNode(`one timed call over 10 million numbers took tens of milliseconds on an ${os.cpus()[0]?.model ?? 'ordinary'} laptop.`) });
  });

  test('constant.js, search.js, binarySearch.js: the values in the comments', async () => {
    const constant = snippet(SN, 'constant-time', 'constant.js');
    const search = snippet(SN, 'linear-search', 'search.js');
    const bin = snippet(SN, 'binary-search', 'binarySearch.js');
    const [c, sr, b] = await Promise.all([
      run(`${plain(constant.code)}\nout = [arr.BYTES_PER_ELEMENT, arr.length, names.has('carol')];`),
      run(`${plain(search.code)}\nout = [ids.includes(46), ids.indexOf(46), idSet.has(46)];`),
      run(`${plain(bin.code)}
let ok = true, worst = 0;
for (const n of [1, 2, 3, 10, 1000, 1 << 20]) {
  const sorted = Array.from({ length: n }, (_, i) => i * 2);
  for (let k = 0; k < 200; k++) {
    const target = Math.floor(Math.random() * 2 * n);
    const got = binarySearch(sorted, target);
    if (got !== (target % 2 === 0 && target / 2 < n ? target / 2 : -1)) ok = false;
  }
}
let reads = 0; const probe = new Proxy(Array.from({ length: 1 << 20 }, (_, i) => i), { get(t, k) { if (typeof k === 'string' && /^\\d+$/.test(k)) reads++; return t[k]; } });
binarySearch(probe, -5); worst = reads;
out = [ok, worst];`),
    ]);
    const rows = [
      { s: constant, step: 'constant-time', real: `${c.out[0]} bytes per number, ${c.out[1].toLocaleString('en-US')} numbers; names.has('carol') = ${c.out[2]}`, says: '8 bytes per number', pass: c.out[0] === 8 && c.out[2] === true },
      { s: search, step: 'linear-search', real: `includes ${sr.out[0]}, indexOf ${sr.out[1]}, has ${sr.out[2]}`, says: 'indexOf(46) returns 14', pass: sr.out[0] === true && sr.out[1] === 14 && sr.out[2] === true },
      { s: bin, step: 'binary-search', real: `correct on ${6 * 200} searches; a miss in 1,048,576 items read ${b.out[1]} elements`, says: 'halves the range each step: about log₂ n looks', pass: b.out[0] === true && b.out[1] <= 2 * 21 },
    ];
    for (const r of rows) R.check({ lesson: LESSON, step: r.step, title: `${r.s.title}`, software: NODE, real: r.real, lesson_says: r.says, pass: r.pass });
    for (const r of rows) expect(r.pass, `${r.s.title}: ${r.real}`).toBe(true);
    R.stamp(constant.code, { lesson: LESSON, by: NODE, kind: 'ran', note: onNode('each Float64Array element is 8 bytes, and the Set found carol.') });
    R.stamp(search.code, { lesson: LESSON, by: NODE, kind: 'ran', note: onNode('includes found 46, indexOf returned 14, and the Set agreed.') });
    R.stamp(bin.code, { lesson: LESSON, by: NODE, kind: 'ran', note: onNode('it found every target on sorted arrays up to a million items and missed nothing, touching about log₂ n elements per search.') });
  });

  test('mergeSort.js + merge.js: sorts, and V8’s sort behaves like TimSort (split-in-halves, merge-back-up)', async () => {
    const ms1 = snippet(SN, 'split-in-halves', 'mergeSort.js');
    const mg = snippet(SN, 'merge-back-up', 'merge.js');
    const { out } = await run(`${plain(mg.code).replace(/\n!?\[5, 3, 9, 1\][^\n]*/, '')}\n${plain(ms1.code)}
const example = ${plain(mg.code).split('\n').find((l) => l.startsWith('[5, 3, 9, 1]'))!.split(';')[0]};
let ok = true;
for (let k = 0; k < 200; k++) { const a = Array.from({ length: Math.floor(Math.random() * 300) }, () => Math.floor(Math.random() * 100)); if (mergeSort(a).join() !== [...a].sort((x, y) => x - y).join()) ok = false; }
let cmp = 0; Array.from({ length: 10000 }, (_, i) => i).sort((x, y) => (cmp++, x - y));
let cmpR = 0; Array.from({ length: 10000 }, () => Math.random()).sort((x, y) => (cmpR++, x - y));
out = [example, ok, cmp, cmpR];`);
    const pass = out[0].join() === '1,3,5,9' && out[1] === true && out[2] === 9999 && out[3] < 10000 * Math.log2(10000);
    R.check({ lesson: LESSON, step: 'merge-back-up', title: 'mergeSort, merge and V8’s Array.prototype.sort', software: NODE, real: `[5, 3, 9, 1] → [${out[0].join(', ')}]; mergeSort matched sort on 200 random arrays: ${out[1]}; sorting 10,000 sorted numbers took ${out[2]} comparisons (n − 1), random ones ${out[3].toLocaleString('en-US')}`, lesson_says: 'V8 uses TimSort: O(n log n)', pass });
    expect(pass, JSON.stringify(out)).toBe(true);
    R.stamp(ms1.code, { lesson: LESSON, by: NODE, kind: 'ran', note: onNode('with merge.js, it sorted 200 random arrays exactly like Array.prototype.sort.') });
    R.stamp(mg.code, { lesson: LESSON, by: NODE, kind: 'ran', note: onNode('[5, 3, 9, 1] sorted to [1, 3, 5, 9]. V8’s sort needed only n − 1 comparisons on already sorted input, the TimSort signature.') });
  });

  test('fib.js and fibMemo.js: the call counts (exploding-calls, memoization)', async () => {
    const fib = snippet(SN, 'exploding-calls', 'fib.js');
    const memo = snippet(SN, 'memoization', 'fibMemo.js');
    const def = plain(fib.code).split('\n\nfib(')[0].replace('function fib(n) {', 'function fib(n) {\n  calls++;');
    const { out } = await run(`let calls = 0;\n${def}
const counts = [30, 31, 32, 33, 34, 35].map((n) => { calls = 0; fib(n); return calls; });
calls = 0; const t = performance.now(); fib(40); const secs = (performance.now() - t) / 1000; const c40 = calls;
out = [counts, c40, secs];`);
    const [counts, c40, secs] = out as [number[], number, number];
    const formula = [30, 31, 32, 33, 34, 35].every((n, i) => counts[i] === fibCalls(n));
    const said = /fib\(30\);\s+\/\/ ([\d,]+) calls[\s\S]*fib\(50\);\s+\/\/ ([\d,]+) calls: ([^\n]*)/.exec(plain(fib.code))!;
    const est50 = (secs / c40) * fibCalls(50);
    const memoRun = await run(`let calls = 0;\n${plain(memo.code).replace('function fib(n) {', 'function fib(n) {\n  calls++;').replace(/\nfib\(50\);[^\n]*/, '')}\nconst v = fib(50);\nout = [calls, v, 2 * 50 - 1];`);
    const pass = counts[0] === Number(said[1].replaceAll(',', '')) && formula && fibCalls(50) === Number(said[2].replaceAll(',', '')) && est50 > 60 && memoRun.out[0] === 99 && memoRun.out[1] === 12586269025;
    R.check({
      lesson: LESSON,
      step: 'exploding-calls',
      title: 'fib(30) and fib(50): calls and time',
      software: NODE,
      real: `fib(30) made ${counts[0].toLocaleString('en-US')} calls; counted calls for n = 30…35 all equal 2·fib(n+1) − 1; fib(40) ran at ${((secs / c40) * 1e9).toFixed(2)} ns a call, so fib(50)'s ${fibCalls(50).toLocaleString('en-US')} calls take about ${Math.round(est50)} s; memoized fib(50) made ${memoRun.out[0]} calls`,
      lesson_says: `${said[1]} calls; ${said[2]} calls: ${said[3]}; memoized: 99 calls`,
      pass,
    });
    expect(pass, JSON.stringify({ counts, c40, secs, est50, memo: memoRun.out })).toBe(true);
    R.stamp(fib.code, { lesson: LESSON, by: NODE, kind: 'ran', note: onNode('fib(30) made exactly 2,692,537 calls. At the per-call speed of fib(40), fib(50)’s 40.7 billion calls take more than a minute.') });
    R.stamp(memo.code, { lesson: LESSON, by: NODE, kind: 'ran', note: onNode('fib(50) returned 12,586,269,025 after exactly 99 calls.') });
  });

  test('a-million.js and the duplicate checks (a-million-items, all-pairs, space-complexity)', async () => {
    const million = snippet(SN, 'a-million-items', 'a-million.js');
    const pairs = snippet(SN, 'all-pairs', 'hasDuplicate.js');
    const space = snippet(SN, 'space-complexity', 'hasDuplicate.js');
    const m = await run(`const n = 1_000_000;\nconst values = [${plain(million.code)
      .split('\n')
      .filter((l) => /^(n|2)\b/.test(l))
      .map((l) => l.split('//')[0].trim())
      .join(', ')}];\nout = [values, (2n ** 1000000n).toString().length];`);
    const [vals, digits] = m.out as [number[], number];
    const say = plain(million.code);
    const pass1 = vals[0] === 1e6 && Math.abs(vals[1] - 2e7) / 2e7 < 0.01 && vals[2] === 1e12 && digits === 301030 && say.includes('301,030-digit') && Math.round(1e12 / 1e9 / 60) === 17;
    const dup = await run(`${plain(pairs.code)}\nconst allPairs = hasDuplicate;\n${plain(space.code).replace('function hasDuplicate', 'function withSet').replace(/\nnew Set\(arr\)[^\n]*/, '')}
const oneLine = (arr) => ${/new Set\(arr\)\.size !== arr\.length/.exec(plain(space.code))![0]};
let ok = true;
for (let k = 0; k < 500; k++) { const arr = Array.from({ length: Math.floor(Math.random() * 40) }, () => Math.floor(Math.random() * 60)); const a = allPairs(arr); if (a !== withSet(arr) || a !== oneLine(arr)) ok = false; }
out = ok;`);
    const pass2 = dup.out === true;
    R.check({ lesson: LESSON, step: 'a-million-items', title: 'a-million.js: the step counts', software: NODE, real: `n = ${vals[0]}, n·log₂n = ${Math.round(vals[1]).toLocaleString('en-US')}, n² = ${vals[2].toExponential()}, 2ⁿ has ${digits.toLocaleString('en-US')} digits (BigInt)`, lesson_says: '1,000,000; ≈ 20,000,000; 1,000,000,000,000; a 301,030-digit number', pass: pass1 });
    R.check({ lesson: LESSON, step: 'space-complexity', title: 'hasDuplicate: all pairs, with a Set, and the one-liner agree', software: NODE, real: `500 random arrays: ${pass2 ? 'same answer from all three' : 'DISAGREE'}`, lesson_says: 'same idea, O(n) with a Set', pass: pass2 });
    expect(pass1 && pass2, JSON.stringify({ m: m.out, dup: dup.out })).toBe(true);
    R.stamp(million.code, { lesson: LESSON, by: NODE, kind: 'ran', note: onNode('with n = 1,000,000 the first three lines evaluate to 1,000,000, about 19.9 million and 10¹², and 2n ** 1000000n has 301,030 digits.') });
    R.stamp(pairs.code, { lesson: LESSON, by: NODE, kind: 'ran', note: onNode('it agreed with the Set version on 500 random arrays.') });
    R.stamp(space.code, { lesson: LESSON, by: NODE, kind: 'ran', note: onNode('both versions agreed with the all-pairs check on 500 random arrays.') });
  });
});

/* ================================================================== */
/* Garbage collection                                                  */
/* ================================================================== */

describe('Garbage collection', () => {
  const LESSON = 'garbage-collection';
  const SN = collectSnippets(GC);

  test('report.js: the listener leaks a report per open; the AbortController fix does not (find-the-leak)', async () => {
    const s = snippet(SN, 'find-the-leak', 'report.js');
    const [leakPart, fixPart] = plain(s.code).split('// The fix: remove the listener when the modal closes.');
    const fixLines = fixPart.trim().split('\n');
    const fixed = leakPart
      .replace(/ {2}window\.addEventListener\('resize'[^\n]*\n/, `  const redraw = () => drawChart(modal, report);\n${fixLines.map((l) => `  ${l}`).join('\n')}\n`)
      .replace(/ {2}modal\.onClose = \(\) => modal\.remove\(\);[^\n]*\n/, '');
    const prelude = `
function buildReport() { return Array.from({ length: 78000 }, (_, i) => ({ id: i, name: 'row ' + i, total: i * 1.5 })); }
function showModal(report) { const el = document.createElement('div'); el.className = 'modal'; el.textContent = report.length + ' rows'; document.body.append(el); return el; }
function drawChart(modal, report) { modal.dataset.w = innerWidth + ':' + report.length; }`;
    const heapPerRound = async (code: string) => {
      const tab = await openTab(chrome.browser, 'about:blank');
      await tab.page.evaluate(`${prelude}\n${code}\nwindow.openReport = openReport;`);
      const cdp = await tab.page.createCDPSession();
      const used = async () => {
        await cdp.send('HeapProfiler.collectGarbage');
        await cdp.send('HeapProfiler.collectGarbage');
        return (await cdp.send('Runtime.getHeapUsage')).usedSize / 1e6;
      };
      const sizes = [await used()];
      for (let i = 0; i < 3; i++) {
        await tab.page.evaluate(() => {
          (window as unknown as { openReport: () => void }).openReport();
          const modal = [...document.querySelectorAll('.modal')].pop() as HTMLElement & { onClose: () => void };
          modal.onClose();
        });
        sizes.push(await used());
      }
      const report = (await tab.page.evaluate(() => {
        const r = (0, eval)('buildReport()');
        return JSON.stringify(r).length;
      })) as number;
      await tab.close();
      return { sizes, steps: sizes.slice(1).map((x, i) => x - sizes[i]), report };
    };
    const leak = await heapPerRound(leakPart);
    const fix = await heapPerRound(fixed);
    const pass = leak.steps.every((d) => d > 4 && d < 6.5) && fix.steps.every((d) => Math.abs(d) < 0.5);
    R.check({
      lesson: LESSON,
      step: 'find-the-leak',
      title: 'Heap after GC, per open and close of a ~5 MB report',
      software: CHROME,
      real: `leaky: ${leak.sizes.map((x) => x.toFixed(1)).join(' → ')} MB; with the fix: ${fix.sizes.map((x) => x.toFixed(1)).join(' → ')} MB`,
      lesson_says: 'after every open and close, the heap after GC is 5 MB bigger; removing the listener fixes it',
      pass,
    });
    expect(pass, JSON.stringify({ leak, fix })).toBe(true);
    R.stamp(s.code, { lesson: LESSON, by: CHROME, kind: 'ran', note: inChrome('with a 5 MB report, each open and close left about 5 MB more on the heap after GC. With the AbortController fix, the heap stayed flat.') });
  });

  test('mark.js and sweep.js: cycles stop the marker; the sweep frees the rest (mark, sweep)', async () => {
    const mark = snippet(SN, 'mark', 'mark.js');
    const sweep = snippet(SN, 'sweep', 'sweep.js');
    const r = await nodeCode(`const freeList = [];\n${plain(mark.code)}\n${plain(sweep.code)}
const o = (name) => ({ name, refs: [], marked: false });
const user = o('user'), profile = o('profile'), cart = o('cart'), draft = o('draft'), note = o('note');
user.refs.push(profile); profile.refs.push(user); user.refs.push(cart);   // a reachable cycle
draft.refs.push(note); note.refs.push(draft);                              // an unreachable cycle
const heap = [user, draft, profile, note, cart];
mark([user]);
const marked = heap.filter((x) => x.marked).map((x) => x.name);
sweep(heap);
console.log(JSON.stringify({ marked, freed: freeList.map((x) => x.name), cleared: heap.every((x) => !x.marked) }));`);
    const got = JSON.parse(r.lines[0]) as { marked: string[]; freed: string[]; cleared: boolean };
    const pass = same(got.marked, ['user', 'profile', 'cart']) && same(got.freed, ['draft', 'note']) && got.cleared;
    R.check({ lesson: LESSON, step: 'mark', title: 'mark() on a graph with two cycles, then sweep()', software: NODE, real: `marked ${got.marked.join(', ')}; freed ${got.freed.join(', ')} in address order; marks cleared: ${got.cleared}`, lesson_says: 'cycles can’t trap the marker; the unreachable draft ↔ note cycle is freed', pass });
    expect(pass, r.lines.join()).toBe(true);
    R.stamp(mark.code, { lesson: LESSON, by: NODE, kind: 'ran', note: onNode('on a graph with a reachable cycle it finished and marked exactly the three reachable objects; the unreachable draft ↔ note cycle stayed unmarked.') });
    R.stamp(sweep.code, { lesson: LESSON, by: NODE, kind: 'ran', note: onNode('after mark.js, it put the unmarked draft and note on the free list in heap order and cleared every mark.') });
  });

  test('node --trace-gc and --max-semi-space-size (mark-compact, copying, young-and-old)', async () => {
    const trace = snippet(SN, 'young-and-old', 'terminal');
    const semi = snippet(SN, 'copying', 'terminal');
    const alloc = `let keep = [];\nfor (let i = 0; i < 3e6; i++) { keep.push({ i, s: 'x' + i }); if (keep.length > 300000) keep = []; }\nconst cache = []; for (let i = 0; i < 60; i++) cache.push(Array.from({ length: 20000 }, (_, j) => ({ j })));\nconst v8 = require('node:v8'); console.log('new_space', v8.getHeapSpaceStatistics().find((s) => s.space_name === 'new_space').space_size / 2 ** 20);`;
    const [plainRun, flagRun] = await Promise.all([nodeCode(alloc, 'server.js', { args: ['--trace-gc'] }), nodeCode(alloc, 'server.js', { args: ['--trace-gc', '--max-semi-space-size=32'] })]);
    const LINE = /^\[\d+:0x[0-9a-f]+\]\s+\d+ ms: (Scavenge|Mark-Compact) [\d.]+ \([\d.]+\) -> [\d.]+ \([\d.]+\) MB, (?:pooled: [\d.]+ MB, )?[\d.]+ \/ [\d.]+ ms/;
    const kinds = uniq(plainRun.lines.map((l) => LINE.exec(l)?.[1]).filter(Boolean));
    const lessonLines = plain(trace.code).split('\n').filter((l) => l.startsWith('['));
    const lessonParses = lessonLines.every((l) => LINE.test(l));
    const scav = (r: typeof plainRun) => r.lines.filter((l) => l.includes('Scavenge')).length;
    const space = (r: typeof plainRun) => Number(r.lines.find((l) => l.startsWith('new_space'))?.split(' ')[1]);
    const pooled = plainRun.lines.some((l) => l.includes('pooled:'));
    const passTrace = kinds.includes('Scavenge') && kinds.includes('Mark-Compact') && lessonParses;
    const passSemi = space(flagRun) === 64 && space(plainRun) === 32 && scav(flagRun) < scav(plainRun) && semi.code.includes('--max-semi-space-size=32');
    R.check({
      lesson: LESSON,
      step: 'young-and-old',
      title: 'node --trace-gc prints Scavenge and Mark-Compact lines in this format',
      software: NODE,
      real: `printed ${kinds.join(' and ')} lines with pid:isolate, time, heap before (reserved) -> after (reserved) MB, pause${pooled ? ', plus a "pooled: N MB," field the lesson’s lines don’t have' : ''}`,
      lesson_says: 'these fields; the format varies a little between Node versions',
      pass: passTrace,
    });
    R.check({
      lesson: LESSON,
      step: 'copying',
      title: '--max-semi-space-size=32',
      software: NODE,
      real: `new space grew to ${space(flagRun)} MB (default ${space(plainRun)} MB, starting at 1 MB); scavenges: ${scav(flagRun)} vs ${scav(plainRun)}`,
      lesson_says: 'sets the maximum size of each half, in MB; they start small and grow',
      pass: passSemi,
    });
    expect(passTrace && passSemi, `${kinds} ${space(flagRun)} ${space(plainRun)}`).toBe(true);
  });
});

/* ================================================================== */
/* Race conditions                                                     */
/* ================================================================== */

describe('Race conditions', () => {
  const LESSON = 'race-conditions';
  const SN = collectSnippets(RC);
  const W = 4;
  const N = 1_000_000;
  /** Four worker threads each run the snippet's increment line N times on one shared counter. */
  const race = async (code: string) => {
    const lines = plain(code)
      .split('\n')
      .filter((l) => l.trim() && !l.trim().startsWith('//'));
    const setup = lines.find((l) => l.startsWith('const count'))!;
    const step = lines.find((l) => !l.startsWith('const count'))!;
    const r = await nodeCode(`const { Worker } = require('node:worker_threads');
const sharedBuffer = new SharedArrayBuffer(4);
const body = ${JSON.stringify(`const { workerData: { sharedBuffer, N } } = require('node:worker_threads');\n${setup}\nfor (let i = 0; i < N; i++) {\n${step}\n}`)};
Promise.all(Array.from({ length: ${W} }, () => new Promise((res, rej) => { const w = new Worker(body, { eval: true, workerData: { sharedBuffer, N: ${N} } }); w.on('exit', res); w.on('error', rej); })))
  .then(() => console.log(new Int32Array(sharedBuffer)[0]));`);
    return Number(r.lines[0]);
  };

  test('worker.js: a plain increment loses updates; Atomics.add does not (the-lost-update, fetch-and-add)', async () => {
    const lost = snippet(SN, 'the-lost-update', 'worker.js');
    const faa = snippet(SN, 'fetch-and-add', 'worker.js');
    const plainCounts = [await race(lost.code), await race(lost.code)];
    const atomicCounts = [await race(faa.code), await race(faa.code)];
    const old = await nodeCode(`const count = new Int32Array(new SharedArrayBuffer(4)); count[0] = 5;\nconst r = ${plain(faa.code).split('\n').find((l) => l.startsWith('Atomics.add'))!.split(';')[0]};\nconsole.log(r, count[0]);`);
    const pass = plainCounts.every((c) => c < W * N) && atomicCounts.every((c) => c === W * N) && old.lines[0] === '5 6';
    R.check({
      lesson: LESSON,
      step: 'the-lost-update',
      title: `${W} worker threads × ${N.toLocaleString('en-US')} increments on one SharedArrayBuffer`,
      software: NODE,
      real: `count[0] = count[0] + 1 ended at ${plainCounts.map((c) => c.toLocaleString('en-US')).join(' and ')}; Atomics.add at ${atomicCounts.map((c) => c.toLocaleString('en-US')).join(' and ')}; Atomics.add on 5 returned ${old.lines[0].split(' ')[0]}`,
      lesson_says: `plain: lost updates; atomic: exactly ${(W * N).toLocaleString('en-US')}; Atomics.add returns the old value`,
      pass,
    });
    expect(pass, JSON.stringify({ plainCounts, atomicCounts, old: old.lines })).toBe(true);
    R.stamp(lost.code, { lesson: LESSON, by: NODE, kind: 'ran', note: onNode(`with ${W} worker threads doing a million increments each on one SharedArrayBuffer, the count came up short: updates were lost.`) });
    R.stamp(faa.code, { lesson: LESSON, by: NODE, kind: 'ran', note: onNode(`the same ${W} threads with Atomics.add always reached exactly ${(W * N).toLocaleString('en-US')}, and Atomics.add returned the old value.`) });
  });

  test('SharedArrayBuffer needs a cross-origin isolated page in Chrome (fetch-and-add note)', async () => {
    site.file('/sab/plain/', '<!doctype html><p>plain');
    site.file('/sab/iso/', '<!doctype html><p>isolated', { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' });
    const probe = async (p: string) => {
      const tab = await openTab(chrome.browser, site.url(p));
      const r = (await tab.page.evaluate(() => ({ sab: typeof SharedArrayBuffer, isolated: crossOriginIsolated }))) as { sab: string; isolated: boolean };
      await tab.close();
      return r;
    };
    const [a, b] = [await probe('/sab/plain/'), await probe('/sab/iso/')];
    const pass = a.sab === 'undefined' && !a.isolated && b.sab === 'function' && b.isolated;
    R.check({ lesson: LESSON, step: 'fetch-and-add', title: 'SharedArrayBuffer with and without COOP + COEP', software: CHROME, real: `without the headers: typeof SharedArrayBuffer = ${a.sab}; with them: ${b.sab} (crossOriginIsolated ${b.isolated})`, lesson_says: 'needs a cross-origin isolated page (COOP and COEP headers)', pass });
    expect(pass).toBe(true);
  });
});

/* ================================================================== */
/* WebSockets: the browser side                                        */
/* ================================================================== */

describe('WebSockets: the browser side', () => {
  const LESSON = 'websockets';
  const SN = collectSnippets(WS);

  test('handshake, frames, pings, closes, reconnects: what Chrome does (ask-to-upgrade … silent-death)', async () => {
    const server = snippet(SN, 'switching-protocols', 'server.js');
    // The lesson's own accept computation drives the stand-in server.
    const acceptOf = new Function('createHash', 'req', `${plain(server.code).replace(/^import .*\n/m, '')}\nreturn accept;`) as (h: typeof createHash, req: { headers: Record<string, string> }) => string;
    const accept = (key: string) => acceptOf(createHash, { headers: { 'sec-websocket-key': key } });
    const rfc = accept('dGhlIHNhbXBsZSBub25jZQ==');
    const rfcSays = /\/\/ '([^']+)'/.exec(plain(server.code))?.[1];

    const seen: { path: string; at: number; headers: Record<string, string | string[] | undefined> }[] = [];
    const frames: { path: string; op: number; text: string }[] = [];
    const open = (p: string, then?: (sock: import('node:stream').Duplex) => void, bad = false) =>
      site.ws(p, (req, sock) => {
        const key = String(req.headers['sec-websocket-key']);
        seen.push({ path: p, at: Date.now(), headers: req.headers });
        accept101(sock, bad ? `x${accept(key).slice(1)}` : accept(key));
        let closing = false;
        sock.on('data', (b: Buffer) => {
          for (const f of parseFrames(b)) {
            frames.push({ path: p, op: f.op, text: f.payload.toString() });
            if (f.op === OP.close) {
              if (!closing) sock.write(closeFrame(f.payload.length >= 2 ? f.payload.readUInt16BE(0) : 1000));
              sock.end();
            }
            if (f.op === OP.text && p === '/ws-chat') {
              const msg = JSON.parse(f.payload.toString());
              if (msg.type === 'join') sock.write(frame(OP.text, JSON.stringify({ id: 19, from: 'alice', text: 'Lunch at noon?' })));
              if (msg.type === 'say') {
                closing = true;
                sock.write(closeFrame(1000));
              }
            }
          }
        });
        then?.(sock);
      });
    open('/ws');
    open('/ws-bad', undefined, true);
    open('/ws-chat');
    open('/ws-ping', (sock) => setTimeout(() => sock.write(frame(OP.ping, 'hb-1')), 100));
    open('/ws-cut', (sock) => setTimeout(() => sock.destroy(), 150));
    const attempts: number[] = [];
    site.ws('/ws-down', (_req, sock) => {
      attempts.push(Date.now());
      sock.destroy();
    });
    site.file('/ws/', '<!doctype html><p>chat', { 'set-cookie': 'sid=abc123; Path=/' });

    // silent-death: start the reconnect loop first, it takes a few seconds.
    const recon = snippet(SN, 'silent-death', 'chat.js · reconnect and resync');
    const reconTab = await openTab(chrome.browser, site.url('/ws/'));
    await reconTab.page.evaluate(`const render = () => {};\n${plain(recon.code).replace('wss://chat.example/ws', `ws://127.0.0.1:${site.port}/ws-down`)}\nconnect();`);

    // ask-to-upgrade: the handshake and the moment onopen runs
    const ask = snippet(SN, 'ask-to-upgrade', 'chat.js · Bob’s browser');
    const tab = await openTab(chrome.browser, site.url('/ws/'));
    const t0 = Date.now();
    await tab.page.evaluate(plain(ask.code).replace("'wss://chat.example/ws'", `'ws://127.0.0.1:${site.port}/ws'`));
    await until(() => tab.logs.includes('connected'), 2000);
    const connectedAt = Date.now();
    const state = await tab.page.evaluate('ws.readyState');
    const hs = seen.find((x) => x.path === '/ws')!;
    const key = String(hs.headers['sec-websocket-key']);
    const handshake =
      rfc === rfcSays &&
      hs.headers.upgrade === 'websocket' &&
      hs.headers.connection === 'Upgrade' &&
      Buffer.from(key, 'base64').length === 16 &&
      hs.headers['sec-websocket-version'] === '13' &&
      hs.headers.origin === `http://127.0.0.1:${site.port}` &&
      String(hs.headers.cookie).includes('sid=abc123') &&
      hs.at >= t0 &&
      connectedAt >= hs.at &&
      state === 1;
    R.check({
      lesson: LESSON,
      step: 'ask-to-upgrade',
      title: 'What the browser sends, and when onopen runs',
      software: CHROME,
      real: `GET with Upgrade: ${hs.headers.upgrade}, Connection: ${hs.headers.connection}, a ${Buffer.from(key, 'base64').length}-byte key, version ${hs.headers['sec-websocket-version']}, Origin, and the page's cookie; "connected" logged after the 101, readyState ${state}`,
      lesson_says: 'Upgrade + Connection, 16 random bytes base64, version 13, cookies sent; onopen runs after the handshake',
      pass: handshake,
    });
    R.check({ lesson: LESSON, step: 'switching-protocols', title: 'Sec-WebSocket-Accept for the RFC’s sample key', software: NODE, real: rfc, lesson_says: rfcSays ?? '?', pass: rfc === rfcSays });

    // readyState CONNECTING → OPEN; a wrong accept is refused; a cut connection closes with 1006; pings are answered and hidden
    const probe = (p: string, host = '127.0.0.1') =>
      tab.page.evaluate(
        (url: string) =>
          new Promise((resolve) => {
            const ws = new WebSocket(url);
            const ev: { states: number[]; open?: boolean; msgs: string[]; error?: boolean; code?: number } = { states: [ws.readyState], msgs: [] };
            ws.onopen = () => {
              ev.open = true;
              ev.states.push(ws.readyState);
            };
            ws.onmessage = (e) => ev.msgs.push(String(e.data));
            ws.onerror = () => (ev.error = true);
            ws.onclose = (e) => {
              ev.code = e.code;
              resolve(ev);
            };
            setTimeout(() => ws.close(1000), 500);
          }),
        `ws://${host}:${site.port}${p}`,
      ) as Promise<{ states: number[]; open?: boolean; msgs: string[]; error?: boolean; code?: number }>;
    const [bad, cut, ping, cross] = [await probe('/ws-bad'), await probe('/ws-cut'), await probe('/ws-ping'), await probe('/ws', 'localhost')];
    const pong = frames.find((f) => f.path === '/ws-ping' && f.op === OP.pong);
    const crossOrigin = seen.filter((x) => x.path === '/ws').pop()!.headers.origin;
    const checks = [
      { step: 'switching-protocols', title: 'A wrong Sec-WebSocket-Accept', real: `open: ${!!bad.open}, error: ${!!bad.error}, close code ${bad.code}`, says: 'the browser refuses the connection', pass: !bad.open && !!bad.error && bad.code === 1006 },
      { step: 'one-connection', title: 'readyState during the handshake', real: `before: ${ping.states[0]}, in onopen: ${ping.states[1]}`, says: 'CONNECTING (0), then OPEN (1) when the 101 checks out', pass: ping.states[0] === 0 && ping.states[1] === 1 },
      { step: 'heartbeats', title: 'The connection is cut without a close frame', real: `close code ${cut.code}`, says: 'the browser sees it close (code 1006)', pass: cut.code === 1006 },
      { step: 'heartbeats', title: 'A ping from the server', real: `browser answered with opcode ${pong?.op} carrying "${pong?.text}"; messages seen by the page: ${ping.msgs.length}`, says: 'the browser answers with a pong (opcode 10), automatically, hidden from JavaScript', pass: pong?.op === 10 && pong.text === 'hb-1' && ping.msgs.length === 0 },
      { step: 'switching-protocols', title: 'A WebSocket to another origin', real: `page on 127.0.0.1 opened ws://localhost: ${!!cross.open}, Origin sent: ${crossOrigin}`, says: 'the same-origin policy doesn’t stop other sites from opening WebSockets; check Origin', pass: !!cross.open && crossOrigin === `http://127.0.0.1:${site.port}` },
    ];
    for (const c of checks) R.check({ lesson: LESSON, step: c.step, title: c.title, software: CHROME, real: c.real, lesson_says: c.says, pass: c.pass });

    // one-connection: the full chat.js
    const chat = snippet(SN, 'one-connection', 'chat.js');
    const chatTab = await openTab(chrome.browser, site.url('/ws/'));
    await chatTab.page.evaluate(`document.body.innerHTML = '<input id="msg" value="Sounds good"><button id="send">Send</button>';
window.rendered = []; const render = (m) => rendered.push(m); const sendButton = document.querySelector('#send'); const input = document.querySelector('#msg');
${plain(chat.code).replace("'wss://chat.example/ws'", `'ws://127.0.0.1:${site.port}/ws-chat'`)}`);
    await until(() => chatTab.page.evaluate('rendered.length > 0') as Promise<boolean>, 2000);
    await chatTab.page.click('#send');
    await until(() => chatTab.logs.some((l) => l.startsWith('closed with code')), 2000);
    const rendered = (await chatTab.page.evaluate('rendered')) as { text: string }[];
    const sent = frames.filter((f) => f.path === '/ws-chat' && f.op === OP.text).map((f) => f.text);
    const chatPass = same(sent, ['{"type":"join","room":42}', '{"type":"say","text":"Sounds good"}']) && rendered[0]?.text === 'Lunch at noon?' && chatTab.logs.includes('closed with code 1000');
    R.check({ lesson: LESSON, step: 'one-connection', title: 'chat.js end to end', software: CHROME, real: `server got ${sent.join(' then ')}; render() got "${rendered[0]?.text}"; console: ${chatTab.logs.join(', ')}`, lesson_says: 'join on open, render each message, send on click, log the close code', pass: chatPass });
    await chatTab.close();
    await tab.close();

    // silent-death: the waits between reconnect attempts
    await until(() => attempts.length >= 4, 9000, 50);
    await reconTab.close();
    const gaps = attempts.slice(1, 4).map((t, i) => (t - attempts[i]) / 1000);
    const bounds = [1, 2, 4];
    const backoff = gaps.length === 3 && gaps.every((g, i) => g >= bounds[i] * 0.5 - 0.05 && g <= bounds[i] + 0.25);
    R.check({ lesson: LESSON, step: 'silent-death', title: 'Reconnect backoff against a server that is down', software: CHROME, real: `waits: ${gaps.map((g) => `${g.toFixed(2)} s`).join(', ')}`, lesson_says: 'about 1 s, then 2, 4… with random jitter (the code waits 50–100% of 1, 2, 4 s)', pass: backoff });

    const all = [handshake, rfc === rfcSays, ...checks.map((c) => c.pass), chatPass, backoff];
    expect(all.every(Boolean), JSON.stringify({ checks, gaps, sent, rendered, logs: chatTab.logs })).toBe(true);
    R.stamp(ask.code, { lesson: LESSON, by: CHROME, kind: 'ran', note: inChrome('onopen ran only after the server’s 101, and the upgrade request carried a 16-byte key, version 13, the Origin and the page’s cookies.') });
    R.stamp(server.code, { lesson: LESSON, by: NODE, kind: 'ran', note: onNode(`the RFC’s sample key gives ${rfc}, and ${CHROME} accepted the handshakes it answered (and refused a wrong one).`) });
    R.stamp(chat.code, { lesson: LESSON, by: CHROME, kind: 'ran', note: inChrome('it joined on open, rendered the server’s message, sent on click and logged "closed with code 1000" when the server closed.') });
    R.stamp(recon.code, { lesson: LESSON, by: CHROME, kind: 'ran', note: inChrome('against a server that was down, the waits between attempts fell within 0.5–1 s, 1–2 s and 2–4 s: doubling, with jitter.') });
  });

  test('Server-Sent Events and long polling (server-sent-events, long-polling)', async () => {
    const events = snippet(SN, 'server-sent-events', 'events.js');
    const long = snippet(SN, 'long-polling', 'long-poll.js');
    const sse: { url: string; accept?: string; lastId?: string; method?: string }[] = [];
    const posts: string[] = [];
    site.route('/events', (req, res) => {
      sse.push({ url: String(req.url), accept: req.headers.accept, lastId: req.headers['last-event-id'] as string | undefined, method: req.method });
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      if (sse.length === 1) {
        res.write('retry: 200\nid: 18\ndata: {"from":"alice","text":"Lunch at noon?"}\n\n');
        setTimeout(() => res.destroy(), 150);
      } else res.write('id: 19\ndata: {"from":"bob","text":"Sounds good"}\n\n');
    });
    site.route('/messages', (req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        posts.push(body);
        res.writeHead(201);
        res.end();
      });
    });
    const tab = await openTab(chrome.browser, site.url('/ws/'));
    await tab.page.evaluate(`window.got = []; const render = (m) => got.push(m); const msg = { room: 42, text: 'Sounds good' };\n${plain(events.code)}`);
    await until(() => tab.page.evaluate('got.length >= 2') as Promise<boolean>, 3000);
    const got = (await tab.page.evaluate('got')) as { text: string }[];
    const ssePass =
      sse[0]?.method === 'GET' && sse[0].accept === 'text/event-stream' && got[0]?.text === 'Lunch at noon?' && sse[1]?.lastId === '18' && got[1]?.text === 'Sounds good' && posts[0] === '{"room":42,"text":"Sounds good"}';
    R.check({
      lesson: LESSON,
      step: 'server-sent-events',
      title: 'EventSource: a GET, events, and a reconnect after a drop',
      software: CHROME,
      real: `${sse[0]?.method} with Accept: ${sse[0]?.accept}; render got "${got[0]?.text}"; after the server dropped the stream, the browser came back with Last-Event-ID: ${sse[1]?.lastId} and got "${got[1]?.text}"; POST body ${posts[0]}`,
      lesson_says: 'an ordinary GET; if the stream drops, the browser reconnects by itself and sends Last-Event-ID',
      pass: ssePass,
    });
    await tab.close();

    // "about six connections per server… across all tabs"
    const ctx = await chrome.browser.createBrowserContext();
    let live = 0;
    let most = 0;
    site.route('/hold', (req, res) => {
      live++;
      most = Math.max(most, live);
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(': open\n\n');
      req.on('close', () => live--);
    });
    const a = await openTab(ctx, site.url('/ws/'));
    const b = await openTab(ctx, site.url('/ws/'));
    await a.page.evaluate(`window.es = [1, 2, 3, 4].map((i) => new EventSource('/hold?a' + i))`);
    await b.page.evaluate(`window.es = [5, 6, 7].map((i) => new EventSource('/hold?b' + i))`);
    await sleep(800);
    const states = [(await a.page.evaluate('es.map((e) => e.readyState)')) as number[], (await b.page.evaluate('es.map((e) => e.readyState)')) as number[]].flat();
    await ctx.close();
    const limit = most === 6 && states.filter((x) => x === 1).length === 6 && states.filter((x) => x === 0).length === 1;
    R.check({ lesson: LESSON, step: 'server-sent-events', title: 'Seven EventSources to one HTTP/1.1 server, across two tabs', software: CHROME, real: `the server saw ${most} streams at once; readyStates ${states.join(', ')}`, lesson_says: 'about six connections per server, across all tabs', pass: limit });

    // long-poll.js: 204 means ask again at once; the cursor moves on
    const polls: { at: number; after: string | null }[] = [];
    site.route('/poll', (req, res) => {
      const after = new URL(String(req.url), 'http://x').searchParams.get('after');
      polls.push({ at: Date.now(), after });
      if (polls.length === 1) setTimeout(() => (res.writeHead(204), res.end()), 300);
      else if (polls.length === 2)
        setTimeout(() => {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify([{ id: 18, text: 'Lunch at noon?' }]));
        }, 100);
      // the third request hangs until news that never comes
    });
    site.file('/lp/long-poll.js', `window.got = []; const render = (m) => got.push(m);\n${plain(long.code)}`);
    site.file('/lp/', pageHtml({ src: 'long-poll.js', module: true }));
    const lp = await openTab(chrome.browser, site.url('/lp/'));
    await until(() => polls.length >= 3, 3000);
    const lpGot = (await lp.page.evaluate('got')) as { id: number }[];
    await lp.close();
    const again = polls.length >= 3 ? polls[1].at - polls[0].at : NaN;
    const lpPass = polls.length >= 3 && again >= 290 && again < 350 && polls[2].after === '18' && polls[0].after === '17' && lpGot[0]?.id === 18;
    R.check({ lesson: LESSON, step: 'long-polling', title: 'long-poll.js against a server that answers 204, then news', software: CHROME, real: `requests with after = ${polls.map((p) => p.after).join(', ')}; after the 204 it asked again ${ms(again - 300)} later; render got id ${lpGot[0]?.id}`, lesson_says: '204: ask again immediately; then render and move the cursor', pass: lpPass });

    expect(ssePass && limit && lpPass, JSON.stringify({ sse, got, most, states, polls, lpGot })).toBe(true);
    R.stamp(events.code, { lesson: LESSON, by: CHROME, kind: 'ran', note: inChrome('EventSource sent a GET asking for text/event-stream and rendered each event; when the stream dropped, it reconnected with Last-Event-ID on its own.') });
    R.stamp(long.code, { lesson: LESSON, by: CHROME, kind: 'ran', note: inChrome('after a 204 it asked again at once, and after the news it asked with the new cursor.') });
  });
});

/* ================================================================== */
/* Processes & threads, message queues                                 */
/* ================================================================== */

describe('Processes & threads, message queues', () => {
  test('main.js: a worker thread sums in parallel (python-and-node)', async () => {
    const s = snippet(collectSnippets(PT), 'python-and-node', 'main.js');
    const crunch = `const { workerData, parentPort } = require('node:worker_threads');\nlet sum = 0;\nfor (let i = 0; i < workerData; i++) sum += i * i;\nparentPort.postMessage(sum);`;
    const r = await nodeRun({ 'main.js': plain(s.code), 'crunch.js': crunch }, 'main.js');
    const exact = ((1e7 - 1) * 1e7 * (2e7 - 1)) / 6;
    const sumOk = Math.abs(Number(r.lines[0]) - exact) / exact < 1e-9;
    const par = await nodeRun(
      {
        'crunch.js': crunch,
        'par.js': `const { Worker } = require('node:worker_threads');
const one = () => new Promise((res) => new Worker('./crunch.js', { workerData: 3e8 }).on('message', res));
(async () => { let t = performance.now(); await one(); const single = performance.now() - t; t = performance.now(); await Promise.all([one(), one(), one(), one()]); console.log(single, performance.now() - t); })();`,
      },
      'par.js',
    );
    const [single, four] = par.lines[0].split(' ').map(Number);
    const pass = sumOk && four < single * 1.6;
    R.check({ lesson: 'processes-threads', step: 'python-and-node', title: 'worker_threads: the sum, and four at once', software: NODE, real: `printed ${r.lines[0]}; one worker ${ms(single)}, four at once ${ms(four)}`, lesson_says: 'real threads, each with its own heap; the result comes back as a message', pass });
    expect(pass, JSON.stringify({ out: r.lines, single, four })).toBe(true);
    R.stamp(s.code, { lesson: 'processes-threads', by: NODE, kind: 'ran', note: onNode('the worker posted back the sum of 10 million squares. Four such workers at once took about as long as one: real threads, on separate cores.') });
  });

  test('parseCharge: the message that always fails (the-message-that-always-fails)', async () => {
    const s = snippet(collectSnippets(MQ), 'the-message-that-always-fails', 'worker.js');
    const r = await nodeCode(`${plain(s.code)}
const good = parseCharge('{"orderId": 7, "amount": 12.5}');
const bad = [];
for (let attempt = 1; attempt <= 3; attempt++) { try { parseCharge('{"orderId": 8, "amount": "12"}'); bad.push('ok'); } catch (e) { bad.push(e.constructor.name + ': ' + e.message); } }
console.log(JSON.stringify({ good, bad }));`);
    const got = JSON.parse(r.lines[0]) as { good: { orderId: number; amount: number }; bad: string[] };
    const pass = got.good.orderId === 7 && got.good.amount === 12.5 && got.bad.every((b) => b === 'TypeError: bad amount: 12');
    R.check({ lesson: 'message-queues', step: 'the-message-that-always-fails', title: 'parseCharge on a good and a poison message', software: NODE, real: `good → ${JSON.stringify(got.good)}; "amount": "12", three tries → ${uniq(got.bad).join(', ')}`, lesson_says: 'a message with a bad amount throws, every time', pass });
    expect(pass, r.lines.join()).toBe(true);
    R.stamp(s.code, { lesson: 'message-queues', by: NODE, kind: 'ran', note: onNode('a body with "amount": "12" threw TypeError: bad amount: 12 on every attempt, while a good one parsed.') });
  });
});
