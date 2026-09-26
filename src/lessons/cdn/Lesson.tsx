'use client';

import { useState } from 'react';
import { ActionsCard, PredictCard, SliderCard, Stat, ToggleCard } from '@/components/lesson/cards';
import { CodeBlock } from '@/components/lesson/CodeBlock';
import { LessonShell } from '@/components/lesson/LessonShell';
import { LessonStage } from '@/components/lesson/LessonStage';
import { Prose } from '@/components/lesson/Prose';
import { QuizCard } from '@/components/lesson/QuizCard';
import { HighlightContext } from '@/components/lesson/Term';
import { useLessonPlayer, type PlayerEntry } from '@/components/lesson/useLessonPlayer';
import { Hud, Legend } from '@/components/stage/chrome';
import { Callouts, StagePrompt } from '@/components/stage/overlays';
import { CHAPTERS, META } from './chapters';
import { Readouts, TourInspector, calloutRect, hudItems, readoutRect } from './Overlay';
import { Playground, PopsCard } from './panel';
import { MapScene } from './Scene';
import { SequenceScene } from './Sequence';
import { CdnSim, DEFAULTS, type CdnConfig } from './sim';
import type { Chapter, Interaction, Step } from './types';

function configOf(step: Step, chapter: Chapter): CdnConfig {
  return { ...DEFAULTS, ...chapter.cfg, ...step.cfg };
}

/** Keep the yellow prompt pill (11px mono, ~6.7px per character) on the stage. */
function clampPrompt(x: number, text: string, w: number) {
  const half = (text.length * 6.7 + 22) / 2 + 8;
  return Math.min(Math.max(x, half), w - half);
}

function InteractionCard({ it, sim, cfg }: { it: Interaction; sim: CdnSim; cfg: CdnConfig }) {
  switch (it.kind) {
    case 'toggle':
      return <ToggleCard prompt={it.prompt} initial={it.initial} options={it.options.map((o) => ({ label: o.label, note: o.note, apply: () => o.apply(sim) }))} />;
    case 'slider':
      return (
        <SliderCard
          poll={sim}
          prompt={it.prompt}
          sliders={it.sliders.map((s) => ({ ...s, onChange: (v: number) => s.onChange(sim, v) }))}
          stats={() =>
            it.stats ? (
              it.stats(sim)
            ) : (
              <>
                <Stat label="hits" value={sim.hits} />
                <Stat label="to origin" value={sim.originFetches} />
              </>
            )
          }
        />
      );
    case 'actions':
      return <ActionsCard prompt={it.prompt} buttons={it.buttons.map((b) => ({ label: b.label, icon: b.icon, after: b.after, run: () => b.run(sim) }))} />;
    case 'pops':
      return <PopsCard sim={sim} prompt={it.prompt} />;
    case 'playground':
      return <Playground sim={sim} initial={cfg} />;
    default:
      return null;
  }
}

export default function CdnLesson() {
  const [sim] = useState(() => new CdnSim());
  const player = useLessonPlayer(CHAPTERS, ({ step, chapter }: PlayerEntry<Step, Chapter>) => {
    sim.enter(configOf(step, chapter), step.script ?? [], { reset: step.reset ?? true, predict: step.predict?.rounds });
    step.onEnter?.(sim);
  });
  const { step, chapter } = player;
  const cfg = configOf(step, chapter);
  const interactions = step.interactions ?? [];
  const clickPops = interactions.some((i) => i.kind === 'pops' || i.kind === 'playground');

  const scene = () =>
    sim.cfg.view === 'sequence' ? (
      <SequenceScene sim={sim} />
    ) : (
      <MapScene
        sim={sim}
        highlight={player.highlight}
        focus={step.focus}
        route={step.route}
        showLoad={step.showLoad}
        onPop={clickPops ? (p) => sim.togglePop(p) : undefined}
      />
    );

  const overlay = () => {
    const portrait = sim.orient === 'portrait';
    const map = sim.cfg.view === 'map';
    const tour = map && sim.cfg.mode === 'tour';
    const chosen = portrait && step.readoutPortrait !== undefined ? step.readoutPortrait : step.readout;
    // Chips beside each PoP already show the caches on a big stage.
    const readout = chosen === 'caches' && !portrait ? undefined : (chosen ?? undefined);
    const strip = portrait && map && (!!readout || tour);
    const q = sim.game?.pending;
    const at = q?.askAt && 'id' in q.askAt ? sim.boxes.get(q.askAt.id) : null;
    const box = readout && !portrait ? readoutRect(sim, readout) : null;
    const callouts = (portrait ? (step.calloutsPortrait ?? step.callouts) : step.callouts)?.filter((c) => {
      // On smaller stages a readout can end up where a callout's text would go: drop the callout.
      const r = box && calloutRect(sim, c.target, c.dir);
      return !(r && box && r.x0 < box.x1 && r.x1 > box.x0 && r.y0 < box.y1 && r.y1 > box.y0);
    });
    return (
      <>
        {map && step.hud && <Hud items={hudItems(sim, step.hud)} />}
        {map && readout && !(portrait && tour) && <Readouts sim={sim} kind={readout} />}
        {tour && <TourInspector sim={sim} />}
        {q && at && (
          <StagePrompt x={clampPrompt(at.x, q.ask ?? '', sim.w)} y={at.y - at.h / 2 - (portrait ? 14 : 22)}>
            {q.ask}
          </StagePrompt>
        )}
        {map && <Callouts sim={sim} callouts={callouts} stepKey={player.stepKey} />}
        <Legend items={strip ? [] : (step.legend ?? [])} />
      </>
    );
  };

  const panel = (
    <HighlightContext.Provider value={player.setHighlight}>
      <Prose>{step.body}</Prose>
      {step.extra}
      {step.predict && <PredictCard key={player.stepKey} game={() => sim.game} sim={sim} prompt={step.predict.prompt} />}
      {interactions.map((it, i) => (
        <InteractionCard key={`${player.stepKey}-${i}`} it={it} sim={sim} cfg={cfg} />
      ))}
      {step.quiz && <QuizCard key={player.stepKey} quiz={step.quiz} />}
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
      stage={<LessonStage sim={sim} player={player} meta={META} scene={scene} overlay={overlay} />}
    />
  );
}
