'use client';

import type { CSSProperties } from 'react';
import cards from '@/components/lesson/cards.module.css';
import { CodeBlock, type CodeSpec } from '@/components/lesson/CodeBlock';
import { Icon } from '@/components/lesson/Icon';
import { usePoll } from '@/components/lesson/usePoll';
import type { Strategy } from './fastrun';
import { STRATEGY_LABEL } from './Scene';
import type { RaceSim } from './sim';
import css from './race.module.css';

/* ------------------------------------------------------------------ */
/* Cheat sheet                                                         */
/* ------------------------------------------------------------------ */

const ROWS: [string, string, string][] = [
  ['Mutex', 'One thread in the critical section at a time; the rest block', 'Contention; slow work done while holding it'],
  ['Atomics', 'Read-modify-write in one hardware step (lock xadd)', 'Covers one variable, not multi-step logic'],
  ['CAS loop', 'Swap only if unchanged, otherwise retry', 'Retry storms under contention; ABA'],
  ['Lock order', 'Every thread takes locks in one global order', 'One call site that breaks the order'],
  ['Try-lock', 'Time out, release everything, back off, retry', 'Livelock if the back-off isn’t random'],
  ['FOR UPDATE', 'Locks the row until the transaction ends', 'Waiting transactions; lock-order deadlocks'],
  ['Version check', 'UPDATE … WHERE version = v, retry on 0 rows', 'Lots of retries when conflicts are common'],
];

export function CheatSheet() {
  return (
    <>
      <table className={cards.table}>
        <thead>
          <tr>
            <th>Tool</th>
            <th>How it works</th>
            <th>Watch out for</th>
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

      <p className={cards.subhead}>Remember</p>
      <ul className={cards.takeaways}>
        <li>
          <code className={css.kbd}>count++</code> is a <strong>read-modify-write</strong>: three steps another thread can slip between.
        </li>
        <li>
          Races give <strong>different wrong answers on different runs</strong>. A passing test proves little; run a race detector (<code className={css.kbd}>go test -race</code>,
          ThreadSanitizer).
        </li>
        <li>
          Find the <strong>critical section</strong> and guard it with a <strong>mutex</strong>. Keep it short.
        </li>
        <li>
          For a single counter or flag, use <strong>atomics</strong>. They never block.
        </li>
        <li>
          Holding several locks? Take them in <strong>one global order</strong>, or risk <strong>deadlock</strong>.
        </li>
        <li>
          Across requests and databases, beware <strong>check-then-act</strong>. Make the check and the write one atomic step.
        </li>
      </ul>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Playground                                                          */
/* ------------------------------------------------------------------ */

const STRATS: { id: Strategy; sub: string }[] = [
  { id: 'none', sub: 'count++' },
  { id: 'mutex', sub: 'lock, count++, unlock' },
  { id: 'faa', sub: 'fetch-and-add' },
  { id: 'cas', sub: 'compare-and-swap, retry' },
];

const PERS = [10, 100, 1000, 10000];
const WORKS: [number, string][] = [
  [0, 'none'],
  [6, 'some'],
  [30, 'lots'],
];

const MISSIONS: { id: string; title: string; text: string; hint: string }[] = [
  { id: 'half', title: 'Chaos', text: 'With no lock, lose more than half of the updates in a single run.', hint: 'Hint: more threads means more collisions.' },
  { id: 'lucky', title: 'Lucky run', text: 'Get the exact total with no protection at all.', hint: 'Hint: races need overlap. How long does a tiny loop run?' },
  { id: 'lockfree', title: 'Exact without a lock', text: 'Get the exact total with 1,000+ increments per thread and no mutex.', hint: 'Hint: let the hardware do it.' },
];

function goCode(s: Strategy, per: number, work: number): CodeSpec {
  const body =
    s === 'mutex'
      ? ['!mu.Lock()', '!count++', '!mu.Unlock()']
      : s === 'faa'
        ? ['!atomic.AddInt64(&count, 1)']
        : s === 'cas'
          ? ['!for {', '!    old := atomic.LoadInt64(&count)', '!    if atomic.CompareAndSwapInt64(&count, old, old+1) {', '!        break', '!    }', '!}']
          : ['!count++ // data race'];
  const lines = [`for i := 0; i < ${per}; i++ {`, ...(work ? ['    doOtherWork()'] : []), ...body.map((l) => `!    ${l.slice(1)}`), '}'];
  return { title: `worker.go · ${STRATEGY_LABEL[s]}`, lang: 'c', code: lines.join('\n') };
}

export function Playground({ sim }: { sim: RaceSim }) {
  usePoll(sim, 150);
  const running = !!sim.run;
  const last = sim.runs[sim.runs.length - 1];
  const seg = (label: string, opts: [number, string][], cur: number, set: (v: number) => void) => (
    <div className={css.pickRow} style={{ marginTop: 10 }}>
      <span className={cards.pgLabel}>{label}</span>
      <div className={css.seg} role="group" aria-label={label}>
        {opts.map(([v, l]) => (
          <button key={v} type="button" aria-pressed={cur === v} disabled={running} onClick={() => set(v)}>
            {l}
          </button>
        ))}
      </div>
    </div>
  );
  return (
    <div className={cards.pg}>
      <div className={cards.pgGroup}>
        <div className={cards.pgLabel}>Protect count with</div>
        <div className={cards.algos}>
          {STRATS.map((s) => (
            <button key={s.id} type="button" className={cards.algo} aria-pressed={sim.strategy === s.id} disabled={running} onClick={() => sim.setStrategy(s.id)}>
              {STRATEGY_LABEL[s.id]}
              <small style={{ display: 'block', marginTop: 2, fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-3)' }}>{s.sub}</small>
            </button>
          ))}
        </div>
      </div>

      <div className={cards.pgGroup}>
        {seg(
          'Threads',
          [2, 3, 4].map((n) => [n, String(n)] as [number, string]),
          sim.nThreads,
          (v) => sim.setThreads(v),
        )}
        {seg(
          'Increments each',
          PERS.map((n) => [n, n.toLocaleString('en-US')] as [number, string]),
          sim.per,
          (v) => sim.setPer(v),
        )}
        {seg('Other work per loop', WORKS, sim.work, (v) => sim.setWork(v))}
        <div>
          <button type="button" className={css.primary} disabled={running} onClick={() => sim.startRun()}>
            <Icon name="play" size={13} />
            {running ? 'Running…' : 'Run'}
          </button>
          <button type="button" className={css.ghostBtn} disabled={running || !sim.runs.length} onClick={() => sim.clearRuns()}>
            Clear chart
          </button>
        </div>
        {last && (
          <div className={css.stats}>
            <span>
              last <b data-bad={last.lost > 0} data-good={last.lost === 0}>
                {last.final.toLocaleString('en-US')}
              </b>{' '}
              / {last.expected.toLocaleString('en-US')}
            </span>
            <span>
              lost <b data-bad={last.lost > 0}>{last.lost.toLocaleString('en-US')}</b>
            </span>
            <span>
              time <b>{last.ticks >= 1000 ? `${(last.ticks / 1000).toFixed(1)}k` : last.ticks}</b>
            </span>
            {last.retries > 0 && (
              <span>
                retries <b>{last.retries.toLocaleString('en-US')}</b>
              </span>
            )}
          </div>
        )}
      </div>

      <div className={cards.pgGroup}>
        <div className={cards.pgLabel}>Challenges</div>
        <div className={cards.missions}>
          {MISSIONS.map((m) => {
            const done = sim.badges.has(m.id);
            return (
              <div key={m.id} className={cards.mission} data-done={done}>
                <div className={cards.missionTitle}>
                  {done && <Icon name="check" size={15} />}
                  {m.title}
                </div>
                <div className={cards.missionText}>{m.text}</div>
                {!done && <div className={cards.missionHint}>{m.hint}</div>}
                <div className={cards.meter}>
                  <i style={{ width: done ? '100%' : '0%' } as CSSProperties} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <CodeBlock spec={goCode(sim.strategy, sim.per, sim.work)} />
    </div>
  );
}
