import type { ReactNode } from 'react';
import type { CodeSpec } from '@/components/lesson/CodeBlock';
import type { IconName } from '@/components/lesson/Icon';
import type { QuizSpec } from '@/components/lesson/QuizCard';
import type { LegendItem } from '@/components/stage/chrome';
import type { Callout } from '@/components/stage/overlays';
import type { ScriptEvent } from '@/lib/sim/Sim';
import type { ShardConfig, ShardSim } from './sim';

export type HudKey =
  | 'load'
  | 'disk'
  | 'failed'
  | 'primary'
  | 'replica'
  | 'hottest'
  | 'skew'
  | 'idle'
  | 'writes'
  | 'biggest'
  | 'monthly'
  | 'myorders'
  | 'single'
  | 'scatter'
  | 'lookups'
  | 'join'
  | 'ids'
  | 'dupes'
  | 'moved';

export type Interaction =
  | { kind: 'actions'; prompt?: ReactNode; buttons: { label: string; icon?: IconName; run: (s: ShardSim) => void; after?: ReactNode }[] }
  | { kind: 'toggle'; prompt: ReactNode; initial?: number; options: { label: string; apply: (s: ShardSim) => void; note?: ReactNode }[] }
  | { kind: 'playground' };

export interface Step {
  id: string;
  title: string;
  body: ReactNode;
  cfg?: Partial<ShardConfig>;
  script?: ScriptEvent<ShardSim>[];
  seed?: number;
  /** pdir: direction on phones ('hide' to drop it there) */
  callouts?: (Callout & { pdir?: Callout['dir'] | 'hide'; ptarget?: string })[];
  legend?: LegendItem[];
  hud?: HudKey[];
  focus?: string[];
  /** Question shown on the PredictCard (the sim asks the individual rounds) */
  predictPrompt?: ReactNode;
  interaction?: Interaction;
  quiz?: QuizSpec;
  code?: CodeSpec;
  extra?: ReactNode;
}

export interface Chapter {
  id: string;
  title: string;
  cfg?: Partial<ShardConfig>;
  steps: Step[];
}
