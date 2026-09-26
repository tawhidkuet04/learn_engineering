import type { ReactNode } from 'react';
import { Hud, Legend, type HudItem, type LegendItem } from '@/components/stage/chrome';
import { RLine, RResult, RRow, RRows, Readout, StagePrompt } from '@/components/stage/overlays';
import { SIG } from '@/lib/sim/colors';
import { clamp } from '@/lib/sim/geometry';
import { dbGeom } from './geom';
import { seqTimeline } from './Scene';
import { money, toMs, type ReplSim } from './sim';
import css from './replication.module.css';

/* ------------------------------------------------------------------ */
/* HUD                                                                 */
/* ------------------------------------------------------------------ */

export type HudKey =
  | 'reads'
  | 'readLat'
  | 'errors'
  | 'writeErrors'
  | 'commits'
  | 'commitLat'
  | 'lsn'
  | 'lag'
  | 'stale'
  | 'aliceStale'
  | 'aliceLat'
  | 'backJumps'
  | 'lost'
  | 'leaders'
  | 'unbacked'
  | 'seqLat'
  | 'seqCopies';

function hudItem(sim: ReplSim, k: HudKey): HudItem | null {
  const m = sim.m;
  switch (k) {
    case 'reads':
      return { label: 'Reads served', value: sim.rate(m.readT).toFixed(1), unit: '/s' };
    case 'readLat': {
      const p = sim.p95(m.readLat);
      const v = p == null ? null : toMs(p);
      return { label: 'p95 read', value: v ?? '—', unit: 'ms', tone: v == null ? undefined : v > 160 ? 'bad' : v > 95 ? 'warn' : undefined };
    }
    case 'errors':
      return { label: 'Errors', value: m.errors, tone: m.errors > 0 ? 'bad' : undefined };
    case 'writeErrors':
      return { label: 'Failed writes', value: m.writeErrors, tone: m.writeErrors > 0 ? 'bad' : undefined };
    case 'commits':
      return { label: 'Commits', value: sim.rate(m.commitT).toFixed(1), unit: '/s' };
    case 'commitLat': {
      const wait = sim.waitingFor();
      if (wait != null && wait > 3.5) return { label: 'Oldest write waiting', value: toMs(wait), unit: 'ms', tone: 'bad' };
      const last = m.commitLat[m.commitLat.length - 1];
      return { label: 'Commit latency', value: last == null ? '—' : toMs(last), unit: 'ms' };
    }
    case 'lsn': {
      const L = sim.leader();
      return { label: 'Leader log at', value: L ? `#${L.head}` : '—' };
    }
    case 'lag': {
      const v = toMs(sim.maxLagView());
      return { label: 'Max lag', value: v, unit: 'ms', tone: v > 200 ? 'bad' : v > 90 ? 'warn' : undefined };
    }
    case 'stale': {
      const pct = m.reads ? Math.round((m.stale / m.reads) * 100) : 0;
      return { label: 'Stale reads', value: pct, unit: '%', tone: pct > 10 ? 'warn' : undefined };
    }
    case 'aliceStale':
      return { label: 'Alice saw old data', value: `${m.aliceStale} / ${m.aliceReads}`, tone: m.aliceStale > 0 ? 'bad' : m.aliceReads > 0 ? 'good' : undefined };
    case 'aliceLat':
      return { label: "Alice's last read", value: m.aliceLat == null ? '—' : toMs(m.aliceLat), unit: 'ms', tone: m.aliceLat != null && toMs(m.aliceLat) > 100 ? 'warn' : undefined };
    case 'backJumps':
      return { label: 'Back in time', value: m.backJumps, unit: '×', tone: m.backJumps > 0 ? 'bad' : undefined };
    case 'lost':
      return { label: 'Lost writes', value: m.lost, tone: m.lost > 0 ? 'bad' : undefined };
    case 'leaders': {
      const n = sim.leaderCount();
      return { label: 'Leaders', value: n, tone: n !== 1 ? 'bad' : 'good' };
    }
    case 'unbacked':
      return m.backupLost > 0
        ? { label: 'Lost in restore', value: m.backupLost, unit: 'writes', tone: 'bad' }
        : { label: 'Only on this disk', value: sim.writesSinceBackup(), unit: 'writes' };
    case 'seqLat': {
      const tl = seqTimeline(sim.cfg.seqMode);
      return { label: 'Commit latency', value: sim.stepT >= tl.commitAt ? toMs(tl.commitAt - 0.4) : '…', unit: 'ms', tone: sim.cfg.seqMode === 'sync' && sim.stepT >= tl.commitAt ? 'warn' : undefined };
    }
    case 'seqCopies': {
      const tl = seqTimeline(sim.cfg.seqMode);
      return { label: 'Copies at COMMIT', value: sim.stepT >= tl.commitAt ? tl.copies : '…', tone: sim.stepT >= tl.commitAt ? (tl.copies > 1 ? 'good' : 'warn') : undefined };
    }
  }
}

export function StageHud({ sim, keys }: { sim: ReplSim; keys: HudKey[] }) {
  const items = keys.map((k) => hudItem(sim, k)).filter((x): x is HudItem => !!x);
  return <Hud items={items} />;
}

/* ------------------------------------------------------------------ */
/* Legend                                                              */
/* ------------------------------------------------------------------ */

export type LegendKey = 'write' | 'read' | 'entry' | 'commit' | 'result' | 'ack' | 'stale' | 'err' | 'hb' | 'app1' | 'app2' | 'repair' | 'term';

export const LEGEND: Record<LegendKey, LegendItem> = {
  write: { label: 'write', color: SIG.heavy },
  read: { label: 'read', color: SIG.req },
  entry: { label: 'log entry', color: SIG.heavy, shape: 'square' },
  commit: { label: 'commit', color: SIG.res },
  result: { label: 'result', color: SIG.res },
  ack: { label: 'flush ack', color: SIG.res, shape: 'small' },
  stale: { label: 'stale result', color: SIG.warn },
  err: { label: 'error', color: SIG.err },
  hb: { label: 'heartbeat', color: SIG.hc, shape: 'small' },
  app1: { label: 'app-1 write', color: SIG.teal },
  app2: { label: 'app-2 write', color: SIG.pink },
  repair: { label: 'read repair', color: SIG.hc },
  term: { label: 'term 2 entry', color: SIG.teal, shape: 'line' },
};

/* ------------------------------------------------------------------ */
/* Readouts                                                            */
/* ------------------------------------------------------------------ */

export type ReadoutKind = 'status' | 'wal' | 'alice' | 'history' | 'lost' | 'split' | 'conflict' | 'quorum' | 'load';

function lagBars(ms: number) {
  return clamp(Math.round(ms / 22), 0, 12);
}

function StatusBody({ sim, compact }: { sim: ReplSim; compact: boolean }) {
  const fs = sim.followers();
  const L = sim.leader();
  return (
    <>
      <RRows>
        {fs.map((f) => {
          const ms = toMs(sim.lagView(f.id));
          const fromOther = L && f.source !== L.id;
          const state = sim.cfg.sync ? ` ${sim.syncStateOf(f)}` : '';
          return (
            <RRow
              key={f.id}
              label={f.up ? `${f.label}${compact ? '' : state} #${f.applied}` : `${f.label} down`}
              n={f.up && !fromOther ? lagBars(ms) : 0}
              value={f.up ? (fromOther ? '—' : `${ms} ms`) : '—'}
              good={f.up && ms < 45}
            />
          );
        })}
      </RRows>
    </>
  );
}

function statusHead(sim: ReplSim) {
  const L = sim.leader();
  if (!L || !L.up) return 'replication · no leader';
  return `replication · ${L.label} @ #${L.head}`;
}

function WalBody({ sim }: { sim: ReplSim }) {
  const L = sim.leader();
  const e = L?.log[L.log.length - 1];
  if (!L || !e) return <RLine dim>waiting for the first write…</RLine>;
  return (
    <>
      <RLine>
        lsn <em>#{e.lsn}</em> · term {e.term}
      </RLine>
      <RLine>table accounts, row &apos;{e.key}&apos;</RLine>
      <RLine>
        set balance = <em>{money(e.v)}</em>
      </RLine>
      <RLine dim>({e.note})</RLine>
      <RResult>
        logged first, then applied · <b>#{L.applied}</b>
      </RResult>
    </>
  );
}

function AliceBody({ sim }: { sim: ReplSim }) {
  const a = sim.alice;
  const m = sim.m;
  const pol = sim.cfg.scenario === 'stale' ? 'reads go to a follower' : sim.cfg.ryw === 'leader' ? 'reads → leader for a while after a write' : sim.cfg.ryw === 'lsn' ? `followers wait until ≥ #${a.lastLsn || '…'}` : 'reads → any follower';
  return (
    <>
      <RLine>
        alice&apos;s deposit {a.lastLsn ? <em>#{a.lastLsn}</em> : '…'} → {money(a.expect)}
      </RLine>
      <RLine dim>{pol}</RLine>
      <RResult>
        stale reads <b>{m.aliceStale}</b> of {m.aliceReads}
      </RResult>
    </>
  );
}

function HistoryBody({ sim }: { sim: ReplSim }) {
  const reads = sim.alice.reads;
  return (
    <>
      {reads.length === 0 && <RLine dim>waiting for the first refresh…</RLine>}
      {reads.map((r, i) => (
        <RLine key={`${i}-${r.v}-${r.db}`}>
          {r.db} → {money(r.v)} {r.back ? <em>↓ back in time</em> : i > 0 ? <span className={css.dimText}>ok</span> : null}
        </RLine>
      ))}
      <RResult>
        went backwards <b>{sim.m.backJumps}×</b>
      </RResult>
    </>
  );
}

function LostBody({ sim }: { sim: ReplSim }) {
  const lost = sim.lostEntries.slice(-3);
  const promoted = sim.term > 1;
  return (
    <>
      {!promoted && <RLine dim>no failover yet…</RLine>}
      {promoted && lost.length === 0 && <RLine>every confirmed write survived ✓</RLine>}
      {lost.map((e) => (
        <RLine key={e.lsn}>
          #{e.lsn} {e.note} <em>was confirmed</em>
        </RLine>
      ))}
      <RResult>
        confirmed, then lost: <b>{sim.m.lost}</b>
      </RResult>
    </>
  );
}

function SplitBody({ sim }: { sim: ReplSim }) {
  const leaders = [...sim.dbs.values()].filter((d) => d.role === 'leader' && d.up && !d.fenced);
  return (
    <>
      {leaders.map((d) => (
        <RLine key={d.id}>
          {d.label} (term {d.term}): alice {money(d.data.alice.v)} · bob {money(d.data.bob.v)}
        </RLine>
      ))}
      <RResult>
        accepting writes: <b>{leaders.length === 1 ? `${leaders[0].label} only` : `${leaders.length} leaders`}</b>
      </RResult>
    </>
  );
}

function ConflictBody({ sim }: { sim: ReplSim }) {
  const c = sim.conflicts[sim.conflicts.length - 1];
  if (!c) return <RLine dim>watching both regions…</RLine>;
  return (
    <>
      <RLine>us-east wrote alice = {money(c.us)}</RLine>
      <RLine>eu-west wrote alice = {money(c.eu)}</RLine>
      <RLine>
        later timestamp: <em>{c.winner === 'us' ? 'us-east' : 'eu-west'}</em> → {money(c.final)}
      </RLine>
      <RResult>
        silently discarded: <b>{c.lostNote}</b>
      </RResult>
    </>
  );
}

function QuorumBody({ sim }: { sim: ReplSim }) {
  const R = sim.cfg.quorumR;
  const q = sim.quorum;
  const ok = 2 + R > 3;
  return (
    <>
      <RLine>
        W + R = {2 + R} <em>{ok ? '>' : '≤'}</em> N = 3
      </RLine>
      <RLine dim>{ok ? 'every read overlaps the latest write' : 'a read can miss the latest write'}</RLine>
      <RResult>
        {q.result ? (
          <>
            read {q.result.from.join(' + ')} → <b>{money(q.result.v)} v{q.result.ver}</b> {q.result.stale ? '(stale)' : '(newest)'}
          </>
        ) : (
          'waiting for a read…'
        )}
      </RResult>
    </>
  );
}

function LoadBody({ sim }: { sim: ReplSim }) {
  const dbs = sim.order.map((id) => sim.dbs.get(id)).filter((d): d is NonNullable<typeof d> => !!d);
  if (dbs.length === 1) {
    const d = dbs[0];
    const full = d.queue.length >= 7;
    return (
      <>
        <RRows>
          <RRow label="running" n={d.inService.length} value={`${d.inService.length} / 2`} />
          <RRow label="waiting" n={d.queue.length} value={full ? `${d.queue.length} full` : d.queue.length} />
        </RRows>
        <RResult>
          refused so far <b>{sim.m.errors}</b>
        </RResult>
      </>
    );
  }
  return (
    <RRows>
      {dbs.map((d) => {
        const busy = d.inService.length + d.queue.length;
        return <RRow key={d.id} label={`${d.label}${d.role === 'leader' ? ' leader' : ''}`} n={busy} value={d.up ? busy : 'down'} good={busy <= 2} />;
      })}
    </RRows>
  );
}

const HEADS: Record<ReadoutKind, (sim: ReplSim) => string> = {
  status: statusHead,
  wal: (sim) => `${sim.leader()?.label ?? 'leader'} · newest log entry`,
  alice: () => "alice's session",
  history: () => "alice's dashboard · last reads",
  lost: () => 'writes lost in the failover',
  split: () => 'who accepts writes?',
  conflict: () => 'conflict · last write wins',
  quorum: (sim) => `N = 3 · W = 2 · R = ${sim.cfg.quorumR}`,
  load: (sim) => (sim.dbs.size === 1 ? 'db-1 · queries in progress' : 'queries in progress'),
};

function Body({ sim, kind, compact }: { sim: ReplSim; kind: ReadoutKind; compact: boolean }) {
  switch (kind) {
    case 'status':
      return <StatusBody sim={sim} compact={compact} />;
    case 'wal':
      return <WalBody sim={sim} />;
    case 'alice':
      return <AliceBody sim={sim} />;
    case 'history':
      return <HistoryBody sim={sim} />;
    case 'lost':
      return <LostBody sim={sim} />;
    case 'split':
      return <SplitBody sim={sim} />;
    case 'conflict':
      return <ConflictBody sim={sim} />;
    case 'quorum':
      return <QuorumBody sim={sim} />;
    case 'load':
      return <LoadBody sim={sim} />;
  }
}

/** Where readouts go: the free column right of the replication arcs (landscape). */
function sidePanel(sim: ReplSim): { x: number; y: number; w: number } {
  if (sim.cfg.topo === 'multi') return { x: sim.w / 2, y: sim.h * 0.58 + 64, w: 300 };
  const first = sim.boxes.get(sim.order[0]);
  if (!first || Number.isNaN(first.x)) return { x: sim.w - 140, y: 90, w: 250 };
  const x0 = first.x + first.w / 2 + sim.arcRoom() + 18;
  const w = clamp(sim.w - 16 - x0, 180, 262);
  return { x: x0 + w / 2, y: Math.max(84, first.y - first.h / 2), w };
}

export function Readouts({ sim, kinds }: { sim: ReplSim; kinds: ReadoutKind[] }) {
  if (!kinds.length || sim.cfg.topo === 'seq') return null;
  const P = sim.orient === 'portrait';
  if (P) {
    const k = kinds[0];
    return (
      <Readout anchor="strip" head={HEADS[k](sim)}>
        <Body sim={sim} kind={k} compact />
        {kinds.includes('alice') && k !== 'alice' && <AliceStrip sim={sim} />}
      </Readout>
    );
  }
  const pos = sidePanel(sim);
  return (
    <Readout x={pos.x} y={pos.y} width={pos.w} head={HEADS[kinds[0]](sim)}>
      <Body sim={sim} kind={kinds[0]} compact={false} />
      {kinds.slice(1).map((k) => (
        <div key={k} className={css.subReadout}>
          <div className={css.subHead}>{HEADS[k](sim)}</div>
          <Body sim={sim} kind={k} compact={false} />
        </div>
      ))}
    </Readout>
  );
}

function AliceStrip({ sim }: { sim: ReplSim }) {
  const a = sim.alice;
  return (
    <RResult>
      alice&apos;s deposit <b>{a.lastLsn ? `#${a.lastLsn}` : '…'}</b> · stale {sim.m.aliceStale}/{sim.m.aliceReads}
    </RResult>
  );
}

/* ------------------------------------------------------------------ */
/* Prediction prompt and the inspector card                            */
/* ------------------------------------------------------------------ */

export function Prompt({ sim }: { sim: ReplSim }) {
  const q = sim.game?.pending;
  if (!q?.ask) return null;
  let x = sim.w / 2;
  let y = 60;
  const at = q.askAt;
  if (at && 'id' in at) {
    const b = sim.boxes.get(at.id);
    if (b) {
      x = b.x;
      // Sit in the gap above the node without covering the node above it.
      y = b.y - b.h / 2 + (sim.orient === 'portrait' ? 8 : -4);
    }
  } else if (at) {
    x = at.x;
    y = at.y;
  }
  x = clamp(x, 150, sim.w - 150);
  const text: ReactNode = q.choices ? (
    q.ask
  ) : (
    <>
      {q.ask} <span className={css.promptHint}>Click one</span>
    </>
  );
  return (
    <StagePrompt x={x} y={y}>
      {text}
    </StagePrompt>
  );
}

/**
 * A card that rides along beside one replicated log entry, in the free
 * column right of the arcs (the kit's InspectorCard would sit on top of
 * the status readout here). Landscape only.
 */
export function Inspector({ sim }: { sim: ReplSim }) {
  const tr = sim.inspect;
  if (!tr || sim.orient !== 'landscape') return null;
  const e = sim.leader()?.log.find((x) => x.lsn === tr.lsn);
  const to = sim.dbs.get(tr.to);
  if (!e || !to) return null;
  const f = sim.flights.find((x) => x.id === tr.flightId);
  const k = f ? sim.progressOf(f) : 1;
  const p = sim.arcPoint(tr.from, tr.to, k);
  const mid = sim.arcPoint(tr.from, tr.to, 0.5);
  if (!p || !mid) return null;
  const left = mid.maxX + 26;
  const landed = tr.landedAt != null;
  return (
    <div className={css.walCard} data-landed={landed} style={{ left, top: p.y }}>
      <svg className={css.walLeader} width={Math.max(1, left - p.x)} height={2} style={{ left: p.x - left }} aria-hidden>
        <line x1={0} y1={1} x2={Math.max(1, left - p.x)} y2={1} />
      </svg>
      <div className={css.walHead}>
        log entry #{e.lsn} → {to.label}
      </div>
      <div className={css.walBody}>
        <div>table accounts</div>
        <div>row id = &apos;{e.key}&apos;</div>
        <div className={css.walStrong}>set balance = {money(e.v)}</div>
        <div className={css.walDim}>
          lsn {e.lsn} · term {e.term}
        </div>
        {landed && <div className={css.walDone}>✓ replayed: {to.label} at #{to.applied}</div>}
      </div>
    </div>
  );
}

/**
 * Callout targets beyond plain box ids: 'leader', 'tape:<id|leader>'.
 * Prefix with 'L|' or 'P|' to show a callout only in landscape or portrait.
 */
export function resolveTarget(sim: ReplSim, raw: string) {
  let target = raw;
  if (raw.startsWith('L|') || raw.startsWith('P|')) {
    if ((raw[0] === 'L') !== (sim.orient === 'landscape')) return null;
    target = raw.slice(2);
  }
  const [kind, rest] = target.split(':');
  const id = (x: string) => (x === 'leader' ? sim.leaderId ?? 'db1' : x);
  if (kind === 'tape' && rest) {
    const b = sim.boxes.get(id(rest));
    if (!b || Number.isNaN(b.x)) return null;
    const g = dbGeom(b.w, sim.orient === 'portrait');
    const tw = g.cells * g.cellW;
    return { x: b.x + b.w / 2 - 10 - tw / 2, y: b.y - b.h / 2 + g.tapeMid, w: tw, h: g.tapeH };
  }
  const b = sim.boxes.get(id(target));
  if (!b || Number.isNaN(b.x)) return null;
  return { x: b.x, y: b.y, w: b.w, h: b.h };
}

export function StageLegend({ sim, keys, hasStrip }: { sim: ReplSim; keys: LegendKey[]; hasStrip: boolean }) {
  if (sim.orient === 'portrait' && hasStrip) return null;
  return <Legend items={keys.map((k) => LEGEND[k])} />;
}
