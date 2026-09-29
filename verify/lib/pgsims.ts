/**
 * Runs the replication and race-condition lessons' own simulations headlessly,
 * the way their pages drive them, so the tests can compare the animation with
 * what PostgreSQL and MySQL actually do.
 */
import { CHAPTERS as REPL_CHAPTERS } from '@/lessons/replication/chapters';
import { DEFAULTS, ReplSim, type ReplConfig } from '@/lessons/replication/sim';
import { RaceSim, type Chip, type RaceCfg } from '@/lessons/race-conditions/sim';
import type { Question } from '@/lib/sim/predict';

/* ---------------- replication ---------------- */

export function replStep(id: string) {
  for (const chapter of REPL_CHAPTERS) {
    const step = chapter.steps.find((s) => s.id === id);
    if (step) return { chapter, step };
  }
  throw new Error(`no step "${id}" in the replication lesson`);
}

/** Enter a step exactly like the lesson page does (see Lesson.tsx configOf), on a desktop-sized stage. */
export function replEnter(id: string, patch: Partial<ReplConfig> = {}) {
  const { chapter, step } = replStep(id);
  const cfg: ReplConfig = { ...DEFAULTS, ...chapter.cfg, ...step.cfg, ...patch, strip: !!step.readout?.length };
  const sim = new ReplSim();
  sim.setSize(1100, 640);
  sim.enter(cfg, step.script ?? [], { reset: step.reset, predict: step.predict });
  return sim;
}

export interface Asked {
  at: number;
  ask: string;
  acceptable: string[];
  choices?: string[];
  explain: string;
}

/**
 * Play `seconds` of lesson time at 60 frames a second. Prediction prompts are
 * answered with the lesson's own correct answer (and recorded).
 */
export function replRun(sim: ReplSim, seconds: number, asked: Asked[] = []) {
  const dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) {
    const q: Question | null | undefined = sim.game?.pending;
    if (q) {
      const pick = q.acceptable[0];
      asked.push({ at: sim.stepT, ask: q.ask ?? '', acceptable: q.acceptable, choices: q.choices?.map((c) => c.id), explain: q.explain(pick, true) });
      sim.game!.answer(pick);
    }
    sim.advance(dt, true, 1);
  }
  return asked;
}

/* ---------------- race conditions ---------------- */

export interface RaceRound {
  chips: Chip[];
  result: { text: string; ok: boolean } | null;
  threads: { id: string; ok: boolean | null; text: string | null }[];
  cells: Record<string, string | number>;
}

/** Play one round of a scene until it ends (or deadlocks) and report what happened, step by step. */
export function raceRound(cfg: RaceCfg): RaceRound {
  const sim = new RaceSim();
  sim.setSize(1100, 640);
  sim.enter(cfg);
  for (let i = 0; i < 60 * 60 && !sim.roundOver && !sim.deadlocked; i++) sim.advance(1 / 60, true, 1);
  return {
    chips: [...sim.hist],
    result: sim.result,
    threads: sim.threads.map((t) => ({ id: t.id, ok: t.result?.ok ?? null, text: t.result?.text ?? null })),
    cells: Object.fromEntries(sim.cells.map((c) => [c.id, c.value])),
  };
}

export const chipText = (c: Chip) => `${c.tid}:${c.code}${c.val ? `(${c.val})` : ''}`;
