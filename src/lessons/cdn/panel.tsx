'use client';

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Icon } from '@/components/lesson/Icon';
import { lessonCss } from '@/components/lesson/Prose';
import { usePoll } from '@/components/lesson/usePoll';
import { POP_IDS } from './geo';
import type { CdnConfig, CdnSim } from './sim';
import css from './cdn.module.css';

/* ------------------------------------------------------------------ */
/* Cheat sheet                                                         */
/* ------------------------------------------------------------------ */

const ROWS: [string, string, string][] = [
  ['public, max-age=31536000, immutable', 'Any cache may keep it for a year and never recheck.', 'fingerprinted assets like app.3f9a.js'],
  ['public, max-age=300', 'Fresh for 5 minutes, then revalidate (304 if unchanged).', 'images, feeds, pages that may be a little old'],
  ['s-maxage=600', 'A max-age for shared caches (CDNs) only; browsers ignore it.', 'letting the CDN keep a copy longer than browsers'],
  ['stale-while-revalidate=60', 'Once stale, serve the old copy for up to 60 s while refreshing.', 'hiding revalidation latency'],
  ['no-cache', 'Store it, but check with the origin before every use.', 'HTML that points at fingerprinted files'],
  ['private', 'Only the user’s own browser may store it.', 'personalized pages'],
  ['no-store', 'Nobody stores it, anywhere.', 'sensitive data'],
];

export function CheatSheet() {
  return (
    <>
      <p className={css.subhead}>Cache-Control, at a glance</p>
      <div className={css.sheet}>
        {ROWS.map(([h, means, use]) => (
          <div key={h} className={css.sheetRow}>
            <code className={css.sheetKey}>{h}</code>
            <div className={css.sheetMeans}>{means}</div>
            <div className={css.sheetUse}>Use for {use}.</div>
          </div>
        ))}
      </div>

      <p className={css.subhead}>Remember</p>
      <ul className={css.takeaways}>
        <li>
          <strong>Distance is latency:</strong> about 5 ms per 1,000 km each way, paid on every round trip, and a page load takes several.
        </li>
        <li>
          A CDN caches your content in <strong>PoPs</strong> near users. <strong>Anycast</strong> (or GeoDNS) sends each user to the nearest one.
        </li>
        <li>
          <strong>Hit:</strong> served locally in milliseconds. <strong>Miss:</strong> fetched from the origin, stored, then hits. Watch the{' '}
          <strong>hit ratio</strong>.
        </li>
        <li>
          Your <strong>Cache-Control</strong> headers decide what is kept and for how long. Never cache personalized pages as <code>public</code>.
        </li>
        <li>
          <strong>Fingerprint</strong> asset names so a deploy never needs a purge; purge the rest.
        </li>
        <li>
          An <strong>origin shield</strong> and request collapsing protect the origin; edges also absorb spikes and DDoS and terminate TLS near users.
        </li>
      </ul>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Take PoPs offline                                                   */
/* ------------------------------------------------------------------ */

export function PopsCard({ sim, prompt }: { sim: CdnSim; prompt: ReactNode }) {
  usePoll(sim, 150, true);
  const down = POP_IDS.filter((p) => sim.isDown(p));
  return (
    <div className={lessonCss.card}>
      <div className={lessonCss.cardKicker}>
        <Icon name="power" size={13} /> Try it
      </div>
      <p className={lessonCss.cardQ}>{prompt}</p>
      <div className={css.popGrid} role="group" aria-label="PoPs">
        {POP_IDS.map((p) => (
          <button key={p} type="button" className={css.popBtn} aria-pressed={sim.isDown(p)} onClick={() => sim.togglePop(p)}>
            {p}
          </button>
        ))}
      </div>
      <p className={css.stats} style={{ fontFamily: 'var(--font-sans)', fontSize: 14, color: 'var(--text-2)' }}>
        {down.length === 0
          ? 'All six PoPs are up.'
          : down.length === POP_IDS.length - 1
            ? 'One PoP is left, and it serves the whole world. Slow, but still up.'
            : `${down.join(', ')} ${down.length === 1 ? 'is' : 'are'} offline. Those users now reach the next-nearest PoP.`}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Playground                                                          */
/* ------------------------------------------------------------------ */

interface Mission {
  id: string;
  title: string;
  text: string;
  hint: string;
  hold: number;
  check: (s: CdnSim) => boolean;
}

const MISSIONS: Mission[] = [
  {
    id: 'ratio',
    title: 'Cache champion',
    text: 'Keep the hit ratio at 90% or more for 15 seconds.',
    hint: 'Hint: the longer a copy stays fresh, the fewer misses.',
    hold: 15,
    check: (s) => s.cfg.cdn && (s.hitRatio() ?? 0) >= 0.9,
  },
  {
    id: 'crowd',
    title: 'Survive the crowd',
    text: 'Serve 12+ requests per second with no origin errors for 15 seconds.',
    hint: 'Hint: the origin manages 6 per second. Something has to absorb the rest.',
    hold: 15,
    check: (s) => s.cfg.rps >= 12 && s.recentErrors(4) === 0 && s.originLoad() < 1,
  },
  {
    id: 'outage',
    title: 'Fast through an outage',
    text: 'With at least one PoP offline, keep the average response under 30 ms for 15 seconds.',
    hint: 'Hint: rerouted users pay a longer trip, so everyone else should be hitting.',
    hold: 15,
    check: (s) => s.cfg.cdn && s.popsDown.size >= 1 && (s.avgMs() ?? 999) < 30,
  },
];

function Range({ label, value, min, max, step, format, onChange }: { label: string; value: number; min: number; max: number; step: number; format: (v: number) => string; onChange: (v: number) => void }) {
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

export function Playground({ sim, initial }: { sim: CdnSim; initial: CdnConfig }) {
  usePoll(sim, 250);
  const [rps, setRps] = useState(initial.rps);
  const [maxAge, setMaxAge] = useState(initial.policy.logo?.maxAge ?? 15);
  const [held, setHeld] = useState<Record<string, number>>({});
  const lastT = useRef<number | null>(null);

  useEffect(() => {
    const id = window.setInterval(() => {
      const t = sim.t;
      const dt = lastT.current == null ? 0 : Math.max(0, Math.min(1, t - lastT.current));
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
  const swr = !!sim.policyOf('logo').swr;

  return (
    <div className={css.pg}>
      <div className={css.pgGroup}>
        <Range
          label="Traffic"
          value={rps}
          min={0.5}
          max={16}
          step={0.5}
          format={(v) => `${v.toFixed(1)} req/s`}
          onChange={(v) => {
            setRps(v);
            sim.setRps(v);
          }}
        />
        <div style={{ height: 8 }} />
        <Range
          label="max-age on /logo.png"
          value={maxAge}
          min={2}
          max={60}
          step={1}
          format={(v) => `${v} s`}
          onChange={(v) => {
            setMaxAge(v);
            sim.setMaxAge('logo', v);
          }}
        />
      </div>

      <div className={css.pgGroup}>
        <label className={css.switch}>
          <span>
            CDN
            <small>Edges in six cities cache your files</small>
          </span>
          <input type="checkbox" checked={cfg.cdn} onChange={(e) => sim.setCdn(e.target.checked)} />
        </label>
        <label className={css.switch}>
          <span>
            Origin shield
            <small>One cache in front of the origin for every miss</small>
          </span>
          <input type="checkbox" checked={cfg.shield} onChange={(e) => sim.setShield(e.target.checked)} />
        </label>
        <label className={css.switch}>
          <span>
            stale-while-revalidate=30
            <small>Serve a stale logo while refreshing it</small>
          </span>
          <input type="checkbox" checked={swr} onChange={(e) => sim.setSwr('logo', e.target.checked ? 30 : 0)} />
        </label>
      </div>

      <div className={css.pgGroup}>
        <div className={css.pgLabel}>
          PoPs <output>{POP_IDS.length - sim.popsDown.size} of 6 up</output>
        </div>
        <div className={css.popGrid}>
          {POP_IDS.map((p) => (
            <button key={p} type="button" className={css.popBtn} aria-pressed={sim.isDown(p)} onClick={() => sim.togglePop(p)}>
              {p}
            </button>
          ))}
        </div>
        <div className={css.btnRow}>
          <button type="button" className={css.btn} onClick={() => sim.purge('logo')}>
            <Icon name="replay" size={14} /> Purge /logo.png
          </button>
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
    </div>
  );
}
