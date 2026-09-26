'use client';

import type { ReactNode } from 'react';
import { Effects } from '@/components/stage/svg';
import stage from '@/components/stage/stage.module.css';
import { SIG } from '@/lib/sim/colors';
import { clamp } from '@/lib/sim/geometry';
import type { Box } from '@/lib/sim/Sim';
import { fmt, phoneOf } from './hashing';
import { TOMB, type Table } from './table';
import { entryId, keyId, rackOf, slotId, type HashSim, type MachineState, type Mark, type Op } from './sim';
import css from './ht.module.css';

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

const live = (b: Box | undefined): b is Box => !!b && !Number.isNaN(b.x) && b.alpha > 0.01;

/** Font size that fits `text` in `w` pixels of monospace. */
export function fitFont(text: string, w: number, base: number) {
  return Math.min(base, (w - 6) / (Math.max(1, text.length) * 0.61));
}

const age = (sim: HashSim, m: Mark | undefined) => (m ? sim.vt - m.vt : Infinity);

/** Dark outline behind text drawn over lines and bars. */
const HALO = { paintOrder: 'stroke', stroke: 'var(--ink-1)', strokeWidth: 4, strokeLinejoin: 'round' } as const;

export const OPS: Record<Op, { label: string; color: string }> = {
  put: { label: 'put', color: SIG.req },
  get: { label: 'get', color: SIG.hc },
  del: { label: 'delete', color: SIG.pink },
  hash: { label: 'hash', color: SIG.req },
  rehash: { label: 'rehash', color: SIG.warn },
  scan: { label: 'find', color: SIG.hc },
  jump: { label: 'index', color: SIG.warn },
};

function tableOf(sim: HashSim, rack: string): Table | null {
  if (rack === rackOf(sim.table)) return sim.table;
  if (sim.next && rack === rackOf(sim.next)) return sim.next;
  return null;
}

/* ------------------------------------------------------------------ */
/* The hash machine                                                    */
/* ------------------------------------------------------------------ */

type Seg = { t: string; c?: string; w?: number };

function machineLines(m: MachineState | null, L: boolean): Seg[][] {
  const dim = 'var(--text-3)';
  const hi = 'var(--text-1)';
  const Y = SIG.warn;
  if (!m) return [[{ t: 'waiting for a key…', c: dim }], []];
  const H = m.hash;
  const idx: Seg = m.ask ? { t: '?', c: Y, w: 700 } : m.index != null ? { t: String(m.index), c: Y, w: 700 } : { t: '…', c: dim };
  const modLine = (op: string, n: number): Seg[] =>
    H == null ? [{ t: `h ${op} ${n} = …`, c: dim }] : [{ t: fmt(H), c: hi }, { t: ` ${op} ` }, { t: String(n), c: hi }, { t: ' = ' }, idx];

  if (m.op === 'hash') {
    const s = m.shown > 0 ? m.steps[m.shown - 1] : null;
    if (H != null) return [[{ t: 'h = ' }, { t: fmt(H), c: hi, w: 600 }], [{ t: 'same key in, same number out', c: dim }]];
    if (s) return [[{ t: 'h = ' }, { t: fmt(s.prev), c: hi }, { t: ' × 31 + ' }, { t: String(s.code), c: Y, w: 600 }, { t: ' = ' }, { t: fmt(s.next), c: hi }], []];
    return [[{ t: 'h = 0', c: dim }], []];
  }
  if (m.stored) {
    return [
      [{ t: 'h = ' }, { t: fmt(H ?? 0), c: hi, w: 600 }, { t: L ? '   stored with the key' : '  (stored)', c: dim }],
      [...modLine('mod', m.cap), { t: `   was ${m.from}`, c: dim }],
    ];
  }
  switch (m.kind) {
    case 'first': {
      const s = m.steps[0];
      const a: Seg[] = s ? [{ t: 'h = code(' }, { t: `'${s.ch}'`, c: hi }, { t: ') = ' }, { t: String(s.code), c: H == null ? Y : hi, w: 600 }] : [];
      if (s && L) a.push({ t: '   the rest is ignored', c: dim });
      return [a, modLine('mod', m.cap)];
    }
    case 'keyed':
      return [
        [{ t: 'h = keyed(' }, { t: m.key, c: hi }, { t: ', ' }, { t: '••••', c: SIG.hc }, { t: ') = ' }, { t: H == null ? '…' : fmt(H), c: hi, w: 600 }],
        modLine('mod', m.cap),
      ];
    case 'java':
      return [
        [{ t: `hashCode("${m.key}") = ` }, { t: m.raw == null ? '…' : fmt(m.raw), c: hi }],
        [{ t: 'h ^ (h >>> 16) = ' }, { t: H == null ? '…' : fmt(H), c: hi, w: 600 }],
        modLine('&', m.cap - 1),
      ];
    case 'py': {
      const p = m.probe;
      const mask = m.cap - 1;
      const a: Seg[] = [{ t: `hash("${m.key}") = ` }, { t: H == null ? '…' : fmt(H), c: hi, w: 600 }];
      if (!p) return [a, [{ t: `i = h & ${mask} = …`, c: dim }], []];
      if (p.perturb == null) return [a, [{ t: `i = h & ${mask} = ` }, { t: String(p.slot), c: Y, w: 700 }], []];
      const b: Seg[] = [{ t: `i = h & ${mask} = `, c: dim }, { t: String(p.prev ?? ''), c: dim }, { t: '  taken', c: SIG.heavy }];
      const c: Seg[] = L
        ? [{ t: 'perturb >>= 5 → ' }, { t: fmt(p.perturb), c: hi }, { t: `;  i = (5·${p.prev} + perturb + 1) & ${mask} = ` }, { t: String(p.slot), c: Y, w: 700 }]
        : [{ t: `perturb ${fmt(p.perturb)} → i = ` }, { t: String(p.slot), c: Y, w: 700 }];
      return [a, b, c];
    }
    default: {
      const s = m.shown > 0 ? m.steps[m.shown - 1] : null;
      let a: Seg[];
      if (H != null) a = [{ t: 'h = ' }, { t: fmt(H), c: hi, w: 600 }];
      else if (s)
        a = [{ t: 'h = ' }, { t: fmt(s.prev), c: hi }, { t: ' × 31 + ' }, { t: String(s.code), c: Y, w: 600 }, { t: ' = ' }, { t: fmt(s.next), c: hi }];
      else a = [{ t: 'h = 0', c: dim }];
      return [a, modLine('mod', m.cap)];
    }
  }
}

function SegText({ x, y, segs, size, anchor }: { x: number; y: number; segs: Seg[]; size: number; anchor?: 'start' | 'end' | 'middle' }) {
  return (
    <text className={css.formula} x={x} y={y} fontSize={size} textAnchor={anchor}>
      {segs.map((s, i) => (
        <tspan key={i} fill={s.c} fontWeight={s.w}>
          {s.t}
        </tspan>
      ))}
    </text>
  );
}

function ruleText(m: MachineState | null, kind: string, L: boolean) {
  if (m?.stored) return L ? 'rehash: reuse the stored hash' : 'reuse stored hash';
  switch (m?.kind ?? kind) {
    case 'first':
      return L ? 'h = code of the first letter' : 'h = first letter';
    case 'keyed':
      return L ? 'h = keyed(key, secret)' : 'keyed(key, secret)';
    case 'java':
      return L ? 'Java: hashCode(), then spread' : 'hashCode(), spread';
    case 'py':
      return L ? 'CPython: i = h & mask, then perturb' : 'i = h & mask …';
    default:
      return L ? 'for each char: h = h × 31 + code' : 'h = h × 31 + code';
  }
}

function Tiles({ m, x, y, L }: { m: MachineState; x: number; y: number; L: boolean }) {
  const tw = L ? 26 : 20;
  const tp = L ? 31 : 24;
  return (
    <g>
      {m.steps.map((s, i) => {
        let state: 'pending' | 'active' | 'done' | 'ignored' = 'pending';
        if (m.stored) state = 'ignored';
        else if (m.kind === 'first') state = i === 0 ? (m.shown >= 1 ? (m.hash == null ? 'active' : 'done') : 'pending') : m.shown >= 1 ? 'ignored' : 'pending';
        else if (m.kind === 'poly') state = i < m.shown - 1 || (m.hash != null && i < m.shown) ? 'done' : i === m.shown - 1 ? 'active' : 'pending';
        else state = m.shown > 0 ? 'done' : 'pending';
        const stroke = state === 'active' ? SIG.warn : state === 'done' ? 'rgba(69,213,255,0.55)' : 'rgba(143,166,201,0.22)';
        const fill = state === 'active' ? 'rgba(255,210,63,0.14)' : state === 'done' ? 'rgba(69,213,255,0.07)' : 'rgba(143,166,201,0.03)';
        const tc = state === 'pending' || state === 'ignored' ? 'var(--text-3)' : 'var(--text-1)';
        const cc = state === 'active' ? SIG.warn : state === 'done' ? 'var(--text-2)' : 'var(--text-3)';
        const op = state === 'ignored' ? 0.45 : 1;
        return (
          <g key={i} transform={`translate(${x + i * tp},${y})`} opacity={op}>
            <rect width={tw} height={tw} rx={4} fill={fill} stroke={stroke} strokeWidth={1.2} />
            <text className={css.keyText} x={tw / 2} y={tw / 2 + (L ? 5 : 4)} textAnchor="middle" fontSize={L ? 14 : 11} fill={tc}>
              {s.ch}
            </text>
            {state !== 'ignored' && (
              <text className={css.mono} x={tw / 2} y={tw + (L ? 12.5 : 10)} textAnchor="middle" fontSize={L ? 10 : 8} fill={cc}>
                {s.code}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}

export function MachineView({ sim, dim }: { sim: HashSim; dim: boolean }) {
  const b = sim.boxes.get('M');
  if (!live(b)) return null;
  const g = sim.geo.machine;
  const strip = g?.mode === 'strip';
  const L = sim.orient === 'landscape';
  const m = sim.machine;
  const x0 = b.x - b.w / 2;
  const y0 = b.y - b.h / 2;
  const { w, h } = b;
  const tone = 'rgba(181,155,255,0.62)';
  const flash = m ? clamp(1 - (sim.vt - m.vt) / 0.55, 0, 1) : 0;
  const pad = L ? 16 : 12;
  const fs = L ? 12.5 : 10.5;
  const op = m ? OPS[m.op] : null;

  let content: ReactNode;
  if (strip) {
    const lines = machineLines(m, false);
    const main = m?.stored || m?.kind === 'java' ? lines[lines.length - 1] : lines[1] ?? [];
    const a = m && m.hash != null ? [{ t: 'h = ' }, { t: fmt(m.hash), c: 'var(--text-1)' } as Seg] : lines[0];
    content = (
      <>
        <text className={css.caps} x={pad} y={h / 2 + 3.5} fill={op?.color ?? '#cdbdff'}>
          {op ? `${op.label}` : 'hash'}
        </text>
        {m && (
          <text className={css.keyText} x={pad + (L ? 52 : 44)} y={h / 2 + 4} fontSize={fs + 1}>
            {m.key}
          </text>
        )}
        <SegText x={w - pad} y={h / 2 + 4} segs={m && m.hash != null ? main : a} size={fs} anchor="end" />
      </>
    );
  } else {
    const lines = machineLines(m, L);
    const ty = L ? 31 : 25;
    const lineY = [L ? 97 : 77, L ? 118 : 95, L ? 139 : 112];
    content = (
      <>
        <text className={css.caps} x={pad} y={L ? 20 : 16} fill="#cdbdff">
          hash machine
        </text>
        {m && op && (
          <text className={css.mono} x={w - pad} y={L ? 20 : 16} textAnchor="end" fontSize={L ? 11.5 : 9.5} fill={op.color}>
            {m.op === 'rehash' ? `rehash ${m.key}` : `${op.label}("${m.key}")`}
          </text>
        )}
        {m ? (
          <Tiles m={m} x={pad} y={ty} L={L} />
        ) : (
          <rect x={pad} y={ty} width={L ? 150 : 110} height={L ? 26 : 20} rx={4} fill="none" stroke="rgba(143,166,201,0.18)" strokeDasharray="3 4" />
        )}
        <text className={css.mono} x={w - pad} y={ty + (L ? 17 : 14)} textAnchor="end" fontSize={L ? 11 : 9.5} fill="var(--text-3)">
          {ruleText(m, sim.cfg.view === 'pydict' ? 'py' : sim.cfg.hash, L)}
        </text>
        <line x1={pad} x2={w - pad} y1={L ? 79 : 61} y2={L ? 79 : 61} stroke="rgba(143,166,201,0.14)" />
        {lines.map((segs, i) => (segs.length ? <SegText key={i} x={pad} y={lineY[i]} segs={segs} size={fs} /> : null))}
        {m && m.index != null && !m.ask && (
          <text className={css.mono} x={w - pad} y={lineY[lines.length - 1]} textAnchor="end" fontSize={fs} fill={SIG.warn} fontWeight={600}>
            {sim.cfg.view === 'pydict' ? `→ slot ${m.index}` : `→ bucket ${m.index}`}
          </text>
        )}
        {m?.ask && (
          <text className={`${css.mono} ${css.askPulse}`} x={w - pad} y={lineY[lines.length - 1]} textAnchor="end" fontSize={fs} fill={SIG.warn} fontWeight={600}>
            → bucket ?
          </text>
        )}
      </>
    );
  }

  return (
    <g opacity={b.alpha * (dim ? 0.3 : 1)}>
      <g transform={`translate(${x0},${y0})`}>
        {!strip && sim.geo.op && (
          <path
            d={`M-13,${h / 2 - 15} L0,${h / 2 - 8} M-13,${h / 2 + 15} L0,${h / 2 + 8}`}
            stroke={tone}
            strokeWidth={1.2}
            fill="none"
            strokeLinecap="round"
          />
        )}
        <rect className={stage.card} width={w} height={h} rx={12} style={{ stroke: tone }} />
        <rect className={stage.cardInner} x={4} y={4} width={Math.max(0, w - 8)} height={Math.max(0, h - 8)} rx={9} />
        {flash > 0.01 && <rect x={-2} y={-2} width={w + 4} height={h + 4} rx={13} fill="none" stroke="#b59bff" strokeWidth={2.4} opacity={flash * 0.45} />}
        <path d={`M${w / 2 - 13},${h - 0.5} L${w / 2 - 7},${h + 7} L${w / 2 + 7},${h + 7} L${w / 2 + 13},${h - 0.5}`} fill="var(--node-fill)" stroke={tone} strokeWidth={1.2} />
        {content}
      </g>
    </g>
  );
}

/** The operation card left of the machine (wide stages only). */
export function OpCardView({ sim, dim }: { sim: HashSim; dim: boolean }) {
  const b = sim.boxes.get('op');
  if (!live(b) || !sim.geo.op) return null;
  const o = sim.opCard;
  const op = o ? OPS[o.op] : null;
  const x0 = b.x - b.w / 2;
  const y0 = b.y - b.h / 2;
  const fs = o ? fitFont(o.key, b.w - 20, 15) : 15;
  return (
    <g transform={`translate(${x0},${y0})`} opacity={b.alpha * (dim ? 0.3 : 1)}>
      <rect className={stage.card} width={b.w} height={b.h} rx={10} style={op ? { stroke: op.color, strokeOpacity: 0.6 } : undefined} />
      <text className={css.caps} x={12} y={17} fill={op?.color ?? 'var(--text-3)'}>
        {op ? op.label : 'next key'}
      </text>
      <text className={css.keyText} x={12} y={38} fontSize={fs}>
        {o ? o.key : '—'}
      </text>
      {o && o.op === 'put' && (
        <text className={css.mono} x={12} y={51} fontSize={9.5} fill="var(--text-3)">
          {phoneOf(o.key)}
        </text>
      )}
      <path d={`M${b.w + 4},${b.h / 2} l8,0`} stroke="rgba(143,166,201,0.35)" strokeDasharray="2 3" />
    </g>
  );
}

/* ------------------------------------------------------------------ */
/* Racks: bucket arrays and the plain list                             */
/* ------------------------------------------------------------------ */

const SLOT_RE = /^(t\d+|L|P\d+):(\d+)$/;

function Tombstone({ w, h }: { w: number; h: number }) {
  const s = Math.min(w, h) * 0.3;
  return (
    <g stroke="#b59bff" strokeWidth={1.2} fill="rgba(181,155,255,0.14)" strokeLinejoin="round">
      <path d={`M${-s * 0.72},${s} V${-s * 0.2} A${s * 0.72},${s * 0.72} 0 0 1 ${s * 0.72},${-s * 0.2} V${s} Z`} />
      <line x1={-s * 0.34} x2={s * 0.34} y1={-s * 0.05} y2={-s * 0.05} />
      <line x1={-s * 0.34} x2={s * 0.34} y1={s * 0.38} y2={s * 0.38} />
      <line x1={-s * 1.05} x2={s * 1.05} y1={s} y2={s} />
    </g>
  );
}

export function RackView({
  sim,
  dimTable,
  dimList,
  pickable,
  onSlot,
  hideIndexes,
}: {
  sim: HashSim;
  dimTable: boolean;
  dimList: boolean;
  pickable: boolean;
  onSlot: (id: string) => void;
  hideIndexes?: boolean;
}) {
  const L = sim.orient === 'landscape';
  const slots = [...sim.boxes.values()].filter((b) => SLOT_RE.test(b.id) && live(b));
  const byRack = new Map<string, Box[]>();
  for (const b of slots) {
    const r = b.id.split(':')[0];
    byRack.set(r, [...(byRack.get(r) ?? []), b]);
  }

  // Rails behind each row of each rack (the contiguous array in memory).
  const rails: ReactNode[] = [];
  for (const r of sim.geo.racks) {
    const boxes = byRack.get(r.id) ?? [];
    for (let row = 0; row < r.rows; row++) {
      const rowBoxes = boxes.filter((b) => Math.floor(Number(b.id.split(':')[1]) / r.perRow) === row);
      if (!rowBoxes.length) continue;
      const x1 = Math.min(...rowBoxes.map((b) => b.x - b.w / 2)) - 6;
      const x2 = Math.max(...rowBoxes.map((b) => b.x + b.w / 2)) + 6;
      const cy = rowBoxes.reduce((s, b) => s + b.y, 0) / rowBoxes.length;
      const hh = rowBoxes[0].h + 12;
      const a = Math.min(...rowBoxes.map((b) => b.alpha));
      const dim = r.id === 'L' ? dimList : dimTable;
      rails.push(<rect key={`${r.id}-${row}`} className={css.rail} x={x1} y={cy - hh / 2} width={x2 - x1} height={hh} rx={8} opacity={a * (dim ? 0.3 : 1)} />);
    }
    if (r.caption && boxes.length) {
      const b0 = boxes.find((b) => b.id === slotId(r.id, 0)) ?? boxes[0];
      const dim = r.id === 'L' ? dimList : dimTable;
      rails.push(
        <text
          key={`${r.id}-cap`}
          className={css.caps}
          x={b0.x - b0.w / 2 - 6}
          y={b0.y - b0.h / 2 - (L ? 40 : 34)}
          fill={r.id === 'L' ? SIG.hc : SIG.req}
          opacity={b0.alpha * (dim ? 0.3 : 1)}
        >
          {r.caption}
        </text>,
      );
    }
  }

  return (
    <g>
      {rails}
      {slots.map((b) => {
        const [, rack, n] = SLOT_RE.exec(b.id) ?? [];
        const i = Number(n);
        const isList = rack === 'L';
        const isPy = rack.startsWith('P');
        const t = !isList && !isPy ? tableOf(sim, rack) : null;
        const mark = sim.markOf(b.id);
        const a = age(sim, mark);
        const dim = isList ? dimList : dimTable;
        const canPick = pickable && !!t && t === sim.table;
        const w = b.w;
        const h = b.h;
        let content: ReactNode = null;
        if (t) {
          if (t.mode === 'chain') {
            const chain = t.chains[i] ?? [];
            content = chain.length ? (
              <circle r={2.8} fill="var(--text-2)" />
            ) : (
              <line x1={-w / 2 + 7} y1={h / 2 - 7} x2={w / 2 - 7} y2={-h / 2 + 7} stroke="rgba(143,166,201,0.2)" strokeWidth={1} />
            );
          } else if (t.slots[i] === TOMB) {
            content = <Tombstone w={w} h={h} />;
          }
        } else if (isList) {
          const item = sim.list[i] ?? '';
          const roomy = w >= 56;
          const fs = fitFont(item, w, L ? 13.5 : roomy ? 12 : 10);
          content = (
            <>
              <text className={css.keyText} x={0} y={roomy ? -3 : 3.5} textAnchor="middle" fontSize={fs}>
                {item}
              </text>
              {roomy && (
                <text className={css.mono} x={0} y={L ? 14 : 12} textAnchor="middle" fontSize={L ? 9.5 : 8.5} fill="var(--text-3)">
                  {phoneOf(item)}
                </text>
              )}
            </>
          );
        } else if (isPy && sim.py) {
          const v = sim.py.indices[i];
          const fresh = mark?.kind === 'fresh' && a < 1.2;
          content =
            v == null ? (
              <text className={css.mono} x={0} y={4} textAnchor="middle" fontSize={L ? 11 : 9.5} fill="rgba(143,166,201,0.35)">
                ·
              </text>
            ) : (
              <text className={css.keyText} x={0} y={L ? 5 : 4} textAnchor="middle" fontSize={L ? 14 : 12} fill={fresh ? SIG.res : 'var(--text-1)'}>
                {v}
              </text>
            );
        }

        // Marks drawn on the slot itself
        let ring: ReactNode = null;
        const k = mark?.kind;
        if (k === 'home') ring = <rect x={-w / 2 - 3} y={-h / 2 - 2} width={w + 6} height={h + 4} rx={6} fill="none" stroke={SIG.warn} strokeWidth={1.3} strokeDasharray="3 3" />;
        if (k === 'taken') {
          const f = clamp(1 - a / 0.7, 0.35, 1);
          ring = <rect x={-w / 2 - 2} y={-h / 2 - 2} width={w + 4} height={h + 4} rx={6} fill="none" stroke={SIG.heavy} strokeWidth={1.6} opacity={f} />;
        }
        if (k === 'clash')
          ring = (
            <g>
              <rect x={-w / 2 - 2} y={-h / 2 - 2} width={w + 4} height={h + 4} rx={6} fill="rgba(255,154,60,0.08)" stroke={SIG.heavy} strokeWidth={1.8} />
              <text className={css.mono} x={L ? 34 : 24} y={-h / 2 - (L ? 23 : 19)} fontSize={L ? 12 : 10} fill={SIG.heavy} fontWeight={600} style={HALO}>
                collision!
              </text>
            </g>
          );
        if (k === 'tomb') ring = <rect x={-w / 2 - 2} y={-h / 2 - 2} width={w + 4} height={h + 4} rx={6} fill="none" stroke={SIG.hc} strokeWidth={1.6} opacity={clamp(1 - a / 1.2, 0.4, 1)} />;
        if (k === 'empty')
          ring = (
            <g>
              <rect x={-w / 2 - 3} y={-h / 2 - 3} width={w + 6} height={h + 6} rx={6} fill="rgba(255,77,106,0.06)" stroke={SIG.err} strokeWidth={1.4} strokeDasharray="3 3" />
              <text className={css.mono} x={0} y={4} textAnchor="middle" fontSize={L ? 12 : 10} fill={SIG.err}>
                ∅
              </text>
            </g>
          );
        if (k === 'fresh' && isPy) ring = <rect x={-w / 2 - 2} y={-h / 2 - 2} width={w + 4} height={h + 4} rx={6} fill="none" stroke={SIG.res} strokeWidth={1.6} opacity={clamp(1 - a / 1.4, 0, 1)} />;
        if (isList && (k === 'cmp' || k === 'hit' || k === 'skip')) {
          const col = k === 'cmp' ? SIG.warn : k === 'hit' ? SIG.res : SIG.heavy;
          const op = k === 'skip' ? clamp(1 - a / 0.8, 0.25, 1) : 1;
          ring = <rect x={-w / 2 - 2} y={-h / 2 - 2} width={w + 4} height={h + 4} rx={6} fill={k === 'hit' ? 'rgba(75,227,160,0.08)' : 'none'} stroke={col} strokeWidth={1.6} opacity={op} />;
        }
        const idxHot = k === 'home' || (isList && (k === 'cmp' || k === 'hit'));
        return (
          <g
            key={b.id}
            transform={`translate(${b.x},${b.y})`}
            opacity={b.alpha * (dim ? 0.3 : 1)}
            className={canPick ? css.pickable : undefined}
            onClick={canPick ? () => onSlot(b.id) : undefined}
            role={canPick ? 'button' : undefined}
            aria-label={canPick ? `Bucket ${i}` : undefined}
          >
            {canPick && <rect x={-w / 2 - 4} y={-h / 2 - 14} width={w + 8} height={h + 18} fill="transparent" />}
            <rect className={css.slot} x={-w / 2} y={-h / 2} width={w} height={h} rx={5} style={isList && k === 'skip' ? { opacity: 0.6 } : undefined} />
            {content}
            {ring}
            {!hideIndexes && (
              <text className={`${css.idx} ${idxHot ? css.idxHot : ''}`} x={0} y={-h / 2 - 7} textAnchor="middle" style={L ? { fontSize: 10.5 } : { fontSize: 8.5 }}>
                {i}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}

/* ------------------------------------------------------------------ */
/* Keys: chain nodes, probe entries, tree nodes                        */
/* ------------------------------------------------------------------ */

function keyTable(sim: HashSim, key: string): Table | null {
  if (sim.table.has(key)) return sim.table;
  if (sim.next?.has(key)) return sim.next;
  return null;
}

export function LinksView({ sim, dim }: { sim: HashSim; dim: boolean }) {
  const out: ReactNode[] = [];
  const tables = sim.next ? [sim.table, sim.next] : [sim.table];
  if (sim.cfg.view !== 'table' && sim.cfg.view !== 'race') return null;
  for (const t of tables) {
    if (t.mode !== 'chain') continue;
    const R = rackOf(t);
    t.chains.forEach((chain, b) => {
      if (!chain.length) return;
      const s = sim.boxes.get(slotId(R, b));
      if (!live(s)) return;
      if (t.trees.has(b)) {
        const shape = t.treeShape(b);
        let root: string | null = null;
        for (const [k, v] of shape) {
          if (v.level === 0) root = k;
          if (!v.parent) continue;
          const p = sim.boxes.get(keyId(v.parent));
          const c = sim.boxes.get(keyId(k));
          if (!live(p) || !live(c)) continue;
          out.push(<line key={`e-${k}`} className={css.link} x1={p.x} y1={p.y + p.h / 2} x2={c.x} y2={c.y - c.h / 2} stroke={SIG.res} strokeOpacity={0.55} />);
        }
        const r = root ? sim.boxes.get(keyId(root)) : undefined;
        if (live(r)) out.push(<line key={`r-${R}-${b}`} className={css.link} x1={s.x} y1={s.y} x2={r.x} y2={r.y - r.h / 2} />);
        return;
      }
      let prev = { x: s.x, y: s.y };
      chain.forEach((k, d) => {
        const n = sim.boxes.get(keyId(k));
        if (!live(n)) return;
        const y2 = n.y - n.h / 2;
        out.push(<line key={`l-${k}`} className={css.link} x1={prev.x} y1={prev.y + (d === 0 ? 0 : 0)} x2={n.x} y2={y2 - 1} opacity={n.alpha} />);
        if (d > 0) out.push(<path key={`a-${k}`} d={`M${n.x - 3},${y2 - 5} L${n.x},${y2 - 1} L${n.x + 3},${y2 - 5}`} fill="none" stroke="rgba(143,166,201,0.6)" strokeWidth={1.1} opacity={n.alpha} />);
        prev = { x: n.x, y: n.y + n.h / 2 };
      });
    });
  }
  return <g opacity={dim ? 0.3 : 1}>{out}</g>;
}

export function KeysView({ sim, dim }: { sim: HashSim; dim: boolean }) {
  const L = sim.orient === 'landscape';
  const boxes = [...sim.boxes.values()].filter((b) => b.id.startsWith('k:') && live(b));
  return (
    <g opacity={dim ? 0.3 : 1}>
      {boxes.map((b) => {
        const key = b.id.slice(2);
        const t = keyTable(sim, key);
        const probe = (t?.mode ?? sim.cfg.mode) === 'probe';
        const mark = sim.markOf(b.id);
        const a = age(sim, mark);
        const k = mark?.kind;
        let stroke = probe ? 'rgba(69,213,255,0.5)' : 'rgba(143,166,201,0.55)';
        let glow = 0;
        let glowColor: string = SIG.res;
        let dash: string | undefined;
        if (k === 'cmp') {
          stroke = SIG.warn;
          glow = 0.5;
          glowColor = SIG.warn;
        } else if (k === 'hit') {
          stroke = SIG.res;
          glow = 0.5;
        } else if (k === 'skip') {
          const f = clamp(1 - a / 0.8, 0, 1);
          if (f > 0) stroke = SIG.heavy;
          glow = 0.35 * f;
          glowColor = SIG.heavy;
        } else if (k === 'fresh') {
          glow = clamp(1 - a / 1.3, 0, 1) * 0.6;
          if (glow > 0.05) stroke = SIG.res;
        } else if (k === 'lift') {
          stroke = SIG.warn;
          dash = '3 3';
          glow = 0.3;
          glowColor = SIG.warn;
        } else if (k === 'moved' || k === 'stay') {
          const f = clamp(1 - a / 1.1, 0, 1);
          glow = f * 0.55;
          glowColor = k === 'moved' ? SIG.warn : SIG.res;
          if (f > 0.1) stroke = glowColor;
        }
        const w = b.w;
        const h = b.h;
        const fs = fitFont(key, w, probe ? (L ? 13.5 : 10) : L ? 12.5 : 9.5);
        const badge = L && (k === 'skip' ? a < 0.9 : k === 'hit') ? (k === 'hit' ? '=' : '≠') : null;
        return (
          <g key={b.id} transform={`translate(${b.x},${b.y})`} opacity={b.alpha}>
            {glow > 0.01 && <rect x={-w / 2 - 4} y={-h / 2 - 4} width={w + 8} height={h + 8} rx={8} fill="none" stroke={glowColor} strokeWidth={3} opacity={glow * 0.5} />}
            <rect
              className={css.node}
              x={-w / 2}
              y={-h / 2}
              width={w}
              height={h}
              rx={probe ? 5 : 4}
              style={{ stroke, strokeDasharray: dash, fill: probe ? '#0f1d33' : undefined }}
            />
            <text className={css.keyText} x={0} y={fs * 0.36} textAnchor="middle" fontSize={fs}>
              {key}
            </text>
            {badge && (
              <g transform={`translate(${w / 2 + 1},0)`}>
                <circle r={7} fill="var(--ink-1)" stroke={k === 'hit' ? SIG.res : SIG.heavy} strokeWidth={1.1} />
                <text className={css.mono} x={0} y={3.6} textAnchor="middle" fontSize={10} fill={k === 'hit' ? SIG.res : SIG.heavy} fontWeight={700}>
                  {badge}
                </text>
              </g>
            )}
          </g>
        );
      })}
    </g>
  );
}

/* ------------------------------------------------------------------ */
/* Keys in flight                                                      */
/* ------------------------------------------------------------------ */

export function ChipsView({ sim }: { sim: HashSim }) {
  const L = sim.orient === 'landscape';
  const fs = L ? 12 : 9.5;
  const h = L ? 21 : 17;
  return (
    <g>
      {sim.flightViews().map((p) => {
        const label = p.label ?? '';
        const w = label.length * fs * 0.62 + 14;
        return (
          <g key={p.id}>
            {p.trail && <line className={stage.trail} x1={p.tx} y1={p.ty} x2={p.x} y2={p.y} stroke={p.color} strokeWidth={5} opacity={0.2} />}
            <rect x={p.x - w / 2 - 3} y={p.y - h / 2 - 3} width={w + 6} height={h + 6} rx={(h + 6) / 2} fill={p.color} opacity={0.12} />
            <rect x={p.x - w / 2} y={p.y - h / 2} width={w} height={h} rx={h / 2} fill="rgba(7,11,20,0.96)" stroke={p.color} strokeWidth={1.3} />
            <text className={css.chipText} x={p.x} y={p.y + fs * 0.36} textAnchor="middle" fontSize={fs} fill={p.color}>
              {label}
            </text>
          </g>
        );
      })}
    </g>
  );
}

/* ------------------------------------------------------------------ */
/* Python: entries in insertion order                                  */
/* ------------------------------------------------------------------ */

export function EntriesView({ sim, dim }: { sim: HashSim; dim: boolean }) {
  const e = sim.geo.entries;
  const d = sim.py;
  if (!e || !d) return null;
  const L = sim.orient === 'landscape';
  const x0 = e.x - e.w / 2;
  const head = L ? 26 : 22;
  const fs = L ? 11.5 : 10;
  const cols = L ? [14, 56, 190, 300] : [10, 40, 150, 250];
  const rack = `P${sim.pyGen}`;
  const links: ReactNode[] = [];
  d.indices.forEach((v, i) => {
    if (v == null) return;
    const s = sim.boxes.get(slotId(rack, i));
    const r = sim.boxes.get(entryId(v));
    if (!live(s) || !live(r)) return;
    const fresh = sim.pyFresh === v;
    const x1 = s.x;
    const y1 = s.y + s.h / 2;
    const x2 = x0 + 8;
    const y2 = r.y;
    links.push(
      <path
        key={`lk-${i}`}
        d={`M${x1},${y1} C${x1},${y1 + 40} ${x2 - 40},${y2} ${x2},${y2}`}
        fill="none"
        stroke={fresh ? SIG.res : 'rgba(143,166,201,0.2)'}
        strokeWidth={fresh ? 1.5 : 1}
      />,
    );
  });
  return (
    <g opacity={dim ? 0.3 : 1}>
      {links}
      <text className={css.caps} x={x0} y={e.y + 9} fill={SIG.req}>
        entries · insertion order
      </text>
      {['#', 'hash', 'key', 'value'].map((c, i) =>
        !L && i === 1 ? null : (
          <text key={c} className={css.caps} x={x0 + cols[i] + (i === 0 ? 0 : 0)} y={e.y + head - 4} fill="var(--text-3)" style={{ fontSize: 8.5 }}>
            {c}
          </text>
        ),
      )}
      {d.entries.map((en, n) => {
        const b = sim.boxes.get(entryId(n));
        if (!live(b)) return null;
        const fresh = sim.pyFresh === n;
        return (
          <g key={n} opacity={b.alpha}>
            <rect x={x0} y={b.y - b.h / 2} width={e.w} height={b.h} rx={4} fill={fresh ? 'rgba(75,227,160,0.08)' : 'rgba(11,19,36,0.85)'} stroke={fresh ? SIG.res : 'rgba(143,166,201,0.22)'} />
            <text className={css.mono} x={x0 + cols[0]} y={b.y + 4} fontSize={fs} fill={SIG.warn}>
              {n}
            </text>
            {L && (
              <text className={css.mono} x={x0 + cols[1]} y={b.y + 4} fontSize={fs} fill="var(--text-3)">
                {fmt(en.hash)}
              </text>
            )}
            <text className={css.keyText} x={x0 + cols[2]} y={b.y + 4} fontSize={fs}>
              {`'${en.key}'`}
            </text>
            <text className={css.mono} x={x0 + cols[3]} y={b.y + 4} fontSize={fs} fill="var(--text-2)">
              {`'${phoneOf(en.key)}'`}
            </text>
          </g>
        );
      })}
    </g>
  );
}

/* ------------------------------------------------------------------ */
/* Amortized cost chart                                                */
/* ------------------------------------------------------------------ */

export function ChartView({ sim }: { sim: HashSim }) {
  const c = sim.geo.chart;
  const ch = sim.chart;
  if (!c) return null;
  const L = sim.orient === 'landscape';
  const target = ch?.target ?? 64;
  const maxY = target;
  const bw = c.w / target;
  const yOf = (v: number) => c.y + c.h - (v / maxY) * c.h;
  const bars = ch?.bars ?? [];
  const n = bars.length;
  const avgPts: string[] = [];
  for (let i = 0, run = 0; i < bars.length; i++) {
    run += bars[i].work;
    avgPts.push(`${(c.x + (i + 0.5) * bw).toFixed(1)},${yOf(run / (i + 1)).toFixed(1)}`);
  }
  const ticks = [0, 16, 32, 48, 64].filter((t) => t <= maxY);
  return (
    <g>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={c.x} x2={c.x + c.w} y1={yOf(t)} y2={yOf(t)} stroke="rgba(143,166,201,0.1)" />
          <text className={css.idx} x={c.x - 8} y={yOf(t) + 3.5} textAnchor="end">
            {t}
          </text>
        </g>
      ))}
      <line x1={c.x} x2={c.x + c.w} y1={c.y + c.h} y2={c.y + c.h} stroke="rgba(143,166,201,0.45)" />
      <line x1={c.x} x2={c.x} y1={c.y} y2={c.y + c.h} stroke="rgba(143,166,201,0.45)" />
      <text className={css.caps} x={c.x} y={c.y - 12} fill="var(--text-3)">
        keys touched by each insert
      </text>
      <text className={css.caps} x={c.x + c.w} y={c.y + c.h + (L ? 26 : 22)} textAnchor="end" fill="var(--text-3)">
        insert number →
      </text>
      {[1, 16, 32, 48, 64].map((t) =>
        t <= target ? (
          <text key={t} className={css.idx} x={c.x + (t - 0.5) * bw} y={c.y + c.h + 13} textAnchor="middle">
            {t}
          </text>
        ) : null,
      )}
      {/* Growing by one slot at a time would copy everything on every insert. */}
      <line x1={c.x} y1={yOf(0)} x2={c.x + c.w} y2={yOf(target)} stroke={SIG.err} strokeOpacity={0.55} strokeDasharray="4 5" />
      <text className={css.mono} x={c.x + c.w * 0.5 + 10} y={yOf(target * 0.5) - 10} fontSize={L ? 10.5 : 9} fill={SIG.err} fillOpacity={0.85} transform={`rotate(${(-Math.atan2(c.h, c.w) * 180) / Math.PI} ${c.x + c.w * 0.5 + 10} ${yOf(target * 0.5) - 10})`}>
        grow by 1 slot: copy everything, every time
      </text>
      {bars.map((b) => {
        const x = c.x + (b.n - 1) * bw + Math.max(0.5, bw * 0.12);
        const w = Math.max(1, bw * 0.76);
        const y = yOf(b.work);
        const fresh = b.n === n;
        return (
          <g key={b.n}>
            <rect x={x} y={y} width={w} height={c.y + c.h - y} rx={Math.min(2, w / 2)} fill={b.resize ? SIG.warn : SIG.req} opacity={b.resize ? 0.9 : fresh ? 1 : 0.7} />
            {b.resize && (
              <text className={css.mono} x={x - 4} y={y + 12} textAnchor="end" fontSize={L ? 10.5 : 8.5} fill={SIG.warn} style={HALO}>
                {`resize → ${b.cap}`}
              </text>
            )}
          </g>
        );
      })}
      {avgPts.length > 1 && <polyline points={avgPts.join(' ')} fill="none" stroke={SIG.res} strokeWidth={2.2} strokeLinejoin="round" />}
      {n > 0 && ch && (
        <g transform={`translate(${c.x + (n - 0.5) * bw},${yOf(ch.total / n)})`}>
          <circle r={4} fill={SIG.res} />
          <text
            className={css.mono}
            x={n / target > 0.6 ? -10 : 10}
            y={-12}
            textAnchor={n / target > 0.6 ? 'end' : 'start'}
            fontSize={L ? 12 : 10}
            fill={SIG.res}
            fontWeight={600}
            style={HALO}
          >
            {`average ${(ch.total / n).toFixed(2)} per insert`}
          </text>
        </g>
      )}
    </g>
  );
}

/* ------------------------------------------------------------------ */
/* Cost of a miss vs load factor (large-table formulas)                */
/* ------------------------------------------------------------------ */

/** Expected key comparisons for a miss on a big table: Knuth's ½(1 + 1/(1−α)²) probes, minus the empty one. */
export const probeMiss = (a: number) => 0.5 * (1 / (1 - a) ** 2 - 1);

export function CurveView({ sim }: { sim: HashSim }) {
  const c = sim.geo.curve;
  if (!c) return null;
  const L = sim.orient === 'landscape';
  const t = sim.table;
  const a = t.count / t.cap;
  const yMax = 10;
  const X = (al: number) => c.x + al * c.w;
  const Y = (v: number) => c.y + c.h - (Math.min(v, yMax) / yMax) * c.h;
  const pts: string[] = [];
  for (let al = 0; al <= 0.99; al += 0.01) {
    const v = probeMiss(al);
    if (v > yMax) {
      // finish exactly at the top edge
      const edge = 1 - 1 / Math.sqrt(2 * yMax + 1);
      pts.push(`${X(edge).toFixed(1)},${Y(yMax).toFixed(1)}`);
      break;
    }
    pts.push(`${X(al).toFixed(1)},${Y(v).toFixed(1)}`);
  }
  const probeActive = t.mode === 'probe';
  const pv = a >= 1 ? Infinity : probeMiss(a);
  const fs = L ? 11 : 9.5;
  return (
    <g>
      <text className={css.caps} x={c.x} y={c.y - 14} fill="var(--text-3)">
        cost of a miss on a big table
      </text>
      {[0, 5, 10].map((v) => (
        <g key={v}>
          <line x1={c.x} x2={c.x + c.w} y1={Y(v)} y2={Y(v)} stroke="rgba(143,166,201,0.1)" />
          <text className={css.idx} x={c.x - 7} y={Y(v) + 3.5} textAnchor="end">
            {v}
          </text>
        </g>
      ))}
      {[0, 0.25, 0.5, 0.75, 1].map((v) => (
        <text key={v} className={css.idx} x={X(v)} y={c.y + c.h + 14} textAnchor="middle">
          {v === 0 ? '0' : v === 1 ? '1' : v.toFixed(2).replace(/^0/, '')}
        </text>
      ))}
      <text className={css.mono} x={c.x + c.w} y={c.y + c.h + 28} textAnchor="end" fontSize={L ? 10 : 9} fill="var(--text-3)" letterSpacing="0.08em">
        load factor α →
      </text>
      <line x1={c.x} x2={c.x + c.w} y1={c.y + c.h} y2={c.y + c.h} stroke="rgba(143,166,201,0.45)" />
      <line x1={c.x} x2={c.x} y1={c.y} y2={c.y + c.h} stroke="rgba(143,166,201,0.45)" />
      <polyline points={`${X(0)},${Y(0)} ${X(1)},${Y(1)}`} fill="none" stroke={SIG.res} strokeWidth={probeActive ? 1.5 : 2.6} opacity={probeActive ? 0.6 : 1} />
      <polyline points={pts.join(' ')} fill="none" stroke={SIG.heavy} strokeWidth={probeActive ? 2.6 : 1.5} opacity={probeActive ? 1 : 0.6} strokeLinejoin="round" />
      {/* Left of the steep part of the curve: that corner of the chart is always empty. */}
      <text className={css.mono} x={X(0.71)} y={Y(7.8)} textAnchor="end" fontSize={fs} fill={SIG.heavy} style={HALO}>
        linear probing
      </text>
      <text className={css.mono} x={X(1) - 2} y={Y(1) - 8} textAnchor="end" fontSize={fs} fill={SIG.res} style={HALO}>
        chaining
      </text>
      <line x1={X(a)} x2={X(a)} y1={c.y} y2={c.y + c.h} stroke={SIG.warn} strokeDasharray="3 4" strokeOpacity={0.8} />
      <circle cx={X(a)} cy={Y(a)} r={3.5} fill={SIG.res} />
      <circle cx={X(a)} cy={Y(pv)} r={3.8} fill={SIG.heavy} />
      <text className={css.mono} x={X(a) + (a > 0.6 ? -8 : 8)} y={Y(pv) + (pv >= yMax ? 12 : -8)} textAnchor={a > 0.6 ? 'end' : 'start'} fontSize={fs} fill={SIG.heavy} fontWeight={600} style={HALO}>
        {Number.isFinite(pv) ? (pv > yMax ? `↑ ${pv.toFixed(0)}` : pv.toFixed(1)) : '↑ ∞'}
      </text>
    </g>
  );
}

/* ------------------------------------------------------------------ */
/* Markup glow for hovered narration terms                             */
/* ------------------------------------------------------------------ */

export function GlowView({ sim, target }: { sim: HashSim; target: string | null }) {
  if (!target) return null;
  const r = sim.targetRect(target);
  if (!r) return null;
  return <rect x={r.x - r.w / 2 - 6} y={r.y - r.h / 2 - 6} width={r.w + 12} height={r.h + 12} rx={9} fill="none" stroke="var(--accent)" strokeWidth={1.4} strokeDasharray="3 3" />;
}

/* ------------------------------------------------------------------ */
/* Everything together                                                 */
/* ------------------------------------------------------------------ */

export function Scene({
  sim,
  focus,
  highlight,
}: {
  sim: HashSim;
  /** What the step is about; everything else is dimmed */
  focus?: ('machine' | 'table' | 'list')[];
  highlight: string | null;
}) {
  const v = sim.cfg.view;
  const f = focus ?? [];
  const dimM = f.length > 0 && !f.includes('machine');
  const dimT = f.length > 0 && !f.includes('table');
  const dimL = f.length > 0 && !f.includes('list');
  const pickable = !!sim.game?.awaitingStageClick;
  if (v === 'chart') {
    return (
      <>
        <ChartView sim={sim} />
        <GlowView sim={sim} target={highlight} />
      </>
    );
  }
  return (
    <>
      <RackView sim={sim} dimTable={dimT} dimList={dimL} pickable={pickable} onSlot={(id) => sim.pick(id)} />
      <LinksView sim={sim} dim={dimT} />
      <KeysView sim={sim} dim={dimT} />
      <EntriesView sim={sim} dim={dimT} />
      <CurveView sim={sim} />
      <MachineView sim={sim} dim={dimM} />
      <OpCardView sim={sim} dim={dimM} />
      <ChipsView sim={sim} />
      <Effects sim={sim} />
      <GlowView sim={sim} target={highlight} />
    </>
  );
}
