import type { ReactNode } from 'react';
import type { CodeSpec } from '@/components/lesson/CodeBlock';
import type { IconName } from '@/components/lesson/Icon';
import { Aside } from '@/components/lesson/Prose';
import type { QuizSpec } from '@/components/lesson/QuizCard';
import { Term } from '@/components/lesson/Term';
import type { LegendItem } from '@/components/stage/chrome';
import type { Callout } from '@/components/stage/overlays';
import { SIG } from '@/lib/sim/colors';
import type { ScriptEvent } from '@/lib/sim/Sim';
import type { HudKey, ReadoutKind } from './Overlay';
import type { GcSim } from './sim';
import {
  barrierRun,
  bugDoubleFree,
  bugLeak,
  bugUseAfterFree,
  copyDemo,
  compactDemo,
  cycleRound,
  dropTree,
  fragRound,
  introCall,
  leakStart,
  makeWeak,
  manualReset,
  markDemo,
  pyCollect,
  rcDemo,
  rootsLoop,
  splitCollect,
  splitDrop,
  splitReset,
  sweepDemo,
  weakReset,
} from './stories';
import type { GcConfig } from './types';

export const LESSON = { slug: 'garbage-collection', code: 'CS-05', track: 'Computer science', title: 'Garbage Collection' };

export type Interaction =
  | { kind: 'actions'; prompt?: ReactNode; kicker?: string; buttons: { label: string; icon?: IconName; run: (sim: GcSim) => void; after?: ReactNode }[] }
  | { kind: 'toggle'; prompt: ReactNode; kicker?: string; initial?: number; options: { label: string; apply: (sim: GcSim) => void; note?: ReactNode }[] }
  | {
      kind: 'slider';
      prompt?: ReactNode;
      sliders: { label: string; min: number; max: number; step: number; initial: (cfg: GcConfig) => number; format?: (v: number) => string; ends?: [string, string]; apply: (sim: GcSim, v: number) => void }[];
      stats?: (sim: GcSim) => ReactNode;
      done?: (sim: GcSim) => ReactNode;
    }
  | { kind: 'playground' };

export interface Step {
  id: string;
  title: string;
  body: ReactNode;
  cfg?: Partial<GcConfig>;
  /** Rebuild the world when the step starts (default true) */
  reset?: boolean;
  script?: ScriptEvent<GcSim>[];
  predict?: { needed: number; prompt: ReactNode };
  interactions?: Interaction[];
  /** land: only on wide stages (phones show the note line instead) */
  callouts?: (Callout & { land?: boolean })[];
  legend?: LegendItem[];
  focus?: string[];
  code?: CodeSpec;
  hud?: HudKey[];
  readout?: ReadoutKind;
  quiz?: QuizSpec;
  extra?: ReactNode;
  seed?: number;
}

export interface Chapter {
  id: string;
  title: string;
  cfg?: Partial<GcConfig>;
  steps: Step[];
}

/* ---------- legend vocabulary ---------- */

const L = {
  obj: { label: 'object', color: SIG.line, shape: 'square' },
  ref: { label: 'reference', color: SIG.line, shape: 'line' },
  unreachable: { label: 'unreachable', color: SIG.err, shape: 'square' },
  garbage: { label: 'garbage', color: SIG.err, shape: 'square' },
  leaked: { label: 'leaked', color: SIG.err, shape: 'square' },
  trace: { label: 'trace from roots', color: SIG.res },
  marked: { label: 'marked (live)', color: SIG.res, shape: 'square' },
  worklist: { label: 'in the worklist', color: SIG.warn, shape: 'ring' },
  count: { label: 'reference count', color: SIG.hc, shape: 'ring' },
  dec: { label: 'count −1', color: SIG.hc },
  weak: { label: 'weak reference', color: SIG.hc, shape: 'line' },
  dangling: { label: 'dangling pointer', color: SIG.err, shape: 'line' },
  freedC: { label: 'freed', color: SIG.heavy, shape: 'square' },
  young: { label: 'young object', color: SIG.req, shape: 'square' },
  old: { label: 'old object', color: SIG.hc, shape: 'square' },
  dead: { label: 'dead, not yet collected', color: SIG.err, shape: 'square' },
  minor: { label: 'minor GC', color: SIG.heavy, shape: 'square' },
  major: { label: 'major GC', color: SIG.err, shape: 'square' },
  full: { label: 'full GC', color: SIG.err, shape: 'square' },
  app: { label: 'app running', color: SIG.req, shape: 'line' },
  pause: { label: 'stop-the-world pause', color: SIG.err, shape: 'square' },
  markSeg: { label: 'mark', color: SIG.hc, shape: 'square' },
  sweepSeg: { label: 'sweep', color: SIG.heavy, shape: 'square' },
  hole: { label: 'free block', color: SIG.dim, shape: 'ring' },
  fits: { label: 'hole that fits', color: SIG.res, shape: 'ring' },
  small: { label: 'hole too small', color: SIG.warn, shape: 'ring' },
} satisfies Record<string, LegendItem>;

/* ================================================================== */

export const CHAPTERS: Chapter[] = [
  /* ================================================================ */
  {
    id: 'who-cleans-up',
    title: 'Who cleans up?',
    steps: [
      {
        id: 'objects-pile-up',
        title: 'Every object needs memory',
        cfg: { view: 'graph', scene: 'intro', heap: 'on' },
        script: [{ at: 0.3, run: (s) => introCall(s, 1) }],
        body: (
          <>
            <p>
              Every time your program creates an object, a list or a string, the runtime carves a piece out of a region of memory called the{' '}
              <Term k="heap">heap</Term>. Here a web server handles a request: it builds a request object, a user and a cart. Watch the heap fill up, block
              by block.
            </p>
            <p>
              The variables that point at those objects live on the <Term k="roots">stack</Term>, inside the function&apos;s frame. When{' '}
              <code>handleRequest()</code> returns, the frame is popped and the variables disappear on their own.
            </p>
            <p>
              The objects don&apos;t. They stay in the heap, taking up space nobody can use anymore. Handle a few more requests and the heap is full.
            </p>
            <Aside>Real heaps hold gigabytes, not 24 blocks of 16 bytes. The shape of the problem is the same.</Aside>
          </>
        ),
        callouts: [{ target: 'heap:used', text: <>still <b>taking memory</b> after return</>, dir: 'down', land: true }],
        hud: ['heap'],
        legend: [L.obj, L.unreachable],
        code: {
          title: 'server.js',
          lang: 'js',
          code: `
function handleRequest(req) {
!  const user = { id: 42, name: 'Alice' };   // allocated on the heap
!  const cart = { items: [] };
  cart.items.push(req.item);
  return render(user, cart);
}   // user and cart leave the stack. The objects stay.`,
        },
      },
      {
        id: 'freeing-by-hand',
        title: 'Freeing memory by hand',
        cfg: { view: 'graph', scene: 'manual', heap: 'on', ro: true },
        script: [{ at: 0, run: (s) => manualReset(s) }],
        body: (
          <>
            <p>
              In C you manage the heap yourself. <code>malloc</code> hands you a block and <code>free</code> gives it back. It&apos;s fast and
              predictable, and every call is your responsibility.
            </p>
            <p>
              Get the timing wrong and you hit one of three classic bugs. <strong>Forget to free</strong> and memory leaks until the program runs out.{' '}
              <strong>Free too early</strong> and a pointer still aims at memory that now belongs to someone else: a <strong>use-after-free</strong>.{' '}
              <strong>Free twice</strong> and you corrupt the allocator&apos;s own bookkeeping.
            </p>
            <p>Break it all three ways. The allocator&apos;s log shows what your program never sees.</p>
            <Aside>
              These aren&apos;t just crashes. Microsoft and Google&apos;s Chrome team have each reported that about 70% of their serious security bugs
              are memory-safety bugs like these.
            </Aside>
          </>
        ),
        interactions: [
          {
            kind: 'actions',
            kicker: 'Break it',
            buttons: [
              {
                label: 'Forget to free',
                icon: 'bolt',
                run: bugLeak,
                after: (
                  <>
                    Each loop overwrote <code>line</code> without freeing the old buffer. Unreachable, never given back: a <strong>leak</strong>.
                    Long-running servers die this way, slowly.
                  </>
                ),
              },
              {
                label: 'Free too early',
                icon: 'bolt',
                run: bugUseAfterFree,
                after: (
                  <>
                    <code>user</code> still holds the old address, and <code>malloc</code> handed that same block to <code>order</code>. Reading
                    through <code>user</code> now reads order data. Writing would corrupt it.
                  </>
                ),
              },
              {
                label: 'Free twice',
                icon: 'bolt',
                run: bugDoubleFree,
                after: (
                  <>
                    A second <code>free</code> would put the same block on the free list twice, so two later <code>malloc</code> calls could get
                    the same memory. glibc noticed and killed the process.
                  </>
                ),
              },
              { label: 'Reset', icon: 'replay', run: manualReset },
            ],
          },
        ],
        hud: ['heap'],
        readout: 'alloc',
        legend: [L.obj, L.dangling, L.freedC, L.leaked],
        code: {
          title: 'main.c',
          lang: 'c',
          code: `
char *line = malloc(32);
!line = malloc(32);            // leak: the first block is lost

struct user *u = malloc(sizeof *u);
free(u);
!printf("%s", u->name);        // use-after-free
!free(u);                      // double free`,
        },
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'reachability',
    title: 'What is garbage?',
    steps: [
      {
        id: 'start-from-the-roots',
        title: 'Start from the roots',
        cfg: { view: 'graph', scene: 'roots', heap: 'land' },
        script: [{ at: 0.6, run: rootsLoop }],
        body: (
          <>
            <p>
              A <strong>garbage collector</strong> flips the deal: you allocate, the runtime frees. It can&apos;t read your mind about what you&apos;ll
              need later, so it uses a rule it can check: <strong>reachability</strong>.
            </p>
            <p>
              The <Term k="roots">roots</Term> are references the program can use directly: local variables in each thread&apos;s stack frames, global
              variables, and values held in CPU registers, like the temporary string in <Term k="r:rax">rax</Term>. An object is <strong>live</strong>{' '}
              if you can reach it by following references from a root. Everything else is <strong>garbage</strong>.
            </p>
            <p>
              Watch the trace spread. <Term k="o:draft">draft</Term> and <Term k="o:note">note</Term> point at each other, and draft even points at a
              live object. But no path leads <em>to</em> them. Garbage.
            </p>
            <Aside>
              Reachable is a safe over-estimate. A reachable object may never be touched again (that&apos;s how leaks happen in garbage-collected
              languages), but an unreachable one never can be.
            </Aside>
          </>
        ),
        callouts: [{ target: 'o:draft', text: <>points out, but <b>nothing points in</b></>, dir: 'up' }],
        hud: ['reachable'],
        legend: [L.trace, L.marked, L.unreachable],
        code: {
          title: 'app.js',
          lang: 'js',
          code: `
!const cache = new Map();           // a global: always a root
function main() {
!  let user = loadUser(42);         // a local: a root while main() runs
!  let cart = { items: [item] };
  let draft = { note, product };
!  draft = null;                    // the old draft is unreachable now
}`,
        },
      },
      {
        id: 'snip',
        title: 'Snip! What’s garbage now?',
        cfg: { view: 'graph', scene: 'shop', heap: 'land', cut: 'predict' },
        predict: { needed: 3, prompt: 'After each cut, click an object on the stage that just became garbage. If none did, press the button.' },
        body: (
          <>
            <p>
              Your turn. <strong>Click any arrow</strong> to delete that reference, as if the program ran <code>user.profile = null</code> or{' '}
              <code>cart = null</code>. Then predict which object just became garbage.
            </p>
            <p>
              Look for three situations. A <strong>shared</strong> object, like the <Term k="o:avatar">avatar</Term> that both the profile and the
              global cache point at. A <strong>chain</strong>, where one cut strands everything behind it. And the <Term k="o:sessA">session</Term>{' '}
              <strong>cycle</strong>, two objects pointing at each other.
            </p>
          </>
        ),
        hud: ['reachable'],
        legend: [L.ref, L.trace, L.garbage],
        code: {
          title: 'app.js',
          lang: 'js',
          code: `
!user.profile = null;   // cut one reference
!cart = null;           // cut a root: what's behind it may go too
session = null;        // two objects pointing at each other: garbage?`,
        },
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'refcount',
    title: 'Reference counting',
    cfg: { view: 'graph', rc: true, heap: 'land' },
    steps: [
      {
        id: 'count-the-references',
        title: 'Count the references',
        cfg: { scene: 'rc' },
        script: [{ at: 0.2, run: rcDemo }],
        body: (
          <>
            <p>
              The simplest automatic scheme: every object keeps a <strong>reference count</strong>, the number of references pointing at it (the
              purple badges). Storing a reference adds one. Overwriting or dropping one subtracts one.
            </p>
            <p>
              When a count hits <strong>zero</strong>, nothing can reach the object, so it&apos;s freed on the spot, and its own references are
              dropped too. <code>user.profile = null</code> frees the profile, but the <Term k="o:avatar">avatar</Term> survives at 1: the global cache
              still holds it. Then <code>cart = null</code> takes the cart, the item and the product down in a chain.
            </p>
            <p>
              No pauses and no separate collector: memory comes back the moment it becomes garbage. CPython works this way, and so do Swift and
              Objective-C (as ARC), C++&apos;s <code>shared_ptr</code> and Rust&apos;s <code>Rc</code>.
            </p>
          </>
        ),
        hud: ['freed', 'updates'],
        legend: [L.count, L.dec, L.garbage],
        code: {
          title: 'refs.py',
          lang: 'python',
          code: `
import sys
a = []
b = [a]                      # a is referenced by the name a and by b[0]
!print(sys.getrefcount(a))   # 3
!del b                       # b's list is freed, a's count drops by one`,
          note: 'The count includes the temporary reference held by the call itself. Python 3.14 can borrow that reference and report one less.',
        },
      },
      {
        id: 'snip-and-count',
        title: 'Your turn: snip and count',
        cfg: { scene: 'rc', cut: 'free' },
        body: (
          <>
            <p>
              Cut references and watch the counts. Each cut sends a <strong>−1</strong> to the object it pointed at, and every object that reaches
              zero releases its own references in turn.
            </p>
            <p>
              Notice the hidden cost. Every pointer write in the program also updates a count, and when threads share objects those updates must be
              atomic, which is slow. Swift and CPython put a lot of work into skipping redundant updates, and most high-performance runtimes chose a
              tracing collector instead.
            </p>
          </>
        ),
        interactions: [
          {
            kind: 'actions',
            prompt: 'Can you free the avatar? How many cuts does it take?',
            buttons: [{ label: 'Reset the graph', icon: 'replay', run: (s) => s.resetScene('rc') }],
          },
        ],
        hud: ['freed', 'updates'],
        legend: [L.count, L.dec, L.garbage],
      },
      {
        id: 'the-cycle-problem',
        title: 'The cycle problem',
        cfg: { scene: 'cycle' },
        predict: { needed: 2, prompt: 'The root variable goes away. What does reference counting free?' },
        script: [{ at: 1.1, run: (s) => cycleRound(s, 1) }],
        body: (
          <>
            <p>
              Two structures, two root variables. On top, a chain: <Term k="o:page">page</Term> → para → text. Below, a <strong>cycle</strong>: a{' '}
              <Term k="o:parent">parent</Term> that points at its <Term k="o:child">child</Term>, and a child that points back at its parent. Trees with
              parent links, doubly linked lists and observers that point back at their owners all look like this.
            </p>
            <p>The program is about to drop each root. Predict what reference counting frees each time.</p>
          </>
        ),
        hud: ['freed'],
        legend: [L.count, L.dec, L.leaked],
        code: {
          title: 'tree.py',
          lang: 'python',
          code: `
class Node:
    def __init__(self):
        self.children, self.parent = [], None

parent, child = Node(), Node()
parent.children.append(child)
!child.parent = parent     # a cycle: each keeps the other's count up
!del parent, child         # unreachable, yet neither count reaches 0`,
        },
      },
      {
        id: 'breaking-cycles',
        title: 'Breaking cycles',
        cfg: { scene: 'weak', heap: 'off', ro: true },
        body: (
          <>
            <p>
              Two ways out. The first is a <strong>weak reference</strong>: a reference that doesn&apos;t count. Make the child&apos;s link to its
              parent weak and the cycle no longer props itself up. Swift has <code>weak var parent</code>, Python has the <code>weakref</code> module.
            </p>
            <p>
              The second is a backup collector. CPython runs a <strong>cycle detector</strong> over container objects every so often. It copies each
              count and subtracts the references that come from <em>inside</em> the group. Anything still above zero is referenced from outside, so it
              survives, along with everything it reaches. The rest is an unreachable cycle.
            </p>
            <p>
              Try both. Drop <code>tree</code> with the strong back-link and run <code>gc.collect()</code>. Then reset, make the link weak first, and
              drop it again.
            </p>
          </>
        ),
        interactions: [
          {
            kind: 'actions',
            buttons: [
              { label: 'tree = None', icon: 'power', run: dropTree },
              { label: 'gc.collect()', icon: 'replay', run: pyCollect },
              { label: 'Make child.parent weak', icon: 'code', run: makeWeak },
              { label: 'Reset', icon: 'replay', run: weakReset },
            ],
          },
        ],
        hud: ['freed'],
        readout: 'cycle',
        legend: [L.count, L.weak, L.dec, L.leaked],
        code: {
          title: 'tree.py',
          lang: 'python',
          code: `
import gc, weakref

!child.parent = weakref.ref(parent)   # doesn't bump the count
parent = None                         # freed at once, the child with it

# or keep the strong cycle and let the detector find it:
!gc.collect()    # returns how many unreachable objects it found`,
        },
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'mark-sweep',
    title: 'Mark and sweep',
    steps: [
      {
        id: 'mark',
        title: 'Mark: follow every reference',
        cfg: { view: 'graph', scene: 'mark', heap: 'on', ro: true },
        script: [{ at: 0.8, run: markDemo }],
        body: (
          <>
            <p>Tracing collectors skip the counting. Every so often they find the live objects directly, starting from the roots.</p>
            <p>
              The <strong>mark</strong> phase keeps a <strong>worklist</strong>. It starts with whatever the roots point at. It takes an object off the
              list, sets the <strong>mark bit</strong> on everything that object references, and adds the newly marked ones to the list. When the list
              runs dry, every reachable object is marked.
            </p>
            <p>
              A marked object is never queued twice, so cycles can&apos;t trap the marker. And the <Term k="o:draft">draft ↔ note</Term> cycle? No path
              leads there, so it&apos;s simply never visited.
            </p>
            <Aside>
              Textbooks call the three states white (not found), gray (found, waiting in the worklist) and black (scanned). The names come back in
              chapter 7.
            </Aside>
          </>
        ),
        hud: ['reachable'],
        readout: 'worklist',
        legend: [L.worklist, L.marked, L.trace],
        code: {
          title: 'mark.js',
          lang: 'js',
          code: `
function mark(roots) {
  const worklist = [];
  for (const obj of roots) shade(obj, worklist);
  while (worklist.length) {
    const obj = worklist.pop();              // scan it
    for (const ref of obj.refs) shade(ref, worklist);
  }
}
function shade(obj, worklist) {
!  if (obj.marked) return;                    // seen it: cycles stop here
!  obj.marked = true;
  worklist.push(obj);
}`,
        },
      },
      {
        id: 'sweep',
        title: 'Sweep: free everything unmarked',
        cfg: { view: 'graph', scene: 'mark', heap: 'on' },
        script: [{ at: 0.6, run: sweepDemo }],
        body: (
          <>
            <p>
              Then the <strong>sweep</strong>: walk the entire <Term k="heap">heap</Term> in address order. An unmarked object is garbage, so its memory
              goes onto a <strong>free list</strong> for future allocations. A marked object is live; the sweeper just clears its bit for next time.
            </p>
            <p>
              The garbage cycle goes along with everything else. Tracing never looks at counts, only at reachability. This is <strong>mark-sweep</strong>
              , the collector John McCarthy described for Lisp in 1960.
            </p>
            <p>
              Notice what each phase costs: marking touches every <em>live</em> object, sweeping touches the <em>whole heap</em>.
            </p>
          </>
        ),
        callouts: [{ target: 'heap', text: <>the sweep walks <b>every block</b></>, dir: 'down', land: true }],
        hud: ['heap', 'freed'],
        legend: [L.marked, L.garbage, L.hole],
        code: {
          title: 'sweep.js',
          lang: 'js',
          code: `
function sweep(heap) {
  for (const obj of heap) {            // every object, in address order
!    if (obj.marked) obj.marked = false;
!    else freeList.push(obj);           // its memory can be reused
  }
}`,
        },
      },
      {
        id: 'counting-vs-tracing',
        title: 'Counting vs tracing, side by side',
        cfg: { view: 'split', scene: 'split' },
        script: [{ at: 0, run: splitReset }],
        body: (
          <>
            <p>
              The same program runs twice: reference counting on the left, mark-sweep on the right. <Term k="o:a.page">page</Term> and{' '}
              <Term k="o:a.para">para</Term> form a cycle, and the root variable <code>doc</code> holds the page.
            </p>
            <p>Drop the root on both sides, then run both collectors. Which one gets the cycle back?</p>
          </>
        ),
        interactions: [
          {
            kind: 'actions',
            buttons: [
              {
                label: 'doc = null',
                icon: 'power',
                run: splitDrop,
                after: <>Left: page&apos;s count went from 2 to 1 and stopped there. Right: nothing happens until a collection runs.</>,
              },
              {
                label: 'Run both collectors',
                icon: 'replay',
                run: splitCollect,
                after: (
                  <>
                    Counting leaks the cycle for good. Tracing starts from the roots, never reaches it, and the sweep frees it. (Press them in the other
                    order and nothing is freed on either side.)
                  </>
                ),
              },
              { label: 'Reset', icon: 'replay', run: splitReset },
            ],
          },
        ],
        legend: [L.count, L.trace, L.leaked, L.garbage],
      },
      {
        id: 'stop-the-world',
        title: 'The price: stopping the world',
        cfg: { view: 'threads', gcMode: 'stw', liveMB: 300 },
        body: (
          <>
            <p>
              There&apos;s a catch. If the program keeps changing references while the marker is halfway through, it can hide a live object: move the
              only pointer to it into an object the marker has already scanned. The sweep would then free something still in use.
            </p>
            <p>
              The classic answer is blunt: <strong>stop the world</strong>. Every <Term k="lanes:app">application thread</Term> is paused while the{' '}
              <Term k="lanes:gc">collector</Term> marks and sweeps, then everything resumes. Each red block is a pause: no requests handled, no frames
              drawn.
            </p>
            <p>Drag the slider. Marking visits every live object, so the pause grows with the amount of live data.</p>
            <Aside>Illustrative numbers. Real pauses depend on the collector, the number of cores and the shape of the object graph.</Aside>
          </>
        ),
        interactions: [
          {
            kind: 'slider',
            sliders: [
              {
                label: 'Live data on the heap',
                min: 50,
                max: 1000,
                step: 50,
                initial: (c) => c.liveMB,
                format: (v) => `${v} MB`,
                ends: ['small', 'large'],
                apply: (s, v) => s.setLiveMB(v),
              },
            ],
            stats: (s) => (
              <span>
                each pause ≈ <b data-bad={s.threads.stwMs() > 150}>{s.threads.stwMs()} ms</b>
              </span>
            ),
            done: (s) =>
              s.cfg.liveMB >= 800 ? (
                <>
                  <strong>That&apos;s a stutter you can see.</strong> A few hundred milliseconds freezes a UI or times out a busy API. The next chapters
                  are about avoiding exactly this.
                </>
              ) : null,
          },
        ],
        hud: ['tlLongest', 'tlPaused'],
        legend: [L.app, L.pause, L.markSeg, L.sweepSeg],
        code: {
          title: 'terminal',
          lang: 'shell',
          code: `
$ java -XX:+UseSerialGC -Xlog:gc -jar app.jar
[1.412s][info][gc] GC(0) Pause Young (Allocation Failure) 67M->9M(247M) 11.412ms
![9.187s][info][gc] GC(7) Pause Full (Allocation Failure) 812M->421M(1023M) 386.228ms`,
          note: 'The Serial collector stops the world for every collection. Heap before → after (total), then the pause.',
        },
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'fragmentation',
    title: 'Holes in the heap',
    cfg: { view: 'heap' },
    steps: [
      {
        id: 'swiss-cheese',
        title: 'Swiss cheese memory',
        cfg: { scene: 'frag', play: 'frag', ro: true },
        predict: { needed: 2, prompt: 'Will the new object fit in the heap?' },
        script: [{ at: 1, run: (s) => fragRound(s, 1) }],
        body: (
          <>
            <p>
              Sweeping frees memory exactly where it lies. After a few collections the <Term k="heap">heap</Term> looks like Swiss cheese: plenty of
              free space in total, chopped into small <strong>holes</strong> between live objects.
            </p>
            <p>
              An object needs one <strong>contiguous</strong> run of memory. The allocator walks its free list looking for the first hole that&apos;s
              big enough (<strong>first-fit</strong>). Two allocations are coming. Predict whether each one fits.
            </p>
            <Aside>
              When an allocation fails, a garbage-collected runtime collects and tries again, or grows the heap. C&apos;s <code>malloc</code> asks
              the operating system for more memory first and returns <code>NULL</code> only when that fails too.
            </Aside>
          </>
        ),
        hud: ['free', 'largest'],
        readout: 'holes',
        legend: [L.obj, L.hole, L.fits, L.small],
        code: {
          title: 'alloc.c',
          lang: 'c',
          code: `
char *buf = malloc(48);    // 3 blocks: the first hole that fits
!char *big = malloc(80);    // 5 blocks: 6 are free, but not in one piece`,
        },
      },
      {
        id: 'mark-compact',
        title: 'Mark-compact: slide everything together',
        cfg: { scene: 'compact', play: 'compact', ro: true },
        script: [{ at: 0.3, run: compactDemo }],
        body: (
          <>
            <p>
              A <strong>mark-compact</strong> collector fixes fragmentation. After marking, it slides every live object toward the start of the heap,
              closing the gaps. Free memory ends up as one run at the end.
            </p>
            <p>
              Moving an object changes its address, so every reference to it must be rewritten, in the roots and inside other objects. The collector
              first computes a <strong>forwarding address</strong> for each live object, then fixes every pointer, then moves the memory.
            </p>
            <p>
              The payoff: allocation becomes a <strong>bump pointer</strong>. No free list to search, just take the next N bytes and add N to the
              pointer.
            </p>
          </>
        ),
        hud: ['free', 'largest'],
        readout: 'forward',
        legend: [L.marked, L.garbage, L.hole],
        code: {
          title: 'terminal',
          lang: 'shell',
          code: `
$ node --trace-gc server.js
![4127:0x118008000]  6590 ms: Mark-Compact 81.2 (98.4) -> 52.7 (93.1) MB, 21.40 / 0.00 ms  (average mu = 0.981, current mu = 0.964) allocation failure; GC in old space requested`,
          note: 'V8 collects its old generation with mark-compact. Heap used before → after in MB (reserved in parentheses), then the pause. The format varies a little between Node versions.',
        },
      },
      {
        id: 'copying',
        title: 'Copying collectors',
        cfg: { scene: 'copy', play: 'copy', ro: true },
        script: [{ at: 0.3, run: copyDemo }],
        body: (
          <>
            <p>
              A <strong>copying collector</strong> reaches the same goal another way. It splits the heap into two halves and allocates from only one,
              the <strong>from-space</strong>, with a bump pointer.
            </p>
            <p>
              At collection time it copies every reachable object into the empty <strong>to-space</strong>, packed tight, and leaves a forwarding
              address behind so later references to the same object find the copy. Then the whole from-space is free at once, and the halves swap
              roles.
            </p>
            <p>
              The work is proportional to the <strong>live</strong> objects only; garbage is never even looked at. The price: half the heap sits
              empty. That trade is perfect when most objects are garbage, which brings us to the young.
            </p>
            <Aside>This is Cheney&apos;s algorithm (1970). No mark bits, no recursion: the to-space itself is the worklist.</Aside>
          </>
        ),
        hud: ['free'],
        readout: 'copy',
        legend: [L.marked, L.garbage, L.hole],
        code: {
          title: 'terminal',
          lang: 'shell',
          code: `
!$ node --max-semi-space-size=32 server.js`,
          note: 'V8’s young generation is a copying collector over two semi-spaces. This flag sets the maximum size of each half, in MB; they start small and grow.',
        },
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'generations',
    title: 'Most objects die young',
    cfg: { view: 'gen', scene: 'gen' },
    steps: [
      {
        id: 'die-young',
        title: 'Most objects die young',
        cfg: { generational: false, allocRate: 9, ro: true },
        body: (
          <>
            <p>
              Measure a real program and a pattern jumps out: <strong>most objects die young</strong>. Temporary strings, iterator objects, the
              intermediate arrays of <code>.map().filter()</code>, the request object of a finished request: garbage within microseconds to
              milliseconds. The few that survive a while (caches, sessions, configuration) tend to live a long time.
            </p>
            <p>
              Each cell here is an object. New ones appear in the <Term k="zone:heap">heap</Term> and most turn into hatched garbage almost at once.
              The <strong>age at death</strong> histogram piles up on the left.
            </p>
            <p>
              This is the <strong>generational hypothesis</strong>. It suggests an idea: if new objects are mostly garbage, collect the new ones often
              and leave the old ones alone.
            </p>
          </>
        ),
        hud: ['allocated', 'young'],
        readout: 'hist',
        legend: [L.young, L.dead, L.full],
      },
      {
        id: 'young-and-old',
        title: 'Young and old generations',
        cfg: { generational: true, allocRate: 9 },
        body: (
          <>
            <p>
              A <strong>generational collector</strong> splits the heap. New objects are born in the <Term k="zone:eden">eden</Term> space of the{' '}
              <strong>young generation</strong>. When eden fills, a <strong>minor GC</strong> traces only the young generation, copies the few survivors
              into a <Term k="zone:surv">survivor space</Term>, and wipes eden in one go. It&apos;s a copying collector, so it only pays for survivors.
            </p>
            <p>
              Survive a couple of minor GCs and you&apos;re <strong>promoted</strong> to the <Term k="zone:old">old generation</Term>. It fills slowly,
              so the expensive <strong>major GC</strong> (mark-compact over everything) runs rarely.
            </p>
            <p>
              Watch the <Term k="chart">pause chart</Term>: frequent, tiny orange minor pauses and the occasional tall red one.
            </p>
            <Aside>
              Pauses are animated in slow motion; real minor GCs usually take about a millisecond. JVMs keep two survivor spaces that swap roles on
              each minor GC; here they&apos;re drawn as one.
            </Aside>
          </>
        ),
        hud: ['minor', 'major', 'last'],
        legend: [L.young, L.old, L.dead, L.minor, L.major],
        code: {
          title: 'terminal',
          lang: 'shell',
          code: `
$ node --trace-gc server.js
![4127:0x118008000]   812 ms: Scavenge 9.8 (12.1) -> 8.9 (13.1) MB, 0.91 / 0.00 ms  (average mu = 1.000, current mu = 1.000) allocation failure;
![4127:0x118008000]   904 ms: Scavenge 10.0 (13.1) -> 9.1 (14.1) MB, 0.84 / 0.00 ms  (average mu = 1.000, current mu = 1.000) allocation failure;
[4127:0x118008000]  6590 ms: Mark-Compact 81.2 (98.4) -> 52.7 (93.1) MB, 21.40 / 0.00 ms  (average mu = 0.981, current mu = 0.964) allocation failure; GC in old space requested`,
          note: 'Scavenge is V8’s minor GC over the young generation; Mark-Compact is its major GC.',
        },
      },
      {
        id: 'allocation-rate',
        title: 'Turn up the allocation rate',
        cfg: { generational: true, allocRate: 9 },
        body: (
          <>
            <p>
              Your turn. The slider sets how fast the program allocates. Faster allocation fills eden sooner, so minor GCs come more often. More
              objects get promoted too, so major GCs arrive sooner.
            </p>
            <p>
              Then switch to <strong>one big heap</strong>. Every collection becomes a <strong>full GC</strong> that re-traces all the long-lived
              objects every time, and the pauses grow. That&apos;s the whole case for generations: spend the effort where the garbage is.
            </p>
          </>
        ),
        interactions: [
          {
            kind: 'slider',
            sliders: [
              {
                label: 'Allocation rate',
                min: 3,
                max: 40,
                step: 1,
                initial: (c) => c.allocRate,
                format: (v) => `${v} objects/s`,
                ends: ['calm', 'frantic'],
                apply: (s, v) => s.setAllocRate(v),
              },
            ],
            stats: (s) => {
              const st = s.gen.stats();
              return (
                <>
                  <span>
                    minor <b>{st.minor}</b>
                  </span>
                  <span>
                    {s.cfg.generational ? 'major' : 'full'} <b data-bad={st.major > 0}>{st.major}</b>
                  </span>
                  <span>
                    longest pause <b data-bad={st.longest >= 15}>{st.longest ? `${st.longest.toFixed(1)} ms` : '–'}</b>
                  </span>
                </>
              );
            },
          },
          {
            kind: 'toggle',
            prompt: 'Heap layout (switching starts the heap over):',
            options: [
              { label: 'Generational', apply: (s) => s.setGenerational(true), note: <>Short minor pauses most of the time, and a major GC now and then.</> },
              {
                label: 'One big heap',
                apply: (s) => s.setGenerational(false),
                note: <>Every GC now traces every live object, including the long-lived ones it traced last time.</>,
              },
            ],
          },
        ],
        hud: ['minor', 'major', 'longest', 'avgMinor'],
        legend: [L.young, L.old, L.dead, L.minor, { label: 'major or full GC', color: SIG.err, shape: 'square' }],
      },
      {
        id: 'write-barriers',
        title: 'Old objects pointing at young ones',
        cfg: { generational: true, genPaused: true, scene: 'barrier', ro: true },
        script: [{ at: 0.2, run: (s) => barrierRun(s, true) }],
        body: (
          <>
            <p>
              A minor GC only traces the young generation. But what if an old object points at a young one? Here a long-lived{' '}
              <Term k="glabel:cache">cache</Term> in the old generation stores a brand-new <Term k="glabel:entry">entry</Term>. No root points at the
              entry. Only the cache does.
            </p>
            <p>
              So the runtime adds a <strong>write barrier</strong>: a few instructions compiled into every pointer store. When a store makes an old
              object point at a young one, the barrier records it in a <Term k="gen:rs">remembered set</Term> (often a <strong>card table</strong>,
              one byte per small slice of the old generation). Minor GCs treat those entries as extra roots.
            </p>
            <p>Run it both ways. Without the barrier, the collector frees an object that&apos;s still in use.</p>
          </>
        ),
        interactions: [
          {
            kind: 'actions',
            buttons: [
              { label: 'Run with the barrier', icon: 'replay', run: (s) => barrierRun(s, true) },
              {
                label: 'Run without it',
                icon: 'bolt',
                run: (s) => barrierRun(s, false),
                after: <>The minor GC never looked inside the old generation, so it decided the entry was garbage. The cache now points at freed memory.</>,
              },
            ],
          },
        ],
        hud: ['minor', 'last'],
        readout: 'rs',
        legend: [L.young, L.old, L.dead, L.trace],
        code: {
          title: 'barrier.js',
          lang: 'js',
          code: `
// what the compiler emits for:  cache.entry = entry
cache.entry = entry;
!if (isOld(cache) && isYoung(entry)) rememberedSet.add(cache);`,
        },
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'real-world',
    title: 'Pauses and leaks',
    steps: [
      {
        id: 'shorter-pauses',
        title: 'Shorter pauses',
        cfg: { view: 'threads', gcMode: 'stw', liveMB: 600 },
        body: (
          <>
            <p>
              Modern collectors attack the pause itself. <strong>Parallel</strong> collection uses several GC threads during the pause, so it ends
              sooner. <strong>Incremental</strong> collection chops the work into small slices between bits of the program. <strong>Concurrent</strong>{' '}
              collection runs on other cores <em>while the program keeps going</em>, and stops the world only briefly to start and to finish.
            </p>
            <p>
              Running alongside the program brings back the problem from chapter 4: references keep moving while the marker works. Write barriers
              solve it again. While marking is in progress, every pointer store also reports the objects involved to the marker (shading them
              gray), so no live object can slip past it.
            </p>
            <p>
              V8&apos;s Orinoco marks concurrently and scavenges in parallel. Java&apos;s G1 aims for a pause-time target, and ZGC keeps pauses
              typically under a millisecond, even on huge heaps. Go&apos;s collector marks concurrently too.
            </p>
            <Aside>
              Concurrency isn&apos;t free. The collector&apos;s threads use CPU the program could have used, and barriers add work to pointer writes.
              You trade some throughput for shorter pauses.
            </Aside>
          </>
        ),
        interactions: [
          {
            kind: 'toggle',
            prompt: 'Pick a collector design:',
            options: [
              { label: 'Stop the world', apply: (s) => s.setGcMode('stw'), note: <>One long pause per cycle. Simple, and the best throughput.</> },
              { label: 'Parallel', apply: (s) => s.setGcMode('parallel'), note: <>Still stops the world, but two GC threads finish in about half the time.</> },
              { label: 'Incremental', apply: (s) => s.setGcMode('incremental'), note: <>The same work in small slices. More pauses, each one short.</> },
              {
                label: 'Concurrent',
                apply: (s) => s.setGcMode('concurrent'),
                note: <>Marking runs next to the app. Only two tiny pauses per cycle, while the app shares its cores with the collector.</>,
              },
            ],
          },
        ],
        hud: ['tlLongest', 'tlPauses', 'tlPaused'],
        legend: [L.app, L.pause, L.markSeg, L.sweepSeg],
        code: {
          title: 'terminal',
          lang: 'shell',
          code: `
$ java -XX:+UseG1GC -XX:MaxGCPauseMillis=50 -Xlog:gc -jar app.jar
[2.918s][info][gc] GC(0) Pause Young (Normal) (G1 Evacuation Pause) 24M->4M(256M) 3.172ms
![9.604s][info][gc] GC(5) Pause Young (Concurrent Start) (G1 Evacuation Pause) 121M->98M(256M) 6.851ms
![9.604s][info][gc] GC(6) Concurrent Mark Cycle
[9.690s][info][gc] GC(6) Pause Remark 104M->104M(256M) 1.201ms
[9.702s][info][gc] GC(6) Pause Cleanup 104M->104M(256M) 0.212ms
[9.705s][info][gc] GC(6) Concurrent Mark Cycle 101.023ms`,
          note: 'G1 has been the JVM’s default collector since Java 9. Short pauses bracket a marking cycle that runs alongside the application.',
        },
      },
      {
        id: 'find-the-leak',
        title: 'Find the leak',
        cfg: { view: 'graph', scene: 'leak', heap: 'off' },
        predict: { needed: 1, prompt: 'Which reference, repeated once per report, is the leak? Click it on the stage.' },
        script: [{ at: 0.2, run: leakStart }],
        body: (
          <>
            <p>
              A garbage collector frees what&apos;s unreachable. It can&apos;t free what you&apos;re still, by accident, holding on to. Leaks are
              alive and well in JavaScript, Java, Python and Go.
            </p>
            <p>
              This page opens a report in a modal. A closure listens for window resizes to redraw the report&apos;s chart, and each report holds 5 MB
              of rows. Closing the modal removes it from the page. Yet after every open and close, the heap after GC is 5 MB bigger.
            </p>
            <p>
              After the third round the lesson stops. <strong>Click the reference that keeps the old reports alive.</strong>
            </p>
            <Aside>
              The usual suspects: event listeners and timers nobody removes, caches and maps that only grow, global arrays, and closures that capture
              more than they need. In Chrome DevTools, compare two heap snapshots to see what piles up.
            </Aside>
          </>
        ),
        hud: ['mem', 'listeners'],
        legend: [L.ref, L.trace, L.garbage],
        code: {
          title: 'report.js',
          lang: 'js',
          code: `
function openReport() {
  const report = buildReport();                 // ~5 MB of rows
  const modal = showModal(report);
!  window.addEventListener('resize', () => drawChart(modal, report));
  modal.onClose = () => modal.remove();         // the listener stays behind
}

// The fix: remove the listener when the modal closes.
const controller = new AbortController();
!window.addEventListener('resize', redraw, { signal: controller.signal });
!modal.onClose = () => { controller.abort(); modal.remove(); };`,
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
        cfg: { view: 'gen', scene: 'gen', generational: true, allocRate: 14 },
        body: (
          <p>
            Everything in one place. On the stage, a generational heap keeps running: allocation in eden, cheap minor GCs, promotion, and the
            occasional major GC.
          </p>
        ),
        extra: 'cheat',
        hud: ['minor', 'major', 'longest'],
        legend: [L.young, L.old, L.dead, L.minor, L.major],
      },
      {
        id: 'playground',
        title: 'Playground',
        cfg: { view: 'graph', scene: 'pg', heap: 'on', cut: 'free', rc: true },
        body: (
          <p>
            Build your own object graph and pick a collector. Select a root or an object, add new objects under it or link it to another one, cut
            arrows, and watch the heap. Then take on the challenges.
          </p>
        ),
        interactions: [{ kind: 'playground' }],
        hud: ['heap', 'freed', 'largest'],
        legend: [L.count, L.marked, L.garbage, L.leaked],
      },
    ],
  },
];
