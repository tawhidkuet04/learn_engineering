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
import { CHAPTERS, META, type Chapter, type Step } from './chapters';
import { Overlay } from './Overlay';
import { DepthCard, Playground } from './Panels';
import { Scene } from './Scene';
import { DEFAULT_CFG, MemSim, type Cfg } from './sim';

const LESSON_META: LessonMeta = META;

const cfgOf = (step: Step): Cfg => ({ ...DEFAULT_CFG, lane: !!(step.predict || step.breakPrompt), ...step.cfg });

export default function StackHeapLesson() {
  const [sim] = useState(() => new MemSim());
  const player = useLessonPlayer(CHAPTERS, ({ step }: PlayerEntry<Step, Chapter>) => sim.enter(cfgOf(step), { predict: step.predict?.needed }));
  const { step, stepKey } = player;

  // The kit's callouts take a rectangle by its center; the sim's targets are top-left.
  const centerOf = (t: string) => {
    const r = sim.target(t);
    return r ? { x: r.x + r.w / 2, y: r.y + r.h / 2, w: r.w, h: r.h } : null;
  };

  const scene = () => <Scene sim={sim} focus={step.focus} highlight={player.highlight} />;
  const overlay = () => <Overlay sim={sim} opts={{ hud: step.hud, legend: step.legend, breakPrompt: step.breakPrompt }} />;

  const panel = (
    <HighlightContext.Provider value={player.setHighlight}>
      <Prose>{step.body}</Prose>
      {step.predict && <PredictCard key={stepKey} game={() => sim.game} sim={sim} prompt={step.predict.prompt} />}
      {step.depthSlider && <DepthCard key={`${stepKey}-depth`} sim={sim} initial={cfgOf(step).depth} />}
      {step.actions && (
        <ActionsCard
          key={`${stepKey}-actions`}
          kicker={step.actions.kicker}
          prompt={step.actions.prompt}
          buttons={step.actions.buttons.map((b) => ({ label: b.label, icon: b.icon, after: b.after, run: () => b.run(sim) }))}
        />
      )}
      {step.toggle && (
        <ToggleCard
          key={`${stepKey}-toggle`}
          prompt={step.toggle.prompt}
          initial={step.toggle.initial}
          options={step.toggle.options.map((o) => ({ label: o.label, note: o.note, apply: () => o.apply(sim) }))}
        />
      )}
      {step.playground && <Playground key={stepKey} sim={sim} />}
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
      stage={<LessonStage sim={sim} player={player} meta={LESSON_META} scene={scene} overlay={overlay} callouts={step.callouts} resolveCallout={centerOf} />}
    />
  );
}
