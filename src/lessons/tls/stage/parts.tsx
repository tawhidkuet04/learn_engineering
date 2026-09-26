import type { ReactNode } from 'react';
import { SIG } from '@/lib/sim/colors';
import type { Box } from '@/lib/sim/Sim';
import type { CertData, CertRowKey } from '../sim/data';
import css from '../tls.module.css';

/* ------------------------------------------------------------------ */
/* Glyphs (centered on x, y)                                           */
/* ------------------------------------------------------------------ */

export function Lock({ x, y, s = 1, color = SIG.res, open = false }: { x: number; y: number; s?: number; color?: string; open?: boolean }) {
  return (
    <g transform={`translate(${x},${y}) scale(${s})`}>
      <path d={open ? 'M-3,-1.2 V-3.8 a3,3 0 0 1 6,0 V-3' : 'M-3,-1.2 V-3.6 a3,3 0 0 1 6,0 V-1.2'} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" />
      <rect x={-4.6} y={-1.4} width={9.2} height={7.2} rx={1.6} fill={color} />
    </g>
  );
}

export function KeyGlyph({ x, y, s = 1, color = SIG.lime }: { x: number; y: number; s?: number; color?: string }) {
  return (
    <g transform={`translate(${x},${y}) scale(${s})`} stroke={color} strokeWidth={1.5} strokeLinecap="round" fill="none">
      <circle cx={-4} cy={0} r={2.9} />
      <path d="M-1.1,0 H6.4 M4.2,0 V2.6 M6.4,0 V2.2" />
    </g>
  );
}

export function Eye({ x, y, s = 1, color = SIG.err }: { x: number; y: number; s?: number; color?: string }) {
  return (
    <g transform={`translate(${x},${y}) scale(${s})`}>
      <path d="M-7,0 Q0,-6.2 7,0 Q0,6.2 -7,0 Z" fill="none" stroke={color} strokeWidth={1.3} />
      <circle r={2.2} fill={color} />
    </g>
  );
}

export function Wifi({ x, y, s = 1, color = SIG.line }: { x: number; y: number; s?: number; color?: string }) {
  return (
    <g transform={`translate(${x},${y}) scale(${s})`} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round">
      <path d="M-7.5,-2 a10.5,10.5 0 0 1 15,0" />
      <path d="M-4.8,1 a6.6,6.6 0 0 1 9.6,0" />
      <path d="M-2.2,3.8 a3.1,3.1 0 0 1 4.4,0" />
      <circle cx={0} cy={6.4} r={0.9} fill={color} />
    </g>
  );
}

export function ServerGlyph({ x, y, color = SIG.line }: { x: number; y: number; color?: string }) {
  return (
    <g transform={`translate(${x},${y})`} fill="none" stroke={color} strokeWidth={1.2}>
      <rect x={-7} y={-7.5} width={14} height={6.5} rx={1.5} />
      <rect x={-7} y={1} width={14} height={6.5} rx={1.5} />
      <circle cx={-3.8} cy={-4.2} r={0.9} fill={SIG.res} stroke="none" />
      <circle cx={-3.8} cy={4.3} r={0.9} fill={SIG.res} stroke="none" />
    </g>
  );
}

export function RouterGlyph({ x, y, color = SIG.line }: { x: number; y: number; color?: string }) {
  return (
    <g transform={`translate(${x},${y})`} fill="none" stroke={color} strokeWidth={1.2} strokeLinecap="round">
      <circle r={7} />
      <path d="M-4,0 H4 M2,-2 L4,0 L2,2 M0,-4 V4" />
    </g>
  );
}

export function Tick({ x, y, s = 1, color = SIG.res }: { x: number; y: number; s?: number; color?: string }) {
  return <path transform={`translate(${x},${y}) scale(${s})`} d="M-4,0 L-1.2,3 L4.2,-3.4" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />;
}

export function Cross({ x, y, s = 1, color = SIG.err }: { x: number; y: number; s?: number; color?: string }) {
  return (
    <g transform={`translate(${x},${y}) scale(${s})`} stroke={color} strokeWidth={1.8} strokeLinecap="round">
      <line x1={-3.4} y1={-3.4} x2={3.4} y2={3.4} />
      <line x1={-3.4} y1={3.4} x2={3.4} y2={-3.4} />
    </g>
  );
}

export function Warn({ x, y, s = 1, color = SIG.err }: { x: number; y: number; s?: number; color?: string }) {
  return (
    <g transform={`translate(${x},${y}) scale(${s})`}>
      <path d="M0,-5.4 L5.8,4.6 H-5.8 Z" fill="none" stroke={color} strokeWidth={1.4} strokeLinejoin="round" />
      <line x1={0} y1={-1.8} x2={0} y2={1.2} stroke={color} strokeWidth={1.4} strokeLinecap="round" />
      <circle cx={0} cy={3} r={0.8} fill={color} />
    </g>
  );
}

/** Dashed markup ring for hovered narration terms. */
export function GlowRing({ w, h, rx = 10, pad = 6 }: { w: number; h: number; rx?: number; pad?: number }) {
  return <rect x={-pad} y={-pad} width={w + pad * 2} height={h + pad * 2} rx={rx + 4} fill="none" stroke="var(--accent)" strokeWidth={1.4} strokeDasharray="3 3" />;
}

/* ------------------------------------------------------------------ */
/* Browser window                                                      */
/* ------------------------------------------------------------------ */

export interface BrowserLook {
  url: string;
  secure: 'none' | 'lock' | 'warn' | 'pending';
  title?: string;
  lines?: string[];
  alert?: { text: string; tone: 'err' | 'ok' } | null;
  error?: { title: string; line: string; code?: string } | null;
  /** Extra drawing in the title bar, right side (e.g. key chips) */
  badge?: ReactNode;
}

const fit = (s: string, px: number, charW: number) => {
  const n = Math.max(3, Math.floor(px / charW));
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
};

export function BrowserNode({ box, look, dim, glow, compact }: { box: Box; look: BrowserLook; dim?: boolean; glow?: boolean; compact?: boolean }) {
  const { w, h } = box;
  const titleH = compact ? 12 : 16;
  const addrY = titleH + (compact ? 3 : 5);
  const addrH = compact ? 16 : 19;
  const pageY = addrY + addrH + (compact ? 6 : 10);
  const err = !!look.error;
  const frame = err ? 'rgba(255,77,106,0.85)' : undefined;
  const lineH = compact ? 11.5 : 14;
  const room = Math.max(0, Math.floor((h - pageY - (compact ? 14 : 20)) / lineH));
  const lines = (look.lines ?? []).slice(0, room);
  const iconX = 7 + (compact ? 9 : 11);
  const cy = addrY + addrH / 2;
  const textX = look.secure === 'warn' ? iconX + (compact ? 58 : 66) : look.secure === 'none' ? iconX - 4 : iconX + 9;
  const charW = compact ? 5.3 : 6.1;
  return (
    <g className={css.node} transform={`translate(${box.x - w / 2},${box.y - h / 2})`} opacity={box.alpha * (dim ? 0.28 : 1)}>
      {glow && <GlowRing w={w} h={h} rx={9} />}
      <rect className={css.card} width={w} height={h} rx={9} style={frame ? { stroke: frame } : undefined} />
      {[0, 1, 2].map((i) => (
        <circle key={i} cx={9 + i * (compact ? 6 : 7)} cy={titleH / 2 + 1} r={compact ? 1.6 : 2.1} fill="rgba(143,166,201,0.35)" />
      ))}
      <line x1={0} y1={titleH + 1} x2={w} y2={titleH + 1} stroke="rgba(143,166,201,0.14)" />
      {look.badge && <g transform={`translate(${w - 8},${titleH / 2 + 1})`}>{look.badge}</g>}
      <rect x={7} y={addrY} width={w - 14} height={addrH} rx={addrH / 2} fill="rgba(143,166,201,0.06)" stroke={look.secure === 'warn' ? 'rgba(255,77,106,0.45)' : 'rgba(143,166,201,0.22)'} />
      {look.secure === 'lock' && <Lock x={iconX} y={cy - 1} s={compact ? 0.85 : 1} color={SIG.res} />}
      {look.secure === 'pending' && (
        <g>
          {[0, 1, 2].map((i) => (
            <circle key={i} cx={iconX - 3 + i * 3} cy={cy} r={1} fill={SIG.dim} />
          ))}
        </g>
      )}
      {look.secure === 'warn' && (
        <>
          <Warn x={iconX} y={cy} s={compact ? 0.8 : 0.9} />
          <text x={iconX + 8} y={cy + (compact ? 3 : 3.5)} style={{ fontFamily: 'var(--font-sans)', fontSize: compact ? 9 : 10, fontWeight: 600, fill: SIG.err }}>
            Not secure
          </text>
        </>
      )}
      <text className={css.mono2} x={textX} y={cy + (compact ? 3 : 3.5)} style={{ fontSize: compact ? 9 : 10.5, fill: 'var(--text-1)' }}>
        {fit(look.url, w - 14 - (textX - 7) - 8, charW)}
      </text>
      {!err && look.title && (
        <text className={css.title} x={12} y={pageY + (compact ? 7 : 9)} style={compact ? { fontSize: 10.5 } : undefined}>
          {look.title}
        </text>
      )}
      {!err &&
        lines.map((l, i) => (
          <text key={i} className={css.mono2} x={12} y={pageY + (compact ? 7 : 9) + (i + 1) * lineH} style={compact ? { fontSize: 9 } : undefined}>
            {fit(l, w - 24, compact ? 5.4 : 6)}
          </text>
        ))}
      {look.alert && !err && (
        <g transform={`translate(8,${h - (compact ? 25 : 32)})`}>
          <rect width={w - 16} height={compact ? 19 : 25} rx={6} fill={look.alert.tone === 'err' ? 'rgba(255,77,106,0.16)' : 'rgba(75,227,160,0.12)'} stroke={look.alert.tone === 'err' ? SIG.err : SIG.res} strokeOpacity={0.8} />
          {look.alert.tone === 'err' ? <Warn x={11} y={compact ? 9.5 : 12.5} s={0.75} /> : <Tick x={11} y={compact ? 9.5 : 12.5} s={0.8} />}
          <text x={21} y={compact ? 13 : 16.5} style={{ fontFamily: 'var(--font-sans)', fontSize: compact ? 9 : 10.5, fontWeight: 600, fill: look.alert.tone === 'err' ? '#ffb3c0' : '#b6f7da' }}>
            {fit(look.alert.text, w - 44, compact ? 5 : 5.6)}
          </text>
        </g>
      )}
      {err && look.error && (
        <g>
          <rect x={1} y={pageY - (compact ? 4 : 6)} width={w - 2} height={h - pageY + (compact ? 3 : 5)} rx={0} fill="rgba(255,77,106,0.1)" />
          <Warn x={16} y={pageY + (compact ? 6 : 10)} s={compact ? 1 : 1.25} />
          <text x={compact ? 26 : 30} y={pageY + (compact ? 9.5 : 14)} style={{ fontFamily: 'var(--font-sans)', fontSize: compact ? 10 : 12, fontWeight: 600, fill: '#ffb3c0' }}>
            {fit(look.error.title, w - (compact ? 32 : 40), compact ? 5.3 : 6.2)}
          </text>
          {!compact && (
            <text className={css.mono2} x={12} y={pageY + 32} style={{ fontSize: 9.5 }}>
              {fit(look.error.line, w - 24, 5.7)}
            </text>
          )}
          {look.error.code && (
            <text className={css.mono} x={12} y={compact ? pageY + 22 : pageY + 47} style={{ fontSize: compact ? 8.5 : 9.5, fill: SIG.err }}>
              {fit(look.error.code, w - 24, compact ? 5.1 : 5.7)}
            </text>
          )}
        </g>
      )}
    </g>
  );
}

/* ------------------------------------------------------------------ */
/* Plain node card (router, server, attacker)                          */
/* ------------------------------------------------------------------ */

export function Card({
  box,
  title,
  sub,
  icon,
  tone,
  kicker,
  dim,
  glow,
  children,
}: {
  box: Box;
  title: string;
  sub?: string;
  icon?: ReactNode;
  tone?: string;
  kicker?: { text: string; color?: string };
  dim?: boolean;
  glow?: boolean;
  children?: ReactNode;
}) {
  const { w, h } = box;
  const ix = icon ? 32 : 12;
  const narrow = w < 120;
  return (
    <g className={css.node} transform={`translate(${box.x - w / 2},${box.y - h / 2})`} opacity={box.alpha * (dim ? 0.28 : 1)}>
      {glow && <GlowRing w={w} h={h} />}
      {kicker && (
        <text className={css.caps} x={0} y={-7} style={{ fill: kicker.color ?? 'var(--text-3)', fontSize: 8.5 }}>
          {kicker.text}
        </text>
      )}
      <rect className={css.card} width={w} height={h} rx={10} style={tone ? { stroke: tone } : undefined} />
      <rect className={css.cardInner} x={3.5} y={3.5} width={Math.max(0, w - 7)} height={Math.max(0, h - 7)} rx={7.5} />
      {icon && <g transform={`translate(17,${h / 2})`}>{icon}</g>}
      <text className={css.name} x={ix} y={sub ? h / 2 - 2 : h / 2 + 4} style={narrow ? { fontSize: 11 } : undefined}>
        {title}
      </text>
      {sub && (
        <text className={css.mono} x={ix} y={h / 2 + 11} style={narrow ? { fontSize: 8.5 } : undefined}>
          {sub}
        </text>
      )}
      {children}
    </g>
  );
}

/** A person (Eve, Mallory): avatar initial + name. */
export function Person({ box, name, sub, color, dim, glow }: { box: Box; name: string; sub?: string; color: string; dim?: boolean; glow?: boolean }) {
  const { w, h } = box;
  const r = Math.min(11, h / 2 - 5);
  const ax = r + 8;
  return (
    <g className={css.node} transform={`translate(${box.x - w / 2},${box.y - h / 2})`} opacity={box.alpha * (dim ? 0.28 : 1)}>
      {glow && <GlowRing w={w} h={h} rx={9} />}
      <rect className={css.card} width={w} height={h} rx={9} style={{ stroke: 'rgba(255,77,106,0.6)' }} />
      <circle cx={ax} cy={h / 2} r={r} fill={color} fillOpacity={0.16} stroke={color} strokeWidth={1.2} />
      <text x={ax} y={h / 2 + 4} textAnchor="middle" fill={color} style={{ fontFamily: 'var(--font-sans)', fontSize: 11, fontWeight: 600 }}>
        {name[0]}
      </text>
      <text className={css.name} x={ax + r + 7} y={sub ? h / 2 - 2 : h / 2 + 4} style={{ fontSize: h < 32 ? 11 : 12.5 }}>
        {name}
      </text>
      {sub && (
        <text className={css.mono} x={ax + r + 7} y={h / 2 + 10} style={{ fontSize: 8.5 }}>
          {sub}
        </text>
      )}
    </g>
  );
}

/* ------------------------------------------------------------------ */
/* Key chips                                                           */
/* ------------------------------------------------------------------ */

const KEY_COLORS = { shared: SIG.lime, public: SIG.teal, private: SIG.hc, stolen: SIG.err } as const;

export function KeyChip({ x, y, kind, text, anchor = 'middle' }: { x: number; y: number; kind: keyof typeof KEY_COLORS; text: string; anchor?: 'start' | 'middle' | 'end' }) {
  const c = KEY_COLORS[kind];
  const w = text.length * 5.6 + 26;
  const x0 = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x;
  return (
    <g transform={`translate(${x0},${y})`}>
      <rect width={w} height={17} rx={8.5} fill="rgba(7,11,20,0.92)" stroke={c} strokeOpacity={0.75} />
      {kind === 'public' ? <Lock x={11} y={8.2} s={0.72} color={c} open /> : <KeyGlyph x={11} y={8.5} s={0.78} color={c} />}
      <text x={20} y={11.8} style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, fontWeight: 500, fill: c }}>
        {text}
      </text>
    </g>
  );
}

/* ------------------------------------------------------------------ */
/* Paint pot                                                           */
/* ------------------------------------------------------------------ */

export function Pot({
  box,
  color,
  partial,
  secret,
  label,
  sub,
  num,
  dim,
  glow,
  mark,
  compact,
  plain,
}: {
  box: Box;
  color?: string;
  partial?: boolean;
  secret?: boolean;
  label: string;
  sub?: string;
  num?: string;
  dim?: boolean;
  glow?: boolean;
  mark?: 'ok' | 'bad' | null;
  compact?: boolean;
  /** Label as written (math), not in small caps */
  plain?: boolean;
}) {
  const { w, h } = box;
  const top = h * 0.2;
  const bodyH = h - top - 1;
  const rimRy = h * 0.09;
  const level = color ? (partial ? 0.5 : 0.82) : 0;
  const liquidTop = top + bodyH * (1 - level);
  const clip = `pot-${box.id.replace(/[^a-z0-9]/gi, '')}`;
  return (
    <g className={css.node} transform={`translate(${box.x - w / 2},${box.y - h / 2})`} opacity={box.alpha * (dim ? 0.28 : 1)}>
      <defs>
        <clipPath id={clip}>
          <rect x={3} y={top} width={w - 6} height={bodyH} rx={compact ? 4 : 6} />
        </clipPath>
      </defs>
      {glow && <GlowRing w={w} h={h} rx={8} pad={7} />}
      {mark && <rect x={-4} y={-4} width={w + 8} height={h + 8} rx={9} fill="none" stroke={mark === 'ok' ? SIG.res : SIG.err} strokeWidth={1.6} />}
      <rect x={3} y={top} width={w - 6} height={bodyH} rx={compact ? 4 : 6} fill="var(--node-fill)" stroke={color ? 'rgba(143,166,201,0.55)' : 'rgba(143,166,201,0.4)'} strokeDasharray={color ? undefined : '3 3'} strokeWidth={1.1} />
      {color && (
        <g clipPath={`url(#${clip})`}>
          <rect x={3} y={liquidTop} width={w - 6} height={h} fill={color} />
          <ellipse cx={w / 2} cy={liquidTop} rx={(w - 6) / 2} ry={rimRy * 0.9} fill="#ffffff" opacity={0.16} />
        </g>
      )}
      <ellipse cx={w / 2} cy={top} rx={(w - 6) / 2 + 1} ry={rimRy} fill="rgba(7,11,20,0.85)" stroke="rgba(143,166,201,0.6)" strokeWidth={1.1} />
      {num && (
        <text x={w / 2} y={top + bodyH * 0.62 + (compact ? 3 : 4)} textAnchor="middle" className={css.halo} style={{ fontFamily: 'var(--font-sans)', fontSize: compact ? 12 : 16, fontWeight: 700, fill: '#fff' }}>
          {num}
        </text>
      )}
      {secret && (
        <g transform={`translate(${w - 2},${top + 2})`}>
          <circle r={compact ? 6.5 : 8} fill="rgba(7,11,20,0.95)" stroke="rgba(255,210,63,0.7)" />
          <Lock x={0} y={-0.5} s={compact ? 0.62 : 0.78} color={SIG.warn} />
        </g>
      )}
      <text
        x={w / 2}
        y={h + (compact ? 12 : 17)}
        textAnchor="middle"
        className={`${plain ? css.mono2 : css.caps} ${css.halo}`}
        style={plain ? { fontSize: compact ? 9 : 10.5, fill: 'var(--text-1)' } : { fontSize: compact ? 7.8 : 9, fill: 'var(--text-2)' }}
      >
        {label}
      </text>
      {sub && (
        <text x={w / 2} y={h + (compact ? 22 : 29)} textAnchor="middle" className={`${css.mono} ${css.halo}`} style={{ fontSize: compact ? 7.5 : 9 }}>
          {sub}
        </text>
      )}
    </g>
  );
}

/* ------------------------------------------------------------------ */
/* Certificate card                                                    */
/* ------------------------------------------------------------------ */

export const ROLE = {
  leaf: { head: 'Leaf certificate', short: 'Leaf', color: SIG.req, tag: 'sent by the server' },
  inter: { head: 'Intermediate CA', short: 'Intermediate', color: SIG.hc, tag: 'sent by the server' },
  root: { head: 'Root CA', short: 'Root', color: SIG.res, tag: 'already on Alice’s device' },
} as const;

export interface RowSpot {
  k: CertRowKey;
  tone: 'run' | 'ok' | 'fail';
}

const SHORT_LABEL: Record<CertRowKey, string> = { subject: 'Subject', issuer: 'Issuer', valid: 'Valid', key: 'Key', sig: 'Sig' };

export function certRows(data: CertData, compact: boolean): CertData['rows'] {
  if (!compact) return data.role === 'root' ? data.rows.filter((r) => r.k !== 'sig') : data.rows;
  const keep: CertRowKey[] = data.role === 'leaf' ? ['subject', 'issuer', 'valid', 'key'] : data.role === 'inter' ? ['subject', 'issuer', 'valid'] : ['subject', 'issuer'];
  return data.rows.filter((r) => keep.includes(r.k));
}

export function certMetrics(compact: boolean) {
  return compact ? { head: 16, row: 12.5, pad: 4, labelW: 58 } : { head: 22, row: 17, pad: 5, labelW: 82 };
}

/** Local y of a row's center, or of the header if that row isn't drawn. */
export function rowCenter(data: CertData, k: CertRowKey, compact: boolean) {
  const M = certMetrics(compact);
  const rows = certRows(data, compact);
  const i = rows.findIndex((r) => r.k === k);
  if (i < 0) return M.head / 2;
  return M.head + M.pad + i * M.row + M.row / 2;
}

export function CertCard({
  box,
  data,
  spots = [],
  compact,
  dim,
  glow,
  tag,
  fake,
  bare,
}: {
  box: Box;
  data: CertData;
  spots?: RowSpot[];
  compact: boolean;
  dim?: boolean;
  glow?: boolean;
  tag?: string;
  fake?: boolean;
  /** No frame/header outline (drawn inside the trust store) */
  bare?: boolean;
}) {
  const { w, h } = box;
  const M = certMetrics(compact);
  const role = ROLE[data.role];
  const rows = certRows(data, compact);
  const charW = compact ? 5.25 : 6;
  const valueX = M.labelW;
  return (
    <g className={css.node} transform={`translate(${box.x - w / 2},${box.y - h / 2})`} opacity={box.alpha * (dim ? 0.28 : 1)}>
      {glow && <GlowRing w={w} h={h} rx={8} />}
      <rect className={css.card} width={w} height={h} rx={8} style={{ stroke: fake ? 'rgba(255,77,106,0.6)' : `${role.color}99` }} />
      <rect x={0.5} y={0.5} width={w - 1} height={M.head} rx={7.5} fill={`${role.color}1f`} />
      <rect x={10} y={0} width={w - 20} height={2} rx={1} fill={role.color} opacity={bare ? 0.5 : 0.9} />
      <text className={css.caps} x={10} y={M.head / 2 + 3.4} style={{ fill: role.color, fontSize: compact ? 8 : 9 }}>
        {compact ? role.short : role.head}
      </text>
      {(tag ?? role.tag) && (
        <text className={css.mono} x={w - 10} y={M.head / 2 + 3.4} textAnchor="end" style={{ fontSize: compact ? 8 : 9 }}>
          {tag ?? role.tag}
        </text>
      )}
      {rows.map((r, i) => {
        const y = M.head + M.pad + i * M.row;
        const spot = spots.find((s) => s.k === r.k);
        const c = spot ? (spot.tone === 'run' ? SIG.warn : spot.tone === 'ok' ? SIG.res : SIG.err) : null;
        const value = compact ? (r.short ?? r.value) : r.value;
        return (
          <g key={r.k} transform={`translate(0,${y})`}>
            {c && (
              <>
                <rect x={4} y={0.5} width={w - 8} height={M.row - 1} rx={3} fill={c} opacity={0.13} />
                <rect x={4} y={0.5} width={2.5} height={M.row - 1} rx={1} fill={c} />
              </>
            )}
            <text className={css.caps} x={11} y={M.row / 2 + 3.2} style={{ fontSize: compact ? 7.4 : 8.4 }}>
              {compact ? SHORT_LABEL[r.k] : r.label}
            </text>
            <text className={css.mono2} x={valueX} y={M.row / 2 + 3.4} style={{ fontSize: compact ? 9 : 10, fill: c === SIG.err ? '#ffb3c0' : 'var(--text-1)' }}>
              {fit(value, w - valueX - (spot && spot.tone !== 'run' ? 22 : 10), charW)}
            </text>
            {spot?.tone === 'ok' && <Tick x={w - 13} y={M.row / 2} s={0.8} />}
            {spot?.tone === 'fail' && <Cross x={w - 13} y={M.row / 2} s={0.8} />}
          </g>
        );
      })}
    </g>
  );
}
