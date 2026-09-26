'use client';

import { SequenceDiagram, type SeqMessage, type SeqNote, type SeqSpan } from '@/components/stage/SequenceDiagram';
import { Cylinder, Effects, Flights, NodeCard, Wires } from '@/components/stage/svg';
import stage from '@/components/stage/stage.module.css';
import { SIG } from '@/lib/sim/colors';
import { bezier, clamp, curvePath, type Curve } from '@/lib/sim/geometry';
import { FRAMES, bits, byte0, byte1, headerBytes, hex } from './frames';
import { FIELDS, frameGeo, raceGeo, type FieldGeo } from './geo';
import { EMPTY, PEOPLE, PIPE, SERVER_META, type Leaf, type PersonId, type ServerId, type WsSim } from './sim';
import css from './ws.module.css';

const easeOut = (p: number) => 1 - (1 - clamp(p, 0, 1)) ** 3;
const fx = (n: number) => n.toFixed(1);

export interface SceneProps {
  sim: WsSim;
  highlight: string | null;
  focus: string[] | null;
}

export function Scene(props: SceneProps) {
  switch (props.sim.cfg.view) {
    case 'race':
      return <RaceScene sim={props.sim} highlight={props.highlight} />;
    case 'seq':
      return <SeqScene sim={props.sim} />;
    case 'frame':
      return <FrameScene {...props} />;
    case 'choose':
      return <ChooseScene {...props} />;
    default:
      return <ChatScene {...props} />;
  }
}

/* ================================================================== */
/* The chat world                                                      */
/* ================================================================== */

function ChatScene({ sim, highlight, focus }: SceneProps) {
  const c = sim.cfg;
  const dim = (id: string) => !!focus?.length && !focus.includes(id);
  const glow = (id: string) => highlight === id;
  return (
    <g>
      <Wires sim={sim} />
      <HeldMarks sim={sim} />
      <BlockedMarks sim={sim} />
      <HandshakeMarks sim={sim} />
      <Pipes sim={sim} focus={focus} glow={highlight} />
      {c.lb && <LbBar sim={sim} dim={dim('lb')} glow={glow('lb')} />}
      {c.redis && <RedisNode sim={sim} dim={dim('redis') || !c.backplane} glow={glow('redis')} />}
      {sim.liveServers().map((sid) => (
        <ServerCard key={sid} sim={sim} sid={sid} dim={dim(sid)} glow={glow(sid) || glow('server')} />
      ))}
      {c.people.map((pid) => (
        <ChatWindow key={pid} sim={sim} pid={pid} dim={dim(pid)} glow={glow(pid)} />
      ))}
      <CutMarks sim={sim} />
      <Flights sim={sim} />
      <Effects sim={sim} />
    </g>
  );
}

/* ---------------- chat window ---------------- */

function ChatWindow({ sim, pid, dim, glow }: { sim: WsSim; pid: PersonId; dim: boolean; glow: boolean }) {
  const b = sim.boxes.get(pid);
  if (!b || Number.isNaN(b.x)) return null;
  const p = sim.ppl.get(pid)!;
  const meta = PEOPLE[pid];
  const small = b.h < 112 || b.w < 172;
  const hdr = small ? 24 : 30;
  const st = sim.statusOf(pid);
  const bh = small ? 18 : 22;
  const gap = small ? 4 : 6;
  const padT = small ? 5 : 9;
  const areaTop = hdr + padT;
  const areaH = b.h - hdr - padT - (small ? 5 : 9);
  const maxRows = Math.max(1, Math.floor((areaH + gap) / (bh + gap)));
  const rows = p.log.slice(-maxRows);
  const newest = rows[rows.length - 1];
  const age = newest ? sim.vt - newest.vt : 9;
  const slide = age < 0.35 ? (1 - easeOut(age / 0.35)) * (bh + gap) : 0;
  const group = sim.cfg.people.length > 2;
  const charW = small ? 5.3 : 5.9;
  const ar = small ? 7.5 : 9.5;
  const ax = small ? 14 : 17;
  const clipId = `ws-clip-${pid}`;
  return (
    <g transform={`translate(${fx(b.x - b.w / 2)},${fx(b.y - b.h / 2)})`} opacity={b.alpha * (dim ? 0.28 : 1)}>
      {glow && <rect x={-6} y={-6} width={b.w + 12} height={b.h + 12} rx={14} fill="none" stroke="var(--accent)" strokeWidth={1.4} strokeDasharray="3 3" />}
      <rect className={stage.card} width={b.w} height={b.h} rx={10} />
      <path className={css.winHead} d={`M1,${hdr} V10 Q1,1 10,1 H${b.w - 10} Q${b.w - 1},1 ${b.w - 1},10 V${hdr} Z`} />
      <line className={css.winRule} x1={1} y1={hdr} x2={b.w - 1} y2={hdr} />
      <circle cx={ax} cy={hdr / 2} r={ar} fill={meta.color} fillOpacity={0.15} stroke={meta.color} strokeWidth={1.2} />
      <text x={ax} y={hdr / 2 + 3.6} textAnchor="middle" fill={meta.color} style={{ fontFamily: 'var(--font-sans)', fontSize: small ? 9.5 : 11, fontWeight: 600 }}>
        {meta.name[0]}
      </text>
      <text className={stage.name} x={ax + ar + 7} y={hdr / 2 + 4.2} style={small ? { fontSize: 11.5 } : undefined}>
        {meta.name}
      </text>
      <WifiGlyph x={b.w - 12} y={hdr / 2} ok={p.net} />
      {st && (
        <g>
          <circle cx={b.w - 26 - st.text.length * (small ? 5.2 : 5.75) - 7} cy={hdr / 2} r={2.6} fill={st.color} />
          <text className={css.status} x={b.w - 24} y={hdr / 2 + 3.3} textAnchor="end" fill={st.color} style={small ? { fontSize: 8.8 } : undefined}>
            {st.text}
          </text>
        </g>
      )}
      <clipPath id={clipId}>
        <rect x={2} y={hdr + 1} width={b.w - 4} height={b.h - hdr - 3} />
      </clipPath>
      <g clipPath={`url(#${clipId})`}>
        {!rows.length && (
          <text className={css.empty} x={b.w / 2} y={hdr + (b.h - hdr) / 2 + 3} textAnchor="middle">
            no messages yet
          </text>
        )}
        {rows.map((m, i) => {
          const fromBottom = rows.length - 1 - i;
          const y = areaTop + areaH - bh - fromBottom * (bh + gap) + slide;
          const color = PEOPLE[m.from].color;
          const isNew = m === newest && age < 0.3;
          const meta2 = m.mine ? (m.ok ? '✓' : '…') : m.delay != null ? `+${m.delay.toFixed(1)}s` : '';
          const metaW = meta2 ? meta2.length * 5.4 + 8 : 0;
          const prefix = (!m.mine && group ? 12 : 0) + (m.dm ? 20 : 0) + (m.resync ? 14 : 0);
          const maxTextW = b.w - 22 - metaW - prefix - 16;
          const maxChars = Math.max(4, Math.floor(maxTextW / charW));
          const text = m.text.length > maxChars ? `${m.text.slice(0, maxChars - 1)}…` : m.text;
          const bw = text.length * charW + 16 + prefix;
          const bx = m.mine ? b.w - 10 - bw : 10;
          const delayTone = m.delay == null ? 'var(--text-3)' : m.delay > 5 ? SIG.err : m.delay > 2.6 ? SIG.heavy : SIG.res;
          return (
            <g key={m.id} opacity={isNew ? Math.min(1, age / 0.22) : 1}>
              <rect x={bx} y={y} width={bw} height={bh} rx={bh / 2} fill={color} fillOpacity={m.mine ? 0.16 : 0.1} stroke={color} strokeOpacity={m.mine ? 0.5 : 0.38} />
              {!m.mine && group && <circle cx={bx + 10} cy={y + bh / 2} r={3} fill={color} />}
              {m.dm && (
                <text className={css.dmTag} x={bx + 8 + (!m.mine && group ? 12 : 0)} y={y + bh / 2 + 3} fill={color}>
                  DM
                </text>
              )}
              {m.resync && (
                <text className={css.dmTag} x={bx + 8 + (!m.mine && group ? 12 : 0) + (m.dm ? 20 : 0)} y={y + bh / 2 + 3.2} fill={SIG.hc}>
                  ↻
                </text>
              )}
              <text className={small ? css.bubbleTextSm : css.bubbleText} x={bx + 8 + prefix} y={y + bh / 2 + (small ? 3.4 : 3.8)}>
                {text}
              </text>
              {meta2 && (
                <text
                  className={css.meta}
                  x={m.mine ? bx - 5 : bx + bw + 5}
                  y={y + bh / 2 + 3}
                  textAnchor={m.mine ? 'end' : 'start'}
                  style={{ fill: m.mine ? (m.ok ? SIG.res : 'var(--text-3)') : delayTone }}
                >
                  {meta2}
                </text>
              )}
            </g>
          );
        })}
      </g>
    </g>
  );
}

function WifiGlyph({ x, y, ok }: { x: number; y: number; ok: boolean }) {
  const c = ok ? 'rgba(143,166,201,0.55)' : SIG.err;
  return (
    <g transform={`translate(${x},${y + 3})`} stroke={c} strokeWidth={1.2} fill="none" strokeLinecap="round">
      <path d="M-5,-4 Q0,-8.5 5,-4" />
      <path d="M-3,-1.6 Q0,-4.2 3,-1.6" />
      <circle cx={0} cy={1} r={0.9} fill={c} stroke="none" />
      {!ok && <line x1={-5.5} y1={2.5} x2={5.5} y2={-8} strokeWidth={1.4} />}
    </g>
  );
}

/* ---------------- servers, proxy, redis ---------------- */

function ServerCard({ sim, sid, dim, glow }: { sim: WsSim; sid: ServerId; dim: boolean; glow: boolean }) {
  const b = sim.boxes.get(sid);
  if (!b || Number.isNaN(b.x)) return null;
  const s = sim.srv.get(sid)!;
  const single = sim.cfg.servers === 1;
  const title = single ? 'chat server' : SERVER_META[sid].name;
  const sub = single ? 'chat.example' : SERVER_META[sid].ip;
  const small = b.h < 64;
  const mode = sim.cfg.mode;
  const conns = [...s.conns.keys()];
  const waiting = mode !== 'ws' && mode !== 'sse' ? sim.pendingFor('bob').length : 0;
  const pending = sim.game?.pending && 'id' in (sim.game.pending.askAt ?? {}) && (sim.game.pending.askAt as { id: string }).id === sid;
  const state = !s.up ? 'down' : pending ? 'hot' : 'normal';
  const y1 = small ? 18 : 24;
  const y2 = small ? 31 : 38;
  const y3 = small ? 45 : 57;
  const cr = small ? 5.5 : 6.5;
  return (
    <g
      transform={`translate(${fx(b.x - b.w / 2)},${fx(b.y - b.h / 2)})`}
      opacity={b.alpha * (dim ? 0.28 : 1)}
      data-state={state}
      className={stage.node}
    >
      {glow && <rect x={-6} y={-6} width={b.w + 12} height={b.h + 12} rx={14} fill="none" stroke="var(--accent)" strokeWidth={1.4} strokeDasharray="3 3" />}
      <rect className={stage.card} width={b.w} height={b.h} rx={10} />
      <rect className={stage.cardInner} x={3.5} y={3.5} width={b.w - 7} height={b.h - 7} rx={7.5} />
      {!s.up && <rect width={b.w} height={b.h} rx={10} fill="url(#kit-hatch)" />}
      <circle cx={12} cy={y1 - 4} r={3.2} fill={s.up ? SIG.res : SIG.err} />
      <text className={stage.name} x={22} y={y1} style={small ? { fontSize: 11.5 } : undefined}>
        {title}
      </text>
      <text className={stage.mono} x={22} y={y2} style={small ? { fontSize: 9 } : undefined}>
        {!s.up ? 'restarting…' : sub}
      </text>
      {mode === 'ws' &&
        (conns.length ? (
          conns.map((pid, i) => (
            <g key={pid} transform={`translate(${22 + cr + i * (cr * 2 + 4)},${y3 - 3.5})`}>
              <circle r={cr} fill={PEOPLE[pid].color} fillOpacity={0.18} stroke={PEOPLE[pid].color} strokeWidth={1.1} />
              <text className={css.chipInitial} y={3.2} textAnchor="middle" fill={PEOPLE[pid].color}>
                {PEOPLE[pid].name[0]}
              </text>
            </g>
          ))
        ) : (
          <text className={css.meta} x={22} y={y3}>
            no sockets
          </text>
        ))}
      {mode === 'ws' && conns.length > 0 && (
        <text className={css.meta} x={22 + conns.length * (cr * 2 + 4) + 4} y={y3}>
          {small ? '' : conns.length === 1 ? 'socket' : 'sockets'}
        </text>
      )}
      {(mode === 'http' || mode === 'short' || mode === 'long') && sim.cfg.people.includes('bob') && (
        <g transform={`translate(22,${y3 - 8})`}>
          <rect width={11} height={8} rx={1.5} fill="none" stroke={waiting ? SIG.warn : 'rgba(143,166,201,0.5)'} strokeWidth={1.1} />
          <path d="M0.5,0.8 L5.5,4.6 L10.5,0.8" fill="none" stroke={waiting ? SIG.warn : 'rgba(143,166,201,0.5)'} strokeWidth={1} />
          <text className={css.meta} x={16} y={7.5} style={{ fill: waiting ? SIG.warn : undefined }}>
            {waiting ? `${waiting} waiting for Bob` : 'nothing for Bob'}
          </text>
        </g>
      )}
      {mode === 'sse' && (
        <text className={css.meta} x={22} y={y3}>
          {sim.cfg.receivers.filter((r) => sim.ppl.get(r)!.sse === 'open').length} open streams
        </text>
      )}
    </g>
  );
}

function LbBar({ sim, dim, glow }: { sim: WsSim; dim: boolean; glow: boolean }) {
  const b = sim.boxes.get('lb');
  if (!b || Number.isNaN(b.x)) return null;
  const small = b.w < 24;
  const fresh = sim.lastLb && sim.vt - sim.lastLb.vt < 0.8;
  const c = sim.cfg;
  return (
    <g opacity={b.alpha * (dim ? 0.28 : 1)}>
      <g transform={`translate(${fx(b.x - b.w / 2)},${fx(b.y - b.h / 2)})`}>
        {glow && <rect x={-6} y={-6} width={b.w + 12} height={b.h + 12} rx={12} fill="none" stroke="var(--accent)" strokeWidth={1.4} strokeDasharray="3 3" />}
        <rect className={stage.card} width={b.w} height={b.h} rx={small ? 6 : 8} style={{ stroke: fresh ? SIG.warn : 'rgba(181,155,255,0.55)' }} />
        <text className={css.lbLabel} transform={`translate(${b.w / 2 + 3.2},${b.h / 2}) rotate(-90)`} textAnchor="middle" style={small ? { fontSize: 7.5, letterSpacing: '0.1em' } : undefined}>
          {c.lbName}
        </text>
      </g>
      {c.people.map((pid) => {
        const g = sim.boxes.get(`gate:${pid}`);
        if (!g || Number.isNaN(g.x)) return null;
        const s = sim.srv.get(sim.ppl.get(pid)!.server)!;
        const cn = s.conns.get(pid);
        const r = small ? 6 : 9;
        const k = cn && c.idle > 0 ? clamp((sim.t - cn.lastTraffic) / c.idle, 0, 1) : 0;
        const col = k > 0.8 ? SIG.err : k > 0.55 ? SIG.heavy : SIG.hc;
        const a0 = -Math.PI / 2;
        const a1 = a0 + k * Math.PI * 2;
        const large = k > 0.5 ? 1 : 0;
        return (
          <g key={pid}>
            <circle cx={g.x} cy={g.y} r={r} fill="var(--ink-1)" stroke={cn ? 'rgba(181,155,255,0.6)' : 'rgba(143,166,201,0.3)'} strokeWidth={1.1} />
            {cn && c.idle > 0 && k > 0.001 && (
              <path
                d={
                  k >= 0.999
                    ? `M${g.x},${g.y - r} A${r},${r} 0 1 1 ${g.x - 0.01},${g.y - r}`
                    : `M${fx(g.x + r * Math.cos(a0))},${fx(g.y + r * Math.sin(a0))} A${r},${r} 0 ${large} 1 ${fx(g.x + r * Math.cos(a1))},${fx(g.y + r * Math.sin(a1))}`
                }
                fill="none"
                stroke={col}
                strokeWidth={2.2}
                strokeLinecap="round"
              />
            )}
            <circle cx={g.x} cy={g.y} r={small ? 1.8 : 2.4} fill={cn ? PIPE : 'rgba(143,166,201,0.4)'} />
          </g>
        );
      })}
    </g>
  );
}

function RedisNode({ sim, dim, glow }: { sim: WsSim; dim: boolean; glow: boolean }) {
  const b = sim.boxes.get('redis');
  if (!b || Number.isNaN(b.x)) return null;
  const small = b.w < 100;
  return (
    <g>
      <Cylinder box={b} title="redis" sub={small ? undefined : 'pub/sub'} dim={dim} glow={glow} tone="rgba(181,155,255,0.7)" />
      <text className={css.small} x={b.x} y={b.y + b.h / 2 + 14} textAnchor="middle" opacity={b.alpha * (dim ? 0.4 : 1)} style={{ fill: '#cdbdff' }}>
        {small ? 'room:42' : 'channel room:42'}
      </text>
    </g>
  );
}

/* ---------------- the open connection ---------------- */

function Pipes({ sim, focus, glow }: { sim: WsSim; focus: string[] | null; glow: string | null }) {
  const c = sim.cfg;
  return (
    <g>
      {c.people.map((pid) => {
        const p = sim.ppl.get(pid)!;
        if (p.pipe < 0.01) return null;
        const curves = sim.pipeCurves(pid);
        if (!curves.length) return null;
        const dimmed = !!focus?.length && !focus.includes(pid) && !focus.includes(`pipe:${pid}`);
        return (
          <Pipe
            key={pid}
            curves={curves}
            k={p.pipe}
            broken={!p.net}
            oneway={c.mode === 'sse'}
            vt={sim.vt}
            dim={dimmed}
            glow={glow === `pipe:${pid}` || glow === 'pipe'}
            fresh={sim.vt - p.openVt < 1.2 ? 1 - (sim.vt - p.openVt) / 1.2 : 0}
          />
        );
      })}
    </g>
  );
}

export function Pipe({
  curves,
  k,
  broken,
  oneway,
  vt,
  dim,
  glow,
  fresh = 0,
}: {
  curves: Curve[];
  k: number;
  broken?: boolean;
  oneway?: boolean;
  vt: number;
  dim?: boolean;
  glow?: boolean;
  fresh?: number;
}) {
  const d = curves.map(curvePath).join(' ');
  const wWall = 10.5 * k;
  const wCore = 8 * k;
  const col = broken ? SIG.err : PIPE;
  const last = curves[curves.length - 1];
  const first = curves[0];
  // Chevrons for a one-way stream, drifting from the server toward the browser.
  const chevrons: { x: number; y: number; a: number }[] = [];
  if (oneway && first && !broken) {
    const n = 4;
    const phase = (vt * 0.22) % (1 / n);
    for (let i = 0; i < n; i++) {
      const t = 1 - (i / n + phase) - 0.06;
      if (t < 0.08 || t > 0.94) continue;
      const p = bezier(first, t);
      const q = bezier(first, clamp(t - 0.02, 0, 1));
      chevrons.push({ x: p.x, y: p.y, a: (Math.atan2(q.y - p.y, q.x - p.x) * 180) / Math.PI });
    }
  }
  const cut = broken && first ? bezier(first, 0.3) : null;
  return (
    <g opacity={Math.min(1, k * 1.3) * (dim ? 0.3 : 1)}>
      <path d={d} stroke={col} strokeWidth={wWall + 10 + fresh * 14} strokeOpacity={0.05 + fresh * 0.12} fill="none" strokeLinecap="round" />
      {glow && <path d={d} stroke="var(--accent)" strokeWidth={wWall + 8} strokeOpacity={0.5} fill="none" strokeDasharray="3 4" />}
      <path d={d} stroke={col} strokeWidth={wWall} strokeOpacity={broken ? 0.45 : 0.62} fill="none" strokeDasharray={broken ? '7 5' : undefined} />
      <path d={d} stroke="var(--ink-1)" strokeWidth={wCore} fill="none" />
      <path d={d} stroke={col} strokeWidth={wCore} strokeOpacity={broken ? 0.04 : 0.14} fill="none" />
      {!broken && !oneway && <path d={d} stroke={col} strokeWidth={1.1} strokeOpacity={0.5} fill="none" strokeDasharray="1.5 12" strokeDashoffset={-vt * 12} />}
      {chevrons.map((c, i) => (
        <path key={i} d="M-3,-3.4 L1.6,0 L-3,3.4" transform={`translate(${fx(c.x)},${fx(c.y)}) rotate(${fx(c.a)})`} fill="none" stroke={PIPE} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" opacity={0.85} />
      ))}
      {cut && (
        <g transform={`translate(${fx(cut.x)},${fx(cut.y)})`} stroke={SIG.err} strokeWidth={2.2} strokeLinecap="round">
          <circle r={9} fill="var(--ink-1)" stroke={SIG.err} strokeWidth={1.2} />
          <line x1={-4} y1={-4} x2={4} y2={4} />
          <line x1={-4} y1={4} x2={4} y2={-4} />
        </g>
      )}
      {last && null}
    </g>
  );
}

/** A long-poll request parked on the server: the line stays lit until it's answered. */
function HeldMarks({ sim }: { sim: WsSim }) {
  if (sim.cfg.mode !== 'long') return null;
  return (
    <g>
      {sim.cfg.receivers.map((pid) => {
        const p = sim.ppl.get(pid)!;
        if (p.lp !== 'held') return null;
        const c = sim.route(pid, p.server);
        if (!c) return null;
        const d = curvePath(c);
        const end = bezier(c, 1);
        const held = sim.t - p.heldSince;
        const pulse = (sim.vt * 1.2) % 1;
        return (
          <g key={pid}>
            <path d={d} stroke={SIG.req} strokeWidth={2} strokeOpacity={0.55} fill="none" strokeDasharray="5 5" strokeDashoffset={-sim.vt * 10} />
            <circle cx={end.x} cy={end.y} r={5 + pulse * 10} fill="none" stroke={SIG.req} strokeWidth={1.6 * (1 - pulse)} opacity={1 - pulse} />
            <circle cx={end.x} cy={end.y} r={4.2} fill={SIG.req} />
            <text className={`${css.small} ${css.halo}`} x={end.x + (sim.orient === 'landscape' ? 10 : 12)} y={end.y + (sim.orient === 'landscape' ? 20 : 4)} style={{ fill: SIG.req }}>
              GET held {held.toFixed(1)} s
            </text>
          </g>
        );
      })}
    </g>
  );
}

/** Plain HTTP: the server has news for Bob but no request of his to answer. */
function BlockedMarks({ sim }: { sim: WsSim }) {
  if (sim.cfg.mode !== 'http' || !sim.cfg.people.includes('bob')) return null;
  const waiting = sim.pendingFor('bob').length;
  if (!waiting) return null;
  const c = sim.route(sim.ppl.get('bob')!.server, 'bob');
  if (!c) return null;
  const from = bezier(c, 0.04);
  const to = bezier(c, 0.42);
  const land = sim.orient === 'landscape';
  const pulse = 0.55 + 0.45 * Math.sin(sim.vt * 3);
  return (
    <g opacity={0.9}>
      <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke={SIG.res} strokeWidth={1.6} strokeDasharray="3 4" strokeOpacity={0.55} />
      <g transform={`translate(${fx(to.x)},${fx(to.y)})`} stroke={SIG.err} strokeWidth={2} strokeLinecap="round" opacity={pulse}>
        <line x1={-4.5} y1={-4.5} x2={4.5} y2={4.5} />
        <line x1={-4.5} y1={4.5} x2={4.5} y2={-4.5} />
      </g>
      <text
        className={`${css.small} ${css.halo}`}
        x={land ? to.x : to.x + 12}
        y={land ? to.y + 20 : to.y + 4}
        textAnchor={land ? 'middle' : 'start'}
        style={{ fill: SIG.err }}
      >
        no request to answer
      </text>
    </g>
  );
}

/** While the upgrade is in flight, the connection underneath is plain TCP + TLS. */
function HandshakeMarks({ sim }: { sim: WsSim }) {
  if (sim.cfg.mode !== 'ws' || sim.cfg.lb) return null;
  const asking = !!sim.game?.pending;
  return (
    <g>
      {sim.cfg.people.map((pid) => {
        const p = sim.ppl.get(pid)!;
        if (p.conn !== 'connecting' || !p.net) return null;
        const c = sim.route(pid, p.server);
        if (!c) return null;
        const m = bezier(c, 0.5);
        const land = sim.orient === 'landscape';
        const horizontal = Math.abs(c.p3.x - c.p0.x) > Math.abs(c.p3.y - c.p0.y);
        return (
          <g key={pid}>
            <path d={curvePath(c)} fill="none" stroke="rgba(143,166,201,0.55)" strokeWidth={2.4} />
            {!(asking && !land) && (
            <text
              className={`${css.small} ${css.halo}`}
              x={horizontal ? m.x : m.x + 12}
              y={horizontal ? m.y + (land ? 22 : 20) : m.y + 4}
              textAnchor={horizontal ? 'middle' : 'start'}
            >
              TCP + TLS, still HTTP
            </text>
            )}
          </g>
        );
      })}
    </g>
  );
}

function CutMarks({ sim }: { sim: WsSim }) {
  return (
    <g>
      {sim.cfg.people.map((pid) => {
        const p = sim.ppl.get(pid)!;
        if (p.net) return null;
        const target = sim.cfg.lb ? `gate:${pid}` : p.server;
        const c = sim.route(pid, target);
        if (!c) return null;
        const at = bezier(c, 0.3);
        const land = sim.orient === 'landscape';
        const horizontal = Math.abs(c.p3.x - c.p0.x) > Math.abs(c.p3.y - c.p0.y);
        return (
          <g key={pid}>
            {p.pipe < 0.05 && (
              <g transform={`translate(${fx(at.x)},${fx(at.y)})`} stroke={SIG.err} strokeWidth={2.2} strokeLinecap="round">
                <circle r={9} fill="var(--ink-1)" stroke={SIG.err} strokeWidth={1.2} />
                <line x1={-4} y1={-4} x2={4} y2={4} />
                <line x1={-4} y1={4} x2={4} y2={-4} />
              </g>
            )}
            <text
              className={`${css.small} ${css.halo}`}
              x={at.x + (horizontal ? 0 : 14)}
              y={at.y + (horizontal ? (land ? -16 : -14) : 4)}
              textAnchor={horizontal ? 'middle' : 'start'}
              style={{ fill: SIG.err }}
            >
              no network
            </text>
          </g>
        );
      })}
    </g>
  );
}

/* ================================================================== */
/* Race: three lanes, each a sequence diagram on its side               */
/* ================================================================== */

const LANE_TITLE: Record<string, string> = { short: 'Short polling', long: 'Long polling', ws: 'WebSocket' };

function RaceScene({ sim, highlight }: { sim: WsSim; highlight: string | null }) {
  const land = sim.orient === 'landscape';
  const g = raceGeo(sim.w, sim.h, land);
  const r = sim.race;
  const now = r.t;
  const X = (t: number) => g.x1 - (now - t) * g.pps;
  const t0 = now - g.span;
  const clipId = 'ws-race-clip';
  const gridTimes: number[] = [];
  for (let s = Math.ceil(t0); s <= now; s++) gridTimes.push(s);
  const last = g.lanes[g.lanes.length - 1];
  return (
    <g>
      <defs>
        <clipPath id={clipId}>
          <rect x={g.x0} y={0} width={g.x1 - g.x0 + 2} height={sim.h} />
        </clipPath>
      </defs>
      {g.lanes.map((L) => {
        const lane = r.lane(L.kind);
        const avg = r.avg(L.kind);
        const title = L.kind === 'short' ? `${LANE_TITLE.short} · every ${r.interval} s` : LANE_TITLE[L.kind];
        const summary = `${lane.requests} requests · ${lane.empty} empty · avg ${avg == null ? '–' : `${avg.toFixed(1)} s`}`;
        return (
          <g key={L.kind}>
            <rect
              x={g.x0 - (land ? 104 : 8)}
              y={L.y}
              width={g.x1 - g.x0 + (land ? 104 : 16)}
              height={L.h}
              rx={10}
              fill="rgba(8,13,24,0.5)"
              stroke={highlight === `lane:${L.kind}` ? 'var(--accent)' : 'rgba(143,166,201,0.14)'}
              strokeDasharray={highlight === `lane:${L.kind}` ? '3 3' : undefined}
              strokeWidth={highlight === `lane:${L.kind}` ? 1.4 : 1}
            />
            <text className={css.laneTitle} x={land ? g.x0 - 92 : g.x0} y={L.y + (land ? 18 : 15)}>
              {title}
            </text>
            {!land && (
              <text className={css.laneSub} x={g.x0} y={L.y + 28}>
                {summary}
              </text>
            )}
            <line className={css.track} x1={g.x0} y1={L.ySrv} x2={g.x1} y2={L.ySrv} />
            <line className={css.track} x1={g.x0} y1={L.yBob} x2={g.x1} y2={L.yBob} />
            {land ? (
              <>
                <text className={css.trackLabel} x={g.x0 - 10} y={L.ySrv + 3} textAnchor="end">
                  server
                </text>
                <text className={css.trackLabel} x={g.x0 - 10} y={L.yBob + 3} textAnchor="end">
                  Bob&apos;s browser
                </text>
              </>
            ) : null}
            <g clipPath={`url(#${clipId})`}>
              {gridTimes.map((s) => (
                <line key={s} className={css.grid} x1={X(s)} y1={L.ySrv - 4} x2={X(s)} y2={L.yBob + 4} />
              ))}
              {L.kind === 'ws' && (
                <g>
                  <rect x={g.x0} y={L.ySrv} width={g.x1 - g.x0} height={L.yBob - L.ySrv} fill={PIPE} fillOpacity={0.07} />
                  <line x1={g.x0} y1={L.ySrv} x2={g.x1} y2={L.ySrv} stroke={PIPE} strokeOpacity={0.55} />
                  <line x1={g.x0} y1={L.yBob} x2={g.x1} y2={L.yBob} stroke={PIPE} strokeOpacity={0.55} />
                  <text className={css.trackLabel} x={g.x0 + 8} y={(L.ySrv + L.yBob) / 2 + 3} style={{ fill: PIPE }}>
                    one open connection
                  </text>
                </g>
              )}
              {lane.holds.map((h, i) => {
                const a = X(h.t0);
                const b = X(h.t1 ?? now);
                if (b < g.x0) return null;
                return (
                  <g key={i}>
                    <rect x={a} y={L.ySrv - 4} width={Math.max(2, b - a)} height={8} rx={4} fill={SIG.req} fillOpacity={0.22} stroke={SIG.req} strokeOpacity={0.6} />
                    {land && b - a > 70 && (
                      <text className={css.trackLabel} x={(a + b) / 2} y={L.ySrv - 9} textAnchor="middle" style={{ fill: SIG.req }}>
                        held open
                      </text>
                    )}
                  </g>
                );
              })}
              {r.msgs.map((m) =>
                X(m.ts) < g.x0 - 40 ? null : (
                  <g key={m.id}>
                    <line x1={X(m.ts)} y1={L.ySrv - 10} x2={X(m.ts)} y2={L.yBob + 6} stroke={SIG.warn} strokeOpacity={0.3} strokeDasharray="2 4" />
                    {m.tServer <= now && (
                      <path d={`M${fx(X(m.tServer))},${L.ySrv - 5} l5,5 l-5,5 l-5,-5 Z`} fill={SIG.pink} stroke="var(--ink-1)" strokeWidth={1} />
                    )}
                  </g>
                ),
              )}
              {lane.segs.map((s, i) => {
                if (s.t0 > now || X(s.t1) < g.x0 - 10) return null;
                const k = clamp((now - s.t0) / (s.t1 - s.t0), 0, 1);
                const up = s.kind === 'req';
                const xa = X(s.t0);
                const ya = up ? L.yBob : L.ySrv;
                const xb = X(s.t1);
                const yb = up ? L.ySrv : L.yBob;
                const hx = xa + (xb - xa) * k;
                const hy = ya + (yb - ya) * k;
                const color = s.kind === 'req' ? SIG.req : s.kind === 'empty' ? EMPTY : SIG.res;
                return (
                  <g key={i}>
                    <line x1={xa} y1={ya} x2={hx} y2={hy} stroke={color} strokeWidth={s.kind === 'empty' ? 1.3 : 1.7} strokeOpacity={s.kind === 'empty' ? 0.75 : 0.95} strokeLinecap="round" />
                    {k < 1 && <circle cx={hx} cy={hy} r={3.4} fill={color} />}
                  </g>
                );
              })}
              {(() => {
                let lastRight = -Infinity;
                return lane.deliv.map((d) => {
                  const a = X(d.ts);
                  const b = X(d.tr);
                  if (b < g.x0 - 20) return null;
                  const lat = d.tr - d.ts;
                  const col = lat > 3 ? SIG.err : lat > 1.6 ? SIG.heavy : SIG.res;
                  const y = L.yBob + (land ? 9 : 7);
                  const label = `${lat.toFixed(1)} s`;
                  const lw = label.length * 6.2;
                  const mid = (a + b) / 2;
                  const show = mid - lw / 2 > lastRight + 4 && mid - lw / 2 > g.x0 + 2;
                  if (show) lastRight = mid + lw / 2;
                  return (
                    <g key={d.id}>
                      <circle cx={b} cy={L.yBob} r={4.2} fill={SIG.res} stroke="var(--ink-1)" strokeWidth={1.2} />
                      <path d={`M${fx(a)},${y - 3} V${y} H${fx(b)} V${y - 3}`} fill="none" stroke={col} strokeWidth={1.2} strokeOpacity={0.85} />
                      {show && (
                        <text className={`${css.lat} ${css.halo}`} x={mid} y={y + 11} textAnchor="middle" style={{ fill: col }}>
                          {label}
                        </text>
                      )}
                    </g>
                  );
                });
              })()}
              {r.msgs.map((m) => {
                if (lane.deliv.some((d) => d.id === m.id)) return null;
                const a = X(m.ts);
                const b = g.x1;
                const wait = now - m.ts;
                if (wait < 0.3) return null;
                const y = L.yBob + (land ? 9 : 7);
                const col = wait > 3 ? SIG.err : SIG.heavy;
                return (
                  <g key={`w${m.id}`} opacity={0.9}>
                    <path d={`M${fx(a)},${y - 3} V${y} H${fx(b)}`} fill="none" stroke={col} strokeWidth={1.2} strokeDasharray="3 3" />
                    {b - a > 44 && (
                      <text className={`${css.lat} ${css.halo}`} x={(a + b) / 2} y={y + 11} textAnchor="middle" style={{ fill: col }}>
                        {wait.toFixed(1)} s…
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
            {land && (
              <g transform={`translate(${g.sumX},${L.y})`}>
                <rect width={g.sumW} height={L.h} rx={10} fill="rgba(8,13,24,0.6)" stroke="rgba(143,166,201,0.16)" />
                {[
                  { label: 'HTTP requests', value: String(lane.requests), tone: undefined },
                  { label: 'came back empty', value: String(lane.empty), tone: lane.empty ? SIG.heavy : undefined },
                  { label: 'avg delay', value: avg == null ? '–' : `${avg.toFixed(1)} s`, tone: avg == null ? undefined : avg > 2 ? SIG.heavy : SIG.res },
                ].map((row, i) => (
                  <g key={row.label} transform={`translate(14,${24 + i * ((L.h - 34) / 3)})`}>
                    <text className={css.sumLabel} y={0}>
                      {row.label}
                    </text>
                    <text className={css.sumNum} y={17} style={row.tone ? { fill: row.tone } : undefined}>
                      {row.value}
                    </text>
                  </g>
                ))}
              </g>
            )}
          </g>
        );
      })}
      <line x1={g.x1} y1={g.lanes[0].y + 6} x2={g.x1} y2={last.y + last.h - 6} stroke={SIG.warn} strokeOpacity={0.5} strokeDasharray="2 3" />
      <text className={css.trackLabel} x={g.x1} y={last.y + last.h + 13} textAnchor="middle" style={{ fill: SIG.warn }}>
        now
      </text>
      {[5, 10, 15, 20].map((s) =>
        g.x1 - s * g.pps > g.x0 + 10 ? (
          <text key={s} className={css.trackLabel} x={g.x1 - s * g.pps} y={last.y + last.h + 13} textAnchor="middle">
            −{s} s
          </text>
        ) : null,
      )}
    </g>
  );
}

/* ================================================================== */
/* Sequence: one connection from TCP to frames                          */
/* ================================================================== */

function SeqScene({ sim }: { sim: WsSim }) {
  const land = sim.orient === 'landscape';
  const H = 0.6;
  const m = (id: string, from: 'c' | 's', t0: number, label: string, labelSm: string, color?: string, hot?: boolean): SeqMessage => ({
    id,
    from,
    to: from === 'c' ? 's' : 'c',
    t0,
    t1: t0 + H,
    label: land ? label : labelSm,
    color,
    hot,
  });
  const tcp = SIG.line;
  const messages: SeqMessage[] = [
    m('syn', 'c', 0.4, 'SYN', 'SYN', tcp),
    m('synack', 's', 1.0, 'SYN-ACK', 'SYN-ACK', tcp),
    m('ack', 'c', 1.6, 'ACK + TLS ClientHello', 'ACK+Hello', tcp),
    m('shello', 's', 2.2, 'TLS ServerHello … Finished', 'TLS …Finished', tcp),
    m('get', 'c', 2.8, 'GET /ws  Upgrade: websocket', 'GET Upgrade', SIG.req, true),
    m('101', 's', 3.4, '101 Switching Protocols', '101 Switching', SIG.res, true),
    m('f1', 'c', 4.6, 'text frame "hi"', 'text "hi"'),
    m('f2', 's', 5.5, 'text frame "hey Bob"', 'text "hey"'),
    m('ping', 's', 6.9, 'ping', 'ping', SIG.hc),
    m('pong', 'c', 7.5, 'pong', 'pong', SIG.hc),
    m('x1', 'c', 8.8, 'typing…', 'typing…'),
    m('x2', 's', 9.15, 'new message', 'new msg'),
    m('f3', 's', 10.6, 'binary frame 4 KB', 'binary 4 KB'),
    m('close', 'c', 12.2, 'close 1000', 'close 1000', SIG.hc),
    m('close2', 's', 12.8, 'close 1000', 'close 1000', SIG.hc),
  ];
  const spans: SeqSpan[] = [
    { id: 'tcp', actor: 'c', t0: 0.4, t1: 2.2, label: land ? 'TCP' : 'TCP', color: SIG.line },
    { id: 'tls', actor: 'c', t0: 2.2, t1: 3.4, label: 'TLS', color: SIG.line },
    { id: 'http', actor: 'c', t0: 3.4, t1: 4.0, label: 'HTTP', color: SIG.req },
    { id: 'ws', actor: 'c', t0: 4.0, t1: 13.4, label: 'WebSocket', color: PIPE },
    { id: 'wss', actor: 's', t0: 4.0, t1: 13.4, label: land ? 'same TCP socket' : 'WebSocket', color: PIPE },
  ];
  const notes: SeqNote[] = [
    { id: 'n0', actor: 'c', t: 0.3, text: land ? 'new WebSocket(url)' : 'new WebSocket', color: SIG.text2 },
    { id: 'n1', actor: 'c', t: 4.0, text: land ? 'readyState: OPEN' : 'OPEN', color: PIPE },
    { id: 'n2', actor: 'c', t: 13.4, text: 'CLOSED', color: SIG.text2 },
  ];
  const top = land ? 64 : 58;
  return (
    <SequenceDiagram
      x={land ? 90 : 10}
      y={top}
      w={land ? sim.w - 180 : sim.w - 20}
      h={sim.h - top - (land ? 104 : 84)}
      now={sim.seqT}
      actors={[
        { id: 'c', label: 'Bob’s browser', sub: '203.0.113.57', color: PEOPLE.bob.color },
        { id: 's', label: 'chat.example', sub: '198.51.100.10:443', color: PIPE },
      ]}
      messages={messages}
      spans={spans}
      notes={notes}
      pxPerSec={land ? 44 : 34}
      timeLabel={(t) => `${Math.round(t * 40)} ms`}
    />
  );
}

/* ================================================================== */
/* Frame anatomy                                                        */
/* ================================================================== */

const FIELD_COLOR: Record<FieldGeo['id'], string> = {
  fin: SIG.warn,
  rsv: EMPTY,
  opcode: SIG.req,
  mask: SIG.pink,
  len: SIG.res,
};

function FrameScene({ sim, highlight }: SceneProps) {
  const f = FRAMES[sim.cfg.frame];
  const land = sim.orient === 'landscape';
  const g = frameGeo(sim.w, sim.h, land, f);
  const cli = sim.boxes.get('fcli');
  const srv = sim.boxes.get('fsrv');
  const b0 = bits(byte0(f));
  const b1 = bits(byte1(f));
  const all = [...b0, ...b1];
  const fieldOf = (i: number) => FIELDS.find((x) => i >= x.from && i < x.from + x.n)!;
  const k = easeOut((sim.vt - sim.frameVt) / 0.5);
  const hlField = highlight?.startsWith('field:') ? highlight.slice(6) : null;
  const pipeCurve: Curve | null =
    cli && srv ? { p0: { x: cli.x + cli.w / 2, y: cli.y }, p1: { x: cli.x + cli.w / 2 + 40, y: cli.y }, p2: { x: srv.x - srv.w / 2 - 40, y: srv.y }, p3: { x: srv.x - srv.w / 2, y: srv.y } } : null;
  const hdr = headerBytes(f);
  const values: Record<FieldGeo['id'], string> = {
    fin: '1 · final (whole message)',
    rsv: '000 · no extensions',
    opcode: `${all.slice(4, 8).join('')} · ${f.opcode} = ${f.opName}`,
    mask: f.mask ? '1 · payload is masked' : '0 · not masked',
    len:
      f.len7 === 126
        ? `${all.slice(9).join('')} · 126: next 2 bytes`
        : f.len7 === 127
          ? `${all.slice(9).join('')} · 127: next 8 bytes`
          : `${all.slice(9).join('')} · ${f.len7} bytes`,
  };
  const groupLabel = (grp: string) =>
    grp === 'ext'
      ? `extended length = ${f.length.toLocaleString('en-US')}`
      : grp === 'key'
        ? 'masking key'
        : grp === 'payload'
          ? f.mask
            ? 'payload, masked'
            : 'payload'
          : '';
  const groupColor = (grp: string) => (grp === 'ext' ? SIG.res : grp === 'key' ? SIG.pink : 'rgba(143,166,201,0.8)');
  const cellFont = land ? css.bit : css.bitSm;
  return (
    <g>
      <Wires sim={sim} />
      {pipeCurve && <Pipe curves={[pipeCurve]} k={1} vt={sim.vt} />}
      {cli && <NodeCard box={cli} title={land ? 'Bob’s browser' : 'browser'} sub={land ? '203.0.113.57' : undefined} glow={highlight === 'fcli'} />}
      {srv && <NodeCard box={srv} title={land ? 'chat server' : 'server'} sub={land ? 'chat.example' : undefined} glow={highlight === 'fsrv'} />}
      <Flights sim={sim} />
      <Effects sim={sim} />

      {/* byte labels and bit indexes */}
      <text className={css.trackLabel} x={g.gx + g.cell * 4} y={g.gy - (land ? 30 : 26)} textAnchor="middle">
        BYTE 0 · 0x{hex(byte0(f))}
      </text>
      <text className={css.trackLabel} x={g.gx + g.cell * 12} y={g.gy - (land ? 30 : 26)} textAnchor="middle">
        BYTE 1 · 0x{hex(byte1(f))}
      </text>
      {FIELDS.map((fd) => {
        const cx0 = g.gx + (fd.from + fd.n / 2) * g.cell;
        const col = FIELD_COLOR[fd.id];
        return (
          <text key={fd.id} className={land ? css.fieldName : css.fieldNameSm} x={cx0} y={g.gy - (land ? 9 : 7)} textAnchor="middle" style={{ fill: col }}>
            {land ? fd.name : fd.id === 'len' ? 'length' : fd.id === 'rsv' ? 'rsv' : fd.name.toLowerCase()}
          </text>
        );
      })}
      {all.map((bit, i) => {
        const fd = fieldOf(i);
        const col = FIELD_COLOR[fd.id];
        const x = g.gx + i * g.cell;
        const on = hlField === fd.id;
        return (
          <g key={i}>
            <rect
              x={x + 1}
              y={g.gy}
              width={g.cell - 2}
              height={g.cellH}
              rx={land ? 4 : 3}
              fill={col}
              fillOpacity={(bit ? 0.24 : 0.07) * (0.6 + 0.4 * k)}
              stroke={on ? 'var(--accent)' : col}
              strokeOpacity={on ? 1 : 0.55}
              strokeWidth={on ? 1.8 : 1}
            />
            <text className={cellFont} x={x + g.cell / 2} y={g.gy + g.cellH / 2 + (land ? 5.5 : 4.3)} textAnchor="middle" style={{ fill: bit ? 'var(--text-1)' : 'var(--text-3)' }}>
              {bit}
            </text>
            {land && (
              <text className={css.bitIdx} x={x + g.cell / 2} y={g.gy + g.cellH + 12} textAnchor="middle">
                {i}
              </text>
            )}
          </g>
        );
      })}
      <line x1={g.gx + g.cell * 8} y1={g.gy - 4} x2={g.gx + g.cell * 8} y2={g.gy + g.cellH + 4} stroke="rgba(143,166,201,0.45)" strokeDasharray="2 2" />

      {/* what each field says */}
      {FIELDS.map((fd, i) => {
        const col = FIELD_COLOR[fd.id];
        const colW = land ? (g.cell * 16) / 2 : sim.w - 32;
        const rowsPer = land ? 3 : 5;
        const cx0 = land ? g.gx + Math.floor(i / rowsPer) * colW : 16;
        const y = g.gy + g.cellH + (land ? 36 : 22) + (i % rowsPer) * (land ? 19 : 15);
        return (
          <g key={fd.id}>
            <rect x={cx0} y={y - 7} width={7} height={7} rx={1.5} fill={col} />
            <text className={land ? css.explain : css.explainSm} x={cx0 + 13} y={y}>
              <tspan style={{ fill: col }}>{land ? fd.name : fd.id === 'len' ? 'len' : fd.name}</tspan>
              <tspan dx={6}>{values[fd.id]}</tspan>
            </text>
          </g>
        );
      })}

      {/* the rest of the frame, byte by byte */}
      {g.groups.map((gr, i) =>
        gr.group === 'more' ? null : (
          <g key={i}>
            <path d={`M${gr.x0 + 2},${gr.y - 6} V${gr.y - 10} H${gr.x1 - 2} V${gr.y - 6}`} fill="none" stroke={groupColor(gr.group)} strokeOpacity={0.7} />
            <text className={land ? css.trackLabel : css.fieldNameSm} x={(gr.x0 + gr.x1) / 2} y={gr.y - 15} textAnchor="middle" style={{ fill: groupColor(gr.group) }}>
              {gr.x1 - gr.x0 < 90 && gr.group === 'ext' ? `len = ${f.length}` : groupLabel(gr.group)}
            </text>
          </g>
        ),
      )}
      {g.bytes.map((bc, i) => {
        const value = bc.group === 'ext' ? f.ext[bc.i] : bc.group === 'key' ? f.key![bc.i] : bc.group === 'payload' ? f.payload[bc.i] : null;
        const col = groupColor(bc.group);
        const moreN = f.more + Math.max(0, f.payload.length - (land ? 6 : 5));
        return (
          <g key={i} opacity={0.35 + 0.65 * k}>
            <rect x={bc.x} y={bc.y} width={g.bw} height={g.bh} rx={4} fill={col} fillOpacity={bc.group === 'more' ? 0.03 : 0.1} stroke={col} strokeOpacity={bc.group === 'more' ? 0.3 : 0.6} strokeDasharray={bc.group === 'more' ? '3 3' : undefined} />
            <text className={land ? css.hexCell : css.hexCellSm} x={bc.x + g.bw / 2} y={bc.y + g.bh / 2 + (land ? 4.5 : 4)} textAnchor="middle" style={bc.group === 'more' ? { fill: 'var(--text-3)', fontSize: land ? 11 : 9.5 } : undefined}>
              {value != null ? hex(value) : moreLabel(moreN, g.bw)}
            </text>
            {bc.group === 'payload' && f.plain && (
              <text className={css.bitIdx} x={bc.x + g.bw / 2} y={bc.y + g.bh + 12} textAnchor="middle" style={{ fill: SIG.pink }}>
                {land ? `${String.fromCharCode(f.plain[bc.i])} ${hex(f.plain[bc.i])}⊕${hex(f.key![bc.i % 4])}` : `'${String.fromCharCode(f.plain[bc.i])}'`}
              </text>
            )}
            {bc.group === 'payload' && !f.plain && f.opName === 'text' && (
              <text className={css.bitIdx} x={bc.x + g.bw / 2} y={bc.y + g.bh + 12} textAnchor="middle">
                {JSON.stringify(String.fromCharCode(f.payload[bc.i])).slice(1, -1)}
              </text>
            )}
          </g>
        );
      })}
      {!g.bytes.length && (
        <text className={css.laneSub} x={sim.w / 2} y={g.by + g.bh / 2 + 4} textAnchor="middle">
          nothing after the first two bytes
        </text>
      )}
      <text className={land ? css.explain : css.explainSm} x={sim.w / 2} y={g.sumY + (land ? 16 : 12)} textAnchor="middle">
        <tspan style={{ fill: 'var(--text-3)' }}>{f.dir === 'c2s' ? 'browser → server' : 'server → browser'} · header </tspan>
        <tspan style={{ fill: 'var(--accent)' }}>{hdr} bytes</tspan>
        <tspan style={{ fill: 'var(--text-3)' }}> · payload </tspan>
        <tspan style={{ fill: 'var(--text-1)' }}>{f.length.toLocaleString('en-US')} bytes</tspan>
      </text>
      <WireDump f={f} x={sim.w / 2} y={g.sumY + (land ? 44 : 32)} land={land} />
    </g>
  );
}

/** "+294" or "+99,994" if it fits the cell, else "+99K". */
function moreLabel(n: number, cellW: number) {
  const full = `+${n.toLocaleString('en-US')}`;
  return full.length * 6.2 <= cellW - 4 ? full : `+${Math.floor(n / 1000)}K`;
}

/** The whole frame as it appears on the wire, colored by part. */
function WireDump({ f, x, y, land }: { f: (typeof FRAMES)[keyof typeof FRAMES]; x: number; y: number; land: boolean }) {
  const maxPayload = land ? 6 : 3;
  const parts: { t: string; c: string }[] = [
    { t: `${hex(byte0(f))} ${hex(byte1(f))}`, c: 'var(--text-1)' },
    ...(f.ext.length ? [{ t: f.ext.map(hex).join(' '), c: SIG.res }] : []),
    ...(f.key ? [{ t: f.key.map(hex).join(' '), c: SIG.pink }] : []),
    ...(f.payload.length ? [{ t: f.payload.slice(0, maxPayload).map(hex).join(' ') + (f.payload.length > maxPayload || f.more ? ' …' : ''), c: 'var(--text-2)' }] : []),
  ];
  return (
    <text className={land ? css.explain : css.explainSm} x={x} y={y} textAnchor="middle">
      <tspan style={{ fill: 'var(--text-3)' }}>on the wire: </tspan>
      {parts.map((p, i) => (
        <tspan key={i} style={{ fill: p.c }}>
          {i ? '  ' : ''}
          {p.t}
        </tspan>
      ))}
    </text>
  );
}

/* ================================================================== */
/* Choosing a transport                                                 */
/* ================================================================== */

const LEAF: Record<Leaf, { title: string; color: string }> = {
  http: { title: 'Plain HTTP', color: SIG.line },
  sse: { title: 'Server-Sent Events', color: SIG.res },
  ws: { title: 'WebSocket', color: PIPE },
};

/** The newest examples that fit in `chars` characters. */
function fitList(list: string[], chars: number) {
  let out = '';
  for (let i = list.length - 1; i >= 0; i--) {
    const next = out ? `${list[i]} · ${out}` : list[i];
    if (next.length > chars) break;
    out = next;
  }
  return out || (list.length ? `${list[list.length - 1].slice(0, Math.max(1, chars - 1))}…` : '…');
}

function ChooseScene({ sim, highlight }: SceneProps) {
  const land = sim.orient === 'landscape';
  const q = (id: string, text: string, textSm: string) => {
    const b = sim.boxes.get(id);
    if (!b || Number.isNaN(b.x)) return null;
    return (
      <g key={id} transform={`translate(${fx(b.x - b.w / 2)},${fx(b.y - b.h / 2)})`} opacity={b.alpha}>
        {highlight === id && <rect x={-6} y={-6} width={b.w + 12} height={b.h + 12} rx={14} fill="none" stroke="var(--accent)" strokeWidth={1.4} strokeDasharray="3 3" />}
        <rect className={stage.card} width={b.w} height={b.h} rx={b.h / 2} style={{ stroke: 'rgba(255,210,63,0.55)' }} />
        <text className={land ? css.qText : css.qTextSm} x={b.w / 2} y={b.h / 2 + 4.5} textAnchor="middle">
          {land ? text : textSm}
        </text>
      </g>
    );
  };
  const leaf = (id: Leaf) => {
    const b = sim.boxes.get(`leaf:${id}`);
    if (!b || Number.isNaN(b.x)) return null;
    const L = LEAF[id];
    const list = sim.chooseLog[id];
    const fresh = list.length ? 1 : 0;
    return (
      <g key={id} transform={`translate(${fx(b.x - b.w / 2)},${fx(b.y - b.h / 2)})`} opacity={b.alpha}>
        {highlight === `leaf:${id}` && <rect x={-6} y={-6} width={b.w + 12} height={b.h + 12} rx={14} fill="none" stroke="var(--accent)" strokeWidth={1.4} strokeDasharray="3 3" />}
        <rect className={stage.card} width={b.w} height={b.h} rx={10} style={{ stroke: L.color, strokeOpacity: 0.8 }} />
        <rect x={10} y={0} width={b.w - 20} height={2} rx={1} fill={L.color} opacity={0.9} />
        <text className={land ? css.leafTitle : css.leafTitleSm} x={b.w / 2} y={land ? 26 : 21} textAnchor="middle" style={{ fill: L.color }}>
          {L.title}
        </text>
        <text className={css.meta} x={b.w / 2} y={land ? 45 : 37} textAnchor="middle" opacity={0.6 + 0.4 * fresh}>
          {fitList(list, Math.floor((b.w - 16) / 5.5))}
        </text>
      </g>
    );
  };
  const label = (a: string, b: string, text: string, color: string) => {
    const w = sim.wireViews().find((x) => x.key === `${a}>${b}`);
    if (!w) return null;
    return (
      <text key={`${a}-${b}`} className={css.edgeLabel} x={w.mid.x} y={w.mid.y + 3} textAnchor="middle" style={{ fill: color }} opacity={w.alpha}>
        {text}
      </text>
    );
  };
  return (
    <g>
      <Wires sim={sim} />
      {label('q1', 'leaf:http', 'no', SIG.text2)}
      {label('q1', 'q2', 'yes', SIG.warn)}
      {label('q2', 'leaf:sse', 'no', SIG.text2)}
      {label('q2', 'leaf:ws', 'yes', SIG.warn)}
      {q('q1', 'Does the server need to push updates?', 'Server needs to push updates?')}
      {q('q2', 'Does the browser talk back often, and fast?', 'Browser talks back often, fast?')}
      {leaf('http')}
      {leaf('sse')}
      {leaf('ws')}
      <Flights sim={sim} />
      <Effects sim={sim} />
    </g>
  );
}
