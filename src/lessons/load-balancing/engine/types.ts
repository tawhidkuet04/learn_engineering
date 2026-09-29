export type Algo = 'rr' | 'least' | 'weighted' | 'iphash' | 'random' | 'p2c';
export type Size = 's' | 'm' | 'l';
export type Pool = 'api' | 'media';
export type LBMode = 'none' | 'single' | 'pair';
export type LBId = 'A' | 'B';
export type Orient = 'landscape' | 'portrait';

export interface ServerSpec {
  id: string;
  label?: string;
  size?: Size;
  weight?: number;
  down?: boolean;
  pool?: Pool;
}

export interface ClientSpec {
  id: string;
  name: string;
  ip: string;
  color: string;
}

export interface WorldConfig {
  clients: ClientSpec[];
  servers: ServerSpec[];
  lb: LBMode;
  /** l4 = route whole TCP connections by address; l7 = read the HTTP request */
  layer: 'l4' | 'l7';
  algorithm: Algo;
  /** L7 content routing: /api/* and /media/* go to separate pools */
  routeByPath: boolean;
  /** Without a load balancer, which server DNS points everyone at */
  directTo: string | null;
  rps: number;
  arrival: 'uniform' | 'poisson';
  clientOrder: 'cycle' | 'random';
  heavyRatio: number;
  /** Deterministic heavy/light pattern, overrides heavyRatio */
  pattern: ('H' | 'L')[] | null;
  healthChecks: boolean;
  /**
   * Whose failure handling to imitate when a server refuses a connection.
   * nginx: retry the next server at once and skip the dead one for 10 s.
   * haproxy: retry the same server 3 times, a second apart, then answer 503.
   * Both were measured on the real software (verify/load-balancing.test.ts).
   */
  proxy: 'nginx' | 'haproxy';
  /** Servers keep shopping carts in their own memory */
  sessions: boolean;
  /** Carts live in a shared Redis instead */
  sessionStore: boolean;
  colorBy: 'type' | 'client' | 'path';
  queueCap: number;
  showZones: boolean;
  showBrain: boolean;
  showServed: boolean;
  /** Hide the "next pick" hint so the learner can predict it */
  hideNext: boolean;
  /** Ambient mode: randomly crash and revive servers */
  chaos: boolean;
}

export interface ScriptEvent {
  at: number;
  run: (w: import('./world').World) => void;
}
