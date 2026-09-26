'use client';

import type { ReactNode } from 'react';
import { Effects, Flights, Wires } from '@/components/stage/svg';
import stage from '@/components/stage/stage.module.css';
import { SIG } from '@/lib/sim/colors';
import { clamp, smoothstep } from '@/lib/sim/geometry';
import type { Box } from '@/lib/sim/Sim';
import { LEVELS, PER_LINE, avgNs, fmtBytes, fmtNs, hex, type LevelId } from './model';
import { LIST, type CacheSim, type ChartGeo, type Mesi } from './sim';
import css from './cc.module.css';

/** Identity colors for the levels (traffic keeps the signal colors). */
export const LEVEL_COLOR: Record<LevelId, string> = { l1: SIG.res, l2: SIG.lime, l3: SIG.blue, ram: SIG.heavy };
export const MESI_COLOR: Record<Mesi, string> = { M: SIG.heavy, E: SIG.res, S: SIG.req, I: SIG.err };
const MESI_NAME: Record<Mesi, string> = { M: 'Modified', E: 'Exclusive', S: 'Shared', I: 'Invalid' };

export interface SceneProps {
  sim: CacheSim;
  highlight: string | null;
  focus?: string[];
}

export function Scene({ sim, highlight, focus }: SceneProps) {
  const dim = (id: string) => !!focus?.length && !focus.includes(id);
  const glow = (id: string) => highlight === id;
  const v = sim.cfg.view;
  return (
    <>
      <Wires sim={sim} />
      {v === 'wall' && <WallScene sim={sim} dim={dim} glow={glow} />}
      {(v === 'ladder' || v === 'cliff') && <ChainScene sim={sim} dim={dim} glow={glow} mini={v === 'cliff'} />}
      {v === 'cliff' && <Chart sim={sim} />}
      {v === 'grid' && <GridScene sim={sim} dim={dim} glow={glow} />}
      {v === 'race' && <RaceScene sim={sim} glow={glow} />}
      {v === 'cores' && <CoresScene sim={sim} dim={dim} glow={glow} />}
      <Flights sim={sim} />
      <Effects sim={sim} />
    </>
  );
}

type Pred = (id: string) => boolean;

/* ================================================================== */
/* Shared bits                                                         */
/* ================================================================== */

function Card({ box, dim, glow, tone, rx = 10, children }: { box: Box; dim?: boolean; glow?: boolean; tone?: string; rx?: number; children?: ReactNode }) {
  return (
    <g className={stage.node} transform={`translate(${box.x - box.w / 2},${box.y - box.h / 2})`} opacity={box.alpha * (dim ? 0.28 : 1)}>
      {glow && <rect x={-6} y={-6} width={box.w + 12} height={box.h + 12} rx={rx + 4} fill="none" stroke="var(--accent)" strokeWidth={1.4} strokeDasharray="3 3" />}
      <rect className={stage.card} width={box.w} height={box.h} rx={rx} style={tone ? { stroke: tone } : undefined} />
      <rect className={stage.cardInner} x={3.5} y={3.5} width={Math.max(0, box.w - 7)} height={Math.max(0, box.h - 7)} rx={Math.max(2, rx - 2.5)} />
      {children}
    </g>
  );
}

function Title({ x, y, text, sub, anchor = 'start', size }: { x: number; y: number; text: string; sub?: string; anchor?: 'start' | 'middle' | 'end'; size?: number }) {
  return (
    <>
      <text className={stage.name} x={x} y={y} textAnchor={anchor} style={size ? { fontSize: size } : undefined}>
        {text}
      </text>
      {sub && (
        <text className={stage.mono} x={x} y={y + 13} textAnchor={anchor}>
          {sub}
        </text>
      )}
    </>
  );
}

/* ================================================================== */
/* Chapter 1: core, (cache), and a linked list in RAM                   */
/* ================================================================== */

function WallScene({ sim, dim, glow }: { sim: CacheSim; dim: Pred; glow: Pred }) {
  const core = sim.boxes.get('core');
  const cache = sim.boxes.get('cache');
  const ram = sim.boxes.get('ram');
  const land = sim.orient === 'landscape';
  const W = sim.wall;
  const cycles = sim.wallCycles();
  const waiting = W.inLoad;
  return (
    <g>
      {ram && (
        <Card box={ram} dim={dim('ram')} glow={glow('ram')}>
          <Title x={14} y={22} text="RAM" sub={land ? 'DRAM · ~100 ns per request' : undefined} />
          {!land && (
            <text className={stage.mono} x={ram.w - 12} y={22} textAnchor="end">
              ~100 ns per request
            </text>
          )}
          {land && (
            <>
              <text className={css.axisText} x={ram.w - 12} y={50} textAnchor="end">
                low addresses
              </text>
              <text className={css.axisText} x={ram.w - 12} y={ram.h - 10} textAnchor="end">
                high addresses
              </text>
            </>
          )}
        </Card>
      )}
      {ram && <ListArrows sim={sim} alpha={ram.alpha * (dim('ram') ? 0.28 : 1)} />}
      {LIST.map((n, k) => {
        const b = sim.boxes.get(`node:${k}`);
        if (!b || !ram) return null;
        const active = W.k === k && (W.inLoad || sim.wall.passNs > 0 || k === 0);
        const cached = !!sim.cfg.cache && W.cached.has(k);
        return (
          <g key={k} transform={`translate(${b.x - b.w / 2},${b.y - b.h / 2})`} opacity={b.alpha * (dim('ram') ? 0.28 : 1)}>
            <rect width={b.w} height={b.h} rx={5} className={css.node} data-active={active && W.inLoad} data-cached={cached} />
            <line x1={b.w * 0.34} y1={3} x2={b.w * 0.34} y2={b.h - 3} className={css.nodeSep} />
            <text className={css.nodeVal} x={b.w * 0.17} y={b.h / 2 + 4} textAnchor="middle">
              {n.value}
            </text>
            <text className={css.nodeNext} x={b.w * 0.34 + 6} y={b.h / 2 + 3.5}>
              → {k + 1 < LIST.length ? hex(LIST[k + 1].addr) : 'NULL'}
            </text>
            <text className={css.nodeAddr} x={0} y={-4}>
              {hex(n.addr)}
            </text>
          </g>
        );
      })}
      {cache && (
        <Card box={cache} dim={dim('cache')} glow={glow('cache')} tone="rgba(75,227,160,0.55)">
          <Title x={12} y={land ? 22 : 20} text="cache" sub={land ? 'SRAM · ~1 ns' : undefined} />
          {!land && (
            <text className={stage.mono} x={60} y={20}>
              SRAM · ~1 ns
            </text>
          )}
          {LIST.map((n, k) => {
            const has = W.cached.has(k);
            if (land) {
              const y = 58 + k * 19;
              return (
                <g key={k}>
                  <rect x={12} y={y - 12} width={cache.w - 24} height={16} rx={3} className={css.cacheSlot} data-on={has} />
                  <text className={css.cacheText} x={19} y={y} data-on={has}>
                    {has ? `${hex(n.addr)}  value ${n.value}` : '—'}
                  </text>
                </g>
              );
            }
            const sw = (cache.w - 116) / 6;
            return (
              <g key={k}>
                <rect x={108 + k * sw} y={cache.h / 2 - 9} width={sw - 4} height={18} rx={3} className={css.cacheSlot} data-on={has} />
                <text className={css.cacheText} x={108 + k * sw + (sw - 4) / 2} y={cache.h / 2 + 3.5} textAnchor="middle" data-on={has}>
                  {has ? n.value : '·'}
                </text>
              </g>
            );
          })}
        </Card>
      )}
      {core && (
        <Card box={core} dim={dim('core')} glow={glow('core')}>
          <Title x={14} y={land ? 24 : 22} text="core 0" sub={land ? '4 GHz · 1 cycle = 0.25 ns' : undefined} />
          {!land && (
            <text className={stage.mono} x={core.w - 12} y={22} textAnchor="end">
              4 GHz
            </text>
          )}
          <Gauge x={14} y={land ? 62 : 38} w={core.w - 28} cycles={cycles} waiting={waiting} hit={W.hit} land={land} />
          {land && (
            <>
              <line x1={14} y1={core.h - 36} x2={core.w - 14} y2={core.h - 36} className={css.coreRule} />
              <text className={stage.mono} x={14} y={core.h - 16}>
                running total
              </text>
              <text className={css.coreSum} x={core.w - 14} y={core.h - 15} textAnchor="end">
                sum = {W.sum}
              </text>
            </>
          )}
        </Card>
      )}
    </g>
  );
}

function Gauge({ x, y, w, cycles, waiting, hit, land }: { x: number; y: number; w: number; cycles: number; waiting: boolean; hit: boolean; land: boolean }) {
  const f = clamp(cycles / 400, 0, 1);
  const color = hit ? SIG.res : SIG.err;
  return (
    <g transform={`translate(${x},${y})`}>
      <text className={stage.caps} x={0} y={0}>
        {waiting ? 'waiting on memory' : 'last load waited'}
      </text>
      <text className={css.gaugeNum} x={0} y={land ? 34 : 28} style={{ fill: waiting ? color : 'var(--text-1)', fontSize: land ? 30 : 22 }}>
        {cycles}
      </text>
      <text className={stage.mono} x={land ? 64 : 48} y={land ? 33 : 27}>
        {cycles === 1 ? 'cycle' : 'cycles'}
      </text>
      <rect x={0} y={land ? 44 : 35} width={w} height={6} rx={3} className={css.gaugeTrack} />
      <rect x={0} y={land ? 44 : 35} width={Math.max(0, w * f)} height={6} rx={3} fill={color} opacity={0.85} />
      {land && (
        <text className={stage.mono} x={w} y={62} textAnchor="end">
          400 cycles = 100 ns
        </text>
      )}
    </g>
  );
}

/**
 * The list's next pointers: dashed arrows hopping around RAM. Hops within a
 * column bulge outward; hops across snake through the gap between columns.
 */
function ListArrows({ sim, alpha }: { sim: CacheSim; alpha: number }) {
  const ram = sim.boxes.get('ram');
  const paths: ReactNode[] = [];
  for (let k = 0; k + 1 < LIST.length; k++) {
    const a = sim.boxes.get(`node:${k}`);
    const b = sim.boxes.get(`node:${k + 1}`);
    if (!a || !b || !ram) continue;
    const aRight = a.x > ram.x;
    const bRight = b.x > ram.x;
    let d: string;
    let ex: number;
    let dir: number;
    if (aRight === bRight) {
      const s = aRight ? 1 : -1;
      const sx = a.x + (s * a.w) / 2;
      ex = b.x + (s * b.w) / 2;
      const bulge = 14 + Math.abs(b.y - a.y) * 0.14;
      d = `M${sx},${a.y} C${sx + s * bulge},${a.y} ${ex + s * bulge},${b.y} ${ex},${b.y}`;
      dir = -s;
    } else {
      const s = aRight ? -1 : 1;
      const sx = a.x + (s * a.w) / 2;
      ex = b.x - (s * b.w) / 2;
      const k2 = Math.abs(ex - sx) * 0.6;
      d = `M${sx},${a.y} C${sx + s * k2},${a.y} ${ex - s * k2},${b.y} ${ex},${b.y}`;
      dir = s;
    }
    const ey = b.y;
    paths.push(
      <g key={k}>
        <path d={d} className={css.listArrow} />
        <polyline points={`${ex - dir * 6},${ey - 4} ${ex},${ey} ${ex - dir * 6},${ey + 4}`} className={css.listArrowHead} />
      </g>,
    );
  }
  return <g opacity={alpha}>{paths}</g>;
}

/* ================================================================== */
/* Chapter 2 and 6: the hierarchy, distances to scale                   */
/* ================================================================== */

const REGS = ['rax', 'rbx', 'rcx', 'rdx', 'rsi', 'rdi', 'rbp', 'rsp', 'r8', 'r9', 'r10', 'r11', 'r12', 'r13', 'r14', 'r15'];

function ChainScene({ sim, dim, glow, mini }: { sim: CacheSim; dim: Pred; glow: Pred; mini: boolean }) {
  const core = sim.boxes.get('core');
  const ram = sim.boxes.get('ram');
  const land = sim.orient === 'landscape';
  const small = !land || mini;
  const { x0, y } = sim.chain;
  const slabs = (['l1', 'l2', 'l3'] as const).map((id) => ({ id, b: sim.boxes.get(id) })).filter((s): s is { id: 'l1' | 'l2' | 'l3'; b: Box } => !!s.b);
  const active = sim.cfg.view === 'cliff' ? (sim.cl.busy ? sim.cl.level : null) : sim.lad.busy ? sim.lad.level : null;
  if (!core || !ram) return null;
  const top = Math.min(core.y - core.h / 2, ram.y - ram.h / 2);
  const bottom = Math.max(...slabs.map((s) => s.b.y + s.b.h / 2), ram.y + ram.h / 2);
  const alpha = core.alpha;
  // Fan-out labels under the slabs
  const labelY = bottom + (small ? 22 : 40);
  const spread = small ? (land ? 92 : Math.min(84, (ram.x - ram.w / 2 - x0) / 3)) : 118;
  const labelX = (i: number) => x0 + (small ? 22 : 30) + i * spread;
  const ramLeft = ram.x - ram.w / 2;
  return (
    <g opacity={alpha}>
      {/* the bus */}
      <line x1={x0} y1={y} x2={ramLeft} y2={y} className={css.bus} />
      {/* dimension line: round-trip latency, to scale */}
      {!mini && (
        <g className={css.dims}>
          <line x1={x0} y1={top - 22} x2={ramLeft} y2={top - 22} />
          <line x1={x0} y1={top - 28} x2={x0} y2={top - 10} />
          {[...slabs.map((s) => ({ x: s.b.x - s.b.w / 2, ns: LEVELS[s.id].ns })), { x: ramLeft, ns: LEVELS.ram.ns }].map((t) => (
            <g key={t.ns}>
              <line x1={t.x} y1={top - 28} x2={t.x} y2={top - 10} />
              <text
                x={t.ns === 1 ? t.x - 2 : t.ns === 4 ? t.x + 2 : t.x}
                y={top - 33}
                textAnchor={t.ns === 1 || t.ns === 100 ? 'end' : t.ns === 4 ? 'start' : 'middle'}
                className={css.dimText}
              >
                {t.ns === 100 ? (land ? '100 ns round trip' : '100 ns') : t.ns}
              </text>
            </g>
          ))}
        </g>
      )}
      {/* core */}
      <g opacity={dim('core') ? 0.28 : 1}>
        <Card box={core} glow={glow('core')}>
          <Title x={core.w / 2} y={small ? 18 : 22} text="core" anchor="middle" size={small ? 11.5 : undefined} />
          {!small && (
            <>
              <text className={stage.caps} x={core.w / 2} y={42} textAnchor="middle">
                registers
              </text>
              {REGS.map((r, i) => {
                const cw = (core.w - 24) / 4;
                const rx = 12 + (i % 4) * cw;
                const ry = 50 + Math.floor(i / 4) * 17;
                return (
                  <g key={r}>
                    <rect x={rx + 1} y={ry} width={cw - 2} height={14} rx={2} className={css.reg} />
                    <text x={rx + cw / 2} y={ry + 10} textAnchor="middle" className={css.regText}>
                      {r}
                    </text>
                  </g>
                );
              })}
              <text className={stage.mono} x={core.w / 2} y={core.h - 12} textAnchor="middle">
                ~0.3 ns
              </text>
            </>
          )}
          {small && (
            <text className={stage.mono} x={core.w / 2} y={core.h / 2 + 12} textAnchor="middle" style={{ fontSize: 8.5 }}>
              registers
            </text>
          )}
        </Card>
      </g>
      {/* slabs */}
      {slabs.map(({ id, b }) => {
        const c = LEVEL_COLOR[id];
        const on = active === id;
        return (
          <g key={id} opacity={dim(id) ? 0.28 : 1}>
            {glow(id) && <rect x={b.x - b.w / 2 - 5} y={b.y - b.h / 2 - 5} width={b.w + 10} height={b.h + 10} rx={5} fill="none" stroke="var(--accent)" strokeDasharray="3 3" strokeWidth={1.4} />}
            <rect x={b.x - b.w / 2} y={b.y - b.h / 2} width={b.w} height={b.h} rx={2.5} fill={c} fillOpacity={on ? 0.42 : 0.2} stroke={c} strokeWidth={on ? 1.8 : 1.1} />
          </g>
        );
      })}
      {/* fan-out labels */}
      {slabs.map(({ id, b }, i) => {
        const lx = labelX(i);
        const c = LEVEL_COLOR[id];
        const L = LEVELS[id];
        return (
          <g key={`lab-${id}`} opacity={dim(id) ? 0.28 : 1}>
            <path d={`M${b.x},${b.y + b.h / 2} L${b.x},${b.y + b.h / 2 + 8} L${lx},${labelY - (small ? 12 : 16)}`} className={css.leader} />
            <circle cx={b.x} cy={b.y + b.h / 2} r={2} fill={c} />
            <text x={lx} y={labelY} textAnchor="middle" className={css.levelName} style={{ fill: c, fontSize: small ? 11 : 13 }}>
              {L.name}
            </text>
            {!mini && (
              <text x={lx} y={labelY + (small ? 12 : 15)} textAnchor="middle" className={stage.mono} style={small ? { fontSize: 8.5 } : undefined}>
                {small ? `${L.ns} ns` : `${L.size} · ${L.range}`}
              </text>
            )}
            {!small && (
              <text x={lx} y={labelY + 28} textAnchor="middle" className={stage.mono} style={{ fontSize: 9 }}>
                {L.where}
              </text>
            )}
            {mini && (
              <text x={lx} y={labelY + 12} textAnchor="middle" className={stage.mono} style={{ fontSize: 8.5 }}>
                {L.ns} ns
              </text>
            )}
          </g>
        );
      })}
      {/* RAM */}
      <g opacity={dim('ram') ? 0.28 : 1}>
        <Card box={ram} glow={glow('ram')} tone={active === 'ram' ? SIG.heavy : undefined}>
          <Title x={ram.w / 2} y={small ? 18 : 24} text="RAM" anchor="middle" size={small ? 11.5 : undefined} />
          {!small && (
            <>
              {[0, 1, 2, 3].map((i) => (
                <rect key={i} x={22 + i * ((ram.w - 44) / 4)} y={48} width={(ram.w - 44) / 4 - 6} height={ram.h - 110} rx={2} className={css.chip} />
              ))}
              <text className={stage.mono} x={ram.w / 2} y={ram.h - 42} textAnchor="middle">
                16–64 GB
              </text>
              <text className={stage.mono} x={ram.w / 2} y={ram.h - 26} textAnchor="middle" style={{ fill: SIG.heavy }}>
                80–100 ns
              </text>
            </>
          )}
          {small && (
            <text className={stage.mono} x={ram.w / 2} y={ram.h / 2 + 12} textAnchor="middle" style={{ fontSize: 8.5, fill: SIG.heavy }}>
              100 ns
            </text>
          )}
        </Card>
      </g>
    </g>
  );
}

/* ================================================================== */
/* Chapter 6: latency vs working-set size                              */
/* ================================================================== */

let curveCache: { key: string; d: string } | null = null;

/** The latency curve's path; it only changes with the chart's size. */
function curvePath(sim: CacheSim, g: ChartGeo): string {
  const key = `${g.x}|${g.y}|${g.w}|${g.h}`;
  if (curveCache && curveCache.key === key) return curveCache.d;
  let d = '';
  for (let i = 0; i <= 240; i++) {
    const ws = 2 ** (12 + (18 * i) / 240);
    d += `${i ? 'L' : 'M'}${sim.chartX(ws, g).toFixed(1)},${sim.chartY(avgNs(ws), g).toFixed(1)} `;
  }
  curveCache = { key, d };
  return d;
}

function Chart({ sim }: { sim: CacheSim }) {
  const g = sim.chartGeo();
  const box = sim.boxes.get('chart');
  if (!g || !box) return null;
  const small = sim.orient !== 'landscape';
  const curveD = curvePath(sim, g);
  const bands: { id: LevelId; a: number; b: number }[] = [
    { id: 'l1', a: 2 ** 12, b: LEVELS.l1.bytes },
    { id: 'l2', a: LEVELS.l1.bytes, b: LEVELS.l2.bytes },
    { id: 'l3', a: LEVELS.l2.bytes, b: LEVELS.l3.bytes },
    { id: 'ram', a: LEVELS.l3.bytes, b: 2 ** 30 },
  ];
  const ws = sim.cfg.ws;
  const px = sim.chartX(ws, g);
  const ns = avgNs(ws);
  const py = sim.chartY(ns, g);
  const xt = small ? [2 ** 12, 2 ** 15, 2 ** 20, 2 ** 25, 2 ** 30] : [2 ** 12, 2 ** 15, 2 ** 18, 2 ** 20, 2 ** 23, 2 ** 25, 2 ** 28, 2 ** 30];
  const yt = [1, 3, 10, 30, 100];
  const labelLeft = px > g.x + g.w * 0.62;
  return (
    <g opacity={box.alpha}>
      {bands.map((b) => {
        const x1 = sim.chartX(b.a, g);
        const x2 = sim.chartX(b.b, g);
        const on = b.id === (ws <= LEVELS.l1.bytes ? 'l1' : ws <= LEVELS.l2.bytes ? 'l2' : ws <= LEVELS.l3.bytes ? 'l3' : 'ram');
        return (
          <g key={b.id}>
            <rect x={x1} y={g.y} width={x2 - x1} height={g.h} fill={LEVEL_COLOR[b.id]} opacity={on ? 0.1 : 0.035} />
            <text x={(x1 + x2) / 2} y={g.y + (small ? 13 : 16)} textAnchor="middle" className={css.bandText} style={{ fill: LEVEL_COLOR[b.id], opacity: on ? 1 : 0.7 }}>
              {b.id === 'ram' ? (small ? 'RAM' : 'RAM only') : small ? `in ${LEVELS[b.id].name}` : `fits in ${LEVELS[b.id].name}`}
            </text>
          </g>
        );
      })}
      {[LEVELS.l1.bytes, LEVELS.l2.bytes, LEVELS.l3.bytes].map((b) => (
        <line key={b} x1={sim.chartX(b, g)} y1={g.y} x2={sim.chartX(b, g)} y2={g.y + g.h} className={css.bandEdge} />
      ))}
      {/* axes */}
      <line x1={g.x} y1={g.y + g.h} x2={g.x + g.w} y2={g.y + g.h} className={css.axis} />
      <line x1={g.x} y1={g.y} x2={g.x} y2={g.y + g.h} className={css.axis} />
      {xt.map((t) => (
        <g key={t}>
          <line x1={sim.chartX(t, g)} y1={g.y + g.h} x2={sim.chartX(t, g)} y2={g.y + g.h + 4} className={css.axis} />
          <text x={sim.chartX(t, g)} y={g.y + g.h + (small ? 14 : 17)} textAnchor="middle" className={css.tick}>
            {fmtBytes(t)}
          </text>
        </g>
      ))}
      {yt.map((t) => (
        <g key={t}>
          <line x1={g.x - 4} y1={sim.chartY(t, g)} x2={g.x + g.w} y2={sim.chartY(t, g)} className={css.grid} />
          <text x={g.x - 7} y={sim.chartY(t, g) + 3.5} textAnchor="end" className={css.tick}>
            {t}
          </text>
        </g>
      ))}
      <text x={g.x - 7} y={g.y - 8} textAnchor="end" className={css.tick}>
        ns
      </text>
      {!small && (
        <text x={g.x} y={g.y + g.h + 36} className={css.axisText}>
          working set: the bytes your loop keeps touching (log scale) →
        </text>
      )}
      <path d={curveD} className={css.curve} />
      {/* marker */}
      <line x1={px} y1={g.y} x2={px} y2={g.y + g.h} className={css.marker} />
      <circle cx={px} cy={py} r={9} fill={SIG.warn} opacity={0.18} />
      <circle cx={px} cy={py} r={4.5} fill={SIG.warn} />
      <g transform={`translate(${labelLeft ? px - 10 : px + 10},${py - 14})`}>
        <text textAnchor={labelLeft ? 'end' : 'start'} className={css.markerText}>
          {fmtBytes(ws)} → {ns < 10 ? ns.toFixed(1) : Math.round(ns)} ns
        </text>
      </g>
    </g>
  );
}

/* ================================================================== */
/* Chapters 3–6: the array in RAM and the L1                            */
/* ================================================================== */

function GridScene({ sim, dim, glow }: { sim: CacheSim; dim: Pred; glow: Pred }) {
  const core = sim.boxes.get('core');
  const land = sim.orient === 'landscape';
  const m = sim.ma;
  const op = m.cur;
  const e = sim.cursor('a');
  let status = 'ready';
  if (op) status = op.kind === 'hit' ? `${sim.elemName(op.e)}: hit` : `${sim.elemName(op.e)}: waiting…`;
  else if (m.finished) status = 'pass done';
  else if (e != null) status = `next ${sim.elemName(e)}`;
  const stalled = !!op && op.kind !== 'hit';
  return (
    <g>
      <RamGrid sim={sim} mid="a" dim={dim('ram')} glow={glow('ram')} />
      <L1Box sim={sim} mid="a" dim={dim('l1')} glow={glow('l1')} />
      {core && (
        <Card box={core} dim={dim('core')} glow={glow('core')} tone={stalled ? 'rgba(255,154,60,0.8)' : undefined}>
          <Title x={12} y={land ? 25 : 20} text="core" />
          <text className={stage.mono} x={land ? 12 : 12} y={land ? 44 : 36} style={{ fill: stalled ? SIG.heavy : undefined, fontSize: land ? 10 : 8.5 }}>
            {land ? status : stalled ? 'stalled…' : status.replace(/^next /, '')}
          </text>
          {stalled && <circle cx={core.w - 12} cy={12} r={3.2} fill={SIG.heavy} />}
          {!stalled && <circle cx={core.w - 12} cy={12} r={3.2} fill={SIG.res} />}
        </Card>
      )}
      <FillFlights sim={sim} mid="a" />
    </g>
  );
}

function RaceScene({ sim, glow }: { sim: CacheSim; glow: Pred }) {
  return (
    <g>
      {(['a', 'b'] as const).map((mid) => (
        <g key={mid}>
          <RamGrid sim={sim} mid={mid} glow={glow(mid === 'a' ? 'ram' : 'ram:b')} />
          <L1Box sim={sim} mid={mid} glow={glow(mid === 'a' ? 'l1' : 'l1:b')} />
          <TimeBar sim={sim} mid={mid} />
          <FillFlights sim={sim} mid={mid} />
        </g>
      ))}
    </g>
  );
}

const ORDER_TITLE: Record<string, string> = {
  row: 'row by row',
  col: 'column by column',
  tile: 'columns, in tiles',
  random: 'random',
  reuse: 'the same few values',
  quiz: 'a mixed pattern',
  colquiz: 'column by column',
};

function TimeBar({ sim, mid }: { sim: CacheSim; mid: 'a' | 'b' }) {
  const ram = sim.boxes.get(mid === 'a' ? 'ram' : 'ram:b');
  const m = sim.machine(mid);
  if (!ram) return null;
  const land = sim.orient === 'landscape';
  const w = ram.w - 16;
  const x = ram.x - w / 2;
  const y = ram.y + ram.h / 2 + (land ? 22 : 12);
  const max = m.seq.length * 100;
  const f = clamp(m.ns / max, 0, 1);
  const done = m.finished;
  const other = sim.machine(mid === 'a' ? 'b' : 'a');
  const winner = done && (!other.finished || m.ns <= other.ns);
  return (
    <g opacity={ram.alpha}>
      <rect x={x} y={y} width={w} height={land ? 8 : 6} rx={3} className={css.gaugeTrack} />
      <rect x={x} y={y} width={Math.max(1, w * f)} height={land ? 8 : 6} rx={3} fill={mid === 'a' ? SIG.res : SIG.heavy} opacity={0.85} />
      <text x={x} y={y + (land ? 24 : 17)} className={css.timeText} style={land ? undefined : { fontSize: 9.5 }}>
        {fmtNs(m.ns, true)}
        {done ? '  ✓ done' : ''}
      </text>
      {winner && other.finished && (
        <text x={x + w} y={y + (land ? 24 : 17)} textAnchor="end" className={css.timeText} style={{ fill: SIG.res, fontSize: land ? undefined : 9.5 }}>
          {(other.ns / Math.max(1, m.ns)).toFixed(1)}× faster
        </text>
      )}
      {!land && null}
    </g>
  );
}

function RamGrid({ sim, mid, dim, glow }: { sim: CacheSim; mid: 'a' | 'b'; dim?: boolean; glow?: boolean }) {
  const box = sim.boxes.get(mid === 'a' ? 'ram' : 'ram:b');
  const g = sim.gridGeo(mid);
  const m = sim.machine(mid);
  if (!box || !g) return null;
  const land = sim.orient === 'landscape';
  const race = sim.cfg.view === 'race';
  const two = sim.cfg.dims === 2 || race;
  const cached = new Set(m.slots.filter((s) => s).map((s) => s!.line));
  const pending = new Map(m.fills.map((f) => [f.line, f]));
  const e = sim.cursor(mid);
  const op = m.cur;
  const vt = sim.vt;
  const evictedK = new Map<number, number>();
  for (const ev of m.evicted) {
    const k = 1 - (vt - ev.vt) / 0.9;
    if (k > 0) evictedK.set(ev.line, k);
  }
  const x0 = box.x - box.w / 2;
  const y0 = box.y - box.h / 2;
  const title = race ? (mid === 'a' ? 'sum_rows()' : 'sum_cols()') : two ? 'RAM · long a[8][16]' : 'RAM · long a[128]';
  const sub = race ? ORDER_TITLE[m.order] : land ? '8 bytes per value · 64-byte lines outlined' : undefined;
  const lines: ReactNode[] = [];
  for (let l = 0; l < m.numLines; l++) {
    const r = sim.lineRect(g, l);
    const f = pending.get(l);
    const ek = evictedK.get(l) ?? 0;
    const state = cached.has(l) ? 'cached' : f ? (f.pf ? 'pf' : 'fetch') : 'idle';
    lines.push(
      <g key={`L${l}`}>
        <rect x={r.x - 2.5} y={r.y - 2.5} width={r.w + 5} height={r.h + 5} rx={4} className={css.lineBox} data-state={state} />
        {ek > 0 && <rect x={r.x - 2.5} y={r.y - 2.5} width={r.w + 5} height={r.h + 5} rx={4} fill="none" stroke={SIG.err} strokeWidth={2} opacity={ek} />}
      </g>,
    );
  }
  const cells: ReactNode[] = [];
  for (let i = 0; i < m.n; i++) {
    const r = sim.cellRect(g, i);
    const line = m.lineOf(i);
    const inL1 = cached.has(line);
    cells.push(<rect key={i} x={r.x + 0.75} y={r.y + 0.75} width={r.w - 1.5} height={r.h - 1.5} rx={2} className={css.cell} data-v={m.visited[i] ? 1 : 0} data-c={inL1 ? 1 : 0} />);
  }
  let cursor: ReactNode = null;
  if (e != null) {
    const r = sim.cellRect(g, e);
    const waiting = !!op && op.kind !== 'hit';
    const pulse = waiting ? 0.5 + 0.5 * Math.sin(vt * 9) : 1;
    cursor = (
      <g>
        <rect x={r.x - 3} y={r.y - 3} width={r.w + 6} height={r.h + 6} rx={4} fill={SIG.warn} opacity={0.14 * pulse} />
        <rect x={r.x - 1} y={r.y - 1} width={r.w + 2} height={r.h + 2} rx={3} fill={waiting ? 'rgba(255,154,60,0.3)' : 'none'} stroke={SIG.warn} strokeWidth={2} />
      </g>
    );
  }
  const rowLabels: ReactNode[] = [];
  if (land && !race) {
    for (let r = 0; r < g.rows; r++) {
      const cr = sim.cellRect(g, r * g.cols);
      const top = two ? `i = ${r}` : `a[${r * g.cols}]`;
      rowLabels.push(
        <g key={r}>
          <text x={g.x0 - 12} y={cr.y + cr.h / 2 - (g.ch >= 24 ? 1 : -3)} textAnchor="end" className={css.rowLabel}>
            {top}
          </text>
          {g.ch >= 24 && (
            <text x={g.x0 - 12} y={cr.y + cr.h / 2 + 10} textAnchor="end" className={css.rowAddr}>
              {hex(0x1000 + r * g.cols * 8)}
            </text>
          )}
        </g>,
      );
    }
  }
  const colLabels: ReactNode[] = [];
  if (land && two && !race) {
    for (let c = 0; c < g.cols; c++) {
      const cr = sim.cellRect(g, c);
      colLabels.push(
        <text key={c} x={cr.x + cr.w / 2} y={g.y0 - 8} textAnchor="middle" className={css.colLabel}>
          {c}
        </text>,
      );
    }
  }
  return (
    <g opacity={box.alpha * (dim ? 0.28 : 1)}>
      <g transform={`translate(${x0},${y0})`}>
        {glow && <rect x={-6} y={-6} width={box.w + 12} height={box.h + 12} rx={14} fill="none" stroke="var(--accent)" strokeWidth={1.4} strokeDasharray="3 3" />}
        <rect className={stage.card} width={box.w} height={box.h} rx={10} />
        <text className={stage.name} x={12} y={land ? 20 : 15} style={land ? undefined : { fontSize: 11 }}>
          {title}
        </text>
        {sub && (
          <text className={stage.mono} x={box.w - 12} y={land ? 20 : 15} textAnchor="end" style={land ? undefined : { fontSize: 8.5 }}>
            {sub}
          </text>
        )}
        {land && two && !race && (
          <text className={css.colLabel} x={g.x0 - x0 - 12} y={g.y0 - y0 - 8} textAnchor="end">
            j →
          </text>
        )}
      </g>
      {lines}
      {cells}
      {rowLabels}
      {colLabels}
      {cursor}
    </g>
  );
}

function L1Box({ sim, mid, dim, glow }: { sim: CacheSim; mid: 'a' | 'b'; dim?: boolean; glow?: boolean }) {
  const box = sim.boxes.get(mid === 'a' ? 'l1' : 'l1:b');
  const sg = sim.slotGeo(mid);
  const m = sim.machine(mid);
  if (!box || !sg) return null;
  const land = sim.orient === 'landscape';
  const out = m.nextOut();
  const reserved = new Map(m.fills.map((f) => [f.slot, f]));
  const vt = sim.vt;
  const bytes = m.ways * 64;
  return (
    <g opacity={box.alpha * (dim ? 0.28 : 1)}>
      <g transform={`translate(${box.x - box.w / 2},${box.y - box.h / 2})`}>
        {glow && <rect x={-6} y={-6} width={box.w + 12} height={box.h + 12} rx={14} fill="none" stroke="var(--accent)" strokeWidth={1.4} strokeDasharray="3 3" />}
        <rect className={stage.card} width={box.w} height={box.h} rx={10} style={{ stroke: 'rgba(75,227,160,0.55)' }} />
        {!sg.horizontal && (
          <>
            <text className={stage.name} x={10} y={land ? 21 : 15} style={land ? undefined : { fontSize: 11 }}>
              L1 cache
            </text>
            <text className={stage.mono} x={box.w - 10} y={land ? 21 : 15} textAnchor="end" style={land ? undefined : { fontSize: 8.5 }}>
              {m.ways} lines · {bytes} B
            </text>
          </>
        )}
        {sg.horizontal && land && (
          <text className={stage.caps} x={box.w / 2} y={11} textAnchor="middle">
            L1 · {m.ways} lines
          </text>
        )}
      </g>
      {Array.from({ length: m.ways }, (_, i) => {
        const r = sim.slotRect(sg, i, m.ways);
        const s = m.slots[i];
        const f = reserved.get(i);
        const fresh = s ? clamp(1 - (vt - s.vt) / 0.7, 0, 1) : 0;
        const used = !!m.lastOp && s?.line === m.lastOp.line && vt - s.vt < 30 ? 1 : 0;
        const isOut = out === i && !f;
        return (
          <g key={i}>
            <rect x={r.x - 3} y={r.y - 3} width={r.w + 6} height={r.h + 6} rx={3.5} className={css.slotFrame} data-f={f ? (f.pf ? 'pf' : 'fetch') : undefined} data-out={isOut} />
            {s &&
              Array.from({ length: PER_LINE }, (_, k) => (
                <rect
                  key={k}
                  x={r.x + k * sg.cw + 0.5}
                  y={r.y + 0.5}
                  width={sg.cw - 1}
                  height={r.h - 1}
                  rx={1.5}
                  className={css.slotCell}
                  data-used={(s.used >> k) & 1}
                  data-pf={s.pf}
                />
              ))}
            {s && fresh > 0 && <rect x={r.x - 3} y={r.y - 3} width={r.w + 6} height={r.h + 6} rx={3.5} fill="none" stroke={s.pf ? SIG.hc : SIG.res} strokeWidth={2} opacity={fresh} />}
            {sg.tags && (
              <text x={r.x + r.w + 8} y={r.y + r.h / 2 + 3.5} className={css.slotTag} data-empty={!s} data-hot={used === 1 && !m.finished}>
                {s ? sim.lineName(s.line) : 'empty'}
              </text>
            )}
            {isOut && sg.tags && (
              <text x={box.x + box.w / 2 - 10} y={r.y + r.h / 2 + 3} textAnchor="end" className={css.outTag}>
                next out
              </text>
            )}
            {isOut && !sg.tags && <circle cx={r.x + r.w / 2} cy={r.y + r.h + (land ? 7 : 6)} r={2} fill={SIG.err} opacity={0.8} />}
          </g>
        );
      })}
    </g>
  );
}

/** Lines on the move: a request dot out to RAM, then the 8-value line flying into its slot. */
function FillFlights({ sim, mid }: { sim: CacheSim; mid: 'a' | 'b' }) {
  const m = sim.machine(mid);
  const g = sim.gridGeo(mid);
  const sg = sim.slotGeo(mid);
  const l1 = sim.boxes.get(mid === 'a' ? 'l1' : 'l1:b');
  if (!g || !sg || !l1 || !m.fills.length) return null;
  const land = sim.orient === 'landscape';
  const race = sim.cfg.view === 'race';
  const out: ReactNode[] = [];
  for (const f of m.fills) {
    const p = clamp((sim.t - f.t0) / Math.max(1e-6, f.t1 - f.t0), 0, 1);
    const color = f.pf ? SIG.hc : SIG.res;
    const lr = sim.lineRect(g, f.line);
    const sr = sim.slotRect(sg, f.slot, m.ways);
    const split = 0.42;
    if (p < split) {
      const u = smoothstep(p / split);
      // Leave the L1 on the side facing RAM
      const sx = race || !land ? l1.x : l1.x + l1.w / 2;
      const sy = race || !land ? l1.y + l1.h / 2 : l1.y;
      const ex = lr.x + lr.w / 2;
      const ey = lr.y + lr.h / 2;
      const x = sx + (ex - sx) * u;
      const y = sy + (ey - sy) * u - Math.sin(Math.PI * u) * (land && !race ? 26 : 10);
      const tail = Math.max(0, u - 0.08);
      const tx = sx + (ex - sx) * tail;
      const ty = sy + (ey - sy) * tail - Math.sin(Math.PI * tail) * (land && !race ? 26 : 10);
      out.push(
        <g key={`q${f.line}`}>
          <line x1={tx} y1={ty} x2={x} y2={y} stroke={f.pf ? SIG.hc : SIG.req} strokeWidth={5} strokeLinecap="round" opacity={0.26} />
          <circle cx={x} cy={y} r={10} fill={f.pf ? SIG.hc : SIG.req} opacity={0.13} />
          <circle cx={x} cy={y} r={4} fill={f.pf ? SIG.hc : SIG.req} />
        </g>,
      );
    } else {
      const u = smoothstep((p - split) / (1 - split));
      const w = lr.w + (sr.w - lr.w) * u;
      const h = lr.h + (sr.h - lr.h) * u;
      const cxp = lr.x + lr.w / 2 + (sr.x + sr.w / 2 - (lr.x + lr.w / 2)) * u;
      const cyp = lr.y + lr.h / 2 + (sr.y + sr.h / 2 - (lr.y + lr.h / 2)) * u - Math.sin(Math.PI * u) * (land && !race ? 30 : 12);
      const cwv = w / PER_LINE;
      out.push(
        <g key={`s${f.line}`}>
          <rect x={cxp - w / 2 - 4} y={cyp - h / 2 - 4} width={w + 8} height={h + 8} rx={4} fill={color} opacity={0.12} />
          {Array.from({ length: PER_LINE }, (_, k) => (
            <rect key={k} x={cxp - w / 2 + k * cwv + 0.5} y={cyp - h / 2} width={Math.max(0.5, cwv - 1)} height={h} rx={1.5} fill={color} opacity={0.85} />
          ))}
        </g>,
      );
    }
  }
  return <g>{out}</g>;
}

/* ================================================================== */
/* Chapter 7: two cores, private L1s, a shared L3                       */
/* ================================================================== */

function CoresScene({ sim, dim, glow }: { sim: CacheSim; dim: Pred; glow: Pred }) {
  const land = sim.orient === 'landscape';
  const mode = sim.cfg.cores;
  const C = sim.co;
  const c0 = sim.boxes.get('core');
  const c1 = sim.boxes.get('core:1');
  const l1a = sim.boxes.get('l1');
  const l1b = sim.boxes.get('l1:1');
  const l3 = sim.boxes.get('l3');
  const ram = sim.boxes.get('ram');
  const coreSub = (i: 0 | 1) => (mode === 'coherence' ? (i === 0 ? 'reads, then writes x' : 'reads x') : i === 0 ? 'thread 0: a++' : 'thread 1: b++');
  const coreCard = (b: Box | undefined, i: 0 | 1, id: string) =>
    b && (
      <Card box={b} dim={dim(id)} glow={glow(id)}>
        <Title x={12} y={land ? 26 : 20} text={`core ${i}`} size={land ? undefined : 11} />
        <text className={stage.mono} x={12} y={land ? 43 : 35} style={land ? undefined : { fontSize: 8.5 }}>
          {coreSub(i)}
        </text>
        {mode !== 'coherence' && (
          <text className={css.counter} x={b.w - 12} y={b.h / 2 + (land ? 7 : 5)} textAnchor="end" style={{ fill: i === 0 ? SIG.pink : SIG.teal, fontSize: land ? 19 : 13 }}>
            {i === 0 ? 'a' : 'b'} = {C.cnt[i]}
          </text>
        )}
      </Card>
    );
  const l1Card = (b: Box | undefined, i: 0 | 1, id: string) => {
    if (!b) return null;
    const pad = 12;
    const badge = land ? 26 : 20;
    const cw = (b.w - pad * 2 - badge - 10) / 8;
    const stripY = land ? 42 : 30;
    const sh = land ? 28 : 22;
    const state: Mesi = mode === 'padded' ? (i === 0 ? C.mesi[0] : C.mesiB[1]) : C.mesi[i];
    const kind = mode === 'coherence' ? 'x' : mode === 'packed' ? 'ab' : i === 0 ? 'a' : 'b';
    const val = mode === 'coherence' ? (i === 0 ? C.x.c0 : C.x.c1) : null;
    const had = C.had[i];
    let note = MESI_NAME[state];
    if (state === 'I') note = had ? (land ? 'Invalid · copy thrown out' : 'Invalid · dropped') : 'Invalid · no copy';
    else if (mode === 'coherence' && val != null) note = `${MESI_NAME[state]} · x = ${val}`;
    else if (mode === 'padded') note = land ? 'Modified · stays here' : 'Modified';
    return (
      <Card box={b} dim={dim(id)} glow={glow(id)} tone="rgba(75,227,160,0.5)">
        <Title x={12} y={land ? 23 : 17} text={`L1 · core ${i}`} size={land ? undefined : 10.5} />
        {land && (
          <text className={stage.mono} x={b.w - 12} y={23} textAnchor="end">
            private
          </text>
        )}
        <LineStrip x={pad} y={stripY} cw={cw} h={sh} kind={kind} state={state} struck={state === 'I' && had} />
        <MesiBadge x={b.w - pad - badge} y={stripY} w={badge} h={sh} state={state} />
        <text className={css.mesiName} x={pad} y={stripY + sh + (land ? 20 : 16)} style={{ fill: MESI_COLOR[state], fontSize: land ? undefined : 8 }}>
          {note}
        </text>
      </Card>
    );
  };
  return (
    <g>
      {ram && (
        <Card box={ram} dim={dim('ram')} glow={glow('ram')}>
          <text className={stage.name} x={12} y={ram.h / 2 + 4} style={land ? undefined : { fontSize: 11 }}>
            RAM
          </text>
          <text className={stage.mono} x={ram.w - 12} y={ram.h / 2 + 4} textAnchor="end">
            {mode === 'coherence' ? `x = ${C.x.ram}${C.mesi.includes('M') ? ' (stale)' : ''}` : '~100 ns away'}
          </text>
        </Card>
      )}
      {l3 && (
        <Card box={l3} dim={dim('l3')} glow={glow('l3')}>
          <Title x={12} y={land ? 22 : 17} text="L3 · shared by all cores" size={land ? undefined : 11} />
          <text className={stage.mono} x={l3.w - 12} y={land ? 22 : 17} textAnchor="end" style={land ? undefined : { fontSize: 8.5 }}>
            {mode === 'coherence' ? (C.l3 ? 'tracks who holds x' : 'x not cached yet') : 'directs line transfers'}
          </text>
          <Holders sim={sim} x={12} y={land ? 40 : 30} w={l3.w - 24} land={land} />
        </Card>
      )}
      {coreCard(c0, 0, 'core')}
      {coreCard(c1, 1, 'core:1')}
      {l1Card(l1a, 0, 'l1')}
      {l1Card(l1b, 1, 'l1:1')}
    </g>
  );
}

function Holders({ sim, x, y, w, land }: { sim: CacheSim; x: number; y: number; w: number; land: boolean }) {
  const C = sim.co;
  const mode = sim.cfg.cores;
  const items: { label: string; state: Mesi }[] =
    mode === 'padded'
      ? [
          { label: 'line A (a) → core 0', state: 'M' },
          { label: 'line B (b) → core 1', state: 'M' },
        ]
      : [
          { label: 'core 0', state: C.mesi[0] },
          { label: 'core 1', state: C.mesi[1] },
        ];
  const colW = w / 2;
  return (
    <g transform={`translate(${x},${y})`}>
      {items.map((it, i) => (
        <g key={it.label} transform={`translate(${i * colW},0)`}>
          <rect width={land ? 18 : 15} height={land ? 18 : 15} rx={4} fill={MESI_COLOR[it.state]} fillOpacity={0.16} stroke={MESI_COLOR[it.state]} />
          <text x={land ? 9 : 7.5} y={land ? 13 : 11} textAnchor="middle" className={css.mesiLetter} style={{ fill: MESI_COLOR[it.state], fontSize: land ? 11 : 9.5 }}>
            {it.state}
          </text>
          <text x={land ? 26 : 21} y={land ? 13 : 11} className={stage.mono} style={land ? undefined : { fontSize: 8.5 }}>
            {mode === 'padded' ? it.label : `${it.label}: ${MESI_NAME[it.state].toLowerCase()}`}
          </text>
        </g>
      ))}
    </g>
  );
}

/** One 64-byte line as 8 cells. The variables the story is about are colored; padding is hatched. */
function LineStrip({ x, y, cw, h, kind, state, struck }: { x: number; y: number; cw: number; h: number; kind: 'x' | 'ab' | 'a' | 'b'; state: Mesi; struck: boolean }) {
  const invalid = state === 'I';
  const cells: ReactNode[] = [];
  for (let k = 0; k < 8; k++) {
    let label = '';
    let color: string | null = null;
    const pad = (kind === 'a' || kind === 'b') && k > 0;
    if (kind === 'x' && k === 0) {
      label = 'x';
      color = SIG.text;
    } else if (kind === 'ab' && k < 2) {
      label = k === 0 ? 'a' : 'b';
      color = k === 0 ? SIG.pink : SIG.teal;
    } else if ((kind === 'a' || kind === 'b') && k === 0) {
      label = kind;
      color = kind === 'a' ? SIG.pink : SIG.teal;
    }
    cells.push(
      <g key={k}>
        <rect x={x + k * cw + 0.5} y={y} width={cw - 1} height={h} rx={2} className={css.coCell} style={color && !invalid ? { fill: color, fillOpacity: 0.16, stroke: color } : undefined} />
        {pad && <rect x={x + k * cw + 0.5} y={y} width={cw - 1} height={h} rx={2} fill="url(#kit-hatch-dim)" />}
        {label && (
          <text x={x + k * cw + cw / 2} y={y + h / 2 + 4} textAnchor="middle" className={css.coCellText} style={{ fill: invalid ? 'var(--text-3)' : (color ?? undefined) }}>
            {label}
          </text>
        )}
      </g>,
    );
  }
  return (
    <g opacity={invalid ? 0.42 : 1}>
      {cells}
      {struck && <line x1={x - 3} y1={y + h / 2} x2={x + 8 * cw + 3} y2={y + h / 2} stroke={SIG.err} strokeWidth={1.4} opacity={0.85} />}
    </g>
  );
}

function MesiBadge({ x, y, w, h, state }: { x: number; y: number; w: number; h: number; state: Mesi }) {
  const c = MESI_COLOR[state];
  return (
    <g transform={`translate(${x},${y})`}>
      <rect width={w} height={h} rx={5} fill={c} fillOpacity={0.16} stroke={c} strokeWidth={1.2} />
      <text x={w / 2} y={h / 2 + 4.5} textAnchor="middle" className={css.mesiLetter} style={{ fill: c }}>
        {state}
      </text>
    </g>
  );
}

