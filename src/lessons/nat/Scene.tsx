'use client';

import type { ReactNode } from 'react';
import { Effects, Flights } from '@/components/stage/svg';
import stage from '@/components/stage/stage.module.css';
import { SIG } from '@/lib/sim/colors';
import { clamp } from '@/lib/sim/geometry';
import type { Box } from '@/lib/sim/Sim';
import { bitX, bitsGeo, cellXY, dividerX, mapGeo, rowY, v6BitX, v6Geo, type BitsGeo } from './geo';
import { bcastOf, bitAt, intToIp, ipToInt, maskOf, netOf, octets, PLACES, placeSum, v6Bit, v6Compress, v6Groups } from './ip';
import { FILL_DUR, FILL_ORDER, FILL_START, LAST_BLOCKS, blockKind, type BitRow, type Glyph, type NatSim } from './sim';
import css from './nat.module.css';

export const NET = SIG.blue;
export const HOST = SIG.lime;
export const PRIV = SIG.teal;

const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(' ');

export function Scene({ sim, highlight }: { sim: NatSim; highlight: string | null }) {
  const hl = highlight ?? '';
  if (sim.cfg.view === 'bits') return sim.cfg.v6 ? <V6Scene sim={sim} hl={hl} /> : <BitsScene sim={sim} hl={hl} />;
  if (sim.cfg.view === 'map') return <MapScene sim={sim} hl={hl} />;
  return <NetScene sim={sim} hl={hl} />;
}

/* ================================================================== */
/* Bits                                                                */
/* ================================================================== */

type Part = 'plain' | 'net' | 'host' | 'off';

function cellColors(part: Part, bit: number) {
  if (part === 'plain') {
    return bit
      ? { fill: 'rgba(69,213,255,0.17)', stroke: 'rgba(69,213,255,0.62)', text: SIG.text }
      : { fill: 'rgba(143,166,201,0.04)', stroke: 'rgba(143,166,201,0.24)', text: SIG.dim };
  }
  if (part === 'off') return { fill: 'rgba(143,166,201,0.03)', stroke: 'rgba(143,166,201,0.2)', text: SIG.dim };
  const c = part === 'net' ? '147,165,255' : '196,242,90';
  return bit
    ? { fill: `rgba(${c},0.24)`, stroke: `rgba(${c},0.8)`, text: SIG.text }
    : { fill: `rgba(${c},0.06)`, stroke: `rgba(${c},0.34)`, text: `rgba(${c},0.62)` };
}

const ROW_NAME: Record<BitRow, string> = { addr: 'address', mask: 'mask', net: 'network', bcast: 'broadcast' };

function rowValue(row: BitRow, addr: number, prefix: number) {
  if (row === 'addr') return addr;
  if (row === 'mask') return maskOf(prefix);
  if (row === 'net') return netOf(addr, prefix);
  return bcastOf(addr, prefix);
}

/** Which octet the "how binary works" walkthrough is pointing at, or -1. */
export function focusOctet(sim: NatSim): number {
  if (!sim.cfg.places) return -1;
  if (sim.lastFlip != null && sim.vt - sim.flipVt[sim.lastFlip] < 5) return Math.floor(sim.lastFlip / 8);
  const k = Math.floor((sim.stepT - 0.8) / 1.9);
  if (k < 0) return -1;
  const m = k % 5;
  return m < 4 ? m : -1;
}

function BitsScene({ sim, hl }: { sim: NatSim; hl: string }) {
  const land = sim.orient === 'landscape';
  const g = bitsGeo(sim.w, sim.h, land);
  const c = sim.cfg;
  const t = sim.stepT;
  const split = c.rows.length > 1;
  const P = sim.prefix;
  const addr = sim.addr;
  const maskIn = c.andAnim ? clamp((t - 0.5) / 0.5, 0, 1) : 1;
  const sweep = c.andAnim ? clamp((t - 1.5) / 2.0, 0, 1) : 1;
  const sweepBit = sweep * 32;
  const netIn = c.andAnim ? clamp((t - 1.3) / 0.3, 0, 1) : 1;
  const fo = focusOctet(sim);
  const lastRow = c.rows.length - 1;
  const bottom = rowY(g, lastRow) + g.ch;
  const hlNet = hl === 'bits:net';
  const hlHost = hl === 'bits:host';
  const oc = octets(addr);
  const digit = land ? Math.min(13, g.cell * 0.62) : 8.5;

  return (
    <g>
      {/* The address in dotted decimal */}
      <text className={css.bigAddr} x={sim.w / 2} y={g.addrY} textAnchor="middle" style={{ fontSize: land ? 44 : 27 }}>
        {oc.map((o, k) => (
          <tspan key={k} fill={fo === k ? SIG.warn : split ? (k * 8 + 8 <= P ? NET : k * 8 >= P ? HOST : SIG.text) : SIG.text}>
            {o}
            {k < 3 ? <tspan fill={SIG.dim}>.</tspan> : null}
          </tspan>
        ))}
        {split && <tspan fill={SIG.warn}>/{P}</tspan>}
      </text>

      {/* Sweep highlight for the AND */}
      {c.andAnim && sweep > 0 && sweep < 1 && (
        <rect
          x={bitX(g, Math.min(31, Math.floor(sweepBit))) - 2}
          y={rowY(g, 0) - 6}
          width={g.cell + 4}
          height={rowY(g, 2) + g.ch - rowY(g, 0) + 12}
          rx={4}
          fill="rgba(255,210,63,0.12)"
          stroke="rgba(255,210,63,0.6)"
        />
      )}

      {c.rows.map((row, ri) => {
        const y = rowY(g, ri);
        const val = rowValue(row, addr, P);
        const vis = row === 'mask' ? maskIn : row === 'net' ? netIn : 1;
        if (vis <= 0) return null;
        return (
          <g key={row} opacity={vis}>
            <RowLabel g={g} y={y} name={ROW_NAME[row]} value={row === 'addr' || !c.andAnim || row !== 'net' || sweep >= 1 ? intToIp(val) : '…'} land={land} />
            {Array.from({ length: 32 }, (_, i) => {
              if (row === 'net' && c.andAnim && i >= sweepBit) return null;
              const bit = bitAt(val, i);
              const isNet = i < P;
              let part: Part = 'plain';
              if (split) part = row === 'mask' ? (isNet ? 'net' : 'off') : isNet ? 'net' : 'host';
              const col = cellColors(part, bit);
              const x = bitX(g, i);
              const flash = row === 'addr' ? clamp(1 - (sim.vt - sim.flipVt[i]) / 0.7, 0, 1) : 0;
              const inFocus = row === 'addr' && fo === Math.floor(i / 8);
              const glowPart = (hlNet && isNet) || (hlHost && !isNet && split);
              const clickable = row === 'addr' && c.flip;
              return (
                <g key={i} className={clickable ? css.bitClick : undefined} onClick={clickable ? () => sim.flipBit(i) : undefined} role={clickable ? 'button' : undefined} aria-label={clickable ? `Flip bit ${i + 1}` : undefined}>
                  {clickable && <rect x={x - 1} y={y - 3} width={g.cell + 2} height={g.ch + 6} fill="transparent" />}
                  <rect
                    className={css.bitCell}
                    x={x}
                    y={y}
                    width={g.cell}
                    height={g.ch}
                    rx={land ? 3 : 2}
                    fill={col.fill}
                    stroke={flash > 0.01 ? SIG.warn : inFocus || glowPart ? SIG.warn : col.stroke}
                    strokeWidth={flash > 0.01 || inFocus || glowPart ? 1.5 : 1}
                  />
                  {flash > 0.01 && <rect x={x - 3} y={y - 3} width={g.cell + 6} height={g.ch + 6} rx={5} fill="none" stroke={SIG.warn} strokeOpacity={flash} strokeWidth={2} />}
                  <text className={css.bitDigit} x={x + g.cell / 2} y={y + g.ch / 2 + digit * 0.36} textAnchor="middle" fill={col.text} style={{ fontSize: digit }}>
                    {bit}
                  </text>
                </g>
              );
            })}
            {/* octet values above the address row */}
            {row === 'addr' &&
              [0, 1, 2, 3].map((k) => {
                const x = (bitX(g, k * 8) + bitX(g, k * 8 + 7) + g.cell) / 2;
                return (
                  <text key={k} className={css.octet} x={x} y={y - (land ? 9 : 6)} textAnchor="middle" fill={fo === k ? SIG.warn : SIG.text2} style={{ fontSize: land ? 12 : 9.5 }}>
                    {oc[k]}
                  </text>
                );
              })}
          </g>
        );
      })}

      {/* AND operator between mask and network rows */}
      {c.andAnim && c.rows.includes('net') && land && netIn > 0 && (
        <text className={css.andOp} x={bitX(g, 0) - 12} y={rowY(g, 2) - g.rowGap / 2 + 13} textAnchor="end" opacity={netIn}>
          AND ↓
        </text>
      )}

      {/* place values under the address row */}
      {c.places && land && (
        <g>
          {Array.from({ length: 32 }, (_, i) => (
            <text key={i} className={css.place} x={bitX(g, i) + g.cell / 2} y={rowY(g, 0) + g.ch + 13} textAnchor="middle" fill={fo === Math.floor(i / 8) ? SIG.warn : SIG.dim}>
              {PLACES[i % 8]}
            </text>
          ))}
        </g>
      )}
      {c.places && fo >= 0 && (
        <text className={css.sumLine} x={sim.w / 2} y={rowY(g, 0) + g.ch + (land ? 46 : 28)} textAnchor="middle" style={land ? undefined : { fontSize: 11.5 }}>
          <tspan fill={SIG.text2}>{oc[fo].toString(2).padStart(8, '0')}</tspan>
          {placeSum(oc[fo]).includes('+') && (
            <>
              <tspan fill={SIG.dim}> = </tspan>
              <tspan fill={SIG.text}>{placeSum(oc[fo])}</tspan>
            </>
          )}
          <tspan fill={SIG.dim}> = </tspan>
          <tspan fill={SIG.warn}>{oc[fo]}</tspan>
        </text>
      )}

      {/* the network / host divider */}
      {split && maskIn > 0 && <Divider g={g} x={dividerX(g, sim.prefixVis)} top={rowY(g, 0) - (land ? 30 : 22)} bottom={bottom + 8} label={`/${P}`} opacity={maskIn} />}

      {/* brackets naming the two parts */}
      {split && (!c.andAnim || sweep >= 1) && <Brackets g={g} y={bottom + (land ? 22 : 16)} P={P} dv={dividerX(g, sim.prefixVis)} land={land} hl={hl} />}
    </g>
  );
}

function RowLabel({ g, y, name, value, land }: { g: BitsGeo; y: number; name: string; value: string; land: boolean }) {
  if (land) {
    return (
      <g>
        <text className={css.rowName} x={g.x0 - 18} y={y + 11} textAnchor="end">
          {name}
        </text>
        <text className={css.rowVal} x={g.x0 - 18} y={y + 26} textAnchor="end">
          {value}
        </text>
      </g>
    );
  }
  return (
    <g>
      <text className={css.rowName} x={g.x0} y={y - 6}>
        {name}
      </text>
      <text className={css.rowVal} x={g.x0 + g.totalW} y={y - 6} textAnchor="end" style={{ fontSize: 10 }}>
        {value}
      </text>
    </g>
  );
}

function Divider({ g, x, top, bottom, label, opacity }: { g: BitsGeo; x: number; top: number; bottom: number; label: string; opacity: number }) {
  const w = label.length * (g.land ? 8 : 7) + 14;
  return (
    <g opacity={opacity}>
      <line x1={x} y1={top + 8} x2={x} y2={bottom} stroke={SIG.warn} strokeWidth={1.4} strokeDasharray="4 4" />
      <rect x={x - w / 2} y={top - 9} width={w} height={g.land ? 19 : 16} rx={g.land ? 9.5 : 8} fill={SIG.warn} />
      <text className={css.divLabel} x={x} y={top + (g.land ? 4.5 : 3)} textAnchor="middle" style={{ fontSize: g.land ? 11.5 : 10 }}>
        {label}
      </text>
    </g>
  );
}

function Brackets({ g, y, P, dv, land, hl }: { g: BitsGeo; y: number; P: number; dv: number; land: boolean; hl: string }) {
  const x0 = bitX(g, 0);
  const x1 = bitX(g, 31) + g.cell;
  const parts: { a: number; b: number; color: string; text: string; key: string }[] = [];
  if (P > 0) parts.push({ a: x0, b: dv - 5, color: NET, text: land ? `network · ${P} bit${P === 1 ? '' : 's'}` : `net ${P}`, key: 'bits:net' });
  if (P < 32) parts.push({ a: dv + 5, b: x1, color: HOST, text: land ? `host · ${32 - P} bit${32 - P === 1 ? '' : 's'}` : `host ${32 - P}`, key: 'bits:host' });
  return (
    <g>
      {parts.map((p) => {
        const wide = p.b - p.a > (land ? 70 : 34);
        return (
          <g key={p.key} opacity={hl && hl !== p.key && hl.startsWith('bits:') ? 0.45 : 1}>
            <path d={`M${p.a},${y - 6} V${y} H${p.b} V${y - 6}`} fill="none" stroke={p.color} strokeWidth={1.3} />
            {wide && (
              <text className={css.bracket} x={(p.a + p.b) / 2} y={y + (land ? 15 : 12)} textAnchor="middle" fill={p.color}>
                {p.text}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}

/* ---------------- IPv6 ---------------- */

export const V6_FULL = '2001:0db8:4f3a:0010:8d1c:4b2e:9a07:5e13';

function V6Scene({ sim, hl }: { sim: NatSim; hl: string }) {
  const land = sim.orient === 'landscape';
  const g = v6Geo(sim.w, sim.h, land);
  const groups = v6Groups(V6_FULL);
  const t = sim.stepT;
  const hex = V6_FULL.split(':');
  const reveal = clamp(t / 1.6, 0, 1);
  const shown = Math.floor(reveal * 128);
  const v4 = ipToInt('203.0.113.7');
  return (
    <g>
      <text className={css.bigAddr} x={sim.w / 2} y={g.addrY} textAnchor="middle" style={{ fontSize: land ? 28 : 13.5 }}>
        <tspan fill={NET}>{v6Compress(groups.slice(0, 4)).replace(/::$/, '')}</tspan>
        <tspan fill={SIG.dim}>:</tspan>
        <tspan fill={HOST}>{groups.slice(4).map((x) => x.toString(16)).join(':')}</tspan>
        <tspan fill={SIG.warn}>/64</tspan>
      </text>
      <text className={css.caption} x={sim.w / 2} y={g.addrY + (land ? 26 : 19)} textAnchor="middle">
        8 groups of 16 bits · 128 bits · written in hex
      </text>

      {land && (
        <g>
          <text className={css.rowName} x={g.x0 - 18} y={g.top - 58} textAnchor="end">
            IPv4
          </text>
          <text className={css.rowVal} x={g.x0 - 18} y={g.top - 44} textAnchor="end" style={{ fontSize: 10.5 }}>
            all 32 bits
          </text>
          {Array.from({ length: 32 }, (_, i) => {
            const b = bitAt(v4, i);
            const x = g.x0 + i * g.pitch + (i >= 16 ? g.gap : 0);
            return <rect key={i} x={x} y={g.top - 66} width={g.cell} height={14} rx={2} fill={b ? 'rgba(143,166,201,0.3)' : 'rgba(143,166,201,0.06)'} stroke="rgba(143,166,201,0.3)" />;
          })}
        </g>
      )}

      {Array.from({ length: g.lines }, (_, li) => {
        const y = g.top + li * g.lineGap;
        return (
          <g key={li}>
            {Array.from({ length: g.per }, (_, j) => {
              const i = li * g.per + j;
              if (i >= shown) return null;
              const b = v6Bit(groups, i);
              const part: Part = i < 64 ? 'net' : 'host';
              const col = cellColors(part, b);
              const x = v6BitX(g, j);
              const glow = (hl === 'v6:net' && i < 64) || (hl === 'v6:host' && i >= 64);
              return (
                <g key={j}>
                  <rect x={x} y={y} width={g.cell} height={g.ch} rx={2} fill={col.fill} stroke={glow ? SIG.warn : col.stroke} strokeWidth={glow ? 1.4 : 1} />
                  {g.cell >= 12 && (
                    <text className={css.bitDigit} x={x + g.cell / 2} y={y + g.ch / 2 + 3.4} textAnchor="middle" fill={col.text} style={{ fontSize: 9.5 }}>
                      {b}
                    </text>
                  )}
                </g>
              );
            })}
            {/* hex label for each 16-bit group */}
            {land
              ? [0, 1].map((k) => {
                  const gi = li * 2 + k;
                  const xa = v6BitX(g, k * 16);
                  const xb = v6BitX(g, k * 16 + 15) + g.cell;
                  return (
                    <text key={k} className={css.octet} x={(xa + xb) / 2} y={y - 7} textAnchor="middle" fill={gi < 4 ? NET : HOST} style={{ fontSize: 12 }}>
                      {hex[gi]}
                    </text>
                  );
                })
              : (
                  <text className={css.octet} x={g.x0 - 8} y={y + g.ch / 2 + 4} textAnchor="end" fill={li < 4 ? NET : HOST} style={{ fontSize: 10.5 }}>
                    {hex[li]}
                  </text>
                )}
          </g>
        );
      })}

      {/* brackets: network prefix and interface ID */}
      {land ? (
        <g>
          {[
            { a: 0, b: 1, color: NET, t1: 'network prefix', t2: 'first 64 bits', key: 'v6:net' },
            { a: 2, b: 3, color: HOST, t1: 'interface ID', t2: 'last 64 bits', key: 'v6:host' },
          ].map((p) => {
            const y0 = g.top + p.a * g.lineGap;
            const y1 = g.top + p.b * g.lineGap + g.ch;
            const x = g.x0 - 16;
            return (
              <g key={p.key}>
                <path d={`M${x + 6},${y0} H${x} V${y1} H${x + 6}`} fill="none" stroke={p.color} strokeWidth={1.3} />
                <text className={css.bracket} x={x - 8} y={(y0 + y1) / 2 - 2} textAnchor="end" fill={p.color}>
                  {p.t1}
                </text>
                <text className={css.bracketDim} x={x - 8} y={(y0 + y1) / 2 + 12} textAnchor="end">
                  {p.t2}
                </text>
              </g>
            );
          })}
        </g>
      ) : (
        <g>
          <text className={css.bracket} x={g.x0} y={g.top + 8 * g.lineGap + 6} fill={NET}>
            ■ prefix · 64
          </text>
          <text className={css.bracket} x={g.x0 + g.totalW} y={g.top + 8 * g.lineGap + 6} textAnchor="end" fill={HOST}>
            interface ID · 64 ■
          </text>
        </g>
      )}
    </g>
  );
}

/* ================================================================== */
/* The /8 map                                                          */
/* ================================================================== */

function MapScene({ sim, hl }: { sim: NatSim; hl: string }) {
  const land = sim.orient === 'landscape';
  const g = mapGeo(sim.w, sim.h, land);
  const mode = sim.cfg.map;
  const t = sim.stepT;
  const per = FILL_DUR / FILL_ORDER.length;
  const fillAt = new Map<number, number>();
  FILL_ORDER.forEach((n, i) => fillAt.set(n, FILL_START + i * per));
  const cells: ReactNode[] = [];
  for (let n = 0; n < 256; n++) {
    const { x, y } = cellXY(g, n);
    const kind = blockKind(n);
    const s = g.cell;
    let fill = 'rgba(143,166,201,0.03)';
    let stroke = 'rgba(143,166,201,0.2)';
    let hatch = false;
    let flash = 0;
    let labelColor: string = SIG.dim;
    if (kind === 'unicast') {
      const at = fillAt.get(n) ?? 0;
      const done = mode === 'private' || t >= at;
      if (done) {
        fill = 'rgba(143,166,201,0.26)';
        stroke = 'rgba(143,166,201,0.5)';
        labelColor = SIG.text2;
        if (mode === 'fill') flash = clamp(1 - (t - at) / 0.35, 0, 1);
      }
      if (mode === 'fill' && LAST_BLOCKS.includes(n) && done) {
        stroke = SIG.warn;
        labelColor = SIG.warn;
      }
    } else if (kind === 'private' && mode === 'private') {
      fill = 'rgba(45,212,191,0.34)';
      stroke = PRIV;
      labelColor = '#b5f5ea';
    } else if (kind === 'multicast') {
      fill = 'rgba(181,155,255,0.1)';
      stroke = 'rgba(181,155,255,0.38)';
      labelColor = 'rgba(181,155,255,0.7)';
    } else {
      hatch = true;
      stroke = 'rgba(143,166,201,0.26)';
    }
    const glow = hl === `map:${n}` || (hl === 'map:private' && (n === 10 || n === 172 || n === 192)) || (hl === 'map:reserved' && kind !== 'unicast' && kind !== 'private');
    cells.push(
      <g key={n}>
        <rect x={x} y={y} width={s} height={s} rx={2.5} fill={fill} stroke={glow ? SIG.warn : stroke} strokeWidth={glow ? 1.6 : 1} />
        {hatch && <rect x={x} y={y} width={s} height={s} rx={2.5} fill="url(#kit-hatch-dim)" />}
        {flash > 0.01 && <rect x={x} y={y} width={s} height={s} rx={2.5} fill={SIG.text} opacity={flash * 0.35} />}
        {land && (
          <text className={css.cellNum} x={x + s / 2} y={y + s / 2 + 3.2} textAnchor="middle" fill={labelColor}>
            {n}
          </text>
        )}
      </g>,
    );
  }

  // Private sub-blocks inside 172/8 (one /12 of 16) and 192/8 (one /16 of 256)
  const sub: ReactNode[] = [];
  if (mode === 'private') {
    const c172 = cellXY(g, 172);
    const q = g.cell / 4;
    sub.push(<rect key="172" x={c172.x + q} y={c172.y} width={q} height={q} fill={PRIV} opacity={0.95} />);
    for (let i = 1; i < 4; i++) {
      sub.push(<line key={`172v${i}`} x1={c172.x + i * q} y1={c172.y} x2={c172.x + i * q} y2={c172.y + g.cell} stroke="rgba(7,12,23,0.5)" strokeWidth={0.6} />);
      sub.push(<line key={`172h${i}`} x1={c172.x} y1={c172.y + i * q} x2={c172.x + g.cell} y2={c172.y + i * q} stroke="rgba(7,12,23,0.5)" strokeWidth={0.6} />);
    }
    const c192 = cellXY(g, 192);
    const q2 = g.cell / 16;
    sub.push(<rect key="192" x={c192.x + 8 * q2} y={c192.y + 10 * q2} width={Math.max(1.6, q2)} height={Math.max(1.6, q2)} fill={PRIV} />);
    sub.push(<rect key="192r" x={c192.x + 8 * q2 - 2.5} y={c192.y + 10 * q2 - 2.5} width={q2 + 5} height={q2 + 5} fill="none" stroke={PRIV} strokeWidth={1} />);
  }

  return (
    <g>
      {land &&
        Array.from({ length: 16 }, (_, r) => (
          <text key={r} className={css.cellNum} x={g.x0 - 9} y={g.y0 + r * g.pitch + g.cell / 2 + 3.2} textAnchor="end" fill={SIG.dim}>
            {r * 16}
          </text>
        ))}
      {cells}
      {sub}
      {mode === 'private' && land && <Zoom192 sim={sim} />}
    </g>
  );
}

/** Zoom into 192.0.0.0/8: 256 /16 blocks, one of which is 192.168/16. */
function Zoom192({ sim }: { sim: NatSim }) {
  const g = mapGeo(sim.w, sim.h, true);
  const c = cellXY(g, 192);
  const zp = Math.min(11, Math.floor((sim.w - (g.x0 + g.size) - 90) / 16));
  if (zp < 6) return null;
  const size = zp * 16;
  const zx = g.x0 + g.size + 56;
  const zy = g.y0 + g.size - size;
  return (
    <g>
      <rect x={c.x - 2} y={c.y - 2} width={g.cell + 4} height={g.cell + 4} rx={3.5} fill="none" stroke="rgba(255,210,63,0.8)" strokeWidth={1.4} />
      <rect x={zx} y={zy} width={size} height={size} fill="rgba(8,12,22,0.92)" stroke="rgba(255,210,63,0.55)" />
      {Array.from({ length: 256 }, (_, k) => {
        const on = k === 168;
        return <rect key={k} x={zx + (k % 16) * zp + 0.5} y={zy + Math.floor(k / 16) * zp + 0.5} width={zp - 1.5} height={zp - 1.5} fill={on ? PRIV : 'rgba(143,166,201,0.14)'} />;
      })}
      <text className={css.zoomLabel} x={zx} y={zy - 22} style={{ fill: 'rgba(255,210,63,0.85)' }}>
        square 192, zoomed in:
      </text>
      <text className={css.zoomLabel} x={zx} y={zy - 9}>
        256 blocks of /16 each
      </text>
      <text className={css.zoomHot} x={zx + 8 * zp + zp / 2} y={zy + 10 * zp + zp + 14} textAnchor="middle">
        192.168/16
      </text>
    </g>
  );
}

/* ================================================================== */
/* The network                                                         */
/* ================================================================== */

function NetScene({ sim, hl }: { sim: NatSim; hl: string }) {
  const c = sim.cfg;
  const dim = (id: string) => c.focus.length > 0 && !c.focus.includes(id);
  const glow = (id: string) => hl === id;
  const b = (id: string) => {
    const x = sim.boxes.get(id);
    return x && !Number.isNaN(x.x) ? x : null;
  };
  const pend = sim.game?.pending;
  const askingAt = sim.asking?.at;

  return (
    <g>
      <Regions sim={sim} dim={dim} />
      <Links sim={sim} dim={dim} />
      {b('cloud') && <Cloud box={b('cloud')!} dim={dim('cloud')} vt={sim.vt} noRoute={sim.noRoute && sim.vt - sim.noRoute.vt < 3.6 ? sim.noRoute.ip : null} />}
      {sim.noRoute && sim.vt - sim.noRoute.vt < 3.6 && <NoRoute sim={sim} />}
      {['laptop', 'phone', 'tv', 'guest', 'bob'].map((id) => {
        const box = b(id);
        return box ? <Device key={id} box={box} sim={sim} id={id} dim={dim(id)} glow={glow(id)} hot={!!pend && askingAt === id} /> : null;
      })}
      {['router', 'routerB', 'cgnat'].map((id) => {
        const box = b(id);
        return box ? <RouterCard key={id} box={box} sim={sim} id={id} dim={dim(id)} glow={glow(id) || (id === 'router' && hl === 'router:nat')} hot={!!pend && askingAt === id} /> : null;
      })}
      {['server', 'carol', 'stun'].map((id) => {
        const box = b(id);
        return box ? <Host key={id} box={box} sim={sim} id={id} dim={dim(id)} glow={glow(id)} /> : null;
      })}
      <Resting sim={sim} />
      <Flights sim={sim} />
      <Effects sim={sim} />
    </g>
  );
}

/* ---------------- dashed region: the home network ---------------- */

function Regions({ sim, dim }: { sim: NatSim; dim: (id: string) => boolean }) {
  const land = sim.orient === 'landscape';
  const regions: { key: string; x: number; y: number; w: number; h: number; label: string; lx: number; ly: number; anchor: 'start' | 'end' }[] = [];
  const rb = sim.boxes.get('router');
  if (!rb || Number.isNaN(rb.x)) return null;
  const devBoxes = (ids: string[]) => ids.map((id) => sim.boxes.get(id)).filter((x): x is Box => !!x && !Number.isNaN(x.x) && x.alpha > 0.05);
  const net = `${intToIp(netOf(ipToInt(sim.labels.laptop?.ip || '192.168.1.23'), sim.lanPrefix))}/${sim.lanPrefix}`;
  if (sim.cfg.topo === 'two') {
    const rB = sim.boxes.get('routerB');
    const pairs: [string, Box | undefined, string][] = [
      ['a', sim.boxes.get('laptop'), sim.cfg.scenario === 'no-nat' || sim.cfg.scenario === 'p2p' ? "Alice's home" : 'home'],
      ['b', sim.boxes.get('bob'), "Bob's home"],
    ];
    for (const [key, dev, name] of pairs) {
      const r = key === 'a' ? rb : rB;
      if (!dev || !r || Number.isNaN(dev.x) || Number.isNaN(r.x)) continue;
      const netB = key === 'a' ? '192.168.1.0/24' : sim.cfg.scenario === 'no-nat' ? '192.168.1.0/24' : '10.0.0.0/24';
      if (land) {
        const left = key === 'a' ? dev.x - dev.w / 2 - 16 : r.x;
        const right = key === 'a' ? r.x : dev.x + dev.w / 2 + 16;
        const top = Math.min(dev.y - dev.h / 2, r.y - r.h / 2) - 18;
        const bottom = Math.max(dev.y + dev.h / 2, r.y + r.h / 2) + 32;
        regions.push({ key, x: left, y: top, w: right - left, h: bottom - top, label: `${name} · ${netB}`, lx: key === 'a' ? left + 12 : right - 12, ly: bottom - 11, anchor: key === 'a' ? 'start' : 'end' });
      } else {
        const left = dev.x - dev.w / 2 - 8;
        const right = dev.x + dev.w / 2 + 8;
        const top = r.y;
        const bottom = dev.y + dev.h / 2 + 22;
        regions.push({ key, x: left, y: top, w: right - left, h: bottom - top, label: name, lx: left + 8, ly: bottom - 7, anchor: 'start' });
      }
    }
  } else {
    const devs = devBoxes(['laptop', 'phone', 'tv', 'guest']);
    if (devs.length) {
      if (land) {
        const left = Math.min(...devs.map((d) => d.x - d.w / 2)) - 18;
        const top = Math.min(...devs.map((d) => d.y - d.h / 2), rb.y - rb.h / 2) - 20;
        const bottom = Math.max(...devs.map((d) => d.y + d.h / 2), rb.y + rb.h / 2) + 34;
        regions.push({ key: 'a', x: left, y: top, w: rb.x - left, h: bottom - top, label: `home network · ${net}`, lx: left + 12, ly: bottom - 12, anchor: 'start' });
      } else {
        const bottom = Math.max(...devs.map((d) => d.y + d.h / 2)) + 26;
        regions.push({ key: 'a', x: 8, y: rb.y, w: sim.w - 16, h: bottom - rb.y, label: `home LAN · ${net}`, lx: 18, ly: bottom - 9, anchor: 'start' });
      }
    }
  }
  return (
    <g opacity={dim('router') && dim('laptop') ? 0.35 : 1}>
      {regions.map((r) => (
        <g key={r.key}>
          <rect x={r.x} y={r.y} width={r.w} height={r.h} rx={14} fill="rgba(45,212,191,0.025)" stroke="rgba(45,212,191,0.34)" strokeDasharray="3 5" />
          <text className={css.regionLabel} x={r.lx} y={r.ly} textAnchor={r.anchor}>
            {r.label}
          </text>
        </g>
      ))}
    </g>
  );
}

/* ---------------- wires ---------------- */

function Links({ sim, dim }: { sim: NatSim; dim: (id: string) => boolean }) {
  const lines: { key: string; pts: { x: number; y: number }[]; dim: boolean; lan?: boolean }[] = [];
  const bus = sim.bus();
  if (bus) {
    for (const id of sim.homeDevs()) {
      const p = sim.lanPort(id);
      const bx = sim.boxes.get(id);
      if (!p || !bx) continue;
      const tap = bus.vertical ? { x: bus.x1, y: p.y } : { x: p.x, y: bus.y1 };
      lines.push({ key: `stub-${id}`, pts: [p, tap], dim: dim(id), lan: true });
    }
    const rp = sim.lanPort('router');
    if (rp) lines.push({ key: 'stub-router', pts: [rp, bus.vertical ? { x: bus.x1, y: rp.y } : { x: rp.x, y: bus.y1 }], dim: dim('router'), lan: true });
  }
  if (sim.cfg.topo === 'two') {
    const a = sim.lanPort('laptop');
    const ra = sim.lanPort('router');
    if (a && ra) lines.push({ key: 'lan-a', pts: [a, ra], dim: dim('laptop'), lan: true });
    const bb = sim.lanPort('bob');
    const rb = sim.lanPort('routerB');
    if (bb && rb) lines.push({ key: 'lan-b', pts: [bb, rb], dim: dim('bob'), lan: true });
  }
  const cloud = sim.boxes.get('cloud');
  const cc = cloud && !Number.isNaN(cloud.x) ? { x: cloud.x, y: cloud.y } : null;
  if (cc) {
    const wanIds = sim.cfg.topo === 'cgnat' ? ['cgnat'] : ['router', 'routerB'];
    for (const id of [...wanIds, 'server', 'carol', 'stun']) {
      if (!sim.boxes.has(id)) continue;
      const p = id === 'cgnat' ? sim.pathPoints('cgnat', 'cloud')?.[0] : sim.wanPort(id);
      if (p) lines.push({ key: `wan-${id}`, pts: [p, cc], dim: dim(id) || dim('cloud') });
    }
  }
  if (sim.cfg.topo === 'cgnat') {
    const pts = sim.pathPoints('router', 'cgnat');
    if (pts) lines.push({ key: 'r-cg', pts, dim: dim('cgnat') && dim('router') });
  }
  const alpha = (id: string) => sim.boxes.get(id)?.alpha ?? 1;
  return (
    <g>
      {lines.map((l) => (
        <polyline
          key={l.key}
          points={l.pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}
          className={l.lan ? css.lanWire : stage.wire}
          fill="none"
          opacity={(l.dim ? 0.3 : 1) * alpha(l.key.replace(/^(stub|wan|lan)-/, '') || 'cloud')}
        />
      ))}
      {bus && (
        <g opacity={dim('laptop') && dim('router') ? 0.3 : 1}>
          <line x1={bus.x1} y1={bus.y1} x2={bus.x2} y2={bus.y2} className={css.bus} />
          {sim.homeDevs().map((id) => {
            const p = sim.lanPort(id);
            if (!p) return null;
            const tap = bus.vertical ? { x: bus.x1, y: p.y } : { x: p.x, y: bus.y1 };
            return <circle key={id} cx={tap.x} cy={tap.y} r={2.6} fill={PRIV} />;
          })}
        </g>
      )}
    </g>
  );
}

/* ---------------- the internet ---------------- */

const CLOUD = [
  { x: -0.315, y: 0.135, r: 0.327 },
  { x: -0.076, y: -0.135, r: 0.404 },
  { x: 0.185, y: -0.058, r: 0.346 },
  { x: 0.337, y: 0.173, r: 0.25 },
  { x: 0.022, y: 0.212, r: 0.308 },
];
const MESH = [
  { x: -0.28, y: 0.04 },
  { x: -0.1, y: -0.28 },
  { x: 0.13, y: 0.08 },
  { x: 0.26, y: -0.2 },
  { x: 0.02, y: -0.08 },
];
const MESH_LINKS: [number, number][] = [
  [0, 1],
  [0, 4],
  [1, 4],
  [1, 3],
  [4, 2],
  [2, 3],
  [4, 3],
];

function Cloud({ box, dim, vt, noRoute }: { box: Box; dim: boolean; vt: number; noRoute: string | null }) {
  const { x, y, w, h } = box;
  const circ = CLOUD.map((c) => ({ cx: x + c.x * w, cy: y + c.y * h * 1.02, r: c.r * h * 0.98 }));
  const mesh = MESH.map((m) => ({ x: x + m.x * w, y: y + m.y * h }));
  const pulse = 0.5 + 0.5 * Math.sin(vt * 2.2);
  return (
    <g opacity={box.alpha * (dim ? 0.3 : 1)}>
      {circ.map((c, i) => (
        <circle key={`o${i}`} cx={c.cx} cy={c.cy} r={c.r + 1.2} fill={noRoute ? 'rgba(255,77,106,0.55)' : 'rgba(143,166,201,0.5)'} />
      ))}
      {circ.map((c, i) => (
        <circle key={`i${i}`} cx={c.cx} cy={c.cy} r={c.r} fill="var(--node-fill)" />
      ))}
      <g opacity={0.8}>
        {MESH_LINKS.map(([a, b2], i) => (
          <line key={i} x1={mesh[a].x} y1={mesh[a].y} x2={mesh[b2].x} y2={mesh[b2].y} stroke="rgba(143,166,201,0.2)" strokeWidth={1} />
        ))}
        {mesh.map((m, i) => (
          <circle key={i} cx={m.x} cy={m.y} r={2.3} fill="rgba(143,166,201,0.45)" opacity={0.6 + 0.4 * (i === 4 ? pulse : 1)} />
        ))}
      </g>
      <text className={css.cloudLabel} x={x} y={y + h * 0.3} textAnchor="middle">
        internet
      </text>
    </g>
  );
}

function NoRoute({ sim }: { sim: NatSim }) {
  const cloud = sim.boxes.get('cloud');
  if (!cloud || !sim.noRoute) return null;
  const k = clamp((sim.vt - sim.noRoute.vt) / 0.4, 0, 1) * clamp((3.6 - (sim.vt - sim.noRoute.vt)) / 0.6, 0, 1);
  const targets = ['router', 'routerB'].map((id) => sim.wanPort(id)).filter((p): p is { x: number; y: number } => !!p);
  return (
    <g opacity={k}>
      {targets.map((p, i) => {
        const mx = (cloud.x + p.x) / 2;
        const my = (cloud.y + p.y) / 2;
        return (
          <g key={i}>
            <line x1={cloud.x} y1={cloud.y} x2={p.x} y2={p.y} stroke={SIG.err} strokeWidth={1.4} strokeDasharray="3 5" />
            <circle cx={mx} cy={my - 2} r={10} fill="rgba(20,8,12,0.95)" stroke={SIG.err} />
            <text x={mx} y={my + 2.5} textAnchor="middle" className={css.qmark}>
              ?
            </text>
          </g>
        );
      })}
    </g>
  );
}

/* ---------------- nodes ---------------- */

const GLYPH: Record<Glyph, string> = {
  laptop: 'M3.5 3.5h9v7h-9z M1.5 12.5h13',
  phone: 'M5 1.5h6a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1z M7.2 12.3h1.6',
  tv: 'M1.5 3h13v8.5h-13z M5.5 14.5h5 M8 11.5v3',
  printer: 'M4.5 6V2h7v4 M2 6h12v5.5H2z M4.5 9.5h7v5h-7z',
  nas: 'M2.5 2.5h11v4.5h-11z M2.5 9h11v4.5h-11z M5 4.8h.01 M5 11.2h.01',
  router: 'M2 8.5h12v5H2z M4.8 8.5 3.4 3 M11.2 8.5 12.6 3 M5 11h.01 M8 11h.01',
  server: 'M2.5 2h11v5h-11z M2.5 9h11v5h-11z M5 4.5h.01 M5 11.5h.01 M8.5 4.5h3 M8.5 11.5h3',
  person: 'M8 7.6a2.8 2.8 0 1 0 0-5.6 2.8 2.8 0 0 0 0 5.6z M2.5 14.5c.6-3 2.8-4.6 5.5-4.6s4.9 1.6 5.5 4.6',
  isp: 'M2 14.5V5.5L8 2l6 3.5v9 M5.5 14.5V9.5h5v5 M2 14.5h12',
  stun: 'M13 8a5 5 0 1 1-1.6-3.7 M13.2 1.8v3h-3 M8 5.5v3l2 1.2',
};

function GlyphIcon({ glyph, x, y, color, size = 16 }: { glyph: Glyph; x: number; y: number; color: string; size?: number }) {
  const s = size / 16;
  return (
    <path
      d={GLYPH[glyph]}
      transform={`translate(${x},${y}) scale(${s})`}
      fill="none"
      stroke={color}
      strokeWidth={1.4 / s}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
}

function Frame({ box, dim, glow, hot, dashed, children, tone }: { box: Box; dim: boolean; glow: boolean; hot?: boolean; dashed?: boolean; children: ReactNode; tone?: string }) {
  return (
    <g transform={`translate(${box.x - box.w / 2},${box.y - box.h / 2})`} opacity={box.alpha * (dim ? 0.3 : 1)}>
      {glow && <rect x={-6} y={-6} width={box.w + 12} height={box.h + 12} rx={14} fill="none" stroke="var(--accent)" strokeWidth={1.4} strokeDasharray="3 3" />}
      <rect
        className={cx(stage.card, hot && css.cardHot)}
        width={box.w}
        height={box.h}
        rx={10}
        style={{ strokeDasharray: dashed ? '4 4' : undefined, stroke: tone }}
      />
      {!dashed && <rect className={stage.cardInner} x={3.5} y={3.5} width={Math.max(0, box.w - 7)} height={Math.max(0, box.h - 7)} rx={7.5} />}
      {children}
    </g>
  );
}

function Device({ box, sim, id, dim, glow, hot }: { box: Box; sim: NatSim; id: string; dim: boolean; glow: boolean; hot: boolean }) {
  const lb = sim.labels[id];
  if (!lb) return null;
  const narrow = box.w < 118;
  const iconX = narrow ? 8 : 12;
  const tx = narrow ? 30 : 38;
  const privateIp = lb.ip.startsWith('192.168.') || lb.ip.startsWith('10.');
  const showPrefix = id === 'laptop' && sim.cfg.scenario === 'predict-gw';
  const ip = showPrefix ? `${lb.ip}/${sim.lanPrefix}` : lb.ip;
  if (lb.ghost) {
    return (
      <Frame box={box} dim={dim} glow={glow} dashed>
        <text className={css.ghostText} x={box.w / 2} y={box.h / 2 + 4} textAnchor="middle">
          {narrow ? 'another host' : 'another host?'}
        </text>
      </Frame>
    );
  }
  const stream = sim.stream && sim.stream.dev === id ? sim.stream : null;
  return (
    <Frame box={box} dim={dim} glow={glow} hot={hot}>
      <rect x={iconX - 3} y={box.h / 2 - 11} width={22} height={22} rx={6} fill="rgba(45,212,191,0.08)" stroke="rgba(45,212,191,0.35)" />
      <GlyphIcon glyph={lb.glyph} x={iconX} y={box.h / 2 - 8} color={PRIV} />
      <text className={stage.name} x={tx} y={box.h / 2 - 3} style={narrow ? { fontSize: 11 } : undefined}>
        {narrow && lb.name.length > 11 ? lb.name.replace("'s laptop", '') : lb.name}
      </text>
      <text className={css.ipText} x={tx} y={box.h / 2 + 11} fill={privateIp ? PRIV : SIG.text2} style={narrow ? { fontSize: ip.length > 13 ? 8 : 8.8 } : undefined}>
        {ip}
      </text>
      {lb.badge && (sim.orient === 'landscape' || !narrow) && (
        <g transform={`translate(${box.w - 4},${-7})`}>
          <rect x={-lb.badge.length * 5.6 - 10} y={-8} width={lb.badge.length * 5.6 + 12} height={15} rx={7.5} fill="rgba(7,11,20,0.95)" stroke="rgba(75,227,160,0.6)" />
          <text className={css.badgeText} x={-lb.badge.length * 2.8 - 4} y={3} textAnchor="middle">
            {lb.badge}
          </text>
        </g>
      )}
      {stream && (
        <text className={css.badgeText} x={box.w - 8} y={13} textAnchor="end" fill={stream.stalled ? SIG.err : SIG.res}>
          {stream.stalled ? '■ stalled' : '▶ streaming'}
        </text>
      )}
    </Frame>
  );
}

function RouterCard({ box, sim, id, dim, glow, hot }: { box: Box; sim: NatSim; id: string; dim: boolean; glow: boolean; hot: boolean }) {
  const lb = sim.labels[id];
  const n = sim.nats.get(id);
  if (!lb || !n) return null;
  const land = sim.orient === 'landscape';
  const narrow = box.w < 140;
  const busy = sim.rests.some((r) => r.at === id);
  const lookupFresh = n.lookup && sim.vt - n.lookup.vt < 1.2;
  const natColor = !n.on ? SIG.dim : lookupFresh && !n.lookup!.ok ? SIG.err : busy ? SIG.warn : SIG.hc;
  const lanLabel = id === 'cgnat' ? 'in' : 'LAN';
  const wanLabel = id === 'cgnat' ? 'out' : 'WAN';
  const rows = land || box.h >= 50;
  return (
    <Frame box={box} dim={dim} glow={glow} hot={hot || busy} tone={id === 'cgnat' ? 'rgba(255,154,60,0.7)' : undefined}>
      <GlyphIcon glyph={lb.glyph} x={10} y={8} color={id === 'cgnat' ? SIG.heavy : SIG.text2} size={14} />
      <text className={stage.name} x={29} y={19} style={{ fontSize: narrow ? 11 : 12 }}>
        {lb.name}
      </text>
      <g transform={`translate(${box.w - 10},${9})`}>
        <rect x={-30} y={0} width={30} height={13} rx={3.5} fill={n.on ? 'rgba(181,155,255,0.12)' : 'transparent'} stroke={natColor} strokeWidth={1} />
        <text className={css.natChip} x={-15} y={9.6} textAnchor="middle" fill={natColor}>
          {n.on ? 'NAT' : 'off'}
        </text>
      </g>
      {rows && (
        <>
          <text className={css.portText} x={12} y={box.h - (land ? 27 : 20)} style={{ fontSize: land ? 10 : 9 }}>
            <tspan fill={SIG.dim}>{lanLabel} </tspan>
            <tspan fill={PRIV}>{lb.ip}</tspan>
          </text>
          <text className={css.portText} x={12} y={box.h - (land ? 12 : 7)} style={{ fontSize: land ? 10 : 9 }}>
            <tspan fill={SIG.dim}>{wanLabel} </tspan>
            <tspan fill={id === 'router' && sim.cfg.topo === 'cgnat' ? SIG.heavy : SIG.text}>{lb.wan}</tspan>
          </text>
        </>
      )}
    </Frame>
  );
}

function Host({ box, sim, id, dim, glow }: { box: Box; sim: NatSim; id: string; dim: boolean; glow: boolean }) {
  const lb = sim.labels[id];
  if (!lb) return null;
  const person = lb.glyph === 'person';
  const narrow = box.w < 130;
  return (
    <Frame box={box} dim={dim} glow={glow}>
      {person ? (
        <g>
          <circle cx={20} cy={box.h / 2} r={11} fill="rgba(255,154,60,0.14)" stroke={SIG.heavy} strokeWidth={1.2} />
          <text x={20} y={box.h / 2 + 4} textAnchor="middle" fill={SIG.heavy} style={{ fontFamily: 'var(--font-sans)', fontSize: 11, fontWeight: 600 }}>
            C
          </text>
        </g>
      ) : (
        <GlyphIcon glyph={lb.glyph} x={12} y={box.h / 2 - 8} color={SIG.text2} />
      )}
      <text className={stage.name} x={38} y={box.h / 2 - 3} style={narrow ? { fontSize: 11 } : undefined}>
        {lb.name}
      </text>
      <text className={css.ipText} x={38} y={box.h / 2 + 11} fill={SIG.text2} style={narrow ? { fontSize: 8.8 } : undefined}>
        {id === 'stun' ? `${lb.ip}:3478` : lb.ip}
      </text>
    </Frame>
  );
}

/* ---------------- packets waiting inside a box ---------------- */

function Pill({ x, y, text, color }: { x: number; y: number; text: string; color: string }) {
  const w = text.length * 6.1 + 10;
  return (
    <g transform={`translate(${x},${y})`}>
      <rect x={-w / 2} y={-8} width={w} height={14} rx={7} fill="rgba(7,11,20,0.92)" stroke={color} strokeOpacity={0.7} />
      <text className={stage.flightLabel} x={0} y={2.5} textAnchor="middle" fill={color}>
        {text}
      </text>
    </g>
  );
}

function Resting({ sim }: { sim: NatSim }) {
  return (
    <g>
      {sim.rests.map((r, i) => {
        const pt = sim.restPoint(r.at);
        if (!pt) return null;
        const spin = (sim.vt * 220) % 360;
        const color = r.held ? SIG.warn : r.p.color;
        const k = (sim.vt - r.vt0) % 1.2;
        return (
          <g key={`${r.p.id}-${i}`}>
            {r.held && <circle cx={pt.x} cy={pt.y} r={8 + k * 10} fill="none" stroke={SIG.warn} strokeWidth={1.6 * (1 - k / 1.2)} opacity={1 - k / 1.2} />}
            <circle cx={pt.x} cy={pt.y} r={10} fill="none" stroke={color} strokeWidth={1.3} strokeDasharray="4 3" transform={`rotate(${spin} ${pt.x} ${pt.y})`} opacity={0.85} />
            <circle cx={pt.x} cy={pt.y} r={11.5} fill={r.p.color} opacity={0.12} />
            <circle cx={pt.x} cy={pt.y} r={4.6} fill={r.p.color} />
            {r.p.label && <Pill x={pt.x} y={pt.y - 20} text={r.p.label} color={r.p.color} />}
          </g>
        );
      })}
    </g>
  );
}
