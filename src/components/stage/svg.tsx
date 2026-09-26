import type { ReactNode } from 'react';
import { SIG } from '@/lib/sim/colors';
import type { Box, Sim } from '@/lib/sim/Sim';
import css from './stage.module.css';

const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(' ');

/* ------------------------------------------------------------------ */
/* Shared <defs>: include once per stage (StageFrame does this)        */
/* ------------------------------------------------------------------ */

export function KitDefs() {
  return (
    <defs>
      <pattern id="kit-hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <line x1="0" y1="0" x2="0" y2="7" stroke="rgba(255,77,106,0.32)" strokeWidth="2" />
      </pattern>
      <pattern id="kit-hatch-dim" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <line x1="0" y1="0" x2="0" y2="7" stroke="rgba(143,166,201,0.16)" strokeWidth="2" />
      </pattern>
      <linearGradient id="kit-violet" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="rgba(181,155,255,0.16)" />
        <stop offset="1" stopColor="rgba(181,155,255,0.05)" />
      </linearGradient>
      <linearGradient id="kit-cyan" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="rgba(69,213,255,0.14)" />
        <stop offset="1" stopColor="rgba(69,213,255,0.04)" />
      </linearGradient>
    </defs>
  );
}

export function RegistrationMarks({ w, h }: { w: number; h: number }) {
  const m = 10;
  const l = 14;
  const corners: [number, number, number, number][] = [
    [m, m, 1, 1],
    [w - m, m, -1, 1],
    [m, h - m, 1, -1],
    [w - m, h - m, -1, -1],
  ];
  return (
    <g aria-hidden>
      {corners.map(([x, y, sx, sy], i) => (
        <path key={i} className={css.reg} d={`M${x},${y + sy * l} L${x},${y} L${x + sx * l},${y}`} />
      ))}
    </g>
  );
}

/* ------------------------------------------------------------------ */
/* Flow layer: wires, flights (packets), effects                       */
/* ------------------------------------------------------------------ */

export function Wires({ sim }: { sim: Sim }) {
  return (
    <g>
      {sim.wireViews().map((w) => (
        <g key={w.key} opacity={w.alpha}>
          <path d={w.d} className={css.wire} data-state={w.state} style={w.color ? { stroke: w.color } : undefined} />
          {w.flash > 0.01 && <path d={w.d} className={css.wireFlash} opacity={w.flash * 0.75} />}
        </g>
      ))}
    </g>
  );
}

/**
 * Everything in flight. Pass onFlightClick to make packets clickable
 * (e.g. "click a packet to drop it").
 */
export function Flights({ sim, onFlightClick, labels = true }: { sim: Sim; onFlightClick?: (id: number) => void; labels?: boolean }) {
  return (
    <g>
      {sim.flightViews().map((p) => {
        const clickable = !!onFlightClick;
        const body =
          p.shape === 'envelope' ? (
            <g transform={`translate(${p.x},${p.y})`}>
              <rect x={-6.5} y={-4.8} width={13} height={9.6} rx={1.5} fill={p.color} />
              <path d="M-6.5,-4.3 L0,0.8 L6.5,-4.3" fill="none" stroke="rgba(5,8,15,0.75)" strokeWidth={1.1} />
            </g>
          ) : p.shape === 'square' ? (
            <rect x={p.x - p.r} y={p.y - p.r} width={p.r * 2} height={p.r * 2} rx={1.5} fill={p.color} transform={`rotate(${(p.angle * 180) / Math.PI} ${p.x} ${p.y})`} />
          ) : (
            <circle cx={p.x} cy={p.y} r={p.r} fill={p.color} />
          );
        return (
          <g
            key={p.id}
            className={clickable ? css.clickable : undefined}
            onClick={clickable ? () => onFlightClick(p.id) : undefined}
            role={clickable ? 'button' : undefined}
            aria-label={clickable ? `Packet ${p.label ?? ''}` : undefined}
          >
            {clickable && <circle cx={p.x} cy={p.y} r={14} fill="transparent" />}
            {p.trail && <line className={css.trail} x1={p.tx} y1={p.ty} x2={p.x} y2={p.y} stroke={p.color} strokeWidth={p.r * 1.25} opacity={0.26} />}
            {p.r >= 3.5 && <circle cx={p.x} cy={p.y} r={p.r * 2.5} fill={p.color} opacity={0.13} />}
            {body}
            {labels && p.label && (
              <FlightLabel x={p.x} y={p.y - p.r - 9} text={p.label} color={p.color} />
            )}
          </g>
        );
      })}
    </g>
  );
}

function FlightLabel({ x, y, text, color }: { x: number; y: number; text: string; color: string }) {
  const w = text.length * 6.1 + 10;
  return (
    <g transform={`translate(${x},${y})`}>
      <rect x={-w / 2} y={-8} width={w} height={14} rx={7} fill="rgba(7,11,20,0.9)" stroke={color} strokeOpacity={0.7} />
      <text className={css.flightLabel} x={0} y={2.5} textAnchor="middle" fill={color}>
        {text}
      </text>
    </g>
  );
}

export function Effects({ sim }: { sim: Sim }) {
  return (
    <g>
      {sim.effectViews().map((e, i) => {
        if (e.kind === 'ring') {
          const r = (10 + e.k * 26) * e.size;
          return <circle key={i} cx={e.x} cy={e.y} r={r} fill="none" stroke={e.color} strokeWidth={2.2 * (1 - e.k)} opacity={1 - e.k} />;
        }
        if (e.kind === 'x') {
          const s = (5 + e.k * 3) * e.size;
          return (
            <g key={i} transform={`translate(${e.x},${e.y})`} opacity={1 - e.k} stroke={e.color} strokeWidth={2} strokeLinecap="round">
              <line x1={-s} y1={-s} x2={s} y2={s} />
              <line x1={-s} y1={s} x2={s} y2={-s} />
            </g>
          );
        }
        return null;
      })}
    </g>
  );
}

/* ------------------------------------------------------------------ */
/* Node shapes                                                         */
/* ------------------------------------------------------------------ */

export type NodeState = 'normal' | 'down' | 'hot' | 'ok' | 'dim';

interface NodeCommon {
  box: Box;
  /** Dim everything outside the current focus */
  dim?: boolean;
  /** Dashed markup ring (hovered term in the narration) */
  glow?: boolean;
  state?: NodeState;
  /** Clickable with a pulsing invitation (prediction answers) */
  pickable?: boolean;
  onClick?: () => void;
  children?: ReactNode;
}

function Frame({ box, dim, glow, state = 'normal', pickable, onClick, children, rx }: NodeCommon & { rx: number }) {
  const clickable = !!onClick;
  return (
    <g
      className={cx(css.node, clickable && css.clickable, pickable && css.pickable)}
      data-state={state}
      transform={`translate(${box.x - box.w / 2},${box.y - box.h / 2})`}
      opacity={box.alpha * (dim ? 0.28 : 1)}
      onClick={onClick}
      role={clickable ? 'button' : undefined}
      aria-label={clickable ? box.id : undefined}
    >
      {clickable && <rect x={-8} y={-8} width={box.w + 16} height={box.h + 16} fill="transparent" />}
      {glow && <rect x={-6} y={-6} width={box.w + 12} height={box.h + 12} rx={rx + 4} fill="none" stroke="var(--accent)" strokeWidth={1.4} strokeDasharray="3 3" />}
      {children}
      {state === 'down' && <rect width={box.w} height={box.h} rx={rx} fill="url(#kit-hatch)" pointerEvents="none" />}
    </g>
  );
}

/** The workhorse node: a card with a title, a subtitle, an optional LED and icon. */
export function NodeCard({
  title,
  sub,
  kicker,
  led,
  icon,
  tone,
  ...rest
}: NodeCommon & {
  title: string;
  sub?: string;
  /** Small caps label drawn above the card */
  kicker?: { text: string; color?: string };
  led?: 'up' | 'down' | 'busy' | null;
  icon?: ReactNode;
  /** Accent color for the border (e.g. SIG.hc for control-plane boxes) */
  tone?: string;
}) {
  const { box } = rest;
  const ix = icon ? 34 : 12;
  const narrow = box.w < 110;
  return (
    <Frame {...rest} rx={10}>
      {kicker && (
        <text className={css.caps} x={0} y={-6} style={{ fill: kicker.color ?? 'var(--text-3)' }}>
          {kicker.text}
        </text>
      )}
      <rect className={css.card} width={box.w} height={box.h} rx={10} style={tone ? { stroke: tone } : undefined} />
      <rect className={css.cardInner} x={3.5} y={3.5} width={Math.max(0, box.w - 7)} height={Math.max(0, box.h - 7)} rx={7.5} />
      {icon && <g transform={`translate(18,${box.h / 2})`}>{icon}</g>}
      <text className={css.name} x={ix} y={sub ? box.h / 2 - 2 : box.h / 2 + 4} style={narrow ? { fontSize: 11.5 } : undefined}>
        {title}
      </text>
      {sub && (
        <text className={css.mono} x={ix} y={box.h / 2 + 11} style={narrow ? { fontSize: 9 } : undefined}>
          {sub}
        </text>
      )}
      {led && <circle cx={box.w - 11} cy={11} r={3.2} fill={led === 'down' ? SIG.err : led === 'busy' ? SIG.warn : SIG.res} />}
      {rest.children}
    </Frame>
  );
}

/** A person or device, drawn with a colored avatar initial. */
export function ClientCard({ name, sub, color, pulse, ...rest }: NodeCommon & { name: string; sub?: string; color: string; pulse?: { color: string; k: number } | null }) {
  const { box } = rest;
  const narrow = box.w < 118;
  const ar = narrow ? 9 : 11;
  const ax = narrow ? 15 : 20;
  const tx = ax + ar + 8;
  const showSub = sub && box.w >= 100;
  return (
    <Frame {...rest} rx={9}>
      <rect className={css.card} width={box.w} height={box.h} rx={9} />
      <circle cx={ax} cy={box.h / 2} r={ar} fill={color} fillOpacity={0.14} stroke={color} strokeWidth={1.2} />
      <text x={ax} y={box.h / 2 + 4} textAnchor="middle" fill={color} style={{ fontFamily: 'var(--font-sans)', fontSize: 11, fontWeight: 600 }}>
        {name[0]}
      </text>
      {pulse && <circle cx={ax} cy={box.h / 2} r={ar + pulse.k * 12} fill="none" stroke={pulse.color} strokeWidth={2.2 * (1 - pulse.k)} opacity={1 - pulse.k} />}
      <text className={css.name} x={tx} y={showSub ? box.h / 2 - 2 : box.h / 2 + 4} style={narrow ? { fontSize: 11.5 } : undefined}>
        {name}
      </text>
      {showSub && (
        <text className={css.mono} x={tx} y={box.h / 2 + 11} style={narrow ? { fontSize: 8.5 } : undefined}>
          {sub}
        </text>
      )}
      {rest.children}
    </Frame>
  );
}

/** A database / store drawn as a cylinder. Children render inside, below the title. */
export function Cylinder({ title, sub, tone = 'rgba(143,166,201,0.6)', ...rest }: NodeCommon & { title: string; sub?: string; tone?: string }) {
  const { box } = rest;
  const ry = Math.min(8, box.h * 0.14);
  return (
    <Frame {...rest} rx={8}>
      <path
        d={`M0,${ry} A${box.w / 2},${ry} 0 0,1 ${box.w},${ry} V${box.h - ry} A${box.w / 2},${ry} 0 0,1 0,${box.h - ry} Z`}
        fill="var(--node-fill)"
        stroke={tone}
        strokeWidth={1.2}
        className={css.card}
        style={{ stroke: tone }}
      />
      <ellipse cx={box.w / 2} cy={ry} rx={box.w / 2} ry={ry} fill="rgba(143,166,201,0.06)" stroke={tone} strokeWidth={1.2} />
      <text className={css.monoStrong} x={box.w / 2} y={ry + 19} textAnchor="middle">
        {title}
      </text>
      {sub && (
        <text className={css.mono} x={box.w / 2} y={ry + 32} textAnchor="middle">
          {sub}
        </text>
      )}
      {rest.children}
    </Frame>
  );
}

export interface RackUnit {
  busy: boolean;
  /** 0..1 progress of the work in this slot */
  p: number;
  color: string;
}

/** A server drawn as a rack: one bar per worker slot that fills as it works. */
export function Rack({ title, sub, units, ...rest }: NodeCommon & { title: string; sub?: string; units: RackUnit[] }) {
  const { box } = rest;
  const header = 21;
  const gap = 3;
  const uh = Math.max(6, Math.min(11, (box.h - header - 7 - gap * (units.length - 1)) / Math.max(1, units.length)));
  const bw = box.w - 16;
  const down = rest.state === 'down';
  return (
    <Frame {...rest} rx={6}>
      <rect className={css.card} width={box.w} height={box.h} rx={6} />
      <circle cx={11} cy={header / 2 + 1} r={3.2} fill={down ? SIG.err : SIG.res} />
      <text className={css.monoStrong} x={21} y={header / 2 + 5}>
        {title}
      </text>
      {sub && box.w >= 130 && (
        <text className={css.mono} x={box.w - 9} y={header / 2 + 5} textAnchor="end">
          {sub}
        </text>
      )}
      {units.map((u, i) => (
        <g key={i} transform={`translate(8,${header + i * (uh + gap)})`}>
          <rect className={css.unit} width={bw} height={uh} rx={2} />
          <circle cx={6} cy={uh / 2} r={2} fill={u.busy ? u.color : 'rgba(143,166,201,0.22)'} />
          {u.busy && <rect x={12} y={2} width={Math.max(1.5, (bw - 16) * u.p)} height={uh - 4} rx={1.5} fill={u.color} opacity={0.85} />}
        </g>
      ))}
      {rest.children}
    </Frame>
  );
}

/* ------------------------------------------------------------------ */
/* Annotation helpers                                                  */
/* ------------------------------------------------------------------ */

/** Small caps label anywhere on the drawing. */
export function Label({ x, y, text, color, anchor = 'start', size }: { x: number; y: number; text: string; color?: string; anchor?: 'start' | 'middle' | 'end'; size?: number }) {
  return (
    <text className={css.caps} x={x} y={y} textAnchor={anchor} style={{ fill: color ?? 'var(--text-3)', fontSize: size }}>
      {text}
    </text>
  );
}

/** Dashed boundary line with labels on either side (e.g. public internet | private network). */
export function Boundary({ orient, at, length, a, b }: { orient: 'vertical' | 'horizontal'; at: number; length: number; a: string; b: string }) {
  if (orient === 'vertical') {
    return (
      <g>
        <line x1={at} y1={26} x2={at} y2={length - 26} stroke="rgba(143,166,201,0.28)" strokeDasharray="2 6" />
        <text className={css.caps} transform={`translate(${at - 8},104) rotate(90)`} style={{ fill: 'rgba(143,166,201,0.62)', fontSize: 9.5 }}>
          ← {a}
        </text>
        <text className={css.caps} transform={`translate(${at + 16},104) rotate(90)`} style={{ fill: 'rgba(143,166,201,0.62)', fontSize: 9.5 }}>
          {b} →
        </text>
      </g>
    );
  }
  return (
    <g>
      <line x1={14} y1={at} x2={length - 14} y2={at} stroke="rgba(143,166,201,0.28)" strokeDasharray="2 6" />
      <text className={css.caps} x={14} y={at - 8} style={{ fill: 'rgba(143,166,201,0.62)', fontSize: 9.5 }}>
        ↑ {a}
      </text>
      <text className={css.caps} x={14} y={at + 16} style={{ fill: 'rgba(143,166,201,0.62)', fontSize: 9.5 }}>
        ↓ {b}
      </text>
    </g>
  );
}

/** A straight arrow, for static diagram annotations. */
export function Arrow({ x1, y1, x2, y2, color = 'rgba(143,166,201,0.5)', dashed, width = 1.3 }: { x1: number; y1: number; x2: number; y2: number; color?: string; dashed?: boolean; width?: number }) {
  const a = Math.atan2(y2 - y1, x2 - x1);
  const h = 6;
  const p1 = `${x2 - h * Math.cos(a - 0.45)},${y2 - h * Math.sin(a - 0.45)}`;
  const p2 = `${x2 - h * Math.cos(a + 0.45)},${y2 - h * Math.sin(a + 0.45)}`;
  return (
    <g stroke={color} strokeWidth={width} fill="none" strokeLinecap="round" strokeLinejoin="round">
      <line x1={x1} y1={y1} x2={x2} y2={y2} strokeDasharray={dashed ? '3 4' : undefined} />
      <polyline points={`${p1} ${x2},${y2} ${p2}`} />
    </g>
  );
}
