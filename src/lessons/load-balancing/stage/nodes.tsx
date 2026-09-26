import { VIP } from '../engine/constants';
import { UNIT, UNIT_COMPACT } from '../engine/layout';
import type { ClientView, EffectView, LBView, PacketView, ServerView, View, WireView } from '../engine/world';
import css from './stage.module.css';

const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(' ');

const OK = '#4BE3A0';
const BAD = '#FF4D6A';

/* ------------------------------------------------------------------ */

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
    <g>
      {corners.map(([x, y, sx, sy], i) => (
        <path key={i} className={css.reg} d={`M${x},${y + sy * l} L${x},${y} L${x + sx * l},${y}`} />
      ))}
    </g>
  );
}

export function Zones({ v }: { v: View }) {
  if (!v.showZones || v.boundary == null) return null;
  if (v.orient === 'landscape') {
    const x = v.boundary;
    const labelTop = 104;
    return (
      <g>
        <rect className={css.zoneFill} x={x} y={0} width={Math.max(0, v.w - x)} height={v.h} />
        <line className={css.zoneLine} x1={x} y1={26} x2={x} y2={v.h - 26} />
        <text className={css.zoneLabel} transform={`translate(${x - 8},${labelTop}) rotate(90)`} textAnchor="start">
          ← public internet
        </text>
        <text className={css.zoneLabel} transform={`translate(${x + 16},${labelTop}) rotate(90)`} textAnchor="start">
          private network →
        </text>
      </g>
    );
  }
  const y = v.boundary;
  return (
    <g>
      <rect className={css.zoneFill} x={0} y={y} width={v.w} height={Math.max(0, v.h - y)} />
      <line className={css.zoneLine} x1={14} y1={y} x2={v.w - 14} y2={y} />
      <text className={css.zoneLabel} x={14} y={y - 8}>
        ↑ internet
      </text>
      <text className={css.zoneLabel} x={14} y={y + 16}>
        ↓ private
      </text>
    </g>
  );
}

/* ------------------------------------------------------------------ */

export function Wires({ wires }: { wires: WireView[] }) {
  return (
    <g>
      {wires.map((w) => (
        <g key={w.key} opacity={w.alpha}>
          <path
            d={w.d}
            className={cx(
              css.wire,
              w.kind === 'hb' && css.wireHb,
              w.kind === 'redis' && css.wireRedis,
              w.state === 'down' && css.wireDown,
              w.state === 'out' && css.wireOut,
              w.state === 'standby' && css.wireStandby,
            )}
          />
          {w.flash > 0.01 && <path d={w.d} className={css.wireFlash} opacity={w.flash * 0.75} />}
          {w.state === 'out' && (
            <g className={css.outBadge} transform={`translate(${w.mid.x},${w.mid.y})`}>
              <circle r={6.5} />
              <line x1={-4} y1={4} x2={4} y2={-4} />
            </g>
          )}
        </g>
      ))}
    </g>
  );
}

/* ------------------------------------------------------------------ */

export function ClientNode({ c, dim, glow }: { c: ClientView; dim: boolean; glow: boolean }) {
  const x0 = c.x - c.w / 2;
  const y0 = c.y - c.h / 2;
  const narrow = c.w < 118;
  const tiny = c.w < 100;
  const ar = narrow ? 9 : 11;
  const ax = narrow ? 15 : 20;
  const tx = ax + ar + 8;
  return (
    <g className={css.node} transform={`translate(${x0},${y0})`} opacity={c.alpha * (dim ? 0.28 : 1)}>
      {glow && <rect x={-5} y={-5} width={c.w + 10} height={c.h + 10} rx={12} fill="none" stroke="var(--accent)" strokeWidth={1.4} strokeDasharray="3 3" />}
      <rect className={css.card} width={c.w} height={c.h} rx={9} />
      <circle cx={ax} cy={c.h / 2} r={ar} fill={c.color} fillOpacity={0.14} stroke={c.color} strokeWidth={1.2} />
      <text className={css.avatarText} x={ax} y={c.h / 2 + 4} textAnchor="middle" fill={c.color}>
        {c.name[0]}
      </text>
      {c.pulse && (
        <circle cx={ax} cy={c.h / 2} r={ar + c.pulse.k * 12} fill="none" stroke={c.pulse.color} strokeWidth={2.2 * (1 - c.pulse.k)} opacity={1 - c.pulse.k} />
      )}
      <text className={css.name} x={tx} y={tiny ? c.h / 2 + 4 : c.h / 2 - (narrow ? 1 : 2)} style={narrow ? { fontSize: 11.5 } : undefined}>
        {c.name}
      </text>
      {!tiny && (
        <text className={css.mono} x={tx} y={c.h / 2 + (narrow ? 10 : 11)} style={narrow ? { fontSize: 8.5 } : undefined}>
          {c.ip}
        </text>
      )}
    </g>
  );
}

/* ------------------------------------------------------------------ */

function SplitterGlyph() {
  return (
    <g className={css.lbGlyph}>
      <path d="M0,0 H7" />
      <path d="M7,0 C12,0 12,-8 18,-8 H20" />
      <path d="M7,0 H20" />
      <path d="M7,0 C12,0 12,8 18,8 H20" />
      <circle cx={0} cy={0} r={1.8} fill="#b59bff" stroke="none" />
    </g>
  );
}

export function LBNode({ lb, dim, glow, hatchId, onClick }: { lb: LBView; dim: boolean; glow: boolean; hatchId: string; onClick?: () => void }) {
  const x0 = lb.x - lb.w / 2;
  const y0 = lb.y - lb.h / 2;
  const standby = lb.pair && !lb.active && lb.up;
  const title = lb.pair ? `${!lb.up ? 'down' : lb.active ? 'active' : 'standby'} · ${lb.label}` : lb.up ? 'load balancer' : 'load balancer · down';
  return (
    <g
      className={cx(css.node, !lb.up && css.lbDown, standby && css.lbStandby, onClick && css.clickable)}
      transform={`translate(${x0},${y0})`}
      opacity={lb.alpha * (dim ? 0.28 : 1)}
      onClick={onClick}
    >
      {glow && <rect x={-6} y={-6} width={lb.w + 12} height={lb.h + 12} rx={16} fill="none" stroke="var(--accent)" strokeWidth={1.4} strokeDasharray="3 3" />}
      {lb.flash > 0.01 && lb.up && <rect x={-3} y={-3} width={lb.w + 6} height={lb.h + 6} rx={14} fill="none" stroke="#b59bff" strokeWidth={3} opacity={lb.flash * 0.55} />}
      <rect className={css.lbCard} width={lb.w} height={lb.h} rx={12} />
      <rect className={css.cardInner} x={4} y={4} width={lb.w - 8} height={lb.h - 8} rx={9} />
      <g transform={`translate(14,${lb.h / 2})`}>
        <SplitterGlyph />
      </g>
      <text className={cx(css.lbTitle, css.caps)} x={44} y={lb.h / 2 - 5}>
        {title}
      </text>
      <text className={css.monoStrong} x={44} y={lb.h / 2 + 11}>
        {lb.active ? VIP : lb.ip}
      </text>
      <circle cx={lb.w - 12} cy={12} r={3.2} fill={lb.up ? OK : BAD} />
      {!lb.up && <rect width={lb.w} height={lb.h} rx={12} fill={`url(#${hatchId})`} />}
    </g>
  );
}

/* ------------------------------------------------------------------ */

function CartGlyph({ x, y, color }: { x: number; y: number; color: string }) {
  return (
    <g transform={`translate(${x},${y})`}>
      <path d="M0,0.5 H2.2 L3.8,6.5 H10 L11.6,2 H2.8" fill="none" stroke={color} strokeWidth={1.3} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={4.6} cy={8.6} r={1.1} fill={color} />
      <circle cx={9.2} cy={8.6} r={1.1} fill={color} />
    </g>
  );
}

export function ServerNode({
  s,
  dim,
  glow,
  compactUnits,
  showServed,
  showWeight,
  hatchId,
  clickable,
  onClick,
  vt,
}: {
  s: ServerView;
  dim: boolean;
  glow: boolean;
  compactUnits: boolean;
  showServed: boolean;
  showWeight: boolean;
  hatchId: string;
  clickable: boolean;
  onClick?: (id: string) => void;
  vt: number;
}) {
  const U = compactUnits ? UNIT_COMPACT : UNIT;
  const x0 = s.x - s.w / 2;
  const y0 = s.y - s.h / 2;
  const out = s.inRot === false && s.up;
  const narrow = s.w < 130;
  const bw = s.w - 16;
  const shake = s.mark?.kind === 'bad' ? Math.sin(s.mark.k * 40) * 4 * (1 - s.mark.k) : 0;
  const markColor = s.mark ? (s.mark.kind === 'ok' ? OK : s.mark.kind === 'bad' ? BAD : '#FFD23F') : null;
  const tagY = -6;

  return (
    <g
      className={cx(css.node, css.server, !s.up && css.serverDown, out && css.serverOut, (clickable || s.pickable) && css.clickable, s.pickable && css.pickable)}
      transform={`translate(${x0 + shake},${y0})`}
      opacity={s.alpha * (dim ? 0.28 : 1)}
      onClick={clickable || s.pickable ? () => onClick?.(s.id) : undefined}
      role={clickable || s.pickable ? 'button' : undefined}
      aria-label={clickable || s.pickable ? `${s.label}${s.up ? '' : ' (down)'}` : undefined}
    >
      {/* generous invisible hit area */}
      {(clickable || s.pickable) && <rect x={-8} y={-22} width={s.w + 16} height={s.h + 30} fill="transparent" />}
      {glow && <rect x={-6} y={-6} width={s.w + 12} height={s.h + 12} rx={10} fill="none" stroke="var(--accent)" strokeWidth={1.4} strokeDasharray="3 3" />}

      {/* label strip */}
      {s.pool && (
        <text className={css.tag} x={0} y={tagY} fill={s.pool === 'api' ? '#45D5FF' : '#FF7EB6'}>
          {s.pool} pool
        </text>
      )}
      {!s.pool && showWeight && (
        <text className={css.tag} x={0} y={tagY} fill="var(--accent)">
          weight {s.weight}
        </text>
      )}
      {s.tally && (
        <g transform={`translate(${s.w},${tagY - 3})`}>
          {out || (!s.up && s.inRot === false) ? (
            <text className={css.tag} textAnchor="end" y={3} fill={BAD}>
              out of rotation
            </text>
          ) : (
            <>
              <text className={css.tag} textAnchor="end" x={-30} y={3} fill="var(--text-3)">
                checks
              </text>
              {[0, 1, 2].map((i) => {
                const r = s.tally![s.tally!.length - 3 + i];
                return <circle key={i} cx={-22 + i * 9} cy={0} r={3} fill={r === 'ok' ? OK : r === 'fail' ? BAD : 'none'} stroke={r ? 'none' : 'rgba(143,166,201,0.4)'} />;
              })}
            </>
          )}
        </g>
      )}
      {!s.tally && out && (
        <text className={css.tag} textAnchor="end" x={s.w} y={tagY} fill={BAD}>
          out of rotation
        </text>
      )}

      {/* card */}
      <rect className={css.card} width={s.w} height={s.h} rx={6} />
      <circle className={css.led} cx={11} cy={U.header / 2 + 1} r={3.2} fill={s.up ? OK : BAD} />
      {s.up && s.units.some((u) => u.busy) && (
        <circle cx={11} cy={U.header / 2 + 1} r={6} fill="none" stroke={OK} strokeWidth={1} opacity={0.35 + 0.35 * Math.sin(vt * 9)} />
      )}
      <text className={css.monoStrong} x={21} y={U.header / 2 + 5} style={narrow ? { fontSize: 10 } : undefined}>
        {s.label}
      </text>
      {!narrow && (
        <text className={css.mono} x={s.w - 9} y={U.header / 2 + 5} textAnchor="end">
          {s.up ? s.ip : 'down'}
        </text>
      )}

      {/* worker units, one per concurrent request */}
      {s.units.map((u, i) => {
        const y = U.header + i * (U.h + U.gap);
        return (
          <g key={i} transform={`translate(8,${y})`}>
            <rect className={css.unit} width={bw} height={U.h} rx={2} />
            <circle cx={6} cy={U.h / 2} r={2} fill={u.busy ? u.color : 'rgba(143,166,201,0.22)'} />
            {u.busy ? (
              <rect x={12} y={2} width={Math.max(1.5, (bw - 16) * u.p)} height={U.h - 4} rx={1.5} fill={u.color} opacity={0.85} />
            ) : (
              U.h >= 9 && <path d={`M${bw - 16},3 v${U.h - 6} M${bw - 12},3 v${U.h - 6} M${bw - 8},3 v${U.h - 6}`} stroke="rgba(143,166,201,0.18)" strokeWidth={1} />
            )}
          </g>
        );
      })}

      {!s.up && <rect width={s.w} height={s.h} rx={6} fill={`url(#${hatchId})`} />}
      {!s.up && (
        <text className={cx(css.caps)} x={s.w / 2} y={U.header + (s.h - U.header) / 2 + 4} textAnchor="middle" fill={BAD} style={{ fontSize: 10, fontWeight: 600 }}>
          ✕ down
        </text>
      )}

      {/* below the card */}
      {s.carts.length > 0 && (
        <g transform={`translate(2,${s.h + 7})`}>
          {s.carts.map((color, i) => (
            <CartGlyph key={i} x={i * 16} y={0} color={color} />
          ))}
          <text className={css.mono} x={s.carts.length * 16 + 2} y={8.5} style={{ fontSize: 9 }}>
            in memory
          </text>
        </g>
      )}
      {showServed && s.carts.length === 0 && (
        <text className={css.mono} x={0} y={s.h + 14} style={{ fontSize: 9.5 }}>
          served {s.served}
          {s.served > 0 ? ` · ${Math.round(s.share * 100)}%` : ''}
        </text>
      )}

      {markColor && (
        <rect
          x={-4}
          y={-4}
          width={s.w + 8}
          height={s.h + 8}
          rx={9}
          fill="none"
          stroke={markColor}
          strokeWidth={s.mark!.kind === 'answer' ? 2 : 2.4}
          strokeDasharray={s.mark!.kind === 'answer' ? '4 3' : undefined}
          opacity={1 - s.mark!.k}
        />
      )}
    </g>
  );
}

export function Queue({ s, dim, orient }: { s: ServerView; dim: boolean; orient: View['orient'] }) {
  if (!s.up && s.queue.length === 0) return null;
  const last = s.capSlots[s.capSlots.length - 1];
  const mid = s.capSlots[Math.floor(s.capSlots.length / 2)];
  const labelPos = orient === 'landscape' ? { x: mid.x, y: mid.y + 16 } : { x: mid.x + 14, y: mid.y + 3 };
  return (
    <g opacity={s.alpha * (dim ? 0.28 : 1)}>
      <g opacity={s.queue.length ? 1 : 0.45}>
        {s.capSlots.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={3.3} fill="var(--ink-1)" stroke="rgba(143,166,201,0.28)" strokeWidth={1} />
        ))}
      </g>
      {s.queue.map((q, i) => (
        <circle key={i} cx={q.x} cy={q.y} r={4.2} fill={q.color} />
      ))}
      {s.overflow > 0 && last && (
        <text className={css.mono} x={last.x - (orient === 'landscape' ? 12 : 0)} y={last.y + 3} textAnchor="end" fill="var(--text-2)">
          +{s.overflow}
        </text>
      )}
      {s.queue.length > 0 && (
        <text
          className={css.caps}
          x={labelPos.x}
          y={labelPos.y}
          textAnchor={orient === 'landscape' ? 'middle' : 'start'}
          fill={s.queue.length >= s.capSlots.length ? BAD : 'var(--text-3)'}
          style={{ fontSize: 8.5 }}
        >
          queue {s.queue.length}/{s.capSlots.length}
        </text>
      )}
    </g>
  );
}

/* ------------------------------------------------------------------ */

export function RedisNode({ r, dim, glow }: { r: NonNullable<View['redis']>; dim: boolean; glow: boolean }) {
  const x0 = r.x - r.w / 2;
  const y0 = r.y - r.h / 2;
  const ry = 7;
  return (
    <g className={css.node} transform={`translate(${x0},${y0})`} opacity={r.alpha * (dim ? 0.28 : 1)}>
      {glow && <rect x={-6} y={-8} width={r.w + 12} height={r.h + 16} rx={12} fill="none" stroke="var(--accent)" strokeWidth={1.4} strokeDasharray="3 3" />}
      <path
        d={`M0,${ry} A${r.w / 2},${ry} 0 0,1 ${r.w},${ry} V${r.h - ry} A${r.w / 2},${ry} 0 0,1 0,${r.h - ry} Z`}
        fill="var(--node-fill)"
        stroke="rgba(181,155,255,0.8)"
        strokeWidth={1.2}
      />
      <ellipse cx={r.w / 2} cy={ry} rx={r.w / 2} ry={ry} fill="rgba(181,155,255,0.08)" stroke="rgba(181,155,255,0.8)" strokeWidth={1.2} />
      <text className={cx(css.caps)} x={r.w / 2} y={ry + 17} textAnchor="middle" fill="#cdbdff">
        redis · sessions
      </text>
      <g transform={`translate(${r.w / 2 - (r.carts.length * 16) / 2 + 2},${ry + 26})`}>
        {r.carts.map((color, i) => (
          <CartGlyph key={i} x={i * 16} y={0} color={color} />
        ))}
      </g>
    </g>
  );
}

/* ------------------------------------------------------------------ */

export function Packets({ packets }: { packets: PacketView[] }) {
  return (
    <g>
      {packets.map((p) => {
        if (p.kind === 'hc' || p.kind === 'hcack' || p.kind === 'hb' || p.kind === 'sess') {
          return <circle key={p.id} cx={p.x} cy={p.y} r={p.r} fill={p.color} opacity={0.95} />;
        }
        return (
          <g key={p.id}>
            <line className={css.trail} x1={p.tx} y1={p.ty} x2={p.x} y2={p.y} stroke={p.color} strokeWidth={p.r * 1.25} opacity={0.26} />
            <circle cx={p.x} cy={p.y} r={p.r * 2.5} fill={p.color} opacity={0.13} />
            {p.sealed ? (
              <g transform={`translate(${p.x},${p.y})`}>
                <rect x={-6.5} y={-4.8} width={13} height={9.6} rx={1.5} fill={p.color} />
                <path d="M-6.5,-4.3 L0,0.8 L6.5,-4.3" fill="none" stroke="rgba(5,8,15,0.75)" strokeWidth={1.1} />
              </g>
            ) : (
              <circle cx={p.x} cy={p.y} r={p.r} fill={p.color} />
            )}
            {p.heavy && !p.sealed && <circle cx={p.x} cy={p.y} r={p.r * 0.4} fill="rgba(20,10,0,0.75)" />}
          </g>
        );
      })}
    </g>
  );
}

export function PendingDot({ p, vt }: { p: NonNullable<View['pending']>; vt: number }) {
  const k = (Math.sin(vt * 5) + 1) / 2;
  return (
    <g transform={`translate(${p.x},${p.y})`}>
      <circle r={20 + k * 6} fill="none" stroke="var(--accent)" strokeWidth={1.4} opacity={0.35 + 0.4 * (1 - k)} strokeDasharray="3 4" />
      <circle r={6} fill={p.color} />
      <circle r={13} fill={p.color} opacity={0.18} />
    </g>
  );
}

export function EffectsLayer({ effects }: { effects: EffectView[] }) {
  return (
    <g>
      {effects.map((e, i) => {
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

export function EffectTexts({ effects }: { effects: EffectView[] }) {
  return (
    <>
      {effects
        .filter((e) => e.kind === 'text')
        .map((e, i) => {
          const fadeIn = Math.min(1, e.k / 0.12);
          const fadeOut = e.k > 0.7 ? 1 - (e.k - 0.7) / 0.3 : 1;
          return (
            <div
              key={i}
              className={css.fxText}
              style={{ left: e.x, top: e.y - e.k * 14, color: e.color, opacity: fadeIn * fadeOut }}
            >
              {e.text}
            </div>
          );
        })}
    </>
  );
}
