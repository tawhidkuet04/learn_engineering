'use client';

import { useState } from 'react';
import { CodeBlock } from '@/components/lesson/CodeBlock';
import { LessonShell } from '@/components/lesson/LessonShell';
import { Prose } from '@/components/lesson/Prose';
import { QuizCard } from '@/components/lesson/QuizCard';
import { HighlightContext } from '@/components/lesson/Term';
import { useLessonPlayer, type PlayerEntry } from '@/components/lesson/useLessonPlayer';
import { PlaybackControls, TitleBlock } from '@/components/stage/chrome';
import { CHAPTERS, LESSON } from './chapters';
import { DEFAULT_CONFIG } from './engine/constants';
import type { WorldConfig } from './engine/types';
import { World } from './engine/world';
import { ActionsCard, ClickServersCard, PredictCard, SliderCard, ToggleCard } from './panel/Cards';
import { Playground } from './panel/Playground';
import { Hud, Legend } from './stage/Chrome';
import { Stage } from './stage/Stage';
import type { Chapter, Step } from './types';

type Entry = PlayerEntry<Step, Chapter>;

function configOf({ step, chapter }: Entry): WorldConfig {
  return { ...DEFAULT_CONFIG, ...chapter.config, ...step.config };
}

function enterStep(world: World, entry: Entry) {
  const { step } = entry;
  const cfg = configOf(entry);
  world.enter(cfg, { reset: step.reset, script: step.script, seed: step.seed });
  step.onEnter?.(world);
  if (step.interaction?.kind === 'predict') world.startPredict(step.interaction.rounds);
}

export default function LoadBalancingLesson() {
  const [world] = useState(() => new World());
  const player = useLessonPlayer(CHAPTERS, (entry: Entry) => enterStep(world, entry));
  const { step, chapter, ci, index, playing, speed, stepKey } = player;
  const it = step.interaction;

  const onServerClick = (id: string) => {
    if (world.predict?.pending) world.answerPredict(id);
    else if (step.clickServers) world.toggleServer(id);
  };

  const panel = (
    <HighlightContext.Provider value={player.setHighlight}>
      <Prose>{step.body}</Prose>
      {step.extra}
      {it?.kind === 'predict' && <PredictCard key={stepKey} world={world} spec={it} />}
      {it?.kind === 'slider' && <SliderCard key={stepKey} world={world} spec={it} initial={configOf(player.entry).rps} />}
      {it?.kind === 'actions' && <ActionsCard key={stepKey} world={world} spec={it} />}
      {it?.kind === 'toggle' && <ToggleCard key={stepKey} world={world} spec={it} />}
      {it?.kind === 'clickServers' && <ClickServersCard key={step.id} world={world} spec={it} />}
      {it?.kind === 'playground' && <Playground key={stepKey} world={world} initial={configOf(player.entry)} />}
      {step.quiz && <QuizCard key={step.id} quiz={step.quiz} />}
      {step.code && <CodeBlock spec={step.code} />}
    </HighlightContext.Provider>
  );

  const stage = (
    <Stage
      world={world}
      playing={playing}
      speed={speed}
      focus={step.focus}
      highlight={player.highlight}
      callouts={step.callouts}
      stepKey={stepKey}
      clickableServers={!!step.clickServers}
      onServerClick={onServerClick}
      label={`Animation: ${step.title}`}
      overlay={(v) => (
        <>
          <Hud hud={v.hud} show={step.hud ?? []} />
          {!(v.brain && v.brain.anchor === 'strip') && <Legend keys={step.legend ?? []} />}
          <PlaybackControls playing={playing} onToggle={player.togglePlay} speed={speed} onSpeed={player.setSpeed} onReplay={player.replay} />
          {v.w >= 760 && (
            <TitleBlock
              code={LESSON.code}
              title={LESSON.title}
              chapter={chapter.title}
              chapterNo={ci + 1}
              step={step.title}
              stepNo={index + 1}
              total={player.total}
            />
          )}
        </>
      )}
    />
  );

  return (
    <LessonShell
      code={LESSON.code}
      track={LESSON.track}
      title={LESSON.title}
      chapters={player.shellChapters}
      index={index}
      visited={player.visited}
      onIndexChange={player.go}
      stage={stage}
      panel={panel}
      onTogglePlay={player.togglePlay}
      onReplay={player.replay}
    />
  );
}
