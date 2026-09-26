'use client';

import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import type { PredictGame } from '@/lib/sim/predict';
import { Icon, type IconName } from './Icon';
import { lessonCss } from './Prose';
import { usePoll } from './usePoll';
import css from './cards.module.css';

/* Interaction cards for the narration panel. Every lesson uses these so the
   "your turn" moments look and behave the same across the whole site. */

function Kicker({ icon = 'target', children, right }: { icon?: IconName; children: ReactNode; right?: ReactNode }) {
  return (
    <div className={css.head}>
      <div className={lessonCss.cardKicker}>
        <Icon name={icon} size={13} /> {children}
      </div>
      {right}
    </div>
  );
}

/* ------------------------------------------------------------------ */

/**
 * Predict-then-reveal. Pair with a PredictGame in your sim: the sim calls
 * game.ask(question) at the right moment (which freezes it); the learner
 * answers by clicking the stage or the buttons rendered here.
 *
 * `game` is a getter because the step's game is created when the step
 * starts, which happens after this card first renders.
 */
export function PredictCard({ game: getGame, sim, prompt, onDone }: { game: () => PredictGame | null; sim: { rev: number }; prompt: ReactNode; onDone?: () => void }) {
  usePoll(sim, 100, true);
  const game = getGame();
  const done = !!game?.done;
  useEffect(() => {
    if (done) onDone?.();
    // onDone is a fire-once notification; re-running on identity change is not wanted
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done]);

  if (!game) return null;
  const q = game.pending;
  return (
    <div className={lessonCss.card}>
      <Kicker
        right={
          <span className={css.score} aria-label={`${game.correct} of ${game.needed} correct`}>
            {Array.from({ length: game.needed }, (_, i) => (
              <i key={i} data-on={i < game.correct} />
            ))}
          </span>
        }
      >
        Your turn · predict
      </Kicker>
      <p className={lessonCss.cardQ}>{prompt}</p>
      {q ? (
        q.choices ? (
          <div className={css.row}>
            {q.choices.map((c) => (
              <button key={c.id} type="button" className={`${css.btn} ${css.btnHot}`} onClick={() => game.answer(c.id)}>
                {c.label}
              </button>
            ))}
          </div>
        ) : (
          <div className={css.status}>
            <span className={css.pulse} />
            <span>
              {q.ask ?? 'Waiting for your answer.'} <strong style={{ color: 'var(--text-1)' }}>Pick on the stage.</strong>
            </span>
          </div>
        )
      ) : done ? (
        <div className={css.status}>
          <Icon name="check" size={15} />
          <span>
            <strong style={{ color: 'var(--sig-res)' }}>You&apos;ve got it.</strong> The simulation runs on its own now.
          </span>
        </div>
      ) : (
        <div className={`${css.status} ${css.waiting}`}>Watch for the next one…</div>
      )}
      {game.last && (
        <div key={game.last.key} className={css.feedback} data-ok={game.last.ok}>
          <strong>{game.last.ok ? 'Correct.' : 'Not quite.'}</strong> {game.last.text}
        </div>
      )}
      <div className={css.row}>
        {done ? (
          <button type="button" className={css.btn} onClick={() => game.restart()}>
            <Icon name="replay" size={14} /> Practice again
          </button>
        ) : (
          <button type="button" className={`${css.btn} ${css.btnGhost}`} onClick={() => game.skip()}>
            Skip, just show me
          </button>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

export interface ActionButton {
  label: string;
  icon?: IconName;
  run: () => void;
  /** Shown after this button is pressed */
  after?: ReactNode;
}

/** A row of buttons that change the simulation ("Crash the server", "Add a node"…). */
export function ActionsCard({ prompt, buttons, kicker = 'Your turn' }: { prompt?: ReactNode; buttons: ActionButton[]; kicker?: string }) {
  const [last, setLast] = useState<number | null>(null);
  const after = last != null ? buttons[last].after : null;
  return (
    <div className={lessonCss.card}>
      <Kicker icon="power">{kicker}</Kicker>
      {prompt && <p className={lessonCss.cardQ}>{prompt}</p>}
      <div className={css.row}>
        {buttons.map((b, i) => (
          <button
            key={b.label}
            type="button"
            className={`${css.btn} ${i === 0 ? css.btnHot : ''}`}
            onClick={() => {
              b.run();
              setLast(i);
            }}
          >
            {b.icon && <Icon name={b.icon} size={14} />}
            {b.label}
          </button>
        ))}
      </div>
      {after && (
        <p key={last} className={css.after}>
          {after}
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

/** Segmented control: pick one mode and apply it to the simulation. */
export function ToggleCard({ prompt, options, initial = 0, kicker = 'Try it' }: { prompt: ReactNode; options: { label: string; apply: () => void; note?: ReactNode }[]; initial?: number; kicker?: string }) {
  const [sel, setSel] = useState(initial);
  const note = options[sel]?.note;
  return (
    <div className={lessonCss.card}>
      <Kicker icon="bolt">{kicker}</Kicker>
      <p className={lessonCss.cardQ}>{prompt}</p>
      <div className={`${css.seg} ${css.segWrap}`} role="group">
        {options.map((o, i) => (
          <button
            key={o.label}
            type="button"
            aria-pressed={sel === i}
            onClick={() => {
              setSel(i);
              o.apply();
            }}
          >
            {o.label}
          </button>
        ))}
      </div>
      {note && (
        <p key={sel} className={css.after}>
          {note}
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

export interface SliderSpec {
  label: string;
  min: number;
  max: number;
  step: number;
  /** Starting value; take it from the step's config, not the live sim */
  initial: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
  /** Words under the two ends of the track */
  ends?: [string, string];
}

/** One or more sliders, plus live stats and a message once a goal is reached. */
export function SliderCard({
  sliders,
  prompt,
  stats,
  done,
  kicker = 'Try it',
  poll,
}: {
  sliders: SliderSpec[];
  prompt?: ReactNode;
  /** Live numbers under the sliders (re-rendered while the sim runs) */
  stats?: () => ReactNode;
  /** Shown once the learner reaches the goal (return null until then) */
  done?: () => ReactNode;
  kicker?: string;
  /** The sim, so stats/done refresh while it runs */
  poll?: { rev: number };
}) {
  usePoll(poll ?? { rev: 0 }, 200);
  const [vals, setVals] = useState(() => sliders.map((s) => s.initial));
  const reached = done?.();
  return (
    <div className={lessonCss.card}>
      <Kicker icon="bolt">{kicker}</Kicker>
      {prompt && <p className={lessonCss.cardQ}>{prompt}</p>}
      {sliders.map((s, i) => {
        const v = vals[i];
        const fill = ((v - s.min) / (s.max - s.min)) * 100;
        return (
          <div key={s.label}>
            <div className={css.sliderHead}>
              <span>{s.label}</span>
              <output>{s.format ? s.format(v) : v}</output>
            </div>
            <input
              className={css.range}
              type="range"
              min={s.min}
              max={s.max}
              step={s.step}
              value={v}
              style={{ '--fill': `${fill}%` } as CSSProperties}
              onChange={(e) => {
                const nv = Number(e.target.value);
                setVals((old) => old.map((o, j) => (j === i ? nv : o)));
                s.onChange(nv);
              }}
              aria-label={s.label}
            />
            {s.ends && (
              <div className={css.scale}>
                <span>{s.ends[0]}</span>
                <span>{s.ends[1]}</span>
              </div>
            )}
          </div>
        );
      })}
      {stats && <div className={css.stats}>{stats()}</div>}
      {reached && <p className={css.after}>{reached}</p>}
    </div>
  );
}

/** A bold number inside SliderCard stats; `bad` turns it red. */
export function Stat({ label, value, bad }: { label: string; value: ReactNode; bad?: boolean }) {
  return (
    <span>
      {label} <b data-bad={!!bad}>{value}</b>
    </span>
  );
}
