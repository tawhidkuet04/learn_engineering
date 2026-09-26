'use client';

import type { ReactNode } from 'react';
import type { HudItem } from '@/components/stage/chrome';
import { RLine, RResult, RRow, RRows, Readout, StagePrompt } from '@/components/stage/overlays';
import { NAME_RANGES, TENANTS, VITESS_RANGES } from './routing';
import { type Detail, type ShardSim } from './sim';
import type { HudKey } from './types';
import css from './sharding.module.css';

const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(' ');
const pct = (x: number) => `${Math.round(x * 100)}%`;

/* ------------------------------------------------------------------ */
/* HUD                                                                 */
/* ------------------------------------------------------------------ */

export function hudItems(sim: ShardSim, keys: HudKey[]): HudItem[] {
  const out: HudItem[] = [];
  const n = sim.cfg.shards;
  for (const k of keys) {
    switch (k) {
      case 'load': {
        const db = sim.nodes.get('db');
        if (!db) break;
        const l = db.shownLoad;
        out.push({ label: 'write load', value: pct(l), tone: l >= 1 ? 'bad' : l >= 0.85 ? 'warn' : undefined });
        break;
      }
      case 'disk': {
        const db = sim.nodes.get('db');
        if (!db) break;
        const f = db.shownFill;
        out.push({ label: sim.cfg.scene === 'replicas' ? 'disk, each' : 'disk used', value: `${Math.round(f)}%`, tone: f >= 90 ? 'bad' : f >= 80 ? 'warn' : undefined });
        break;
      }
      case 'failed':
        out.push({ label: 'timeouts', value: sim.failed, tone: sim.failed > 0 ? 'bad' : undefined });
        break;
      case 'primary': {
        const db = sim.nodes.get('db');
        if (!db) break;
        out.push({ label: 'primary', value: pct(db.shownLoad), tone: db.shownLoad >= 1 ? 'bad' : undefined });
        break;
      }
      case 'replica': {
        const r = sim.nodes.get('rep1');
        if (!r) break;
        out.push({ label: 'replicas', value: pct(r.shownLoad), tone: r.shownLoad >= 1 ? 'bad' : r.shownLoad >= 0.85 ? 'warn' : undefined });
        break;
      }
      case 'hottest': {
        const h = sim.hottest();
        if (!h) break;
        out.push({ label: 'hottest', value: pct(h.shownLoad), unit: h.kind === 'shard' ? `shard-${h.idx}` : '', tone: h.shownLoad >= 1 ? 'bad' : h.shownLoad >= 0.85 ? 'warn' : 'good' });
        break;
      }
      case 'skew': {
        const s = sim.skew();
        out.push({ label: 'max ÷ avg', value: s ? `${s.toFixed(1)}×` : '—', tone: s && s > 1.6 ? 'bad' : s && s > 1.25 ? 'warn' : s ? 'good' : undefined });
        break;
      }
      case 'idle':
        out.push({ label: 'idle shards', value: `${sim.idle()} of ${n}`, tone: sim.idle() > 0 ? 'warn' : undefined });
        break;
      case 'writes':
        out.push({ label: 'writes', value: sim.totalRate().toFixed(1), unit: '/s' });
        break;
      case 'biggest': {
        const list = sim.shardNodes();
        if (!list.length) break;
        const f = Math.max(...list.map((x) => x.shownFill));
        out.push({ label: 'fullest disk', value: `${Math.round(f)}%` });
        break;
      }
      case 'monthly': {
        const m = sim.monthly;
        out.push({ label: 'monthly report', value: m ? m.shards : '—', unit: m ? (m.shards === 1 ? 'shard' : 'shards') : undefined, tone: m ? (m.shards === 1 ? 'good' : 'warn') : undefined });
        break;
      }
      case 'myorders': {
        const m = sim.myOrders;
        out.push({ label: 'alice’s orders', value: m ? m.shards : '—', unit: m ? (m.shards === 1 ? 'shard' : 'shards') : undefined, tone: m ? (m.shards === 1 ? 'good' : 'warn') : undefined });
        break;
      }
      case 'single': {
        const a = sim.avg(sim.lat.single);
        out.push({ label: 'single-shard avg', value: a ?? '—', unit: a != null ? 'ms' : undefined, tone: a != null ? 'good' : undefined });
        break;
      }
      case 'scatter': {
        const a = sim.avg(sim.lat.scatter);
        out.push({ label: 'scatter-gather avg', value: a ?? '—', unit: a != null ? 'ms' : undefined, tone: a != null ? 'warn' : undefined });
        break;
      }
      case 'lookups':
        out.push({ label: 'lookups', value: sim.lookups });
        break;
      case 'join': {
        const j = sim.joinStats;
        out.push({
          label: 'last join',
          value: j ? `${j.ms}` : '—',
          unit: j ? `ms · ${j.shards} shard${j.shards > 1 ? 's' : ''} · ${j.trips} trip${j.trips > 1 ? 's' : ''}` : undefined,
          tone: j ? (j.trips > 1 ? 'warn' : 'good') : undefined,
          wide: true,
        });
        break;
      }
      case 'ids':
        out.push({ label: 'ids issued', value: sim.idsIssued });
        break;
      case 'dupes':
        out.push({ label: 'duplicate ids', value: sim.dupes, tone: sim.dupes > 0 ? 'bad' : 'good' });
        break;
      case 'moved': {
        if (sim.cfg.tiles) {
          const m = sim.moved;
          out.push({
            label: 'rows moved',
            value: m ? `${sim.tileMoves}/${m.of}` : '—',
            unit: m && sim.tileMoving === 0 ? `· ${Math.round((m.rows / m.of) * 100)}%` : undefined,
            tone: m && sim.tileMoving === 0 ? (m.rows / m.of > 0.5 ? 'bad' : 'good') : undefined,
          });
        } else {
          const p = sim.movedPct;
          out.push({ label: 'last move', value: p == null ? '—' : pct(p), tone: p == null ? undefined : p > 0.5 ? 'bad' : p > 0.3 ? 'warn' : 'good' });
        }
        break;
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Readouts                                                            */
/* ------------------------------------------------------------------ */

function placeFor(sim: ShardSim): { anchor: 'right' | 'strip'; x?: number; y?: number } | null {
  if (sim.orient === 'portrait') return { anchor: 'strip' };
  const proxy = sim.cfg.routerMode === 'proxy';
  const hub = sim.boxes.get(proxy ? 'router' : 'app');
  if (!hub || Number.isNaN(hub.x)) return null;
  return { anchor: 'right', x: hub.x + hub.w / 2 + 22, y: proxy ? hub.y : hub.y + 58 };
}

export function StageReadout({ sim }: { sim: ShardSim }) {
  const kind = sim.cfg.readout;
  const at = placeFor(sim);
  if (!at || kind === 'none' || sim.cfg.scene !== 'sharded') return null;
  let head = '';
  let body: ReactNode = null;
  if (kind === 'writes') [head, body] = writesReadout(sim);
  else if (kind === 'queries') [head, body] = queriesReadout(sim);
  else if (kind === 'ids') [head, body] = idsReadout(sim);
  else if (kind === 'tiles') [head, body] = tilesReadout(sim);
  if (!head) return null;
  return (
    <Readout anchor={at.anchor} x={at.x} y={at.y} head={head} fresh={sim.vt - sim.lastVt < 0.35}>
      {body}
    </Readout>
  );
}

/** Which shard-level row to highlight for a routing decision. */
function hitOf(d: Detail | null) {
  return d ? d.shard : -1;
}

function writesReadout(sim: ShardSim): [string, ReactNode] {
  const c = sim.cfg;
  const P = sim.orient === 'portrait';
  const pw = sim.pendingWrite;
  const d: Detail | null = pw ? pw.detail : sim.last;
  const hidden = !!pw;
  const hit = hidden ? -1 : hitOf(d);
  const n = c.shards;
  const rowsOf = (labels: string[]) =>
    P ? (
      <div className={css.pairs}>
        {labels.map((l, i) => (
          <span key={i} className={cx(i === hit && css.on)}>
            {l}→{i}
          </span>
        ))}
      </div>
    ) : (
      <div className={css.kv}>
        {labels.map((l, i) => [
          <span key={`a${i}`} className={cx(i === hit && css.on)}>
            {l}
          </span>,
          <span key={`b${i}`} className={cx(i === hit && css.on)}>
            → shard-{i}
          </span>,
        ])}
      </div>
    );
  const waiting = <RResult>waiting for a write…</RResult>;

  switch (c.rule) {
    case 'name': {
      const res =
        d && d.rule === 'name' ? (
          <RResult>
            <span className={css.first}>{d.key[0]}</span>
            {d.key.slice(1)} → {hidden ? <b>shard ?</b> : <b>shard-{d.shard}</b>}
          </RResult>
        ) : (
          waiting
        );
      return ['range table · username', <>{rowsOf(NAME_RANGES)}{res}</>];
    }
    case 'year': {
      const labels = Array.from({ length: n }, (_, i) => sim.tagOf(i));
      const res =
        d && d.rule === 'year' ? (
          <RResult>
            created_at {d.key} → <b>shard-{d.shard}</b>
          </RResult>
        ) : (
          waiting
        );
      return ['range table · created_at', <>{rowsOf(labels)}{res}</>];
    }
    case 'hash': {
      const key = c.keyName;
      if (!d || d.rule !== 'hash') return [`hash routing · ${key}`, <><RLine dim>shard = hash({key}) mod {n}</RLine>{waiting}</>];
      const name = d.salt != null ? `${d.id}#${d.salt}` : `${d.id}`;
      if (c.hashMode === 'buckets') {
        return [
          `100 buckets · ${key}`,
          <>
            <RLine>
              hash({name}) = <em>{d.h}</em> → bucket {d.h}
            </RLine>
            <RLine dim>bucket {d.h} is owned by shard-{d.shard}</RLine>
            <RResult>
              → <b>shard-{d.shard}</b>
            </RResult>
          </>,
        ];
      }
      return [
        `hash routing · ${key}`,
        <>
          <RLine>
            hash({name}) = <em>{d.h}</em>
          </RLine>
          <RLine>
            {d.h} mod {d.n} = {hidden ? <em>?</em> : <em>{d.shard}</em>}
          </RLine>
          <RResult>→ {hidden ? <b>shard ?</b> : <b>shard-{d.shard}</b>}</RResult>
        </>,
      ];
    }
    case 'country': {
      const labels = Array.from({ length: n }, (_, i) => sim.tagOf(i));
      const res =
        d && d.rule === 'country' ? (
          <RResult>
            country {d.code} → <b>shard-{d.shard}</b>
          </RResult>
        ) : (
          waiting
        );
      return ['list · country', <>{rowsOf(labels)}{res}</>];
    }
    case 'dir': {
      const moving = sim.dirMoving;
      const cur = d && d.rule === 'dir' ? d.tenant : null;
      return [
        'directory · tenant → shard',
        <>
          <div className={css.pairs}>
            {TENANTS.map((t) => (
              <span key={t.name} className={cx(t.name === cur && css.on, t.name === moving && css.moving)}>
                {t.name} {sim.dirMap[t.name]}
                {t.name === moving ? '→4' : ''}
              </span>
            ))}
          </div>
          {d && d.rule === 'dir' ? (
            <RResult>
              lookup {d.tenant} → <b>shard-{d.shard}</b>
            </RResult>
          ) : (
            waiting
          )}
        </>,
      ];
    }
    case 'vitess': {
      const proxy = c.routerMode === 'proxy';
      const res =
        d && d.rule === 'vitess' ? (
          <RResult>
            {d.id} → 0x{d.ks.slice(0, 4)}… → <b>shard-{d.shard}</b>
          </RResult>
        ) : (
          waiting
        );
      return [proxy ? 'vtgate · shard map v7' : 'client library · shard map v7', <>{rowsOf(VITESS_RANGES)}{res}</>];
    }
    default:
      return ['', null];
  }
}

function queriesReadout(sim: ShardSim): [string, ReactNode] {
  const q = sim.query;
  const n = sim.cfg.shards;
  if (!q) return ['query plan', <RResult key="w">waiting for a query…</RResult>];
  const pending = sim.qPending === q;
  const sql = q.spec.sql;
  if (pending) {
    return [
      'query plan · your call',
      <>
        <div className={css.sql} title={sql}>
          {q.spec.short}
        </div>
        <RResult>
          shards to ask: <b>?</b>
        </RResult>
      </>,
    ];
  }
  const head = q.kind === 'join' ? (q.round2.length ? 'join · 2 round trips' : 'join · runs on one shard') : q.targets.length > 1 ? `scatter-gather · ${n} shards` : 'routed · 1 shard';
  const maxMs = Math.max(1, ...q.results.map((r) => r.ms ?? 0));
  return [
    head,
    <>
      <div className={css.sql} title={sql}>
        {q.spec.short}
      </div>
      <RRows>
        {q.results.map((r, i) => (
          <RRow
            key={i}
            label={`${q.kind === 'join' && q.round2.length ? `r${r.round} ` : ''}shard-${r.shard}`}
            n={r.ms == null ? 0 : Math.max(1, Math.round((r.ms / maxMs) * 10))}
            value={r.ms == null ? '…' : `${r.ms} ms`}
            good={q.slowest == null || r.shard !== q.slowest || r.ms == null}
          />
        ))}
      </RRows>
      <RResult>
        {q.total == null ? (
          q.kind === 'join' && q.round === 2 ? (
            'fetching product names…'
          ) : q.targets.length > 1 ? (
            `waiting for all ${q.targets.length} shards…`
          ) : (
            `waiting for shard-${q.targets[0]}…`
          )
        ) : (
          <>
            {q.slowest != null ? `slowest: shard-${q.slowest} · ` : ''}total <b>{q.total} ms</b>
          </>
        )}
      </RResult>
    </>,
  ];
}

function idsReadout(sim: ShardSim): [string, ReactNode] {
  const c = sim.cfg;
  const P = sim.orient === 'portrait';
  if (c.idMode === 'auto') {
    return [
      'auto_increment · per shard',
      <>
        <div className={css.pairs}>
          {Array.from({ length: c.shards }, (_, i) => (
            <span key={i}>
              shard-{i}: {sim.autoInc[i]}
            </span>
          ))}
        </div>
        <RResult>
          {sim.dupes > 0 ? (
            <>
              duplicates so far: <b>{sim.dupes}</b>
            </>
          ) : (
            'every shard counts from 1000…'
          )}
        </RResult>
      </>,
    ];
  }
  const last = sim.ids[0];
  if (!last) return ['snowflake ids', <RResult key="w">waiting for an insert…</RResult>];
  const big = BigInt(last.id);
  const time = (big >> BigInt(22)).toString();
  const shard = Number((big >> BigInt(12)) & BigInt(1023));
  const seq = Number(big & BigInt(4095));
  return [
    'snowflake id · 64 bits',
    <>
      <RLine>
        <em>{last.id}</em>
      </RLine>
      {P ? (
        <RLine dim>
          time {time} · shard {shard} · seq {seq}
        </RLine>
      ) : (
        <div className={css.bits}>
          <span>time</span>
          <span>41 bits</span>
          <span>{time} ms</span>
          <span>shard</span>
          <span>10 bits</span>
          <span>{shard}</span>
          <span>sequence</span>
          <span>12 bits</span>
          <span>{seq}</span>
        </div>
      )}
    </>,
  ];
}

function tilesReadout(sim: ShardSim): [string, ReactNode] {
  const c = sim.cfg;
  const m = sim.moved;
  const moving = sim.tileMoving > 0;
  const result = m ? (
    <RResult>
      {moving ? 'moving… ' : ''}moved <b>{sim.tileMoves}</b> of {m.of} rows{!moving ? ` (${Math.round((m.rows / m.of) * 100)}%)` : ''}
    </RResult>
  ) : (
    <RResult>add a shard to see what moves</RResult>
  );
  if (c.hashMode === 'buckets') {
    return [
      '16 buckets → shards',
      <>
        <RLine>
          bucket = hash mod <em>16</em>
        </RLine>
        <RLine>shard = owner[bucket]</RLine>
        <RLine dim>{c.shards === 5 ? 'shard-4 now owns 13, 14, 15' : 'owner[] is a 16-entry table'}</RLine>
        {result}
      </>,
    ];
  }
  return [
    'placement rule',
    <>
      <RLine>
        shard = hash mod <em>{c.shards}</em>
      </RLine>
      {result}
    </>,
  ];
}

/* ------------------------------------------------------------------ */

export function PredictPrompt({ sim }: { sim: ShardSim }) {
  const q = sim.game?.pending;
  const r = sim.boxes.get('router');
  if (!q || !r) return null;
  return (
    <StagePrompt x={r.x} y={r.y - r.h / 2 - 12}>
      {q.ask}
    </StagePrompt>
  );
}
