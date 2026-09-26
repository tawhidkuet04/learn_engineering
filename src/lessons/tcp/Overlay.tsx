import { Hud, Legend, type HudItem, type LegendItem } from '@/components/stage/chrome';
import { Callouts, Readout, RLine, RResult, StagePrompt, type Callout } from '@/components/stage/overlays';
import { featuredSeg, seqGeom, segLine } from './geom';
import { CLIENT, SERVER, fmtBytes, fmtMs, fmtRate } from './labels';
import type { Seg, TcpModel } from './model';
import type { TcpSim } from './sim';
import css from './tcp.module.css';

export type HudKey =
  | 'net-sent'
  | 'net-lost'
  | 'net-late'
  | 'net-dup'
  | 'net-rtx'
  | 'rtt'
  | 'inflight'
  | 'acked'
  | 'rtx'
  | 'timeouts'
  | 'fastrtx'
  | 'dropped'
  | 'rwnd'
  | 'cwnd'
  | 'ssthresh'
  | 'goodput'
  | 'queue'
  | 'loss'
  | 'probes'
  | 'syns'
  | 'elapsed';

function hudItem(sim: TcpSim, k: HudKey): HudItem | null {
  const n = sim.net;
  const m = sim.model;
  switch (k) {
    case 'net-sent':
      return n ? { label: 'Sent', value: n.stats.sent } : null;
    case 'net-lost':
      return n ? { label: 'Lost', value: n.stats.lost, tone: n.stats.lost ? 'bad' : undefined } : null;
    case 'net-late':
      return n ? { label: 'Out of order', value: n.stats.late, tone: n.stats.late ? 'warn' : undefined } : null;
    case 'net-dup':
      return n ? { label: 'Duplicated', value: n.stats.dups, tone: n.stats.dups ? 'warn' : undefined } : null;
    case 'net-rtx':
      return n ? { label: 'Resent', value: n.stats.rtx } : null;
  }
  if (!m) return null;
  switch (k) {
    case 'rtt':
      return { label: 'Smoothed RTT', value: m.srtt ? Math.round(m.srtt) : '—', unit: 'ms' };
    case 'inflight':
      return { label: 'In flight', value: m.nxt - m.una, unit: 'segs' };
    case 'acked':
      return { label: 'Acknowledged', value: fmtBytes(m.bytesThrough(m.una)) };
    case 'rtx':
      return { label: 'Retransmits', value: m.stats.rtx, tone: m.stats.rtx ? 'warn' : undefined };
    case 'timeouts':
      return { label: 'Timeouts', value: m.stats.timeouts, tone: m.stats.timeouts ? 'bad' : undefined };
    case 'fastrtx':
      return { label: 'Fast retransmits', value: m.stats.fastRtx };
    case 'dropped':
      return { label: 'Dropped by you', value: sim.userDrops, tone: sim.userDrops ? 'bad' : undefined };
    case 'rwnd': {
      const w = m.advWin();
      return { label: 'Receive window', value: w, unit: 'B', tone: w === 0 ? 'bad' : undefined };
    }
    case 'cwnd':
      return { label: 'cwnd', value: m.cfg.cc === 'none' ? '—' : m.cwnd.toFixed(m.cwnd < 10 ? 1 : 0), unit: 'segs' };
    case 'ssthresh':
      return { label: 'ssthresh', value: Number.isFinite(m.ssthresh) && m.cfg.cc !== 'bbr' ? Math.round(m.ssthresh) : '∞', unit: Number.isFinite(m.ssthresh) ? 'segs' : undefined };
    case 'goodput': {
      const gp = m.goodput(1500);
      const pct = m.cfg.path === 'bottleneck' ? Math.round((gp / m.capacity()) * 100) : null;
      return { label: 'Goodput', value: fmtRate(gp).split(' ')[0], unit: `${fmtRate(gp).split(' ')[1]}${pct != null ? ` · ${pct}%` : ''}` };
    }
    case 'queue':
      return { label: 'Router queue', value: `${m.routerQueue().length}/${m.cfg.qcap}`, tone: m.routerQueue().length >= m.cfg.qcap ? 'bad' : undefined };
    case 'loss': {
      const r = m.recentLoss(3000);
      return { label: 'Dropped · last 3 s', value: r == null ? '—' : Math.round(r * 100), unit: '%', tone: r != null && r > 0.1 ? 'bad' : undefined };
    }
    case 'probes':
      return { label: 'Window probes', value: m.stats.probes };
    case 'syns':
      return { label: 'SYNs sent', value: m.segs.filter((s) => s.kind === 'syn').length };
    case 'elapsed':
      return { label: 'Connection time', value: fmtMs(m.now) };
    default:
      return null;
  }
}

const KIND_NAME: Record<string, string> = { syn: 'SYN', synack: 'SYN-ACK', ack: 'ACK', data: 'data', fin: 'FIN', probe: 'probe', wupd: 'window update' };

/** The TCP header of the segment the diagram is talking about. */
function HeaderCard({ m, s, abs, x, y, width, strip }: { m: TcpModel; s: Seg; abs: boolean; x: number; y: number; width: number; strip: boolean }) {
  const A = (space: 'c' | 's', rel: number) => String(abs ? (space === 'c' ? m.absC(rel) : m.absS(rel)) : rel);
  const src = s.from === 'c' ? CLIENT : SERVER;
  const dst = s.from === 'c' ? SERVER : CLIENT;
  const flags = s.kind === 'syn' ? 'SYN' : s.kind === 'synack' ? 'SYN ACK' : s.kind === 'fin' ? 'FIN ACK' : s.kind === 'data' ? 'PSH ACK' : 'ACK';
  const ack = s.ack < 0 ? null : s.conceal ? '?' : A(s.from === 'c' ? 's' : 'c', s.ack);
  const head = `TCP header · ${KIND_NAME[s.kind] ?? s.kind} · ${s.from === 'c' ? 'Alice → server' : 'server → Alice'}`;
  if (strip) {
    return (
      <Readout anchor="strip" head={head}>
        <RLine>
          seq <em>{A(s.from, s.seq)}</em> · ack {ack == null ? '— (flag off)' : <em>{ack}</em>}
        </RLine>
        <RLine dim>
          flags {flags} · win {s.win} · ports {src.port} → {dst.port}
          {s.len > 0 ? ` · ${s.len} B` : ''}
        </RLine>
      </Readout>
    );
  }
  return (
    <Readout x={x} y={y} width={width} head={head}>
      <div className={css.hdrGrid}>
        <span>src port</span>
        <b>{src.port}</b>
        <span>dst port</span>
        <b>{dst.port}</b>
        <span>seq</span>
        <em>{A(s.from, s.seq)}</em>
        <span>ack</span>
        {ack == null ? <i>0 · ACK flag off</i> : <em data-q={s.conceal}>{ack}</em>}
        <span>flags</span>
        <b>{flags}</b>
        <span>window</span>
        <b>{s.win}</b>
        {(s.kind === 'syn' || s.kind === 'synack') && (
          <>
            <span>options</span>
            <i>mss 1460 · sackOK · wscale 7</i>
          </>
        )}
        {s.len > 0 && (
          <>
            <span>payload</span>
            <b>{s.len} bytes</b>
          </>
        )}
      </div>
    </Readout>
  );
}

export function TcpOverlay({
  sim,
  hud,
  mobileHud,
  legend = [],
  callouts = [],
  mobileCallouts = [],
  stepKey,
}: {
  sim: TcpSim;
  hud: HudKey[];
  mobileHud?: HudKey[];
  legend?: LegendItem[];
  callouts?: Callout[];
  mobileCallouts?: Callout[];
  stepKey: string;
}) {
  const port = sim.orient === 'portrait';
  const keys = port ? (mobileHud ?? hud.slice(0, 3)) : hud;
  const items = keys.map((k) => hudItem(sim, k)).filter((x): x is HudItem => !!x);
  const m = sim.model;
  const q = sim.game?.pending;
  // On phones a readout docks above the controls, where the legend would go.
  const docked = port && (sim.view === 'net' || !!sim.cfg.seq?.side || !!sim.cfg.seq?.inspect);
  // On phones the chart's own key covers its lines, so the legend keeps to one row.
  const chartKeys = new Set(['cwnd', 'ssthresh', 'router queue']);
  const items2 = port && sim.view === 'pipe' ? legend.filter((l) => !chartKeys.has(l.label)) : legend;
  return (
    <>
      <Hud items={items} />
      <Callouts sim={sim} callouts={port ? mobileCallouts : callouts} stepKey={stepKey} />
      {!docked && <Legend items={items2} />}
      {sim.view === 'net' && <NetReadout sim={sim} />}
      {sim.view === 'seq' && m && <SeqOverlay sim={sim} m={m} />}
      {sim.view === 'pipe' && m && q && (() => {
        const c = sim.boxes.get('chart');
        return c ? <StagePrompt x={c.x} y={c.y - c.h / 2 + 62}>{q.ask}</StagePrompt> : null;
      })()}
    </>
  );
}

function SeqOverlay({ sim, m }: { sim: TcpSim; m: TcpModel }) {
  const g = seqGeom(sim, m);
  if (!g) return null;
  const o = sim.cfg.seq ?? {};
  const port = sim.orient === 'portrait';
  const q = sim.game?.pending;
  const side = sim.boxes.get('side');
  const concealed = m.segs.find((s) => s.conceal && s.status === 'flight');
  let prompt = null;
  if (q && concealed) {
    const L = segLine(g, m, concealed);
    // Below the playhead the diagram is still empty: ask there.
    const half = (q.ask?.length ?? 10) * 3.4 + 14;
    prompt = (
      <StagePrompt x={Math.min(Math.max(L.hx, half + 8), sim.w - half - 8)} y={Math.min(L.hy + 46, g.bottom)}>
        {q.ask}
      </StagePrompt>
    );
  }
  let inspector = null;
  if (o.inspect) {
    const s = featuredSeg(m);
    if (s && side) inspector = <HeaderCard m={m} s={s} abs={!!o.abs} x={side.x} y={side.y} width={side.w} strip={port} />;
  }
  return (
    <>
      {o.side === 'rto' && <RtoReadout m={m} x={side?.x ?? 0} y={side?.y ?? 0} w={side?.w} strip={port} />}
      {o.side === 'dup' && <DupReadout m={m} x={side?.x ?? 0} y={side?.y ?? 0} w={side?.w} strip={port} />}
      {inspector}
      {prompt}
    </>
  );
}

function RtoReadout({ m, x, y, w, strip }: { m: TcpModel; x: number; y: number; w?: number; strip: boolean }) {
  const t = m.timer('rto');
  const left = t ? Math.max(0, t.deadline - m.now) : null;
  const frac = t ? Math.min(1, (m.now - t.start) / Math.max(1, t.deadline - t.start)) : 0;
  const overdue = t && m.now - t.start > 1.25 * (m.srtt || 100);
  return (
    <Readout x={x} y={y} width={w} anchor={strip ? 'strip' : 'below'} head="retransmission timer (RTO)" fresh={!!overdue}>
      <RLine>
        SRTT <em>{Math.round(m.srtt)} ms</em> · RTTVAR {Math.round(m.rttvar)} ms
      </RLine>
      <RLine dim>RTO = SRTT + max(4·RTTVAR, 200)</RLine>
      <div className={css.timerBar} data-warn={!!overdue}>
        <i style={{ width: `${Math.round(frac * 100)}%` }} />
      </div>
      <RResult>
        {t ? (
          <>
            RTO <b>{Math.round(m.rto)} ms</b> · {overdue ? 'ACK overdue: ' : ''}fires in {Math.round(left ?? 0)} ms
          </>
        ) : (
          <>
            RTO <b>{Math.round(m.rto)} ms</b> · idle (nothing unacknowledged)
          </>
        )}
      </RResult>
    </Readout>
  );
}

function DupReadout({ m, x, y, w, strip }: { m: TcpModel; x: number; y: number; w?: number; strip: boolean }) {
  const d = m.dupacks;
  const hole = m.una < m.nxt ? m.segSeq(m.una) : null;
  return (
    <Readout x={x} y={y} width={w} anchor={strip ? 'strip' : 'below'} head="sender: duplicate ACK counter" fresh={d >= 3}>
      <RLine>
        oldest unacked byte <em>{hole ?? '—'}</em>
      </RLine>
      <div className={css.dots}>
        {[1, 2, 3].map((k) => (
          <i key={k} data-on={d >= k} />
        ))}
        <span>{d >= 3 ? 'fast retransmit!' : `${d} of 3 duplicate ACKs`}</span>
      </div>
      <RResult>
        {m.inRecovery || d >= 3 ? (
          <>
            resent <b>seq={hole}</b> without waiting for the timer
          </>
        ) : (
          <>
            3 duplicates → <b>resend now</b>
          </>
        )}
      </RResult>
    </Readout>
  );
}

function NetReadout({ sim }: { sim: TcpSim }) {
  const n = sim.net;
  const srv = sim.boxes.get('srv');
  if (!n || !srv) return null;
  const port = sim.orient === 'portrait';
  const recent = n.arrivals.slice(port ? -9 : -14);
  const tcp = n.mode === 'tcp';
  const x = port ? 0 : sim.w / 2;
  const y = port ? 0 : sim.h * 0.43 + Math.min(150, sim.h * 0.19) + 64;
  return (
    <Readout x={x} y={y} anchor={port ? 'strip' : 'below'} head={tcp ? 'server · what arrives vs what the app reads' : 'server · what the app receives (UDP)'} width={port ? undefined : 470}>
      <div className={css.arrRow}>
        <span className={css.arrLabel}>{tcp ? 'arrived' : 'app gets'}</span>
        <span className={css.arrChips}>
          {recent.map((a) => (
            <i key={a.key} data-mark={a.mark}>
              {a.n}
            </i>
          ))}
          {!recent.length && <em>waiting…</em>}
        </span>
      </div>
      {tcp ? (
        <div className={css.arrRow}>
          <span className={css.arrLabel}>app reads</span>
          <span className={css.arrChips}>
            {n.appRead.slice(port ? -9 : -14).map((k) => (
              <i key={k} data-mark="ok">
                {k}
              </i>
            ))}
            {n.heldList.length > 0 && <em>holding {n.heldList.join(', ')} until {n.expectedNext} arrives</em>}
          </span>
        </div>
      ) : (
        <RResult>
          {n.missing.size ? (
            <>
              never arrived: <b>{[...n.missing].slice(-4).join(', ')}</b>
            </>
          ) : (
            <>no gaps noticed yet</>
          )}
          {n.stats.late ? <> · out of order: {n.stats.late}</> : null}
          {n.stats.dups ? <> · twice: {n.stats.dups}</> : null}
        </RResult>
      )}
    </Readout>
  );
}
