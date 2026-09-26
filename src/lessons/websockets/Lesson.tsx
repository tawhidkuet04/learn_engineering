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
import { Legend, type LegendItem } from '@/components/stage/chrome';
import { Callouts } from '@/components/stage/overlays';
import { SIG } from '@/lib/sim/colors';
import { CHAPTERS, META } from './chapters';
import { StageOverlay } from './Overlay';
import { AfterPredict, CheatSheet, IntervalCard, Playground, RaceCard } from './Panel';
import { Scene } from './Scene';
import { DEFAULTS, EMPTY, PIPE, WsSim, type Cfg } from './sim';
import type { Chapter, Step } from './types';

const LESSON_META: LessonMeta = META;

function configOf({ step, chapter }: { step: Step; chapter: Chapter }): Cfg {
  return { ...DEFAULTS, ...chapter.cfg, ...step.cfg, strip: !!step.strip };
}

/** The playground's legend follows whatever transport is running. */
function liveLegend(sim: WsSim): LegendItem[] {
  const c = sim.cfg;
  if (c.mode === 'ws') {
    const out: LegendItem[] = [{ label: 'WebSocket frame', color: SIG.req, shape: 'square' }];
    if (c.heartbeat) out.push({ label: 'ping / pong', color: SIG.hc, shape: 'small' });
    if (c.servers === 2 && c.backplane) out.push({ label: 'Redis pub/sub', color: SIG.hc });
    out.push({ label: 'open WebSocket', color: PIPE, shape: 'line' });
    return out;
  }
  if (c.mode === 'sse') {
    return [
      { label: 'HTTP request', color: SIG.req },
      { label: 'event', color: SIG.res, shape: 'square' },
      { label: 'open event stream', color: PIPE, shape: 'line' },
    ];
  }
  return [
    { label: 'HTTP request', color: SIG.req },
    { label: 'response with messages', color: SIG.res },
    { label: 'empty response', color: EMPTY },
  ];
}

export default function WebsocketsLesson() {
  const [sim] = useState(() => new WsSim());
  const player = useLessonPlayer(CHAPTERS, (entry: PlayerEntry<Step, Chapter>) => {
    const { step } = entry;
    sim.enter(configOf(entry), step.script ?? [], { predict: step.predict?.kind ?? null, needed: step.predict?.needed });
  });
  const { step, chapter } = player;
  const cfg = configOf({ step, chapter });

  const actions = step.actions && (
    <ActionsCard
      key={`${player.stepKey}-actions`}
      prompt={step.actions.prompt}
      buttons={step.actions.buttons.map((b) => ({ label: b.label, icon: b.icon, after: b.after, run: () => b.run(sim) }))}
    />
  );

  const panel = (
    <HighlightContext.Provider value={player.setHighlight}>
      <Prose>{step.body}</Prose>
      {step.predict && <PredictCard key={`${player.stepKey}-predict`} game={() => sim.game} sim={sim} prompt={step.predict.prompt} />}
      {actions &&
        (step.actions?.afterPredict ? (
          <AfterPredict key={`${player.stepKey}-gate`} sim={sim}>
            {actions}
          </AfterPredict>
        ) : (
          actions
        ))}
      {step.toggle && (
        <ToggleCard
          key={`${player.stepKey}-toggle`}
          prompt={step.toggle.prompt}
          initial={step.toggle.initial}
          options={step.toggle.options.map((o) => ({ label: o.label, note: o.note, apply: () => o.apply(sim) }))}
        />
      )}
      {step.interval && <IntervalCard key={`${player.stepKey}-interval`} sim={sim} initial={cfg.interval} />}
      {step.race && <RaceCard key={`${player.stepKey}-race`} sim={sim} initial={cfg.interval} />}
      {step.playground && <Playground key={`${player.stepKey}-playground`} sim={sim} />}
      {step.cheat && <CheatSheet />}
      {step.quiz && <QuizCard key={`${player.stepKey}-quiz`} quiz={step.quiz} />}
      {step.code && <CodeBlock spec={step.code} />}
      {step.code2 && <CodeBlock spec={step.code2} />}
    </HighlightContext.Provider>
  );

  const overlay = () => {
    const land = sim.orient === 'landscape';
    const callouts = (step.callouts ?? []).filter((c) => land || !c.landOnly).map((c) => ({ ...c, dir: !land && c.pdir ? c.pdir : c.dir }));
    const legend = step.playground ? liveLegend(sim) : (step.legend ?? []);
    return (
      <>
        <StageOverlay sim={sim} hud={step.hud} readouts={step.readouts} strip={step.strip} hint={step.hint} />
        <Callouts sim={sim} callouts={callouts} stepKey={player.stepKey} resolve={(t) => sim.calloutRect(t)} />
        {(land || !step.strip) && <Legend items={legend} />}
      </>
    );
  };

  const stage = (
    <LessonStage
      sim={sim}
      player={player}
      meta={LESSON_META}
      scene={() => <Scene sim={sim} highlight={player.highlight} focus={step.focus ?? null} />}
      overlay={overlay}
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
