import { DEFAULT_CONFIG } from './engine/constants';
import type { WorldConfig } from './engine/types';
import type { World } from './engine/world';
import type { Chapter, Step } from './types';

interface Entry {
  step: Step;
  chapter: Chapter;
}

export function configOf({ step, chapter }: Entry): WorldConfig {
  return { ...DEFAULT_CONFIG, ...chapter.config, ...step.config };
}

/** Put the world in a step's starting state. Shared by the page and the headless checks in verify/. */
export function enterStep(world: World, entry: Entry) {
  const { step } = entry;
  world.enter(configOf(entry), { reset: step.reset, script: step.script, seed: step.seed });
  step.onEnter?.(world);
  if (step.interaction?.kind === 'predict') world.startPredict(step.interaction.rounds);
}
