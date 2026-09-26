'use client';

import type { ReactNode } from 'react';
import { SIG } from '@/lib/sim/colors';
import type { Curve } from '../engine/chart';
import { plotGeo, type PlotGeo } from '../layout';
import { commas, fmtCountLg, sup } from '../model';
import type { BigOSim } from '../sim';
import css from '../bigo.module.css';

const SAMPLES = 220;
const L10 = Math.log10;

/** Screen mapping for the current zoom and linear↔log mix. */
export function chartScale(sim: BigOSim, p: PlotGeo) {
  const c = sim.chart;
  const N = 10 ** c.lgN;
  const X = 1.25 * N;
  const lgY = c.topLg(X);
  const lgX2 = L10(2 * N);
  const lgTop = c.topLg(2 * N);
  const W = p.x1 - p.x0;
  const H = p.y1 - p.y0;
  const m = c.mix;
  /** screen y for a value given as log10, at parameter u (for the linear half) */
  const yLin = (lgv: number) => {
    const d = lgv - lgY;
    const ratio = d > 4 ? 1e4 : 10 ** d;
    return p.y1 - ratio * H;
  };
  const yLog = (lgv: number) => p.y1 - ((lgv + 0.3) / (lgTop + 0.3)) * H;
  return {
    N,
    X,
    lgY,
    lgX2,
    lgTop,
    m,
    /** Point on a curve at sample u in [0, 1] */
    at(curve: Curve, u: number) {
      const nLin = Math.max(u * X, 1e-9);
      const nLog = 10 ** (u * lgX2);
      const a = yLin(curve.lg(Math.max(1, nLin)));
      const b = yLog(curve.lg(nLog));
      return { x: p.x0 + u * W, y: Math.max(p.y0 - 4000, a + (b - a) * m) };
    },
    /** Screen x of a given n */
    xOf(n: number) {
      const ul = n / X;
      const ug = L10(Math.max(1, n)) / lgX2;
      return p.x0 + (ul + (ug - ul) * m) * W;
    },
    yOfLg(lgv: number) {
      const a = yLin(lgv);
      const b = yLog(lgv);
      return Math.max(p.y0 - 4000, a + (b - a) * m);
    },
  };
}

function niceStep(raw: number) {
  const e = 10 ** Math.floor(L10(raw));
  const f = raw / e;
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * e;
}

const shortNum = (v: number) => {
  if (v >= 1e12) return `${+(v / 1e12).toFixed(1)}T`;
  if (v >= 1e9) return `${+(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${+(v / 1e6).toFixed(1)}M`;
  if (v >= 1e4) return `${+(v / 1e3).toFixed(0)}K`;
  return commas(v);
};

const pow10Label = (k: number) => (k <= 3 ? commas(10 ** k) : k === 6 ? '1M' : k === 9 ? '1B' : k === 12 ? '1T' : `10${sup(k)}`);

export function ChartScene({ sim, hl }: { sim: BigOSim; hl: string | null }) {
  const c = sim.chart;
  const p = plotGeo(sim);
  const s = chartScale(sim, p);
  const land = sim.orient === 'landscape';
  const W = p.x1 - p.x0;
  const H = p.y1 - p.y0;
  const curves = c.curves;
  const clipId = 'bigo-plot-clip';

  /* ---------- gridlines & ticks (crossfaded between linear and log) ---------- */
  const grid: ReactNode[] = [];
  const linA = 1 - s.m;
  const logA = s.m;
  if (linA > 0.02) {
    const xs = niceStep(s.X / (land ? 5 : 3));
    for (let v = xs; v <= s.X * 1.0001; v += xs) {
      const x = p.x0 + (v / s.X) * W;
      grid.push(<line key={`lx${v}`} className={css.gridline} x1={x} x2={x} y1={p.y0} y2={p.y1} opacity={linA} />);
      grid.push(
        <text key={`lxt${v}`} className={css.mono} x={x} y={p.y1 + 14} textAnchor="middle" opacity={linA} style={{ fontSize: 9 }}>
          {shortNum(v)}
        </text>,
      );
    }
    const Y = 10 ** s.lgY;
    const ys = niceStep(Y / 4);
    for (let v = ys; v <= Y * 1.0001; v += ys) {
      const y = p.y1 - (v / Y) * H;
      grid.push(<line key={`ly${v}`} className={css.gridline} x1={p.x0} x2={p.x1} y1={y} y2={y} opacity={linA} />);
      grid.push(
        <text key={`lyt${v}`} className={css.mono} x={p.x0 - 6} y={y + 3} textAnchor="end" opacity={linA} style={{ fontSize: 9 }}>
          {shortNum(v)}
        </text>,
      );
    }
  }
  if (logA > 0.02) {
    const maxX = Math.floor(s.lgX2);
    for (let k = 0; k <= maxX; k++) {
      const x = p.x0 + (k / s.lgX2) * W;
      grid.push(<line key={`gx${k}`} className={css.gridline} x1={x} x2={x} y1={p.y0} y2={p.y1} opacity={logA} />);
      const every = maxX > 4 && !land ? 2 : 1;
      if (k % every === 0)
        grid.push(
          <text key={`gxt${k}`} className={css.mono} x={x} y={p.y1 + 14} textAnchor="middle" opacity={logA} style={{ fontSize: 9 }}>
            {pow10Label(k)}
          </text>,
        );
    }
    const maxY = Math.floor(s.lgTop);
    const every = maxY > 8 ? 3 : maxY > 4 ? 2 : 1;
    for (let k = 0; k <= maxY; k++) {
      const y = p.y1 - ((k + 0.3) / (s.lgTop + 0.3)) * H;
      grid.push(<line key={`gy${k}`} className={css.gridline} x1={p.x0} x2={p.x1} y1={y} y2={y} opacity={logA * (k % every === 0 ? 1 : 0.5)} />);
      if (k % every === 0)
        grid.push(
          <text key={`gyt${k}`} className={css.mono} x={p.x0 - 6} y={y + 3} textAnchor="end" opacity={logA} style={{ fontSize: 9 }}>
            {pow10Label(k)}
          </text>,
        );
    }
  }

  /* ---------- curves ---------- */
  const paths: ReactNode[] = [];
  const labels: { id: string; x: number; y: number; color: string; text: string; exit: boolean }[] = [];
  const pts = new Map<string, { x: number; y: number }[]>();
  for (const cv of curves) {
    const arr: { x: number; y: number }[] = [];
    let exit: { x: number; y: number } | null = null;
    let prev: { x: number; y: number } | null = null;
    for (let i = 0; i <= SAMPLES; i++) {
      const u = i / SAMPLES;
      const pt = cv.id === 'exp' ? s.at(cv, u * u) : s.at(cv, u);
      arr.push(pt);
      if (!exit && pt.y < p.y0 && prev && prev.y >= p.y0) {
        const k = (prev.y - p.y0) / Math.max(1e-6, prev.y - pt.y);
        exit = { x: prev.x + (pt.x - prev.x) * k, y: p.y0 };
      }
      prev = pt;
    }
    pts.set(cv.id, arr);
    const end = arr[arr.length - 1];
    labels.push(
      exit ? { id: cv.id, x: exit.x, y: p.y0, color: cv.color, text: cv.label, exit: true } : { id: cv.id, x: p.x1, y: end.y, color: cv.color, text: cv.label, exit: false },
    );
  }

  // shade the gap between each pair in the rules chart
  if (c.mode === 'rules') {
    const pairs: [string, string, string][] = [
      ['n2+100n', 'n2', 'rgba(255,154,60,0.13)'],
      ['3n', 'n', 'rgba(69,213,255,0.12)'],
    ];
    for (const [a, b, fill] of pairs) {
      const A = pts.get(a);
      const B = pts.get(b);
      if (!A || !B) continue;
      const d = `M${A.map((q) => `${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(' L')} L${[...B]
        .reverse()
        .map((q) => `${q.x.toFixed(1)},${q.y.toFixed(1)}`)
        .join(' L')} Z`;
      paths.push(<path key={`sh${a}`} d={d} fill={fill} />);
    }
  }

  for (const cv of curves) {
    const arr = pts.get(cv.id)!;
    const hot = hl === `curve:${cv.id}`;
    const d = `M${arr.map((q) => `${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(' L')}`;
    paths.push(
      <g key={cv.id}>
        {hot && <path d={d} fill="none" stroke={cv.color} strokeWidth={8} opacity={0.18} strokeLinejoin="round" />}
        <path d={d} fill="none" stroke={cv.color} strokeWidth={hot ? 3 : 2} strokeDasharray={cv.dashed ? '6 5' : undefined} strokeLinejoin="round" strokeLinecap="round" />
      </g>,
    );
  }

  /* ---------- cursor at n ---------- */
  const N = c.nNow;
  const cx = s.xOf(N);
  const dots = curves.map((cv) => {
    const y = s.yOfLg(cv.lg(N));
    return { cv, y, off: y < p.y0 };
  });

  /* ---------- label de-collision (right edge) ---------- */
  const right = labels.filter((l) => !l.exit).sort((a, b) => b.y - a.y);
  for (let i = 0; i < right.length; i++) {
    const lim = i === 0 ? p.y1 - 2 : right[i - 1].y - 13;
    right[i].y = Math.min(right[i].y, lim);
  }
  const tops = labels.filter((l) => l.exit).sort((a, b) => a.x - b.x);
  for (let i = 1; i < tops.length; i++) tops[i].x = Math.max(tops[i].x, tops[i - 1].x + tops[i - 1].text.length * 7 + 12);

  return (
    <g>
      <defs>
        <clipPath id={clipId}>
          <rect x={p.x0} y={p.y0 - 1} width={W + 1} height={H + 2} />
        </clipPath>
      </defs>
      {hl === 'plot' && <rect x={p.x0 - 8} y={p.y0 - 8} width={W + 16} height={H + 16} rx={8} fill="none" stroke="var(--accent)" strokeDasharray="3 3" />}
      {grid}
      <path className={css.axis} d={`M${p.x0},${p.y0 - 6} V${p.y1} H${p.x1 + 6}`} />
      <text className={css.caps} x={p.x0 + 6} y={p.y0 + 4}>
        steps{s.m > 0.5 ? ' (log)' : ''}
      </text>
      <text className={css.caps} x={p.x1} y={p.y1 + (land ? 28 : 24)} textAnchor="end">
        input size n{s.m > 0.5 ? ' (log)' : ''} →
      </text>
      <g clipPath={`url(#${clipId})`}>{paths}</g>

      {/* cursor */}
      <line x1={cx} x2={cx} y1={p.y0} y2={p.y1} stroke={SIG.warn} strokeWidth={1.2} strokeDasharray="3 4" opacity={0.75} />
      <g transform={`translate(${Math.min(p.x1 - 30, Math.max(p.x0 + 30, cx))},${p.y1 - 12})`}>
        <rect x={-38} y={-10} width={76} height={19} rx={9.5} fill="rgba(7,11,20,0.92)" stroke={SIG.warn} strokeOpacity={0.6} />
        <text className={css.monoStrong} x={0} y={4} textAnchor="middle" style={{ fill: SIG.warn, fontSize: 10.5 }}>
          n = {shortNum(Math.round(N))}
        </text>
      </g>
      {dots.map(({ cv, y, off }) =>
        off ? (
          <path key={`d${cv.id}`} d={`M${cx},${p.y0 + 2} l-5,8 h10 z`} fill={cv.color} opacity={0.9} />
        ) : (
          <circle key={`d${cv.id}`} cx={cx} cy={y} r={4.2} fill={cv.color} stroke="var(--ink-1)" strokeWidth={1.5} />
        ),
      )}

      {/* curve labels */}
      {labels.map((l) => (
        <text
          key={`l${l.id}`}
          className={`${css.monoStrong} ${css.halo}`}
          x={l.exit ? l.x + 5 : l.x - 4}
          y={l.exit ? l.y + 14 : l.y - 5}
          textAnchor={l.exit ? 'start' : 'end'}
          style={{ fill: l.color, fontSize: land ? 12.5 : 11 }}
        >
          {l.text}
          {l.exit ? ' ↑' : ''}
        </text>
      ))}
    </g>
  );
}

/** Values at the cursor for the readouts. */
export function chartValues(sim: BigOSim) {
  const c = sim.chart;
  const N = Math.round(c.N);
  return c.curves.map((cv) => ({ cv, lg: cv.lg(N), text: fmtCountLg(cv.lg(N)) }));
}
