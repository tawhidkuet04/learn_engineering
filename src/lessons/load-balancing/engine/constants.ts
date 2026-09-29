import type { ClientSpec, Size, WorldConfig } from './types';

/** Signal colors for traffic. Mirrors the --sig-* tokens in globals.css. */
export const C = {
  req: '#45D5FF',
  res: '#4BE3A0',
  heavy: '#FF9A3C',
  err: '#FF4D6A',
  warn: '#FFD23F',
  hc: '#B59BFF',
  api: '#45D5FF',
  media: '#FF7EB6',
} as const;

/** Hop durations in simulated seconds. */
export const HOP = {
  clientLb: 0.8,
  lbServer: 0.55,
  clientServer: 1.1,
  lbLb: 0.45,
  serverRedis: 0.26,
};

/** Processing time per request, simulated seconds. */
export const WORK = { light: 0.9, heavy: 4.5, tour: 1.6 };

/** Displayed latency: one simulated second reads as this many milliseconds. */
export const MS_PER_S = 40;

export const HC = { interval: 2, timeout: 1.3, fall: 3, rise: 2 };
export const HB = { interval: 1, dead: 3.4 };
export const GATEWAY_TIMEOUT = 1.2;
/**
 * What real balancers do when a server refuses a connection, with their
 * default settings (see verify/load-balancing.test.ts).
 * HAProxy: `retries 3`, each one second after the last, on the same server.
 * NGINX: `max_fails=1 fail_timeout=10s`, so one refusal benches the server.
 */
export const RETRY = { haproxyTries: 3, haproxyGap: 1, nginxBench: 10 };

export const SIZE_WORKERS: Record<Size, number> = { s: 2, m: 4, l: 8 };
export const SIZE_WEIGHT: Record<Size, number> = { s: 1, m: 2, l: 4 };

export const VIP = '203.0.113.10';

export const CLIENTS: ClientSpec[] = [
  { id: 'alice', name: 'Alice', ip: '198.51.100.42', color: '#FF7EB6' },
  { id: 'bob', name: 'Bob', ip: '192.0.2.7', color: '#2DD4BF' },
  { id: 'carol', name: 'Carol', ip: '198.51.100.73', color: '#C4F25A' },
  { id: 'dave', name: 'Dave', ip: '192.0.2.150', color: '#93A5FF' },
];

export const DEFAULT_CONFIG: WorldConfig = {
  clients: CLIENTS.slice(0, 3),
  servers: [{ id: 's1' }, { id: 's2' }, { id: 's3' }],
  lb: 'single',
  layer: 'l7',
  algorithm: 'rr',
  routeByPath: false,
  directTo: null,
  rps: 2,
  arrival: 'uniform',
  clientOrder: 'cycle',
  heavyRatio: 0,
  pattern: null,
  healthChecks: false,
  proxy: 'nginx',
  sessions: false,
  sessionStore: false,
  colorBy: 'type',
  queueCap: 10,
  showZones: true,
  showBrain: true,
  showServed: false,
  hideNext: false,
  chaos: false,
};

export function serverNumber(id: string): number {
  const n = parseInt(id.replace(/\D/g, ''), 10);
  return Number.isFinite(n) ? n : 1;
}

export function serverLabel(id: string): string {
  return `web-${serverNumber(id)}`;
}

export function serverIp(id: string): string {
  return `10.0.1.${10 + serverNumber(id)}`;
}

export const LIGHT_PATHS = ['/cart', '/products/42', '/search?q=boots', '/checkout'];
export const HEAVY_PATHS = ['/export/orders.csv', '/reports/yearly.pdf'];
export const API_PATHS = ['/api/cart', '/api/login', '/api/orders'];
export const MEDIA_PATHS = ['/media/hero.jpg', '/media/intro.mp4', '/media/logo.svg'];
