import type { ReactNode } from 'react';
import { Hud, Legend, type HudItem, type LegendItem } from '@/components/stage/chrome';
import { Callouts, InspectorCard, RLine, RResult, Readout, StagePrompt, type Callout } from '@/components/stage/overlays';
import { SIG } from '@/lib/sim/colors';
import { ALGO_NAMES } from '../limiter';
import { fmtClock, GATEWAYS, type RateSim } from '../sim';
import { fmt1, fmt2 } from './Limiter';
import { raceGeo } from './Race';

/** A callout with its own direction on phones ('none' hides it there). */
export type StageCallout = Callout & { pdir?: Callout['dir'] | 'none' };
type Rect = { x: number; y: number; w: number; h: number };

export type HudKey = 'queue' | 'errors' | 'allowed' | 'rejected' | 'span' | 'best' | 'tokens' | 'wait' | 'storm' | 'botWindow' | 'redis';

function hudItem(sim: RateSim, k: HudKey): HudItem | null {
  const W = sim.cfg.window;
  switch (k) {
    case 'queue': {
      const full = sim.waiting.length >= sim.cfg.queueCap;
      return { label: 'Server waiting room', value: sim.waiting.length, unit: `/ ${sim.cfg.queueCap}`, tone: full ? 'bad' : sim.waiting.length > 2 ? 'warn' : undefined };
    }
    case 'errors':
      return { label: '503 errors', value: sim.errors, tone: sim.errors > 0 ? 'bad' : undefined };
    case 'allowed':
      return { label: 'Allowed', value: sim.accepted, tone: sim.accepted > 0 ? 'good' : undefined };
    case 'rejected':
      return { label: 'Rejected · 429', value: sim.rejected, tone: sim.rejected > 0 ? 'bad' : undefined };
    case 'span':
      return { label: `Most in any ${W} s`, value: sim.best.count, unit: `limit ${sim.cfg.limit}`, tone: sim.best.count > sim.cfg.limit ? 'bad' : undefined };
    case 'best':
      return { label: `Your best ${W} s`, value: sim.bestEver, unit: `limit ${sim.cfg.limit}`, tone: sim.bestEver > sim.cfg.limit ? 'bad' : undefined };
    case 'tokens': {
      const s = sim.keys.get(sim.keyOrder()[0]);
      const t = s ? s.tokens : sim.cfg.capacity;
      return { label: 'Tokens', value: fmt1(t), unit: `/ ${sim.cfg.capacity}`, tone: t < 1 ? 'bad' : undefined };
    }
    case 'wait':
      return { label: 'Longest wait', value: sim.maxWait.toFixed(1), unit: 's' };
    case 'storm': {
      const st = sim.storms[sim.storms.length - 1];
      return {
        label: 'This reconnect',
        value: st ? st.attempts : 0,
        wide: true,
        custom: (
          <div style={{ display: 'flex', gap: 10, marginTop: 2, fontFamily: 'var(--font-mono)', fontSize: 14, fontVariantNumeric: 'tabular-nums' }}>
            <span>
              {st?.attempts ?? 0} <small style={{ fontSize: 10, color: 'var(--text-3)' }}>tries</small>
            </span>
            <span style={{ color: st && st.rejected ? 'var(--sig-err)' : undefined }}>
              {st?.rejected ?? 0} <small style={{ fontSize: 10, color: 'var(--text-3)' }}>rejected</small>
            </span>
            <span style={{ color: st?.doneAt != null ? 'var(--sig-res)' : undefined }}>
              {st?.doneAt != null ? `${(st.doneAt - st.start).toFixed(1)} s` : st ? `${st.left} left` : '–'}
            </span>
          </div>
        ),
      };
    }
    case 'botWindow': {
      const n = sim.allowedThisWindow('bot');
      return { label: 'Scraper allowed · this window', value: n, unit: `limit ${sim.cfg.limit}`, tone: n > sim.cfg.limit ? 'bad' : 'good', wide: true };
    }
    case 'redis':
      return { label: 'Redis calls', value: sim.redisOps };
  }
}

export function StageHud({ sim, keys }: { sim: RateSim; keys: HudKey[] }) {
  const portrait = sim.orient === 'portrait';
  const items = keys.map((k) => hudItem(sim, k)).filter((x): x is HudItem => !!x);
  return <Hud items={portrait ? items.slice(0, 3) : items} />;
}

/** The limiter's decision rule, with the numbers from the last request plugged in. */
function DecisionReadout({ sim }: { sim: RateSim }) {
  const lim = sim.boxes.get('limiter');
  const algo = sim.cfg.algo;
  if (!lim || algo === 'none' || Number.isNaN(lim.x)) return null;
  const L = sim.orient === 'landscape';
  if (!L && sim.strip) return null;
  const last = sim.last && sim.last.node === 'limiter' ? sim.last : null;
  const d = last?.d;
  const who = last ? (sim.cfg.key === 'global' ? 'everyone' : sim.clients.get(last.client)?.name ?? last.client) : '';
  const fresh = !!last && sim.vt - last.vt < 0.45;
  let body: ReactNode = <RLine dim>waiting for a request…</RLine>;
  if (d) {
    const verdict = d.ok ? (d.queued ? <b>wait in the queue</b> : <b>allow</b>) : <b style={{ color: SIG.err }}>429</b>;
    switch (algo) {
      case 'fixed':
        body = (
          <>
            <RLine>
              count({who}, {fmtClock(d.winStart)}) = <em>{d.count}</em>
            </RLine>
            <RLine dim>{d.ok ? `${d.count} < ${d.limit}, so count it: ${d.count + 1}` : `${d.count} = ${d.limit}: window is full`}</RLine>
            <RResult>→ {verdict}</RResult>
          </>
        );
        break;
      case 'log':
        body = (
          <>
            <RLine>
              entries in the last {sim.cfg.window} s = <em>{d.count}</em>
            </RLine>
            <RLine dim>{d.ok ? `${d.count} < ${d.limit}, so log this one` : `${d.count} = ${d.limit}: no room`}</RLine>
            <RResult>→ {verdict}</RResult>
          </>
        );
        break;
      case 'sliding':
        body = (
          <>
            <RLine>
              {d.prev} × {fmt2(d.weight)} + {d.count} = <em>{fmt2(d.est)}</em>
            </RLine>
            <RLine dim>{d.ok ? `${fmt2(d.est)} < ${d.limit}, so count it` : `${fmt2(d.est)} ≥ ${d.limit}: over the limit`}</RLine>
            <RResult>→ {verdict}</RResult>
          </>
        );
        break;
      case 'token':
        body = (
          <>
            <RLine>
              tokens = <em>{fmt1(d.tokens)}</em>
            </RLine>
            <RLine dim>{d.ok ? `≥ 1, so take one: ${fmt1(d.tokens - 1)} left` : `< 1: nothing to take`}</RLine>
            <RResult>→ {verdict}</RResult>
          </>
        );
        break;
      case 'leaky':
        body = (
          <>
            <RLine>
              queue = <em>{d.count}</em> of {d.limit}
            </RLine>
            <RLine dim>{d.ok ? (d.queued ? `room, so join the line (#${d.count + 1})` : 'empty and the drip is ready: go now') : 'bucket is full'}</RLine>
            <RResult>→ {verdict}</RResult>
          </>
        );
        break;
    }
  }
  const head = last ? `${ALGO_NAMES[algo]} · ${who}` : ALGO_NAMES[algo];
  return L ? (
    <Readout x={lim.x} y={lim.y + lim.h / 2 + 14} head={head} fresh={fresh} width={244}>
      {body}
    </Readout>
  ) : (
    <Readout anchor="strip" head={head} fresh={fresh}>
      {body}
    </Readout>
  );
}

function DistReadout({ sim }: { sim: RateSim }) {
  const lb = sim.boxes.get('lb');
  if (!lb || Number.isNaN(lb.x)) return null;
  const L = sim.orient === 'landscape';
  const win = Math.floor(sim.lt / sim.cfg.window + 1e-9);
  const counts = GATEWAYS.map((g) => {
    const s = sim.gwKeys.get(g)?.get('bot');
    return s && s.win === win ? s.count : 0;
  });
  const total = sim.allowedThisWindow('bot');
  const redis = sim.cfg.store === 'redis';
  const body = redis ? (
    <>
      <RLine>one counter in Redis, shared by all 3</RLine>
      <RLine dim>INCR returns the global count</RLine>
      <RResult>
        scraper allowed this window: <b>{total}</b> of {sim.cfg.limit}
      </RResult>
    </>
  ) : (
    <>
      <RLine>
        gw-1 <em>{counts[0]}</em> + gw-2 <em>{counts[1]}</em> + gw-3 <em>{counts[2]}</em>
      </RLine>
      <RLine dim>each gateway only sees a third</RLine>
      <RResult>
        scraper allowed this window: <b style={{ color: total > sim.cfg.limit ? SIG.err : undefined }}>{total}</b> (limit {sim.cfg.limit})
      </RResult>
    </>
  );
  return L ? (
    <Readout x={lb.x} y={lb.y + lb.h / 2 + 96} head="scraper · this window" width={236}>
      {body}
    </Readout>
  ) : (
    <Readout anchor="strip" head="scraper · this window">
      {body}
    </Readout>
  );
}

const PEOPLE = new Set(['Alice', 'Bob', 'Scraper']);

export function StageOverlay({
  sim,
  hud,
  legend,
  callouts = [],
  stepKey,
  resolveCallout,
  readout = true,
}: {
  sim: RateSim;
  hud: HudKey[];
  legend: LegendItem[];
  callouts?: StageCallout[];
  stepKey: string;
  resolveCallout?: (target: string) => Rect | null;
  readout?: boolean;
}) {
  const sc = sim.cfg.scene;
  const portrait = sim.orient === 'portrait';
  // On phones a docked readout takes the legend's spot.
  const docked = portrait && readout && !sim.strip && sc !== 'race' && (sc === 'dist' || sim.cfg.inspect || sim.cfg.algo !== 'none');
  // Only list people who are on stage; on phones they're labeled there already, so keep the legend to one line.
  const present = new Set([...sim.clients.values()].map((c) => c.name));
  const onStage = legend.filter((l) => !PEOPLE.has(l.label) || present.has(l.label));
  const items = portrait && onStage.length > 4 ? onStage.filter((l) => !PEOPLE.has(l.label)) : onStage;
  const shown: Callout[] = callouts
    .map((c) => (portrait ? (c.pdir === 'none' ? null : { ...c, dir: c.pdir ?? c.dir }) : c))
    .filter((c): c is Callout => !!c);
  const q = sim.game?.pending;
  const lim = sim.boxes.get('limiter');
  let prompt: ReactNode = null;
  if (q) {
    if (sc === 'race') {
      const g = raceGeo(sim);
      prompt = (
        <StagePrompt x={g.x + g.w / 2} y={g.yOf(2.5) + 30}>
          {q.ask}
        </StagePrompt>
      );
    } else if (lim) {
      prompt = (
        <StagePrompt x={lim.x} y={lim.y - lim.h / 2 - (portrait ? 8 : 24)}>
          {q.ask}
        </StagePrompt>
      );
    }
  }

  // The newest response that carries headers gets an inspector card, once it's clear of the limiter.
  // Phones have no room for a riding card, so the latest headers dock at the bottom instead.
  let inspector: ReactNode = null;
  if (sim.cfg.inspect) {
    const mark = (lines: string[], err: boolean) => lines.map((t, i) => (i === 0 ? { t, kind: 'strong' as const } : i === 1 && err ? { t, kind: 'change' as const } : t));
    if (portrait) {
      const n = sim.lastNote;
      inspector = (
        <Readout anchor="strip" head={n ? n.head : 'responses'}>
          {n ? (
            n.lines.map((t, i) => (
              <RLine key={i} dim={i > 1 || (i === 1 && n.tone !== 'err')}>
                {i === 0 || (i === 1 && n.tone === 'err') ? <em>{t}</em> : t}
              </RLine>
            ))
          ) : (
            <RLine dim>waiting for a response…</RLine>
          )}
        </Readout>
      );
    } else {
      // Pinned above the client-limiter wire; it shows whichever response is on its way.
      const lim = sim.boxes.get('limiter');
      const client = sim.clients.size ? sim.boxes.get([...sim.clients.keys()][0]) : null;
      const note = sim.lastNote;
      if (lim && client && note) {
        const x = (client.x + client.w / 2 + lim.x - lim.w / 2) / 2;
        inspector = <InspectorCard key={note.lines.join('|')} x={x} y={lim.y - 6} stageW={sim.w} head={note.head} lines={mark(note.lines, note.tone === 'err')} tone={note.tone} />;
      }
    }
  }

  return (
    <>
      <StageHud sim={sim} keys={hud} />
      {!docked && <Legend items={items} />}
      <Callouts sim={sim} callouts={shown} stepKey={stepKey} resolve={resolveCallout} />
      {readout && sc !== 'race' && sc !== 'dist' && !sim.cfg.inspect && <DecisionReadout sim={sim} />}
      {readout && sc === 'dist' && <DistReadout sim={sim} />}
      {inspector}
      {prompt}
    </>
  );
}
