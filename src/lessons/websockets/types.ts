import type { ReactNode } from 'react';
import type { CodeSpec } from '@/components/lesson/CodeBlock';
import type { IconName } from '@/components/lesson/Icon';
import type { QuizSpec } from '@/components/lesson/QuizCard';
import type { LegendItem } from '@/components/stage/chrome';
import type { Callout } from '@/components/stage/overlays';
import type { ScriptEvent } from '@/lib/sim/Sim';
import type { HudKey, ReadoutKey } from './Overlay';
import type { Cfg, PredictKind, WsSim } from './sim';

/** A callout that can change direction on phones, or show on wide stages only. */
export interface WsCallout extends Callout {
  pdir?: Callout['dir'];
  landOnly?: boolean;
}

export interface Step {
  id: string;
  title: string;
  body: ReactNode;
  cfg?: Partial<Cfg>;
  script?: ScriptEvent<WsSim>[];
  predict?: { kind: PredictKind; needed: number; prompt: ReactNode };
  /** Buttons that change the simulation */
  actions?: { prompt?: ReactNode; afterPredict?: boolean; buttons: { label: string; icon?: IconName; run: (s: WsSim) => void; after?: ReactNode }[] };
  toggle?: { prompt: ReactNode; initial: number; options: { label: string; apply: (s: WsSim) => void; note?: ReactNode }[] };
  /** The short-polling interval slider */
  interval?: boolean;
  /** Controls for the race view */
  race?: boolean;
  playground?: boolean;
  cheat?: boolean;
  quiz?: QuizSpec;
  code?: CodeSpec;
  code2?: CodeSpec;
  hud?: HudKey[];
  /** Readouts on wide stages */
  readouts?: ReadoutKey[];
  /** The one readout docked at the bottom on phones */
  strip?: ReadoutKey | null;
  legend?: LegendItem[];
  callouts?: WsCallout[];
  /** Everything else is dimmed */
  focus?: string[];
  /** Yellow "your turn" pill on the stage */
  hint?: string;
}

export interface Chapter {
  id: string;
  title: string;
  cfg?: Partial<Cfg>;
  steps: Step[];
}
