'use client';

import type { ReactNode } from 'react';
import { SIG } from '@/lib/sim/colors';
import { gridGeo } from '../layout';
import type { BigOSim } from '../sim';
import css from '../bigo.module.css';

const PAIR = SIG.heavy;
const I_COL = SIG.warn;
const J_COL = SIG.req;

export function GridScene({ sim, hl }: { sim: BigOSim; hl: string | null }) {
  const gr = sim.grid;
  const n = gr.n;
  const g = gridGeo(sim, n);
  const c = g.cell;
  const S = c * n;
  const land = sim.orient === 'landscape';
  const cur = gr.cur;
  const flash = Math.max(0, 1 - (sim.vt - gr.lastVt) / 0.25);
  const fs = Math.min(12, c * 0.42);
  const hsz = Math.min(g.hs, c);
  // index of pair (i, j), j > i, in row-major order
  const pairIdx = (i: number, j: number) => i * n - (i * (i + 1)) / 2 + (j - i - 1);

  const cells: ReactNode[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const x = g.gx + j * c;
      const y = g.gy + i * c;
      if (j > i) {
        const idx = pairIdx(i, j);
        const done = idx < gr.k;
        const now = cur && cur[0] === i && cur[1] === j;
        cells.push(
          <rect
            key={`${i}-${j}`}
            x={x + 1}
            y={y + 1}
            width={c - 2}
            height={c - 2}
            rx={Math.min(4, c / 6)}
            fill={now ? `rgba(255,154,60,${0.55 + 0.4 * flash})` : done ? 'rgba(255,154,60,0.42)' : 'rgba(143,166,201,0.04)'}
            stroke={now ? PAIR : done ? 'rgba(255,154,60,0.7)' : 'rgba(143,166,201,0.22)'}
            strokeWidth={now ? 1.6 : 1}
          />,
        );
      } else {
        cells.push(<rect key={`${i}-${j}`} x={x + 1} y={y + 1} width={c - 2} height={c - 2} rx={Math.min(4, c / 6)} fill={j === i ? 'rgba(143,166,201,0.1)' : 'url(#kit-hatch-dim)'} opacity={0.8} />);
      }
    }
  }

  return (
    <g>
      {hl === 'grid' && <rect x={g.gx - 6} y={g.gy - 6} width={S + 12} height={S + 12} rx={8} fill="none" stroke="var(--accent)" strokeDasharray="3 3" />}
      {cells}
      {/* headers: the same array along both axes */}
      {gr.vals.map((v, j) => {
        const on = cur?.[1] === j;
        return (
          <g key={`h${j}`}>
            <rect x={g.gx + j * c + 1} y={g.gy - hsz - 3} width={c - 2} height={hsz} rx={3} fill={on ? 'rgba(69,213,255,0.18)' : 'var(--node-fill)'} stroke={on ? J_COL : 'rgba(143,166,201,0.35)'} />
            <text className={css.cellTextSm} x={g.gx + j * c + c / 2} y={g.gy - hsz / 2 - 3 + fs * 0.36} textAnchor="middle" style={{ fontSize: fs, fill: on ? J_COL : undefined }}>
              {v}
            </text>
          </g>
        );
      })}
      {gr.vals.map((v, i) => {
        const on = cur?.[0] === i;
        return (
          <g key={`v${i}`}>
            <rect x={g.gx - hsz - 3} y={g.gy + i * c + 1} width={hsz} height={c - 2} rx={3} fill={on ? 'rgba(255,210,63,0.16)' : 'var(--node-fill)'} stroke={on ? I_COL : 'rgba(143,166,201,0.35)'} />
            <text className={css.cellTextSm} x={g.gx - hsz / 2 - 3} y={g.gy + i * c + c / 2 + fs * 0.36} textAnchor="middle" style={{ fontSize: fs, fill: on ? I_COL : undefined }}>
              {v}
            </text>
          </g>
        );
      })}
      {/* loop labels */}
      <text className={`${css.monoStrong} ${css.halo}`} x={g.gx - hsz - 3} y={g.gy - hsz - 9} textAnchor="start" style={{ fill: 'var(--text-3)', fontSize: land ? 10 : 9 }}>
        {land ? 'i ↓   j →' : 'i↓ j→'}
      </text>
      {cur && land && (
        <text className={`${css.monoStrong} ${css.halo}`} x={g.gx + S} y={g.gy + S + 22} textAnchor="end" style={{ fill: PAIR, fontSize: 11.5 }}>
          arr[{cur[0]}] === arr[{cur[1]}]? {gr.vals[cur[0]]} vs {gr.vals[cur[1]]}
        </text>
      )}
      {gr.state === 'done' && (
        <text className={`${css.monoStrong} ${css.halo}`} x={g.gx + S} y={g.gy + S + (land ? 22 : 16)} textAnchor="end" style={{ fill: SIG.res, fontSize: land ? 11.5 : 10 }}>
          {gr.total} comparisons · no duplicates
        </text>
      )}
    </g>
  );
}
