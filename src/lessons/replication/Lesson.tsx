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
import { CHAPTERS, META, type Chapter, type Interaction, type Step } from './chapters';
import { Inspector, Prompt, Readouts, StageHud, StageLegend, resolveTarget } from './Overlay';
import { Playground } from './Playground';
import { Scene } from './Scene';
import { DEFAULTS, ReplSim, type ReplConfig } from './sim';

const LESSON_META: LessonMeta = META;

type Entry = PlayerEntry<Step, Chapter>;

function configOf({ step, chapter }: Entry): ReplConfig {
  const c = { ...DEFAULTS, ...chapter.cfg, ...step.cfg };
  return { ...c, strip: !!step.readout?.length };
}

export default function ReplicationLesson() {
  const [sim] = useState(() => new ReplSim());
  const player = useLessonPlayer(CHAPTERS, (entry: Entry) => {
    sim.enter(configOf(entry), entry.step.script ?? [], { reset: entry.step.reset, predict: entry.step.predict });
  });
  const { step } = player;
  const cfg = configOf(player.entry);

  const onDbClick = (id: string) => {
    const g = sim.game;
    if (g?.pending && !g.pending.choices) {
      if (sim.canPick(id)) g.answer(id);
      return;
    }
    if (step.clickDbs) sim.toggleDb(id);
  };

  const interaction = (it: Interaction, i: number) => {
    const key = `${player.stepKey}-${i}`;
    switch (it.kind) {
      case 'predict':
        return <PredictCard key={key} game={() => sim.game} sim={sim} prompt={it.prompt} />;
      case 'slider':
        return (
          <SliderCard
            key={key}
            poll={sim}
            prompt={it.prompt}
            sliders={it.sliders.map((s) => ({
              label: s.label,
              min: s.min,
              max: s.max,
              step: s.step,
              initial: s.initial(cfg),
              format: s.format,
              ends: s.ends,
              onChange: (v: number) => s.set(sim, v),
            }))}
            stats={it.stats ? () => it.stats!(sim) : undefined}
            done={it.done ? () => it.done!(sim) : undefined}
          />
        );
      case 'actions':
        return (
          <ActionsCard
            key={key}
            prompt={it.prompt}
            kicker={it.kicker}
            buttons={it.buttons.map((b) => ({ label: b.label, icon: b.icon, after: b.after, run: () => b.run(sim) }))}
          />
        );
      case 'toggle':
        return (
          <ToggleCard key={key} prompt={it.prompt} initial={it.initial} options={it.options.map((o) => ({ label: o.label, note: o.note, apply: () => o.apply(sim) }))} />
        );
      case 'playground':
        return <Playground key={key} sim={sim} initial={cfg} />;
    }
  };

  const panel = (
    <HighlightContext.Provider value={player.setHighlight}>
      <Prose>{step.body}</Prose>
      {step.extra}
      {(step.interactions ?? []).map(interaction)}
      {step.quiz && <QuizCard key={`${player.stepKey}-quiz`} quiz={step.quiz} />}
      {step.code && <CodeBlock spec={step.code} />}
    </HighlightContext.Provider>
  );

  const scene = () => <Scene sim={sim} focus={step.focus} highlight={player.highlight} onDbClick={onDbClick} clickable={!!step.clickDbs} />;

  const overlay = () => (
    <>
      <StageHud sim={sim} keys={step.hud ?? []} />
      <Readouts sim={sim} kinds={step.readout ?? []} />
      {step.inspector && <Inspector sim={sim} />}
      <Prompt sim={sim} />
      <StageLegend sim={sim} keys={step.legend ?? []} hasStrip={!!step.readout?.length} />
    </>
  );

  return (
    <LessonShell
      code={LESSON_META.code}
      track={LESSON_META.track}
      title={LESSON_META.title}
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
          scene={scene}
          overlay={overlay}
          callouts={step.callouts}
          resolveCallout={(t) => resolveTarget(sim, t)}
        />
      }
    />
  );
}
