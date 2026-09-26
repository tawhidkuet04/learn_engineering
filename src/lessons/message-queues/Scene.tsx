import { ClientCard, Effects, NodeCard, Wires } from '@/components/stage/svg';
import k from '@/components/stage/stage.module.css';
import { SIG } from '@/lib/sim/colors';
import { clamp } from '@/lib/sim/geometry';
import { SERVICES, USERS, type Consumer, type Queue, type Worker } from './model';
import css from './mq.module.css';
import type { MQSim } from './sim';

const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(' ');

/* ------------------------------------------------------------------ */
/* A message on the stage: id, type color, receive count, visibility   */
/* ------------------------------------------------------------------ */

export function Chip({
  x,
  y,
  cw,
  ch,
  label,
  color,
  ghost,
  pips = 0,
  timer,
  alpha = 1,
  glow,
}: {
  x: number;
  y: number;
  cw: number;
  ch: number;
  label: string;
  color: string;
  ghost?: boolean;
  /** Receive count, drawn as dots along the bottom edge */
  pips?: number;
  /** Visibility timeout left, 0..1 */
  timer?: number | null;
  alpha?: number;
  glow?: boolean;
}) {
  const n = Math.min(pips, 5);
  return (
    <g transform={`translate(${x.toFixed(1)},${y.toFixed(1)})`} opacity={alpha}>
      {glow && <rect x={-cw / 2 - 4} y={-ch / 2 - 4} width={cw + 8} height={ch + 8} rx={6} fill="none" stroke="var(--accent)" strokeWidth={1.3} strokeDasharray="3 3" />}
      <rect
        x={-cw / 2}
        y={-ch / 2}
        width={cw}
        height={ch}
        rx={4}
        fill={color}
        fillOpacity={ghost ? 0.05 : 0.17}
        stroke={color}
        strokeOpacity={ghost ? 0.65 : 0.95}
        strokeWidth={1.2}
        strokeDasharray={ghost ? '3 2.5' : undefined}
      />
      <text className={css.chipText} x={0} y={n > 0 ? 1 : 3.6} textAnchor="middle" fill={color} opacity={ghost ? 0.8 : 1}>
        {label}
      </text>
      {Array.from({ length: n }, (_, i) => (
        <circle key={i} cx={(i - (n - 1) / 2) * 4.2} cy={ch / 2 - 3.6} r={1.35} fill={color} opacity={ghost ? 0.75 : 1} />
      ))}
      {timer != null && (
        <>
          <rect x={-cw / 2} y={ch / 2 + 3} width={cw} height={2.6} rx={1.3} fill="rgba(181,155,255,0.16)" />
          <rect x={-cw / 2} y={ch / 2 + 3} width={Math.max(0, cw * timer)} height={2.6} rx={1.3} fill={timer < 0.3 ? SIG.warn : SIG.hc} />
        </>
      )}
    </g>
  );
}

/* ------------------------------------------------------------------ */
/* Queue: header, in-flight shelf, rail of ready messages              */
/* ------------------------------------------------------------------ */

function QueueNode({ sim, q, dim, glow }: { sim: MQSim; q: Queue; dim: boolean; glow: boolean }) {
  const g = sim.queueGeo(q.id);
  const b = sim.boxes.get(q.id);
  if (!g || !b) return null;
  const P = sim.orient === 'portrait';
  const w = g.right - g.left;
  const full = !q.dead && sim.cfg.maxDepth != null && q.visible.length >= sim.cfg.maxDepth;
  const flash = clamp(1 - (sim.vt - q.flash) / 0.7, 0, 1);
  const over = q.visible.length > g.cap ? q.visible.length - (g.cap - 1) : 0;
  const vis = sim.cfg.visibility;
  const railStroke = q.dead ? 'rgba(255,77,106,0.75)' : full || flash > 0 ? SIG.err : undefined;
  const chev: number[] = [];
  for (let x = g.x0 + 18; x < g.x1 - 10; x += 38) chev.push(x);
  const counts = q.dead ? `${q.visible.length} parked` : `${q.visible.length} ready${q.shelf || q.inflight.length ? ` · ${q.inflight.length} in flight` : ''}`;
  const prefix = q.dead ? 'dlq' : P && w < 240 ? 'q' : 'queue';
  const right = full ? `full · ${sim.cfg.maxDepth} max` : counts;
  // Estimated text widths (mono fonts), so the counts never collide with the name.
  const fits = prefix.length * 6.7 + 8 + q.name.length * 6.4 + right.length * 5.8 + 14 <= w;
  return (
    <g opacity={b.alpha * (dim ? 0.28 : 1)}>
      {glow && <rect x={g.left - 6} y={g.top - 6} width={w + 12} height={g.bottom - g.top + 12} rx={12} fill="none" stroke="var(--accent)" strokeWidth={1.4} strokeDasharray="3 3" />}
      <text className={k.caps} x={g.left + 2} y={g.top + 10} style={{ fill: q.dead ? '#ff9aab' : 'var(--text-3)' }}>
        {prefix}
        <tspan dx={6} className={k.monoStrong} style={{ textTransform: 'none', letterSpacing: 0, fill: q.dead ? '#ffb3c0' : 'var(--text-1)' }}>
          {q.name}
        </tspan>
      </text>
      {fits && (
        <text className={k.mono} x={g.right - 2} y={g.top + 10} textAnchor="end" style={{ fontSize: 9.5, fill: full ? '#ff9aab' : undefined }}>
          {right}
        </text>
      )}

      {q.shelf && (
        <>
          <rect x={g.left} y={g.shelfTop} width={w} height={g.shelfH} rx={7} fill="rgba(181,155,255,0.035)" stroke="rgba(181,155,255,0.38)" strokeDasharray="3 4" />
          <text className={css.tiny} x={g.left + 8} y={g.shelfY + 3} style={{ fill: 'rgba(205,189,255,0.7)' }}>
            {P ? 'in flight' : `in flight · hidden ${vis} s`}
          </text>
        </>
      )}

      <rect className={k.card} x={g.left} y={g.railTop} width={w} height={g.railH} rx={8} style={railStroke ? { stroke: railStroke } : undefined} />
      {flash > 0 && <rect x={g.left - 2} y={g.railTop - 2} width={w + 4} height={g.railH + 4} rx={9} fill="none" stroke={SIG.err} strokeWidth={2} opacity={flash} />}
      {chev.map((x) => (
        <path key={x} d={`M${x - 2},${g.railY - 3.5} L${x + 1.5},${g.railY} L${x - 2},${g.railY + 3.5}`} fill="none" stroke="rgba(143,166,201,0.2)" strokeWidth={1.1} />
      ))}

      {q.visible.map((m) =>
        m.alpha > 0.02 ? <Chip key={m.id} x={m.x} y={m.y} cw={g.cw} ch={g.ch} label={m.label} color={m.color} pips={m.receives} alpha={m.alpha} /> : null,
      )}
      {q.inflight.map((m) =>
        m.alpha > 0.02 ? (
          <Chip
            key={m.id}
            x={m.x}
            y={m.y}
            cw={g.cw}
            ch={g.ch}
            label={m.label}
            color={m.color}
            ghost
            pips={m.receives}
            alpha={m.alpha}
            timer={clamp((m.visibleAt - sim.t) / Math.max(0.1, vis), 0, 1)}
          />
        ) : null,
      )}
      {over > 0 && (
        <g transform={`translate(${g.x0 + 2},${g.railY})`}>
          <rect x={-2} y={-9} width={30} height={18} rx={9} fill="rgba(7,11,20,0.92)" stroke="rgba(143,166,201,0.5)" />
          <text className={k.mono} x={13} y={3.5} textAnchor="middle" style={{ fill: 'var(--text-1)', fontSize: 9.5 }}>
            +{over}
          </text>
        </g>
      )}
      {!q.dead && !P && (
        <>
          <text className={css.tiny} x={g.left + 4} y={g.bottom + 12}>
            newest
          </text>
          <text className={css.tiny} x={g.right - 4} y={g.bottom + 12} textAnchor="end">
            oldest · next out
          </text>
        </>
      )}
    </g>
  );
}

/* ------------------------------------------------------------------ */
/* Workers and consumers                                               */
/* ------------------------------------------------------------------ */

function Bar({ x, y, w, p, color }: { x: number; y: number; w: number; p: number | null; color: string }) {
  return (
    <>
      <rect x={x} y={y} width={w} height={3.5} rx={1.75} fill="rgba(143,166,201,0.14)" />
      {p != null && <rect x={x} y={y} width={Math.max(1.5, w * clamp(p, 0, 1))} height={3.5} rx={1.75} fill={color} />}
    </>
  );
}

function WorkerNode({ sim, w, dim, glow, onClick }: { sim: MQSim; w: Worker; dim: boolean; glow: boolean; onClick?: () => void }) {
  const b = sim.boxes.get(w.id);
  if (!b || Number.isNaN(b.x)) return null;
  const down = w.state === 'down';
  const err = w.state === 'error';
  const busy = w.state === 'working' || w.state === 'fetching';
  const msg = w.msg;
  const narrow = b.w < 130;
  const flash = w.flash ? clamp(1 - (sim.vt - w.flash.vt) / 0.9, 0, 1) : 0;
  const color = msg?.color ?? SIG.req;
  const statusFill = down || err || w.note === 'double' ? '#ff9aab' : w.note === 'skipped' ? '#cdbdff' : w.note === 'charged' ? '#8ff3c6' : undefined;
  const led = down || err ? SIG.err : busy ? SIG.req : SIG.res;
  const pulse = busy ? 0.3 + 0.3 * Math.sin(sim.vt * 8) : 0;
  return (
    <g
      className={cx(k.node, onClick && k.clickable)}
      data-state={down ? 'down' : err ? 'hot' : 'normal'}
      transform={`translate(${b.x - b.w / 2},${b.y - b.h / 2})`}
      opacity={b.alpha * (dim ? 0.28 : 1)}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      aria-label={onClick ? `${w.name}: ${down ? 'restart' : 'crash'} it` : undefined}
    >
      {onClick && <rect x={-8} y={-8} width={b.w + 16} height={b.h + 16} fill="transparent" />}
      {glow && <rect x={-6} y={-6} width={b.w + 12} height={b.h + 12} rx={13} fill="none" stroke="var(--accent)" strokeWidth={1.4} strokeDasharray="3 3" />}
      {flash > 0 && w.flash && <rect x={-3} y={-3} width={b.w + 6} height={b.h + 6} rx={12} fill="none" stroke={w.flash.color} strokeWidth={2.4} opacity={flash} />}
      <rect className={k.card} width={b.w} height={b.h} rx={9} />
      <rect className={k.cardInner} x={3.5} y={3.5} width={Math.max(0, b.w - 7)} height={Math.max(0, b.h - 7)} rx={6.5} />
      <circle cx={12} cy={14} r={3.2} fill={led} />
      {busy && <circle cx={12} cy={14} r={6.2} fill="none" stroke={SIG.req} strokeWidth={1} opacity={pulse} />}
      <text className={k.monoStrong} x={21} y={17.5} style={narrow ? { fontSize: 10 } : undefined}>
        {w.name}
      </text>
      {msg && busy && <Chip x={b.w - 19} y={14} cw={narrow ? 24 : 28} ch={16} label={msg.label} color={color} pips={0} />}
      {msg && busy && msg.receives > 1 && (
        <text className={k.mono} x={b.w - 19} y={31} textAnchor="middle" style={{ fontSize: 8, fill: SIG.warn }}>
          try {msg.receives}
        </text>
      )}
      <text className={k.mono} x={11} y={b.h - 16} style={{ fontSize: narrow ? 9 : 10, fill: statusFill }}>
        {w.status}
      </text>
      <Bar x={10} y={b.h - 10} w={b.w - 20} p={busy ? (w.state === 'fetching' ? 0 : w.p) : null} color={color} />
      {down && <rect width={b.w} height={b.h} rx={9} fill="url(#kit-hatch)" pointerEvents="none" />}
    </g>
  );
}

function ConsumerNode({ sim, c, dim, glow, onClick }: { sim: MQSim; c: Consumer; dim: boolean; glow: boolean; onClick?: () => void }) {
  const b = sim.boxes.get(c.id);
  const g = sim.groups.get(c.group);
  if (!b || Number.isNaN(b.x) || !g) return null;
  const down = c.state === 'down';
  const busy = c.state === 'working' || c.state === 'fetching';
  const narrow = b.w < 130;
  const rec = c.cur?.rec;
  return (
    <g
      className={cx(k.node, onClick && k.clickable)}
      data-state={down ? 'down' : 'normal'}
      transform={`translate(${b.x - b.w / 2},${b.y - b.h / 2})`}
      opacity={b.alpha * (dim ? 0.28 : 1)}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      aria-label={onClick ? `${c.name}: ${down ? 'restart' : 'crash'} it` : undefined}
    >
      {onClick && <rect x={-8} y={-8} width={b.w + 16} height={b.h + 16} fill="transparent" />}
      {glow && <rect x={-6} y={-6} width={b.w + 12} height={b.h + 12} rx={13} fill="none" stroke="var(--accent)" strokeWidth={1.4} strokeDasharray="3 3" />}
      <rect className={k.card} width={b.w} height={b.h} rx={9} />
      <rect x={0} y={9} width={3} height={b.h - 18} rx={1.5} fill={g.color} />
      <circle cx={13} cy={14} r={3.2} fill={down ? SIG.err : busy ? SIG.req : SIG.res} />
      <text className={k.monoStrong} x={22} y={17.5} style={narrow ? { fontSize: 10 } : undefined}>
        {c.name}
      </text>
      {rec && busy && !narrow && <Chip x={b.w - 19} y={14} cw={28} ch={16} label={rec.label} color={rec.color} />}
      <text className={k.mono} x={11} y={b.h - 16} style={{ fontSize: narrow ? 9 : 10, fill: down ? '#ff9aab' : undefined }}>
        {c.status}
      </text>
      <Bar x={10} y={b.h - 10} w={b.w - 20} p={busy ? (c.state === 'fetching' ? 0 : c.p) : null} color={rec?.color ?? SIG.req} />
      {down && <rect width={b.w} height={b.h} rx={9} fill="url(#kit-hatch)" pointerEvents="none" />}
    </g>
  );
}

/* ------------------------------------------------------------------ */
/* Synchronous services                                                */
/* ------------------------------------------------------------------ */

function ServiceNode({ sim, id, name, call, dim, glow }: { sim: MQSim; id: 'email' | 'thumbs' | 'analytics'; name: string; call: string; dim: boolean; glow: boolean }) {
  const b = sim.boxes.get(`svc:${id}`);
  if (!b || Number.isNaN(b.x)) return null;
  const health = id === 'email' ? sim.cfg.email : 'ok';
  const calls = sim.calls.get(id) ?? [];
  const cur = calls[calls.length - 1];
  const p = cur ? clamp((sim.t - cur.t0) / cur.dur, 0, 1) : null;
  const narrow = b.w < 130;
  return (
    <NodeCard
      box={b}
      title={name}
      sub={health === 'down' ? '✕ down' : health === 'slow' ? 'slow: ~4 s' : narrow ? call.split('.')[1] : call}
      led={health === 'down' ? 'down' : health === 'slow' ? 'busy' : 'up'}
      dim={dim}
      glow={glow}
      state={health === 'down' ? 'down' : health === 'slow' ? 'hot' : 'normal'}
    >
      <g transform={`translate(0,${-6})`}>
        <Bar x={12} y={b.h - 4} w={b.w - 24} p={p} color={health === 'slow' ? SIG.heavy : SIG.req} />
      </g>
      {calls.length > 1 && (
        <text className={k.mono} x={b.w - 10} y={b.h / 2 + 11} textAnchor="end" style={{ fontSize: 9 }}>
          ×{calls.length}
        </text>
      )}
    </NodeCard>
  );
}

/* ------------------------------------------------------------------ */
/* Fan-out exchange                                                    */
/* ------------------------------------------------------------------ */

function ExchangeNode({ sim, dim, glow }: { sim: MQSim; dim: boolean; glow: boolean }) {
  const b = sim.boxes.get('ex');
  if (!b || Number.isNaN(b.x)) return null;
  const P = sim.orient === 'portrait';
  const flash = clamp(1 - (sim.vt - sim.exFlash) / 0.5, 0, 1);
  const rows = sim.cfg.subs.map((s) => sim.queueGeo(`q:${s.id}`)).filter((g): g is NonNullable<typeof g> => !!g);
  const bus = b.w - (P ? 9 : 14);
  const y0 = b.y - b.h / 2;
  return (
    <g transform={`translate(${b.x - b.w / 2},${y0})`} opacity={b.alpha * (dim ? 0.28 : 1)}>
      {glow && <rect x={-6} y={-6} width={b.w + 12} height={b.h + 12} rx={14} fill="none" stroke="var(--accent)" strokeWidth={1.4} strokeDasharray="3 3" />}
      <rect width={b.w} height={b.h} rx={10} fill="url(#kit-violet)" stroke="rgba(181,155,255,0.7)" strokeWidth={1.2} />
      {flash > 0 && <rect x={-3} y={-3} width={b.w + 6} height={b.h + 6} rx={13} fill="none" stroke={SIG.hc} strokeWidth={2.4} opacity={flash} />}
      {P ? (
        <text className={k.caps} transform={`translate(${b.w / 2 - 4},${b.h / 2}) rotate(-90)`} textAnchor="middle" style={{ fill: '#cdbdff' }}>
          fanout · user.events
        </text>
      ) : (
        <>
          <text className={k.caps} x={12} y={20} style={{ fill: '#cdbdff' }}>
            exchange
          </text>
          <text className={k.monoStrong} x={12} y={36}>
            user.events
          </text>
          <text className={k.mono} x={12} y={50}>
            type: fanout
          </text>
        </>
      )}
      {rows.length > 0 && (
        <>
          <line x1={bus} y1={rows[0].railY - y0} x2={bus} y2={rows[rows.length - 1].railY - y0} stroke="rgba(181,155,255,0.55)" strokeWidth={1.4} />
          {rows.map((g, i) => (
            <g key={i}>
              <line x1={bus} y1={g.railY - y0} x2={b.w} y2={g.railY - y0} stroke="rgba(181,155,255,0.55)" strokeWidth={1.4} />
              <circle cx={bus} cy={g.railY - y0} r={2.4} fill={SIG.hc} />
            </g>
          ))}
        </>
      )}
    </g>
  );
}

/* ------------------------------------------------------------------ */
/* Partitioned log                                                     */
/* ------------------------------------------------------------------ */

function PartitionRow({ sim, p, dim, pickable, onClick }: { sim: MQSim; p: number; dim: boolean; pickable: boolean; onClick?: () => void }) {
  const g = sim.partGeo(p);
  const b = sim.boxes.get(`p${p}`);
  const part = sim.parts[p];
  if (!g || !b || !part) return null;
  const base = sim.partBase(p);
  const groups = [...sim.groups.values()];
  return (
    <g
      className={cx(k.node, pickable && k.pickable, onClick && k.clickable)}
      opacity={b.alpha * (dim ? 0.28 : 1)}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      aria-label={onClick ? `Partition ${p}` : undefined}
    >
      {onClick && <rect x={g.left - 6} y={g.top - 6} width={g.right - g.left + 12} height={g.bottom - g.top + 12} fill="transparent" />}
      <rect className={k.card} x={g.left} y={g.top} width={g.right - g.left} height={g.bottom - g.top} rx={8} />
      <text className={k.monoStrong} x={g.left + g.lw / 2 + 3} y={g.rowY + 4} textAnchor="middle">
        P{p}
      </text>
      <line x1={g.left + g.lw + 3} y1={g.top + 6} x2={g.left + g.lw + 3} y2={g.bottom - 6} stroke="rgba(143,166,201,0.25)" />
      {part.log.map((r) =>
        r.alpha > 0.03 ? (
          <g key={r.offset}>
            <Chip x={r.x} y={r.y} cw={g.cw} ch={g.ch} label={r.label} color={r.color} alpha={r.alpha} />
            <text className={css.offset} x={r.x} y={r.y + g.ch / 2 + 9} textAnchor="middle" opacity={r.alpha}>
              {r.offset}
            </text>
          </g>
        ) : null,
      )}
      {base > 0 && (
        <text className={k.mono} x={g.x0 - 2} y={g.rowY + 3} textAnchor="end" style={{ fontSize: 9 }}>
          …
        </text>
      )}
      {groups.map((grp) => {
        const mk = sim.markPos(grp.id, p);
        if (!mk) return null;
        const y = mk.y + 6;
        return (
          <g key={grp.id} transform={`translate(${mk.x.toFixed(1)},${y.toFixed(1)})`}>
            <path d="M0,-4.5 L4,1.5 L-4,1.5 Z" fill={grp.color} />
            {mk.clipped && (
              <text className={k.mono} x={7} y={2} style={{ fontSize: 8, fill: grp.color }}>
                {grp.committed[p]}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}

/* ------------------------------------------------------------------ */
/* Traffic                                                             */
/* ------------------------------------------------------------------ */

function FlightPill({ x, y, text, color }: { x: number; y: number; text: string; color: string }) {
  const w = text.length * 6.1 + 10;
  return (
    <g transform={`translate(${x.toFixed(1)},${y.toFixed(1)})`}>
      <rect x={-w / 2} y={-8} width={w} height={14} rx={7} fill="rgba(7,11,20,0.9)" stroke={color} strokeOpacity={0.7} />
      <text className={css.flightLabel} x={0} y={2.5} textAnchor="middle" fill={color}>
        {text}
      </text>
    </g>
  );
}

function Traffic({ sim }: { sim: MQSim }) {
  const { cw, ch } = sim.chipDims();
  return (
    <g>
      {sim.flightViews().map((f) => {
        const trail = f.trail && <line className={k.trail} x1={f.tx} y1={f.ty} x2={f.x} y2={f.y} stroke={f.color} strokeWidth={f.tag === 'msg' ? 5 : f.r * 1.25} opacity={0.22} />;
        if (f.tag === 'msg' && !f.label) {
          return (
            <g key={f.id}>
              {trail}
              <circle cx={f.x} cy={f.y} r={11} fill={f.color} opacity={0.12} />
              <rect x={f.x - 5} y={f.y - 5} width={10} height={10} rx={2} fill={f.color} transform={`rotate(${((f.angle * 180) / Math.PI).toFixed(1)} ${f.x.toFixed(1)} ${f.y.toFixed(1)})`} />
            </g>
          );
        }
        if (f.tag === 'msg') {
          return (
            <g key={f.id}>
              {trail}
              <rect x={f.x - cw / 2 - 3} y={f.y - ch / 2 - 3} width={cw + 6} height={ch + 6} rx={7} fill={f.color} opacity={0.12} />
              <Chip x={f.x} y={f.y} cw={cw} ch={ch} label={f.label ?? ''} color={f.color} />
            </g>
          );
        }
        return (
          <g key={f.id}>
            {trail}
            {f.r >= 3.5 && <circle cx={f.x} cy={f.y} r={f.r * 2.5} fill={f.color} opacity={0.13} />}
            <circle cx={f.x} cy={f.y} r={f.r} fill={f.color} />
            {f.label && <FlightPill x={f.x} y={f.y - f.r - 9} text={f.label} color={f.color} />}
          </g>
        );
      })}
    </g>
  );
}

/** The record waiting at the producer while the learner picks a partition. */
function PendingRecord({ sim }: { sim: MQSim }) {
  const h = sim.hash;
  const b = sim.boxes.get('api');
  if (!h || !h.asking || !b) return null;
  const { cw, ch } = sim.chipDims();
  const P = sim.orient === 'portrait';
  const x = P ? b.x + b.w / 2 + 26 : b.x + b.w / 2 + 28;
  const y = P ? b.y : b.y;
  const k2 = (Math.sin(sim.vt * 5) + 1) / 2;
  return (
    <g>
      <circle cx={x} cy={y} r={20 + k2 * 5} fill="none" stroke="var(--accent)" strokeWidth={1.3} strokeDasharray="3 4" opacity={0.4 + 0.4 * (1 - k2)} />
      <Chip x={x} y={y} cw={cw} ch={ch} label={h.label} color={h.color} />
    </g>
  );
}

/* ------------------------------------------------------------------ */
/* The whole scene                                                     */
/* ------------------------------------------------------------------ */

export function Scene({
  sim,
  focus,
  highlight,
  onWorker,
  onConsumer,
  onPartition,
}: {
  sim: MQSim;
  focus?: string[];
  highlight: string | null;
  onWorker?: (id: string) => void;
  onConsumer?: (id: string) => void;
  onPartition?: (p: number) => void;
}) {
  const dim = (id: string) => !!focus?.length && !focus.some((f) => f === id || (f.endsWith('*') && id.startsWith(f.slice(0, -1))));
  const glow = (id: string) => highlight === id || (!!highlight?.endsWith('*') && id.startsWith(highlight.slice(0, -1)));
  const api = sim.boxes.get('api');
  const c = sim.cfg;
  const pending = !!sim.game?.pending;
  return (
    <>
      <Wires sim={sim} />

      {USERS.slice(0, 3).map((u) => {
        const b = sim.boxes.get(`u:${u.id}`);
        if (!b || Number.isNaN(b.x)) return null;
        const fl = sim.userFlash.get(u.id);
        const kk = fl ? clamp((sim.vt - fl.vt) / 0.9, 0, 1) : 1;
        return (
          <ClientCard
            key={u.id}
            box={b}
            name={u.name}
            sub={sim.userStatus(u.id)}
            color={u.color}
            dim={dim(`u:${u.id}`)}
            glow={glow(`u:${u.id}`)}
            pulse={fl && kk < 1 ? { color: fl.ok ? SIG.res : SIG.err, k: kk } : null}
          />
        );
      })}

      {api && !Number.isNaN(api.x) && (
        <NodeCard
          box={api}
          title={c.producer}
          sub={c.producerSub}
          led="up"
          dim={dim('api')}
          glow={glow('api')}
          kicker={c.mode === 'sync' ? undefined : { text: c.mode === 'log' ? 'producer · partitioner' : 'producer', color: 'var(--text-3)' }}
        />
      )}

      {SERVICES.map((s) => (
        <ServiceNode key={s.id} sim={sim} id={s.id} name={s.name} call={s.call} dim={dim(`svc:${s.id}`)} glow={glow(`svc:${s.id}`)} />
      ))}

      <ExchangeNode sim={sim} dim={dim('ex')} glow={glow('ex')} />

      {[...sim.queues.values()].map((q) => (
        <QueueNode key={q.id} sim={sim} q={q} dim={dim(q.id)} glow={glow(q.id)} />
      ))}

      {sim.parts.map((part) => (
        <PartitionRow
          key={part.idx}
          sim={sim}
          p={part.idx}
          dim={dim(`p${part.idx}`)}
          pickable={pending && c.predict === 'partition'}
          onClick={pending && c.predict === 'partition' && onPartition ? () => onPartition(part.idx) : undefined}
        />
      ))}

      {[...sim.workers.values()].map((w) => (
        <WorkerNode
          key={w.id}
          sim={sim}
          w={w}
          dim={dim(w.id)}
          glow={glow(w.id) || glow('workers')}
          onClick={c.clickWorkers && onWorker && !pending && !w.sub ? () => onWorker(w.id) : undefined}
        />
      ))}

      {[...sim.consumers.values()].map((cn) => (
        <ConsumerNode
          key={cn.id}
          sim={sim}
          c={cn}
          dim={dim(cn.id)}
          glow={glow(cn.id) || glow(`group:${cn.group}`)}
          onClick={c.clickWorkers && onConsumer ? () => onConsumer(cn.id) : undefined}
        />
      ))}

      <Traffic sim={sim} />
      <PendingRecord sim={sim} />
      <Effects sim={sim} />
    </>
  );
}

