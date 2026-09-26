'use client';

import type { ReactNode } from 'react';
import { CodeTrace } from '@/components/stage/CodeTrace';
import { Hud, type HudItem } from '@/components/stage/chrome';
import { StagePrompt } from '@/components/stage/overlays';
import { TILE_ROWS } from './machine';
import { HUMAN_ROWS, LEVELS, LEVEL_IDS, avgNs, fitsIn, fmtBytes, fmtNs, hex, human, levelMix } from './model';
import { LEVEL_COLOR, MESI_COLOR } from './Scene';
import type { CacheSim } from './sim';
import css from './cc.module.css';

const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(' ');

export type HudKey =
  | 'cycles'
  | 'waiting'
  | 'pass'
  | 'passes'
  | 'last'
  | 'stopwatch'
  | 'hits'
  | 'misses'
  | 'rate'
  | 'time'
  | 'pf'
  | 'nspa'
  | 'rows'
  | 'cols'
  | 'ratio'
  | 'ws'
  | 'avg'
  | 'fits'
  | 'incA'
  | 'incB'
  | 'xfers'
  | 'nsinc';

export type ReadoutKey = 'access' | 'pf' | 'human' | 'levels' | 'mix' | 'mesi' | 'fs';

const pct = (f: number) => `${Math.round(f * 100)}%`;

/* ------------------------------------------------------------------ */
/* HUD                                                                 */
/* ------------------------------------------------------------------ */

function hudItems(sim: CacheSim, keys: HudKey[]): HudItem[] {
  const out: HudItem[] = [];
  const m = sim.ma;
  const W = sim.wall;
  const land = sim.orient === 'landscape';
  for (const k of keys) {
    switch (k) {
      case 'cycles': {
        const c = sim.wallCycles();
        out.push({ label: 'This load', value: c, unit: c === 1 ? 'cycle' : 'cycles', tone: c >= 100 ? 'bad' : 'good' });
        break;
      }
      case 'waiting': {
        const total = W.waitNs + W.workNs;
        out.push({ label: 'Waiting', value: total ? `${((W.waitNs / total) * 100).toFixed(1)}%` : '—', unit: total && land ? 'of the time' : undefined, tone: total ? (W.waitNs / total > 0.9 ? 'bad' : 'warn') : undefined });
        break;
      }
      case 'pass': {
        const last = W.passes[W.passes.length - 1];
        out.push({ label: 'Whole list', value: last != null ? fmtNs(last, true) : W.inLoad || W.passNs ? `${fmtNs(W.passNs, true)}…` : '—' });
        break;
      }
      case 'passes': {
        const p = W.passes;
        const first = p.length >= 1 ? p[0] : null;
        const second = p.length >= 2 ? p[1] : null;
        out.push({ label: land ? 'Walk 1 · cold' : 'Walk 1', value: first != null ? fmtNs(first, true) : W.pass === 0 ? `${fmtNs(W.passNs, true)}…` : '—', tone: first != null ? 'warn' : undefined });
        out.push({
          label: land ? 'Walk 2 · warm' : 'Walk 2',
          value: second != null ? fmtNs(second, true) : W.pass === 1 ? `${fmtNs(W.passNs, true)}…` : '—',
          tone: second != null ? 'good' : undefined,
        });
        break;
      }
      case 'last': {
        const L = sim.lad;
        const lvl = L.busy ? L.level : L.last?.level;
        out.push({
          label: L.busy ? 'Loading from' : 'Last load',
          value: lvl ? LEVELS[lvl].name : '—',
          unit: lvl ? (land ? `${LEVELS[lvl].ns} ns · ${LEVELS[lvl].ns * 4} cycles` : `${LEVELS[lvl].ns} ns`) : undefined,
          tone: lvl === 'ram' ? 'warn' : lvl ? 'good' : undefined,
        });
        break;
      }
      case 'stopwatch': {
        const ns = sim.ladElapsed();
        out.push({ label: land ? 'If 1 ns took 1 second' : 'Human time', value: ns ? human(ns) : '—', wide: land, tone: ns >= 100 ? 'warn' : undefined });
        break;
      }
      case 'hits':
        out.push({ label: 'L1 hits', value: m.hits, tone: m.hits ? 'good' : undefined });
        break;
      case 'misses':
        out.push({ label: 'Misses', value: m.misses, unit: land ? '→ RAM' : undefined, tone: m.misses ? 'warn' : undefined });
        break;
      case 'rate': {
        const n = m.accesses;
        out.push({ label: 'Hit rate', value: n ? pct(m.hits / n) : '—', tone: n ? (m.hits / n >= 0.8 ? 'good' : m.hits / n >= 0.5 ? 'warn' : 'bad') : undefined });
        break;
      }
      case 'time':
        out.push({ label: 'Time', value: fmtNs(m.ns, true) });
        break;
      case 'pf':
        out.push({ label: 'Prefetched', value: m.prefetches, unit: land ? 'lines' : undefined, tone: m.prefetches ? 'good' : undefined });
        break;
      case 'nspa': {
        const n = m.accesses;
        out.push({ label: 'Per load', value: n ? (m.ns / n).toFixed(1) : '—', unit: 'ns' });
        break;
      }
      case 'rows':
      case 'cols': {
        const mm = k === 'rows' ? sim.ma : sim.mb;
        out.push({ label: k === 'rows' ? 'Rows' : 'Columns', value: fmtNs(mm.ns, true), unit: mm.finished && land ? 'done' : undefined, tone: k === 'rows' ? 'good' : 'warn' });
        break;
      }
      case 'ratio': {
        const a = sim.ma;
        const b = sim.mb;
        const done = a.finished && b.finished;
        out.push({ label: land ? 'Columns ÷ rows' : 'Ratio', value: done ? `${(b.ns / Math.max(1, a.ns)).toFixed(1)}×` : '…', tone: done ? 'bad' : undefined });
        break;
      }
      case 'ws':
        out.push({ label: 'Working set', value: fmtBytes(sim.cfg.ws) });
        break;
      case 'avg': {
        const ns = avgNs(sim.cfg.ws);
        out.push({ label: 'Avg load', value: ns < 10 ? ns.toFixed(1) : Math.round(ns), unit: 'ns', tone: ns > 40 ? 'bad' : ns > 8 ? 'warn' : 'good' });
        break;
      }
      case 'fits': {
        const f = fitsIn(sim.cfg.ws);
        out.push({ label: 'Fits in', value: f === 'ram' ? 'RAM' : LEVELS[f].name, unit: f === 'ram' && land ? 'no cache' : undefined, tone: f === 'ram' ? 'bad' : 'good' });
        break;
      }
      case 'incA':
        out.push({ label: land ? 'Thread 0 · a' : 'a', value: sim.co.cnt[0] });
        break;
      case 'incB':
        out.push({ label: land ? 'Thread 1 · b' : 'b', value: sim.co.cnt[1] });
        break;
      case 'xfers':
        out.push({ label: 'Transfers', value: sim.co.transfers, tone: sim.co.transfers ? 'bad' : 'good' });
        break;
      case 'nsinc': {
        const v = sim.nsPerInc();
        out.push({ label: land ? 'Per increment' : 'Per a++', value: v == null ? '—' : v < 2 ? v.toFixed(1) : Math.round(v), unit: 'ns', tone: v == null ? undefined : v > 3 ? 'bad' : 'good' });
        break;
      }
    }
  }
  if (land) return out;
  // Phones: one row of chips, so the drawing below stays clear. The counters
  // are already on the core cards there.
  const skip = sim.cfg.view === 'cores' ? new Set(['Thread 0 · a', 'Thread 1 · b', 'a', 'b']) : new Set<string>();
  return out.filter((it) => !skip.has(it.label)).slice(0, 3);
}

/* ------------------------------------------------------------------ */
/* Readouts                                                            */
/* ------------------------------------------------------------------ */

function Ro({ head, children, fresh, className }: { head: ReactNode; children: ReactNode; fresh?: boolean; className?: string }) {
  return (
    <div className={cx(css.ro, fresh && css.roFresh, className)}>
      <div className={css.roHead}>{head}</div>
      {children}
    </div>
  );
}

function AccessReadout({ sim, compact }: { sim: CacheSim; compact?: boolean }) {
  const m = sim.ma;
  const asking = !!sim.game?.pending && !!sim.asking && 'e' in sim.asking;
  const op = asking ? null : (m.cur ?? m.lastOp);
  const e = asking ? m.peek() : (op?.e ?? m.peek());
  if (e == null) {
    return (
      <Ro head="the load">
        <div className={css.dim}>waiting…</div>
      </Ro>
    );
  }
  const addr = sim.addrOf(e);
  const lineAddr = addr & ~63;
  const off = addr & 63;
  const name = sim.elemName(e);
  const outcome =
    op == null ? (
      <b>?</b>
    ) : op.kind === 'hit' ? (
      <span className={css.good}>hit · 1 ns</span>
    ) : op.kind === 'miss' ? (
      <span className={css.warn}>miss → RAM · 100 ns</span>
    ) : (
      <span className={css.warn}>arriving · waited {Math.round(op.ns)} ns</span>
    );
  const formula = sim.cfg.dims === 2 ? `(${Math.floor(e / m.cols)}·16+${e % m.cols})·8` : `${e}·8`;
  if (compact) {
    return (
      <Ro head={`load ${name}`}>
        <div className={css.line}>
          {hex(addr)} → line <em>{hex(lineAddr)}</em> +{off}
        </div>
        <div className={css.result}>in L1? {outcome}</div>
      </Ro>
    );
  }
  return (
    <Ro head={`load ${name}`}>
      <div className={css.row2}>
        <span className={css.dim}>address</span>
        <span>
          0x1000 + {formula} = <b>{hex(addr)}</b>
        </span>
      </div>
      <div className={css.row2}>
        <span className={css.dim}>line</span>
        <span>
          <em>{hex(lineAddr)}</em> (address &amp; ~63)
        </span>
      </div>
      <div className={css.row2}>
        <span className={css.dim}>offset</span>
        <span>
          {off} (address &amp; 63)
        </span>
      </div>
      <div className={cx(css.result, css.row2)}>
        <span>in L1?</span>
        {outcome}
      </div>
    </Ro>
  );
}

function PfReadout({ sim, compact }: { sim: CacheSim; compact?: boolean }) {
  const m = sim.ma;
  const on = sim.cfg.prefetch;
  const inflight = m.fills.filter((f) => f.pf).map((f) => f.line);
  if (compact) {
    return (
      <Ro head={`prefetcher · ${on ? 'on' : 'off'}`}>
        <div className={css.line}>
          {on ? (m.streak >= 1 ? <>stream spotted → fetching {inflight.length ? inflight.map((l) => sim.lineName(l)).join(', ') : 'ahead'}</> : 'watching for a stream…') : 'every new line waits for RAM'}
        </div>
        <div className={css.result}>
          misses <b>{m.misses}</b> · prefetched <b>{m.prefetches}</b> · {fmtNs(m.ns, true)}
        </div>
      </Ro>
    );
  }
  return (
    <Ro head={`prefetcher · ${on ? 'on' : 'off'}`}>
      <div className={css.row2}>
        <span className={css.dim}>pattern</span>
        <span>{!on ? '—' : m.streak >= 1 ? <span className={css.good}>sequential stream</span> : 'watching…'}</span>
      </div>
      <div className={css.row2}>
        <span className={css.dim}>in flight</span>
        <span>{inflight.length ? inflight.map((l) => sim.lineName(l)).join(' ') : '—'}</span>
      </div>
      <div className={css.row2}>
        <span className={css.dim}>used before needed</span>
        <span>{m.pfUsed}</span>
      </div>
      <div className={css.result}>{on ? 'fetches the next 2 lines before you ask' : 'each new line waits a full trip'}</div>
    </Ro>
  );
}

function HumanTable({ sim, compact }: { sim: CacheSim; compact?: boolean }) {
  const L = sim.lad;
  const lvl = L.busy ? L.level : L.last?.level;
  const rowFor: Record<string, string> = { 'L1 hit': 'l1', 'L2 hit': 'l2', 'L3 hit': 'l3', RAM: 'ram' };
  return (
    <Ro head="if 1 ns took 1 second">
      <div className={css.table3}>
        {HUMAN_ROWS.map((r) => {
          const on = rowFor[r.name] === lvl;
          return (
            <div key={r.name} className={cx(css.tr, on && css.trOn)}>
              <span>{compact ? r.name.replace('Datacenter round trip', 'Datacenter trip') : r.name}</span>
              <span className={css.num}>{fmtNs(r.ns)}</span>
              <em>{human(r.ns)}</em>
            </div>
          );
        })}
      </div>
    </Ro>
  );
}

function LevelsReadout({ sim }: { sim: CacheSim }) {
  const L = sim.lad;
  const lvl = L.busy ? L.level : L.last?.level;
  return (
    <Ro head="the hierarchy">
      <div className={css.table3}>
        {LEVEL_IDS.map((id) => (
          <div key={id} className={cx(css.tr4, lvl === id && css.trOn)}>
            <span style={{ color: LEVEL_COLOR[id] }}>{LEVELS[id].name}</span>
            <span>{LEVELS[id].size}</span>
            <span className={css.dim}>{LEVELS[id].short}</span>
            <em>{LEVELS[id].range}</em>
          </div>
        ))}
      </div>
    </Ro>
  );
}

function MixReadout({ sim, compact }: { sim: CacheSim; compact?: boolean }) {
  const mix = levelMix(sim.cfg.ws);
  return (
    <Ro head={`${fmtBytes(sim.cfg.ws)} of random reads`}>
      <div className={css.stack}>
        {LEVEL_IDS.map((id, i) => (
          <i key={id} style={{ width: `${mix[i] * 100}%`, background: LEVEL_COLOR[id] }} />
        ))}
      </div>
      <div className={css.stackLegend}>
        {LEVEL_IDS.map((id, i) => (
          <span key={id}>
            <i className={css.dot} style={{ background: LEVEL_COLOR[id] }} />
            {LEVELS[id].name} {pct(mix[i])}
          </span>
        ))}
      </div>
      {!compact && <div className={css.result}>average load ≈ {avgNs(sim.cfg.ws).toFixed(1)} ns</div>}
    </Ro>
  );
}

function MesiReadout({ sim }: { sim: CacheSim }) {
  const C = sim.co;
  return (
    <Ro head="coherence protocol (MESI)" fresh>
      <div className={css.logLine}>{C.log}</div>
      <div className={css.mesiKey}>
        {(['M', 'E', 'S', 'I'] as const).map((s) => (
          <span key={s}>
            <b style={{ color: MESI_COLOR[s] }}>{s}</b> {s === 'M' ? 'modified' : s === 'E' ? 'exclusive' : s === 'S' ? 'shared' : 'invalid'}
          </span>
        ))}
      </div>
    </Ro>
  );
}

function FsReadout({ sim }: { sim: CacheSim }) {
  const C = sim.co;
  const padded = sim.cfg.cores === 'padded';
  const v = sim.nsPerInc();
  return (
    <Ro head={padded ? 'padded: one line each' : 'packed: a and b share a line'}>
      <div className={css.row2}>
        <span className={css.dim}>a · b</span>
        <span>
          {C.cnt[0]} · {C.cnt[1]}
        </span>
      </div>
      <div className={css.row2}>
        <span className={css.dim}>line transfers</span>
        <span className={C.transfers ? css.bad : css.good}>{C.transfers}</span>
      </div>
      <div className={css.result}>
        per increment: <b>{v == null ? '—' : `${v < 2 ? v.toFixed(1) : Math.round(v)} ns`}</b>
      </div>
    </Ro>
  );
}

function renderReadout(k: ReadoutKey, sim: CacheSim, compact: boolean) {
  switch (k) {
    case 'access':
      return <AccessReadout key={k} sim={sim} compact={compact} />;
    case 'pf':
      return <PfReadout key={k} sim={sim} compact={compact} />;
    case 'human':
      return <HumanTable key={k} sim={sim} compact={compact} />;
    case 'levels':
      return <LevelsReadout key={k} sim={sim} />;
    case 'mix':
      return <MixReadout key={k} sim={sim} compact={compact} />;
    case 'mesi':
      return <MesiReadout key={k} sim={sim} />;
    case 'fs':
      return <FsReadout key={k} sim={sim} />;
  }
}

/* ------------------------------------------------------------------ */
/* The loop on the stage                                               */
/* ------------------------------------------------------------------ */

function loopFor(sim: CacheSim): { code: string; active: number; mark: string } | null {
  const m = sim.ma;
  const e = sim.cursor('a');
  const i = e == null ? 0 : Math.floor(e / m.cols);
  const j = e == null ? 0 : e % m.cols;
  switch (sim.cfg.order) {
    case 'row':
      if (sim.cfg.dims === 1) return { code: 'for (int k = 0; k < 128; k++)\n    sum += a[k];', active: 2, mark: `k = ${e ?? 0}` };
      return { code: 'for (int i = 0; i < 8; i++)\n    for (int j = 0; j < 16; j++)\n        sum += a[i][j];', active: 3, mark: `i=${i} j=${j}` };
    case 'col':
    case 'colquiz':
      return { code: 'for (int j = 0; j < 16; j++)\n    for (int i = 0; i < 8; i++)\n        sum += a[i][j];', active: 3, mark: `i=${i} j=${j}` };
    case 'tile':
      return {
        code: `for (int ii = 0; ii < 8; ii += ${TILE_ROWS})\n  for (int j = 0; j < 16; j++)\n    for (int i = ii; i < ii + ${TILE_ROWS}; i++)\n      sum += a[i][j];`,
        active: 4,
        mark: `i=${i} j=${j}`,
      };
    case 'random':
      return { code: 'for (int k = 0; k < 128; k++)\n    sum += a[rand() % 128];', active: 2, mark: `a[${e ?? 0}]` };
    case 'reuse':
      return { code: 'int hot[4] = {3, 42, 77, 110};\nfor (int k = 0; k < 128; k++)\n    sum += a[hot[k % 4]];', active: 3, mark: `a[${e ?? 0}]` };
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ */
/* Stage overlay                                                       */
/* ------------------------------------------------------------------ */

export function StageOverlay({ sim, hud = [], side = [], strip }: { sim: CacheSim; hud?: HudKey[]; side?: ReadoutKey[]; strip?: ReadoutKey | null }) {
  const land = sim.orient === 'landscape';
  const v = sim.cfg.view;
  const loop = v === 'grid' && sim.cfg.code && land && sim.w >= 860 ? loopFor(sim) : null;
  return (
    <>
      <Hud items={hudItems(sim, hud)} />
      {loop && <CodeTrace x={sim.w - 14 - 300} y={14} w={300} title="the loop" lang="c" code={loop.code} active={loop.active} marks={{ [loop.active]: loop.mark }} />}
      {land && side.length > 0 && <SideReadouts sim={sim} keys={side} />}
      {!land && v === 'ladder' && side.includes('human') && <PortraitHuman sim={sim} />}
      {!land && strip && <div className={css.strip}>{renderReadout(strip, sim, true)}</div>}
      <Prompts sim={sim} />
    </>
  );
}

function SideReadouts({ sim, keys }: { sim: CacheSim; keys: ReadoutKey[] }) {
  const v = sim.cfg.view;
  if (v === 'grid') {
    const l1 = sim.boxes.get('l1');
    if (!l1) return null;
    const x = Math.max(l1.x, 152);
    return (
      <div className={css.anchored} style={{ left: x, top: l1.y + l1.h / 2 + 18, width: 280 }}>
        {keys.map((k) => renderReadout(k, sim, false))}
      </div>
    );
  }
  if (v === 'ladder') {
    const ram = sim.boxes.get('ram');
    if (!ram) return null;
    // Under the fan-out labels, clear of the title block in the corner
    const top = ram.y + ram.h / 2 + 88;
    return (
      <div className={css.anchored} style={{ left: Math.min(sim.w / 2, sim.w - 290 - 180), top, width: 350 }}>
        {keys.map((k) => renderReadout(k, sim, false))}
      </div>
    );
  }
  if (v === 'cores') {
    return (
      <div className={css.col} style={{ width: 300 }}>
        {keys.map((k) => renderReadout(k, sim, false))}
      </div>
    );
  }
  if (v === 'cliff') {
    return (
      <div className={css.col} style={{ width: 260 }}>
        {keys.map((k) => renderReadout(k, sim, false))}
      </div>
    );
  }
  return null;
}

function PortraitHuman({ sim }: { sim: CacheSim }) {
  const ram = sim.boxes.get('ram');
  if (!ram) return null;
  return (
    <div className={css.anchoredFull} style={{ top: ram.y + ram.h / 2 + 58 }}>
      <HumanTable sim={sim} compact />
    </div>
  );
}

function Prompts({ sim }: { sim: CacheSim }) {
  const q = sim.game?.pending;
  const a = sim.asking;
  if (!q || !a) return null;
  const land = sim.orient === 'landscape';
  if ('e' in a) {
    // Above the RAM box, lined up with the cell, so the grid itself stays visible.
    const g = sim.gridGeo(a.m);
    const ram = sim.boxes.get(a.m === 'a' ? 'ram' : 'ram:b');
    if (!g || !ram) return null;
    const r = sim.cellRect(g, a.e);
    const text = q.ask ?? '';
    const half = (text.length * 6.7 + 22) / 2;
    return (
      <StagePrompt x={Math.min(Math.max(r.x + r.w / 2, half + 8), sim.w - half - 8)} y={ram.y - ram.h / 2 - 8}>
        {text}
      </StagePrompt>
    );
  }
  const l3 = sim.boxes.get('l3');
  if (!l3) return null;
  const text = land ? (q.ask ?? '') : a.fs === 1 ? 'What happens to the other copy?' : 'Where is the line now?';
  return (
    <StagePrompt x={sim.w / 2} y={l3.y - l3.h / 2 - 12}>
      {text}
    </StagePrompt>
  );
}

