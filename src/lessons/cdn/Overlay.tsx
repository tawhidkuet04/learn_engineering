'use client';

import { Fragment, type ReactNode } from 'react';
import type { HudItem } from '@/components/stage/chrome';
import { InspectorCard, Readout, RResult, type InspectorLine } from '@/components/stage/overlays';
import { SIG } from '@/lib/sim/colors';
import { CITIES, CITY_IDS, ORIGIN_PLACE, POPS, POP_IDS, fmtKm, km, minRttMs, rttMs } from './geo';
import { latencyColor } from './Scene';
import { APP_BUILDS, FILES, appPath, headerOf, pathOf, type CdnSim, type Entry, type FileId, type Outcome } from './sim';
import css from './cdn.module.css';

export type HudKey = 'avg' | 'hit' | 'origin' | 'fetches' | 'leaks' | 'errors';

export type ReadoutKind =
  | 'board'
  | 'distances'
  | 'ratio'
  | 'light'
  | 'caches'
  | 'table'
  | 'entry'
  | 'log'
  | 'keys'
  | 'versions'
  | 'builds'
  | 'shield'
  | 'anycast'
  | 'tour'
  | 'origin';

/* ------------------------------------------------------------------ */
/* HUD                                                                 */
/* ------------------------------------------------------------------ */

export function hudItems(sim: CdnSim, keys: HudKey[]): HudItem[] {
  return keys.map((k): HudItem => {
    switch (k) {
      case 'avg': {
        const ms = sim.avgMs();
        return { label: 'avg response', value: ms == null ? '—' : Math.round(ms), unit: 'ms', tone: ms == null ? undefined : ms < 50 ? 'good' : ms > 120 ? 'warn' : undefined };
      }
      case 'hit': {
        const r = sim.hitRatio();
        return { label: 'hit ratio', value: r == null ? '—' : Math.round(r * 100), unit: '%', tone: r != null && r >= 0.9 ? 'good' : undefined, spark: sim.hitSeries.length > 3 ? sim.hitSeries : undefined };
      }
      case 'origin': {
        const load = sim.originLoad();
        return { label: 'origin load', value: sim.originRate().toFixed(1), unit: 'req/s', tone: load >= 1 ? 'bad' : load >= 0.7 ? 'warn' : undefined };
      }
      case 'fetches':
        return { label: 'origin requests', value: sim.originFetches };
      case 'leaks':
        return { label: 'wrong page served', value: sim.leaks, tone: sim.leaks ? 'bad' : undefined };
      case 'errors': {
        const n = sim.recentErrors(5);
        return { label: 'errors · last 5 s', value: n, tone: n ? 'bad' : undefined };
      }
      default:
        return { label: k, value: '' };
    }
  });
}

/* ------------------------------------------------------------------ */
/* Small pieces                                                        */
/* ------------------------------------------------------------------ */

const fmtMs = (ms: number | null) => (ms == null ? '—' : `${Math.round(ms)} ms`);

function Pill({ outcome }: { outcome: Outcome | 'EMPTY' }) {
  const cls =
    outcome === 'HIT' || outcome === 'STALE'
      ? css.fresh
      : outcome === 'MISS'
        ? css.stale
        : outcome === 'REVAL'
          ? css.reval
          : outcome === 'ERROR'
            ? css.bad
            : outcome === 'BYPASS'
              ? css.req
              : css.rdim;
  return <span className={`${css.pill} ${cls}`}>{outcome === 'REVAL' ? 'REVALIDATED' : outcome === 'DIRECT' ? 'ORIGIN' : outcome}</span>;
}

function Mini({ state, children }: { state: 'fresh' | 'stale' | 'none' | 'old'; children: ReactNode }) {
  return (
    <span className={css.mini} data-state={state}>
      {children}
    </span>
  );
}

function ageText(sim: CdnSim, e: Entry) {
  const p = sim.policyOf(e.file);
  const age = sim.ageOf(e);
  if (p.kind === 'no-cache') return `stored ${age.toFixed(0)} s ago`;
  if (p.kind !== 'public') return '';
  if (p.immutable || (p.maxAge ?? 0) >= 86400) return `age ${age.toFixed(0)} s`;
  const left = (p.maxAge ?? 0) - age;
  return left > 0 ? `fresh ${left.toFixed(1)} s more` : `stale ${(-left).toFixed(1)} s`;
}

/* ------------------------------------------------------------------ */
/* Readout bodies                                                      */
/* ------------------------------------------------------------------ */

function Board({ sim }: { sim: CdnSim }) {
  const max = 230;
  const bw = sim.orient === 'portrait' ? 62 : 96;
  const bar = (ms: number | null, color: string) => (
    <span className={css.barCell}>
      <i className={css.bar} style={{ width: ms == null ? 0 : Math.max(2, (Math.min(ms, max) / max) * bw), background: color }} />
      <span className={css.num} style={{ color: ms == null ? 'var(--text-3)' : 'var(--text-1)' }}>
        {fmtMs(ms)}
      </span>
    </span>
  );
  return (
    <div className={css.rtable} style={{ gridTemplateColumns: 'auto 1fr 1fr' }}>
      <span className={css.rhead}>city</span>
      <span className={css.rhead} style={{ color: sim.cfg.cdn ? undefined : SIG.warn }}>
        no CDN
      </span>
      <span className={css.rhead} style={{ color: sim.cfg.cdn ? SIG.warn : undefined }}>
        with CDN
      </span>
      {CITY_IDS.map((c) => (
        <Fragment key={c}>
          <span className={css.rcell}>{CITIES[c].name}</span>
          {bar(sim.cityMs[c].direct, SIG.heavy)}
          {bar(sim.cityMs[c].cdn, SIG.res)}
        </Fragment>
      ))}
    </div>
  );
}

function Distances({ sim }: { sim: CdnSim }) {
  const rows = CITY_IDS.map((c) => ({ c, name: CITIES[c].name, km: km(CITIES[c], ORIGIN_PLACE), ms: rttMs(CITIES[c], ORIGIN_PLACE, true) })).sort((a, b) => a.km - b.km);
  const bw = sim.orient === 'portrait' ? 70 : 120;
  const last = sim.log[0]?.who;
  return (
    <div className={css.rtable} style={{ gridTemplateColumns: 'auto auto 1fr' }}>
      <span className={css.rhead}>city</span>
      <span className={css.rhead} style={{ textAlign: 'right' }}>to Virginia</span>
      <span className={css.rhead}>round trip</span>
      {rows.map((r) => (
        <Fragment key={r.c}>
          <span className={css.rcell} style={last === r.name ? { color: SIG.warn } : undefined}>
            {r.name}
          </span>
          <span className={css.num}>{fmtKm(r.km)}</span>
          <span className={css.barCell}>
            <i className={css.bar} style={{ width: (r.ms / 220) * bw, background: latencyColor(r.ms) === SIG.text ? SIG.line : latencyColor(r.ms) }} />
            <span className={css.num}>{r.ms} ms</span>
          </span>
        </Fragment>
      ))}
    </div>
  );
}

function Ratio({ sim }: { sim: CdnSim }) {
  const { hits, total } = sim.recentCounts();
  const misses = total - hits;
  const pct = total ? Math.round((hits / total) * 100) : null;
  return (
    <>
      <div className={css.ttl} style={{ height: 8 }}>
        {total > 0 && <i style={{ width: `${(hits / total) * 100}%`, background: SIG.res }} />}
        {total > 0 && <i style={{ left: `${(hits / total) * 100}%`, width: `${(misses / total) * 100}%`, background: SIG.heavy, borderRadius: 0 }} />}
      </div>
      <div className={css.kv}>
        <span className={css.fresh}>hits: answered by an edge</span>
        <span>{hits}</span>
        <span className={css.stale}>misses: went to Virginia</span>
        <span>{misses}</span>
      </div>
      <RResult>
        hit ratio = {hits} ÷ {total} = <b>{pct == null ? '—' : `${pct}%`}</b> <span className={css.rdim}>(last {total} requests)</span>
      </RResult>
    </>
  );
}

function Light() {
  const d = km(CITIES.sydney, ORIGIN_PLACE);
  const min = minRttMs(CITIES.sydney, ORIGIN_PLACE);
  return (
    <>
      <div className={css.kv}>
        <span>great-circle distance</span>
        <span>{fmtKm(d)}</span>
        <span>light in fiber</span>
        <span>200 km per ms</span>
        <span>one way, best case</span>
        <span>{Math.round(min / 2)} ms</span>
        <span>round trip, best case</span>
        <span>{Math.round(min)} ms</span>
      </div>
      <RResult>
        real round trip ≈ <b>{rttMs(CITIES.sydney, ORIGIN_PLACE, true)} ms</b>
      </RResult>
    </>
  );
}

function Caches({ sim, files }: { sim: CdnSim; files: FileId[] }) {
  return (
    <div className={css.chipsRow}>
      {POP_IDS.map((p) => (
        <span key={p} className={css.popChip}>
          <b>{p}</b>
          {sim.isDown(p) ? (
            <span className={css.bad}>down</span>
          ) : (
            files.map((f) => {
              const c = sim.chip(`pop:${p}`, f);
              return (
                <Mini key={f} state={c.state}>
                  {FILES[f].short}
                </Mini>
              );
            })
          )}
        </span>
      ))}
    </div>
  );
}

const TABLE_FILES: FileId[] = ['app', 'logo', 'html', 'account'];

function Table({ sim, compact }: { sim: CdnSim; compact: boolean }) {
  const node = 'pop:LHR';
  const lastFor = (f: FileId) => sim.log.find((l) => l.file === f && l.pop === 'LHR');
  return (
    <div className={css.rtable} style={{ gridTemplateColumns: compact ? 'auto 1fr auto' : 'auto auto 1fr auto' }}>
      <span className={css.rhead}>path</span>
      {!compact && <span className={css.rhead}>cache-control</span>}
      <span className={css.rhead}>in LHR’s cache</span>
      <span className={css.rhead}>last</span>
      {TABLE_FILES.map((f) => {
        const path = FILES[f].path;
        const e = sim.entry(node, path);
        const last = lastFor(f);
        return (
          <Fragment key={f}>
            <span className={css.rcell}>{path}</span>
            {!compact && <span className={css.rdim}>{headerOf(sim.policyOf(f))}</span>}
            <span className={e ? css.rcell : css.rdim}>{e ? ageText(sim, e) : f === 'account' ? 'never stored' : '—'}</span>
            <span>{last ? <Pill outcome={last.outcome} /> : <span className={css.rdim}>…</span>}</span>
          </Fragment>
        );
      })}
    </div>
  );
}

function EntryTtl({ sim }: { sim: CdnSim }) {
  const e = sim.entry('pop:LHR', FILES.logo.path);
  const p = sim.policyOf('logo');
  const maxAge = p.maxAge ?? 0;
  const age = e ? sim.ageOf(e) : 0;
  const fresh = e ? age < maxAge : false;
  const swrLeft = e && p.swr ? maxAge + p.swr - age : 0;
  const state = !e ? 'not cached' : fresh ? 'fresh' : p.swr && swrLeft > 0 ? 'stale, still servable' : 'stale';
  const color = !e ? 'var(--text-3)' : fresh ? SIG.res : p.swr && swrLeft > 0 ? SIG.heavy : SIG.heavy;
  const revals = sim.log.filter((l) => l.outcome === 'REVAL').length;
  return (
    <>
      <div className={css.formulaLine}>
        <span className={css.rdim}>Cache-Control: </span>
        <span style={{ color: 'var(--text-1)' }}>{headerOf(p)}</span>
      </div>
      <div className={css.ttl}>
        {e && <i style={{ width: `${Math.max(0, Math.min(1, 1 - age / Math.max(0.01, maxAge))) * 100}%`, background: SIG.res }} />}
      </div>
      <div className={css.kv}>
        <span>age</span>
        <span>{e ? `${age.toFixed(1)} s of ${maxAge} s` : '—'}</span>
        <span>state</span>
        <span style={{ color }}>{state}</span>
        <span>hits · revalidations</span>
        <span>
          {sim.hits} · {revals}
        </span>
      </div>
    </>
  );
}

function Log({ sim, rows }: { sim: CdnSim; rows: number }) {
  const lines = sim.log.slice(0, rows);
  if (!lines.length) return <div className={css.rdim}>waiting for requests…</div>;
  return (
    <div style={{ display: 'grid', rowGap: 3 }}>
      {lines.map((l) => (
        <div key={l.id} className={css.logRow}>
          <span className={css.rcell}>
            {l.who} <span className={css.rdim}>{l.path.length > 22 ? `${l.path.slice(0, 21)}…` : l.path}</span>
          </span>
          {l.file === 'account' && l.owner && l.person && l.owner !== l.person ? (
            <span className={`${css.pill} ${css.bad}`}>got {l.owner}’s page</span>
          ) : (
            <Pill outcome={l.outcome} />
          )}
          <span className={css.num} style={{ color: latencyColor(l.ms), minWidth: 48 }}>
            {l.ms} ms
          </span>
        </div>
      ))}
    </div>
  );
}

function Keys({ sim }: { sim: CdnSim }) {
  const entries = sim.entries('pop:LHR').sort((a, b) => b.storedAt - a.storedAt);
  const shown = entries.slice(0, sim.orient === 'portrait' ? 3 : 5);
  const r = sim.hitRatio();
  return (
    <>
      {shown.length ? (
        shown.map((e) => (
          <div key={e.key} className={css.rcell}>
            {e.key}
            {e.hits > 0 && <span className={css.fresh}> · {e.hits} {e.hits === 1 ? 'hit' : 'hits'}</span>}
          </div>
        ))
      ) : (
        <div className={css.rdim}>empty</div>
      )}
      {entries.length > shown.length && <div className={css.rdim}>+ {entries.length - shown.length} more entries</div>}
      <RResult>
        {entries.length} {entries.length === 1 ? 'entry' : 'entries'} for one image · hit ratio <b>{r == null ? '—' : `${Math.round(r * 100)}%`}</b>
      </RResult>
    </>
  );
}

function Versions({ sim }: { sim: CdnSim }) {
  const cur = sim.version.style;
  return (
    <>
      <div className={css.chipsRow}>
        <span className={css.popChip}>
          <b style={{ color: SIG.text }}>origin</b>
          <Mini state="fresh">v{cur}</Mini>
        </span>
        {POP_IDS.map((p) => {
          const c = sim.chip(`pop:${p}`, 'style');
          return (
            <span key={p} className={css.popChip}>
              <b>{p}</b>
              {c.state === 'none' ? <Mini state="none">empty</Mini> : <Mini state={c.version < cur ? 'old' : 'fresh'}>v{c.version}</Mini>}
            </span>
          );
        })}
      </div>
      <RResult>
        {(() => {
          const old = POP_IDS.filter((p) => {
            const c = sim.chip(`pop:${p}`, 'style');
            return c.state !== 'none' && c.version < cur;
          }).length;
          return old ? (
            <>
              <b>{old}</b> of 6 edges still serve an old /style.css
            </>
          ) : (
            <>every edge serves the current version</>
          );
        })()}
      </RResult>
    </>
  );
}

function Builds({ sim }: { sim: CdnSim }) {
  const cur = appPath(sim.version.app).slice(1);
  return (
    <>
      <div className={css.formulaLine}>
        <span className={css.rdim}>origin’s index.html loads </span>
        <span style={{ color: SIG.warn }}>{cur}</span>
      </div>
      <div className={css.chipsRow} style={{ marginTop: 6 }}>
        {POP_IDS.map((p) => {
          const builds = sim
            .entries(`pop:${p}`)
            .filter((e) => e.file === 'app')
            .map((e) => e.version)
            .sort((a, b) => a - b);
          return (
            <span key={p} className={css.popChip}>
              <b>{p}</b>
              {builds.length ? (
                builds.map((v) => (
                  <Mini key={v} state={v === sim.version.app ? 'fresh' : 'none'}>
                    {APP_BUILDS[(v - 1) % APP_BUILDS.length]}
                  </Mini>
                ))
              ) : (
                <Mini state="none">—</Mini>
              )}
            </span>
          );
        })}
      </div>
    </>
  );
}

function ShieldCount({ sim }: { sim: CdnSim }) {
  return (
    <>
      <div className={css.compare}>
        <div className={sim.cfg.shield ? undefined : css.compareOn}>
          <div className={css.rhead}>shield off</div>
          <div className={css.rdim}>each PoP asks the origin</div>
        </div>
        <div className={sim.cfg.shield ? css.compareOn : undefined}>
          <div className={css.rhead}>shield on</div>
          <div className={css.rdim}>only the shield asks</div>
        </div>
      </div>
      <RResult>
        {sim.bursts ? (
          <>
            origin requests for {pathOf('sale', sim.version.sale)}: <b>{sim.saleFetches}</b>
          </>
        ) : (
          <>publish the banner to see how many requests reach Virginia</>
        )}
      </RResult>
    </>
  );
}

function Anycast({ sim }: { sim: CdnSim }) {
  const g = sim.guest;
  return (
    <>
      <div className={css.kv}>
        <span>announced by every PoP</span>
        <span>198.51.100.0/24</span>
        <span>cdn.shop.example, everywhere</span>
        <span style={{ color: '#9eeaff' }}>198.51.100.7</span>
      </div>
      <RResult>
        {g && g.pop ? (
          <>
            {g.place.name} → <b>{g.pop}</b> · {fmtKm(km(g.place, POPS[g.pop]))} · {rttMs(g.place, POPS[g.pop], true)} ms
          </>
        ) : g ? (
          <>{g.place.name} → ?</>
        ) : (
          <>waiting for a visitor…</>
        )}
      </RResult>
    </>
  );
}

function TourCache({ sim }: { sim: CdnSim }) {
  const e = sim.entry('pop:SYD', FILES.app.path);
  return e ? (
    <div className={css.rcell}>
      <span className={css.fresh}>+ </span>
      {FILES.app.path} <span className={css.rdim}>· fresh for a year · {e.hits} {e.hits === 1 ? 'hit' : 'hits'}</span>
    </div>
  ) : (
    <div className={css.rdim}>empty: nobody in Sydney has asked for anything yet</div>
  );
}

function OriginLoad({ sim }: { sim: CdnSim }) {
  const load = sim.originLoad();
  const color = load >= 1 ? SIG.err : load >= 0.7 ? SIG.heavy : SIG.res;
  return (
    <>
      <div className={css.ttl}>
        <i style={{ width: `${Math.min(1, load) * 100}%`, background: color }} />
      </div>
      <div className={css.kv}>
        <span>origin handles</span>
        <span style={{ color }}>
          {sim.originRate().toFixed(1)} of {sim.cfg.originCap} req/s
        </span>
        <span>errors, last 5 s</span>
        <span style={{ color: sim.recentErrors(5) ? SIG.err : undefined }}>{sim.recentErrors(5)}</span>
        <span>errors since the step began</span>
        <span>{sim.errors}</span>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Placement                                                           */
/* ------------------------------------------------------------------ */

const HEADS: Record<ReadoutKind, string> = {
  board: 'response time by city',
  distances: 'distance is latency',
  ratio: 'hit ratio, last 40 requests',
  light: 'sydney → virginia',
  caches: 'what each edge has cached',
  table: 'lhr edge · what the headers did',
  entry: 'lhr edge · /logo.png',
  log: 'latest requests',
  keys: 'lhr edge · cache keys',
  versions: 'who serves which /style.css',
  builds: 'fingerprinted builds at each edge',
  shield: 'origin shield',
  anycast: 'anycast',
  tour: 'syd edge · cache',
  origin: 'origin · virginia',
};

const WIDTH: Partial<Record<ReadoutKind, number>> = {
  board: 400,
  distances: 380,
  ratio: 360,
  light: 300,
  table: 560,
  entry: 330,
  log: 330,
  keys: 380,
  versions: 470,
  builds: 470,
  shield: 330,
  anycast: 330,
  tour: 390,
  origin: 330,
  caches: 470,
};

/** Rough rendered heights (px), used to keep readouts clear of the stage chrome. */
const HEIGHT: Partial<Record<ReadoutKind, number>> = {
  board: 160,
  distances: 160,
  ratio: 104,
  light: 118,
  table: 128,
  entry: 112,
  log: 138,
  keys: 142,
  versions: 84,
  builds: 88,
  shield: 112,
  anycast: 98,
  tour: 52,
  origin: 116,
  caches: 70,
};

/**
 * Below the map, centered, unless that would run into the legend and
 * controls (bottom-left) or the title block (bottom-right, 262 px wide).
 */
export function placeReadout(sim: CdnSim, kind: ReadoutKind) {
  const { w, h, map } = sim;
  const width = Math.min(WIDTH[kind] ?? 360, w - 28);
  const H = HEIGHT[kind] ?? 130;
  let y = map.y + map.h + 16;
  // Stay above the legend (and the controls under it).
  if (y + H > h - 78) y = Math.max(map.y + 40, h - 78 - H);
  let x = w / 2;
  // Slide left of the title block if the two would share rows.
  if (w >= 760 && y + H > h - 100) x = Math.max(14 + width / 2, Math.min(x, w - 288 - width / 2));
  return { x, y, width };
}

/** The readout's rectangle on a landscape stage (for keeping callouts clear of it). */
export function readoutRect(sim: CdnSim, kind: ReadoutKind) {
  const p = placeReadout(sim, kind);
  return { x0: p.x - p.width / 2, x1: p.x + p.width / 2, y0: p.y, y1: p.y + (HEIGHT[kind] ?? 130) };
}

/**
 * Where the kit's Callouts will put a callout's text box (mirrors its
 * placement: 46 px leader, clamped to the stage), assuming a ~200×32 box.
 */
export function calloutRect(sim: CdnSim, target: string, dir: 'up' | 'down' | 'left' | 'right' = 'up') {
  const b = sim.boxes.get(target);
  if (!b) return null;
  const bw = 200;
  const bh = 32;
  let ax = b.x;
  let ay = b.y;
  if (dir === 'up') ay = b.y - b.h / 2 - 4;
  if (dir === 'down') ay = b.y + b.h / 2 + 4;
  if (dir === 'left') ax = b.x - b.w / 2 - 4;
  if (dir === 'right') ax = b.x + b.w / 2 + 4;
  let bx = ax + (dir === 'left' ? -46 : dir === 'right' ? 46 : 0);
  let by = ay + (dir === 'up' ? -46 : dir === 'down' ? 46 : 0);
  if (dir === 'up' || dir === 'down') bx = Math.min(Math.max(bx, 118), sim.w - 118);
  by = Math.min(Math.max(by, 40), sim.h - 40);
  if (dir === 'down') return { x0: bx - bw / 2, x1: bx + bw / 2, y0: by, y1: by + bh };
  if (dir === 'up') return { x0: bx - bw / 2, x1: bx + bw / 2, y0: by - bh, y1: by };
  if (dir === 'left') return { x0: bx - bw, x1: bx, y0: by - bh / 2, y1: by + bh / 2 };
  return { x0: bx, x1: bx + bw, y0: by - bh / 2, y1: by + bh / 2 };
}

export function Readouts({ sim, kind }: { sim: CdnSim; kind: ReadoutKind }) {
  const portrait = sim.orient === 'portrait';
  let body: ReactNode = null;
  switch (kind) {
    case 'board':
      body = <Board sim={sim} />;
      break;
    case 'distances':
      body = <Distances sim={sim} />;
      break;
    case 'ratio':
      body = <Ratio sim={sim} />;
      break;
    case 'light':
      body = <Light />;
      break;
    case 'caches':
      body = <Caches sim={sim} files={sim.cfg.chips.length ? sim.cfg.chips : ['app', 'logo']} />;
      break;
    case 'table':
      body = <Table sim={sim} compact={portrait} />;
      break;
    case 'entry':
      body = <EntryTtl sim={sim} />;
      break;
    case 'log':
      body = <Log sim={sim} rows={portrait ? 3 : 5} />;
      break;
    case 'keys':
      body = <Keys sim={sim} />;
      break;
    case 'versions':
      body = <Versions sim={sim} />;
      break;
    case 'builds':
      body = <Builds sim={sim} />;
      break;
    case 'shield':
      body = <ShieldCount sim={sim} />;
      break;
    case 'anycast':
      body = <Anycast sim={sim} />;
      break;
    case 'tour':
      body = <TourCache sim={sim} />;
      break;
    case 'origin':
      body = <OriginLoad sim={sim} />;
      break;
  }
  if (portrait) {
    return (
      <Readout anchor="strip" head={HEADS[kind]}>
        {body}
      </Readout>
    );
  }
  const p = placeReadout(sim, kind);
  return (
    <Readout x={p.x} y={p.y} anchor="below" width={p.width} head={HEADS[kind]}>
      {body}
    </Readout>
  );
}

/* ------------------------------------------------------------------ */
/* Follow-one-request inspector                                        */
/* ------------------------------------------------------------------ */

const TOUR_CARDS: Record<string, { head: string; tone?: 'req' | 'res' | 'err'; lines: InspectorLine[]; note?: (s: CdnSim) => string }> = {
  toEdge: {
    head: 'request · Alice → SYD edge',
    lines: ['GET /app.3f9a.js HTTP/2', 'Host: cdn.shop.example', 'rule', { t: 'from Alice, 198.51.100.42', kind: 'dim' }],
  },
  lookup: {
    head: 'SYD edge · cache lookup',
    tone: 'err',
    lines: ['key: cdn.shop.example/app.3f9a.js', 'rule', { t: 'not in the cache → MISS', kind: 'bad' }],
  },
  toOrigin: {
    head: 'cache fill · SYD → origin',
    lines: ['GET /app.3f9a.js HTTP/1.1', 'Host: cdn.shop.example', { t: 'X-Forwarded-For: 198.51.100.42', kind: 'add' }],
  },
  atOrigin: {
    head: 'origin · Virginia',
    tone: 'res',
    lines: ['reads app.3f9a.js (48 KB)', 'adds its caching rules'],
  },
  toEdgeBack: {
    head: 'response · origin → SYD',
    tone: 'res',
    lines: ['HTTP/1.1 200 OK', { t: 'Cache-Control: public,', kind: 'change' }, { t: '  max-age=31536000, immutable', kind: 'change' }, 'ETag: "3f9a"', 'Content-Length: 48213'],
  },
  stored: {
    head: 'SYD edge · stored',
    tone: 'res',
    lines: [{ t: 'cdn.shop.example/app.3f9a.js', kind: 'add' }, { t: 'fresh for 31536000 s (a year)', kind: 'dim' }],
  },
  toUser: {
    head: 'response · SYD → Alice',
    tone: 'res',
    lines: ['HTTP/2 200', { t: 'x-cache: MISS', kind: 'change' }, 'age: 0'],
    note: (s) => `Alice waited ${s.tour?.aliceMs ?? 0} ms: a trip to Virginia and back.`,
  },
  bobToEdge: {
    head: 'request · Bob → SYD edge',
    lines: ['GET /app.3f9a.js HTTP/2', 'Host: cdn.shop.example', 'rule', { t: 'Bob is also in Sydney', kind: 'dim' }],
  },
  bobLookup: {
    head: 'SYD edge · cache lookup',
    tone: 'res',
    lines: ['key: cdn.shop.example/app.3f9a.js', 'rule', { t: 'found, still fresh → HIT', kind: 'add' }],
  },
  bobToUser: {
    head: 'response · SYD → Bob',
    tone: 'res',
    lines: ['HTTP/2 200', { t: 'x-cache: HIT', kind: 'add' }, 'age: 6'],
    note: (s) => `Bob waited ${s.tour?.bobMs ?? 0} ms. Virginia never heard about it.`,
  },
};

export function TourInspector({ sim }: { sim: CdnSim }) {
  const t = sim.tour;
  if (!t) return null;
  const stage = t.stage === 'done' ? 'bobToUser' : t.stage;
  const spec = TOUR_CARDS[stage];
  if (!spec) return null;
  const f = sim.flightViews().find((v) => v.tag === 'tour');
  const hold = stage === 'lookup' || stage === 'stored' || stage === 'bobLookup' ? 'pop:SYD' : stage === 'atOrigin' ? 'origin' : null;
  let x = 0;
  let y = 0;
  if (f && !hold) {
    x = f.x;
    y = f.y;
  } else {
    const b = sim.boxes.get(hold ?? (stage.startsWith('bob') ? 'person:1' : 'person:0'));
    if (!b) return null;
    x = b.x;
    y = b.y - b.h / 2;
  }
  const note = spec.note?.(sim);
  if (sim.orient === 'portrait') {
    return (
      <Readout anchor="strip" head={spec.head}>
        {spec.lines.map((l, i) =>
          l === 'rule' ? null : (
            <div key={i} className={typeof l === 'object' && l.kind === 'bad' ? css.bad : typeof l === 'object' && l.kind === 'add' ? css.fresh : undefined}>
              {typeof l === 'string' ? l : l.t}
            </div>
          ),
        )}
        {note && <RResult>{note}</RResult>}
      </Readout>
    );
  }
  return <InspectorCard key={stage} x={x} y={y} stageW={sim.w} head={spec.head} lines={spec.lines} tone={spec.tone} note={note} />;
}
