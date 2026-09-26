import type { ReactNode } from 'react';
import type { CodeSpec } from '@/components/lesson/CodeBlock';
import type { QuizSpec } from '@/components/lesson/QuizCard';
import type { Callout } from '@/components/stage/overlays';
import type { ScriptEvent } from '@/lib/sim/Sim';
import type { HudKey, ReadoutKey } from './overlays';
import type { CacheConfig, CacheSim } from './sim';

export type LegendKey = 'req' | 'hit' | 'nil' | 'query' | 'set' | 'resp' | 'stale' | 'write' | 'flush' | 'refresh' | 'evict';

export interface StepCallout extends Callout {
  /** Direction on a phone-sized (portrait) stage, if different */
  pdir?: Callout['dir'];
  /** Only show in one orientation */
  only?: 'landscape' | 'portrait';
}

export interface CardCtx {
  replay: () => void;
  /** The step's resolved config (for slider starting values) */
  cfg: CacheConfig;
}

export interface Step {
  id: string;
  title: string;
  body: ReactNode;
  cfg?: Partial<CacheConfig>;
  /** Clear traffic, cache contents and metrics when the step starts */
  reset?: boolean;
  script?: ScriptEvent<CacheSim>[];
  /** Predict-then-reveal (the kind of question is cfg.predict) */
  predict?: { rounds: number; prompt: ReactNode };
  /** Interaction cards under the narration */
  cards?: (sim: CacheSim, ctx: CardCtx) => ReactNode;
  quiz?: QuizSpec;
  code?: CodeSpec[];
  extra?: ReactNode;
  callouts?: StepCallout[];
  legend?: LegendKey[];
  hud?: HudKey[];
  readout?: ReadoutKey;
  /** Spotlight: dim everything else */
  focus?: string[];
  /** Cache rows are clickable (eviction prediction) */
  pickRows?: boolean;
}

export interface Chapter {
  id: string;
  title: string;
  cfg?: Partial<CacheConfig>;
  steps: Step[];
}
