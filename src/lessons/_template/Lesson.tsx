'use client';

import { useState } from 'react';
import { ActionsCard, PredictCard, SliderCard, Stat } from '@/components/lesson/cards';
import { CodeBlock } from '@/components/lesson/CodeBlock';
import { LessonShell } from '@/components/lesson/LessonShell';
import { LessonStage, type LessonMeta } from '@/components/lesson/LessonStage';
import { Aside, Prose } from '@/components/lesson/Prose';
import { HighlightContext, Term } from '@/components/lesson/Term';
import { useLessonPlayer, type PlayerEntry } from '@/components/lesson/useLessonPlayer';
import { CodeTrace } from '@/components/stage/CodeTrace';
import { Hud } from '@/components/stage/chrome';
import { InspectorCard, RLine, RResult, Readout, StagePrompt } from '@/components/stage/overlays';
import { SequenceDiagram } from '@/components/stage/SequenceDiagram';
import { ClientCard, Cylinder, Effects, Flights, NodeCard, Wires } from '@/components/stage/svg';
import { SIG } from '@/lib/sim/colors';
import type { Callout } from '@/components/stage/overlays';
import type { LegendItem } from '@/components/stage/chrome';
import type { CodeSpec } from '@/components/lesson/CodeBlock';
import type { ReactNode } from 'react';
import { DEFAULTS, DemoSim, type DemoConfig } from './sim';

/* TEMPLATE lesson: shows how every kit piece fits together. Copy, rename, replace. */

const META: LessonMeta = { slug: 'kit-demo', code: 'XX-00', track: 'Template', title: 'Kit demo' };

interface Step {
  id: string;
  title: string;
  body: ReactNode;
  cfg?: Partial<DemoConfig>;
  reset?: boolean;
  predict?: number;
  view?: 'flow' | 'sequence' | 'code';
  callouts?: Callout[];
  legend?: LegendItem[];
  focus?: string[];
  code?: CodeSpec;
}

interface Chapter {
  id: string;
  title: string;
  steps: Step[];
}

const CHAPTERS: Chapter[] = [
  {
    id: 'basics',
    title: 'Basics',
    steps: [
      {
        id: 'flow',
        title: 'Requests flow',
        reset: true,
        body: (
          <p>
            The <Term k="client">client</Term> sends requests to the <Term k="server">server</Term>, which asks the <Term k="db">database</Term>.
          </p>
        ),
        callouts: [{ target: 'db', text: <>the <b>database</b>: slow but durable</>, dir: 'down' }],
        legend: [
          { label: 'request', color: SIG.req },
          { label: 'response', color: SIG.res },
        ],
      },
      {
        id: 'predict',
        title: 'Hit or miss?',
        reset: true,
        cfg: { cache: true },
        predict: 3,
        body: <p>Now the server caches responses. Predict each lookup.</p>,
        code: { title: 'cache.js', lang: 'js', code: `const hit = cache.get(key);\n!if (hit) return hit;\nconst row = await db.get(key);\ncache.set(key, row);` },
      },
    ],
  },
  {
    id: 'kit',
    title: 'Other kit pieces',
    steps: [
      { id: 'sequence', title: 'Sequence diagram', reset: true, view: 'sequence', body: <p>Time runs downward. Messages draw themselves.</p> },
      {
        id: 'code',
        title: 'Code trace',
        reset: true,
        view: 'code',
        body: (
          <>
            <p>Step through code with the active line highlighted.</p>
            <Aside>Use CodeTrace for event loops, stacks, and anything with a program counter.</Aside>
          </>
        ),
      },
    ],
  },
];

const PROGRAM = `function greet(name) {
  const msg = 'hi ' + name;
  return msg;
}
console.log(greet('Ada'));`;

export default function TemplateLesson() {
  const [sim] = useState(() => new DemoSim());
  const player = useLessonPlayer(CHAPTERS, ({ step }: PlayerEntry<Step, Chapter>) => {
    sim.enter({ ...DEFAULTS, ...step.cfg }, [], { reset: step.reset, predict: step.predict });
  });
  const { step } = player;
  const view = step.view ?? 'flow';
  const dim = (id: string) => !!step.focus?.length && !step.focus.includes(id);
  const glow = (id: string) => player.highlight === id;
  const line = Math.min(5, 1 + Math.floor(sim.stepT / 1.2) % 5);

  const scene = () => {
    if (view === 'sequence') {
      const t = sim.stepT;
      return (
        <SequenceDiagram
          x={40}
          y={80}
          w={sim.w - 80}
          h={sim.h - 160}
          now={t}
          actors={[
            { id: 'c', label: 'Client', sub: '198.51.100.42', color: SIG.pink },
            { id: 's', label: 'Server', sub: '203.0.113.10', color: SIG.hc },
          ]}
          messages={[
            { id: 1, from: 'c', to: 's', t0: 0.5, t1: 1.5, label: 'SYN' },
            { id: 2, from: 's', to: 'c', t0: 1.5, t1: 2.5, label: 'SYN-ACK', color: SIG.res },
            { id: 3, from: 'c', to: 's', t0: 2.5, t1: 3.5, label: 'ACK' },
          ]}
          notes={[{ id: 'n1', actor: 's', t: 3.5, text: 'ESTABLISHED', color: SIG.res }]}
          timeLabel={(x) => `${Math.round(x * 40)} ms`}
        />
      );
    }
    if (view === 'code') return null;
    const c = sim.boxes.get('client');
    const s = sim.boxes.get('server');
    const d = sim.boxes.get('db');
    return (
      <>
        <Wires sim={sim} />
        {c && <ClientCard box={c} name="Alice" sub="198.51.100.42" color={SIG.pink} dim={dim('client')} glow={glow('client')} />}
        {s && (
          <NodeCard
            box={s}
            title="web-1"
            sub="10.0.1.11"
            led="up"
            dim={dim('server')}
            glow={glow('server')}
            state={sim.game?.pending ? 'hot' : 'normal'}
          />
        )}
        {d && <Cylinder box={d} title="postgres" sub="10.0.2.5" dim={dim('db')} glow={glow('db')} />}
        <Flights sim={sim} />
        <Effects sim={sim} />
      </>
    );
  };

  const overlay = () => {
    if (view === 'code') {
      return <CodeTrace x={40} y={80} w={Math.min(420, sim.w - 80)} title="greet.js" code={PROGRAM} active={line} done={Array.from({ length: line - 1 }, (_, i) => i + 1)} marks={line >= 3 ? { 2: "msg = 'hi Ada'" } : {}} />;
    }
    if (view === 'sequence') return null;
    const s = sim.boxes.get('server');
    const q = sim.game?.pending;
    return (
      <>
        <Hud
          items={[
            { label: 'Served', value: sim.served },
            { label: 'Cache hits', value: sim.hits, tone: sim.hits > 0 ? 'good' : undefined },
          ]}
        />
        {s && (
          <Readout x={s.x} y={s.y + s.h / 2 + 14} anchor={sim.orient === 'landscape' ? 'below' : 'strip'} head="cache contents">
            <RLine>{sim.cached.size ? [...sim.cached].join(' · ') : 'empty'}</RLine>
            <RResult>
              last served <b>{sim.lastKey ?? '—'}</b>
            </RResult>
          </Readout>
        )}
        {q && s && <StagePrompt x={s.x} y={s.y - s.h / 2 - 12}>{q.ask}</StagePrompt>}
        {view === 'flow' && player.step.id === 'flow' && sim.flights[0] && (() => {
          const f = sim.flightViews()[0];
          return f ? <InspectorCard x={f.x} y={f.y} stageW={sim.w} head="request" lines={[`GET ${f.label ?? '/'} HTTP/1.1`, 'Host: shop.example']} /> : null;
        })()}
      </>
    );
  };

  const panel = (
    <HighlightContext.Provider value={player.setHighlight}>
      <Prose>{step.body}</Prose>
      {step.predict && <PredictCard key={player.stepKey} game={() => sim.game} sim={sim} prompt="Will the server find this page in its cache?" />}
      {step.id === 'flow' && (
        <SliderCard
          key={player.stepKey}
          poll={sim}
          sliders={[{ label: 'Traffic', min: 0.2, max: 3, step: 0.1, initial: DEFAULTS.rps, format: (v) => `${v.toFixed(1)} req/s`, onChange: (v) => sim.setRps(v) }]}
          stats={() => <Stat label="served" value={sim.served} />}
        />
      )}
      {step.id === 'code' && <ActionsCard buttons={[{ label: 'Replay', icon: 'replay', run: player.replay }]} />}
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
      stage={<LessonStage sim={sim} player={player} meta={META} scene={scene} overlay={overlay} callouts={step.callouts} legend={step.legend} />}
    />
  );
}
