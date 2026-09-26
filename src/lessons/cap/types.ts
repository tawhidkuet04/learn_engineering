import type { ReactNode } from 'react';
import type { CodeSpec } from '@/components/lesson/CodeBlock';
import type { QuizSpec } from '@/components/lesson/QuizCard';
import type { LegendItem } from '@/components/stage/chrome';
import type { Callout } from '@/components/stage/overlays';
import type { CapConfig, CapSim, Op } from './sim';

export type HudKey =
  | 'agree'
  | 'stale'
  | 'errors'
  | 'oversold'
  | 'wlat'
  | 'rlat'
  | 'dropped'
  | 'leader'
  | 'qwrite'
  | 'qread'
  | 'qstale'
  | 'anomalies';

export type ReadoutKey = 'decision' | 'dilemma' | 'cap' | 'raft' | 'tunable' | 'quorum' | 'conflict' | 'lww' | 'vv' | 'pacelc' | 'feed';

export interface Step {
  id: string;
  title: string;
  body: ReactNode;
  cfg?: Partial<CapConfig>;
  reset?: boolean;
  /** Scripted requests, played in order */
  ops?: Op[];
  /** Replay the ops forever (the world resets between rounds) */
  loop?: boolean;
  predict?: { needed: number; prompt: ReactNode };
  onEnter?: (s: CapSim) => void;
  hud?: HudKey[];
  readout?: ReadoutKey;
  callouts?: Callout[];
  /** Callouts for the phone layout (defaults to `callouts`) */
  phoneCallouts?: Callout[];
  legend?: LegendItem[];
  focus?: string[];
  code?: CodeSpec | CodeSpec[];
  quiz?: QuizSpec;
  /** Interactive cards for the narration panel */
  panel?: (sim: CapSim) => ReactNode;
  /** Extra content after the cards (cheat sheet, playground) */
  extra?: (sim: CapSim) => ReactNode;
}

export interface Chapter {
  id: string;
  title: string;
  cfg?: Partial<CapConfig>;
  steps: Step[];
}
