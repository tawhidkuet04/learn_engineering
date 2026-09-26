'use client';

import { useId } from 'react';
import { Effects, Flights } from '@/components/stage/svg';
import { SIG } from '@/lib/sim/colors';
import { clamp } from '@/lib/sim/geometry';
import { Q_COLOR, type Icon, type QName } from './engine';
import type { CardView, EventLoopSim, Rect } from './sim';
import type { BarKind, Click } from './thread';
import css from './el.module.css';

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

export function hexA(hex: string, a: number) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/(.)/g, '$1$1') : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function fit(text: string, px: number, cw: number) {
  const max = Math.max(1, Math.floor(px / cw));
  return text.length > max ? `${text.slice(0, Math.max(1, max - 1))}…` : text;
}

/** A static piece's rectangle, eased, with its alpha. */
export function rectOf(sim: EventLoopSim, id: string): (Rect & { a: number }) | null {
  const b = sim.boxes.get(id);
  if (!b || Number.isNaN(b.x) || b.alpha < 0.01) return null;
  const s = sim.sizeOf(id);
  return { x: b.x - s.w / 2, y: b.y - s.h / 2, w: s.w, h: s.h, a: b.alpha };
}

function arcPath(cx: number, cy: number, r: number, a0: number, a1: number) {
  const p0 = { x: cx + r * Math.cos(a0), y: cy + r * Math.sin(a0) };
  const p1 = { x: cx + r * Math.cos(a1), y: cy + r * Math.sin(a1) };
  const large = Math.abs(a1 - a0) > Math.PI ? 1 : 0;
  return `M${p0.x.toFixed(1)},${p0.y.toFixed(1)} A${r},${r} 0 ${large} 1 ${p1.x.toFixed(1)},${p1.y.toFixed(1)}`;
}

/* ------------------------------------------------------------------ */
/* glyphs                                                              */
/* ------------------------------------------------------------------ */

export function Glyph({ icon, x, y, color, s = 1 }: { icon: Icon; x: number; y: number; color: string; s?: number }) {
  const st = { stroke: color, fill: 'none', strokeWidth: 1.2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  let body = null;
  switch (icon) {
    case 'timer':
      body = (
        <g {...st}>
          <circle r={4.2} />
          <path d="M0,-2.3 V0 L1.7,1.2" />
        </g>
      );
      break;
    case 'net':
      body = (
        <g {...st}>
          <circle r={4.2} />
          <ellipse rx={1.8} ry={4.2} />
          <path d="M-4.2,0 H4.2" />
        </g>
      );
      break;
    case 'click':
      body = <path d="M-2.4,-4.2 L3,1 L0.6,1.3 L2,4 L0.8,4.6 L-0.5,1.9 L-2.4,3.5 Z" fill={color} />;
      break;
    case 'promise':
      body = <rect x={-2.7} y={-2.7} width={5.4} height={5.4} transform="rotate(45)" fill={color} />;
      break;
    case 'resume':
      body = (
        <g {...st}>
          <path d="M3.4,-1.6 A3.8,3.8 0 1 0 2.6,2.8" />
          <path d="M3.9,-4.2 V-1.2 H0.9" />
        </g>
      );
      break;
    case 'raf':
      body = (
        <g {...st}>
          <rect x={-4.3} y={-3.4} width={8.6} height={5.8} rx={1} />
          <path d="M-1.8,4.2 H1.8" />
        </g>
      );
      break;
    case 'fn':
      body = (
        <text x={0} y={3.6} textAnchor="middle" style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: 11, fill: color }}>
          f
        </text>
      );
      break;
    case 'api':
      body = <path {...st} d="M-1.4,-3.6 L-4,0 L-1.4,3.6 M1.4,-3.6 L4,0 L1.4,3.6" />;
      break;
    case 'script':
    case 'file':
      body = (
        <g {...st}>
          <path d="M-3.2,-4.3 H1.1 L3.3,-2.1 V4.3 H-3.2 Z" />
          <path d="M-1.4,-0.4 H1.5 M-1.4,1.9 H1.5" />
        </g>
      );
      break;
    case 'immediate':
      body = <path {...st} d="M-3.6,-3.2 L-0.4,0 L-3.6,3.2 M0.6,-3.2 L3.8,0 L0.6,3.2" />;
      break;
  }
  return <g transform={`translate(${x},${y}) scale(${s})`}>{body}</g>;
}

/* ------------------------------------------------------------------ */
/* cards: frames, queued callbacks, Web API items                      */
/* ------------------------------------------------------------------ */

function CardG({ c, compact, onPick, onBuy }: { c: CardView; compact: boolean; onPick?: (id: string) => void; onBuy?: () => void }) {
  const x0 = c.x - c.w / 2;
  const y0 = c.y - c.h / 2;
  const frame = c.role === 'frame';
  const parked = c.role === 'parked';
  const api = c.role === 'api';
  const col = c.color;
  const two = (api || parked) && c.h >= 24;
  const iconX = compact ? 9 : 11.5;
  const textX = compact ? 17 : 22;
  const cw = compact ? 5.15 : 6.05;
  const right = c.listener ? 46 : frame && c.remain ? 74 : 6;
  const maxW = c.w - textX - right;
  const fill = frame && c.top ? hexA(col, 0.13) : 'var(--node-fill)';
  const pickable = !!c.pick && !!onPick;
  return (
    <g
      transform={`translate(${x0.toFixed(1)},${y0.toFixed(1)})`}
      opacity={c.alpha}
      className={pickable ? css.clickable : undefined}
      onClick={pickable ? () => onPick(c.pick!) : undefined}
      role={pickable ? 'button' : undefined}
      aria-label={pickable ? `Runs next: ${c.label}` : undefined}
    >
      {pickable && <rect className={css.pickRing} x={-4} y={-4} width={c.w + 8} height={c.h + 8} rx={8} />}
      {frame && c.top && <rect x={-3} y={-3} width={c.w + 6} height={c.h + 6} rx={7} fill="none" stroke={col} strokeOpacity={0.25} strokeWidth={3} />}
      <rect
        width={c.w}
        height={c.h}
        rx={5}
        fill={fill}
        stroke={col}
        strokeOpacity={frame ? (c.top ? 0.95 : 0.5) : parked ? 0.6 : 0.75}
        strokeWidth={frame && c.top ? 1.4 : 1}
        strokeDasharray={c.builtin || parked ? '3 2.5' : undefined}
      />
      <rect x={1} y={3} width={2.4} height={Math.max(0, c.h - 6)} rx={1.2} fill={col} opacity={c.builtin ? 0.45 : 0.9} />
      <Glyph icon={c.icon} x={iconX} y={two ? c.h / 2 - 5 : c.h / 2} color={col} s={compact ? 0.85 : 1} />
      <text
        className={compact ? css.cardTextSm : css.cardText}
        x={textX}
        y={two ? c.h / 2 - 1.5 : c.h / 2 + (compact ? 3 : 3.5)}
        style={c.builtin ? { fill: 'var(--text-2)' } : undefined}
      >
        {fit(c.label, maxW, cw)}
      </text>
      {two && (c.sub || c.remain) && (
        <text className={css.cardSub} x={textX} y={c.h / 2 + (compact ? 8 : 10)} style={compact ? { fontSize: 7.5 } : undefined}>
          {fit((c.sub ?? c.remain)!, maxW, compact ? 4.6 : 5.2)}
        </text>
      )}
      {frame && c.remain && (
        <text className={css.cardSub} x={c.w - 7} y={c.h / 2 + 3} textAnchor="end" style={{ fill: SIG.heavy }}>
          {c.remain.replace('busy ', '')}
        </text>
      )}
      {c.progress != null && <rect x={3} y={c.h - 3.2} width={Math.max(0, (c.w - 6) * c.progress)} height={2} rx={1} fill={col} opacity={0.95} />}
      {c.listener && (
        <g
          className={onBuy ? `${css.buyPill} ${css.buyInvite}` : undefined}
          onClick={onBuy}
          role={onBuy ? 'button' : undefined}
          aria-label={onBuy ? 'Click the Buy button' : undefined}
        >
          <rect x={c.w - 44} y={c.h / 2 - 10} width={38} height={20} rx={10} fill="rgba(255,210,63,0.14)" stroke={SIG.warn} strokeWidth={1.2} />
          <text x={c.w - 25} y={c.h / 2 + 3.5} textAnchor="middle" style={{ fontFamily: 'var(--font-sans)', fontSize: 11, fontWeight: 600, fill: SIG.warn }}>
            Buy
          </text>
        </g>
      )}
    </g>
  );
}

/* ------------------------------------------------------------------ */
/* static pieces                                                       */
/* ------------------------------------------------------------------ */

function Glow({ r }: { r: Rect }) {
  return <rect x={r.x - 6} y={r.y - 6} width={r.w + 12} height={r.h + 12} rx={12} fill="none" stroke="var(--accent)" strokeWidth={1.4} strokeDasharray="3 3" />;
}

function StackPanel({ r, empty, compact }: { r: Rect; empty: number; compact: boolean }) {
  const top = r.y + (compact ? 14 : 20);
  return (
    <g>
      <text className={css.caps} x={r.x + 1} y={r.y + (compact ? 8 : 10)} style={compact ? { fontSize: 8 } : undefined}>
        call stack
      </text>
      <rect x={r.x} y={top} width={r.w} height={Math.max(0, r.y + r.h - top)} fill="rgba(143,166,201,0.03)" />
      <path d={`M${r.x},${top} V${r.y + r.h} H${r.x + r.w} V${top}`} fill="none" stroke="rgba(143,166,201,0.45)" strokeWidth={1.2} />
      {empty > 0.01 && (
        <text className={css.capsSm} x={r.x + r.w / 2} y={r.y + r.h - 12} textAnchor="middle" opacity={empty}>
          empty
        </text>
      )}
    </g>
  );
}

function ApisPanel({ r, title, clock, caption, compact }: { r: Rect; title: string; clock: string; caption?: string; compact: boolean }) {
  const ty = r.y + (compact ? 13 : 18);
  return (
    <g>
      <rect x={r.x} y={r.y} width={r.w} height={r.h} rx={10} fill="rgba(69,213,255,0.025)" stroke="rgba(143,166,201,0.32)" strokeDasharray="4 4" />
      {caption && r.h > 150 && (
        <text className={css.capsSm} x={r.x + r.w / 2} y={r.y + r.h - 12} textAnchor="middle" style={{ fill: 'rgba(143,166,201,0.45)' }}>
          {caption}
        </text>
      )}
      <text className={css.caps} x={r.x + 10} y={ty} style={compact ? { fontSize: 8 } : undefined}>
        {title}
      </text>
      <text className={css.cardSub} x={r.x + r.w - 10} y={ty} textAnchor="end" style={{ fill: 'var(--text-2)', fontSize: compact ? 8 : 9.5 }}>
        {clock}
      </text>
    </g>
  );
}

function ShelfPanel({ r, compact }: { r: Rect; compact: boolean }) {
  return (
    <g>
      <rect x={r.x} y={r.y} width={r.w} height={r.h} rx={9} fill="rgba(181,155,255,0.03)" stroke="rgba(181,155,255,0.38)" strokeDasharray="3 4" />
      <text className={css.capsSm} x={r.x + 9} y={r.y + (compact ? 9 : 12)} style={{ fill: '#cdbdff', fontSize: compact ? 7 : 8 }}>
        waiting on a promise
      </text>
    </g>
  );
}

function Belt({ r, label, color, n, active, vt, compact }: { r: Rect; label: string; color: string; n: number; active: boolean; vt: number; compact: boolean }) {
  const pitch = compact ? 16 : 22;
  const off = (vt * 16) % pitch;
  const chev: number[] = [];
  for (let x = r.x + r.w - 10 - off; x > r.x + 10; x -= pitch) chev.push(x);
  const cy = r.y + r.h / 2;
  const k = compact ? 3 : 4;
  return (
    <g>
      <text className={css.caps} x={r.x + 1} y={r.y - (compact ? 4 : 6)} style={{ fill: color, fontSize: compact ? 7.5 : 9 }}>
        {label}
      </text>
      {n > 0 && (
        <text className={css.capsSm} x={r.x + r.w - 1} y={r.y - (compact ? 4 : 6)} textAnchor="end" style={{ fontSize: compact ? 7 : 8 }}>
          {n} waiting
        </text>
      )}
      <rect x={r.x} y={r.y} width={r.w} height={r.h} rx={6} fill={hexA(color, active ? 0.085 : 0.035)} stroke={hexA(color, active ? 0.75 : 0.3)} strokeWidth={active ? 1.4 : 1} />
      <g stroke={hexA(color, 0.2)} strokeWidth={1.2} fill="none" strokeLinecap="round">
        {chev.map((x) => (
          <path key={x.toFixed(1)} d={`M${x + k / 2},${cy - k} L${x - k / 2},${cy} L${x + k / 2},${cy + k}`} />
        ))}
      </g>
      <path d={`M${r.x - 2},${cy - 5} L${r.x - 8},${cy} L${r.x - 2},${cy + 5}`} fill={hexA(color, active ? 0.9 : 0.45)} />
    </g>
  );
}

function LoopRing({ sim, compact }: { sim: EventLoopSim; compact: boolean }) {
  const b = rectOf(sim, 'ring');
  if (!b) return null;
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const r = b.w / 2;
  const m = sim.m;
  const node = m.policy === 'node';
  const names = node ? ['timers', 'pending', 'idle', 'poll', 'check', 'close'] : ['task', 'micro', 'render'];
  const colors = node ? [SIG.req, SIG.dim, SIG.dim, SIG.teal, SIG.pink, SIG.dim] : [SIG.req, SIG.hc, SIG.res];
  const ang = (sim.pointerAngle * Math.PI) / 180;
  const px = cx + r * Math.cos(ang);
  const py = cy + r * Math.sin(ang);
  const note = m.note;
  const words = note.split(' ');
  let l1 = note;
  let l2 = '';
  if (note.length > 11 && words.length > 1) {
    let best = 1;
    let bestD = Infinity;
    for (let i = 1; i < words.length; i++) {
      const d = Math.abs(words.slice(0, i).join(' ').length - words.slice(i).join(' ').length);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    l1 = words.slice(0, best).join(' ');
    l2 = words.slice(best).join(' ');
  }
  const running = m.busy;
  return (
    <g opacity={b.a}>
      <circle cx={cx} cy={cy} r={r + 8} fill="none" stroke="rgba(255,210,63,0.07)" strokeWidth={6} />
      <circle cx={cx} cy={cy} r={r} fill="rgba(8,13,24,0.94)" stroke="rgba(143,166,201,0.4)" strokeWidth={1.2} />
      <circle cx={cx} cy={cy} r={r - (compact ? 5 : 7)} fill="none" stroke="rgba(143,166,201,0.13)" strokeDasharray="2 4" />
      <path d={arcPath(cx, cy, r, ang - 0.95, ang)} stroke={SIG.warn} strokeWidth={compact ? 2 : 2.6} strokeOpacity={0.5} fill="none" strokeLinecap="round" />
      {names.map((nm, i) => {
        const a = (sim.stationAngle(i) * Math.PI) / 180;
        const sx = cx + r * Math.cos(a);
        const sy = cy + r * Math.sin(a);
        const on = i === m.station;
        const c = Math.cos(a);
        const s = Math.sin(a);
        const lr = r + (compact ? 7 : 10);
        const lx = cx + lr * c;
        const ly = cy + lr * s + (s > 0.35 ? (compact ? 8 : 10) : s < -0.35 ? -2 : 3);
        const anchor = c > 0.3 ? 'start' : c < -0.3 ? 'end' : 'middle';
        return (
          <g key={nm}>
            <circle cx={sx} cy={sy} r={on ? (compact ? 4 : 5) : compact ? 2.8 : 3.6} fill={on ? colors[i] : 'var(--ink-1)'} stroke={colors[i]} strokeWidth={1.3} />
            {(!compact || !node || on) && (
              <text className={css.capsSm} x={lx} y={ly} textAnchor={anchor} style={{ fill: on ? colors[i] : 'var(--text-3)', fontSize: compact ? 7 : 8 }}>
                {nm}
              </text>
            )}
          </g>
        );
      })}
      <circle cx={px} cy={py} r={compact ? 6 : 9} fill={SIG.warn} opacity={0.18} />
      <circle cx={px} cy={py} r={compact ? 3 : 4} fill={SIG.warn} />
      <line x1={cx} y1={cy} x2={cx + (r - 9) * Math.cos(ang)} y2={cy + (r - 9) * Math.sin(ang)} stroke={SIG.warn} strokeOpacity={0.35} strokeWidth={1.2} />
      {!compact ? (
        <>
          <text className={css.capsSm} x={cx} y={cy - (l2 ? 9 : 4)} textAnchor="middle" style={{ fill: running ? 'var(--text-3)' : 'var(--text-2)' }}>
            event loop
          </text>
          <text className={css.ringNote} x={cx} y={cy + (l2 ? 4 : 8)} textAnchor="middle">
            {l1}
          </text>
          {l2 && (
            <text className={css.ringNote} x={cx} y={cy + 15} textAnchor="middle">
              {l2}
            </text>
          )}
        </>
      ) : (
        <text className={css.capsSm} x={cx} y={cy + 3} textAnchor="middle" style={{ fontSize: 6.5 }}>
          loop
        </text>
      )}
    </g>
  );
}

function Screen({ sim, r, compact }: { sim: EventLoopSim; r: Rect & { a: number }; compact: boolean }) {
  const m = sim.m;
  const flash = clamp(1 - (sim.vt - m.paintVt) / 0.7, 0, 1);
  const bar = compact ? 11 : 15;
  const x0 = r.x + 10;
  const x1 = r.x + r.w - 10 - (compact ? 12 : 16);
  const bx = (v: number) => x0 + (clamp(v, 0, 150) / 150) * (x1 - x0);
  const sz = compact ? 12 : 16;
  const by = r.y + bar + (r.h - bar) / 2 - sz / 2 + (compact ? 0 : 2);
  return (
    <g opacity={r.a}>
      <rect x={r.x} y={r.y} width={r.w} height={r.h} rx={7} fill="#0d1526" stroke={flash > 0.02 ? hexA(SIG.res, 0.35 + flash * 0.6) : 'rgba(143,166,201,0.35)'} strokeWidth={flash > 0.02 ? 1.6 : 1} />
      <rect x={r.x + 0.5} y={r.y + 0.5} width={r.w - 1} height={bar} rx={6.5} fill="rgba(4,7,13,0.7)" />
      <text className={css.capsSm} x={r.x + 8} y={r.y + bar - (compact ? 3.5 : 4.5)} style={{ fontSize: compact ? 6.5 : 7.5, fill: flash > 0.02 ? SIG.res : 'var(--text-3)' }}>
        {compact ? `frame ${m.frames}` : `screen · frame ${m.frames}`}
      </text>
      <line x1={x0} y1={by + sz / 2} x2={x1 + sz} y2={by + sz / 2} stroke="rgba(143,166,201,0.18)" strokeDasharray="2 3" />
      {m.dom.x !== m.painted.x && <rect x={bx(m.dom.x)} y={by} width={sz} height={sz} rx={3} fill="none" stroke={SIG.res} strokeOpacity={0.55} strokeDasharray="2 2" />}
      <rect x={bx(m.painted.x)} y={by} width={sz} height={sz} rx={3} fill={SIG.res} opacity={0.85} />
      {!compact && (
        <text className={css.cardSub} x={r.x + 10} y={r.y + r.h - 7} style={{ fontSize: 8 }}>
          {m.dom.x !== m.painted.x ? 'DOM changed · not painted yet' : 'left: ' + m.painted.x + 'px'}
        </text>
      )}
    </g>
  );
}

function Tray({ r, compact }: { r: Rect & { a: number }; compact: boolean }) {
  return (
    <g opacity={r.a}>
      <rect x={r.x} y={r.y} width={r.w} height={r.h} rx={8} fill="rgba(75,227,160,0.03)" stroke="rgba(75,227,160,0.35)" strokeDasharray="3 4" />
      <text className={css.capsSm} x={r.x + 8} y={r.y + (compact ? 9 : 12)} style={{ fill: '#8ff3c6', fontSize: compact ? 6.5 : 8 }}>
        {compact ? 'next frame' : 'next frame · rAF callbacks'}
      </text>
    </g>
  );
}

/* ------------------------------------------------------------------ */
/* the machine view                                                    */
/* ------------------------------------------------------------------ */

export function MachineScene({
  sim,
  highlight,
  focus,
  onBuy,
}: {
  sim: EventLoopSim;
  highlight: string | null;
  focus?: string[];
  onBuy?: () => void;
}) {
  const compact = sim.orient === 'portrait';
  const m = sim.m;
  const node = m.policy === 'node';
  const dim = (id: string) => (focus?.length && !focus.includes(id) ? 0.26 : 1);
  const stack = rectOf(sim, 'stack');
  const apis = rectOf(sim, 'apis');
  const shelf = rectOf(sim, 'shelf');
  const screen = rectOf(sim, 'screen');
  const tray = rectOf(sim, 'tray');
  const ring = rectOf(sim, 'ring');
  const serving = sim.serving;
  const picking = !!sim.game?.pending && sim.cfg.predict === 'decide';
  const clock = `t = ${m.ms < 10 ? m.ms.toFixed(2) : m.ms < 100 ? m.ms.toFixed(1) : Math.round(m.ms)} ms`;

  // Leaders: loop stations → the queues they serve.
  const leaders: { d: string; color: string; on: boolean }[] = [];
  if (ring && !node) {
    const cx = ring.x + ring.w / 2;
    const cy = ring.y + ring.h / 2;
    const r = ring.w / 2;
    const at = (i: number) => {
      const a = (sim.stationAngle(i) * Math.PI) / 180;
      return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
    };
    const tq = rectOf(sim, 'q:task');
    const mq = rectOf(sim, 'q:micro');
    if (tq) {
      const p = at(0);
      leaders.push({ d: `M${p.x},${p.y} L${tq.x - 10},${tq.y + tq.h / 2}`, color: SIG.req, on: serving === 'task' && m.station === 0 });
    }
    if (mq) {
      const p = at(1);
      leaders.push({ d: `M${p.x},${p.y} L${mq.x - 10},${mq.y + mq.h / 2}`, color: SIG.hc, on: serving === 'micro' });
    }
    if (screen) {
      const p = at(2);
      const tx = compact ? screen.x + screen.w / 2 : screen.x + 22;
      const ty = compact ? screen.y + screen.h : screen.y;
      leaders.push({ d: `M${p.x},${p.y} L${tx},${ty}`, color: SIG.res, on: serving === 'render' });
    }
  }

  const beltLabel: Partial<Record<QName, string>> = { task: 'task queue', micro: 'microtask queue' };
  return (
    <>
      {apis && (
        <g opacity={apis.a * dim('apis')}>
          <ApisPanel
            r={apis}
            title={node ? (compact ? 'libuv' : 'libuv · OS + thread pool') : compact ? 'web apis' : 'web apis · the browser'}
            caption={compact ? undefined : node ? 'timers · files · sockets, off the JS thread' : 'timers · network · DOM events, off the JS thread'}
            clock={clock}
            compact={compact}
          />
          {highlight === 'apis' && <Glow r={apis} />}
        </g>
      )}
      {shelf && (
        <g opacity={shelf.a * dim('shelf')}>
          <ShelfPanel r={shelf} compact={compact} />
          {highlight === 'shelf' && <Glow r={shelf} />}
        </g>
      )}
      {stack && (
        <g opacity={stack.a * dim('stack')}>
          <StackPanel r={stack} empty={m.stack.length ? 0 : clamp((sim.t - sim.emptySince - 0.35) / 0.3, 0, 1)} compact={compact} />
          {highlight === 'stack' && <Glow r={stack} />}
        </g>
      )}
      {sim.g.belts.map((bg) => {
        const r = rectOf(sim, `q:${bg.q}`);
        if (!r) return null;
        const id = `q:${bg.q}`;
        return (
          <g key={bg.q} opacity={r.a * dim(id)}>
            <Belt r={r} label={node ? bg.label : beltLabel[bg.q] || bg.label} color={Q_COLOR[bg.q]} n={m.queues[bg.q].length} active={serving === bg.q && !m.idle} vt={sim.vt} compact={compact} />
            {highlight === id && <Glow r={r} />}
          </g>
        );
      })}
      <g opacity={dim('ring')}>
        {leaders.map((l, i) => (
          <path key={i} d={l.d} fill="none" stroke={l.on ? l.color : 'rgba(143,166,201,0.2)'} strokeOpacity={l.on ? 0.75 : 1} strokeWidth={l.on ? 1.4 : 1} strokeDasharray={l.on ? undefined : '3 4'} />
        ))}
      </g>
      {tray && (
        <g opacity={dim('screen')}>
          <Tray r={tray} compact={compact} />
        </g>
      )}
      {screen && (
        <g opacity={dim('screen')}>
          <Screen sim={sim} r={screen} compact={compact} />
          {highlight === 'screen' && <Glow r={screen} />}
        </g>
      )}
      {ring && (
        <g opacity={dim('ring')}>
          <LoopRing sim={sim} compact={compact} />
          {highlight === 'ring' && <Glow r={ring} />}
        </g>
      )}
      <g>
        {sim.cards.map((c) => {
          const where = c.role === 'frame' ? 'stack' : c.role === 'api' ? 'apis' : c.role === 'parked' ? 'shelf' : c.q ? `q:${c.q}` : 'stack';
          const k = c.role === 'ghost' ? 1 : dim(where === 'q:raf' ? 'screen' : where);
          return (
            <g key={c.vid} opacity={k}>
              <CardG c={c} compact={compact} onPick={picking ? (id) => sim.pickCard(id) : undefined} onBuy={c.listener ? onBuy : undefined} />
            </g>
          );
        })}
      </g>
      <Flights sim={sim} labels={false} />
      <Effects sim={sim} />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* the browser view: a DevTools-style timeline                         */
/* ------------------------------------------------------------------ */

const BAR_COLOR: Record<BarKind, string> = {
  click: SIG.req,
  long: SIG.heavy,
  chunk: SIG.heavy,
  micro: SIG.hc,
  render: SIG.res,
  message: SIG.req,
  work: SIG.heavy,
  post: SIG.req,
};

/** Input-lane marks for clicks: staggered rows, and delay labels that never collide. */
function clickMarks(clicks: Click[], now: number, win: number, X: (t: number) => number, compact: boolean) {
  const out: { id: number; x0: number; x1: number; row: number; waiting: boolean; label: string | null }[] = [];
  let labelRight = -Infinity;
  const visible = clicks.filter((c) => (c.start ?? now) > now - win);
  for (let i = 0; i < visible.length; i++) {
    const c = visible[i];
    const x0 = X(c.at);
    const x1 = X(c.start ?? now);
    const late = (c.start ?? now) - c.at;
    const text = `${Math.round(late)} ms`;
    const tw = text.length * (compact ? 4.3 : 4.9);
    const lx = (x0 + x1) / 2;
    const fits = late > 60 && x1 - x0 > tw + 8 && lx - tw / 2 > labelRight + 6;
    if (fits) labelRight = lx + tw / 2;
    out.push({ id: c.id, x0, x1, row: (i % 3) - 1, waiting: c.start == null, label: fits ? text : null });
  }
  return out;
}

export function Timeline({ sim }: { sim: EventLoopSim }) {
  const clip = `tl-${useId().replace(/:/g, '')}`;
  const r = rectOf(sim, 'timeline');
  if (!r) return null;
  const th = sim.th;
  const compact = sim.orient === 'portrait';
  const labelW = compact ? 50 : 98;
  const px = r.x + labelW;
  const pw = r.w - labelW - 10;
  const WIN = compact ? 2000 : 3200;
  const now = th.ms;
  const X = (t: number) => px + pw - ((now - t) / WIN) * pw;
  const worker = th.mode === 'worker';
  const laneGap = compact ? 7 : 10;
  const lanes: { id: string; label: string; h: number; y: number }[] = [];
  let y = r.y + (compact ? 20 : 26);
  for (const l of [
    { id: 'input', label: 'input', h: compact ? 22 : 24 },
    { id: 'main', label: compact ? 'main' : 'main thread', h: compact ? 40 : 44 },
    { id: 'frames', label: 'frames', h: compact ? 15 : 16 },
    ...(worker ? [{ id: 'worker', label: 'worker', h: compact ? 24 : 28 }] : []),
  ]) {
    lanes.push({ ...l, y });
    y += l.h + laneGap;
  }
  const lane = (id: string) => lanes.find((l) => l.id === id)!;
  const main = lane('main');
  const inp = lane('input');
  const fr = lane('frames');
  const wk = worker ? lane('worker') : null;
  const slotW = Math.max(1, (16.67 / WIN) * pw - (compact ? 0.4 : 1));
  const grid: number[] = [];
  for (let t = Math.floor((now - WIN) / 500) * 500; t <= now; t += 500) if (t > now - WIN) grid.push(t);
  const longSpans = th.spans.filter((s) => (s.open ? now : s.end) - s.start > 50);
  return (
    <g opacity={r.a}>
      <defs>
        <clipPath id={clip}>
          <rect x={px} y={r.y} width={pw} height={r.h} />
        </clipPath>
        <pattern id={`${clip}-hatch`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="6" stroke="rgba(255,77,106,0.55)" strokeWidth="2.2" />
        </pattern>
      </defs>
      <rect x={r.x} y={r.y} width={r.w} height={r.h} rx={10} fill="rgba(4,7,13,0.55)" stroke="rgba(143,166,201,0.22)" />
      <text className={css.caps} x={r.x + 10} y={r.y + (compact ? 12 : 15)} style={compact ? { fontSize: 7.5 } : undefined}>
        {compact ? 'timeline · last 2 s' : 'performance timeline · last 3 s'}
      </text>
      {lanes.map((l) => (
        <text key={l.id} className={css.capsSm} x={r.x + 10} y={l.y + l.h / 2 + 3} style={{ fontSize: compact ? 6.5 : 8 }}>
          {l.label}
        </text>
      ))}
      <g clipPath={`url(#${clip})`}>
        {grid.map((t) => (
          <g key={t}>
            <line x1={X(t)} y1={r.y + 20} x2={X(t)} y2={r.y + r.h - 14} stroke="rgba(143,166,201,0.08)" />
            {X(t) < px + pw - 40 && (
              <text className={css.capsSm} x={X(t) + 3} y={r.y + r.h - 5} style={{ fontSize: compact ? 6.5 : 7.5, letterSpacing: '0.04em' }}>
                {((t - now) / 1000).toFixed(1)} s
              </text>
            )}
          </g>
        ))}
        {lanes.map((l) => (
          <rect key={l.id} x={px} y={l.y} width={pw} height={l.h} fill="rgba(143,166,201,0.035)" />
        ))}
        {/* main thread */}
        {th.bars
          .filter((b) => b.lane === 'main' && b.end > now - WIN)
          .map((b, i) => {
            const x0 = X(b.start);
            const x1 = Math.max(x0 + (b.kind === 'render' ? 0.8 : 1.2), X(b.end));
            const hh = b.kind === 'render' ? main.h * 0.45 : main.h - 6;
            return <rect key={i} x={x0} y={main.y + (main.h - hh) / 2} width={x1 - x0} height={hh} rx={b.kind === 'render' ? 0 : 2} fill={BAR_COLOR[b.kind]} opacity={b.kind === 'render' ? 0.75 : 0.82} />;
          })}
        {longSpans.map((s, i) => {
          const end = s.open ? now : s.end;
          const x0 = X(s.start);
          const x50 = X(s.start + 50);
          const x1 = X(end);
          return (
            <g key={i}>
              <rect x={x50} y={main.y + 3} width={Math.max(0, x1 - x50)} height={main.h - 6} fill={`url(#${clip}-hatch)`} />
              <path d={`M${x0},${main.y - 1} h7 l-7,7 z`} fill={SIG.err} />
              {x1 - x0 > 110 && x1 > px + 130 && (
                <text className={css.cardSub} x={Math.max(px + 4, x0 + 10)} y={main.y - 3} style={{ fill: '#ff9aab', fontSize: compact ? 7 : 8.5 }}>
                  long task · {Math.round(end - s.start)} ms
                </text>
              )}
            </g>
          );
        })}
        {/* frames */}
        {th.slots
          .filter((s) => s.t > now - WIN)
          .map((s, i) => (
            <rect key={i} x={X(s.t)} y={fr.y + 1} width={slotW} height={fr.h - 2} rx={1} fill={s.state === 'painted' ? SIG.res : s.state === 'dropped' ? SIG.err : 'rgba(143,166,201,0.3)'} opacity={s.state === 'painted' ? 0.7 : 0.85} />
          ))}
        {/* worker */}
        {wk &&
          th.bars
            .filter((b) => b.lane === 'worker' && b.end > now - WIN)
            .map((b, i) => <rect key={i} x={X(b.start)} y={wk.y + 3} width={Math.max(1, X(b.end) - X(b.start))} height={wk.h - 6} rx={2} fill={SIG.heavy} opacity={0.8} />)}
        {/* input: when you clicked, and how long until the handler ran */}
        {clickMarks(th.clicks, now, WIN, X, compact).map((k) => {
          const mid = inp.y + inp.h / 2 + k.row * (compact ? 3 : 4);
          return (
            <g key={k.id}>
              <line x1={k.x0} y1={mid} x2={k.x1} y2={mid} stroke={SIG.warn} strokeOpacity={0.7} strokeDasharray={k.waiting ? '3 3' : undefined} />
              <path d={`M${k.x0 - 4},${inp.y + 1} h8 l-4,6 z`} fill={SIG.warn} />
              {!k.waiting && <circle cx={k.x1} cy={mid} r={2.6} fill={SIG.req} />}
              {k.label && (
                <text className={css.cardSub} x={(k.x0 + k.x1) / 2} y={inp.y + inp.h - 2} textAnchor="middle" style={{ fill: SIG.warn, fontSize: compact ? 7 : 8 }}>
                  {k.label}
                </text>
              )}
            </g>
          );
        })}
      </g>
      <line x1={px + pw} y1={r.y + 18} x2={px + pw} y2={r.y + r.h - 12} stroke={SIG.warn} strokeOpacity={0.5} strokeDasharray="2 3" />
    </g>
  );
}

