'use client';

import { useState } from 'react';
import { ActionsCard, PredictCard, ToggleCard } from '@/components/lesson/cards';
import { CodeBlock } from '@/components/lesson/CodeBlock';
import { LessonShell } from '@/components/lesson/LessonShell';
import { LessonStage } from '@/components/lesson/LessonStage';
import { Prose } from '@/components/lesson/Prose';
import { QuizCard } from '@/components/lesson/QuizCard';
import { HighlightContext } from '@/components/lesson/Term';
import { useLessonPlayer, type PlayerEntry } from '@/components/lesson/useLessonPlayer';
import { StagePrompt } from '@/components/stage/overlays';
import { CHAPTERS, META, type Chapter, type Step } from './chapters';
import { OsiHud, PredictPrompt, StageCards, SymptomCard } from './Overlay';
import { CheatSheet, HexDump, PacketTree, Playground, SortCard, SwapCard, TtlCard } from './panel';
import { Scene, spriteRect, type SceneOpts } from './Scene';
import { DEFAULTS, OsiSim, type DevId, type OsiConfig } from './sim';

function configFor({ step, chapter }: PlayerEntry<Step, Chapter>): OsiConfig {
  return { ...DEFAULTS, ...chapter.cfg, ...step.cfg };
}

export default function OsiModelLesson() {
  const [sim] = useState(() => new OsiSim());
  const player = useLessonPlayer(CHAPTERS, (entry: PlayerEntry<Step, Chapter>) => {
    const { step } = entry;
    sim.enter(configFor(entry), step.script ?? [], {
      reset: step.reset,
      predict: step.predict ? { kind: step.predict.kind, needed: step.predict.needed } : undefined,
    });
  });
  const { step } = player;
  const cfg = configFor(player.entry);
  const it = step.interaction;
  const portrait = sim.orient === 'portrait';

  const opts: SceneOpts = {
    focus: step.focus ?? null,
    focusDevs: step.focusDevs ?? null,
    peers: step.peers,
    wave: step.wave,
    highlight: player.highlight,
    clickRows: step.clickRows ?? null,
    onRow: (dev: DevId, layer) => sim.rowClick(dev, layer),
    onBlock: it === 'inspect' ? (layer) => sim.select(layer) : undefined,
    selected: it === 'inspect' ? sim.selected : null,
  };

  const resolveCallout = (target: string) => {
    if (target === 'pdu') {
      const r = spriteRect(sim);
      return r ? { x: r.x + r.w / 2, y: r.y + r.h / 2, w: r.w, h: r.h } : null;
    }
    const c = sim.col(target as DevId);
    if (c) {
      const top = sim.colTop(c);
      const bottom = sim.slotY(c, 1) + sim.g.rowH / 2;
      return { x: c.cx, y: (top + bottom) / 2, w: c.w, h: bottom - top };
    }
    return null;
  };

  const stripCard = portrait && (cfg.view === 'stack' || cfg.view === 'chain') && !!step.card && step.card !== 'none';
  const legend = stripCard || (portrait && (cfg.view === 'single' || cfg.view === 'path')) ? [] : (step.legend ?? []);

  const overlay = () => {
    const item = sim.sortItem;
    const col = sim.col('ref');
    const r = spriteRect(sim);
    return (
      <>
        {step.hud && <OsiHud sim={sim} keys={step.hud} />}
        <StageCards sim={sim} kind={step.card ?? 'none'} layer={step.cardLayer} />
        <PredictPrompt sim={sim} />
        {(step.predict?.kind === 'symptoms' || it === 'break') && <SymptomCard sim={sim} />}
        {it === 'inspect' && !sim.selected && sim.tripDone && r && (
          <StagePrompt x={portrait ? sim.w / 2 : r.x + r.w / 2} y={portrait ? sim.g.y1 + sim.g.rowH / 2 + 44 : r.y - 26}>
            Click a layer or a header
          </StagePrompt>
        )}
        {it === 'sort' && item && col && (
          <StagePrompt x={portrait ? sim.w / 2 : col.cx} y={sim.colTop(col) - 30}>
            Where does “{item.label}” live?
          </StagePrompt>
        )}
      </>
    );
  };

  const panel = (
    <HighlightContext.Provider value={player.setHighlight}>
      <Prose>{step.body}</Prose>
      {step.predict && <PredictCard key={player.stepKey} game={() => sim.game} sim={sim} prompt={step.predict.prompt} />}
      {it === 'swap' && <SwapCard key={player.stepKey} sim={sim} />}
      {it === 'https' && (
        <ToggleCard
          key={player.stepKey}
          prompt="What does Alice fetch?"
          options={[
            {
              label: 'Plain HTTP',
              apply: () => sim.setApp('http'),
              note: <>Layers 6 and 5 add nothing. The request goes down as the same 75 bytes of readable text.</>,
            },
            {
              label: 'HTTPS',
              apply: () => sim.setApp('https'),
              note: (
                <>
                  At layer 6, TLS seals the 75-byte request into 92 bytes (the ciphertext, one content-type byte and a 16-byte authentication tag) and adds a
                  5-byte record header. Every layer below now carries bytes it can’t read, and TCP’s destination port becomes 443.
                </>
              ),
            },
          ]}
        />
      )}
      {it === 'model' && (
        <ToggleCard
          key={player.stepKey}
          prompt="Describe the same stacks with:"
          options={[
            { label: 'OSI · 7 layers', apply: () => sim.setModel('osi') },
            {
              label: 'TCP/IP · 4 layers',
              apply: () => sim.setModel('tcpip'),
              note: <>Application (OSI 5–7), transport (4), internet (3), link (1–2). Watch the data unit: it doesn’t change at all.</>,
            },
          ]}
        />
      )}
      {it === 'inspect' && <PacketTree sim={sim} />}
      {it === 'sort' && <SortCard key={player.stepKey} sim={sim} />}
      {it === 'ttl' && <TtlCard key={player.stepKey} sim={sim} />}
      {it === 'break' && (
        <ActionsCard
          key={player.stepKey}
          kicker="Break it"
          prompt="Break one layer, then watch where the request dies."
          buttons={[
            {
              label: 'Unplug the cable',
              icon: 'power',
              run: () => sim.breakLayer('cable'),
              after: (
                <>
                  The bits never reach the switch. <code>ip link</code> reports <strong>NO-CARRIER</strong>: layer 1. Every layer above fails too, which is why
                  you check the bottom first.
                </>
              ),
            },
            {
              label: 'Delete the route',
              icon: 'x',
              run: () => sim.breakLayer('route'),
              after: (
                <>
                  The router has no route to 203.0.113.0/24, so it drops the packet and sends back ICMP <strong>“net unreachable”</strong>: layer 3.
                </>
              ),
            },
            {
              label: 'Stop the web server',
              icon: 'power',
              run: () => sim.breakLayer('port'),
              after: (
                <>
                  Alice’s first TCP segment (a SYN, with no data yet) reaches the server, but nothing listens on port 80, so TCP answers with a{' '}
                  <strong>reset</strong>. curl says “Connection refused”: layer 4.
                </>
              ),
            },
            {
              label: 'Break DNS',
              icon: 'x',
              run: () => sim.breakLayer('dns'),
              after: (
                <>
                  curl can’t turn <code>shop.example</code> into an IP address, so nothing is sent at all: <strong>layer 7</strong>.
                </>
              ),
            },
            {
              label: 'Crash the app',
              icon: 'bolt',
              run: () => sim.breakLayer('app500'),
              after: (
                <>
                  The request arrives perfectly and the app answers <strong>500</strong>. Layers 1 to 6 all worked; the bug is in the application, layer 7.
                </>
              ),
            },
            { label: 'Fix everything', icon: 'replay', run: () => sim.breakLayer(null), after: <>Everything is back up. The request goes all the way.</> },
          ]}
        />
      )}
      {it === 'playground' && <Playground key={player.stepKey} sim={sim} initial={{ app: cfg.app, link: cfg.link, view: cfg.view, model: cfg.model, ttl: cfg.ttl }} />}
      {it === 'cheatsheet' && <CheatSheet />}
      {it === 'hexdump' && <HexDump />}
      {step.quiz && <QuizCard key={player.stepKey} quiz={step.quiz} />}
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
          scene={() => (
            <>
              <defs>
                <pattern id="osi-enc" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                  <line x1="0" y1="0" x2="0" y2="6" stroke="rgba(45,212,191,0.55)" strokeWidth="2" />
                </pattern>
              </defs>
              <Scene sim={sim} opts={opts} />
            </>
          )}
          overlay={overlay}
          callouts={step.callouts}
          legend={legend}
          resolveCallout={resolveCallout}
        />
      }
    />
  );
}
