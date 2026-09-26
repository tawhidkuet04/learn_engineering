'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import { SliderCard, Stat } from '@/components/lesson/cards';
import { Icon } from '@/components/lesson/Icon';
import { lessonCss } from '@/components/lesson/Prose';
import { usePoll } from '@/components/lesson/usePoll';
import type { Order, PassResult } from './machine';
import { LEVELS, WS_STEPS, avgNs, fitsIn, fmtBytes, fmtNs } from './model';
import type { CacheSim, PaceKind } from './sim';
import css from './cc.module.css';

/* ------------------------------------------------------------------ */
/* Working-set slider (chapter 6)                                      */
/* ------------------------------------------------------------------ */

export function WsSliderCard({ sim, initial }: { sim: CacheSim; initial: number }) {
  const idx0 = Math.max(0, WS_STEPS.indexOf(initial));
  return (
    <SliderCard
      poll={sim}
      prompt="Grow the array your loop reads at random:"
      sliders={[
        {
          label: 'Working set',
          min: 0,
          max: WS_STEPS.length - 1,
          step: 1,
          initial: idx0,
          format: (i) => fmtBytes(WS_STEPS[i]),
          onChange: (i) => sim.setWs(WS_STEPS[i]),
          ends: ['4 KB', '1 GB'],
        },
      ]}
      stats={() => {
        const ws = sim.cfg.ws;
        const f = fitsIn(ws);
        const ns = avgNs(ws);
        return (
          <>
            <Stat label="fits in" value={f === 'ram' ? 'no cache' : LEVELS[f].name} bad={f === 'ram'} />
            <Stat label="average load" value={`${ns < 10 ? ns.toFixed(1) : Math.round(ns)} ns`} bad={ns > 40} />
            <Stat label="vs L1" value={`${Math.round(ns)}×`} />
          </>
        );
      }}
      done={() =>
        sim.cfg.ws > LEVELS.l3.bytes * 2 ? (
          <>
            <strong>Off the cliff.</strong> Once the working set outgrows the 32 MB L3, most loads go all the way to RAM and the average heads for
            100 ns. The code didn&apos;t change. Only the amount of data did.
          </>
        ) : null
      }
    />
  );
}

/* ------------------------------------------------------------------ */
/* Cheat sheet                                                         */
/* ------------------------------------------------------------------ */

const ROWS: [string, string, string, string][] = [
  ['Registers', 'a few hundred B', '< 1 ns', 'in the core'],
  ['L1', '32–64 KB', '~1 ns', 'per core'],
  ['L2', '1–2 MB', '3–5 ns', 'per core'],
  ['L3', 'tens of MB', '10–20 ns', 'shared'],
  ['RAM', 'GBs', '80–100 ns', 'off-chip'],
  ['SSD', 'TBs', '~100 µs', '1,000× RAM'],
];

export function CheatSheet() {
  return (
    <>
      <table className={css.table}>
        <thead>
          <tr>
            <th>Level</th>
            <th>Size</th>
            <th>Latency</th>
            <th>Where</th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map(([a, b, c, d]) => (
            <tr key={a}>
              <td>{a}</td>
              <td>{b}</td>
              <td className={css.mono}>{c}</td>
              <td>{d}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className={css.subhead}>Remember</p>
      <ul className={css.takeaways}>
        <li>
          RAM is <strong>~100× slower than L1</strong>. Most &ldquo;slow code&rdquo; that isn&apos;t I/O is waiting on memory.
        </li>
        <li>
          Memory moves in <strong>64-byte lines</strong>. Use every byte of a line before you move on.
        </li>
        <li>
          Walk arrays <strong>in the order they&apos;re stored</strong>: row by row in C, C++, Rust and NumPy; column by column in Fortran, MATLAB
          and Julia.
        </li>
        <li>
          Sequential access lets the <strong>prefetcher</strong> hide latency. Pointer chasing and random jumps can&apos;t be predicted.
        </li>
        <li>
          Keep the <strong>working set</strong> small: smaller types, arrays of structs split by field, tiles that fit in cache.
        </li>
        <li>
          Misses come in three kinds: <strong>compulsory</strong> (first touch), <strong>capacity</strong> (too much data) and{' '}
          <strong>conflict</strong> (too many lines fighting over one set).
        </li>
        <li>
          Data written by different threads should live on <strong>different lines</strong>: pad hot per-thread counters to 64 bytes.
        </li>
        <li>
          Measure, don&apos;t guess: <code>perf stat</code>, <code>perf c2c</code>, <code>valgrind --tool=cachegrind</code>.
        </li>
      </ul>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Playground                                                          */
/* ------------------------------------------------------------------ */

interface Mission {
  id: string;
  title: string;
  text: string;
  hint: string;
  check: (p: PassResult) => boolean;
}

const MISSIONS: Mission[] = [
  {
    id: 'tiny',
    title: 'Tiny cache, no problem',
    text: 'Shrink the L1 to 2 lines, keep the prefetcher off, and finish a pass with at most 16 misses: one per line.',
    hint: 'Hint: which pattern is done with each line before it moves on?',
    check: (p) => p.ways === 2 && !p.prefetch && p.misses <= 16,
  },
  {
    id: 'ahead',
    title: 'Ahead of time',
    text: 'Finish a pass with fewer than 8 misses.',
    hint: 'Hint: something can fetch lines before you ask for them.',
    check: (p) => p.misses < 8,
  },
  {
    id: 'rescue',
    title: 'Cheap columns',
    text: 'Walk column by column (not in tiles) with at most 16 misses.',
    hint: 'Hint: keep the loop, change the cache. How many lines does one column touch?',
    check: (p) => p.order === 'col' && p.misses <= 16,
  },
  {
    id: 'defeat',
    title: 'Break it',
    text: 'Turn the prefetcher on and still miss on every single load.',
    hint: 'Hint: prefetchers look for neighbouring lines. Which pattern never touches two in a row?',
    check: (p) => p.prefetch && p.misses === p.n,
  },
];

const ORDERS: { id: Order; label: string }[] = [
  { id: 'row', label: 'Row by row' },
  { id: 'col', label: 'Column by column' },
  { id: 'tile', label: 'Columns, 4-row tiles' },
  { id: 'random', label: 'Random' },
];

export function Playground({ sim, initial }: { sim: CacheSim; initial: { ways: number; prefetch: boolean; order: Order; pace: PaceKind } }) {
  usePoll(sim, 200);
  const [ways, setWays] = useState(initial.ways);
  const [done, setDone] = useState<Record<string, boolean>>({});
  const m = sim.ma;

  useEffect(() => {
    let seen: PassResult | null = null;
    const id = window.setInterval(() => {
      const p = sim.ma.lastPass;
      if (!p || p === seen) return;
      seen = p;
      setDone((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const ms of MISSIONS) {
          if (!next[ms.id] && ms.check(p)) {
            next[ms.id] = true;
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 250);
    return () => window.clearInterval(id);
  }, [sim]);

  const fill = ((ways - 2) / 8) * 100;
  const n = m.accesses;
  const lp = m.lastPass;

  return (
    <div className={css.pg}>
      <div className={css.pgGroup}>
        <div className={css.pgLabel}>Access pattern</div>
        <div className={css.opts} role="group" aria-label="Access pattern">
          {ORDERS.map((o) => (
            <button key={o.id} type="button" className={css.opt} aria-pressed={sim.cfg.order === o.id} onClick={() => sim.setOrder(o.id)}>
              {o.label}
            </button>
          ))}
        </div>
        <div className={css.pgLabel} style={{ marginTop: 14 }}>
          L1 size <output>{ways} lines · {ways * 64} B</output>
        </div>
        <input
          className={css.range}
          type="range"
          min={2}
          max={10}
          step={1}
          value={ways}
          style={{ '--fill': `${fill}%` } as CSSProperties}
          onChange={(e) => {
            const v = Number(e.target.value);
            setWays(v);
            sim.setWays(v);
          }}
          aria-label="L1 size in lines"
        />
        <div className={css.scale}>
          <span>2 lines</span>
          <span>10 lines</span>
        </div>
        <label className={css.switch}>
          <span>
            Prefetcher
            <small>fetches the next 2 lines when it spots a stream</small>
          </span>
          <input type="checkbox" checked={sim.cfg.prefetch} onChange={(e) => sim.setPrefetch(e.target.checked)} />
        </label>
        <div className={css.pgLabel} style={{ marginTop: 14 }}>
          Speed
        </div>
        <div className={css.seg} role="group" aria-label="Animation speed">
          <button type="button" aria-pressed={sim.cfg.pace === 'tutorial'} onClick={() => sim.setPace('tutorial')}>
            Watch each load
          </button>
          <button type="button" aria-pressed={sim.cfg.pace === 'true'} onClick={() => sim.setPace('true')}>
            Real proportions
          </button>
        </div>
        <div className={css.stats}>
          <span>
            hits <b data-tone={m.hits ? 'good' : undefined}>{m.hits}</b>
          </span>
          <span>
            misses <b data-tone={m.misses ? 'bad' : undefined}>{m.misses}</b>
          </span>
          <span>
            hit rate <b>{n ? `${Math.round((m.hits / n) * 100)}%` : '—'}</b>
          </span>
          <span>
            time <b>{fmtNs(m.ns, true)}</b>
          </span>
        </div>
        <div className={css.btnRow}>
          <button type="button" className={css.btn} onClick={() => sim.fastForward()}>
            <Icon name="arrowRight" size={14} /> Finish this pass now
          </button>
          <button type="button" className={css.btn} onClick={() => sim.restartPass()}>
            <Icon name="replay" size={14} /> Restart
          </button>
        </div>
        {lp && (
          <p className={css.lastPass}>
            last full pass: <b>{lp.misses}</b> misses of {lp.n} · <b>{fmtNs(lp.ns, true)}</b>
          </p>
        )}
      </div>

      <div className={css.pgGroup}>
        <div className={css.pgLabel}>
          Challenges{' '}
          <output>
            {Object.values(done).filter(Boolean).length} / {MISSIONS.length}
          </output>
        </div>
        <div className={css.missions}>
          {MISSIONS.map((ms) => (
            <div key={ms.id} className={css.mission} data-done={!!done[ms.id]}>
              <div className={css.missionTitle}>
                {done[ms.id] && <Icon name="check" size={15} />}
                {ms.title}
              </div>
              <div className={css.missionText}>{ms.text}</div>
              {!done[ms.id] && <div className={css.missionHint}>{ms.hint}</div>}
            </div>
          ))}
        </div>
      </div>
      <p className={lessonCss.aside} style={{ marginTop: 0 }}>
        The toy L1 is fully associative with least-recently-used replacement, and misses always cost 100 ns. Real caches are bigger, set-associative,
        and back each miss with L2 and L3.
      </p>
    </div>
  );
}
