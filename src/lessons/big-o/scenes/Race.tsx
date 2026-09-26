'use client';

import { SIG } from '@/lib/sim/colors';
import type { Lane } from '../engine/race';
import { raceGeo, type LaneGeo } from '../layout';
import { commas, place } from '../model';
import type { BigOSim } from '../sim';
import css from '../bigo.module.css';

export function RaceScene({ sim, hl }: { sim: BigOSim; hl: string | null }) {
  const r = sim.race;
  const geos = raceGeo(sim, r.lanes.length);
  const land = sim.orient === 'landscape';
  return (
    <g>
      {r.lanes.map((l, i) => (
        <LaneView key={l.id} sim={sim} lane={l} g={geos[i]} land={land} glow={hl === `lane:${l.id}`} />
      ))}
    </g>
  );
}

function LaneView({ sim, lane: l, g, land, glow }: { sim: BigOSim; lane: Lane; g: LaneGeo; land: boolean; glow: boolean }) {
  const r = sim.race;
  const W = g.tx1 - g.tx0;
  const p = l.total > 0 ? Math.min(1, l.done / l.total) : 0;
  const px = g.tx0 + p * W;
  const done = l.finishedAt != null;
  const asking = r.asking === l.id || (r.asking === 'both' && sim.game?.pending);
  const pulse = asking ? 0.55 + 0.45 * Math.sin(sim.vt * 5) : 0;
  const running = r.running && !done && l.done > 0;
  const hidden = l.hidden;
  const machines = r.preset === 'machines';
  const flash = done && l.finishedAt != null ? Math.max(0, 1 - (sim.t - l.finishedAt) / 0.8) : 0;

  const counter = hidden ? `${commas(l.done)} / ?` : `${commas(l.done)} / ${commas(l.total)}`;
  const secondary = machines
    ? `${((l.clockMs ?? 0) * p).toFixed(1)} ms`
    : done && l.place != null
      ? place(l.place)
      : hidden
        ? 'predict first'
        : r.running
          ? 'running…'
          : '';

  return (
    <g>
      {/* label */}
      {land ? (
        <g>
          {machines ? (
            <text className={css.name} x={g.labelX} y={g.ty - 3} style={{ fill: l.color }}>
              {l.label}
            </text>
          ) : (
            <text className={css.badgeText} x={g.labelX} y={g.ty - 2} style={{ fill: l.color }}>
              {l.label}
            </text>
          )}
          <text className={css.mono} x={g.labelX} y={g.ty + 14}>
            {l.sub}
          </text>
        </g>
      ) : (
        <g>
          <text className={css.badgeText} x={g.labelX} y={g.y + 12} style={{ fill: l.color, fontSize: machines ? 12.5 : 13 }}>
            {l.label}
            <tspan className={css.mono} dx={8} style={{ fontWeight: 400, fontSize: 9.5 }}>
              {l.sub}
            </tspan>
          </text>
          <text className={css.monoStrong} x={g.valX} y={g.y + 12} textAnchor="end" style={{ fontSize: 11 }}>
            {machines ? `${((l.clockMs ?? 0) * p).toFixed(1)} ms` : counter}
          </text>
        </g>
      )}

      {/* track */}
      <rect className={css.rail} x={g.tx0} y={g.ty - 8} width={W} height={16} rx={8} style={asking ? { stroke: SIG.warn, strokeOpacity: 0.5 + pulse * 0.5, strokeWidth: 1.5 } : glow ? { stroke: 'var(--accent)', strokeDasharray: '3 3' } : undefined} />
      {Array.from({ length: 9 }, (_, k) => (
        <line key={k} x1={g.tx0 + ((k + 1) / 10) * W} x2={g.tx0 + ((k + 1) / 10) * W} y1={g.ty - 3} y2={g.ty + 3} stroke="rgba(143,166,201,0.16)" />
      ))}
      {p > 0 && <rect x={g.tx0} y={g.ty - 8} width={Math.max(0, px - g.tx0)} height={16} rx={8} fill={l.color} opacity={done ? 0.2 : 0.24} />}
      {p > 0 && <rect x={Math.max(g.tx0, px - 2)} y={g.ty - 8} width={2} height={16} fill={l.color} opacity={0.9} />}
      {/* finish line */}
      <line x1={g.tx1 + 6} x2={g.tx1 + 6} y1={g.ty - 13} y2={g.ty + 13} stroke="rgba(143,166,201,0.55)" strokeDasharray="2 3" />
      {/* ghost of the previous finish */}
      {l.ghost != null && l.ghost < 0.999 && (
        <g opacity={hidden ? 0.9 : 0.8}>
          <line x1={g.tx0 + l.ghost * W} x2={g.tx0 + l.ghost * W} y1={g.ty - 14} y2={g.ty + 14} stroke={SIG.warn} strokeWidth={1.4} strokeDasharray="3 2" />
          {!hidden && (
            <text className={`${css.mono} ${css.halo}`} x={g.tx0 + l.ghost * W} y={g.ty - 18} textAnchor="middle" style={{ fill: SIG.warn, fontSize: 9.5 }}>
              n={r.prevN} {l.ratio ? `· ${l.ratio}` : ''}
            </text>
          )}
        </g>
      )}
      {/* head */}
      {!done && p > 0 && (
        <g>
          {running && <circle cx={px} cy={g.ty} r={13} fill={l.color} opacity={0.14} />}
          <circle cx={px} cy={g.ty} r={5.5} fill={l.color} />
        </g>
      )}
      {!done && p === 0 && <circle cx={g.tx0 + 6} cy={g.ty} r={4} fill="none" stroke={l.color} strokeWidth={1.4} opacity={0.8} />}
      {done && (
        <g transform={`translate(${g.tx1 + 6},${g.ty})`}>
          {flash > 0 && <circle r={10 + (1 - flash) * 16} fill="none" stroke={l.color} strokeWidth={2 * flash} opacity={flash} />}
          <circle r={9} fill={l.color} />
          <path d="M-4,0.5 L-1.2,3.3 L4.2,-2.6" fill="none" stroke="#0b1020" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        </g>
      )}

      {/* values */}
      {land ? (
        <g>
          {machines ? (
            <>
              <text className={css.monoStrong} x={g.valX} y={g.ty - 2} textAnchor="end" style={{ fontSize: 15, fill: l.color }}>
                {((l.clockMs ?? 0) * p).toFixed(1)} ms
              </text>
              <text className={css.mono} x={g.valX} y={g.ty + 14} textAnchor="end">
                {commas(l.done)} comparisons
              </text>
            </>
          ) : (
            <>
              <text className={css.monoStrong} x={g.valX} y={g.ty - 2} textAnchor="end">
                {counter}
              </text>
              <text className={css.mono} x={g.valX} y={g.ty + 14} textAnchor="end" style={done && l.place === 0 ? { fill: SIG.res } : undefined}>
                {secondary}
              </text>
            </>
          )}
        </g>
      ) : (
        <text className={css.mono} x={g.valX} y={g.ty + 24} textAnchor="end" style={done && l.place === 0 ? { fill: SIG.res } : undefined}>
          {machines ? `${commas(l.done)} comparisons` : secondary}
        </text>
      )}

      {l.mem && <MemMeter sim={sim} lane={l} g={g} land={land} />}
    </g>
  );
}

function MemMeter({ sim, lane: l, g, land }: { sim: BigOSim; lane: Lane; g: LaneGeo; land: boolean }) {
  const used = sim.race.memUsed(l);
  const n = sim.race.n;
  const cells = 16;
  const lit = l.mem === 'fixed' ? 2 : Math.ceil((used / Math.max(1, n)) * cells);
  const y = land ? g.ty + 22 : g.ty + 38;
  const cw = land ? 13 : 8;
  const x0 = g.tx0;
  const label = land
    ? l.mem === 'fixed'
      ? 'i and j: 2 variables at any n'
      : `${commas(used)} of ${commas(n)} items stored`
    : l.mem === 'fixed'
      ? '2 variables'
      : `${commas(used)} stored`;
  return (
    <g>
      <text className={css.caps} x={x0} y={y + 8} style={{ fontSize: 8.5 }}>
        memory
      </text>
      {Array.from({ length: cells }, (_, k) => (
        <rect
          key={k}
          x={x0 + (land ? 58 : 50) + k * (cw + 2)}
          y={y}
          width={cw}
          height={9}
          rx={2}
          fill={k < lit ? l.color : 'rgba(143,166,201,0.08)'}
          opacity={k < lit ? 0.75 : 1}
          stroke="rgba(143,166,201,0.18)"
        />
      ))}
      <text className={css.mono} x={x0 + (land ? 58 : 50) + cells * (cw + 2) + 6} y={y + 8} style={{ fontSize: land ? 10 : 9 }}>
        {label}
      </text>
    </g>
  );
}
