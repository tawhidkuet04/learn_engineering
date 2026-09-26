'use client';

import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { Icon } from '@/components/lesson/Icon';
import { lessonCss } from '@/components/lesson/Prose';
import { usePoll } from '@/components/lesson/usePoll';
import { SIG } from '@/lib/sim/colors';
import { N_STOPS, RULE_STOPS } from './engine/chart';
import { CLASSES, CLASS_IDS, UNIVERSE_LG_NS, commas, fmtCountLg, fmtTimeLg, type ClassId } from './model';
import type { BigOSim } from './sim';
import css from './bigo.module.css';

/* Cards follow the kit's look (lessonCss.card + kicker) so every "your turn"
   moment on the site feels the same. */

function Kicker({ icon = 'bolt', children, right }: { icon?: 'bolt' | 'target' | 'flag'; children: ReactNode; right?: ReactNode }) {
  return (
    <div className={css.cardHead}>
      <div className={lessonCss.cardKicker}>
        <Icon name={icon} size={13} /> {children}
      </div>
      {right}
    </div>
  );
}

function Range({ value, min, max, onChange, label }: { value: number; min: number; max: number; onChange: (v: number) => void; label: string }) {
  const fill = ((value - min) / (max - min)) * 100;
  return (
    <input
      className={css.range}
      type="range"
      min={min}
      max={max}
      step={1}
      value={value}
      style={{ '--fill': `${fill}%` } as CSSProperties}
      onChange={(e) => onChange(Number(e.target.value))}
      aria-label={label}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Count the steps: array size (reads the live n, since the stage      */
/* sweeps 4 → 16 on its own until the learner takes over)              */
/* ------------------------------------------------------------------ */

export function ScanSizeCard({ sim }: { sim: BigOSim }) {
  usePoll(sim, 120);
  const s = sim.scan;
  const n = s.mode === 'max' ? s.n : 8;
  return (
    <div className={lessonCss.card}>
      <Kicker>Try it</Kicker>
      <p className={lessonCss.cardQ}>Pick an array size and count the comparisons.</p>
      <div className={css.sliderHead}>
        <span>Array size n</span>
        <output>{n}</output>
      </div>
      <Range value={n} min={2} max={16} onChange={(v) => sim.setScanN(v)} label="Array size n" />
      <div className={css.scale}>
        <span>2</span>
        <span>16</span>
      </div>
      <div className={css.stats}>
        <span>
          comparisons <b>{s.steps}</b>
        </span>
        <span>
          runs plotted <b>{s.dots.length}</b>
        </span>
      </div>
      {s.dots.length >= 3 && (
        <p className={css.note}>
          <strong>Every dot sits on the line steps = n.</strong> The values in the array never matter, only how many there are.
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Growth chart: n (zoom) + linear / log scale                         */
/* ------------------------------------------------------------------ */

export function ChartCard({ sim, initialN, initialLog }: { sim: BigOSim; initialN: number; initialLog: boolean }) {
  usePoll(sim, 250);
  const [idx, setIdx] = useState(() => Math.max(0, N_STOPS.indexOf(initialN)));
  const [log, setLog] = useState(initialLog);
  const N = N_STOPS[idx];
  const t2 = CLASSES.n2.lg(N);
  const tn = CLASSES.nlogn.lg(N);
  return (
    <div className={lessonCss.card}>
      <Kicker>Try it</Kicker>
      <p className={lessonCss.cardQ}>Drag n to the right, then switch to a log scale.</p>
      <div className={css.sliderHead}>
        <span>Input size n</span>
        <output>{commas(N)}</output>
      </div>
      <Range
        value={idx}
        min={0}
        max={N_STOPS.length - 1}
        onChange={(v) => {
          setIdx(v);
          sim.setChartN(N_STOPS[v]);
        }}
        label="Input size n"
      />
      <div className={css.scale}>
        <span>10</span>
        <span>1,000,000</span>
      </div>
      <div className={css.seg} role="group" aria-label="Scale">
        {[false, true].map((on) => (
          <button
            key={String(on)}
            type="button"
            aria-pressed={log === on}
            onClick={() => {
              setLog(on);
              sim.setChartLog(on);
            }}
          >
            {on ? 'Log scale' : 'Linear scale'}
          </button>
        ))}
      </div>
      <div className={css.stats}>
        <span>
          n log n <b>{fmtTimeLg(tn)}</b>
        </span>
        <span>
          n² <b data-tone={t2 > 11 ? 'bad' : t2 > 9 ? 'warn' : undefined}>{fmtTimeLg(t2)}</b>
        </span>
      </div>
      {N >= 1_000_000 && (
        <p className={css.note}>
          <strong>A million items:</strong> 1 ms for O(n), 20 ms for O(n log n), and about 17 minutes for O(n²).
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Drop the constants: zoom out                                        */
/* ------------------------------------------------------------------ */

export function RulesCard({ sim }: { sim: BigOSim }) {
  const [idx, setIdx] = useState(0);
  const N = RULE_STOPS[idx];
  const r = 1 + 100 / N;
  return (
    <div className={lessonCss.card}>
      <Kicker>Try it</Kicker>
      <p className={lessonCss.cardQ}>Zoom out and watch n² + 100n melt into n².</p>
      <div className={css.sliderHead}>
        <span>Chart shows n up to</span>
        <output>{commas(N)}</output>
      </div>
      <Range
        value={idx}
        min={0}
        max={RULE_STOPS.length - 1}
        onChange={(v) => {
          setIdx(v);
          sim.setChartN(RULE_STOPS[v]);
        }}
        label="Zoom"
      />
      <div className={css.scale}>
        <span>10</span>
        <span>10,000</span>
      </div>
      <div className={css.stats}>
        <span>
          (n² + 100n) ÷ n² <b data-tone={r < 1.1 ? 'good' : r < 2 ? 'warn' : 'bad'}>{r < 10 ? r.toFixed(r < 1.1 ? 3 : 2) : r.toFixed(0)}×</b>
        </span>
        <span>
          3n ÷ n <b>3×</b>
        </span>
      </div>
      {N >= 10_000 && (
        <p className={css.note}>
          <strong>Only 1% apart.</strong> The 100n term still exists, it just stops mattering. The factor of 3 never goes away, but it never changes the
          shape either.
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Cheat sheet                                                         */
/* ------------------------------------------------------------------ */

const ROWS: [ClassId, string, string, string][] = [
  ['c1', 'arr[i], set.has(x)', '1 ns', 'same'],
  ['logn', 'binary search', '20 ns', '+1 step'],
  ['n', 'scan, includes, sum', '1 ms', '×2'],
  ['nlogn', 'merge sort, arr.sort()', '20 ms', 'a bit over ×2'],
  ['n2', 'nested loops, all pairs', '17 min', '×4'],
  ['exp', 'every subset, naive fib', 'never', 'squares'],
];

export function CheatSheet() {
  return (
    <>
      <table className={css.table}>
        <thead>
          <tr>
            <th>Class</th>
            <th>Typical code</th>
            <th>n = 1M</th>
            <th>Double n</th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map(([id, ex, t, d]) => (
            <tr key={id}>
              <td style={{ color: CLASSES[id].color }}>{CLASSES[id].big}</td>
              <td>{ex}</td>
              <td>{t}</td>
              <td>{d}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className={css.subhead}>Remember</p>
      <ul className={css.takeaways}>
        <li>
          Count <strong>steps as a function of n</strong>, not seconds. What matters is how the count grows as n gets large.
        </li>
        <li>
          Keep the <strong>dominant term</strong>: drop constant factors and lower-order terms. 3n² + 100n + 7 is O(n²).
        </li>
        <li>
          Loops in sequence <strong>add</strong>; loops inside loops <strong>multiply</strong>. A halving or doubling loop is log n.
        </li>
        <li>
          Watch for <strong>hidden loops</strong>: <code>includes</code>, <code>indexOf</code> and <code>splice</code> inside a loop make it O(n²).
          A <code>Set</code> or <code>Map</code> usually fixes it.
        </li>
        <li>
          Unless stated otherwise, Big-O is the <strong>worst case</strong>. Hash lookups are O(1) on <strong>average</strong>.
        </li>
        <li>
          <strong>Space</strong> counts extra memory the same way. Memoization and Sets buy time with memory.
        </li>
        <li>
          Constants still matter for <strong>small n</strong>: measure before you optimize.
        </li>
      </ul>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Playground                                                          */
/* ------------------------------------------------------------------ */

export const PLAY_STOPS = [1, 2, 3, 4, 5, 8, 10, 16, 20, 30, 50, 64, 100, 200, 500, 1_000, 2_000, 5_000, 10_000, 20_000, 50_000, 100_000, 200_000, 500_000, 1_000_000, 2_000_000, 5_000_000, 10_000_000, 100_000_000, 1_000_000_000];

interface Mission {
  id: string;
  title: string;
  text: string;
  hint: string;
  check: (s: BigOSim) => boolean;
}

const on = (s: BigOSim, ...ids: ClassId[]) => ids.every((id) => s.lapse.lanes.includes(id));

const MISSIONS: Mission[] = [
  {
    id: 'minute',
    title: 'Milliseconds vs minutes',
    text: 'Find an n where O(n log n) finishes in under a second but O(n²) takes more than a minute.',
    hint: 'Hint: somewhere between a few hundred thousand and a few million.',
    check: (s) => on(s, 'nlogn', 'n2') && CLASSES.nlogn.lg(s.lapse.n) < 9 && CLASSES.n2.lg(s.lapse.n) > Math.log10(60e9),
  },
  {
    id: 'universe',
    title: 'Outlast the universe',
    text: 'Pick an n where O(2ⁿ) would run longer than the universe has existed.',
    hint: 'Hint: it takes less than you think.',
    check: (s) => on(s, 'exp') && CLASSES.exp.lg(s.lapse.n) > UNIVERSE_LG_NS,
  },
  {
    id: 'upset',
    title: 'Upset at tiny n',
    text: 'Find an n where O(2ⁿ) finishes before O(n²).',
    hint: 'Hint: Big-O is about large n. Look very small.',
    check: (s) => on(s, 'exp', 'n2') && CLASSES.exp.lg(s.lapse.n) < CLASSES.n2.lg(s.lapse.n) - 1e-9,
  },
];

export function Playground({ sim, initialN }: { sim: BigOSim; initialN: number }) {
  usePoll(sim, 250);
  const [idx, setIdx] = useState(() => Math.max(0, PLAY_STOPS.indexOf(initialN)));
  const [done, setDone] = useState<Record<string, boolean>>({});
  const n = PLAY_STOPS[idx];

  useEffect(() => {
    const id = window.setInterval(() => {
      setDone((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const m of MISSIONS) {
          if (!next[m.id] && m.check(sim)) {
            next[m.id] = true;
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 300);
    return () => window.clearInterval(id);
  }, [sim]);

  const lanes = sim.lapse.lanes;
  return (
    <div className={css.pg}>
      <div className={css.pgGroup}>
        <div className={css.pgLabel}>
          Racers <output>{lanes.length} / 6</output>
        </div>
        <div className={css.laneChips}>
          {CLASS_IDS.map((id) => (
            <button
              key={id}
              type="button"
              className={css.laneChip}
              aria-pressed={lanes.includes(id)}
              style={{ '--c': CLASSES[id].color } as CSSProperties}
              onClick={() => sim.toggleLapseLane(id)}
              disabled={lanes.includes(id) && lanes.length <= 1}
            >
              <i />
              {CLASSES[id].big}
            </button>
          ))}
        </div>
      </div>

      <div className={css.pgGroup}>
        <div className={css.pgLabel}>
          Input size n <output>{commas(n)}</output>
        </div>
        <Range
          value={idx}
          min={0}
          max={PLAY_STOPS.length - 1}
          onChange={(v) => {
            setIdx(v);
            sim.setLapseN(PLAY_STOPS[v]);
          }}
          label="Input size n"
        />
        <div className={css.scale}>
          <span>1</span>
          <span>1 billion</span>
        </div>
        <div className={css.results}>
          {lanes.map((id) => {
            const lg = CLASSES[id].lg(n);
            const never = lg > UNIVERSE_LG_NS;
            return (
              <Result key={id} color={CLASSES[id].color} label={CLASSES[id].big} steps={fmtCountLg(lg)} time={never ? 'never' : fmtTimeLg(lg)} bad={never} />
            );
          })}
        </div>
        <div className={css.btnRow}>
          <button type="button" className={css.btn} onClick={() => sim.raceAgain()}>
            <Icon name="replay" size={14} /> Race again
          </button>
        </div>
      </div>

      <div className={css.pgGroup}>
        <div className={css.pgLabel}>
          Challenges <output>{Object.values(done).filter(Boolean).length} / {MISSIONS.length}</output>
        </div>
        <div className={css.missions}>
          {MISSIONS.map((m) => (
            <div key={m.id} className={css.mission} data-done={!!done[m.id]}>
              <div className={css.missionTitle}>
                {done[m.id] && <Icon name="check" size={15} />}
                {m.title}
              </div>
              <div className={css.missionText}>{m.text}</div>
              {!done[m.id] && <div className={css.missionHint}>{m.hint}</div>}
            </div>
          ))}
        </div>
      </div>
      <p className={lessonCss.aside} style={{ marginTop: 0 }}>
        Times assume exactly one nanosecond per step and ignore constants, so they&apos;re an order-of-magnitude guide, not a benchmark.
      </p>
    </div>
  );
}

const Result = ({ color, label, steps, time, bad }: { color: string; label: string; steps: string; time: string; bad: boolean }) => (
  <>
    <span style={{ color, fontWeight: 600 }}>{label}</span>
    <span>{steps} steps</span>
    <span style={bad ? { color: SIG.err } : undefined}>{time}</span>
  </>
);
