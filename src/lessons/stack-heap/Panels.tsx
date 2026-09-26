'use client';

import { SliderCard, Stat } from '@/components/lesson/cards';
import { CodeBlock } from '@/components/lesson/CodeBlock';
import { Icon } from '@/components/lesson/Icon';
import { usePoll } from '@/components/lesson/usePoll';
import { DIVE_FRAME, MAX_DEPTH, STACK_LIMIT, bytes, group, tail } from './addr';
import type { MemSim } from './sim';
import css from './sh.module.css';

/* ------------------------------------------------------------------ */
/* Cheat sheet                                                         */
/* ------------------------------------------------------------------ */

const ROWS: [string, string, string][] = [
  ['Holds', 'Locals, arguments, return addresses', 'Objects, arrays, buffers: anything sized at run time or long-lived'],
  ['Lifetime', 'Until the function returns', 'Until freed (or collected)'],
  ['Allocate', 'Move SP: one instruction', 'Search free lists: slower, can fragment'],
  ['Size', 'Small and fixed (8 MB Linux, 1 MB Windows)', 'Up to available memory'],
  ['Freed by', 'Automatically, on return', 'You (C/C++), a GC (Java, JS, Python, Go), the owner (Rust)'],
  ['Classic bugs', 'Stack overflow, returning &local', 'Leaks, use-after-free, double free'],
];

export function CheatSheet() {
  return (
    <>
      <table className={css.table}>
        <thead>
          <tr>
            <th />
            <th>Stack</th>
            <th>Heap</th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map(([a, b, c]) => (
            <tr key={a}>
              <td>{a}</td>
              <td>{b}</td>
              <td>{c}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className={css.subhead}>Remember</p>
      <ul className={css.takeaways}>
        <li>
          Every call pushes a <strong>frame</strong>; returning pops it. Popping frees everything in it, instantly.
        </li>
        <li>
          A <strong>pointer</strong> (or reference) is just an address. Copying it copies the address, never the data.
        </li>
        <li>
          Heap memory lives until someone frees it. Lose the last pointer and it <strong>leaks</strong>; keep using a freed one and it{' '}
          <strong>dangles</strong>.
        </li>
        <li>
          Never let a pointer to a local outlive its function. Set pointers to <code>NULL</code> after <code>free</code>.
        </li>
        <li>
          <strong>Garbage collectors</strong> and <strong>Rust’s ownership</strong> are two answers to one question: who frees this, and when?
        </li>
      </ul>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Recursion depth slider (stack overflow step)                        */
/* ------------------------------------------------------------------ */

/** Round to two significant digits so the slider lands on readable numbers. */
function nice(n: number) {
  if (n < 100) return Math.max(1, Math.round(n));
  const p = 10 ** (Math.floor(Math.log10(n)) - 1);
  return Math.round(n / p) * p;
}

export function DepthCard({ sim, initial }: { sim: MemSim; initial: number }) {
  return (
    <SliderCard
      kicker="Try it · break the stack"
      poll={sim}
      prompt="Set how deep dive() recurses before it returns."
      sliders={[
        {
          label: 'Recursion depth',
          min: 1,
          max: 6,
          step: 0.02,
          initial: Math.log10(initial),
          format: (v) => group(nice(10 ** v)),
          onChange: (v) => sim.setDepth(nice(10 ** v)),
          ends: ['10', '1,000,000'],
        },
      ]}
      stats={() => (
        <>
          <Stat label="frame" value={`${DIVE_FRAME} B`} />
          <Stat label="stack limit" value={bytes(STACK_LIMIT)} />
          <Stat label="fits" value={`≈ ${group(MAX_DEPTH)} frames`} bad={sim.ov.phase === 'crash'} />
        </>
      )}
      done={() =>
        sim.ov.overflowed ? (
          <>
            <strong>Stack overflow.</strong> Frame {group(MAX_DEPTH + 1)} had nowhere to go, touched the guard page, and the kernel killed the process
            with <code>SIGSEGV</code>. No exception, no cleanup: the program is simply gone.
          </>
        ) : null
      }
    />
  );
}

/* ------------------------------------------------------------------ */
/* Playground                                                          */
/* ------------------------------------------------------------------ */

const MISSIONS = [
  { id: 'leak', title: 'Leak a block', text: 'Lose the last pointer to a block without freeing it.' },
  { id: 'uaf', title: 'Catch a use-after-free', text: 'Free a block, then use a pointer that still points at it.' },
  { id: 'alias', title: 'Two names, one block', text: 'Make two pointers point at the same block.' },
  { id: 'clean', title: 'Clean exit', text: 'Allocate at least 3 blocks, free them all, then return from main.' },
] as const;

export function Playground({ sim }: { sim: MemSim }) {
  usePoll(sim, 150);
  const gc = sim.mode === 'gc';
  const ptrs = sim.pgPointers;
  const busy = sim.pgBusy;
  const flags = sim.pg.flags;
  const depth = sim.pg.depth;
  return (
    <div className={css.pg}>
      <div className={css.pgGroup}>
        <div className={css.pgLabel}>
          Stack <output>{['main()', 'main() → f()', 'main() → f() → g()'][depth]}</output>
        </div>
        <div className={css.btns}>
          <button type="button" className={`${css.btn} ${css.btnHot}`} onClick={() => sim.pgCall()} disabled={busy || depth >= 2}>
            <Icon name="plus" size={13} /> call {depth === 0 ? 'f()' : 'g()'}
          </button>
          <button type="button" className={css.btn} onClick={() => sim.pgReturn()} disabled={busy}>
            <Icon name="arrowLeft" size={13} /> {depth === 0 ? 'return from main' : 'return'}
          </button>
        </div>
      </div>

      <div className={css.pgGroup}>
        <div className={css.pgLabel}>
          Heap <output>{sim.heapReserved} B in use</output>
        </div>
        <div className={css.btns}>
          {[16, 32, 64].map((n) => (
            <button key={n} type="button" className={`${css.btn} ${css.btnHot}`} onClick={() => sim.pgMalloc(n)} disabled={busy}>
              {gc ? `GC_MALLOC(${n})` : `malloc(${n})`}
            </button>
          ))}
        </div>
      </div>

      <div className={css.pgGroup}>
        <div className={css.pgLabel}>
          Pointers <output>{ptrs.length}</output>
        </div>
        {ptrs.length === 0 && <p className={css.empty}>No pointers yet. Allocate something.</p>}
        {ptrs.map((p) => (
          <div key={p.name} className={css.ptrRow}>
            <span className={css.ptrName}>
              {p.name}
              <small data-bad={!p.ok && !p.isNull}>
                {p.pending ? `pending… · ${p.fn}()` : p.isNull ? 'NULL' : !p.ok ? 'dangling!' : `→ ${p.target ? tail(p.target.addr, 3) : '?'} · ${p.fn}()`}
              </small>
            </span>
            <span className={css.ptrActs}>
              <button type="button" className={`${css.btn} ${css.btnSm}`} onClick={() => sim.pgUse(p.name)} disabled={busy} title={`${p.name}[0] = 'x'`}>
                use
              </button>
              <button type="button" className={`${css.btn} ${css.btnSm}`} onClick={() => sim.pgCopy(p.name)} disabled={busy} title={`q = ${p.name}`}>
                copy
              </button>
              {!gc && (
                <button type="button" className={`${css.btn} ${css.btnSm}`} onClick={() => sim.pgFree(p.name)} disabled={busy}>
                  free
                </button>
              )}
              <button type="button" className={`${css.btn} ${css.btnSm}`} onClick={() => sim.pgNull(p.name)} disabled={busy || p.isNull}>
                = NULL
              </button>
            </span>
          </div>
        ))}
      </div>

      <div className={css.pgGroup}>
        <div className={css.pgLabel}>Who frees memory?</div>
        <div className={css.seg} role="group">
          <button type="button" aria-pressed={!gc} onClick={() => sim.setMode('c')}>
            You: malloc / free
          </button>
          <button type="button" aria-pressed={gc} onClick={() => sim.setMode('gc')}>
            A garbage collector
          </button>
        </div>
        <p className={css.hint}>
          {gc
            ? 'Like the Boehm GC for C (or Java, JS, Go): blocks nothing points to are collected for you, and there is no free().'
            : 'Every block stays until you free it. The sandbox runs with AddressSanitizer, so misuse gets reported.'}
        </p>
      </div>

      <div className={css.pgGroup}>
        <div className={css.pgLabel}>Challenges</div>
        <div className={css.missions}>
          {MISSIONS.map((m) => {
            const done = flags[m.id];
            return (
              <div key={m.id} className={css.mission} data-done={done}>
                <span className={css.missionMark}>{done && <Icon name="check" size={12} />}</span>
                <span>
                  <div className={css.missionTitle}>{m.title}</div>
                  <div className={css.missionText}>{m.text}</div>
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <CodeBlock spec={{ title: 'sandbox.c · written by your clicks', lang: 'c', code: sim.codeText }} />
    </div>
  );
}
