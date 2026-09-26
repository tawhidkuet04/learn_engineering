import { SequenceDiagram, type SeqMessage, type SeqNote, type SeqSpan } from '@/components/stage/SequenceDiagram';
import { Boundary, Cylinder, Effects, Flights, Label, NodeCard, Wires } from '@/components/stage/svg';
import { SIG } from '@/lib/sim/colors';
import { clamp } from '@/lib/sim/geometry';
import { dbGeom } from './geom';
import { KEYS, TERM_COLORS, money, toMs, type Db, type Entry, type ReplSim } from './sim';

const MONO = 'var(--font-mono)';
const ORANGE = 'rgba(255,154,60,0.9)';

/** Does a focus list mention this node? Accepts ids, 'leader', 'followers', 'apps'. */
export function inFocus(sim: ReplSim, focus: string[] | undefined, id: string) {
  if (!focus?.length) return true;
  if (focus.includes(id)) return true;
  const d = sim.dbs.get(id);
  if (d && focus.includes('leader') && d.id === sim.leaderId) return true;
  if (d && focus.includes('followers') && d.role === 'follower') return true;
  if (id.startsWith('app') && focus.includes('apps')) return true;
  return false;
}

export function Scene({
  sim,
  focus,
  highlight,
  onDbClick,
  clickable,
}: {
  sim: ReplSim;
  focus?: string[];
  highlight: string | null;
  onDbClick: (id: string) => void;
  clickable: boolean;
}) {
  const c = sim.cfg;
  if (c.topo === 'seq') return <SeqView sim={sim} />;
  const dim = (id: string) => !inFocus(sim, focus, id);
  const glow = (id: string) => highlight === id || (highlight === 'leader' && id === sim.leaderId) || (highlight === 'followers' && sim.dbs.get(id)?.role === 'follower');
  const mon = sim.boxes.get('mon');
  return (
    <>
      {c.topo === 'multi' && <Regions sim={sim} />}
      <Wires sim={sim} />
      {[...sim.apps.values()].map((a) => {
        const b = sim.boxes.get(a.id);
        if (!b) return null;
        const stale = !!a.target && a.target !== sim.leaderId;
        const target = a.target ? sim.dbs.get(a.target) : null;
        return (
          <NodeCard
            key={a.id}
            box={b}
            title={a.label}
            sub={a.ip}
            led="up"
            dim={dim(a.id)}
            glow={glow(a.id)}
            tone={stale ? SIG.err : undefined}
            kicker={stale && target ? { text: `→ ${target.label} (stale)`, color: SIG.err } : undefined}
          />
        );
      })}
      {mon && sim.isLive('mon') && <Monitor sim={sim} dim={dim('mon')} glow={glow('mon')} />}
      {sim.order.map((id) => {
        const d = sim.dbs.get(id);
        if (!d) return null;
        const pick = sim.canPick(id);
        const canClick = pick || (clickable && c.topo === 'replicated');
        return <DbNode key={id} sim={sim} d={d} dim={dim(id)} glow={glow(id)} pick={pick} onClick={canClick ? () => onDbClick(id) : undefined} />;
      })}
      <Flights sim={sim} />
      <Effects sim={sim} />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* A database: cylinder, header, a tiny table and its log tape         */
/* ------------------------------------------------------------------ */

function roleBadge(sim: ReplSim, d: Db): { text: string; color: string; fill: string } | null {
  const c = sim.cfg;
  const P = sim.orient === 'portrait';
  const term = c.terms ? (P ? ` T${d.term}` : ` · TERM ${d.term}`) : '';
  const grey = { color: SIG.text2, fill: 'rgba(143,166,201,0.08)' };
  if (c.topo === 'single') return null;
  if (c.topo === 'naive') return { text: 'COPY', ...grey };
  if (c.topo === 'leaderless') return { text: 'REPLICA', ...grey };
  if (d.role === 'leader') {
    const deposed = c.topo === 'replicated' && sim.leaderId !== d.id;
    if (d.fenced) return { text: `CHECKING${term}`, color: SIG.hc, fill: 'rgba(181,155,255,0.12)' };
    return deposed ? { text: `LEADER${term}`, color: SIG.err, fill: 'rgba(255,77,106,0.14)' } : { text: `LEADER${term}`, color: SIG.heavy, fill: 'rgba(255,154,60,0.14)' };
  }
  if (!d.up) return { text: `FOLLOWER${term}`, ...grey };
  if (c.sync) {
    const s = sim.syncStateOf(d);
    if (s === 'sync') return { text: `SYNC${term}`, color: SIG.res, fill: 'rgba(75,227,160,0.12)' };
    if (s === 'potential') return { text: `POTENTIAL${term}`, color: SIG.hc, fill: 'rgba(181,155,255,0.12)' };
    if (s === 'quorum') return { text: `QUORUM${term}`, color: SIG.res, fill: 'rgba(75,227,160,0.12)' };
    return { text: `ASYNC${term}`, ...grey };
  }
  return { text: `FOLLOWER${term}`, ...grey };
}

function DbNode({ sim, d, dim, glow, pick, onClick }: { sim: ReplSim; d: Db; dim: boolean; glow: boolean; pick: boolean; onClick?: () => void }) {
  const box = sim.boxes.get(d.id);
  if (!box || Number.isNaN(box.x)) return null;
  const c = sim.cfg;
  const P = sim.orient === 'portrait';
  const g = dbGeom(box.w, P);
  const w = box.w;
  const vt = sim.vt;
  const L = sim.leader();
  const deposed = c.topo === 'replicated' && d.role === 'leader' && sim.leaderId !== d.id;
  const tone = pick ? SIG.warn : !d.up || deposed ? 'rgba(255,77,106,0.85)' : d.role === 'leader' ? ORANGE : 'rgba(143,166,201,0.6)';
  const badge = roleBadge(sim, d);
  const fs = g.fs;
  const labelW = d.label.length * fs.head * 0.6;
  const badgeW = badge ? badge.text.length * fs.badge * 0.68 + 11 : 0;
  const showLsn = c.tape && (c.topo === 'replicated' || c.topo === 'single');
  const behind = d.role === 'follower' && d.up ? sim.behind(d) : 0;

  // Two leaders disagreeing (split brain) or a fresh conflict flags a row in red.
  const other =
    !d.up || c.topo !== 'replicated'
      ? null
      : deposed && L
        ? L
        : d.id === sim.leaderId && sim.leaderCount() > 1
          ? [...sim.dbs.values()].find((x) => x !== d && x.up && x.role === 'leader' && !x.fenced)
          : null;
  const quorum = c.topo === 'leaderless';

  const cell = (i: number) => {
    const k = KEYS[i];
    const row = d.data[k];
    const fl = clamp(1 - (vt - (d.flash[k] ?? -10)) / 1.1, 0, 1);
    const bad = vt - (d.conflict[k] ?? -10) < 5 || (other ? other.data[k].v !== row.v : false);
    const keyText = quorum && i === 1 ? 'version' : k;
    const valText = quorum && i === 1 ? `v${d.data.alice.ver}` : money(row.v);
    let x: number;
    let y: number;
    let cw: number;
    if (g.stacked) {
      x = 10;
      y = g.rows[i];
      cw = w - 20;
    } else {
      cw = (w - 20) / 2;
      x = 10 + i * cw;
      y = g.rows[0];
      cw -= 4;
    }
    return (
      <g key={k}>
        <rect
          x={x}
          y={y - g.rowH + 4}
          width={cw}
          height={g.rowH}
          rx={3}
          fill={bad ? 'rgba(255,77,106,0.16)' : `rgba(255,210,63,${(0.24 * fl).toFixed(3)})`}
          stroke={bad ? 'rgba(255,77,106,0.8)' : fl > 0.05 ? `rgba(255,210,63,${(0.2 + 0.6 * fl).toFixed(3)})` : 'rgba(143,166,201,0.16)'}
        />
        <text x={x + 7} y={y} style={{ fontFamily: MONO, fontSize: fs.key, fill: 'var(--text-3)' }}>
          {keyText}
        </text>
        <text x={x + cw - 7} y={y} textAnchor="end" style={{ fontFamily: MONO, fontSize: fs.val, fontWeight: 500, fill: bad ? '#ffb3c0' : 'var(--text-1)' }}>
          {valText}
        </text>
      </g>
    );
  };

  return (
    <Cylinder box={box} title="" tone={tone} dim={dim} glow={glow} state={d.up ? 'normal' : 'down'} pickable={pick} onClick={onClick}>
      {/* header */}
      <circle cx={12.5} cy={g.headY - fs.head * 0.36} r={3.2} fill={!d.up ? SIG.err : d.fenced ? SIG.hc : SIG.res} />
      <text x={22} y={g.headY} style={{ fontFamily: MONO, fontSize: fs.head, fontWeight: 500, fill: 'var(--text-1)' }}>
        {d.label}
      </text>
      {badge && (
        <g transform={`translate(${22 + labelW + 7},${g.headY - fs.badge - 4.6})`}>
          <rect width={badgeW} height={fs.badge + 6} rx={3} fill={badge.fill} stroke={badge.color} strokeOpacity={0.55} />
          <text x={badgeW / 2} y={fs.badge + 1.9} textAnchor="middle" style={{ fontFamily: MONO, fontSize: fs.badge, letterSpacing: '0.08em', fill: badge.color }}>
            {badge.text}
          </text>
        </g>
      )}
      {(showLsn || !d.up) && (
        <text x={w - 11} y={g.headY} textAnchor="end" style={{ fontFamily: MONO, fontSize: fs.head, fontWeight: 500, fill: d.up ? 'var(--text-1)' : SIG.err }}>
          {!d.up ? (showLsn ? `down · #${d.head}` : 'down') : null}
          {d.up && behind > 0 ? <tspan style={{ fill: SIG.warn, fontSize: fs.head - 1.5 }}>{`−${behind} `}</tspan> : null}
          {d.up && showLsn ? `#${d.applied}` : null}
        </text>
      )}

      {/* the table */}
      {cell(0)}
      {cell(1)}

      {/* the log tape */}
      {c.tape && <Tape sim={sim} d={d} w={w} />}

      {/* queued queries wait in a line just under the node, clear of the wires */}
      {d.queue.length > 0 && (
        <g transform={`translate(12,${box.h + (P ? 5 : 9)})`}>
          {Array.from({ length: Math.min(d.queue.length, P ? 5 : 8) }, (_, i) => (
            <circle key={i} cx={i * 7} cy={0} r={2.4} fill={d.queue[i]?.kind === 'write' ? SIG.heavy : SIG.req} opacity={0.9} />
          ))}
          {!P && (
            <text x={Math.min(d.queue.length, 8) * 7 + 3} y={3.3} style={{ fontFamily: MONO, fontSize: 9.5, fill: d.queue.length >= 7 ? SIG.err : 'var(--text-3)' }}>
              {d.queue.length >= 7 ? 'queue full' : `queue ${d.queue.length}`}
            </text>
          )}
        </g>
      )}

      {/* a read waiting for this follower to catch up */}
      {d.waiting.length > 0 && (
        <text x={4} y={-6} style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.04em', fill: SIG.warn }}>
          ⧗ alice&apos;s read waits for #{Math.max(...d.waiting.map((r) => r.minLsn ?? 0))}
        </text>
      )}

      {/* the leader is holding writes until a sync standby confirms */}
      {d.pending.length > 0 && d.up && sim.waitingFor() != null && (sim.waitingFor() ?? 0) > 3.5 && (
        <text x={w - 4} y={-6} textAnchor="end" style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.04em', fill: SIG.warn }}>
          {d.pending.length} write{d.pending.length === 1 ? '' : 's'} stuck: no sync standby
        </text>
      )}
    </Cylinder>
  );
}

function cellStyle(e: Entry, d: Db, pending: Set<number>) {
  if (e.forked) return { fill: 'rgba(255,126,182,0.18)', stroke: SIG.pink, text: '#ffc2dc', dash: undefined as string | undefined, strike: false };
  if (e.lost) return { fill: 'rgba(255,77,106,0.2)', stroke: SIG.err, text: '#ffb3c0', dash: undefined, strike: true };
  if (e.orphan) return { fill: 'rgba(143,166,201,0.06)', stroke: 'rgba(143,166,201,0.45)', text: 'var(--text-3)', dash: '2 2', strike: true };
  if (pending.has(e.lsn)) return { fill: 'rgba(255,210,63,0.1)', stroke: SIG.warn, text: '#ffe9a6', dash: '3 2', strike: false };
  if (e.lsn > d.applied) return { fill: 'rgba(255,154,60,0.04)', stroke: 'rgba(255,154,60,0.6)', text: 'rgba(255,197,138,0.75)', dash: '3 2', strike: false };
  return { fill: 'rgba(255,154,60,0.16)', stroke: 'rgba(255,154,60,0.62)', text: '#ffc58a', dash: undefined, strike: false };
}

function Tape({ sim, d, w }: { sim: ReplSim; d: Db; w: number }) {
  const P = sim.orient === 'portrait';
  const g = dbGeom(w, P);
  const entries = d.log.slice(-g.cells);
  const empty = g.cells - entries.length;
  const x0 = w - 11 - g.cells * g.cellW + 3;
  const pending = new Set(d.pending.map((p) => p.e.lsn));
  const fresh = clamp((sim.vt - d.tapeVt) / 0.3, 0, 1);
  const showTerms = sim.cfg.terms;
  return (
    <g>
      {Array.from({ length: g.cells }, (_, i) => {
        const x = x0 + i * g.cellW;
        const cw = g.cellW - 3;
        if (i < empty) {
          return <rect key={`e${i}`} x={x} y={g.tapeTop} width={cw} height={g.tapeH} rx={2.5} fill="none" stroke="rgba(143,166,201,0.14)" strokeDasharray="2 3" />;
        }
        const e = entries[i - empty];
        const s = cellStyle(e, d, pending);
        const newest = i === g.cells - 1;
        return (
          <g key={e.lsn} opacity={newest ? 0.35 + 0.65 * fresh : 1}>
            <rect x={x} y={g.tapeTop} width={cw} height={g.tapeH} rx={2.5} fill={s.fill} stroke={s.stroke} strokeWidth={1} strokeDasharray={s.dash} />
            {showTerms && <rect x={x + 3} y={g.tapeTop + 1.5} width={cw - 6} height={2} rx={1} fill={TERM_COLORS[(e.term - 1) % TERM_COLORS.length]} opacity={0.9} />}
            <text x={x + cw / 2} y={g.tapeTop + g.tapeH / 2 + g.fs.tape * 0.36} textAnchor="middle" style={{ fontFamily: MONO, fontSize: g.fs.tape, fill: s.text }}>
              {e.lsn}
            </text>
            {s.strike && <line x1={x + 3} y1={g.tapeTop + g.tapeH / 2} x2={x + cw - 3} y2={g.tapeTop + g.tapeH / 2} stroke={s.stroke} strokeWidth={1.1} />}
          </g>
        );
      })}
    </g>
  );
}

/* ------------------------------------------------------------------ */
/* The failover manager                                                */
/* ------------------------------------------------------------------ */

function Monitor({ sim, dim, glow }: { sim: ReplSim; dim: boolean; glow: boolean }) {
  const b = sim.boxes.get('mon')!;
  const P = sim.orient === 'portrait';
  const r = sim.mon.results;
  const dead = sim.mon.dead;
  return (
    <NodeCard
      box={b}
      title="monitor"
      sub={sim.cfg.terms ? `term ${sim.term}` : P ? 'patroni' : 'patroni + etcd'}
      tone={SIG.hc}
      led={dead ? 'down' : 'up'}
      dim={dim}
      glow={glow}
      kicker={{ text: dead ? 'leader down!' : 'heartbeats', color: dead ? SIG.err : 'var(--text-3)' }}
    >
      <g transform={`translate(${b.w - (P ? 30 : 34)},${-8.5})`}>
        {[0, 1, 2].map((i) => {
          const res = r[r.length - 3 + i];
          return (
            <circle
              key={i}
              cx={i * 9}
              cy={0}
              r={3}
              fill={res === 'ok' ? SIG.res : res === 'miss' ? SIG.err : 'none'}
              stroke={res ? 'none' : 'rgba(143,166,201,0.4)'}
            />
          );
        })}
      </g>
    </NodeCard>
  );
}

/* ------------------------------------------------------------------ */
/* Multi-leader: two regions                                           */
/* ------------------------------------------------------------------ */

function Regions({ sim }: { sim: ReplSim }) {
  const P = sim.orient === 'portrait';
  const at = sim.regionLine();
  if (P) return <Boundary orient="horizontal" at={at} length={sim.w} a="us-east" b="eu-west" />;
  return (
    <>
      <Boundary orient="vertical" at={at} length={sim.h} a="us-east" b="eu-west" />
      <Label x={sim.w * 0.26} y={sim.h * 0.3 - 52} text="region us-east" anchor="middle" color="var(--text-2)" />
      <Label x={sim.w * 0.74} y={sim.h * 0.3 - 52} text="region eu-west" anchor="middle" color="var(--text-2)" />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Sync vs async as a sequence diagram                                 */
/* ------------------------------------------------------------------ */

const T0 = 0.4;

export function seqTimeline(mode: 'async' | 'sync', short = false) {
  const messages: SeqMessage[] = [{ id: 'w', from: 'app', to: 'leader', t0: T0, t1: 1.0, label: 'UPDATE +$50', color: SIG.heavy }];
  const notes: SeqNote[] = [{ id: 'n1', actor: 'leader', t: 1.12, text: short ? '#108 logged' : '#108 in its WAL', color: SIG.heavy }];
  const flushed = short ? 'flushed' : 'flushed #108';
  let commitAt: number;
  let copies: number;
  if (mode === 'async') {
    messages.push({ id: 'c', from: 'leader', to: 'app', t0: 1.3, t1: 1.9, label: 'COMMIT ✓', color: SIG.res, hot: true });
    messages.push({ id: 'r', from: 'leader', to: 'follower', t0: 1.3, t1: 2.3, label: 'WAL #108', color: SIG.heavy });
    notes.push({ id: 'n2', actor: 'follower', t: 2.45, text: flushed, color: SIG.res });
    commitAt = 1.9;
    copies = 1;
  } else {
    messages.push({ id: 'r', from: 'leader', to: 'follower', t0: 1.3, t1: 2.3, label: 'WAL #108', color: SIG.heavy });
    notes.push({ id: 'n2', actor: 'follower', t: 2.45, text: flushed, color: SIG.res });
    messages.push({ id: 'a', from: 'follower', to: 'leader', t0: 2.6, t1: 3.4, label: 'ack #108', color: SIG.res });
    messages.push({ id: 'c', from: 'leader', to: 'app', t0: 3.55, t1: 4.15, label: 'COMMIT ✓', color: SIG.res, hot: true });
    commitAt = 4.15;
    copies = 2;
  }
  notes.push({ id: 'done', actor: 'app', t: commitAt + 0.18, text: `${toMs(commitAt - T0)} ms`, color: SIG.res });
  const spans: SeqSpan[] = [{ id: 'wait', actor: 'app', t0: T0, t1: commitAt, color: SIG.warn }];
  return { messages, notes, spans, commitAt, copies };
}

function SeqView({ sim }: { sim: ReplSim }) {
  const P = sim.orient === 'portrait';
  const mode = sim.cfg.seqMode;
  const { messages, notes, spans } = seqTimeline(mode, P);
  const x = P ? 8 : 60;
  const y = P ? 84 : 96;
  const w = sim.w - x * 2;
  const h = sim.h - y - (P ? 70 : 104);
  return (
    <SequenceDiagram
      x={x}
      y={y}
      w={w}
      h={h}
      now={Math.min(sim.stepT, 4.6)}
      pxPerSec={P ? 80 : 96}
      actors={[
        { id: 'app', label: 'app-1', sub: P ? undefined : '10.0.1.11', color: SIG.text2 },
        { id: 'leader', label: 'db-1 leader', sub: P ? undefined : '10.0.2.11', color: SIG.heavy },
        { id: 'follower', label: mode === 'sync' ? 'db-2 sync' : 'db-2 async', sub: P ? undefined : '10.0.2.12', color: mode === 'sync' ? SIG.res : SIG.line },
      ]}
      messages={messages}
      notes={notes}
      spans={spans}
      timeLabel={(t) => `${toMs(Math.max(0, t - T0))} ms`}
    />
  );
}
