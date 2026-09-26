import type { ReactNode } from 'react';
import type { CodeSpec } from '@/components/lesson/CodeBlock';
import type { IconName } from '@/components/lesson/Icon';
import type { QuizSpec } from '@/components/lesson/QuizCard';
import type { LegendItem } from '@/components/stage/chrome';
import type { Callout } from '@/components/stage/overlays';
import type { ScriptEvent } from '@/lib/sim/Sim';
import type { HudKey, ReadoutKey } from './Overlay';
import type { Cfg, NatSim, PredictKind } from './sim';

export interface Step {
  id: string;
  title: string;
  body: ReactNode;
  cfg?: Partial<Cfg>;
  script?: ScriptEvent<NatSim>[];
  predict?: { kind: PredictKind; needed: number; prompt: ReactNode };
  actions?: { prompt?: ReactNode; buttons: { label: string; icon?: IconName; run: (s: NatSim) => void; after?: ReactNode }[] };
  /** The CIDR prefix slider with its mini challenges */
  prefixCard?: boolean;
  playground?: boolean;
  cheat?: boolean;
  quiz?: QuizSpec;
  code?: CodeSpec;
  code2?: CodeSpec;
  hud?: HudKey[];
  /** Readouts on a landscape stage */
  side?: ReadoutKey[];
  /** The one readout docked at the bottom on phones */
  strip?: ReadoutKey | null;
  legend?: LegendItem[];
  callouts?: Callout[];
  /** Yellow "your turn" pill on the stage, until `hintDone` says the learner acted */
  hint?: string;
  hintDone?: (s: NatSim) => boolean;
  /** A packet inspector rides along in this step (phones dock it at the top) */
  inspect?: boolean;
}

export interface Chapter {
  id: string;
  title: string;
  cfg?: Partial<Cfg>;
  steps: Step[];
}
