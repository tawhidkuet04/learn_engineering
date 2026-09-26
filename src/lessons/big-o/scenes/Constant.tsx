'use client';

import { SIG } from '@/lib/sim/colors';
import { bezier, type Curve } from '@/lib/sim/geometry';
import { CONST_INDEX, CONST_KEY } from '../engine/constant';
import { frame } from '../layout';
import { commas, ease } from '../model';
import type { BigOSim } from '../sim';
import css from '../bigo.module.css';

const VALUES = [31, 7, 58, 90, 12, 66, 42, 19, 75, 3, 88, 24];

interface Slot {
  x: number;
  w: number;
  /** Array index, or null for the "···" gap */
  idx: number | null;
}

/** Visible cells for an array of n: all of them if they fit, else a head, a gap and the last one. */
function slots(n: number, x0: number, x1: number, maxCells: number): Slot[] {
  const gapW = 34;
  if (n <= maxCells) {
    const w = Math.min(48, (x1 - x0 - (n - 1) * 4) / n);
    return Array.from({ length: n }, (_, i) => ({ x: x0 + i * (w + 4), w, idx: i }));
  }
  const head = maxCells - 1;
  const w = Math.min(48, (x1 - x0 - gapW - head * 4) / (head + 1));
  const out: Slot[] = [];
  for (let i = 0; i < head; i++) out.push({ x: x0 + i * (w + 4), w, idx: i });
  const gx = x0 + head * (w + 4);
  out.push({ x: gx, w: gapW - 4, idx: null });
  out.push({ x: gx + gapW, w, idx: n - 1 });
  return out;
}

function arc(ax: number, ay: number, bx: number, by: number, lift: number): Curve {
  return {
    p0: { x: ax, y: ay },
    p1: { x: ax + (bx - ax) * 0.25, y: Math.min(ay, by) - lift },
    p2: { x: ax + (bx - ax) * 0.75, y: Math.min(ay, by) - lift },
    p3: { x: bx, y: by },
  };
}

function Flight({ c, k, color }: { c: Curve; k: number; color: string }) {
  if (k <= 0 || k >= 1) return null;
  const e = ease(k);
  const p = bezier(c, e);
  const t = bezier(c, Math.max(0, e - 0.08));
  return (
    <g>
      <line x1={t.x} y1={t.y} x2={p.x} y2={p.y} stroke={color} strokeWidth={5.5} strokeLinecap="round" opacity={0.28} />
      <circle cx={p.x} cy={p.y} r={12} fill={color} opacity={0.14} />
      <circle cx={p.x} cy={p.y} r={4.8} fill={color} />
    </g>
  );
}

const pathD = (c: Curve) => `M${c.p0.x},${c.p0.y} C${c.p1.x},${c.p1.y} ${c.p2.x},${c.p2.y} ${c.p3.x},${c.p3.y}`;

export function ConstantScene({ sim, hl }: { sim: BigOSim; hl: string | null }) {
  const k = sim.konst;
  const f = frame(sim);
  const land = f.land;
  const resize = Math.max(0, 1 - (sim.vt - k.changedVt) / 0.7);

  /* ---------------- row A: arr[6] ---------------- */
  const aY = land ? f.y0 + 118 : f.y0 + 96;
  const chipA = land ? { x: f.x0 + 4, y: aY - 22, w: 150, h: 44 } : { x: f.x0 + 2, y: f.y0 + 20, w: 118, h: 34 };
  const stripX0 = land ? f.x0 + 230 : f.x0 + 2;
  const stripX1 = f.x1 - (land ? 8 : 2);
  const cellsA = slots(k.n, stripX0, stripX1, land ? 12 : 9);
  const ch = land ? 44 : 34;
  const target = cellsA.find((s) => s.idx === CONST_INDEX)!;
  const jA = k.arrJump;
  const landedA = jA >= 1;
  const cA = arc(chipA.x + chipA.w, chipA.y + chipA.h / 2, target.x + target.w / 2, aY - ch / 2 - 2, land ? 70 : 36);
  if (!land) {
    cA.p0 = { x: chipA.x + chipA.w / 2 + 30, y: chipA.y + chipA.h };
    cA.p1 = { x: cA.p0.x + 30, y: cA.p0.y + 30 };
    cA.p2 = { x: target.x + target.w / 2, y: aY - ch / 2 - 40 };
  }

  /* ---------------- row B: set.has("carol") ---------------- */
  const bTop = land ? f.y0 + 300 : f.y0 + 214;
  const chipB = land ? { x: f.x0 + 4, y: bTop, w: 196, h: 44 } : { x: f.x0 + 2, y: bTop, w: 170, h: 34 };
  const hashBox = land ? { x: f.x0 + 250, y: bTop - 6, w: 250, h: 56 } : { x: f.x1 - 158, y: bTop - 4, w: 156, h: 42 };
  const bY = land ? bTop + 150 : bTop + 128;
  const bucketCount = k.buckets;
  const bIdx = k.bucket;
  const win = bucketWindow(bucketCount, bIdx, land ? 9 : 7);
  const bx0 = land ? f.x0 + 230 : f.x0 + 2;
  const bx1 = f.x1 - (land ? 8 : 2);
  const bw = Math.min(56, (bx1 - bx0 - (win.length - 1) * 4) / win.length);
  const bh = land ? 50 : 40;
  const tSlot = win.findIndex((w) => w === bIdx);
  const tX = bx0 + tSlot * (bw + 4) + bw / 2;
  const hIn = k.hashIn;
  const hJ = k.hashJump;
  const cB1 = arc(chipB.x + chipB.w, chipB.y + chipB.h / 2, hashBox.x, hashBox.y + hashBox.h / 2, land ? 26 : 10);
  if (!land) {
    cB1.p0 = { x: chipB.x + chipB.w, y: chipB.y + chipB.h / 2 };
    cB1.p1 = { x: chipB.x + chipB.w + 4, y: chipB.y + chipB.h / 2 - 8 };
    cB1.p2 = { x: hashBox.x - 4, y: hashBox.y + hashBox.h / 2 - 8 };
    cB1.p3 = { x: hashBox.x, y: hashBox.y + hashBox.h / 2 };
  }
  const cB2: Curve = {
    p0: { x: hashBox.x + hashBox.w / 2, y: hashBox.y + hashBox.h },
    p1: { x: hashBox.x + hashBox.w / 2, y: hashBox.y + hashBox.h + 50 },
    p2: { x: tX, y: bY - bh / 2 - 50 },
    p3: { x: tX, y: bY - bh / 2 - 2 },
  };
  const landedB = hJ >= 1;

  return (
    <g>
      {/* ===== row A ===== */}
      <text className={css.caps} x={chipA.x} y={chipA.y - (land ? 16 : 8)}>
        array index
      </text>
      <CodeChip r={chipA} code="arr[6]" glow={hl === 'arr'} land={land} />
      <path d={pathD(cA)} fill="none" stroke="rgba(143,166,201,0.25)" strokeDasharray="3 4" />
      {land && (
        <text className={`${css.monoMid} ${css.halo}`} x={(cA.p1.x + cA.p2.x) / 2} y={Math.min(cA.p1.y, cA.p2.y) + 16} textAnchor="middle" style={{ fill: SIG.warn }}>
          address = start + 6 × 8 bytes
        </text>
      )}
      {cellsA.map((s, i) => {
        if (s.idx == null) return <Dots key={`g${i}`} x={s.x + s.w / 2} y={aY} />;
        const hit = s.idx === CONST_INDEX && landedA;
        return (
          <g key={`a${i}`}>
            <rect
              x={s.x}
              y={aY - ch / 2}
              width={s.w}
              height={ch}
              rx={5}
              fill={hit ? 'rgba(75,227,160,0.18)' : 'var(--node-fill)'}
              stroke={hit ? SIG.res : `rgba(143,166,201,${0.45 + resize * 0.5})`}
              strokeWidth={hit ? 1.6 : 1.1}
            />
            <text className={s.w < 34 ? css.cellTextSm : css.cellText} x={s.x + s.w / 2} y={aY + 4} textAnchor="middle" style={hit ? { fill: SIG.res } : undefined}>
              {VALUES[s.idx % VALUES.length]}
            </text>
            <text className={css.mono} x={s.x + s.w / 2} y={aY - ch / 2 - 6} textAnchor="middle" style={{ fontSize: s.idx > 999 ? 8 : 9, fill: s.idx === CONST_INDEX ? SIG.warn : undefined }}>
              {s.idx > 999 && !land ? `${Math.round(s.idx / 1e6)}M−1` : commas(s.idx)}
            </text>
            {land && (
              <text className={css.mono} x={s.x + s.w / 2} y={aY + ch / 2 + 14} textAnchor="middle" style={{ fontSize: 8 }}>
                +{commas(s.idx * 8)}
              </text>
            )}
          </g>
        );
      })}
      <Flight c={cA} k={jA} color={SIG.req} />
      <StepTag x={stripX1} y={land ? aY + ch / 2 + 34 : aY + ch / 2 + 16} text={`${k.arrSteps()} step · n = ${commas(k.n)}`} on={k.arrSteps() > 0} land={land} />

      {/* ===== row B ===== */}
      <text className={css.caps} x={chipB.x} y={chipB.y - (land ? 16 : 8)}>
        hash lookup
      </text>
      <CodeChip r={chipB} code={`set.has("${CONST_KEY}")`} glow={hl === 'hash'} land={land} />
      <path d={pathD(cB1)} fill="none" stroke="rgba(143,166,201,0.25)" strokeDasharray="3 4" />
      <path d={pathD(cB2)} fill="none" stroke="rgba(143,166,201,0.25)" strokeDasharray="3 4" />
      <g>
        <rect className={css.card} x={hashBox.x} y={hashBox.y} width={hashBox.w} height={hashBox.h} rx={9} style={hIn >= 1 ? { stroke: SIG.hc } : undefined} />
        <text className={css.monoMid} x={hashBox.x + 12} y={hashBox.y + (land ? 22 : 17)} style={{ fontSize: land ? 11 : 9.5 }}>
          hash(&quot;{CONST_KEY}&quot;) = {land ? commas(k.hash) : `${(k.hash / 1e9).toFixed(2)}B`}
        </text>
        <text className={css.monoStrong} x={hashBox.x + 12} y={hashBox.y + (land ? 42 : 33)} style={{ fontSize: land ? 12 : 10.5, fill: hIn >= 1 ? SIG.warn : 'var(--text-2)' }}>
          mod {commas(bucketCount)} = {commas(bIdx)}
        </text>
      </g>
      {win.map((b, i) => {
        const x = bx0 + i * (bw + 4);
        if (b == null) return <Dots key={`bg${i}`} x={x + bw / 2} y={bY} />;
        const isT = b === bIdx;
        const hit = isT && landedB;
        const occupied = isT || ((b * 7 + 3) % 5 < 2 && b !== bIdx);
        return (
          <g key={`b${i}`}>
            <rect
              x={x}
              y={bY - bh / 2}
              width={bw}
              height={bh}
              rx={6}
              fill={hit ? 'rgba(75,227,160,0.16)' : 'var(--node-fill)'}
              stroke={hit ? SIG.res : `rgba(143,166,201,${0.4 + resize * 0.5})`}
              strokeWidth={hit ? 1.6 : 1}
            />
            {isT ? (
              <text className={css.cellTextSm} x={x + bw / 2} y={bY + 3.5} textAnchor="middle" style={{ fill: hit ? SIG.res : 'var(--text-2)', fontSize: land ? 10 : 8.5 }}>
                {CONST_KEY}
              </text>
            ) : (
              occupied && <circle cx={x + bw / 2} cy={bY} r={3} fill="rgba(143,166,201,0.45)" />
            )}
            <text className={css.mono} x={x + bw / 2} y={bY + bh / 2 + 13} textAnchor="middle" style={{ fontSize: b > 9999 ? 7.5 : 9, fill: isT ? SIG.warn : undefined }}>
              {commas(b)}
            </text>
          </g>
        );
      })}
      <text className={css.caps} x={bx0} y={bY - bh / 2 - 10} style={{ fontSize: 8.5 }}>
        {commas(bucketCount)} buckets
      </text>
      <Flight c={cB1} k={hIn} color={SIG.hc} />
      <Flight c={cB2} k={hJ} color={SIG.hc} />
      <StepTag x={bx1} y={bY + bh / 2 + (land ? 34 : 30)} text={`1 hash + 1 bucket · n = ${commas(k.n)}`} on={k.hashSteps() > 0} land={land} />
    </g>
  );
}

function bucketWindow(count: number, target: number, size: number): (number | null)[] {
  if (count <= size) return Array.from({ length: count }, (_, i) => i);
  const half = Math.floor((size - 2) / 2);
  let lo = Math.max(0, target - half);
  const hi = Math.min(count - 1, lo + size - 3);
  lo = Math.max(0, hi - (size - 3));
  const out: (number | null)[] = [];
  if (lo > 0) out.push(null);
  for (let b = lo; b <= hi; b++) out.push(b);
  if (hi < count - 1) out.push(null);
  while (out.length > size) out.splice(out[0] == null ? 1 : out.length - 2, 1);
  return out;
}

function CodeChip({ r, code, glow, land }: { r: { x: number; y: number; w: number; h: number }; code: string; glow: boolean; land: boolean }) {
  return (
    <g>
      {glow && <rect x={r.x - 5} y={r.y - 5} width={r.w + 10} height={r.h + 10} rx={12} fill="none" stroke="var(--accent)" strokeDasharray="3 3" />}
      <rect className={css.card} x={r.x} y={r.y} width={r.w} height={r.h} rx={9} />
      <rect x={r.x + 10} y={r.y} width={r.w - 20} height={2} rx={1} fill={SIG.req} opacity={0.8} />
      <text className={css.monoStrong} x={r.x + r.w / 2} y={r.y + r.h / 2 + 4.5} textAnchor="middle" style={{ fontSize: land ? 14 : 12 }}>
        {code}
      </text>
    </g>
  );
}

function Dots({ x, y }: { x: number; y: number }) {
  return (
    <g fill="rgba(143,166,201,0.6)">
      <circle cx={x - 7} cy={y} r={1.6} />
      <circle cx={x} cy={y} r={1.6} />
      <circle cx={x + 7} cy={y} r={1.6} />
    </g>
  );
}

function StepTag({ x, y, text, on, land }: { x: number; y: number; text: string; on: boolean; land: boolean }) {
  const w = text.length * (land ? 6.9 : 6.1) + 22;
  return (
    <g transform={`translate(${x - w},${y - 12})`} opacity={on ? 1 : 0.45}>
      <rect width={w} height={24} rx={12} fill="rgba(7,11,20,0.9)" stroke={SIG.res} strokeOpacity={on ? 0.7 : 0.3} />
      <text className={css.monoStrong} x={w / 2} y={16} textAnchor="middle" style={{ fill: SIG.res, fontSize: land ? 11.5 : 10 }}>
        {text}
      </text>
    </g>
  );
}
