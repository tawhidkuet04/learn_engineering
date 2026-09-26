import type { ReactNode } from 'react';
import type { CodeSpec } from '@/components/lesson/CodeBlock';
import type { IconName } from '@/components/lesson/Icon';
import type { QuizSpec } from '@/components/lesson/QuizCard';
import type { LegendItem } from '@/components/stage/chrome';
import type { Callout } from '@/components/stage/overlays';
import type { ScriptEvent } from '@/lib/sim/Sim';
import type { HudKey, ReadoutKey } from './Overlay';
import type { CacheSim, Cfg, PredictKind } from './sim';

export interface Step {
  id: string;
  title: string;
  body: ReactNode;
  cfg?: Partial<Cfg>;
  script?: ScriptEvent<CacheSim>[];
  predict?: { kind: PredictKind; needed: number; prompt: ReactNode };
  actions?: { prompt?: ReactNode; kicker?: string; buttons: { label: string; icon?: IconName; run: (s: CacheSim) => void; after?: ReactNode }[] };
  toggle?: { prompt: ReactNode; initial: number; kicker?: string; options: { label: string; apply: (s: CacheSim) => void; note?: ReactNode }[] };
  /** The working-set slider (chapter 6) */
  wsSlider?: boolean;
  playground?: boolean;
  cheat?: boolean;
  quiz?: QuizSpec;
  code?: CodeSpec;
  code2?: CodeSpec;
  hud?: HudKey[];
  /** Readouts on roomy (landscape) stages */
  side?: ReadoutKey[];
  /** The one readout docked above the controls on phones */
  strip?: ReadoutKey | null;
  legend?: LegendItem[];
  callouts?: Callout[];
  focus?: string[];
}

export interface Chapter {
  id: string;
  title: string;
  cfg?: Partial<Cfg>;
  steps: Step[];
}
