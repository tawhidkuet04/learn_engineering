import type { ReactNode } from 'react';
import type { CodeSpec } from '@/components/lesson/CodeBlock';
import type { IconName } from '@/components/lesson/Icon';
import type { QuizSpec } from '@/components/lesson/QuizCard';
import type { Callout } from '@/components/stage/overlays';
import type { HashCfg, HashSim } from './sim';

export type HudKey =
  | 'cmp'
  | 'items'
  | 'load'
  | 'cap'
  | 'longest'
  | 'used'
  | 'threshold'
  | 'race'
  | 'total'
  | 'tombs'
  | 'chart'
  | 'birthday'
  | 'steps'
  | 'rehashed';

export type LegendKey = 'put' | 'get' | 'del' | 'cmp' | 'hit' | 'taken' | 'miss' | 'tomb' | 'moved' | 'stay' | 'bar' | 'spike' | 'avg' | 'naive' | 'tree';

export type ReadoutKind = 'hashlog' | 'address' | 'birthday' | 'attack';

export type Interaction =
  | { kind: 'actions'; prompt?: ReactNode; buttons: { label: string; icon?: IconName; run: (s: HashSim) => void; after?: ReactNode }[] }
  | { kind: 'toggle'; prompt: ReactNode; initial?: number; options: { label: string; apply: (s: HashSim) => void; note?: ReactNode }[] }
  | { kind: 'keys'; prompt: ReactNode; mode: 'put' | 'get' | 'both'; suggestions: string[] }
  | { kind: 'load'; max: number };

export interface Step {
  id: string;
  title: string;
  body: ReactNode;
  cfg?: Partial<HashCfg>;
  /** The step's script: queue operations on the sim */
  run?: (s: HashSim) => void;
  /** Replay the script after this many idle seconds */
  loop?: number;
  predict?: { rounds: number; prompt: ReactNode };
  /** What the step is about; the rest is dimmed */
  focus?: ('machine' | 'table' | 'list')[];
  hud?: HudKey[];
  legend?: LegendKey[];
  callouts?: Callout[];
  code?: CodeSpec | CodeSpec[];
  quiz?: QuizSpec;
  interaction?: Interaction;
  readout?: ReadoutKind;
  extra?: 'cheat' | 'playground';
}

export interface Chapter {
  id: string;
  title: string;
  steps: Step[];
}
