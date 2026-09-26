'use client';

import { useState, type ReactNode } from 'react';
import { Icon } from './Icon';
import css from './lesson.module.css';

export interface QuizSpec {
  question: ReactNode;
  options: { text: ReactNode; correct?: boolean; why: ReactNode }[];
}

export function QuizCard({ quiz }: { quiz: QuizSpec }) {
  const [picked, setPicked] = useState<number | null>(null);
  const chosen = picked == null ? null : quiz.options[picked];
  return (
    <div className={css.card}>
      <div className={css.cardKicker}>
        <Icon name="target" size={13} /> Check yourself
      </div>
      <p className={css.cardQ}>{quiz.question}</p>
      <div className={css.options}>
        {quiz.options.map((o, i) => {
          const state = picked === i ? (o.correct ? 'right' : 'wrong') : picked != null && o.correct && chosen?.correct ? 'right' : undefined;
          return (
            <button key={i} type="button" className={css.option} data-state={state} onClick={() => setPicked(i)}>
              <span className={css.optionMark}>{state === 'right' ? <Icon name="check" size={13} /> : state === 'wrong' ? <Icon name="x" size={13} /> : String.fromCharCode(65 + i)}</span>
              <span>{o.text}</span>
            </button>
          );
        })}
      </div>
      {chosen && (
        <p className={css.why} data-state={chosen.correct ? 'right' : 'wrong'}>
          <strong>{chosen.correct ? 'Exactly. ' : 'Not quite. '}</strong>
          {chosen.why}
        </p>
      )}
    </div>
  );
}
