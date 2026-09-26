'use client';

import type { ReactNode } from 'react';
import { Hud, type HudItem } from '@/components/stage/chrome';
import { RChips, RLine, RResult, Readout, StagePrompt } from '@/components/stage/overlays';
import { ZONE_CELLS } from './gen';
import { HEAP_BLOCKS, addrHex, type GcSim } from './sim';
import css from './gc.module.css';

export type HudKey =
  | 'heap'
  | 'freed'
  | 'updates'
  | 'reachable'
  | 'minor'
  | 'major'
  | 'longest'
  | 'last'
  | 'avgMinor'
  | 'allocated'
  | 'young'
  | 'tlLongest'
  | 'tlPauses'
  | 'tlPaused'
  | 'mem'
  | 'listeners'
  | 'free'
  | 'largest';

export type ReadoutKind = 'alloc' | 'worklist' | 'holes' | 'cycle' | 'forward' | 'copy' | 'hist' | 'rs' | 'rc' | 'pg';

function hudItem(sim: GcSim, k: HudKey): HudItem | null {
  switch (k) {
    case 'heap': {
      const used = sim.heapObjs().reduce((n, o) => n + o.size, 0);
      return { label: 'Heap used', value: `${used}/${HEAP_BLOCKS}`, unit: 'blocks', tone: used >= HEAP_BLOCKS - 1 ? 'bad' : used >= 18 ? 'warn' : undefined };
    }
    case 'free': {
      const free = sim.freeBlocks().length;
      return { label: 'Free', value: free, unit: free === 1 ? 'block' : 'blocks' };
    }
    case 'largest': {
      const h = sim.holes().reduce((m, x) => Math.max(m, x.size), 0);
      return { label: 'Biggest hole', value: h, unit: h === 1 ? 'block' : 'blocks', tone: h < 3 ? 'warn' : undefined };
    }
    case 'freed':
      return { label: 'Freed', value: sim.stats.freed, unit: 'objects', tone: sim.stats.freed > 0 ? 'good' : undefined };
    case 'updates':
      return { label: 'Count updates', value: sim.stats.updates };
    case 'reachable': {
      const r = sim.reach();
      return { label: 'Reachable', value: `${r.size}/${sim.liveObjs().length}` };
    }
    case 'minor': {
      const s = sim.gen.stats();
      return { label: 'Minor GCs', value: s.minor };
    }
    case 'major': {
      const s = sim.gen.stats();
      return { label: sim.cfg.generational ? 'Major GCs' : 'Full GCs', value: s.major, tone: s.major > 0 ? 'warn' : undefined };
    }
    case 'longest': {
      const s = sim.gen.stats();
      return { label: 'Longest pause', value: s.longest ? s.longest.toFixed(1) : '–', unit: 'ms', tone: s.longest >= 15 ? 'bad' : s.longest >= 6 ? 'warn' : s.longest ? 'good' : undefined };
    }
    case 'last': {
      const l = sim.gen.last;
      return { label: 'Last pause', value: l ? l.ms.toFixed(1) : '–', unit: l ? `ms · ${l.kind}` : undefined };
    }
    case 'avgMinor': {
      const s = sim.gen.stats();
      return { label: 'Avg minor', value: s.avgMinor ? s.avgMinor.toFixed(1) : '–', unit: 'ms' };
    }
    case 'allocated':
      return { label: 'Allocated', value: sim.gen.allocated, unit: 'objects' };
    case 'young': {
      const died = sim.gen.hist[0] + sim.gen.hist[1];
      const total = sim.gen.hist.reduce((a, b) => a + b, 0);
      return { label: 'Died < 1 s', value: total ? `${Math.round((died / total) * 100)}%` : '–', tone: total ? 'good' : undefined };
    }
    case 'tlLongest': {
      const s = sim.threads.stats();
      return { label: 'Longest pause', value: s.longest || '–', unit: 'ms', tone: s.longest >= 80 ? 'bad' : s.longest >= 20 ? 'warn' : s.longest ? 'good' : undefined };
    }
    case 'tlPauses':
      return { label: 'Pauses', value: sim.threads.stats().count, unit: 'on screen' };
    case 'tlPaused':
      return { label: 'App stopped', value: `${sim.threads.stats().pausedPct}%`, unit: 'of the time' };
    case 'mem': {
      const s = sim.memSeries;
      const last = s[s.length - 1] ?? 0;
      return { label: 'Heap after GC', value: last, unit: 'MB', spark: s.length > 1 ? s : undefined, tone: last > 12 ? 'bad' : 'good', wide: true };
    }
    case 'listeners':
      return { label: 'Resize listeners', value: sim.outEdges('o:listeners').length, tone: sim.outEdges('o:listeners').length > 1 ? 'warn' : undefined };
  }
}

/** Where the one-line note sits for the current view. */
function noteAt(sim: GcSim): { x: number; y: number } {
  const g = sim.g;
  const W = sim.w;
  const H = sim.h;
  if (sim.cfg.view === 'heap' && g.strip) {
    const s = g.strip;
    const bottom = s.y + s.rows * s.ch + (s.rows - 1) * s.rowGap;
    if (g.copyRows) return { x: W / 2, y: g.land ? s.y - 44 : s.y - 50 };
    return { x: W / 2, y: bottom + (g.land ? 58 : 44) };
  }
  if (sim.cfg.view === 'gen') {
    const top = Math.min(g.frames.young?.y ?? 999, g.frames.heap?.y ?? 999);
    if (!g.land && g.chart) return { x: W / 2, y: g.chart.y + g.chart.h / 2 };
    return { x: W / 2, y: top - 22 };
  }
  if (sim.cfg.view === 'threads' && g.lanes) return { x: W / 2, y: g.lanes.ys[3] + (g.land ? 76 : 60) };
  const reg = g.regions[0];
  if (g.land) return { x: reg ? reg.x + reg.w / 2 : W / 2, y: 86 };
  if (g.strip) return { x: W / 2, y: g.strip.y - 30 };
  if (reg) return { x: W / 2, y: reg.y + reg.h + 58 };
  return { x: W / 2, y: H - 120 };
}

/** Where the yellow prompt sits when the question doesn't name a spot. */
function promptAt(sim: GcSim): { x: number; y: number } {
  const g = sim.g;
  const reg = g.regions[0];
  if (sim.cfg.view === 'heap' && g.strip) return { x: sim.w / 2, y: g.land ? g.strip.y - 186 : 92 };
  if (!reg) return { x: sim.w / 2, y: 100 };
  if (g.land) return { x: reg.x + reg.w / 2, y: 104 };
  return { x: sim.w / 2, y: reg.y + reg.h + 70 };
}

export function GcOverlay({ sim, hud, readout, noteVisible = true }: { sim: GcSim; hud: HudKey[]; readout?: ReadoutKind; noteVisible?: boolean }) {
  const items = hud
    .map((k) => hudItem(sim, k))
    .filter((x): x is HudItem => !!x)
    .slice(0, sim.orient === 'portrait' ? 3 : 8);
  const q = sim.game?.pending;
  const land = sim.g.land;
  let prompt: { x: number; y: number; node: ReactNode } | null = null;
  if (q?.ask) {
    let at = promptAt(sim);
    if (land && q.askAt && 'id' in q.askAt) {
      const b = sim.boxes.get(q.askAt.id);
      if (b && !Number.isNaN(b.x)) at = { x: Math.min(Math.max(b.x, 150), sim.w - 150), y: b.y - b.h / 2 - 14 };
    } else if (land && q.askAt && !('id' in q.askAt)) at = q.askAt;
    prompt = { ...at, node: q.ask };
  } else if (sim.cfg.cut !== 'off' && !sim.busy && !sim.crashed && sim.cfg.scene !== 'pg') {
    prompt = {
      ...promptAt(sim),
      node: (
        <>
          <span className={css.pointer}>Click</span>
          <span className={css.touch}>Tap</span> an arrow to cut that reference
        </>
      ),
    };
  }
  const note = sim.note;
  const na = noteAt(sim);
  return (
    <>
      <Hud items={items} />
      {sim.banner && (
        <div className={land ? css.banner : `${css.banner} ${css.bannerSm}`} data-tone={sim.banner.tone}>
          <i />
          {land || sim.banner.tone !== 'gc' ? sim.banner.text : 'GC · app paused'}
        </div>
      )}
      {noteVisible && note && !q && (
        <div key={note.text} className={land ? css.note : `${css.note} ${css.noteWrap}`} data-tone={note.tone} style={{ left: na.x, top: na.y }}>
          {note.text}
        </div>
      )}
      {sim.cfg.view === 'split' && <PaneMsgs sim={sim} />}
      {prompt && (
        <StagePrompt x={prompt.x} y={prompt.y}>
          {prompt.node}
        </StagePrompt>
      )}
      {readout && <GcReadout sim={sim} kind={readout} land={land} />}
    </>
  );
}

function PaneMsgs({ sim }: { sim: GcSim }) {
  return (
    <>
      {sim.g.panes.map((p, i) => {
        const m = sim.paneMsg[i];
        if (!m) return null;
        return (
          <div key={`${i}-${m.text}`} className={css.paneMsg} data-kind={m.kind} style={{ left: p.x + p.w / 2, top: p.y + p.h - (sim.g.land ? 58 : 44), maxWidth: p.w - 24 }}>
            {m.text}
          </div>
        );
      })}
    </>
  );
}

/* ------------------------------------------------------------------ */

function readoutPos(sim: GcSim, kind: ReadoutKind): { x: number; y: number; anchor: 'below' | 'strip' | 'above'; width?: number } {
  const g = sim.g;
  const W = sim.w;
  if (!g.land) return { x: 0, y: 0, anchor: 'strip' };
  if (sim.cfg.view === 'heap' && g.strip) {
    const s = g.strip;
    const bottom = s.y + s.rows * s.ch + (s.rows - 1) * s.rowGap;
    if (g.copyRows) return { x: W / 2, y: s.y + 2 * s.ch + s.rowGap + 104, anchor: 'below', width: 380 };
    return { x: W / 2, y: bottom + 86, anchor: 'below', width: 330 };
  }
  if (sim.cfg.view === 'gen') {
    const r = g.readoutAt;
    return r ? { x: r.x, y: r.y, anchor: 'below', width: r.w } : { x: W - 160, y: 90, anchor: 'below', width: 290 };
  }
  if (kind === 'cycle' || kind === 'rc') return { x: W - 170, y: 100, anchor: 'below', width: 290 };
  return { x: W - 160, y: 96, anchor: 'below', width: 272 };
}

function GcReadout({ sim, kind, land }: { sim: GcSim; kind: ReadoutKind; land: boolean }) {
  const pos = readoutPos(sim, kind);
  const common = { x: pos.x, y: pos.y, anchor: pos.anchor, width: pos.width };
  const log = (n: number) =>
    sim.log.slice(-n).map((l, i) => (
      <div key={`${i}-${l.text}`} className={css.logLine} data-kind={l.kind}>
        {l.text}
      </div>
    ));
  switch (kind) {
    case 'alloc':
      return (
        <Readout {...common} head="allocator (malloc / free)">
          {log(land ? 6 : 3)}
          <RResult>
            free list: <b>{sim.freeList.length ? sim.freeList.map((a) => addrHex(a)).join(', ') : 'empty'}</b>
          </RResult>
        </Readout>
      );
    case 'worklist': {
      const marked = sim.liveObjs().filter((o) => o.mark === 'black').length;
      const scanning = sim.scanning ? sim.objs.get(sim.scanning)?.label : null;
      return (
        <Readout {...common} head="mark · worklist" fresh={sim.phase === 'mark'}>
          <RLine dim>found, not yet scanned:</RLine>
          <div style={{ margin: '5px 0 8px' }}>
            {sim.worklist.length ? <RChips items={sim.worklist.map((id) => ({ label: sim.objs.get(id)?.label ?? id }))} /> : <RLine dim>{sim.phase === 'mark' ? '(empty)' : '—'}</RLine>}
          </div>
          <RLine>
            scanning <em>{scanning ?? '—'}</em>
          </RLine>
          <RResult>
            marked <b>{marked}</b> of {sim.liveObjs().length}
          </RResult>
        </Readout>
      );
    }
    case 'holes': {
      const holes = sim.holes();
      const free = holes.reduce((s, h) => s + h.size, 0);
      const largest = holes.reduce((m, h) => Math.max(m, h.size), 0);
      return (
        <Readout {...common} head="free list · holes in address order">
          <RChips items={holes.map((h) => ({ label: `${addrHex(h.addr)} ×${h.size}` }))} />
          <RResult>
            {free} free · biggest hole <b>{largest}</b>
          </RResult>
        </Readout>
      );
    }
    case 'cycle':
      return (
        <Readout {...common} head="cpython cycle detector" fresh={sim.phase === 'cycle'}>
          {sim.log.length ? log(5) : <RLine dim>Press gc.collect() to run it.</RLine>}
        </Readout>
      );
    case 'forward':
      return (
        <Readout {...common} head="forwarding addresses" fresh={sim.phase === 'compact'}>
          {sim.log.length ? log(land ? 7 : 3) : <RLine dim>{sim.phase === 'mark' ? 'marking…' : 'waiting for the collector'}</RLine>}
        </Readout>
      );
    case 'copy':
      return (
        <Readout {...common} head="copying · breadth first" fresh={sim.phase === 'copy'}>
          {sim.log.length ? log(land ? 6 : 2) : <RLine dim>waiting for the collector</RLine>}
          {sim.bump != null && (
            <RResult>
              to-space free pointer <b>{addrHex(sim.bump)}</b>
            </RResult>
          )}
        </Readout>
      );
    case 'hist': {
      const h = sim.gen.hist;
      const max = Math.max(1, ...h);
      const labels = ['< 0.5 s', '0.5–1 s', '1–2 s', '2–5 s', '> 5 s'];
      return (
        <Readout {...common} head="age at death">
          <div className={css.hist}>
            {h.map((n, i) => (
              <Row key={i} label={labels[i]} n={n} max={max} long={i === 4} />
            ))}
          </div>
          <RResult>
            still alive: <b>{sim.gen.objs.filter((o) => !o.freed && !o.dead).length}</b> of {sim.gen.allocated} allocated
          </RResult>
        </Readout>
      );
    }
    case 'rs': {
      const rs = sim.gen.remembered;
      return (
        <Readout {...common} head="remembered set (card table)" fresh={rs.length > 0}>
          {rs.length ? (
            <RChips items={rs.map((r) => ({ label: `${sim.gen.get(r.from)?.label ?? 'old'} → ${sim.gen.get(r.to)?.label ?? 'young'}` }))} />
          ) : (
            <RLine dim>no old → young references recorded</RLine>
          )}
          <RResult>
            barrier <b>{sim.gen.barrier ? 'on' : 'off'}</b> · eden {sim.gen.used('eden')}/{ZONE_CELLS.eden}
          </RResult>
        </Readout>
      );
    }
    case 'rc':
    case 'pg':
      return null;
  }
}

function Row({ label, n, max, long }: { label: string; n: number; max: number; long?: boolean }) {
  return (
    <>
      <span>{label}</span>
      <span>
        <i className={css.histBar} data-long={long} style={{ display: 'block', width: `${Math.max(2, (n / max) * 100)}%` }} />
      </span>
      <span style={{ color: 'var(--text-1)', textAlign: 'right' }}>{n}</span>
    </>
  );
}
