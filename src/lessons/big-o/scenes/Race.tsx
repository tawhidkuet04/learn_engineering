'use client';

import { SIG } from '@/lib/sim/colors';
import { insertionCost, mergeCost, type Lane } from '../engine/race';
import { racePanel, raceGeo, type LaneGeo } from '../layout';
import { CLASSES, commas, fmtCount, place } from '../model';
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
      {r.preset === 'machines' && <MachinesPanel sim={sim} land={land} glow={hl === 'measure'} />}
      {r.preset === 'constants' && <CrossoverPanel sim={sim} land={land} />}
    </g>
  );
}

/* ------------------------------------------------------------------ */
/* Machines: what the stopwatch saw vs what the counter saw            */
/* ------------------------------------------------------------------ */

function MachinesPanel({ sim, land, glow }: { sim: BigOSim; land: boolean; glow: boolean }) {
  const p = racePanel(sim);
  const lanes = sim.race.lanes;
  const maxMs = Math.max(...lanes.map((l) => l.clockMs ?? 1));
  const minMs = Math.min(...lanes.map((l) => l.clockMs ?? 1));
  const allDone = lanes.every((l) => l.finishedAt != null);
  const short = (l: Lane) => (l.id === 'battery' ? 'on battery' : l.label.toLowerCase());
  const block = (x0: number, x1: number, y0: number, title: string, kind: 'ms' | 'steps', pitch: number) => {
    const bx0 = x0 + (land ? 104 : 76);
    const bx1 = x1 - (land ? 92 : 74);
    const W = bx1 - bx0;
    return (
      <g>
        <text className={css.caps} x={x0} y={y0}>
          {title}
        </text>
        {lanes.map((l, i) => {
          const frac = l.total ? l.done / l.total : 0;
          const ms = (l.clockMs ?? 0) * frac;
          const len = kind === 'ms' ? (ms / maxMs) * W : frac * W;
          const y = y0 + 17 + i * pitch;
          return (
            <g key={l.id}>
              <text className={css.mono} x={x0} y={y + 4} style={{ fill: l.color, fontSize: land ? 10.5 : 9.5 }}>
                {short(l)}
              </text>
              <rect x={bx0} y={y - 4} width={W} height={8} rx={4} fill="rgba(143,166,201,0.08)" />
              {len > 0.5 && <rect x={bx0} y={y - 4} width={len} height={8} rx={4} fill={l.color} opacity={0.8} />}
              <text className={css.monoStrong} x={x1} y={y + 4} textAnchor="end" style={{ fontSize: land ? 11 : 10 }}>
                {kind === 'ms' ? `${ms.toFixed(1)} ms` : fmtCount(Math.round(l.done))}
              </text>
            </g>
          );
        })}
      </g>
    );
  };
  if (land) {
    const mid = (p.x0 + p.x1) / 2;
    const y0 = p.y0 + 30;
    return (
      <g>
        <rect className={css.panelBox} x={p.x0} y={p.y0} width={p.x1 - p.x0} height={p.y1 - p.y0} rx={12} style={glow ? { stroke: 'var(--accent)', strokeDasharray: '3 3' } : undefined} />
        {block(p.x0 + 22, mid - 26, y0, 'stopwatch · depends on the machine', 'ms', 26)}
        {block(mid + 26, p.x1 - 22, y0, 'comparisons · depends only on n', 'steps', 26)}
        <line x1={mid} x2={mid} y1={p.y0 + 16} y2={p.y1 - 16} stroke="rgba(143,166,201,0.14)" />
        {allDone && (
          <>
            <text className={css.monoStrong} x={p.x0 + 22} y={p.y1 - 18} style={{ fill: SIG.heavy }}>
              {(maxMs / minMs).toFixed(1)}× apart
            </text>
            <text className={css.monoStrong} x={mid + 26} y={p.y1 - 18} style={{ fill: SIG.res }}>
              identical: 10,000,000 each
            </text>
          </>
        )}
      </g>
    );
  }
  return (
    <g>
      <rect className={css.panelBox} x={p.x0} y={p.y0} width={p.x1 - p.x0} height={p.y1 - p.y0} rx={10} />
      {block(p.x0 + 12, p.x1 - 12, p.y0 + 20, allDone ? `stopwatch · ${(maxMs / minMs).toFixed(1)}× apart` : 'stopwatch', 'ms', 15)}
      {block(p.x0 + 12, p.x1 - 12, p.y0 + 90, allDone ? 'comparisons · identical' : 'comparisons', 'steps', 15)}
    </g>
  );
}

/* ------------------------------------------------------------------ */
/* Constants: where the two cost curves cross                          */
/* ------------------------------------------------------------------ */

const CROSS = (() => {
  for (let n = 2; n < 400; n++) if (mergeCost(n) < insertionCost(n)) return n;
  return 0;
})();

function CrossoverPanel({ sim, land }: { sim: BigOSim; land: boolean }) {
  const p = racePanel(sim);
  const show = !sim.game || sim.game.done;
  const title = land ? 'cost as n grows · illustrative constants' : 'cost as n grows';
  const box = <rect className={css.panelBox} x={p.x0} y={p.y0} width={p.x1 - p.x0} height={p.y1 - p.y0} rx={12} />;
  if (!show) {
    return (
      <g>
        {box}
        <text className={css.caps} x={p.x0 + 18} y={p.y0 + 24}>
          {title}
        </text>
        <text className={css.monoMid} x={(p.x0 + p.x1) / 2} y={(p.y0 + p.y1) / 2 + 8} textAnchor="middle" style={{ fill: 'var(--text-3)' }}>
          {land ? 'The cost curves appear once you have predicted both races.' : 'Appears after you predict.'}
        </text>
      </g>
    );
  }
  const cx0 = p.x0 + (land ? 62 : 44);
  const cx1 = land ? p.x0 + (p.x1 - p.x0) * 0.62 : p.x1 - 16;
  const cy0 = p.y0 + 40;
  const cy1 = p.y1 - 30;
  const NMAX = 128;
  const YMAX = insertionCost(NMAX);
  const X = (n: number) => cx0 + (n / NMAX) * (cx1 - cx0);
  const Y = (v: number) => cy1 - (v / YMAX) * (cy1 - cy0);
  const path = (f: (n: number) => number) => {
    let d = '';
    for (let n = 1; n <= NMAX; n += 1) d += `${d ? 'L' : 'M'}${X(n).toFixed(1)},${Y(f(n)).toFixed(1)} `;
    return d;
  };
  const ins = CLASSES.n2.color;
  const mer = CLASSES.nlogn.color;
  const xc = X(CROSS);
  return (
    <g>
      {box}
      <text className={css.caps} x={p.x0 + 18} y={p.y0 + 22}>
        {title}
      </text>
      <rect x={cx0} y={cy0} width={xc - cx0} height={cy1 - cy0} fill="rgba(255,154,60,0.06)" />
      <rect x={xc} y={cy0} width={cx1 - xc} height={cy1 - cy0} fill="rgba(181,155,255,0.06)" />
      <path className={css.axis} d={`M${cx0},${cy0 - 4} V${cy1} H${cx1 + 4}`} />
      {[32, 64, 96, 128].map((n) => (
        <text key={n} className={css.mono} x={X(n)} y={cy1 + 13} textAnchor="middle" style={{ fontSize: 9 }}>
          {n}
        </text>
      ))}
      <text className={css.mono} x={cx0 - 6} y={cy0 + 4} textAnchor="end" style={{ fontSize: 9 }}>
        {commas(YMAX)}
      </text>
      <text className={css.mono} x={cx0 - 6} y={cy1} textAnchor="end" style={{ fontSize: 9 }}>
        0
      </text>
      <path d={path(insertionCost)} fill="none" stroke={ins} strokeWidth={2} />
      <path d={path(mergeCost)} fill="none" stroke={mer} strokeWidth={2} />
      <line x1={xc} x2={xc} y1={cy0} y2={cy1} stroke={SIG.warn} strokeDasharray="3 3" />
      <text className={`${css.monoStrong} ${css.halo}`} x={xc + 6} y={cy0 + 12} style={{ fill: SIG.warn, fontSize: 10.5 }}>
        crossover ≈ {CROSS}
      </text>
      <text className={`${css.mono} ${css.halo}`} x={cx0 + 6} y={cy0 + 12} style={{ fill: ins, fontSize: 9.5 }}>
        insertion wins
      </text>
      <text className={`${css.mono} ${css.halo}`} x={cx1 - 4} y={cy1 - 8} textAnchor="end" style={{ fill: mer, fontSize: 9.5 }}>
        merge wins
      </text>
      <circle cx={X(8)} cy={Y(insertionCost(8))} r={3.5} fill={ins} />
      <text className={css.mono} x={X(8)} y={cy1 + 13} textAnchor="middle" style={{ fontSize: 9, fill: SIG.warn }}>
        8
      </text>
      <text className={css.caps} x={cx1} y={cy1 + 26} textAnchor="end" style={{ fontSize: 8.5 }}>
        n →
      </text>
      {land && (
        <g>
          <text className={css.caps} x={cx1 + 40} y={cy0 + 6}>
            the two races
          </text>
          {[
            { n: 8, a: insertionCost(8), b: mergeCost(8) },
            { n: 1000, a: insertionCost(1000), b: mergeCost(1000) },
          ].map((r, i) => (
            <g key={r.n} transform={`translate(${cx1 + 40},${cy0 + 34 + i * 58})`}>
              <text className={css.monoStrong} x={0} y={0} style={{ fontSize: 11.5 }}>
                n = {commas(r.n)}
              </text>
              <text className={css.mono} x={0} y={17} style={{ fill: ins, fontSize: 10.5 }}>
                insertion {commas(r.a)}
                {r.a < r.b && <tspan style={{ fill: SIG.res }}> ✓ faster</tspan>}
              </text>
              <text className={css.mono} x={0} y={32} style={{ fill: mer, fontSize: 10.5 }}>
                merge {commas(Math.round(r.b))}
                {r.a >= r.b && <tspan style={{ fill: SIG.res }}> ✓ faster</tspan>}
              </text>
            </g>
          ))}
        </g>
      )}
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
      {l.ghost != null && l.ghost < 0.999 && !hidden && (
        <g opacity={0.85}>
          <line x1={g.tx0 + l.ghost * W} x2={g.tx0 + l.ghost * W} y1={g.ty - 14} y2={g.ty + 14} stroke={SIG.warn} strokeWidth={1.4} strokeDasharray="3 2" />
          <text className={`${css.mono} ${css.halo}`} x={g.tx0 + l.ghost * W} y={g.ty - 18} textAnchor="middle" style={{ fill: SIG.warn, fontSize: 9.5 }}>
            n={r.prevN} {l.ratio ? `· ${l.ratio}` : ''}
          </text>
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
