import { clamp, lerp } from '@/lib/sim/geometry';
import type { Seg, TcpModel } from './model';
import type { TcpSim } from './sim';

/* Geometry shared by the SVG scene and the HTML overlays, so a prompt or an
   inspector card always lands exactly on the thing it talks about. */

export interface SeqGeom {
  xc: number;
  xs: number;
  /** Top of the scrolling diagram body (headers sit above it) */
  top: number;
  bottom: number;
  /** Pixels per on-screen second */
  pps: number;
  now: number;
  yOf: (disp: number) => number;
  yMs: (ms: number) => number;
}

export function seqGeom(sim: TcpSim, m: TcpModel): SeqGeom | null {
  const hc = sim.boxes.get('hdrC');
  const hs = sim.boxes.get('hdrS');
  const body = sim.boxes.get('body');
  if (!hc || !hs || !body || Number.isNaN(hc.x) || Number.isNaN(body.y)) return null;
  const top = body.y - body.h / 2;
  const bottom = body.y + body.h / 2;
  const pps = sim.orient === 'portrait' ? 52 : 66;
  const lead = 16;
  const tail = 30;
  const now = m.disp;
  const scroll = Math.max(0, lead + now * pps - (bottom - top - tail));
  const yOf = (d: number) => top + lead + d * pps - scroll;
  return { xc: hc.x, xs: hs.x, top, bottom, pps, now, yOf, yMs: (ms: number) => yOf(m.msToDisp(ms)) };
}

/** The segment the header card describes: the most recent one sent. */
export function featuredSeg(m: TcpModel): Seg | null {
  for (let i = m.segs.length - 1; i >= 0; i--) if (m.segs[i].kind !== 'probe') return m.segs[i];
  return null;
}

export interface SegLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** How far along it is drawn (0..1) */
  k: number;
  hx: number;
  hy: number;
}

export function segLine(g: SeqGeom, m: TcpModel, s: Seg): SegLine {
  const x1 = s.from === 'c' ? g.xc : g.xs;
  const x2 = s.from === 'c' ? g.xs : g.xc;
  const y1 = g.yMs(s.sent);
  const y2 = g.yMs(s.arrive);
  let k: number;
  if (s.status === 'lost') k = clamp(s.lostAt ?? 0.5, 0, 1);
  else if (s.status === 'done') k = 1;
  else k = clamp((m.now - s.sent) / Math.max(1e-6, s.arrive - s.sent), 0, 1);
  return { x1, y1, x2, y2, k, hx: lerp(x1, x2, k), hy: lerp(y1, y2, k) };
}

/* ------------------------------------------------------------------ */

export interface PipeGeom {
  /** Data lane: Alice → queue → router → server */
  y: number;
  ax: number;
  qx0: number;
  qx1: number;
  rx0: number;
  rx1: number;
  sx: number;
  slotW: number;
  /** ACK return path: a curve under the row */
  ack: { x0: number; y0: number; cx: number; cy: number; x1: number; y1: number };
  alice: { x: number; y: number; w: number; h: number };
  router: { x: number; y: number; w: number; h: number };
  srv: { x: number; y: number; w: number; h: number };
}

export function pipeGeom(sim: TcpSim, m: TcpModel): PipeGeom | null {
  const a = sim.boxes.get('pAlice');
  const r = sim.boxes.get('pRouter');
  const v = sim.boxes.get('pSrv');
  const q = sim.boxes.get('queue');
  if (!a || !r || !v || !q || Number.isNaN(a.x)) return null;
  const y = a.y;
  const drop = sim.orient === 'portrait' ? 30 : 44;
  return {
    y,
    ax: a.x + a.w / 2,
    qx0: q.x - q.w / 2,
    qx1: q.x + q.w / 2,
    rx0: r.x - r.w / 2,
    rx1: r.x + r.w / 2,
    sx: v.x - v.w / 2,
    slotW: q.w / Math.max(1, m.cfg.qcap),
    ack: { x0: v.x - v.w * 0.3, y0: v.y + v.h / 2, cx: (a.x + v.x) / 2, cy: y + drop + 26, x1: a.x + a.w * 0.3, y1: a.y + a.h / 2 },
    alice: { x: a.x, y: a.y, w: a.w, h: a.h },
    router: { x: r.x, y: r.y, w: r.w, h: r.h },
    srv: { x: v.x, y: v.y, w: v.w, h: v.h },
  };
}

function quad(p: PipeGeom['ack'], t: number) {
  const u = 1 - t;
  return { x: u * u * p.x0 + 2 * u * t * p.cx + t * t * p.x1, y: u * u * p.y0 + 2 * u * t * p.cy + t * t * p.y1 };
}

export function ackPathD(p: PipeGeom['ack']) {
  return `M${p.x0.toFixed(1)},${p.y0.toFixed(1)} Q${p.cx.toFixed(1)},${p.cy.toFixed(1)} ${p.x1.toFixed(1)},${p.y1.toFixed(1)}`;
}

/** Where a segment is drawn in the pipe view right now (null = not visible). */
export function pipePos(g: PipeGeom, m: TcpModel, s: Seg): { x: number; y: number; queued: boolean } | null {
  const now = m.now;
  if (s.from === 's') {
    const t = s.status === 'lost' ? (s.lostAt ?? 0.5) : clamp((now - s.sent) / Math.max(1e-6, s.arrive - s.sent), 0, 1);
    if (s.status === 'done') return null;
    const p = quad(g.ack, t);
    return { ...p, queued: false };
  }
  const leg1 = m.cfg.owd / 2;
  if (!s.hop) {
    if (s.status === 'done') return null;
    const t = s.status === 'lost' ? (s.lostAt ?? 0.5) : clamp((now - s.sent) / leg1, 0, 1);
    return { x: lerp(g.ax, g.qx0, t), y: g.y, queued: false };
  }
  if (now < s.hop.dep) {
    const svc = m.cfg.svc * (s.len > 0 ? s.len / m.cfg.mss : 0.2);
    const slot = clamp((s.hop.dep - now) / m.cfg.svc - 0.5 * (svc / m.cfg.svc), 0, m.cfg.qcap);
    const x = g.qx1 - (slot + 0.5) * g.slotW;
    const into = clamp((now - s.hop.at) / 40, 0, 1);
    return { x: lerp(g.qx0, Math.max(g.qx0, x), into), y: g.y, queued: true };
  }
  if (s.status === 'done') return null;
  const t = s.status === 'lost' ? (s.lostAt ?? 0.5) : clamp((now - s.hop.dep) / Math.max(1e-6, s.arrive - s.hop.dep), 0, 1);
  return { x: lerp(g.rx1, g.sx, t), y: g.y, queued: false };
}
