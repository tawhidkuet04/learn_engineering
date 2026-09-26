import type { ReactNode } from 'react';
import { Effects, Flights, Wires } from '@/components/stage/svg';
import { SIG } from '@/lib/sim/colors';
import kit from '@/components/stage/stage.module.css';
import { FS, detOf, hex, type Col, type Core, type PGeom, type Proc, type PTSim, type Thread } from './sim';
import css from './pt.module.css';

const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(' ');
const INK = '#05080f';

export interface SceneProps {
  sim: PTSim;
  /** Keys of the things this step is about; everything else is dimmed */
  focus?: string[];
  /** Narration hover, drawn as a dashed markup ring */
  highlight?: string | null;
  /** Threads the learner may click (prediction answers or crash mode) */
  pickThreads?: boolean;
  onThread?: (tid: string) => void;
  onProc?: (pid: string) => void;
  crashMode?: boolean;
}

function isDim(focus: string[] | undefined, key: string) {
  if (!focus || !focus.length) return false;
  return !focus.some((f) => f === key || key.startsWith(`${f}:`) || (f.endsWith('*') && key.startsWith(f.slice(0, -1))));
}

/* ------------------------------------------------------------------ */

export function Scene({ sim, focus, highlight, pickThreads, onThread, onProc, crashMode }: SceneProps) {
  const procs = [...sim.procs.values()];
  const threads = [...sim.threads.values()];
  const pending = !!sim.game?.pending;
  const live = (t: Thread) => t.state !== 'dead' && t.state !== 'done' && t.state !== 'new';
  /** Answer candidates for "who runs next?": pulse to invite a click */
  const pickable = (t: Thread) => !!pickThreads && pending && sim.pkind === 'next' && live(t) && t.state !== 'running';
  /** Crash mode: clickable, with a red ring on hover */
  const crashable = (t: Thread) => !!crashMode && !pending && live(t);
  return (
    <>
      <PtDefs />
      <Wires sim={sim} />
      <Tethers sim={sim} focus={focus} />
      <CpuChip sim={sim} dim={isDim(focus, 'cpu')} glow={highlight === 'cpu'} />
      {sim.cores.map((c) => (
        <CoreBox key={c.i} sim={sim} core={c} dim={isDim(focus, `core:${c.i}`) && isDim(focus, 'cpu')} glow={highlight === `core:${c.i}`} />
      ))}
      <QueueStrip sim={sim} dim={isDim(focus, 'queue')} glow={highlight === 'queue'} />
      {procs.map((p) => (
        <ProcBox
          key={p.id}
          sim={sim}
          p={p}
          dim={isDim(focus, `proc:${p.id}`)}
          highlight={highlight}
          onClick={crashMode && onProc && p.alive ? () => onProc(p.id) : undefined}
        />
      ))}
      <FileCard sim={sim} dim={isDim(focus, 'file')} glow={highlight === 'file'} />
      <Disk sim={sim} dim={isDim(focus, 'disk')} glow={highlight === 'disk'} />
      <Kernel sim={sim} dim={isDim(focus, 'kernel')} glow={highlight === 'kernel'} />
      <Gantt sim={sim} dim={isDim(focus, 'gantt')} glow={highlight === 'gantt'} />
      <Flights sim={sim} />
      {threads.map((t) => {
        const p = sim.procs.get(t.procId);
        const dim = isDim(focus, `proc:${t.procId}`) && !(t.state === 'running' && !isDim(focus, 'cpu'));
        return (
          <Token
            key={t.id}
            sim={sim}
            t={t}
            dim={dim}
            glow={highlight === `tok:${t.id}` || highlight === `col:${t.id}`}
            alpha={sim.boxes.get(`proc:${t.procId}`)?.alpha ?? 1}
            revealed={sim.reveal === t.id}
            pickable={pickable(t)}
            crashable={crashable(t)}
            dead={!p?.alive}
            onClick={onThread && (pickable(t) || crashable(t)) ? () => onThread(t.id) : undefined}
          />
        );
      })}
      <Effects sim={sim} />
      <AskRing sim={sim} />
      {highlight && <HighlightRing sim={sim} k={highlight} />}
    </>
  );
}

/* ------------------------------------------------------------------ */

function PtDefs() {
  return (
    <defs>
      <pattern id="pt-hatch-v" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="6" height="6" fill="rgba(181,155,255,0.22)" />
        <line x1="0" y1="0" x2="0" y2="6" stroke="rgba(181,155,255,0.85)" strokeWidth="2" />
      </pattern>
      <pattern id="pt-hatch-o" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="6" height="6" fill="rgba(255,154,60,0.22)" />
        <line x1="0" y1="0" x2="0" y2="6" stroke="rgba(255,154,60,0.9)" strokeWidth="2" />
      </pattern>
      <pattern id="pt-hatch-r" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <line x1="0" y1="0" x2="0" y2="7" stroke="rgba(255,77,106,0.3)" strokeWidth="2" />
      </pattern>
    </defs>
  );
}

function Glow({ x, y, w, h, rx = 10 }: { x: number; y: number; w: number; h: number; rx?: number }) {
  return <rect x={x - 6} y={y - 6} width={w + 12} height={h + 12} rx={rx + 4} fill="none" stroke="var(--accent)" strokeWidth={1.4} strokeDasharray="3 3" />;
}

function HighlightRing({ sim, k }: { sim: PTSim; k: string }) {
  if (sim.boxes.has(k)) return null; // boxes draw their own glow
  if (k.startsWith('proc:') || k === 'cpu' || k.startsWith('core:')) return null;
  const r = sim.rectOf(k);
  if (!r) return null;
  const round = k.startsWith('tok:') || k.startsWith('home:');
  if (round) return <circle cx={r.x} cy={r.y} r={r.w / 2 + 6} fill="none" stroke="var(--accent)" strokeWidth={1.4} strokeDasharray="3 3" />;
  return <Glow x={r.x - r.w / 2} y={r.y - r.h / 2} w={r.w} h={r.h} rx={4} />;
}

/** The region a prediction is asking about pulses in yellow. */
function AskRing({ sim }: { sim: PTSim }) {
  const a = sim.asking;
  if (!a || !sim.game?.pending) return null;
  const r = sim.rectOf(a.key);
  if (!r) return null;
  const k = (Math.sin(sim.vt * 5) + 1) / 2;
  if (a.key.startsWith('tok:')) {
    return <circle cx={r.x} cy={r.y} r={r.w / 2 + 7 + k * 4} fill="none" stroke="var(--accent)" strokeWidth={1.6} strokeDasharray="3 3" opacity={0.5 + 0.5 * (1 - k)} />;
  }
  return (
    <rect
      x={r.x - r.w / 2 - 4}
      y={r.y - r.h / 2 - 4}
      width={r.w + 8}
      height={r.h + 8}
      rx={5}
      fill="rgba(255,210,63,0.07)"
      stroke="var(--accent)"
      strokeWidth={1.6}
      strokeDasharray="4 3"
      opacity={0.55 + 0.45 * (1 - k)}
    />
  );
}

/* ------------------------------------------------------------------ */
/* CPU and cores                                                       */
/* ------------------------------------------------------------------ */

function CpuChip({ sim, dim, glow }: { sim: PTSim; dim: boolean; glow: boolean }) {
  const b = sim.boxes.get('cpu');
  const r = sim.tl('cpu');
  if (!b || !r) return null;
  const n = sim.cores.length;
  const pins: number[] = [];
  for (let x = r.x0 + 12; x <= r.x0 + r.w - 12; x += 10) pins.push(x);
  const busy = sim.runningNow;
  return (
    <g className={kit.node} opacity={b.alpha * (dim ? 0.28 : 1)}>
      <text className={kit.caps} x={r.x0} y={r.y0 - 9}>
        CPU · {n} core{n > 1 ? 's' : ''}
      </text>
      {r.w >= 270 && (
        <text className={kit.caps} x={r.x0 + r.w} y={r.y0 - 9} textAnchor="end" style={{ fill: busy ? SIG.text2 : 'var(--text-3)' }}>
          {busy}/{n} busy
        </text>
      )}
      <g stroke="rgba(143,166,201,0.45)" strokeWidth={1.2}>
        {pins.map((x) => (
          <line key={`t${x}`} x1={x} y1={r.y0 - 4} x2={x} y2={r.y0} />
        ))}
        {pins.map((x) => (
          <line key={`b${x}`} x1={x} y1={r.y0 + r.h} x2={x} y2={r.y0 + r.h + 4} />
        ))}
      </g>
      <rect x={r.x0} y={r.y0} width={r.w} height={r.h} rx={9} fill="rgba(10,16,30,0.94)" stroke="rgba(143,166,201,0.55)" strokeWidth={1.2} />
      <rect x={r.x0 + 3.5} y={r.y0 + 3.5} width={r.w - 7} height={r.h - 7} rx={6.5} fill="none" stroke="rgba(143,166,201,0.12)" />
      {glow && <Glow x={r.x0} y={r.y0} w={r.w} h={r.h} />}
    </g>
  );
}

function CoreBox({ sim, core, dim, glow }: { sim: PTSim; core: Core; dim: boolean; glow: boolean }) {
  const b = sim.boxes.get(`core:${core.i}`);
  const r = sim.tl(`core:${core.i}`);
  if (!b || !r) return null;
  const th = core.thread ? sim.threads.get(core.thread) : null;
  const sw = core.sw;
  const L = sim.M.L;
  const swColor = sw ? (sw.kind === 'psw' ? SIG.heavy : SIG.hc) : null;
  const k = sw ? 1 - Math.max(0, sw.left) / sw.dur : 0;
  const inset = L ? 9 : 6;
  const barW = r.w - inset * 2;
  const barY = r.y0 + r.h - (L ? 9 : 7);
  const labelY = r.y0 + (L ? 15 : 12);
  const sliceK = th ? Math.max(0, Math.min(1, core.slice / sim.cfg.slice)) : 0;
  const p = th ? sim.procs.get(th.procId) : sw ? sim.procs.get(sw.toProc) : null;
  const idle = !th && !sw;
  const right = core.reg && th ? null : L && p ? (sw ? (sw.kind === 'psw' ? 'new process' : 'switch') : `pid ${p.pid}`) : null;
  return (
    <g className={kit.node} opacity={b.alpha * (dim ? 0.28 : 1)}>
      <rect
        x={r.x0}
        y={r.y0}
        width={r.w}
        height={r.h}
        rx={7}
        fill={idle ? 'rgba(143,166,201,0.03)' : 'rgba(143,166,201,0.06)'}
        stroke={th ? th.color : (swColor ?? 'rgba(143,166,201,0.35)')}
        strokeOpacity={th ? 0.8 : 1}
        strokeWidth={th ? 1.4 : 1}
      />
      {sw && <rect x={r.x0 + 1} y={r.y0 + 1} width={r.w - 2} height={r.h - 2} rx={6} fill={sw.kind === 'psw' ? 'url(#pt-hatch-o)' : 'url(#pt-hatch-v)'} opacity={0.5} />}
      <text className={kit.caps} x={r.x0 + inset} y={labelY} style={{ fontSize: L ? 8.5 : 7.5, fill: th ? SIG.text2 : undefined }}>
        core {core.i}
      </text>
      {right && (
        <text className={kit.mono} x={r.x0 + r.w - inset} y={labelY} textAnchor="end" style={{ fontSize: 9, fill: sw ? swColor! : SIG.text2 }}>
          {right}
        </text>
      )}
      {idle && (
        <text className={kit.caps} x={b.x} y={b.y + (L ? 9 : 7)} textAnchor="middle" style={{ fontSize: L ? 9 : 8, fill: core.deciding ? 'var(--accent)' : 'rgba(143,166,201,0.45)' }}>
          {core.deciding ? '?' : 'idle'}
        </text>
      )}
      {/* slice remaining, or switch progress */}
      <rect x={r.x0 + inset} y={barY} width={barW} height={2.5} rx={1.2} fill="rgba(143,166,201,0.14)" />
      {th && <rect x={r.x0 + inset} y={barY} width={barW * sliceK} height={2.5} rx={1.2} fill={th.color} opacity={0.85} />}
      {sw && <rect x={r.x0 + inset} y={barY} width={barW * k} height={2.5} rx={1.2} fill={swColor!} />}
      {core.reg && th && (
        <g transform={`translate(${r.x0 + r.w - inset + 3},${labelY - 4})`}>
          <rect x={-46} y={-8} width={46} height={16} rx={4} fill="rgba(7,11,20,0.94)" stroke={SIG.req} strokeOpacity={0.7} />
          <text className={kit.mono} x={-23} y={3.5} textAnchor="middle" style={{ fill: SIG.req, fontSize: 9.5 }}>
            reg={core.reg}
          </text>
        </g>
      )}
      {glow && <Glow x={r.x0} y={r.y0} w={r.w} h={r.h} rx={7} />}
    </g>
  );
}

/** Dashed line from a core to the process whose thread it is running: the core works inside that address space. */
function Tethers({ sim, focus }: { sim: PTSim; focus?: string[] }) {
  const out: ReactNode[] = [];
  for (const c of sim.cores) {
    const tid = c.thread ?? c.sw?.to;
    if (!tid) continue;
    const th = sim.threads.get(tid);
    const cb = sim.boxes.get(`core:${c.i}`);
    if (!th || !cb || Number.isNaN(cb.x)) continue;
    const p = sim.procs.get(th.procId);
    const g = p ? sim.procGeom(p) : null;
    const col = g?.cols.find((k) => k.tid === tid);
    if (!g || !col) continue;
    const x1 = cb.x;
    const y1 = cb.y + cb.h / 2;
    const x2 = col.cx;
    const y2 = g.box.y0 - (p?.tab ? 20 : 0);
    const k = Math.max(20, (y2 - y1) * 0.5);
    const dim = isDim(focus, `proc:${th.procId}`) && isDim(focus, 'cpu');
    out.push(
      <path
        key={c.i}
        d={`M${x1},${y1} C${x1},${y1 + k} ${x2},${y2 - k} ${x2},${y2}`}
        fill="none"
        stroke={th.color}
        strokeWidth={1.3}
        strokeDasharray="3 4"
        opacity={(c.sw ? 0.3 : 0.55) * (dim ? 0.3 : 1)}
      />,
    );
  }
  return <g>{out}</g>;
}

function QueueStrip({ sim, dim, glow }: { sim: PTSim; dim: boolean; glow: boolean }) {
  const q = sim.M.queue;
  if (!q) return null;
  const L = sim.M.L;
  const cpu = sim.boxes.get('cpu');
  const hide = !!sim.game?.pending && sim.pkind === 'next';
  const items = sim.queue.map((id) => sim.threads.get(id)).filter((t): t is Thread => !!t);
  const blocked = [...sim.threads.values()].filter((t) => t.state === 'blocked');
  const chipW = L ? 34 : 28;
  const gap = 5;
  const labelW = L ? 98 : 80;
  const body = Math.max(1, items.length) * (chipW + gap);
  const extra = blocked.length && L ? 70 + blocked.length * (chipW + gap) : 0;
  const total = labelW + body + extra;
  const center = cpu ? cpu.x : (q.x0 + q.x1) / 2;
  const x0 = Math.max(q.x0, Math.min(center - total / 2, q.x1 - total));
  const y = q.y;
  return (
    <g opacity={dim ? 0.28 : 1}>
      {/* a backing plate so the core-to-process tethers don't cut through the text */}
      <rect x={x0 - 6} y={y - 10} width={labelW} height={20} rx={4} fill="var(--ink-1)" opacity={0.92} />
      <text className={kit.caps} x={x0} y={y + 3.5} style={{ fontSize: L ? 8.5 : 7.5 }}>
        ready queue
      </text>
      <text className={kit.mono} x={x0 + labelW - 16} y={y + 3.5} style={{ fontSize: 10, fill: 'rgba(143,166,201,0.6)' }}>
        →
      </text>
      {items.length === 0 && (
        <text className={kit.mono} x={x0 + labelW} y={y + 3.5} style={{ fontSize: 9.5, fill: 'var(--text-3)' }}>
          empty
        </text>
      )}
      {items.map((t, i) => {
        const x = x0 + labelW + i * (chipW + gap);
        return (
          <g key={t.id} transform={`translate(${x},${y - 8})`}>
            <rect width={chipW} height={16} rx={8} fill={hide ? 'rgba(255,210,63,0.08)' : t.color} fillOpacity={hide ? 1 : 0.9} stroke={hide ? 'rgba(255,210,63,0.6)' : 'none'} strokeDasharray={hide ? '2 2' : undefined} />
            <text x={chipW / 2} y={11.5} textAnchor="middle" className={css.tokText} style={{ fill: hide ? 'var(--accent)' : INK, fontSize: L ? 9.5 : 8.5 }}>
              {hide ? '?' : t.name}
            </text>
            {i === 0 && !hide && (
              <text className={kit.caps} x={chipW / 2} y={27} textAnchor="middle" style={{ fontSize: 7, fill: 'var(--text-3)' }}>
                next
              </text>
            )}
          </g>
        );
      })}
      {extra > 0 && (
        <g transform={`translate(${x0 + labelW + body + 16},${y})`}>
          <line x1={-8} y1={-7} x2={-8} y2={7} stroke="rgba(143,166,201,0.25)" />
          <text className={kit.caps} x={4} y={3.5} style={{ fontSize: 8.5 }}>
            on disk
          </text>
          {blocked.map((t, i) => (
            <g key={t.id} transform={`translate(${62 + i * (chipW + gap)},-8)`}>
              <rect width={chipW} height={16} rx={8} fill="none" stroke={t.color} strokeDasharray="2 2" />
              <text x={chipW / 2} y={11.5} textAnchor="middle" className={css.tokText} style={{ fill: t.color, fontSize: 9.5 }}>
                {t.name}
              </text>
            </g>
          ))}
        </g>
      )}
      {glow && <Glow x={x0} y={y - 10} w={total} h={20} rx={6} />}
    </g>
  );
}

/* ------------------------------------------------------------------ */
/* Processes                                                           */
/* ------------------------------------------------------------------ */

function ProcBox({ sim, p, dim, highlight, onClick }: { sim: PTSim; p: Proc; dim: boolean; highlight?: string | null; onClick?: () => void }) {
  const b = sim.boxes.get(`proc:${p.id}`);
  const g = sim.procGeom(p);
  if (!b || !g) return null;
  const B = g.box;
  const dead = !p.alive;
  const d = detOf(g.dk, !sim.M.L);
  const glow = highlight === `proc:${p.id}`;
  const fresh = sim.vt - p.bornVt;
  const deadK = p.diedVt != null ? Math.min(1, (sim.vt - p.diedVt) / 0.5) : 0;
  const shake = p.diedVt != null && sim.vt - p.diedVt < 0.5 ? Math.sin((sim.vt - p.diedVt) * 60) * 3 * (1 - (sim.vt - p.diedVt) / 0.5) : 0;
  const f = !sim.M.L && g.dk === 'full' ? { ...FS.full, band: 9, label: 7.5 } : FS[g.dk];
  const mini = g.dk === 'mini';
  const big = g.dk === 'xl' || g.dk === 'full';
  const threads = p.threadIds.map((id) => sim.threads.get(id)).filter((t): t is Thread => !!t);
  const holder = p.gil && p.gilHolder ? sim.threads.get(p.gilHolder) : null;
  const clickable = !!onClick;
  const badgeR = g.dk === 'xl' ? 10 : mini ? 7 : 8.5;
  const badgeX = B.x0 + (g.dk === 'xl' ? 17 : mini ? 11 : 14);
  return (
    <g
      className={cx(kit.node, clickable && kit.clickable)}
      transform={`translate(${shake},0)`}
      opacity={b.alpha * (dim ? 0.28 : 1)}
      onClick={onClick}
      role={clickable ? 'button' : undefined}
      aria-label={clickable ? `Crash process ${p.letter} (PID ${p.pid})` : undefined}
    >
      {clickable && <rect x={B.x0 - 6} y={B.y0 - 6} width={B.w + 12} height={B.h + 12} fill="transparent" />}
      {p.tab && <Tab x={B.x0} y={B.y0} w={Math.min(B.w - 8, 170)} label={p.tab} dead={dead} />}
      <rect
        className={kit.card}
        x={B.x0}
        y={B.y0}
        width={B.w}
        height={B.h}
        rx={10}
        style={dead ? { stroke: 'rgba(255,77,106,0.75)', fill: 'rgba(255,77,106,0.04)' } : fresh < 0.8 ? { stroke: `rgba(75,227,160,${0.9 - fresh})` } : undefined}
      />
      {/* header */}
      <line x1={B.x0} y1={B.y0 + d.head} x2={B.x0 + B.w} y2={B.y0 + d.head} stroke="rgba(143,166,201,0.16)" />
      <g transform={`translate(${badgeX},${B.y0 + d.head / 2})`}>
        <circle r={badgeR} fill="rgba(143,166,201,0.1)" stroke="rgba(143,166,201,0.55)" />
        <text y={f.pid * 0.34} textAnchor="middle" className={css.letter} style={{ fontSize: f.pid - 0.5 }}>
          {p.letter}
        </text>
      </g>
      <text className={kit.monoStrong} x={badgeX + badgeR + 6} y={B.y0 + d.head / 2 + f.pid * 0.36} style={{ fontSize: f.pid }}>
        {mini ? p.pid : `PID ${p.pid}`}
      </text>
      <text
        className={kit.name}
        x={B.x0 + B.w - (mini ? 8 : g.dk === 'xl' ? 24 : 20)}
        y={B.y0 + d.head / 2 + f.name * 0.36}
        textAnchor="end"
        style={{ fontSize: f.name, fill: dead ? 'rgba(255,77,106,0.9)' : undefined }}
      >
        {p.name}
      </text>
      {!mini && <circle cx={B.x0 + B.w - (g.dk === 'xl' ? 12 : 10)} cy={B.y0 + d.head / 2} r={3} fill={dead ? SIG.err : p.setup > 0 ? SIG.warn : SIG.res} />}

      {/* region labels */}
      {d.label > 0 && (
        <g>
          <text className={kit.caps} x={g.labelX} y={g.stack.y0 + (big ? 16 : 13)} style={{ fontSize: f.label }}>
            {threads.length > 1 ? 'stacks' : 'stack'}
          </text>
          {big && (
            <text className={css.grow} x={g.labelX} y={g.stack.y0 + (g.dk === 'xl' ? 30 : 26)}>
              ↓ grows
            </text>
          )}
          <text className={kit.caps} x={g.labelX} y={g.heap.y0 + g.heap.h / 2 + 3} style={{ fontSize: f.label }}>
            heap
          </text>
          {big && (
            <text className={css.grow} x={g.labelX} y={g.heap.y0 + g.heap.h / 2 + 14}>
              {g.dk === 'xl' ? '↑ grows' : ''}
            </text>
          )}
          {g.data && (
            <text className={kit.caps} x={g.labelX} y={g.data.y0 + g.data.h / 2 + 3} style={{ fontSize: f.label }}>
              data
            </text>
          )}
          {g.code && (
            <text className={kit.caps} x={g.labelX} y={g.code.y0 + g.code.h / 2 + 3} style={{ fontSize: f.label }}>
              code
            </text>
          )}
          {g.files && (
            <text className={kit.caps} x={g.labelX} y={g.files.y0 + g.files.h / 2 + 3} style={{ fontSize: f.label }}>
              files
            </text>
          )}
          {g.codeData && (
            <text className={kit.caps} x={g.labelX} y={g.codeData.y0 + g.codeData.h / 2 + 3} style={{ fontSize: f.label }}>
              code
            </text>
          )}
        </g>
      )}

      {/* stacks: one column per thread */}
      <rect x={g.stack.x0} y={g.stack.y0 + 3} width={g.stack.w} height={g.stack.h - 5} rx={4} fill="rgba(143,166,201,0.025)" />
      {g.cols.map((col, i) => {
        const th = threads.find((t) => t.id === col.tid);
        return th ? <StackCol key={col.tid} sim={sim} col={col} th={th} first={i === 0} glow={highlight === `col:${th.id}` || highlight === `stack:${p.id}`} /> : null;
      })}

      {/* heap */}
      <Heap sim={sim} p={p} g={g} glow={highlight === `heap:${p.id}`} />

      {/* data / code / files */}
      {g.data && (
        <Band r={g.data} glow={highlight === `data:${p.id}`}>
          <text className={kit.mono} x={g.data.x0 + 7} y={g.data.y0 + g.data.h / 2 + f.band * 0.36} style={{ fontSize: f.band, fill: p.globalsColor ?? SIG.text2 }}>
            {p.globals}
          </text>
          <text className={kit.mono} x={g.data.x0 + g.data.w - 6} y={g.data.y0 + g.data.h / 2 + 3.4} textAnchor="end" style={{ fontSize: 8.5 }}>
            rw-
          </text>
        </Band>
      )}
      {g.code && (
        <Band r={g.code} glow={highlight === `code:${p.id}`}>
          <text className={kit.mono} x={g.code.x0 + 7} y={g.code.y0 + g.code.h / 2 + f.band * 0.36} style={{ fontSize: f.band, fill: SIG.text2 }}>
            {codeText(p, g.code.w < 150)}
          </text>
          <text className={kit.mono} x={g.code.x0 + g.code.w - 6} y={g.code.y0 + g.code.h / 2 + 3.4} textAnchor="end" style={{ fontSize: 8.5 }}>
            r-x
          </text>
        </Band>
      )}
      {g.files && (
        <Band r={g.files} glow={highlight === `files:${p.id}`}>
          {p.files.map((fd, i) => {
            const cw = f.band * 0.62;
            const wOf = (s: string) => (s.length > 2 ? s.length * cw + 10 : Math.max(16, cw + 10));
            const w = wOf(fd);
            const x = g.files!.x0 + 6 + p.files.slice(0, i).reduce((acc, ff) => acc + wOf(ff) + 4, 0);
            if (x + w > g.files!.x0 + g.files!.w - 4) return null;
            return (
              <g key={i} transform={`translate(${x},${g.files!.y0 + 3})`}>
                <rect width={w} height={g.files!.h - 6} rx={3} fill="rgba(143,166,201,0.07)" stroke="rgba(143,166,201,0.3)" />
                <text className={kit.mono} x={w / 2} y={(g.files!.h - 6) / 2 + f.band * 0.34} textAnchor="middle" style={{ fontSize: f.band - 1, fill: SIG.text2 }}>
                  {fd}
                </text>
              </g>
            );
          })}
        </Band>
      )}
      {g.codeData && (
        <Band r={g.codeData} glow={highlight === `data:${p.id}` || highlight === `code:${p.id}`}>
          <text className={kit.mono} x={g.codeData.x0 + 6} y={g.codeData.y0 + g.codeData.h / 2 + 3.2} style={{ fontSize: f.band, fill: p.globalsColor ?? SIG.text2 }}>
            {g.codeData.w > 150 ? `r-x · ${p.globals}` : p.globals}
          </text>
        </Band>
      )}

      {/* the GIL: only its holder may run Python code */}
      {p.gil && (
        <g transform={`translate(${B.x0 + B.w - (g.dk === 'mini' ? 44 : 64)},${B.y0 - 12})`}>
          <rect width={g.dk === 'mini' ? 40 : 56} height={16} rx={4} fill="rgba(7,11,20,0.94)" stroke={holder ? holder.color : 'rgba(143,166,201,0.4)'} />
          <LockIcon x={8} y={8} color={holder ? holder.color : SIG.text2} />
          <text className={kit.mono} x={16} y={11.5} style={{ fontSize: 8.5, fill: holder ? holder.color : SIG.text2 }}>
            {g.dk === 'mini' ? (holder ? holder.name : 'GIL') : holder ? `GIL ${holder.name}` : 'GIL'}
          </text>
        </g>
      )}

      {/* fork / exec in progress */}
      {p.setup > 0 && p.alive && (
        <g>
          <rect x={B.x0 + 1} y={B.y0 + d.head + 1} width={B.w - 2} height={B.h - d.head - 2} rx={8} fill="rgba(7,11,20,0.72)" />
          <text className={kit.caps} x={B.x0 + B.w / 2} y={B.y0 + B.h / 2} textAnchor="middle" style={{ fill: SIG.warn, fontSize: 8.5 }}>
            {p.setupLabel}…
          </text>
          <rect x={B.x0 + B.w * 0.2} y={B.y0 + B.h / 2 + 8} width={B.w * 0.6} height={3} rx={1.5} fill="rgba(143,166,201,0.2)" />
          <rect x={B.x0 + B.w * 0.2} y={B.y0 + B.h / 2 + 8} width={B.w * 0.6 * (1 - p.setup / Math.max(0.01, p.setupTotal))} height={3} rx={1.5} fill={SIG.warn} />
        </g>
      )}

      {/* crashed */}
      {dead && (
        <g opacity={deadK}>
          <rect x={B.x0} y={B.y0} width={B.w} height={B.h} rx={10} fill="url(#pt-hatch-r)" />
          {(() => {
            // Size the chip to its text, and fall back to the short form when the box is narrow.
            const fs = mini ? 9 : 10.5;
            const cw = fs * 0.62;
            const long = `✕ exited · ${short(p.reason)}`;
            const text = !mini && long.length * cw + 20 <= B.w - 16 ? long : `✕ ${short(p.reason)}`;
            const w = Math.min(B.w - 10, text.length * cw + 20);
            return (
              <g transform={`translate(${B.x0 + B.w / 2},${B.y0 + d.head + (B.h - d.head) / 2})`}>
                <rect x={-w / 2} y={-12} width={w} height={24} rx={6} fill="rgba(20,6,10,0.94)" stroke="rgba(255,77,106,0.8)" />
                <text x={0} y={4} textAnchor="middle" className={css.dead} style={{ fontSize: fs }}>
                  {text}
                </text>
              </g>
            );
          })()}
        </g>
      )}
      {glow && <Glow x={B.x0} y={B.y0} w={B.w} h={B.h} />}
    </g>
  );
}

function short(reason: string | null) {
  if (!reason) return 'killed';
  if (reason === 'parent exited') return 'parent gone';
  return reason;
}

function codeText(p: Proc, narrow = false) {
  if (p.kind === 'browser' || p.kind === 'renderer' || p.kind === 'gpu') return 'chrome';
  if (p.kind === 'python') return 'python3.12';
  if (p.kind === 'node') return 'node';
  return narrow ? `${p.name}` : `${p.name} · main() …`;
}

function Band({ r, glow, children }: { r: { x0: number; y0: number; w: number; h: number }; glow?: boolean; children: ReactNode }) {
  return (
    <g>
      <rect x={r.x0} y={r.y0} width={r.w} height={r.h} rx={3} fill="rgba(143,166,201,0.045)" stroke="rgba(143,166,201,0.2)" />
      {children}
      {glow && <Glow x={r.x0} y={r.y0} w={r.w} h={r.h} rx={3} />}
    </g>
  );
}

function StackCol({ sim, col, th, first, glow }: { sim: PTSim; col: Col; th: Thread; first: boolean; glow: boolean }) {
  const d = detOf(sim.M.detail, !sim.M.L);
  const away = th.state === 'running' || th.state === 'blocked';
  const dead = th.state === 'dead';
  const fw = Math.min(col.w - 10, sim.M.detail === 'xl' ? 52 : sim.M.detail === 'full' ? 40 : 30);
  const frames = Math.min(th.depth, col.maxFrames);
  const r = sim.M.tokR;
  const g = sim.procGeom(sim.procs.get(th.procId)!);
  const top = g ? g.stack.y0 : col.hy - r - 5;
  const bottom = g ? g.stack.y0 + g.stack.h : col.fy + 30;
  const running = th.state === 'running';
  return (
    <g>
      {!first && <line x1={col.x0} y1={top + 5} x2={col.x0} y2={bottom - 4} stroke="rgba(143,166,201,0.16)" strokeDasharray="2 3" />}
      {away && !dead && <circle cx={col.cx} cy={col.hy} r={r} fill="none" stroke={th.color} strokeOpacity={0.55} strokeDasharray="2.5 2.5" />}
      {Array.from({ length: frames }, (_, i) => {
        const topFrame = i === frames - 1;
        return (
          <rect
            key={i}
            x={col.cx - fw / 2}
            y={col.fy + i * (d.frameH + 2)}
            width={fw}
            height={d.frameH}
            rx={1.5}
            fill={dead ? 'rgba(255,77,106,0.35)' : th.color}
            opacity={topFrame && running ? 0.9 : 0.38}
          />
        );
      })}
      {th.workTotal != null && !dead && (
        <g>
          <rect x={col.cx - fw / 2} y={bottom - 6} width={fw} height={3} rx={1.5} fill="rgba(143,166,201,0.16)" />
          <rect x={col.cx - fw / 2} y={bottom - 6} width={fw * (1 - (th.work ?? 0) / th.workTotal)} height={3} rx={1.5} fill={th.state === 'done' ? SIG.res : th.color} />
        </g>
      )}
      {glow && <Glow x={col.x0 + 2} y={top + 3} w={col.w - 4} h={bottom - top - 6} rx={4} />}
    </g>
  );
}

function Heap({ sim, p, g, glow }: { sim: PTSim; p: Proc; g: PGeom; glow: boolean }) {
  const r = g.heap;
  const objW = p.objs.length ? p.objs.length * ((sim.objRect(p, 0)?.w ?? 60) + 6) : 0;
  let x = r.x0 + 5 + objW;
  const blocks: ReactNode[] = [];
  const bh = Math.min(r.h - 12, 20);
  const scale = g.dk === 'xl' ? 1.35 : 1;
  for (const blk of p.heap) {
    const bw = blk.w * scale;
    if (x + bw > r.x0 + r.w - 5) break;
    const t = blk.by ? sim.threads.get(blk.by) : null;
    const hot = t && sim.vt - blk.vt < 0.9;
    blocks.push(
      <rect
        key={blk.id}
        x={x}
        y={r.y0 + (r.h - bh) / 2}
        width={bw}
        height={bh}
        rx={1.5}
        fill={hot && t ? t.color : 'rgba(143,166,201,0.2)'}
        opacity={hot ? 0.95 : 1}
        stroke={t ? t.color : 'rgba(143,166,201,0.4)'}
        strokeOpacity={t ? 0.55 : 0.5}
      />,
    );
    x += bw + 3;
  }
  return (
    <g>
      <rect x={r.x0} y={r.y0} width={r.w} height={r.h} rx={3} fill="rgba(143,166,201,0.045)" stroke="rgba(143,166,201,0.2)" />
      {g.dk === 'mini' && (
        <text className={kit.caps} x={r.x0 + r.w - 4} y={r.y0 + r.h / 2 + 3} textAnchor="end" style={{ fontSize: 7 }}>
          heap
        </text>
      )}
      {blocks}
      {p.objs.map((o, i) => {
        const orr = sim.objRect(p, i);
        if (!orr) return null;
        const fresh = sim.vt - o.vt < 0.8;
        return (
          <g key={o.name} transform={`translate(${orr.x0},${orr.y0})`}>
            <rect width={orr.w} height={orr.h} rx={3} fill={o.bad ? 'rgba(255,77,106,0.12)' : 'rgba(7,11,20,0.9)'} stroke={o.bad ? SIG.err : fresh ? o.color : 'rgba(143,166,201,0.5)'} strokeWidth={fresh ? 1.5 : 1} />
            <text className={kit.mono} x={5} y={orr.h / 2 + 3.3} style={{ fontSize: g.dk === 'xl' ? 10 : 9, fill: 'var(--text-3)' }}>
              {o.name}
            </text>
            <text
              className={kit.monoStrong}
              x={orr.w - 5}
              y={orr.h / 2 + 3.6}
              textAnchor="end"
              style={{ fontSize: o.value.length > 8 ? 8.5 : g.dk === 'xl' ? 11.5 : 10, fill: o.bad ? SIG.err : o.color }}
            >
              {o.value}
            </text>
          </g>
        );
      })}
      {glow && <Glow x={r.x0} y={r.y0} w={r.w} h={r.h} rx={3} />}
    </g>
  );
}

function Tab({ x, y, w, label, dead }: { x: number; y: number; w: number; label: string; dead: boolean }) {
  const h = 18;
  return (
    <g>
      <path d={`M${x + 4},${y} L${x + 12},${y - h} H${x + w - 8} L${x + w},${y}`} fill="rgba(12,19,34,0.95)" stroke={dead ? 'rgba(255,77,106,0.7)' : 'rgba(143,166,201,0.5)'} />
      <circle cx={x + 21} cy={y - h / 2} r={3.5} fill={dead ? SIG.err : SIG.req} opacity={0.85} />
      <text className={kit.mono} x={x + 30} y={y - h / 2 + 3.4} style={{ fontSize: 9.5, fill: dead ? SIG.err : SIG.text2 }}>
        {dead ? 'Aw, Snap!' : label}
      </text>
    </g>
  );
}

function LockIcon({ x, y, color }: { x: number; y: number; color: string }) {
  return (
    <g transform={`translate(${x},${y})`} stroke={color} fill="none" strokeWidth={1.2}>
      <rect x={-3.5} y={-1.5} width={7} height={5.5} rx={1} fill={color} fillOpacity={0.25} />
      <path d="M-2.2,-1.5 V-3.4 A2.2,2.2 0 0 1 2.2,-3.4 V-1.5" />
    </g>
  );
}

/* ------------------------------------------------------------------ */
/* Disk, program file, kernel pipe                                     */
/* ------------------------------------------------------------------ */

function Disk({ sim, dim, glow }: { sim: PTSim; dim: boolean; glow: boolean }) {
  const b = sim.boxes.get('disk');
  const r = sim.tl('disk');
  if (!b || !r) return null;
  const L = sim.M.L;
  const ry = 7;
  const h = L ? r.h : r.h * 0.5;
  const busy = [...sim.threads.values()].filter((t) => t.state === 'blocked');
  return (
    <g className={kit.node} opacity={b.alpha * (dim ? 0.28 : 1)}>
      <path
        d={`M${r.x0},${r.y0 + ry} A${r.w / 2},${ry} 0 0,1 ${r.x0 + r.w},${r.y0 + ry} V${r.y0 + h - ry} A${r.w / 2},${ry} 0 0,1 ${r.x0},${r.y0 + h - ry} Z`}
        fill="var(--node-fill)"
        stroke={busy.length ? 'rgba(69,213,255,0.7)' : 'rgba(143,166,201,0.6)'}
        strokeWidth={1.2}
      />
      <ellipse cx={b.x} cy={r.y0 + ry} rx={r.w / 2} ry={ry} fill="rgba(143,166,201,0.06)" stroke={busy.length ? 'rgba(69,213,255,0.7)' : 'rgba(143,166,201,0.6)'} strokeWidth={1.2} />
      <text className={kit.monoStrong} x={b.x} y={r.y0 + ry + (L ? 22 : 17)} textAnchor="middle" style={{ fontSize: L ? 10.5 : 9.5 }}>
        disk
      </text>
      {L && (
        <text className={kit.mono} x={b.x} y={r.y0 + ry + 36} textAnchor="middle">
          {busy.length ? `${busy.length} waiting` : 'nvme0n1'}
        </text>
      )}
      {L && (
        <text className={kit.caps} x={b.x} y={r.y0 + r.h + 6 + sim.M.tokR * 2 + 22} textAnchor="middle" style={{ fontSize: 7.5, opacity: busy.length ? 1 : 0.5 }}>
          blocked on i/o
        </text>
      )}
      {glow && <Glow x={r.x0} y={r.y0} w={r.w} h={r.h} />}
    </g>
  );
}

function FileCard({ sim, dim, glow }: { sim: PTSim; dim: boolean; glow: boolean }) {
  const b = sim.boxes.get('file');
  const r = sim.tl('file');
  if (!b || !r) return null;
  const L = sim.M.L;
  const f = 14;
  const loading = sim.launchPhase === 'loading';
  return (
    <g className={kit.node} opacity={b.alpha * (dim ? 0.28 : 1)}>
      <text className={kit.caps} x={r.x0} y={r.y0 - 8} style={{ fontSize: L ? 8.5 : 7.5 }}>
        on disk
      </text>
      <path
        d={`M${r.x0},${r.y0} H${r.x0 + r.w - f} L${r.x0 + r.w},${r.y0 + f} V${r.y0 + r.h} H${r.x0} Z`}
        fill="var(--node-fill)"
        stroke={loading ? SIG.req : 'rgba(143,166,201,0.6)'}
        strokeWidth={1.2}
      />
      <path d={`M${r.x0 + r.w - f},${r.y0} V${r.y0 + f} H${r.x0 + r.w}`} fill="none" stroke="rgba(143,166,201,0.6)" strokeWidth={1.1} />
      <text className={kit.name} x={r.x0 + 12} y={r.y0 + (L ? 25 : 18)} style={{ fontSize: L ? 13.5 : 11 }}>
        server
      </text>
      <text className={kit.mono} x={r.x0 + 12} y={r.y0 + (L ? 41 : 30)} style={{ fontSize: L ? 10 : 8.5 }}>
        {L ? '/usr/local/bin' : 'ELF · 2.1 MB'}
      </text>
      {L && (
        <>
          <text className={kit.mono} x={r.x0 + 12} y={r.y0 + 56} style={{ fontSize: 10 }}>
            ELF 64-bit · 2.1 MB
          </text>
          <line x1={r.x0 + 12} y1={r.y0 + 68} x2={r.x0 + r.w - 12} y2={r.y0 + 68} stroke="rgba(143,166,201,0.15)" />
          <text className={kit.mono} x={r.x0 + 12} y={r.y0 + 86} style={{ fontSize: 10, fill: SIG.req, opacity: 0.85 }}>
            7f 45 4c 46 02 01 01 00
          </text>
          <text className={kit.mono} x={r.x0 + 12} y={r.y0 + 101} style={{ fontSize: 10, fill: SIG.req, opacity: 0.55 }}>
            00 00 00 00 00 00 00 00
          </text>
          <text className={kit.mono} x={r.x0 + 12} y={r.y0 + 116} style={{ fontSize: 10, fill: SIG.req, opacity: 0.32 }}>
            03 00 3e 00 01 00 …
          </text>
        </>
      )}
      {!L && (
        <text className={kit.mono} x={r.x0 + 10} y={r.y0 + 46} style={{ fontSize: 8.5, fill: SIG.req, opacity: 0.7 }}>
          7f 45 4c 46 …
        </text>
      )}
      {glow && <Glow x={r.x0} y={r.y0} w={r.w} h={r.h} />}
    </g>
  );
}

function Kernel({ sim, dim, glow }: { sim: PTSim; dim: boolean; glow: boolean }) {
  const b = sim.boxes.get('kernel');
  const r = sim.tl('kernel');
  const pipe = sim.rectOf('pipe');
  if (!b || !r || !pipe) return null;
  const L = sim.M.L;
  const slots = 4;
  const sw = pipe.w / slots;
  return (
    <g className={kit.node} opacity={b.alpha * (dim ? 0.28 : 1)}>
      <rect x={r.x0} y={r.y0} width={r.w} height={r.h} rx={10} fill="url(#kit-violet)" stroke="rgba(181,155,255,0.7)" strokeWidth={1.2} />
      <text className={kit.caps} x={b.x} y={L ? r.y0 + 18 : r.y0 + r.h - 9} textAnchor="middle" style={{ fill: '#cdbdff', fontSize: L ? 8.5 : 7.5 }}>
        {L ? 'kernel · pipe' : 'kernel · pipe buffer'}
      </text>
      {L && (
        <text className={kit.mono} x={b.x} y={r.y0 + 32} textAnchor="middle" style={{ fontSize: 9 }}>
          64 KiB buffer
        </text>
      )}
      <rect x={pipe.x - pipe.w / 2} y={pipe.y - pipe.h / 2} width={pipe.w} height={pipe.h} rx={4} fill="rgba(7,11,20,0.8)" stroke="rgba(181,155,255,0.45)" />
      {Array.from({ length: slots - 1 }, (_, i) => (
        <line key={i} x1={pipe.x - pipe.w / 2 + sw * (i + 1)} y1={pipe.y - pipe.h / 2 + 3} x2={pipe.x - pipe.w / 2 + sw * (i + 1)} y2={pipe.y + pipe.h / 2 - 3} stroke="rgba(181,155,255,0.2)" />
      ))}
      {sim.ipc.buf.slice(0, slots).map((m, i) => (
        <g key={m} transform={`translate(${pipe.x - pipe.w / 2 + sw * (i + 0.5)},${pipe.y})`}>
          <rect x={-6.5} y={-4.8} width={13} height={9.6} rx={1.5} fill={SIG.req} />
          <path d="M-6.5,-4.3 L0,0.8 L6.5,-4.3" fill="none" stroke="rgba(5,8,15,0.75)" strokeWidth={1.1} />
        </g>
      ))}
      {L && (
        <text className={kit.mono} x={b.x} y={r.y0 + r.h - 10} textAnchor="middle" style={{ fontSize: 9 }}>
          write() → copy → read()
        </text>
      )}
      {glow && <Glow x={r.x0} y={r.y0} w={r.w} h={r.h} />}
    </g>
  );
}

/* ------------------------------------------------------------------ */
/* Timeline                                                            */
/* ------------------------------------------------------------------ */

function Gantt({ sim, dim, glow }: { sim: PTSim; dim: boolean; glow: boolean }) {
  const g = sim.M.gantt;
  const box = sim.boxes.get('gantt');
  if (!g || !box) return null;
  const L = sim.M.L;
  const now = sim.t;
  const t0 = now - g.win;
  const x0 = g.x + g.labelW;
  const w = g.w - g.labelW - 10;
  const X = (t: number) => x0 + ((t - t0) / g.win) * w;
  const rows = sim.cores.length;
  const rowY = (i: number) => g.y + g.head + i * (g.rowH + g.rowGap);
  // Ticks every simulated ms, counted from when this world was built.
  const ticks: number[] = [];
  for (let k = Math.max(0, Math.ceil(t0 - sim.t0)); sim.t0 + k <= now; k += 1) ticks.push(sim.t0 + k);
  const axisY = rowY(rows - 1) + g.rowH + (L ? 12 : 10);
  const clipId = 'pt-gantt-clip';
  return (
    <g className={kit.node} opacity={box.alpha * (dim ? 0.28 : 1)}>
      <defs>
        <clipPath id={clipId}>
          <rect x={x0} y={g.y} width={w} height={g.h} />
        </clipPath>
      </defs>
      <rect x={g.x} y={g.y} width={g.w} height={g.h} rx={9} fill="rgba(7,11,20,0.72)" stroke="rgba(143,166,201,0.28)" />
      <text className={kit.caps} x={g.x + 10} y={g.y + (L ? 14 : 11)} style={{ fontSize: L ? 8.5 : 7.5 }}>
        {L ? 'timeline · who ran on each core' : 'timeline'}
      </text>
      {L && (
        <text className={kit.caps} x={g.x + g.w - 10} y={g.y + 14} textAnchor="end" style={{ fontSize: 8.5 }}>
          last {g.win} ms
        </text>
      )}
      {Array.from({ length: rows }, (_, i) => (
        <g key={i}>
          <text className={kit.mono} x={g.x + 10} y={rowY(i) + g.rowH / 2 + 3.5} style={{ fontSize: L ? 9.5 : 8.5 }}>
            core {i}
          </text>
          <rect x={x0} y={rowY(i)} width={w} height={g.rowH} rx={3} fill="rgba(143,166,201,0.04)" stroke="rgba(143,166,201,0.1)" />
        </g>
      ))}
      <g clipPath={`url(#${clipId})`}>
        {ticks.map((t) => (
          <line key={t} x1={X(t)} y1={g.y + g.head - 3} x2={X(t)} y2={axisY - 8} stroke="rgba(143,166,201,0.08)" />
        ))}
        {sim.segs.map((s, i) => {
          if (s.core >= rows) return null;
          const e = s.t1 ?? now;
          if (e < t0) return null;
          const sx = X(Math.max(s.t0, t0));
          const ex = X(e);
          const ww = Math.max(ex - sx, 0.8);
          const y = rowY(s.core);
          if (s.kind === 'run') {
            return (
              <g key={i}>
                <rect x={sx} y={y + 2} width={ww} height={g.rowH - 4} rx={2} fill={s.color} opacity={0.82} />
                {ww > (L ? 22 : 18) && (
                  <text x={sx + ww / 2} y={y + g.rowH / 2 + 3.3} textAnchor="middle" className={css.tokText} style={{ fill: INK, fontSize: L ? 9 : 7.5 }}>
                    {s.label}
                  </text>
                )}
              </g>
            );
          }
          return <rect key={i} x={sx} y={y + 1} width={ww} height={g.rowH - 2} rx={1.5} fill={s.kind === 'psw' ? 'url(#pt-hatch-o)' : 'url(#pt-hatch-v)'} stroke={s.kind === 'psw' ? SIG.heavy : SIG.hc} strokeWidth={0.8} />;
        })}
        {sim.marks.map((m, i) => {
          if (m.core >= rows || m.t < t0) return null;
          const x = X(m.t);
          const y = rowY(m.core);
          if (m.kind === 'batch') {
            return m.core === 0 ? <line key={i} x1={x} y1={g.y + g.head - 4} x2={x} y2={rowY(rows - 1) + g.rowH + 3} stroke="var(--accent)" strokeDasharray="2 3" opacity={0.7} /> : null;
          }
          return (
            <g key={i} transform={`translate(${x},${y + g.rowH / 2})`} stroke={SIG.err} strokeWidth={2} strokeLinecap="round">
              <line x1={-4} y1={-4} x2={4} y2={4} />
              <line x1={-4} y1={4} x2={4} y2={-4} />
            </g>
          );
        })}
      </g>
      {ticks.map((t) => {
        const k = Math.round(t - sim.t0);
        if (k % 2 !== 0 || X(t) < x0 + 8) return null;
        return (
          <text key={t} className={kit.mono} x={X(t)} y={axisY} textAnchor="middle" style={{ fontSize: L ? 8.5 : 7.5, fill: 'rgba(143,166,201,0.55)' }}>
            {k}
          </text>
        );
      })}
      <text className={kit.mono} x={x0 - 8} y={axisY} textAnchor="end" style={{ fontSize: L ? 8.5 : 7.5, fill: 'rgba(143,166,201,0.55)' }}>
        ms
      </text>
      <line x1={x0 + w} y1={g.y + g.head - 5} x2={x0 + w} y2={rowY(rows - 1) + g.rowH + 3} stroke="var(--accent)" strokeWidth={1.2} opacity={0.8} />
      {glow && <Glow x={g.x} y={g.y} w={g.w} h={g.h} />}
    </g>
  );
}

/* ------------------------------------------------------------------ */
/* Thread tokens                                                       */
/* ------------------------------------------------------------------ */

function Token({
  sim,
  t,
  dim,
  glow,
  alpha,
  pickable,
  crashable,
  revealed,
  dead,
  onClick,
}: {
  sim: PTSim;
  t: Thread;
  dim: boolean;
  glow: boolean;
  alpha: number;
  pickable: boolean;
  crashable: boolean;
  revealed: boolean;
  dead: boolean;
  onClick?: () => void;
}) {
  if (Number.isNaN(t.x)) return null;
  const r = sim.M.tokR;
  const running = t.state === 'running';
  const parked = t.state === 'lock' || t.state === 'sleep' || t.state === 'new';
  const isDead = t.state === 'dead' || dead;
  const born = Math.min(1, (sim.vt - t.bornVt) / 0.35);
  const scale = 0.4 + 0.6 * born;
  const ioK = t.state === 'blocked' && t.ioTotal > 0 ? 1 - t.ioLeft / t.ioTotal : 0;
  const pulse = (Math.sin(sim.vt * 5) + 1) / 2;
  const label = t.name;
  const fs = r >= 14 ? 11 : r >= 11 ? 9.5 : r >= 10 ? 8.8 : 8;
  return (
    <g
      className={cx(onClick && kit.clickable, css.token)}
      transform={`translate(${t.x},${t.y}) scale(${scale})`}
      opacity={alpha * (dim ? 0.3 : 1) * (isDead ? 0.75 : 1)}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      aria-label={onClick ? `Thread ${label}` : undefined}
    >
      {onClick && <circle r={r + 9} fill="transparent" />}
      {crashable && <circle className={css.hoverRing} r={r + 5} />}
      {pickable && <circle r={r + 6 + pulse * 3} fill="none" stroke="var(--accent)" strokeWidth={1.5} strokeDasharray="3 3" opacity={0.5 + 0.5 * (1 - pulse)} />}
      {revealed && <circle r={r + 7} fill="none" stroke={SIG.res} strokeWidth={2} />}
      {running && !isDead && <circle r={r * 2} fill={t.color} opacity={0.13} />}
      <circle r={r} fill={isDead ? '#2a0d14' : t.color} fillOpacity={parked ? 0.35 : 1} stroke={isDead ? SIG.err : parked ? t.color : 'rgba(5,8,15,0.6)'} strokeWidth={parked || isDead ? 1.3 : 1} />
      {t.state === 'done' && !isDead && <circle r={r} fill="rgba(5,8,15,0.55)" />}
      <text y={fs * 0.36} textAnchor="middle" className={css.tokText} style={{ fill: isDead ? SIG.err : parked ? t.color : INK, fontSize: fs }}>
        {label}
      </text>
      {t.state === 'blocked' && (
        <circle r={r + 3.5} fill="none" stroke={SIG.req} strokeWidth={2} strokeDasharray={`${2 * Math.PI * (r + 3.5) * ioK} 999`} transform="rotate(-90)" opacity={0.9} />
      )}
      {t.state === 'lock' && <LockIcon x={r * 0.85} y={-r * 0.85} color={SIG.warn} />}
      {t.state === 'sleep' && (
        <text x={r * 0.9} y={-r * 0.6} className={css.zz}>
          z
        </text>
      )}
      {t.state === 'done' && !isDead && (
        <path d={`M${-r * 0.45},0 L${-r * 0.1},${r * 0.35} L${r * 0.5},${-r * 0.35}`} fill="none" stroke={SIG.res} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      )}
      {isDead && (
        <g stroke={SIG.err} strokeWidth={1.8} strokeLinecap="round" opacity={0.9}>
          <line x1={-r * 0.72} y1={-r * 0.72} x2={r * 0.72} y2={r * 0.72} />
          <line x1={-r * 0.72} y1={r * 0.72} x2={r * 0.72} y2={-r * 0.72} />
        </g>
      )}
      {glow && <circle r={r + 6} fill="none" stroke="var(--accent)" strokeWidth={1.4} strokeDasharray="3 3" />}
    </g>
  );
}

/* ------------------------------------------------------------------ */
/* Helpers used by overlays                                            */
/* ------------------------------------------------------------------ */

export function regLines(sim: PTSim, core: Core) {
  const th = core.thread ? sim.threads.get(core.thread) : null;
  if (!th) return null;
  return { pc: hex(th.pc), sp: `0x7ffd…${(th.sp & 0xfff).toString(16).padStart(3, '0')}` };
}
