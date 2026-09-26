'use client';

import { useState } from 'react';
import { ActionsCard, PredictCard, ToggleCard } from '@/components/lesson/cards';
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
import { CheatSheet, Playground, TokensCard } from './Panel';
import { Scene } from './Scene';
import { DEFAULTS, RingSim, type Cfg } from './sim';
import type { Chapter, Step } from './types';

const LESSON_META: LessonMeta = META;

function configOf({ step, chapter }: { step: Step; chapter: Chapter }): Cfg {
  return { ...DEFAULTS, ...chapter.cfg, ...step.cfg };
}

export default function ConsistentHashingLesson() {
  const [sim] = useState(() => new RingSim());
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
      {step.toggle && (
        <ToggleCard
          key={`${player.stepKey}-toggle`}
          prompt={step.toggle.prompt}
          initial={step.toggle.initial}
          options={step.toggle.options.map((o) => ({ label: o.label, note: o.note, apply: () => o.apply(sim) }))}
        />
      )}
      {step.tokens && <TokensCard key={`${player.stepKey}-tokens`} sim={sim} initial={cfg.tokens} />}
      {step.playground && <Playground key={`${player.stepKey}-playground`} sim={sim} initialTokens={cfg.tokens} />}
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
          <StageOverlay sim={sim} hud={step.hud} side={step.side} strip={step.strip} hint={step.hint} />
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
