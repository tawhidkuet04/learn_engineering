'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { CodeBlock } from '@/components/lesson/CodeBlock';
import { Icon } from '@/components/lesson/Icon';
import { usePoll } from '@/components/lesson/usePoll';
import kit from '@/components/lesson/cards.module.css';
import type { ShardSim } from '../sim';
import css from '../sharding.module.css';

interface Mission {
  id: string;
  title: string;
  text: string;
  hint: string;
  hold: number;
  check: (s: ShardSim) => boolean;
}

const MISSIONS: Mission[] = [
  {
    id: 'even',
    title: 'Even keel',
    text: 'Push 12 or more writes/s with every shard under 90% load, for 10 seconds.',
    hint: 'Hint: pick a key that spreads writes, and enough shards to share them.',
    hold: 10,
    check: (s) => s.rate >= 12 && s.totalRate() > 9 && s.shardNodes().every((n) => n.shownLoad < 0.9),
  },
  {
    id: 'flash',
    title: 'Flash sale',
    text: 'Turn on the hot key at 8+ writes/s and go 10 seconds without a single timeout.',
    hint: 'Hint: a hot key can’t be split by the shard key alone. Salt it.',
    hold: 10,
    check: (s) => s.cfg.hot && s.rate >= 8 && s.sinceFail() > 0.6,
  },
  {
    id: 'growth',
    title: 'Cheap growth',
    text: 'Add a shard to a hash-sharded table while moving less than 25% of the rows.',
    hint: 'Hint: try adding a shard with mod N first. Then change the placement.',
    hold: 0.01,
    check: (s) => {
      const r = s.lastReshard;
      return !!r && r.rule === 'hash' && r.to > r.from && r.pct < 0.25;
    },
  },
];

const KEYS: { id: 'hash' | 'year' | 'country'; label: string; sub: string }[] = [
  { id: 'hash', label: 'customer_id · hashed', sub: 'many values, spread by a hash' },
  { id: 'year', label: 'created_at · range', sub: 'ranges of time, newest last' },
  { id: 'country', label: 'country · list', sub: '11 values, the US is 40%' },
];

function liveCode(s: ShardSim): string {
  const c = s.cfg;
  const n = c.shards;
  const lines: string[] = [];
  if (c.rule === 'hash' && c.hashMode === 'modn') {
    lines.push('// app-side router, generated from your settings');
    lines.push(`!const shard = hash(order.customer_id) % ${n};`);
    lines.push(`// going to ${n + 1} shards would move ~${Math.round((n / (n + 1)) * 100)}% of rows`);
  } else if (c.rule === 'hash') {
    lines.push('// MongoDB does the bucket idea with chunks of hash values:');
    lines.push('!sh.shardCollection("shop.orders", { customer_id: "hashed" })');
    lines.push(`// here: 100 buckets over ${n} shards (${Math.floor(100 / n)}–${Math.ceil(100 / n)} each)`);
  } else if (c.rule === 'year') {
    lines.push('// MongoDB, ranged on time');
    lines.push('!sh.shardCollection("shop.orders", { created_at: 1 })');
    lines.push(`// ${n} shards, and every new order lands on the newest range`);
  } else {
    lines.push('// MongoDB, ranged on country');
    lines.push('!sh.shardCollection("shop.orders", { country: 1 })');
    lines.push(`// ${n} shards, but "US" is one value: it can never be split`);
  }
  if (c.hot && c.rule === 'hash') {
    lines.push('');
    lines.push(c.salted ? '!const key = `${id}#${rand(4)}`;   // hot key salted into 4' : '// customer 12 is hot: ~70% of all writes');
  }
  return lines.join('\n');
}

export function Playground({ sim, initialRate }: { sim: ShardSim; initialRate: number }) {
  usePoll(sim, 250);
  const [rate, setRate] = useState(initialRate);
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
          if ((prev[m.id] ?? 0) >= m.hold) continue;
          next[m.id] = m.check(sim) ? (prev[m.id] ?? 0) + Math.max(dt, m.hold < 0.1 ? 1 : 0) : 0;
        }
        return next;
      });
    }, 250);
    return () => window.clearInterval(id);
  }, [sim]);

  const c = sim.cfg;
  const n = c.shards;
  const hash = c.rule === 'hash';
  const last = sim.lastReshard;

  return (
    <div className={kit.pg}>
      <div className={kit.pgGroup}>
        <div className={kit.pgLabel}>Shard key</div>
        <div className={css.keyGrid}>
          {KEYS.map((k) => (
            <button key={k.id} type="button" className={kit.algo} aria-pressed={c.rule === k.id} onClick={() => sim.pgSetRule(k.id)}>
              <span className={css.mono}>{k.label}</span>
              <span className={css.subtle} style={{ display: 'block', marginTop: 2 }}>
                {k.sub}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className={kit.pgGroup}>
        <div className={kit.pgLabel}>
          Shards <output>{n} / 6</output>
        </div>
        <div className={css.stepper}>
          <button type="button" className={kit.iconBtn} onClick={() => sim.pgSetShards(n - 1)} disabled={n <= 2} aria-label="Remove a shard">
            <Icon name="minus" size={14} />
          </button>
          <span className={css.stepperValue}>{n} shards</span>
          <button type="button" className={kit.iconBtn} onClick={() => sim.pgSetShards(n + 1)} disabled={n >= 6} aria-label="Add a shard">
            <Icon name="plus" size={14} />
          </button>
        </div>
        {hash && (
          <>
            <div className={kit.pgLabel} style={{ marginTop: 14 }}>
              Placement
            </div>
            <div className={css.twoCol}>
              <button type="button" className={kit.algo} aria-pressed={c.hashMode === 'modn'} onClick={() => sim.pgSetMode('modn')}>
                hash mod N
              </button>
              <button type="button" className={kit.algo} aria-pressed={c.hashMode === 'buckets'} onClick={() => sim.pgSetMode('buckets')}>
                100 buckets
              </button>
            </div>
          </>
        )}
        {last && (
          <p className={css.pgNote}>
            Going from {last.from} to {last.to} shards moved <strong>{Math.round(last.pct * 100)}%</strong> of the rows.
          </p>
        )}
      </div>

      <div className={kit.pgGroup}>
        <div className={kit.pgLabel}>
          Traffic <output>{rate} writes/s</output>
        </div>
        <input
          className={kit.range}
          type="range"
          min={1}
          max={16}
          step={1}
          value={rate}
          style={{ '--fill': `${((rate - 1) / 15) * 100}%` } as CSSProperties}
          onChange={(e) => {
            const v = Number(e.target.value);
            setRate(v);
            sim.setRate(v);
          }}
          aria-label="Writes per second"
        />
        <p className={css.pgNote}>Each shard absorbs about 4 writes/s before it starts to queue.</p>
      </div>

      <div className={kit.pgGroup}>
        <label className={kit.switch}>
          <span>
            Hot key
            <small>{hash ? 'Customer 12 sends ~70% of all writes' : 'Only for the hashed customer_id key'}</small>
          </span>
          <input type="checkbox" checked={c.hot} disabled={!hash} onChange={(e) => sim.setHot(e.target.checked, false)} />
        </label>
        <label className={kit.switch} style={{ marginTop: 12 }}>
          <span>
            Salt the hot key
            <small>Spread it over 4 sub-keys: 12#0 … 12#3</small>
          </span>
          <input type="checkbox" checked={c.salted} disabled={!hash || !c.hot} onChange={(e) => sim.setSalted(e.target.checked)} />
        </label>
      </div>

      <div className={kit.pgGroup}>
        <div className={kit.pgLabel}>Challenges</div>
        <div className={kit.missions}>
          {MISSIONS.map((m) => {
            const h = held[m.id] ?? 0;
            const done = h >= m.hold;
            return (
              <div key={m.id} className={kit.mission} data-done={done}>
                <div className={kit.missionTitle}>
                  {done && <Icon name="check" size={15} />}
                  {m.title}
                </div>
                <div className={kit.missionText}>{m.text}</div>
                {!done && <div className={kit.missionHint}>{m.hint}</div>}
                <div className={kit.meter}>
                  <i style={{ width: `${Math.min(100, (h / m.hold) * 100)}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <CodeBlock spec={{ title: 'orders · live', lang: 'js', code: liveCode(sim) }} />
    </div>
  );
}
