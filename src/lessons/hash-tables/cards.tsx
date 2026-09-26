'use client';

import { useState, type CSSProperties, type ReactNode } from 'react';
import cardCss from '@/components/lesson/cards.module.css';
import { CodeBlock } from '@/components/lesson/CodeBlock';
import { Icon } from '@/components/lesson/Icon';
import { lessonCss } from '@/components/lesson/Prose';
import { usePoll } from '@/components/lesson/usePoll';
import { fmt } from './hashing';
import { HashSim } from './sim';
import type { Mode } from './table';
import type { HashKind } from './hashing';
import css from './ht.module.css';

function Kicker({ icon = 'bolt', children, right }: { icon?: 'bolt' | 'target' | 'power' | 'flag'; children: ReactNode; right?: ReactNode }) {
  return (
    <div className={cardCss.head}>
      <div className={lessonCss.cardKicker}>
        <Icon name={icon} size={13} /> {children}
      </div>
      {right}
    </div>
  );
}

/** What the last operation did, in one sentence. */
export function lastSentence(sim: HashSim): ReactNode {
  const l = sim.last;
  if (!l) return null;
  const c = `${l.cmp} comparison${l.cmp === 1 ? '' : 's'}`;
  switch (l.result) {
    case 'placed':
      return (
        <>
          <code>{l.key}</code> hashed to <b>{fmt(l.hash ?? 0)}</b> and landed in {sim.table.mode === 'probe' ? 'slot' : 'bucket'} <b>{l.index}</b> ({c}).
        </>
      );
    case 'updated':
      return (
        <>
          <code>{l.key}</code> was already there, so its value was updated ({c}).
        </>
      );
    case 'found':
      return (
        <>
          Found <code>{l.key}</code> → <b>{l.value}</b> after {c}.
        </>
      );
    case 'missing':
      return (
        <>
          <code>{l.key}</code> isn’t in the table. Knowing that took {c}.
        </>
      );
    case 'deleted':
      return (
        <>
          Deleted <code>{l.key}</code> ({c}).
        </>
      );
    case 'full':
      return <>The table is full. Open addressing can’t hold more keys than slots.</>;
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ */
/* Type a key                                                          */
/* ------------------------------------------------------------------ */

export function KeyCard({ sim, prompt, mode, suggestions }: { sim: HashSim; prompt: ReactNode; mode: 'put' | 'get' | 'both'; suggestions: string[] }) {
  usePoll(sim, 150, true);
  const [text, setText] = useState('');
  const key = HashSim.clean(text);
  const go = (k: string, op: 'put' | 'get') => {
    if (!k) return;
    if (op === 'put') sim.userPut(k);
    else sim.userGet(k);
    setText('');
  };
  const primary: 'put' | 'get' = mode === 'get' ? 'get' : 'put';
  return (
    <div className={lessonCss.card}>
      <Kicker>Try it</Kicker>
      <p className={lessonCss.cardQ}>{prompt}</p>
      <div className={css.keyRow}>
        <input
          className={css.keyInput}
          value={text}
          maxLength={6}
          placeholder="a name, e.g. kim"
          aria-label="Key"
          onChange={(e) => setText(HashSim.clean(e.target.value))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') go(key, primary);
          }}
        />
        {mode !== 'get' && (
          <button type="button" className={`${cardCss.btn} ${cardCss.btnHot}`} onClick={() => go(key, 'put')} disabled={!key}>
            Insert
          </button>
        )}
        {mode !== 'put' && (
          <button type="button" className={`${cardCss.btn} ${mode === 'get' ? cardCss.btnHot : ''}`} onClick={() => go(key, 'get')} disabled={!key}>
            Look up
          </button>
        )}
      </div>
      <div className={css.suggest}>
        {suggestions.map((s) => (
          <button key={s} type="button" onClick={() => go(s, primary)}>
            {s}
          </button>
        ))}
      </div>
      {sim.last && sim.last.op !== 'hash' && <p className={css.result}>{lastSentence(sim)}</p>}
      <p className={css.hint}>Letters only, up to 6. {sim.busy ? 'Queued behind the running animation.' : ''}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Load factor                                                         */
/* ------------------------------------------------------------------ */

export function LoadCard({ sim, initial, max, initialMode }: { sim: HashSim; initial: number; max: number; initialMode: Mode }) {
  usePoll(sim, 200);
  const [n, setN] = useState(initial);
  const [mode, setMode] = useState<Mode>(initialMode);
  const t = sim.table;
  const fill = ((n - 1) / (max - 1)) * 100;
  const miss = t.avgMiss();
  return (
    <div className={lessonCss.card}>
      <Kicker>Try it</Kicker>
      <p className={lessonCss.cardQ}>Fill the table and watch what a lookup costs.</p>
      <div className={cardCss.sliderHead}>
        <span>Keys in 10 buckets</span>
        <output>
          {n} · α = {(n / 10).toFixed(1)}
        </output>
      </div>
      <input
        className={cardCss.range}
        type="range"
        min={1}
        max={max}
        step={1}
        value={n}
        style={{ '--fill': `${fill}%` } as CSSProperties}
        aria-label="Keys in the table"
        onChange={(e) => {
          const v = Number(e.target.value);
          setN(v);
          sim.setFill(v);
        }}
      />
      <div className={`${cardCss.seg} ${cardCss.segWrap}`} role="group" aria-label="Collision strategy">
        {(['probe', 'chain'] as Mode[]).map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={mode === m}
            onClick={() => {
              setMode(m);
              sim.setMode(m);
            }}
          >
            {m === 'probe' ? 'Linear probing' : 'Chaining'}
          </button>
        ))}
      </div>
      <div className={cardCss.stats}>
        <span>
          avg. to find a key <b>{t.avgHit().toFixed(2)}</b>
        </span>
        <span>
          avg. to miss <b data-bad={miss >= 4}>{miss.toFixed(2)}</b>
        </span>
        <span>
          {t.mode === 'probe' ? 'longest cluster' : 'longest chain'} <b>{t.longestChain()}</b>
        </span>
      </div>
      {n >= 9 && t.mode === 'probe' && (
        <p className={cardCss.after}>
          <strong>That’s the cliff.</strong> With one free slot left, a miss has to walk most of the table to find it. At 10 of 10 there’s no empty slot at all, so a
          miss checks every key.
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Cheat sheet                                                         */
/* ------------------------------------------------------------------ */

const OPS_ROWS: [string, string, string][] = [
  ['Lookup', 'O(1)', 'O(n): every key in one bucket'],
  ['Insert', 'O(1) amortized', 'O(n): a resize, or one huge bucket'],
  ['Delete', 'O(1)', 'O(n)'],
  ['Resize', 'O(n), but rare', 'Doubling keeps inserts O(1) on average'],
];

const REAL_ROWS: [string, string, string][] = [
  ['Java HashMap', 'Chaining; trees past 8', '16 buckets, grows past 0.75'],
  ['Python dict', 'Open addressing, perturbed probing', 'Grows at 2/3; keeps insertion order'],
  ['JS Map (V8)', 'Chaining over an ordered entry list', 'Keeps insertion order'],
  ['Go map, Rust HashMap', 'Swiss tables (open addressing)', 'Random seeds against flooding'],
];

function Table({ head, rows }: { head: [string, string, string]; rows: [string, string, string][] }) {
  return (
    <table className={cardCss.table}>
      <thead>
        <tr>
          {head.map((h) => (
            <th key={h}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map(([a, b, c]) => (
          <tr key={a}>
            <td>{a}</td>
            <td>{b}</td>
            <td>{c}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function CheatSheet() {
  return (
    <>
      <Table head={['Operation', 'Average', 'Worst case']} rows={OPS_ROWS} />
      <Table head={['In the wild', 'Collisions', 'Growth']} rows={REAL_ROWS} />
      <p className={cardCss.subhead}>Remember</p>
      <ul className={cardCss.takeaways}>
        <li>
          A hash table is an <strong>array plus a hash function</strong>: index = hash(key) mod buckets.
        </li>
        <li>
          <strong>Collisions always happen.</strong> Chaining keeps a list per bucket; open addressing probes for the next free slot and needs tombstones to
          delete.
        </li>
        <li>
          Keep the <strong>load factor</strong> low by doubling and rehashing. Each resize is O(n), but they are rare enough that inserts stay O(1) on average.
        </li>
        <li>
          A bad or predictable hash turns O(1) into O(n). Use the language’s built-in hashing: it is <strong>seeded</strong> against flooding attacks.
        </li>
        <li>
          Keys must not change while they’re in the table: a changed key hashes to a different bucket and gets lost.
        </li>
      </ul>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Playground                                                          */
/* ------------------------------------------------------------------ */

const NAMES = ['alice', 'bob', 'carol', 'dave', 'erin', 'frank', 'grace', 'heidi', 'ivan', 'judy', 'kim', 'leo', 'mia', 'nina', 'oscar', 'peggy', 'quinn', 'sybil', 'trent', 'uma', 'walt', 'xena', 'yara', 'zoe', 'jack', 'jane', 'jill', 'max', 'mike', 'sam', 'sue', 'tom'];

interface Mission {
  id: string;
  title: string;
  text: string;
  hint: string;
  done: (s: HashSim) => boolean;
}

const MISSIONS: Mission[] = [
  { id: 'collide', title: 'Collision course', text: 'Insert a key into a bucket that is already taken.', hint: 'Hint: with 10 buckets, hashes that end in the same digit collide.', done: (s) => s.stats.collided },
  { id: 'grow', title: 'Make it grow', text: 'Push the load factor past the limit and trigger a resize.', hint: 'Hint: keep inserting, or lower the limit.', done: (s) => s.stats.resized },
  { id: 'slow', title: 'The slow lane', text: 'Make a single lookup or insert take 4 or more comparisons.', hint: 'Hint: the first-letter hash piles names up fast.', done: (s) => s.stats.maxCmp >= 4 },
  { id: 'cluster', title: 'Cluster buster', text: 'With linear probing, build a cluster of 6 slots in a row.', hint: 'Hint: switch to linear probing and turn resizing off.', done: (s) => s.stats.maxRun >= 6 },
];

const HASHES: { id: HashKind; label: string }[] = [
  { id: 'poly', label: 'h × 31 + code' },
  { id: 'first', label: 'First letter' },
  { id: 'keyed', label: 'Keyed (seeded)' },
];

const PLAYGROUND_CODE = `
class HashTable {
  buckets = Array.from({ length: 8 }, () => []);
  size = 0;

  hash(key) {
    let h = 0;
    for (const ch of key) h = (Math.imul(h, 31) + ch.charCodeAt(0)) | 0;
    return h >>> 0;
  }

  bucketFor(key) {
!    return this.buckets[this.hash(key) % this.buckets.length];
  }

  get(key) {
    return this.bucketFor(key).find((e) => e.key === key)?.value;
  }

  set(key, value) {
    const bucket = this.bucketFor(key);
    const entry = bucket.find((e) => e.key === key);
    if (entry) return void (entry.value = value);
    bucket.push({ key, value });
!    if (++this.size / this.buckets.length > 0.75) this.grow();
  }

  grow() {
    const old = this.buckets.flat();
!    this.buckets = Array.from({ length: this.buckets.length * 2 }, () => []);
!    for (const e of old) this.bucketFor(e.key).push(e);   // rehash every key
  }
}`;

export function Playground({ sim }: { sim: HashSim }) {
  usePoll(sim, 200);
  const [text, setText] = useState('');
  const [limit, setLimit] = useState(0.75);
  const [autoResize, setAutoResize] = useState(true);
  const key = HashSim.clean(text);
  const t = sim.table;
  const random = () => {
    const pool = NAMES.filter((n) => !t.has(n));
    for (let i = 0; i < 3 && pool.length; i++) {
      const k = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
      sim.userPut(k);
    }
  };
  const run = (op: 'put' | 'get' | 'del') => {
    if (!key) return;
    if (op === 'put') sim.userPut(key);
    else if (op === 'get') sim.userGet(key);
    else sim.userDel(key);
    setText('');
  };
  return (
    <div className={cardCss.pg}>
      <div className={cardCss.pgGroup}>
        <div className={cardCss.pgLabel}>
          Keys <output>{sim.totalKeys} in {sim.next ? `${t.cap} → ${sim.next.cap}` : t.cap} buckets</output>
        </div>
        <div className={css.keyRow}>
          <input
            className={css.keyInput}
            value={text}
            maxLength={6}
            placeholder="a name"
            aria-label="Key"
            onChange={(e) => setText(HashSim.clean(e.target.value))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') run('put');
            }}
          />
        </div>
        <div className={cardCss.row} style={{ marginTop: 10 }}>
          <button type="button" className={`${cardCss.btn} ${cardCss.btnHot}`} onClick={() => run('put')} disabled={!key}>
            Insert
          </button>
          <button type="button" className={cardCss.btn} onClick={() => run('get')} disabled={!key}>
            Look up
          </button>
          <button type="button" className={cardCss.btn} onClick={() => run('del')} disabled={!key}>
            Delete
          </button>
        </div>
        <div className={cardCss.row} style={{ marginTop: 8 }}>
          <button type="button" className={cardCss.btn} onClick={random}>
            <Icon name="plus" size={14} /> 3 random names
          </button>
          <button type="button" className={`${cardCss.btn} ${cardCss.btnGhost}`} onClick={() => sim.clearAll()}>
            Clear
          </button>
        </div>
        {sim.last && <p className={css.result}>{lastSentence(sim)}</p>}
      </div>

      <div className={cardCss.pgGroup}>
        <div className={cardCss.pgLabel}>Collisions</div>
        <div className={cardCss.algos}>
          {(['chain', 'probe'] as Mode[]).map((m) => (
            <button key={m} type="button" className={cardCss.algo} aria-pressed={sim.cfg.mode === m} onClick={() => sim.setMode(m)}>
              {m === 'chain' ? 'Separate chaining' : 'Linear probing'}
            </button>
          ))}
        </div>
        <div className={cardCss.pgLabel} style={{ marginTop: 14 }}>
          Hash function
        </div>
        <div className={cardCss.algos}>
          {HASHES.map((h) => (
            <button key={h.id} type="button" className={cardCss.algo} aria-pressed={sim.cfg.hash === h.id} onClick={() => sim.setHash(h.id)}>
              {h.label}
            </button>
          ))}
        </div>
      </div>

      <div className={cardCss.pgGroup}>
        <label className={cardCss.switch}>
          <span>
            Resize automatically
            <small>Double the buckets (up to 20) when the load factor passes the limit</small>
          </span>
          <input
            type="checkbox"
            checked={autoResize}
            onChange={(e) => {
              setAutoResize(e.target.checked);
              sim.setMaxLoad(e.target.checked ? limit : Infinity);
            }}
          />
        </label>
        <div className={cardCss.pgLabel} style={{ marginTop: 14 }}>
          Load factor limit <output>{limit.toFixed(2)}</output>
        </div>
        <input
          className={cardCss.range}
          type="range"
          min={0.5}
          max={1}
          step={0.05}
          value={limit}
          disabled={!autoResize}
          style={{ '--fill': `${((limit - 0.5) / 0.5) * 100}%` } as CSSProperties}
          aria-label="Load factor limit"
          onChange={(e) => {
            const v = Number(e.target.value);
            setLimit(v);
            sim.setMaxLoad(v);
          }}
        />
        <div className={cardCss.stats}>
          <span>
            load factor <b>{(sim.totalKeys / t.cap).toFixed(2)}</b>
          </span>
          <span>
            {t.mode === 'probe' ? 'longest cluster' : 'longest chain'} <b>{t.longestChain()}</b>
          </span>
          <span>
            avg. to find <b>{t.avgHit().toFixed(2)}</b>
          </span>
        </div>
      </div>

      <div className={cardCss.pgGroup}>
        <div className={cardCss.pgLabel}>Challenges</div>
        <div className={cardCss.missions}>
          {MISSIONS.map((m) => {
            const ok = m.done(sim);
            return (
              <div key={m.id} className={cardCss.mission} data-done={ok}>
                <div className={cardCss.missionTitle}>
                  {ok && <Icon name="check" size={15} />}
                  {m.title}
                </div>
                <div className={cardCss.missionText}>{m.text}</div>
                {!ok && <div className={cardCss.missionHint}>{m.hint}</div>}
              </div>
            );
          })}
        </div>
      </div>

      <CodeBlock spec={{ title: 'hash-table.js', lang: 'js', code: PLAYGROUND_CODE, note: 'The whole idea in about 30 lines: chaining, a load-factor limit, and doubling with a full rehash.' }} />
    </div>
  );
}
