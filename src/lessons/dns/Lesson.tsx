'use client';

import { useState } from 'react';
import { ActionsCard, PredictCard, SliderCard, Stat, ToggleCard } from '@/components/lesson/cards';
import { LessonShell } from '@/components/lesson/LessonShell';
import { LessonStage } from '@/components/lesson/LessonStage';
import { Prose } from '@/components/lesson/Prose';
import { QuizCard } from '@/components/lesson/QuizCard';
import { HighlightContext } from '@/components/lesson/Term';
import { useLessonPlayer, type PlayerEntry } from '@/components/lesson/useLessonPlayer';
import { Legend } from '@/components/stage/chrome';
import { CHAPTERS, META } from './chapters';
import { ContinueCard, DnsCode, Playground } from './panel';
import { LEGEND, Overlay, Scene, phoneDig, resolveTarget } from './Scene';
import { DEFAULTS, DnsSim } from './sim';
import type { Chapter, Step } from './types';

export default function DnsLesson() {
  const [sim] = useState(() => new DnsSim());
  const player = useLessonPlayer(CHAPTERS, ({ step, chapter }: PlayerEntry<Step, Chapter>) => {
    sim.enter({ ...DEFAULTS, ...chapter.cfg, ...step.cfg, hasHud: !!step.hud?.length }, { predict: step.predict, setup: step.setup, script: step.script });
  });
  const { step } = player;
  const it = step.interaction;

  const panel = (
    <HighlightContext.Provider value={player.setHighlight}>
      <Prose>{step.body}</Prose>
      {step.extra}
      {step.predict && <PredictCard key={player.stepKey} game={() => sim.game} sim={sim} prompt={step.predictPrompt ?? 'What happens next?'} />}
      {it?.kind === 'actions' && <ActionsCard key={player.stepKey} prompt={it.prompt} buttons={it.buttons.map((b) => ({ ...b, run: () => b.run(sim) }))} />}
      {it?.kind === 'toggle' && (
        <ToggleCard key={player.stepKey} prompt={it.prompt} initial={it.initial} options={it.options.map((o) => ({ ...o, apply: () => o.apply(sim) }))} />
      )}
      {it?.kind === 'ttl' && (
        <SliderCard
          key={player.stepKey}
          prompt={it.prompt}
          poll={sim}
          sliders={[{ label: 'TTL of shop.example', min: it.min, max: it.max, step: 1, initial: it.initial, format: (v) => `${v} s`, onChange: (v) => sim.setTtlA(v), ends: ['changes show fast', 'fewer queries'] }]}
          stats={() => (
            <>
              <Stat label="answered from cache" value={sim.stats.resHits} />
              <Stat label="sent to ns1.shop.example" value={sim.stats.authQueries} />
            </>
          )}
        />
      )}
      {it?.kind === 'continue' && <ContinueCard key={player.stepKey} sim={sim} prompt={it.prompt} onRestart={player.replay} />}
      {it?.kind === 'playground' && <Playground key={player.stepKey} sim={sim} />}
      {step.quiz && <QuizCard key={step.id} quiz={step.quiz} />}
      {step.code && <DnsCode spec={step.code} />}
    </HighlightContext.Provider>
  );

  // Legend drawn here (not by LessonStage) so it can step aside for the phone's bottom dock.
  const legend = () => {
    const portrait = sim.orient === 'portrait';
    const d = sim.cfg.dock;
    const docked = portrait && ((d === 'cache' && sim.cfg.cacheTable) || d === 'zone' || d === 'snoop' || (d === 'dig' && sim.cfg.dig && phoneDig(sim).overflows));
    return docked ? null : <Legend items={(step.legend ?? []).map((k) => LEGEND[k])} />;
  };

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
          scene={() => <Scene sim={sim} step={step} highlight={player.highlight} />}
          overlay={() => (
            <>
              <Overlay sim={sim} step={step} highlight={player.highlight} />
              {legend()}
            </>
          )}
          callouts={step.callouts}
          resolveCallout={(t) => resolveTarget(sim, t)}
        />
      }
    />
  );
}
