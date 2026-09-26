/**
 * Signal colors shared by every lesson. They mirror the --sig-* tokens in
 * globals.css. Use them for anything that moves or carries meaning so the
 * whole site speaks one visual language:
 *   req    cyan    a request / data going out
 *   res    mint    a successful response / ack / "ok"
 *   heavy  orange  expensive or special traffic
 *   err    red     errors, loss, crashes
 *   warn   yellow  markup, attention, "your turn" (also the brand accent)
 *   hc     violet  control-plane traffic: health checks, heartbeats, internal
 */
export const SIG = {
  req: '#45D5FF',
  res: '#4BE3A0',
  heavy: '#FF9A3C',
  err: '#FF4D6A',
  warn: '#FFD23F',
  hc: '#B59BFF',
  pink: '#FF7EB6',
  lime: '#C4F25A',
  teal: '#2DD4BF',
  blue: '#93A5FF',
  line: '#8FA6C9',
  text: '#E8EEF9',
  text2: '#A9B6CC',
  dim: '#6F7D97',
} as const;

/** Distinct colors for users, threads, shards… in a stable order. */
export const PALETTE = [SIG.pink, SIG.teal, SIG.lime, SIG.blue, SIG.heavy, SIG.req, SIG.hc, SIG.warn];
