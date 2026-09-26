'use client';

import type { CSSProperties, ReactNode } from 'react';
import cards from '@/components/lesson/cards.module.css';
import { CodeBlock, type CodeSpec } from '@/components/lesson/CodeBlock';
import { Icon, type IconName } from '@/components/lesson/Icon';
import { lessonCss } from '@/components/lesson/Prose';
import { usePoll } from '@/components/lesson/usePoll';
import type { Strategy } from './fastrun';
import type { BankMode, LockOrder, SeatMode, TId } from './programs';
import { TCOLOR, type RaceSim } from './sim';
import css from './race.module.css';

const fmtN = (n: number) => n.toLocaleString('en-US');
const ticks = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

export function Kicker({ icon = 'target', children, right }: { icon?: IconName; children: ReactNode; right?: ReactNode }) {
  return (
    <div className={cards.head}>
      <div className={lessonCss.cardKicker}>
        <Icon name={icon} size={13} /> {children}
      </div>
      {right}
    </div>
  );
}

function Goals({ items }: { items: { text: ReactNode; done: boolean }[] }) {
  return (
    <div className={css.goals}>
      {items.map((g, i) => (
        <div key={i} className={css.goal} data-done={g.done}>
          <i>{g.done ? <Icon name="check" size={11} strokeWidth={3} /> : null}</i>
          <span>{g.text}</span>
        </div>
      ))}
    </div>
  );
}

/** The live question text for PredictCard (it changes from question to question). */
export function AskText({ sim, fallback }: { sim: RaceSim; fallback: ReactNode }) {
  usePoll(sim, 100, true);
  const g = sim.game;
  return <>{g?.pending?.ask ?? (g?.done ? 'All three moments called. The next rounds play on their own.' : fallback)}</>;
}

/* ------------------------------------------------------------------ */
/* You are the scheduler                                               */
/* ------------------------------------------------------------------ */

export function SchedulerCard({ sim, lock }: { sim: RaceSim; lock?: boolean }) {
  usePoll(sim, 100);
  const ids: TId[] = ['A', 'B'];
  const outs = sim.outcomes;
  const goals = lock
    ? [
        {
          text: (
            <>
              Pause one thread inside the critical section, then <strong>run the other</strong>
            </>
          ),
          done: sim.sawBlock,
        },
        { text: <>Finish two rounds, interleaved any way you like</>, done: outs.length >= 2 },
      ]
    : [
        {
          text: (
            <>
              Lose an update: finish with <strong>count = 6</strong>
            </>
          ),
          done: outs.includes(6),
        },
        {
          text: (
            <>
              Get it right: finish with <strong>count = 7</strong>
            </>
          ),
          done: outs.includes(7),
        },
      ];
  const both = !lock && outs.includes(6) && outs.includes(7);
  return (
    <div className={lessonCss.card}>
      <Kicker>Your turn · you schedule</Kicker>
      <p className={lessonCss.cardQ}>{lock ? 'Pick the interleaving. Can you still lose an update?' : 'Each click runs one instruction. You decide who goes next.'}</p>
      <div className={css.sched}>
        {ids.map((id) => {
          const t = sim.thread(id);
          if (!t) return null;
          const reason = sim.blockedReason(id);
          const ins = t.prog.instrs[t.pc];
          const sub =
            t.status === 'done'
              ? 'finished'
              : t.status === 'blocked'
                ? `waiting for ${t.waitFor}`
                : sim.busy === id
                  ? 'running…'
                  : ins
                    ? `${ins.mn} ${ins.args}`
                    : '';
          return (
            <button key={id} type="button" className={css.runBtn} style={{ '--c': TCOLOR[id] } as CSSProperties} disabled={!!reason} onClick={() => sim.runNext(id)}>
              <b>Run {id} ›</b>
              <span>{sub}</span>
            </button>
          );
        })}
      </div>
      <Goals items={goals} />
      {sim.roundOver && sim.result && <p className={`${css.status} ${sim.result.ok ? css.statusGood : css.statusBad}`}>{sim.result.text}</p>}
      <button type="button" className={css.ghostBtn} style={{ marginLeft: 0 }} onClick={() => sim.restartRound()}>
        <Icon name="replay" size={13} /> Start over
      </button>
      {both && (
        <p className={css.note}>
          <strong>You found both outcomes.</strong> Same code, same starting value, different answers. Only the order of the instructions changed.
        </p>
      )}
      {lock && outs.length >= 2 && (
        <p className={css.note}>
          <strong>{outs.every((o) => o === 7) ? '7 every time.' : 'Still no lost updates.'}</strong> You can pause a thread inside the critical section, but the
          other one can’t get in: its LOCK just waits.
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Run 1,000 increments                                                */
/* ------------------------------------------------------------------ */

export function RunCard({ sim, compare }: { sim: RaceSim; compare?: boolean }) {
  usePoll(sim, 150);
  const running = !!sim.run;
  const runs = sim.runs;
  const last = runs[runs.length - 1];
  const racy = runs.filter((r) => r.strategy === 'none');
  const locked = runs.filter((r) => r.strategy === 'mutex');
  const distinct = new Set(racy.map((r) => r.final)).size;
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  let note: ReactNode = null;
  if (!compare && racy.length >= 3) {
    note = (
      <>
        <strong>
          {racy.length} runs, {distinct} different total{distinct > 1 ? 's' : ''}
          {racy.every((r) => r.lost > 0) ? ', none of them 2,000.' : '.'}
        </strong>{' '}
        Same program, same input. Only the timing changed.
      </>
    );
  }
  if (compare && racy.length && locked.length) {
    const x = avg(locked.map((r) => r.ticks)) / avg(racy.map((r) => r.ticks));
    note = (
      <>
        <strong>The mutex gets 2,000 every time</strong>, and takes about {x.toFixed(1)}× as long. Correctness costs waiting.
      </>
    );
  }
  return (
    <div className={lessonCss.card}>
      <Kicker icon="bolt">Try it</Kicker>
      <p className={lessonCss.cardQ}>{compare ? 'Run it with and without the mutex. Compare the totals and the time bars.' : 'Two threads, 1,000 increments each. Expected total: 2,000.'}</p>
      {compare && (
        <div className={css.optRow}>
          <span className={css.optLabel}>protect count with</span>
          <div className={css.seg} role="group" aria-label="Strategy">
            {(['none', 'mutex'] as Strategy[]).map((s) => (
              <button key={s} type="button" aria-pressed={sim.strategy === s} disabled={running} onClick={() => sim.setStrategy(s)}>
                {s === 'none' ? 'nothing' : 'a mutex'}
              </button>
            ))}
          </div>
        </div>
      )}
      <button type="button" className={css.primary} disabled={running} onClick={() => sim.startRun()}>
        <Icon name="play" size={13} />
        {running ? 'Running…' : 'Run 1,000 increments per thread'}
      </button>
      {last && (
        <div className={css.stats}>
          <span>
            last run{' '}
            <b data-bad={last.lost > 0} data-good={last.lost === 0}>
              {fmtN(last.final)}
            </b>{' '}
            of {fmtN(last.expected)}
          </span>
          <span>
            lost <b data-bad={last.lost > 0}>{fmtN(last.lost)}</b>
          </span>
          <span>
            time <b>{ticks(last.ticks)} ticks</b>
          </span>
        </div>
      )}
      {note && <p className={css.note}>{note}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Deadlock builder                                                    */
/* ------------------------------------------------------------------ */

export function DeadlockCard({ sim }: { sim: RaceSim }) {
  usePoll(sim, 120);
  const row = (i: 0 | 1) => {
    const id: TId = i === 0 ? 'A' : 'B';
    return (
      <div className={css.pickRow} key={id}>
        <span className={css.who} style={{ '--c': TCOLOR[id] } as CSSProperties}>
          <i />
          {id} locks
        </span>
        <div className={css.seg} role="group" aria-label={`Thread ${id} lock order`}>
          {(['ab', 'ba'] as LockOrder[]).map((o) => (
            <button key={o} type="button" aria-pressed={sim.orders[i] === o} onClick={() => sim.setOrder(i, o)}>
              {o === 'ab' ? 'alice, bob' : 'bob, alice'}
            </button>
          ))}
        </div>
      </div>
    );
  };
  const waits = sim.threads
    .filter((t) => t.status === 'blocked' && t.waitFor)
    .map((t) => `${t.id} waits for ${t.waitFor} (held by ${sim.lock(t.waitFor ?? '')?.owner ?? '?'})`);
  const status = sim.deadlocked
    ? `Deadlock. ${waits.join('; ')}.`
    : sim.roundOver
      ? sim.orders[0] === sim.orders[1]
        ? 'Both transfers finished: same order, no cycle.'
        : 'Both transfers finished: one thread backed off.'
      : 'Running…';
  const o = sim.dlOutcomes;
  return (
    <div className={lessonCss.card}>
      <Kicker icon="bolt">Try it · deadlock builder</Kicker>
      <p className={lessonCss.cardQ}>Pick each thread’s lock order. The run restarts with the worst timing: both take their first lock at once.</p>
      <div className={css.pick}>
        {row(0)}
        {row(1)}
        <div className={css.pickRow}>
          <span className={css.optLabel}>second lock</span>
          <div className={css.seg} role="group" aria-label="Second lock strategy">
            <button type="button" aria-pressed={sim.dl === 'wait'} onClick={() => sim.setDL('wait')}>
              wait forever
            </button>
            <button type="button" aria-pressed={sim.dl === 'trylock'} onClick={() => sim.setDL('trylock')}>
              try-lock, back off
            </button>
          </div>
        </div>
      </div>
      <p className={`${css.status} ${sim.deadlocked ? css.statusBad : sim.roundOver ? css.statusGood : ''}`}>{status}</p>
      <Goals
        items={[
          { text: 'Fix it with one global lock order', done: o.has('ordered') },
          { text: 'Fix it with try-lock and back-off, keeping the opposite orders', done: o.has('trylock') },
        ]}
      />
      <button type="button" className={css.ghostBtn} style={{ marginLeft: 0 }} onClick={() => sim.restartRound()}>
        <Icon name="replay" size={13} /> Run again
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Check-then-act and database modes                                   */
/* ------------------------------------------------------------------ */

interface ModeSpec<M extends string> {
  id: M;
  label: string;
  note: ReactNode;
  code: CodeSpec;
}

const SEAT_MODES: ModeSpec<SeatMode>[] = [
  {
    id: 'racy',
    label: 'check, then book',
    note: (
      <>
        Both requests see <strong>free</strong> before either writes. The second write silently replaces the first.
      </>
    ),
    code: {
      title: 'book.sql · racy',
      lang: 'sql',
      code: `SELECT owner FROM seats WHERE id = '14C';
-- the app sees NULL (free), then:
!UPDATE seats SET owner = 'alice' WHERE id = '14C';`,
    },
  },
  {
    id: 'atomic',
    label: 'one conditional UPDATE',
    note: (
      <>
        The check and the write happen in <strong>one statement</strong>, which the database applies to the row atomically. The loser updates 0 rows and
        can show “sold out”.
      </>
    ),
    code: {
      title: 'book.sql · atomic',
      lang: 'sql',
      code: `!UPDATE seats SET owner = 'alice'
! WHERE id = '14C' AND owner IS NULL;
-- 1 row updated: the seat is yours
-- 0 rows updated: someone got there first`,
    },
  },
];

const BANK_MODES: ModeSpec<BankMode>[] = [
  {
    id: 'racy',
    label: 'no lock',
    note: (
      <>
        Both transactions read $100 before either writes. Each one’s check passes, and the second write clobbers the first.
      </>
    ),
    code: {
      title: 'withdraw.sql · racy',
      lang: 'sql',
      code: `BEGIN;
SELECT balance FROM accounts WHERE id = 1;  -- 100
-- the app checks 100 >= 80, then:
!UPDATE accounts SET balance = 20 WHERE id = 1;
COMMIT;`,
    },
  },
  {
    id: 'forupdate',
    label: 'FOR UPDATE',
    note: (
      <>
        <strong>Pessimistic</strong>: the first SELECT locks the row. The second one waits until COMMIT, then reads $20 and refuses.
      </>
    ),
    code: {
      title: 'withdraw.sql · pessimistic',
      lang: 'sql',
      code: `BEGIN;
!SELECT balance FROM accounts WHERE id = 1 FOR UPDATE;
-- row locked: other FOR UPDATE readers wait here
UPDATE accounts SET balance = 20 WHERE id = 1;
COMMIT;  -- releases the row lock`,
    },
  },
  {
    id: 'optimistic',
    label: 'version check',
    note: (
      <>
        <strong>Optimistic</strong>: nobody waits. The second UPDATE matches 0 rows because the version moved on, so it re-reads $20 and refuses.
      </>
    ),
    code: {
      title: 'withdraw.sql · optimistic',
      lang: 'sql',
      code: `SELECT balance, version FROM accounts WHERE id = 1;  -- 100, 7
UPDATE accounts SET balance = 20, version = 8
! WHERE id = 1 AND version = 7;
-- 0 rows updated? it changed under you: re-read, retry`,
    },
  },
];

export function ModeCard({ sim, kind }: { sim: RaceSim; kind: 'seat' | 'bank' }) {
  usePoll(sim, 150);
  const modes: ModeSpec<string>[] = kind === 'seat' ? SEAT_MODES : BANK_MODES;
  const cur: string = kind === 'seat' ? sim.seatMode : sim.bankMode;
  const m = modes.find((x) => x.id === cur) ?? modes[0];
  const pick = (id: string) => {
    if (kind === 'seat') sim.setSeatMode(id as SeatMode);
    else sim.setBankMode(id as BankMode);
  };
  return (
    <>
      <div className={lessonCss.card}>
        <Kicker icon="bolt">Try it</Kicker>
        <p className={lessonCss.cardQ}>{kind === 'seat' ? 'How should the booking code claim the seat?' : 'How should each withdrawal protect the row?'}</p>
        <div className={css.seg} role="group" aria-label="Mode">
          {modes.map((x) => (
            <button key={x.id} type="button" aria-pressed={x.id === cur} onClick={() => pick(x.id)}>
              {x.label}
            </button>
          ))}
        </div>
        <p key={m.id} className={css.note}>
          {m.note}
        </p>
        {sim.result && sim.roundOver && <p className={`${css.status} ${sim.result.ok ? css.statusGood : css.statusBad}`}>{sim.result.text}</p>}
      </div>
      <CodeBlock spec={m.code} />
    </>
  );
}
