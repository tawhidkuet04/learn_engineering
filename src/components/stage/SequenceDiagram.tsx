import { useId } from 'react';
import { SIG } from '@/lib/sim/colors';
import { clamp, lerp } from '@/lib/sim/geometry';
import css from './stage.module.css';

export interface SeqActor {
  id: string;
  label: string;
  sub?: string;
  color?: string;
}

export interface SeqMessage {
  id: string | number;
  from: string;
  to: string;
  /** Sent at (simulated seconds) */
  t0: number;
  /** Arrives at */
  t1: number;
  label: string;
  color?: string;
  /** Lost at this fraction of the trip */
  lostAt?: number | null;
  dashed?: boolean;
  /** Draw thicker, e.g. the message the narration is talking about */
  hot?: boolean;
}

export interface SeqNote {
  id: string | number;
  actor: string;
  t: number;
  text: string;
  color?: string;
}

/** A bar on a lifeline: work in progress, a running timer, an open connection… */
export interface SeqSpan {
  id: string | number;
  actor: string;
  t0: number;
  /** null = still running */
  t1: number | null;
  label?: string;
  color?: string;
}

/**
 * A live sequence diagram (the way TCP, TLS and friends are drawn in RFCs).
 * Time runs downward; messages draw themselves as they travel and stay as
 * history. When the diagram fills up it scrolls to keep `now` in view.
 */
export function SequenceDiagram({
  x,
  y,
  w,
  h,
  actors,
  messages,
  notes = [],
  spans = [],
  now,
  origin = 0,
  pxPerSec = 70,
  timeLabel,
  onMessageClick,
  dimOthers,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  actors: SeqActor[];
  messages: SeqMessage[];
  notes?: SeqNote[];
  spans?: SeqSpan[];
  now: number;
  /** Time at the top of the diagram */
  origin?: number;
  pxPerSec?: number;
  /** Label for the playhead line, e.g. (t) => `${Math.round(t * 40)} ms` */
  timeLabel?: (t: number) => string;
  /** Makes in-flight messages clickable (e.g. to drop them) */
  onMessageClick?: (id: string | number) => void;
  /** Fade messages that aren't hot */
  dimOthers?: boolean;
}) {
  const clipId = `seq-${useId().replace(/:/g, '')}`;
  const headerH = 42;
  const bodyTop = y + headerH + 8;
  const bodyH = h - headerH - 8;
  const colW = w / Math.max(1, actors.length);
  const ax = new Map(actors.map((a, i) => [a.id, x + colW * (i + 0.5)]));
  const scroll = Math.max(0, (now - origin) * pxPerSec - (bodyH - 56));
  const yOf = (t: number) => bodyTop + 16 + (t - origin) * pxPerSec - scroll;
  const cardW = Math.min(150, colW - 16);

  return (
    <g>
      <defs>
        <clipPath id={clipId}>
          <rect x={x - 40} y={bodyTop} width={w + 80} height={bodyH} />
        </clipPath>
      </defs>

      {actors.map((a) => {
        const cxA = ax.get(a.id)!;
        return (
          <g key={a.id}>
            <line x1={cxA} y1={y + headerH} x2={cxA} y2={y + h} stroke="rgba(143,166,201,0.3)" strokeDasharray="3 5" />
            <g transform={`translate(${cxA - cardW / 2},${y})`}>
              <rect className={css.card} width={cardW} height={headerH} rx={9} />
              <rect x={10} y={0} width={cardW - 20} height={2} rx={1} fill={a.color ?? SIG.line} opacity={0.9} />
              <text className={css.name} x={cardW / 2} y={a.sub ? 18 : 25} textAnchor="middle">
                {a.label}
              </text>
              {a.sub && (
                <text className={css.mono} x={cardW / 2} y={31} textAnchor="middle">
                  {a.sub}
                </text>
              )}
            </g>
          </g>
        );
      })}

      <g clipPath={`url(#${clipId})`}>
        {spans.map((s) => {
          const sx = ax.get(s.actor);
          if (sx == null || s.t0 > now) return null;
          const y0 = yOf(s.t0);
          const y1 = yOf(Math.min(s.t1 ?? now, now));
          const color = s.color ?? SIG.hc;
          return (
            <g key={s.id}>
              <rect x={sx - 4} y={y0} width={8} height={Math.max(1, y1 - y0)} rx={2} fill={color} opacity={0.28} stroke={color} strokeOpacity={0.7} />
              {s.label && (
                <text className={css.mono} x={sx + 9} y={y0 + 10} style={{ fill: color, fontSize: 9 }}>
                  {s.label}
                </text>
              )}
            </g>
          );
        })}

        {messages.map((m) => {
          if (m.t0 > now) return null;
          const x1 = ax.get(m.from);
          const x2 = ax.get(m.to);
          if (x1 == null || x2 == null) return null;
          const y1 = yOf(m.t0);
          const y2 = yOf(m.t1);
          const k = clamp((now - m.t0) / Math.max(1e-6, m.t1 - m.t0), 0, 1);
          const lost = m.lostAt != null && k >= m.lostAt;
          const kk = lost ? (m.lostAt as number) : k;
          const hx = lerp(x1, x2, kk);
          const hy = lerp(y1, y2, kk);
          const color = lost ? SIG.err : (m.color ?? SIG.req);
          const done = k >= 1 && !lost;
          const faded = dimOthers && !m.hot;
          const ang = Math.atan2(y2 - y1, x2 - x1);
          const midX = (x1 + x2) / 2;
          const midY = (y1 + y2) / 2;
          return (
            <g key={m.id} opacity={faded ? 0.35 : 1}>
              <line
                x1={x1}
                y1={y1}
                x2={hx}
                y2={hy}
                stroke={color}
                strokeWidth={m.hot ? 2.2 : 1.5}
                strokeDasharray={m.dashed || lost ? '4 4' : undefined}
                strokeLinecap="round"
                opacity={0.9}
              />
              {done && (
                <polyline
                  points={`${x2 - 8 * Math.cos(ang - 0.4)},${y2 - 8 * Math.sin(ang - 0.4)} ${x2},${y2} ${x2 - 8 * Math.cos(ang + 0.4)},${y2 - 8 * Math.sin(ang + 0.4)}`}
                  fill="none"
                  stroke={color}
                  strokeWidth={1.6}
                  strokeLinejoin="round"
                />
              )}
              {!done && !lost && (
                <g className={onMessageClick ? css.clickable : undefined} onClick={onMessageClick ? () => onMessageClick(m.id) : undefined}>
                  {onMessageClick && <circle cx={hx} cy={hy} r={14} fill="transparent" />}
                  <circle cx={hx} cy={hy} r={11} fill={color} opacity={0.14} />
                  <circle cx={hx} cy={hy} r={4.6} fill={color} />
                </g>
              )}
              {lost && (
                <g transform={`translate(${hx},${hy})`} stroke={SIG.err} strokeWidth={2} strokeLinecap="round">
                  <line x1={-5} y1={-5} x2={5} y2={5} />
                  <line x1={-5} y1={5} x2={5} y2={-5} />
                </g>
              )}
              <text
                x={midX}
                y={midY - 7}
                textAnchor="middle"
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10.5,
                  fontWeight: 500,
                  fill: color,
                  paintOrder: 'stroke',
                  stroke: 'var(--ink-1)',
                  strokeWidth: 4,
                  strokeLinejoin: 'round',
                }}
              >
                {m.label}
              </text>
            </g>
          );
        })}

        {notes.map((n) => {
          const nx = ax.get(n.actor);
          if (nx == null || n.t > now) return null;
          const ny = yOf(n.t);
          const color = n.color ?? SIG.text2;
          const tw = n.text.length * 6 + 12;
          const left = [...ax.values()].indexOf(nx) === 0;
          const bx = left ? nx - tw - 10 : nx + 10;
          return (
            <g key={n.id}>
              <rect x={bx} y={ny - 9} width={tw} height={17} rx={4} fill="rgba(7,11,20,0.92)" stroke={color} strokeOpacity={0.55} />
              <text x={bx + tw / 2} y={ny + 3.5} textAnchor="middle" style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, fill: color, letterSpacing: '0.04em' }}>
                {n.text}
              </text>
            </g>
          );
        })}

        <line x1={x} y1={yOf(now)} x2={x + w} y2={yOf(now)} stroke="rgba(255,210,63,0.28)" strokeDasharray="2 5" />
        {timeLabel && (
          <text x={x + 2} y={yOf(now) - 5} style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, fill: 'rgba(255,210,63,0.75)' }}>
            {timeLabel(now)}
          </text>
        )}
      </g>
    </g>
  );
}
