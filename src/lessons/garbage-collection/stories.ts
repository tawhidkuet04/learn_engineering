import { SIG } from '@/lib/sim/colors';
import type { GenObj } from './gen';
import { BLOCK_BYTES, addrHex, type GcSim } from './sim';
import type { ObjKind } from './types';

/*
 * Choreography for individual steps: timed sequences and button actions that
 * drive the simulation through its public methods.
 */

/* ================================================================== */
/* Chapter 1: a request handler that never frees anything              */
/* ================================================================== */

const INTRO_OBJS: { id: string; label: string; kind: ObjKind; size: number; u: number; v: number; p: [number, number]; from: string }[] = [
  { id: 'req', label: 'req', kind: 'obj', size: 1, u: 0, v: 0.36, p: [0.36, 0], from: 'r:req' },
  { id: 'user', label: 'user', kind: 'obj', size: 2, u: 0, v: 0.68, p: [0.68, 0], from: 'r:user' },
  { id: 'name', label: '"Alice"', kind: 'str', size: 1, u: 0.46, v: 0.68, p: [0.68, 0.62], from: 'o:user' },
  { id: 'cart', label: 'cart', kind: 'obj', size: 1, u: 0, v: 1, p: [1, 0], from: 'r:cart' },
  { id: 'items', label: 'items', kind: 'arr', size: 2, u: 0.46, v: 1, p: [1, 0.62], from: 'o:cart' },
];

const FRAME_ROOTS = [
  { id: 'req', label: 'req', v: 0.36, px: 0.36 },
  { id: 'user', label: 'user', v: 0.68, px: 0.68 },
  { id: 'cart', label: 'cart', v: 1, px: 1 },
];

/** One call to handleRequest(): allocate, return, leave the objects behind. Repeats until the heap is full. */
export function introCall(sim: GcSim, k = 1) {
  sim.memo.call = k;
  for (const r of FRAME_ROOTS) if (!sim.roots.has(r.id)) sim.addRoot({ ...r, section: 'stack', frame: 'handleRequest' });
  sim.note = { text: `handleRequest() · call #${k}`, tone: 'info' };
  sim.relayout();
  let t = 0.5;
  let failed = false;
  for (const spec of INTRO_OBJS) {
    sim.after(t, () => {
      if (failed) return;
      const addr = sim.firstFit(spec.size);
      if (addr < 0) {
        failed = true;
        const free = sim.freeBlocks().length;
        sim.banner = { text: 'out of memory', tone: 'bad' };
        sim.note = { text: `new ${spec.label} needs ${spec.size} blocks, ${free} free. Nobody gave any memory back.`, tone: 'bad' };
        sim.fx({ kind: 'text', at: sim.stripCenter(), text: 'heap full', color: SIG.err, dur: 2.4 });
        sim.rev++;
        return;
      }
      const id = `${spec.id}${k}`;
      sim.addObj({ id, label: spec.label, kind: spec.kind, size: spec.size, u: spec.u, v: spec.v, p: spec.p, addr });
      sim.link(spec.from.startsWith('o:') ? `o:${spec.from.slice(2)}${k}` : spec.from, `o:${id}`);
      sim.heapFx.push({ addr, size: spec.size, vt: sim.vt, color: SIG.req });
      sim.relayout();
      sim.rev++;
    });
    t += 0.55;
  }
  sim.after(t + 0.7, () => {
    if (failed) return;
    sim.note = { text: 'return: the stack frame is gone', tone: 'info' };
    for (const r of FRAME_ROOTS) sim.removeRoot(r.id);
    for (const spec of INTRO_OBJS) {
      const o = sim.objs.get(`${spec.id}${k}`);
      if (o) {
        o.fate = 'garbage';
        o.tag = spec.from.startsWith('r:') ? { text: 'unreachable', color: SIG.err } : null;
      }
    }
    sim.rev++;
  });
  sim.after(t + 2.3, () => {
    if (failed) return;
    // Out of sight for the program, but the memory is still taken.
    for (const spec of INTRO_OBJS) sim.retire(`${spec.id}${k}`);
    sim.rev++;
  });
  sim.after(t + 3, () => {
    if (!failed) introCall(sim, k + 1);
  });
}

/* ================================================================== */
/* Chapter 1: manual memory in C                                      */
/* ================================================================== */

function manualBase(sim: GcSim) {
  sim.resetScene('manual');
  sim.log = [
    { text: `malloc(48) → ${addrHex(0)}   user`, kind: 'dim' },
    { text: `malloc(32) → ${addrHex(3)}   cart`, kind: 'dim' },
  ];
  sim.freeList = [];
}

export function manualReset(sim: GcSim) {
  manualBase(sim);
  sim.note = null;
  sim.rev++;
}

/** Forget to free: every iteration allocates a new line and drops the pointer to the old one. */
export function bugLeak(sim: GcSim) {
  manualBase(sim);
  sim.busy = true;
  let k = 0;
  const tick = () => {
    k += 1;
    const addr = sim.firstFit(2);
    if (addr < 0) {
      const leaked = [...sim.objs.values()].filter((o) => o.fate === 'leaked').length;
      sim.log.push({ text: `malloc(32) → NULL`, kind: 'bad' });
      sim.banner = { text: 'out of memory', tone: 'bad' };
      sim.note = { text: `${leaked} lines leaked: unreachable, never freed, still taking ${leaked * 2} blocks.`, tone: 'bad' };
      sim.fx({ kind: 'text', at: sim.stripCenter(), text: 'malloc() returned NULL', color: SIG.err, dur: 2.4 });
      sim.busy = false;
      sim.rev++;
      return;
    }
    const prev = sim.rootEdge('line');
    const prevObj = prev ? sim.obj(prev.to) : undefined;
    const id = `line${k}`;
    sim.addObj({ id, label: 'line', kind: 'raw', size: 2, u: 0.3, v: 1, p: [1, 0.62], addr, sub: `char[32] #${k}` });
    if (prev) sim.unlink(prev.id);
    if (prevObj) {
      prevObj.fate = 'leaked';
      prevObj.tag = { text: 'leaked', color: SIG.err };
      const pid = prevObj.id;
      sim.after(0.35, () => sim.hide(`o:${pid}`));
    }
    sim.link('r:line', `o:${id}`);
    sim.heapFx.push({ addr, size: 2, vt: sim.vt, color: SIG.req });
    sim.log.push({ text: `malloc(32) → ${addrHex(addr)}   line = …`, kind: 'ok' });
    if (sim.log.length > 6) sim.log.shift();
    sim.note = { text: `loop #${k}: line = malloc(32);  // old line never freed`, tone: 'info' };
    sim.relayout();
    sim.rev++;
    sim.after(0.6, tick);
  };
  sim.after(0.3, tick);
}

/** Free too early: the pointer outlives the memory, which gets handed to someone else. */
export function bugUseAfterFree(sim: GcSim) {
  manualBase(sim);
  sim.busy = true;
  sim.after(0.4, () => {
    sim.freeManual('user');
    sim.note = { text: 'free(user);  // …but user is still used later', tone: 'info' };
  });
  sim.after(1.8, () => {
    const addr = sim.firstFit(3);
    sim.addObj({ id: 'order', label: 'order', kind: 'raw', size: 3, u: 0.3, v: 0.66, p: [0.66, 0.62], addr, sub: 'struct order' });
    sim.link('r:order', 'o:order');
    sim.retarget('r:user>o:user', 'o:order');
    sim.freeList = sim.freeList.filter((a) => a !== addr);
    sim.heapFx.push({ addr, size: 3, vt: sim.vt, color: SIG.warn });
    sim.log.push({ text: `malloc(48) → ${addrHex(addr)}   same address!`, kind: 'hot' });
    sim.note = { text: 'order = malloc(48);  // reuses the freed block', tone: 'info' };
    sim.relayout();
    sim.rev++;
  });
  sim.after(3.4, () => {
    const ob = sim.boxes.get('o:order');
    sim.fx({ kind: 'text', at: { id: 'o:order', dy: (ob?.h ?? 30) / 2 + 30 }, text: 'user->name reads "A-1043" ?!', color: SIG.err, dur: 3.4 });
    sim.note = { text: 'printf(user->name) prints order data. A write would corrupt the order.', tone: 'bad' };
    sim.banner = { text: 'use-after-free', tone: 'bad' };
    sim.busy = false;
    sim.rev++;
  });
}

/** Free twice: the allocator catches it and kills the process. */
export function bugDoubleFree(sim: GcSim) {
  manualBase(sim);
  sim.busy = true;
  sim.after(0.4, () => {
    sim.freeManual('cart');
    sim.note = { text: 'free(cart);', tone: 'info' };
  });
  sim.after(1.9, () => {
    sim.log.push({ text: `free(${addrHex(3)})   already free!`, kind: 'bad' });
    sim.note = { text: 'free(cart);  // a second time, from another code path', tone: 'info' };
    sim.fx({ kind: 'x', at: { id: 'r:cart' }, color: SIG.err, size: 1.4 });
    sim.rev++;
  });
  sim.after(2.8, () => {
    sim.log.push({ text: 'free(): double free detected in tcache 2', kind: 'bad' });
    sim.log.push({ text: 'Aborted (core dumped)', kind: 'bad' });
    while (sim.log.length > 6) sim.log.shift();
    sim.crash();
    sim.note = { text: 'glibc caught it this time. Undetected, the block sits in the free list twice.', tone: 'bad' };
    sim.busy = false;
    sim.rev++;
  });
}

/* ================================================================== */
/* Chapter 2: reachability                                            */
/* ================================================================== */

/** Trace from the roots over and over, tagging whatever the wave never reaches. */
export function rootsLoop(sim: GcSim) {
  const run = () => {
    for (const o of sim.liveObjs()) {
      o.tag = null;
      if (o.fate === 'garbage') o.fate = 'live';
    }
    sim.wave({
      step: 0.6,
      onDone: (reached) => {
        for (const o of sim.liveObjs()) {
          if (!reached.has(o.id)) {
            o.fate = 'garbage';
            o.tag = { text: 'unreachable', color: SIG.err };
          }
        }
        sim.rev++;
        sim.after(3.6, () => {
          sim.clearMarks();
          for (const o of sim.liveObjs()) o.tag = null;
          sim.after(0.9, run);
        });
      },
    });
  };
  run();
}

/* ================================================================== */
/* Chapter 3: reference counting                                      */
/* ================================================================== */

/** Two statements, two very different outcomes. */
export function rcDemo(sim: GcSim) {
  sim.after(1, () => {
    sim.note = { text: 'user.profile = null', tone: 'info' };
    sim.cut('o:user>o:profile');
  });
  sim.after(2.4, () => sim.sayAt('o:avatar', 'still 1: the cache holds it', SIG.hc, 2.4));
  sim.after(4.4, () => {
    sim.note = { text: 'cart = null', tone: 'info' };
    sim.cut('r:cart>o:cart');
  });
  sim.after(8, () => {
    sim.note = { text: 'Freed on the spot, one count at a time.', tone: 'ok' };
    sim.rev++;
  });
}

const CYCLE_CHOICES = [
  { id: 'all', label: 'All of them are freed' },
  { id: 'first', label: 'Only the first one' },
  { id: 'none', label: 'None of them' },
];

/** Drop the root of a chain (round 1) or of a cycle (round 2). Asks first. */
export function cycleRound(sim: GcSim, round: 1 | 2) {
  const root = round === 1 ? 'doc' : 'tree';
  const edge = sim.rootEdge(root);
  if (!edge) return;
  sim.note = { text: `${root} = null`, tone: 'info' };
  edge.flashVt = sim.vt;
  edge.flashColor = SIG.warn;
  const proceed = () => {
    sim.cut(edge.id);
    if (round === 1) sim.after(3.4, () => cycleRound(sim, 2));
    else {
      sim.after(1.6, () => {
        for (const id of ['parent', 'child']) {
          const o = sim.objs.get(id);
          if (o && o.fate === 'live') {
            o.fate = 'leaked';
            o.tag = { text: 'leaked', color: SIG.err };
          }
        }
        sim.note = { text: 'Unreachable, but each count is stuck at 1. Leaked.', tone: 'bad' };
        sim.rev++;
      });
    }
  };
  const game = sim.game;
  if (!game || game.done) {
    sim.after(0.6, proceed);
    return;
  }
  sim.after(0.7, () => {
    sim.ask('choice', {
      acceptable: [round === 1 ? 'all' : 'none'],
      choices: CYCLE_CHOICES,
      ask: round === 1 ? 'doc = null. What gets freed?' : 'tree = null. What gets freed?',
      askAt: { id: round === 1 ? 'o:page' : 'o:parent' },
      explain: (_, ok) =>
        round === 1
          ? `${ok ? '' : 'All three go. '}page drops to 0 and is freed. That releases its reference to para (0, freed), which releases text. One decrement cascades down the chain.`
          : `${ok ? '' : 'Nothing is freed. '}parent only drops from 2 to 1, because child still points at it. child stays at 1 because parent points at it. Neither count ever reaches 0.`,
      resolve: () => sim.after(0.2, proceed),
    });
  });
}

/* ---------- weak references and the cycle detector ---------- */

export function weakReset(sim: GcSim) {
  sim.resetScene('weak');
  sim.note = null;
  sim.log = [];
  sim.rev++;
}

export function makeWeak(sim: GcSim) {
  if (sim.busy) return;
  const e = sim.edges.get('o:child>o:parent');
  if (!e || e.removing || e.weak) return;
  sim.setWeak(e.id);
  sim.note = { text: 'child.parent = weakref.ref(parent)  # no longer counted', tone: 'info' };
}

export function dropTree(sim: GcSim) {
  if (sim.busy) return;
  const e = sim.rootEdge('tree');
  if (!e) return;
  sim.note = { text: 'tree = None', tone: 'info' };
  sim.cut(e.id);
  sim.after(1.5, () => {
    const p = sim.objs.get('parent');
    if (p && p.fate === 'live' && p.rc > 0) {
      for (const id of ['parent', 'child']) {
        const o = sim.objs.get(id);
        if (o && o.fate === 'live') o.tag = { text: 'leaked', color: SIG.err };
      }
      sim.note = { text: 'Counts stuck at 1: the cycle leaks. Try gc.collect().', tone: 'bad' };
    } else if (!p || p.fate === 'freed') sim.note = { text: 'The weak link didn’t count, so the whole cycle was freed.', tone: 'ok' };
    sim.rev++;
  });
}

/** CPython's cycle detector: subtract internal references; whatever drops to zero (and isn't reachable from something that didn't) is cyclic garbage. */
export function pyCollect(sim: GcSim) {
  if (sim.busy) return;
  sim.busy = true;
  sim.phase = 'cycle';
  const objs = sim.liveObjs();
  sim.log = [{ text: '1. gc_refs = refcount', kind: 'hot' }];
  sim.note = { text: 'gc.collect()', tone: 'info' };
  for (const o of objs) {
    o.gcRefs = o.rc;
    o.tag = null;
  }
  sim.rev++;
  const internal = sim.liveEdges().filter((e) => e.from.startsWith('o:') && !e.weak);
  sim.after(1.2, () => {
    sim.log.push({ text: '2. subtract references from inside', kind: 'hot' });
    internal.forEach((e, i) => {
      sim.after(i * 0.35, () => {
        sim.send({ from: e.from, to: e.to, dur: 0.5, color: SIG.hc, r: 3.2, lane: 0, label: '−1' });
        sim.after(0.5, () => {
          const t = sim.obj(e.to);
          if (t && t.gcRefs != null) {
            t.gcRefs -= 1;
            t.pulse = sim.vt;
          }
          sim.rev++;
        });
      });
    });
    sim.after(internal.length * 0.35 + 1, () => {
      sim.log.push({ text: '3. gc_refs > 0: referenced from outside', kind: 'hot' });
      // Anything with outside references is alive, and so is everything it reaches.
      const alive = new Set(objs.filter((o) => (o.gcRefs ?? 0) > 0).map((o) => o.id));
      let grew = true;
      while (grew) {
        grew = false;
        for (const e of internal) {
          const a = sim.obj(e.from);
          const b = sim.obj(e.to);
          if (a && b && alive.has(a.id) && !alive.has(b.id)) {
            alive.add(b.id);
            grew = true;
          }
        }
      }
      for (const o of objs) {
        if (alive.has(o.id)) {
          o.mark = 'black';
          o.tag = { text: 'reachable', color: SIG.res };
        } else {
          o.fate = 'garbage';
          o.tag = { text: 'cyclic garbage', color: SIG.err };
        }
      }
      sim.rev++;
      sim.after(1.6, () => {
        const dead = objs.filter((o) => !alive.has(o.id));
        sim.log.push({ text: `4. free the rest → returns ${dead.length}`, kind: dead.length ? 'ok' : 'dim' });
        for (const o of dead) sim.free(o.id);
        for (const o of objs) {
          o.gcRefs = null;
          if (alive.has(o.id)) {
            o.mark = 'white';
            o.tag = null;
          }
        }
        sim.note = dead.length
          ? { text: `Found an unreachable cycle and freed ${dead.length} objects.`, tone: 'ok' }
          : { text: 'Nothing to collect: every object is referenced from outside.', tone: 'info' };
        sim.phase = 'idle';
        sim.busy = false;
        sim.rev++;
      });
    });
  });
}

/* ================================================================== */
/* Chapter 4: mark and sweep                                          */
/* ================================================================== */

export function markDemo(sim: GcSim) {
  sim.banner = { text: 'GC: marking · app paused', tone: 'gc' };
  sim.markWorklist({
    step: 0.85,
    onDone: () => {
      sim.flagUnmarked(undefined, 'unmarked');
      const n = sim.liveObjs().length;
      const marked = sim.liveObjs().filter((o) => o.mark === 'black').length;
      sim.banner = null;
      sim.busy = false;
      sim.note = { text: `Marked ${marked} of ${n}. The other ${n - marked} were never reached.`, tone: 'ok' };
      sim.rev++;
    },
  });
}

export function sweepDemo(sim: GcSim) {
  sim.banner = { text: 'GC: marking · app paused', tone: 'gc' };
  sim.busy = true;
  sim.wave({
    step: 0.32,
    onDone: () => {
      sim.flagUnmarked(undefined, 'unmarked');
      sim.banner = { text: 'GC: sweeping · app paused', tone: 'gc' };
      sim.after(0.9, () =>
        sim.sweep({
          speed: 4.2,
          onDone: () => {
            const holes = sim.holes();
            const free = holes.reduce((s, h) => s + h.size, 0);
            sim.banner = null;
            sim.busy = false;
            sim.note = { text: `Freed ${sim.stats.lastBatch} objects. ${free} blocks free, in ${holes.length} separate holes.`, tone: 'ok' };
            sim.rev++;
          },
        }),
      );
    },
  });
}

/* ---------- side by side: counting vs tracing ---------- */

export function splitReset(sim: GcSim) {
  sim.resetScene('split');
  sim.paneMsg = [
    { text: 'counts: page 2 (doc, para) · para 1', kind: 'dim' },
    { text: 'No counts: frees only when it collects.', kind: 'dim' },
  ];
  sim.memo.dropped = false;
  sim.rev++;
}

export function splitDrop(sim: GcSim) {
  if (sim.busy || sim.memo.dropped) return;
  sim.memo.dropped = true;
  for (const k of ['a', 'b']) {
    const e = sim.rootEdge(`${k}.doc`);
    if (e) sim.cut(e.id);
  }
  sim.paneMsg = [
    { text: 'page 2 → 1: above 0, nothing freed.', kind: 'hot' },
    { text: 'Nothing yet: the tracer runs later.', kind: 'dim' },
  ];
  sim.rev++;
}

export function splitCollect(sim: GcSim) {
  if (sim.busy) return;
  sim.busy = true;
  const dropped = !!sim.memo.dropped;
  sim.paneMsg = [
    dropped ? { text: 'Stuck at 1 forever: page and para leak.', kind: 'bad' } : { text: 'Every count is above 0: nothing to free.', kind: 'dim' },
    { text: 'Marking from the roots…', kind: 'hot' },
  ];
  if (dropped) {
    for (const id of ['a.page', 'a.para']) {
      const o = sim.objs.get(id);
      if (o && o.fate === 'live') {
        o.fate = 'leaked';
        o.tag = { text: 'leaked', color: SIG.err };
      }
    }
  }
  sim.rev++;
  sim.wave({
    pane: 1,
    step: 0.5,
    onDone: () => {
      sim.flagUnmarked(1, 'unmarked');
      const garbage = sim.liveObjs(1).filter((o) => o.fate === 'garbage');
      sim.paneMsg = [sim.paneMsg[0], { text: garbage.length ? 'Sweeping the unmarked…' : 'All reachable: nothing to free.', kind: 'hot' }];
      sim.rev++;
      sim.after(1.1, () => {
        for (const o of garbage) sim.free(o.id);
        sim.paneMsg = [sim.paneMsg[0], garbage.length ? { text: `Freed ${garbage.length}: the cycle was never reached.`, kind: 'ok' } : { text: 'All reachable: nothing to free.', kind: 'dim' }];
        sim.clearMarks(1);
        sim.busy = false;
        sim.rev++;
      });
    },
  });
}

/* ================================================================== */
/* Chapter 5: fragmentation, compaction, copying                      */
/* ================================================================== */

export function fragRound(sim: GcSim, round: 1 | 2) {
  const size = round === 1 ? 3 : 5;
  const id = round === 1 ? 'buf' : 'big';
  const free = sim.freeBlocks().length;
  sim.note = { text: `new ${id}: ${size} blocks (${size * BLOCK_BYTES} B) · ${free} free`, tone: 'info' };
  sim.rev++;
  const proceed = () =>
    sim.scanAlloc(size, { id, label: id, kind: 'arr' }, () => {
      if (round === 1) sim.after(2.2, () => fragRound(sim, 2));
    });
  const game = sim.game;
  if (!game || game.done) {
    sim.after(0.8, proceed);
    return;
  }
  sim.after(0.9, () => {
    sim.ask('choice', {
      acceptable: [round === 1 ? 'yes' : 'no'],
      choices: [
        { id: 'yes', label: 'Yes, it fits' },
        { id: 'no', label: 'No, it won’t fit' },
      ],
      ask: `${free} blocks free. Will ${size} blocks fit?`,
      explain: () =>
        round === 1
          ? 'It fits. The allocator walks the holes in address order: 1 block, too small; 2 blocks, too small; 3 blocks at 0x090, taken.'
          : 'It doesn’t. 6 blocks are free in total, but the biggest hole is only 2 long, and an object needs one contiguous run of memory.',
      resolve: () => sim.after(0.2, proceed),
    });
  });
}

export function compactDemo(sim: GcSim) {
  sim.note = { text: 'new big: 5 blocks. No hole is big enough, so the runtime collects.', tone: 'info' };
  sim.after(1.6, () =>
    sim.markCompact(() =>
      sim.after(1.2, () => {
        const at = sim.bump ?? 0;
        sim.bumpAlloc(5, { id: 'big', label: 'big', kind: 'arr' });
        sim.note = { text: `new big → ${addrHex(at)}. Allocation is now a pointer bump: add 5, done.`, tone: 'ok' };
        sim.rev++;
      }),
    ),
  );
}

export function copyDemo(sim: GcSim) {
  sim.note = { text: 'From-space is full. Copy the survivors out.', tone: 'info' };
  sim.after(1.4, () => sim.copyCollect());
}

/* ================================================================== */
/* Chapter 6: generations                                             */
/* ================================================================== */

/** Old generation with a long-lived cache, a young generation with some fresh objects. */
function barrierWorld(sim: GcSim) {
  const gen = sim.gen;
  gen.reset();
  gen.generational = true;
  gen.paused = true;
  sim.box('gen:roots');
  sim.box('gen:rs');
  for (let i = 0; i < 11; i++) gen.alloc({ zone: 'old', life: 400, age: 2, label: i === 8 ? 'cache' : undefined, pinned: i === 8 });
  for (let i = 0; i < 9; i++) {
    const o = gen.alloc({ zone: 'eden', life: i % 3 === 0 ? 400 : 0.2 + i * 0.05 });
    if (o && i % 3 === 0) o.pinned = true;
  }
  sim.relayout();
  sim.snap();
}

export function barrierRun(sim: GcSim, withBarrier: boolean) {
  sim.clearTransient();
  sim.banner = null;
  barrierWorld(sim);
  const gen = sim.gen;
  gen.barrier = withBarrier;
  sim.note = { text: withBarrier ? 'Write barrier: on' : 'Write barrier: off (what could go wrong?)', tone: 'info' };
  sim.memo.barrier = withBarrier;
  sim.rev++;
  let entry: GenObj | null = null;
  const cache = gen.objs.find((o) => o.label === 'cache');
  sim.after(0.9, () => {
    entry = gen.alloc({ label: 'entry', pinned: true, viaOld: true });
    sim.note = { text: 'const entry = { key, value }  // young', tone: 'info' };
    sim.relayout();
    sim.rev++;
  });
  sim.after(2.2, () => {
    if (!entry || !cache) return;
    gen.links.push({ from: cache.id, to: entry.id });
    sim.note = { text: 'cache.set(key, entry)  // old → young', tone: 'info' };
    if (withBarrier) {
      gen.remembered.push({ from: cache.id, to: entry.id });
      sim.fx({ kind: 'ring', at: { id: cache.id }, color: SIG.hc, size: 1.3 });
      sim.sayAt(cache.id, 'barrier: remember this', SIG.hc, 2.2, (sim.boxes.get(cache.id)?.h ?? 20) + 34);
    } else {
      sim.sayAt(cache.id, 'no barrier: nobody notices', SIG.text2, 2.2, (sim.boxes.get(cache.id)?.h ?? 20) + 34);
    }
    sim.rev++;
  });
  sim.after(4, () => {
    sim.note = { text: 'Eden full: minor GC, young generation only', tone: 'info' };
    gen.startMinor();
  });
  sim.after(6.4, () => {
    if (!entry) return;
    if (entry.lost) {
      sim.note = { text: 'entry freed while cache still points at it!', tone: 'bad' };
      sim.banner = { text: 'live object freed', tone: 'bad' };
    } else sim.note = { text: 'entry survived: the remembered set is a root.', tone: 'ok' };
    sim.rev++;
  });
}

/* ================================================================== */
/* Chapter 7: the leak hunt                                           */
/* ================================================================== */

const BASE_MB = 12;

function leakSlot(slot: number) {
  const land = [0.1, 0.5, 0.9][slot];
  const px = [0, 0.5, 1][slot];
  return {
    clo: { u: 0.42, v: land, p: [px, 0.36] as [number, number] },
    rep: { u: 0.86, v: land - 0.115, p: [px, 0.7] as [number, number] },
    modal: { u: 0.86, v: land + 0.115, p: [px, 1] as [number, number] },
  };
}

export function leakStart(sim: GcSim) {
  sim.memo.k = 0;
  sim.memo.fixed = false;
  sim.memSeries = [BASE_MB];
  sim.after(0.6, () => leakCycle(sim));
}

function retainedMB(sim: GcSim) {
  const reports = sim.liveObjs().filter((o) => o.id.startsWith('rep')).length;
  return BASE_MB + reports * 5;
}

function leakCycle(sim: GcSim) {
  const k = sim.memo.k as number;
  const fixed = !!sim.memo.fixed;
  const slot = fixed ? 0 : k % 3;
  const pos = leakSlot(slot);
  const clo = `clo${k}`;
  const rep = `rep${k}`;
  const modal = `modal${k}`;
  sim.note = { text: `openReport()  #${k + 1}`, tone: 'info' };
  sim.addObj({ id: clo, label: 'onResize', kind: 'fn', size: 1, ...pos.clo });
  sim.addObj({ id: rep, label: 'report', kind: 'arr', size: 1, sub: '5 MB', ...pos.rep });
  sim.addObj({ id: modal, label: 'modal', kind: 'dom', size: 1, ...pos.modal });
  sim.link('o:body', `o:${modal}`, { bend: 0 });
  sim.link('o:listeners', `o:${clo}`);
  sim.link(`o:${clo}`, `o:${rep}`);
  sim.link(`o:${clo}`, `o:${modal}`);
  sim.relayout();
  sim.rev++;
  sim.after(1.8, () => {
    sim.note = { text: fixed ? 'closeReport(): controller.abort(); modal.remove()' : 'closeReport(): modal.remove()', tone: 'info' };
    sim.cut(`o:body>o:${modal}`);
    if (fixed) sim.after(0.3, () => sim.cut(`o:listeners>o:${clo}`));
    else {
      const m = sim.objs.get(modal);
      if (m) m.tag = { text: 'detached', color: SIG.heavy };
    }
    sim.rev++;
  });
  sim.after(2.9, () => {
    sim.note = { text: 'GC runs', tone: 'info' };
    const reach = sim.reach();
    const garbage = sim.liveObjs().filter((o) => !reach.has(o.id)).map((o) => o.id);
    sim.revealGarbage(garbage, () => {
      sim.memSeries.push(retainedMB(sim));
      if (sim.memSeries.length > 14) sim.memSeries.shift();
      const retained = retainedMB(sim);
      sim.note = garbage.length
        ? { text: `Freed ${garbage.length} objects. Heap after GC: ${retained} MB.`, tone: 'ok' }
        : { text: `Nothing was garbage. Heap after GC: ${retained} MB, and climbing.`, tone: 'bad' };
      sim.rev++;
      sim.memo.k = k + 1;
      if (!fixed && k + 1 === 3) sim.after(0.8, () => leakQuestion(sim));
      else sim.after(1.4, () => leakCycle(sim));
    });
  });
}

function leakQuestion(sim: GcSim) {
  const acceptable = [0, 1, 2].map((k) => `o:listeners>o:clo${k}`);
  const game = sim.game;
  if (!game || game.done) {
    leakFix(sim);
    return;
  }
  sim.ask('edge', {
    acceptable,
    ask: 'Click the reference that keeps old reports alive',
    askAt: { id: 'o:listeners' },
    explain: (picked, ok) => {
      if (ok) return 'That’s the leak. Every openReport() added a resize listener and nothing removed it. window → listeners → closure → report is a live path, so no collector is allowed to free them.';
      if (picked === 'r:window>o:listeners') return 'Cutting that drops every resize listener, including ones you still need. The bug is the one listener per report that is never removed.';
      if (picked.includes('>o:rep')) return 'That frees one report, but the closure and the detached modal it captured still leak. The root cause is the listener nobody removed.';
      if (picked.includes('>o:modal')) return 'The modal is small fry, and the closure would still hold the report. The root cause is the listener nobody removed.';
      return 'That path isn’t what keeps the old reports alive. Follow window → listeners → closure → report.';
    },
    resolve: () => sim.after(0.3, () => leakFix(sim)),
  });
}

/** removeEventListener for every stale listener, then collect. */
function leakFix(sim: GcSim) {
  sim.memo.fixed = true;
  sim.note = { text: 'Fix: remove each listener when its modal closes.', tone: 'ok' };
  const stale = sim.liveEdges().filter((e) => e.from === 'o:listeners');
  stale.forEach((e, i) => sim.after(0.25 * i, () => sim.cut(e.id)));
  sim.after(0.25 * stale.length + 0.8, () => {
    const reach = sim.reach();
    const garbage = sim.liveObjs().filter((o) => !reach.has(o.id)).map((o) => o.id);
    sim.revealGarbage(garbage, () => {
      sim.memSeries.push(retainedMB(sim));
      if (sim.memSeries.length > 14) sim.memSeries.shift();
      sim.note = { text: `Freed ${garbage.length} objects. Heap after GC: back to ${retainedMB(sim)} MB.`, tone: 'ok' };
      sim.rev++;
      sim.after(1.6, () => leakCycle(sim));
    });
  });
}
