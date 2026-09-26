'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { ShellChapter } from './LessonShell';

export interface PlayerStep {
  id: string;
  title: string;
}

export interface PlayerChapter<S extends PlayerStep> {
  id: string;
  title: string;
  steps: S[];
}

export interface PlayerEntry<S extends PlayerStep, C extends PlayerChapter<S>> {
  step: S;
  chapter: C;
  /** Chapter index */
  ci: number;
}

// The URL hash is the source of truth for the current step: /learn/<slug>#<step-id>
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

/**
 * Everything a lesson needs to drive its steps: which step is showing (synced
 * to the URL hash), play/pause/speed, replay, the narration-hover highlight,
 * and props for <LessonShell>. `enter` runs whenever a step starts or replays.
 */
export function useLessonPlayer<S extends PlayerStep, C extends PlayerChapter<S>>(chapters: C[], enter: (entry: PlayerEntry<S, C>) => void) {
  const flat = useMemo(() => chapters.flatMap((chapter, ci) => chapter.steps.map((step) => ({ step, chapter, ci }))), [chapters]);
  const hash = useSyncExternalStore(subscribeHash, readHash, serverHash);
  const hydrated = useSyncExternalStore(noop, () => true, () => false);
  const found = flat.findIndex((f) => f.step.id === hash);
  const index = found >= 0 ? found : 0;
  const [maxVisited, setMaxVisited] = useState(0);
  const visited = Math.max(maxVisited, index);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [replays, setReplays] = useState(0);

  const enterRef = useRef(enter);
  useEffect(() => {
    enterRef.current = enter;
  });

  useEffect(() => {
    if (hydrated) enterRef.current(flat[index]);
  }, [flat, index, hydrated, replays]);

  const go = useCallback(
    (i: number) => {
      const next = Math.max(0, Math.min(flat.length - 1, i));
      window.history.replaceState(null, '', `#${flat[next].step.id}`);
      window.dispatchEvent(new Event(HASH_EVENT));
      setMaxVisited((v) => Math.max(v, next));
      setPlaying(true);
      setHighlight(null);
    },
    [flat],
  );

  const togglePlay = useCallback(() => setPlaying((p) => !p), []);
  const replay = useCallback(() => {
    setReplays((r) => r + 1);
    setPlaying(true);
  }, []);

  const shellChapters: ShellChapter[] = useMemo(
    () => chapters.map((c) => ({ id: c.id, title: c.title, steps: c.steps.map((s) => ({ id: s.id, title: s.title })) })),
    [chapters],
  );

  const entry = flat[index];
  return {
    flat,
    index,
    total: flat.length,
    visited,
    entry,
    step: entry.step,
    chapter: entry.chapter,
    ci: entry.ci,
    go,
    playing,
    setPlaying,
    togglePlay,
    speed,
    setSpeed,
    replay,
    replays,
    highlight,
    setHighlight,
    /** Changes whenever the step starts over: use as a React key for step-local cards */
    stepKey: `${entry.step.id}-${replays}`,
    shellChapters,
  };
}

export type LessonPlayer = ReturnType<typeof useLessonPlayer>;
