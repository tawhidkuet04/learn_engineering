import type { ReactNode } from 'react';
import type { CodeSpec } from '@/components/lesson/CodeBlock';
import type { IconName } from '@/components/lesson/Icon';
import type { QuizSpec } from '@/components/lesson/QuizCard';
import type { LegendItem } from '@/components/stage/chrome';
import type { Callout } from '@/components/stage/overlays';
import type { ScriptEvent } from '@/lib/sim/Sim';
import type { HudKey, ReadoutKind } from './Overlay';
import type { RouteMark } from './Scene';
import type { CdnConfig, CdnSim } from './sim';

export type Interaction =
  | {
      kind: 'toggle';
      prompt: ReactNode;
      initial?: number;
      options: { label: string; apply: (s: CdnSim) => void; note?: ReactNode }[];
    }
  | {
      kind: 'slider';
      prompt?: ReactNode;
      sliders: {
        label: string;
        min: number;
        max: number;
        step: number;
        initial: number;
        format?: (v: number) => string;
        ends?: [string, string];
        onChange: (s: CdnSim, v: number) => void;
      }[];
      stats?: (s: CdnSim) => ReactNode;
    }
  | {
      kind: 'actions';
      prompt?: ReactNode;
      buttons: { label: string; icon?: IconName; run: (s: CdnSim) => void; after?: ReactNode }[];
    }
  /** Take PoPs offline by clicking them on the stage or in the card */
  | { kind: 'pops'; prompt: ReactNode }
  | { kind: 'playground' };

export interface Step {
  id: string;
  title: string;
  body: ReactNode;
  cfg?: Partial<CdnConfig>;
  /** Start from a clean world (default true) */
  reset?: boolean;
  predict?: { rounds: number; prompt: ReactNode };
  script?: ScriptEvent<CdnSim>[];
  onEnter?: (s: CdnSim) => void;
  callouts?: Callout[];
  /** Callouts for the small portrait stage (defaults to `callouts`) */
  calloutsPortrait?: Callout[];
  legend?: LegendItem[];
  /** Spotlight: everything else is dimmed */
  focus?: string[];
  hud?: HudKey[];
  readout?: ReadoutKind;
  /** Readout on the small portrait stage, if different (null = none) */
  readoutPortrait?: ReadoutKind | null;
  route?: RouteMark;
  showLoad?: boolean;
  interactions?: Interaction[];
  quiz?: QuizSpec;
  extra?: ReactNode;
  code?: CodeSpec;
}

export interface Chapter {
  id: string;
  title: string;
  cfg?: Partial<CdnConfig>;
  steps: Step[];
}
