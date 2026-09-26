import type { ReactNode } from 'react';
import type { IconName } from '@/components/lesson/Icon';
import type { QuizSpec } from '@/components/lesson/QuizCard';
import type { Callout } from '@/components/stage/overlays';
import type { ScriptEvent } from '@/lib/sim/Sim';
import type { DnsCodeSpec } from './panel';
import type { DnsConfig, DnsSim } from './sim';

export type LegendKey = 'query' | 'referral' | 'answer' | 'cname' | 'nx' | 'http' | 'old' | 'new' | 'tcp' | 'enc' | 'trunc';

export type HudKey = 'time' | 'trips' | 'hits' | 'alice' | 'bob' | 'misses' | 'auth' | 'neg' | 'moved' | 'since' | 'errors' | 'stale' | 'lost' | 'retries' | 'size' | 'lookups' | 'hitRate' | 'root' | 'maxTtl';

export type Interaction =
  | { kind: 'actions'; prompt?: ReactNode; buttons: { label: string; icon?: IconName; run: (s: DnsSim) => void; after?: ReactNode }[] }
  | { kind: 'toggle'; prompt: ReactNode; options: { label: string; apply: (s: DnsSim) => void; note?: ReactNode }[]; initial?: number }
  | { kind: 'ttl'; prompt: ReactNode; min: number; max: number; initial: number }
  | { kind: 'continue'; prompt: ReactNode }
  | { kind: 'playground' };

export interface Step {
  id: string;
  title: string;
  body: ReactNode;
  cfg?: Partial<DnsConfig>;
  /** Runs right after the world resets, to put caches in the state this step starts from */
  setup?: (s: DnsSim) => void;
  script?: ScriptEvent<DnsSim>[];
  /** Number of correct predictions needed (turns on the predict card) */
  predict?: number;
  predictPrompt?: ReactNode;
  focus?: string[];
  callouts?: Callout[];
  legend?: LegendKey[];
  hud?: HudKey[];
  interaction?: Interaction;
  quiz?: QuizSpec;
  code?: DnsCodeSpec;
  /** Extra panel content under the narration (tables, lists) */
  extra?: ReactNode;
}

export interface Chapter {
  id: string;
  title: string;
  cfg?: Partial<DnsConfig>;
  steps: Step[];
}
