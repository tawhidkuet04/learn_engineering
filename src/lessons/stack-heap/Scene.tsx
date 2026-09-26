'use client';

import { SIG } from '@/lib/sim/colors';
import { clamp } from '@/lib/sim/geometry';
import { Effects, Flights } from '@/components/stage/svg';
import { DIVE_FRAME, HEAP_BASE, MAX_DEPTH, STACK_BASE, group, hex, jsId, tail } from './addr';
import type { Block, Frame, Slot, Val } from './model';
import { SEGS, type MemSim, type Rect, type SegDef } from './sim';
import css from './sh.module.css';

const VIOLET = '#cdbdff';
const ORANGE = '#ffc58a';

/** Everything drawn in SVG for the current frame of the animation. */
export function Scene({ sim, focus, highlight }: { sim: MemSim; focus?: string[]; highlight?: string | null }) {
  const dimStack = !!focus?.length && !focus.includes('stack');
  const dimHeap = !!focus?.length && !focus.includes('heap');
  return (
    <>
      <defs>
        <pattern id="sh-frames" width="8" height="5" patternUnits="userSpaceOnUse">
          <rect width="8" height="5" fill="rgba(181,155,255,0.16)" />
          <line x1="0" y1="4.5" x2="8" y2="4.5" stroke="rgba(181,155,255,0.45)" strokeWidth="1" />
        </pattern>
      </defs>
      {sim.view === 'map' && <MapView sim={sim} />}
      {sim.view === 'run' && (
        <>
          <StackRegion sim={sim} dim={dimStack} />
          <HeapRegion sim={sim} dim={dimHeap} />
          <g opacity={dimStack ? 0.3 : 1}>
            {sim.frames.map((f) => (
              <FrameCard key={f.id} sim={sim} f={f} />
            ))}
            <SpMarker sim={sim} />
          </g>
          <g opacity={dimHeap ? 0.3 : 1}>
            {sim.blocks.map((b) => (
              <BlockCard key={b.id} sim={sim} b={b} />
            ))}
          </g>
          <Arrows sim={sim} />
        </>
      )}
      {sim.view === 'overflow' && <Gauge sim={sim} />}
      <Flights sim={sim} />
      <Effects sim={sim} />
      {highlight && <Ring r={sim.target(highlight)} />}
    </>
  );
}

function Ring({ r }: { r: Rect | null }) {
  if (!r) return null;
  return <rect x={r.x - 6} y={r.y - 6} width={r.w + 12} height={r.h + 12} rx={10} fill="none" stroke="var(--accent)" strokeWidth={1.4} strokeDasharray="3 3" />;
}

/* ------------------------------------------------------------------ */
/* Run view: the two regions                                           */
/* ------------------------------------------------------------------ */

function StackRegion({ sim, dim }: { sim: MemSim; dim: boolean }) {
  const r = sim.segRect('stack');
  if (!r) return null;
  const small = sim.geo.portrait;
  const js = sim.lang === 'js';
  const live = sim.liveFrames();
  const lowest = live.length ? sim.frameRect(live[live.length - 1]) : null;
  const ghosts = sim.frames.filter((f) => f.ghost);
  const lastGhost = ghosts.length ? sim.frameRect(ghosts[ghosts.length - 1]) : null;
  const usedBottom = Math.max(lowest ? lowest.y + lowest.h : r.y + 24, lastGhost ? lastGhost.y + lastGhost.h : 0);
  const freeRoom = r.y + r.h - usedBottom;
  return (
    <g opacity={dim ? 0.35 : 1}>
      <rect x={r.x} y={r.y} width={r.w} height={r.h} rx={12} fill="rgba(181,155,255,0.022)" className={css.regionLine} />
      <text className={css.caps} x={r.x + 11} y={r.y + 15} style={{ fill: VIOLET, fontSize: small ? 8.5 : 9 }}>
        stack ↓
      </text>
      {!js && (
        <text className={css.monoDim} x={r.x + r.w - 10} y={r.y + 15} textAnchor="end" style={{ fontSize: small ? 8 : 9 }}>
          {hex(STACK_BASE)}
        </text>
      )}
      {freeRoom > 44 && (
        <text className={css.caps} x={r.x + r.w / 2} y={r.y + r.h - 12} textAnchor="middle" style={{ fontSize: small ? 7.5 : 8.5, opacity: 0.7 }}>
          {small ? 'free ↓ lower addresses' : 'free space ↓ lower addresses'}
        </text>
      )}
    </g>
  );
}

function HeapRegion({ sim, dim }: { sim: MemSim; dim: boolean }) {
  const r = sim.segRect('heap');
  if (!r) return null;
  const small = sim.geo.portrait;
  const js = sim.lang === 'js';
  const shown = sim.blocks.filter((b) => b.shown || b.state === 'free');
  let topY = r.y + r.h - 24;
  for (const b of sim.blocks) {
    const br = sim.blockRect(b);
    if (br && (b.shown || b.state === 'free')) topY = Math.min(topY, br.y);
  }
  return (
    <g opacity={dim ? 0.35 : 1}>
      <rect x={r.x} y={r.y} width={r.w} height={r.h} rx={12} fill="rgba(255,154,60,0.02)" className={css.regionLine} />
      <text className={css.caps} x={r.x + 11} y={r.y + r.h - 9} style={{ fill: ORANGE, fontSize: small ? 8.5 : 9 }}>
        {js ? 'heap · gc' : 'heap ↑'}
      </text>
      {!js && (
        <text className={css.monoDim} x={r.x + r.w - 10} y={r.y + r.h - 9} textAnchor="end" style={{ fontSize: small ? 8 : 9 }}>
          {hex(HEAP_BASE)}
        </text>
      )}
      {shown.length > 0 && !js && (
        <g opacity={0.8}>
          <line x1={r.x + 8} x2={r.x + r.w - 8} y1={topY - 7} y2={topY - 7} stroke="rgba(255,154,60,0.45)" strokeDasharray="2 4" />
          <text className={css.caps} x={r.x + r.w - 10} y={topY - 11} textAnchor="end" style={{ fontSize: small ? 7.5 : 8, fill: ORANGE, opacity: 0.8 }}>
            top of heap {small ? '' : tail(sim.heapTop, 3)}
          </text>
        </g>
      )}
      {shown.length === 0 && (
        <text className={css.caps} x={r.x + r.w / 2} y={r.y + r.h / 2} textAnchor="middle" style={{ fontSize: small ? 7.5 : 8.5, opacity: 0.55 }}>
          nothing allocated
        </text>
      )}
    </g>
  );
}

/* ------------------------------------------------------------------ */
/* A stack frame                                                       */
/* ------------------------------------------------------------------ */

function topPath(x: number, y: number, w: number, h: number, rx: number) {
  return `M${x},${y + h} L${x},${y + rx} Q${x},${y} ${x + rx},${y} L${x + w - rx},${y} Q${x + w},${y} ${x + w},${y + rx} L${x + w},${y + h} Z`;
}

function FrameCard({ sim, f }: { sim: MemSim; f: Frame }) {
  const box = sim.boxes.get(`fr:${f.id}`);
  const r = sim.frameRect(f);
  if (!box || !r) return null;
  const m = sim.fm;
  const g = sim.geo;
  const small = g.portrait;
  const js = sim.lang === 'js';
  const top = sim.top();
  const active = top === f && !sim.ended;
  const full = sim.cfg.detail === 'full';
  const rows = f.slots.filter((s) => s.kind === 'param' || s.kind === 'local');
  const fs = Math.min(g.font.row, m.rowH * 0.66);
  const fa = Math.min(g.font.addr, m.rowH * 0.58);
  const addrW = js ? 0 : small ? 30 : 40;
  const opacity = box.alpha * (f.ghost ? 0.52 : 1);
  return (
    <g opacity={opacity}>
      <rect
        x={r.x}
        y={r.y}
        width={r.w}
        height={r.h}
        rx={7}
        className={css.card}
        style={f.ghost ? { strokeDasharray: '3 3', stroke: 'rgba(143,166,201,0.45)', fill: 'rgba(11,19,36,0.5)' } : active ? { stroke: 'var(--accent)', strokeWidth: 1.5 } : undefined}
      />
      <path d={topPath(r.x + 0.5, r.y + 0.5, r.w - 1, m.headH, 6.5)} fill={f.ghost ? 'rgba(143,166,201,0.06)' : 'rgba(181,155,255,0.12)'} />
      <text className={css.sans} x={r.x + 9} y={r.y + m.headH * 0.68} style={{ fontSize: Math.min(g.font.head, m.headH * 0.62), fill: f.ghost ? 'var(--text-3)' : undefined }}>
        {f.fn}()
      </text>
      <text className={css.monoDim} x={r.x + r.w - 8} y={r.y + m.headH * 0.68} textAnchor="end" style={{ fontSize: fa }}>
        {f.ghost ? 'popped' : js ? '' : `${f.size} B`}
      </text>
      {full ? (
        f.slots
          .filter((s) => s.kind === 'ret' || s.kind === 'rbp')
          .map((s, i) => {
            const y = r.y + m.headH + i * m.rowH;
            return (
              <g key={s.name}>
                <rect x={r.x + 1} y={y} width={r.w - 2} height={m.rowH} fill="rgba(181,155,255,0.06)" />
                {!js && (
                  <text className={css.monoDim} x={r.x + 8} y={y + m.rowH * 0.68} style={{ fontSize: fa }}>
                    {tail(s.addr)}
                  </text>
                )}
                <text className={css.mono} x={r.x + 8 + addrW} y={y + m.rowH * 0.68} style={{ fontSize: fs, fill: VIOLET }}>
                  {s.kind === 'ret' ? 'ret addr' : 'saved rbp'}
                </text>
                <text className={css.mono} x={r.x + r.w - 9} y={y + m.rowH * 0.68} textAnchor="end" style={{ fontSize: fs, fill: VIOLET }}>
                  {s.v.t === 'code' ? s.v.v : ''}
                </text>
              </g>
            );
          })
      ) : (
        <g>
          <rect x={r.x + 1} y={r.y + m.headH} width={r.w - 2} height={m.bkH} fill="url(#kit-hatch-dim)" />
          {m.bkH >= 9 && (
            <text className={css.caps} x={r.x + 9} y={r.y + m.headH + m.bkH * 0.74} style={{ fontSize: Math.min(7.5, m.bkH * 0.66), letterSpacing: '0.1em', opacity: 0.85 }}>
              {js ? 'return address · engine data' : 'ret addr · saved rbp'}
            </text>
          )}
        </g>
      )}
      {rows.map((s, i) => (
        <SlotRow key={s.uid} sim={sim} s={s} x={r.x} w={r.w} y={r.y + m.headH + (full ? 2 * m.rowH : m.bkH) + i * m.rowH} h={m.rowH} fs={fs} fa={fa} addrW={addrW} first={i === 0} />
      ))}
    </g>
  );
}

function valText(sim: MemSim, v: Val): string {
  return sim.fmt(v);
}

function SlotRow({ sim, s, x, w, y, h, fs, fa, addrW, first }: { sim: MemSim; s: Slot; x: number; w: number; y: number; h: number; fs: number; fa: number; addrW: number; first: boolean }) {
  const js = sim.lang === 'js';
  const k = clamp(1 - (sim.vt - s.flash) / 0.9, 0, 1);
  const isPtr = s.v.t === 'ptr' && !!s.v.addr && !s.moved;
  const t = isPtr ? sim.resolvePtr(s.v) : null;
  const bad = (isPtr && t != null && !t.ok) || s.bad;
  const ptrColor = bad ? SIG.err : (s.color ?? SIG.req);
  const stale = 'stale' in s.v && !!s.v.stale;
  let value = s.moved ? 'moved' : valText(sim, s.v);
  if (stale) value = `${value}?`;
  const ty = y + h * 0.68;
  return (
    <g>
      {!first && <line className={css.rowRule} x1={x + 6} x2={x + w - 6} y1={y} y2={y} />}
      {k > 0 && <rect x={x + 1} y={y} width={w - 2} height={h} fill={s.bad ? SIG.err : SIG.warn} opacity={k * 0.2} />}
      {!js && (
        <text className={css.monoDim} x={x + 8} y={ty} style={{ fontSize: fa }}>
          {tail(s.addr)}
        </text>
      )}
      <text className={css.monoStrong} x={x + 8 + addrW} y={ty} style={{ fontSize: fs, fill: s.moved ? 'var(--text-3)' : s.color ?? undefined, textDecoration: s.moved ? 'line-through' : undefined }}>
        {s.name}
      </text>
      <text
        className={stale ? `${css.mono} ${css.stale}` : css.mono}
        x={x + w - (isPtr ? 14 : 9)}
        y={ty}
        textAnchor="end"
        style={{ fontSize: fs, fill: s.moved ? 'var(--text-3)' : isPtr ? ptrColor : s.v.t === 'ptr' ? 'var(--text-3)' : stale ? undefined : 'var(--text-1)' }}
      >
        {value}
      </text>
      {isPtr && <circle cx={x + w - 5} cy={y + h / 2} r={2.6} fill={ptrColor} />}
    </g>
  );
}

/* ------------------------------------------------------------------ */
/* A heap block                                                        */
/* ------------------------------------------------------------------ */

function BlockCard({ sim, b }: { sim: MemSim; b: Block }) {
  const box = sim.boxes.get(`bk:${b.id}`);
  const r = sim.blockRect(b);
  if (!box || !r || box.alpha < 0.01) return null;
  const m = sim.fm;
  const small = sim.geo.portrait;
  const fa = small ? 8 : 9;
  const fs = small ? 9.5 : 10.5;
  const k = clamp(1 - (sim.vt - b.flash) / 0.9, 0, 1);
  const free = b.state === 'free';
  const leaked = b.state === 'leaked';
  const garbage = b.state === 'garbage';
  const js = !!b.js;
  const stroke = free ? 'rgba(143,166,201,0.35)' : leaked ? SIG.err : garbage ? 'rgba(181,155,255,0.7)' : 'rgba(255,154,60,0.55)';
  const addr = js ? jsId(b.alloc) : small ? tail(b.addr) : hex(b.addr);
  const tag = free ? 'free' : leaked ? 'leaked' : garbage ? 'unreachable' : null;
  const tagColor = leaked ? SIG.err : garbage ? VIOLET : 'var(--text-3)';
  const size = js ? b.label : `${b.label} · ${b.req} B`;

  if (b.compact) {
    return (
      <g opacity={box.alpha}>
        <rect x={r.x} y={r.y} width={r.w} height={r.h} rx={4} fill={free ? 'url(#kit-hatch-dim)' : leaked ? 'rgba(255,77,106,0.1)' : 'var(--node-fill)'} stroke={stroke} strokeDasharray={free || garbage ? '3 3' : undefined} />
        <text className={css.monoDim} x={r.x + 7} y={r.y + r.h * 0.7} style={{ fontSize: fa }}>
          {js ? addr : tail(b.addr, 3)} · {free ? `${b.size} B` : `${b.req} B`}
        </text>
        {tag && (
          <text className={css.caps} x={r.x + r.w - 7} y={r.y + r.h * 0.7} textAnchor="end" style={{ fontSize: 7.5, fill: tagColor }}>
            {tag}
          </text>
        )}
      </g>
    );
  }

  const headY = r.y + m.bHead * 0.66;
  return (
    <g opacity={box.alpha}>
      <rect
        x={r.x}
        y={r.y}
        width={r.w}
        height={r.h}
        rx={6}
        fill={free ? 'url(#kit-hatch-dim)' : leaked ? 'rgba(255,77,106,0.07)' : 'var(--node-fill)'}
        stroke={stroke}
        strokeWidth={leaked ? 1.4 : 1.1}
        strokeDasharray={free || garbage ? '3 3' : undefined}
      />
      {k > 0 && !free && <rect x={r.x + 1} y={r.y + 1} width={r.w - 2} height={r.h - 2} rx={5} fill={SIG.warn} opacity={k * 0.14} />}
      {free ? (
        <>
          <text className={css.monoDim} x={r.x + 8} y={r.y + r.h * 0.64} style={{ fontSize: fa }}>
            {small ? tail(b.addr, 4) : hex(b.addr)}
          </text>
          <text className={css.caps} x={r.x + r.w - 8} y={r.y + r.h * 0.64} textAnchor="end" style={{ fontSize: small ? 7.5 : 8 }}>
            free · {b.size} B
          </text>
        </>
      ) : (
        <>
          <path d={topPath(r.x + 0.5, r.y + 0.5, r.w - 1, m.bHead - 1, 5.5)} fill={leaked ? 'rgba(255,77,106,0.1)' : 'rgba(255,154,60,0.09)'} />
          <text className={css.mono} x={r.x + 8} y={headY} style={{ fontSize: fa, fill: 'var(--text-2)' }}>
            {addr}
          </text>
          <text className={tag ? css.caps : css.monoDim} x={r.x + r.w - 8} y={headY} textAnchor="end" style={tag ? { fontSize: small ? 7.5 : 8, fill: tagColor } : { fontSize: fa }}>
            {tag ?? size}
          </text>
          <BlockBody sim={sim} b={b} r={r} fs={fs} />
        </>
      )}
    </g>
  );
}

function BlockBody({ sim, b, r, fs }: { sim: MemSim; b: Block; r: Rect; fs: number }) {
  const m = sim.fm;
  const y0 = r.y + m.bHead;
  const dimmed = b.state !== 'live';
  if (b.kind === 'cells') {
    const n = b.fields.length;
    const cw = (r.w - 16) / n;
    return (
      <g opacity={dimmed ? 0.6 : 1}>
        {b.fields.map((f, i) => {
          const k = clamp(1 - (sim.vt - f.flash) / 0.9, 0, 1);
          const x = r.x + 8 + i * cw;
          return (
            <g key={f.k}>
              <rect x={x + 1} y={y0 + 2} width={cw - 2} height={m.bRow} rx={3} fill={k > 0 ? `rgba(255,210,63,${0.08 + k * 0.25})` : 'rgba(143,166,201,0.05)'} stroke="rgba(143,166,201,0.22)" />
              <text className={css.mono} x={x + cw / 2} y={y0 + 2 + m.bRow * 0.7} textAnchor="middle" style={{ fontSize: fs, fill: f.v.t === 'none' ? 'var(--text-3)' : 'var(--text-1)' }}>
                {sim.fmt(f.v)}
              </text>
            </g>
          );
        })}
      </g>
    );
  }
  if (b.kind === 'text') {
    const f = b.fields[0];
    const k = f ? clamp(1 - (sim.vt - f.flash) / 0.9, 0, 1) : 0;
    return (
      <g opacity={dimmed ? 0.6 : 1}>
        {k > 0 && <rect x={r.x + 3} y={y0 + 1} width={r.w - 6} height={m.bRow} rx={3} fill={SIG.warn} opacity={k * 0.2} />}
        <text className={css.mono} x={r.x + 9} y={y0 + m.bRow * 0.72} style={{ fontSize: fs, fill: !f || f.v.t === 'none' ? 'var(--text-3)' : f.bad ? SIG.err : 'var(--text-1)' }}>
          {!f || f.v.t === 'none' ? '? uninitialized' : sim.fmt(f.v)}
        </text>
      </g>
    );
  }
  return (
    <g opacity={dimmed ? 0.6 : 1}>
      {b.fields.map((f, i) => {
        const y = y0 + i * m.bRow;
        const k = clamp(1 - (sim.vt - f.flash) / 0.9, 0, 1);
        const isPtr = f.v.t === 'ptr' && !!f.v.addr;
        return (
          <g key={f.k}>
            {i > 0 && <line className={css.rowRule} x1={r.x + 6} x2={r.x + r.w - 6} y1={y} y2={y} />}
            {k > 0 && <rect x={r.x + 1} y={y} width={r.w - 2} height={m.bRow} fill={f.bad ? SIG.err : SIG.warn} opacity={k * 0.2} />}
            <text className={css.monoDim} x={r.x + 9} y={y + m.bRow * 0.7} style={{ fontSize: fs - 0.5 }}>
              {f.k}
            </text>
            <text
              className={css.mono}
              x={r.x + r.w - (isPtr ? 14 : 9)}
              y={y + m.bRow * 0.7}
              textAnchor="end"
              style={{ fontSize: fs, fill: f.bad ? SIG.err : isPtr ? SIG.hc : f.v.t === 'none' || (f.v.t === 'ptr' && !f.v.addr) ? 'var(--text-3)' : 'var(--text-1)' }}
            >
              {sim.fmt(f.v)}
            </text>
            {isPtr && <circle cx={r.x + r.w - 5} cy={y + m.bRow / 2} r={2.4} fill={SIG.hc} />}
          </g>
        );
      })}
    </g>
  );
}

/* ------------------------------------------------------------------ */
/* Pointer arrows and the stack pointer                                */
/* ------------------------------------------------------------------ */

function Arrows({ sim }: { sim: MemSim }) {
  const arrows = sim.arrowViews();
  return (
    <g>
      {arrows.map((a) => {
        const k = clamp((sim.vt - a.born) / 0.38, 0, 1);
        const h = 6.5;
        const p1 = `${a.x1 - h * Math.cos(a.ang - 0.42)},${a.y1 - h * Math.sin(a.ang - 0.42)}`;
        const p2 = `${a.x1 - h * Math.cos(a.ang + 0.42)},${a.y1 - h * Math.sin(a.ang + 0.42)}`;
        return (
          <g key={a.key}>
            <path d={a.d} fill="none" stroke={a.color} strokeWidth={4} opacity={0.08 * k} />
            <path
              d={a.d}
              fill="none"
              stroke={a.color}
              strokeWidth={1.4}
              pathLength={a.bad ? undefined : 1}
              strokeDasharray={a.bad ? '4 4' : '1'}
              strokeDashoffset={a.bad ? 0 : 1 - k}
              opacity={0.92}
            />
            {k > 0.85 && <polygon points={`${p1} ${a.x1},${a.y1} ${p2}`} fill={a.color} />}
          </g>
        );
      })}
    </g>
  );
}

function SpMarker({ sim }: { sim: MemSim }) {
  const r = sim.segRect('stack');
  if (!r) return null;
  const top = sim.top();
  const fr = top ? sim.frameRect(top) : null;
  const y = fr ? fr.y + fr.h : r.y + 34;
  const x0 = r.x + 5;
  const x1 = fr ? fr.x - 3 : r.x + r.w - 10;
  const small = sim.geo.portrait;
  return (
    <g>
      <line x1={x0} x2={x1} y1={y} y2={y} stroke="var(--accent)" strokeWidth={1.2} strokeDasharray="2 3" />
      <polygon points={`${x1 - 6},${y - 4} ${x1},${y} ${x1 - 6},${y + 4}`} fill="var(--accent)" />
      <text x={x0 + 1} y={y - 4} style={{ fontFamily: 'var(--font-mono)', fontSize: small ? 8.5 : 9.5, fontWeight: 600, fill: 'var(--accent)' }}>
        SP
      </text>
    </g>
  );
}

/* ------------------------------------------------------------------ */
/* Map view: the whole address space                                   */
/* ------------------------------------------------------------------ */

const SEG_STYLE: Record<SegDef['id'], { fill: string; stroke: string; label: string }> = {
  stack: { fill: 'rgba(181,155,255,0.10)', stroke: 'rgba(181,155,255,0.6)', label: VIOLET },
  libs: { fill: 'rgba(143,166,201,0.05)', stroke: 'rgba(143,166,201,0.3)', label: 'var(--text-2)' },
  heap: { fill: 'rgba(255,154,60,0.09)', stroke: 'rgba(255,154,60,0.55)', label: ORANGE },
  data: { fill: 'rgba(45,212,191,0.08)', stroke: 'rgba(45,212,191,0.5)', label: '#7ee8d9' },
  text: { fill: 'rgba(147,165,255,0.09)', stroke: 'rgba(147,165,255,0.5)', label: '#b9c5ff' },
};

function MapView({ sim }: { sim: MemSim }) {
  const g = sim.geo;
  const m = g.map;
  if (!m) return null;
  const small = g.portrait;
  const st = sim.segRect('stack');
  const hp = sim.segRect('heap');
  const tx = sim.segRect('text');
  const t = sim.vt;
  const ambient = !sim.prog;
  // Ambient life: the stack breathes as calls come and go, the heap slowly fills.
  const nFrames = Math.max(1, Math.min(4, 1 + Math.floor(2 + 2.2 * Math.sin(t * 1.3) + 0.8 * Math.sin(t * 3.1))));
  const spY = st ? st.y + 5 + nFrames * ((small ? 9 : 13) + 3) - 1.5 : 0;
  const heapFill = ambient ? 0.3 + 0.12 * Math.sin(t * 0.55 + 1) : 0.2;
  const aStack = sim.segAlpha('stack');
  const aHeap = sim.segAlpha('heap');
  return (
    <g>
      {st && tx && (
        <>
          <line x1={m.x + m.w / 2} x2={m.x + m.w / 2} y1={m.y - 14} y2={m.y} stroke="rgba(143,166,201,0.3)" strokeDasharray="2 4" />
          <text className={css.monoDim} x={m.x - 10} y={m.y - 8} textAnchor="end" style={{ fontSize: small ? 8 : 9 }}>
            0x7fffffffffff
          </text>
          <text className={css.caps} x={m.x + m.w + 12} y={m.y - 8} style={{ fontSize: small ? 7.5 : 8.5 }}>
            {small ? 'high addresses' : 'high addresses (end of user space)'}
          </text>
          <text className={css.monoDim} x={m.x - 10} y={tx.y + tx.h + 20} textAnchor="end" style={{ fontSize: small ? 8 : 9 }}>
            0x000000000000
          </text>
          <text className={css.caps} x={m.x + m.w + 12} y={tx.y + tx.h + 20} style={{ fontSize: small ? 7.5 : 8.5 }}>
            {small ? 'NULL page' : 'low addresses (NULL page)'}
          </text>
        </>
      )}
      {SEGS.map((d, i) => {
        const r = sim.segRect(d.id);
        const a = sim.segAlpha(d.id);
        if (!r || a < 0.01) return null;
        const s = SEG_STYLE[d.id];
        const next = SEGS[i + 1];
        const nr = next ? sim.segRect(next.id) : null;
        const gapH = nr ? nr.y - (r.y + r.h) : 0;
        return (
          <g key={d.id} opacity={a}>
            <rect x={r.x} y={r.y} width={r.w} height={r.h} rx={6} fill={s.fill} stroke={s.stroke} strokeWidth={1.1} />
            <line x1={r.x - 6} x2={r.x} y1={r.y + r.h} y2={r.y + r.h} stroke="rgba(143,166,201,0.45)" />
            <text className={css.monoDim} x={r.x - 10} y={r.y + r.h + 3} textAnchor="end" style={{ fontSize: small ? 8 : 9 }}>
              {hex(d.lo)}
            </text>
            {small ? (
              <text x={r.x + r.w + 10} y={r.y + r.h / 2 + 4}>
                <tspan className={css.sans} style={{ fontSize: 11, fill: s.label }}>
                  {d.name}
                </tspan>
                <tspan className={css.monoDim} dx={6} style={{ fontSize: 7.5 }}>
                  {shortDesc(d.id)}
                </tspan>
              </text>
            ) : (
              <>
                <text className={css.sans} x={r.x + r.w + 12} y={r.y + r.h / 2 - 2} style={{ fontSize: 13, fill: s.label }}>
                  {d.name}
                </text>
                <text className={css.monoDim} x={r.x + r.w + 12} y={r.y + r.h / 2 + 12} style={{ fontSize: 9.5 }}>
                  {d.desc}
                </text>
              </>
            )}
            {gapH > 26 && (
              <g opacity={0.8}>
                <line x1={r.x + 10} x2={r.x + r.w - 10} y1={r.y + r.h + gapH / 2} y2={r.y + r.h + gapH / 2} stroke="rgba(143,166,201,0.18)" strokeDasharray="1 5" />
                <text className={css.caps} x={r.x + r.w / 2} y={r.y + r.h + gapH / 2 + 3} textAnchor="middle" style={{ fontSize: small ? 7 : 8, opacity: 0.8 }}>
                  {small ? 'unmapped' : 'unmapped · free'}
                </text>
              </g>
            )}
          </g>
        );
      })}
      {st && aStack > 0.01 && (
        <g opacity={aStack}>
          {ambient &&
            Array.from({ length: nFrames }, (_, i) => {
              const fh = small ? 9 : 13;
              return <rect key={i} x={st.x + 8} y={st.y + 5 + i * (fh + 3)} width={st.w - 16} height={fh} rx={3} fill="rgba(181,155,255,0.2)" stroke="rgba(181,155,255,0.55)" />;
            })}
          <line className={css.grow} x1={st.x + st.w / 2} x2={st.x + st.w / 2} y1={st.y + st.h + 4} y2={st.y + st.h + 30} stroke={VIOLET} strokeWidth={1.3} />
          <polygon points={`${st.x + st.w / 2 - 4},${st.y + st.h + 26} ${st.x + st.w / 2},${st.y + st.h + 33} ${st.x + st.w / 2 + 4},${st.y + st.h + 26}`} fill={VIOLET} />
          {ambient && (
            <g>
              <line x1={st.x - 16} x2={st.x + st.w} y1={spY} y2={spY} stroke="var(--accent)" strokeWidth={1.1} strokeDasharray="2 3" />
              <polygon points={`${st.x - 7},${spY - 4} ${st.x - 1},${spY} ${st.x - 7},${spY + 4}`} fill="var(--accent)" />
              <text x={st.x - 20} y={spY + 3.5} textAnchor="end" style={{ fontFamily: 'var(--font-mono)', fontSize: small ? 8.5 : 9.5, fontWeight: 600, fill: 'var(--accent)' }}>
                SP
              </text>
            </g>
          )}
        </g>
      )}
      {hp && aHeap > 0.01 && (
        <g opacity={aHeap}>
          {ambient &&
            Array.from({ length: 5 }, (_, i) => {
              const bh = (hp.h * 0.8) / 5;
              const y = hp.y + hp.h - 3 - (i + 1) * bh;
              const on = (i + 0.5) / 5 < heapFill / 0.5;
              const hole = i === 1;
              return on ? (
                <rect key={i} x={hp.x + 8} y={y} width={hp.w - 16} height={Math.max(2, bh - 3)} rx={3} fill={hole ? 'url(#kit-hatch-dim)' : 'rgba(255,154,60,0.2)'} stroke={hole ? 'rgba(143,166,201,0.3)' : 'rgba(255,154,60,0.5)'} />
              ) : null;
            })}
          <line className={css.grow} x1={hp.x + hp.w / 2} x2={hp.x + hp.w / 2} y1={hp.y - 4} y2={hp.y - 30} stroke={ORANGE} strokeWidth={1.3} />
          <polygon points={`${hp.x + hp.w / 2 - 4},${hp.y - 26} ${hp.x + hp.w / 2},${hp.y - 33} ${hp.x + hp.w / 2 + 4},${hp.y - 26}`} fill={ORANGE} />
        </g>
      )}
      {sim.pins.map((p) => (
        <MapPin key={p.id} sim={sim} id={p.id} />
      ))}
    </g>
  );
}

function shortDesc(id: SegDef['id']) {
  return { stack: 'locals', libs: 'libc', heap: 'malloc', data: 'globals', text: 'code' }[id];
}

function MapPin({ sim, id }: { sim: MemSim; id: string }) {
  const p = sim.pins.find((x) => x.id === id);
  const pos = sim.pinPos(id);
  if (!p || !pos) return null;
  const small = sim.geo.portrait;
  const k = clamp(1 - (sim.vt - p.flash) / 1, 0, 1);
  const a = clamp((sim.vt - p.at) / 0.35, 0, 1);
  const w = p.label.length * (small ? 5.4 : 6.2) + 16;
  return (
    <g opacity={a * (p.freed ? 0.55 : 1)}>
      {k > 0 && <circle cx={pos.x} cy={pos.y} r={8 + (1 - k) * 18} fill="none" stroke={SIG.warn} strokeWidth={2 * k} opacity={k} />}
      <rect x={pos.x - w / 2} y={pos.y - 8} width={w} height={16} rx={8} fill="rgba(7,11,20,0.92)" stroke={p.freed ? 'rgba(143,166,201,0.4)' : SIG.warn} strokeDasharray={p.freed ? '3 3' : undefined} />
      <text className={css.mono} x={pos.x} y={pos.y + 3.5} textAnchor="middle" style={{ fontSize: small ? 8.5 : 9.5, fill: p.freed ? 'var(--text-3)' : 'var(--text-1)', textDecoration: p.freed ? 'line-through' : undefined }}>
        {p.label}
      </text>
    </g>
  );
}

/* ------------------------------------------------------------------ */
/* Overflow view: the whole 8 MB stack as a gauge                      */
/* ------------------------------------------------------------------ */

function Gauge({ sim }: { sim: MemSim }) {
  const g = sim.geo;
  const G = g.gauge;
  const C = g.cards;
  if (!G || !C) return null;
  const small = g.portrait;
  const frac = sim.ovFrac;
  const fillH = G.h * frac;
  const edgeY = G.y + fillH;
  const crashed = sim.ov.phase === 'crash';
  const depth = crashed ? MAX_DEPTH : Math.floor(sim.ov.depth);
  const ticks = [2, 4, 6, 8];
  const cardH = small ? 30 : 36;
  const cardGap = 5;
  const n = Math.min(3, Math.max(1, depth));
  const cards = Array.from({ length: n }, (_, i) => depth - (n - 1 - i));
  const extra = crashed ? cardH + cardGap : 0;
  const stackTopY = Math.max(G.y + 24, edgeY - n * (cardH + cardGap) - extra);
  const crashY = stackTopY + n * (cardH + cardGap);
  return (
    <g>
      <text className={css.caps} x={G.x + G.w / 2} y={G.y - 26} textAnchor="middle" style={{ fill: VIOLET, fontSize: small ? 8 : 9 }}>
        stack · 8 MB
      </text>
      <text className={css.monoDim} x={G.x + G.w / 2} y={G.y - 12} textAnchor="middle" style={{ fontSize: small ? 7.5 : 8.5 }}>
        {small ? tail(STACK_BASE, 4) : hex(STACK_BASE)}
      </text>
      <rect x={G.x} y={G.y} width={G.w} height={G.h} rx={4} fill="rgba(181,155,255,0.03)" stroke="rgba(143,166,201,0.45)" />
      {fillH > 0.5 && <rect x={G.x + 1} y={G.y + 1} width={G.w - 2} height={Math.max(1, fillH - 1)} rx={3} fill="url(#sh-frames)" />}
      {ticks.map((mb) => {
        const y = G.y + (G.h * mb) / 8;
        const nearSp = Math.abs(y - (edgeY + 8)) < 12;
        return (
          <g key={mb}>
            <line x1={G.x - 5} x2={G.x} y1={y} y2={y} stroke="rgba(143,166,201,0.5)" />
            {!nearSp && (
              <text className={css.monoDim} x={G.x - 8} y={y + 3} textAnchor="end" style={{ fontSize: small ? 7.5 : 8.5 }}>
                {`${mb} MB`}
              </text>
            )}
          </g>
        );
      })}
      <rect x={G.x} y={G.y + G.h + 2} width={G.w} height={12} rx={2} fill="url(#kit-hatch)" stroke={crashed ? SIG.err : 'rgba(255,77,106,0.6)'} strokeWidth={crashed ? 2 : 1} />
      <text className={css.caps} x={G.x + G.w / 2} y={G.y + G.h + 28} textAnchor="middle" style={{ fontSize: small ? 7 : 8, fill: '#ff8a9d' }}>
        guard page
      </text>
      {/* stack pointer at the fill edge */}
      <line x1={G.x - 16} x2={G.x + G.w + 6} y1={edgeY} y2={edgeY} stroke="var(--accent)" strokeWidth={1.3} strokeDasharray="2 3" />
      <text x={G.x - 18} y={edgeY + 12} textAnchor="end" style={{ fontFamily: 'var(--font-mono)', fontSize: small ? 8.5 : 9.5, fontWeight: 600, fill: 'var(--accent)' }}>
        SP
      </text>
      {/* the most recent frames, drawn at full size next to the edge */}
      <path d={`M${G.x + G.w + 6},${edgeY} L${C.x - 6},${Math.min(edgeY, stackTopY + n * (cardH + cardGap) - cardGap / 2)}`} stroke="rgba(255,210,63,0.5)" fill="none" />
      {cards.map((d, i) => {
        const y = stackTopY + i * (cardH + cardGap);
        const last = i === cards.length - 1;
        return (
          <g key={i}>
            <rect x={C.x} y={y} width={C.w} height={cardH} rx={6} className={css.card} style={last && !crashed ? { stroke: 'var(--accent)', strokeWidth: 1.4 } : undefined} />
            <text className={css.sans} x={C.x + 9} y={y + cardH * 0.46} style={{ fontSize: small ? 10 : 11.5 }}>
              {d <= 1 && depth <= 1 ? 'dive(1)' : `dive(${group(d)})`}
            </text>
            <text className={css.monoDim} x={C.x + 9} y={y + cardH * 0.82} style={{ fontSize: small ? 7.5 : 8.5 }}>
              {small ? `buf[40] · ${DIVE_FRAME} B` : `depth, buf[40], ret addr · ${DIVE_FRAME} B`}
            </text>
          </g>
        );
      })}
      {crashed && (
        <g>
          <rect x={C.x} y={crashY} width={C.w} height={cardH} rx={6} fill="rgba(255,77,106,0.1)" stroke={SIG.err} strokeWidth={1.4} strokeDasharray="4 3" />
          <text className={css.sans} x={C.x + 9} y={crashY + cardH * 0.46} style={{ fontSize: small ? 10 : 11.5, fill: '#ff8a9d' }}>
            dive({group(MAX_DEPTH + 1)})
          </text>
          <text className={css.monoDim} x={C.x + 9} y={crashY + cardH * 0.82} style={{ fontSize: small ? 7.5 : 8.5, fill: '#ff8a9d' }}>
            {small ? 'no room: SIGSEGV' : 'no room: hits the guard page → SIGSEGV'}
          </text>
        </g>
      )}
    </g>
  );
}
