'use client';

import { useState } from 'react';
import { PredictCard } from '@/components/lesson/cards';
import { CodeBlock } from '@/components/lesson/CodeBlock';
import { LessonShell } from '@/components/lesson/LessonShell';
import { LessonStage, type LessonMeta } from '@/components/lesson/LessonStage';
import { Prose, lessonCss } from '@/components/lesson/Prose';
import { QuizCard } from '@/components/lesson/QuizCard';
import { HighlightContext } from '@/components/lesson/Term';
import { useLessonPlayer, type PlayerEntry } from '@/components/lesson/useLessonPlayer';
import { CHAPTERS, META, type Chapter, type Step } from './chapters';
import { TcpOverlay } from './Overlay';
import { Scene } from './Scene';
import { TcpSim } from './sim';

const LESSON_META: LessonMeta = META;

export default function TcpLesson() {
  const [sim] = useState(() => new TcpSim());
  const player = useLessonPlayer(CHAPTERS, ({ step }: PlayerEntry<Step, Chapter>) => {
    sim.enter(step.cfg, step.script ?? [], step.predict ? { kind: step.predict.kind, rounds: step.predict.rounds } : undefined);
  });
  const { step } = player;
  const onSegClick = (id: number) => sim.dropSeg(id);

  const panel = (
    <HighlightContext.Provider value={player.setHighlight}>
      <Prose>{step.body}</Prose>
      {step.predict && <PredictCard key={`${player.stepKey}-predict`} game={() => sim.game} sim={sim} prompt={step.predict.prompt} />}
      {step.extra?.({ sim, stepKey: player.stepKey, replay: player.replay })}
      {step.quiz && <QuizCard key={`${player.stepKey}-quiz`} quiz={step.quiz} />}
      {step.aside && <div className={lessonCss.body}>{step.aside}</div>}
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
          meta={LESSON_META}
          scene={() => <Scene sim={sim} hl={player.highlight} onSegClick={onSegClick} />}
          overlay={() => (
            <TcpOverlay
              sim={sim}
              hud={step.hud ?? []}
              mobileHud={step.mhud}
              legend={step.legend}
              callouts={step.callouts}
              mobileCallouts={step.mcallouts}
              stepKey={player.stepKey}
            />
          )}
        />
      }
    />
  );
}
