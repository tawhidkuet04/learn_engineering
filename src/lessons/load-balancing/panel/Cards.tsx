'use client';

import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { Icon } from '@/components/lesson/Icon';
import { lessonCss } from '@/components/lesson/Prose';
import type { World } from '../engine/world';
import type { Interaction } from '../types';
import { usePoll } from './usePoll';
import css from './panel.module.css';

type Of<K extends Interaction['kind']> = Extract<Interaction, { kind: K }>;

function Kicker({ icon = 'target', children, right }: { icon?: 'target' | 'bolt' | 'power' | 'flag'; children: ReactNode; right?: ReactNode }) {
  return (
    <div className={css.head}>
      <div className={lessonCss.cardKicker}>
        <Icon name={icon} size={13} /> {children}
      </div>
      {right}
    </div>
  );
}

/* ------------------------------------------------------------------ */

export function PredictCard({ world, spec }: { world: World; spec: Of<'predict'> }) {
  usePoll(world, 100, true);
  const pr = world.predict;
  const done = !!pr?.done;

  // Once mastered, show the "next" hint again.
  useEffect(() => {
    if (done) world.update({ hideNext: false });
  }, [done, world]);

  if (!pr) return null;
  const last = pr.last;
  return (
    <div className={lessonCss.card}>
      <Kicker
        right={
          <span className={css.score} aria-label={`${pr.correct} of ${pr.needed} correct`}>
            {Array.from({ length: pr.needed }, (_, i) => (
              <i key={i} data-on={i < pr.correct} />
            ))}
          </span>
        }
      >
        Your turn · predict
      </Kicker>
      <p className={lessonCss.cardQ}>{spec.prompt}</p>
      {pr.pending ? (
        <div className={css.status}>
          <span className={css.pulse} />
          <span>
            A request is waiting at the load balancer. <strong style={{ color: 'var(--text-1)' }}>Click a server on the stage.</strong>
          </span>
        </div>
      ) : done ? (
        <div className={css.status}>
          <Icon name="check" size={15} />
          <span>
            <strong style={{ color: 'var(--sig-res)' }}>You&apos;ve got it.</strong> The simulation runs on its own now.
          </span>
        </div>
      ) : (
        <div className={`${css.status} ${css.waiting}`}>Waiting for the next request…</div>
      )}
      {last && (
        <div key={last.vt} className={css.feedback} data-ok={last.ok}>
          <strong>{last.ok ? 'Correct.' : 'Not quite.'}</strong>
          {last.text}
        </div>
      )}
      <div className={css.row}>
        {done ? (
          <button type="button" className={css.btn} onClick={() => world.startPredict(pr.needed)}>
            <Icon name="replay" size={14} /> Practice again
          </button>
        ) : (
          <button type="button" className={`${css.btn} ${css.btnGhost}`} onClick={() => world.endPredict()}>
            Skip, just show me
          </button>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

export function SliderCard({ world, spec, initial }: { world: World; spec: Of<'slider'>; initial: number }) {
  usePoll(world, 200);
  const [val, setVal] = useState(initial);
  const drops = world.metrics.drops;
  const s1 = world.servers.get('s1');
  const queue = s1?.queue.length ?? 0;
  const reached = drops >= spec.goalDrops;
  const fill = ((val - spec.min) / (spec.max - spec.min)) * 100;
  return (
    <div className={lessonCss.card}>
      <Kicker icon="bolt">Try it · push the traffic</Kicker>
      <div className={css.sliderHead}>
        <span>{spec.label}</span>
        <output>{val.toFixed(2)} req/s</output>
      </div>
      <input
        className={css.range}
        type="range"
        min={spec.min}
        max={spec.max}
        step={spec.step}
        value={val}
        style={{ '--fill': `${fill}%` } as CSSProperties}
        onChange={(e) => {
          const v = Number(e.target.value);
          setVal(v);
          world.setRps(v);
        }}
        aria-label="Traffic in requests per second"
      />
      <div className={css.scale}>
        <span>calm</span>
        <span>viral</span>
      </div>
      <div className={css.stats}>
        <span>
          queue <b data-bad={queue >= world.cfg.queueCap}>{queue}</b>/{world.cfg.queueCap}
        </span>
        <span>
          turned away <b data-bad={drops > 0}>{drops}</b>
        </span>
      </div>
      {reached && <p className={css.after}>{spec.done}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ */

export function ActionsCard({ world, spec }: { world: World; spec: Of<'actions'> }) {
  const [last, setLast] = useState<number | null>(null);
  const after = last != null ? spec.buttons[last].after : null;
  return (
    <div className={lessonCss.card}>
      <Kicker icon="power">Your turn</Kicker>
      {spec.prompt && <p className={lessonCss.cardQ}>{spec.prompt}</p>}
      <div className={css.row}>
        {spec.buttons.map((b, i) => (
          <button
            key={b.label}
            type="button"
            className={`${css.btn} ${i === 0 ? css.btnHot : ''}`}
            onClick={() => {
              b.run(world);
              setLast(i);
            }}
          >
            {b.icon && <Icon name={b.icon} size={14} />}
            {b.label}
          </button>
        ))}
      </div>
      {after && (
        <p key={last} className={css.after}>
          {after}
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

export function ToggleCard({ world, spec }: { world: World; spec: Of<'toggle'> }) {
  const [sel, setSel] = useState(spec.initial);
  return (
    <div className={lessonCss.card}>
      <Kicker icon="bolt">Try it</Kicker>
      <p className={lessonCss.cardQ}>{spec.prompt}</p>
      <div className={css.seg} role="group">
        {spec.options.map((o, i) => (
          <button
            key={o.label}
            type="button"
            aria-pressed={sel === i}
            onClick={() => {
              setSel(i);
              o.apply(world);
            }}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

export function ServerList({ world }: { world: World }) {
  const servers = [...world.servers.values()].filter((s) => !s.removing);
  return (
    <div className={css.servers}>
      {servers.map((s) => {
        const hs = world.healthOf(s.id);
        const out = hs && !hs.inRot;
        const state = !s.up ? (out ? 'down · out of rotation' : 'down · still getting traffic!') : out ? 'up · waiting to pass checks' : 'up · in rotation';
        return (
          <button key={s.id} type="button" className={css.serverChip} onClick={() => world.toggleServer(s.id)}>
            <span className={css.led} data-down={!s.up} />
            {s.label}
            <span className={css.serverState} data-bad={!s.up && !out} data-warn={s.up && !!out}>
              {state}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function ClickServersCard({ world, spec }: { world: World; spec: Of<'clickServers'> }) {
  usePoll(world, 200);
  return (
    <div className={lessonCss.card}>
      <Kicker icon="power">Your turn · break things</Kicker>
      <p className={lessonCss.cardQ}>{spec.prompt}</p>
      <ServerList world={world} />
    </div>
  );
}
