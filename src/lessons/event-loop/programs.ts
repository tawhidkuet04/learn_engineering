import type { Fn, Machine, Op, Program } from './engine';

/*
 * Every snippet the lesson runs: the exact source the learner reads, and the
 * ops the machine executes for it (line numbers are 1-based). Outputs were
 * checked against Node 22, which orders tasks and microtasks like browsers.
 */

const log = (line: number, text: string, src?: string): Op => ({ op: 'log', line, text, src });
const fn = (name: string, body: Op[], card?: string): Fn => ({ name, body, card });
const afn = (name: string, body: Op[]): Fn => ({ name, body, async: true });
const say = (line: number, text: string, card: string): Fn => fn('', [log(line, text)], card);

/* ------------------------------------------------------------------ */
/* Chapter 1                                                           */
/* ------------------------------------------------------------------ */

const greet = fn('greet', [{ op: 'return', line: 2, mark: "returns 'Hi, Ada'" }]);
const mainFn = fn('main', [
  { op: 'call', line: 5, fn: greet, args: "'Ada'" },
  { op: 'stmt', line: 5, dur: 0.3, mark: "msg = 'Hi, Ada'" },
  log(6, 'Hi, Ada', 'msg'),
]);

export const CALL_STACK: Program = {
  id: 'call-stack',
  file: 'greet.js',
  code: `function greet(name) {
  return 'Hi, ' + name;
}
function main() {
  const msg = greet('Ada');
  console.log(msg);
}
main();`,
  main: [{ op: 'call', line: 8, fn: mainFn }],
  expect: ['Hi, Ada'],
};

export const HAND_OFF: Program = {
  id: 'hand-off',
  file: 'checkout.js',
  code: `console.log('Order placed');
setTimeout(() => {
  console.log('Email sent');
}, 1000);
console.log('Show receipt');`,
  main: [log(1, 'Order placed'), { op: 'timeout', line: 2, ms: 1000, fn: say(3, 'Email sent', 'timeout → email') }, log(5, 'Show receipt')],
  expect: ['Order placed', 'Show receipt', 'Email sent'],
};

export const ZERO_ROUNDS: Program[] = [
  {
    id: 'zero-1',
    file: 'zero.js',
    code: `console.log('A');
setTimeout(() => console.log('B'), 0);
console.log('C');`,
    main: [log(1, 'A'), { op: 'timeout', line: 2, ms: 0, fn: say(2, 'B', 'timeout → B') }, log(3, 'C')],
    expect: ['A', 'C', 'B'],
    ask: {
      choices: ['A B C', 'A C B', 'B A C'],
      answer: 1,
      explain: 'A 0 ms timer expires right away, but its callback still waits in the task queue until the stack is empty. The script is still running, so C prints before B.',
    },
  },
  {
    id: 'zero-2',
    file: 'timers.js',
    code: `setTimeout(() => console.log('1'), 10);
setTimeout(() => console.log('2'), 0);
console.log('3');`,
    main: [
      { op: 'timeout', line: 1, ms: 10, fn: say(1, '1', 'timeout → 1') },
      { op: 'timeout', line: 2, ms: 0, fn: say(2, '2', 'timeout → 2') },
      log(3, '3'),
    ],
    expect: ['3', '2', '1'],
    ask: {
      choices: ['1 2 3', '3 1 2', '3 2 1', '2 3 1'],
      answer: 2,
      explain: 'Synchronous code first: 3. Then timers run in the order they expire: the 0 ms timer (2) is ready long before the 10 ms one (1).',
    },
  },
  {
    id: 'zero-3',
    file: 'busy.js',
    code: `setTimeout(() => console.log('X'), 0);
const end = Date.now() + 100;
while (Date.now() < end) {}  // 100 ms
console.log('Y');`,
    main: [
      { op: 'timeout', line: 1, ms: 0, fn: say(1, 'X', 'timeout → X') },
      { op: 'stmt', line: 2 },
      { op: 'work', line: 3, ms: 100 },
      log(4, 'Y'),
    ],
    expect: ['Y', 'X'],
    ask: {
      choices: ['X Y', 'Y X'],
      answer: 1,
      explain: 'X is queued after 0 ms, but a queued task never interrupts running code. It waits the full 100 ms for the loop to finish.',
    },
  },
];

/* ------------------------------------------------------------------ */
/* Chapter 2                                                           */
/* ------------------------------------------------------------------ */

export const CLICKS: Program = {
  id: 'clicks',
  file: 'shop.js',
  code: `const buy = document.querySelector('#buy');
let n = 0;
buy.addEventListener('click', () => {
  n++;
  console.log('click', n);
});
setInterval(() => console.log('tick'), 3000);`,
  main: [
    { op: 'stmt', line: 1 },
    { op: 'stmt', line: 2, run: (m) => (m.vars.n = 0) },
    {
      op: 'listen',
      line: 3,
      fn: fn(
        '',
        [
          { op: 'stmt', line: 4, run: (m) => (m.vars.n += 1) },
          { op: 'log', line: 5, text: (m) => `click ${m.vars.n}`, src: "'click', n" },
        ],
        'click handler',
      ),
    },
    { op: 'timeout', line: 7, ms: 3000, repeat: true, fn: say(7, 'tick', 'interval → tick') },
  ],
};

export const MINIMUM: Program = {
  id: 'minimum',
  file: 'late.js',
  code: `const start = Date.now();
setTimeout(() => {
  console.log('timer', Date.now() - start);
}, 100);
while (Date.now() - start < 300) {}
console.log('loop done');`,
  main: [
    { op: 'stmt', line: 1, run: (m) => (m.vars.start = m.ms) },
    {
      op: 'timeout',
      line: 2,
      ms: 100,
      fn: fn('', [{ op: 'log', line: 3, text: (m) => `timer ${Math.round(m.ms - m.vars.start)}`, src: "'timer', …" }], 'timeout → log'),
    },
    { op: 'work', line: 5, ms: 300 },
    log(6, 'loop done'),
  ],
};

/* ------------------------------------------------------------------ */
/* Chapter 3                                                           */
/* ------------------------------------------------------------------ */

export const PROMISE_QUEUE: Program = {
  id: 'promise-queue',
  file: 'queues.js',
  code: `console.log('A');
setTimeout(() => console.log('B'), 0);
Promise.resolve()
  .then(() => console.log('C'));
console.log('D');`,
  main: [
    log(1, 'A'),
    { op: 'timeout', line: 2, ms: 0, fn: say(2, 'B', 'timeout → B') },
    { op: 'stmt', line: 3, dur: 0.34 },
    { op: 'then', line: 4, fn: say(4, 'C', 'then → C') },
    log(5, 'D'),
  ],
  expect: ['A', 'D', 'C', 'B'],
};

export const CLASSIC_ROUNDS: Program[] = [
  {
    id: 'classic',
    file: 'classic.js',
    code: `console.log('script start');
setTimeout(() => {
  console.log('setTimeout');
}, 0);
Promise.resolve()
  .then(() => console.log('promise1'))
  .then(() => console.log('promise2'));
console.log('script end');`,
    main: [
      log(1, 'script start'),
      { op: 'timeout', line: 2, ms: 0, fn: say(3, 'setTimeout', 'setTimeout cb') },
      { op: 'stmt', line: 5, dur: 0.34 },
      { op: 'then', line: 6, fn: say(6, 'promise1', 'then → promise1') },
      { op: 'then', line: 7, on: 'last', fn: say(7, 'promise2', 'then → promise2'), wait: 'waits for promise1' },
      log(8, 'script end'),
    ],
    expect: ['script start', 'script end', 'promise1', 'promise2', 'setTimeout'],
  },
  {
    id: 'nested',
    file: 'nested.js',
    code: `setTimeout(() => console.log('t1'), 0);
queueMicrotask(() => {
  console.log('m1');
  setTimeout(() => console.log('t2'), 0);
  queueMicrotask(() => console.log('m2'));
});
console.log('sync');`,
    main: [
      { op: 'timeout', line: 1, ms: 0, fn: say(1, 't1', 'timeout → t1') },
      {
        op: 'micro',
        line: 2,
        fn: fn(
          '',
          [log(3, 'm1'), { op: 'timeout', line: 4, ms: 0, fn: say(4, 't2', 'timeout → t2') }, { op: 'micro', line: 5, fn: say(5, 'm2', 'microtask → m2') }],
          'microtask → m1',
        ),
      },
      log(7, 'sync'),
    ],
    expect: ['sync', 'm1', 'm2', 't1', 't2'],
  },
];

const again: Fn = { name: 'again', card: 'again()', body: [] };
again.body.push(
  { op: 'log', line: 4, pre: (m: Machine) => (m.vars.n += 1), text: (m: Machine) => `micro ${m.vars.n}`, src: "'micro', ++n" },
  { op: 'if', line: 5, test: (m: Machine) => m.vars.n < 3, body: [{ op: 'micro', line: 5, fn: again }] },
);

export const DRAIN: Program = {
  id: 'drain',
  file: 'drain.js',
  code: `let n = 0;
setTimeout(() => console.log('timeout'), 0);
function again() {
  console.log('micro', ++n);
  if (n < 3) queueMicrotask(again);
}
queueMicrotask(again);`,
  main: [
    { op: 'stmt', line: 1, run: (m) => (m.vars.n = 0) },
    { op: 'timeout', line: 2, ms: 0, fn: say(2, 'timeout', 'timeout → log') },
    { op: 'micro', line: 7, fn: again },
  ],
  expect: ['micro 1', 'micro 2', 'micro 3', 'timeout'],
};

const frameFn: Fn = { name: 'frame', body: [] };
frameFn.body.push(
  { op: 'stmt', line: 4, run: (m: Machine) => (m.vars.x += 50), mark: (m: Machine) => `x = ${m.vars.x}` },
  { op: 'dom', line: 5, run: (m: Machine) => (m.dom = { ...m.dom, x: m.vars.x }) },
  { op: 'if', line: 6, test: (m: Machine) => m.vars.x < 150, body: [{ op: 'raf', line: 6, fn: frameFn }] },
);

export const RENDER: Program = {
  id: 'render',
  file: 'animate.js',
  code: `const box = document.querySelector('.box');
let x = 0;
function frame() {
  x += 50;
  box.style.left = x + 'px';
  if (x < 150) requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
setTimeout(() => console.log('task'), 0);`,
  main: [
    { op: 'stmt', line: 1 },
    { op: 'stmt', line: 2, run: (m) => (m.vars.x = 0) },
    { op: 'raf', line: 8, fn: frameFn },
    { op: 'timeout', line: 9, ms: 0, fn: say(9, 'task', 'timeout → task') },
  ],
  screen: 'anim',
  firstFrame: 6,
  expect: ['task'],
};

/* ------------------------------------------------------------------ */
/* Chapter 4                                                           */
/* ------------------------------------------------------------------ */

export const AWAIT_SPLIT: Program = {
  id: 'await-split',
  file: 'checkout.js',
  code: `async function checkout() {
  console.log('1 · checkout starts');
  await null;
  console.log('3 · after await');
}
checkout();
console.log('2 · back in the script');`,
  main: [
    {
      op: 'call',
      line: 6,
      fn: afn('checkout', [log(2, '1 · checkout starts'), { op: 'await', line: 3, on: 'value', wait: 'ready' }, log(4, '3 · after await')]),
    },
    log(7, '2 · back in the script'),
  ],
  expect: ['1 · checkout starts', '2 · back in the script', '3 · after await'],
};

export const AWAIT_FETCH: Program = {
  id: 'await-fetch',
  file: 'cart.js',
  code: `async function loadCart() {
  console.log('loading…');
  const res = await fetch('/api/cart');
  console.log('status', res.status);
}
loadCart();
console.log('page is interactive');`,
  main: [
    {
      op: 'call',
      line: 6,
      fn: afn('loadCart', [
        log(2, 'loading…'),
        { op: 'fetch', line: 3, url: '/api/cart', ms: 400 },
        { op: 'await', line: 3, on: 'last', wait: 'waits for fetch' },
        { op: 'log', line: 4, text: 'status 200', src: "'status', res.status" },
      ]),
    },
    log(7, 'page is interactive'),
  ],
  expect: ['loading…', 'page is interactive', 'status 200'],
};

const runFn = afn('run', [log(2, '1'), { op: 'await', line: 3, on: 'value' }, log(4, '2')]);
const bFn = afn('b', [log(7, 'b')]);
const aFn = afn('a', [log(2, 'a1'), { op: 'call', line: 3, fn: bFn }, { op: 'await', line: 3, on: 'last', wait: 'waits for b()' }, log(4, 'a2')]);
const fFn = afn('f', [log(2, 'f1'), { op: 'sleep', line: 3, ms: 0, api: 'setTimeout(r, 0)' }, { op: 'await', line: 3, on: 'last', wait: 'waits for the timer' }, log(4, 'f2')]);

export const ASYNC_ROUNDS: Program[] = [
  {
    id: 'async-1',
    file: 'order.js',
    code: `async function run() {
  console.log('1');
  await null;
  console.log('2');
}
setTimeout(() => console.log('3'), 0);
run();
queueMicrotask(() => console.log('4'));
console.log('5');`,
    main: [
      { op: 'timeout', line: 6, ms: 0, fn: say(6, '3', 'timeout → 3') },
      { op: 'call', line: 7, fn: runFn },
      { op: 'micro', line: 8, fn: say(8, '4', 'microtask → 4') },
      log(9, '5'),
    ],
    expect: ['1', '5', '2', '4', '3'],
    ask: {
      choices: ['1 2 5 4 3', '1 5 2 4 3', '1 5 4 2 3', '3 1 5 2 4'],
      answer: 1,
      explain: "run() prints 1, then pauses at await: its continuation is queued as a microtask before queueMicrotask's. The script finishes with 5, the microtasks run in order (2, then 4), and the timer's task (3) goes last.",
    },
  },
  {
    id: 'async-2',
    file: 'nested-await.js',
    code: `async function a() {
  console.log('a1');
  await b();
  console.log('a2');
}
async function b() {
  console.log('b');
}
a();
console.log('end');`,
    main: [{ op: 'call', line: 9, fn: aFn }, log(10, 'end')],
    expect: ['a1', 'b', 'end', 'a2'],
    ask: {
      choices: ['a1 b a2 end', 'a1 end b a2', 'a1 b end a2', 'end a1 b a2'],
      answer: 2,
      explain: 'Calling b() runs it right away, so b prints before anything pauses. Only then does a() pause at await, which lets the script print end. a2 is the continuation, a microtask.',
    },
  },
  {
    id: 'async-3',
    file: 'sleep.js',
    code: `async function f() {
  console.log('f1');
  await new Promise((r) => setTimeout(r, 0));
  console.log('f2');
}
f();
queueMicrotask(() => console.log('m'));
console.log('s');`,
    main: [{ op: 'call', line: 6, fn: fFn }, { op: 'micro', line: 7, fn: say(7, 'm', 'microtask → m') }, log(8, 's')],
    expect: ['f1', 's', 'm', 'f2'],
    ask: {
      choices: ['f1 f2 s m', 'f1 s f2 m', 'f1 s m f2', 's f1 m f2'],
      answer: 2,
      explain: "This await waits for a timer, a task. So f() can't resume until that task has run: the script prints s, the microtask prints m, and only after the timer's task resolves the promise does f2 print.",
    },
  },
];

/* ------------------------------------------------------------------ */
/* Chapter 6: Node                                                     */
/* ------------------------------------------------------------------ */

export const NODE_IO: Program = {
  id: 'node-io',
  file: 'app.js',
  policy: 'node',
  code: `const fs = require('node:fs');

fs.readFile(__filename, () => {
  setTimeout(() => {
    console.log('timeout');
  }, 0);
  setImmediate(() => {
    console.log('immediate');
  });
});`,
  main: [
    { op: 'stmt', line: 1 },
    {
      op: 'readFile',
      line: 3,
      ms: 6,
      fn: fn(
        '',
        [
          { op: 'timeout', line: 4, ms: 0, fn: say(5, 'timeout', 'timeout → log') },
          { op: 'immediate', line: 7, fn: say(8, 'immediate', 'immediate → log') },
        ],
        'readFile callback',
      ),
    },
  ],
  expect: ['immediate', 'timeout'],
};

/* ------------------------------------------------------------------ */
/* Playground                                                          */
/* ------------------------------------------------------------------ */

export type BlockKind = 'log' | 'timeout' | 'timeout100' | 'then' | 'micro' | 'async' | 'fetch';

export interface Block {
  id: number;
  kind: BlockKind;
}

export const BLOCK_INFO: Record<BlockKind, { label: string; lines: number; logs: number; hint: string }> = {
  log: { label: 'console.log', lines: 1, logs: 1, hint: 'runs now' },
  timeout: { label: 'setTimeout 0', lines: 1, logs: 1, hint: 'task' },
  timeout100: { label: 'setTimeout 100', lines: 1, logs: 1, hint: 'task, later' },
  then: { label: 'Promise.then', lines: 2, logs: 1, hint: 'microtask' },
  micro: { label: 'queueMicrotask', lines: 1, logs: 1, hint: 'microtask' },
  async: { label: 'async + await', lines: 5, logs: 2, hint: 'split in two' },
  fetch: { label: 'fetch().then', lines: 2, logs: 1, hint: 'network → task → microtask' },
};

export interface BuiltProgram {
  program: Program;
  /** Letters each block prints, in code order */
  letters: string[][];
}

export function buildProgram(blocks: Block[]): BuiltProgram {
  const code: string[] = [];
  const main: Op[] = [];
  const letters: string[][] = [];
  let next = 0;
  const letter = () => String.fromCharCode(65 + next++);
  for (const b of blocks) {
    const line = code.length + 1;
    if (b.kind === 'log') {
      const l = letter();
      letters.push([l]);
      code.push(`console.log('${l}');`);
      main.push(log(line, l));
    } else if (b.kind === 'timeout' || b.kind === 'timeout100') {
      const l = letter();
      const ms = b.kind === 'timeout' ? 0 : 100;
      letters.push([l]);
      code.push(`setTimeout(() => console.log('${l}'), ${ms});`);
      main.push({ op: 'timeout', line, ms, fn: say(line, l, `timeout → ${l}`) });
    } else if (b.kind === 'then') {
      const l = letter();
      letters.push([l]);
      code.push('Promise.resolve()', `  .then(() => console.log('${l}'));`);
      main.push({ op: 'stmt', line, dur: 0.3 }, { op: 'then', line: line + 1, fn: say(line + 1, l, `then → ${l}`) });
    } else if (b.kind === 'micro') {
      const l = letter();
      letters.push([l]);
      code.push(`queueMicrotask(() => console.log('${l}'));`);
      main.push({ op: 'micro', line, fn: say(line, l, `microtask → ${l}`) });
    } else if (b.kind === 'async') {
      const l1 = letter();
      const l2 = letter();
      letters.push([l1, l2]);
      code.push('(async () => {', `  console.log('${l1}');`, '  await null;', `  console.log('${l2}');`, '})();');
      main.push({ op: 'call', line, label: 'async fn', fn: afn('async', [log(line + 1, l1), { op: 'await', line: line + 2, on: 'value' }, log(line + 3, l2)]) });
    } else if (b.kind === 'fetch') {
      const l = letter();
      letters.push([l]);
      code.push("fetch('/api/cart')", `  .then(() => console.log('${l}'));`);
      main.push({ op: 'fetch', line, url: '/api/cart', ms: 120 }, { op: 'then', line: line + 1, on: 'last', fn: say(line + 1, l, `then → ${l}`), wait: 'waits for fetch' });
    }
  }
  if (!code.length) code.push('// add a block to start');
  return { program: { id: `pg-${blocks.map((b) => b.kind).join('-')}`, file: 'playground.js', code: code.join('\n'), main }, letters };
}

export const PG_START: BlockKind[] = ['log', 'timeout', 'then', 'log'];
export const PG_MAX_BLOCKS = 6;
export const PG_MAX_LINES = 16;
