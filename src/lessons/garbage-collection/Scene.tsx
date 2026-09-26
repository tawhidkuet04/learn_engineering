'use client';

import type { ReactNode } from 'react';
import { Effects, Flights } from '@/components/stage/svg';
import { SIG } from '@/lib/sim/colors';
import type { Curve } from '@/lib/sim/geometry';
import { ZONE_CELLS, type GenObj, type Zone } from './gen';
import { BLOCK_BYTES, HEAP_BLOCKS, addrHex, bezierMid, type GEdge, type GObj, type GRoot, type GcSim, type Strip } from './sim';
import { LANES, MS_PER_S, type Seg } from './threads';
import css from './gc.module.css';

const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(' ');
const f1 = (n: number) => n.toFixed(1);
const LINE = 'rgba(143,166,201,0.55)';

export interface SceneProps {
  sim: GcSim;
  /** Hovered narration term */
  highlight: string | null;
  /** Ids kept bright; everything else dims */
  focus?: string[];
}

export function GcScene({ sim, highlight, focus }: SceneProps) {
  const v = sim.cfg.view;
  if (v === 'gen') return <GenView sim={sim} highlight={highlight} />;
  if (v === 'threads') return <ThreadsView sim={sim} highlight={highlight} />;
  if (v === 'heap') return <HeapView sim={sim} highlight={highlight} />;
  return <GraphView sim={sim} highlight={highlight} focus={focus} />;
}

/* ================================================================== */
/* Graph view: roots, objects, references, heap strip                 */
/* ================================================================== */

function dimmed(focus: string[] | undefined, id: string) {
  return !!focus?.length && !focus.includes(id);
}

function GraphView({ sim, highlight, focus }: SceneProps) {
  const g = sim.g;
  return (
    <g>
      {sim.cfg.view === 'split' && <SplitFrames sim={sim} />}
      <RootPanels sim={sim} />
      {sim.g.chart && <LeakChart sim={sim} />}
      <Edges sim={sim} focus={focus} highlight={highlight} />
      {[...sim.roots.values()].map((r) => (
        <RootSlot key={r.id} sim={sim} r={r} glow={highlight === `r:${r.id}`} dim={dimmed(focus, `r:${r.id}`)} />
      ))}
      {[...sim.objs.values()].map((o) => (
        <ObjCard key={o.id} sim={sim} o={o} glow={highlight === `o:${o.id}`} dim={dimmed(focus, `o:${o.id}`)} />
      ))}
      <Flights sim={sim} />
      <Effects sim={sim} />
      {g.strip && <HeapStrip sim={sim} s={g.strip} glow={highlight === 'heap'} />}
    </g>
  );
}

/* ---------- roots ---------- */

const SECTION_TITLE: Record<GRoot['section'], string> = { stack: 'stack', globals: 'globals', registers: 'registers' };

function sectionLabel(r: GRoot) {
  return r.section === 'stack' && r.frame ? `stack · ${r.frame}()` : SECTION_TITLE[r.section];
}

function RootPanels({ sim }: { sim: GcSim }) {
  const panes = sim.cfg.view === 'split' ? [0, 1] : [0];
  const land = sim.g.land;
  const bare = sim.cfg.view === 'split' && !land;
  return (
    <g>
      {panes.map((pane) => {
        const roots = [...sim.roots.values()].filter((r) => r.pane === pane);
        const boxes = roots.map((r) => sim.boxes.get(`r:${r.id}`)).filter((b): b is NonNullable<typeof b> => !!b && !Number.isNaN(b.x));
        if (!boxes.length) return null;
        const alpha = Math.max(...boxes.map((b) => b.alpha));
        const x0 = Math.min(...boxes.map((b) => b.x - b.w / 2)) - (land ? 12 : 8);
        const x1 = Math.max(...boxes.map((b) => b.x + b.w / 2)) + (land ? 12 : 8);
        const y0 = Math.min(...boxes.map((b) => b.y - b.h / 2)) - (bare ? 8 : land ? 44 : 30);
        const y1 = Math.max(...boxes.map((b) => b.y + b.h / 2)) + (land ? 12 : 8);
        // Section labels: above the first slot of each section.
        const firsts: { r: GRoot; x: number; y: number }[] = [];
        const seen = new Set<string>();
        const ordered = roots
          .map((r) => ({ r, b: sim.boxes.get(`r:${r.id}`) }))
          .filter((x) => x.b && !Number.isNaN(x.b.x))
          .sort((a, b) => (land ? (a.b as { y: number }).y - (b.b as { y: number }).y : (a.b as { x: number }).x - (b.b as { x: number }).x));
        for (const { r, b } of ordered) {
          const key = sectionLabel(r);
          if (seen.has(key) || !b) continue;
          seen.add(key);
          firsts.push({ r, x: b.x - b.w / 2, y: b.y - b.h / 2 - 7 });
        }
        return (
          <g key={pane} opacity={alpha}>
            <rect className={css.rootPanel} x={x0} y={y0} width={x1 - x0} height={y1 - y0} rx={10} />
            {land && (
              <text className={css.caps} x={x0 + 12} y={y0 + 15} style={{ fill: 'var(--accent)' }}>
                roots
              </text>
            )}
            {!bare &&
              firsts.map(({ r, x, y }) => (
                <text key={r.id} className={css.caps} x={x} y={y}>
                  {sectionLabel(r)}
                </text>
              ))}
          </g>
        );
      })}
    </g>
  );
}

function RootSlot({ sim, r, glow, dim }: { sim: GcSim; r: GRoot; glow: boolean; dim: boolean }) {
  const b = sim.boxes.get(`r:${r.id}`);
  if (!b || Number.isNaN(b.x)) return null;
  const e = sim.rootEdge(r.id);
  const land = sim.g.land;
  const selected = sim.pg.selected === `r:${r.id}`;
  const clickable = sim.cfg.scene === 'pg';
  const target = e ? sim.obj(e.to) : undefined;
  const cMode = sim.cfg.scene === 'manual';
  let value: ReactNode = null;
  if (cMode) {
    const addr = target && target.addr >= 0 ? addrHex(target.addr) : target?.lastAddr != null ? addrHex(target.lastAddr) : 'NULL';
    value = (
      <text className={css.slotValue} x={b.w - (land ? 14 : 10)} y={b.h / 2 + 3.5} textAnchor="end" style={{ fill: e?.dangling ? SIG.err : e ? 'var(--text-2)' : 'var(--text-3)' }}>
        {addr}
      </text>
    );
  } else if (!e) {
    value = (
      <text className={css.slotValue} x={b.w - (land ? 12 : 8)} y={b.h / 2 + 3.5} textAnchor="end">
        null
      </text>
    );
  }
  const narrow = b.w < 70;
  return (
    <g
      className={cx(css.node, clickable && css.clickable)}
      transform={`translate(${b.x - b.w / 2},${b.y - b.h / 2})`}
      opacity={b.alpha * (dim ? 0.3 : 1)}
      onClick={clickable ? () => sim.clickRoot(r.id) : undefined}
      role={clickable ? 'button' : undefined}
      aria-label={clickable ? `Root ${r.label}` : undefined}
    >
      {clickable && <rect x={-6} y={-6} width={b.w + 12} height={b.h + 12} fill="transparent" />}
      {(glow || selected) && (
        <rect x={-5} y={-5} width={b.w + 10} height={b.h + 10} rx={9} fill="none" stroke="var(--accent)" strokeWidth={1.4} strokeDasharray={selected ? undefined : '3 3'} />
      )}
      <rect className={css.slot} width={b.w} height={b.h} rx={6} />
      <text className={css.slotName} x={narrow ? 7 : 10} y={b.h / 2 + 4} style={narrow ? { fontSize: 10.5 } : undefined}>
        {r.label}
      </text>
      {value}
      {e && !cMode && (
        <circle cx={land ? b.w : b.w / 2} cy={land ? b.h / 2 : b.h} r={3.4} fill={e.dangling ? SIG.err : SIG.text2} />
      )}
      {e && cMode && <circle cx={land ? b.w : b.w / 2} cy={land ? b.h / 2 : b.h} r={3.4} fill={e.dangling ? SIG.err : SIG.text2} />}
    </g>
  );
}

/* ---------- references ---------- */

function arrowHead(c: Curve, size = 7) {
  const dx = c.p3.x - c.p2.x;
  const dy = c.p3.y - c.p2.y;
  const a = Math.atan2(dy, dx);
  const p = (ang: number) => `${f1(c.p3.x - size * Math.cos(a + ang))},${f1(c.p3.y - size * Math.sin(a + ang))}`;
  return `M${p(0.42)} L${f1(c.p3.x)},${f1(c.p3.y)} L${p(-0.42)} Z`;
}

function curveD(c: Curve) {
  return `M${f1(c.p0.x)},${f1(c.p0.y)} C${f1(c.p1.x)},${f1(c.p1.y)} ${f1(c.p2.x)},${f1(c.p2.y)} ${f1(c.p3.x)},${f1(c.p3.y)}`;
}

function edgeTone(sim: GcSim, e: GEdge) {
  const a = sim.obj(e.from);
  const b = sim.obj(e.to);
  if (e.dangling) return { stroke: SIG.err, dash: '4 4', fade: 1 };
  if (e.weak) return { stroke: SIG.hc, dash: '3 4', fade: 1 };
  const bad = (o?: GObj) => o && (o.fate === 'garbage' || o.fate === 'leaked' || o.fate === 'freed');
  if (bad(a) || (!a && bad(b) && e.removing)) return { stroke: 'rgba(255,77,106,0.55)', dash: undefined, fade: 0.8 };
  return { stroke: LINE, dash: undefined, fade: 1 };
}

function Edges({ sim, focus, highlight }: { sim: GcSim; focus?: string[]; highlight: string | null }) {
  const pending = sim.game?.pending && sim.askKind === 'edge';
  return (
    <g>
      {[...sim.edges.values()].map((e) => {
        if (e.alpha < 0.01) return null;
        const c = sim.curveOf(e);
        if (!c) return null;
        const d = curveD(c);
        const tone = edgeTone(sim, e);
        const clickable = sim.edgeClickable(e);
        const flash = Math.max(0, 1 - (sim.vt - e.flashVt) / 0.9);
        const dim = !!focus?.length && !(focus.includes(e.from) || focus.includes(e.to));
        const hot = highlight === e.id;
        const mid = e.weak ? bezierMid(c) : null;
        return (
          <g
            key={e.id}
            className={cx(css.edge, clickable && css.edgeClickable, clickable && (pending || sim.cfg.cut !== 'off') && css.edgeInvite)}
            opacity={e.alpha * tone.fade * (dim ? 0.3 : 1)}
            onClick={clickable ? () => sim.clickEdge(e.id) : undefined}
            role={clickable ? 'button' : undefined}
            aria-label={clickable ? `Reference ${sim.labelOf(e.from)} to ${sim.labelOf(e.to)}` : undefined}
          >
            {clickable && <path d={d} className={css.edgeHit} />}
            <path d={d} className={css.edgeLine} stroke={hot ? 'var(--accent)' : tone.stroke} strokeDasharray={tone.dash} />
            <path d={arrowHead(c)} className={css.edgeHead} fill={hot ? 'var(--accent)' : tone.stroke} />
            {flash > 0.01 && <path d={d} fill="none" stroke={e.flashColor} strokeWidth={2.6} strokeLinecap="round" opacity={flash * 0.85} />}
            {mid && (
              <text className={css.weakTag} x={mid.x} y={mid.y - 6} textAnchor="middle">
                weak
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}

/* ---------- objects ---------- */

function KindGlyph({ kind, x, y, color }: { kind: GObj['kind']; x: number; y: number; color: string }) {
  const t = (s: string) => (
    <text className={css.glyph} x={x} y={y + 3.6} textAnchor="middle" fill={color}>
      {s}
    </text>
  );
  switch (kind) {
    case 'arr':
      return t('[ ]');
    case 'fn':
      return t('ƒ');
    case 'dom':
      return t('<>');
    case 'str':
      return t('" "');
    case 'raw':
      return t('*');
    case 'img':
      return (
        <g transform={`translate(${x - 6},${y - 5})`} stroke={color} strokeWidth={1.1} fill="none" strokeLinejoin="round">
          <rect width={12} height={10} rx={1.5} />
          <path d="M1.5,8.5 L4.8,5 L7,7 L8.6,5.6 L10.5,8.5" />
        </g>
      );
    default:
      return t('{ }');
  }
}

function ObjCard({ sim, o, glow, dim }: { sim: GcSim; o: GObj; glow: boolean; dim: boolean }) {
  const b = sim.boxes.get(`o:${o.id}`);
  if (!b || Number.isNaN(b.x)) return null;
  const land = sim.g.land;
  const pending = sim.game?.pending;
  const pickable = !!pending && (sim.askKind === 'obj' || sim.askKind === 'mixed') && o.fate === 'live';
  const clickable = sim.objClickable(o);
  const selected = sim.pg.selected === `o:${o.id}`;
  const linkTarget = sim.pg.linking && !selected && o.fate !== 'freed';
  const marked = o.mark === 'black';
  const gray = o.mark === 'gray';
  const scanning = sim.scanning === o.id;
  const bad = o.fate === 'garbage' || o.fate === 'leaked';
  const ghost = o.fate === 'ghost';
  const freed = o.fate === 'freed';
  const stroke = freed ? SIG.err : bad ? SIG.err : ghost ? SIG.heavy : marked ? SIG.res : gray ? SIG.warn : o.fate === 'live' && sim.crashed ? SIG.dim : LINE;
  const fill = marked ? 'rgba(75,227,160,0.09)' : bad ? 'rgba(255,77,106,0.06)' : 'var(--node-fill)';
  const rcOn = sim.rcOn[o.pane] || (sim.cfg.scene === 'pg' && sim.pg.mode === 'rc');
  const pulse = Math.max(0, 1 - (sim.vt - o.pulse) / 0.6);
  const fs = land ? 11.5 : 10.5;
  const gx = land ? 15 : 12;
  const tx = land ? 29 : 23;
  const hasSub = !!o.sub && b.h >= 30 && tx + o.sub.length * 5.5 <= b.w - 4;
  const roomForCheck = tx + o.label.length * fs * 0.6 <= b.w - 19;
  const labelY = hasSub ? b.h / 2 - 1.5 : b.h / 2 + 4;
  return (
    <g
      className={cx(css.node, clickable && css.clickable, pickable && css.pickable)}
      transform={`translate(${b.x - b.w / 2},${b.y - b.h / 2})`}
      opacity={b.alpha * (dim ? 0.3 : 1) * (ghost ? 0.75 : 1) * (sim.crashed ? 0.55 : 1)}
      onClick={clickable ? () => sim.clickObj(o.id) : undefined}
      role={clickable ? 'button' : undefined}
      aria-label={clickable ? `Object ${o.label}` : undefined}
    >
      {clickable && <rect x={-7} y={-7} width={b.w + 14} height={b.h + 14} fill="transparent" />}
      {(glow || selected || linkTarget) && (
        <rect
          x={-5}
          y={-5}
          width={b.w + 10}
          height={b.h + 10}
          rx={11}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={1.4}
          strokeDasharray={selected ? undefined : '3 3'}
          opacity={linkTarget ? 0.7 : 1}
        />
      )}
      {scanning && <rect x={-4} y={-4} width={b.w + 8} height={b.h + 8} rx={10} fill="none" stroke={SIG.res} strokeWidth={2} opacity={0.5} />}
      <rect className={css.objCard} width={b.w} height={b.h} rx={8} style={{ stroke, fill }} strokeDasharray={gray || ghost || o.fate === 'leaked' ? '4 3' : undefined} />
      {(bad || freed) && <rect width={b.w} height={b.h} rx={8} fill="url(#kit-hatch)" pointerEvents="none" opacity={freed ? 0.5 : 0.8} />}
      <KindGlyph kind={o.kind} x={gx} y={b.h / 2} color={marked ? SIG.res : bad ? SIG.err : 'var(--text-3)'} />
      <text className={css.objLabel} x={tx} y={labelY} style={{ fontSize: fs, fill: ghost ? 'var(--text-3)' : undefined }}>
        {o.label}
      </text>
      {hasSub && (
        <text className={css.objSub} x={tx} y={b.h / 2 + 10}>
          {o.sub}
        </text>
      )}
      {marked && !rcOn && roomForCheck && (
        <path d={`M${b.w - 15},${b.h / 2} l3.5,3.5 l6.5,-7`} fill="none" stroke={SIG.res} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
      )}
      {rcOn && o.fate !== 'freed' && (
        <g transform={`translate(${b.w - 1},1)`}>
          <circle r={9.5 + pulse * 3} className={css.rcBadge} style={{ stroke: o.rc === 0 ? SIG.err : SIG.hc }} />
          <text className={css.rcText} y={3.8} textAnchor="middle" style={{ fill: o.rc === 0 ? SIG.err : '#d9ccff' }}>
            {o.rc}
          </text>
        </g>
      )}
      {o.gcRefs != null && (
        <g transform={`translate(${b.w / 2},${b.h + 2})`}>
          <rect x={-30} y={0} width={60} height={15} rx={7.5} className={css.gcRefs} style={{ stroke: o.gcRefs > 0 ? SIG.res : SIG.hc }} />
          <text className={css.gcRefsText} y={10.5} textAnchor="middle" style={{ fill: o.gcRefs > 0 ? SIG.res : '#d9ccff' }}>
            gc_refs {o.gcRefs}
          </text>
        </g>
      )}
      {o.tag && o.gcRefs == null && (
        <text className={css.tag} x={b.w / 2} y={b.h + 13} textAnchor="middle" style={{ fill: o.tag.color }}>
          {o.tag.text}
        </text>
      )}
    </g>
  );
}

/* ---------- split view frames ---------- */

function SplitFrames({ sim }: { sim: GcSim }) {
  const titles = ['Reference counting', 'Mark & sweep'];
  const subs = ['frees when a count hits 0', 'traces from the roots'];
  return (
    <g>
      {sim.g.panes.map((p, i) => (
        <g key={i}>
          <rect className={css.pane} x={p.x} y={p.y} width={p.w} height={p.h} rx={12} />
          <text className={css.paneTitle} x={p.x + 16} y={p.y + 24} style={sim.g.land ? undefined : { fontSize: 16 }}>
            {titles[i]}
          </text>
          {sim.g.land && (
            <text className={css.caps} x={p.x + p.w - 14} y={p.y + 22} textAnchor="end">
              {subs[i]}
            </text>
          )}
        </g>
      ))}
    </g>
  );
}

/* ---------- heap strip under the graph ---------- */

function segments(addr: number, size: number, s: Strip) {
  const out: { x: number; y: number; w: number; row: number }[] = [];
  let a = addr;
  let left = size;
  while (left > 0) {
    const row = Math.floor(a / s.cols);
    const col = a % s.cols;
    const n = Math.min(left, s.cols - col);
    out.push({ x: s.x + col * s.cw, y: s.y + row * (s.ch + s.rowGap), w: n * s.cw, row });
    a += n;
    left -= n;
  }
  return out;
}

function blockTone(o: GObj) {
  if (o.fate === 'garbage') return { fill: 'rgba(255,77,106,0.1)', stroke: 'rgba(255,77,106,0.75)', hatch: true, text: '#ff9aab' };
  if (o.fate === 'leaked') return { fill: 'rgba(255,77,106,0.1)', stroke: 'rgba(255,77,106,0.75)', hatch: true, text: '#ff9aab' };
  if (o.mark === 'black') return { fill: 'rgba(75,227,160,0.16)', stroke: 'rgba(75,227,160,0.8)', hatch: false, text: '#b6f7da' };
  if (o.mark === 'gray') return { fill: 'rgba(255,210,63,0.1)', stroke: 'rgba(255,210,63,0.7)', hatch: false, text: 'var(--text-1)' };
  return { fill: 'rgba(143,166,201,0.14)', stroke: 'rgba(143,166,201,0.55)', hatch: false, text: 'var(--text-1)' };
}

function HeapStrip({ sim, s, glow }: { sim: GcSim; s: Strip; glow: boolean }) {
  const blocks = sim.heapObjs();
  const used = blocks.reduce((n, o) => n + o.size, 0);
  const W = s.cols * s.cw;
  const H = s.rows * s.ch + (s.rows - 1) * s.rowGap;
  const land = sim.g.land;
  const ticks = land ? [0, 6, 12, 18, 24] : [0, 6, 12];
  return (
    <g>
      {glow && <rect x={s.x - 6} y={s.y - 24} width={W + 12} height={H + 44} rx={8} fill="none" stroke="var(--accent)" strokeDasharray="3 3" strokeWidth={1.3} />}
      <text className={css.caps} x={s.x} y={s.y - 9}>
        heap · {HEAP_BLOCKS} blocks × {BLOCK_BYTES} B
      </text>
      <text className={css.caps} x={s.x + W} y={s.y - 9} textAnchor="end">
        <tspan style={{ fill: 'var(--text-2)' }}>{used}</tspan> used · <tspan style={{ fill: 'var(--text-2)' }}>{HEAP_BLOCKS - used}</tspan> free
      </text>
      {Array.from({ length: HEAP_BLOCKS }, (_, i) => {
        const row = Math.floor(i / s.cols);
        const col = i % s.cols;
        return <rect key={i} className={css.cell} x={s.x + col * s.cw + 1} y={s.y + row * (s.ch + s.rowGap)} width={s.cw - 2} height={s.ch} rx={2} />;
      })}
      {blocks.map((o) => {
        const tone = blockTone(o);
        return segments(o.addr, o.size, s).map((seg, i) => {
          const cw = land ? 6.2 : 5.4;
          const room = Math.floor((seg.w - 6) / cw);
          const text = o.label.length <= room ? o.label : room >= 3 ? `${o.label.slice(0, room - 1)}…` : '';
          const showLabel = !!text;
          return (
            <g key={`${o.id}-${i}`}>
              <rect x={seg.x + 1} y={seg.y} width={seg.w - 2} height={s.ch} rx={3} fill={tone.fill} stroke={tone.stroke} strokeWidth={1} />
              {tone.hatch && <rect x={seg.x + 1} y={seg.y} width={seg.w - 2} height={s.ch} rx={3} fill="url(#kit-hatch)" />}
              {showLabel && (
                <text className={css.blockLabel} x={seg.x + seg.w / 2} y={seg.y + s.ch / 2 + 3.5} textAnchor="middle" style={{ fill: tone.text, fontSize: land ? 10 : 8.5 }}>
                  {text}
                </text>
              )}
            </g>
          );
        });
      })}
      {sim.heapFx.map((fx, i) => {
        const k = Math.min(1, (sim.vt - fx.vt) / 1.1);
        return segments(fx.addr, fx.size, s).map((seg, j) => (
          <rect key={`fx${i}-${j}`} x={seg.x + 1} y={seg.y - 1} width={seg.w - 2} height={s.ch + 2} rx={3} fill="none" stroke={fx.color} strokeWidth={2} opacity={(1 - k) * 0.9} />
        ));
      })}
      {sim.sweepAt != null && <SweepCursor s={s} at={sim.sweepAt} />}
      {ticks.map((t) => {
        const last = s.rows - 1;
        const a = land ? t : last * s.cols + t;
        const col = t;
        return (
          <text key={t} className={css.addr} x={s.x + col * s.cw} y={s.y + last * (s.ch + s.rowGap) + s.ch + 12} textAnchor={col === 0 ? 'start' : col === s.cols ? 'end' : 'middle'}>
            {addrHex(a)}
          </text>
        );
      })}
    </g>
  );
}

function SweepCursor({ s, at }: { s: Strip; at: number }) {
  const a = Math.min(at, HEAP_BLOCKS - 0.001);
  const row = Math.floor(a / s.cols);
  const x = s.x + (a % s.cols) * s.cw;
  const y = s.y + row * (s.ch + s.rowGap);
  return (
    <g>
      <line x1={x} y1={y - 6} x2={x} y2={y + s.ch + 6} stroke={SIG.warn} strokeWidth={2} />
      <path d={`M${x - 5},${y - 12} L${x + 5},${y - 12} L${x},${y - 5} Z`} fill={SIG.warn} />
    </g>
  );
}

/* ---------- leak chart ---------- */

function LeakChart({ sim }: { sim: GcSim }) {
  const c = sim.g.chart;
  if (!c) return null;
  const vals = sim.memSeries;
  const max = Math.max(30, ...vals);
  const pad = 14;
  const iw = c.w - pad * 2;
  const ih = c.h - 44;
  const bw = Math.min(22, iw / Math.max(6, vals.length) - 6);
  const last = vals[vals.length - 1] ?? 0;
  return (
    <g>
      <rect className={css.chartFrame} x={c.x} y={c.y} width={c.w} height={c.h} rx={10} />
      <text className={css.caps} x={c.x + pad} y={c.y + 18} style={{ fill: '#cdbdff' }}>
        heap after each gc
      </text>
      <text className={css.chartValue} x={c.x + c.w - pad} y={c.y + 19} textAnchor="end" style={{ fill: last > 12 ? SIG.err : SIG.res }}>
        {last} MB
      </text>
      <line x1={c.x + pad} y1={c.y + 30 + ih} x2={c.x + c.w - pad} y2={c.y + 30 + ih} stroke="rgba(143,166,201,0.3)" />
      {vals.map((v, i) => {
        const h = (v / max) * ih;
        const x = c.x + pad + 4 + i * (bw + 6);
        return <rect key={i} x={x} y={c.y + 30 + ih - h} width={bw} height={h} rx={2} fill={v > 12 ? 'rgba(255,77,106,0.55)' : 'rgba(75,227,160,0.55)'} />;
      })}
    </g>
  );
}

/* ================================================================== */
/* Heap view: memory as blocks                                        */
/* ================================================================== */

function HeapView({ sim, highlight }: { sim: GcSim; highlight: string | null }) {
  const s = sim.g.strip;
  if (!s) return null;
  const land = sim.g.land;
  const copy = sim.g.copyRows;
  const W = s.cols * s.cw;
  const rowY = (r: number) => s.y + r * (s.ch + s.rowGap);
  const fromRow = sim.fromLow ? 0 : 1;
  return (
    <g>
      {Array.from({ length: s.rows }, (_, r) => (
        <g key={r}>
          {copy && (
            <text className={css.spaceLabel} x={r === 1 ? s.x + W : s.x} y={rowY(r) - 12} textAnchor={r === 1 ? 'end' : 'start'} style={{ fill: r === fromRow ? 'var(--text-2)' : SIG.res }}>
              {r === fromRow ? 'from-space' : 'to-space'}{' '}
              <tspan style={{ fill: 'var(--text-3)', textTransform: 'none', letterSpacing: '0.04em' }}>
                · {addrHex(r * s.cols)}–{addrHex((r + 1) * s.cols - 1)}
                {land && sim.memo.copied && r !== fromRow ? ' · the old half, now free in one go' : ''}
              </tspan>
            </text>
          )}
          {!copy && r === 0 && land && (
            <text className={css.caps} x={s.x} y={rowY(0) - 196}>
              heap · {HEAP_BLOCKS} blocks × {BLOCK_BYTES} B
            </text>
          )}
        </g>
      ))}
      {highlight === 'heap' && <rect x={s.x - 8} y={s.y - 8} width={W + 16} height={s.rows * s.ch + (s.rows - 1) * s.rowGap + 16} rx={8} fill="none" stroke="var(--accent)" strokeDasharray="3 3" />}
      {Array.from({ length: HEAP_BLOCKS }, (_, i) => {
        const row = Math.floor(i / s.cols);
        const col = i % s.cols;
        return <rect key={i} className={css.cellBig} x={s.x + col * s.cw + 1.5} y={rowY(row)} width={s.cw - 3} height={s.ch} rx={3} />;
      })}
      {Array.from({ length: s.rows }, (_, r) =>
        [0, 3, 6, 9, 12, 15, 18, 21, 24]
          .filter((t) => (land && !copy ? true : t <= s.cols && (t % 6 === 0 || t === s.cols)))
          .map((t) => {
            const a = r * s.cols + Math.min(t, s.cols);
            if (!land && !copy && t === s.cols && r === 0) return null;
            if (a > HEAP_BLOCKS) return null;
            const col = Math.min(t, s.cols);
            return (
              <text key={`${r}-${t}`} className={css.addr} x={s.x + col * s.cw} y={rowY(r) + s.ch + 13} textAnchor={col === 0 ? 'start' : col === s.cols ? 'end' : 'middle'}>
                {addrHex(a)}
              </text>
            );
          }),
      )}
      {sim.scan && <ScanBox s={s} scan={sim.scan} />}
      {sim.ghosts.map((gh, i) => {
        const segs = segments(gh.addr, gh.size, s);
        return segs.map((seg, j) => (
          <g key={`gh${i}-${j}`}>
            <rect x={seg.x + 1.5} y={seg.y} width={seg.w - 3} height={s.ch} rx={3} fill="url(#kit-hatch-dim)" stroke="rgba(143,166,201,0.4)" strokeDasharray="3 3" />
            {j === 0 && seg.w > 40 && (
              <text className={css.blockSub} x={seg.x + seg.w / 2} y={seg.y + s.ch / 2 + 3.5} textAnchor="middle">
                → {addrHex(gh.to)}
              </text>
            )}
          </g>
        ));
      })}
      <Edges sim={sim} highlight={highlight} />
      {[...sim.roots.values()].map((r) => (
        <RootChip key={r.id} sim={sim} r={r} glow={highlight === `r:${r.id}`} />
      ))}
      {[...sim.objs.values()].map((o) => (
        <HeapBlock key={o.id} sim={sim} o={o} glow={highlight === `o:${o.id}`} />
      ))}
      {sim.heapFx.map((fx, i) => {
        const k = Math.min(1, (sim.vt - fx.vt) / 1.1);
        return segments(fx.addr, fx.size, s).map((seg, j) => (
          <rect key={`fx${i}-${j}`} x={seg.x + 1} y={seg.y - 2} width={seg.w - 2} height={s.ch + 4} rx={4} fill="none" stroke={fx.color} strokeWidth={2.2} opacity={(1 - k) * 0.9} />
        ));
      })}
      {sim.bump != null && <BumpMarker s={s} at={sim.bump} label={land} />}
      <Flights sim={sim} />
      <Effects sim={sim} />
    </g>
  );
}

function RootChip({ sim, r, glow }: { sim: GcSim; r: GRoot; glow: boolean }) {
  const b = sim.boxes.get(`r:${r.id}`);
  if (!b || Number.isNaN(b.x)) return null;
  return (
    <g transform={`translate(${b.x - b.w / 2},${b.y - b.h / 2})`} opacity={b.alpha}>
      {glow && <rect x={-5} y={-5} width={b.w + 10} height={b.h + 10} rx={9} fill="none" stroke="var(--accent)" strokeDasharray="3 3" />}
      <rect className={css.slot} width={b.w} height={b.h} rx={6} />
      <text className={css.slotName} x={b.w / 2} y={b.h / 2 + 4} textAnchor="middle">
        {r.label}
      </text>
    </g>
  );
}

function HeapBlock({ sim, o, glow }: { sim: GcSim; o: GObj; glow: boolean }) {
  const b = sim.boxes.get(`o:${o.id}`);
  if (!b || Number.isNaN(b.x)) return null;
  const tone = blockTone(o);
  const land = sim.g.land;
  const freed = o.fate === 'freed';
  const label = o.label;
  const fits = b.w - 6 > label.length * (land ? 6.6 : 5.6);
  const showSize = b.h >= 40 && b.w > 50;
  return (
    <g transform={`translate(${b.x - b.w / 2},${b.y - b.h / 2})`} opacity={b.alpha}>
      {glow && <rect x={-4} y={-4} width={b.w + 8} height={b.h + 8} rx={6} fill="none" stroke="var(--accent)" strokeDasharray="3 3" />}
      <rect width={b.w} height={b.h} rx={4} fill={freed ? 'rgba(255,77,106,0.12)' : tone.fill} stroke={freed ? SIG.err : tone.stroke} strokeWidth={1.2} />
      {(tone.hatch || freed) && <rect width={b.w} height={b.h} rx={4} fill="url(#kit-hatch)" />}
      {fits && (
        <text className={css.blockLabel} x={b.w / 2} y={showSize ? b.h / 2 - 1 : b.h / 2 + 3.5} textAnchor="middle" style={{ fill: tone.text, fontSize: land ? 11 : 9.5 }}>
          {label}
        </text>
      )}
      {fits && showSize && (
        <text className={css.blockSub} x={b.w / 2} y={b.h / 2 + 12} textAnchor="middle">
          {o.size * BLOCK_BYTES} B
        </text>
      )}
      {o.tag && (
        <text className={css.tag} x={b.w / 2} y={-6} textAnchor="middle" style={{ fill: o.tag.color }}>
          {o.tag.text}
        </text>
      )}
    </g>
  );
}

function ScanBox({ s, scan }: { s: Strip; scan: { addr: number; size: number; ok: boolean } }) {
  const segs = segments(scan.addr, scan.size, s);
  const color = scan.ok ? SIG.res : SIG.warn;
  return (
    <g>
      {segs.map((seg, i) => (
        <rect key={i} x={seg.x - 1} y={seg.y - 4} width={seg.w + 2} height={s.ch + 8} rx={5} fill={scan.ok ? 'rgba(75,227,160,0.08)' : 'rgba(255,210,63,0.06)'} stroke={color} strokeWidth={1.8} />
      ))}
      <text className={css.scanLabel} x={segs[0].x + segs[0].w / 2} y={segs[0].y + s.ch + 26} textAnchor="middle" style={{ fill: color }}>
        {scan.size} {scan.size === 1 ? 'block' : 'blocks'} {scan.ok ? '✓' : '✗'}
      </text>
    </g>
  );
}

function BumpMarker({ s, at, label }: { s: Strip; at: number; label: boolean }) {
  const a = Math.min(at, HEAP_BLOCKS);
  const row = Math.min(s.rows - 1, Math.floor(Math.min(a, HEAP_BLOCKS - 0.001) / s.cols));
  const col = a - row * s.cols;
  const x = s.x + col * s.cw;
  const y = s.y + row * (s.ch + s.rowGap);
  return (
    <g>
      <line x1={x} y1={y - 8} x2={x} y2={y + s.ch + 4} stroke={SIG.warn} strokeWidth={1.8} />
      <path d={`M${x},${y - 8} l-5,-8 h10 Z`} fill={SIG.warn} />
      {label && (
        <text className={css.scanLabel} x={x + 7} y={y - 10} style={{ fill: SIG.warn }}>
          bump
        </text>
      )}
    </g>
  );
}

/* ================================================================== */
/* Generational view                                                  */
/* ================================================================== */

function GenView({ sim, highlight }: { sim: GcSim; highlight: string | null }) {
  const g = sim.g;
  const gen = sim.gen;
  const land = g.land;
  const pause = gen.pause;
  const zoneGlow = (k: string) => highlight === k;
  const frame = (key: 'young' | 'old' | 'heap', title: string, sub: string, color: string) => {
    const r = g.frames[key];
    if (!r) return null;
    const active = pause && ((pause.kind === 'minor' && key === 'young') || (pause.kind === 'major' && key === 'old') || (pause.kind === 'full' && key === 'heap'));
    return (
      <g>
        <rect className={css.zone} x={r.x} y={r.y} width={r.w} height={r.h} rx={12} style={active ? { stroke: SIG.hc, strokeWidth: 1.6 } : undefined} />
        {zoneGlow(`zone:${key}`) && <rect x={r.x - 6} y={r.y - 6} width={r.w + 12} height={r.h + 12} rx={15} fill="none" stroke="var(--accent)" strokeDasharray="3 3" />}
        <text className={css.caps} x={r.x + (land ? 14 : 9)} y={r.y + (land ? 17 : 14)} style={{ fill: color }}>
          {title}
        </text>
        {land && (title.length + sub.length) * 7.6 + 44 < r.w && (
          <text className={css.caps} x={r.x + r.w - 14} y={r.y + 17} textAnchor="end">
            {sub}
          </text>
        )}
      </g>
    );
  };
  const cells = (z: Zone) => {
    const zg = g.zones[z];
    if (!zg) return null;
    return Array.from({ length: ZONE_CELLS[z] }, (_, i) => (
      <rect key={`${z}${i}`} className={css.genCell} x={zg.x + (i % zg.cols) * zg.pitch} y={zg.y + Math.floor(i / zg.cols) * zg.pitch} width={zg.cell} height={zg.cell} rx={3} />
    ));
  };
  const sub = (z: Zone, text: string) => {
    const zg = g.zones[z];
    if (!zg) return null;
    return (
      <text className={css.zoneSub} x={zg.x} y={zg.y - (land ? 7 : 5)} style={zoneGlow(`zone:${z}`) ? { fill: 'var(--accent)' } : undefined}>
        {text}
      </text>
    );
  };
  const usedTxt = (z: Zone) => `${gen.used(z)}/${ZONE_CELLS[z]}`;
  return (
    <g>
      {g.frames.young && frame('young', 'young generation', `minor GC when eden fills`, SIG.req)}
      {g.frames.old && frame('old', 'old generation', 'major GC when nearly full', SIG.hc)}
      {g.frames.heap && frame('heap', 'one heap, one generation', 'every GC traces it all', 'var(--text-2)')}
      {g.zones.eden && sub('eden', `eden · ${usedTxt('eden')}`)}
      {g.zones.surv && sub('surv', `survivor · ${usedTxt('surv')}`)}
      {g.zones.old && land && sub('old', `tenured · ${usedTxt('old')}`)}
      {g.zones.heap && sub('heap', `cells · ${usedTxt('heap')}`)}
      {cells('eden')}
      {cells('surv')}
      {cells('old')}
      {cells('heap')}
      {g.frames.young && g.frames.old && <PromoteArrow sim={sim} />}
      <GenRootBoxes sim={sim} highlight={highlight} />
      <GenLinks sim={sim} />
      {gen.objs.map((o) => (
        <GenCell key={o.id} sim={sim} o={o} />
      ))}
      <Flights sim={sim} labels={false} />
      <Effects sim={sim} />
      {g.chart && (land || !(sim.cfg.ro && !sim.cfg.generational)) && <PauseChart sim={sim} glow={highlight === 'chart'} />}
    </g>
  );
}

function PromoteArrow({ sim }: { sim: GcSim }) {
  const y = sim.g.frames.young;
  const o = sim.g.frames.old;
  if (!y || !o) return null;
  const land = sim.g.land;
  const x1 = y.x + y.w + 8;
  const x2 = o.x - 8;
  const cy = y.y + y.h * (land ? 0.62 : 0.66);
  return (
    <g>
      <line x1={x1} y1={cy} x2={x2 - 2} y2={cy} stroke={SIG.hc} strokeWidth={1.4} strokeDasharray="4 4" opacity={0.8} />
      <path d={`M${x2 - 8},${cy - 4.5} L${x2},${cy} L${x2 - 8},${cy + 4.5}`} fill="none" stroke={SIG.hc} strokeWidth={1.5} />
      {land && (
        <text className={css.caps} x={(x1 + x2) / 2} y={cy - 9} textAnchor="middle" style={{ fill: '#cdbdff' }}>
          promote
        </text>
      )}
      {land && (
        <text className={css.caps} x={(x1 + x2) / 2} y={cy + 17} textAnchor="middle">
          after {sim.gen.tenure} gcs
        </text>
      )}
    </g>
  );
}

function GenRootBoxes({ sim, highlight }: { sim: GcSim; highlight: string | null }) {
  const roots = sim.boxes.get('gen:roots');
  const rs = sim.boxes.get('gen:rs');
  const card = (b: typeof roots, title: string, sub: string, tone: string, key: string, count?: number) => {
    if (!b || Number.isNaN(b.x)) return null;
    return (
      <g transform={`translate(${b.x - b.w / 2},${b.y - b.h / 2})`} opacity={b.alpha}>
        {highlight === key && <rect x={-5} y={-5} width={b.w + 10} height={b.h + 10} rx={11} fill="none" stroke="var(--accent)" strokeDasharray="3 3" />}
        <rect className={css.slot} width={b.w} height={b.h} rx={8} style={{ stroke: tone }} />
        <text className={css.slotName} x={b.w / 2} y={sim.g.land ? b.h / 2 - 2 : b.h / 2 + 4} textAnchor="middle" style={{ fill: tone }}>
          {title}
          {count != null ? ` · ${count}` : ''}
        </text>
        {sim.g.land && (
          <text className={css.objSub} x={b.w / 2} y={b.h / 2 + 11} textAnchor="middle">
            {sub}
          </text>
        )}
      </g>
    );
  };
  return (
    <g>
      {card(roots, 'roots', 'stack · globals', 'var(--text-1)', 'gen:roots')}
      {card(rs, 'remembered set', `${sim.gen.remembered.length} old → young ${sim.gen.remembered.length === 1 ? 'ref' : 'refs'}`, SIG.hc, 'gen:rs')}
    </g>
  );
}

function GenLinks({ sim }: { sim: GcSim }) {
  return (
    <g>
      {sim.gen.links.map((l, i) => {
        const a = sim.boxes.get(l.from);
        const target = sim.gen.get(l.to);
        const b = sim.boxes.get(l.to);
        if (!a) return null;
        const lost = !!target?.lost;
        const bx = b ? b.x : a.x - 120;
        const by = b ? b.y : a.y;
        const remembered = sim.gen.remembered.some((r) => r.from === l.from && r.to === l.to);
        const x0 = a.x - a.w / 2;
        const x3 = bx + (b ? b.w / 2 + 3 : 0);
        const mx = (x0 + x3) / 2;
        const lift = sim.g.land ? 70 : 46;
        const d = `M${f1(x0)},${f1(a.y)} C${f1(mx + 20)},${f1(a.y - lift)} ${f1(mx - 20)},${f1(by - lift)} ${f1(x3)},${f1(by)}`;
        const color = lost ? SIG.err : remembered ? SIG.hc : LINE;
        return (
          <g key={i}>
            <path d={d} fill="none" stroke={color} strokeWidth={1.6} strokeDasharray={lost ? '4 4' : undefined} />
            <circle cx={x3} cy={by} r={3} fill={color} />
          </g>
        );
      })}
    </g>
  );
}

function GenCell({ sim, o }: { sim: GcSim; o: GenObj }) {
  const b = sim.boxes.get(o.id);
  if (!b || Number.isNaN(b.x)) return null;
  const old = o.zone === 'old';
  const stroke = o.lost ? SIG.err : o.dead ? 'rgba(255,77,106,0.6)' : o.label ? 'var(--accent)' : old ? 'rgba(181,155,255,0.75)' : 'rgba(69,213,255,0.7)';
  const fill = o.dead ? 'rgba(255,77,106,0.06)' : old ? 'rgba(181,155,255,0.16)' : 'rgba(69,213,255,0.14)';
  const land = sim.g.land;
  return (
    <g transform={`translate(${b.x - b.w / 2},${b.y - b.h / 2})`} opacity={b.alpha * (o.dead ? 0.75 : 1)}>
      <rect width={b.w} height={b.h} rx={4} fill={fill} stroke={stroke} strokeWidth={o.label ? 1.6 : 1.1} />
      {o.dead && <rect width={b.w} height={b.h} rx={4} fill="url(#kit-hatch)" />}
      {!o.dead && o.age > 0 && !old && (
        <g>
          {Array.from({ length: Math.min(3, o.age) }, (_, i) => (
            <circle key={i} cx={b.w / 2 + (i - (Math.min(3, o.age) - 1) / 2) * 6} cy={b.h - (land ? 6 : 4.5)} r={land ? 2 : 1.5} fill={SIG.res} />
          ))}
        </g>
      )}
      {o.label && (
        <text className={css.cellLabel} x={b.w / 2} y={-5} textAnchor="middle">
          {o.label}
        </text>
      )}
    </g>
  );
}

const NICE = [4, 6, 10, 16, 20, 30, 40, 60, 80, 100];

function PauseChart({ sim, glow }: { sim: GcSim; glow: boolean }) {
  const c = sim.g.chart;
  if (!c) return null;
  const land = sim.g.land;
  const window = 40;
  const now = sim.t;
  const evs = sim.gen.events.filter((e) => e.t >= now - window);
  const peak = Math.max(3, ...evs.map((e) => e.ms)) * 1.15;
  const maxMs = NICE.find((n) => n >= peak) ?? Math.ceil(peak / 20) * 20;
  const top = c.y + (land ? 24 : 18);
  const ih = c.h - (land ? 32 : 24);
  const x0 = c.x + (land ? 40 : 30);
  const x1 = c.x + c.w - 10;
  const xAt = (t: number) => x1 - ((now - t) / window) * (x1 - x0);
  const yAt = (ms: number) => top + ih - (ms / maxMs) * ih;
  const pause = sim.gen.pause;
  const grid = [maxMs / 2, maxMs];
  const bw = land ? 6 : 4;
  const last = evs[evs.length - 1];
  return (
    <g>
      {glow && <rect x={c.x - 6} y={c.y - 6} width={c.w + 12} height={c.h + 12} rx={10} fill="none" stroke="var(--accent)" strokeDasharray="3 3" />}
      <text className={css.caps} x={c.x} y={c.y + 8}>
        gc pauses · last {window}s
      </text>
      <text className={css.caps} x={c.x + c.w} y={c.y + 8} textAnchor="end">
        <tspan style={{ fill: SIG.heavy }}>■</tspan> minor <tspan style={{ fill: SIG.err }}>■</tspan> {sim.cfg.generational ? 'major' : 'full'}
      </text>
      {grid.map((m) => (
        <g key={m}>
          <line x1={x0} y1={yAt(m)} x2={x1} y2={yAt(m)} stroke="rgba(143,166,201,0.12)" />
          <text className={css.addr} x={x0 - 6} y={yAt(m) + 3} textAnchor="end">
            {m}ms
          </text>
        </g>
      ))}
      <line x1={x0} y1={top + ih} x2={x1} y2={top + ih} stroke="rgba(143,166,201,0.35)" />
      {evs.map((e, i) => {
        const x = xAt(e.t);
        const h = Math.max(2, top + ih - yAt(e.ms));
        const color = e.kind === 'minor' ? SIG.heavy : SIG.err;
        return <rect key={i} x={x - bw / 2} y={top + ih - h} width={bw} height={h} rx={1.5} fill={color} opacity={e === last ? 1 : 0.8} />;
      })}
      {last && (
        <text className={css.pauseLabel} x={Math.min(xAt(last.t), x1 - 16)} y={Math.max(top + 8, yAt(last.ms) - 6)} textAnchor="middle" style={{ fill: last.kind === 'minor' ? '#ffc58a' : '#ff9aab' }}>
          {last.ms.toFixed(1)} ms
        </text>
      )}
      {pause && <rect x={xAt(pause.t0) - bw / 2} y={top} width={bw} height={ih} fill={SIG.hc} opacity={0.35} />}
    </g>
  );
}

/* ================================================================== */
/* Pause timeline: app threads and GC threads                         */
/* ================================================================== */

function segStyle(kind: Seg['kind']): { fill: string; stroke?: string; hatch?: boolean; label?: string } {
  switch (kind) {
    case 'pause':
      return { fill: 'rgba(255,77,106,0.18)', stroke: 'rgba(255,77,106,0.8)', hatch: true };
    case 'mark':
    case 'slice':
      return { fill: 'rgba(181,155,255,0.6)', label: 'mark' };
    case 'sweep':
      return { fill: 'rgba(255,154,60,0.6)', label: 'sweep' };
    case 'cmark':
      return { fill: 'rgba(181,155,255,0.32)', stroke: 'rgba(181,155,255,0.8)', label: 'concurrent mark' };
    case 'csweep':
      return { fill: 'rgba(255,154,60,0.3)', stroke: 'rgba(255,154,60,0.75)', label: 'sweep' };
    case 'init':
    case 'remark':
      return { fill: 'rgba(255,77,106,0.7)' };
    case 'shared':
      return { fill: 'rgba(69,213,255,0.08)' };
  }
}

function ThreadsView({ sim, highlight }: { sim: GcSim; highlight: string | null }) {
  const L = sim.g.lanes;
  if (!L) return null;
  const th = sim.threads;
  const now = th.now;
  const land = sim.g.land;
  const win = th.window;
  const xAt = (t: number) => L.x1 - ((now - t) / win) * (L.x1 - L.x0);
  const clampX = (x: number) => Math.max(L.x0, Math.min(L.x1, x));
  const paused = th.paused(now);
  return (
    <g>
      <text className={css.caps} x={L.x0} y={L.ys[0] - 32}>
        application threads
      </text>
      <text className={css.caps} x={L.x0} y={L.ys[2] - 30}>
        collector threads
      </text>
      {L.ys.map((y, i) => {
        const app = i < 2;
        const glow = highlight === (app ? 'lanes:app' : 'lanes:gc');
        return (
          <g key={i}>
            {glow && <rect x={L.x0 - 8} y={y - L.h / 2 - 6} width={L.x1 - L.x0 + 16} height={L.h + 12} rx={8} fill="none" stroke="var(--accent)" strokeDasharray="3 3" />}
            <text className={css.laneLabel} x={L.x0 - 12} y={y + 4} textAnchor="end">
              {land ? LANES[i].replace('app', 'app thread').replace('gc', 'GC thread') : LANES[i]}
            </text>
            <rect x={L.x0} y={y - L.h / 2} width={L.x1 - L.x0} height={L.h} rx={4} fill="rgba(143,166,201,0.04)" stroke="rgba(143,166,201,0.14)" />
            {app && <rect x={L.x0 + 1} y={y - 2.5} width={L.x1 - L.x0 - 2} height={5} rx={2.5} fill="rgba(69,213,255,0.55)" />}
          </g>
        );
      })}
      {th.segs.map((sg, i) => {
        const x0 = clampX(xAt(sg.t0));
        const x1 = clampX(xAt(Math.min(sg.t1, now)));
        if (sg.t0 > now || x1 - x0 < 0.5) return null;
        const y = L.ys[sg.lane];
        const st = segStyle(sg.kind);
        const w = x1 - x0;
        return (
          <g key={i}>
            <rect x={x0} y={y - L.h / 2 + 1} width={w} height={L.h - 2} rx={3} fill={st.fill} stroke={st.stroke} strokeWidth={1} />
            {st.hatch && <rect x={x0} y={y - L.h / 2 + 1} width={w} height={L.h - 2} rx={3} fill="url(#kit-hatch)" />}
            {st.label && w > st.label.length * 6 + 10 && (
              <text className={css.segLabel} x={x0 + w / 2} y={y + 3.5} textAnchor="middle">
                {st.label}
              </text>
            )}
          </g>
        );
      })}
      {th.pauses.map((p, i) => {
        if (p.t0 > now) return null;
        const x0 = clampX(xAt(p.t0));
        const x1 = clampX(xAt(Math.min(p.t1, now)));
        if (x1 < L.x0 + 4) return null;
        const done = p.t1 <= now;
        return (
          <g key={`p${i}`}>
            <line x1={x0} y1={L.ys[0] - L.h / 2 - 4} x2={x0} y2={L.ys[3] + L.h / 2 + 4} stroke="rgba(255,77,106,0.35)" strokeDasharray="2 3" />
            {done && (x1 - x0 > 26 || th.mode === 'stw' || th.mode === 'parallel') && (
              <text className={css.pauseLabel} x={(x0 + x1) / 2} y={L.ys[0] - L.h / 2 - 8} textAnchor="middle">
                {p.ms} ms
              </text>
            )}
          </g>
        );
      })}
      <line x1={L.x1} y1={L.ys[0] - L.h / 2 - 16} x2={L.x1} y2={L.ys[3] + L.h / 2 + 10} stroke="rgba(255,210,63,0.5)" strokeDasharray="2 4" />
      <text className={css.caps} x={L.x1} y={L.ys[3] + L.h / 2 + 24} textAnchor="end" style={{ fill: 'rgba(255,210,63,0.8)' }}>
        now
      </text>
      <text className={css.caps} x={L.x0} y={L.ys[3] + L.h / 2 + 24}>
        ← {((win * MS_PER_S) / 1000).toFixed(1)} s ago
      </text>
      {paused && (
        <text className={css.pausedNow} x={L.x1 - 6} y={L.ys[1] + L.h / 2 + 18} textAnchor="end">
          app stopped
        </text>
      )}
    </g>
  );
}
