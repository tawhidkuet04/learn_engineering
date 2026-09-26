'use client';

import { useState } from 'react';
import { ActionsCard, PredictCard, SliderCard, ToggleCard } from '@/components/lesson/cards';
import { CodeBlock } from '@/components/lesson/CodeBlock';
import { LessonShell } from '@/components/lesson/LessonShell';
import { LessonStage, type LessonMeta } from '@/components/lesson/LessonStage';
import { Prose } from '@/components/lesson/Prose';
import { QuizCard } from '@/components/lesson/QuizCard';
import { HighlightContext } from '@/components/lesson/Term';
import { useLessonPlayer, type PlayerEntry } from '@/components/lesson/useLessonPlayer';
import { Legend } from '@/components/stage/chrome';
import { CHAPTERS, META } from './chapters';
import { stripH } from './layout';
import { StageOverlay } from './Overlay';
import { ChartCard, CheatSheet, Playground, RulesCard, ScanSizeCard } from './Panel';
import { Scene } from './Scene';
import { BigOSim, DEFAULTS, type Cfg } from './sim';
import type { Chapter, Step } from './types';

const LESSON_META: LessonMeta = META;

function configOf({ step, chapter }: { step: Step; chapter: Chapter }): Cfg {
  return { ...DEFAULTS, ...chapter.cfg, ...step.cfg };
}

export default function BigOLesson() {
  const [sim] = useState(() => new BigOSim());
  const player = useLessonPlayer(CHAPTERS, (entry: PlayerEntry<Step, Chapter>) => {
    const { step } = entry;
    sim.enter(configOf(entry), step.script ?? [], {
      predict: step.predict?.kind ?? null,
      needed: step.predict?.needed,
      legend: (step.legend ?? []).map((l) => l.label),
    });
  });
  const { step, chapter } = player;
  const cfg = configOf({ step, chapter });
  const k = player.stepKey;

  const panel = (
    <HighlightContext.Provider value={player.setHighlight}>
      <Prose>{step.body}</Prose>
      {step.predict && <PredictCard key={`${k}-predict`} game={() => sim.game} sim={sim} prompt={step.predict.prompt} />}
      {step.actions && (
        <ActionsCard
          key={`${k}-actions`}
          prompt={step.actions.prompt}
          buttons={step.actions.buttons.map((b) => ({ label: b.label, icon: b.icon, after: b.after, run: () => b.run(sim) }))}
        />
      )}
      {step.toggle && (
        <ToggleCard
          key={`${k}-toggle`}
          prompt={step.toggle.prompt}
          initial={step.toggle.initial}
          options={step.toggle.options.map((o) => ({ label: o.label, note: o.note, apply: () => o.apply(sim) }))}
        />
      )}
      {step.slider && (
        <SliderCard
          key={`${k}-slider`}
          poll={sim}
          prompt={step.slider.prompt}
          sliders={[
            {
              label: step.slider.label,
              min: step.slider.min,
              max: step.slider.max,
              step: step.slider.step,
              initial: cfg.n,
              format: step.slider.format,
              ends: step.slider.ends,
              onChange: (v) => step.slider?.set(sim, v),
            },
          ]}
          stats={step.slider.stats ? () => step.slider?.stats?.(sim) : undefined}
        />
      )}
      {step.card === 'scanSize' && <ScanSizeCard key={`${k}-size`} sim={sim} />}
      {step.card === 'chart' && <ChartCard key={`${k}-chart`} sim={sim} initialN={cfg.n} initialLog={cfg.log} />}
      {step.card === 'rules' && <RulesCard key={`${k}-rules`} sim={sim} />}
      {step.card === 'playground' && <Playground key={`${k}-pg`} sim={sim} initialN={cfg.n} />}
      {step.cheat && <CheatSheet />}
      {step.quiz && <QuizCard key={`${k}-quiz`} quiz={step.quiz} />}
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
          <StageOverlay sim={sim} hud={step.hud} />
          {(sim.orient === 'landscape' || !stripH(sim)) && <Legend items={step.legend ?? []} />}
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
