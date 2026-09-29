'use client';

import { SIG } from '@/lib/sim/colors';
import { clamp } from '@/lib/sim/geometry';
import { ClientCard, Effects, Flights, NodeCard, Wires } from '@/components/stage/svg';
import { TRACE_HOPS } from './content';
import { LAYERS, REGION_COLOR, RUNS_ON, TCPIP, bitSample, blockColor, blockLabel, blockBytes, isHollow, protoFor, receiverFor, type BlockKind, type Built, type LayerN } from './model';
import { OsiSim, RAIL_W, type Col, type DevId } from './sim';
import css from './osi.module.css';

export interface SceneOpts {
  /** Spotlight: layers in focus (others dim) */
  focus?: LayerN[] | null;
  /** Spotlight: devices in focus */
  focusDevs?: DevId[] | null;
  peers?: boolean;
  wave?: boolean;
  highlight?: string | null;
  /** Which rows can be clicked */
  clickRows?: DevId[] | null;
  onRow?: (dev: DevId, layer: LayerN) => void;
  onBlock?: (layer: LayerN) => void;
  selected?: LayerN | null;
  /** Hide the data unit's caption */
  noCaption?: boolean;
}

const TINY: Record<LayerN, string> = { 7: 'App', 6: 'Pres', 5: 'Sess', 4: 'Trans', 3: 'Net', 2: 'Link', 1: 'Phys' };

type Density = 'full' | 'mid' | 'small' | 'tiny';

function density(sim: OsiSim): Density {
  const land = sim.orient === 'landscape';
  if (sim.g.view === 'path') return land ? 'mid' : 'tiny';
  return land ? 'full' : 'small';
}

/* ------------------------------------------------------------------ */

export function Scene({ sim, opts }: { sim: OsiSim; opts: SceneOpts }) {
  const view = sim.cfg.view;
  if (view === 'chain') return <Chain sim={sim} />;
  const sv = sim.spriteView();
  return (
    <g>
      {opts.peers && view === 'stack' && <PeerLines sim={sim} />}
      {view === 'stack' && sim.orient === 'landscape' && <RunsOn sim={sim} opts={opts} />}
      <Cables sim={sim} />
      {sim.g.cols.map((c) => (
        <Column key={c.dev} sim={sim} col={c} opts={opts} />
      ))}
      {view === 'single' && <SortTags sim={sim} />}
      {sv && view === 'path' && sim.spriteW > 1 && <Leader sim={sim} />}
      <BitTrain sim={sim} wave={!!opts.wave} />
      {sv && sim.blocks.length > 0 && <Sprite sim={sim} opts={opts} />}
      <Flights sim={sim} />
      <Effects sim={sim} />
    </g>
  );
}

/* ------------------------------------------------------------------ */
/* Columns of layer rows                                               */
/* ------------------------------------------------------------------ */

interface Slot {
  layers: LayerN[];
  top: number;
  bottom: number;
}

function osiSlots(sim: OsiSim, c: Col): Slot[] {
  const { rowH } = sim.g;
  if (c.collapsed) {
    const groups: LayerN[][] = [[7, 6, 5, 4], [3], [2], [1]];
    return groups.map((layers) => {
      const y = sim.slotY(c, layers[layers.length - 1]);
      return { layers, top: y - rowH / 2, bottom: y + rowH / 2 };
    });
  }
  return c.layers.map((L) => {
    const y = sim.slotY(c, L);
    return { layers: [L], top: y - rowH / 2, bottom: y + rowH / 2 };
  });
}

function tcpipSlots(sim: OsiSim, c: Col): (Slot & { name: string })[] {
  const { rowH } = sim.g;
  const out: (Slot & { name: string })[] = [];
  for (const grp of TCPIP) {
    const layers = grp.layers.filter((L) => c.layers.includes(L));
    if (!layers.length) continue;
    const top = sim.slotY(c, layers[0]) - rowH / 2;
    const bottom = sim.slotY(c, layers[layers.length - 1]) + rowH / 2;
    out.push({ layers, top, bottom, name: grp.name });
  }
  return out;
}

function devTitle(sim: OsiSim, dev: DevId): { name: string; sub: string } {
  const rx = receiverFor(sim.cfg.app);
  switch (dev) {
    case 'alice':
      return { name: 'Alice’s laptop', sub: '198.51.100.23' };
    case 'srv':
      return { name: rx.host, sub: rx.ip };
    case 'sw':
      return { name: sim.cfg.link === 'wifi' ? 'access point' : 'switch', sub: '' };
    case 'rt':
      return { name: 'router', sub: '' };
    case 'ref':
      return { name: 'the OSI model', sub: '' };
  }
}

function Column({ sim, col, opts }: { sim: OsiSim; col: Col; opts: SceneOpts }) {
  const box = sim.boxes.get(col.dev);
  const alpha = box ? box.alpha : 1;
  const d = density(sim);
  const t = devTitle(sim, col.dev);
  const x0 = col.cx - col.w / 2;
  const top = sim.colTop(col);
  const devDim = !!opts.focusDevs?.length && !opts.focusDevs.includes(col.dev);
  const glowCol = opts.highlight === col.dev;
  const mk = col.collapsed ? 0 : sim.modelK;
  const showTitleSub = d === 'full' && !!t.sub;
  // Narrow columns: short names, pinned to the stage edges so they never clip.
  const name = d === 'tiny' ? ({ alice: 'Alice', srv: 'server' } as Record<string, string>)[col.dev] ?? t.name : t.name;
  const edge = d === 'tiny' && (col.dev === 'alice' || col.dev === 'srv');
  const tx = showTitleSub || (edge && col.dev === 'alice') ? x0 + 2 : edge ? x0 + col.w - 2 : col.cx;
  const anchor = showTitleSub || (edge && col.dev === 'alice') ? 'start' : edge ? 'end' : 'middle';
  return (
    <g opacity={alpha * (devDim ? 0.3 : 1)}>
      {glowCol && <rect x={x0 - 7} y={top - 34} width={col.w + 14} height={col.w > 0 ? sim.slotY(col, 1) + sim.g.rowH / 2 - top + 41 : 0} rx={12} fill="none" stroke="var(--accent)" strokeWidth={1.4} strokeDasharray="3 3" />}
      <text className={css.devName} x={tx} y={top - 12} textAnchor={anchor}>
        {name}
      </text>
      {showTitleSub && (
        <text className={css.devSub} x={x0 + col.w - 2} y={top - 12} textAnchor="end">
          {t.sub}
        </text>
      )}
      <g opacity={1 - mk}>
        {osiSlots(sim, col).map((s) => (
          <Row key={s.layers.join('')} sim={sim} col={col} slot={s} opts={opts} d={d} />
        ))}
      </g>
      {mk > 0.01 && (
        <g opacity={mk}>
          {tcpipSlots(sim, col).map((s) => (
            <MergedRow key={s.name} sim={sim} col={col} slot={s} d={d} />
          ))}
        </g>
      )}
    </g>
  );
}

function unitAt(sim: OsiSim): { dev: DevId; layer: LayerN } | null {
  if (!sim.path.length || sim.tripDone && !sim.dead && sim.blocks.length === 0) return null;
  const m = sim.moving;
  const A = sim.path[sim.at];
  if (!A) return null;
  if (m) {
    const B = sim.path[m.to];
    if (A.dev !== B.dev) return null;
    return m.k > 0.5 ? { dev: B.dev, layer: B.layer } : { dev: A.dev, layer: A.layer };
  }
  return { dev: A.dev, layer: A.layer };
}

function Row({ sim, col, slot, opts, d }: { sim: OsiSim; col: Col; slot: Slot; opts: SceneOpts; d: Density }) {
  const L = slot.layers[slot.layers.length - 1];
  const multi = slot.layers.length > 1;
  const info = LAYERS[L];
  const x = col.cx - col.w / 2;
  const y = slot.top;
  const w = col.w;
  const h = slot.bottom - slot.top;
  const here = unitAt(sim);
  const active = !!here && here.dev === col.dev && slot.layers.includes(here.layer) && !!sim.tripSpecActive;
  const side = col.dev === 'alice' ? 'alice' : 'far';
  // Layers 5 and 6 with no protocol of their own: drawn as empty boxes, because the app does their jobs.
  const hollow = !multi && (col.dev === 'alice' || col.dev === 'srv') && isHollow(L, sim.cfg.app);
  const proto = hollow
    ? 'in the app'
    : multi
      ? `${protoFor(4, sim.cfg.app, sim.cfg.link, side)} · ${protoFor(7, sim.cfg.app, sim.cfg.link, side)}`
      : col.dev === 'rt' && L === 1
        ? 'copper · fiber'
        : col.dev === 'sw' && L === 1
          ? sim.cfg.link === 'wifi' ? 'radio · copper' : 'copper'
          : col.dev === 'sw' && L === 2 && sim.cfg.link === 'wifi'
            ? '802.11 → Eth'
            : col.dev === 'ref'
              ? ''
              : protoFor(L, sim.cfg.app, sim.cfg.link, side);
  const dim = !!opts.focus?.length && !slot.layers.some((l) => opts.focus!.includes(l));
  const glow = slot.layers.some((l) => opts.highlight === `${col.dev}.${l}`);
  const flash = slot.layers.map((l) => sim.flashes.get(`${col.dev}.${l}`)).find(Boolean);
  const fk = flash ? clamp(1 - (sim.vt - flash.vt) / 1.2, 0, 1) : 0;
  const dead = !!sim.dead && sim.dead.dev === col.dev && slot.layers.includes(sim.dead.layer);
  const selected = col.dev === 'alice' && !!opts.selected && slot.layers.includes(opts.selected);
  const clickable = !!opts.clickRows?.includes(col.dev) && !multi && !!opts.onRow;
  const pick = clickable && col.dev === 'ref';
  const accent = active ? info.color : selected ? 'var(--accent)' : undefined;
  const num = multi ? `${slot.layers[slot.layers.length - 1]}–${slot.layers[0]}` : String(L);
  const name = multi ? (d === 'tiny' ? 'Upper' : 'Upper layers') : d === 'tiny' ? TINY[L] : info.name;
  const colors = slot.layers.map((l) => LAYERS[l].color);

  const numX = d === 'tiny' ? 9 : d === 'small' ? 11 : 15;
  const nameX = d === 'tiny' ? (multi ? 30 : 19) : d === 'small' ? (multi ? 34 : 22) : multi ? 42 : 32;
  // Every density uses two lines: name on top, then the job (full) or the protocol.
  const line1 = d === 'full' ? h / 2 - 3 : h / 2 - 2;
  const line2 = d === 'full' ? h / 2 + 12 : d === 'mid' ? h / 2 + 13 : h / 2 + 11;
  const protoStyle = active ? { fill: info.color } : hollow ? { opacity: 0.6 } : proto === '—' ? { opacity: 0.5 } : undefined;

  return (
    <g
      className={clickable ? css.rowClick : undefined}
      transform={`translate(${x},${y})`}
      opacity={dim ? 0.28 : 1}
      onClick={clickable ? () => opts.onRow!(col.dev, L) : undefined}
      role={clickable ? 'button' : undefined}
      aria-label={clickable ? `Layer ${L}: ${info.name}` : undefined}
    >
      {clickable && <rect x={-4} y={-3} width={w + 8} height={h + 6} fill="transparent" />}
      {active && <rect x={-4} y={-4} width={w + 8} height={h + 8} rx={10} fill={info.color} opacity={0.09} />}
      {fk > 0 && <rect x={-3} y={-3} width={w + 6} height={h + 6} rx={9} fill="none" stroke={flash!.color} strokeWidth={2.2} opacity={fk * 0.85} />}
      {glow && <rect x={-6} y={-6} width={w + 12} height={h + 12} rx={11} fill="none" stroke="var(--accent)" strokeWidth={1.4} strokeDasharray="3 3" />}
      <rect className={css.rowRect} width={w} height={h} rx={7} style={accent ? { stroke: accent, strokeWidth: 1.6 } : undefined} data-pick={pick || undefined} data-hollow={hollow || undefined} />
      {colors.map((c, i) => (
        <rect key={i} x={0.5} y={0.5 + (i * (h - 1)) / colors.length} width={4} height={(h - 1) / colors.length} fill={c} opacity={hollow ? 0.35 : active || !dim ? 0.95 : 0.6} rx={i === 0 || i === colors.length - 1 ? 2 : 0} />
      ))}
      {dead && <rect width={w} height={h} rx={7} fill="url(#kit-hatch)" />}
      <text className={css.rowNum} x={numX} y={d === 'full' ? h / 2 + 4 : line1} fill={info.color} style={d === 'tiny' ? { fontSize: 10 } : multi ? { fontSize: 11 } : undefined}>
        {num}
      </text>
      <text className={css.rowName} x={nameX} y={line1} opacity={hollow ? 0.62 : undefined} style={d === 'tiny' ? { fontSize: 10.5 } : d === 'small' ? { fontSize: 11.5 } : undefined}>
        {name}
      </text>
      {d === 'full' && (
        <text className={css.rowJob} x={nameX} y={line2} opacity={hollow ? 0.75 : undefined}>
          {multi ? 'TCP, TLS and the app' : info.job}
        </text>
      )}
      {proto && d === 'full' && (
        <text className={css.rowProto} x={w - 11} y={line1} textAnchor="end" style={protoStyle}>
          {proto}
        </text>
      )}
      {proto && d !== 'full' && (
        <text className={css.rowProto} x={d === 'tiny' ? numX : nameX} y={line2} style={{ fontSize: d === 'tiny' ? 8 : d === 'small' ? 8.5 : 9.5, ...protoStyle }}>
          {proto}
        </text>
      )}
      {selected && !active && <rect x={-2} y={-2} width={w + 4} height={h + 4} rx={8} fill="none" stroke="var(--accent)" strokeWidth={1.2} />}
    </g>
  );
}

function MergedRow({ sim, col, slot, d }: { sim: OsiSim; col: Col; slot: Slot & { name: string }; d: Density }) {
  const x = col.cx - col.w / 2;
  const h = slot.bottom - slot.top;
  const first = slot.layers[0];
  const last = slot.layers[slot.layers.length - 1];
  const nums = first === last ? String(first) : `${last}–${first}`;
  const side = col.dev === 'alice' ? 'alice' : 'far';
  const protos = [...new Set(slot.layers.map((l) => protoFor(l, sim.cfg.app, sim.cfg.link, side)).filter((p) => p !== '—'))].join(' · ');
  const small = d === 'small' || d === 'tiny';
  return (
    <g transform={`translate(${x},${slot.top})`}>
      <rect className={css.rowRect} width={col.w} height={h} rx={8} style={{ stroke: 'rgba(143,166,201,0.6)' }} />
      {slot.layers.map((l, i) => (
        <rect key={l} x={0.5} y={0.5 + (i * (h - 1)) / slot.layers.length} width={4} height={(h - 1) / slot.layers.length} fill={LAYERS[l].color} />
      ))}
      <text className={css.rowName} x={small ? 12 : 18} y={h / 2 - (small ? 2 : 3)} style={small ? { fontSize: 11.5 } : { fontSize: 14 }}>
        {slot.name}
      </text>
      <text className={css.rowJob} x={small ? 12 : 18} y={h / 2 + (small ? 10 : 12)} style={small ? { fontSize: 8.5 } : undefined}>
        {col.dev === 'ref' ? `OSI ${nums}` : `OSI ${nums}${protos && !small ? ` · ${protos}` : ''}`}
      </text>
    </g>
  );
}

/* ------------------------------------------------------------------ */
/* Where each layer really runs: program, kernel, network card         */
/* ------------------------------------------------------------------ */

function RunsOn({ sim, opts }: { sim: OsiSim; opts: SceneOpts }) {
  const { pitch, rowH } = sim.g;
  const tick = 5;
  return (
    <g>
      {(['alice', 'srv'] as DevId[]).map((dev) => {
        const c = sim.col(dev);
        if (!c) return null;
        // Fade and dim with the stack it labels.
        const alpha = (sim.boxes.get(dev)?.alpha ?? 1) * (opts.focusDevs?.length && !opts.focusDevs.includes(dev) ? 0.3 : 1);
        const left = dev === 'alice';
        // The rail sits just outside the stack; ticks point back at the rows.
        const x = left ? c.cx - c.w / 2 - RAIL_W / 2 + 2 : c.cx + c.w / 2 + RAIL_W / 2 - 2;
        const dx = left ? tick : -tick;
        const y1 = sim.slotY(c, 1);
        const yOf = (v: number) => (v >= 7.5 ? sim.slotY(c, 7) - rowH / 2 : v <= 0.5 ? y1 + rowH / 2 : y1 - (v - 1) * pitch);
        return (
          <g key={dev} opacity={alpha}>
            {RUNS_ON.map((r) => {
              const top = yOf(r.span[0]) + 3;
              const bottom = yOf(r.span[1]) - 3;
              const mid = (top + bottom) / 2;
              const tw = r.label.length * 7 + 12;
              return (
                <g key={r.label}>
                  <path d={`M${x + dx},${top} H${x} V${mid - tw / 2} M${x},${mid + tw / 2} V${bottom} H${x + dx}`} className={css.rail} />
                  <text className={css.railLabel} transform={`translate(${x},${mid}) rotate(${left ? -90 : 90})`} y={3.2} textAnchor="middle">
                    {r.label}
                  </text>
                </g>
              );
            })}
          </g>
        );
      })}
    </g>
  );
}

/* ------------------------------------------------------------------ */
/* Cables, radio links and the bits on them                            */
/* ------------------------------------------------------------------ */

function links(sim: OsiSim): [Col, Col][] {
  const cols = sim.g.cols;
  const out: [Col, Col][] = [];
  for (let i = 0; i + 1 < cols.length; i++) out.push([cols[i], cols[i + 1]]);
  return out;
}

function Cables({ sim }: { sim: OsiSim }) {
  if (sim.g.view === 'single') return null;
  const cut = sim.broken === 'cable';
  return (
    <g>
      {links(sim).map(([a, b], i) => {
        const y = sim.slotY(a, 1);
        const x0 = a.cx + a.w / 2;
        const x1 = b.cx - b.w / 2;
        const alpha = Math.min(sim.boxes.get(a.dev)?.alpha ?? 1, sim.boxes.get(b.dev)?.alpha ?? 1);
        const radio = i === 0 && sim.cfg.link === 'wifi';
        const mid = (x0 + x1) / 2;
        if (radio) {
          return (
            <g key={i} opacity={alpha}>
              <line x1={x0} y1={y} x2={x1} y2={y} className={css.radio} />
              {[0, 1, 2].map((k) => (
                <path key={k} d={`M${x0 + 10 + k * 6},${y - 8 - k * 4} A${10 + k * 6},${10 + k * 6} 0 0,1 ${x0 + 10 + k * 6},${y + 8 + k * 4}`} className={css.radioArc} />
              ))}
              {[0, 1, 2].map((k) => (
                <path key={`b${k}`} d={`M${x1 - 10 - k * 6},${y - 8 - k * 4} A${10 + k * 6},${10 + k * 6} 0 0,0 ${x1 - 10 - k * 6},${y + 8 + k * 4}`} className={css.radioArc} />
              ))}
            </g>
          );
        }
        if (cut && i === 0) {
          const g0 = x0 + (x1 - x0) * 0.44;
          const g1 = x0 + (x1 - x0) * 0.58;
          return (
            <g key={i} opacity={alpha}>
              <line x1={x0} y1={y} x2={g0} y2={y} className={css.cable} />
              <line x1={g1} y1={y} x2={x1} y2={y} className={css.cable} />
              <rect x={g0 - 3} y={y - 4} width={6} height={8} rx={1.5} fill={SIG.err} />
              <rect x={g1 - 3} y={y - 4} width={6} height={8} rx={1.5} fill={SIG.err} opacity={0.6} />
              <text className={css.cableLabel} x={(g0 + g1) / 2} y={sim.orient === 'landscape' ? y + 20 : y + sim.g.rowH / 2 + 14} textAnchor="middle" style={{ fill: SIG.err }}>
                unplugged
              </text>
            </g>
          );
        }
        return (
          <g key={i} opacity={alpha}>
            <line x1={x0} y1={y} x2={x1} y2={y} className={css.cable} />
            <rect x={x0 - 1} y={y - 4} width={5} height={8} rx={1} className={css.port} />
            <rect x={x1 - 4} y={y - 4} width={5} height={8} rx={1} className={css.port} />
            {sim.g.view === 'stack' && sim.orient === 'landscape' && (
              <text className={css.cableLabel} x={mid} y={y + sim.g.rowH / 2 + 16} textAnchor="middle">
                the network: switches, routers, more cable
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}

function BitTrain({ sim, wave }: { sim: OsiSim; wave: boolean }) {
  const wv = sim.wireView();
  if (!wv) return null;
  const land = sim.orient === 'landscape';
  const sp = land ? 10 : 7.5;
  const len = Math.abs(wv.x1 - wv.x0);
  const n = Math.max(16, Math.min(56, Math.round(len / sp) + 4));
  const bits = bitSample(sim.built(), n);
  const L = bits.length * sp;
  const s = wv.k * (len + L);
  const head = wv.x0 + s;
  const fs = land ? 11 : 9;
  const y = wv.y;
  const glyphs = bits
    .map((b, i) => ({ ...b, x: head - i * sp }))
    .filter((g) => g.x >= wv.x0 - 1 && g.x <= (wv.lostAt != null ? wv.x0 + len * wv.lostAt : wv.x1) + 1);
  return (
    <g>
      {wave && glyphs.length > 1 && (
        <polyline
          points={glyphs
            .slice()
            .reverse()
            .flatMap((g) => {
              const yy = y + 22 - g.bit * 10;
              return [`${g.x - sp / 2},${yy}`, `${g.x + sp / 2},${yy}`];
            })
            .join(' ')}
          fill="none"
          stroke={LAYERS[1].color}
          strokeWidth={1.3}
          opacity={0.8}
        />
      )}
      {glyphs.map((g, i) => (
        <text key={i} x={g.x} y={y - 6 - (wv.radio ? Math.sin(g.x / 14) * 3 : 0)} textAnchor="middle" className={css.bit} style={{ fill: REGION_COLOR[g.region], fontSize: fs }}>
          {g.bit}
        </text>
      ))}
      {wv.lostAt != null && (
        <g transform={`translate(${wv.x0 + len * wv.lostAt},${y})`} stroke={SIG.err} strokeWidth={2.2} strokeLinecap="round">
          <line x1={-7} y1={-7} x2={7} y2={7} />
          <line x1={-7} y1={7} x2={7} y2={-7} />
        </g>
      )}
    </g>
  );
}

/* ------------------------------------------------------------------ */
/* The data unit: nested header blocks                                 */
/* ------------------------------------------------------------------ */

function regionBytes(k: BlockKind, b: Built): number[] {
  switch (k) {
    case 'eth':
    case 'wifi':
      return b.l2;
    case 'ip':
      return b.ip;
    case 'tcp':
    case 'udp':
      return b.l4;
    case 'tls':
      return b.tls ? b.tls.slice(0, 5) : [];
    case 'app':
      return b.tls ? b.tls.slice(5, 40) : b.app.slice(0, 40);
    case 'fcs':
      return b.fcs;
  }
}

export function spriteHeight(sim: OsiSim) {
  return sim.g.big ? 36 : Math.round(15 + 12 * Math.min(1, sim.g.scale * 1.4));
}

export function spriteRect(sim: OsiSim) {
  const sv = sim.spriteView();
  if (!sv) return null;
  const s = sim.g.scale;
  const W = sim.spriteW * s;
  const H = spriteHeight(sim);
  return { x: sv.x - W * sv.align, y: sv.y - H / 2, w: W, h: H, sv };
}

function Sprite({ sim, opts }: { sim: OsiSim; opts: SceneOpts }) {
  const r = spriteRect(sim);
  if (!r) return null;
  const { sv } = r;
  const s = sim.g.scale;
  const big = sim.g.big;
  const H = r.h;
  const built = sim.built();
  const vt = sim.vt;
  const bk = sim.bitsK;
  const hot = sim.hot;
  const readOnly = sim.path[sim.at]?.dev === 'sw' && sim.swPhase === 'lookup' && !sim.moving;
  const outer = sim.outer;
  return (
    <g>
      {sim.blocks.map((b) => {
        const bw = b.w * s;
        if (bw < 0.5) return null;
        const bornK = clamp((vt - b.born) / 0.4, 0, 1);
        const deadK = b.dead != null ? clamp((vt - b.dead) / 0.55, 0, 1) : 0;
        if (deadK >= 1) return null;
        const ease = 1 - (1 - bornK) * (1 - bornK);
        const x = r.x + b.x * s;
        const y = sv.y - H / 2 - deadK * 26;
        const color = blockColor(b.kind);
        const isHot = hot === b.kind || (hot === 'eth' && b.kind === 'fcs' && sim.lastAdded === 'eth');
        const sealed = readOnly && !(b.kind === 'eth' || b.kind === 'wifi' || b.kind === 'fcs');
        const alpha = ease * (1 - deadK) * (sealed ? 0.35 : 1);
        const label = b.kind === 'app' && b.enc ? (big ? 'encrypted' : '•••') : blockLabel(b.kind, sim.cfg.app);
        const labelW = label.length * (big ? 6.6 : 5.2);
        const showLabel = bw >= labelW + 6;
        const bytes = blockBytes(b.kind, built, b.enc);
        const clickable = !!opts.onBlock && b.dead == null;
        const glyphs = bk > 0.02 ? Math.max(1, Math.floor(bw / (big ? 8 : 6))) : 0;
        const rb = glyphs ? regionBytes(b.kind, built) : [];
        return (
          <g
            key={b.key}
            opacity={alpha}
            className={clickable ? css.blockClick : undefined}
            onClick={clickable ? () => opts.onBlock!(LAYERS[OsiSim.layerOfBlock(b.kind)].n) : undefined}
          >
            {isHot && !deadK && <rect x={x - 3} y={y - 3} width={bw + 6} height={H + 6} rx={6} fill="none" stroke={color} strokeWidth={1.4} opacity={0.5 + 0.4 * Math.sin((vt - sim.hotVt) * 6)} />}
            <rect x={x} y={y} width={Math.max(1, bw)} height={H} rx={big ? 4 : 3} fill={color} fillOpacity={isHot ? 0.3 : 0.16} stroke={color} strokeWidth={isHot ? 1.6 : 1.1} strokeDasharray={bk > 0.5 ? '2 2' : undefined} />
            {b.enc && <rect x={x} y={y} width={Math.max(1, bw)} height={H} rx={big ? 4 : 3} fill="url(#osi-enc)" opacity={1 - bk} />}
            {showLabel && (
              <text className={css.blockLabel} x={x + bw / 2} y={big ? y + H / 2 - 2 : y + H / 2 + 3.5} textAnchor="middle" style={{ fill: color, opacity: 1 - bk, fontSize: big ? 11 : 8.5 }}>
                {label}
              </text>
            )}
            {showLabel && big && (
              <text className={css.blockBytes} x={x + bw / 2} y={y + H / 2 + 11} textAnchor="middle" style={{ opacity: 1 - bk }}>
                {bytes} B
              </text>
            )}
            {glyphs > 0 &&
              Array.from({ length: glyphs }, (_, i) => {
                const byte = rb[Math.floor(i / 8) % Math.max(1, rb.length)] ?? 0;
                const bit = (byte >> (i % 8)) & 1;
                return (
                  <text key={i} className={css.bit} x={x + (i + 0.5) * (bw / glyphs)} y={y + H / 2 + 3.5} textAnchor="middle" style={{ fill: color, opacity: bk, fontSize: big ? 10 : 8 }}>
                    {bit}
                  </text>
                );
              })}

          </g>
        );
      })}
      {readOnly && (() => {
        // One label under the part the switch never opens
        const inner = sim.blocks.filter((b) => b.dead == null && b.kind !== 'eth' && b.kind !== 'wifi' && b.kind !== 'fcs');
        if (!inner.length) return null;
        const x0 = r.x + inner[0].x * s;
        const last = inner[inner.length - 1];
        const x1 = r.x + (last.x + last.w) * s;
        return (
          <g>
            <path d={`M${x0},${r.y + H + 5} v4 H${x1} v-4`} fill="none" stroke="rgba(143,166,201,0.45)" strokeWidth={1} />
            <text className={css.blockBytes} x={(x0 + x1) / 2} y={r.y + H + 19} textAnchor="middle" style={{ fontSize: 9.5 }}>
              packet inside: not read
            </text>
          </g>
        );
      })()}
      {!opts.noCaption && outer && sim.orient === 'landscape' && (
        <text
          className={css.caption}
          x={sv.align === 1 ? r.x + r.w : sv.align === 0 ? r.x : sv.x}
          y={r.y - 9}
          textAnchor={sv.align === 1 ? 'end' : sv.align === 0 ? 'start' : 'middle'}
          style={{ fill: sim.deliveredTo && sim.tripDone ? (sim.broken === 'app500' ? SIG.err : SIG.res) : bk > 0.5 ? LAYERS[1].color : blockColor(outer) }}
        >
          {sim.deliveredTo && sim.tripDone ? `${sim.broken === 'app500' ? '✕' : '✓'} ${sim.deliveredTo}` : `${sim.unit} · ${sim.size.toLocaleString('en-US')} bytes`}
        </text>
      )}
    </g>
  );
}

/** Path view: a dashed leader from the floating unit to the row that holds it. */
function Leader({ sim }: { sim: OsiSim }) {
  const r = spriteRect(sim);
  const here = unitAt(sim);
  if (!r || !here) return null;
  const c = sim.col(here.dev);
  if (!c) return null;
  const y1 = sim.slotY(c, here.layer) - sim.g.rowH / 2 - 2;
  const top = sim.colTop(c);
  return (
    <g>
      <line x1={r.sv.x} y1={r.y + r.h + 4} x2={c.cx} y2={top - 26} stroke={LAYERS[here.layer].color} strokeWidth={1.1} strokeDasharray="2 4" opacity={0.6} />
      <line x1={c.cx} y1={top - 6} x2={c.cx} y2={y1} stroke={LAYERS[here.layer].color} strokeWidth={1.1} strokeDasharray="2 4" opacity={y1 > top + 2 ? 0.6 : 0} />
    </g>
  );
}

/* ------------------------------------------------------------------ */
/* Peer lines: each layer talks to its twin                            */
/* ------------------------------------------------------------------ */

function PeerLines({ sim }: { sim: OsiSim }) {
  const a = sim.col('alice');
  const b = sim.col('srv');
  if (!a || !b) return null;
  const x0 = a.cx + a.w / 2 + 6;
  const x1 = b.cx - b.w / 2 - 6;
  const mid = (x0 + x1) / 2;
  const land = sim.orient === 'landscape';
  // The labels slide to whichever side the data unit isn't on.
  const px = land ? x0 + (x1 - x0) * sim.peerK : mid;
  // On a phone the lane is too narrow for both: hide the pill on the unit's row.
  const busy = land ? null : (sim.spriteView()?.layer ?? null);
  const label = (L: LayerN): string | null => {
    if (L === 7) return 'HTTP ⇄ HTTP';
    if (L === 4) return 'TCP ⇄ TCP';
    if (L === 3) return 'IP ⇄ IP';
    return null;
  };
  return (
    <g>
      {([7, 6, 5, 4, 3, 2, 1] as LayerN[]).map((L) => {
        const y = sim.slotY(a, L);
        const end = L >= 4;
        const color = LAYERS[L].color;
        const t = busy === L ? null : label(L);
        const tw = t ? t.length * (land ? 6.4 : 5.2) + 14 : 0;
        return (
          <g key={L}>
            <line x1={x0} y1={y} x2={x1} y2={y} stroke={end ? color : 'rgba(143,166,201,0.45)'} strokeWidth={end ? 1.3 : 1} strokeDasharray={end ? '5 5' : '1.5 5'} opacity={end ? (L === 7 || L === 4 ? 0.75 : 0.35) : 0.7} />
            {t && (
              <g transform={`translate(${px},${y})`}>
                <rect x={-tw / 2} y={-9} width={tw} height={18} rx={9} fill="rgba(7,11,20,0.94)" stroke={end ? color : 'rgba(143,166,201,0.5)'} strokeOpacity={0.7} />
                <text className={css.peerLabel} y={3.5} textAnchor="middle" style={{ fill: end ? color : 'var(--text-2)', fontSize: land ? 10.5 : 8.5 }}>
                  {t}
                </text>
              </g>
            )}
          </g>
        );
      })}
      {land && (
        <>
          <text className={css.bracket} x={mid} y={(sim.slotY(a, 6) + sim.slotY(a, 5)) / 2 + 4} textAnchor="middle">
            layers 4–7: only the two ends
          </text>
          <text className={css.bracket} x={mid} y={(sim.slotY(a, 2) + sim.slotY(a, 1)) / 2 + 4} textAnchor="middle">
            layers 1–3: every hop in between too
          </text>
        </>
      )}
    </g>
  );
}

/* ------------------------------------------------------------------ */
/* Sorting tags                                                        */
/* ------------------------------------------------------------------ */

function SortTags({ sim }: { sim: OsiSim }) {
  const c = sim.col('ref');
  if (!c) return null;
  const land = sim.orient === 'landscape';
  const per = new Map<number, number>();
  return (
    <g>
      {sim.sortPlaced.map((p) => {
        const j = per.get(p.home) ?? 0;
        per.set(p.home, j + 1);
        const text = `${p.ok ? '✓' : '✕'} ${p.label}`;
        const tw = text.length * (land ? 6.6 : 5.3) + (land ? 18 : 12);
        let x = c.cx + c.w / 2 + 14;
        for (const q of sim.sortPlaced) {
          if (q === p) break;
          if (q.home === p.home) x += `${q.ok ? '✓' : '✕'} ${q.label}`.length * (land ? 6.6 : 5.3) + (land ? 18 : 12) + 6;
        }
        const y = sim.slotY(c, p.home);
        const k = clamp((sim.vt - p.vt) / 0.45, 0, 1);
        const color = p.ok ? SIG.res : SIG.err;
        return (
          <g key={p.id} transform={`translate(${x + (1 - k) * 24},${y})`} opacity={k}>
            <rect x={0} y={-11} width={tw} height={22} rx={11} fill="rgba(7,11,20,0.94)" stroke={color} strokeOpacity={0.85} />
            <text className={css.tag} x={tw / 2} y={4} textAnchor="middle" style={{ fill: p.ok ? 'var(--text-1)' : '#ffb3c0', fontSize: land ? 11 : 9 }}>
              {text}
            </text>
          </g>
        );
      })}
    </g>
  );
}

/* ------------------------------------------------------------------ */
/* traceroute chain                                                    */
/* ------------------------------------------------------------------ */

function Chain({ sim }: { sim: OsiSim }) {
  const a = sim.boxes.get('c.alice');
  return (
    <g>
      <Wires sim={sim} />
      {a && <ClientCard box={a} name="Alice" sub="198.51.100.23" color={SIG.pink} />}
      {TRACE_HOPS.map((h, i) => {
        const b = sim.boxes.get(h.id);
        if (!b) return null;
        const last = i === TRACE_HOPS.length - 1;
        return (
          <NodeCard
            key={h.id}
            box={b}
            title={last ? 'shop.example' : sim.orient === 'landscape' ? 'router' : `router ${i + 1}`}
            sub={h.ip}
            kicker={sim.orient === 'landscape' ? { text: `hop ${i + 1}`, color: last ? SIG.res : undefined } : undefined}
            led={last ? 'up' : null}
          />
        );
      })}
      <Flights sim={sim} />
      <Effects sim={sim} />
    </g>
  );
}
