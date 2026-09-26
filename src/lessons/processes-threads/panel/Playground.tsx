'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { CodeBlock } from '@/components/lesson/CodeBlock';
import { Icon } from '@/components/lesson/Icon';
import { usePoll } from '@/components/lesson/usePoll';
import type { PTConfig, PTSim } from '../sim';
import css from '../pt.module.css';

interface Mission {
  id: string;
  title: string;
  text: string;
  hint: string;
  /** Simulated ms the condition must hold */
  hold: number;
  check: (s: PTSim) => boolean;
}

const runnable = (s: PTSim) => [...s.threads.values()].filter((t) => t.state === 'ready' || t.state === 'running').length;

const MISSIONS: Mission[] = [
  {
    id: 'parallel',
    title: 'Four at once',
    text: 'Keep four threads running at the same instant for 3 ms.',
    hint: 'Hint: parallelism needs cores and threads.',
    hold: 3,
    check: (s) => s.runningNow >= 4,
  },
  {
    id: 'cheap',
    title: 'Cheap switching',
    text: 'On one core with at least four threads taking turns, keep switching overhead under 4% for 6 ms.',
    hint: 'Hint: longer slices switch less often, and some switches cost less than others.',
    hold: 6,
    check: (s) => s.cores.length === 1 && runnable(s) >= 4 && s.overhead < 0.04 && s.util > 0.5,
  },
  {
    id: 'survivor',
    title: 'Survivor',
    text: 'Crash something, and keep at least one process working through it for 4 ms.',
    hint: 'Hint: click a thread or process on the stage. How many processes will you need?',
    hold: 4,
    check: (s) => s.crashes > 0 && s.aliveProcs >= 1 && s.runningNow >= 1,
  },
];

const STAT: Record<string, string> = { running: 'R', ready: 'R', blocked: 'D', sleep: 'S', lock: 'S', new: 'R' };

/** A `ps -eLf`-style listing of the live world: one row per thread; the running ones are highlighted. */
function psListing(sim: PTSim) {
  const rows = ['UID    PID   LWP  S CMD'];
  for (const p of sim.procs.values()) {
    if (!p.alive) continue;
    for (const tid of p.threadIds) {
      const t = sim.threads.get(tid);
      if (!t || t.state === 'dead' || t.state === 'done') continue;
      const on = t.core != null && sim.cores[t.core]?.thread === t.id;
      rows.push(`${on ? '!' : ''}alice  ${String(p.pid).padEnd(5)} ${String(t.tid).padEnd(4)} ${STAT[t.state] ?? 'S'} ./${p.name}`);
    }
  }
  return rows.join('\n');
}

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

export function Playground({ sim, initial }: { sim: PTSim; initial: PTConfig }) {
  usePoll(sim, 250);
  const [cores, setCores] = useState(initial.cores);
  const [slice, setSlice] = useState(initial.slice);
  const [io, setIo] = useState(false);
  const [held, setHeld] = useState<Record<string, number>>({});
  const lastT = useRef<number | null>(null);

  // How long each challenge's condition has held, in simulated ms.
  useEffect(() => {
    const id = window.setInterval(() => {
      const now = sim.t;
      const dt = lastT.current == null ? 0 : Math.max(0, Math.min(1, now - lastT.current));
      lastT.current = now;
      setHeld((prev) => {
        const next = { ...prev };
        for (const m of MISSIONS) {
          if ((prev[m.id] ?? 0) >= m.hold) continue;
          next[m.id] = m.check(sim) ? (prev[m.id] ?? 0) + dt : 0;
        }
        return next;
      });
    }, 200);
    return () => window.clearInterval(id);
  }, [sim]);

  const procs = [...sim.procs.values()];

  return (
    <div className={css.pg}>
      <div className={css.pgGroup}>
        <Slider
          label="CPU cores"
          value={cores}
          min={1}
          max={4}
          step={1}
          format={(v) => `${v}`}
          onChange={(v) => {
            setCores(v);
            sim.setCores(v);
          }}
        />
        <div style={{ height: 8 }} />
        <Slider
          label="Time slice"
          value={slice}
          min={0.3}
          max={4}
          step={0.1}
          format={(v) => `${v.toFixed(1)} ms`}
          onChange={(v) => {
            setSlice(v);
            sim.setSlice(v);
          }}
        />
      </div>

      <div className={css.pgGroup}>
        <div className={css.pgLabel}>
          Processes <output>{procs.length} / 4</output>
        </div>
        {procs.map((p) => (
          <div key={p.id} className={css.procRow}>
            <span className={css.procName}>
              <span className={css.dot} data-down={!p.alive} />
              {p.letter} · {p.pid}
            </span>
            <button type="button" className={css.iconBtn} onClick={() => sim.removeThread(p.id)} disabled={!p.alive || p.threadIds.length <= 1} aria-label={`Remove a thread from ${p.letter}`}>
              <Icon name="minus" size={13} />
            </button>
            <span style={{ minWidth: 58, textAlign: 'center', color: 'var(--text-2)', fontSize: 11 }}>
              {p.threadIds.length} thread{p.threadIds.length > 1 ? 's' : ''}
            </span>
            <button type="button" className={css.iconBtn} onClick={() => sim.spawnThread(p.id)} disabled={!p.alive || p.threadIds.length >= 5} aria-label={`Add a thread to ${p.letter}`}>
              <Icon name="plus" size={13} />
            </button>
            <span className={css.procMeta}>
              {p.alive ? (
                <button type="button" className={css.iconBtn} onClick={() => sim.crashProcess(p.id, 'SIGKILL')} aria-label={`Kill process ${p.letter}`}>
                  kill
                </button>
              ) : (
                <button type="button" className={css.iconBtn} onClick={() => sim.restartProcess(p.id)} aria-label={`Restart process ${p.letter}`}>
                  <Icon name="replay" size={12} /> restart
                </button>
              )}
            </span>
          </div>
        ))}
        <div className={css.row}>
          <button type="button" className={css.iconBtn} onClick={() => sim.removeProcess()} disabled={procs.length <= 1} aria-label="Remove the last process">
            <Icon name="minus" size={13} /> process
          </button>
          <button type="button" className={css.iconBtn} onClick={() => sim.addProcess(1)} disabled={procs.length >= 4} aria-label="Start a new process">
            <Icon name="plus" size={13} /> process
          </button>
        </div>
      </div>

      <div className={css.pgGroup}>
        <label className={css.switch}>
          <span>
            Threads read from disk
            <small>Each thread blocks now and then, and gives up its core</small>
          </span>
          <input
            type="checkbox"
            checked={io}
            onChange={(e) => {
              setIo(e.target.checked);
              sim.setIoHeavy(e.target.checked);
            }}
          />
        </label>
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

      <CodeBlock
        spec={{
          title: 'ps -eLf · live, trimmed',
          lang: 'shell',
          code: psListing(sim),
          note: 'One row per thread (LWP is the thread ID). Highlighted rows are on a core right now.',
        }}
      />
    </div>
  );
}
