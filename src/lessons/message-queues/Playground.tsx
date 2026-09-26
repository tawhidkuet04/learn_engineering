'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { CodeBlock } from '@/components/lesson/CodeBlock';
import { Icon } from '@/components/lesson/Icon';
import { usePoll } from '@/components/lesson/usePoll';
import css from '@/components/lesson/cards.module.css';
import type { MQConfig } from './model';
import type { MQSim } from './sim';

interface Base {
  dupes: number;
  lost: number;
}

interface Mission {
  id: string;
  title: string;
  text: string;
  hint: string;
  hold: number;
  check: (s: MQSim, base: Base) => boolean;
}

const MISSIONS: Mission[] = [
  {
    id: 'rush',
    title: 'Rush hour',
    text: 'At 2 or more messages a second, keep the oldest message younger than 5 s for 15 seconds.',
    hint: 'Hint: add workers, or let autoscaling do it.',
    hold: 15,
    check: (s) => s.cfg.rate >= 2 && s.oldestAge() < 5,
  },
  {
    id: 'chaos',
    title: 'Chaos-proof billing',
    text: 'With crashes at 20% or more, run for 20 seconds without a single double charge or lost job.',
    hint: 'Hint: which kind of ack never loses work, and what makes a repeat harmless?',
    hold: 20,
    check: (s, b) => s.cfg.crashRate >= 0.2 && s.m.dupes === b.dupes && s.m.lost === b.lost && s.rateOut() > 0.3,
  },
  {
    id: 'poison',
    title: 'Poison-proof',
    text: 'With 10% or more poison messages, keep the oldest message younger than 8 s for 20 seconds.',
    hint: 'Hint: poison never succeeds. Where should it go instead?',
    hold: 20,
    check: (s) => s.cfg.poisonRate >= 0.1 && s.cfg.rate >= 0.8 && s.oldestAge() < 8,
  },
];

function Range({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
  first,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
  first?: boolean;
}) {
  return (
    <>
      <div className={css.pgLabel} style={first ? undefined : { marginTop: 10 }}>
        {label} <output>{format(value)}</output>
      </div>
      <input
        className={css.range}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ '--fill': `${((value - min) / (max - min)) * 100}%` } as CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
      />
    </>
  );
}

function Switch({ label, sub, checked, onChange }: { label: string; sub: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className={css.switch}>
      <span>
        {label}
        <small>{sub}</small>
      </span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

function configCode(c: MQConfig) {
  const lines = [
    'await sqs.send(new SetQueueAttributesCommand({',
    '  QueueUrl: CHARGES_URL,',
    '  Attributes: {',
    `!    VisibilityTimeout: '${c.visibility}',`,
  ];
  if (c.dlq) {
    lines.push('!    RedrivePolicy: JSON.stringify({', '!      deadLetterTargetArn: CHARGES_DLQ_ARN,', `!      maxReceiveCount: '${c.maxReceives}' }),`);
  } else lines.push('    // no RedrivePolicy: retry till expiry');
  lines.push('  },', '}));');
  lines.push(`// ${c.autoscale ? 'autoscaled workers' : `${c.workers} worker${c.workers > 1 ? 's' : ''}`}`);
  lines.push(c.ackBefore ? '!// delete on receipt: at-most-once' : '// delete after work: at-least-once');
  lines.push(c.idempotent ? '// INSERT … ON CONFLICT DO NOTHING' : '!// plain INSERT: repeats charge twice');
  return lines.join('\n');
}

export function Playground({ sim, initial }: { sim: MQSim; initial: MQConfig }) {
  usePoll(sim, 250);
  const [rate, setRate] = useState(initial.rate);
  const [work, setWork] = useState(initial.work);
  const [vis, setVis] = useState(initial.visibility);
  const [crash, setCrash] = useState(initial.crashRate);
  const [poison, setPoison] = useState(initial.poisonRate);
  const [held, setHeld] = useState<Record<string, number>>({});
  const base = useRef<Record<string, Base>>({});
  const lastT = useRef<number | null>(null);

  // How long each challenge's condition has held, in simulated seconds.
  useEffect(() => {
    const id = window.setInterval(() => {
      const t = sim.t;
      const dt = lastT.current == null ? 0 : Math.max(0, t - lastT.current);
      lastT.current = t;
      setHeld((prev) => {
        const next = { ...prev };
        for (const m of MISSIONS) {
          if ((prev[m.id] ?? 0) >= m.hold) continue;
          const b = base.current[m.id] ?? { dupes: sim.m.dupes, lost: sim.m.lost };
          if (m.check(sim, b)) {
            base.current[m.id] = b;
            next[m.id] = (prev[m.id] ?? 0) + dt;
          } else {
            base.current[m.id] = { dupes: sim.m.dupes, lost: sim.m.lost };
            next[m.id] = 0;
          }
        }
        return next;
      });
    }, 250);
    return () => window.clearInterval(id);
  }, [sim]);

  const c = sim.cfg;
  const n = c.workers;

  return (
    <div className={css.pg}>
      <div className={css.pgGroup}>
        <Range
          first
          label="Arrivals"
          value={rate}
          min={0.2}
          max={3}
          step={0.1}
          format={(v) => `${v.toFixed(1)} msg/s`}
          onChange={(v) => {
            setRate(v);
            sim.setRate(v);
          }}
        />
        <div className={css.row}>
          <button type="button" className={`${css.btn} ${css.btnHot}`} onClick={() => sim.spike(24, 2.4)}>
            <Icon name="bolt" size={14} /> Spike: +24 messages
          </button>
        </div>
      </div>

      <div className={css.pgGroup}>
        <div className={css.pgLabel}>
          Workers <output>{c.autoscale ? `${n} · auto` : `${n} / 6`}</output>
        </div>
        <div className={css.row}>
          <button type="button" className={css.iconBtn} onClick={() => sim.setWorkers(n - 1)} disabled={c.autoscale || n <= 1} aria-label="Remove a worker">
            <Icon name="minus" size={14} />
          </button>
          <button type="button" className={css.iconBtn} onClick={() => sim.setWorkers(n + 1)} disabled={c.autoscale || n >= 6} aria-label="Add a worker">
            <Icon name="plus" size={14} />
          </button>
        </div>
        <div style={{ marginTop: 12 }}>
          <Switch label="Autoscale on queue depth" sub="One worker per 3 waiting messages, up to 6" checked={c.autoscale} onChange={(v) => sim.update({ autoscale: v })} />
        </div>
        <Range
          label="Work per message"
          value={work}
          min={0.6}
          max={3.5}
          step={0.1}
          format={(v) => `${v.toFixed(1)} s`}
          onChange={(v) => {
            setWork(v);
            sim.update({ work: v });
          }}
        />
        <Range
          label="Visibility timeout"
          value={vis}
          min={1}
          max={10}
          step={1}
          format={(v) => `${v} s`}
          onChange={(v) => {
            setVis(v);
            sim.update({ visibility: v });
          }}
        />
      </div>

      <div className={css.pgGroup}>
        <Range
          first
          label="Worker crashes"
          value={crash}
          min={0}
          max={0.4}
          step={0.05}
          format={(v) => `${Math.round(v * 100)}% of jobs`}
          onChange={(v) => {
            setCrash(v);
            sim.update({ crashRate: v });
          }}
        />
        <Range
          label="Poison messages"
          value={poison}
          min={0}
          max={0.2}
          step={0.02}
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={(v) => {
            setPoison(v);
            sim.update({ poisonRate: v });
          }}
        />
      </div>

      <div className={css.pgGroup} style={{ display: 'grid', gap: 12 }}>
        <Switch label="Idempotent consumer" sub="Unique order id: a repeat is a no-op" checked={c.idempotent} onChange={(v) => sim.setIdempotent(v)} />
        <Switch label="Dead-letter queue" sub={`Park a message after ${c.maxReceives} failed receives`} checked={c.dlq} onChange={(v) => sim.update({ dlq: v })} />
        <Switch label="Ack before the work" sub="At-most-once: crashes lose jobs" checked={c.ackBefore} onChange={(v) => sim.setAckBefore(v)} />
      </div>

      <div className={css.pgGroup}>
        <div className={css.pgLabel}>Challenges</div>
        <div className={css.missions}>
          {MISSIONS.map((m) => {
            const h = held[m.id] ?? 0;
            const done = h >= m.hold;
            return (
              <div key={m.id} className={css.mission} data-done={done}>
                <div className={css.missionTitle}>
                  {done && <Icon name="check" size={15} />}
                  {m.title}
                </div>
                <div className={css.missionText}>{m.text}</div>
                {!done && <div className={css.missionHint}>{m.hint}</div>}
                <div className={css.meter}>
                  <i style={{ width: `${Math.min(100, (h / m.hold) * 100)}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <CodeBlock spec={{ title: 'charges queue · live', lang: 'js', code: configCode(c) }} />
    </div>
  );
}
