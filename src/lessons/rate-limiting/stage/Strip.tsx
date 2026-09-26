import type { ReactNode } from 'react';
import { SIG } from '@/lib/sim/colors';
import { clamp } from '@/lib/sim/geometry';
import { fmtClock, type RateSim, type Rect } from '../sim';
import css from './rl.module.css';

const BIN = 0.25;
/** A dark outline so labels stay readable over lines and hatching. */
const HALO = { paintOrder: 'stroke', stroke: 'rgba(9,14,26,0.92)', strokeWidth: 3, strokeLinejoin: 'round' } as const;

export interface StripGeo {
  x0: number;
  x1: number;
  xNow: number;
  pxs: number;
  axisY: number;
  plotTop: number;
  plotBot: number;
  X: (t: number) => number;
}

/**
 * Shared geometry so callouts can point at things on the strip. History
 * fills in from the left; once the strip is full it scrolls.
 */
export function stripGeo(sim: RateSim, r: Rect): StripGeo {
  const L = sim.orient === 'landscape';
  const storm = sim.cfg.scene === 'storm';
  const pxs = L ? (storm ? 30 : 44) : storm ? 16 : 25;
  const x0 = r.x + 10;
  const x1 = r.x + r.w - (L ? 40 : 30);
  const flow = sim.cfg.strip === 'flow';
  const head = L ? 26 : 21;
  const foot = L ? 18 : 15;
  const plotTop = r.y + head;
  const plotBot = r.y + r.h - foot;
  const axisY = flow ? plotTop + (plotBot - plotTop) * 0.6 : plotBot;
  const now = sim.lt;
  const xNow = Math.min(x1, x0 + 14 + Math.max(0, now - sim.stripStart) * pxs);
  return { x0, x1, xNow, pxs, axisY, plotTop, plotBot, X: (t: number) => xNow - (now - t) * pxs };
}

export function Strip({ sim, rect, dim, glow }: { sim: RateSim; rect: Rect; dim?: boolean; glow?: boolean }) {
  const L = sim.orient === 'landscape';
  const g = stripGeo(sim, rect);
  const { x0, x1, xNow, pxs, axisY, plotTop, plotBot, X } = g;
  const now = sim.lt;
  const tFrom = Math.max(sim.stripStart - 1e-6, now - (xNow - x0) / pxs);
  const flow = sim.cfg.strip === 'flow';
  const algo = sim.cfg.algo;
  const W = sim.cfg.window;
  const binW = BIN * pxs;
  const sqW = Math.max(3, binW - (L ? 2 : 1.4));
  const sqH = L ? 7 : 5;
  const step = sqH + (L ? 2 : 1.5);
  const fade = (x: number) => clamp((x - x0) / 36, 0, 1);
  const labelSize = L ? 9 : 8;

  // Bin the decisions: allowed at the bottom, rejected stacked above.
  const bins = new Map<number, { ok: number; no: number }>();
  for (const e of sim.events) {
    if (e.t < tFrom - BIN) continue;
    const b = Math.floor(e.t / BIN + 1e-9);
    const cur = bins.get(b) ?? { ok: 0, no: 0 };
    if (e.ok) cur.ok++;
    else cur.no++;
    bins.set(b, cur);
  }
  const outBins = new Map<number, number>();
  if (flow) {
    for (const t of sim.outs) {
      if (t < tFrom - BIN) continue;
      const b = Math.floor(t / BIN + 1e-9);
      outBins.set(b, (outBins.get(b) ?? 0) + 1);
    }
  }

  const upRoom = Math.max(1, Math.floor((axisY - plotTop - 16) / step));
  const downRoom = Math.max(1, Math.floor((plotBot - axisY - 14) / step));

  const squares: ReactNode[] = [];
  for (const [b, v] of bins) {
    const x = X(b * BIN);
    if (x < x0 - binW || x > xNow + 1) continue;
    const o = fade(x);
    const total = v.ok + v.no;
    const k = total > upRoom ? upRoom / total : 1;
    for (let i = 0; i < total; i++) {
      const ok = i < v.ok;
      squares.push(<rect key={`${b}-${i}`} x={x + 1} y={axisY - 2 - (i + 1) * step * k} width={sqW} height={Math.max(1.5, sqH * k)} rx={1.5} fill={ok ? SIG.res : SIG.err} opacity={o * 0.92} />);
    }
  }
  for (const [b, n] of outBins) {
    const x = X(b * BIN);
    if (x < x0 - binW || x > xNow + 1) continue;
    const k = n > downRoom ? downRoom / n : 1;
    for (let i = 0; i < n; i++) squares.push(<rect key={`o${b}-${i}`} x={x + 1} y={axisY + 2 + i * step * k} width={sqW} height={Math.max(1.5, sqH * k)} rx={1.5} fill={SIG.req} opacity={fade(x) * 0.9} />);
  }

  // Time ticks every 5 s
  const ticks: number[] = [];
  for (let t = Math.ceil(tFrom / 5 - 1e-9) * 5; t <= now + 1e-6; t += 5) ticks.push(t);

  // Fixed window edges (for the window algorithms)
  const showEdges = algo === 'fixed' || algo === 'sliding';
  const edges: number[] = [];
  if (showEdges) for (let t = Math.ceil(tFrom / W - 1e-9) * W; t <= now + 1e-6; t += W) edges.push(t);

  const sliding = algo === 'log' || algo === 'sliding';
  const best = sim.best;
  const showBest = sim.cfg.span && best.count > sim.cfg.limit && X(best.start + Math.min(W, 3)) > x0;
  const headY = rect.y + (L ? 16 : 13);
  // Labels sit right of their line, or left of it near "now", and never spill out of the strip.
  const label = (x: number, y: number, text: string, color: string, size = labelSize) => {
    const tw = text.length * size * 0.8;
    let right = x > xNow - tw - 8;
    let lx = right ? x - 4 : x + 4;
    if (right && lx - tw < x0) {
      right = false;
      lx = Math.max(x0 + 2, Math.min(x + 4, x1 - tw));
    }
    return (
      <text className={css.caps} x={lx} y={y} textAnchor={right ? 'end' : 'start'} style={{ fill: color, fontSize: size, ...HALO }}>
        {text}
      </text>
    );
  };

  return (
    <g opacity={dim ? 0.3 : 1}>
      {glow && <rect x={rect.x - 5} y={rect.y - 5} width={rect.w + 10} height={rect.h + 10} rx={12} fill="none" stroke="var(--accent)" strokeWidth={1.4} strokeDasharray="3 3" />}
      <rect className={css.stripBox} x={rect.x} y={rect.y} width={rect.w} height={rect.h} rx={9} />
      <text className={css.caps} x={rect.x + 10} y={headY} style={{ fontSize: labelSize }}>
        {sim.cfg.scene === 'storm' ? 'attempts at the limiter' : L ? 'requests at the limiter · one square each' : 'at the limiter'}
      </text>
      <g transform={`translate(${rect.x + rect.w - 12},${headY})`}>
        <Key items={flow ? [['sent on', SIG.req], ['429', SIG.err], ['allowed', SIG.res]] : [['429', SIG.err], ['allowed', SIG.res]]} size={labelSize} />
      </g>

      {sliding && (
        <g>
          <rect x={Math.max(x0, X(now - W))} y={plotTop} width={xNow - Math.max(x0, X(now - W))} height={axisY - plotTop} fill="rgba(181,155,255,0.08)" stroke="rgba(181,155,255,0.45)" strokeWidth={1} rx={3} />
          {label(Math.max(x0, X(now - W)), plotTop + 20, `last ${W} s`, '#cdbdff')}
        </g>
      )}
      {algo === 'sliding' &&
        (() => {
          const start = Math.floor(now / W + 1e-9) * W;
          const a = Math.max(x0, X(now - W));
          const b = X(start);
          if (b <= a) return null;
          return <rect x={a} y={plotTop} width={b - a} height={axisY - plotTop} fill="url(#kit-hatch-dim)" opacity={0.9} />;
        })()}

      {edges.map((t) => {
        const x = X(t);
        if (x < x0) return null;
        return (
          <g key={`e${t}`} opacity={fade(x)}>
            <line className={css.edge} x1={x} y1={plotTop - 2} x2={x} y2={flow ? plotBot : axisY} />
            {label(x, plotTop + 8, L ? 'window resets' : 'reset', '#cdbdff', labelSize - 0.5)}
          </g>
        );
      })}

      {sim.markers.map((m, i) => {
        const x = X(m.t);
        if (x < x0 || x > xNow) return null;
        return (
          <g key={`m${i}`} opacity={fade(x)}>
            <line x1={x} y1={plotTop - 2} x2={x} y2={plotBot} stroke="rgba(255,210,63,0.55)" strokeWidth={1} />
            {label(x, plotTop + 32, m.label, 'rgba(255,210,63,0.9)', labelSize - 0.5)}
          </g>
        );
      })}

      {showBest && (
        <g>
          <rect x={Math.max(x0, X(best.start))} y={plotTop} width={Math.max(0, Math.min(xNow, X(best.start + W)) - Math.max(x0, X(best.start)))} height={axisY - plotTop} fill="rgba(255,210,63,0.07)" stroke="rgba(255,210,63,0.65)" strokeDasharray="4 3" rx={3} />
          {label(Math.max(x0, X(best.start)), plotTop + 32, `${best.count} allowed within ${W} s`, 'var(--accent)')}
        </g>
      )}

      {squares}

      <line className={css.axis} x1={x0} y1={axisY} x2={x1} y2={axisY} />
      {flow && (
        <text className={css.caps} x={x0 + 2} y={plotBot - 2} style={{ fontSize: labelSize - 0.5, fill: 'rgba(69,213,255,0.75)' }}>
          ↓ on to the server
        </text>
      )}
      {ticks.map((t) => {
        const x = X(t);
        if (x < x0 - 2) return null;
        return (
          <g key={`t${t}`} opacity={fade(x + 20)}>
            <line className={css.tick} x1={x} y1={plotBot} x2={x} y2={plotBot + 4} />
            <text className={css.monoDim} x={x} y={plotBot + (L ? 14 : 12)} textAnchor="middle" style={{ fontSize: L ? 9 : 8 }}>
              {fmtClock(t)}
            </text>
          </g>
        );
      })}
      <line x1={xNow} y1={plotTop - 4} x2={xNow} y2={plotBot + 2} stroke="rgba(255,210,63,0.6)" strokeWidth={1} />
      <text className={css.caps} x={xNow + 4} y={axisY - 3} style={{ fill: 'rgba(255,210,63,0.85)', fontSize: labelSize }}>
        now
      </text>
    </g>
  );
}

function Key({ items, size }: { items: [string, string][]; size: number }) {
  let x = 0;
  const out: ReactNode[] = [];
  for (const [label, color] of items) {
    const w = label.length * size * 0.8 + 22;
    x -= w;
    out.push(
      <g key={label} transform={`translate(${x},0)`}>
        <rect x={0} y={-6.5} width={7} height={6} rx={1.2} fill={color} />
        <text className={css.caps} x={11} y={0} style={{ fontSize: size }}>
          {label}
        </text>
      </g>,
    );
  }
  return <g>{out}</g>;
}
