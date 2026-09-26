'use client';

import { SIG } from '@/lib/sim/colors';
import { classifyGeo } from '../layout';
import { CLASSES, easeOut } from '../model';
import type { BigOSim } from '../sim';
import css from '../bigo.module.css';

const NS = [8, 16, 32];

function step(a: number, b: number, answer: string) {
  if (answer === 'logn') return `+${b - a}`;
  if (a === b) return 'same';
  const r = b / a;
  return `×${Number.isInteger(r) ? r : r.toFixed(1)}`;
}

/** The doubling test: steps at n = 8, 16 and 32 once the snippet is revealed. */
export function ClassifyScene({ sim }: { sim: BigOSim }) {
  const cl = sim.classify;
  const s = cl.snippet;
  const g = classifyGeo(sim).test;
  const land = sim.orient === 'landscape';
  const revealed = cl.revealed;
  const k = revealed ? easeOut(Math.min(1, (sim.vt - cl.revealVt) / 0.7)) : 0;
  const color = CLASSES[s.answer].color;
  const max = Math.max(...s.counts);
  const top = g.y0 + (land ? 40 : 34);
  const base = g.y1 - (land ? 34 : 26);
  const Hh = base - top;
  const slot = (g.x1 - g.x0) / 3;
  const bw = Math.min(land ? 92 : 56, slot * 0.5);

  return (
    <g>
      <text className={css.caps} x={g.x0} y={g.y0 + 8}>
        the doubling test · steps as n doubles
      </text>
      {revealed && (
        <text className={`${css.badgeText} ${css.halo}`} x={g.x1} y={g.y0 + 10} textAnchor="end" style={{ fill: color, fontSize: land ? 15 : 13, opacity: k }}>
          {CLASSES[s.answer].big}
        </text>
      )}
      <line x1={g.x0} x2={g.x1} y1={base} y2={base} className={css.axis} />
      {NS.map((n, i) => {
        const cx = g.x0 + slot * (i + 0.5);
        const v = s.counts[i];
        const h = Math.max(3, (v / max) * Hh) * k;
        return (
          <g key={n}>
            {revealed ? (
              <rect x={cx - bw / 2} y={base - h} width={bw} height={h} rx={4} fill={color} opacity={0.75} />
            ) : (
              <rect x={cx - bw / 2} y={base - Hh * 0.45} width={bw} height={Hh * 0.45} rx={4} fill="rgba(143,166,201,0.04)" stroke="rgba(143,166,201,0.3)" strokeDasharray="4 4" />
            )}
            <text className={css.monoStrong} x={cx} y={revealed ? base - h - 8 : base - Hh * 0.45 - 8} textAnchor="middle" style={{ fill: revealed ? 'var(--text-1)' : 'var(--text-3)', fontSize: land ? 13 : 11.5 }}>
              {revealed ? v.toLocaleString('en-US') : '?'}
            </text>
            <text className={css.mono} x={cx} y={base + 16} textAnchor="middle" style={{ fontSize: land ? 10.5 : 9.5 }}>
              n = {n}
            </text>
            {i > 0 && revealed && (
              <g opacity={k}>
                <text className={`${css.monoStrong} ${css.halo}`} x={cx - slot / 2} y={top + 4} textAnchor="middle" style={{ fill: SIG.warn, fontSize: land ? 12 : 10.5 }}>
                  {step(s.counts[i - 1], v, s.answer)}
                </text>
              </g>
            )}
          </g>
        );
      })}
    </g>
  );
}
