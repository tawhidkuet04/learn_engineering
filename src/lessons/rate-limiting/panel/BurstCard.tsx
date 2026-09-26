'use client';

import type { ReactNode } from 'react';
import { Icon, type IconName } from '@/components/lesson/Icon';
import { lessonCss } from '@/components/lesson/Prose';
import { usePoll } from '@/components/lesson/usePoll';
import css from './panel.module.css';

export interface BurstButton {
  label: string;
  icon?: IconName;
  run: () => void;
}

/**
 * "Your turn" card with action buttons, live stats and a goal message.
 * (The kit's ActionsCard has static feedback; this one polls the sim.)
 */
export function LiveActionsCard({
  poll,
  prompt,
  buttons,
  stats,
  goal,
  kicker = 'Your turn',
}: {
  poll: { rev: number };
  prompt?: ReactNode;
  buttons: BurstButton[];
  stats?: () => ReactNode;
  /** Return a message once the goal is reached, null until then */
  goal?: () => ReactNode;
  kicker?: string;
}) {
  usePoll(poll, 150);
  const reached = goal?.();
  return (
    <div className={lessonCss.card}>
      <div className={css.head}>
        <div className={lessonCss.cardKicker}>
          <Icon name="bolt" size={13} /> {kicker}
        </div>
      </div>
      {prompt && <p className={lessonCss.cardQ}>{prompt}</p>}
      <div className={css.row}>
        {buttons.map((b, i) => (
          <button key={b.label} type="button" className={`${css.btn} ${i === 0 ? css.btnHot : ''}`} onClick={b.run}>
            {b.icon && <Icon name={b.icon} size={14} />}
            {b.label}
          </button>
        ))}
      </div>
      {stats && <div className={css.stats}>{stats()}</div>}
      {reached && (
        <div className={css.success}>
          <strong>
            <Icon name="check" size={13} /> Done.
          </strong>
          {reached}
        </div>
      )}
    </div>
  );
}

export function Num({ label, value, tone }: { label: string; value: ReactNode; tone?: 'bad' | 'good' }) {
  return (
    <span>
      {label} <b data-tone={tone}>{value}</b>
    </span>
  );
}
