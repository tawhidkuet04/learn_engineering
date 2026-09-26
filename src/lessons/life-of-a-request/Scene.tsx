import { SIG } from '@/lib/sim/colors';
import { SequenceDiagram, type SeqMessage, type SeqNote, type SeqSpan } from '@/components/stage/SequenceDiagram';
import { Cylinder, Effects, Flights, NodeCard, Wires } from '@/components/stage/svg';
import { BrowserWindow } from './Browser';
import { distanceLabel, IP, PH, type NodeId, type RowId } from './journey';
import { Pipeline } from './Pipeline';
import type { JourneySim } from './sim';
import { Waterfall } from './Waterfall';

const MONO = 'var(--font-mono)';

export interface SceneOpts {
  focus?: string[];
  highlight: string | null;
  rows?: RowId[];
}

function WorkBar({ w, h, k, color }: { w: number; h: number; k: number; color: string }) {
  return (
    <g>
      <rect x={10} y={h - 8} width={w - 20} height={3} rx={1.5} fill="rgba(143,166,201,0.15)" />
      <rect x={10} y={h - 8} width={Math.max(2, (w - 20) * k)} height={3} rx={1.5} fill={color} />
    </g>
  );
}

/** The browser ↔ server connection: nothing, a TCP connection, or an encrypted tunnel. */
function Tunnel({ sim }: { sim: JourneySim }) {
  const st = sim.connState();
  if (st === 'none') return null;
  const d = sim.pathD('browser', 'server');
  const mid = sim.pathPoint('browser', 'server', 0.5);
  if (!d || !mid) return null;
  const color = st === 'tls' ? PH.tls : PH.tcp;
  return (
    <g>
      <path d={d} fill="none" stroke={color} strokeOpacity={0.14} strokeWidth={9} strokeLinecap="round" />
      <path d={d} fill="none" stroke={color} strokeOpacity={0.55} strokeWidth={1.2} />
      {st === 'tls' && (
        <g transform={`translate(${mid.x},${mid.y - 15})`}>
          <rect x={-7} y={-7} width={14} height={14} rx={3} fill="rgba(7,11,20,0.95)" stroke={PH.tls} strokeOpacity={0.8} />
          <g stroke={PH.tls} strokeWidth={1.2} fill="none">
            <rect x={-3.4} y={-1} width={6.8} height={5} rx={1} />
            <path d="M-2.1,-1 V-2.8 A2.1,2.1 0 0,1 2.1,-2.8 V-1" />
          </g>
        </g>
      )}
    </g>
  );
}

function RttCaption({ sim }: { sim: JourneySim }) {
  if (sim.orient !== 'landscape') return null;
  const p = sim.pathPoint('browser', 'server', 0.5);
  if (!p) return null;
  const rtt = sim.j.cfg.rtt;
  return (
    <text x={p.x} y={p.y + 19} textAnchor="middle" style={{ fontFamily: MONO, fontSize: 9.5, fill: SIG.dim, letterSpacing: '0.04em' }}>
      ⟷ round trip {rtt} ms · {distanceLabel(rtt)}
    </text>
  );
}

function NetView({ sim, o }: { sim: JourneySim; o: SceneOpts }) {
  const dim = (id: string) => !!o.focus?.length && !o.focus.includes(id);
  const glow = (id: string) => o.highlight === id;
  const b = sim.boxes.get('browser');
  const r = sim.boxes.get('resolver');
  const s = sim.boxes.get('server');
  const a = sim.boxes.get('app');
  const d = sim.boxes.get('db');
  const work = (id: NodeId) => sim.workOn(id);
  const rw = work('resolver');
  const sw = work('server');
  const aw = work('app');
  const dw = work('db');
  const lost = sim.lostMark();
  const m = sim.j.marks;
  const cluster = sim.sc.cluster;
  const cur = sim.sc.inspector === 'full' && sim.sc.view === 'net' ? sim.current() : null;
  const small = sim.orient === 'portrait';
  // The retransmission timer, drawn around the browser's jack while it runs.
  let rto: { x: number; y: number; k: number } | null = null;
  if (m.lossAt != null && sim.tau >= m.lossAt && sim.tau < m.synAt && b) {
    const p = sim.jack();
    if (p) rto = { ...p, k: (sim.tau - (m.synAt - 1000)) / 1000 };
  }
  return (
    <g>
      <Wires sim={sim} />
      <Tunnel sim={sim} />
      {sim.sc.view === 'net' && !dim('server') && <RttCaption sim={sim} />}
      {cur && (
        <line
          x1={cur.at.x}
          y1={cur.at.y}
          x2={Math.min(Math.max(cur.at.x, sim.dock.x - sim.dock.w / 2 + 14), sim.dock.x + sim.dock.w / 2 - 14)}
          y2={sim.dock.y}
          stroke={cur.color}
          strokeOpacity={0.45}
          strokeDasharray="2 3"
        />
      )}
      {r && (
        <NodeCard box={r} title="DNS resolver" sub={IP.resolver} kicker={small ? undefined : { text: 'recursive resolver' }} led={rw ? 'busy' : 'up'} dim={dim('resolver')} glow={glow('resolver')}>
          {rw && <WorkBar w={r.w} h={r.h} k={rw.k} color={PH.dns} />}
        </NodeCard>
      )}
      {s && (
        <NodeCard
          box={s}
          title={cluster ? 'load balancer' : 'shop.example'}
          sub={cluster || small ? IP.server : `${IP.server} : 443`}
          kicker={small ? undefined : { text: cluster ? 'shop.example' : 'web server' }}
          led={sw ? 'busy' : 'up'}
          dim={dim('server')}
          glow={glow('server')}
        >
          {sw && !cluster && <WorkBar w={s.w} h={s.h} k={sw.k} color={PH.req} />}
        </NodeCard>
      )}
      {a && (
        <NodeCard box={a} title="app-2" sub={small ? undefined : `${IP.app}:8080`} kicker={small ? undefined : { text: 'app server' }} led={aw ? 'busy' : 'up'} dim={dim('app')} glow={glow('app')}>
          {aw && <WorkBar w={a.w} h={a.h} k={aw.k} color={PH.req} />}
        </NodeCard>
      )}
      {d && (
        <Cylinder box={d} title="postgres" sub={small ? undefined : IP.db} dim={dim('db')} glow={glow('db')}>
          {dw && <WorkBar w={d.w} h={d.h - 4} k={dw.k} color={PH.req} />}
        </Cylinder>
      )}
      {b && (
        <BrowserWindow
          box={b}
          state={sim.pageState()}
          vt={sim.vt}
          dim={dim('browser')}
          glow={glow('browser')}
          urlGlow={sim.sc.view === 'url' || glow('url')}
          errCode={sim.j.cfg.cert === 'wrong-name' ? 'NET::ERR_CERT_COMMON_NAME_INVALID' : 'NET::ERR_CERT_DATE_INVALID'}
          secure={sim.connState() === 'tls'}
        />
      )}
      {b && sim.sc.view === 'net' && (() => {
        const p = sim.jack();
        return p ? <circle cx={p.x} cy={p.y} r={3} fill="var(--ink-1)" stroke="rgba(143,166,201,0.7)" /> : null;
      })()}
      {rto && (
        <g transform={`translate(${rto.x},${rto.y})`}>
          <circle r={15} fill="rgba(7,11,20,0.9)" stroke="rgba(255,77,106,0.25)" strokeWidth={3} />
          <circle r={15} fill="none" stroke={SIG.err} strokeWidth={3} strokeDasharray={`${2 * Math.PI * 15 * rto.k} 999`} transform="rotate(-90)" />
          {/* Inside the (still blank) page, left of the timer ring */}
          <text x={-22} y={3.5} textAnchor="end" style={{ fontFamily: MONO, fontSize: 9.5, fill: SIG.err, paintOrder: 'stroke', stroke: 'var(--ink-1)', strokeWidth: 3 }}>
            RTO {Math.round(rto.k * 1000)} / 1000 ms
          </text>
        </g>
      )}
      <Flights sim={sim} />
      {lost && (
        <g transform={`translate(${lost.x},${lost.y})`}>
          <g stroke={SIG.err} strokeWidth={2.2} strokeLinecap="round">
            <line x1={-6} y1={-6} x2={6} y2={6} />
            <line x1={-6} y1={6} x2={6} y2={-6} />
          </g>
          {!small && (
            <text y={-12} textAnchor="middle" style={{ fontFamily: MONO, fontSize: 9.5, fill: SIG.err }}>
              SYN lost
            </text>
          )}
        </g>
      )}
      <Effects sim={sim} />
    </g>
  );
}

function SeqView({ sim }: { sim: JourneySim }) {
  const R = sim.seqRect;
  const j = sim.j;
  const m = j.marks;
  const pk = j.packets.filter((p) => !p.internal && p.info !== 'chunk' && (p.from === 'browser' || p.to === 'browser') && (p.from === 'server' || p.to === 'server'));
  const inFlight = pk.some((p) => sim.tau > p.send && sim.tau < p.arrive);
  const messages: SeqMessage[] = pk.filter((p) => p.send < sim.tau - 1e-9).map((p) => ({
    id: p.id,
    from: p.from === 'browser' ? 'b' : 's',
    to: p.to === 'browser' ? 'b' : 's',
    t0: p.send,
    t1: p.arrive,
    label: p.label,
    color: p.color,
    lostAt: p.lostAt ?? null,
    hot: sim.tau >= p.send && sim.tau < p.arrive,
  }));
  const notes: SeqNote[] = [];
  if (!j.cfg.reuse) notes.push({ id: 'est', actor: 'b', t: m.tcpEnd, text: 'connected', color: PH.tcp });
  if (!j.cfg.reuse && m.failAt == null) notes.push({ id: 'keys', actor: 'b', t: m.tlsEnd, text: 'keys ready', color: PH.tls });
  if (m.failAt != null) notes.push({ id: 'fail', actor: 'b', t: m.failAt, text: 'cert rejected', color: SIG.err });
  const spans: SeqSpan[] = [];
  if (m.lossAt != null) spans.push({ id: 'rto', actor: 'b', t0: m.synAt - 1000, t1: m.synAt, label: 'RTO 1 s', color: SIG.err });
  if (Number.isFinite(m.reqArrive)) spans.push({ id: 'think', actor: 's', t0: m.reqArrive, t1: m.resSent, label: 'think', color: PH.req });
  const origin = Math.max(0, sim.from - 6);
  const span = Math.max(40, sim.to - origin);
  const bodyH = R.h - 50;
  // Fit the whole section without scrolling (the diagram scrolls once content passes bodyH - 56).
  const px = Math.min(3.2, Math.max(0.6, (bodyH - (sim.orient === 'portrait' ? 58 : 70)) / span));
  const bodyTop = R.y + 42 + 8;
  const scroll = Math.max(0, (sim.tau - origin) * px - (bodyH - 56));
  const yOf = (t: number) => bodyTop + 16 + (t - origin) * px - scroll;
  // Round-trip brackets: SYN → SYN-ACK, ClientHello → server's reply.
  const portrait = sim.orient === 'portrait';
  const brackets: { id: string; t0: number; t1: number; label: string; color: string }[] = [];
  if (!j.cfg.reuse) {
    brackets.push({ id: 'tcp', t0: m.synAt, t1: m.tcpEnd, label: portrait ? '1 RTT' : `1 RTT · ${j.cfg.rtt} ms`, color: PH.tcp });
    const tlsEnd = m.failAt != null ? m.failAt - 1 : m.tlsEnd;
    const n = j.cfg.tls === '1.3' || m.failAt != null ? 1 : 2;
    brackets.push({ id: 'tls', t0: m.tcpEnd, t1: tlsEnd, label: portrait ? `${n} RTT` : `${n} RTT · ${Math.round(tlsEnd - m.tcpEnd)} ms`, color: PH.tls });
  }
  const bx = R.x + 6;
  return (
    <g>
      <SequenceDiagram
        x={R.x + 34}
        y={R.y}
        w={R.w - 34}
        h={R.h}
        actors={[
          { id: 'b', label: 'Alice’s browser', sub: IP.browser, color: SIG.pink },
          { id: 's', label: 'shop.example', sub: `${IP.server}:443`, color: PH.req },
        ]}
        messages={messages}
        notes={notes}
        spans={spans}
        now={sim.tau}
        origin={origin}
        pxPerSec={px}
        timeLabel={portrait ? undefined : (t) => `${Math.round(t)} ms`}
        dimOthers={inFlight}
      />
      <g>
        <defs>
          <clipPath id="seq-brackets">
            <rect x={R.x - 4} y={bodyTop} width={60} height={bodyH} />
          </clipPath>
        </defs>
        <g clipPath="url(#seq-brackets)">
          {brackets.map((br) => {
            if (!(sim.tau >= br.t1)) return null;
            const y0 = yOf(br.t0);
            const y1 = yOf(br.t1);
            return (
              <g key={br.id} stroke={br.color} strokeWidth={1.3} fill="none">
                <path d={`M${bx + 8},${y0} H${bx + 2} V${y1} H${bx + 8}`} />
                <text
                  x={bx - 1}
                  y={(y0 + y1) / 2}
                  transform={`rotate(-90 ${bx - 1} ${(y0 + y1) / 2})`}
                  textAnchor="middle"
                  stroke="none"
                  style={{ fontFamily: MONO, fontSize: 9, fill: br.color }}
                >
                  {br.label}
                </text>
              </g>
            );
          })}
        </g>
      </g>
    </g>
  );
}

function RenderView({ sim, o }: { sim: JourneySim; o: SceneOpts }) {
  const b = sim.boxes.get('browser');
  return (
    <g>
      {b && <BrowserWindow box={b} state={sim.pageState()} vt={sim.vt} glow={o.highlight === 'browser'} secure />}
      <Pipeline sim={sim} glow={o.highlight} />
      <Effects sim={sim} />
    </g>
  );
}

export function Scene({ sim, o }: { sim: JourneySim; o: SceneOpts }) {
  const v = sim.sc.view;
  const rows = [...(o.rows ?? [])];
  if (o.highlight?.startsWith('row:')) rows.push(o.highlight.slice(4) as RowId);
  return (
    <>
      {(v === 'net' || v === 'url') && <NetView sim={sim} o={o} />}
      {v === 'seq' && <SeqView sim={sim} />}
      {v === 'render' && <RenderView sim={sim} o={o} />}
      <Waterfall sim={sim} highlight={rows} glow={o.highlight === 'waterfall'} />
    </>
  );
}
