import type { ReactNode } from 'react';
import { Hud, type HudItem } from '@/components/stage/chrome';
import { InspectorCard, RLine, RResult, Readout, StagePrompt } from '@/components/stage/overlays';
import { SIG } from '@/lib/sim/colors';
import { POLICY_NAMES, longRunHitRatio, type Policy } from './cache';
import { HOT, keyName } from './products';
import { REDIS_MS, type CacheSim } from './sim';
import css from './caching.module.css';

export type HudKey = 'hit' | 'p95' | 'avg' | 'db' | 'stale' | 'inflight' | 'writeMs' | 'lost' | 'hotq';
export type ReadoutKey = 'tally' | 'ladder' | 'formula' | 'curve' | 'policies' | 'table' | 'writes' | 'stampede';

const pct = (v: number | null) => (v == null ? '—' : `${Math.round(v * 100)}`);

/* ------------------------------------------------------------------ */
/* HUD                                                                 */
/* ------------------------------------------------------------------ */

export function CacheHud({ sim, keys }: { sim: CacheSim; keys: HudKey[] }) {
  // Phones: shorter labels and no sparkline, so the chips stay on one row.
  const small = sim.orient === 'portrait';
  const items: HudItem[] = keys.map((k) => {
    switch (k) {
      case 'hit': {
        const h = sim.hitRatio;
        return { label: 'Hit ratio', value: pct(h), unit: h == null ? undefined : '%', tone: h == null ? undefined : h >= 0.8 ? 'good' : h < 0.45 ? 'warn' : undefined };
      }
      case 'p95': {
        const p = sim.p95;
        return {
          label: small ? 'p95' : 'p95 latency',
          value: p == null ? '—' : Math.round(p),
          unit: 'ms',
          tone: p == null ? undefined : p <= 10 ? 'good' : p > 120 ? 'bad' : p > 60 ? 'warn' : undefined,
          spark: !small && sim.p95Spark.length > 2 ? sim.p95Spark : undefined,
        };
      }
      case 'avg': {
        const a = sim.avgLatency;
        return { label: 'Avg latency', value: a == null ? '—' : a < 10 ? a.toFixed(1) : Math.round(a), unit: 'ms', tone: a == null ? undefined : a < 10 ? 'good' : undefined };
      }
      case 'db': {
        const l = sim.dbLoad;
        return { label: 'DB load', value: Math.round(l * 100), unit: '%', tone: l >= 0.9 ? 'bad' : l >= 0.65 ? 'warn' : l <= 0.3 ? 'good' : undefined };
      }
      case 'stale': {
        const s = sim.staleRate;
        return { label: 'Stale reads', value: pct(s), unit: s == null ? undefined : '%', tone: s == null ? undefined : s > 0 ? 'bad' : 'good' };
      }
      case 'inflight': {
        const n = sim.dbInFlight;
        return { label: small ? 'DB queries' : 'DB queries now', value: n, tone: n > sim.cfg.dbWorkers ? 'bad' : undefined };
      }
      case 'writeMs': {
        const w = sim.lastWriteMs;
        return { label: 'Last write', value: w == null ? '—' : Math.max(1, Math.round(w)), unit: 'ms', tone: w != null && w < 3 ? 'good' : undefined };
      }
      case 'lost':
        return { label: 'Lost writes', value: sim.lostWrites, tone: sim.lostWrites > 0 ? 'bad' : undefined };
      case 'hotq':
        return { label: small ? `#${HOT} queries` : `Queries for #${HOT}`, value: sim.hotQueriesLastExpiry, tone: sim.hotQueriesLastExpiry > 2 ? 'bad' : undefined };
    }
  });
  return <Hud items={items} />;
}

/* ------------------------------------------------------------------ */
/* Where a readout sits                                                */
/* ------------------------------------------------------------------ */

type Spot = { x: number; y: number; anchor: 'below' | 'above' | 'strip'; left?: boolean };

/**
 * Phones: docked strip at the bottom. Desktop: bottom-left under the
 * shoppers, or (step 1, before there is a cache) where Redis will appear.
 */
function spot(sim: CacheSim, where: 'dock' | 'cacheArea'): Spot {
  if (sim.orient === 'portrait') return { x: 0, y: 0, anchor: 'strip' };
  if (where === 'cacheArea') {
    const pad = sim.compact ? 16 : 24;
    const cacheW = sim.compact ? 270 : 312;
    return { x: sim.w - pad - cacheW / 2 - 12, y: 96, anchor: 'below' };
  }
  const d = sim.dock();
  return { x: d.x, y: d.y, anchor: 'above', left: true };
}

/* ------------------------------------------------------------------ */
/* Readouts: the internal state you can't normally see                 */
/* ------------------------------------------------------------------ */

export function CacheReadout({ sim, which }: { sim: CacheSim; which: ReadoutKey }) {
  switch (which) {
    case 'tally':
      return <TallyReadout sim={sim} />;
    case 'ladder':
      return <LadderReadout sim={sim} />;
    case 'formula':
      return <FormulaReadout sim={sim} />;
    case 'curve':
      return <CurveReadout sim={sim} />;
    case 'policies':
      return <PolicyReadout sim={sim} />;
    case 'table':
      return <TableReadout sim={sim} keys={[HOT]} />;
    case 'writes':
      return <TableReadout sim={sim} keys={[HOT, 7, 13]} writes />;
    case 'stampede':
      return <StampedeReadout sim={sim} />;
  }
}

function At({ s, head, width = 272, children }: { s: Spot; head: string; width?: number; children: ReactNode }) {
  const x = s.left ? s.x + width / 2 : s.x;
  return (
    <Readout x={x} y={s.y} anchor={s.anchor} head={head} width={s.anchor === 'strip' ? undefined : width}>
      {children}
    </Readout>
  );
}

function TallyReadout({ sim }: { sim: CacheSim }) {
  const s = spot(sim, 'cacheArea');
  const total = [...sim.tally.values()].reduce((a, b) => a + b, 0);
  const top = [...sim.tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, sim.orient === 'portrait' ? 4 : 6);
  const max = Math.max(1, ...top.map((t) => t[1]));
  const top3 = [...sim.tally.values()].sort((a, b) => b - a).slice(0, 3).reduce((a, b) => a + b, 0);
  return (
    <At s={s} head="what postgres keeps computing" width={262}>
      <div className={css.bars}>
        {top.map(([k, n]) => (
          <Bar key={k} label={keyName(k)} frac={n / max} value={`×${n}`} on={k === HOT} />
        ))}
        {!top.length && <span className={css.dimTxt}>waiting for reads…</span>}
      </div>
      {total >= 6 && (
        <RResult>
          top 3 products: <b>{Math.round((top3 / total) * 100)}%</b> of {total} reads
        </RResult>
      )}
    </At>
  );
}

function Bar({ label, frac, value, on }: { label: string; frac: number; value: string; on?: boolean }) {
  return (
    <>
      <span style={{ color: on ? 'var(--text-1)' : undefined }}>{label}</span>
      <span className={`${css.barTrack} ${on ? css.barOn : ''}`}>
        <i style={{ width: `${Math.max(3, frac * 100)}%` }} />
      </span>
      <span style={{ color: 'var(--text-1)', textAlign: 'right' }}>{value}</span>
    </>
  );
}

function LadderReadout({ sim }: { sim: CacheSim }) {
  const s = spot(sim, 'dock');
  return (
    <At s={s} head="typical latencies" width={304}>
      <div className={css.ladder}>
        <span>read from RAM</span>
        <span>0.0001 ms</span>
        <span className={css.ladderHot}>Redis GET, same datacenter</span>
        <span className={css.ladderHot}>~0.5–1 ms</span>
        <span className={css.ladderSlow}>Postgres query with joins</span>
        <span className={css.ladderSlow}>~5–100 ms</span>
        <span>call to another region</span>
        <span>~70–150 ms</span>
      </div>
      <RResult>
        this query vs Redis: <b>~50× slower</b>
      </RResult>
    </At>
  );
}

function FormulaReadout({ sim }: { sim: CacheSim }) {
  const s = spot(sim, 'dock');
  const h = sim.hitRatio;
  const missMs = REDIS_MS + 50 + REDIS_MS;
  if (h == null)
    return (
      <At s={s} head="average read latency" width={292}>
        <RLine dim>waiting for reads…</RLine>
      </At>
    );
  const avg = h * REDIS_MS + (1 - h) * missMs;
  return (
    <At s={s} head="average read latency" width={292}>
      <RLine>
        hits&nbsp;&nbsp;&nbsp;<em>{pct(h)}%</em> × {REDIS_MS} ms = {(h * REDIS_MS).toFixed(1)} ms
      </RLine>
      <RLine>
        misses <em>{pct(1 - h)}%</em> × {missMs} ms = {((1 - h) * missMs).toFixed(1)} ms
      </RLine>
      <RResult>
        ≈ <b>{avg.toFixed(1)} ms</b> per read · DB sees <b>{pct(1 - h)}%</b>
      </RResult>
    </At>
  );
}

/** Long-run LRU hit ratio for each cache size, on this lesson's traffic. */
const curveCache = new Map<string, number[]>();
function lruCurve(keys: number, skew: number, max: number): number[] {
  const id = `${keys}-${skew}-${max}`;
  let c = curveCache.get(id);
  if (!c) {
    c = Array.from({ length: max }, (_, i) => longRunHitRatio('lru', i + 1, keys, skew));
    curveCache.set(id, c);
  }
  return c;
}

export const CURVE_MAX = 12;

/** Smallest cache that reaches the goal on the long-run curve. */
export function sizeForGoal(keys: number, skew: number, goal: number): number {
  const c = lruCurve(keys, skew, CURVE_MAX);
  const i = c.findIndex((v) => v >= goal);
  return i < 0 ? CURVE_MAX : i + 1;
}

function CurveReadout({ sim }: { sim: CacheSim }) {
  const s = spot(sim, 'dock');
  const portrait = sim.orient === 'portrait';
  const curve = lruCurve(sim.cfg.keys, sim.cfg.skew, CURVE_MAX);
  const size = sim.cache.capacity;
  const W = portrait ? 330 : 250;
  const H = portrait ? 70 : 96;
  const px = (n: number) => 16 + ((n - 1) / (CURVE_MAX - 1)) * (W - 24);
  const py = (v: number) => 6 + (1 - v) * (H - 20);
  const pts = curve.map((v, i) => `${px(i + 1).toFixed(1)},${py(v).toFixed(1)}`).join(' ');
  const live = sim.hitRatio;
  return (
    <At s={s} head="hit ratio vs cache size (LRU)" width={276}>
      <svg className={css.chart} width={W} height={H} aria-hidden>
        {[0.25, 0.5, 0.75, 1].map((v) => (
          <g key={v}>
            <line x1={16} x2={W - 8} y1={py(v)} y2={py(v)} stroke="rgba(143,166,201,0.12)" />
            <text x={0} y={py(v) + 3} style={{ fontFamily: 'var(--font-mono)', fontSize: 8, fill: 'var(--text-3)' }}>
              {v * 100}
            </text>
          </g>
        ))}
        <polyline points={pts} fill="none" stroke="rgba(181,155,255,0.85)" strokeWidth={1.6} strokeLinejoin="round" />
        {curve.map((v, i) => (
          <circle key={i} cx={px(i + 1)} cy={py(v)} r={i + 1 === size ? 0 : 1.8} fill="rgba(181,155,255,0.85)" />
        ))}
        <line x1={px(size)} x2={px(size)} y1={py(1)} y2={H - 14} stroke="rgba(255,210,63,0.4)" strokeDasharray="2 3" />
        <circle cx={px(size)} cy={py(curve[size - 1] ?? 0)} r={4.5} fill={SIG.warn} />
        {live != null && <circle cx={px(size)} cy={py(live)} r={3.5} fill="none" stroke={SIG.res} strokeWidth={1.6} />}
        <text x={px(1)} y={H - 2} style={{ fontFamily: 'var(--font-mono)', fontSize: 8, fill: 'var(--text-3)' }}>
          1 key
        </text>
        <text x={W - 8} y={H - 2} textAnchor="end" style={{ fontFamily: 'var(--font-mono)', fontSize: 8, fill: 'var(--text-3)' }}>
          {CURVE_MAX} keys
        </text>
      </svg>
      <div className={css.chartNote}>
        {size} key{size > 1 ? 's' : ''}: long run <b>{pct(curve[size - 1] ?? 0)}%</b> hits · live <span className={css.ok}>{live == null ? '…' : `${pct(live)}%`}</span>
      </div>
    </At>
  );
}

const POLICIES: Policy[] = ['lru', 'lfu', 'fifo'];

function PolicyReadout({ sim }: { sim: CacheSim }) {
  const s = spot(sim, 'dock');
  const cur = sim.cfg.policy;
  const long = POLICIES.map((p) => [p, longRunHitRatioCached(p, sim.cache.capacity, sim.cfg.keys, sim.cfg.skew)] as const);
  return (
    <At s={s} head={`long run · 12,000 reads · ${sim.cache.capacity} slots`} width={272}>
      <div className={css.bars}>
        {long.map(([p, v]) => (
          <Bar key={p} label={POLICY_NAMES[p]} frac={v} value={`${pct(v)}%`} on={p === cur} />
        ))}
      </div>
      <RResult>
        {POLICY_NAMES[cur]} evicted <b>{keyName(HOT)}</b> {sim.hotEvictions}× so far
      </RResult>
    </At>
  );
}

const lrCache = new Map<string, number>();
function longRunHitRatioCached(p: Policy, size: number, keys: number, skew: number) {
  const id = `${p}-${size}-${keys}-${skew}`;
  let v = lrCache.get(id);
  if (v == null) {
    v = longRunHitRatio(p, size, keys, skew);
    lrCache.set(id, v);
  }
  return v;
}

function TableReadout({ sim, keys, writes }: { sim: CacheSim; keys: number[]; writes?: boolean }) {
  const s = spot(sim, 'dock');
  return (
    <At s={s} head={writes ? 'postgres vs redis, right now' : 'the price, in both places'} width={writes ? 272 : 256}>
      <div className={css.cmp}>
        <span className={css.cmpHead}>key</span>
        <span className={css.cmpHead}>postgres</span>
        <span className={css.cmpHead}>redis</span>
        {keys.map((k) => {
          const e = sim.cache.peek(k);
          const db = sim.dbPrice.get(k);
          const stale = e ? sim.isStale(e) : false;
          // Postgres already has a newer version, but the write hasn't finished: not stale yet.
          const updating = !!e && !stale && !e.dirty && e.version < (sim.dbVer.get(k) ?? 0);
          return <Cmp key={k} k={k} db={db} e={e?.price} stale={stale} behind={!!e?.dirty} updating={updating} />;
        })}
      </div>
      {writes ? (
        <RResult>
          unsaved in Redis: <b>{[...sim.cache.entries.values()].filter((e) => e.dirty).length}</b> · lost: <b>{sim.lostWrites}</b>
        </RResult>
      ) : (
        <RResult>
          stale reads served: <b>{sim.staleReads}</b>
        </RResult>
      )}
    </At>
  );
}

function Cmp({ k, db, e, stale, behind, updating }: { k: number; db?: number; e?: number; stale: boolean; behind: boolean; updating: boolean }) {
  const cls = e == null ? css.dimTxt : stale ? css.bad : behind || updating ? css.warnTxt : css.ok;
  const note = stale ? ' stale' : behind ? ' newer' : updating ? ' updating…' : '';
  return (
    <>
      <span>{keyName(k)}</span>
      <span className={behind ? css.warnTxt : undefined}>
        ${db}
        {behind ? ' (old)' : ''}
      </span>
      <span className={cls}>{e == null ? 'not cached' : `$${e}${note}`}</span>
    </>
  );
}

function StampedeReadout({ sim }: { sim: CacheSim }) {
  const s = spot(sim, 'dock');
  const cached = sim.cache.peek(HOT);
  return (
    <At s={s} head={`${keyName(HOT)} · the hot key`} width={258}>
      <RLine>
        in redis:{' '}
        {cached ? (
          <em>cached, {Math.max(0, Math.ceil(cached.expiresAt - sim.t))}s left</em>
        ) : (
          <span className={css.bad}>missing</span>
        )}
      </RLine>
      <RLine>
        waiting in the app: <em>{sim.waitingFor(HOT)}</em>
        {sim.cfg.refreshAhead ? (
          <>
            {' '}
            · refreshes: <em>{sim.hotRefreshes}</em>
          </>
        ) : null}
      </RLine>
      <RResult>
        miss queries since expiry: <b>{sim.hotQueriesLastExpiry}</b>
      </RResult>
    </At>
  );
}

/* ------------------------------------------------------------------ */
/* Guided tour card, prediction prompt, race counters                  */
/* ------------------------------------------------------------------ */

export function TourCard({ sim }: { sim: CacheSim }) {
  const n = sim.note;
  if (!n) return null;
  let x: number;
  let y: number;
  if ('flight' in n.at) {
    const id = n.at.flight;
    const f = sim.flightViews().find((v) => v.id === id);
    if (!f) return null;
    x = f.x;
    y = f.y;
  } else {
    const b = sim.boxes.get(n.at.box);
    if (!b || Number.isNaN(b.x)) return null;
    x = b.x;
    y = b.y - b.h / 2 + (n.at.dy ?? 0);
  }
  return <InspectorCard x={x} y={y} stageW={sim.w} head={n.head} lines={n.lines} tone={n.tone} progress={n.progress?.()} />;
}

export function AskPrompt({ sim, strip }: { sim: CacheSim; strip?: boolean }) {
  const q = sim.game?.pending;
  if (!q?.ask) return null;
  let x = sim.w / 2;
  let y = 90;
  const at = q.askAt;
  const cache = sim.boxes.get('cache');
  if (sim.orient === 'portrait' && cache && !Number.isNaN(cache.x)) {
    // Phones: the free band under the cache, or just above it when a readout strip fills the bottom.
    x = sim.w / 2;
    y = strip ? cache.y - cache.h / 2 - 6 : cache.y + cache.h / 2 + 34;
  } else if (at && 'id' in at) {
    const b = sim.boxes.get(at.id);
    if (b && !Number.isNaN(b.x)) {
      x = b.x;
      y = b.y - b.h / 2 - 12;
    }
  } else if (at) {
    x = at.x;
    y = at.y;
  }
  x = Math.min(Math.max(x, 130), sim.w - 130);
  return (
    <StagePrompt x={x} y={y}>
      {q.ask}
    </StagePrompt>
  );
}

export function RaceCounters({ sim }: { sim: CacheSim }) {
  const r = sim.race;
  const cache = sim.boxes.get('cache');
  const db = sim.boxes.get('db');
  if (!r || !cache || !db) return null;
  const el = sim.raceElapsedMs();
  const cacheMs = r.cacheMs;
  const dbMs = r.dbMs;
  const dbLive = dbMs ?? Math.min(el, 49);
  return (
    <>
      <div className={css.counter} style={{ left: cache.x, top: cache.y - cache.h / 2 - 10, color: SIG.res }}>
        <small>redis</small>
        {cacheMs == null ? '…' : `${Math.max(1, Math.round(cacheMs))} ms ✓`}
      </div>
      <div className={css.counter} style={{ left: db.x, top: db.y - db.h / 2 - 12, color: SIG.heavy }}>
        <small>postgres</small>
        {dbMs == null ? `${Math.round(dbLive)} ms…` : `${Math.round(dbMs)} ms ✓`}
      </div>
    </>
  );
}
