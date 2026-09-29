/** Runs Load Balancing lesson steps headlessly and returns what the animation did. */
import { CHAPTERS } from '@/lessons/load-balancing/chapters';
import { enterStep } from '@/lessons/load-balancing/enterStep';
import type { TraceEvent } from '@/lessons/load-balancing/engine/world';
import { World } from '@/lessons/load-balancing/engine/world';
import type { WorldConfig } from '@/lessons/load-balancing/engine/types';

export function findStep(id: string) {
  for (const chapter of CHAPTERS) {
    const step = chapter.steps.find((s) => s.id === id);
    if (step) return { chapter, step };
  }
  throw new Error(`no step "${id}" in the load balancing lesson`);
}

export interface SimRun {
  world: World;
  trace: TraceEvent[];
}

/**
 * Enter a step the way the page does, then play it for `seconds` of lesson
 * time. Prediction prompts are answered correctly so traffic keeps flowing.
 */
export function simulate(
  stepId: string,
  seconds: number,
  opts: { config?: Partial<WorldConfig>; at?: { t: number; run: (w: World) => void }[] } = {},
): SimRun {
  const world = new World();
  world.trace = [];
  enterStep(world, findStep(stepId));
  if (opts.config) world.update(opts.config);
  const events = [...(opts.at ?? [])].sort((a, b) => a.t - b.t);
  const dt = 0.05;
  for (let t = 0; t < seconds; t += dt) {
    while (events.length && events[0].t <= t) events.shift()!.run(world);
    const pending = world.predict?.pending;
    if (pending) world.answerPredict(pending.decision.chosen);
    world.advance(dt, true, 1);
  }
  return { world, trace: world.trace };
}

export const routes = (trace: TraceEvent[]) =>
  trace.filter((e): e is Extract<TraceEvent, { kind: 'route' }> => e.kind === 'route').map((e) => e.server);
