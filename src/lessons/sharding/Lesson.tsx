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
import { Hud, Legend } from '@/components/stage/chrome';
import { Callouts } from '@/components/stage/overlays';
import { CHAPTERS, LESSON } from './chapters';
import { hudItems, PredictPrompt, StageReadout } from './Overlay';
import { Playground } from './panel/Playground';
import { Scene } from './Scene';
import { DEFAULTS, ShardSim, type ShardConfig } from './sim';
import type { Chapter, Step } from './types';

type Entry = PlayerEntry<Step, Chapter>;

const META: LessonMeta = LESSON;

function configOf({ step, chapter }: Entry): ShardConfig {
  return { ...DEFAULTS, ...chapter.cfg, ...step.cfg };
}

export default function ShardingLesson() {
  const [sim] = useState(() => new ShardSim());
  const player = useLessonPlayer(CHAPTERS, (entry: Entry) => sim.enter(configOf(entry), entry.step.script, { seed: entry.step.seed }));
  const { step, stepKey } = player;
  const it = step.interaction;
  const cfg0 = configOf(player.entry);

  /** Callout targets like "meter:db" point at parts of a node rather than the node itself. */
  const resolveCallout = (target: string) => {
    const [part, id] = target.split(':');
    if (!id) return null;
    const b = sim.boxes.get(id);
    if (!b || Number.isNaN(b.x)) return null;
    if (part === 'meter') return { x: b.x, y: b.y + b.h / 2 + 16, w: b.w, h: 18 };
    if (part === 'tag') return { x: b.x, y: b.y - b.h / 2 - 12, w: b.w, h: 14 };
    return null;
  };

  const overlay = () => {
    const portrait = sim.orient === 'portrait';
    // On phones the readout docks where the legend would go.
    const strip = portrait && cfg0.scene === 'sharded' && cfg0.readout !== 'none';
    const callouts = (step.callouts ?? []).flatMap(({ pdir, ptarget, ...c }) => {
      if (!portrait) return [c];
      if (pdir === 'hide') return [];
      return [{ ...c, target: ptarget ?? c.target, dir: pdir ?? c.dir }];
    });
    return (
      <>
        <Hud items={hudItems(sim, step.hud ?? [])} />
        <StageReadout sim={sim} />
        <PredictPrompt sim={sim} />
        <Callouts sim={sim} callouts={callouts} stepKey={stepKey} resolve={resolveCallout} />
        {!strip && <Legend items={step.legend ?? []} />}
      </>
    );
  };

  const panel = (
    <HighlightContext.Provider value={player.setHighlight}>
      <Prose>{step.body}</Prose>
      {step.extra}
      {step.predictPrompt && <PredictCard key={stepKey} game={() => sim.game} sim={sim} prompt={step.predictPrompt} />}
      {step.quiz && <QuizCard key={step.id} quiz={step.quiz} />}
      {it?.kind === 'actions' && <ActionsCard key={stepKey} prompt={it.prompt} buttons={it.buttons.map((b) => ({ ...b, run: () => b.run(sim) }))} />}
      {it?.kind === 'toggle' && (
        <ToggleCard key={stepKey} prompt={it.prompt} initial={it.initial} options={it.options.map((o) => ({ ...o, apply: () => o.apply(sim) }))} />
      )}
      {it?.kind === 'playground' && <Playground key={stepKey} sim={sim} initialRate={cfg0.rate} />}
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
          scene={() => <Scene sim={sim} highlight={player.highlight} focus={step.focus} />}
          overlay={overlay}
        />
      }
    />
  );
}
