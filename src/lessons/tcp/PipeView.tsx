import { SIG } from '@/lib/sim/colors';
import type { Box } from '@/lib/sim/Sim';
import stage from '@/components/stage/stage.module.css';
import { ackPathD, pipeGeom, pipePos, type PipeGeom } from './geom';
import { CLIENT, SERVER, fmtRate, segColor } from './labels';
import type { TcpModel } from './model';
import type { TcpSim } from './sim';
import { SendStrip } from './SeqView';
import css from './tcp.module.css';

/* Chapter 6 and the playground: the path as a pipe with a bottleneck
   router in the middle, and cwnd drawn live underneath. */

const MONO = 'var(--font-mono)';

function Host({ b, title, sub, accent, glow, dim }: { b: PipeGeom['alice']; title: string; sub: string; accent: string; glow?: boolean; dim?: boolean }) {
  const narrow = b.w < 120;
  return (
    <g transform={`translate(${b.x - b.w / 2},${b.y - b.h / 2})`} opacity={dim ? 0.3 : 1}>
      {glow && <rect x={-6} y={-6} width={b.w + 12} height={b.h + 12} rx={13} fill="none" stroke="var(--accent)" strokeWidth={1.4} strokeDasharray="3 3" />}
      <rect className={stage.card} width={b.w} height={b.h} rx={9} />
      <rect x={10} y={0} width={b.w - 20} height={2} rx={1} fill={accent} opacity={0.9} />
      <text className={stage.name} x={b.w / 2} y={b.h / 2 - (narrow ? 1 : 2)} textAnchor="middle" style={narrow ? { fontSize: 11 } : undefined}>
        {title}
      </text>
      <text className={stage.mono} x={b.w / 2} y={b.h / 2 + (narrow ? 10 : 12)} textAnchor="middle" style={narrow ? { fontSize: 8.5 } : undefined}>
        {sub}
      </text>
    </g>
  );
}

export function PipeScene({ sim, hl, onSegClick }: { sim: TcpSim; hl: string | null; onSegClick: (id: number) => void }) {
  const m = sim.model;
  if (!m) return null;
  const g = pipeGeom(sim, m);
  if (!g) return null;
  const compact = sim.orient === 'portrait';
  const o = sim.cfg.pipe ?? {};
  const strip = sim.boxes.get('pStrip');
  const chart = sim.boxes.get('chart');
  const outage = m.now < m.outageUntil;
  const queue = m.routerQueue();
  const slotH = compact ? 11 : 16;

  return (
    <g>
      {strip && o.strip && <SendStrip sim={sim} m={m} box={strip} window labels="regions" glow={hl === 'strip'} />}

      {/* links */}
      <line x1={g.ax} y1={g.y} x2={g.qx0} y2={g.y} stroke={outage ? SIG.err : 'rgba(143,166,201,0.4)'} strokeWidth={outage ? 1.6 : 1.3} strokeDasharray={outage ? '4 5' : undefined} />
      <line x1={g.rx1} y1={g.y} x2={g.sx} y2={g.y} stroke="rgba(143,166,201,0.55)" strokeWidth={2.4} />
      <path d={ackPathD(g.ack)} fill="none" stroke="rgba(75,227,160,0.22)" strokeWidth={1.2} strokeDasharray="3 5" />
      {!compact && (
        <>
          <text className={stage.caps} x={(g.ax + g.qx0) / 2} y={g.y - 12} textAnchor="middle" style={{ fill: outage ? SIG.err : undefined }}>
            {outage ? 'Wi-Fi hiccup: all lost' : 'fast Wi-Fi'}
          </text>
          <text className={stage.caps} x={(g.rx1 + g.sx) / 2} y={g.y - 12} textAnchor="middle" style={{ fill: 'rgba(255,154,60,0.85)' }}>
            bottleneck link
          </text>
          <text x={(g.rx1 + g.sx) / 2} y={g.y + 18} textAnchor="middle" style={{ fontFamily: MONO, fontSize: 10, fill: 'rgba(255,154,60,0.85)' }}>
            {fmtRate(m.capacity())}
          </text>
          <text className={stage.caps} x={g.ack.cx} y={g.ack.cy - 1} textAnchor="middle" style={{ fill: 'rgba(75,227,160,0.6)' }}>
            ACKs come back
          </text>
        </>
      )}
      {compact && outage && (
        <text className={stage.caps} x={(g.ax + g.qx0) / 2} y={g.y - 10} textAnchor="middle" style={{ fill: SIG.err, fontSize: 8 }}>
          hiccup
        </text>
      )}

      {/* router queue */}
      <g opacity={hl && hl !== 'queue' && hl !== 'router' ? 0.5 : 1}>
        {hl === 'queue' && <rect x={g.qx0 - 6} y={g.y - slotH / 2 - 6} width={g.qx1 - g.qx0 + 12} height={slotH + 12} rx={6} fill="none" stroke="var(--accent)" strokeWidth={1.3} strokeDasharray="3 3" />}
        {Array.from({ length: m.cfg.qcap }, (_, k) => (
          <rect key={k} x={g.qx1 - (k + 1) * g.slotW + 1} y={g.y - slotH / 2} width={g.slotW - 2} height={slotH} rx={2} fill="rgba(143,166,201,0.05)" stroke={queue.length >= m.cfg.qcap ? 'rgba(255,77,106,0.55)' : 'rgba(143,166,201,0.28)'} />
        ))}
        <text className={stage.caps} x={(g.qx0 + g.qx1) / 2} y={g.y + slotH / 2 + (compact ? 11 : 14)} textAnchor="middle" style={compact ? { fontSize: 7.5 } : undefined}>
          {`queue ${queue.length}/${m.cfg.qcap}`}
        </text>
      </g>

      <Router b={g.router} glow={hl === 'router'} busy={queue.length > 0} compact={compact} />
      <Host b={g.alice} title={compact ? CLIENT.short : CLIENT.name} sub={compact ? 'sender' : 'sender · 198.51.100.42'} accent={SIG.pink} glow={hl === 'client'} />
      <Host b={g.srv} title={compact ? 'server' : SERVER.name} sub={compact ? 'receiver' : 'receiver · 203.0.113.10'} accent={SIG.hc} glow={hl === 'server'} />
      {o.rbuf && <RbufGauge m={m} b={g.srv} compact={compact} />}

      {/* packets */}
      {m.segs.map((s) => {
        if (s.status !== 'flight') return null;
        const p = pipePos(g, m, s);
        if (!p) return null;
        const color = segColor(s);
        const ack = s.from === 's';
        const can = !p.queued && !sim.frozen;
        if (p.queued) {
          const r = compact ? 3.6 : 5.5;
          return <rect key={s.id} x={p.x - r} y={p.y - r} width={r * 2} height={r * 2} rx={1.5} fill={color} opacity={0.95} />;
        }
        return (
          <g key={s.id} className={can ? stage.clickable : undefined} onClick={can ? () => onSegClick(s.id) : undefined}>
            {can && <circle cx={p.x} cy={p.y} r={12} fill="transparent" />}
            {!ack && <circle cx={p.x} cy={p.y} r={9} fill={color} opacity={0.13} />}
            <circle cx={p.x} cy={p.y} r={ack ? (compact ? 2.4 : 3) : compact ? 3.6 : 4.6} fill={color} />
          </g>
        );
      })}

      {chart && o.chart && <CwndChart sim={sim} m={m} box={chart} glow={hl === 'chart'} />}
    </g>
  );
}

function Router({ b, glow, busy, compact }: { b: PipeGeom['router']; glow?: boolean; busy: boolean; compact: boolean }) {
  const r = Math.min(b.h, b.w) / 2 - 4;
  return (
    <g transform={`translate(${b.x},${b.y})`}>
      {glow && <circle r={r + 8} fill="none" stroke="var(--accent)" strokeWidth={1.4} strokeDasharray="3 3" />}
      <circle r={r} className={stage.card} style={busy ? { stroke: 'rgba(255,154,60,0.8)' } : undefined} />
      <g stroke={busy ? SIG.heavy : 'rgba(143,166,201,0.8)'} strokeWidth={1.4} strokeLinecap="round" fill="none">
        <path d={`M${-r * 0.5},0 H${r * 0.5} M${r * 0.25},${-r * 0.25} L${r * 0.5},0 L${r * 0.25},${r * 0.25}`} />
        <path d={`M0,${-r * 0.5} V${-r * 0.2} M0,${r * 0.2} V${r * 0.5}`} opacity={0.5} />
      </g>
      <text className={stage.caps} y={r + (compact ? 11 : 14)} textAnchor="middle" style={compact ? { fontSize: 7.5 } : undefined}>
        router
      </text>
    </g>
  );
}

function RbufGauge({ m, b, compact }: { m: TcpModel; b: PipeGeom['srv']; compact: boolean }) {
  const used = (m.rcvNxt - m.appRead + m.ooo.size) / m.cfg.rbuf;
  const w = b.w - 16;
  const x = b.x - w / 2;
  const y = b.y + b.h / 2 + (compact ? 8 : 10);
  const zero = m.advWin() === 0;
  return (
    <g>
      <rect x={x} y={y} width={w} height={5} rx={2.5} fill="rgba(181,155,255,0.12)" />
      <rect x={x} y={y} width={Math.max(2, Math.min(1, used) * w)} height={5} rx={2.5} fill={zero ? SIG.err : SIG.hc} />
      {!compact && (
        <text x={b.x} y={y + 16} textAnchor="middle" style={{ fontFamily: MONO, fontSize: 9, fill: zero ? SIG.err : SIG.text2 }}>
          {zero ? 'receive buffer full · rwnd 0' : `receive buffer ${Math.round(used * 100)}% full`}
        </text>
      )}
    </g>
  );
}

/* ------------------------------------------------------------------ */
/* cwnd over time                                                       */
/* ------------------------------------------------------------------ */

function ChartKey({ x, y, m, compact, cw, q }: { x: number; y: number; m: TcpModel; compact: boolean; cw: number; q: number }) {
  const items: { swatch: 'line' | 'dash' | 'box'; color: string; text: string }[] = [{ swatch: 'line', color: SIG.warn, text: `cwnd ${cw.toFixed(cw < 10 ? 1 : 0)}` }];
  if (m.cfg.cc === 'reno' || m.cfg.cc === 'cubic') items.push({ swatch: 'dash', color: SIG.hc, text: `ssthresh ${Number.isFinite(m.ssthresh) ? Math.round(m.ssthresh) : '∞'}` });
  if (m.cfg.path === 'bottleneck') items.push({ swatch: 'box', color: SIG.heavy, text: `queue ${q}` });
  let cx = x;
  const size = compact ? 9 : 10;
  return (
    <g>
      {items.map((it) => {
        const at = cx;
        cx += 22 + it.text.length * size * 0.6 + (compact ? 12 : 18);
        return (
          <g key={it.text.split(' ')[0]} transform={`translate(${at},${y})`}>
            {it.swatch === 'box' ? (
              <rect x={0} y={-6} width={14} height={8} rx={1.5} fill={it.color} opacity={0.35} />
            ) : (
              <line x1={0} y1={-2} x2={14} y2={-2} stroke={it.color} strokeWidth={2} strokeDasharray={it.swatch === 'dash' ? '4 3' : undefined} />
            )}
            <text x={20} y={2} style={{ fontFamily: MONO, fontSize: size, fill: it.color }}>
              {it.text}
            </text>
          </g>
        );
      })}
    </g>
  );
}

export function CwndChart({ sim, m, box, glow }: { sim: TcpSim; m: TcpModel; box: Box; glow?: boolean }) {
  const compact = sim.orient === 'portrait';
  const left = box.x - box.w / 2;
  const top = box.y - box.h / 2;
  const padL = compact ? 26 : 34;
  const padR = compact ? 8 : 14;
  const padT = compact ? 42 : 48;
  const padB = compact ? 20 : 22;
  const X0 = left + padL;
  const X1 = left + box.w - padR;
  const Y0 = top + padT;
  const Y1 = top + box.h - padB;
  const span = compact ? 3000 : 4200;
  const tEnd = Math.max(m.now, span);
  const tStart = tEnd - span;
  const bdp = m.baseRtt() / m.cfg.svc;
  const cap = bdp + m.cfg.qcap;
  const pts = m.cwndHist.filter((p) => p.ms >= tStart - 50);
  let peak = cap + 2;
  for (const p of pts) peak = Math.max(peak, p.cwnd);
  const yMax = Math.max(20, Math.ceil((peak * 1.12) / 4) * 4);
  const X = (ms: number) => X0 + ((ms - tStart) / span) * (X1 - X0);
  const Y = (v: number) => Y1 - (Math.min(v, yMax) / yMax) * (Y1 - Y0);
  const step = yMax > 40 ? 10 : yMax > 24 ? 8 : 4;

  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${X(Math.max(tStart, p.ms)).toFixed(1)},${Y(p.cwnd).toFixed(1)}`).join(' ');
  // The router queue sits on top of the pipe's capacity line.
  let qArea = '';
  if (pts.length > 1) {
    const top2 = pts.map((p) => `${X(Math.max(tStart, p.ms)).toFixed(1)},${Y(bdp + p.q).toFixed(1)}`);
    const base = [...pts].reverse().map((p) => `${X(Math.max(tStart, p.ms)).toFixed(1)},${Y(bdp).toFixed(1)}`);
    qArea = `M${top2.join(' L')} L${base.join(' L')} Z`;
  }
  let ssLine = '';
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (!Number.isFinite(p.ssthresh)) continue;
    const x = X(Math.max(tStart, p.ms)).toFixed(1);
    const y = Y(p.ssthresh).toFixed(1);
    const prev = pts[i - 1];
    ssLine += prev && Number.isFinite(prev.ssthresh) ? ` H${x} V${y}` : ` M${x},${y}`;
  }
  const last = pts[pts.length - 1];
  const marks = m.lossMarks.filter((l) => l.ms >= tStart);
  const bbr = m.cfg.cc === 'bbr' ? m.bbrInfo() : null;
  const phase = bbr
    ? `BBR · ${bbr.mode.replace('_', ' ')}`
    : m.cfg.cc === 'none'
      ? 'no congestion control'
      : m.inRecovery
        ? 'fast recovery'
        : m.cwnd < m.ssthresh
          ? 'slow start'
          : 'congestion avoidance';
  const cw = m.cfg.cc === 'none' ? m.cfg.fixedWnd : m.cwnd;

  return (
    <g opacity={box.alpha}>
      <rect x={left} y={top} width={box.w} height={box.h} rx={10} fill="rgba(7,11,20,0.55)" stroke={glow ? 'var(--accent)' : 'rgba(143,166,201,0.2)'} strokeDasharray={glow ? '3 3' : undefined} />
      <text className={stage.caps} x={left + 12} y={top + 16}>
        {compact ? 'cwnd (segments) over time' : 'congestion window (cwnd, segments) over time'}
      </text>
      <text x={left + box.w - 12} y={top + 16} textAnchor="end" style={{ fontFamily: MONO, fontSize: compact ? 9 : 10, fill: SIG.warn }}>
        {phase}
      </text>
      <ChartKey x={left + 12} y={top + 32} m={m} compact={compact} cw={cw} q={last?.q ?? 0} />

      {Array.from({ length: Math.floor(yMax / step) + 1 }, (_, k) => k * step).map((v) => (
        <g key={v}>
          <line x1={X0} y1={Y(v)} x2={X1} y2={Y(v)} stroke="rgba(143,166,201,0.09)" />
          <text x={X0 - 6} y={Y(v) + 3} textAnchor="end" style={{ fontFamily: MONO, fontSize: 8.5, fill: SIG.dim }}>
            {v}
          </text>
        </g>
      ))}
      {Array.from({ length: Math.floor(tEnd / 1000) - Math.ceil(tStart / 1000) + 1 }, (_, k) => Math.ceil(tStart / 1000) + k).map((s) => (
        <text key={s} x={X(s * 1000)} y={Y1 + 13} textAnchor="middle" style={{ fontFamily: MONO, fontSize: 8.5, fill: SIG.dim }}>
          {`${s} s`}
        </text>
      ))}

      {m.cfg.path === 'bottleneck' && (
        <g>
          {qArea && <path d={qArea} fill="rgba(255,154,60,0.2)" stroke="none" />}
          <line x1={X0} y1={Y(bdp)} x2={X1} y2={Y(bdp)} stroke="rgba(143,166,201,0.45)" strokeDasharray="5 5" />
          <line x1={X0} y1={Y(cap)} x2={X1} y2={Y(cap)} stroke="rgba(255,77,106,0.5)" strokeDasharray="5 5" />
          <text x={X1 - 4} y={Y(bdp) + 12} textAnchor="end" style={{ fontFamily: MONO, fontSize: compact ? 8 : 9, fill: SIG.text2 }}>
            {compact ? `pipe ${bdp.toFixed(0)}` : `pipe holds ${bdp.toFixed(0)} (BDP)`}
          </text>
          <text x={X1 - 4} y={Y(cap) - 5} textAnchor="end" style={{ fontFamily: MONO, fontSize: compact ? 8 : 9, fill: 'rgba(255,120,140,0.9)' }}>
            {compact ? `+queue ${cap.toFixed(0)}: drops` : `pipe + queue = ${cap.toFixed(0)}: above this, drops`}
          </text>
          {!compact && qArea && (
            <text x={X0 + 6} y={Y(bdp) - 5} style={{ fontFamily: MONO, fontSize: 9, fill: 'rgba(255,154,60,0.85)' }}>
              queue
            </text>
          )}
        </g>
      )}

      {ssLine && <path d={ssLine} fill="none" stroke={SIG.hc} strokeWidth={1.2} strokeDasharray="4 3" opacity={0.85} />}
      {line && <path d={line} fill="none" stroke={SIG.warn} strokeWidth={4} opacity={0.15} strokeLinejoin="round" />}
      {line && <path d={line} fill="none" stroke={SIG.warn} strokeWidth={1.8} strokeLinejoin="round" />}

      {marks.map((l, i) => {
        const x = X(l.ms);
        const y = Y(l.cwnd);
        const recent = i >= marks.length - 2;
        return (
          <g key={`${l.ms}-${i}`} className={css.popIn}>
            <circle cx={x} cy={y} r={4} fill="var(--ink-1)" stroke={SIG.err} strokeWidth={1.6} />
            {recent && !compact && (
              <text x={x + 7} y={y - 6} style={{ fontFamily: MONO, fontSize: 9, fill: SIG.err, paintOrder: 'stroke', stroke: 'var(--ink-1)', strokeWidth: 3 }}>
                {l.kind === 'fast' ? '3 dup ACKs' : 'timeout'}
              </text>
            )}
          </g>
        );
      })}

      {last && (
        <g>
          <circle cx={X(last.ms)} cy={Y(last.cwnd)} r={4} fill={SIG.warn} />
          <text x={X(last.ms) - 7} y={Y(last.cwnd) - 8} textAnchor="end" style={{ fontFamily: MONO, fontSize: 10, fill: SIG.warn, paintOrder: 'stroke', stroke: 'var(--ink-1)', strokeWidth: 3 }}>
            {`cwnd ${cw.toFixed(cw < 10 ? 1 : 0)}`}
          </text>
        </g>
      )}
    </g>
  );
}
