'use client';

import { useState } from 'react';
import { ActionsCard, PredictCard, SliderCard, Stat, ToggleCard, type SliderSpec } from '@/components/lesson/cards';
import { CodeBlock } from '@/components/lesson/CodeBlock';
import { LessonShell } from '@/components/lesson/LessonShell';
import { LessonStage, type LessonMeta } from '@/components/lesson/LessonStage';
import { Prose } from '@/components/lesson/Prose';
import { QuizCard } from '@/components/lesson/QuizCard';
import { HighlightContext } from '@/components/lesson/Term';
import { useLessonPlayer, type PlayerEntry } from '@/components/lesson/useLessonPlayer';
import type { LegendItem } from '@/components/stage/chrome';
import { SIG } from '@/lib/sim/colors';
import { CHAPTERS, LESSON } from './chapters';
import { PROTO_NAME } from './engine';
import { Overlay } from './Overlay';
import { TYPE_COLOR } from './page';
import { LiveAsk, LiveResults, Playground } from './Panel';
import { Scene } from './Scene';
import { DEFAULT_CFG, HttpSim, RACE, type StageCfg } from './sim';
import type { Chapter, Interaction, LegendKey, SliderKey, Step } from './types';

const META: LessonMeta = { slug: LESSON.slug, code: LESSON.code, track: LESSON.track, title: LESSON.title };

const LEGEND: Record<LegendKey, LegendItem> = {
  html: { label: 'HTML', color: TYPE_COLOR.html, shape: 'square' },
  css: { label: 'CSS', color: TYPE_COLOR.css, shape: 'square' },
  js: { label: 'JS', color: TYPE_COLOR.js, shape: 'square' },
  font: { label: 'font', color: TYPE_COLOR.font, shape: 'square' },
  img: { label: 'images', color: TYPE_COLOR.img, shape: 'square' },
  req: { label: 'request', color: SIG.req },
  res: { label: 'response', color: SIG.res },
  hs: { label: 'handshake', color: SIG.heavy },
  lost: { label: 'lost · stalled', color: SIG.err },
  ctl: { label: 'path check', color: SIG.hc },
};

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

/**
 * Callout targets: "c:name" shows on wide stages only (phones have no room
 * between the lanes and the waterfall), "p:name" everywhere. Prefixed names
 * never match a sim box, so hiding one really hides it.
 */
function resolveCallout(sim: HttpSim, t: string) {
  if (t.startsWith('p:')) return sim.resolveTarget(t.slice(2));
  if (t.startsWith('c:')) return sim.orient === 'portrait' ? null : sim.resolveTarget(t.slice(2));
  return sim.resolveTarget(t);
}

function cfgOf(step: Step, chapter: Chapter): StageCfg {
  return { ...DEFAULT_CFG, ...chapter.cfg, ...step.cfg };
}

function sliderSpec(key: SliderKey, sim: HttpSim, cfg: StageCfg): SliderSpec {
  switch (key) {
    case 'rtt':
      return {
        label: 'Round-trip time',
        min: 20,
        max: 300,
        step: 10,
        initial: cfg.rttMs,
        format: (v) => `${v} ms`,
        onChange: (v) => sim.setRtt(v),
        ends: ['same city', 'other side of the world'],
      };
    case 'loss':
      return {
        label: 'Packet loss',
        min: 0,
        max: 0.03,
        step: 0.0025,
        initial: cfg.pktLoss,
        format: (v) => `${(v * 100).toFixed(v > 0 && v < 0.01 ? 2 : 1)}%`,
        onChange: (v) => sim.setLoss(v),
        ends: ['wired', 'bad mobile'],
      };
    case 'count':
      return { label: 'Files on the page', min: 4, max: 24, step: 1, initial: cfg.count, format: (v) => `${v} files`, onChange: (v) => sim.setCount(v) };
    case 'files':
      return {
        label: 'Same bytes, split into',
        min: 4,
        max: 24,
        step: 1,
        initial: cfg.count,
        format: (v) => `${v} files`,
        onChange: (v) => sim.setCount(v),
        ends: ['bundled', 'many small files'],
      };
  }
}

function Stats({ sim, kind }: { sim: HttpSim; kind: 'load' | 'rtts' | 'race' }) {
  if (kind === 'race') {
    const f = sim.raceFinal;
    return (
      <>
        {RACE.map((k) => (
          <Stat key={k} label={PROTO_NAME[k]} value={f ? `${fmt(f[k].ms)} ms` : '…'} />
        ))}
      </>
    );
  }
  const L = sim.load;
  const ms = L.done ? L.loadMs : sim.lastMs;
  if (kind === 'rtts') {
    return (
      <>
        <Stat label="page load" value={ms != null ? `${fmt(ms)} ms` : 'loading…'} />
        <Stat label="≈ round trips" value={ms != null ? (ms / sim.cfg.rttMs).toFixed(1) : '…'} />
      </>
    );
  }
  return (
    <>
      <Stat label="requests" value={L.res.length} />
      <Stat label="page load" value={ms != null ? `${fmt(ms)} ms` : 'loading…'} />
    </>
  );
}

function InteractionCard({ it, sim, cfg }: { it: Interaction; sim: HttpSim; cfg: StageCfg }) {
  if (it.kind === 'slider') {
    return (
      <SliderCard prompt={it.prompt} sliders={it.sliders.map((k) => sliderSpec(k, sim, cfg))} poll={sim} stats={() => <Stats sim={sim} kind={it.stats} />} />
    );
  }
  if (it.kind === 'toggle') {
    return (
      <ToggleCard
        prompt={
          <>
            {it.prompt}
            {it.results && (
              <span style={{ display: 'block', marginTop: 8 }}>
                <LiveResults sim={sim} items={it.results} />
              </span>
            )}
          </>
        }
        initial={it.initial ?? 0}
        options={it.options.map((o) => ({ label: o.label, note: o.note, apply: () => sim.setCfg(o.cfg) }))}
      />
    );
  }
  if (it.kind === 'actions') {
    return <ActionsCard prompt={it.prompt} buttons={it.buttons.map((b) => ({ label: b.label, icon: b.icon, after: b.after, run: () => b.run(sim) }))} />;
  }
  return <Playground sim={sim} initial={cfg} />;
}

export default function HttpVersionsLesson() {
  const [sim] = useState(() => new HttpSim());
  const player = useLessonPlayer(CHAPTERS, ({ step, chapter }: PlayerEntry<Step, Chapter>) => {
    sim.enter(cfgOf(step, chapter), { predict: step.predict?.needed, script: step.script });
  });
  const { step, chapter } = player;
  const cfg = cfgOf(step, chapter);
  const legend = (step.legend ?? []).map((k) => LEGEND[k]);

  const panel = (
    <HighlightContext.Provider value={player.setHighlight}>
      <Prose>{step.body}</Prose>
      {step.predict && <PredictCard key={player.stepKey} game={() => sim.game} sim={sim} prompt={<LiveAsk sim={sim} fallback={step.predict.prompt} />} />}
      {step.interactions?.map((it, i) => (
        <InteractionCard key={`${player.stepKey}-${i}`} it={it} sim={sim} cfg={cfg} />
      ))}
      {step.extra}
      {step.quiz && <QuizCard key={step.id} quiz={step.quiz} />}
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
          scene={() => <Scene sim={sim} highlight={player.highlight} />}
          overlay={() => <Overlay sim={sim} hud={step.hud ?? []} />}
          callouts={step.callouts}
          legend={legend}
          resolveCallout={(t) => resolveCallout(sim, t)}
        />
      }
    />
  );
}
