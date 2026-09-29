import type { ReactNode } from 'react';
import type { CodeSpec } from '@/components/lesson/CodeBlock';
import { Aside } from '@/components/lesson/Prose';
import type { QuizSpec } from '@/components/lesson/QuizCard';
import { Term } from '@/components/lesson/Term';
import type { LegendItem } from '@/components/stage/chrome';
import type { Callout } from '@/components/stage/overlays';
import { SIG } from '@/lib/sim/colors';
import {
  ASYNC_ROUNDS,
  AWAIT_FETCH,
  AWAIT_SPLIT,
  CALL_STACK,
  CLASSIC_ROUNDS,
  CLICKS,
  DRAIN,
  HAND_OFF,
  MINIMUM,
  NODE_IO,
  PROMISE_QUEUE,
  RENDER,
  ZERO_ROUNDS,
} from './programs';
import type { StepCfg } from './sim';
import { CheatSheet } from './Panel';

export type HudKey = 'clock' | 'tasks' | 'micro' | 'frames' | 'dropped' | 'delay' | 'longest' | 'fps';

export type Interaction =
  | { kind: 'stepper'; prompt?: string }
  | { kind: 'click' }
  | { kind: 'rerun' }
  | { kind: 'modes'; prompt: ReactNode; options: { label: string; mode: 'long' | 'chunk' | 'micro' | 'worker'; note?: ReactNode }[]; initial: number }
  | { kind: 'playground' };

export interface Step {
  id: string;
  title: string;
  body: ReactNode;
  cfg: StepCfg;
  /** Correct answers needed (PredictGame) */
  predict?: number;
  predictPrompt?: ReactNode;
  interaction?: Interaction;
  callouts?: Callout[];
  legend?: LegendItem[];
  hud?: HudKey[];
  quiz?: QuizSpec;
  code?: CodeSpec;
  code2?: CodeSpec;
  extra?: ReactNode;
}

export interface Chapter {
  id: string;
  title: string;
  steps: Step[];
}

export const LESSON = { slug: 'event-loop', code: 'CS-02', track: 'Computer science', title: 'The Event Loop' };

const L_TASK: LegendItem = { label: 'task', color: SIG.req };
const L_MICRO: LegendItem = { label: 'microtask', color: SIG.hc };
const L_RENDER: LegendItem = { label: 'render', color: SIG.res };
const L_SYNC: LegendItem = { label: 'script / function', color: SIG.line, shape: 'square' };
const L_LOOP: LegendItem = { label: 'event loop', color: SIG.warn, shape: 'ring' };

const COLOR_NAME: Record<string, string> = { [SIG.req]: 'cyan', [SIG.hc]: 'violet', [SIG.res]: 'green', [SIG.heavy]: 'orange', [SIG.err]: 'red' };
/** Steps before microtasks are introduced: dim the microtask queue. */
const TASK_ONLY = ['code', 'console', 'stack', 'apis', 'q:task', 'ring', 'shelf'];

const T = (c: string) => <strong style={{ color: c }}>{COLOR_NAME[c]}</strong>;

export const CHAPTERS: Chapter[] = [
  /* ================================================================ */
  {
    id: 'one-thread',
    title: 'One thread',
    steps: [
      {
        id: 'call-stack',
        title: 'One thread, one call stack',
        cfg: { view: 'machine', programs: [CALL_STACK], loop: true, focus: ['code', 'stack', 'console'] },
        body: (
          <>
            <p>
              JavaScript runs your code on a <strong>single thread</strong>: one worker, doing one thing at a time. To remember where it is, it keeps a{' '}
              <strong>call stack</strong>.
            </p>
            <p>
              Calling a function <strong>pushes a frame</strong> onto the <Term k="stack">stack</Term>. Returning <strong>pops</strong> it off. The top
              frame is the code running right now. Every frame below it is paused, waiting for the call above it to return.
            </p>
            <p>
              Watch <code>main()</code> call <code>greet()</code>, wait for its answer, then call <code>console.log()</code>. When the stack is empty
              again, the script is done.
            </p>
          </>
        ),
        interaction: { kind: 'stepper' },
        callouts: [{ target: 'stack', text: <>the <b>top frame</b> is what runs</>, dir: 'right' }],
        legend: [L_SYNC],
        code: {
          title: 'DevTools console',
          lang: 'shell',
          code: `Uncaught Error: out of greetings
!    at greet (greet.js:2:9)
!    at main (greet.js:5:15)
!    at greet.js:8:1`,
          note: 'A stack trace is a snapshot of the call stack at the moment of an error: the top frame first, down to the script that started it all.',
        },
      },
      {
        id: 'hand-it-off',
        title: 'Hand the waiting to the browser',
        cfg: { view: 'machine', programs: [HAND_OFF], loop: true, focus: TASK_ONLY },
        body: (
          <>
            <p>
              One thread means JavaScript can&apos;t afford to wait. If <code>setTimeout</code> sat on the stack for a whole second, nothing else could
              happen: no click handlers, no key presses, no screen updates.
            </p>
            <p>
              So it doesn&apos;t wait. <code>setTimeout</code> hands the timer to the browser&apos;s <Term k="apis">Web APIs</Term> and returns right
              away. The browser counts down on its own while your script carries on.
            </p>
            <p>
              When time is up, the browser doesn&apos;t interrupt anything. It puts the callback in the <Term k="q:task">task queue</Term>, and the{' '}
              <Term k="ring">event loop</Term> moves it onto the stack, but only once the stack is empty.
            </p>
            <Aside>Node.js does the same job with libuv, a C library with its own timers and a thread pool for file I/O. More on Node in chapter 6.</Aside>
          </>
        ),
        callouts: [{ target: 'wide:api:first', text: <>the browser counts, <b>not JavaScript</b></>, dir: 'down' }],
        legend: [L_SYNC, L_TASK, L_LOOP],
        hud: ['clock', 'tasks'],
        code: {
          title: 'timers.js',
          lang: 'js',
          code: `// Returns at once, with an id…
!const id = setTimeout(sendEmail, 1000);
// …so you can cancel it before it fires:
clearTimeout(id);`,
        },
      },
      {
        id: 'zero-is-not-now',
        title: 'Zero doesn’t mean now',
        cfg: { view: 'machine', programs: ZERO_ROUNDS, predict: 'order', focus: TASK_ONLY },
        predict: 2,
        predictPrompt: 'What will the console print?',
        body: (
          <>
            <p>A timer with a 0 ms delay is ready immediately. So does its callback run immediately?</p>
            <p>
              Your turn. Read each snippet and <strong>predict what the console prints</strong>, before anything runs. The animation waits for your
              answer, then shows you why.
            </p>
          </>
        ),
        legend: [L_SYNC, L_TASK],
        code: {
          title: 'focus.js',
          lang: 'js',
          code: `// Classic use: after the current code is done
!setTimeout(() => input.focus(), 0);`,
          note: 'Browsers also clamp nested timers: after 5 levels of setTimeout inside setTimeout, the minimum delay becomes 4 ms.',
        },
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'tasks',
    title: 'The task queue',
    steps: [
      {
        id: 'every-click-is-a-task',
        title: 'Every click is a task',
        cfg: { view: 'machine', programs: [CLICKS], focus: TASK_ONLY },
        body: (
          <>
            <p>
              The task queue isn&apos;t only for timers. Clicks, key presses, network events and messages all arrive as <strong>tasks</strong>.
            </p>
            <p>
              Your turn: <strong>click Buy</strong> on the stage a few times, quickly. Each click becomes a card in the{' '}
              <Term k="q:task">task queue</Term>. The loop takes <strong>one task at a time</strong>, runs it to completion, then comes back for the
              next.
            </p>
            <p>
              The interval&apos;s <code>tick</code> gets no special treatment. It never interrupts a click handler: it waits for the stack to empty,
              like every other task.
            </p>
            <Aside>
              Browsers really keep several task queues (input, timers, networking…) and favor some. Chrome runs a waiting click before a timer that
              came due earlier, so here a click can overtake a tick that is already queued. What never changes: one task at a time, and each runs to
              completion.
            </Aside>
          </>
        ),
        interaction: { kind: 'click' },
        callouts: [{ target: 'wide:api:listener', text: <>click <b>Buy</b>, quickly</>, dir: 'down' }],
        legend: [L_SYNC, L_TASK, L_LOOP],
        hud: ['clock', 'tasks'],
        code: {
          title: 'cart.js',
          lang: 'js',
          code: `button.addEventListener('click', (event) => {
!  // runs later, as a task, on an empty stack
  addToCart(event.target.dataset.sku);
});`,
        },
      },
      {
        id: 'timers-are-a-minimum',
        title: 'Timers are a minimum',
        cfg: { view: 'machine', programs: [MINIMUM], loop: true, focus: TASK_ONLY },
        body: (
          <>
            <p>
              A running task can&apos;t be interrupted. This script asks for a callback in 100 ms, then keeps the stack busy for 300 ms with a busy loop
              (the {T(SIG.heavy)} frame).
            </p>
            <p>
              The timer does expire at 100 ms, and its callback lands in the <Term k="q:task">task queue</Term> right on time. But it can&apos;t run
              until the stack is empty, so it prints <code>timer 300</code> or a few ms more, never <code>timer 100</code>.
            </p>
            <p>
              The delay you pass to <code>setTimeout</code> is a <strong>minimum</strong>, not a promise. Every long task delays everything queued
              behind it.
            </p>
          </>
        ),
        hud: ['clock'],
        legend: [L_SYNC, { label: 'busy loop', color: SIG.heavy, shape: 'square' }, L_TASK],
        quiz: {
          question: 'A click arrives 50 ms into that 300 ms busy loop. When does its handler run?',
          options: [
            {
              text: 'Immediately: the click interrupts the loop',
              why: 'Nothing interrupts a running task. JavaScript finishes whatever is on the stack first. That rule is called run-to-completion.',
            },
            {
              text: 'After the loop ends, when the event loop reaches its task',
              correct: true,
              why: 'The click is queued as a task the moment it happens. It runs once the stack is empty and the loop picks it up.',
            },
            {
              text: 'Never: browsers drop input while the page is busy',
              why: "Input isn't dropped, it's queued. That's why a frozen page suddenly catches up on all your clicks at once.",
            },
          ],
        },
        code: {
          title: 'late.js',
          lang: 'js',
          code: `const t0 = performance.now();
setTimeout(() => {
!  const late = performance.now() - t0 - 100;
!  console.log(\`late by \${late} ms\`);
}, 100);`,
        },
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'microtasks',
    title: 'Microtasks',
    steps: [
      {
        id: 'the-microtask-queue',
        title: 'Promises have their own queue',
        cfg: { view: 'machine', programs: [PROMISE_QUEUE], loop: true },
        body: (
          <>
            <p>
              Promise callbacks don&apos;t go in the task queue. They go in the <Term k="q:micro">microtask queue</Term>, a separate line with a
              stricter rule.
            </p>
            <p>
              <code>Promise.resolve()</code> is already resolved, so <code>.then()</code> queues its callback straight away ({T(SIG.hc)}). The
              timer&apos;s callback still takes the long way: Web APIs, then the task queue ({T(SIG.req)}).
            </p>
            <p>
              After every task, including your script, the loop runs <strong>every microtask</strong> before it looks at the task queue again. So C
              beats B, even though B was scheduled first.
            </p>
          </>
        ),
        interaction: { kind: 'stepper' },
        callouts: [{ target: 'wide:q:micro', text: <>runs <b>right after</b> each task</>, dir: 'down' }],
        legend: [L_SYNC, L_TASK, L_MICRO, L_LOOP],
        code: {
          title: 'microtasks.js',
          lang: 'js',
          code: `!queueMicrotask(() => flushUpdates());
promise.then(onDone).catch(onError);
!await somePromise; // the rest of the function
new MutationObserver(onChange)
  .observe(list, { childList: true });`,
          note: 'All four run their callbacks as microtasks: queueMicrotask directly, promise reactions, the code after an await, and MutationObserver change records.',
        },
      },
      {
        id: 'task-or-microtask',
        title: 'Task or microtask?',
        cfg: { view: 'machine', programs: CLASSIC_ROUNDS, predict: 'decide' },
        predict: 2,
        predictPrompt: 'The stack is empty. What runs next?',
        body: (
          <>
            <p>
              The classic interview puzzle. As it runs, the stack empties several times, and each time the loop must choose: the microtask queue, or the
              task queue?
            </p>
            <p>
              The animation freezes at each choice. <strong>Click the card that runs next</strong> on the stage, or pick below.
            </p>
            <Aside>
              <code>promise2</code> isn&apos;t queued until <code>promise1</code>&apos;s callback returns. Calling <code>.then()</code> on a pending
              promise only registers the callback (the dashed card on the shelf); it joins the queue when that promise resolves.
            </Aside>
          </>
        ),
        legend: [L_SYNC, L_TASK, L_MICRO, L_LOOP],
      },
      {
        id: 'drained-until-empty',
        title: 'Drained until empty',
        cfg: { view: 'machine', programs: [DRAIN], loop: true },
        body: (
          <>
            <p>
              Here&apos;s what makes microtasks special: the loop doesn&apos;t run <em>one</em> microtask per turn. It runs them{' '}
              <strong>until the queue is empty</strong>, including any that are queued while it drains.
            </p>
            <p>
              Each call to <code>again()</code> queues another microtask, and the loop keeps going. The timeout, which was queued first, waits until the
              chain ends.
            </p>
            <p>Three rounds is harmless. A chain that never ends would freeze the page as surely as an infinite loop. You&apos;ll see that in chapter 5.</p>
          </>
        ),
        callouts: [{ target: 'wide:q:micro', text: <>keeps draining <b>as it refills</b></>, dir: 'down' }],
        legend: [L_SYNC, L_TASK, L_MICRO, L_LOOP],
        hud: ['micro', 'tasks'],
      },
      {
        id: 'where-rendering-fits',
        title: 'Where rendering fits',
        cfg: { view: 'machine', programs: [RENDER], loop: true },
        body: (
          <>
            <p>
              Once per display refresh (60 times a second on a typical screen), the browser gets a chance to <strong>render</strong>: run{' '}
              <code>requestAnimationFrame</code> callbacks, recalculate styles, lay out the page and paint pixels.
            </p>
            <p>
              Rendering only happens <strong>between tasks</strong>, after the microtasks are drained. That&apos;s the whole loop:{' '}
              <strong>one task → all microtasks → render if a frame is due → repeat</strong>.
            </p>
            <p>
              Watch the <Term k="screen">screen</Term>: the box only moves when the loop passes the render step and paints. The dashed outline is where
              the DOM already says it is. Most turns skip rendering because no frame is due yet.
            </p>
            <Aside>
              Time is slowed way down here. Frames are 16.7 ms apart, and a turn of the loop often takes a fraction of a millisecond. The timer&apos;s
              task usually runs before the first frame, as it does here, but that isn&apos;t guaranteed: run the same code from a click handler and
              Chrome paints the frame first, because it hurries a frame after input.
            </Aside>
          </>
        ),
        legend: [L_SYNC, L_TASK, L_RENDER, L_LOOP],
        hud: ['clock', 'frames'],
        code: {
          title: 'animate.js',
          lang: 'js',
          code: `function tick(now) {
  const x = (now / 10) % 300;
  box.style.transform = \`translateX(\${x}px)\`;
!  requestAnimationFrame(tick); // next frame
}
requestAnimationFrame(tick);`,
          note: 'rAF callbacks run in the render step, right before paint, once per frame.',
        },
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'async-await',
    title: 'async and await',
    steps: [
      {
        id: 'await-splits-a-function',
        title: 'await splits a function in two',
        cfg: { view: 'machine', programs: [AWAIT_SPLIT], loop: true },
        body: (
          <>
            <p>
              <code>async</code>/<code>await</code> is promises underneath. An async function runs <strong>synchronously until its first await</strong>.
              There it pauses: its frame leaves the stack, and the call returns a promise.
            </p>
            <p>
              The rest of the function becomes a <strong>continuation</strong>: a microtask that runs once the awaited value is ready.{' '}
              <code>null</code> is ready immediately, so watch the frame slide straight into the <Term k="q:micro">microtask queue</Term>.
            </p>
            <p>
              The script keeps going and prints 2 first. Then the loop drains microtasks, and <code>checkout()</code> resumes exactly where it left off,
              local variables intact.
            </p>
          </>
        ),
        interaction: { kind: 'stepper' },
        legend: [L_SYNC, L_MICRO, L_LOOP],
        code: {
          title: 'checkout.js',
          lang: 'js',
          code: `// What await means, written with promises:
function checkout() {
  console.log('1 · checkout starts');
!  return Promise.resolve(null).then(() => {
!    console.log('3 · after await');
!  });
}`,
          note: "Engines don't literally rewrite your function (the paused frame keeps its variables), but the ordering is exactly this.",
        },
      },
      {
        id: 'awaiting-the-network',
        title: 'Awaiting the network',
        cfg: { view: 'machine', programs: [AWAIT_FETCH], loop: true },
        body: (
          <>
            <p>
              <code>fetch()</code> works like a timer: it hands the request to the browser and immediately returns a <strong>pending promise</strong>.
            </p>
            <p>
              Awaiting a pending promise parks the function on the <Term k="shelf">shelf</Term> until the promise settles. Nothing is blocked
              meanwhile: the stack is empty, so the loop is free to handle clicks and paint.
            </p>
            <p>
              When the response arrives, the browser queues a <strong>task</strong> that resolves the promise, and resolving it queues the continuation
              as a <strong>microtask</strong>. Two hops, then <code>loadCart()</code> picks up where it left off.
            </p>
          </>
        ),
        callouts: [{ target: 'shelf', text: <>parked: <b>not</b> on the stack</>, dir: 'up' }],
        legend: [L_SYNC, L_TASK, L_MICRO, L_LOOP],
        hud: ['clock'],
        quiz: {
          question: 'While loadCart() waits for the network, what is on the call stack?',
          options: [
            {
              text: 'Nothing. The stack is empty and the loop is free.',
              correct: true,
              why: 'The paused function lives on the heap, attached to the promise. The stack is free for anything else.',
            },
            {
              text: 'loadCart(), paused at the await',
              why: "A paused async function doesn't hold the stack. That's the whole point: the thread is free while it waits.",
            },
            {
              text: 'fetch(), waiting for the response',
              why: 'fetch() returned a promise right away. The waiting happens in the browser’s network code, not in JavaScript.',
            },
          ],
        },
        code: {
          title: 'cart.js',
          lang: 'js',
          code: `async function loadCart() {
  // network → task → microtask:
!  const res = await fetch('/api/cart');
  // the body streams in later, so await again:
!  const cart = await res.json();
  renderCart(cart);
}`,
        },
      },
      {
        id: 'predict-the-async-order',
        title: 'Predict the async order',
        cfg: { view: 'machine', programs: ASYNC_ROUNDS, predict: 'order' },
        predict: 2,
        predictPrompt: 'What will the console print?',
        body: (
          <>
            <p>Time to put it together. Each snippet mixes async functions, microtasks and a timer.</p>
            <p>
              <strong>Predict the whole console output</strong> before it runs. Remember: an async function runs until its first <code>await</code>,
              and everything after it is a microtask.
            </p>
          </>
        ),
        legend: [L_SYNC, L_TASK, L_MICRO],
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'blocking',
    title: 'Blocking the loop',
    steps: [
      {
        id: 'a-long-task',
        title: 'A long task freezes the page',
        cfg: { view: 'browser', mode: 'long', auto: true },
        body: (
          <>
            <p>
              Here&apos;s a page with a JavaScript-drawn spinner and two buttons. Under it is a timeline like the one in DevTools&apos; Performance
              panel: <strong>input</strong>, the <strong>main thread</strong>, and the <strong>frames</strong> that reached the screen.
            </p>
            <p>
              <strong>Process orders</strong> does 1.5 seconds of work in a single task. Press it, then click <strong>Add to cart</strong> a few times
              while it runs. (Until you do, a demo replays it every few seconds.)
            </p>
            <p>
              For the whole task, the stack is busy. The loop can&apos;t render, so the spinner freezes and frames drop ({T(SIG.err)}). It can&apos;t
              run your click handlers either: they wait in the queue and then all run at once.
            </p>
            <Aside>
              Chrome calls any task over 50 ms a <strong>long task</strong> (the red corner and hatching). CSS animations of transform and opacity can
              keep running on the compositor thread during one, but this spinner is driven by JavaScript, and anything your code renders needs the main
              thread.
            </Aside>
          </>
        ),
        interaction: { kind: 'rerun' },
        hud: ['fps', 'dropped', 'delay', 'longest'],
        legend: [
          { label: 'long task', color: SIG.heavy, shape: 'square' },
          { label: 'click handler', color: SIG.req, shape: 'square' },
          { label: 'frame painted', color: SIG.res, shape: 'square' },
          { label: 'frame dropped', color: SIG.err, shape: 'square' },
        ],
        code: {
          title: 'orders.js',
          lang: 'js',
          code: `processBtn.addEventListener('click', () => {
  // 3,000 orders × 0.5 ms = 1.5 s, one task
!  for (const order of orders) process(order);
  status.textContent = 'Done';
});`,
        },
      },
      {
        id: 'break-it-up',
        title: 'Break the work into chunks',
        cfg: { view: 'browser', mode: 'chunk', auto: true },
        body: (
          <>
            <p>
              The fix is to do the same work in small pieces and <strong>yield to the event loop</strong> between them. Each chunk becomes its own task,
              so between chunks the loop can paint a frame and run any clicks that came in.
            </p>
            <p>
              Switch strategies and compare the timelines. The total work is the same (it even takes about a third longer), but the spinner keeps
              turning and every click is handled within milliseconds.
            </p>
            <p>
              Where it&apos;s supported (Chromium browsers first), <code>await scheduler.yield()</code> puts your continuation at the front of the
              queue instead of the back. Clicks still get in and the work finishes sooner, but in Chrome it also goes ahead of rendering, so frames are
              painted less often.
            </p>
          </>
        ),
        interaction: {
          kind: 'modes',
          prompt: 'How should processAll() run?',
          initial: 1,
          options: [
            { label: 'One long task', mode: 'long' },
            { label: 'Chunks + setTimeout', mode: 'chunk' },
          ],
        },
        hud: ['fps', 'dropped', 'delay', 'longest'],
        legend: [
          { label: 'work', color: SIG.heavy, shape: 'square' },
          { label: 'click handler', color: SIG.req, shape: 'square' },
          { label: 'frame painted', color: SIG.res, shape: 'square' },
          { label: 'frame dropped', color: SIG.err, shape: 'square' },
        ],
        code: {
          title: 'orders.js',
          lang: 'js',
          code: `async function processAll(orders) {
  let last = performance.now();
  for (const order of orders) {
    process(order);
!    if (performance.now() - last > 12) {
!      await yieldToLoop(); // clicks + frames
      last = performance.now();
    }
  }
}

function yieldToLoop() {
  if (globalThis.scheduler?.yield) {
    return scheduler.yield();
  }
  return new Promise((r) => setTimeout(r, 0));
}`,
        },
      },
      {
        id: 'microtasks-cant-yield',
        title: 'Microtasks can’t yield',
        cfg: { view: 'browser', mode: 'micro', auto: true },
        body: (
          <>
            <p>
              A tempting shortcut: yield with <code>await Promise.resolve()</code> instead of a timer. Each chunk still ends, so it <em>looks</em> like
              yielding.
            </p>
            <p>
              But the continuation is a <strong>microtask</strong>, and the loop drains every microtask before it renders or takes another task. The
              chunks ({T(SIG.hc)}) run back to back as one giant task: the spinner freezes and the clicks wait, exactly like before.
            </p>
            <p>
              Only a real <strong>task boundary</strong> gives rendering and input a turn: a timer, a message, or <code>scheduler.yield()</code>.
            </p>
          </>
        ),
        interaction: {
          kind: 'modes',
          prompt: 'How should each chunk yield?',
          initial: 0,
          options: [
            { label: 'await Promise.resolve()', mode: 'micro' },
            { label: 'await setTimeout', mode: 'chunk' },
          ],
        },
        hud: ['fps', 'dropped', 'delay', 'longest'],
        legend: [
          { label: 'chunk as microtask', color: SIG.hc, shape: 'square' },
          { label: 'chunk as task', color: SIG.heavy, shape: 'square' },
          { label: 'frame painted', color: SIG.res, shape: 'square' },
          { label: 'frame dropped', color: SIG.err, shape: 'square' },
        ],
        code: {
          title: 'yield.js',
          lang: 'js',
          code: `// A microtask: no frame, no click in between
!await Promise.resolve();

// A task: the loop gets a turn
!await new Promise((r) => setTimeout(r));`,
        },
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'beyond',
    title: 'Beyond the main thread',
    steps: [
      {
        id: 'web-workers',
        title: 'Hand heavy work to a worker',
        cfg: { view: 'browser', mode: 'worker', auto: true },
        body: (
          <>
            <p>
              Sometimes the work is simply big: parsing a huge file, resizing images, crunching numbers. A <strong>Web Worker</strong> runs JavaScript on
              another thread, with its own call stack, queues and event loop.
            </p>
            <p>
              The main thread only posts the data over, then receives <strong>message</strong> events (tasks) with progress and the result. The work
              runs on the worker lane, so frames keep painting and clicks are handled instantly.
            </p>
            <p>Workers can&apos;t touch the DOM, and data sent to them is copied (or transferred), so they suit pure computation.</p>
          </>
        ),
        interaction: { kind: 'rerun' },
        hud: ['fps', 'dropped', 'delay', 'longest'],
        legend: [
          { label: 'worker thread', color: SIG.heavy, shape: 'square' },
          { label: 'tasks', color: SIG.req, shape: 'square' },
          { label: 'frame painted', color: SIG.res, shape: 'square' },
        ],
        code: {
          title: 'main.js + orders-worker.js',
          lang: 'js',
          code: `// main.js
const worker = new Worker('orders-worker.js');
!worker.postMessage(orders);  // a copy
!worker.onmessage = (e) => {  // a task
  show(e.data);
};

// orders-worker.js
onmessage = (e) => {
  postMessage(e.data.map(process));
};`,
        },
      },
      {
        id: 'node-js',
        title: 'Node.js: the same loop, in phases',
        cfg: { view: 'node', programs: [NODE_IO], loop: true },
        body: (
          <>
            <p>
              Node.js also runs your JavaScript on one thread, with <strong>libuv</strong> doing the waiting. Its loop goes around in{' '}
              <strong>phases</strong>: expired <strong>timers</strong>, pending callbacks, housekeeping, <strong>poll</strong> (run I/O callbacks, or
              wait for I/O), <strong>check</strong> (<code>setImmediate</code>), then close callbacks.
            </p>
            <p>
              Inside an I/O callback, <code>setImmediate</code> always beats <code>setTimeout(…, 0)</code>: check comes right after poll, while the
              timer has to wait for the next lap.
            </p>
            <p>
              Between callbacks, Node drains microtasks, just as a browser does after each task. <code>process.nextTick</code> callbacks get their own
              queue that runs even earlier.
            </p>
            <Aside>
              From the main module, the order of <code>setTimeout(…, 0)</code> and <code>setImmediate</code> isn&apos;t guaranteed: it depends on
              whether 1 ms has passed by the time the loop first checks its timers.
            </Aside>
          </>
        ),
        legend: [
          { label: 'timers', color: SIG.req },
          { label: 'I/O callback', color: SIG.teal },
          { label: 'setImmediate', color: SIG.pink },
          L_LOOP,
        ],
        hud: ['clock'],
        code: {
          title: 'main.js',
          lang: 'js',
          code: `// In the main module, the order can flip:
!setTimeout(() => console.log('timeout'), 0);
!setImmediate(() => console.log('immediate'));`,
          note: 'Inside an I/O callback (the stage), immediate always wins.',
        },
        code2: {
          title: 'ticks.cjs',
          lang: 'js',
          code: `Promise.resolve()
  .then(() => console.log('promise'));
process.nextTick(() => console.log('nextTick'));
!// CommonJS prints: nextTick, promise`,
          note: 'In an ES module the promise prints first: the module body itself runs from a microtask, so that queue drains before Node gets back to its nextTick queue.',
        },
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'recap',
    title: 'Recap & playground',
    steps: [
      {
        id: 'cheat-sheet',
        title: 'Cheat sheet',
        cfg: { view: 'machine', programs: [CLASSIC_ROUNDS[0]], loop: true },
        body: (
          <p>
            The whole lesson in one loop: the classic puzzle on repeat. One task, then every microtask, then (maybe) a frame, then the next task.
          </p>
        ),
        extra: <CheatSheet />,
        legend: [L_SYNC, L_TASK, L_MICRO, L_LOOP],
        hud: ['clock', 'tasks', 'micro'],
      },
      {
        id: 'playground',
        title: 'Playground',
        cfg: { view: 'machine', playground: true },
        body: (
          <p>
            Build a snippet from blocks and watch it run. Letters follow the order of the code, so any shuffling in the console is the event loop at
            work. Reorder blocks, step through, and try the challenges.
          </p>
        ),
        interaction: { kind: 'playground' },
        legend: [L_SYNC, L_TASK, L_MICRO, L_LOOP],
        hud: ['clock', 'tasks', 'micro'],
      },
    ],
  },
];
