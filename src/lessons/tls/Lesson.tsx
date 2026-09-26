'use client';

import { Fragment, useState } from 'react';
import { PredictCard } from '@/components/lesson/cards';
import { CodeBlock } from '@/components/lesson/CodeBlock';
import { LessonShell } from '@/components/lesson/LessonShell';
import { LessonStage, type LessonMeta } from '@/components/lesson/LessonStage';
import { Prose } from '@/components/lesson/Prose';
import { QuizCard } from '@/components/lesson/QuizCard';
import { HighlightContext } from '@/components/lesson/Term';
import { useLessonPlayer, type PlayerEntry } from '@/components/lesson/useLessonPlayer';
import { Hud, Legend, type HudItem } from '@/components/stage/chrome';
import { Callouts, StagePrompt } from '@/components/stage/overlays';
import { CHAPTERS, META, type Chapter, type Step } from './chapters';
import { LivePrompt } from './panel/cards';
import { TlsSim } from './sim/TlsSim';
import { CertPanel, NotebookPanel, PaintPanel, WirePanel } from './stage/panels';
import { CertScene, PaintScene, ShakeScene, WireScene } from './stage/scenes';

const LESSON_META: LessonMeta = META;

/**
 * Callout targets that aren't boxes. 'hs:tap' is the spot where the
 * ClientHello crosses Eve's lane in the handshake diagram.
 */
function resolveCallout(sim: TlsSim, target: string) {
  if (target === 'hs:tap' && sim.scene === 'shake') {
    const s = sim.shake;
    const f = s.flights.find((x) => x.dir === 'cs' && x.msgs.some((m) => m.id === 'ch'));
    if (!f) return null;
    const g = s.geo();
    return { x: g.ex, y: g.top + ((f.t0 + f.t1) / 2) * s.pxPerSec(), w: 16, h: 16 };
  }
  return null;
}

/** Live metric chips for the current step (top-left of the stage). */
function hudItems(sim: TlsSim, step: Step, portrait: boolean): HudItem[] {
  const out: HudItem[] = [];
  for (const k of step.hud ?? []) {
    if (k === 'packets') {
      out.push({ label: sim.wire.cfg.attacker === 'eve' ? 'Eve copied' : 'Mallory saw', value: sim.wire.packets, unit: 'packets' });
    } else if (k === 'leaked') {
      const n = sim.wire.leaked.length;
      out.push({ label: 'Secrets leaked', value: n, tone: n ? 'bad' : 'good' });
    } else if (k === 'goals') {
      const ok = sim.wire.cfg.proto !== 'http';
      const goals = portrait ? ['Private', 'Intact', 'Authentic'] : ['Confidentiality', 'Integrity', 'Authentication'];
      for (const g of goals) out.push({ label: g, value: ok ? '✓ yes' : '✗ no', tone: ok ? 'good' : 'bad' });
    } else if (k === 'rtt') {
      const s = sim.shake;
      const http = s.cfg.proto === 'http';
      out.push({ label: 'TLS handshake', value: http ? 'none' : `${s.tlsRtts} RTT`, tone: http ? 'bad' : undefined });
      out.push({ label: 'Request leaves', value: s.requestAtRtts * s.cfg.rtt, unit: 'ms' });
      if (!portrait) out.push({ label: 'First byte', value: s.firstByteRtts * s.cfg.rtt, unit: 'ms' });
    }
  }
  return out;
}

export default function TlsLesson() {
  const [sim] = useState(() => new TlsSim());
  const player = useLessonPlayer(CHAPTERS, ({ step }: PlayerEntry<Step, Chapter>) => {
    sim.enter(step.cfg, { reset: step.reset ?? true, predict: step.predict?.rounds });
  });
  const { step } = player;
  const dim = (id: string) => !!step.focus?.length && !step.focus.includes(id);
  const glow = (id: string) => player.highlight === id;

  const scene = () => {
    const props = { sim, dim, glow };
    switch (sim.scene) {
      case 'wire':
        return <WireScene {...props} />;
      case 'paint':
        return <PaintScene {...props} />;
      case 'cert':
        return <CertScene {...props} />;
      case 'shake':
        return <ShakeScene {...props} />;
    }
  };

  const overlay = () => {
    const portrait = sim.orient === 'portrait';
    const q = sim.game?.pending;
    const at = q?.askAt && 'id' in q.askAt ? sim.boxes.get(q.askAt.id) : null;
    const callouts = portrait ? (step.calloutsPortrait ?? step.callouts) : step.callouts;
    return (
      <>
        <Hud items={hudItems(sim, step, portrait)} />
        {sim.scene === 'wire' && <WirePanel sim={sim} />}
        {sim.scene === 'paint' && <PaintPanel sim={sim} />}
        {sim.scene === 'cert' && <CertPanel sim={sim} />}
        {sim.scene === 'shake' && <NotebookPanel sim={sim} />}
        {q && at && (
          <StagePrompt x={Math.min(Math.max(at.x, 110), sim.w - 110)} y={at.y - at.h / 2 - 14}>
            {q.ask}
          </StagePrompt>
        )}
        {!portrait && <Legend items={step.legend ?? []} />}
        <Callouts sim={sim} callouts={callouts} stepKey={player.stepKey} resolve={(t) => resolveCallout(sim, t)} />
      </>
    );
  };

  const panel = (
    <HighlightContext.Provider value={player.setHighlight}>
      <Prose>{step.body}</Prose>
      {step.predict && <PredictCard key={player.stepKey} game={() => sim.game} sim={sim} prompt={<LivePrompt sim={sim} fallback={step.predict.prompt} />} />}
      {step.card && <Fragment key={player.stepKey}>{step.card(sim)}</Fragment>}
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
      stage={<LessonStage sim={sim} player={player} meta={LESSON_META} scene={scene} overlay={overlay} />}
    />
  );
}
