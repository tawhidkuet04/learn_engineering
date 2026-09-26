'use client';

import { Hud, type HudItem, type LegendItem } from '@/components/stage/chrome';
import { Readout, RLine, RResult, RRow, RRows, StagePrompt } from '@/components/stage/overlays';
import { SIG } from '@/lib/sim/colors';
import { ATTACK_KEYS, birthday, fmt, polyHash } from './hashing';
import type { HashSim } from './sim';
import type { HudKey, LegendKey, ReadoutKind, Step } from './types';
import css from './ht.module.css';

/* ------------------------------------------------------------------ */
/* HUD                                                                 */
/* ------------------------------------------------------------------ */

function LoadMeter({ load, limit }: { load: number; limit: number }) {
  const over = Number.isFinite(limit) && load > limit + 1e-9;
  const color = over ? SIG.err : load >= 0.7 ? SIG.heavy : SIG.res;
  return (
    <div className={css.meterRow}>
      <span className={css.meterVal} style={{ color }}>
        {load.toFixed(2)}
      </span>
      <span className={css.meter}>
        <i style={{ width: `${Math.min(1, load) * 100}%`, background: color }} />
        {Number.isFinite(limit) && <b style={{ left: `${Math.min(1, limit) * 100}%` }} />}
      </span>
    </div>
  );
}

export function hudItems(sim: HashSim, keys: HudKey[]): HudItem[] {
  const t = sim.table;
  const py = sim.cfg.view === 'pydict' ? sim.py : null;
  const count = py ? py.entries.length : t.count + (sim.next?.count ?? 0);
  const cap = py ? py.size : t.cap;
  const items: HudItem[] = [];
  for (const k of keys) {
    switch (k) {
      case 'cmp':
        items.push({ label: 'comparisons', value: sim.cmp, tone: sim.cmp >= 5 ? 'warn' : undefined });
        break;
      case 'steps':
        items.push({ label: 'steps', value: sim.cmp, tone: sim.cmp ? 'good' : undefined });
        break;
      case 'items':
        items.push({ label: sim.cfg.view === 'list' ? 'contacts' : 'keys', value: sim.cfg.view === 'list' ? sim.list.length : count });
        break;
      case 'load':
        items.push({ label: 'load factor', value: '', custom: <LoadMeter load={count / cap} limit={py ? 2 / 3 : sim.cfg.maxLoad} /> });
        break;
      case 'cap':
        items.push({ label: py ? 'index slots' : 'buckets', value: sim.next ? `${t.cap} → ${sim.next.cap}` : cap, tone: sim.next ? 'warn' : undefined });
        break;
      case 'longest': {
        const n = t.longestChain();
        const label = t.mode === 'probe' ? 'longest cluster' : t.trees.size ? 'biggest bucket' : 'longest chain';
        items.push({ label, value: n, tone: t.trees.size ? undefined : n >= 5 ? 'bad' : n >= 3 ? 'warn' : undefined });
        break;
      }
      case 'used':
        items.push({ label: 'buckets used', value: `${t.usedBuckets()} / ${t.cap}` });
        break;
      case 'threshold': {
        const thr = Math.floor(t.cap * 0.75);
        items.push({ label: 'resize threshold', value: thr, unit: `${t.cap} × 0.75`, tone: count >= thr ? 'warn' : undefined });
        break;
      }
      case 'total':
        items.push({ label: 'comparisons, total', value: sim.totalCmp, tone: sim.totalCmp >= 20 ? 'bad' : undefined });
        break;
      case 'tombs':
        items.push({ label: 'tombstones', value: t.tombstones() });
        break;
      case 'birthday': {
        // The key hovering over a taken bucket counts: it has arrived, it just has nowhere to go yet.
        const n = count + (sim.last?.result === 'collision' ? 1 : 0);
        const p = birthday(n, cap);
        items.push({ label: 'collision odds', value: `${Math.round(p * 100)}%`, unit: `${n} key${n === 1 ? '' : 's'}`, tone: p >= 0.5 ? 'warn' : undefined });
        break;
      }
      case 'rehashed':
        items.push({ label: 'rehashed', value: sim.resizing ? `${sim.resizing.done} / ${sim.resizing.total}` : sim.table.cap > sim.cfg.cap ? 'done' : '–' });
        break;
      case 'race': {
        const r = sim.race;
        items.push({ label: 'list scan', value: r?.list.cmp ?? 0, unit: r?.winner === 'list' ? 'wins' : undefined, tone: r?.winner === 'list' ? 'good' : undefined });
        items.push({ label: 'hash table', value: r?.table.cmp ?? 0, unit: r?.winner === 'table' ? 'wins' : undefined, tone: r?.winner === 'table' ? 'good' : undefined });
        break;
      }
      case 'chart': {
        const c = sim.chart;
        const n = c?.bars.length ?? 0;
        items.push({ label: 'inserts', value: n });
        items.push({ label: 'keys touched', value: c?.total ?? 0 });
        items.push({ label: 'per insert', value: n ? (c!.total / n).toFixed(2) : '–', tone: 'good' });
        break;
      }
    }
  }
  return items;
}

/* ------------------------------------------------------------------ */
/* Legend                                                              */
/* ------------------------------------------------------------------ */

const LEG: Record<LegendKey, LegendItem> = {
  put: { label: 'insert', color: SIG.req },
  get: { label: 'lookup', color: SIG.hc },
  del: { label: 'delete', color: SIG.pink },
  cmp: { label: 'comparing', color: SIG.warn, shape: 'ring' },
  hit: { label: 'found', color: SIG.res, shape: 'ring' },
  taken: { label: 'taken', color: SIG.heavy, shape: 'ring' },
  miss: { label: 'not found', color: SIG.err, shape: 'ring' },
  tomb: { label: 'tombstone', color: SIG.hc, shape: 'square' },
  moved: { label: 'moved', color: SIG.warn, shape: 'ring' },
  stay: { label: 'stayed', color: SIG.res, shape: 'ring' },
  bar: { label: 'insert', color: SIG.req, shape: 'square' },
  spike: { label: 'insert + resize', color: SIG.warn, shape: 'square' },
  avg: { label: 'average', color: SIG.res, shape: 'line' },
  naive: { label: 'grow by 1', color: SIG.err, shape: 'line' },
  tree: { label: 'tree bucket', color: SIG.res, shape: 'line' },
};

export const legendFor = (keys: LegendKey[] = []) => keys.map((k) => LEG[k]);

/* ------------------------------------------------------------------ */
/* Readouts                                                            */
/* ------------------------------------------------------------------ */

/** Lowest point of the drawn table (slots and keys), for placing readouts under it. */
function contentBottom(sim: HashSim) {
  let y = 0;
  for (const b of sim.boxes.values()) {
    if (b.removing || Number.isNaN(b.y)) continue;
    if (/^(t\d+|L|P\d+):\d+$/.test(b.id) || b.id.startsWith('k:')) y = Math.max(y, b.y + b.h / 2);
  }
  return y;
}

function StepReadout({ sim, kind }: { sim: HashSim; kind: ReadoutKind }) {
  const L = sim.orient === 'landscape';
  const x = sim.w / 2;
  const y = contentBottom(sim) + (L ? 22 : 16);
  const W = L ? 300 : Math.min(300, sim.w - 40);
  const fits = y + 110 < sim.h - (L ? 70 : 60);
  const anchor = fits ? 'below' : 'strip';

  switch (kind) {
    case 'hashlog':
      return (
        <Readout x={x} y={y} anchor={anchor} head="hash log" width={W}>
          {sim.hashLog.length ? (
            sim.hashLog.map((e, i) => (
              <RLine key={i}>
                {e.key.padEnd(6, ' ')} → <em>{fmt(e.hash)}</em>
                {e.again ? <span style={{ color: SIG.res }}> ✓ same</span> : null}
              </RLine>
            ))
          ) : (
            <RLine dim>nothing hashed yet</RLine>
          )}
        </Readout>
      );
    case 'address': {
      const i = sim.jumpInfo?.i;
      return (
        <Readout x={x} y={y} anchor={anchor} head="array math" width={W}>
          {i == null ? (
            <RLine dim>waiting…</RLine>
          ) : (
            <>
              <RLine>
                address of <em>contacts[{i}]</em>
              </RLine>
              <RLine>= start + {i} × entry size</RLine>
              <RLine>
                = 4000 + {i} × 16 = <em>{4000 + i * 16}</em>
              </RLine>
              <RResult>
                <b>1 step</b>, however long the array
              </RResult>
            </>
          )}
        </Readout>
      );
    }
    case 'birthday': {
      const n = sim.table.count + (sim.last?.result === 'collision' ? 1 : 0);
      const ks = L ? [2, 3, 4, 5, 6] : [3, 4, 5];
      return (
        <Readout x={x} y={y} anchor="below" head="chance of a collision · 10 buckets" width={W}>
          <RRows>
            {ks.map((k) => (
              <RRow key={k} label={`${k} keys`} n={Math.round(birthday(k, 10) * 10)} value={`${Math.round(birthday(k, 10) * 100)}%`} good={k === n} />
            ))}
          </RRows>
          {L && (
            <RResult>
              11 keys: <b>100%</b>, there aren’t enough buckets
            </RResult>
          )}
        </Readout>
      );
    }
    case 'attack': {
      // On phones the flooded chain needs the room; the narration carries these numbers.
      if (!sim.attacked || !L) return null;
      const h = polyHash(ATTACK_KEYS[0]);
      return (
        <Readout x={L ? sim.w * 0.27 : x} y={L ? y - 4 : y} anchor={L ? 'below' : 'strip'} head="8 keys, one hash" width={L ? 300 : W}>
          <RLine>
            hash = <em>{fmt(h)}</em>
          </RLine>
          <RLine>
            mod 10 = {h % 10} · mod 20 = {h % 20} · mod 64 = {h % 64}
          </RLine>
          <RResult>
            same hash, <b>same bucket</b> at any size
          </RResult>
        </Readout>
      );
    }
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ */
/* Everything on top of the SVG                                        */
/* ------------------------------------------------------------------ */

export function Overlay({ sim, step }: { sim: HashSim; step: Step }) {
  const L = sim.orient === 'landscape';
  const q = sim.game?.pending;
  const m = sim.boxes.get('M');
  const hud = hudItems(sim, step.hud ?? []);
  return (
    <>
      {!(q && !L) && <Hud items={L ? hud : hud.slice(0, 3)} />}
      {q?.ask &&
        (L && m && !Number.isNaN(m.x) ? (
          <StagePrompt x={m.x} y={m.y - m.h / 2 - 12}>
            {q.ask}
          </StagePrompt>
        ) : (
          <StagePrompt x={sim.w / 2} y={46}>
            {q.ask}
          </StagePrompt>
        ))}
      {step.readout && <StepReadout sim={sim} kind={step.readout} />}
    </>
  );
}
