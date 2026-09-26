'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Icon } from '@/components/lesson/Icon';
import { usePoll } from '@/components/lesson/usePoll';
import { ALGO_LABELS, ALGOS, type Algo } from '../limiter';
import type { KeyMode, Pattern, RateConfig, RateSim } from '../sim';
import css from './panel.module.css';

interface Mission {
  id: string;
  title: string;
  text: string;
  hint: string;
  hold: number;
  check: (s: RateSim) => boolean;
}

/** Requests per second a config lets through in the long run. */
function sustained(c: RateConfig) {
  return c.algo === 'token' || c.algo === 'leaky' ? c.rate : c.limit / c.window;
}

const MISSIONS: Mission[] = [
  {
    id: 'fair',
    title: 'Fair share',
    text: 'With the abusive client on, turn away at least two thirds of the scraper while Alice and Bob never see a 429. Hold it for 8 s.',
    hint: 'Hint: whose requests is the limiter counting together?',
    hold: 8,
    check: (s) => {
      if (!s.clients.has('bot')) return false;
      const a = s.recent('alice', 10);
      const b = s.recent('bob', 10);
      const bot = s.recent('bot', 10);
      return a.no === 0 && b.no === 0 && a.ok + b.ok >= 2 && bot.no >= 2 * bot.ok && bot.no > 5;
    },
  },
  {
    id: 'burst',
    title: 'Burst-friendly',
    text: "With bursty traffic, let every one of Alice's 8-request bursts through, while the long-run limit stays at 1 request per second or less.",
    hint: 'Hint: which algorithm has a knob just for bursts?',
    hold: 4,
    check: (s) => {
      if (s.clients.get('alice')?.cfg.traffic !== 'bursty') return false;
      const a = s.recent('alice', 26);
      return sustained(s.cfg) <= 1.0001 && a.no === 0 && a.ok >= 15;
    },
  },
  {
    id: 'drip',
    title: 'Steady drip',
    text: 'Feed the API server no faster than one request per second (no two within 0.9 s) while turning away fewer than 20% of requests. Hold it for 10 s.',
    hint: 'Hint: one queue for everyone, draining at a fixed pace.',
    hold: 10,
    check: (s) => {
      const from = s.lt - 20;
      const outs = s.outs.filter((t) => t >= from);
      if (outs.length < 8) return false;
      for (let i = 1; i < outs.length; i++) if (outs[i] - outs[i - 1] < 0.9) return false;
      let ok = 0;
      let no = 0;
      for (const e of s.events) {
        if (e.t < from) continue;
        if (e.ok) ok++;
        else no++;
      }
      return no < 0.2 * (ok + no);
    },
  },
];

function Slider({ label, value, min, max, step, format, onChange }: { label: string; value: number; min: number; max: number; step: number; format: (v: number) => string; onChange: (v: number) => void }) {
  return (
    <>
      <div className={css.pgLabel}>
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

export function Playground({ sim, initial }: { sim: RateSim; initial: RateConfig }) {
  usePoll(sim, 250);
  const [pattern, setPattern] = useState<Pattern>('abusive');
  const [limit, setLimit] = useState(initial.limit);
  const [windowS, setWindowS] = useState(initial.window);
  const [capacity, setCapacity] = useState(initial.capacity);
  const [rate, setRate] = useState(initial.rate);
  const [held, setHeld] = useState<Record<string, number>>({});
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
          next[m.id] = m.check(sim) ? (prev[m.id] ?? 0) + dt : 0;
        }
        return next;
      });
    }, 250);
    return () => window.clearInterval(id);
  }, [sim]);

  const cfg = sim.cfg;
  const algo = cfg.algo as Algo;
  const bucket = algo === 'token' || algo === 'leaky';
  const key: KeyMode = cfg.key;

  return (
    <div className={css.pg}>
      <div className={css.pgGroup}>
        <div className={css.pgLabel}>Traffic</div>
        <div className={`${css.choices} ${css.choices3}`}>
          {(['steady', 'bursty', 'abusive'] as Pattern[]).map((p) => (
            <button
              key={p}
              type="button"
              className={css.choice}
              aria-pressed={pattern === p}
              onClick={() => {
                setPattern(p);
                sim.setPattern(p);
              }}
            >
              {p === 'abusive' ? 'Abusive' : p === 'bursty' ? 'Bursty' : 'Steady'}
            </button>
          ))}
        </div>
        <div className={css.row}>
          <button type="button" className={`${css.btn} ${css.btnHot}`} onClick={() => sim.burst('alice', 10)}>
            <Icon name="bolt" size={14} /> Alice sends 10 now
          </button>
        </div>
      </div>

      <div className={css.pgGroup}>
        <div className={css.pgLabel}>Algorithm</div>
        <div className={css.choices}>
          {ALGOS.map((a) => (
            <button key={a} type="button" className={css.choice} aria-pressed={algo === a} onClick={() => sim.setAlgo(a)}>
              {ALGO_LABELS[a]}
            </button>
          ))}
        </div>
        <div className={css.pgLabel} style={{ marginTop: 14 }}>
          Count requests
        </div>
        <div className={css.choices}>
          <button type="button" className={css.choice} aria-pressed={key === 'client'} onClick={() => sim.setKeyMode('client')}>
            Per client (IP)
          </button>
          <button type="button" className={css.choice} aria-pressed={key === 'global'} onClick={() => sim.setKeyMode('global')}>
            All together
          </button>
        </div>
      </div>

      <div className={css.pgGroup}>
        {bucket ? (
          <>
            <Slider
              label={algo === 'token' ? 'Bucket size (burst)' : 'Queue size'}
              value={capacity}
              min={1}
              max={12}
              step={1}
              format={(v) => `${v}`}
              onChange={(v) => {
                setCapacity(v);
                sim.setParam('capacity', v);
              }}
            />
            <Slider
              label={algo === 'token' ? 'Refill rate' : 'Leak rate'}
              value={rate}
              min={0.2}
              max={3}
              step={0.1}
              format={(v) => `${v.toFixed(1)} / s`}
              onChange={(v) => {
                setRate(v);
                sim.setParam('rate', v);
              }}
            />
          </>
        ) : (
          <>
            <Slider
              label="Limit"
              value={limit}
              min={1}
              max={12}
              step={1}
              format={(v) => `${v} requests`}
              onChange={(v) => {
                setLimit(v);
                sim.setParam('limit', v);
              }}
            />
            <Slider
              label="Window"
              value={windowS}
              min={2}
              max={20}
              step={1}
              format={(v) => `${v} s`}
              onChange={(v) => {
                setWindowS(v);
                sim.setParam('window', v);
              }}
            />
          </>
        )}
        <div className={css.stats}>
          <span>
            long-run limit <b>{sustained(cfg).toFixed(2)} req/s</b>
          </span>
          <span>
            allowed <b data-tone="good">{sim.accepted}</b>
          </span>
          <span>
            429s <b data-tone={sim.rejected ? 'bad' : undefined}>{sim.rejected}</b>
          </span>
        </div>
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
                  {done && <Icon name="check" size={14} />}
                  {m.title}
                </div>
                <div className={css.missionText}>{m.text}</div>
                {!done && <div className={css.missionHint}>{m.hint}</div>}
                <div className={css.meter} data-done={done}>
                  <i style={{ width: `${Math.min(100, (h / m.hold) * 100)}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
