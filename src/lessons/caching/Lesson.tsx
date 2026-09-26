'use client';

import { Fragment, useEffect, useState } from 'react';
import { PredictCard } from '@/components/lesson/cards';
import { CodeBlock } from '@/components/lesson/CodeBlock';
import { LessonShell } from '@/components/lesson/LessonShell';
import { LessonStage, type LessonMeta } from '@/components/lesson/LessonStage';
import { Prose } from '@/components/lesson/Prose';
import { QuizCard } from '@/components/lesson/QuizCard';
import { HighlightContext } from '@/components/lesson/Term';
import { useLessonPlayer, type PlayerEntry } from '@/components/lesson/useLessonPlayer';
import type { LegendItem } from '@/components/stage/chrome';
import type { Callout } from '@/components/stage/overlays';
import { SIG } from '@/lib/sim/colors';
import { CHAPTERS, LESSON } from './chapters';
import { AskPrompt, CacheHud, CacheReadout, RaceCounters, TourCard } from './overlays';
import { Scene } from './Scene';
import { CacheSim, DEFAULTS, type CacheConfig } from './sim';
import type { Chapter, LegendKey, Step } from './types';

const META: LessonMeta = LESSON;

const LEGEND: Record<LegendKey, LegendItem> = {
  req: { label: 'request', color: SIG.req },
  hit: { label: 'cache hit', color: SIG.res },
  nil: { label: 'miss (nil)', color: '#8FA6C9' },
  query: { label: 'database query', color: SIG.heavy },
  set: { label: 'SET / DEL', color: SIG.hc },
  resp: { label: 'response', color: SIG.res },
  stale: { label: 'stale price', color: SIG.err },
  write: { label: 'price change', color: SIG.warn, shape: 'square' },
  flush: { label: 'flush to DB', color: SIG.hc },
  refresh: { label: 'background refresh', color: SIG.hc, shape: 'small' },
  evict: { label: 'evicted', color: SIG.err, shape: 'ring' },
};

function configFor(step: Step, chapter: Chapter): CacheConfig {
  return { ...DEFAULTS, ...chapter.cfg, ...step.cfg };
}

/** The stage's orientation, re-rendering only when it flips (callouts and legend depend on it). */
function useStageOrient(sim: CacheSim) {
  const [orient, setOrient] = useState(sim.orient);
  useEffect(() => {
    const id = window.setInterval(() => setOrient(sim.orient), 300);
    return () => window.clearInterval(id);
  }, [sim]);
  return orient;
}

export default function CachingLesson() {
  const [sim] = useState(() => new CacheSim());
  const player = useLessonPlayer(CHAPTERS, ({ step, chapter }: PlayerEntry<Step, Chapter>) => {
    sim.enter(configFor(step, chapter), step.script ?? [], { reset: step.reset, predict: step.predict?.rounds });
  });
  const { step, chapter } = player;
  const cfg = configFor(step, chapter);
  const view = cfg.view;
  const orient = useStageOrient(sim);

  const resolveCallout = (target: string) => {
    if (target === 'row:next') return sim.rowRect('next');
    if (target.startsWith('row:')) return sim.rowRect(Number(target.slice(4)));
    if (target === 'ttl') {
      const g = sim.cacheGeom();
      if (!g) return null;
      const barW = sim.orient === 'portrait' ? 58 : 74;
      return { x: g.x0 + g.w - 12 - barW / 2 - 10, y: g.y0 + g.header / 2 + 4, w: barW + 30, h: g.header };
    }
    const b = sim.boxes.get(target);
    return b && !Number.isNaN(b.x) ? { x: b.x, y: b.y, w: b.w, h: b.h } : null;
  };

  const scene = () => (
    <Scene sim={sim} focus={step.focus} highlight={player.highlight} pickRows={step.pickRows && !!sim.game?.pending} onRowClick={(key) => sim.game?.answer(`row:${key}`)} />
  );

  const overlay = () => (
    <>
      {step.hud && <CacheHud sim={sim} keys={step.hud} />}
      {step.readout && <CacheReadout sim={sim} which={step.readout} />}
      {view === 'race' && <RaceCounters sim={sim} />}
      <TourCard sim={sim} />
      <AskPrompt sim={sim} strip={!!step.readout} />
    </>
  );

  const portrait = orient === 'portrait';
  const callouts: Callout[] = (step.callouts ?? [])
    .filter((c) => !c.only || c.only === (portrait ? 'portrait' : 'landscape'))
    .map((c) => ({ target: c.target, text: c.text, dir: portrait ? (c.pdir ?? c.dir) : c.dir }));
  const legend = portrait && step.readout ? [] : (step.legend ?? []).map((k) => LEGEND[k]);

  const panel = (
    <HighlightContext.Provider value={player.setHighlight}>
      <Prose>{step.body}</Prose>
      {step.predict && <PredictCard key={`predict-${player.stepKey}`} game={() => sim.game} sim={sim} prompt={step.predict.prompt} />}
      {step.cards && <Fragment key={`cards-${player.stepKey}`}>{step.cards(sim, { replay: player.replay, cfg })}</Fragment>}
      {step.quiz && <QuizCard key={step.id} quiz={step.quiz} />}
      {step.extra}
      {step.code?.map((c) => <CodeBlock key={c.title + step.id} spec={c} />)}
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
      stage={<LessonStage sim={sim} player={player} meta={META} scene={scene} overlay={overlay} callouts={callouts} legend={legend} resolveCallout={resolveCallout} />}
    />
  );
}
