'use client';

import { Fragment, useState } from 'react';
import { PredictCard } from '@/components/lesson/cards';
import { CodeBlock } from '@/components/lesson/CodeBlock';
import { LessonShell } from '@/components/lesson/LessonShell';
import { LessonStage } from '@/components/lesson/LessonStage';
import { Prose } from '@/components/lesson/Prose';
import { QuizCard } from '@/components/lesson/QuizCard';
import { HighlightContext } from '@/components/lesson/Term';
import { useLessonPlayer, type PlayerEntry } from '@/components/lesson/useLessonPlayer';
import { CHAPTERS } from './chapters';
import { META } from './common';
import { Scene } from './Scene';
import { CapSim, DEFAULTS, type CapConfig } from './sim';
import { StageOverlay } from './StageOverlay';
import type { Chapter, Step } from './types';

type Entry = PlayerEntry<Step, Chapter>;

const configOf = ({ step, chapter }: Entry): CapConfig => ({ ...DEFAULTS, ...chapter.cfg, ...step.cfg });

export default function CapLesson() {
  const [sim] = useState(() => new CapSim());
  const player = useLessonPlayer(CHAPTERS, (entry: Entry) => {
    const { step } = entry;
    sim.enter(configOf(entry), { reset: step.reset ?? true, predict: step.predict?.needed, ops: step.ops, loop: step.loop, onEnter: step.onEnter });
  });
  const { step } = player;
  const codes = step.code ? (Array.isArray(step.code) ? step.code : [step.code]) : [];

  const panel = (
    <HighlightContext.Provider value={player.setHighlight}>
      <Prose>{step.body}</Prose>
      {step.predict && <PredictCard key={player.stepKey} game={() => sim.game} sim={sim} prompt={step.predict.prompt} />}
      <Fragment key={`p-${player.stepKey}`}>{step.panel?.(sim)}</Fragment>
      {step.quiz && <QuizCard key={step.id} quiz={step.quiz} />}
      <Fragment key={`x-${player.stepKey}`}>{step.extra?.(sim)}</Fragment>
      {codes.map((c) => (
        <CodeBlock key={c.title} spec={c} />
      ))}
    </HighlightContext.Provider>
  );

  return (
    <LessonShell
      code={META.code}
      track={META.track}
      title={META.title}
      chapters={player.shellChapters}
      index={player.index}
      visited={player.visited}
      onIndexChange={player.go}
      onTogglePlay={player.togglePlay}
      onReplay={player.replay}
      panel={panel}
      stage={
        <LessonStage
          sim={sim}
          player={player}
          meta={META}
          scene={() => <Scene sim={sim} focus={step.focus} highlight={player.highlight} />}
          overlay={() => <StageOverlay sim={sim} step={step} stepKey={player.stepKey} />}
        />
      }
    />
  );
}
