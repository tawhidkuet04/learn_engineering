import type { ReactNode } from 'react';
import type { CodeSpec } from '@/components/lesson/CodeBlock';
import type { IconName } from '@/components/lesson/Icon';
import type { QuizSpec } from '@/components/lesson/QuizCard';
import type { Callout } from '@/components/stage/overlays';
import type { ScriptEvent } from '@/lib/sim/Sim';
import type { PredictKind, PTConfig, PTSim } from './sim';

export type HudKey = 'switches' | 'overhead' | 'wait' | 'util' | 'batch' | 'alive' | 'spaces' | 'race' | 'ipc' | 'running';

export type LegendKey = 'thread' | 'tsw' | 'psw' | 'io' | 'wait' | 'sleep' | 'load' | 'crash' | 'lock' | 'mem' | 'store' | 'lost' | 'msg' | 'fork' | 'ok' | 'gil';

export type StepCallout = Callout & {
  /** Direction to use on a portrait (phone) stage */
  pdir?: Callout['dir'];
  only?: 'landscape' | 'portrait';
};

export interface ModeOption {
  label: string;
  apply: (s: PTSim) => void;
  note?: ReactNode;
  code?: CodeSpec;
}

export type Interaction =
  | { kind: 'actions'; prompt?: ReactNode; buttons: { label: string; icon?: IconName; run: (s: PTSim) => void; after?: ReactNode }[] }
  | { kind: 'toggle'; prompt: ReactNode; options: ModeOption[]; initial?: number }
  | { kind: 'cores'; prompt?: ReactNode }
  | { kind: 'slice'; prompt?: ReactNode }
  | { kind: 'io'; prompt?: ReactNode }
  | { kind: 'playground' };

export interface Step {
  id: string;
  title: string;
  body: ReactNode;
  cfg?: Partial<PTConfig>;
  /** Rebuild the world from cfg.procs when the step starts */
  reset?: boolean;
  seed?: number;
  script?: ScriptEvent<PTSim>[];
  predict?: { kind: PredictKind; rounds: number; prompt: ReactNode };
  interaction?: Interaction;
  /** Shown after the prediction is done (e.g. crash buttons) */
  afterPredict?: Interaction;
  hud?: HudKey[];
  legend?: LegendKey[];
  callouts?: StepCallout[];
  focus?: string[];
  code?: CodeSpec;
  quiz?: QuizSpec;
  extra?: ReactNode;
  /** Clicking threads/processes on the stage crashes them */
  crashMode?: boolean;
  /** The context-switch inspector */
  inspector?: boolean;
}

export interface Chapter {
  id: string;
  title: string;
  cfg?: Partial<PTConfig>;
  steps: Step[];
}
