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
import { CheatSheet, Playground, WsSliderCard } from './Panel';
import { Scene } from './Scene';
import { CacheSim, DEFAULTS, type Cfg } from './sim';
import type { Chapter, Step } from './types';

const LESSON_META: LessonMeta = META;

function configOf({ step, chapter }: { step: Step; chapter: Chapter }): Cfg {
  return { ...DEFAULTS, ...chapter.cfg, ...step.cfg };
}

export default function CpuCachesLesson() {
  const [sim] = useState(() => new CacheSim());
  const player = useLessonPlayer(CHAPTERS, (entry: PlayerEntry<Step, Chapter>) => {
    const { step } = entry;
    sim.enter(configOf(entry), step.script ?? [], { predict: step.predict?.kind ?? null, needed: step.predict?.needed });
  });
  const { step, chapter, stepKey } = player;
  const cfg = configOf({ step, chapter });

  const panel = (
    <HighlightContext.Provider value={player.setHighlight}>
      <Prose>{step.body}</Prose>
      {step.predict && <PredictCard key={`${stepKey}-predict`} game={() => sim.game} sim={sim} prompt={step.predict.prompt} />}
      {step.toggle && (
        <ToggleCard
          key={`${stepKey}-toggle`}
          kicker={step.toggle.kicker}
          prompt={step.toggle.prompt}
          initial={step.toggle.initial}
          options={step.toggle.options.map((o) => ({ label: o.label, note: o.note, apply: () => o.apply(sim) }))}
        />
      )}
      {step.actions && (
        <ActionsCard
          key={`${stepKey}-actions`}
          kicker={step.actions.kicker}
          prompt={step.actions.prompt}
          buttons={step.actions.buttons.map((b) => ({ label: b.label, icon: b.icon, after: b.after, run: () => b.run(sim) }))}
        />
      )}
      {step.wsSlider && <WsSliderCard key={`${stepKey}-ws`} sim={sim} initial={cfg.ws} />}
      {step.playground && <Playground key={`${stepKey}-pg`} sim={sim} initial={{ ways: cfg.ways, prefetch: cfg.prefetch, order: cfg.order, pace: cfg.pace }} />}
      {step.cheat && <CheatSheet />}
      {step.quiz && <QuizCard key={`${stepKey}-quiz`} quiz={step.quiz} />}
      {step.code && <CodeBlock spec={step.code} />}
      {step.code2 && <CodeBlock spec={step.code2} />}
    </HighlightContext.Provider>
  );

  const stage = (
    <LessonStage
      sim={sim}
      player={player}
      meta={LESSON_META}
      scene={() => <Scene sim={sim} highlight={player.highlight} focus={step.focus} />}
      overlay={() => (
        <>
          <StageOverlay sim={sim} hud={step.hud} side={step.side} strip={step.strip} />
          {(sim.orient === 'landscape' || (!step.strip && !step.side?.includes('human'))) && <Legend items={step.legend ?? []} />}
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
