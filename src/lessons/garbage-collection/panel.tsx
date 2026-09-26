'use client';

import { Icon } from '@/components/lesson/Icon';
import { usePoll } from '@/components/lesson/usePoll';
import { BLOCK_BYTES, type GcSim } from './sim';
import css from './gc.module.css';

/* ------------------------------------------------------------------ */
/* Cheat sheet                                                         */
/* ------------------------------------------------------------------ */

const ROWS: [string, string, string, string][] = [
  ['Reference counting', 'Free the moment an object’s count of incoming references hits 0', 'Leaks cycles; a count update on every pointer write', 'CPython, Swift and Objective-C (ARC), C++ shared_ptr, Rust Rc'],
  ['Mark-sweep', 'Mark everything reachable from the roots, free the rest in place', 'Fragmentation; pauses grow with the heap', 'Go (concurrent), Ruby, Lua'],
  ['Mark-compact', 'Mark, then slide live objects together and fix every pointer', 'Moving objects costs extra passes', 'V8’s old generation, JVM full GCs'],
  ['Copying', 'Copy survivors into an empty half, reuse the old half whole', 'Half the space sits idle', 'Young generations (V8 Scavenge, JVM)'],
  ['Generational', 'Collect young objects often and cheaply, old ones rarely', 'Needs write barriers for old → young references', 'JVM, V8, .NET'],
  ['Concurrent', 'Mark (and even move) while the program keeps running', 'Uses CPU cores; barriers on every write', 'Go, Java G1 and ZGC, V8 Orinoco'],
];

export function CheatSheet() {
  return (
    <>
      <table className={css.table}>
        <thead>
          <tr>
            <th>Strategy</th>
            <th>How it works</th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map(([a, b, c, d]) => (
            <tr key={a}>
              <td className={css.tdName}>{a}</td>
              <td>
                {b}.
                <div className={css.catch}>{c}</div>
                <div className={css.usedBy}>{d}</div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className={css.subhead}>Remember</p>
      <ul className={css.takeaways}>
        <li>
          Garbage means <strong>unreachable from the roots</strong> (stacks, globals, registers), not &ldquo;no longer needed&rdquo;.
        </li>
        <li>
          <strong>Reference counting</strong> frees immediately but leaks cycles. Weak references or a backup cycle detector fix that.
        </li>
        <li>
          <strong>Tracing</strong> handles cycles. Sweeping leaves holes; <strong>compacting</strong> and <strong>copying</strong> collectors remove them and make allocation a pointer bump.
        </li>
        <li>
          <strong>Most objects die young</strong>, so generational collectors collect the young generation often and the old one rarely.
        </li>
        <li>
          <strong>Pauses</strong> shrink with parallel, incremental and concurrent collection, paid for with CPU time and write barriers.
        </li>
        <li>
          Garbage-collected programs still <strong>leak</strong>: anything you keep a reference to stays alive.
        </li>
      </ul>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Playground                                                          */
/* ------------------------------------------------------------------ */

const MODES: { id: GcSim['pg']['mode']; label: string; sub: string }[] = [
  { id: 'rc', label: 'Reference counting', sub: 'frees on zero' },
  { id: 'mark-sweep', label: 'Mark-sweep', sub: 'leaves holes' },
  { id: 'mark-compact', label: 'Mark-compact', sub: 'slides together' },
];

export function Playground({ sim }: { sim: GcSim }) {
  usePoll(sim, 150);
  const pg = sim.pg;
  const sel = pg.selected;
  const selLabel = sel ? sim.labelOf(sel) : null;
  const missions = [
    {
      id: 'leak',
      title: 'Leak a cycle',
      text: 'With reference counting on, strand two or more objects that are never freed.',
      hint: 'Hint: two nodes point at each other. Cut the root that holds them.',
      done: pg.leakedCycle,
    },
    {
      id: 'chain',
      title: 'Chain reaction',
      text: 'Free three or more objects with a single cut or a single collection.',
      hint: 'Hint: select an object, add children under it, then cut above them.',
      done: sim.stats.bestBatch >= 3,
    },
    {
      id: 'cheese',
      title: 'Swiss cheese',
      text: 'Make an allocation fail while enough blocks are free in total, then fix it with mark-compact.',
      hint: 'Hint: select user and add five 32 B objects. Cut the 1st and 3rd, collect with mark-sweep, then ask for 64 B.',
      done: pg.fixed,
    },
  ];
  return (
    <div className={css.pg}>
      <div className={css.pgGroup}>
        <div className={css.pgLabel}>Collector</div>
        <div className={css.modes}>
          {MODES.map((m) => (
            <button key={m.id} type="button" className={css.mode} aria-pressed={pg.mode === m.id} onClick={() => sim.setPgMode(m.id)} disabled={sim.busy}>
              {m.label}
              <small style={{ display: 'block', color: 'var(--text-3)', fontSize: 11 }}>{m.sub}</small>
            </button>
          ))}
        </div>
        <div className={css.btnRow}>
          <button type="button" className={`${css.btn} ${css.btnHot}`} onClick={() => sim.pgCollect()} disabled={sim.busy || pg.mode === 'rc'}>
            <Icon name="replay" size={14} /> Collect garbage
          </button>
          <button type="button" className={css.btn} onClick={() => sim.resetPg()} disabled={sim.busy}>
            Reset graph
          </button>
        </div>
        {pg.mode === 'rc' && <p className={css.pgHint}>Reference counting frees on its own the moment a count hits zero. There is nothing to run.</p>}
      </div>

      <div className={css.pgGroup}>
        <div className={css.pgLabel}>
          Build <output style={{ fontSize: 12, letterSpacing: 0, textTransform: 'none', color: 'var(--text-1)' }}>{selLabel ? `selected: ${selLabel}` : 'nothing selected'}</output>
        </div>
        <p className={css.pgHint}>Click a root or an object on the stage to select it. New objects hang off the selection. Click any arrow to cut it.</p>
        <div className={css.btnRow} style={{ alignItems: 'center' }}>
          <div className={css.sizes} role="group" aria-label="New object size">
            {[1, 2, 3, 4].map((n) => (
              <button key={n} type="button" aria-pressed={pg.size === n} onClick={() => sim.setPgSize(n)}>
                {n * BLOCK_BYTES} B
              </button>
            ))}
          </div>
          <button type="button" className={`${css.btn} ${css.btnHot}`} onClick={() => sim.pgNew()} disabled={sim.busy}>
            <Icon name="plus" size={14} /> New object
          </button>
          <button type="button" className={css.btn} aria-pressed={pg.linking} onClick={() => sim.toggleLink()} disabled={!sel || sim.busy}>
            <Icon name="arrowRight" size={14} /> {pg.linking ? 'Click the target…' : 'Link to…'}
          </button>
        </div>
        {pg.message && (
          <p key={pg.message.text} className={css.pgMsg} data-kind={pg.message.kind}>
            {pg.message.text}
          </p>
        )}
      </div>

      <div className={css.pgGroup}>
        <div className={css.pgLabel}>Challenges</div>
        <div className={css.missions}>
          {missions.map((m) => (
            <div key={m.id} className={css.mission} data-done={m.done}>
              <div className={css.missionTitle}>
                {m.done && <Icon name="check" size={15} />}
                {m.title}
              </div>
              <div className={css.missionText}>{m.text}</div>
              {!m.done && <div className={css.missionHint}>{m.hint}</div>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
