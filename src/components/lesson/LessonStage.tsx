'use client';

import type { ReactNode } from 'react';
import type { Sim } from '@/lib/sim/Sim';
import { Legend, PlaybackControls, TitleBlock, type LegendItem } from '@/components/stage/chrome';
import { Callouts, FxTexts, type Callout } from '@/components/stage/overlays';
import { StageFrame } from '@/components/stage/StageFrame';
import type { LessonPlayer } from './useLessonPlayer';

export interface LessonMeta {
  slug: string;
  /** Sheet code shown in the title block, e.g. "NET-03" */
  code: string;
  track: string;
  title: string;
}

/**
 * The standard lesson stage: blueprint frame + your scene, with callouts,
 * floating effect texts, legend, playback controls and the title block
 * already wired to the player.
 */
export function LessonStage({
  sim,
  player,
  meta,
  scene,
  overlay,
  callouts,
  legend = [],
  resolveCallout,
}: {
  sim: Sim;
  player: LessonPlayer;
  meta: LessonMeta;
  /** SVG content for this frame */
  scene: () => ReactNode;
  /** Extra HTML overlays (HUD, readouts, inspector cards, prompts) */
  overlay?: () => ReactNode;
  callouts?: Callout[];
  legend?: LegendItem[];
  resolveCallout?: (target: string) => { x: number; y: number; w: number; h: number } | null;
}) {
  return (
    <StageFrame
      sim={sim}
      playing={player.playing}
      speed={player.speed}
      label={`Animation: ${player.step.title}`}
      svg={scene}
      overlay={() => (
        <>
          {overlay?.()}
          <FxTexts sim={sim} />
          <Callouts sim={sim} callouts={callouts} stepKey={player.stepKey} resolve={resolveCallout} />
          <Legend items={legend} />
          <PlaybackControls playing={player.playing} onToggle={player.togglePlay} speed={player.speed} onSpeed={player.setSpeed} onReplay={player.replay} />
          {sim.w >= 760 && (
            <TitleBlock
              code={meta.code}
              title={meta.title}
              chapter={player.chapter.title}
              chapterNo={player.ci + 1}
              step={player.step.title}
              stepNo={player.index + 1}
              total={player.total}
            />
          )}
        </>
      )}
    />
  );
}
