'use client';

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { CodeBlock } from '@/components/lesson/CodeBlock';
import { Icon } from '@/components/lesson/Icon';
import { usePoll } from '@/components/lesson/usePoll';
import cards from '@/components/lesson/cards.module.css';
import { POLICY_NAMES, type Policy } from '../cache';
import { HOT, keyName } from '../products';
import type { CacheConfig, CacheSim } from '../sim';
import { redisConf } from './redisConf';

interface Mission {
  id: string;
  title: string;
  text: string;
  hint: string;
  /** Seconds the condition must hold; 0 = happens once */
  hold: number;
  check: (s: CacheSim) => boolean;
}

const MISSIONS: Mission[] = [
  {
    id: 'offload',
    title: 'Take the load off',
    text: 'At 4 req/s or more, keep the database under 30% load for 10 seconds.',
    hint: 'Hint: more room, and keys that live longer.',
    hold: 10,
    check: (s) => s.cfg.rps >= 4 && s.hitRatio != null && s.dbLoad < 0.3,
  },
  {
    id: 'fresh',
    title: 'Fresh and fast',
    text: 'With price changes on, keep stale reads under 5% and hits at 70% or more, for 10 seconds.',
    hint: 'Hint: what should a write do to the cached copy? Then give the cache time to warm up.',
    hold: 10,
    check: (s) => s.cfg.admin && s.staleRate != null && s.staleRate < 0.05 && (s.hitRatio ?? 0) >= 0.7,
  },
  {
    id: 'herd',
    title: 'Herd immunity',
    text: `At 4 req/s or more, expire ${keyName(HOT)} and let it cost only one database query.`,
    hint: 'Hint: one of the switches stops misses piling up.',
    hold: 0,
    check: (s) => s.lastHerd != null && s.lastHerd.rps >= 4 && s.lastHerd.queries <= 1,
  },
];

const POLICIES: Policy[] = ['lru', 'lfu', 'fifo'];

/** Products the playground's traffic touches (its config sets keys to match). */
export const KEYS = 12;

function Range({ label, value, min, max, step, format, onChange }: { label: string; value: number; min: number; max: number; step: number; format: (v: number) => ReactNode; onChange: (v: number) => void }) {
  return (
    <>
      <div className={cards.pgLabel} style={{ marginTop: 10 }}>
        {label} <output>{format(value)}</output>
      </div>
      <input
        className={cards.range}
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

export function Playground({ sim, initial }: { sim: CacheSim; initial: CacheConfig }) {
  usePoll(sim, 250);
  const [rps, setRps] = useState(initial.rps);
  const [skew, setSkew] = useState(initial.skew);
  const [slots, setSlots] = useState(initial.slots);
  const [ttl, setTtl] = useState(initial.ttl);
  // Switches keep their own state so they flip on click, not on the next poll.
  const [policy, setPolicy] = useState(initial.policy);
  const [writes, setWrites] = useState(initial.admin);
  const [delOnWrite, setDelOnWrite] = useState(initial.writeMode === 'around');
  const [coalesce, setCoalesce] = useState(initial.coalesce);
  const [held, setHeld] = useState<Record<string, number>>({});
  const lastT = useRef<number | null>(null);

  // How long each challenge's condition has held, in simulated seconds.
  useEffect(() => {
    const id = window.setInterval(() => {
      const t = sim.t;
      const dt = lastT.current == null ? 0 : Math.max(0, t - lastT.current);
      lastT.current = t;
      setHeld((prev) => {
        const next = { ...prev };
        for (const m of MISSIONS) {
          const need = Math.max(m.hold, 0.001);
          if ((prev[m.id] ?? 0) >= need) continue;
          if (m.hold === 0) next[m.id] = m.check(sim) ? need : 0;
          else next[m.id] = m.check(sim) ? (prev[m.id] ?? 0) + dt : 0;
        }
        return next;
      });
    }, 250);
    return () => window.clearInterval(id);
  }, [sim]);

  const cfg = sim.cfg;

  return (
    <div className={cards.pg}>
      <div className={cards.pgGroup}>
        <Range
          label="Traffic"
          value={rps}
          min={0.5}
          max={8}
          step={0.5}
          format={(v) => `${v.toFixed(1)} req/s`}
          onChange={(v) => {
            setRps(v);
            sim.setRps(v);
          }}
        />
        <Range
          label="Popularity skew"
          value={skew}
          min={0}
          max={1.6}
          step={0.1}
          format={(v) => (v === 0 ? 'all equal' : v < 0.8 ? `${v.toFixed(1)} · mild` : v < 1.3 ? `${v.toFixed(1)} · typical` : `${v.toFixed(1)} · extreme`)}
          onChange={(v) => {
            setSkew(v);
            sim.setSkew(v);
          }}
        />
      </div>

      <div className={cards.pgGroup}>
        <Range
          label="Cache size"
          value={slots}
          min={1}
          max={12}
          step={1}
          format={(v) => `${v} of ${KEYS} keys`}
          onChange={(v) => {
            setSlots(v);
            sim.setSlots(v);
          }}
        />
        <Range
          label="TTL"
          value={ttl}
          min={0}
          max={60}
          step={1}
          format={(v) => (v === 0 ? 'never expires' : `${v} s`)}
          onChange={(v) => {
            setTtl(v);
            sim.setTtl(v);
          }}
        />
        <div className={cards.pgLabel} style={{ marginTop: 12 }}>
          Eviction policy
        </div>
        <div className={cards.algos} style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
          {POLICIES.map((p) => (
            <button
              key={p}
              type="button"
              className={cards.algo}
              aria-pressed={policy === p}
              onClick={() => {
                setPolicy(p);
                sim.setPolicy(p);
              }}
            >
              {POLICY_NAMES[p]}
            </button>
          ))}
        </div>
      </div>

      <div className={cards.pgGroup} style={{ display: 'grid', gap: 12 }}>
        <label className={cards.switch}>
          <span>
            Price changes
            <small>Dave updates a price every 3 seconds</small>
          </span>
          <input
            type="checkbox"
            checked={writes}
            onChange={(e) => {
              setWrites(e.target.checked);
              sim.setWrites(e.target.checked);
            }}
          />
        </label>
        <label className={cards.switch}>
          <span>
            Delete the key on write
            <small>UPDATE, then DEL product:N</small>
          </span>
          <input
            type="checkbox"
            checked={delOnWrite}
            onChange={(e) => {
              setDelOnWrite(e.target.checked);
              sim.setWriteMode(e.target.checked ? 'around' : 'none');
            }}
          />
        </label>
        <label className={cards.switch}>
          <span>
            Request coalescing
            <small>One query per key; other misses wait for it</small>
          </span>
          <input
            type="checkbox"
            checked={coalesce}
            onChange={(e) => {
              setCoalesce(e.target.checked);
              sim.setCoalesce(e.target.checked);
            }}
          />
        </label>
        <div className={cards.row} style={{ marginTop: 0 }}>
          <button type="button" className={`${cards.btn} ${cards.btnHot}`} onClick={() => sim.expireNow(HOT)}>
            <Icon name="bolt" size={14} /> Expire {keyName(HOT)}
          </button>
          <button type="button" className={cards.btn} onClick={() => sim.crashCache()}>
            <Icon name="power" size={14} /> Restart Redis
          </button>
        </div>
      </div>

      <div className={cards.pgGroup}>
        <div className={cards.pgLabel}>Challenges</div>
        <div className={cards.missions}>
          {MISSIONS.map((m) => {
            const h = held[m.id] ?? 0;
            const need = Math.max(m.hold, 0.001);
            const done = h >= need;
            return (
              <div key={m.id} className={cards.mission} data-done={done}>
                <div className={cards.missionTitle}>
                  {done && <Icon name="check" size={15} />}
                  {m.title}
                </div>
                <div className={cards.missionText}>{m.text}</div>
                {!done && <div className={cards.missionHint}>{m.hint}</div>}
                {m.hold > 0 && (
                  <div className={cards.meter}>
                    <i style={{ width: `${Math.min(100, (h / need) * 100)}%` }} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <CodeBlock spec={{ title: 'your settings · live', lang: 'conf', code: redisConf(cfg) }} />
    </div>
  );
}
