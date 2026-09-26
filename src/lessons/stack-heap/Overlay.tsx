'use client';

import { highlightLine } from '@/components/lesson/CodeBlock';
import { Hud, Legend, type HudItem, type LegendItem } from '@/components/stage/chrome';
import { RChips, RLine, RResult, Readout, StagePrompt } from '@/components/stage/overlays';
import { SIG } from '@/lib/sim/colors';
import { clamp } from '@/lib/sim/geometry';
import { DIVE_FRAME, MAX_DEPTH, STACK_LIMIT, STACK_PRE_USED, bytes, group, hex, tail } from './addr';
import type { MemSim, Rect } from './sim';
import css from './sh.module.css';

export type HudKey = 'frames' | 'sp' | 'stack' | 'heap' | 'leaked' | 'depth' | 'used' | 'objects';
export type LegendKey = 'arg' | 'ret' | 'sp' | 'ptr' | 'ref' | 'dangling' | 'malloc' | 'new' | 'free' | 'leaked' | 'hole' | 'gc' | 'value' | 'inner' | 'drop';

const LEGEND: Record<LegendKey, LegendItem> = {
  arg: { label: 'argument', color: SIG.req },
  ret: { label: 'return value', color: SIG.res },
  sp: { label: 'stack pointer', color: SIG.warn, shape: 'line' },
  ptr: { label: 'pointer', color: SIG.req, shape: 'line' },
  ref: { label: 'reference', color: SIG.req, shape: 'line' },
  dangling: { label: 'dangling pointer', color: SIG.err, shape: 'line' },
  malloc: { label: 'malloc request', color: SIG.heavy },
  new: { label: 'new object', color: SIG.heavy },
  free: { label: 'free()', color: SIG.hc },
  drop: { label: 'drop (free)', color: SIG.hc },
  leaked: { label: 'leaked block', color: SIG.err, shape: 'square' },
  hole: { label: 'free hole', color: SIG.dim, shape: 'square' },
  gc: { label: 'garbage collector', color: SIG.hc, shape: 'ring' },
  value: { label: 'value', color: SIG.res },
  inner: { label: 'pointer inside the heap', color: SIG.hc, shape: 'line' },
};

export interface OverlayOpts {
  hud?: HudKey[];
  legend?: LegendKey[];
  /** Shown on the stage while the program waits at a breakpoint */
  breakPrompt?: string;
}

export function Overlay({ sim, opts }: { sim: MemSim; opts: OverlayOpts }) {
  const g = sim.geo;
  const q = sim.game?.pending;
  const askR = q ? (sim.askAt ? sim.target(sim.askAt) : g.code) : null;
  const codeR = g.code;
  // Put the question where it covers nothing: on phones in the lane under the caption,
  // elsewhere under a dead frame, under the terminal, or above the target.
  const lanePos = g.portrait && g.lane ? { x: g.lane.x + g.lane.w / 2, y: g.lane.y + g.lane.h - 1 } : null;
  const askPos = !askR
    ? null
    : (lanePos ??
      (sim.askAt === 'ghost' || sim.askAt === 'console' ? { x: askR.x + askR.w / 2, y: askR.y + askR.h + 36 } : { x: askR.x + askR.w / 2, y: Math.max(24, askR.y - 12) }));
  const breakPos = lanePos ?? (g.cap ? { x: g.cap.x + g.cap.w / 2, y: g.cap.y + g.cap.h + 40 } : null);
  return (
    <>
      {opts.hud && <Hud items={hudItems(sim, opts.hud)} />}
      {codeR && <Trace sim={sim} r={codeR} />}
      {g.cap && sim.caption && <Caption sim={sim} r={g.cap} />}
      {g.con && <Terminal sim={sim} r={g.con} />}
      {sim.cfg.info === 'alloc' && <AllocInfo sim={sim} r={g.info} />}
      {sim.cfg.info === 'overflow' && <OverflowInfo sim={sim} r={g.info} />}
      {q && askPos && (
        <StagePrompt x={fitX(sim, askPos.x, q.ask ?? '')} y={askPos.y}>
          {q.ask}
        </StagePrompt>
      )}
      {!q && sim.paused && opts.breakPrompt && breakPos && (
        <StagePrompt x={fitX(sim, breakPos.x, opts.breakPrompt)} y={breakPos.y}>
          {opts.breakPrompt}
        </StagePrompt>
      )}
      {!g.portrait && opts.legend && opts.legend.length > 0 && <Legend items={opts.legend.map((k) => LEGEND[k])} />}
    </>
  );
}

/** Keep a centered pill inside the stage (the pill is ~6.7px per character of 11px mono). */
function fitX(sim: MemSim, x: number, text: string) {
  const half = (text.length * 6.7 + 22) / 2;
  return clamp(x, half + 10, sim.w - half - 10);
}

function hudItems(sim: MemSim, keys: HudKey[]): HudItem[] {
  const small = sim.geo.portrait;
  return keys.map((k): HudItem => {
    switch (k) {
      case 'frames':
        return { label: 'Frames', value: sim.liveFrames().length };
      case 'sp':
        return { label: 'SP', value: small ? tail(sim.sp) : hex(sim.sp) };
      case 'stack':
        return { label: 'Stack used', value: sim.stackUsed, unit: 'B' };
      case 'heap':
        return { label: sim.lang === 'js' ? 'Heap objects' : 'Heap in use', value: sim.lang === 'js' ? sim.blocks.filter((b) => b.shown && b.state !== 'free').length : sim.heapInUse, unit: sim.lang === 'js' ? undefined : 'B' };
      case 'objects':
        return { label: 'Objects', value: sim.blocks.filter((b) => b.shown && b.state !== 'free').length };
      case 'leaked':
        return { label: 'Leaked', value: sim.leakedBytes, unit: 'B', tone: sim.leakedBytes > 0 ? 'bad' : undefined };
      case 'depth':
        return { label: 'Depth', value: group(Math.floor(sim.ov.depth)), tone: sim.ov.phase === 'crash' ? 'bad' : undefined };
      case 'used': {
        const pct = (sim.ovUsed / STACK_LIMIT) * 100;
        return { label: 'Stack used', value: bytes(sim.ovUsed).split(' ')[0], unit: `${bytes(sim.ovUsed).split(' ')[1]} · ${pct < 1 ? pct.toFixed(2) : Math.round(pct)}%`, tone: pct > 90 ? 'bad' : pct > 50 ? 'warn' : undefined };
      }
    }
  });
}

/* ------------------------------------------------------------------ */
/* Code window with the executing line, auto-scrolled                   */
/* ------------------------------------------------------------------ */

function Trace({ sim, r }: { sim: MemSim; r: Rect }) {
  const g = sim.geo;
  const code = sim.codeText;
  const lines = code.split('\n');
  const vis = g.codeLines;
  const active = sim.line;
  const first = lines.length > vis && active ? clamp(active - 1 - Math.floor((vis - 1) / 2), 0, lines.length - vis) : lines.length > vis ? lines.length - vis : 0;
  const lang = sim.lang === 'rust' ? 'js' : sim.lang;
  const live = sim.cfg.sandbox || sim.cfg.playground;
  const state = sim.crashed || sim.lineBad ? 'crashed' : live ? 'running' : sim.game?.pending ? 'paused' : sim.paused || (!sim.auto && !sim.ended && sim.view !== 'overflow') ? 'paused' : sim.ended ? 'done' : 'running';
  const label = live && state === 'running' ? 'live' : { crashed: 'crashed', paused: sim.game?.pending ? 'your call' : 'paused', done: 'finished', running: 'running' }[state];
  const file = sim.cfg.playground ? 'sandbox.c' : sim.cfg.sandbox ? 'heap.c' : sim.view === 'overflow' ? 'dive.c' : (sim.prog?.file ?? '');
  return (
    <div className={css.trace} style={{ left: r.x, top: r.y, width: r.w }}>
      <div className={css.traceHead}>
        <span className={css.dots} aria-hidden>
          <i />
          <i />
          <i />
        </span>
        {file}
        <span className={css.traceState} data-s={state}>
          {label}
        </span>
      </div>
      <div className={css.viewport} style={{ height: vis * g.lineH }}>
        <div className={css.lines} style={{ transform: `translateY(${-first * g.lineH}px)`, fontSize: g.codeFont, lineHeight: `${g.lineH}px` }}>
          {lines.map((line, i) => {
            const n = i + 1;
            const st = n === active ? (sim.lineBad ? 'bad' : 'active') : undefined;
            const comment = line.trim().startsWith('//');
            return (
              <div key={i} className={css.line} data-state={st}>
                <span className={css.num}>{n === active ? '▶' : n}</span>
                <span className={css.code} style={comment ? { opacity: 0.8 } : undefined}>
                  {highlightLine(line, lang)}
                  {line === '' ? ' ' : null}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Caption({ sim, r }: { sim: MemSim; r: Rect }) {
  return (
    <div key={`${sim.capVt}`} className={css.caption} data-bad={sim.capBad} style={{ left: r.x + 2, top: r.y, width: r.w - 4, fontSize: sim.geo.portrait ? 10.5 : 11.5 }}>
      <b>▸</b>
      <span className={css.captionText}>{sim.caption}</span>
    </div>
  );
}

function Terminal({ sim, r }: { sim: MemSim; r: Rect }) {
  const portrait = sim.geo.portrait;
  const fs = portrait ? 10 : 10.5;
  const lh = portrait ? 14 : 15;
  const avail = portrait ? r.h - 10 : r.h - 25 - 10;
  // Keep the newest lines; a long line wraps onto a second row.
  const perRow = Math.max(12, Math.floor((r.w - 20) / (fs * 0.6)));
  const rows = (t: string) => Math.min(3, Math.max(1, Math.ceil(t.length / perRow)));
  let used = 0;
  let first = sim.out.length;
  for (let i = sim.out.length - 1; i >= 0; i--) {
    const need = rows(sim.out[i].text) * lh;
    if (used + need > avail) break;
    used += need;
    first = i;
  }
  const lines = sim.out.slice(first);
  const showCmd = first === 0 && used + lh <= avail;
  return (
    <div className={css.term} style={{ left: r.x, top: r.y, width: r.w, height: r.h }}>
      {!portrait && (
        <div className={css.termHead}>
          <span className={css.dots} aria-hidden>
            <i />
            <i />
            <i />
          </span>
          terminal
        </div>
      )}
      <div className={css.termBody} style={{ height: portrait ? r.h : r.h - 25, lineHeight: `${lh}px`, fontSize: fs, padding: portrait ? '5px 10px' : undefined }}>
        {showCmd && <div className={`${css.termLine} ${css.prompt}`}>{sim.cmd || './a.out'}</div>}
        {lines.map((l, i) => (
          <div key={`${l.vt}-${i}`} className={css.termLine} data-tone={l.tone} data-fresh={sim.vt - l.vt < 0.5}>
            {l.text}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Readouts                                                            */
/* ------------------------------------------------------------------ */

function AllocInfo({ sim, r }: { sim: MemSim; r: Rect | null }) {
  const st = sim.sbStats;
  const portrait = sim.geo.portrait;
  const chips = st.holes.length ? st.holes.map((h) => ({ label: `${tail(h.addr, 3)} · ${h.size} B` })) : [{ label: 'empty' }];
  if (portrait || !r)
    return (
      <Readout anchor="strip" head="malloc’s free list">
        <RChips items={chips} />
        <RResult>
          in use <b>{st.inUse} B</b> · free {st.free} B · heap {st.heap} B
        </RResult>
      </Readout>
    );
  return (
    <Readout x={r.x} y={r.y + r.h / 2} anchor="right" width={r.w} head="free list · first fit">
      <RChips items={chips} />
      <RLine>
        used <em>{st.inUse} B</em> · free {st.free} B
      </RLine>
      <RResult>
        heap size <b>{st.heap} B</b>
      </RResult>
    </Readout>
  );
}

function OverflowInfo({ sim, r }: { sim: MemSim; r: Rect | null }) {
  if (!r) return null;
  const d = Math.min(MAX_DEPTH, Math.floor(sim.ov.depth));
  const portrait = sim.geo.portrait;
  if (portrait)
    return (
      <Readout x={r.x} y={r.y + r.h / 2} anchor="right" width={r.w} head="stack budget">
        <RLine>
          {group(d)} × {DIVE_FRAME} B = <em>{bytes(d * DIVE_FRAME)}</em>
        </RLine>
        <RResult>
          max depth ≈ <b>{group(MAX_DEPTH)}</b>
        </RResult>
      </Readout>
    );
  return (
    <Readout x={r.x} y={r.y + r.h / 2} anchor="right" width={r.w} head="stack budget">
      <RLine>
        {group(d)} frame{d === 1 ? '' : 's'} × {DIVE_FRAME} B = <em>{bytes(d * DIVE_FRAME)}</em>
      </RLine>
      <RLine dim>+ {bytes(STACK_PRE_USED)} for main, argv and environment</RLine>
      <RLine dim>limit: ulimit -s = 8192 KB = {bytes(STACK_LIMIT)}</RLine>
      <RResult>
        max depth here ≈ <b>{group(MAX_DEPTH)}</b> calls
      </RResult>
    </Readout>
  );
}
