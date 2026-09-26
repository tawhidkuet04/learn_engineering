import type { ReactNode } from 'react';
import type { CodeSpec } from '@/components/lesson/CodeBlock';
import type { IconName } from '@/components/lesson/Icon';
import type { QuizSpec } from '@/components/lesson/QuizCard';
import type { LegendItem } from '@/components/stage/chrome';
import type { Callout } from '@/components/stage/overlays';
import type { ScriptEvent } from '@/lib/sim/Sim';
import type { HudKey } from './Overlay';
import type { BigOSim, Cfg, PredictKind } from './sim';

export interface SliderDef {
  prompt?: ReactNode;
  label: string;
  min: number;
  max: number;
  step: number;
  format?: (v: number) => string;
  set: (s: BigOSim, v: number) => void;
  ends?: [string, string];
  stats?: (s: BigOSim) => ReactNode;
  done?: (s: BigOSim) => ReactNode;
}

export interface Step {
  id: string;
  title: string;
  body: ReactNode;
  cfg?: Partial<Cfg>;
  script?: ScriptEvent<BigOSim>[];
  predict?: { kind: PredictKind; needed: number; prompt: ReactNode };
  actions?: { prompt?: ReactNode; buttons: { label: string; icon?: IconName; run: (s: BigOSim) => void; after?: ReactNode }[] };
  toggle?: { prompt: ReactNode; initial: number; options: { label: string; apply: (s: BigOSim) => void; note?: ReactNode }[] };
  /** One kit slider; its initial value is the step's cfg.n */
  slider?: SliderDef;
  /** Lesson-specific cards */
  card?: 'scanSize' | 'chart' | 'rules' | 'playground';
  cheat?: boolean;
  quiz?: QuizSpec;
  code?: CodeSpec;
  code2?: CodeSpec;
  hud?: HudKey[];
  legend?: LegendItem[];
  callouts?: Callout[];
}

export interface Chapter {
  id: string;
  title: string;
  cfg?: Partial<Cfg>;
  steps: Step[];
}
