import type { ReactNode } from 'react';
import type { CodeSpec } from '@/components/lesson/CodeBlock';
import type { QuizSpec } from '@/components/lesson/QuizCard';
import type { LegendItem } from '@/components/stage/chrome';
import type { Callout } from '@/components/stage/overlays';
import type { ScriptEvent } from '@/lib/sim/Sim';
import type { MQConfig } from './model';
import type { MQSim } from './sim';

export type HudKey =
  | 'signup'
  | 'ok'
  | 'failed'
  | 'depth'
  | 'inflight'
  | 'age'
  | 'in'
  | 'out'
  | 'processed'
  | 'redelivered'
  | 'charges'
  | 'dupes'
  | 'skipped'
  | 'lost'
  | 'rejected'
  | 'dlq'
  | 'workers'
  | 'stale'
  | 'lag'
  | 'lagA'
  | 'poison'
  | 'backlogs';

export interface Step {
  id: string;
  title: string;
  body: ReactNode;
  cfg?: Partial<MQConfig>;
  /** Clear traffic, queues and metrics when the step starts */
  reset?: boolean;
  seed?: number;
  script?: ScriptEvent<MQSim>[];
  predict?: { needed: number; prompt: ReactNode };
  hud?: HudKey[];
  legend?: LegendItem[];
  callouts?: Callout[];
  /** Callouts for the narrow portrait stage (defaults to `callouts`) */
  pCallouts?: Callout[];
  /** Spotlight: everything else is dimmed. A trailing * matches a prefix. */
  focus?: string[];
  code?: CodeSpec;
  quiz?: QuizSpec;
  /** Interaction cards under the narration. `cfg` is this step's resolved config. */
  panel?: (sim: MQSim, cfg: MQConfig) => ReactNode;
  extra?: ReactNode;
}

export interface Chapter {
  id: string;
  title: string;
  cfg?: Partial<MQConfig>;
  steps: Step[];
}
