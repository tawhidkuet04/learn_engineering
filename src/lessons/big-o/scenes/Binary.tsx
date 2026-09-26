'use client';

import { SIG } from '@/lib/sim/colors';
import { bigGeo, binaryCells, frame } from '../layout';
import { commas, ease } from '../model';
import type { BigOSim } from '../sim';
import css from '../bigo.module.css';

const MID = SIG.warn;
const RANGE = SIG.lime;

export function BinaryScene({ sim, hl }: { sim: BigOSim; hl: string | null }) {
  return sim.bin.mode === 'array' ? <ArrayView sim={sim} hl={hl} /> : <BigView sim={sim} />;
}

/* ================================================================== */
/* 32 sorted numbers                                                   */
/* ================================================================== */

function ArrayView({ sim, hl }: { sim: BigOSim; hl: string | null }) {
  const b = sim.bin;
  const { cells, cw, ch, rows } = binaryCells(sim, b.arr.length);
  const land = sim.orient === 'landscape';
  const vt = sim.vt;
  const inRange = (i: number) => i >= b.lo && i <= b.hi;
  const active = b.phase !== 'found' && b.phase !== 'missing';
  const small = cw < 28;

  // bracket spans for the live range, one per row it touches
  const spans: { x0: number; x1: number; y: number }[] = [];
  if (b.lo <= b.hi && active) {
    const per = cells.length / rows;
    for (let r = 0; r < rows; r++) {
      const idx = cells.map((_, i) => i).filter((i) => inRange(i) && Math.floor(i / per) === r);
      if (!idx.length) continue;
      const a = cells[idx[0]];
      const z = cells[idx[idx.length - 1]];
      spans.push({ x0: a.x, x1: z.x + z.w, y: a.y + ch + 8 });
    }
  }

  return (
    <g>
      {cells.map((c, i) => {
        const deadVt = b.dead[i];
        const dead = deadVt >= 0;
        const k = dead ? Math.min(1, (vt - deadVt) / 0.45) : 0;
        const isMid = b.mid === i && (b.phase === 'mid' || b.phase === 'cmp' || b.phase === 'found');
        const found = b.phase === 'found' && b.mid === i;
        let stroke = 'rgba(143,166,201,0.5)';
        let fill = 'var(--node-fill)';
        let text = 'var(--text-1)';
        if (inRange(i) && active) {
          stroke = 'rgba(196,242,90,0.55)';
          fill = 'rgba(196,242,90,0.05)';
        }
        if (isMid) {
          stroke = MID;
          fill = 'rgba(255,210,63,0.14)';
        }
        if (found) {
          stroke = SIG.res;
          fill = 'rgba(75,227,160,0.22)';
          text = SIG.res;
        }
        return (
          <g key={i} opacity={1 - 0.72 * ease(k)}>
            <rect x={c.x} y={c.y} width={c.w} height={c.h} rx={small ? 4 : 5} fill={fill} stroke={stroke} strokeWidth={isMid || found ? 1.7 : 1.1} />
            {dead && k > 0.3 && <line x1={c.x + 4} y1={c.y + c.h - 4} x2={c.x + c.w - 4} y2={c.y + 4} stroke={SIG.err} strokeWidth={1.2} opacity={0.55 * Math.min(1, (k - 0.3) / 0.4)} />}
            <text className={small ? css.cellTextSm : css.cellText} x={c.x + c.w / 2} y={c.y + c.h / 2 + (small ? 3.5 : 4.5)} textAnchor="middle" style={{ fill: text, fontSize: small ? 10.5 : undefined }}>
              {b.arr[i]}
            </text>
            {land && (
              <text className={css.mono} x={c.x + c.w / 2} y={c.y - 6} textAnchor="middle" style={{ fontSize: 8 }}>
                {i}
              </text>
            )}
          </g>
        );
      })}
      {hl === 'range' &&
        spans.map((s, i) => <rect key={i} x={s.x0 - 4} y={s.y - ch - 12} width={s.x1 - s.x0 + 8} height={ch + 8} rx={7} fill="none" stroke="var(--accent)" strokeDasharray="3 3" />)}
      {/* range bracket */}
      {spans.map((s, i) => (
        <path key={`s${i}`} d={`M${s.x0},${s.y - 4} V${s.y} H${s.x1} V${s.y - 4}`} fill="none" stroke={RANGE} strokeWidth={1.3} opacity={0.8} />
      ))}
      {active && b.lo <= b.hi && (
        <>
          <PointerLabel x={cells[b.lo].x + cells[b.lo].w / 2} y={cells[b.lo].y + ch + 22} text={`lo ${b.lo}`} color={RANGE} anchor={land ? 'middle' : 'start'} />
          {b.hi !== b.lo && <PointerLabel x={cells[b.hi].x + cells[b.hi].w / 2} y={cells[b.hi].y + ch + 22} text={`hi ${b.hi}`} color={RANGE} anchor={land ? 'middle' : 'end'} />}
        </>
      )}
      {b.mid != null && (b.phase === 'mid' || b.phase === 'cmp' || b.phase === 'found') && (
        <g>
          <path d={`M${cells[b.mid].x + cw / 2},${cells[b.mid].y - (land ? 16 : 12)} l-6,-9 h12 z`} fill={b.phase === 'found' ? SIG.res : MID} />
          <text
            className={`${css.monoStrong} ${css.halo}`}
            x={cells[b.mid].x + cw / 2}
            y={cells[b.mid].y - (land ? 30 : 26)}
            textAnchor="middle"
            style={{ fill: b.phase === 'found' ? SIG.res : MID, fontSize: 11 }}
          >
            mid {b.mid}
          </text>
        </g>
      )}
      {hl === 'mid' &&
        (() => {
          const m = b.mid ?? (b.lo + b.hi) >> 1;
          const c = cells[Math.max(0, Math.min(cells.length - 1, m))];
          return <rect x={c.x - 5} y={c.y - 5} width={c.w + 10} height={c.h + 10} rx={7} fill="none" stroke="var(--accent)" strokeWidth={1.4} strokeDasharray="3 3" />;
        })()}
      <Verdict sim={sim} y={land ? cells[0].y + ch + 70 : cells[cells.length - 1].y + ch + 40} />
    </g>
  );
}

function PointerLabel({ x, y, text, color, anchor }: { x: number; y: number; text: string; color: string; anchor: 'start' | 'middle' | 'end' }) {
  return (
    <text className={`${css.monoStrong} ${css.halo}`} x={x} y={y} textAnchor={anchor} style={{ fill: color, fontSize: 10.5 }}>
      {text}
    </text>
  );
}

function Verdict({ sim, y }: { sim: BigOSim; y: number }) {
  const b = sim.bin;
  const f = frame(sim);
  const land = f.land;
  const cx = (f.x0 + f.x1) / 2;
  let text = `find ${b.target}`;
  let tone = 'var(--text-1)';
  if (b.phase === 'cmp' && b.mid != null) {
    const v = b.arr[b.mid];
    text = b.lastCmp === '<' ? `${v} < ${b.target} → drop the left half` : `${v} > ${b.target} → drop the right half`;
    tone = MID;
  } else if (b.phase === 'mid' && b.mid != null) text = `check the middle: arr[${b.mid}] = ${b.arr[b.mid]}`;
  else if (b.phase === 'found') {
    text = `found ${b.target} in ${b.steps} step${b.steps === 1 ? '' : 's'}`;
    tone = SIG.res;
  } else if (b.phase === 'missing') {
    text = `${b.target} isn't there · ${b.steps} steps`;
    tone = SIG.err;
  } else if (b.phase === 'cut') text = `${b.hi - b.lo + 1} left to search`;
  if (!land && text.length > 34) text = text.replace(' → ', ' → ').replace('drop the ', '');
  const w = text.length * (land ? 7.4 : 6.5) + 28;
  return (
    <g transform={`translate(${cx},${y})`}>
      <rect x={-w / 2} y={-15} width={w} height={30} rx={15} fill="rgba(7,11,20,0.92)" stroke={tone} strokeOpacity={0.6} />
      <text className={css.monoStrong} x={0} y={4.5} textAnchor="middle" style={{ fill: tone, fontSize: land ? 12.5 : 11 }}>
        {text}
      </text>
    </g>
  );
}

/* ================================================================== */
/* A million (or a billion) items: zooming bar + ladder                */
/* ================================================================== */

const compact = (x: number) => {
  if (x >= 1e9) return `${+(x / 1e9).toFixed(2)}B`;
  if (x >= 1e6) return `${+(x / 1e6).toFixed(x >= 1e7 ? 0 : 2)}M`;
  if (x >= 1e4) return `${Math.round(x / 1e3)}K`;
  if (x >= 1e3) return `${(x / 1e3).toFixed(1)}K`;
  return String(x);
};

function BigView({ sim }: { sim: BigOSim }) {
  const b = sim.bin;
  const g = bigGeo(sim);
  const land = sim.orient === 'landscape';
  const W = g.bx1 - g.bx0;
  const k = ease(Math.min(1, (sim.vt - b.zoom.vt) / 0.3));
  const dLo = b.zoom.lo + (b.bLo - b.zoom.lo) * k;
  const dHi = b.zoom.hi + (b.bHi - b.zoom.hi) * k;
  const span = Math.max(1, dHi - dLo + 1);
  const X = (i: number) => g.bx0 + ((i - dLo) / span) * W;
  const found = b.bPhase === 'found';
  const tx = X(b.tgt + 0.5);
  const midX = b.bMid != null ? X(b.bMid + 0.5) : null;
  const clip = `big-clip`;
  const size = b.bHi - b.bLo + 1;

  return (
    <g>
      <defs>
        <clipPath id={clip}>
          <rect x={g.bx0} y={g.by - 4} width={W} height={g.bh + 8} />
        </clipPath>
      </defs>
      <text className={css.caps} x={g.bx0} y={g.by - 38}>
        {commas(b.N)} sorted items · looking for #{commas(b.tgt)}
      </text>
      {/* the whole array, zoomed to the live range */}
      <g clipPath={`url(#${clip})`}>
        <rect x={X(0)} y={g.by} width={X(b.N) - X(0)} height={g.bh} fill="url(#kit-hatch-dim)" stroke="rgba(143,166,201,0.3)" />
        <rect x={X(b.bLo)} y={g.by} width={Math.max(2, X(b.bHi + 1) - X(b.bLo))} height={g.bh} rx={4} fill="var(--node-fill)" />
        <rect x={X(b.bLo)} y={g.by} width={Math.max(2, X(b.bHi + 1) - X(b.bLo))} height={g.bh} rx={4} fill={found ? 'rgba(75,227,160,0.2)' : 'rgba(196,242,90,0.13)'} stroke={found ? SIG.res : RANGE} strokeWidth={1.3} />
        {Array.from({ length: 15 }, (_, i) => (
          <line key={i} x1={g.bx0 + ((i + 1) / 16) * W} x2={g.bx0 + ((i + 1) / 16) * W} y1={g.by + g.bh - 6} y2={g.by + g.bh} stroke="rgba(143,166,201,0.25)" />
        ))}
        {midX != null && !found && <line x1={midX} x2={midX} y1={g.by - 2} y2={g.by + g.bh + 2} stroke={MID} strokeWidth={1.5} strokeDasharray="3 2" />}
      </g>
      {/* target marker */}
      <g transform={`translate(${Math.min(g.bx1, Math.max(g.bx0, tx))},${g.by + g.bh + 4})`}>
        <path d="M0,0 l-6,9 h12 z" fill={found ? SIG.res : MID} />
      </g>
      <text className={`${css.monoStrong} ${css.halo}`} x={g.bx0} y={g.by + g.bh + (land ? 20 : 34)} style={{ fill: RANGE, fontSize: land ? 11 : 9.5 }}>
        lo #{commas(b.bLo)}
      </text>
      <text className={`${css.monoStrong} ${css.halo}`} x={g.bx1} y={g.by + g.bh + (land ? 20 : 34)} textAnchor="end" style={{ fill: RANGE, fontSize: land ? 11 : 9.5 }}>
        hi #{commas(b.bHi)}
      </text>
      <text className={`${css.monoStrong} ${css.halo}`} x={(g.bx0 + g.bx1) / 2} y={g.by - 12} textAnchor="middle" style={{ fill: found ? SIG.res : 'var(--text-1)', fontSize: land ? 13 : 11 }}>
        {found ? `found #${commas(b.tgt)} in ${b.bSteps} steps` : b.bPhase === 'run' || b.bSteps > 0 ? `${commas(size)} left · step ${b.bSteps}` : `${commas(b.N)} left`}
      </text>

      {/* overview: where the live range sits in the whole array */}
      <text className={css.caps} x={g.bx0} y={g.oy - 8} style={{ fontSize: 8.5 }}>
        where you are in the whole array
      </text>
      <rect x={g.bx0} y={g.oy} width={W} height={6} rx={3} fill="rgba(143,166,201,0.12)" />
      <rect x={g.bx0 + (b.bLo / b.N) * W} y={g.oy - 2} width={Math.max(2, (size / b.N) * W)} height={10} rx={2} fill={found ? SIG.res : RANGE} />

      {/* ladder of range sizes */}
      <text className={css.caps} x={g.ladder.x0} y={g.ladder.y - 10} style={{ fontSize: 8.5 }}>
        range size after each step
      </text>
      {b.ladder.map((s, i) => {
        const L = g.ladder;
        const col = i % L.per;
        const row = Math.floor(i / L.per);
        const x = L.x0 + col * (L.cw + L.gap);
        const y = L.y + row * (L.chH + 8);
        const last = i === b.ladder.length - 1;
        return (
          <g key={i}>
            <rect x={x} y={y} width={L.cw} height={L.chH} rx={5} fill={last ? 'rgba(196,242,90,0.14)' : 'rgba(8,13,24,0.8)'} stroke={last ? RANGE : 'rgba(143,166,201,0.22)'} />
            <text className={css.mono} x={x + 6} y={y + L.chH / 2 + 3.5} style={{ fontSize: land ? 8.5 : 7.5, fill: 'var(--text-3)' }}>
              {i}
            </text>
            <text
              className={css.monoStrong}
              x={x + L.cw - 6}
              y={y + L.chH / 2 + 4}
              textAnchor="end"
              style={{ fontSize: land ? (s >= 1e8 ? 9.5 : 11) : 9.5, fill: last ? RANGE : 'var(--text-1)' }}
            >
              {land ? commas(s) : compact(s)}
            </text>
          </g>
        );
      })}
    </g>
  );
}
