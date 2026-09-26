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
import { Hud, Legend, type HudItem } from '@/components/stage/chrome';
import { StagePrompt } from '@/components/stage/overlays';
import { Effects } from '@/components/stage/svg';
import { clamp } from '@/lib/sim/geometry';
import { CHAPTERS, LESSON, type Chapter, type HudKey, type Step } from './chapters';
import { CodePane, ConsolePane, PAGE_CODE, PageMock, ThreadReadout } from './Overlay';
import { Playground, StepperCard } from './Panel';
import { MachineScene, Timeline, rectOf } from './Scene';
import { EventLoopSim } from './sim';

const META: LessonMeta = { slug: LESSON.slug, code: LESSON.code, track: LESSON.track, title: LESSON.title };

const fmtMs = (ms: number) => (ms < 10 ? ms.toFixed(2) : ms < 100 ? ms.toFixed(1) : Math.round(ms).toLocaleString('en-US'));

function hudItems(sim: EventLoopSim, keys: HudKey[]): HudItem[] {
  const m = sim.m;
  const th = sim.th;
  const portrait = sim.orient === 'portrait';
  const fps = th.slots.filter((s) => s.t > th.ms - 1000 && s.state === 'painted').length;
  const longest = Math.max(th.stats.longest, th.currentSpan);
  const out: HudItem[] = [];
  for (const k of keys) {
    if (k === 'clock') out.push({ label: 'Clock', value: fmtMs(m.ms), unit: 'ms' });
    if (k === 'tasks') out.push({ label: 'Tasks run', value: m.ran.task });
    if (k === 'micro') out.push({ label: 'Microtasks run', value: m.ran.micro });
    if (k === 'frames') out.push({ label: 'Frames painted', value: m.frames });
    if (k === 'fps' && !portrait) out.push({ label: 'Frame rate', value: th.ms < 400 ? '—' : fps, unit: 'fps', tone: th.ms < 400 ? undefined : fps < 20 ? 'bad' : fps < 50 ? 'warn' : 'good' });
    if (k === 'dropped') out.push({ label: portrait ? 'Dropped' : 'Frames dropped', value: th.stats.dropped, tone: th.stats.dropped > 0 ? 'bad' : undefined });
    if (k === 'delay') {
      const d = th.stats.lastDelay;
      out.push({ label: 'Input delay', value: d == null ? '—' : Math.round(d), unit: d == null ? undefined : 'ms', tone: d == null ? undefined : d > 100 ? 'bad' : d > 50 ? 'warn' : 'good' });
    }
    if (k === 'longest') out.push({ label: 'Longest task', value: Math.round(longest), unit: 'ms', tone: longest > 50 ? 'bad' : longest > 0 ? 'good' : undefined });
  }
  return out;
}

export default function EventLoopLesson() {
  const [sim] = useState(() => new EventLoopSim());
  const player = useLessonPlayer(CHAPTERS, ({ step }: PlayerEntry<Step, Chapter>) => sim.enter(step.cfg, { predict: step.predict }));
  const { step } = player;
  const it = step.interaction;

  const scene = () =>
    sim.view === 'browser' ? (
      <Timeline sim={sim} />
    ) : (
      <MachineScene sim={sim} highlight={player.highlight} focus={step.cfg.focus} onBuy={it?.kind === 'click' ? () => sim.clickBuy() : undefined} />
    );

  const overlay = () => {
    const L = sim.orient === 'landscape';
    const q = sim.game?.pending;
    const at = q?.askAt && 'id' in q.askAt ? rectOf(sim, q.askAt.id) : null;
    const m = sim.m;
    return (
      <>
        {step.hud && (L || sim.view === 'browser') && <Hud items={hudItems(sim, step.hud)} />}
        {sim.view === 'browser' ? (
          <>
            <PageMock sim={sim} />
            <svg width={sim.w} height={sim.h} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'visible' }} aria-hidden>
              <Effects sim={sim} />
            </svg>
            {L && <CodePane sim={sim} id="src" title="orders.js" code={PAGE_CODE[sim.th.mode].code} hot={PAGE_CODE[sim.th.mode].hot} tag="the page's code" />}
            {(!L || sim.g.timeline.y + sim.g.timeline.h + 90 < sim.h - 70) && <ThreadReadout sim={sim} />}
          </>
        ) : (
          <>
            {m.prog && (
              <CodePane
                sim={sim}
                title={m.prog.file}
                code={m.prog.code}
                active={m.activeLine}
                marks={m.marks}
                pending={m.pendingLines()}
                tag={m.finishedFlag ? 'done' : m.busy ? 'running' : 'waiting'}
              />
            )}
            <ConsolePane sim={sim} />
            {q && at && sim.cfg.predict === 'decide' && (() => {
              // Desktop: between the two queue heads. Phone: at the top of the (empty) stack.
              const tq = rectOf(sim, 'q:task');
              const mq = rectOf(sim, 'q:micro');
              const st = rectOf(sim, 'stack');
              let x = at.x + at.w / 2;
              let y = at.y - 14;
              if (L && tq && mq) {
                x = tq.x + tq.w / 2;
                y = (tq.y + tq.h + mq.y) / 2 + 8;
              } else if (st) {
                x = st.x + st.w / 2;
                y = st.y + 44;
              }
              return (
                <StagePrompt x={clamp(x, 130, sim.w - 130)} y={y}>
                  {q.ask}
                </StagePrompt>
              );
            })()}
          </>
        )}
        {L && step.legend && <Legend items={step.legend} />}
      </>
    );
  };

  const resolveCallout = (target: string) => {
    const wide = target.startsWith('wide:');
    if (wide && sim.orient === 'portrait') return null;
    const id = wide ? target.slice(5) : target;
    // Virtual targets: the first Web API item, or the click listener.
    if (id === 'api:first' || id === 'api:listener') {
      const c = sim.cards.find((k) => k.role === 'api' && (id === 'api:first' || k.listener));
      return c ? { x: c.x, y: c.y, w: c.w, h: c.h } : null;
    }
    const r = rectOf(sim, id);
    return r ? { x: r.x + r.w / 2, y: r.y + r.h / 2, w: r.w, h: r.h } : null;
  };

  const panel = (
    <HighlightContext.Provider value={player.setHighlight}>
      <Prose>{step.body}</Prose>
      {step.predict && <PredictCard key={player.stepKey} game={() => sim.game} sim={sim} prompt={step.predictPrompt} />}
      {it?.kind === 'stepper' && <StepperCard key={player.stepKey} sim={sim} player={player} prompt={it.prompt} />}
      {it?.kind === 'click' && (
        <ActionsCard
          key={player.stepKey}
          prompt="Or click from here:"
          buttons={[
            {
              label: 'Click Buy',
              icon: 'target',
              run: () => sim.clickBuy(),
              after: <>Each click is queued as a task. Watch the loop take them one at a time, in order.</>,
            },
            {
              label: 'Click 3 times fast',
              icon: 'bolt',
              run: () => {
                sim.clickBuy();
                sim.clickBuy();
                sim.clickBuy();
              },
              after: <>Three tasks, one queue. The stack only ever holds one handler at a time.</>,
            },
          ]}
        />
      )}
      {it?.kind === 'rerun' && (
        <ActionsCard
          key={player.stepKey}
          prompt="Use the buttons on the page, or replay the demo:"
          buttons={[{ label: 'Run the demo again', icon: 'replay', run: () => sim.demo() }]}
        />
      )}
      {it?.kind === 'modes' && (
        <ToggleCard
          key={player.stepKey}
          prompt={it.prompt}
          initial={it.initial}
          options={it.options.map((o) => ({ label: o.label, apply: () => sim.setMode(o.mode), note: o.note }))}
        />
      )}
      {it?.kind === 'playground' && <Playground key={player.stepKey} sim={sim} player={player} />}
      {step.quiz && <QuizCard key={step.id} quiz={step.quiz} />}
      {step.extra}
      {step.code && <CodeBlock spec={step.code} />}
      {step.code2 && <CodeBlock spec={step.code2} />}
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
      stage={<LessonStage sim={sim} player={player} meta={META} scene={scene} overlay={overlay} callouts={step.callouts} legend={[]} resolveCallout={resolveCallout} />}
    />
  );
}
