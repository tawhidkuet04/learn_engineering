'use client';

import { SIG } from '@/lib/sim/colors';
import { scanGeo, type ScanGeo } from '../layout';
import type { BigOSim } from '../sim';
import css from '../bigo.module.css';

const CUR = SIG.warn;

export function ScanScene({ sim, hl }: { sim: BigOSim; hl: string | null }) {
  const s = sim.scan;
  const g = scanGeo(sim, s.n);
  const land = g.land;
  const running = s.state === 'run';
  const flash = Math.max(0, 1 - (sim.vt - s.hitVt) / 0.35);
  const small = g.cw < 26;

  return (
    <g>
      {/* index labels */}
      {g.cells.map((c, i) => (
        <text key={`i${i}`} className={css.mono} x={c.x + c.w / 2} y={c.y - 7} textAnchor="middle" style={{ fontSize: small ? 8 : 9 }}>
          {i}
        </text>
      ))}
      {/* cells */}
      {g.cells.map((c, i) => {
        const visited = i < s.i || (i === s.i && !running);
        const cur = i === s.i && running;
        const isMax = s.mode === 'max' && i === s.bestIdx;
        const found = s.foundIdx === i;
        let fill = 'var(--node-fill)';
        let stroke = 'rgba(143,166,201,0.5)';
        let text = 'var(--text-1)';
        if (visited) {
          fill = 'rgba(69,213,255,0.12)';
          stroke = 'rgba(69,213,255,0.38)';
          text = 'var(--text-2)';
        }
        if (isMax) {
          stroke = SIG.res;
          text = SIG.res;
        }
        if (found) {
          fill = 'rgba(75,227,160,0.2)';
          stroke = SIG.res;
          text = SIG.res;
        }
        if (cur) {
          fill = `rgba(255,210,63,${0.1 + 0.18 * flash})`;
          stroke = CUR;
        }
        return (
          <g key={i}>
            <rect x={c.x} y={c.y} width={c.w} height={c.h} rx={small ? 3 : 6} fill={fill} stroke={stroke} strokeWidth={cur || isMax || found ? 1.6 : 1.1} />
            <text className={small ? css.cellTextSm : css.cellText} x={c.x + c.w / 2} y={c.y + c.h / 2 + (small ? 3.5 : 4.5)} textAnchor="middle" style={{ fill: text }}>
              {s.arr[i]}
            </text>
          </g>
        );
      })}
      {/* pointer */}
      {s.i >= 0 && s.i < s.n && (
        <Pointer x={g.cells[s.i].x + g.cw / 2} y={g.cells[s.i].y + g.ch + 4} label={land ? `i = ${s.i}` : `${s.i}`} done={!running} />
      )}
      <Register sim={sim} g={g} />
      {s.mode === 'max' && <DotsChart sim={sim} g={g} glow={hl === 'dots'} />}
      {s.mode === 'cases' && <CostBars sim={sim} g={g} />}
    </g>
  );
}

function Pointer({ x, y, label, done }: { x: number; y: number; label: string; done: boolean }) {
  return (
    <g opacity={done ? 0.55 : 1}>
      <path d={`M${x},${y} l-6,9 h12 z`} fill={CUR} />
      <text className={css.monoStrong} x={x} y={y + 22} textAnchor="middle" style={{ fill: CUR, fontSize: 10.5 }}>
        {label}
      </text>
    </g>
  );
}

function Register({ sim, g }: { sim: BigOSim; g: ScanGeo }) {
  const s = sim.scan;
  const land = g.land;
  const y = g.reg.y + (land ? 8 : 14);
  let text: string;
  let tone = 'var(--text-1)';
  if (s.mode === 'max') {
    text = s.bestIdx < 0 ? 'max so far: −∞' : `max so far: ${s.best}`;
    if (s.state === 'done') {
      text = `max = ${s.best} · ${s.steps} comparisons for n = ${s.n}`;
      tone = SIG.res;
    }
  } else {
    const t = s.target ?? 0;
    if (s.state === 'done') {
      text = s.foundIdx != null ? `found ${t} at index ${s.foundIdx} · ${s.steps} steps` : `${t} isn't there · checked all ${s.steps}`;
      tone = s.foundIdx != null ? SIG.res : SIG.err;
    } else text = `looking for ${t} · ${s.steps} step${s.steps === 1 ? '' : 's'}`;
    if (!land && s.state === 'done') text = s.foundIdx != null ? `found ${t} · ${s.steps} steps` : `${t} missing · ${s.steps} steps`;
  }
  const w = text.length * (land ? 7.3 : 6.4) + 26;
  return (
    <g transform={`translate(${g.reg.x},${y + 14})`}>
      <rect x={-w / 2} y={-14} width={w} height={28} rx={14} fill="rgba(7,11,20,0.92)" stroke={tone} strokeOpacity={0.6} />
      <text className={css.monoStrong} x={0} y={4} textAnchor="middle" style={{ fill: tone, fontSize: land ? 12 : 10.5 }}>
        {text}
      </text>
    </g>
  );
}

/* steps vs n: every finished findMax run drops a dot */
function DotsChart({ sim, g, glow }: { sim: BigOSim; g: ScanGeo; glow: boolean }) {
  const s = sim.scan;
  const p = g.panel;
  const land = g.land;
  const x0 = p.x0 + (land ? 34 : 22);
  const x1 = p.x1 - 10;
  const y0 = p.y0 + 12;
  const y1 = p.y1 - (land ? 30 : 24);
  const MAX = 16;
  const X = (n: number) => x0 + (n / MAX) * (x1 - x0);
  const Y = (v: number) => y1 - (v / MAX) * (y1 - y0);
  const line = s.dots.length >= 2;
  const live = s.state === 'run';
  return (
    <g>
      {glow && <rect x={p.x0 - 8} y={p.y0 - 8} width={p.x1 - p.x0 + 16} height={p.y1 - p.y0 + 16} rx={10} fill="none" stroke="var(--accent)" strokeDasharray="3 3" />}
      {[4, 8, 12, 16].map((v) => (
        <g key={v}>
          <line className={css.gridline} x1={x0} x2={x1} y1={Y(v)} y2={Y(v)} />
          <line className={css.gridline} x1={X(v)} x2={X(v)} y1={y0} y2={y1} />
          <text className={css.mono} x={x0 - 7} y={Y(v) + 3.5} textAnchor="end" style={{ fontSize: 9 }}>
            {v}
          </text>
          <text className={css.mono} x={X(v)} y={y1 + 14} textAnchor="middle" style={{ fontSize: 9 }}>
            {v}
          </text>
        </g>
      ))}
      <path className={css.axis} d={`M${x0},${y0 - 4} V${y1} H${x1 + 4}`} />
      <text className={css.caps} x={x1} y={y1 + (land ? 28 : 27)} textAnchor="end">
        {land ? 'input size n →' : 'n →'}
      </text>
      <text className={css.caps} x={x0 + 6} y={y0 + 2}>
        steps
      </text>
      {line && (
        <g>
          <line x1={X(0)} y1={Y(0)} x2={X(16)} y2={Y(16)} stroke={SIG.req} strokeWidth={1.3} strokeDasharray="5 4" opacity={0.7} />
          <text className={`${css.monoStrong} ${css.halo}`} x={X(13.2)} y={Y(15.2)} textAnchor="end" style={{ fill: SIG.req, fontSize: 12 }}>
            T(n) = n
          </text>
        </g>
      )}
      {s.dots.map((d) => {
        const k = Math.min(1, (sim.vt - d.vt) / 0.4);
        return (
          <g key={d.n}>
            <circle cx={X(d.n)} cy={Y(d.steps)} r={5 + (1 - k) * 6} fill={SIG.req} opacity={0.25 * (1 - k)} />
            <circle cx={X(d.n)} cy={Y(d.steps)} r={5} fill={SIG.req} />
            <text className={`${css.mono} ${css.halo}`} x={X(d.n) + 9} y={Y(d.steps) + 13} style={{ fill: 'var(--text-2)', fontSize: 9.5 }}>
              ({d.n}, {d.steps})
            </text>
          </g>
        );
      })}
      {live && (
        <g>
          <line x1={X(s.n)} x2={X(s.n)} y1={Y(s.steps)} y2={y1} stroke={CUR} strokeWidth={1.2} strokeDasharray="2 3" opacity={0.7} />
          <circle cx={X(s.n)} cy={Y(s.steps)} r={5} fill="none" stroke={CUR} strokeWidth={1.6} />
        </g>
      )}
    </g>
  );
}

/* Cost of finding each item: position i costs i + 1 steps; a missing item costs n */
function CostBars({ sim, g }: { sim: BigOSim; g: ScanGeo }) {
  const s = sim.scan;
  const p = g.panel;
  const land = g.land;
  const n = s.n;
  const x0 = p.x0 + (land ? 30 : 20);
  const x1 = p.x1 - 6;
  const y0 = p.y0 + 16;
  const y1 = p.y1 - (land ? 34 : 26);
  const slots = n + 1;
  const bw = (x1 - x0) / slots;
  const H = (v: number) => (v / n) * (y1 - y0);
  const cur = s.state === 'run' ? null : s.foundIdx != null ? s.foundIdx : s.state === 'done' ? n : null;
  const avg = (n + 1) / 2;
  const liveIdx = s.state === 'run' ? s.i : null;
  return (
    <g>
      <text className={css.caps} x={x0} y={p.y0 + 2}>
        steps to find each item
      </text>
      {Array.from({ length: slots }, (_, i) => {
        const missing = i === n;
        const v = missing ? n : i + 1;
        const x = x0 + i * bw + 2;
        const on = cur === i;
        const live = liveIdx != null && (missing ? false : i <= liveIdx);
        const color = missing ? SIG.err : i === 0 ? SIG.res : SIG.req;
        return (
          <g key={i}>
            <rect x={x} y={y1 - H(v)} width={bw - 4} height={H(v)} rx={2} fill={color} opacity={on ? 0.85 : live ? 0.35 : 0.16} stroke={on ? color : 'none'} />
            {(land || i % 4 === 0 || missing) && (
              <text className={css.mono} x={x + (bw - 4) / 2} y={y1 + 12} textAnchor="middle" style={{ fontSize: land ? 9 : 8, fill: missing ? SIG.err : undefined }}>
                {missing ? (land ? '∅' : '∅') : i}
              </text>
            )}
          </g>
        );
      })}
      <line x1={x0} x2={x1} y1={y1} y2={y1} className={css.axis} />
      <line x1={x0} x2={x1} y1={y1 - H(avg)} y2={y1 - H(avg)} stroke={SIG.warn} strokeWidth={1.2} strokeDasharray="4 3" />
      <text className={`${css.mono} ${css.halo}`} x={x0 + 4} y={y1 - H(avg) - 5} style={{ fill: SIG.warn, fontSize: land ? 10 : 9 }}>
        average (n + 1)/2 = {avg}
      </text>
      <text className={css.caps} x={x1} y={y1 + (land ? 26 : 22)} textAnchor="end">
        {land ? 'position of the target · ∅ = missing' : 'target position · ∅ missing'}
      </text>
    </g>
  );
}
