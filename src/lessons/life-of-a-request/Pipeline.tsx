import type { ReactNode } from 'react';
import { SIG } from '@/lib/sim/colors';
import kit from '@/components/stage/stage.module.css';
import { PH } from './journey';
import type { JourneySim } from './sim';

const MONO = 'var(--font-mono)';

type Status = 'wait' | 'active' | 'done' | 'blocked';

interface Line {
  t: string;
  d?: number;
  at?: number;
  tag?: 'css' | 'js';
  dim?: boolean;
  bad?: boolean;
}

const DOM_LINES = (blocking: boolean): Line[] => [
  { t: 'html', d: 0, at: 0.02 },
  { t: 'head', d: 1, at: 0.08 },
  { t: 'link href=app.css', d: 2, at: 0.18, tag: 'css' },
  { t: blocking ? 'script src=app.js' : 'script src=app.js defer', d: 2, at: 0.24, tag: 'js' },
  { t: 'body', d: 1, at: 0.36 },
  { t: 'header', d: 2, at: 0.46 },
  { t: 'h1 "Your cart"', d: 2, at: 0.56 },
  { t: 'ul.items › li × 2', d: 2, at: 0.7 },
  { t: 'div.promo', d: 2, at: 0.82 },
  { t: 'button.btn "Checkout"', d: 2, at: 0.93 },
];

const CSS_LINES: Line[] = [
  { t: 'body      { font: 15px sans-serif }' },
  { t: 'header    { background: #16223b }' },
  { t: 'h1        { font-size: 24px }' },
  { t: '.items li { display: flex }' },
  { t: '.promo    { display: none }' },
  { t: '.btn      { background: #FFD23F }' },
];

const TREE_LINES: Line[] = [{ t: 'body' }, { t: '  header' }, { t: '  h1' }, { t: '  li · li' }, { t: '  button.btn' }, { t: 'skipped: head, .promo', dim: true }];
const LAYOUT_LINES: Line[] = [{ t: 'header 0,0    320×40' }, { t: 'h1     16,56  180×28' }, { t: 'li     16,98  288×48' }, { t: 'li     16,156 288×48' }, { t: 'btn    16,246 288×38' }];
const PAINT_LINES: Line[] = [{ t: 'fill   header #16223b' }, { t: 'text   "Your cart"' }, { t: 'text   "Trail boots" …' }, { t: 'fill   .btn #FFD23F' }, { t: 'text   "Checkout"' }];

function statusText(s: Status) {
  return s === 'done' ? 'done ✓' : s === 'active' ? 'building…' : s === 'blocked' ? 'paused' : 'waiting';
}

function Card({
  x,
  y,
  w,
  h,
  title,
  status,
  color,
  k,
  lines,
  reveal = 1,
  children,
  glow,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  status: Status;
  color: string;
  k: number;
  lines?: Line[];
  reveal?: number;
  children?: ReactNode;
  glow?: boolean;
}) {
  const stroke = status === 'active' ? color : status === 'done' ? 'rgba(75,227,160,0.6)' : status === 'blocked' ? SIG.err : 'rgba(143,166,201,0.32)';
  const stColor = status === 'done' ? SIG.res : status === 'active' ? color : status === 'blocked' ? SIG.err : SIG.dim;
  const lh = 12.5;
  return (
    <g transform={`translate(${x},${y})`}>
      {glow && <rect x={-5} y={-5} width={w + 10} height={h + 10} rx={12} fill="none" stroke="var(--accent)" strokeWidth={1.3} strokeDasharray="3 3" />}
      <rect className={kit.card} width={w} height={h} rx={9} style={{ stroke }} />
      <text className={kit.caps} x={10} y={16} style={{ fill: status === 'wait' ? SIG.dim : SIG.text }}>
        {title}
      </text>
      <text x={w - 10} y={16} textAnchor="end" style={{ fontFamily: MONO, fontSize: 9, fill: stColor }}>
        {statusText(status)}
      </text>
      <line x1={8} y1={23} x2={w - 8} y2={23} stroke="rgba(143,166,201,0.14)" />
      {lines?.map((l, i) => {
        const on = l.at == null ? i < Math.ceil(reveal * lines.length) : reveal >= l.at;
        if (!on) return null;
        return (
          <text key={i} x={10 + (l.d ?? 0) * 11} y={37 + i * lh} style={{ fontFamily: MONO, fontSize: 9.5, fill: l.bad ? '#ffb3c0' : l.dim ? SIG.dim : status === 'wait' ? SIG.text2 : SIG.text, whiteSpace: 'pre' }}>
            {(l.d ?? 0) > 0 ? '· ' : ''}
            {l.t}
          </text>
        );
      })}
      {children}
      {status === 'active' && (
        <g>
          <rect x={8} y={h - 7} width={w - 16} height={3} rx={1.5} fill="rgba(143,166,201,0.15)" />
          <rect x={8} y={h - 7} width={Math.max(2, (w - 16) * k)} height={3} rx={1.5} fill={color} />
        </g>
      )}
    </g>
  );
}

function Chip({ x, y, text, color }: { x: number; y: number; text: string; color: string }) {
  const w = text.length * 5.3 + 10;
  return (
    <g transform={`translate(${x},${y})`}>
      <rect x={0} y={-9} width={w} height={12} rx={6} fill="rgba(7,11,20,0.9)" stroke={color} strokeOpacity={0.7} />
      <text x={w / 2} y={0.5} textAnchor="middle" style={{ fontFamily: MONO, fontSize: 8, fill: color }}>
        {text}
      </text>
    </g>
  );
}

/** The rendering pipeline: bytes → DOM + CSSOM → render tree → layout → paint → composite. */
export function Pipeline({ sim, glow }: { sim: JourneySim; glow?: string | null }) {
  const b = sim.boxes.get('browser');
  if (!b || Number.isNaN(b.x)) return null;
  const st = sim.renderStages();
  const blocking = sim.j.cfg.script === 'blocking';
  const land = sim.orient === 'landscape';
  const x0 = b.tx + b.w / 2 + (land ? 26 : 10);
  const x1 = sim.band.x + sim.band.w;
  const y0 = sim.band.y + (land ? 2 : 2);
  const y1 = sim.band.y + sim.band.h;

  const domStatus: Status = st.blocked ? 'blocked' : st.parse >= 1 ? 'done' : st.parse > 0 ? 'active' : 'wait';
  const cssStatus: Status = st.cssArrived ? (st.cssK >= 1 ? 'done' : 'active') : 'wait';
  const s = (k: number): Status => (k >= 1 ? 'done' : k > 0 ? 'active' : 'wait');
  const treeK = st.style;
  const cssChip = st.cssArrived ? { t: 'loaded', c: SIG.res } : st.requested ? { t: 'downloading…', c: SIG.req } : null;
  const jsChip = st.jsDone
    ? { t: 'ran', c: SIG.res }
    : st.jsRun
      ? { t: 'running', c: PH.js }
      : st.blocked
        ? { t: 'parser waits', c: SIG.err }
        : st.jsArrived
          ? { t: 'loaded · runs later', c: SIG.res }
          : st.requested
            ? { t: 'downloading…', c: SIG.req }
            : null;

  if (!land) {
    // Phone: a compact column of stages.
    const rows: { title: string; status: Status; color: string; k: number; text: string }[] = [
      { title: 'DOM', status: domStatus, color: PH.parse, k: st.parse, text: st.blocked ? 'paused at <script>' : `${Math.round(st.parse * 11)} of 11 nodes` },
      { title: 'CSSOM', status: cssStatus, color: PH.parse, k: st.cssK, text: st.cssArrived ? '6 rules' : 'waiting for app.css' },
      { title: 'Render tree', status: s(treeK), color: PH.render, k: treeK, text: 'visible nodes + styles' },
      { title: 'Layout', status: s(st.layout), color: PH.render, k: st.layout, text: 'x, y, width, height' },
      { title: 'Paint', status: s(st.paint), color: PH.render, k: st.paint, text: 'draw commands' },
      { title: 'Composite', status: s(st.composite), color: PH.render, k: st.composite, text: 'layers → screen' },
    ];
    const gap = 5;
    const rh = (y1 - y0 - gap * (rows.length - 1)) / rows.length;
    const w = x1 - x0;
    return (
      <g>
        {rows.map((r, i) => (
          <g key={r.title}>
            <Card x={x0} y={y0 + i * (rh + gap)} w={w} h={rh} title={r.title} status={r.status} color={r.color} k={r.k} glow={glow === r.title.toLowerCase()}>
              <text x={10} y={Math.min(rh - 11, 36)} style={{ fontFamily: MONO, fontSize: 9, fill: r.status === 'blocked' ? '#ffb3c0' : SIG.text2 }}>
                {r.text}
              </text>
            </Card>
          </g>
        ))}
      </g>
    );
  }

  const W = x1 - x0;
  const topH = Math.min(172, (y1 - y0) * 0.5);
  const gapY = 30;
  const botY = y0 + topH + gapY;
  const botH = y1 - botY;
  const halfW = (W - 14) / 2;
  const cw = (W - 3 * 12) / 4;
  const cx = (i: number) => x0 + i * (cw + 12);
  const busY = y0 + topH + gapY / 2;
  const treeTop = { x: cx(0) + cw / 2, y: botY };
  const conn = (fx: number, color: string, on: boolean) => (
    <path d={`M${fx},${y0 + topH} V${busY} H${treeTop.x} V${treeTop.y}`} fill="none" stroke={on ? color : 'rgba(143,166,201,0.3)'} strokeWidth={1.3} strokeDasharray={on ? undefined : '3 4'} />
  );
  const arrow = (i: number, on: boolean) => {
    const ax = cx(i) + cw;
    const ay = botY + botH / 2;
    const c = on ? PH.render : 'rgba(143,166,201,0.35)';
    return (
      <g key={`a${i}`} stroke={c} strokeWidth={1.3} fill="none">
        <line x1={ax + 1} y1={ay} x2={ax + 11} y2={ay} />
        <polyline points={`${ax + 7},${ay - 3} ${ax + 11},${ay} ${ax + 7},${ay + 3}`} />
      </g>
    );
  };
  const layerOff = (1 - st.composite) * 7;
  return (
    <g>
      {conn(x0 + halfW / 2, PH.parse, st.parse >= 1)}
      {conn(x0 + halfW + 14 + halfW / 2, PH.parse, st.cssArrived)}
      <Card x={x0} y={y0} w={halfW} h={topH} title="DOM · from HTML" status={domStatus} color={PH.parse} k={st.parse} lines={DOM_LINES(blocking)} reveal={st.parse} glow={glow === 'dom'}>
        {st.parse >= 0.18 && cssChip && <Chip x={Math.min(halfW - 92, 150)} y={37 + 2 * 12.5} text={cssChip.t} color={cssChip.c} />}
        {st.parse >= 0.24 && jsChip && <Chip x={Math.min(halfW - (jsChip.t.length * 5.3 + 14), blocking ? 150 : 180)} y={37 + 3 * 12.5} text={jsChip.t} color={jsChip.c} />}
      </Card>
      <Card
        x={x0 + halfW + 14}
        y={y0}
        w={halfW}
        h={topH}
        title="CSSOM · from app.css"
        status={cssStatus}
        color={PH.parse}
        k={st.cssK}
        lines={st.cssArrived ? CSS_LINES : [{ t: 'waiting for app.css…' }, { t: '' }, { t: 'render-blocking: nothing can', dim: true }, { t: 'be painted without it', dim: true }]}
        reveal={st.cssArrived ? Math.max(0.01, st.cssK) : 1}
        glow={glow === 'cssom'}
      />
      <Card x={cx(0)} y={botY} w={cw} h={botH} title="Render tree" status={s(treeK)} color={PH.render} k={treeK} lines={TREE_LINES} reveal={treeK} glow={glow === 'render tree'} />
      {arrow(0, st.layout > 0)}
      <Card x={cx(1)} y={botY} w={cw} h={botH} title="Layout" status={s(st.layout)} color={PH.render} k={st.layout} lines={LAYOUT_LINES} reveal={st.layout} glow={glow === 'layout'} />
      {arrow(1, st.paint > 0)}
      <Card x={cx(2)} y={botY} w={cw} h={botH} title="Paint" status={s(st.paint)} color={PH.render} k={st.paint} lines={PAINT_LINES} reveal={st.paint} glow={glow === 'paint'} />
      {arrow(2, st.composite > 0)}
      <Card x={cx(3)} y={botY} w={cw} h={botH} title="Composite" status={s(st.composite)} color={PH.render} k={st.composite} glow={glow === 'composite'}>
        <g transform={`translate(${cw / 2 - 34},${34})`} opacity={st.paint > 0 ? 1 : 0.35}>
          <rect x={layerOff} y={layerOff} width={60} height={46} rx={3} fill="rgba(147,165,255,0.12)" stroke={PH.parse} strokeOpacity={0.7} />
          <rect x={-layerOff} y={-layerOff} width={60} height={12} rx={2} fill="rgba(22,34,59,0.95)" stroke={PH.render} strokeOpacity={0.8} />
          <text x={30} y={62} textAnchor="middle" style={{ fontFamily: MONO, fontSize: 8.5, fill: SIG.text2 }}>
            {st.composite >= 1 ? '1 frame on screen' : '2 layers → GPU'}
          </text>
        </g>
      </Card>
    </g>
  );
}
