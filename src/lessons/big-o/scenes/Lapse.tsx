'use client';

import { SIG } from '@/lib/sim/colors';
import { LAPSE_MAX, LAPSE_TICKS } from '../engine/lapse';
import { lapseGeo } from '../layout';
import { CLASSES, UNIVERSE_LG_NS, fmtCountLg, fmtTimeLg } from '../model';
import type { BigOSim } from '../sim';
import css from '../bigo.module.css';

export function LapseScene({ sim, hl }: { sim: BigOSim; hl: string | null }) {
  const lp = sim.lapse;
  const g = lapseGeo(sim, lp.lanes.length);
  const land = sim.orient === 'landscape';
  const W = g.tx1 - g.tx0;
  const X = (lg: number) => g.tx0 + (Math.max(0, Math.min(LAPSE_MAX, lg)) / LAPSE_MAX) * W;
  const play = lp.play;
  const px = X(play);
  const top = g.lanes[0]?.y ?? g.rulerY + 20;
  const last = g.lanes[g.lanes.length - 1];
  const bottom = last ? last.y + last.h : top;
  const ux = X(UNIVERSE_LG_NS);
  const ticks = land ? LAPSE_TICKS : LAPSE_TICKS.filter((t) => t.major);

  return (
    <g>
      {/* ruler */}
      <line x1={g.tx0} x2={g.tx1} y1={g.rulerY} y2={g.rulerY} stroke="rgba(143,166,201,0.45)" />
      {ticks.map((t, i) => {
        const x = X(t.lg);
        const universe = t.lg === UNIVERSE_LG_NS;
        const row = universe && land ? 2 : land ? i % 2 : 0;
        return (
          <g key={t.label}>
            <line x1={x} x2={x} y1={g.rulerY - 4} y2={g.rulerY + 4} stroke={universe ? SIG.err : 'rgba(143,166,201,0.6)'} />
            <line x1={x} x2={x} y1={g.rulerY + 4} y2={bottom} stroke={universe ? 'rgba(255,77,106,0.35)' : 'rgba(143,166,201,0.07)'} strokeDasharray={universe ? '3 4' : undefined} />
            <text
              className={css.mono}
              x={universe && land ? x + 3 : x}
              y={g.rulerY - 9 - row * 12}
              textAnchor={universe ? 'end' : i === 0 ? 'start' : 'middle'}
              style={{ fontSize: land ? 9.5 : 8.5, fill: universe ? SIG.err : t.major ? 'var(--text-2)' : undefined }}
            >
              {land ? t.label : t.short}
            </text>
          </g>
        );
      })}
      <text className={css.caps} x={g.tx0} y={g.rulerY - (land ? 36 : 30)} style={{ fontSize: 8.5 }}>
        time at 1 ns per step · log scale
      </text>

      {/* lanes */}
      {lp.lanes.map((id, i) => {
        const L = g.lanes[i];
        const c = CLASSES[id];
        const fin = lp.finishLg(id);
        const done = fin <= play;
        const beyond = fin > LAPSE_MAX;
        const barEnd = X(Math.min(play, fin));
        const dv = lp.doneVt.get(id);
        const flash = dv != null ? Math.max(0, 1 - (sim.vt - dv) / 0.8) : 0;
        const glow = hl === `lane:${id}`;
        const timeText = done ? fmtTimeLg(fin) : beyond && !lp.running ? 'never' : '';
        const lgNow = done || beyond ? fin : Math.min(fin, Math.max(0, play));
        const stepsText = `${beyond ? 'needs ' : ''}${fmtCountLg(lgNow)} step${lgNow < 1e-9 ? '' : 's'}`;
        return (
          <g key={id}>
            {land ? (
              <g>
                <text className={css.badgeText} x={L.labelX} y={L.ty - 1} style={{ fill: c.color, fontSize: 13.5 }}>
                  {c.big}
                </text>
                <text className={css.mono} x={L.labelX} y={L.ty + 14}>
                  {c.example}
                </text>
              </g>
            ) : (
              <g>
                <text className={css.badgeText} x={L.labelX} y={L.y + 11} style={{ fill: c.color, fontSize: 12 }}>
                  {c.big}
                  <tspan className={css.mono} dx={7} style={{ fontWeight: 400, fontSize: 9 }}>
                    {c.example}
                  </tspan>
                </text>
                <text className={css.monoStrong} x={L.valX} y={L.y + 11} textAnchor="end" style={{ fontSize: 10.5, fill: done ? c.color : beyond && !lp.running ? SIG.err : 'var(--text-3)' }}>
                  {timeText || (lp.running ? 'running…' : '')}
                </text>
              </g>
            )}
            <rect className={css.rail} x={g.tx0} y={L.ty - 7} width={W} height={14} rx={7} style={glow ? { stroke: 'var(--accent)', strokeDasharray: '3 3' } : undefined} />
            {barEnd > g.tx0 + 1 && <rect x={g.tx0} y={L.ty - 7} width={barEnd - g.tx0} height={14} rx={7} fill={c.color} opacity={done ? 0.28 : 0.22} />}
            {!done && play > 0 && <circle cx={barEnd} cy={L.ty} r={4.5} fill={c.color} />}
            {done && (
              <g transform={`translate(${X(fin)},${L.ty})`}>
                {flash > 0 && <circle r={9 + (1 - flash) * 14} fill="none" stroke={c.color} strokeWidth={2 * flash} opacity={flash} />}
                <circle r={7.5} fill={c.color} />
                <path d="M-3.4,0.4 L-1,2.8 L3.6,-2.2" fill="none" stroke="#0b1020" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
              </g>
            )}
            {beyond && !lp.running && (
              <g>
                <path d={`M${g.tx1 - 2},${L.ty - 6} l8,6 l-8,6`} fill="none" stroke={SIG.err} strokeWidth={1.6} />
              </g>
            )}
            {land && (
              <g>
                <text className={css.monoStrong} x={L.valX} y={L.ty - 1} textAnchor="end" style={{ fill: done ? c.color : beyond && !lp.running ? SIG.err : 'var(--text-3)', fontSize: 13 }}>
                  {timeText || (lp.running ? '…' : '')}
                </text>
                <text className={css.mono} x={L.valX} y={L.ty + 14} textAnchor="end">
                  {stepsText}
                </text>
              </g>
            )}
            {!land && (
              <text className={css.mono} x={L.valX} y={L.ty + 19} textAnchor="end" style={{ fontSize: 9 }}>
                {stepsText}
              </text>
            )}
          </g>
        );
      })}

      {/* playhead */}
      {play > -0.5 && (
        <g>
          <line x1={px} x2={px} y1={g.rulerY - 2} y2={bottom + 4} stroke={SIG.warn} strokeWidth={1.3} opacity={0.85} />
          <g transform={`translate(${Math.min(g.tx1 - 34, Math.max(g.tx0 + 34, px))},${bottom + 16})`}>
            <rect x={-40} y={-10} width={80} height={19} rx={9.5} fill="rgba(7,11,20,0.92)" stroke={SIG.warn} strokeOpacity={0.6} />
            <text className={css.monoStrong} x={0} y={4} textAnchor="middle" style={{ fill: SIG.warn, fontSize: 10.5 }}>
              {fmtTimeLg(Math.max(0, play))}
            </text>
          </g>
        </g>
      )}
      {ux > 0 && land && (
        <text className={css.mono} x={ux + 6} y={bottom + 18} style={{ fill: 'rgba(255,77,106,0.8)', fontSize: 9.5 }}>
          → never
        </text>
      )}
    </g>
  );
}
