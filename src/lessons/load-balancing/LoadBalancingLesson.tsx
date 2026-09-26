'use client';

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { CodeBlock } from '@/components/lesson/CodeBlock';
import { LessonShell, type ShellChapter } from '@/components/lesson/LessonShell';
import { Prose } from '@/components/lesson/Prose';
import { QuizCard } from '@/components/lesson/QuizCard';
import { HighlightContext } from '@/components/lesson/Term';
import { CHAPTERS, LESSON } from './chapters';
import { DEFAULT_CONFIG } from './engine/constants';
import type { WorldConfig } from './engine/types';
import { World } from './engine/world';
import { ActionsCard, ClickServersCard, PredictCard, SliderCard, ToggleCard } from './panel/Cards';
import { Playground } from './panel/Playground';
import { Hud, Legend, PlaybackControls, TitleBlock } from './stage/Chrome';
import { Stage } from './stage/Stage';
import type { Chapter, Step } from './types';

interface Entry {
  step: Step;
  chapter: Chapter;
  ci: number;
}

const FLAT: Entry[] = CHAPTERS.flatMap((chapter, ci) => chapter.steps.map((step) => ({ step, chapter, ci })));

// The URL hash is the source of truth for the current step: /learn/load-balancing#least-connections
const HASH_EVENT = 'lesson:hash';
function subscribeHash(cb: () => void) {
  window.addEventListener('hashchange', cb);
  window.addEventListener(HASH_EVENT, cb);
  return () => {
    window.removeEventListener('hashchange', cb);
    window.removeEventListener(HASH_EVENT, cb);
  };
}
const readHash = () => window.location.hash.slice(1);
const serverHash = () => '';
const noop = () => () => {};

function configOf({ step, chapter }: Entry): WorldConfig {
  return { ...DEFAULT_CONFIG, ...chapter.config, ...step.config };
}

function enterStep(world: World, entry: Entry) {
  const { step } = entry;
  const cfg = configOf(entry);
  world.enter(cfg, { reset: step.reset, script: step.script, seed: step.seed });
  step.onEnter?.(world);
  if (step.interaction?.kind === 'predict') world.startPredict(step.interaction.rounds);
}

export default function LoadBalancingLesson() {
  const [world] = useState(() => new World());
  const hash = useSyncExternalStore(subscribeHash, readHash, serverHash);
  const hydrated = useSyncExternalStore(noop, () => true, () => false);
  const found = FLAT.findIndex((f) => f.step.id === hash);
  const index = found >= 0 ? found : 0;
  const [maxVisited, setMaxVisited] = useState(0);
  const visited = Math.max(maxVisited, index);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [replays, setReplays] = useState(0);

  const shellChapters: ShellChapter[] = useMemo(
    () => CHAPTERS.map((c) => ({ id: c.id, title: c.title, steps: c.steps.map((s) => ({ id: s.id, title: s.title })) })),
    [],
  );

  useEffect(() => {
    if (hydrated) enterStep(world, FLAT[index]);
  }, [world, index, hydrated, replays]);

  const go = useCallback((i: number) => {
    const next = Math.max(0, Math.min(FLAT.length - 1, i));
    window.history.replaceState(null, '', `#${FLAT[next].step.id}`);
    window.dispatchEvent(new Event(HASH_EVENT));
    setMaxVisited((v) => Math.max(v, next));
    setPlaying(true);
    setHighlight(null);
  }, []);

  const togglePlay = useCallback(() => setPlaying((p) => !p), []);
  const replay = useCallback(() => {
    setReplays((r) => r + 1);
    setPlaying(true);
  }, []);

  const { step, chapter, ci } = FLAT[index];
  const it = step.interaction;

  const onServerClick = (id: string) => {
    if (world.predict?.pending) world.answerPredict(id);
    else if (step.clickServers) world.toggleServer(id);
  };

  const panel = (
    <HighlightContext.Provider value={setHighlight}>
      <Prose>{step.body}</Prose>
      {step.extra}
      {it?.kind === 'predict' && <PredictCard key={`${step.id}-${replays}`} world={world} spec={it} />}
      {it?.kind === 'slider' && <SliderCard key={`${step.id}-${replays}`} world={world} spec={it} initial={configOf(FLAT[index]).rps} />}
      {it?.kind === 'actions' && <ActionsCard key={`${step.id}-${replays}`} world={world} spec={it} />}
      {it?.kind === 'toggle' && <ToggleCard key={`${step.id}-${replays}`} world={world} spec={it} />}
      {it?.kind === 'clickServers' && <ClickServersCard key={step.id} world={world} spec={it} />}
      {it?.kind === 'playground' && <Playground key={`${step.id}-${replays}`} world={world} initial={configOf(FLAT[index])} />}
      {step.quiz && <QuizCard key={step.id} quiz={step.quiz} />}
      {step.code && <CodeBlock spec={step.code} />}
    </HighlightContext.Provider>
  );

  const stage = (
    <Stage
      world={world}
      playing={playing}
      speed={speed}
      focus={step.focus}
      highlight={highlight}
      callouts={step.callouts}
      stepKey={`${step.id}-${replays}`}
      clickableServers={!!step.clickServers}
      onServerClick={onServerClick}
      label={`Animation: ${step.title}`}
      overlay={(v) => (
        <>
          <Hud hud={v.hud} show={step.hud ?? []} />
          {!(v.brain && v.brain.anchor === 'strip') && <Legend keys={step.legend ?? []} />}
          <PlaybackControls playing={playing} onToggle={togglePlay} speed={speed} onSpeed={setSpeed} onReplay={replay} />
          {v.w >= 760 && (
            <TitleBlock
              code={LESSON.code}
              title={LESSON.title}
              chapter={chapter.title}
              chapterNo={ci + 1}
              step={step.title}
              stepNo={index + 1}
              total={FLAT.length}
            />
          )}
        </>
      )}
    />
  );

  return (
    <LessonShell
      code={LESSON.code}
      track={LESSON.track}
      title={LESSON.title}
      chapters={shellChapters}
      index={index}
      visited={visited}
      onIndexChange={go}
      stage={stage}
      panel={panel}
      onTogglePlay={togglePlay}
      onReplay={replay}
    />
  );
}
