'use client';

import { useState } from 'react';
import { ActionsCard, PredictCard, SliderCard, ToggleCard } from '@/components/lesson/cards';
import { CodeBlock } from '@/components/lesson/CodeBlock';
import { LessonShell } from '@/components/lesson/LessonShell';
import { LessonStage } from '@/components/lesson/LessonStage';
import { Prose } from '@/components/lesson/Prose';
import { QuizCard } from '@/components/lesson/QuizCard';
import { HighlightContext } from '@/components/lesson/Term';
import { useLessonPlayer, type PlayerEntry } from '@/components/lesson/useLessonPlayer';
import { Legend, type LegendItem } from '@/components/stage/chrome';
import { Callouts } from '@/components/stage/overlays';
import { CHAPTERS, META, type Chapter, type Step } from './chapters';
import { NET_DEFAULTS, ROWS } from './journey';
import { Budget, CertCheck, Checks, Inspector, Prompt, RateNote, StageHud, UrlAnatomy } from './Overlay';
import { CheatSheet, LiveNumbers, Playground } from './panel';
import { Scene } from './Scene';
import { JourneySim, STEP_DEFAULTS, type StepConfig } from './sim';

function configFor(step: Step): StepConfig {
  const { net, ...rest } = step.cfg ?? {};
  return { ...STEP_DEFAULTS, ...rest, net: { ...NET_DEFAULTS, ...net } };
}

const SHORT: Record<string, string> = { 'TCP handshake': 'TCP', 'TLS handshake': 'TLS', 'script runs': 'script' };

export default function LifeOfARequestLesson() {
  const [sim] = useState(() => new JourneySim());
  const player = useLessonPlayer(CHAPTERS, ({ step }: PlayerEntry<Step, Chapter>) => sim.enter(configFor(step)));
  const { step } = player;
  const cfg = configFor(step);

  const resolveCallout = (target: string) => {
    const wf = sim.wf;
    if (target === 'waterfall') return { x: wf.x + wf.w * 0.82, y: wf.y + wf.h / 2, w: wf.w * 0.2, h: wf.h };
    if (target.startsWith('row:')) {
      const i = ROWS.findIndex((r) => r.id === target.slice(4));
      if (i < 0) return null;
      return { x: wf.x + wf.labelW / 2, y: wf.y + wf.head + (i + 0.5) * wf.rowH, w: wf.labelW, h: wf.rowH };
    }
    if (target === 'inspector') return { x: sim.dock.x, y: sim.dock.y + 60, w: sim.dock.w, h: 120 };
    return null;
  };

  const legendFor = (items: LegendItem[]) => (sim.orient === 'portrait' ? items.map((it) => ({ ...it, label: SHORT[it.label] ?? it.label })) : items);

  const prompt = () => {
    const q = sim.game?.pending;
    if (!q || !q.ask) return null;
    // Phones: the question takes the inspector's spot.
    if (sim.orient === 'portrait') return <Prompt sim={sim} x={sim.w / 2} y={sim.sc.view === 'render' ? sim.wf.y - 6 : sim.dock.y + 34} text={q.ask} />;
    const id = q.askAt && 'id' in q.askAt ? q.askAt.id : null;
    const b = sim.boxes.get('browser');
    if (sim.sc.view === 'render' && b) {
      const x0 = b.tx + b.w / 2 + 26;
      return <Prompt sim={sim} x={(x0 + sim.band.x + sim.band.w) / 2} y={sim.band.y + Math.min(172, sim.band.h * 0.5) + 27} text={q.ask} />;
    }
    if (id === 'browser' || id === 'server') {
      // Above the middle of the browser ↔ server path, clear of the floating labels.
      const j = sim.jack();
      const s = sim.boxes.get('server');
      if (j && s) return <Prompt sim={sim} x={(j.x + s.x - s.w / 2) / 2} y={j.y - 48} text={q.ask} />;
    }
    const at = id ? sim.boxes.get(id) : null;
    if (!at || Number.isNaN(at.x)) return <Prompt sim={sim} x={sim.w / 2} y={96} text={q.ask} />;
    const top = at.y - at.h / 2 - 10;
    const below = top - 26 < 66;
    return <Prompt sim={sim} x={at.x} y={below ? at.y + at.h / 2 + 34 : top} text={q.ask} />;
  };

  const overlay = () => (
    <>
      <StageHud sim={sim} keys={step.hud ?? ['since', 'phase']} />
      <RateNote sim={sim} />
      <Inspector sim={sim} />
      {sim.sc.view === 'url' && <UrlAnatomy sim={sim} highlight={player.highlight} />}
      {step.overlay === 'checks' && <Checks sim={sim} />}
      {step.overlay === 'cert' && <CertCheck sim={sim} />}
      {step.overlay === 'budget' && <Budget sim={sim} />}
      {prompt()}
      <Callouts
        sim={sim}
        callouts={(step.callouts ?? []).filter((c) => sim.orient === 'landscape' || c.phone)}
        stepKey={player.stepKey}
        resolve={resolveCallout}
      />
      <Legend items={legendFor(step.legend ?? [])} />
    </>
  );

  const panel = (
    <HighlightContext.Provider value={player.setHighlight}>
      <Prose>{step.body}</Prose>
      {step.predict && <PredictCard key={player.stepKey} game={() => sim.game} sim={sim} prompt={step.predict} />}
      {step.interaction === 'syn' && (
        <ActionsCard
          key={player.stepKey}
          prompt="Drop the browser’s first SYN somewhere on the internet."
          buttons={[
            {
              label: 'Lose the SYN',
              icon: 'x',
              run: () => sim.loseSyn(true),
              after: (
                <>
                  The SYN vanished. The browser&apos;s OS waited out its <strong>1-second</strong> retransmission timer (fast-forwarded here), then sent
                  it again. The TCP row now dwarfs everything else: one unlucky packet cost more than the whole page usually takes.
                </>
              ),
            },
            { label: 'Normal handshake', icon: 'replay', run: () => sim.loseSyn(false) },
          ]}
        />
      )}
      {step.interaction === 'tls' && (
        <ToggleCard
          key={player.stepKey}
          prompt="Compare the handshakes:"
          options={[
            { label: 'TLS 1.3', apply: () => sim.setTls('1.3'), note: <>The key share rides in the very first message, so one round trip is enough.</> },
            {
              label: 'TLS 1.2',
              apply: () => sim.setTls('1.2'),
              note: (
                <>
                  The server sends its key exchange only in its reply, so the browser needs a second round trip to finish. The request leaves{' '}
                  <strong>40 ms later</strong>, on every new connection.
                </>
              ),
            },
          ]}
        />
      )}
      {step.interaction === 'cert' && (
        <ToggleCard
          key={player.stepKey}
          prompt="Serve a different certificate:"
          options={[
            { label: 'Valid', apply: () => sim.setCert('valid'), note: <>All three checks pass. The browser sends its Finished and the request right behind it.</> },
            {
              label: 'Expired',
              apply: () => sim.setCert('expired'),
              note: (
                <>
                  The browser aborts the handshake and shows a full-page warning (<code>NET::ERR_CERT_DATE_INVALID</code>). <code>GET /cart</code>, and
                  Alice&apos;s cookie, never leave her machine.
                </>
              ),
            },
            {
              label: 'Wrong name',
              apply: () => sim.setCert('wrong-name'),
              note: (
                <>
                  A perfectly valid certificate, for someone else. That&apos;s exactly what an impostor would present, so the browser refuses (
                  <code>NET::ERR_CERT_COMMON_NAME_INVALID</code>).
                </>
              ),
            },
          ]}
        />
      )}
      {step.interaction === 'sliders' && (
        <SliderCard
          key={player.stepKey}
          poll={sim}
          sliders={[
            {
              label: 'Round trip (RTT)',
              min: 5,
              max: 250,
              step: 5,
              initial: cfg.net.rtt,
              format: (v) => `${v} ms`,
              onChange: (v) => sim.setRtt(v),
              ends: ['next door', 'other side of the world'],
            },
            {
              label: 'Server think time',
              min: 10,
              max: 400,
              step: 10,
              initial: cfg.net.serverMs,
              format: (v) => `${v} ms`,
              onChange: (v) => sim.setServerMs(v),
            },
          ]}
          stats={() => <LiveNumbers sim={sim} />}
          done={() =>
            sim.j.cfg.rtt >= 150 ? (
              <>
                <strong>Feel that?</strong> At {sim.j.cfg.rtt} ms the TCP and TLS handshakes alone cost {2 * sim.j.cfg.rtt} ms, before the server has
                even seen the request. No amount of server tuning buys that back.
              </>
            ) : null
          }
        />
      )}
      {step.interaction === 'script' && (
        <ToggleCard
          key={player.stepKey}
          prompt="How is app.js loaded?"
          options={[
            { label: '<script defer>', apply: () => sim.setScript('defer'), note: <>The parser never stops. app.js runs after the page has painted.</> },
            {
              label: '<script>',
              apply: () => sim.setScript('blocking'),
              note: (
                <>
                  The parser freezes at the script tag until 90 KB of JavaScript arrive and run. First paint moves from <strong>277 ms</strong> to{' '}
                  <strong>365 ms</strong>.
                </>
              ),
            },
          ]}
        />
      )}
      {step.interaction === 'playground' && <Playground key={player.stepKey} sim={sim} initial={cfg.net} />}
      {step.extra === 'cheatsheet' && <CheatSheet />}
      {step.quiz && <QuizCard key={`${step.id}-quiz`} quiz={step.quiz} />}
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
          scene={() => <Scene sim={sim} o={{ focus: step.focus, highlight: player.highlight, rows: step.rows }} />}
          overlay={overlay}
        />
      }
    />
  );
}
