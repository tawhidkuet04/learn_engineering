import type { ReactNode } from 'react';
import type { CodeSpec } from '@/components/lesson/CodeBlock';
import type { IconName } from '@/components/lesson/Icon';
import type { QuizSpec } from '@/components/lesson/QuizCard';
import type { LegendItem } from '@/components/stage/chrome';
import type { Callout } from '@/components/stage/overlays';
import type { ScriptEvent } from '@/lib/sim/Sim';
import type { HudKey, ReadoutKey } from './Overlay';
import type { Cfg, PredictKind, RingSim } from './sim';

export interface Step {
  id: string;
  title: string;
  body: ReactNode;
  cfg?: Partial<Cfg>;
  script?: ScriptEvent<RingSim>[];
  predict?: { kind: PredictKind; needed: number; prompt: ReactNode };
  actions?: { prompt?: ReactNode; buttons: { label: string; icon?: IconName; run: (s: RingSim) => void; after?: ReactNode }[] };
  toggle?: { prompt: ReactNode; initial: number; options: { label: string; apply: (s: RingSim) => void; note?: ReactNode }[] };
  /** The "tokens per server" slider */
  tokens?: boolean;
  playground?: boolean;
  cheat?: boolean;
  quiz?: QuizSpec;
  code?: CodeSpec;
  code2?: CodeSpec;
  hud?: HudKey[];
  /** Readouts in the right-hand column (landscape) */
  side?: ReadoutKey[];
  /** The one readout docked at the bottom on phones */
  strip?: ReadoutKey | null;
  legend?: LegendItem[];
  callouts?: Callout[];
  /** Yellow "your turn" pill on the stage until the learner acts */
  hint?: string;
  after?: ReactNode;
}

export interface Chapter {
  id: string;
  title: string;
  cfg?: Partial<Cfg>;
  steps: Step[];
}
