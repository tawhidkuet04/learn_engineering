'use client';

import { SequenceDiagram } from '@/components/stage/SequenceDiagram';
import { Cylinder, Effects, Flights, NodeCard, Wires } from '@/components/stage/svg';
import { SIG } from '@/lib/sim/colors';
import { clamp } from '@/lib/sim/geometry';
import type { Box } from '@/lib/sim/Sim';
import { shardColor, shardId, type DbNode, type ShardSim } from './sim';
import css from './sharding.module.css';

/* ------------------------------------------------------------------ */
/* Glyphs drawn inside node cards (centered on 0,0)                    */
/* ------------------------------------------------------------------ */

function SplitGlyph() {
  return (
    <g className={css.glyph}>
      <path d="M-9,0 H-3" />
      <path d="M-3,0 C1,0 1,-7 6,-7 H9" />
      <path d="M-3,0 C1,0 1,-2.4 6,-2.4 H9" />
      <path d="M-3,0 C1,0 1,2.4 6,2.4 H9" />
      <path d="M-3,0 C1,0 1,7 6,7 H9" />
      <circle cx={-9} cy={0} r={1.8} className={css.glyphDot} />
    </g>
  );
}

function StackGlyph() {
  return (
    <g className={css.glyph}>
      <rect x={-8} y={-8} width={16} height={4.4} rx={1.2} />
      <rect x={-8} y={-2.2} width={16} height={4.4} rx={1.2} />
      <rect x={-8} y={3.6} width={16} height={4.4} rx={1.2} />
    </g>
  );
}

function TableGlyph() {
  return (
    <g className={css.glyphViolet}>
      <rect x={-8} y={-7} width={16} height={14} rx={2} />
      <path d="M-8,-2.4 H8 M-8,2.4 H8 M-1.5,-7 V7" />
    </g>
  );
}

function MapGlyph() {
  return (
    <g className={css.glyphViolet}>
      <circle cx={0} cy={0} r={7.5} />
      <path d="M0,-7.5 V7.5 M-7.5,0 H7.5" />
      <circle cx={0} cy={0} r={2.2} className={css.glyphDotViolet} />
    </g>
  );
}

/* ------------------------------------------------------------------ */
/* A database node: cylinder, fill level (disk), load meter, tag       */
/* ------------------------------------------------------------------ */

function loadColor(l: number) {
  if (l >= 1) return SIG.err;
  if (l >= 0.85) return SIG.heavy;
  if (l >= 0.6) return SIG.warn;
  return SIG.res;
}

function titleOf(node: DbNode) {
  if (node.kind === 'db') return 'orders-db';
  if (node.kind === 'primary') return 'primary';
  if (node.kind === 'replica') return `replica-${node.idx}`;
  return `shard-${node.idx}`;
}

function colorOf(node: DbNode) {
  return node.kind === 'shard' ? shardColor(node.idx) : SIG.blue;
}

export function DbNodeView({
  sim,
  node,
  box,
  dim,
  glow,
  pickable,
  onClick,
  tag,
  tagColor,
}: {
  sim: ShardSim;
  node: DbNode;
  box: Box;
  dim?: boolean;
  glow?: boolean;
  pickable?: boolean;
  onClick?: () => void;
  tag?: string;
  tagColor?: string;
}) {
  const w = box.w;
  const h = box.h;
  const narrow = w < 96;
  const tiny = w < 70;
  const ry = Math.min(8, h * 0.14);
  const color = colorOf(node);
  const tiles = sim.cfg.tiles && node.kind === 'shard';
  const fill = clamp(node.shownFill, 0, 100);
  const load = node.shownLoad;
  const over = load >= 1;
  const titleY = ry + (narrow ? 16 : 19);
  const top = ry + (narrow ? 24 : 30);
  const bottom = h - ry;
  const yf = bottom - (bottom - top) * (fill / 100);
  const full = fill >= 90;
  const liquid = full ? SIG.err : color;
  const pulse = over ? 0.45 + 0.4 * Math.sin(sim.vt * 7) : 0;
  const tone = pickable ? SIG.warn : over ? SIG.err : 'rgba(143,166,201,0.6)';
  const q = node.q;
  const qk = q ? clamp((sim.t - q.t0) / q.dur, 0, 1) : 0;
  const meterY = h + 8;
  const loadPct = Math.round(load * 100);

  return (
    <Cylinder box={box} title="" dim={dim} glow={glow} pickable={pickable} onClick={onClick} tone={tone}>
      {/* tag above: the key range / values this node owns (a pill, so wires pass behind it) */}
      {tag && <Tag x={w / 2} y={-13} text={tag} color={tagColor ?? color} small={tag.length > 11 || tiny} maxW={w + 14} />}

      {/* liquid: how full the disk is */}
      {!tiles && fill > 0.2 && (
        <g>
          <path d={`M1,${yf} L1,${bottom} A${w / 2 - 1},${ry} 0 0,0 ${w - 1},${bottom} L${w - 1},${yf} Z`} fill={liquid} opacity={0.17} />
          <ellipse cx={w / 2} cy={yf} rx={w / 2 - 1.5} ry={Math.max(2, ry * 0.85)} fill={liquid} opacity={0.32} stroke={liquid} strokeOpacity={0.7} strokeWidth={1} />
        </g>
      )}

      {/* title and disk use */}
      <text className={css.nodeTitle} x={w / 2} y={titleY} textAnchor="middle" style={narrow ? { fontSize: 10 } : undefined}>
        {titleOf(node)}
      </text>
      {!tiles && (
        <text className={css.nodeSub} x={w / 2} y={titleY + (narrow ? 12 : 14)} textAnchor="middle" style={{ fill: full ? SIG.err : undefined }}>
          {tiny ? `${Math.round(fill)}%` : `disk ${Math.round(fill)}%`}
        </text>
      )}

      {/* sample rows (resharding demos) */}
      {tiles && <Tiles sim={sim} node={node} w={w} top={titleY + 8} />}

      {/* a query being worked on */}
      {q && (
        <g>
          <rect x={8} y={bottom - 9} width={w - 16} height={3} rx={1.5} fill="rgba(143,166,201,0.18)" />
          <rect x={8} y={bottom - 9} width={(w - 16) * qk} height={3} rx={1.5} fill={SIG.req} />
        </g>
      )}

      {/* overload outline */}
      {over && (
        <path
          d={`M0,${ry} A${w / 2},${ry} 0 0,1 ${w},${ry} V${h - ry} A${w / 2},${ry} 0 0,1 0,${h - ry} Z`}
          fill="none"
          stroke={SIG.err}
          strokeWidth={2.2}
          opacity={pulse}
        />
      )}

      {/* load meter under the node: 100% = all the writes this machine can absorb */}
      {tiles ? (
        <text className={css.meterText} x={w / 2} y={meterY + 10} textAnchor="middle">
          {rowsLabel(sim.tiles.filter((t) => t.owner === node.idx && !t.moving).length)}
        </text>
      ) : (
        <g transform={`translate(0,${meterY})`}>
          <rect width={w} height={5} rx={2.5} fill="rgba(143,166,201,0.14)" />
          <rect width={w * Math.min(1, load)} height={5} rx={2.5} fill={loadColor(load)} />
          {over && <path d={`M${w + 2},-3 l4,5.5 l-4,5.5`} fill="none" stroke={SIG.err} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />}
          <text className={css.meterText} x={w / 2} y={17} textAnchor="middle" style={{ fill: over ? SIG.err : load >= 0.85 ? SIG.heavy : undefined }}>
            {narrow ? `${loadPct}%` : node.kind === 'replica' ? `replays ${loadPct}%` : `load ${loadPct}%`}
          </text>
        </g>
      )}
    </Cylinder>
  );
}

const rowsLabel = (n: number) => `${n} ${n === 1 ? 'row' : 'rows'}`;

function Tag({ x, y, text, color, small, maxW }: { x: number; y: number; text: string; color: string; small?: boolean; maxW: number }) {
  const fs = small ? 8.5 : 9.5;
  const tw = Math.min(maxW, text.length * fs * 0.72 + 12);
  return (
    <g transform={`translate(${x},${y})`}>
      <rect x={-tw / 2} y={-8} width={tw} height={15} rx={7.5} fill="rgba(7,11,20,0.94)" stroke={color} strokeOpacity={0.35} />
      <text className={css.tag} x={0} y={3} textAnchor="middle" style={{ fill: color, fontSize: fs }}>
        {text}
      </text>
    </g>
  );
}

function Tiles({ sim, node, w, top }: { sim: ShardSim; node: DbNode; w: number; top: number }) {
  const P = sim.orient === 'portrait';
  const tw = P ? 22 : 25;
  const th = P ? 13 : 15;
  const gap = 3;
  const cols = Math.max(1, Math.floor((w - 10) / (tw + gap)));
  const mine = sim.tiles.filter((t) => t.owner === node.idx && !t.moving);
  const rowW = Math.min(cols, Math.max(1, mine.length)) * (tw + gap) - gap;
  const x0 = (w - rowW) / 2;
  const color = shardColor(node.idx);
  return (
    <g>
      {mine.map((t, i) => {
        const cx = x0 + (i % cols) * (tw + gap);
        const cy = top + Math.floor(i / cols) * (th + gap);
        return (
          <g key={t.h} transform={`translate(${cx},${cy})`}>
            <rect width={tw} height={th} rx={2.5} fill={color} fillOpacity={t.moved ? 0.34 : 0.14} stroke={t.moved ? SIG.warn : color} strokeOpacity={t.moved ? 0.95 : 0.55} strokeWidth={1} />
            <text className={css.tileText} x={tw / 2} y={th / 2 + 3.2} textAnchor="middle" style={{ fill: t.moved ? SIG.warn : color }}>
              {t.h}
            </text>
          </g>
        );
      })}
    </g>
  );
}

/* ------------------------------------------------------------------ */
/* "Together they hold everything" brace                               */
/* ------------------------------------------------------------------ */

function Brace({ sim }: { sim: ShardSim }) {
  const boxes = sim
    .shardNodes()
    .map((n) => sim.boxes.get(n.id))
    .filter((b): b is Box => !!b && !Number.isNaN(b.x));
  if (!boxes.length || sim.orient === 'portrait') return null;
  const x0 = Math.min(...boxes.map((b) => b.x - b.w / 2));
  const x1 = Math.max(...boxes.map((b) => b.x + b.w / 2));
  const y = Math.max(...boxes.map((b) => b.y + b.h / 2)) + 40;
  const a = Math.min(...boxes.map((b) => b.alpha));
  return (
    <g opacity={a}>
      <path d={`M${x0},${y - 6} V${y} H${x1} V${y - 6}`} fill="none" stroke="rgba(255,210,63,0.55)" strokeWidth={1.2} />
      <text className={css.brace} x={(x0 + x1) / 2} y={y + 16} textAnchor="middle">
        together: every row, exactly once
      </text>
    </g>
  );
}

/* ------------------------------------------------------------------ */
/* The whole flow scene                                                */
/* ------------------------------------------------------------------ */

export function Scene({ sim, highlight, focus }: { sim: ShardSim; highlight: string | null; focus?: string[] }) {
  const c = sim.cfg;
  if (c.scene === 'twopc') return <TwoPcScene sim={sim} />;
  const dim = (id: string) => !!focus?.length && !focus.includes(id);
  const glow = (id: string) => highlight === id || (highlight === 'shards' && id.startsWith('s'));
  const stageClick = !!sim.game?.awaitingStageClick;
  const app = sim.boxes.get('app');
  const router = sim.boxes.get('router');
  const dir = sim.boxes.get('dir');
  const cfgBox = sim.boxes.get('cfg');
  const P = sim.orient === 'portrait';

  const nodes = [...sim.nodes.values()].sort((a, b) => (a.kind === 'shard' && b.kind === 'shard' ? a.idx - b.idx : 0));

  return (
    <>
      <Wires sim={sim} />
      {c.brace && <Brace sim={sim} />}
      {app && <NodeCard box={app} title="app servers" sub={P ? undefined : 'shop.example'} icon={<StackGlyph />} dim={dim('app')} glow={glow('app')} />}
      {router && (
        <NodeCard
          box={router}
          title="router"
          sub={c.routerSub}
          icon={<SplitGlyph />}
          dim={dim('router')}
          glow={glow('router')}
          state={sim.game?.pending ? 'hot' : 'normal'}
          tone={SIG.hc}
        />
      )}
      {dir && <NodeCard box={dir} title="directory" sub={P ? 'lookups' : 'tenant → shard'} icon={<TableGlyph />} tone={SIG.hc} dim={dim('dir')} glow={glow('dir')} />}
      {cfgBox && <NodeCard box={cfgBox} title={P ? 'config svc' : 'config service'} sub={P ? 'shard map' : 'etcd · shard map'} icon={<MapGlyph />} tone={SIG.hc} dim={dim('cfg')} glow={glow('cfg')} />}
      {nodes.map((node) => {
        const b = sim.boxes.get(node.id);
        if (!b || Number.isNaN(b.x)) return null;
        const isShard = node.kind === 'shard';
        const tag = isShard ? sim.tagOf(node.idx) || (c.rule === 'dir' ? 'empty' : '') : node.kind === 'replica' ? 'full copy' : node.kind === 'primary' ? 'every write' : '';
        const tagColor = node.kind === 'replica' ? SIG.hc : node.kind === 'primary' ? SIG.req : undefined;
        return (
          <DbNodeView
            key={node.id}
            sim={sim}
            node={node}
            box={b}
            dim={dim(node.id)}
            glow={glow(node.id)}
            pickable={stageClick && isShard}
            onClick={stageClick && isShard ? () => sim.game?.answer(shardId(node.idx)) : undefined}
            tag={tag}
            tagColor={tagColor}
          />
        );
      })}
      <Flights sim={sim} />
      <Effects sim={sim} />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Two-phase commit, drawn as a sequence diagram                       */
/* ------------------------------------------------------------------ */

function TwoPcScene({ sim }: { sim: ShardSim }) {
  const P = sim.orient === 'portrait';
  const x = P ? 6 : 50;
  const y = P ? 64 : 78;
  const w = sim.w - x * 2;
  const h = sim.h - y - (P ? 70 : 112);
  // Fit one whole transaction (about 10 s) without scrolling.
  const pxPerSec = Math.max(32, Math.min(60, (h - 106) / 11));
  // Span labels would run off a phone screen; the legend explains the bars there.
  const spans = P ? sim.tpc.spans.map((s) => ({ ...s, label: undefined })) : sim.tpc.spans;
  return (
    <SequenceDiagram
      x={x}
      y={y}
      w={w}
      h={h}
      now={sim.tpcClock}
      origin={sim.tpc.origin}
      pxPerSec={pxPerSec}
      actors={[
        { id: 'app', label: 'app', sub: P ? undefined : 'shop-api', color: SIG.req },
        { id: 's0', label: 'shard-0', sub: 'alice', color: shardColor(0) },
        { id: 'router', label: 'router', sub: 'coordinator', color: SIG.hc },
        { id: 's2', label: 'shard-2', sub: 'bob', color: shardColor(2) },
      ]}
      messages={sim.tpc.messages}
      notes={sim.tpc.notes}
      spans={spans}
    />
  );
}
