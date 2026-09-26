import type { ReactNode } from 'react';
import { SIG } from '@/lib/sim/colors';
import { clamp, lerp } from '@/lib/sim/geometry';
import type { Box } from '@/lib/sim/Sim';
import { bucketRows, MAX_SHOWN, singleBucket, slotPos, type BucketGeo } from '../geo';
import { ALGO_NAMES, overlap, type Algo, type KeyState } from '../limiter';
import { fmtClock, type RateSim } from '../sim';
import css from './rl.module.css';

export const TOKEN = SIG.hc;
const OK = SIG.res;
const BAD = SIG.err;

/** One decimal, rounded down, so "4.99" never reads as "5.0". */
export function fmt1(v: number) {
  return (Math.floor(v * 10 + 1e-6) / 10).toFixed(1);
}

export function fmt2(v: number) {
  return (Math.floor(v * 100 + 1e-6) / 100).toFixed(2);
}

/** The funnel glyph in the limiter's header. */
function Funnel({ x, y }: { x: number; y: number }) {
  return (
    <path
      transform={`translate(${x},${y})`}
      d="M-6.5,-5.5 H6.5 L1.6,0.6 V5.8 L-1.6,4.2 V0.6 Z"
      fill="rgba(181,155,255,0.16)"
      stroke="#cdbdff"
      strokeWidth={1.2}
      strokeLinejoin="round"
    />
  );
}

function paramsLine(sim: RateSim) {
  const c = sim.cfg;
  const who = c.key === 'global' ? 'one global limit' : 'per client';
  if (c.algo === 'token') return `holds ${c.capacity} · refills ${c.rate}/s · ${who}`;
  if (c.algo === 'leaky') return `queue ${c.capacity} · leaks ${c.rate}/s · ${who}`;
  return `${c.limit} per ${c.window} s · ${who}`;
}

export function LimiterCard({ sim, box, dim, glow }: { sim: RateSim; box: Box; dim?: boolean; glow?: boolean }) {
  const algo = sim.cfg.algo;
  if (algo === 'none' || Number.isNaN(box.x)) return null;
  const L = sim.orient === 'landscape';
  const { w, h } = box;
  const last = sim.last && sim.last.node === 'limiter' ? sim.last : null;
  const flash = last ? clamp(1 - (sim.vt - last.vt) / 0.5, 0, 1) : 0;
  const keys = sim.keyOrder();
  const titleY = L ? 21 : 18;
  const paramY = L ? 37 : 32;

  let body: ReactNode = null;
  if (algo === 'token' || algo === 'leaky') body = keys.length > 1 ? <MiniBuckets sim={sim} w={w} h={h} algo={algo} keys={keys} /> : <Bucket sim={sim} h={h} algo={algo} k={keys[0]} />;
  else if (keys.length > 1) body = <WindowRows sim={sim} w={w} algo={algo} keys={keys} />;
  else body = <WindowSingle sim={sim} w={w} algo={algo} k={keys[0]} />;

  return (
    <g transform={`translate(${box.x - w / 2},${box.y - h / 2})`} opacity={box.alpha * (dim ? 0.28 : 1)}>
      {glow && <rect x={-6} y={-6} width={w + 12} height={h + 12} rx={16} fill="none" stroke="var(--accent)" strokeWidth={1.4} strokeDasharray="3 3" />}
      {L && (
        <text className={css.caps} x={2} y={-8}>
          api gateway
        </text>
      )}
      <rect className={css.card} width={w} height={h} rx={12} />
      {flash > 0.01 && last && <rect x={-2.5} y={-2.5} width={w + 5} height={h + 5} rx={14} fill="none" stroke={last.d.ok ? OK : BAD} strokeWidth={2.2} opacity={flash * 0.85} />}
      <rect className={css.inner} x={4} y={4} width={w - 8} height={h - 8} rx={9} />
      <Funnel x={17} y={titleY - 4} />
      <text className={css.title} x={30} y={titleY}>
        rate limiter
      </text>
      <text className={css.algo} x={w - 12} y={titleY - 1} textAnchor="end">
        {ALGO_NAMES[algo]}
      </text>
      <text className={css.monoDim} x={12} y={paramY}>
        {paramsLine(sim)}
      </text>
      {body}
    </g>
  );
}

/* ------------------------------------------------------------------ */
/* Window algorithms                                                   */
/* ------------------------------------------------------------------ */

/** Window state as it stands right now (a window may have rolled since the last request). */
function windowView(sim: RateSim, s: KeyState | null) {
  const p = sim.params;
  const lt = sim.lt;
  const win = Math.floor(lt / p.window + 1e-9);
  const count = s && s.win === win ? s.count : 0;
  const prev = s ? (s.win === win ? s.prev : s.win === win - 1 ? s.count : 0) : 0;
  const log = s ? s.log.filter((t) => t > lt - p.window) : [];
  return { win, winStart: win * p.window, count, prev, log, wgt: overlap(lt, p) };
}

/** One key: big slots, a window bar, a status line. */
function WindowSingle({ sim, w, algo, k }: { sim: RateSim; w: number; algo: Algo; k: string }) {
  const L = sim.orient === 'landscape';
  const p = sim.params;
  const lt = sim.lt;
  const s = sim.liveState(k);
  const v = windowView(sim, s);
  const top = L ? 50 : 41;

  if (algo === 'sliding') {
    const est = v.prev * v.wgt + v.count;
    const full = est >= p.limit - 1e-9;
    const rowH = L ? 25 : 20;
    const small = Math.max(7, Math.min(L ? 17 : 13, Math.floor((w - 24 - (L ? 150 : 124)) / p.limit) - 4));
    const sx = L ? 78 : 66;
    const barY = top + rowH * 2 + (L ? 12 : 8);
    const barW = w - 24;
    const rows = [
      { label: 'previous', n: v.prev, tone: '#b59bff', note: `× ${fmt2(v.wgt)}`, prev: true },
      { label: 'current', n: v.count, tone: OK, note: '', prev: false },
    ];
    return (
      <g>
        {rows.map((r, i) => {
          const y = top + i * rowH;
          return (
            <g key={r.label}>
              <text className={css.caps} x={12} y={y + small / 2 + 3}>
                {r.label}
              </text>
              {Array.from({ length: p.limit }, (_, j) => (
                <rect
                  key={j}
                  className={css.slot}
                  x={sx + j * (small + 4)}
                  y={y}
                  width={small}
                  height={small}
                  rx={3}
                  style={j < r.n ? { fill: r.tone, stroke: r.tone, fillOpacity: r.prev ? 0.25 + 0.6 * v.wgt : 0.85 } : undefined}
                />
              ))}
              <text className={css.mono} x={w - 12} y={y + small / 2 + 4} textAnchor="end">
                {r.n}
                {r.note ? ` ${r.note}` : ''}
              </text>
            </g>
          );
        })}
        <text className={css.caps} x={12} y={barY - 6}>
          estimate
        </text>
        <text className={css.mono} x={w - 12} y={barY - 6} textAnchor="end" style={{ fill: full ? BAD : 'var(--text-1)' }}>
          {v.prev}×{fmt2(v.wgt)} + {v.count} = {fmt2(est)} {full ? '≥' : '<'} {p.limit}
        </text>
        <rect className={css.track} x={12} y={barY} width={barW} height={5} rx={2.5} />
        <rect x={12} y={barY} width={Math.min(1, est / p.limit) * barW} height={5} rx={2.5} fill={full ? BAD : OK} opacity={0.85} />
      </g>
    );
  }

  const gap = L ? 6 : 5;
  const textW = L ? 66 : 54;
  const size = Math.max(8, Math.min(L ? 24 : 19, Math.floor((w - 24 - textW + gap) / p.limit) - gap));
  const n = algo === 'log' ? v.log.length : v.count;
  const full = n >= p.limit;
  const barY = top + size + (L ? 28 : 20);
  const barW = w - 24;
  const resetIn = algo === 'log' ? (v.log.length ? v.log[0] + p.window - lt : 0) : (v.win + 1) * p.window - lt;
  return (
    <g>
      {Array.from({ length: p.limit }, (_, j) => {
        const x = 12 + j * (size + gap);
        if (algo === 'log' && j < n) {
          const life = clamp((v.log[j] + p.window - lt) / p.window, 0, 1);
          return (
            <g key={j}>
              <rect className={css.slot} x={x} y={top} width={size} height={size} rx={4} style={{ stroke: full ? BAD : OK }} />
              <rect x={x + 1.5} y={top + 1.5 + (size - 3) * (1 - life)} width={size - 3} height={(size - 3) * life} rx={2.5} fill={full ? BAD : OK} opacity={0.85} />
            </g>
          );
        }
        return <rect key={j} className={css.slot} x={x} y={top} width={size} height={size} rx={4} style={j < n ? { fill: full ? BAD : OK, stroke: full ? BAD : OK, fillOpacity: 0.85 } : undefined} />;
      })}
      <text className={L ? css.big : css.mid} x={12 + p.limit * (size + gap) + 4} y={top + size / 2 + (L ? 8 : 5)} style={{ fill: full ? BAD : 'var(--text-1)' }}>
        {n}
        <tspan className={css.mono} dx={3}>
          / {p.limit}
        </tspan>
      </text>

      {algo === 'fixed' ? (
        <>
          <text className={css.monoDim} x={12} y={barY - 6}>
            window {fmtClock(v.winStart)} → {fmtClock(v.winStart + p.window)}
          </text>
          <text className={css.mono} x={w - 12} y={barY - 6} textAnchor="end">
            resets in {fmt1(resetIn)} s
          </text>
          <rect className={css.track} x={12} y={barY} width={barW} height={5} rx={2.5} />
          <rect x={12} y={barY} width={clamp((lt - v.winStart) / p.window, 0, 1) * barW} height={5} rx={2.5} fill="#b59bff" opacity={0.8} />
          <text className={css.mono} x={12} y={barY + (L ? 22 : 17)} style={{ fill: full ? BAD : OK }}>
            {full ? `full · 429 until ${fmtClock(v.winStart + p.window)}` : `room for ${p.limit - n} more`}
          </text>
        </>
      ) : (
        <>
          <text className={css.monoDim} x={12} y={barY - 4}>
            {L ? `each entry expires ${p.window} s after it arrived` : `entries expire after ${p.window} s`}
          </text>
          <text className={css.mono} x={12} y={barY + (L ? 16 : 13)} style={{ fill: full ? BAD : OK }}>
            {full ? 'full · 429' : `room for ${p.limit - n} more`}
          </text>
          {n > 0 && (
            <text className={css.mono} x={w - 12} y={barY + (L ? 16 : 13)} textAnchor="end">
              oldest leaves in {fmt1(resetIn)} s
            </text>
          )}
        </>
      )}
    </g>
  );
}

/** Several keys: one row of slots each. */
function WindowRows({ sim, w, algo, keys }: { sim: RateSim; w: number; algo: Algo; keys: string[] }) {
  const L = sim.orient === 'landscape';
  const p = sim.params;
  const lt = sim.lt;
  const top = L ? 49 : 40;
  const rowH = L ? 26 : 20;
  const nameW = L ? 66 : 58;
  const numW = L ? 46 : 40;
  const gap = 4;
  const size = Math.max(6, Math.min(L ? 16 : 13, Math.floor((w - 24 - nameW - numW + gap) / p.limit) - gap));
  const win = Math.floor(lt / p.window + 1e-9);
  const winStart = win * p.window;
  const barY = top + keys.length * rowH + (L ? 12 : 6);
  const barW = w - 24;
  return (
    <g>
      {keys.map((k, i) => {
        const v = windowView(sim, sim.liveState(k));
        const y = top + i * rowH;
        const est = v.prev * v.wgt + v.count;
        const n = algo === 'log' ? v.log.length : v.count;
        const full = algo === 'sliding' ? est >= p.limit - 1e-9 : n >= p.limit;
        return (
          <g key={k}>
            <circle cx={16} cy={y + size / 2} r={3.5} fill={sim.keyColor(k)} />
            <text className={css.name} x={24} y={y + size / 2 + 4} style={{ fill: 'var(--text-1)', fontSize: L ? 11 : 10 }}>
              {sim.keyLabel(k)}
            </text>
            {Array.from({ length: p.limit }, (_, j) => (
              <rect
                key={j}
                className={css.slot}
                x={12 + nameW + j * (size + gap)}
                y={y}
                width={size}
                height={size}
                rx={3}
                style={j < n ? { fill: full ? BAD : OK, stroke: full ? BAD : OK, fillOpacity: 0.85 } : undefined}
              />
            ))}
            <text className={css.mono} x={w - 12} y={y + size / 2 + 4} textAnchor="end" style={{ fill: full ? BAD : 'var(--text-1)' }}>
              {algo === 'sliding' ? `≈${fmt1(est)}` : `${n}/${p.limit}`}
            </text>
          </g>
        );
      })}
      {algo !== 'log' ? (
        <>
          <text className={css.monoDim} x={12} y={barY + (L ? 10 : 6)}>
            {L ? `window ${fmtClock(winStart)} → ${fmtClock(winStart + p.window)}` : `${fmtClock(winStart)} → ${fmtClock(winStart + p.window)}`}
          </text>
          <text className={css.mono} x={w - 12} y={barY + (L ? 10 : 6)} textAnchor="end">
            resets in {fmt1((win + 1) * p.window - lt)} s
          </text>
          <rect className={css.track} x={12} y={barY + (L ? 17 : 11)} width={barW} height={4} rx={2} />
          <rect x={12} y={barY + (L ? 17 : 11)} width={clamp((lt - winStart) / p.window, 0, 1) * barW} height={4} rx={2} fill="#b59bff" opacity={0.8} />
        </>
      ) : (
        <text className={css.monoDim} x={12} y={barY + (L ? 10 : 6)}>
          counts requests in the last {p.window} s
        </text>
      )}
    </g>
  );
}

/* ------------------------------------------------------------------ */
/* Buckets                                                             */
/* ------------------------------------------------------------------ */

function BucketShape({ g, hole }: { g: BucketGeo; hole: boolean }) {
  const l0 = g.cx - g.tw / 2;
  const r0 = g.cx + g.tw / 2;
  const l1 = g.cx - g.bw / 2;
  const r1 = g.cx + g.bw / 2;
  const outline = hole
    ? `M${l0},${g.top} L${l1},${g.bot} L${g.cx - 5},${g.bot} M${g.cx + 5},${g.bot} L${r1},${g.bot} L${r0},${g.top}`
    : `M${l0},${g.top} L${l1},${g.bot} L${r1},${g.bot} L${r0},${g.top}`;
  return (
    <g>
      <path d={`M${l0},${g.top} L${l1},${g.bot} L${r1},${g.bot} L${r0},${g.top} Z`} fill="rgba(181,155,255,0.05)" stroke="none" />
      <path d={outline} fill="none" stroke="rgba(205,189,255,0.7)" strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
      <ellipse cx={g.cx} cy={g.top} rx={g.tw / 2} ry={3} fill="none" stroke="rgba(205,189,255,0.45)" strokeWidth={1.1} />
    </g>
  );
}

function Coin({ x, y, r, k = 1, faded }: { x: number; y: number; r: number; k?: number; faded?: boolean }) {
  return (
    <g opacity={faded ? 0.55 : 1}>
      <circle cx={x} cy={y} r={r * k} fill={TOKEN} fillOpacity={0.92} stroke="#e6ddff" strokeWidth={0.9} />
      {r * k > 5 && <circle cx={x} cy={y} r={r * k * 0.48} fill="none" stroke="rgba(20,12,48,0.55)" strokeWidth={1} />}
    </g>
  );
}

function EmptySlot({ x, y, r }: { x: number; y: number; r: number }) {
  return <circle cx={x} cy={y} r={r} fill="none" stroke="rgba(205,189,255,0.3)" strokeDasharray="2 2.5" />;
}

function Bucket({ sim, h, algo, k }: { sim: RateSim; h: number; algo: 'token' | 'leaky'; k: string }) {
  const L = sim.orient === 'landscape';
  const p = sim.params;
  const lt = sim.lt;
  const s: KeyState | null = sim.liveState(k);
  const cap = p.capacity;
  const g = singleBucket(L, cap, h);
  const shown = Math.min(cap, MAX_SHOWN);
  const col = L ? 150 : 124;
  const ys = L ? [64, 92, 114, 136] : [50, 70, 86, 103];

  if (algo === 'token') {
    const tokens = s ? s.tokens : cap;
    const whole = Math.floor(tokens + 1e-9);
    const frac = tokens - whole;
    const fillAge = s ? lt - s.fillAt : 99;
    const takeAge = s ? lt - s.takeAt : 99;
    const falling = fillAge >= 0 && fillAge < 0.35 && whole > 0;
    const spout = { x: g.cx, y: g.top - 6 };
    const empty = tokens < 1 - 1e-9;
    const full = tokens >= cap - 1e-9;
    return (
      <g>
        {/* the tap: tokens drip in at the refill rate */}
        <path className={css.pipe} d={`M${g.cx + 40},${g.top - 16} H${g.cx + 6} Q${g.cx},${g.top - 16} ${g.cx},${g.top - 10}`} />
        {L && (
          <text className={css.monoDim} x={g.cx + 14} y={g.top - 22} style={{ fill: '#cdbdff' }}>
            +{p.rate}/s
          </text>
        )}
        {!full && frac > 0.02 && <Coin x={spout.x} y={spout.y + 1} r={g.r} k={Math.max(0.25, frac)} faded />}
        <BucketShape g={g} hole={false} />
        {Array.from({ length: shown }, (_, i) => {
          const pos = slotPos(g, i);
          if (i < whole && !(falling && i === whole - 1)) return <Coin key={i} x={pos.x} y={pos.y} r={g.r} />;
          return <EmptySlot key={i} x={pos.x} y={pos.y} r={g.r} />;
        })}
        {falling &&
          (() => {
            const pos = slotPos(g, whole - 1);
            const q = fillAge / 0.35;
            return <Coin x={pos.x} y={lerp(spout.y, pos.y, q * q)} r={g.r} />;
          })()}
        {takeAge >= 0 &&
          takeAge < 0.3 &&
          (() => {
            const pos = slotPos(g, Math.min(shown - 1, whole));
            const q = takeAge / 0.3;
            return (
              <g opacity={1 - q}>
                <Coin x={lerp(pos.x, -4, q)} y={lerp(pos.y, h / 2, q)} r={g.r} />
              </g>
            );
          })()}
        <text className={css.caps} x={col} y={ys[0]}>
          tokens
        </text>
        <text className={L ? css.big : css.mid} x={col} y={ys[1]} style={{ fill: empty ? BAD : 'var(--text-1)' }}>
          {fmt1(tokens)}
          <tspan className={css.mono} dx={4}>
            / {cap}
          </tspan>
        </text>
        <text className={css.mono} x={col} y={ys[2]}>
          +1 every {fmt1(1 / p.rate)} s
        </text>
        <text className={css.mono} x={col} y={ys[3]} style={{ fill: empty ? BAD : full ? 'var(--text-3)' : OK }}>
          {empty ? 'empty · 429' : full ? 'full' : '1 per request'}
        </text>
      </g>
    );
  }

  // Leaky bucket: requests wait in the bucket and drip out at a fixed pace.
  const q = s ? s.queue : [];
  const leakAge = s ? lt - s.takeAt : 99;
  const next = s && q.length ? Math.max(0, s.nextLeak - lt) : 0;
  const full = q.length >= cap;
  return (
    <g>
      <BucketShape g={g} hole />
      {Array.from({ length: shown }, (_, i) => {
        const pos = slotPos(g, i);
        const item = q[i];
        if (item) {
          const c = sim.reqColor(item.client);
          return (
            <g key={i}>
              <circle cx={pos.x} cy={pos.y} r={g.r} fill={c} fillOpacity={0.2} stroke={c} strokeWidth={1.2} />
              <circle cx={pos.x} cy={pos.y} r={g.r * 0.45} fill={c} />
            </g>
          );
        }
        return <EmptySlot key={i} x={pos.x} y={pos.y} r={g.r} />;
      })}
      {leakAge >= 0 && leakAge < 0.3 && <circle cx={g.cx} cy={g.bot + 2 + leakAge * 30} r={3} fill={SIG.req} opacity={1 - leakAge / 0.3} />}
      <text className={css.caps} x={col} y={ys[0]}>
        in the queue
      </text>
      <text className={L ? css.big : css.mid} x={col} y={ys[1]} style={{ fill: full ? BAD : 'var(--text-1)' }}>
        {q.length}
        <tspan className={css.mono} dx={4}>
          / {cap}
        </tspan>
      </text>
      <text className={css.mono} x={col} y={ys[2]}>
        1 out every {fmt1(1 / p.rate)} s
      </text>
      <text className={css.mono} x={col} y={ys[3]} style={{ fill: full ? BAD : q.length ? 'var(--text-2)' : 'var(--text-3)' }}>
        {full ? 'full · 429' : q.length ? `next in ${fmt1(next)} s` : 'empty'}
      </text>
    </g>
  );
}

function MiniBuckets({ sim, w, h, algo, keys }: { sim: RateSim; w: number; h: number; algo: 'token' | 'leaky'; keys: string[] }) {
  const L = sim.orient === 'landscape';
  const p = sim.params;
  const n = keys.length;
  const slotW = (w - 24) / n;
  const rows = bucketRows(p.capacity);
  const r = L ? 7 : 4.2;
  const sp = L ? 16 : 10.5;
  const rowH = L ? 15.5 : 9.5;
  const bot = h - (L ? 40 : 32);
  const top = bot - rows * rowH - (L ? 10 : 7);
  const tw = Math.min(2 * sp + 2 * r + (L ? 18 : 14), slotW - 14);
  const cap = Math.min(p.capacity, MAX_SHOWN);
  return (
    <g>
      {keys.map((k, i) => {
        const cx = 12 + slotW * (i + 0.5);
        const g: BucketGeo = { cx, top, bot, tw, bw: tw * 0.8, r, sp, rowH, cols: 3 };
        const s = sim.liveState(k);
        let inner: ReactNode;
        let value: string;
        let bad = false;
        if (algo === 'token') {
          const tokens = s ? s.tokens : p.capacity;
          const whole = Math.floor(tokens + 1e-9);
          bad = tokens < 1 - 1e-9;
          value = `${fmt1(tokens)} tokens`;
          inner = Array.from({ length: cap }, (_, j) => {
            const pos = slotPos(g, j);
            return j < whole ? <Coin key={j} x={pos.x} y={pos.y} r={r} /> : <EmptySlot key={j} x={pos.x} y={pos.y} r={r} />;
          });
        } else {
          const q = s ? s.queue : [];
          bad = q.length >= p.capacity;
          value = `${q.length}/${p.capacity} queued`;
          inner = Array.from({ length: cap }, (_, j) => {
            const pos = slotPos(g, j);
            const item = q[j];
            return item ? <circle key={j} cx={pos.x} cy={pos.y} r={r} fill={sim.reqColor(item.client)} fillOpacity={0.85} /> : <EmptySlot key={j} x={pos.x} y={pos.y} r={r} />;
          });
        }
        return (
          <g key={k}>
            <BucketShape g={g} hole={algo === 'leaky'} />
            {inner}
            <text className={css.name} x={cx} y={bot + (L ? 16 : 13)} textAnchor="middle" style={{ fill: sim.keyColor(k), fontSize: L ? 11 : 10 }}>
              {sim.keyLabel(k)}
            </text>
            <text className={css.monoDim} x={cx} y={bot + (L ? 30 : 24)} textAnchor="middle" style={{ fill: bad ? BAD : undefined, fontSize: L ? 9.5 : 8.5 }}>
              {value}
            </text>
          </g>
        );
      })}
    </g>
  );
}
