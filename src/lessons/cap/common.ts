import type { LegendItem } from '@/components/stage/chrome';
import { SIG } from '@/lib/sim/colors';
import type { CapConfig } from './sim';

export const META = { slug: 'cap', code: 'SD-09', track: 'System design', title: 'CAP & Consistency' };

/** Legend entries, so every step names the colors the same way. */
export const LG = {
  req: { label: 'request', color: SIG.req, shape: 'env' },
  ok: { label: 'answer', color: SIG.res, shape: 'env' },
  repl: { label: 'replication', color: SIG.req },
  ack: { label: 'ack', color: SIG.res, shape: 'small' },
  stale: { label: 'stale answer', color: SIG.heavy, shape: 'env' },
  err: { label: 'error · lost', color: SIG.err },
  hb: { label: 'heartbeat', color: SIG.hc, shape: 'small' },
  check: { label: 'version check', color: SIG.hc, shape: 'small' },
  vote: { label: 'heartbeat · vote', color: SIG.hc, shape: 'small' },
  write: { label: 'write', color: SIG.req },
  read: { label: 'read', color: SIG.req, shape: 'small' },
  held: { label: 'held back', color: SIG.warn },
} satisfies Record<string, LegendItem>;

export const CP: Partial<CapConfig> = { wq: 2, rq: 2, hints: false, sides: true };
export const AP: Partial<CapConfig> = { wq: 1, rq: 1, hints: true, sides: false };
export const LAST_SEAT: Partial<CapConfig> = { seats: 1, ver: 9 };
