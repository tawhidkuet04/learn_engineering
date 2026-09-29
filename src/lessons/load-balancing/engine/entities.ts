import type { Decision } from './algorithms';
import type { LBId, Pool, Size } from './types';

/** Anything drawn on the stage: a target position it eases toward, plus fade state. */
export interface Box {
  x: number;
  y: number;
  tx: number;
  ty: number;
  w: number;
  h: number;
  alpha: number;
  talpha: number;
  removing: boolean;
}

export interface Client extends Box {
  id: string;
  name: string;
  ip: string;
  color: string;
  port: number;
  /** Server whose memory holds this user's cart (sessions lesson) */
  cartHome: string | null;
  /** Server this client's TCP connection is pinned to (L4) */
  conn: string | null;
  pulse: { color: string; vt: number } | null;
}

export interface Job {
  reqId: number;
  work: number;
  done: number;
  color: string;
  heavy: boolean;
  x: number;
  y: number;
}

export interface Server extends Box {
  id: string;
  label: string;
  ip: string;
  size: Size;
  workers: number;
  weight: number;
  pool: Pool | null;
  up: boolean;
  slots: (Job | null)[];
  queue: Job[];
  served: number;
  util: number;
  mark: { kind: 'ok' | 'bad' | 'answer'; vt: number } | null;
}

export interface HealthState {
  inRot: boolean;
  fails: number;
  passes: number;
  hist: ('ok' | 'fail')[];
}

export interface LB extends Box {
  id: LBId;
  label: string;
  ip: string;
  up: boolean;
  /** Holds the virtual IP that clients connect to */
  active: boolean;
  rr: number;
  wrr: Map<string, number>;
  /** Open connections this balancer has to each server */
  conns: Map<string, number>;
  health: Map<string, HealthState>;
  /** NGINX passive health: a server that refused a connection is skipped until this time */
  benched: Map<string, number>;
  lastPick: string | null;
  decision: Decision | null;
  decisionVt: number;
  lastHb: number;
}

export type RedisNode = Box;
