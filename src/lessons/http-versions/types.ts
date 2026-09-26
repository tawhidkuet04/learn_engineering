import type { ReactNode } from 'react';
import type { CodeSpec } from '@/components/lesson/CodeBlock';
import type { IconName } from '@/components/lesson/Icon';
import type { QuizSpec } from '@/components/lesson/QuizCard';
import type { Callout } from '@/components/stage/overlays';
import type { ScriptEvent } from '@/lib/sim/Sim';
import type { HudKey } from './Overlay';
import type { HttpSim, StageCfg } from './sim';

export type LegendKey = 'html' | 'css' | 'js' | 'font' | 'img' | 'req' | 'res' | 'hs' | 'lost' | 'ctl';
export type SliderKey = 'rtt' | 'loss' | 'count' | 'files';
export type StatKey = 'load' | 'rtts' | 'race';

export type Interaction =
  | { kind: 'slider'; prompt?: ReactNode; sliders: SliderKey[]; stats: StatKey }
  | {
      kind: 'toggle';
      prompt: ReactNode;
      initial?: number;
      options: { label: string; cfg: Partial<StageCfg>; note?: ReactNode }[];
      results?: { label: string; key: string }[];
    }
  | { kind: 'actions'; prompt?: ReactNode; buttons: { label: string; icon?: IconName; run: (s: HttpSim) => void; after?: ReactNode }[] }
  | { kind: 'playground' };

export interface Step {
  id: string;
  title: string;
  body: ReactNode;
  cfg?: Partial<StageCfg>;
  predict?: { needed: number; prompt: ReactNode };
  script?: ScriptEvent<HttpSim>[];
  callouts?: Callout[];
  hud?: HudKey[];
  legend?: LegendKey[];
  interactions?: Interaction[];
  code?: CodeSpec;
  quiz?: QuizSpec;
  extra?: ReactNode;
}

export interface Chapter {
  id: string;
  title: string;
  cfg?: Partial<StageCfg>;
  steps: Step[];
}
