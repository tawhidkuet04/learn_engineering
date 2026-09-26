import type { CSSProperties, ReactNode } from 'react';
import { Hud, Legend, type HudItem } from '@/components/stage/chrome';
import { Callouts, RLine, RResult, Readout } from '@/components/stage/overlays';
import { clamp } from '@/lib/sim/geometry';
import { fmtClock, fmtVV, NODES, REGION, vvCompare, type Val } from './model';
import type { CapSim } from './sim';
import { Spectrum } from './Spectrum';
import type { HudKey, ReadoutKey, Step } from './types';
import css from './cap.module.css';

/** Everything HTML on top of the stage: live metrics, the readout panel, questions. */
export function StageOverlay({ sim, step, stepKey }: { sim: CapSim; step: Step; stepKey: string }) {
  const pending = sim.game?.pending;
  const portrait = sim.orient === 'portrait';
  const callouts = portrait && step.phoneCallouts ? step.phoneCallouts : step.callouts;
  return (
    <>
      {callouts && !pending && <Callouts sim={sim} callouts={callouts} stepKey={stepKey} resolve={(t) => resolveCallout(sim, t)} />}
      {step.hud && <Hud items={hudItems(sim, step.hud)} />}
      {step.readout && !(portrait && pending) && <StepReadout sim={sim} k={step.readout} />}
      {pending?.choices && <AskBox sim={sim} />}
      {sim.cfg.view === 'spectrum' && <Spectrum sim={sim} />}
      {step.legend && !hasStrip(sim, step) && <Legend items={step.legend} />}
    </>
  );
}

/** Callout targets that aren't boxes: the partition line. */
function resolveCallout(sim: CapSim, target: string) {
  if (target !== 'cut') return null;
  const L = sim.cutLine();
  if (!sim.cut || !L) return null;
  const p = sim.orient === 'portrait' ? { x: sim.w * 0.5, y: L.a.y } : { x: L.a.x + (L.b.x - L.a.x) * 0.12, y: L.a.y + (L.b.y - L.a.y) * 0.12 };
  return { x: p.x, y: p.y, w: 8, h: 8 };
}

/** Does this step show a readout docked at the bottom on phones? (Then the legend is hidden.) */
export const hasStrip = (sim: CapSim, step: Step) => sim.orient === 'portrait' && (!!step.readout || !!sim.game?.pending || sim.cfg.view === 'spectrum');

/* ------------------------------------------------------------------ */

function hudItems(sim: CapSim, keys: HudKey[]): HudItem[] {
  const s = sim.stats;
  const q = sim.quorum;
  const ms = (v: number | null) => (v == null ? '—' : Math.round(v));
  return keys.map((k): HudItem => {
    switch (k) {
      case 'agree':
        return { label: 'Replicas', value: sim.agree ? 'in sync' : 'differ', tone: sim.agree ? 'good' : 'warn' };
      case 'stale':
        return { label: 'Stale reads', value: s.stale, tone: s.stale ? 'warn' : undefined };
      case 'errors':
        return { label: 'Errors', value: s.errors, tone: s.errors ? 'bad' : undefined };
      case 'oversold':
        return { label: 'Last seat sold', value: `${sim.lastSeat.length}×`, tone: sim.flags.oversold ? 'bad' : sim.lastSeat.length ? 'good' : undefined };
      case 'wlat':
        return { label: 'Write latency', value: ms(s.lastWriteMs), unit: s.lastWriteMs == null ? undefined : 'ms' };
      case 'rlat':
        return { label: 'Read latency', value: ms(s.lastReadMs), unit: s.lastReadMs == null ? undefined : 'ms' };
      case 'dropped':
        return { label: 'Writes lost', value: s.dropped, tone: s.dropped ? 'bad' : undefined };
      case 'leader': {
        const l = sim.raft.leader;
        return { label: 'Leader', value: l ? `${REGION[l].short} · term ${sim.raft.nodes[l].term}` : 'none', tone: l ? 'good' : 'bad' };
      }
      case 'qwrite':
        return { label: 'Write waited', value: ms(q.wMs), unit: q.wMs == null ? undefined : 'ms' };
      case 'qread':
        return { label: 'Read waited', value: ms(q.rMs), unit: q.rMs == null ? undefined : 'ms' };
      case 'qstale':
        return { label: 'Stale reads', value: `${q.stale} of ${q.stale + q.fresh}`, tone: q.stale ? 'bad' : q.fresh ? 'good' : undefined };
      case 'anomalies':
        return { label: 'Reply before post', value: `${sim.feed.anomalies}×`, tone: sim.feed.anomalies ? 'bad' : undefined };
    }
  });
}

/* ------------------------------------------------------------------ */

function Panel({ sim, head, children, fresh }: { sim: CapSim; head: string; children: ReactNode; fresh?: boolean }) {
  if (sim.orient === 'portrait')
    return (
      <Readout anchor="strip" head={head} fresh={fresh}>
        {children}
      </Readout>
    );
  return (
    <Readout anchor="below" x={sim.w - 14 - 132} y={14} width={264} head={head} fresh={fresh}>
      {children}
    </Readout>
  );
}

const valLine = (v: Val) => `${v.seats} left · v${v.ver} · ${v.by ?? 'initial'}`;

function StepReadout({ sim, k }: { sim: CapSim; k: ReadoutKey }) {
  const portrait = sim.orient === 'portrait';
  switch (k) {
    case 'decision': {
      const d = sim.decision;
      const cp = sim.cfg.wq >= 2 || sim.cfg.rq >= 2;
      const fresh = !!d && sim.vt - d.vt < 0.6;
      return (
        <Panel sim={sim} head={d ? `${REGION[d.node].city} · ${d.kind === 'book' ? 'booking' : 'read'}` : 'how each replica decides'} fresh={fresh}>
          <RLine>{cp ? <>rule: <em>2 of 3</em> replicas must confirm</> : <>rule: answer from <em>its own copy</em></>}</RLine>
          {d && (
            <RLine dim>
              can reach {d.reach} of 3 · needs {d.need}
            </RLine>
          )}
          <RResult>{d ? <>→ <b>{d.outcome}</b></> : 'waiting for a request…'}</RResult>
        </Panel>
      );
    }
    case 'dilemma': {
      const va = sim.replicas.va.val;
      const res = sim.clients.alice.result;
      return (
        <Panel sim={sim} head="Virginia has to choose" fresh={!!sim.dilemma}>
          <RLine>
            its copy says <em>{va.seats} left</em> (v{va.ver})
          </RLine>
          <RLine dim>{portrait ? "can't check with FRA or SG" : "can't reach Frankfurt or Singapore to check"}</RLine>
          <RResult>{sim.dilemma ? <>answer anyway, or <b>refuse</b>?</> : res ? <>Alice got: <b>{res.text}</b></> : 'waiting for Alice…'}</RResult>
        </Panel>
      );
    }
    case 'cap': {
      const res = sim.clients.alice.result;
      return (
        <Panel sim={sim} head="CAP · during a partition">
          <div className={css.capGrid}>
            <span className={css.capLetter}>C</span>
            <span className={css.capText}>
              <b>Consistency</b>: {portrait ? 'reads see the latest write' : 'every read sees the latest write'}
            </span>
            <span className={css.capLetter}>A</span>
            <span className={css.capText}>
              <b>Availability</b>: {portrait ? 'every live replica answers' : 'every replica that is up answers'}
            </span>
            {!portrait && (
              <>
                <span className={`${css.capLetter} ${css.capOn}`}>P</span>
                <span className={css.capText}>
                  <b>Partition</b>: the split is not up to you
                </span>
              </>
            )}
          </div>
          <RResult>{res ? <>Alice just got: <b>{res.text}</b></> : portrait ? <>P isn&apos;t optional: pick <b>C or A</b></> : <>so pick <b>C or A</b></>}</RResult>
        </Panel>
      );
    }
    case 'raft': {
      const l = sim.raft.leader;
      const ev = sim.raft.event;
      return (
        <Panel sim={sim} head="etcd cluster · raft">
          <RLine>
            leader: <em>{l ? REGION[l].city : 'none'}</em>
            {l ? ` · term ${sim.raft.nodes[l].term}` : ''}
          </RLine>
          <RLine dim>a write commits once 2 of 3 have it</RLine>
          {ev && <RResult>{ev.text}</RResult>}
        </Panel>
      );
    }
    case 'tunable': {
      const cl = sim.cfg.wq === 1 ? 'ONE' : sim.cfg.wq === 2 ? 'QUORUM' : 'ALL';
      const res = sim.clients.carol.result;
      return (
        <Panel sim={sim} head="coordinator · Singapore">
          <RLine>
            CONSISTENCY <em>{cl}</em> → {sim.cfg.wq} of 3 acks
          </RLine>
          <RLine dim>replicas reachable: {sim.reach('sg')} of 3</RLine>
          <RResult>{res ? <>last write: <b>{res.tone === 'err' ? res.text : `${Math.round(sim.stats.lastWriteMs ?? 0)} ms`}</b></> : 'waiting for a write…'}</RResult>
        </Panel>
      );
    }
    case 'quorum': {
      const q = sim.quorum;
      const { n, w, r } = q;
      const ok = r + w > n;
      const asking = !!sim.game?.pending;
      return (
        <Panel sim={sim} head="quorum math">
          <RLine>
            N = <em>{n}</em> · W = <em>{w}</em>
            {r > 0 && (
              <>
                {' '}
                · R = <em>{r}</em>
              </>
            )}
          </RLine>
          {r > 0 ? (
            <RLine>
              R + W = {r + w}
              {asking ? `, N = ${n}` : ` ${ok ? '>' : '≤'} N = ${n}`}
            </RLine>
          ) : (
            <RLine dim>ok after W acks; the rest catch up</RLine>
          )}
          <RResult>
            {r === 0 ? (
              <>
                write returns after <b>{w} acks</b>
              </>
            ) : asking ? (
              <>
                do they overlap? <b>your call</b>
              </>
            ) : ok ? (
              <>
                <b>overlap guaranteed</b>: reads see it
              </>
            ) : (
              <>
                <b>may read stale</b>: the sets can miss
              </>
            )}
          </RResult>
        </Panel>
      );
    }
    case 'conflict':
    case 'vv': {
      const vv = k === 'vv';
      const lines = NODES.map((n) => {
        const R = sim.replicas[n];
        const vals = R.siblings.length ? R.siblings : [R.val];
        return { n, vals };
      });
      const distinct = new Map<number, Val>();
      for (const l of lines) for (const v of l.vals) distinct.set(v.id, v);
      const vs = [...distinct.values()].filter((v) => v.by);
      const conc = vs.length >= 2 && vvCompare(vs[0].vv, vs[1].vv) === 'concurrent';
      return (
        <Panel sim={sim} head={vv ? 'version vectors [VA, FRA, SG]' : 'what each replica holds'}>
          {vv
            ? vs.slice(0, 3).map((v) => (
                <RLine key={v.id}>
                  {v.by} v{v.ver} <em>{fmtVV(v.vv)}</em>
                </RLine>
              ))
            : lines.map((l) => (
                <RLine key={l.n}>
                  {REGION[l.n].short}: {l.vals.length > 1 ? <em>{l.vals.map((v) => v.by).join(' + ')}</em> : valLine(l.vals[0])}
                </RLine>
              ))}
          <RResult>
            {sim.agree ? (
              <>
                replicas <b>agree</b>
                {sim.flags.dropped ? ': one booking was lost' : ''}
              </>
            ) : conc ? (
              vv ? (
                <>
                  neither covers the other: <b>concurrent</b>
                </>
              ) : (
                <>
                  <b>two truths</b>: both are v{vs[0].ver}
                </>
              )
            ) : (
              <>
                versions <b>differ</b>
              </>
            )}
          </RResult>
        </Panel>
      );
    }
    case 'lww': {
      const d = sim.dropped;
      const skew = sim.cfg.skew;
      const va = sim.replicas.va.val;
      const fra = sim.replicas.fra.val;
      const t = (v: Val) => fmtClock(v.ts, !portrait);
      return (
        <Panel sim={sim} head={skew ? `last write wins · VA clock +${skew} ms` : 'last write wins'} fresh={!!d && sim.vt - d.vt < 0.6}>
          {d ? (
            <>
              <RLine>
                keeps <em>{d.winner.by}</em> @ {t(d.winner)}
              </RLine>
              <RLine dim>
                drops {d.loser.by} @ {t(d.loser)}
              </RLine>
              <RResult>{d.winner.real < d.loser.real ? <><b>the earlier booking won</b>: skewed clock</> : <><b>{d.loser.by}&apos;s booking</b> vanished, silently</>}</RResult>
            </>
          ) : (
            <>
              <RLine>
                VA: {va.by ?? 'initial'} @ {t(va)}
              </RLine>
              <RLine>
                FRA: {fra.by ?? 'initial'} @ {t(fra)}
              </RLine>
              <RResult>
                on conflict: keep the <b>higher timestamp</b>
              </RResult>
            </>
          )}
        </Panel>
      );
    }
    case 'pacelc': {
      const el = sim.cfg.wq === 1;
      const ms = sim.stats.lastWriteMs;
      const bob = sim.clients.bob.result;
      return (
        <Panel sim={sim} head="PACELC · no partition right now">
          <RLine>
            <em>P</em>artition → <em>A</em> or <em>C</em>
          </RLine>
          <RLine>
            <em>E</em>lse → <em>L</em>atency or <em>C</em>onsistency
          </RLine>
          <RResult>
            {el ? 'EL' : 'EC'} · write <b>{ms == null ? '…' : `${Math.round(ms)} ms`}</b>
            {bob ? ` · Bob ${bob.tone === 'stale' ? 'stale' : 'fresh'}` : ''}
          </RResult>
        </Panel>
      );
    }
    case 'feed': {
      const items = sim.feed.items.sg.map((p) => p.id);
      const held = sim.feed.held.sg.map((p) => p.id);
      return (
        <Panel sim={sim} head="Singapore's copy of the feed">
          <RLine>
            shows: <em>{items.length ? items.join(', ') : 'nothing yet'}</em>
            {held.length ? ` · holding ${held.join(', ')}` : ''}
          </RLine>
          <RResult>
            {sim.cfg.causal ? (
              <>
                <b>causal</b>: B waits for A
              </>
            ) : (
              <>
                <b>eventual</b>: shows whatever arrived
              </>
            )}
          </RResult>
        </Panel>
      );
    }
  }
}

/* ------------------------------------------------------------------ */

const PLACE: Record<string, 'above' | 'left'> = { va: 'above', fra: 'left', sg: 'above', qb: 'left' };

/** The question, with answer buttons, right on the stage. */
function AskBox({ sim }: { sim: CapSim }) {
  const g = sim.game;
  const q = g?.pending;
  if (!g || !q?.choices) return null;
  const id = q.askAt && 'id' in q.askAt ? q.askAt.id : null;
  const b = id ? sim.boxes.get(id) : null;
  const W = 268;
  let style: CSSProperties | undefined;
  let cls = css.ask;
  if (sim.orient === 'portrait' || !b || !id) cls = `${css.ask} ${css.askDock}`;
  else if ((PLACE[id] ?? 'above') === 'left') style = { left: Math.max(12, b.x - b.w / 2 - 18 - W), top: b.y, transform: 'translateY(-50%)' };
  else style = { left: clamp(b.x - W / 2, 12, sim.w - W - 12), top: b.y - b.h / 2 - 12, transform: 'translateY(-100%)' };
  return (
    <div className={cls} style={style}>
      <div className={css.askKicker}>your call · predict</div>
      <div className={css.askQ}>{q.ask}</div>
      <div className={css.askRow}>
        {q.choices.map((c) => (
          <button key={c.id} type="button" className={css.askBtn} onClick={() => g.answer(c.id)}>
            {c.label}
          </button>
        ))}
      </div>
    </div>
  );
}
