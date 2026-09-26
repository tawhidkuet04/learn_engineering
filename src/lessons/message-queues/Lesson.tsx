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
import { CHAPTERS, META } from './chapters';
import { DEFAULTS, type MQConfig } from './model';
import { Overlay } from './Overlay';
import { Scene } from './Scene';
import { MQSim } from './sim';
import type { Chapter, Step } from './types';

function configOf(step: Step, chapter: Chapter): MQConfig {
  return { ...DEFAULTS, ...chapter.cfg, ...step.cfg };
}

/** SD-08 · Message Queues: producers, queues, consumers, acks, retries, fan-out and partitions. */
export default function MessageQueuesLesson() {
  const [sim] = useState(() => new MQSim());
  const player = useLessonPlayer(CHAPTERS, ({ step, chapter }: PlayerEntry<Step, Chapter>) => {
    sim.enter(configOf(step, chapter), step.script ?? [], { reset: step.reset, predict: step.predict?.needed, seed: step.seed });
  });
  const { step, chapter } = player;
  const cfg = configOf(step, chapter);

  const panel = (
    <HighlightContext.Provider value={player.setHighlight}>
      <Prose>{step.body}</Prose>
      {step.predict && <PredictCard key={player.stepKey} game={() => sim.game} sim={sim} prompt={step.predict.prompt} />}
      {step.panel && <Fragment key={player.stepKey}>{step.panel(sim, cfg)}</Fragment>}
      {step.extra}
      {step.quiz && <QuizCard key={step.id} quiz={step.quiz} />}
      {step.code && <CodeBlock spec={step.code} />}
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
          scene={() => (
            <Scene
              sim={sim}
              focus={step.focus}
              highlight={player.highlight}
              onWorker={(id) => sim.toggleWorker(id)}
              onConsumer={(id) => sim.toggleConsumer(id)}
              onPartition={(p) => sim.pickPartition(p)}
            />
          )}
          overlay={() => <Overlay sim={sim} step={step} stepKey={player.stepKey} />}
        />
      }
    />
  );
}
