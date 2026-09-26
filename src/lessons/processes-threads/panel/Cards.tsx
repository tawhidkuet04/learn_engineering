'use client';

import { useState, type ReactNode } from 'react';
import { CodeBlock } from '@/components/lesson/CodeBlock';
import { Icon } from '@/components/lesson/Icon';
import { lessonCss } from '@/components/lesson/Prose';
import { usePoll } from '@/components/lesson/usePoll';
import cards from '@/components/lesson/cards.module.css';
import type { PTSim } from '../sim';
import type { ModeOption } from '../types';

/**
 * A segmented toggle that reconfigures the simulation and swaps the
 * real-world code underneath to match the selected option.
 */
export function ModeCard({ sim, prompt, options, initial = 0 }: { sim: PTSim; prompt: ReactNode; options: ModeOption[]; initial?: number }) {
  const [sel, setSel] = useState(initial);
  const opt = options[sel];
  return (
    <>
      <div className={lessonCss.card}>
        <div className={lessonCss.cardKicker}>
          <Icon name="bolt" size={13} /> Try it
        </div>
        <p className={lessonCss.cardQ}>{prompt}</p>
        <div className={`${cards.seg} ${cards.segWrap}`} role="group">
          {options.map((o, i) => (
            <button
              key={o.label}
              type="button"
              aria-pressed={sel === i}
              onClick={() => {
                setSel(i);
                o.apply(sim);
              }}
            >
              {o.label}
            </button>
          ))}
        </div>
        {opt?.note && (
          <p key={sel} className={cards.after}>
            {opt.note}
          </p>
        )}
      </div>
      {opt?.code && <CodeBlock key={`code-${sel}`} spec={opt.code} />}
    </>
  );
}

/** Renders its children once the step's prediction game is finished. */
export function WhenPredicted({ sim, children }: { sim: PTSim; children: ReactNode }) {
  usePoll(sim, 200);
  if (sim.game && !sim.game.done) return null;
  return <>{children}</>;
}
