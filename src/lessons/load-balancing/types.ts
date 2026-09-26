import type { ReactNode } from 'react';
import type { CodeSpec } from '@/components/lesson/CodeBlock';
import type { IconName } from '@/components/lesson/Icon';
import type { QuizSpec } from '@/components/lesson/QuizCard';
import type { ScriptEvent, WorldConfig } from './engine/types';
import type { World } from './engine/world';
import type { HudKey, LegendKey } from './stage/Chrome';
import type { Callout } from './stage/overlays';

export type Interaction =
  | { kind: 'predict'; rounds: number; prompt: ReactNode }
  | { kind: 'slider'; label: string; min: number; max: number; step: number; goalDrops: number; done: ReactNode }
  | { kind: 'actions'; prompt?: ReactNode; buttons: { label: string; icon?: IconName; run: (w: World) => void; after?: ReactNode }[] }
  | { kind: 'toggle'; prompt: ReactNode; options: { label: string; apply: (w: World) => void }[]; initial: number }
  | { kind: 'clickServers'; prompt: ReactNode }
  | { kind: 'playground' };

export interface Step {
  id: string;
  title: string;
  body: ReactNode;
  config?: Partial<WorldConfig>;
  /** Clear traffic, queues and metrics when the step starts */
  reset?: boolean;
  seed?: number;
  script?: ScriptEvent[];
  onEnter?: (w: World) => void;
  focus?: string[];
  callouts?: Callout[];
  interaction?: Interaction;
  quiz?: QuizSpec;
  code?: CodeSpec;
  hud?: HudKey[];
  legend?: LegendKey[];
  /** Let the learner crash and revive servers by clicking them */
  clickServers?: boolean;
  extra?: ReactNode;
}

export interface Chapter {
  id: string;
  title: string;
  config?: Partial<WorldConfig>;
  steps: Step[];
}
