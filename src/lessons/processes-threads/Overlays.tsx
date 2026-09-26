import type { HudItem, LegendItem } from '@/components/stage/chrome';
import { RLine, RResult, Readout, StagePrompt } from '@/components/stage/overlays';
import { SIG } from '@/lib/sim/colors';
import { hex, type PTSim, type Switch, type Thread } from './sim';
import type { HudKey, LegendKey } from './types';
import css from './pt.module.css';

/* ------------------------------------------------------------------ */
/* HUD                                                                 */
/* ------------------------------------------------------------------ */

export function hudItems(sim: PTSim, keys: HudKey[]): HudItem[] {
  const out: HudItem[] = [];
  const L = sim.orient === 'landscape';
  for (const k of keys) {
    if (k === 'switches') out.push({ label: L ? 'Context switches' : 'Switches', value: sim.nSw });
    if (k === 'overhead') {
      const o = sim.overhead * 100;
      out.push({ label: L ? 'Time spent switching' : 'Switching', value: o.toFixed(0), unit: '%', tone: o > 15 ? 'bad' : o > 7 ? 'warn' : 'good' });
    }
    if (k === 'wait') {
      const w = sim.maxWait;
      out.push({ label: 'Longest wait', value: w.toFixed(1), unit: 'ms', tone: w > 8 ? 'bad' : w > 5 ? 'warn' : undefined });
    }
    if (k === 'util') out.push({ label: 'Core busy', value: Math.round(sim.util * 100), unit: '%', tone: sim.util > 0.9 ? 'good' : undefined });
    if (k === 'batch') {
      // Until the first run finishes, show the clock ticking; afterwards, the last finish time.
      const first = sim.batchLast == null;
      out.push({
        label: first ? (L ? 'Job running for' : 'Job time') : L ? 'Job finished in' : 'Job took',
        value: (first ? sim.t - sim.batchStart : (sim.batchLast ?? 0)).toFixed(1),
        unit: 'ms',
        tone: !first && sim.batchDoneAt != null ? 'good' : undefined,
      });
    }
    if (k === 'running') out.push({ label: L ? 'Running right now' : 'Running', value: `${sim.runningNow} / ${sim.cores.length}` });
    if (k === 'alive') {
      const n = sim.procs.size;
      const a = sim.aliveProcs;
      out.push({ label: L ? 'Processes alive' : 'Alive', value: `${a} / ${n}`, tone: a < n ? 'bad' : 'good' });
    }
    if (k === 'spaces') {
      out.push({ label: 'Address spaces', value: sim.procs.size });
      out.push({ label: 'Threads', value: sim.threads.size });
    }
    if (k === 'race') {
      const grew = sim.race.value - sim.race.start;
      out.push({ label: 'Increments run', value: sim.race.attempts });
      out.push({ label: 'hits grew by', value: grew, tone: sim.race.lost > 0 ? 'bad' : grew > 0 ? 'good' : undefined });
    }
    if (k === 'ipc') {
      out.push({ label: 'Messages', value: sim.ipc.msgs });
      out.push({ label: 'Copies', value: sim.ipc.copies, tone: 'warn' });
      if (L) out.push({ label: 'System calls', value: sim.ipc.calls });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Legend                                                              */
/* ------------------------------------------------------------------ */

const LEGEND: Record<LegendKey, LegendItem> = {
  thread: { label: 'thread', color: '#FF7EB6' },
  tsw: { label: 'thread switch', color: SIG.hc, shape: 'square' },
  psw: { label: 'process switch', color: SIG.heavy, shape: 'square' },
  io: { label: 'disk read', color: SIG.req, shape: 'small' },
  wait: { label: 'waiting on I/O', color: SIG.req, shape: 'ring' },
  sleep: { label: 'z = sleeping', color: SIG.text2, shape: 'ring' },
  load: { label: 'code & data', color: SIG.req, shape: 'small' },
  crash: { label: 'crashed', color: SIG.err },
  lock: { label: 'lock / unlock', color: SIG.hc, shape: 'small' },
  mem: { label: 'load', color: SIG.req, shape: 'small' },
  store: { label: 'store', color: SIG.res, shape: 'small' },
  lost: { label: 'lost update', color: SIG.err, shape: 'small' },
  msg: { label: 'message, copied', color: SIG.req, shape: 'env' },
  fork: { label: 'fork()', color: SIG.hc, shape: 'small' },
  ok: { label: 'reachable', color: SIG.res, shape: 'small' },
  gil: { label: 'GIL', color: SIG.warn, shape: 'ring' },
};

export function legendItems(keys: LegendKey[]) {
  return keys.filter((k) => k !== 'thread').map((k) => LEGEND[k]);
}

/* ------------------------------------------------------------------ */
/* Context switch inspector                                            */
/* ------------------------------------------------------------------ */

function steps(sim: PTSim, sw: Switch) {
  const from = sw.from ? sim.threads.get(sw.from) : null;
  const to = sim.threads.get(sw.to);
  const tp = sim.procs.get(sw.toProc);
  const fn = from?.name ?? 'idle';
  const tn = to?.name ?? '?';
  const why =
    sw.cause === 'timer'
      ? 'timer interrupt → kernel'
      : sw.cause === 'block'
        ? `${fn} blocks → kernel`
        : sw.cause === 'done'
          ? `${fn} exits → kernel`
          : sw.cause === 'lock'
            ? `${fn} waits on a lock`
            : 'idle core wakes up';
  const out: string[] = [why, `save ${fn}’s registers`, `pick next: ${tn}`];
  if (sw.kind === 'psw') {
    out.push(`load ${tp ? `process ${tp.letter}’s` : 'its'} page table`);
    out.push('TLB & caches: cold');
  }
  out.push(`restore ${tn}’s registers`);
  return out;
}

export function SwitchInspector({ sim }: { sim: PTSim }) {
  const core = sim.cores[0];
  const cpu = sim.boxes.get('cpu');
  if (!core || !cpu || Number.isNaN(cpu.x)) return null;
  const L = sim.orient === 'landscape';
  const x = cpu.x + cpu.w / 2 + 24;
  const y = cpu.y + 6;
  const anchor = L ? 'right' : 'strip';
  const sw = core.sw;
  if (sw) {
    const list = steps(sim, sw);
    const k = 1 - Math.max(0, sw.left) / sw.dur;
    const cur = Math.min(list.length - 1, Math.floor(k * list.length));
    const head = sw.kind === 'psw' ? 'context switch · other process' : 'context switch · same process';
    if (!L) {
      return (
        <Readout anchor="strip" head={head} fresh>
          <RLine>
            {cur + 1}/{list.length} <em>{list[cur]}</em>
          </RLine>
        </Readout>
      );
    }
    return (
      <Readout x={x} y={y} anchor={anchor} head={head} fresh width={262}>
        {list.map((s, i) => (
          <RLine key={i} dim={i > cur}>
            {i < cur ? '✓ ' : i === cur ? '▸ ' : '· '}
            {i === cur ? <em>{s}</em> : s}
          </RLine>
        ))}
        <RResult>
          cost so far <b>{(sw.dur - Math.max(0, sw.left)).toFixed(1)} ms</b>
        </RResult>
      </Readout>
    );
  }
  const th: Thread | undefined = core.thread ? sim.threads.get(core.thread) : undefined;
  if (!th) {
    return (
      <Readout x={x} y={y} anchor={anchor} head="core 0 · registers">
        <RLine dim>idle</RLine>
      </Readout>
    );
  }
  const p = sim.procs.get(th.procId);
  const sp = `0x7ffd…${(th.sp & 0xfff).toString(16).padStart(3, '0')}`;
  if (!L) {
    return (
      <Readout anchor="strip" head={`core 0 · running ${th.name}`}>
        <RLine>
          pc <em>{hex(th.pc)}</em> · sp {sp} · page table {p?.letter}
        </RLine>
      </Readout>
    );
  }
  return (
    <Readout x={x} y={y} anchor={anchor} head={`core 0 · running ${th.name}`} width={262}>
      <RLine>
        pc&nbsp;&nbsp;<em>{hex(th.pc)}</em>
      </RLine>
      <RLine>sp&nbsp;&nbsp;{sp}</RLine>
      <RLine dim>page table: process {p?.letter}</RLine>
      <RResult>
        slice left <b>{Math.max(0, core.slice).toFixed(1)} ms</b>
      </RResult>
    </Readout>
  );
}

/* ------------------------------------------------------------------ */
/* Live thread table, the way `top -H` lists threads                   */
/* ------------------------------------------------------------------ */

const STATE_LETTER: Partial<Record<Thread['state'], string>> = { running: 'R', ready: 'R', blocked: 'D', sleep: 'S', lock: 'S' };

export function ThreadTable({ sim }: { sim: PTSim }) {
  const at = sim.M.table;
  if (!at) return null;
  const rows = [...sim.threads.values()].filter((t) => STATE_LETTER[t.state] && sim.procs.get(t.procId)?.alive);
  return (
    <div className={css.ps} style={{ left: at.x, top: at.y, width: at.w }}>
      <div className={css.psHead}>
        <span>$ top -H</span>
        <span>one row per thread</span>
      </div>
      <table className={css.psTable}>
        <thead>
          <tr>
            <th />
            <th>PID</th>
            <th>TID</th>
            <th>S</th>
            <th>%CPU</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => {
            const p = sim.procs.get(t.procId)!;
            const on = t.core != null && sim.cores[t.core]?.thread === t.id;
            return (
              <tr key={t.id} data-on={on}>
                <td>
                  <i style={{ background: t.color }} />
                  {t.name}
                </td>
                <td>{p.pid}</td>
                <td>{t.tid}</td>
                <td data-s={STATE_LETTER[t.state]}>{STATE_LETTER[t.state]}</td>
                <td>{Math.round(t.load * 100)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className={css.psFoot}>R running or ready · S sleeping · D waiting on disk</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Prediction prompts on the stage                                     */
/* ------------------------------------------------------------------ */

export function AskPrompt({ sim }: { sim: PTSim }) {
  const q = sim.game?.pending;
  if (!q) return null;
  const L = sim.orient === 'landscape';
  let x = sim.w / 2;
  let y = 60;
  let text = '';
  if (sim.pkind === 'next') {
    const cpu = sim.boxes.get('cpu');
    text = L ? `${q.ask ?? 'Which thread runs next?'} Click one` : 'Who runs next? Tap a thread';
    if (cpu) {
      x = cpu.x;
      y = cpu.y - cpu.h / 2 - 22;
      // Phones: between the (hidden) ready queue and the processes, clear of the HUD.
      const tops = [...sim.procs.keys()].map((id) => sim.boxes.get(`proc:${id}`)).filter((b) => b && !Number.isNaN(b.y));
      if (!L && tops.length) y = Math.min(...tops.map((b) => b!.y - b!.h / 2)) - 8;
    }
  } else if (sim.asking) {
    const key = sim.asking.key;
    const r = sim.rectOf(key);
    text = sim.pkind === 'crash' ? 'What does the OS kill?' : `Can ${lastThreadName(sim)} reach this?`;
    // Sit above the process that holds the thing being asked about, so nothing inside it is covered.
    const i = key.indexOf(':');
    const id = key.slice(i + 1);
    const th = key.startsWith('tok:') ? sim.threads.get(id) : null;
    const pb = sim.boxes.get(`proc:${th ? th.procId : id}`);
    if (r) x = r.x;
    if (pb) {
      if (!r) x = pb.x;
      y = pb.y - pb.h / 2 - 12 - (sim.M.tabs ? 20 : 0);
    } else if (r) y = r.y - r.h / 2 - 10;
  } else return null;
  const half = (text.length * 6.7 + 22) / 2;
  x = Math.min(Math.max(x, half + 10), sim.w - half - 10);
  y = Math.max(y, 40);
  return (
    <StagePrompt x={x} y={y}>
      {text}
    </StagePrompt>
  );
}

function lastThreadName(sim: PTSim) {
  const a = [...sim.procs.values()][0];
  const id = a?.threadIds[a.threadIds.length - 1];
  return (id && sim.threads.get(id)?.name) ?? 'it';
}
