'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { CodeBlock } from '@/components/lesson/CodeBlock';
import { Icon } from '@/components/lesson/Icon';
import { usePoll } from '@/components/lesson/usePoll';
import { toMs, type ReplConfig, type ReplSim } from './sim';
import css from './replication.module.css';

type ModeId = 'async' | 'one' | 'backup' | 'any';

/** Commit modes. Like Patroni's synchronous mode, names follow whoever the followers are right now. */
const MODES: { id: ModeId; label: string; sub: (s: ReplSim) => string }[] = [
  { id: 'async', label: 'Async', sub: () => 'no standby waits' },
  { id: 'one', label: 'Sync to one', sub: (s) => `FIRST 1 (${names(s, 'one').join(', ')})` },
  { id: 'backup', label: 'Sync + backup', sub: (s) => `FIRST 1 (${names(s, 'backup').join(', ')})` },
  { id: 'any', label: 'Quorum', sub: (s) => `ANY 1 (${names(s, 'any').join(', ')})` },
];

function names(s: ReplSim, mode: ModeId): string[] {
  const fs = s.followers().map((f) => f.id);
  if (mode === 'one') return fs.slice(0, 1);
  if (mode === 'backup') return fs.slice(0, 2);
  return fs;
}

function applyMode(s: ReplSim, mode: ModeId) {
  if (mode === 'async') s.setSync(false);
  else s.setSync(true, names(s, mode), mode === 'any' ? 'any' : 'first');
}

interface Mission {
  id: string;
  title: string;
  text: string;
  hint: string;
  hold: number;
  check: (s: ReplSim) => boolean;
}

const MISSIONS: Mission[] = [
  {
    id: 'reads',
    title: 'Read-heavy',
    text: 'Serve at least 8 reads per second with p95 reads under 80 ms, for 10 seconds.',
    hint: 'Hint: one machine can’t do it alone. Where do the reads go?',
    hold: 10,
    check: (s) => {
      const p = s.p95(s.m.readLat);
      return s.rate(s.m.readT) >= 7.5 && p != null && toMs(p) < 80;
    },
  },
  {
    id: 'zero-loss',
    title: 'Zero-loss failover',
    text: 'Crash the leader while writing at least 1 per second, and lose no confirmed writes.',
    hint: 'Hint: pick a sync mode before you pull the plug. Lost some? Reset and try again.',
    hold: 1.5,
    check: (s) => s.term > 1 && s.m.lost === 0 && s.cfg.writeRate >= 1 && s.m.commits > 4,
  },
  {
    id: 'keep-writing',
    title: 'Sync, and still writing',
    text: 'With a sync mode on and its first-choice follower crashed, keep committing for 8 seconds.',
    hint: 'Hint: give the sync follower a backup, or wait for any one of them.',
    hold: 8,
    check: (s) => {
      if (!s.cfg.sync || !s.cfg.syncNames.length) return false;
      const first = s.dbs.get(s.cfg.syncNames[0]);
      return !!first && !first.up && s.rate(s.m.commitT) >= 0.5;
    },
  },
];

function Range({ label, value, min, max, step, format, onChange }: { label: string; value: number; min: number; max: number; step: number; format: (v: number) => string; onChange: (v: number) => void }) {
  return (
    <>
      <div className={css.pgLabel}>
        {label} <output>{format(value)}</output>
      </div>
      <input
        className={css.range}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ '--fill': `${((value - min) / (max - min)) * 100}%` } as CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
      />
    </>
  );
}

export function Playground({ sim, initial }: { sim: ReplSim; initial: ReplConfig }) {
  usePoll(sim, 250);
  const [writes, setWrites] = useState(initial.writeRate);
  const [reads, setReads] = useState(initial.readRate);
  const [delay, setDelay] = useState(initial.delays.db4 ?? 0);
  const [mode, setMode] = useState<ModeId>('async');
  const [held, setHeld] = useState<Record<string, number>>({});
  const lastT = useRef<number | null>(null);
  const followerKey = sim
    .followers()
    .map((f) => f.id)
    .join(',');

  // When the set of followers changes (a failover, an old leader rejoining),
  // re-point the sync list at the current followers, like Patroni would.
  useEffect(() => {
    if (mode !== 'async') applyMode(sim, mode);
  }, [sim, mode, followerKey]);

  useEffect(() => {
    const id = window.setInterval(() => {
      const t = sim.t;
      const dt = lastT.current == null ? 0 : Math.max(0, t - lastT.current);
      lastT.current = t;
      setHeld((prev) => {
        const next = { ...prev };
        for (const m of MISSIONS) {
          if ((prev[m.id] ?? 0) >= m.hold) continue;
          next[m.id] = m.check(sim) ? (prev[m.id] ?? 0) + dt : 0;
        }
        return next;
      });
    }, 250);
    return () => window.clearInterval(id);
  }, [sim]);

  const L = sim.leader();
  const cfg = sim.cfg;
  const followers = sim.followers();
  const readTo = cfg.readFrom === 'leader' ? L?.label ?? 'the leader' : followers.filter((f) => f.up).map((f) => f.label).join(', ') || 'the leader';
  const config = [
    `# postgresql.conf on the leader (${L?.label ?? 'none!'})`,
    `!synchronous_commit = on`,
    cfg.sync ? `!synchronous_standby_names = '${cfg.syncMethod === 'any' ? 'ANY' : 'FIRST'} 1 (${cfg.syncNames.join(', ')})'` : `!synchronous_standby_names = ''   # async`,
    '',
    '# the app',
    `#   writes → ${L?.label ?? 'nobody'}${L ? ` (${L.ip})` : ''}`,
    `#   reads  → ${readTo}`,
    '',
    '# failover manager',
    `#   automatic failover: ${cfg.failover === 'off' ? 'off' : 'on'} · fencing: ${cfg.fencing ? 'on' : 'off'}`,
  ].join('\n');

  return (
    <div className={css.pg}>
      <div className={css.pgGroup}>
        <Range
          label="Writes"
          value={writes}
          min={0.2}
          max={3}
          step={0.1}
          format={(v) => `${v.toFixed(1)} /s`}
          onChange={(v) => {
            setWrites(v);
            sim.setWriteRate(v);
          }}
        />
        <Range
          label="Reads"
          value={reads}
          min={0}
          max={14}
          step={0.5}
          format={(v) => `${v.toFixed(1)} /s`}
          onChange={(v) => {
            setReads(v);
            sim.setReadRate(v);
          }}
        />
        <Range
          label="Network delay to db-4"
          value={delay}
          min={0}
          max={5}
          step={0.25}
          format={(v) => `+${toMs(v)} ms`}
          onChange={(v) => {
            setDelay(v);
            sim.setDelay('db4', v);
          }}
        />
      </div>

      <div className={css.pgGroup}>
        <div className={css.pgLabel}>Commit waits for</div>
        <div className={css.choices}>
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              className={css.choice}
              aria-pressed={mode === m.id}
              onClick={() => {
                setMode(m.id);
                applyMode(sim, m.id);
              }}
            >
              {m.label}
              <small>{m.sub(sim)}</small>
            </button>
          ))}
        </div>
        <div className={css.pgLabel} style={{ marginTop: 14 }}>
          Reads go to
        </div>
        <div className={css.choices}>
          {(['leader', 'followers'] as const).map((r) => (
            <button key={r} type="button" className={css.choice} aria-pressed={cfg.readFrom === r} onClick={() => sim.setReadFrom(r)}>
              {r === 'leader' ? 'The leader' : 'The followers'}
            </button>
          ))}
        </div>
      </div>

      <div className={css.pgGroup}>
        <div className={css.pgLabel}>
          Databases <output>click to crash or revive</output>
        </div>
        <div className={css.nodes}>
          {sim.order.map((id) => {
            const d = sim.dbs.get(id);
            if (!d) return null;
            const lead = d.role === 'leader' && d.id === sim.leaderId;
            const meta = !d.up
              ? 'down'
              : lead
                ? `leader · #${d.head}`
                : d.role === 'leader'
                  ? `stale leader · #${d.head}`
                  : `${cfg.sync ? sim.syncStateOf(d) : 'follower'} · #${d.applied} · ${toMs(sim.lagView(d.id))} ms`;
            return (
              <button key={id} type="button" className={css.nodeRow} onClick={() => sim.toggleDb(id)}>
                <span className={css.led} data-down={!d.up} />
                {d.label}
                <span className={css.nodeMeta} data-lead={lead}>
                  {meta}
                </span>
              </button>
            );
          })}
        </div>
        <div className={css.btnRow}>
          <button type="button" className={`${css.btn} ${css.btnHot}`} onClick={() => sim.crashLeader()}>
            <Icon name="power" size={14} /> Crash the leader
          </button>
          <button type="button" className={css.btn} onClick={() => sim.reviveDown()}>
            <Icon name="replay" size={14} /> Revive all
          </button>
          <button
            type="button"
            className={css.btn}
            onClick={() => {
              sim.restart();
              if (mode !== 'async') applyMode(sim, mode);
              setHeld({});
            }}
          >
            <Icon name="replay" size={14} /> Reset
          </button>
        </div>
      </div>

      <div className={css.pgGroup}>
        <label className={css.switch}>
          <span>
            Automatic failover
            <small>Promote the most up-to-date follower after 3 missed heartbeats</small>
          </span>
          <input type="checkbox" checked={cfg.failover !== 'off'} onChange={(e) => sim.setFailover(e.target.checked ? 'auto' : 'off')} />
        </label>
        <label className={css.switch}>
          <span>
            Fencing
            <small>A restarted old leader checks the term and steps down</small>
          </span>
          <input type="checkbox" checked={cfg.fencing} onChange={(e) => sim.setFencing(e.target.checked)} />
        </label>
      </div>

      <div className={css.pgGroup}>
        <div className={css.pgLabel}>Challenges</div>
        <div className={css.missions}>
          {MISSIONS.map((m) => {
            const h = held[m.id] ?? 0;
            const done = h >= m.hold;
            return (
              <div key={m.id} className={css.mission} data-done={done}>
                <div className={css.missionTitle}>
                  {done && <Icon name="check" size={15} />}
                  {m.title}
                </div>
                <div className={css.missionText}>{m.text}</div>
                {!done && <div className={css.missionHint}>{m.hint}</div>}
                <div className={css.meter}>
                  <i style={{ width: `${Math.min(100, (h / m.hold) * 100)}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <CodeBlock spec={{ title: 'your cluster · live', lang: 'conf', code: config }} />
    </div>
  );
}
