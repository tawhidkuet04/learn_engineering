'use client';

import { useState } from 'react';
import { PredictCard } from '@/components/lesson/cards';
import { CodeBlock } from '@/components/lesson/CodeBlock';
import { LessonShell } from '@/components/lesson/LessonShell';
import { LessonStage } from '@/components/lesson/LessonStage';
import { Prose } from '@/components/lesson/Prose';
import { QuizCard } from '@/components/lesson/QuizCard';
import { HighlightContext } from '@/components/lesson/Term';
import { useLessonPlayer, type PlayerEntry } from '@/components/lesson/useLessonPlayer';
import type { LegendItem } from '@/components/stage/chrome';
import { SIG } from '@/lib/sim/colors';
import { AskText, DeadlockCard, ModeCard, RunCard, SchedulerCard } from './Cards';
import { CHAPTERS, META, type Chapter, type LegendKey, type Step } from './chapters';
import { StageOverlay } from './Overlay';
import { CheatSheet, Playground } from './Recap';
import { Scene } from './Scene';
import { RaceSim } from './sim';

const LEGEND: Record<LegendKey, LegendItem> = {
  A: { label: 'Thread A', color: SIG.pink },
  B: { label: 'Thread B', color: SIG.teal },
  lost: { label: 'lost update', color: SIG.err, shape: 'ring' },
  lock: { label: 'lock', color: SIG.hc, shape: 'square' },
  atomic: { label: 'atomic step', color: SIG.warn },
  held: { label: 'held by', color: SIG.line, shape: 'line' },
  waits: { label: 'waits for', color: SIG.warn, shape: 'line' },
  money: { label: '$10 moving', color: SIG.res },
  alice: { label: 'Alice’s request', color: SIG.pink },
  bob: { label: 'Bob’s request', color: SIG.teal },
  atm: { label: 'ATM withdrawal', color: SIG.pink },
  app: { label: 'app withdrawal', color: SIG.teal },
};

export default function RaceConditionsLesson() {
  const [sim] = useState(() => new RaceSim());
  const player = useLessonPlayer(CHAPTERS, ({ step }: PlayerEntry<Step, Chapter>) => sim.enter(step.cfg));
  const { step, stepKey } = player;
  const kind = step.panel;

  const panel = (
    <HighlightContext.Provider value={player.setHighlight}>
      <Prose>{step.body}</Prose>
      {kind === 'predict-count' && <PredictCard key={stepKey} game={() => sim.game} sim={sim} prompt="Where will count end up when both threads finish?" />}
      {kind === 'predict-lock' && <PredictCard key={stepKey} game={() => sim.game} sim={sim} prompt={<AskText sim={sim} fallback="Watch the mutex. The next question comes up soon." />} />}
      {kind === 'scheduler' && <SchedulerCard key={stepKey} sim={sim} />}
      {kind === 'scheduler-lock' && <SchedulerCard key={stepKey} sim={sim} lock />}
      {kind === 'run' && <RunCard key={stepKey} sim={sim} />}
      {kind === 'run-compare' && <RunCard key={stepKey} sim={sim} compare />}
      {kind === 'deadlock' && <DeadlockCard key={stepKey} sim={sim} />}
      {kind === 'seat' && <ModeCard key={stepKey} sim={sim} kind="seat" />}
      {kind === 'bank' && <ModeCard key={stepKey} sim={sim} kind="bank" />}
      {kind === 'cheatsheet' && <CheatSheet />}
      {kind === 'playground' && <Playground key={stepKey} sim={sim} />}
      {step.aside && <Prose>{step.aside}</Prose>}
      {step.quiz && <QuizCard key={step.id} quiz={step.quiz} />}
      {step.code?.map((c) => (
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
          scene={() => <Scene sim={sim} highlight={player.highlight} pick={step.cfg.mode === 'manual'} onPick={(id) => sim.runNext(id)} />}
          overlay={() => <StageOverlay sim={sim} hud={step.hud ?? []} callouts={step.callouts ?? []} stepKey={stepKey} />}
          legend={(step.legend ?? []).map((k) => LEGEND[k])}
        />
      }
    />
  );
}
