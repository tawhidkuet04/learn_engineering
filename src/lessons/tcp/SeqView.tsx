import { SIG } from '@/lib/sim/colors';
import { clamp } from '@/lib/sim/geometry';
import type { Box } from '@/lib/sim/Sim';
import stage from '@/components/stage/stage.module.css';
import { featuredSeg, seqGeom, segLine, type SeqGeom } from './geom';
import { CLIENT, SERVER, fmtMs, segColor, segTexts, stateTone, textW } from './labels';
import type { Seg, TcpModel, TcpState, TimerLog } from './model';
import type { SeqOpts, TcpSim } from './sim';
import css from './tcp.module.css';

/* The main view of chapters 2–5 and 7: a live sequence diagram, the way
   TCP is drawn in RFCs. Time runs downward; every segment is a line. */

const MONO = 'var(--font-mono)';

function Halo({ x, y, text, color, anchor = 'start', size = 10.5, weight = 500 }: { x: number; y: number; text: string; color: string; anchor?: 'start' | 'middle' | 'end'; size?: number; weight?: number }) {
  return (
    <text
      x={x}
      y={y}
      textAnchor={anchor}
      style={{ fontFamily: MONO, fontSize: size, fontWeight: weight, fill: color, paintOrder: 'stroke', stroke: 'var(--ink-1)', strokeWidth: 4, strokeLinejoin: 'round' }}
    >
      {text}
    </text>
  );
}

export function ActorHeader({ box, title, sub, state, glow, accent }: { box: Box; title: string; sub: string; state: TcpState; glow?: boolean; accent: string }) {
  const tone = stateTone(state);
  const pillW = textW(state, 9.5) + 18;
  const narrow = box.w < 150;
  return (
    <g transform={`translate(${box.x - box.w / 2},${box.y - box.h / 2})`} opacity={box.alpha}>
      {glow && <rect x={-6} y={-6} width={box.w + 12} height={box.h + 12} rx={13} fill="none" stroke="var(--accent)" strokeWidth={1.4} strokeDasharray="3 3" />}
      <rect className={stage.card} width={box.w} height={box.h} rx={9} />
      <rect x={10} y={0} width={box.w - 20} height={2} rx={1} fill={accent} opacity={0.9} />
      <text className={stage.name} x={box.w / 2} y={box.h / 2 - (narrow ? 1 : 2)} textAnchor="middle" style={narrow ? { fontSize: 11.5 } : undefined}>
        {title}
      </text>
      <text className={stage.mono} x={box.w / 2} y={box.h / 2 + (narrow ? 11 : 12)} textAnchor="middle" style={narrow ? { fontSize: 9 } : undefined}>
        {sub}
      </text>
      <g key={state} className={css.pillIn} transform={`translate(${box.w / 2 - pillW / 2},${box.h + 5})`}>
        <rect width={pillW} height={16} rx={8} fill="rgba(7,11,20,0.95)" stroke={tone} strokeOpacity={0.75} />
        <text x={pillW / 2} y={11.5} textAnchor="middle" style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.05em', fill: tone }}>
          {state}
        </text>
      </g>
    </g>
  );
}

function noteColor(tone: string) {
  return tone === 'good' ? SIG.res : tone === 'warn' ? SIG.warn : tone === 'bad' ? SIG.err : tone === 'ctl' ? SIG.hc : SIG.text2;
}

const TIMER_LABEL: Record<string, string> = {
  syn: 'SYN timer',
  synack: 'SYN-ACK timer',
  rto: 'RTO timer',
  persist: 'persist timer',
  timewait: 'TIME_WAIT',
  fin: 'FIN timer',
};

function timerSpan(t: TimerLog, g: SeqGeom, m: TcpModel, o: SeqOpts, compact: boolean) {
  const x = t.side === 'c' ? g.xc : g.xs;
  const end = t.end ?? m.now;
  if (t.kind === 'rto' && !t.fired) {
    // A running RTO timer only matters once its ACK is overdue.
    if (end - t.start < Math.max(1.25 * (m.srtt || 100), 140)) return null;
  }
  const y0 = g.yMs(t.start);
  const y1 = Math.max(y0 + 2, g.yMs(end));
  // A fired retransmission timer means trouble; a persist timer firing is routine.
  const bad = t.fired && t.kind !== 'persist' && t.kind !== 'timewait';
  const color = t.kind === 'timewait' ? SIG.heavy : bad ? SIG.err : SIG.hc;
  const label = `${TIMER_LABEL[t.kind]} ${fmtMs(t.deadline - t.start)}`;
  const left = t.side === 'c';
  void o;
  return (
    <g key={`t${t.id}`}>
      <rect x={x - 4} y={y0} width={8} height={y1 - y0} rx={2} fill={color} opacity={0.22} stroke={color} strokeOpacity={0.75} />
      {!t.fired && t.end == null && <rect x={x - 4} y={y1 - 3} width={8} height={3} rx={1} fill={color} className={css.blink} />}
      {bad && (
        <g transform={`translate(${x},${y1})`}>
          <circle r={6} fill="var(--ink-1)" stroke={color} strokeWidth={1.4} />
          <path d="M-2.5,-2.5 L2.5,2.5 M-2.5,2.5 L2.5,-2.5" stroke={color} strokeWidth={1.4} />
        </g>
      )}
      {y1 - y0 > 30 && <Halo x={left ? x - 10 : x + 10} y={y0 + 26} text={compact ? TIMER_LABEL[t.kind] : label} color={color} anchor={left ? 'end' : 'start'} size={compact ? 8.5 : 9.5} weight={400} />}
    </g>
  );
}

export function SeqScene({ sim, hl, onSegClick }: { sim: TcpSim; hl: string | null; onSegClick: (id: number) => void }) {
  const m = sim.model;
  if (!m) return null;
  const g = seqGeom(sim, m);
  const hc = sim.boxes.get('hdrC');
  const hs = sim.boxes.get('hdrS');
  if (!g || !hc || !hs) return null;
  const o = sim.cfg.seq ?? {};
  const compact = sim.orient === 'portrait';
  const lifeTop = hc.y + hc.h / 2 + 22;
  const span = Math.abs(g.xs - g.xc);
  const clipId = 'tcp-seq-body';
  // Dense captions from both sides share the gap on a narrow stage.
  const labelMax = span - 34;
  const denseMax = compact ? span / 2 - 14 : span - 34;
  const clickable = new Set(o.drop ?? []);
  const sStrip = sim.boxes.get('sendStrip');
  const rStrip = sim.boxes.get('rbuf');

  return (
    <g>
      <defs>
        <clipPath id={clipId}>
          <rect x={0} y={g.top - 2} width={sim.w} height={g.bottom - g.top + 2} />
        </clipPath>
      </defs>

      {sStrip && o.strip && <SendStrip sim={sim} m={m} box={sStrip} window={!!o.window} labels="bytes" glow={hl === 'strip'} />}
      {rStrip && o.rbuf && <RecvBuffer sim={sim} m={m} box={rStrip} glow={hl === 'rbuf'} />}

      <line x1={g.xc} y1={lifeTop} x2={g.xc} y2={g.bottom} stroke="rgba(143,166,201,0.3)" strokeDasharray="3 5" />
      <line x1={g.xs} y1={lifeTop} x2={g.xs} y2={g.bottom} stroke="rgba(143,166,201,0.3)" strokeDasharray="3 5" />

      <g clipPath={`url(#${clipId})`}>
        {m.warps.map((w, i) => {
          const y0 = g.yOf(w.disp0);
          const y1 = g.yOf(w.disp1);
          return <Skip key={`w${i}`} xc={g.xc} xs={g.xs} y0={y0} y1={y1} ms={w.ms1 - w.ms0} />;
        })}
        {m.warping && <Skip xc={g.xc} xs={g.xs} y0={g.yMs(m.now) - 30} y1={g.yMs(m.now)} ms={-1} />}

        {o.timers && m.timerLog.filter((t) => o.timers?.includes(t.kind)).map((t) => timerSpan(t, g, m, o, compact))}

        {o.rtt && !compact && <RttBracket m={m} g={g} />}

        {m.notes.map((n) => {
          const x = n.side === 'c' ? g.xc : g.xs;
          const y = g.yMs(n.ms);
          const color = noteColor(n.tone);
          const size = compact ? 8.5 : 9.5;
          const tw = textW(n.text, size) + 12;
          const bx = n.side === 'c' ? x - tw - 9 : x + 9;
          return (
            <g key={`n${n.id}`} className={css.noteIn}>
              <rect x={bx} y={y - 8.5} width={tw} height={17} rx={4} fill="rgba(7,11,20,0.94)" stroke={color} strokeOpacity={0.55} />
              <text x={bx + tw / 2} y={y + 3.5} textAnchor="middle" style={{ fontFamily: MONO, fontSize: size, fill: color, letterSpacing: '0.04em' }}>
                {n.text}
              </text>
            </g>
          );
        })}

        {m.segs.map((s) => (
          <SegMark key={s.id} s={s} m={m} g={g} o={o} labelMax={labelMax} denseMax={denseMax} compact={compact} hot={hl === `seg:${s.kind}`} />
        ))}

        {m.segs.map((s) => {
          if (s.status !== 'flight') return null;
          const L = segLine(g, m, s);
          const color = segColor(s);
          const can = clickable.has(s.kind) || (s.kind === 'wupd' && clickable.has('ack'));
          return (
            <g key={`h${s.id}`} className={can && !sim.frozen ? stage.clickable : undefined} onClick={can ? () => onSegClick(s.id) : undefined}>
              {can && <circle cx={L.hx} cy={L.hy} r={15} fill="transparent" />}
              {can && !sim.frozen && <circle cx={L.hx} cy={L.hy} r={9.5} fill="none" stroke="var(--accent)" strokeWidth={1.2} className={css.invite} />}
              <circle cx={L.hx} cy={L.hy} r={11} fill={color} opacity={0.14} />
              <circle cx={L.hx} cy={L.hy} r={s.len > 0 || s.kind === 'syn' || s.kind === 'synack' || s.kind === 'fin' ? 4.8 : 3.8} fill={color} />
            </g>
          );
        })}

        <Playhead g={g} m={m} w={sim.w} />
      </g>

      {o.inspect && <Leader m={m} g={g} />}

      <ActorHeader box={hc} title={compact ? CLIENT.short : CLIENT.name} sub={`${CLIENT.ip}:${CLIENT.port}`} state={m.cState} glow={hl === 'client'} accent={SIG.pink} />
      <ActorHeader box={hs} title={SERVER.name} sub={`${SERVER.ip}:${SERVER.port}`} state={m.sState} glow={hl === 'server'} accent={SIG.hc} />
    </g>
  );
}

function SegMark({ s, m, g, o, labelMax, denseMax, compact, hot }: { s: Seg; m: TcpModel; g: SeqGeom; o: SeqOpts; labelMax: number; denseMax: number; compact: boolean; hot: boolean }) {
  const L = segLine(g, m, s);
  if (L.y1 > g.bottom + 30 || Math.max(L.y1, L.hy) < g.top - 40) return null;
  const color = segColor(s);
  const lost = s.status === 'lost';
  const done = s.status === 'done';
  const ang = Math.atan2(L.y2 - L.y1, L.x2 - L.x1);
  const size = compact ? 9.5 : 10.5;
  const dir = L.x2 > L.x1 ? 1 : -1;
  const slope = (L.y2 - L.y1) / Math.max(1, Math.abs(L.x2 - L.x1));
  // Control segments are sparse: caption at the middle, like an RFC drawing.
  // Data and its ACKs come in dense runs: caption near the start, where runs
  // from the same side stack neatly without crossing the other side's.
  const sparse = s.kind === 'syn' || s.kind === 'synack' || s.kind === 'fin' || s.kind === 'probe' || (s.kind === 'ack' && s.from === 'c');
  const budget = sparse ? labelMax : denseMax;
  const options = segTexts(m, s, o);
  const text = options.find((t) => textW(t, size) <= budget) ?? options[options.length - 1];
  const lx = sparse ? (L.x1 + L.x2) / 2 : L.x1 + dir * 12;
  const ly = sparse ? (L.y1 + L.y2) / 2 - 7 : L.y1 + slope * 12 - 6;
  const anchor = sparse ? 'middle' : dir > 0 ? 'start' : 'end';
  const labelColor = s.conceal ? SIG.warn : color;
  return (
    <g opacity={lost ? 0.9 : 1}>
      <line x1={L.x1} y1={L.y1} x2={L.hx} y2={L.hy} stroke={color} strokeWidth={hot ? 2.4 : s.len > 0 ? 1.7 : 1.4} strokeDasharray={lost ? '4 4' : undefined} strokeLinecap="round" opacity={0.92} />
      {done && (
        <polyline
          points={`${L.x2 - 8 * Math.cos(ang - 0.42)},${L.y2 - 8 * Math.sin(ang - 0.42)} ${L.x2},${L.y2} ${L.x2 - 8 * Math.cos(ang + 0.42)},${L.y2 - 8 * Math.sin(ang + 0.42)}`}
          fill="none"
          stroke={color}
          strokeWidth={1.6}
          strokeLinejoin="round"
        />
      )}
      {lost && (
        <g transform={`translate(${L.hx},${L.hy})`} stroke={SIG.err} strokeWidth={2.2} strokeLinecap="round" className={css.popIn}>
          <line x1={-5.5} y1={-5.5} x2={5.5} y2={5.5} />
          <line x1={-5.5} y1={5.5} x2={5.5} y2={-5.5} />
        </g>
      )}
      <Halo x={lx} y={ly} text={text} color={labelColor} anchor={anchor} size={size} />
    </g>
  );
}

/** Marks the segment the header card describes. */
function Leader({ m, g }: { m: TcpModel; g: SeqGeom }) {
  const s = featuredSeg(m);
  if (!s) return null;
  const L = segLine(g, m, s);
  const px = s.status === 'done' ? L.x2 : L.hx;
  const py = s.status === 'done' ? L.y2 : L.hy;
  if (py < g.top || py > g.bottom) return null;
  return <circle cx={px} cy={py} r={8} fill="none" stroke="var(--accent)" strokeWidth={1.3} strokeDasharray="3 2.5" opacity={0.9} />;
}

function Skip({ xc, xs, y0, y1, ms }: { xc: number; xs: number; y0: number; y1: number; ms: number }) {
  if (y1 - y0 < 4) return null;
  const mid = (y0 + y1) / 2;
  const zig = (x: number) => {
    const pts: string[] = [];
    const n = Math.max(2, Math.floor((y1 - y0) / 7));
    for (let i = 0; i <= n; i++) pts.push(`${x + (i % 2 ? 5 : -5)},${y0 + ((y1 - y0) * i) / n}`);
    return pts.join(' ');
  };
  const text = ms < 0 ? 'fast-forwarding…' : `⏩ ${fmtMs(ms)} later`;
  const tw = textW(text, 9.5) + 16;
  return (
    <g>
      <rect x={xc} y={y0} width={xs - xc} height={y1 - y0} fill="url(#kit-hatch-dim)" opacity={0.8} />
      <polyline points={zig(xc)} fill="none" stroke="rgba(143,166,201,0.55)" strokeWidth={1.2} />
      <polyline points={zig(xs)} fill="none" stroke="rgba(143,166,201,0.55)" strokeWidth={1.2} />
      <rect x={(xc + xs) / 2 - tw / 2} y={mid - 9} width={tw} height={18} rx={9} fill="rgba(7,11,20,0.95)" stroke="rgba(143,166,201,0.4)" />
      <text x={(xc + xs) / 2} y={mid + 3.5} textAnchor="middle" style={{ fontFamily: MONO, fontSize: 9.5, fill: SIG.text2 }}>
        {text}
      </text>
    </g>
  );
}

function RttBracket({ m, g }: { m: TcpModel; g: SeqGeom }) {
  const syns = m.segs.filter((s) => s.kind === 'syn' && s.status !== 'lost');
  const syn = syns[syns.length - 1];
  const est = m.notes.find((n) => n.side === 'c' && n.text === 'ESTABLISHED');
  if (!syn || !est) return null;
  const y0 = g.yMs(syn.sent);
  const y1 = g.yMs(est.ms);
  const x = g.xc - 104;
  return (
    <g className={css.noteIn}>
      <path d={`M${x + 6},${y0} H${x} V${y1} H${x + 6}`} fill="none" stroke={SIG.warn} strokeWidth={1.3} />
      <Halo x={x - 7} y={(y0 + y1) / 2 - 2} text="1 RTT" color={SIG.warn} anchor="end" size={10} />
      <Halo x={x - 7} y={(y0 + y1) / 2 + 11} text={fmtMs(est.ms - syn.sent)} color={SIG.text2} anchor="end" size={9} weight={400} />
    </g>
  );
}

function Playhead({ g, m, w }: { g: SeqGeom; m: TcpModel; w: number }) {
  const y = g.yMs(m.now);
  if (y < g.top || y > g.bottom) return null;
  return (
    <g>
      <line x1={12} y1={y} x2={w - 12} y2={y} stroke="rgba(255,210,63,0.26)" strokeDasharray="2 5" />
      <text x={14} y={y - 5} style={{ fontFamily: MONO, fontSize: 9.5, fill: 'rgba(255,210,63,0.75)' }}>
        {fmtMs(m.now)}
      </text>
    </g>
  );
}

/* ------------------------------------------------------------------ */
/* The sender's window: a strip of segments over the byte stream        */
/* ------------------------------------------------------------------ */

type BlockState = 'acked' | 'flight' | 'rtx' | 'lost' | 'sacked' | 'usable' | 'blocked' | 'plain';

function blockStyle(st: BlockState): { fill: string; stroke: string; dash?: string; hatch?: boolean } {
  switch (st) {
    case 'acked':
      return { fill: 'rgba(75,227,160,0.2)', stroke: 'rgba(75,227,160,0.55)' };
    case 'flight':
      return { fill: 'rgba(69,213,255,0.62)', stroke: SIG.req };
    case 'rtx':
      return { fill: 'rgba(255,154,60,0.62)', stroke: SIG.heavy };
    case 'lost':
      return { fill: 'rgba(255,77,106,0.12)', stroke: SIG.err, dash: '3 2' };
    case 'sacked':
      return { fill: 'rgba(69,213,255,0.16)', stroke: SIG.req };
    case 'usable':
      return { fill: 'rgba(255,210,63,0.07)', stroke: 'rgba(255,210,63,0.8)', dash: '3 2' };
    case 'blocked':
      return { fill: 'rgba(143,166,201,0.04)', stroke: 'rgba(143,166,201,0.22)', hatch: true };
    default:
      return { fill: 'rgba(143,166,201,0.04)', stroke: 'rgba(143,166,201,0.25)' };
  }
}

export function windowText(m: TcpModel, compact: boolean): string {
  const rw = m.rwndSegs();
  if (m.cfg.cc === 'none') {
    if (rw < m.cfg.fixedWnd) return compact ? `window = rwnd = ${rw}` : `window = rwnd = ${rw * m.cfg.mss} B`;
    return compact ? `window ${m.cfg.fixedWnd} segments` : `window: ${m.cfg.fixedWnd} segments`;
  }
  const cw = m.wnd();
  const eff = Math.min(cw, rw);
  return compact ? `min(cwnd ${cw}, rwnd ${rw}) = ${eff}` : `window = min(cwnd ${cw}, rwnd ${rw}) = ${eff} segments`;
}

export function SendStrip({ sim, m, box, window, labels, glow }: { sim: TcpSim; m: TcpModel; box: Box; window: boolean; labels: 'bytes' | 'regions'; glow?: boolean }) {
  const compact = sim.orient === 'portrait' || box.w < 420;
  const x0 = box.x - box.w / 2;
  const y0 = box.y - box.h / 2;
  const total = m.cfg.total;
  const finite = Number.isFinite(total);
  const wnd = m.cfg.cc === 'none' ? Math.min(m.cfg.fixedWnd, m.rwndSegs()) : Math.min(m.wnd(), m.rwndSegs());
  const minPitch = compact ? 22 : 30;
  let count = Math.max(8, Math.floor(box.w / minPitch));
  if (finite && total <= count) count = total;
  const need = Math.min(64, Math.max(count, wnd + 8));
  const n = labels === 'regions' ? Math.max(count, need) : count;
  const pitch = box.w / n;
  const bw = Math.max(3, pitch - (pitch > 14 ? 3 : 1.5));
  const start = finite && total <= n ? 0 : sim.stripOff;
  const first = Math.floor(start);
  const shift = (start - first) * pitch;
  const by = y0 + 22;
  const bh = compact ? 17 : 21;
  const clip = `tcp-strip-${box.id}`;

  const stateOf = (i: number): BlockState => {
    if (i < m.una) return 'acked';
    if (i < m.nxt) {
      if (m.lost.has(i)) return 'lost';
      if (m.sacked.has(i)) return 'sacked';
      const rtx = m.segs.some((s) => s.kind === 'data' && s.idx === i && s.rtx && s.status === 'flight');
      return rtx ? 'rtx' : 'flight';
    }
    if (!window) return 'plain';
    return i < m.una + wnd ? 'usable' : 'blocked';
  };

  const blocks: { i: number; x: number; st: BlockState }[] = [];
  for (let k = 0; k <= n; k++) {
    const i = first + k;
    if (finite && i >= total) break;
    blocks.push({ i, x: x0 + k * pitch - shift, st: stateOf(i) });
  }

  // Very thin blocks read better as solid runs of one state.
  const dense = pitch < 11;
  const runs: { st: BlockState; x0: number; x1: number }[] = [];
  for (const b of blocks) {
    const last = runs[runs.length - 1];
    if (last && last.st === b.st) last.x1 = b.x + pitch;
    else runs.push({ st: b.st, x0: b.x, x1: b.x + pitch });
  }

  // Region labels under contiguous runs of the same state.
  const regions: { st: BlockState; x0: number; x1: number }[] = [];
  for (const b of blocks) {
    const key: BlockState = b.st === 'rtx' || b.st === 'lost' || b.st === 'sacked' ? 'flight' : b.st;
    const last = regions[regions.length - 1];
    if (last && last.st === key) last.x1 = b.x + bw;
    else regions.push({ st: key, x0: b.x, x1: b.x + bw });
  }
  const REGION_TEXT: Partial<Record<BlockState, string>> = { acked: 'acked', flight: 'in flight', usable: 'can send now', blocked: 'not yet allowed' };

  const wx0 = x0 + (m.una - start) * pitch;
  const wx1 = x0 + (m.una + wnd - start) * pitch - (pitch - bw);

  return (
    <g opacity={box.alpha}>
      <defs>
        <clipPath id={clip}>
          <rect x={x0 - 1} y={y0} width={box.w + 2} height={box.h} />
        </clipPath>
      </defs>
      {glow && <rect x={x0 - 8} y={y0 - 6} width={box.w + 16} height={box.h + 8} rx={10} fill="none" stroke="var(--accent)" strokeWidth={1.4} strokeDasharray="3 3" />}
      <text className={stage.caps} x={x0} y={y0 + 9}>
        {compact || window ? 'Alice · send window' : 'Alice · sender’s view of the byte stream'}
      </text>
      {window && (
        <text x={x0 + box.w} y={y0 + 9} textAnchor="end" style={{ fontFamily: MONO, fontSize: compact ? 9 : 10, fill: SIG.warn }}>
          {windowText(m, compact)}
        </text>
      )}
      <g clipPath={`url(#${clip})`}>
        {dense &&
          runs.map((r, k) => {
            const s = blockStyle(r.st);
            const w = Math.max(2, r.x1 - r.x0 - 1.5);
            return (
              <g key={`r${k}`}>
                <rect x={r.x0} y={by} width={w} height={bh} rx={2.5} fill={s.fill} stroke={s.stroke} strokeWidth={1} strokeDasharray={s.dash} />
                {s.hatch && <rect x={r.x0} y={by} width={w} height={bh} rx={2.5} fill="url(#kit-hatch-dim)" />}
              </g>
            );
          })}
        {!dense && blocks.map((b) => {
          const s = blockStyle(b.st);
          return (
            <g key={b.i}>
              <rect x={b.x} y={by} width={bw} height={bh} rx={2.5} fill={s.fill} stroke={s.stroke} strokeWidth={1} strokeDasharray={s.dash} />
              {s.hatch && <rect x={b.x} y={by} width={bw} height={bh} rx={2.5} fill="url(#kit-hatch-dim)" />}
              {b.st === 'sacked' && <path d={`M${b.x + bw / 2 - 3},${by + bh / 2} l2.5,2.5 l4,-5`} fill="none" stroke={SIG.req} strokeWidth={1.3} />}
              {b.st === 'lost' && bw > 10 && (
                <text x={b.x + bw / 2} y={by + bh / 2 + 3.5} textAnchor="middle" style={{ fontFamily: MONO, fontSize: 9, fill: SIG.err }}>
                  ?
                </text>
              )}
              {labels === 'bytes' && (pitch >= 34 || b.i % 2 === 0) && (
                <text x={b.x + 1} y={by + bh + 11} style={{ fontFamily: MONO, fontSize: compact ? 8.5 : 9, fill: b.st === 'acked' ? 'rgba(169,182,204,0.55)' : SIG.text2 }}>
                  {m.segSeq(b.i)}
                </text>
              )}
            </g>
          );
        })}
        {labels === 'regions' &&
          regions.map((r, k) => {
            const t = REGION_TEXT[r.st];
            if (!t || r.x1 - r.x0 < textW(t, 9) + 6) return null;
            const color = r.st === 'acked' ? SIG.res : r.st === 'flight' ? SIG.req : r.st === 'usable' ? SIG.warn : SIG.dim;
            return (
              <text key={k} x={(Math.max(r.x0, x0) + Math.min(r.x1, x0 + box.w)) / 2} y={by + bh + 12} textAnchor="middle" style={{ fontFamily: MONO, fontSize: 9, fill: color }}>
                {t}
              </text>
            );
          })}
      </g>
      {window && wx1 > wx0 && (
        <g>
          <path d={`M${clamp(wx0, x0, x0 + box.w)},${by - 3} V${by - 7} H${clamp(wx1, x0, x0 + box.w)} V${by - 3}`} fill="none" stroke={SIG.warn} strokeWidth={1.2} />
        </g>
      )}
    </g>
  );
}

/* ------------------------------------------------------------------ */
/* The receiver's buffer                                                */
/* ------------------------------------------------------------------ */

export function RecvBuffer({ sim, m, box, glow }: { sim: TcpSim; m: TcpModel; box: Box; glow?: boolean }) {
  const compact = sim.orient === 'portrait' || box.w < 420;
  const x0 = box.x - box.w / 2;
  const y0 = box.y - box.h / 2;
  const n = m.cfg.rbuf;
  const appW = compact ? 44 : 52;
  const pitch = (box.w - appW - 8) / n;
  const bw = pitch - 3;
  const bx0 = x0 + appW + 8;
  const by = y0 + 22;
  const bh = compact ? 17 : 21;
  const start = sim.rbufOff;
  const first = Math.floor(start);
  const shift = (start - first) * pitch;
  const clip = 'tcp-rbuf-clip';
  const maxOoo = m.ooo.size ? Math.max(...m.ooo) : -1;
  const win = m.advWin();
  const stalled = m.appStalled;
  const rate = m.cfg.appRate;

  const cells: { i: number; x: number; st: 'unread' | 'ooo' | 'hole' | 'free' }[] = [];
  for (let k = 0; k <= n; k++) {
    const i = first + k;
    const x = bx0 + k * pitch - shift;
    let st: 'unread' | 'ooo' | 'hole' | 'free' = 'free';
    if (i < m.appRead) continue;
    if (i < m.rcvNxt) st = 'unread';
    else if (m.ooo.has(i)) st = 'ooo';
    else if (i < maxOoo) st = 'hole';
    cells.push({ i, x, st });
  }
  const freeFrom = bx0 + (m.rcvNxt - start) * pitch;
  const freeTo = bx0 + n * pitch - 3;

  return (
    <g opacity={box.alpha}>
      <defs>
        <clipPath id={clip}>
          <rect x={bx0 - 1} y={y0} width={n * pitch + 1} height={box.h} />
        </clipPath>
      </defs>
      {glow && <rect x={x0 - 8} y={y0 - 6} width={box.w + 16} height={box.h + 8} rx={10} fill="none" stroke="var(--accent)" strokeWidth={1.4} strokeDasharray="3 3" />}
      <text className={stage.caps} x={x0} y={y0 + 9}>
        {compact ? 'server · receive buffer' : `server · receive buffer · ${n} segments`}
      </text>
      <text x={x0 + box.w} y={y0 + 9} textAnchor="end" style={{ fontFamily: MONO, fontSize: compact ? 9 : 10, fill: win === 0 ? SIG.err : SIG.hc }}>
        {win === 0 ? 'rwnd = 0' : `rwnd = ${win} B`}
      </text>

      <g transform={`translate(${x0},${by})`}>
        <rect width={appW} height={bh} rx={4} fill={stalled ? 'rgba(255,77,106,0.1)' : 'rgba(181,155,255,0.1)'} stroke={stalled ? SIG.err : SIG.hc} strokeOpacity={0.7} />
        <text x={appW / 2} y={bh / 2 + 3.5} textAnchor="middle" style={{ fontFamily: MONO, fontSize: 9, fill: stalled ? SIG.err : SIG.hc, letterSpacing: '0.06em' }}>
          {stalled ? 'APP ❚❚' : 'APP'}
        </text>
        <path d={`M${appW + 7},${bh / 2} h-5 m2.5,-2.5 l-2.5,2.5 l2.5,2.5`} fill="none" stroke={stalled ? SIG.err : SIG.hc} strokeWidth={1.1} />
      </g>
      <text x={x0} y={by + bh + 12} style={{ fontFamily: MONO, fontSize: 8.5, fill: stalled ? SIG.err : SIG.text2 }}>
        {stalled ? 'stalled' : Number.isFinite(rate) ? `reads ${rate}/s` : 'reads at once'}
      </text>

      <g clipPath={`url(#${clip})`}>
        {cells.map((c) => {
          const st = c.st;
          const fill = st === 'unread' ? 'rgba(75,227,160,0.55)' : st === 'ooo' ? 'rgba(69,213,255,0.55)' : st === 'hole' ? 'rgba(255,77,106,0.08)' : 'rgba(181,155,255,0.05)';
          const stroke = st === 'unread' ? SIG.res : st === 'ooo' ? SIG.req : st === 'hole' ? SIG.err : 'rgba(181,155,255,0.45)';
          return (
            <g key={c.i}>
              <rect x={c.x} y={by} width={bw} height={bh} rx={2.5} fill={fill} stroke={stroke} strokeDasharray={st === 'hole' || st === 'free' ? '3 2' : undefined} />
              {st === 'hole' && (
                <text x={c.x + bw / 2} y={by + bh / 2 + 3.5} textAnchor="middle" style={{ fontFamily: MONO, fontSize: 10, fill: SIG.err }}>
                  ?
                </text>
              )}
              {(st === 'unread' || st === 'ooo') && pitch >= 34 && (
                <text x={c.x + bw / 2} y={by + bh / 2 + 3} textAnchor="middle" style={{ fontFamily: MONO, fontSize: 8, fill: 'rgba(5,8,15,0.8)' }}>
                  {m.segSeq(c.i)}
                </text>
              )}
            </g>
          );
        })}
      </g>
      {freeTo - freeFrom > 8 && (
        <g>
          <path d={`M${Math.max(bx0, freeFrom)},${by + bh + 3} V${by + bh + 7} H${freeTo} V${by + bh + 3}`} fill="none" stroke={SIG.hc} strokeWidth={1.1} />
          {freeTo - Math.max(bx0, freeFrom) > 70 && (
            <text x={(Math.max(bx0, freeFrom) + freeTo) / 2} y={by + bh + 17} textAnchor="middle" style={{ fontFamily: MONO, fontSize: 8.5, fill: SIG.hc }}>
              free space = rwnd
            </text>
          )}
        </g>
      )}
    </g>
  );
}
