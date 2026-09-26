'use client';

import { CodeBlock } from '@/components/lesson/CodeBlock';
import { Icon } from '@/components/lesson/Icon';
import { lessonCss } from '@/components/lesson/Prose';
import { usePoll } from '@/components/lesson/usePoll';
import type { LessonPlayer } from '@/components/lesson/useLessonPlayer';
import cards from '@/components/lesson/cards.module.css';
import { SIG } from '@/lib/sim/colors';
import type { OutLine } from './engine';
import { BLOCK_INFO, type BlockKind } from './programs';
import type { ChallengeId, EventLoopSim } from './sim';
import css from './el.module.css';

/* ------------------------------------------------------------------ */
/* Step through it: a tiny debugger                                    */
/* ------------------------------------------------------------------ */

function status(sim: EventLoopSim) {
  const m = sim.m;
  if (!m.prog) return null;
  if (m.finishedFlag && !m.busy) {
    return (
      <>
        Finished: <b>{m.out.length}</b> line{m.out.length === 1 ? '' : 's'} printed, nothing left to run.
      </>
    );
  }
  if (m.top) {
    return (
      <>
        Running <b>{m.top.label}</b>
        {m.activeLine ? (
          <>
            {' '}
            · line <b>{m.activeLine}</b>
          </>
        ) : null}{' '}
        · {m.stack.length} frame{m.stack.length === 1 ? '' : 's'} on the stack
      </>
    );
  }
  return (
    <>
      Stack empty · the event loop: <b>{m.note || 'checking the queues'}</b>
    </>
  );
}

export function StepperCard({ sim, player, prompt }: { sim: EventLoopSim; player: LessonPlayer; prompt?: string }) {
  usePoll(sim, 120);
  return (
    <div className={lessonCss.card}>
      <div className={lessonCss.cardKicker}>
        <Icon name="target" size={13} /> Step through it
      </div>
      <p className={lessonCss.cardQ}>{prompt ?? 'Pause and move one step at a time, like a debugger.'}</p>
      <div className={css.stepRow}>
        <button
          type="button"
          className={`${cards.btn} ${cards.btnHot}`}
          onClick={() => {
            player.setPlaying(false);
            sim.stepOnce();
          }}
        >
          <Icon name="right" size={14} /> Step
        </button>
        <button type="button" className={cards.btn} onClick={player.togglePlay}>
          <Icon name={player.playing ? 'pause' : 'play'} size={13} /> {player.playing ? 'Pause' : 'Play'}
        </button>
        <button type="button" className={cards.btn} onClick={() => sim.restart()}>
          <Icon name="replay" size={14} /> Restart
        </button>
      </div>
      <div className={css.stepStatus}>{status(sim)}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Playground                                                          */
/* ------------------------------------------------------------------ */

const KINDS: BlockKind[] = ['log', 'timeout', 'timeout100', 'then', 'micro', 'async', 'fetch'];

const KIND_COLOR: Record<BlockKind, string> = {
  log: SIG.text2,
  timeout: SIG.req,
  timeout100: SIG.req,
  then: SIG.hc,
  micro: SIG.hc,
  async: SIG.hc,
  fetch: SIG.teal,
};

const SRC_COLOR: Record<OutLine['src'], string> = {
  script: SIG.text2,
  task: SIG.req,
  timer: SIG.req,
  micro: SIG.hc,
  raf: SIG.res,
  io: SIG.teal,
  immediate: SIG.pink,
};

const CHALLENGES: { id: ChallengeId; title: string; text: string; hint: string }[] = [
  {
    id: 'reverse',
    title: 'Backwards',
    text: 'Make at least three letters print in exact reverse order (C B A…).',
    hint: 'Hint: what runs later than a microtask? And what runs before one?',
  },
  {
    id: 'cut',
    title: 'Cut the line',
    text: 'Schedule a timer, then a microtask below it in the code, and watch the microtask print first.',
    hint: 'Hint: setTimeout 0, then Promise.then or queueMicrotask.',
  },
  {
    id: 'split',
    title: 'Split the function',
    text: 'Get another letter to print between the two halves of an async function.',
    hint: 'Hint: add async + await, then a plain console.log below it.',
  },
];

function Chevron({ up }: { up?: boolean }) {
  return (
    <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={up ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'} />
    </svg>
  );
}

export function Playground({ sim, player }: { sim: EventLoopSim; player: LessonPlayer }) {
  usePoll(sim, 150);
  const { blocks, built, done } = sim.pg;
  const out = sim.m.out.filter((o) => sim.t - o.t > 0.34);
  return (
    <>
      <div className={lessonCss.card}>
        <div className={lessonCss.cardKicker}>
          <Icon name="code" size={13} /> Your program
        </div>
        <div className={css.blocks}>
          {blocks.length === 0 && <p className={cards.after}>Empty. Add a block below.</p>}
          {blocks.map((b, i) => (
            <div key={b.id} className={css.blockRow}>
              <i className={css.blockDot} style={{ background: KIND_COLOR[b.kind] }} />
              <span className={css.blockName}>
                {BLOCK_INFO[b.kind].label}
                <small>{BLOCK_INFO[b.kind].hint}</small>
              </span>
              <span className={css.letters}>{built.letters[i]?.join(' ')}</span>
              <button type="button" className={css.iconBtn} onClick={() => sim.pgMove(b.id, -1)} disabled={i === 0} aria-label="Move up">
                <Chevron up />
              </button>
              <button type="button" className={css.iconBtn} onClick={() => sim.pgMove(b.id, 1)} disabled={i === blocks.length - 1} aria-label="Move down">
                <Chevron />
              </button>
              <button type="button" className={css.iconBtn} onClick={() => sim.pgRemove(b.id)} aria-label="Remove">
                <Icon name="x" size={12} />
              </button>
            </div>
          ))}
        </div>
        <div className={css.palette}>
          {KINDS.map((k) => (
            <button key={k} type="button" className={css.addBtn} onClick={() => sim.pgAdd(k)} disabled={!sim.pgCanAdd(k)}>
              + {BLOCK_INFO[k].label}
              <small>{BLOCK_INFO[k].hint}</small>
            </button>
          ))}
        </div>
        <div className={css.stepRow}>
          <button
            type="button"
            className={`${cards.btn} ${cards.btnHot}`}
            onClick={() => {
              sim.restart();
              player.setPlaying(true);
            }}
          >
            <Icon name="replay" size={14} /> Run again
          </button>
          <button
            type="button"
            className={cards.btn}
            onClick={() => {
              player.setPlaying(false);
              sim.stepOnce();
            }}
          >
            <Icon name="right" size={14} /> Step
          </button>
          <button type="button" className={`${cards.btn} ${cards.btnGhost}`} onClick={() => sim.pgClear()}>
            Clear
          </button>
          <button type="button" className={`${cards.btn} ${cards.btnGhost}`} onClick={() => sim.pgReset()}>
            Reset
          </button>
        </div>
        <div className={css.outRow} aria-live="polite">
          {out.map((o, i) => (
            <span key={i} className={css.outChip} style={{ color: SRC_COLOR[o.src] }}>
              {o.text}
              <small>{o.src === 'micro' ? 'micro' : o.src}</small>
            </span>
          ))}
          {!out.length && <span className={css.stepStatus}>Console output appears here, colored by where it came from.</span>}
        </div>
      </div>

      <div className={lessonCss.card}>
        <div className={lessonCss.cardKicker}>
          <Icon name="flag" size={13} /> Challenges
        </div>
        <div className={cards.missions}>
          {CHALLENGES.map((c) => {
            const ok = done.has(c.id);
            return (
              <div key={c.id} className={cards.mission} data-done={ok}>
                <div className={cards.missionTitle}>
                  {ok && <Icon name="check" size={15} />}
                  {c.title}
                </div>
                <div className={cards.missionText}>{c.text}</div>
                {!ok && <div className={cards.missionHint}>{c.hint}</div>}
              </div>
            );
          })}
        </div>
      </div>

      <CodeBlock spec={{ title: 'playground.js · live', lang: 'js', code: built.program.code }} />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Cheat sheet                                                         */
/* ------------------------------------------------------------------ */

const ROWS: { api: string[]; q: string; color: string; when: string }[] = [
  { api: ['setTimeout', 'setInterval'], q: 'task', color: SIG.req, when: 'once the delay has passed, one task per turn' },
  { api: ['click', 'keydown', 'message', 'network events'], q: 'task', color: SIG.req, when: 'one task per turn of the loop' },
  { api: ['.then', '.catch', '.finally', 'await', 'queueMicrotask'], q: 'microtask', color: SIG.hc, when: 'right after the current task, every one of them' },
  { api: ['requestAnimationFrame'], q: 'render step', color: SIG.res, when: 'when a frame is due, just before paint' },
  { api: ['setImmediate'], q: 'Node: check', color: SIG.pink, when: 'right after the poll phase' },
  { api: ['process.nextTick'], q: 'Node: nextTick', color: SIG.hc, when: 'before promise microtasks' },
];

export function CheatSheet() {
  return (
    <>
      <div className={css.sheet}>
        {ROWS.map((r) => (
          <div key={r.api.join()} className={css.sheetRow}>
            <div className={css.sheetApi}>
              {r.api.map((a) => (
                <code key={a}>{a}</code>
              ))}
            </div>
            <div className={css.sheetWhen}>
              <span className={css.qTag} style={{ color: r.color }}>
                {r.q}
              </span>
              {r.when}
            </div>
          </div>
        ))}
      </div>
      <p className={cards.subhead}>Remember</p>
      <ul className={cards.takeaways}>
        <li>
          <strong>One thread, one call stack.</strong> A running task is never interrupted.
        </li>
        <li>
          The loop: <strong>one task → every microtask → render if a frame is due</strong> → repeat.
        </li>
        <li>
          <strong>Microtasks drain completely</strong>, even as they refill. Great for consistency, dangerous in a loop.
        </li>
        <li>
          <strong>await pauses the function, not the thread.</strong> The rest of the function is a microtask continuation.
        </li>
        <li>
          Keep tasks short (<strong>under 50 ms</strong>). Split long work with a real task boundary, or move it to a Web Worker.
        </li>
      </ul>
    </>
  );
}
