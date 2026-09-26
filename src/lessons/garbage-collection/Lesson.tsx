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
import { Callouts } from '@/components/stage/overlays';
import { CHAPTERS, LESSON, type Chapter, type Interaction, type Step } from './chapters';
import { GcOverlay } from './Overlay';
import { CheatSheet, Playground } from './panel';
import { GcScene } from './Scene';
import { GcSim } from './sim';
import { DEFAULTS, type GcConfig } from './types';

const META: LessonMeta = LESSON;

type Entry = PlayerEntry<Step, Chapter>;

function configOf({ step, chapter }: Entry): GcConfig {
  return { ...DEFAULTS, ...chapter.cfg, ...step.cfg, ro: !!step.readout || !!step.cfg?.ro };
}

function InteractionCard({ it, sim, cfg }: { it: Interaction; sim: GcSim; cfg: GcConfig }) {
  switch (it.kind) {
    case 'actions':
      return (
        <ActionsCard
          prompt={it.prompt}
          kicker={it.kicker}
          buttons={it.buttons.map((b) => ({ label: b.label, icon: b.icon, run: () => b.run(sim), after: b.after }))}
        />
      );
    case 'toggle':
      return (
        <ToggleCard
          prompt={it.prompt}
          kicker={it.kicker}
          initial={it.initial}
          options={it.options.map((o) => ({ label: o.label, apply: () => o.apply(sim), note: o.note }))}
        />
      );
    case 'slider': {
      const { stats, done } = it;
      return (
        <SliderCard
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
            onChange: (v: number) => s.apply(sim, v),
          }))}
          stats={stats ? () => stats(sim) : undefined}
          done={done ? () => done(sim) : undefined}
        />
      );
    }
    case 'playground':
      return <Playground sim={sim} />;
  }
}

export default function GarbageCollectionLesson() {
  const [sim] = useState(() => new GcSim());
  const player = useLessonPlayer(CHAPTERS, (entry: Entry) => {
    const { step } = entry;
    sim.enter(configOf(entry), step.script ?? [], { reset: step.reset ?? true, predict: step.predict?.needed, seed: step.seed });
  });
  const { step } = player;
  const cfg = configOf(player.entry);

  const resolveCallout = (t: string) => {
    const g = sim.g;
    if ((t === 'heap' || t === 'heap:used') && g.strip) {
      const s = g.strip;
      const used = t === 'heap:used' ? Math.max(1, ...sim.heapObjs().map((o) => o.addr + o.size)) : s.cols * s.rows;
      const w = (s.rows > 1 ? s.cols : Math.min(s.cols, used)) * s.cw;
      const h = s.rows * s.ch + (s.rows - 1) * s.rowGap + 14;
      return { x: s.x + w / 2, y: s.y + h / 2, w, h };
    }
    if (t === 'chart' && g.chart) return { x: g.chart.x + g.chart.w / 2, y: g.chart.y + g.chart.h / 2, w: g.chart.w, h: g.chart.h };
    if (t.startsWith('zone:')) {
      const k = t.slice(5) as 'young' | 'old' | 'heap';
      const r = g.frames[k];
      if (r) return { x: r.x + r.w / 2, y: r.y + r.h / 2, w: r.w, h: r.h };
    }
    if (t.startsWith('glabel:')) {
      const o = sim.gen.objs.find((x) => x.label === t.slice(7) && !x.freed);
      const b = o && sim.boxes.get(o.id);
      if (b) return { x: b.x, y: b.y, w: b.w, h: b.h };
    }
    return null;
  };

  const highlight = (() => {
    const h = player.highlight;
    if (h?.startsWith('glabel:')) {
      const o = sim.gen.objs.find((x) => x.label === h.slice(7) && !x.freed);
      return o ? o.id : h;
    }
    return h;
  })();

  const panel = (
    <HighlightContext.Provider value={player.setHighlight}>
      <Prose>{step.body}</Prose>
      {step.extra === 'cheat' ? <CheatSheet /> : step.extra}
      {step.predict && <PredictCard key={player.stepKey} game={() => sim.game} sim={sim} prompt={step.predict.prompt} />}
      {step.interactions?.map((it, i) => (
        <InteractionCard key={`${player.stepKey}-${i}`} it={it} sim={sim} cfg={cfg} />
      ))}
      {step.quiz && <QuizCard key={step.id} quiz={step.quiz} />}
      {step.code && <CodeBlock spec={step.code} />}
    </HighlightContext.Provider>
  );

  const stage = (
    <LessonStage
      sim={sim}
      player={player}
      meta={META}
      scene={() => <GcScene sim={sim} highlight={highlight} focus={step.focus} />}
      overlay={() => (
        <>
          <GcOverlay sim={sim} hud={step.hud ?? []} readout={step.readout} />
          <Callouts
            sim={sim}
            callouts={(step.callouts ?? []).filter((c) => !c.land || sim.orient === 'landscape')}
            stepKey={player.stepKey}
            resolve={resolveCallout}
          />
          <Legend items={sim.orient === 'portrait' && step.readout ? [] : (step.legend ?? [])} />
        </>
      )}
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
