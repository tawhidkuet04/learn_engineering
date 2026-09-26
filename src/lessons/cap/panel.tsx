'use client';

import { useState, type CSSProperties, type ReactNode } from 'react';
import kit from '@/components/lesson/cards.module.css';
import { Icon, type IconName } from '@/components/lesson/Icon';
import { lessonCss } from '@/components/lesson/Prose';
import { usePoll } from '@/components/lesson/usePoll';
import { PEOPLE, REGION, type ClientId } from './model';
import type { CapSim } from './sim';
import css from './cap.module.css';

function Kicker({ icon = 'bolt', children }: { icon?: IconName; children: ReactNode }) {
  return (
    <div className={lessonCss.cardKicker}>
      <Icon name={icon} size={13} /> {children}
    </div>
  );
}

function Range({ label, value, min, max, onChange, format }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void; format?: (v: number) => string }) {
  const fill = max > min ? ((value - min) / (max - min)) * 100 : 100;
  return (
    <div>
      <div className={kit.sliderHead}>
        <span>{label}</span>
        <output>{format ? format(value) : value}</output>
      </div>
      <input
        className={kit.range}
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        style={{ '--fill': `${fill}%` } as CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */

/** N, W and R sliders with a live verdict. R and W can never exceed N. */
export function QuorumCard({ sim, initial }: { sim: CapSim; initial: { n: number; r: number; w: number } }) {
  usePoll(sim, 250);
  const [v, setV] = useState(initial);
  const set = (patch: Partial<typeof v>) => {
    const n = patch.n ?? v.n;
    const next = { n, r: Math.min(patch.r ?? v.r, n), w: Math.min(patch.w ?? v.w, n) };
    setV(next);
    sim.update(next);
  };
  const { n, r, w } = v;
  const ok = r + w > n;
  const q = sim.quorum;
  return (
    <div className={lessonCss.card}>
      <Kicker>Try it</Kicker>
      <p className={lessonCss.cardQ}>Set the replicas and quorums. Can you make Bob read stale data? Can you make it impossible?</p>
      <Range label="N · replicas" value={n} min={3} max={5} onChange={(x) => set({ n: x })} />
      <Range label="W · acks a write waits for" value={w} min={1} max={n} onChange={(x) => set({ w: x })} />
      <Range label="R · replicas a read asks" value={r} min={1} max={n} onChange={(x) => set({ r: x })} />
      <div className={css.verdict} data-ok={ok}>
        <strong>{ok ? 'Overlap guaranteed.' : 'May read stale.'}</strong>
        <span className={css.formula}>
          R + W = {r + w} {ok ? '>' : '≤'} N = {n}
        </span>
        <br />
        {ok
          ? 'Every read set shares at least one replica with every write set.'
          : 'A read can land entirely on replicas the write has not reached yet.'}
      </div>
      <div className={kit.stats}>
        <span>
          writes survive <b>{n - w}</b> down
        </span>
        <span>
          reads survive <b>{n - r}</b> down
        </span>
        <span>
          stale reads <b data-bad={q.stale > 0}>{q.stale}</b> of {q.stale + q.fresh}
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

const MISSIONS: { id: 'oversold' | 'refused' | 'skewWin' | 'siblings'; title: string; text: string; hint: string }[] = [
  {
    id: 'oversold',
    title: 'Sell the last seat twice',
    text: 'Get two different people told “booked” for the last seat.',
    hint: 'Hint: AP, cut Virginia off, then book on both sides.',
  },
  {
    id: 'refused',
    title: 'Be refused on purpose',
    text: 'Get an error from a replica that can’t reach a majority.',
    hint: 'Hint: CP, cut the network, then ask Virginia.',
  },
  {
    id: 'skewWin',
    title: 'Let a clock pick the winner',
    text: 'Make last-write-wins keep the earlier of two bookings.',
    hint: 'Hint: AP + LWW, push Virginia’s clock ahead, Alice books before Bob, then heal.',
  },
  {
    id: 'siblings',
    title: 'Detect instead of guess',
    text: 'End up with two versions kept side by side after a heal.',
    hint: 'Hint: AP + version vectors, double-book, then heal.',
  },
];

export function Playground({ sim }: { sim: CapSim }) {
  usePoll(sim, 200);
  const cfg = sim.cfg;
  const cp = cfg.wq >= 2;
  const [skew, setSkew] = useState(cfg.skew);
  return (
    <div className={kit.pg}>
      <div className={kit.pgGroup}>
        <div className={kit.pgLabel}>
          During a partition <output>{cp ? 'CP' : 'AP'}</output>
        </div>
        <div className={css.segRow}>
          <button type="button" className={css.chip} aria-pressed={cp} onClick={() => sim.setMode('cp')}>
            CP · refuse when unsure
          </button>
          <button type="button" className={css.chip} aria-pressed={!cp} onClick={() => sim.setMode('ap')}>
            AP · always answer
          </button>
        </div>
      </div>

      <div className={kit.pgGroup}>
        <div className={kit.pgLabel}>
          Network <output>{sim.cut ? 'partitioned' : 'healthy'}</output>
        </div>
        <div className={css.segRow}>
          <button type="button" className={`${css.mini} ${css.miniHot}`} onClick={() => sim.toggleCut()}>
            {sim.cut ? 'Heal the network' : 'Cut Virginia off'}
          </button>
          <button type="button" className={css.mini} onClick={() => sim.newFlight()}>
            New flight · 1 seat left
          </button>
        </div>
        {(['alice', 'bob', 'carol'] as ClientId[]).map((c) => {
          const busy = sim.clients[c].busy;
          return (
            <div key={c} className={css.clientRow}>
              <span className={css.who} style={{ '--c': PEOPLE[c].color } as CSSProperties}>
                <i />
                {PEOPLE[c].name}
                <small>{REGION[PEOPLE[c].home].short}</small>
              </span>
              <button type="button" className={css.mini} disabled={busy} onClick={() => sim.userRequest(c, 'book')}>
                Book
              </button>
              <button type="button" className={css.mini} disabled={busy} onClick={() => sim.userRequest(c, 'read')}>
                Read
              </button>
            </div>
          );
        })}
      </div>

      <div className={kit.pgGroup}>
        <div className={kit.pgLabel}>
          When versions collide <output>{cfg.merge === 'lww' ? 'last write wins' : 'version vectors'}</output>
        </div>
        <div className={css.segRow}>
          <button type="button" className={css.chip} aria-pressed={cfg.merge === 'lww'} onClick={() => sim.update({ merge: 'lww' })}>
            Last write wins
          </button>
          <button type="button" className={css.chip} aria-pressed={cfg.merge === 'vv'} onClick={() => sim.update({ merge: 'vv' })}>
            Version vectors
          </button>
        </div>
        <div style={{ marginTop: 6 }}>
          <Range
            label="Virginia’s clock"
            value={skew}
            min={0}
            max={800}
            format={(x) => (x ? `+${x} ms fast` : 'accurate')}
            onChange={(x) => {
              const v = Math.round(x / 50) * 50;
              setSkew(v);
              sim.update({ skew: v });
            }}
          />
        </div>
      </div>

      <div className={kit.pgGroup}>
        <div className={kit.pgLabel}>Challenges</div>
        <div className={kit.missions}>
          {MISSIONS.map((m) => {
            const done = sim.flags[m.id];
            return (
              <div key={m.id} className={kit.mission} data-done={done}>
                <div className={kit.missionTitle}>
                  {done && <Icon name="check" size={15} />}
                  {m.title}
                </div>
                <div className={kit.missionText}>{m.text}</div>
                {!done && <div className={kit.missionHint}>{m.hint}</div>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

const ROWS: [string, string, string][] = [
  ['CP', 'Refuse when a majority can’t be reached', 'etcd, ZooKeeper, Consul, Spanner'],
  ['AP', 'Always answer; reconcile after the heal', 'Cassandra, DynamoDB, Riak, CouchDB'],
  ['Majority', '2f + 1 nodes survive f failures', '3 nodes → 1 down, 5 → 2 down'],
  ['Quorum', 'R + W > N: every read overlaps the latest write', 'N=3, W=2, R=2'],
  ['LWW', 'Highest timestamp wins, the rest vanish', 'Cassandra cells'],
  ['Version vectors', 'Detect concurrent writes, keep both', 'Riak, Dynamo'],
  ['PACELC', 'Else (no partition): latency or consistency', 'Cassandra PA/EL · etcd PC/EC'],
];

export function CheatSheet() {
  return (
    <>
      <table className={kit.table}>
        <thead>
          <tr>
            <th>Idea</th>
            <th>In one line</th>
            <th>Where you meet it</th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map(([a, b, c]) => (
            <tr key={a}>
              <td>{a}</td>
              <td>{b}</td>
              <td>{c}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className={kit.subhead}>Remember</p>
      <ul className={kit.takeaways}>
        <li>
          Partitions aren&apos;t optional. The real question is what each side does <strong>while</strong> it is cut off: refuse (C) or answer (A).
        </li>
        <li>
          CP systems keep the <strong>majority</strong> side working; only the minority side refuses.
        </li>
        <li>
          AP systems stay up but must <strong>reconcile</strong> afterwards. Last-write-wins silently drops writes; version vectors detect the clash.
        </li>
        <li>
          With <strong>R + W &gt; N</strong>, reads always overlap the latest write. Lower R or W for speed, and accept staleness.
        </li>
        <li>
          Even with a healthy network, stronger consistency costs <strong>latency</strong> (PACELC). Choose per operation: bookings and payments CP,
          feeds and carts AP.
        </li>
      </ul>
    </>
  );
}
