'use client';

import { useState } from 'react';
import { ActionsCard, PredictCard } from '@/components/lesson/cards';
import { CodeBlock } from '@/components/lesson/CodeBlock';
import { LessonShell } from '@/components/lesson/LessonShell';
import { LessonStage, type LessonMeta } from '@/components/lesson/LessonStage';
import { Prose } from '@/components/lesson/Prose';
import { QuizCard } from '@/components/lesson/QuizCard';
import { HighlightContext } from '@/components/lesson/Term';
import { useLessonPlayer, type PlayerEntry } from '@/components/lesson/useLessonPlayer';
import { Legend } from '@/components/stage/chrome';
import { CHAPTERS, META } from './chapters';
import { StageOverlay } from './Overlay';
import { CheatSheet, Playground, PrefixCard } from './Panel';
import { Scene } from './Scene';
import { DEFAULTS, NatSim, type Cfg } from './sim';
import type { Chapter, Step } from './types';

const LESSON_META: LessonMeta = META;

function configOf({ step, chapter }: { step: Step; chapter: Chapter }): Cfg {
  return { ...DEFAULTS, ...chapter.cfg, ...step.cfg };
}

export default function NatLesson() {
  const [sim] = useState(() => new NatSim());
  const player = useLessonPlayer(CHAPTERS, (entry: PlayerEntry<Step, Chapter>) => {
    const { step } = entry;
    sim.enter(configOf(entry), step.script ?? [], { predict: step.predict?.kind ?? null, needed: step.predict?.needed });
  });
  const { step, chapter } = player;
  const cfg = configOf({ step, chapter });

  const panel = (
    <HighlightContext.Provider value={player.setHighlight}>
      <Prose>{step.body}</Prose>
      {step.predict && <PredictCard key={`${player.stepKey}-predict`} game={() => sim.game} sim={sim} prompt={step.predict.prompt} />}
      {step.actions && (
        <ActionsCard
          key={`${player.stepKey}-actions`}
          prompt={step.actions.prompt}
          buttons={step.actions.buttons.map((b) => ({ label: b.label, icon: b.icon, after: b.after, run: () => b.run(sim) }))}
        />
      )}
      {step.prefixCard && <PrefixCard key={`${player.stepKey}-prefix`} sim={sim} initial={cfg.prefix} />}
      {step.playground && <Playground key={`${player.stepKey}-playground`} sim={sim} initialTimeout={cfg.timeout} />}
      {step.cheat && <CheatSheet />}
      {step.quiz && <QuizCard key={`${player.stepKey}-quiz`} quiz={step.quiz} />}
      {step.code && <CodeBlock spec={step.code} />}
      {step.code2 && <CodeBlock spec={step.code2} />}
    </HighlightContext.Provider>
  );

  const stage = (
    <LessonStage
      sim={sim}
      player={player}
      meta={LESSON_META}
      scene={() => <Scene sim={sim} highlight={player.highlight} />}
      overlay={() => (
        <>
          <StageOverlay
            sim={sim}
            hud={step.hud}
            side={step.side}
            strip={step.strip}
            hint={step.hint && !step.hintDone?.(sim) ? step.hint : null}
            inspect={step.inspect}
          />
          {(sim.orient === 'landscape' || !step.strip) && <Legend items={step.legend ?? []} />}
        </>
      )}
      callouts={step.callouts}
      resolveCallout={(t) => sim.calloutRect(t)}
    />
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
      stage={stage}
    />
  );
}
