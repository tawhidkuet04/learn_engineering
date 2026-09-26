import { Hud, type HudItem } from '@/components/stage/chrome';
import { Callouts, StagePrompt, type Callout } from '@/components/stage/overlays';
import type { ReactNode } from 'react';
import type { RaceSim } from './sim';
import css from './race.module.css';

export type HudKey = 'expected' | 'count' | 'lost' | 'inside' | 'retries' | 'stuck' | 'rounds' | 'paid' | 'booked' | 'waited';

/** A callout whose direction can differ on phones. */
export interface StepCallout extends Callout {
  pdir?: Callout['dir'];
  /** Hide on phones (the stage is too small for it) */
  wide?: boolean;
}

const fmtN = (n: number) => n.toLocaleString('en-US');

function hudItem(sim: RaceSim, k: HudKey): HudItem | null {
  const sample = sim.runSample();
  switch (k) {
    case 'expected':
      return { label: 'Expected', value: fmtN(sim.expectedNow()) };
    case 'count': {
      const c = sim.cell('count');
      return { label: 'count', value: typeof c?.value === 'number' ? fmtN(c.value) : String(c?.value ?? '') };
    }
    case 'lost': {
      const last = sim.runs[sim.runs.length - 1];
      const n = sim.cfg.mode === 'run' ? (sample ? sample.lost : (last?.lost ?? 0)) : sim.lostCount;
      return { label: 'Lost updates', value: fmtN(n), tone: n > 0 ? 'bad' : undefined };
    }
    case 'inside': {
      const n = sim.insideCount();
      return { label: 'In critical section', value: `${n} of 2`, tone: n > 1 ? 'bad' : undefined };
    }
    case 'retries': {
      const n = sim.retries();
      return { label: 'CAS retries', value: n, tone: n > 0 ? 'warn' : undefined };
    }
    case 'stuck': {
      const s = sim.stuckFor();
      return { label: 'Stuck for', value: sim.deadlocked ? s.toFixed(1) : '–', unit: sim.deadlocked ? 's' : undefined, tone: sim.deadlocked ? 'bad' : undefined };
    }
    case 'rounds':
      return { label: 'Rounds', value: sim.round + (sim.roundOver ? 1 : 0) };
    case 'paid': {
      const paid = sim.threads.filter((t) => t.status === 'done' && t.result?.ok).length * 80;
      return { label: 'Paid out', value: `$${paid}`, tone: paid > 100 ? 'bad' : undefined };
    }
    case 'booked': {
      const n = sim.threads.filter((t) => t.status === 'done' && t.result?.ok).length;
      return { label: 'Confirmations', value: n, tone: n > 1 ? 'bad' : undefined };
    }
    case 'waited': {
      const n = sim.threads.filter((t) => t.status === 'blocked').length;
      return { label: 'Blocked threads', value: n, tone: n > 0 ? 'warn' : undefined };
    }
  }
}

/** The gap between the memory row and the threads: prompts and results go here. */
function gapPoint(sim: RaceSim): { x: number; y: number } | null {
  if (sim.scene === 'deadlock') {
    const a = sim.boxes.get('l:alice');
    const b = sim.boxes.get('l:bob');
    if (!a || !b) return null;
    if (sim.orient === 'portrait') return { x: sim.w / 2, y: b.y + b.h / 2 + 6 };
    return { x: sim.w / 2, y: (a.y + b.y) / 2 - 14 };
  }
  const c = sim.cells[0] ? sim.boxes.get(`c:${sim.cells[0].id}`) : null;
  const t = sim.threads[0] ? sim.boxes.get(sim.isLive(`r:${sim.threads[0].id}`) ? `r:${sim.threads[0].id}` : `t:${sim.threads[0].id}`) : null;
  if (!c || !t) return null;
  const top = c.y + c.h / 2;
  const bottom = t.y - t.h / 2;
  return { x: sim.w / 2, y: top + (bottom - top) / 2 - 13 };
}

export function StageOverlay({ sim, hud, callouts, stepKey }: { sim: RaceSim; hud: HudKey[]; callouts: StepCallout[]; stepKey: string }) {
  const P = sim.orient === 'portrait';
  // Phones fit two chips; the memory cell already shows count.
  const keys = P ? hud.filter((k) => k !== 'count').slice(0, 2) : hud;
  const items = keys.map((k) => hudItem(sim, k)).filter((x): x is HudItem => !!x);
  const gap = gapPoint(sim);
  const q = sim.game?.pending;
  let banner: ReactNode = null;
  if (gap && sim.result && (sim.roundOver || sim.deadlocked || sim.cfg.mode === 'run') && !sim.run) {
    banner = (
      <div className={`${css.banner} ${sim.deadlocked ? css.bannerBig : ''}`} data-ok={sim.result.ok} style={{ left: gap.x, top: gap.y }}>
        {sim.deadlocked ? (
          <>
            <b>DEADLOCK</b> · both wait forever
          </>
        ) : (
          sim.result.text
        )}
      </div>
    );
  }
  const manual = sim.cfg.mode === 'manual' && !sim.roundOver && !sim.busy && !q;
  const mapped: Callout[] = callouts.filter((c) => !(P && c.wide)).map((c) => ({ target: c.target, text: c.text, dir: P ? (c.pdir ?? c.dir) : c.dir }));
  return (
    <>
      <Hud items={items} />
      {banner}
      {q && gap && (
        <StagePrompt x={gap.x} y={gap.y + 24}>
          {q.ask}
        </StagePrompt>
      )}
      {manual && gap && (
        <StagePrompt x={gap.x} y={gap.y + 24}>
          Your move: pick a thread to run
        </StagePrompt>
      )}
      <Callouts sim={sim} callouts={mapped} stepKey={stepKey} />
    </>
  );
}
