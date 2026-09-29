/**
 * Runs the Event Loop lesson's own simulation headlessly: the same classes
 * that draw the stage, advanced frame by frame as the page does.
 */
import { CHAPTERS } from '@/lessons/event-loop/chapters';
import type { Program } from '@/lessons/event-loop/engine';
import { EventLoopSim } from '@/lessons/event-loop/sim';
import { MainThread, type ThreadMode } from '@/lessons/event-loop/thread';

/** The step that shows this program on the stage. */
export function stepOf(p: Program): string {
  for (const ch of CHAPTERS) for (const s of ch.steps) if (s.cfg.programs?.includes(p)) return s.id;
  throw new Error(`no step runs program ${p.id}`);
}

export interface SimRun {
  /** What the console printed, in order */
  out: string[];
  /** Where each line came from: script, task, micro, timer, immediate… */
  src: string[];
  /** Console lines and rAF callbacks ("frame"), in the order they happened */
  events: string[];
  frames: number;
  /** The machine's clock, virtual ms */
  ms: number;
  finished: boolean;
  sim: EventLoopSim;
}

/**
 * Play one program on the machine view at 1× speed, 60 frames a second.
 * `each` runs before every frame (to click, say); return true from it to stop.
 */
export function simulateProgram(p: Program, opts: { seconds?: number; each?: (sim: EventLoopSim) => boolean | void; keepGoing?: boolean } = {}): SimRun {
  const sim = new EventLoopSim();
  sim.setSize(1440, 900);
  sim.enter({ view: 'machine', programs: [p] });
  const dt = 1 / 60;
  const events: string[] = [];
  let printed = 0;
  let rafs = 0;
  for (let t = 0; t < (opts.seconds ?? 120); t += dt) {
    if (opts.each?.(sim)) break;
    const q = sim.game?.pending;
    if (q) sim.game!.answer(q.acceptable[0]);
    sim.advance(dt, true, 1);
    const m = sim.m;
    while (rafs < m.ran.raf) {
      rafs++;
      events.push('frame');
    }
    while (printed < m.out.length) events.push(m.out[printed++].text);
    if (m.finishedFlag && !opts.keepGoing) break;
  }
  const m = sim.m;
  return { out: m.out.map((o) => o.text), src: m.out.map((o) => o.src), events, frames: m.frames, ms: m.ms, finished: m.finishedFlag, sim };
}

export interface ThreadRun {
  /** Work start to finish, ms */
  job: number;
  /** Frames painted while the work ran, and display refreshes in that time */
  painted: number;
  slots: number;
  /** Longest task (with its microtasks), ms */
  longest: number;
  /** How long each click waited before its handler ran, ms */
  delays: number[];
}

/**
 * The "Blocking the loop" chapter's main thread, driven like the demo:
 * press Process at `start`, then click Add to cart at the given offsets.
 */
export function simulateThread(mode: ThreadMode, o: { start: number; clicks: number[]; until: number }): ThreadRun {
  const th = new MainThread();
  th.reset(mode);
  const clicks = o.clicks.map((c) => o.start + c);
  let started = false;
  while (th.ms < o.until) {
    if (!started && th.ms >= o.start) {
      th.startJob();
      started = true;
    }
    while (clicks.length && th.ms >= clicks[0]) {
      clicks.shift();
      th.clickCart();
    }
    th.tick(1000 / 60);
  }
  const during = th.slots.filter((s) => s.t > th.job.t0 && s.t < th.job.t1);
  return {
    job: th.job.t1 - th.job.t0,
    painted: during.filter((s) => s.state === 'painted').length,
    slots: during.length,
    longest: th.stats.longest,
    delays: th.clicks.map((c) => (c.start ?? NaN) - c.at),
  };
}
