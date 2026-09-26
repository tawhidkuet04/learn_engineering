'use client';

import { useState } from 'react';
import { ActionsCard, PredictCard, SliderCard, Stat } from '@/components/lesson/cards';
import { CodeBlock } from '@/components/lesson/CodeBlock';
import { LessonShell } from '@/components/lesson/LessonShell';
import { LessonStage, type LessonMeta } from '@/components/lesson/LessonStage';
import { Prose } from '@/components/lesson/Prose';
import { QuizCard } from '@/components/lesson/QuizCard';
import { HighlightContext } from '@/components/lesson/Term';
import { useLessonPlayer, type PlayerEntry } from '@/components/lesson/useLessonPlayer';
import { Hud, Legend } from '@/components/stage/chrome';
import { Callouts } from '@/components/stage/overlays';
import { CHAPTERS, LESSON } from './chapters';
import { AskPrompt, SwitchInspector, ThreadTable, hudItems, legendItems } from './Overlays';
import { ModeCard, WhenPredicted } from './panel/Cards';
import { Playground } from './panel/Playground';
import { Scene } from './Scene';
import { DEFAULTS, PTSim, type PTConfig } from './sim';
import type { Chapter, Interaction, Step } from './types';

type Entry = PlayerEntry<Step, Chapter>;

const META: LessonMeta = LESSON;

function configOf({ step, chapter }: Entry): PTConfig {
  return { ...DEFAULTS, ...chapter.cfg, ...step.cfg };
}

function InteractionCard({ it, sim, cfg, stepKey }: { it: Interaction; sim: PTSim; cfg: PTConfig; stepKey: string }) {
  if (it.kind === 'actions') {
    return <ActionsCard key={stepKey} prompt={it.prompt} buttons={it.buttons.map((b) => ({ label: b.label, icon: b.icon, after: b.after, run: () => b.run(sim) }))} />;
  }
  if (it.kind === 'toggle') return <ModeCard key={stepKey} sim={sim} prompt={it.prompt} options={it.options} initial={it.initial} />;
  if (it.kind === 'cores') {
    return (
      <SliderCard
        key={stepKey}
        poll={sim}
        prompt={it.prompt ?? 'Give the CPU more cores:'}
        sliders={[
          {
            label: 'Cores',
            min: 1,
            max: 4,
            step: 1,
            initial: cfg.cores,
            format: (v) => `${v} core${v > 1 ? 's' : ''}`,
            onChange: (v) => sim.setCores(v),
            ends: ['concurrency', 'parallelism'],
          },
        ]}
        stats={() => (
          <>
            <Stat label="job took" value={sim.batchLast != null ? `${sim.batchLast.toFixed(1)} ms` : '…'} />
            <Stat label="with" value={`${sim.batchCores ?? sim.cores.length} core${(sim.batchCores ?? sim.cores.length) > 1 ? 's' : ''}`} />
          </>
        )}
        done={() =>
          sim.batchCores === 4 && sim.batchLast != null ? (
            <>
              <strong>Four threads, four cores, all running at once.</strong> Same work, about a quarter of the time. That&apos;s parallelism.
            </>
          ) : null
        }
      />
    );
  }
  if (it.kind === 'slice') {
    return (
      <SliderCard
        key={stepKey}
        poll={sim}
        prompt={it.prompt ?? 'Set the time slice:'}
        sliders={[
          {
            label: 'Time slice',
            min: 0.3,
            max: 4,
            step: 0.1,
            initial: cfg.slice,
            format: (v) => `${v.toFixed(1)} ms`,
            onChange: (v) => sim.setSlice(v),
            ends: ['responsive', 'efficient'],
          },
        ]}
        stats={() => (
          <>
            <Stat label="switching" value={`${Math.round(sim.overhead * 100)}%`} bad={sim.overhead > 0.15} />
            <Stat label="longest wait" value={`${sim.maxWait.toFixed(1)} ms`} bad={sim.maxWait > 8} />
          </>
        )}
      />
    );
  }
  if (it.kind === 'io') {
    return (
      <ActionsCard
        key={stepKey}
        prompt="A1 never waits on its own. Make it read a file:"
        buttons={[
          {
            label: 'A1: read a file',
            icon: 'play',
            run: () => sim.requestIO('a1', 3.2),
            after: (
              <>
                A1 calls <code>read()</code> the next time it runs, and the kernel parks it by the disk. The core never sits idle while it waits.
              </>
            ),
          },
        ]}
      />
    );
  }
  return <Playground key={stepKey} sim={sim} initial={cfg} />;
}

export default function ProcessesThreadsLesson() {
  const [sim] = useState(() => new PTSim());
  const player = useLessonPlayer(CHAPTERS, (entry: Entry) => {
    const { step } = entry;
    sim.enter(configOf(entry), {
      reset: step.reset,
      script: step.script,
      predict: step.predict ? { kind: step.predict.kind, rounds: step.predict.rounds } : null,
      seed: step.seed,
    });
  });
  const { step, stepKey } = player;
  const cfg = configOf(player.entry);

  const crashEnabled = () => !!step.crashMode && (!sim.game || sim.game.done);

  const onThread = (tid: string) => {
    const q = sim.game?.pending;
    if (q && !q.choices) {
      sim.game?.answer(tid);
      return;
    }
    if (crashEnabled()) sim.crashThread(tid, 'SIGSEGV');
  };

  const onProc = (pid: string) => {
    if (!crashEnabled()) return;
    const p = sim.procs.get(pid);
    if (!p || !p.alive) return;
    sim.crashProcess(pid, p.kind === 'renderer' || p.kind === 'gpu' || p.kind === 'browser' ? 'SIGSEGV' : 'SIGKILL');
  };

  const scene = () => {
    const nextQ = !!sim.game?.pending && sim.pkind === 'next';
    return (
      <Scene
        sim={sim}
        focus={step.focus}
        highlight={player.highlight}
        pickThreads={nextQ || crashEnabled()}
        crashMode={crashEnabled()}
        onThread={onThread}
        onProc={onProc}
      />
    );
  };

  const overlay = () => {
    const L = sim.orient === 'landscape';
    const pending = !!sim.game?.pending;
    const callouts = (step.callouts ?? [])
      .filter((c) => !c.only || c.only === (L ? 'landscape' : 'portrait'))
      .map((c) => ({ target: c.target, text: c.text, dir: !L && c.pdir ? c.pdir : c.dir }));
    const legend = legendItems(step.legend ?? []);
    const strip = !L && step.inspector;
    return (
      <>
        <Hud items={hudItems(sim, step.hud ?? [])} />
        <ThreadTable sim={sim} />
        {step.inspector && <SwitchInspector sim={sim} />}
        <AskPrompt sim={sim} />
        <Callouts sim={sim} callouts={pending ? [] : callouts} stepKey={stepKey} resolve={(k) => sim.rectOf(k)} />
        {!strip && legend.length > 0 && <Legend items={legend} />}
      </>
    );
  };

  const panel = (
    <HighlightContext.Provider value={player.setHighlight}>
      <Prose>{step.body}</Prose>
      {step.extra}
      {step.predict && <PredictCard key={stepKey} game={() => sim.game} sim={sim} prompt={step.predict.prompt} />}
      {step.afterPredict && (
        <WhenPredicted key={`after-${stepKey}`} sim={sim}>
          <InteractionCard it={step.afterPredict} sim={sim} cfg={cfg} stepKey={`after-${stepKey}`} />
        </WhenPredicted>
      )}
      {step.interaction && <InteractionCard it={step.interaction} sim={sim} cfg={cfg} stepKey={stepKey} />}
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
      stage={<LessonStage sim={sim} player={player} meta={META} scene={scene} overlay={overlay} />}
    />
  );
}
