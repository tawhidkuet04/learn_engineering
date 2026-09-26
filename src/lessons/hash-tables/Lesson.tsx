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
import { CheatSheet, KeyCard, LoadCard, Playground } from './cards';
import { CHAPTERS, META as LESSON } from './chapters';
import { Overlay, legendFor } from './Overlay';
import { Scene } from './Scene';
import { DEFAULTS, HashSim } from './sim';
import type { Chapter, Step } from './types';

const META: LessonMeta = LESSON;

export default function HashTablesLesson() {
  const [sim] = useState(() => new HashSim());
  const player = useLessonPlayer(CHAPTERS, ({ step }: PlayerEntry<Step, Chapter>) => {
    sim.enter({ ...DEFAULTS, ...step.cfg }, step.run ?? null, { predict: step.predict?.rounds, loop: step.loop });
  });
  const { step } = player;
  const it = step.interaction;
  const cfg = { ...DEFAULTS, ...step.cfg };

  const panel = (
    <HighlightContext.Provider value={player.setHighlight}>
      <Prose>{step.body}</Prose>
      {step.predict && <PredictCard key={player.stepKey} game={() => sim.game} sim={sim} prompt={step.predict.prompt} />}
      {it?.kind === 'keys' && <KeyCard key={player.stepKey} sim={sim} prompt={it.prompt} mode={it.mode} suggestions={it.suggestions} />}
      {it?.kind === 'actions' && (
        <ActionsCard key={player.stepKey} prompt={it.prompt} buttons={it.buttons.map((b) => ({ label: b.label, icon: b.icon, after: b.after, run: () => b.run(sim) }))} />
      )}
      {it?.kind === 'toggle' && (
        <ToggleCard
          key={player.stepKey}
          prompt={it.prompt}
          initial={it.initial ?? 0}
          options={it.options.map((o) => ({ label: o.label, note: o.note, apply: () => o.apply(sim) }))}
        />
      )}
      {it?.kind === 'load' && <LoadCard key={player.stepKey} sim={sim} initial={cfg.preset.length} max={it.max} initialMode={cfg.mode} />}
      {step.quiz && <QuizCard key={step.id} quiz={step.quiz} />}
      {step.extra === 'cheat' && <CheatSheet />}
      {step.extra === 'playground' && <Playground key={player.stepKey} sim={sim} />}
      {step.code && (Array.isArray(step.code) ? step.code : [step.code]).map((c) => <CodeBlock key={c.title} spec={c} />)}
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
          overlay={() => <Overlay sim={sim} step={step} />}
          callouts={step.callouts}
          legend={legendFor(step.legend)}
          resolveCallout={(t) => sim.targetRect(t)}
        />
      }
    />
  );
}
