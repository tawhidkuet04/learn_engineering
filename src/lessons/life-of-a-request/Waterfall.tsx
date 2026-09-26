import { SIG } from '@/lib/sim/colors';
import kit from '@/components/stage/stage.module.css';
import { fmtMs, PH, ROWS, type Journey, type RowId, type Seg } from './journey';
import type { JourneySim } from './sim';

const MONO = 'var(--font-mono)';
const HALO = { paintOrder: 'stroke', stroke: 'rgba(7,11,20,0.92)', strokeWidth: 3, strokeLinejoin: 'round' } as const;

function tickStep(axis: number) {
  if (axis <= 160) return 20;
  if (axis <= 400) return 50;
  if (axis <= 900) return 100;
  if (axis <= 2000) return 250;
  return 500;
}

/** Per-row summary for the duration label. */
function rowInfo(segs: Seg[], row: RowId) {
  const list = segs.filter((s) => s.row === row);
  if (!list.length) return null;
  const fetch = list.filter((s) => s.kind !== 'exec');
  const start = Math.min(...list.map((s) => s.start));
  const end = Math.max(...list.map((s) => s.end));
  const fStart = fetch.length ? Math.min(...fetch.map((s) => s.start)) : start;
  const fEnd = fetch.length ? Math.max(...fetch.map((s) => s.end)) : end;
  return { list, start, end, dur: fEnd - fStart, kind: list[0].kind, hasErr: list.some((s) => s.kind === 'error') };
}

/**
 * The waterfall: one row per phase, real milliseconds on the x axis.
 * Bars grow as the journey clock passes them (or show the whole plan in the
 * static view, with a cursor for "now").
 */
export function Waterfall({ sim, highlight, glow }: { sim: JourneySim; highlight?: RowId[]; glow?: boolean }) {
  const { wf } = sim;
  const portrait = sim.orient === 'portrait';
  const j = sim.j;
  const ghost = sim.ghostJ;
  const x0 = wf.x + wf.labelW;
  const x1 = wf.x + wf.w - (portrait ? 36 : 64);
  const scale = (x1 - x0) / Math.max(1, sim.axis);
  const X = (ms: number) => x0 + Math.max(0, ms) * scale;
  const rowY = (i: number) => wf.y + wf.head + i * wf.rowH;
  const barH = Math.max(6, wf.rowH - (portrait ? 5 : 7));
  const step = tickStep(sim.axis);
  const ticks: number[] = [];
  for (let v = 0; v <= sim.axis + 1e-6; v += step) ticks.push(v);
  const now = sim.tau;
  const staticWf = sim.sc.staticWf;
  const fs = portrait ? 8.5 : 9.5;
  const rowsBottom = wf.y + wf.head + ROWS.length * wf.rowH;
  const bottom = rowsBottom + 2;

  const bars = (jj: Journey, isGhost: boolean) =>
    ROWS.map((row, i) => {
      const y = rowY(i) + (wf.rowH - barH) / 2;
      const count: Record<string, number> = {};
      return jj.segs
        .filter((s) => s.row === row.id)
        .map((s, k) => {
          const n = (count[s.row] = (count[s.row] ?? -1) + 1);
          const ext = isGhost ? { s: s.start, e: s.end } : sim.segExtent(s.row, n, s.kind, s.start, s.end);
          if (!ext) return null;
          const xa = X(ext.s);
          let w = Math.max(0, X(ext.e) - xa);
          const key = `${isGhost ? 'g' : 'l'}-${row.id}-${k}`;
          if (isGhost) {
            if (s.kind === 'skip' || s.kind === 'cache' || s.kind === 'error') return null;
            return <rect key={key} x={xa} y={y + barH - 3} width={Math.max(1, w)} height={4} rx={1} fill="none" stroke={s.kind === 'retry' ? SIG.err : s.color} strokeOpacity={0.55} strokeDasharray="3 2" />;
          }
          const future = staticWf && ext.s > now + 1e-6;
          const op = staticWf ? (future ? 0.38 : 0.95) : 0.92;
          if (s.kind === 'skip') return null;
          if (s.kind === 'cache') w = Math.max(3, w);
          if (s.kind === 'error') {
            return (
              <g key={key} transform={`translate(${xa + 4},${y + barH / 2})`} stroke={SIG.err} strokeWidth={1.8} strokeLinecap="round">
                <line x1={-3.5} y1={-3.5} x2={3.5} y2={3.5} />
                <line x1={-3.5} y1={3.5} x2={3.5} y2={-3.5} />
              </g>
            );
          }
          if (s.kind === 'retry' || s.kind === 'blocked') {
            const c = s.kind === 'retry' ? SIG.err : SIG.line;
            return (
              <g key={key} opacity={staticWf && future ? 0.5 : 1}>
                <rect x={xa} y={y} width={w} height={barH} rx={2} fill={s.kind === 'retry' ? 'url(#kit-hatch)' : 'url(#kit-hatch-dim)'} />
                <rect x={xa} y={y} width={w} height={barH} rx={2} fill="none" stroke={c} strokeOpacity={0.55} />
              </g>
            );
          }
          return <rect key={key} x={xa} y={y} width={w} height={barH} rx={2} fill={s.color} opacity={s.kind === 'cache' ? 0.55 : op} />;
        });
    });

  // Duration / status labels at the end of each row.
  const labels = ROWS.map((row, i) => {
    const info = rowInfo(j.segs, row.id);
    if (!info) return null;
    const done = staticWf || sim.reached(info.end);
    const started = staticWf || info.list.some((s) => s.start < now - 1e-9 || (s.end === s.start && sim.reached(s.start)));
    const y = rowY(i) + wf.rowH / 2 + 3.2;
    const fill = SIG.text2;
    if (info.kind === 'skip') {
      if (!started) return null;
      return (
        <text key={row.id} x={X(info.start) + 4} y={y} style={{ fontFamily: MONO, fontSize: fs, fill: SIG.res, ...HALO }}>
          reused · 0 ms
        </text>
      );
    }
    if (!done) return null;
    let txt = fmtMs(info.dur);
    let color: string = fill;
    if (info.kind === 'cache') {
      txt = row.id === 'dns' ? 'cached · 0 ms' : `disk cache · ${Math.round(info.dur)} ms`;
      color = SIG.res;
    }
    if (info.hasErr) {
      txt = 'rejected';
      color = SIG.err;
    }
    if (portrait && info.kind === 'cache') txt = row.id === 'dns' ? 'cached' : 'cache';
    return (
      <text key={row.id} x={X(info.end) + (info.hasErr ? 12 : 5)} y={y} style={{ fontFamily: MONO, fontSize: fs, fill: color, fontVariantNumeric: 'tabular-nums', ...HALO }}>
        {txt}
      </text>
    );
  });

  // Vertical marks (TTFB, first paint) with their labels in the footer strip.
  const m = j.marks;
  const marks: { t: number; color: string; text: string; dashed: boolean }[] = [];
  if (ghost && Number.isFinite(ghost.marks.fcp)) marks.push({ t: ghost.marks.fcp, color: 'rgba(255,126,182,0.6)', text: portrait ? `1st visit ${Math.round(ghost.marks.fcp)}` : `first visit ${Math.round(ghost.marks.fcp)} ms`, dashed: true });
  if (Number.isFinite(m.ttfb) && (staticWf || sim.reached(m.ttfb))) marks.push({ t: m.ttfb, color: PH.res, text: portrait ? `TTFB ${Math.round(m.ttfb)}` : `TTFB ${Math.round(m.ttfb)} ms`, dashed: true });
  if (Number.isFinite(m.fcp) && (staticWf || sim.reached(m.fcp))) marks.push({ t: m.fcp, color: PH.render, text: portrait ? `paint ${Math.round(m.fcp)}` : `first paint ${Math.round(m.fcp)} ms`, dashed: false });
  marks.sort((a, b2) => a.t - b2.t);
  const charW = (fs - 0.5) * 0.6;
  let lastEnd = -Infinity;
  const markEls = marks.map((mk) => {
    const x = X(mk.t);
    const w = mk.text.length * charW;
    let lx = Math.max(x + 3, lastEnd + 8);
    if (lx + w > wf.x + wf.w - 6) lx = wf.x + wf.w - 6 - w;
    lastEnd = lx + w;
    return (
      <g key={mk.text}>
        <line x1={x} y1={wf.y + wf.head - 4} x2={x} y2={rowsBottom + 2} stroke={mk.color} strokeOpacity={0.75} strokeDasharray={mk.dashed ? '3 3' : undefined} />
        <text x={lx} y={wf.y + wf.h - 6} style={{ fontFamily: MONO, fontSize: fs - 0.5, fill: mk.color }}>
          {mk.text}
        </text>
      </g>
    );
  });

  const hl = new Set(highlight ?? []);
  const cursorX = X(Math.min(now, sim.axis));
  const showCursor = !(sim.sc.idle && now <= 0);

  return (
    <g>
      <rect x={wf.x} y={wf.y} width={wf.w} height={wf.h} rx={10} fill="rgba(7,11,20,0.78)" stroke="rgba(143,166,201,0.22)" />
      {glow && <rect x={wf.x - 5} y={wf.y - 5} width={wf.w + 10} height={wf.h + 10} rx={13} fill="none" stroke="var(--accent)" strokeWidth={1.4} strokeDasharray="3 3" />}
      <text className={kit.caps} x={wf.x + 10} y={wf.y + 15} style={{ fill: '#cdbdff', fontSize: portrait ? 8 : 9 }}>
        {portrait ? 'waterfall' : 'waterfall · ms'}
      </text>
      {ticks.map((v) => (
        <g key={v}>
          <line x1={X(v)} y1={wf.y + wf.head - 4} x2={X(v)} y2={bottom} stroke="rgba(143,166,201,0.09)" />
          {(!portrait || v % (step * 2) === 0) && (
            <text x={X(v)} y={wf.y + 15} textAnchor="middle" style={{ fontFamily: MONO, fontSize: fs - 0.5, fill: SIG.dim }}>
              {v}
            </text>
          )}
        </g>
      ))}
      {ROWS.map((row, i) => {
        const on = hl.has(row.id);
        const info = rowInfo(j.segs, row.id);
        const started = !!info && (staticWf || info.list.some((s) => s.start < now - 1e-9 || (s.end === s.start && sim.reached(s.start))));
        return (
          <g key={row.id}>
            {on && <rect x={wf.x + 4} y={rowY(i)} width={wf.w - 8} height={wf.rowH} rx={4} fill="rgba(255,210,63,0.09)" />}
            <text
              x={wf.x + 10}
              y={rowY(i) + wf.rowH / 2 + 3.2}
              style={{ fontFamily: MONO, fontSize: fs, fill: on ? 'var(--accent)' : started ? SIG.text : SIG.dim }}
            >
              {portrait ? row.short : row.label}
            </text>
          </g>
        );
      })}
      {ghost && bars(ghost, true)}
      {bars(j, false)}
      {markEls}
      {labels}
      {showCursor && (
        <g>
          <line x1={cursorX} y1={wf.y + wf.head - 6} x2={cursorX} y2={bottom} stroke="rgba(255,210,63,0.75)" strokeWidth={1.2} />
          <path d={`M${cursorX - 4},${wf.y + wf.head - 9} L${cursorX + 4},${wf.y + wf.head - 9} L${cursorX},${wf.y + wf.head - 4} Z`} fill="var(--accent)" />
        </g>
      )}
    </g>
  );
}
