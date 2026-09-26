'use client';

import { useState } from 'react';
import { ActionsCard, PredictCard, SliderCard, Stat, ToggleCard } from '@/components/lesson/cards';
import { CodeBlock } from '@/components/lesson/CodeBlock';
import { LessonShell } from '@/components/lesson/LessonShell';
import { LessonStage } from '@/components/lesson/LessonStage';
import { Aside, Prose } from '@/components/lesson/Prose';
import { QuizCard } from '@/components/lesson/QuizCard';
import { HighlightContext } from '@/components/lesson/Term';
import { useLessonPlayer, type PlayerEntry } from '@/components/lesson/useLessonPlayer';
import { CHAPTERS, META, type Chapter, type Step } from './chapters';
import { LiveActionsCard, Num } from './panel/BurstCard';
import { Playground } from './panel/Playground';
import { DEFAULTS, fmtClock, RateSim, type RateConfig } from './sim';
import { StageOverlay } from './stage/Overlay';
import { Scene } from './stage/Scene';
import { stripGeo } from './stage/Strip';

type Entry = PlayerEntry<Step, Chapter>;

function configFor({ step, chapter }: Entry): RateConfig {
  return { ...DEFAULTS, ...chapter.cfg, ...step.cfg };
}

export default function RateLimitingLesson() {
  const [sim] = useState(() => new RateSim());
  const player = useLessonPlayer(CHAPTERS, (entry: Entry) => {
    sim.enter(configFor(entry), entry.step.script, { reset: entry.step.reset ?? true, predict: entry.step.predict });
  });
  const { step } = player;
  const cfg = configFor(player.entry);
  const it = step.interaction;

  const resolveCallout = (target: string) => {
    if (target === 'strip' && sim.strip) {
      const r = sim.strip;
      return { x: r.x + r.w / 2, y: r.y + r.h / 2, w: r.w, h: r.h };
    }
    if (target === 'edge' && sim.strip) {
      const g = stripGeo(sim, sim.strip);
      const W = sim.cfg.window;
      const t = Math.floor(sim.lt / W) * W;
      return { x: g.X(t), y: (g.plotTop + g.axisY) / 2, w: 2, h: g.axisY - g.plotTop };
    }
    return null;
  };

  const panel = (
    <HighlightContext.Provider value={player.setHighlight}>
      <Prose>{step.body}</Prose>
      {step.extra}
      {step.predict && <PredictCard key={`${player.stepKey}-predict`} game={() => sim.game} sim={sim} prompt={step.predictPrompt ?? 'What happens next?'} />}
      {it?.kind === 'actions' && (
        <ActionsCard
          key={`${player.stepKey}-actions`}
          prompt={it.prompt}
          buttons={it.buttons.map((b) => ({ label: b.label, icon: b.icon, after: b.after, run: () => b.run(sim) }))}
        />
      )}
      {it?.kind === 'toggle' && (
        <ToggleCard key={`${player.stepKey}-toggle`} prompt={it.prompt} initial={it.initial ?? 0} options={it.options.map((o) => ({ label: o.label, note: o.note, apply: () => o.apply(sim) }))} />
      )}
      {it?.kind === 'bucketSliders' && (
        <>
          <LiveActionsCard
            key={`${player.stepKey}-burst`}
            poll={sim}
            buttons={[{ label: 'Send 10 now', icon: 'bolt', run: () => sim.burst('alice', 10) }]}
            stats={() => {
              const s = sim.keys.get('alice');
              return (
                <>
                  <Num label="tokens" value={(s ? Math.floor(s.tokens * 10 + 1e-6) / 10 : cfg.capacity).toFixed(1)} tone={s && s.tokens < 1 ? 'bad' : undefined} />
                  <Num label="allowed" value={sim.accepted} tone="good" />
                  <Num label="429s" value={sim.rejected} tone={sim.rejected ? 'bad' : undefined} />
                </>
              );
            }}
          />
          <SliderCard
            key={`${player.stepKey}-sliders`}
            poll={sim}
            sliders={[
              { label: 'Bucket size B', min: 1, max: 10, step: 1, initial: cfg.capacity, format: (v) => `${v} tokens`, onChange: (v) => sim.setParam('capacity', v), ends: ['tiny bursts', 'big bursts'] },
              { label: 'Refill rate R', min: 0.2, max: 3, step: 0.1, initial: cfg.rate, format: (v) => `${v.toFixed(1)} / s`, onChange: (v) => sim.setParam('rate', v), ends: ['strict', 'generous'] },
            ]}
            stats={() => <Stat label="long-run limit" value={`${sim.cfg.rate.toFixed(1)} req/s`} />}
          />
        </>
      )}
      {it?.kind === 'exploit' && (
        <LiveActionsCard
          key={`${player.stepKey}-exploit`}
          poll={sim}
          prompt="Get 10 requests allowed within 10 seconds."
          buttons={[{ label: 'Send 5 now', icon: 'bolt', run: () => sim.burst('alice', 5) }]}
          stats={() => {
            const W = sim.cfg.window;
            const resetIn = (Math.floor(sim.lt / W + 1e-9) + 1) * W - sim.lt;
            return (
              <>
                <Num label="window resets in" value={`${resetIn.toFixed(1)} s`} />
                <Num label={`best in ${W} s`} value={`${sim.bestEver} / 10`} tone={sim.bestEver >= 10 ? 'good' : undefined} />
              </>
            );
          }}
          goal={() =>
            sim.bestEver >= 10 ? (
              <>
                Ten requests through inside one 10-second stretch: <strong>double the limit</strong>, and every one got a 200. The window reset at{' '}
                {fmtClock(Math.floor(sim.best.start / sim.cfg.window + 1) * sim.cfg.window)} made it possible.
              </>
            ) : null
          }
        />
      )}
      {it?.kind === 'playground' && <Playground key={`${player.stepKey}-playground`} sim={sim} initial={cfg} />}
      {step.quiz && <QuizCard key={`${player.stepKey}-quiz`} quiz={step.quiz} />}
      {step.aside && <Aside>{step.aside}</Aside>}
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
          scene={() => <Scene sim={sim} focus={step.focus} highlight={player.highlight} />}
          overlay={() => (
            <StageOverlay sim={sim} hud={step.hud ?? []} legend={step.legend ?? []} callouts={step.callouts} stepKey={player.stepKey} resolveCallout={resolveCallout} />
          )}
        />
      }
    />
  );
}
