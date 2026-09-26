import { Fragment, type ReactNode } from 'react';
import { Hud, Legend, type HudItem } from '@/components/stage/chrome';
import { Callouts, InspectorCard, Readout, StagePrompt, type InspectorLine } from '@/components/stage/overlays';
import { clamp } from '@/lib/sim/geometry';
import { SERVICES, userOf, type LedgerRow, type Phase, type SignupReq } from './model';
import css from './mq.module.css';
import type { MQSim } from './sim';
import type { HudKey, Step } from './types';

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

/* ------------------------------------------------------------------ */
/* HUD                                                                 */
/* ------------------------------------------------------------------ */

function hudItems(sim: MQSim, keys: HudKey[], portrait: boolean): HudItem[] {
  const m = sim.m;
  const out: HudItem[] = [];
  const spark = (s: number[]) => (portrait ? undefined : s.length > 1 ? s : undefined);
  for (const key of portrait ? keys.slice(0, 3) : keys) {
    switch (key) {
      case 'signup': {
        const v = sim.lastSignup();
        out.push({
          label: 'Signup response',
          value: v == null ? '—' : fmt(v),
          unit: 'ms',
          tone: v == null ? undefined : v > 1000 ? 'bad' : v > 300 ? 'warn' : 'good',
          spark: spark(m.resp.slice(-16)),
        });
        break;
      }
      case 'ok':
        out.push({ label: 'Signups OK', value: m.okSignups });
        break;
      case 'failed':
        out.push({ label: 'Signups failed', value: m.failedSignups, tone: m.failedSignups > 0 ? 'bad' : undefined });
        break;
      case 'depth': {
        const d = sim.depth();
        out.push({ label: portrait ? 'Depth' : 'Queue depth', value: d, tone: d >= 10 ? 'warn' : undefined, spark: spark(m.depth.slice(-30)) });
        break;
      }
      case 'inflight':
        out.push({ label: 'In flight', value: sim.inflightCount() });
        break;
      case 'age': {
        const a = sim.oldestAge();
        out.push({ label: portrait ? 'Oldest' : 'Oldest message', value: a.toFixed(1), unit: 's', tone: a > 15 ? 'bad' : a > 7 ? 'warn' : undefined });
        break;
      }
      case 'in':
        out.push({ label: 'Arriving', value: sim.rateIn().toFixed(1), unit: '/s' });
        break;
      case 'out':
        out.push({ label: portrait ? 'Done' : 'Processed', value: sim.rateOut().toFixed(1), unit: '/s' });
        break;
      case 'processed':
        out.push({ label: 'Processed', value: m.processed });
        break;
      case 'redelivered':
        out.push({ label: 'Redelivered', value: m.redelivered, tone: m.redelivered > 0 ? 'warn' : undefined });
        break;
      case 'charges':
        out.push({ label: 'Charges', value: m.charges });
        break;
      case 'dupes':
        out.push({ label: portrait ? 'Double' : 'Double charges', value: m.dupes, tone: m.dupes > 0 ? 'bad' : 'good' });
        break;
      case 'skipped':
        out.push({ label: portrait ? 'Skipped' : 'Dupes skipped', value: m.skipped });
        break;
      case 'lost':
        out.push({ label: portrait ? 'Lost' : 'Lost jobs', value: m.lost, tone: m.lost > 0 ? 'bad' : undefined });
        break;
      case 'rejected':
        out.push({ label: portrait ? '503s' : 'Rejected (503)', value: m.rejected, tone: m.rejected > 0 ? 'bad' : undefined });
        break;
      case 'dlq':
        out.push({ label: 'In DLQ', value: sim.depth('dlq'), tone: sim.depth('dlq') > 0 ? 'warn' : undefined });
        break;
      case 'workers':
        out.push({ label: 'Workers', value: sim.liveWorkers() });
        break;
      case 'stale':
        out.push({ label: portrait ? 'Stale' : 'Stale writes', value: m.wrongOrder, tone: m.wrongOrder > 0 ? 'bad' : undefined });
        break;
      case 'lag':
        out.push({ label: portrait ? 'Lag' : 'Lag · billing', value: sim.lag('billing'), spark: spark(m.depth.slice(-30)) });
        break;
      case 'lagA':
        if (sim.groups.has('analytics')) out.push({ label: portrait ? 'Lag · anl.' : 'Lag · analytics', value: sim.lag('analytics'), tone: 'warn' });
        break;
      case 'poison': {
        const q = sim.queues.get('q');
        const pm = q && [...q.visible, ...q.inflight].find((x) => x.poison);
        out.push({ label: portrait ? 'Poison tries' : 'Poison deliveries', value: m.poisonTries, tone: pm ? 'bad' : undefined });
        break;
      }
      case 'backlogs':
        out.push({
          label: 'Backlog per queue',
          value: '',
          wide: true,
          custom: (
            <div className={`${css.strip} ${css.mono}`} style={{ marginTop: 3, fontSize: 12.5, color: 'var(--text-1)' }}>
              {sim.cfg.subs.map((s) => {
                const d = sim.depth(`q:${s.id}`) + sim.inflightCount(`q:${s.id}`);
                return (
                  <span key={s.id}>
                    <span className={css.cDim}>{s.name}</span> <span className={d >= 5 ? css.cWarn : undefined}>{d}</span>
                  </span>
                );
              })}
            </div>
          ),
        });
        break;
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Readouts: the internal state you can't normally see                  */
/* ------------------------------------------------------------------ */

function phaseText(sim: MQSim, ph: Phase) {
  if (ph.state === 'ok') return `${fmt(ph.ms)} ms ✓`;
  if (ph.state === 'fail') return ph.note === 'timed out' ? `✕ ${fmt(ph.ms)} ms timeout` : ph.note === 'queue full' ? '✕ queue full' : '✕ refused';
  const live = clamp((sim.t - ph.t0) / Math.max(0.05, ph.dur), 0, 1) * ph.ms;
  return `${fmt(live)} ms …`;
}

function phaseMs(sim: MQSim, ph: Phase) {
  if (ph.state !== 'run') return ph.ms;
  return clamp((sim.t - ph.t0) / Math.max(0.05, ph.dur), 0, 1) * ph.ms;
}

function Waterfall({ sim, portrait }: { sim: MQSim; portrait: boolean }) {
  const req: SignupReq | null = sim.focus;
  const api = sim.boxes.get('api');
  if (!api || Number.isNaN(api.x)) return null;
  const sync = req ? req.mode === 'sync' : sim.cfg.mode === 'sync';
  const planned = sync ? [{ key: 'db', label: 'insert user' }, ...SERVICES.map((s) => ({ key: s.id, label: s.call }))] : [{ key: 'db', label: 'insert user' }, { key: 'send', label: 'queue.send' }];
  const users = sim.boxes.get('u:alice');
  const x = sync || !users ? api.x : Math.max(api.x, users.x + users.w / 2 + 150);
  const elapsed = req ? req.phases.reduce((s, ph) => s + phaseMs(sim, ph), 0) : 0;
  const name = req ? req.user.name : '';
  let foot: ReactNode = <span className={css.cDim}>waiting for a signup…</span>;
  if (req && req.status != null) {
    const ok = req.status < 400;
    foot = (
      <>
        {name} got <b data-tone={ok ? 'good' : 'bad'}>{req.status === 201 ? '201 Created' : `${req.status} error`}</b> after <b data-tone={ok ? (req.total ?? 0) > 300 ? undefined : 'good' : 'bad'}>{fmt(req.total ?? 0)} ms</b>
      </>
    );
  } else if (req) {
    foot = (
      <>
        {name} is waiting… <b>{fmt(elapsed)} ms</b>
      </>
    );
  }
  return (
    <Readout x={x} y={api.y + api.h / 2 + 16} anchor={portrait ? 'strip' : 'below'} head={req ? `POST /signup · ${req.user.email}` : 'POST /signup'} width={portrait ? undefined : 280}>
      <div className={css.wf}>
        {planned.map((p) => {
          const ph = req?.phases.find((x) => x.key === p.key);
          const ms = ph ? phaseMs(sim, ph) : 0;
          const state = ph ? ph.state : 'wait';
          return (
            <Fragment key={p.key}>
              <span className={css.wfLabel}>{p.label}</span>
              <span className={css.wfBar}>
                <i style={{ width: `${clamp(ms / 1000, ph ? 0.015 : 0, 1) * 100}%` }} data-state={state} />
              </span>
              <span className={css.wfVal} data-state={state}>
                {ph ? phaseText(sim, ph) : '—'}
              </span>
            </Fragment>
          );
        })}
      </div>
      <div className={css.foot}>{foot}</div>
    </Readout>
  );
}

/** The newest rows, but a duplicate always keeps its original charge in view. */
function ledgerRows(all: LedgerRow[], n: number) {
  let rows = all.slice(-n);
  for (let guard = 0; guard < n; guard++) {
    const dup = rows.find((r) => (r.kind === 'dup' || r.kind === 'skip') && !rows.some((x) => x.kind === 'ok' && x.order === r.order));
    const orig = dup && all.find((x) => x.kind === 'ok' && x.order === dup.order);
    if (!dup || !orig) break;
    // Drop the oldest other row, then put the original right above its repeat.
    const drop = rows.findIndex((x) => x !== dup);
    rows = rows.filter((_, i) => i !== drop);
    rows.splice(rows.indexOf(dup), 0, orig);
  }
  return rows;
}

function Ledger({ sim, portrait }: { sim: MQSim; portrait: boolean }) {
  const g = sim.queueGeo('q');
  if (!g) return null;
  const rows = ledgerRows(sim.ledger, portrait ? 3 : 5);
  const newest = sim.ledger[sim.ledger.length - 1];
  return (
    <Readout x={(g.left + g.right) / 2} y={g.bottom + 30} anchor={portrait ? 'strip' : 'below'} head="charges table" width={portrait ? undefined : 318}>
      {rows.length === 0 ? (
        <div className={css.cDim}>no charges yet</div>
      ) : (
        <div className={css.table}>
          {rows.map((r) => {
            const fresh = r === newest && sim.vt - r.vt < 1.2;
            const cls = r.kind === 'ok' ? css.cOk : r.kind === 'dup' ? css.cBad : r.kind === 'skip' ? css.cHc : css.cWarn;
            const text = r.kind === 'ok' ? '✓ charged' : r.kind === 'dup' ? '✕ charged AGAIN' : r.kind === 'skip' ? 'dupe → no-op' : 'lost: never charged';
            return (
              <Fragment key={`${r.order}-${r.vt}`}>
                <span className={fresh ? css.rowNew : undefined}>order {r.order}</span>
                <span className={css.cDim}>{userOf(r.user).name.toLowerCase()}</span>
                <span className={r.kind === 'dup' ? css.cBad : undefined}>${r.amount}</span>
                <span className={cls}>{text}</span>
              </Fragment>
            );
          })}
        </div>
      )}
      <div className={css.foot}>
        {sim.m.dupes > 0 ? (
          <>
            <b data-tone="bad">{sim.m.dupes} double charge{sim.m.dupes > 1 ? 's' : ''}</b> · {sim.m.charges} charges
          </>
        ) : sim.m.lost > 0 ? (
          <>
            <b data-tone="bad">{sim.m.lost} lost</b> · never charged
          </>
        ) : (
          <>
            <b data-tone="good">0 double charges</b> · {sim.m.charges} charges{sim.m.skipped ? ` · ${sim.m.skipped} dupes skipped` : ''}
          </>
        )}
      </div>
    </Readout>
  );
}

function Plans({ sim, portrait }: { sim: MQSim; portrait: boolean }) {
  const g = sim.queueGeo('q');
  if (!g) return null;
  const rows = [...sim.plans.values()].slice(portrait ? -3 : -4);
  return (
    <Readout x={(g.left + g.right) / 2} y={g.bottom + 30} anchor={portrait ? 'strip' : 'below'} head="users table · plan column" width={portrait ? undefined : 318}>
      {rows.length === 0 ? (
        <div className={css.cDim}>no plan changes yet</div>
      ) : (
        <div className={css.table}>
          {rows.map((r) => {
            const u = userOf(r.user);
            const status = r.pending > 0 ? (
              <span className={css.cDim}>{r.pending} update{r.pending > 1 ? 's' : ''} in the queue…</span>
            ) : r.stale ? (
              <span className={css.cBad}>✕ stale (newest: {r.latest})</span>
            ) : (
              <span className={css.cOk}>✓ matches newest</span>
            );
            return (
              <Fragment key={r.user}>
                <span style={{ color: u.color }}>{u.name.toLowerCase()}</span>
                <span className={css.cDim}>plan =</span>
                <span className={r.stale && r.pending === 0 ? css.cBad : undefined}>{r.plan ?? '—'}</span>
                {status}
              </Fragment>
            );
          })}
        </div>
      )}
      <div className={css.foot}>
        {sim.m.wrongOrder > 0 ? (
          <>
            <b data-tone="bad">{sim.m.wrongOrder} stale write{sim.m.wrongOrder > 1 ? 's' : ''}</b>: an older event landed last
          </>
        ) : (
          <>whichever write lands last wins</>
        )}
      </div>
    </Readout>
  );
}

function HashCard({ sim, portrait }: { sim: MQSim; portrait: boolean }) {
  const api = sim.boxes.get('api');
  const h = sim.hash;
  if (!api || Number.isNaN(api.x)) return null;
  return (
    <Readout x={Math.max(api.x, 126)} y={api.y + api.h / 2 + 18} anchor={portrait ? 'strip' : 'below'} head="partitioner" width={portrait ? undefined : 228}>
      {h ? (
        <>
          <div className={css.mono}>
            <span style={{ color: h.color }}>{h.label}</span> <span className={css.cDim}>key</span> &apos;{h.key}&apos;
          </div>
          <div className={css.mono}>
            <span className={css.cDim}>hash(&apos;{h.key}&apos;) =</span> {h.hash}
          </div>
          <div className={css.foot}>
            {h.hash} mod {h.n} = {h.asking ? <b>?</b> : <b>P{h.p}</b>}
          </div>
        </>
      ) : (
        <div className={css.cDim}>waiting for an event…</div>
      )}
    </Readout>
  );
}

function Offsets({ sim, portrait }: { sim: MQSim; portrait: boolean }) {
  const p0 = sim.partGeo(0);
  const pl = sim.partGeo(sim.cfg.partitions - 1);
  if (!p0 || !pl) return null;
  const groups = [...sim.groups.values()];
  return (
    <Readout x={(p0.left + p0.right) / 2} y={pl.bottom + 18} anchor={portrait ? 'strip' : 'below'} head="committed offsets (next to read)" width={portrait ? undefined : 300}>
      <div className={css.table} style={{ gridTemplateColumns: 'auto 1fr auto' }}>
        {groups.map((g) => (
          <Fragment key={g.id}>
            <span style={{ color: g.color }}>{g.id}</span>
            <span>{g.committed.map((o, i) => `P${i}:${o}`).join('  ')}</span>
            <span className={sim.lag(g.id) > 3 ? css.cWarn : css.cDim}>lag {sim.lag(g.id)}</span>
          </Fragment>
        ))}
      </div>
    </Readout>
  );
}

/* ------------------------------------------------------------------ */
/* Follow one message: an inspector card that rides along              */
/* ------------------------------------------------------------------ */

function tourSpec(sim: MQSim): { head: string; lines: InspectorLine[]; tone?: 'req' | 'res' | 'err'; note?: ReactNode; progress?: number } | null {
  const t = sim.tour;
  const msg = t?.msg;
  if (!t || !msg) return null;
  const id = `#${msg.label}`;
  const vis = sim.cfg.visibility;
  const handle = `AQEB${(msg.id * 7919).toString(36).toUpperCase()}…`;
  switch (t.stage) {
    case 'send':
      return {
        head: `SendMessage → ${sim.cfg.queue}`,
        lines: ['type    UserSignedUp', `userId  ${4100 + msg.id}`, 'email   alice@example.com'],
        note: 'The API hands the job over and answers Alice.',
      };
    case 'stored':
      return {
        head: `${id} · stored · ready`,
        lines: [`MessageId     9f3c…${String(msg.id).padStart(4, '0')}`, 'ReceiveCount  0', { t: 'state         ready', kind: 'strong' }],
        note: 'Safely stored. It waits until a worker asks for work.',
      };
    case 'fetch':
      return {
        head: `ReceiveMessage → worker-1`,
        lines: [`ReceiptHandle ${handle}`, { t: 'ReceiveCount  1', kind: 'change' }, { t: `hidden for     ${vis} s`, kind: 'change' }],
        note: 'Receiving does not delete it. The queue hides it and starts a timer.',
      };
    case 'hidden': {
      const left = Math.max(0, msg.visibleAt - sim.t);
      return {
        head: `${id} · in flight · invisible`,
        lines: ['ReceiveCount  1', { t: `visible again in ${left.toFixed(1)} s`, kind: 'strong' }, { t: 'unless worker-1 deletes it first', kind: 'dim' }],
        progress: clamp(left / vis, 0, 1),
      };
    }
    case 'delete':
      return {
        head: `DeleteMessage · ${id}`,
        tone: 'res',
        lines: [`ReceiptHandle ${handle}`, { t: 'email ✓  thumbnail ✓  analytics ✓', kind: 'add' }],
        note: 'This delete is the acknowledgment: “done, forget it”.',
      };
    case 'gone':
      return { head: `${id} · deleted`, tone: 'res', lines: [{ t: 'gone for good', kind: 'add' }], note: 'No worker will ever receive it again.' };
    default:
      return null;
  }
}

function TourCard({ sim, portrait }: { sim: MQSim; portrait: boolean }) {
  const t = sim.tour;
  const spec = tourSpec(sim);
  if (!t || !t.msg || !spec) return null;
  if (portrait) {
    return (
      <Readout anchor="strip" head={spec.head}>
        {spec.lines.map((l, i) => {
          if (l === 'rule') return null;
          const line = typeof l === 'string' ? { t: l } : l;
          const cls = line.kind === 'change' ? css.cWarn : line.kind === 'add' ? css.cOk : line.kind === 'dim' ? css.cDim : undefined;
          return (
            <div key={i} className={cls}>
              {line.t}
            </div>
          );
        })}
        {spec.note && <div className={`${css.foot} ${css.wrap}`}>{spec.note}</div>}
      </Readout>
    );
  }
  let x = t.msg.x;
  let y = t.msg.y;
  if (t.stage === 'send' || t.stage === 'fetch' || t.stage === 'delete') {
    const f = sim.flightViews().find((v) => v.id === t.flight);
    if (f) {
      x = f.x;
      y = f.y;
    }
  } else if (t.stage === 'gone') {
    x = t.x;
    y = t.y;
  }
  const g = sim.queueGeo('q');
  if (g && y > g.top - 8 && y < g.bottom + 8) y = g.top;
  return <InspectorCard key={t.stage} x={x} y={y - 16} stageW={sim.w} head={spec.head} lines={spec.lines} tone={spec.tone} note={spec.note} progress={spec.progress} />;
}

/* ------------------------------------------------------------------ */
/* Predict prompt on the stage                                         */
/* ------------------------------------------------------------------ */

function Prompt({ sim }: { sim: MQSim }) {
  const q = sim.game?.pending;
  if (!q || !q.ask) return null;
  let x = sim.w / 2;
  let y = 100;
  const at = q.askAt;
  if (at && 'id' in at) {
    const b = sim.boxes.get(at.id);
    if (b) {
      x = b.x;
      y = b.y - b.h / 2 - 22;
    }
  } else if (at) {
    x = at.x;
    y = at.y;
  }
  return (
    <StagePrompt x={clamp(x, 120, sim.w - 120)} y={Math.max(y, 40)}>
      {q.ask}
    </StagePrompt>
  );
}

/* ------------------------------------------------------------------ */

export function Overlay({ sim, step, stepKey }: { sim: MQSim; step: Step; stepKey: string }) {
  const portrait = sim.orient === 'portrait';
  const kind = sim.cfg.readout;
  const strip = portrait && kind !== 'none';
  const callouts = (portrait ? (step.pCallouts ?? step.callouts) : step.callouts) ?? [];
  return (
    <>
      <Hud items={hudItems(sim, step.hud ?? [], portrait)} />
      {kind === 'waterfall' && <Waterfall sim={sim} portrait={portrait} />}
      {kind === 'ledger' && <Ledger sim={sim} portrait={portrait} />}
      {kind === 'plans' && <Plans sim={sim} portrait={portrait} />}
      {kind === 'hash' && <HashCard sim={sim} portrait={portrait} />}
      {kind === 'offsets' && <Offsets sim={sim} portrait={portrait} />}
      {kind === 'tour' && <TourCard sim={sim} portrait={portrait} />}
      <Prompt sim={sim} />
      {!strip && <Legend items={step.legend ?? []} />}
      <Callouts sim={sim} callouts={callouts} stepKey={stepKey} resolve={(t) => sim.rectOf(t)} />
    </>
  );
}
