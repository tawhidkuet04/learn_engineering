'use client';

import type { ReactNode } from 'react';
import { SIG } from '@/lib/sim/colors';
import { FLY } from '../engine/merge';
import { mergeGeo } from '../layout';
import { ease } from '../model';
import type { BigOSim } from '../sim';
import css from '../bigo.module.css';

/** Cell tint by value, so sorted runs read as smooth gradients. */
const tint = (v: number) => 0.08 + 0.42 * ((v - 10) / 88);

export function MergeScene({ sim, hl }: { sim: BigOSim; hl: string | null }) {
  const m = sim.merge;
  const g = mergeGeo(sim, m.n, m.L);
  const small = g.cell < 26;
  const vt = sim.vt;
  const split = m.mode === 'split';

  const cellEl = (key: string | number, x: number, y: number, v: number | null, level: number, dim = false, fresh = 0) => {
    const glow = hl === `level:${level}` || hl === 'levels';
    if (v == null) return <rect key={key} className={css.slot} x={x} y={y} width={g.cell} height={g.ch} rx={small ? 3 : 5} style={glow ? { stroke: 'var(--accent)' } : undefined} />;
    return (
      <g key={key} opacity={dim ? 0.4 : 1}>
        <rect
          x={x}
          y={y}
          width={g.cell}
          height={g.ch}
          rx={small ? 3 : 5}
          fill={split ? 'var(--node-fill)' : `rgba(181,155,255,${tint(v)})`}
          stroke={fresh > 0 ? SIG.warn : glow ? 'var(--accent)' : split ? 'rgba(143,166,201,0.5)' : 'rgba(181,155,255,0.6)'}
          strokeWidth={fresh > 0 ? 1.6 : 1.1}
        />
        <text className={small ? css.cellTextSm : css.cellText} x={x + g.cell / 2} y={y + g.ch / 2 + (small ? 3.5 : 4.5)} textAnchor="middle" style={small ? { fontSize: g.cell < 20 ? 9 : 10 } : undefined}>
          {v}
        </text>
      </g>
    );
  };

  const rows: ReactNode[] = [];
  for (let l = 0; l <= m.L; l++) {
    const y = g.rowY(l);
    if (split) {
      const rv = m.rowVt[l];
      if (rv == null) continue;
      const k = ease(Math.min(1, (vt - rv) / 0.55));
      rows.push(
        <g key={l} opacity={l === 0 ? k : 1}>
          {m.vals.map((v, i) => {
            const x1 = g.cellX(l, i);
            const x0 = l === 0 ? x1 : g.cellX(l - 1, i);
            const y0 = l === 0 ? y : g.rowY(l - 1);
            return cellEl(i, x0 + (x1 - x0) * k, y0 + (y - y0) * k, v, l);
          })}
        </g>,
      );
    } else {
      rows.push(
        <g key={l}>
          {m.rows[l].map((v, i) => cellEl(i, g.cellX(l, i), y, v, l, !!m.used[l]?.[i]))}
        </g>,
      );
    }
  }

  // split brackets under each group
  const brackets: ReactNode[] = [];
  const shownRows = split ? m.rowVt.length : m.L + 1;
  for (let l = 1; l < shownRows; l++) {
    const size = m.n >> l;
    const k = split ? ease(Math.min(1, (vt - (m.rowVt[l] ?? vt)) / 0.55)) : 1;
    for (let gI = 0; gI < 1 << l; gI++) {
      const a = g.cellX(l, gI * size);
      const b = g.cellX(l, gI * size + size - 1) + g.cell;
      const pa = g.cellX(l - 1, gI * size);
      const pb = g.cellX(l - 1, gI * size + size - 1) + g.cell;
      const py = g.rowY(l - 1) + g.ch + 3;
      const cy = g.rowY(l) - 3;
      brackets.push(
        <path
          key={`${l}-${gI}`}
          d={`M${(pa + pb) / 2},${py} C${(pa + pb) / 2},${(py + cy) / 2} ${(a + b) / 2},${(py + cy) / 2} ${(a + b) / 2},${cy}`}
          fill="none"
          stroke="rgba(143,166,201,0.22)"
          strokeWidth={1}
          opacity={k}
        />,
      );
    }
  }

  // flying tokens (merge)
  const tokens = split
    ? null
    : m.flying.map((f, i) => {
        const p = Math.min(1, (sim.t - f.t0) / FLY);
        const e = ease(p);
        const x0 = g.cellX(f.pick.level + 1, f.pick.from);
        const y0 = g.rowY(f.pick.level + 1);
        const x1 = g.cellX(f.pick.level, f.pick.to);
        const y1 = g.rowY(f.pick.level);
        const x = x0 + (x1 - x0) * e;
        const y = y0 + (y1 - y0) * e - Math.sin(Math.PI * e) * 16;
        return (
          <g key={`t${i}`}>
            <rect x={x - 2} y={y - 2} width={g.cell + 4} height={g.ch + 4} rx={small ? 4 : 6} fill="none" stroke={SIG.warn} strokeOpacity={0.35} />
            <rect x={x} y={y} width={g.cell} height={g.ch} rx={small ? 3 : 5} fill={`rgba(181,155,255,${tint(f.pick.v) + 0.15})`} stroke={SIG.warn} strokeWidth={1.5} />
            <text className={small ? css.cellTextSm : css.cellText} x={x + g.cell / 2} y={y + g.ch / 2 + (small ? 3.5 : 4.5)} textAnchor="middle" style={small ? { fontSize: g.cell < 20 ? 9 : 10 } : undefined}>
              {f.pick.v}
            </text>
          </g>
        );
      });

  return (
    <g>
      {brackets}
      {rows}
      {tokens}
      {g.land && <Labels sim={sim} />}
    </g>
  );
}

function Labels({ sim }: { sim: BigOSim }) {
  const m = sim.merge;
  const g = mergeGeo(sim, m.n, m.L);
  const split = m.mode === 'split';
  const out: ReactNode[] = [];
  for (let l = 0; l <= m.L; l++) {
    const y = g.rowY(l) + g.ch / 2;
    const shown = split ? l < m.rowVt.length : true;
    if (!shown) continue;
    const pieces = 1 << l;
    const size = m.n >> l;
    out.push(
      <g key={`l${l}`}>
        <text className={css.caps} x={g.labelX} y={y - 3}>
          level {l}
        </text>
        <text className={css.mono} x={g.labelX} y={y + 11}>
          {pieces} × {size} item{size === 1 ? '' : 's'}
        </text>
      </g>,
    );
    if (!split && l < m.L) {
      const moves = m.levelMoves[l] ?? 0;
      const full = moves >= m.n;
      const act = m.level === l;
      out.push(
        <text
          key={`r${l}`}
          className={css.monoStrong}
          x={g.rightX}
          y={y + 4}
          textAnchor="end"
          style={{ fill: full ? SIG.res : act ? SIG.warn : 'var(--text-3)', fontSize: 11.5 }}
        >
          {moves ? `${moves} / ${m.n} moves` : `${m.n} moves`}
        </text>,
      );
    }
    if (split && l > 0) {
      out.push(
        <text key={`h${l}`} className={css.monoStrong} x={g.rightX} y={y + 4} textAnchor="end" style={{ fill: SIG.hc, fontSize: 11.5 }}>
          halving {l}
        </text>,
      );
    }
  }
  return <g>{out}</g>;
}
