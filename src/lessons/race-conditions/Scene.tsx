import { Effects, Flights, Wires } from '@/components/stage/svg';
import kit from '@/components/stage/stage.module.css';
import { SIG } from '@/lib/sim/colors';
import { clamp } from '@/lib/sim/geometry';
import type { Box } from '@/lib/sim/Sim';
import type { OpKind, TId } from './programs';
import { TCOLOR, type CellState, type Chip, type LockState, type RaceSim, type RunSummary, type ThreadState } from './sim';
import css from './race.module.css';

const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(' ');
const ok = (b: Box | undefined): b is Box => !!b && !Number.isNaN(b.x);
const fmtN = (n: number) => n.toLocaleString('en-US');

const MN_COLOR: Partial<Record<OpKind, string>> = {
  load: SIG.req,
  store: SIG.heavy,
  lock: SIG.hc,
  unlock: SIG.hc,
  trylock: SIG.hc,
  faa: SIG.warn,
  cas: SIG.warn,
  inc: SIG.text,
};

export const STRATEGY_LABEL: Record<RunSummary['strategy'], string> = { none: 'no lock', mutex: 'mutex', faa: 'atomic add', cas: 'CAS loop' };
const STRATEGY_SHORT: Record<RunSummary['strategy'], string> = { none: 'racy', mutex: 'mutex', faa: 'atomic', cas: 'CAS' };

export interface SceneProps {
  sim: RaceSim;
  highlight: string | null;
  /** Thread cards are clickable (manual scheduling) */
  pick?: boolean;
  onPick?: (id: TId) => void;
}

export function Scene({ sim, highlight, pick, onPick }: SceneProps) {
  const focus = sim.cfg.focus;
  const dimT = (id: TId) => !!focus?.length && !focus.includes(id);
  const hl = (k: string) => highlight === k;
  return (
    <>
      <Wires sim={sim} />
      {sim.scene === 'deadlock' && <WaitGraph sim={sim} />}
      <MemCaption sim={sim} />
      {sim.cells.map((c) => (
        <MemCell key={c.id} sim={sim} c={c} glow={hl(c.id) || hl('mem')} />
      ))}
      {sim.locks.map((l) => (
        <LockBox key={l.id} sim={sim} l={l} glow={hl(l.id) || hl('lock')} />
      ))}
      {sim.threads.map((t) => (
        <g key={t.id}>
          <RegBox sim={sim} t={t} dim={dimT(t.id)} glow={hl(`r:${t.id}`) || hl('reg')} />
          <ThreadCard sim={sim} t={t} dim={dimT(t.id)} glow={hl(t.id)} pick={pick} onPick={onPick} />
        </g>
      ))}
      {sim.isLive('tl') && <Timeline sim={sim} glow={hl('tl')} />}
      {sim.isLive('chart') && <Chart sim={sim} />}
      <Flights sim={sim} />
      <Effects sim={sim} />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Shared memory                                                       */
/* ------------------------------------------------------------------ */

function MemCaption({ sim }: { sim: RaceSim }) {
  if (sim.scene === 'deadlock') return null;
  const ids = [...sim.locks.map((l) => `l:${l.id}`), ...sim.cells.map((c) => `c:${c.id}`)];
  const bs = ids.map((id) => sim.boxes.get(id)).filter(ok);
  if (!bs.length) return null;
  const x0 = Math.min(...bs.map((b) => b.x - b.w / 2));
  const x1 = Math.max(...bs.map((b) => b.x + b.w / 2));
  const y = Math.min(...bs.map((b) => b.y - b.h / 2)) - 9;
  const a = Math.min(...bs.map((b) => b.alpha));
  const text = sim.scene === 'bank' ? 'database · accounts, id = 1' : sim.scene === 'seat' ? 'database · seats' : 'shared memory';
  return (
    <g opacity={a}>
      <text className={kit.caps} x={x0} y={y}>
        {text}
      </text>
      <line x1={x0 + text.length * 6.9 + 8} y1={y - 3} x2={x1} y2={y - 3} stroke="rgba(143,166,201,0.2)" strokeDasharray="2 4" />
    </g>
  );
}

function cellText(c: CellState, v: CellState['value']) {
  if (c.id === 'balance') return `$${v}`;
  if (c.id === 'version') return `v${v}`;
  return String(v);
}

function MemCell({ sim, c, glow }: { sim: RaceSim; c: CellState; glow: boolean }) {
  const b = sim.boxes.get(`c:${c.id}`);
  if (!ok(b)) return null;
  const P = sim.orient === 'portrait';
  const k = clamp((sim.vt - c.changedAt) / 0.45, 0, 1);
  const lostK = c.lost ? clamp((sim.vt - c.lost.at) / 3.2, 0, 1) : 1;
  const running = !!sim.run;
  const size = c.id === 'version' ? (P ? 18 : 24) : P ? 22 : 31;
  const valY = b.h / 2 + size * 0.36 + (P ? 5 : 7);
  const writer = c.writer ? TCOLOR[c.writer] : null;
  const stroke = c.atomic ? SIG.warn : lostK < 1 ? SIG.err : undefined;
  const pulse = 1 - k;
  return (
    <g className={kit.node} transform={`translate(${b.x - b.w / 2},${b.y - b.h / 2})`} opacity={b.alpha}>
      {glow && <rect x={-6} y={-6} width={b.w + 12} height={b.h + 12} rx={14} fill="none" stroke="var(--accent)" strokeWidth={1.4} strokeDasharray="3 3" />}
      <rect className={kit.card} width={b.w} height={b.h} rx={10} style={stroke ? { stroke, strokeWidth: 1.6 } : undefined} />
      <rect className={kit.cardInner} x={3.5} y={3.5} width={b.w - 7} height={b.h - 7} rx={7.5} />
      {pulse > 0.01 && !running && <rect width={b.w} height={b.h} rx={10} fill={writer ?? SIG.text} opacity={pulse * 0.12} />}
      <text className={kit.caps} x={10} y={P ? 14 : 17} style={{ fill: 'var(--text-2)' }}>
        {c.label}
      </text>
      {c.atomic && (
        <text className={kit.caps} x={b.w - 9} y={P ? 14 : 17} textAnchor="end" style={{ fill: SIG.warn }}>
          atomic
        </text>
      )}
      {!c.atomic && writer && !running && (
        <text className={css.tiny} x={b.w - 9} y={P ? 14 : 17} textAnchor="end" fill={writer}>
          by {c.writer}
        </text>
      )}
      {k < 1 && c.prev != null && !running && (
        <text className={css.bigVal} x={b.w / 2} y={valY - k * 12} textAnchor="middle" style={{ fontSize: size }} opacity={(1 - k) * 0.5}>
          {cellText(c, c.prev)}
        </text>
      )}
      <text
        className={css.bigVal}
        x={b.w / 2}
        y={valY + (running ? 0 : (1 - k) * 10)}
        textAnchor="middle"
        style={{ fontSize: size, fill: c.value === 'free' ? SIG.res : typeof c.value === 'string' && writer ? writer : undefined }}
        opacity={running ? 1 : k}
      >
        {typeof c.value === 'number' && c.id === 'count' && c.value >= 1000 ? fmtN(c.value) : cellText(c, c.value)}
      </text>
      {lostK < 1 && c.lost && (
        <g opacity={1 - lostK * lostK}>
          <text className={css.lostVal} x={P ? 8 : 12} y={b.h - (P ? 7 : 9)} fill={SIG.err}>
            {P
              ? `${c.lost.by ?? 'a'}’s write lost`
              : sim.scene === 'counter'
                ? `${cellText(c, c.lost.value)} from ${c.lost.by ?? '?'} overwritten`
                : `${cellText(c, c.lost.value)} overwritten`}
          </text>
        </g>
      )}
    </g>
  );
}

function Padlock({ x, y, held, color, s = 1 }: { x: number; y: number; held: boolean; color: string; s?: number }) {
  return (
    <g transform={`translate(${x},${y}) scale(${s})`}>
      <path
        d={held ? 'M-4.5,-2 V-6 A4.5,4.5 0 0,1 4.5,-6 V-2' : 'M-4.5,-2 V-6 A4.5,4.5 0 0,1 4.5,-6 V-8.5'}
        fill="none"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        transform={held ? undefined : 'translate(0,-2.5)'}
      />
      <rect x={-7} y={-2} width={14} height={11} rx={2.2} fill={color} fillOpacity={held ? 0.28 : 0.08} stroke={color} strokeWidth={1.4} />
      <circle cx={0} cy={3} r={1.4} fill={color} />
    </g>
  );
}

function LockBox({ sim, l, glow }: { sim: RaceSim; l: LockState; glow: boolean }) {
  const b = sim.boxes.get(`l:${l.id}`);
  if (!ok(b)) return null;
  const P = sim.orient === 'portrait';
  const owner = l.owner ? TCOLOR[l.owner] : null;
  const k = clamp((sim.vt - l.changedAt) / 0.5, 0, 1);
  const stuck = sim.deadlocked && !!l.owner;
  const stroke = stuck ? SIG.err : (owner ?? 'rgba(181,155,255,0.6)');
  const tx = P ? 32 : 50;
  const kicker = sim.scene === 'deadlock' ? 'lock' : sim.scene === 'bank' ? 'row lock' : 'mutex';
  const name = sim.scene === 'bank' ? 'id = 1' : l.label;
  const row = (f: number) => Math.round(b.h * f);
  return (
    <g className={kit.node} transform={`translate(${b.x - b.w / 2},${b.y - b.h / 2})`} opacity={b.alpha}>
      {glow && <rect x={-6} y={-6} width={b.w + 12} height={b.h + 12} rx={14} fill="none" stroke="var(--accent)" strokeWidth={1.4} strokeDasharray="3 3" />}
      <rect className={kit.card} width={b.w} height={b.h} rx={10} style={{ stroke, strokeWidth: owner ? 1.5 : 1.1 }} />
      {k < 1 && <rect width={b.w} height={b.h} rx={10} fill={owner ?? SIG.hc} opacity={(1 - k) * 0.16} />}
      <Padlock x={P ? 16 : 25} y={b.h / 2 - 1} held={!!owner} color={owner ?? SIG.hc} s={P ? 0.95 : 1.25} />
      {P ? (
        <>
          <text className={kit.monoStrong} x={tx} y={row(0.3)} style={{ fontSize: 11 }}>
            {name}
          </text>
          <text className={css.tiny} x={tx} y={row(0.58)} fill={owner ?? SIG.res}>
            {l.owner ? `held by ${l.owner}` : 'free'}
          </text>
          {l.queue.length > 0 && (
            <text className={css.tiny} x={tx} y={row(0.84)} fill={SIG.hc}>
              {l.queue.length === 1 ? `waiting: ${l.queue[0]}` : `${l.queue.length} waiting`}
            </text>
          )}
        </>
      ) : (
        <>
          <text className={kit.caps} x={tx} y={row(0.3)} style={{ fill: '#cdbdff' }}>
            {kicker}
          </text>
          <text className={kit.monoStrong} x={tx} y={row(0.55)} style={{ fontSize: 13 }}>
            {name}
          </text>
          <text className={css.small} x={tx} y={row(0.8)} fill={owner ?? SIG.res}>
            {l.owner ? `held by ${l.owner}` : 'free'}
          </text>
          {l.queue.length > 0 && (
            <g>
              <text className={css.tiny} x={b.w - 10} y={row(0.3)} textAnchor="end" fill={SIG.hc}>
                waiting
              </text>
              {l.queue.map((q, i) => (
                <g key={q} transform={`translate(${b.w - 17 - i * 17},${row(0.64)})`}>
                  <circle r={7.5} fill={TCOLOR[q]} fillOpacity={0.16} stroke={TCOLOR[q]} strokeWidth={1.2} strokeDasharray="2 2" />
                  <text x={0} y={3.3} textAnchor="middle" className={css.letter} fill={TCOLOR[q]}>
                    {q}
                  </text>
                </g>
              ))}
            </g>
          )}
        </>
      )}
    </g>
  );
}

/* ------------------------------------------------------------------ */
/* Threads                                                             */
/* ------------------------------------------------------------------ */

/** A small pill that pops up next to a register: "+1", "free ✓", "too low"… */
function Badge({ x, y, text, color, k }: { x: number; y: number; text: string; color: string; k: number }) {
  const w = text.length * 6.3 + 12;
  const a = k < 0.15 ? k / 0.15 : k > 0.75 ? (1 - k) / 0.25 : 1;
  return (
    <g transform={`translate(${x - w},${y - k * 6})`} opacity={a}>
      <rect width={w} height={16} rx={8} fill="rgba(7,11,20,0.94)" stroke={color} strokeOpacity={0.8} />
      <text className={css.badge} x={w / 2} y={11.5} textAnchor="middle" fill={color}>
        {text}
      </text>
    </g>
  );
}

function badgeColor(text: string, fallback: string) {
  if (/✓|free|enough|yes/.test(text)) return SIG.res;
  if (/low|taken|no|timed/.test(text)) return SIG.err;
  return fallback;
}

function RegBox({ sim, t, dim, glow }: { sim: RaceSim; t: ThreadState; dim: boolean; glow: boolean }) {
  const b = sim.boxes.get(`r:${t.id}`);
  if (!ok(b)) return null;
  const P = sim.orient === 'portrait';
  const flash = clamp(1 - (sim.vt - t.flashAt) / 0.8, 0, 1);
  const addK = clamp((sim.vt - t.addAt) / 1.3, 0, 1);
  const regs = t.prog.regs;
  const cw = b.w / regs.length;
  return (
    <g transform={`translate(${b.x - b.w / 2},${b.y - b.h / 2})`} opacity={b.alpha * (dim ? 0.3 : 1)}>
      {glow && <rect x={-5} y={-5} width={b.w + 10} height={b.h + 10} rx={10} fill="none" stroke="var(--accent)" strokeWidth={1.4} strokeDasharray="3 3" />}
      <line x1={b.w / 2} y1={b.h} x2={b.w / 2} y2={b.h + 6} stroke={t.color} strokeOpacity={0.5} />
      <rect width={b.w} height={b.h} rx={7} fill="var(--node-fill)" stroke={t.color} strokeOpacity={0.55} strokeWidth={1.1} />
      {flash > 0.01 && <rect x={-2} y={-2} width={b.w + 4} height={b.h + 4} rx={9} fill={t.color} fillOpacity={flash * 0.12} stroke={t.color} strokeWidth={2} opacity={flash} />}
      {regs.map((r, i) => {
        const v = t.regs[r];
        return (
          <g key={r} transform={`translate(${i * cw},0)`}>
            {i > 0 && <line x1={0} y1={6} x2={0} y2={b.h - 6} stroke="rgba(143,166,201,0.2)" />}
            <text className={css.regName} x={P ? 8 : 11} y={b.h / 2 + 4}>
              {r}
            </text>
            <text
              className={css.regVal}
              x={cw / 2 + (P ? 8 : 10)}
              y={b.h / 2 + (P ? 5 : 6)}
              textAnchor="middle"
              style={{ fontSize: P ? 13.5 : 17, fill: v == null ? 'var(--text-3)' : t.color }}
            >
              {v == null ? '–' : String(v)}
            </text>
          </g>
        );
      })}
      {addK < 1 && t.addText && <Badge x={b.w + 4} y={-12} text={t.addText} color={badgeColor(t.addText, t.color)} k={addK} />}
    </g>
  );
}

function statusOf(sim: RaceSim, t: ThreadState): { text: string; color: string } {
  if (t.status === 'done') {
    if (t.result && t.result.text !== 'done') return { text: `${t.result.text}${t.result.ok ? ' ✓' : ''}`, color: t.result.ok ? SIG.res : SIG.heavy };
    return { text: 'done ✓', color: SIG.res };
  }
  if (t.status === 'blocked') return sim.deadlocked ? { text: 'stuck', color: SIG.err } : { text: `waiting · ${t.waitFor}`, color: SIG.hc };
  if (t.status === 'sleep') return { text: 'backing off', color: SIG.warn };
  if (t.status === 'busy') return { text: 'running', color: SIG.warn };
  if (sim.run) return { text: 'running', color: SIG.warn };
  return { text: 'ready', color: 'var(--text-3)' };
}

function ThreadCard({ sim, t, dim, glow, pick, onPick }: { sim: RaceSim; t: ThreadState; dim: boolean; glow: boolean; pick?: boolean; onPick?: (id: TId) => void }) {
  const b = sim.boxes.get(`t:${t.id}`);
  if (!ok(b)) return null;
  const m = sim.metrics();
  const { P, lh, head } = m;
  const st = statusOf(sim, t);
  const blocked = t.status === 'blocked';
  const stuck = blocked && sim.deadlocked;
  const clickable = pick && !!onPick;
  const canRun = clickable && !sim.blockedReason(t.id);
  const crit = sim.cfg.crit && t.prog.crit;
  const crowded = t.inside && sim.insideCount() > 1;
  const running = t.status === 'busy';
  const sample = sim.runSample();
  const idx = sim.threads.indexOf(t);
  const lastRun = sim.runs[sim.runs.length - 1];
  const doneN = sample ? sample.done[idx] : sim.cfg.mode === 'run' && lastRun && !sim.run ? lastRun.per : 0;
  const per = sim.cfg.mode === 'run' ? sim.per : 1;
  const waitingNow = !!sample?.waiting[idx];
  const stroke = stuck ? SIG.err : running || waitingNow ? t.color : undefined;
  const name = P ? t.short : t.name;
  const nameX = P ? 10 : 14;
  const nameY = m.tight ? 16 : P ? 17 : 19;
  const nameW = name.length * (P ? 6.7 : 7.5);
  const charW = P ? 6.05 : 7.25;
  const mnX = P ? 30 : 42;
  const mnW = Math.max(...t.prog.instrs.map((i) => i.mn.length)) * charW + (P ? 7 : 10);
  const iters = t.prog.iters ?? 1;
  const statusW = st.text.length * (P ? 5.8 : 6.4);
  const holdsFit = t.holds.length > 0 && b.w - nameX - nameW - statusW - 28 > t.holds.join(' ').length * 6 + 14;
  return (
    <g
      className={cx(kit.node, clickable && kit.clickable)}
      transform={`translate(${b.x - b.w / 2},${b.y - b.h / 2})`}
      opacity={b.alpha * (dim ? 0.3 : 1)}
      onClick={canRun ? () => onPick?.(t.id) : undefined}
      role={clickable ? 'button' : undefined}
      aria-label={clickable ? `Run ${t.name}'s next step` : undefined}
    >
      {clickable && <rect x={-6} y={-6} width={b.w + 12} height={b.h + 12} fill="transparent" />}
      {glow && <rect x={-6} y={-6} width={b.w + 12} height={b.h + 12} rx={14} fill="none" stroke="var(--accent)" strokeWidth={1.4} strokeDasharray="3 3" />}
      {canRun && <rect x={-4} y={-4} width={b.w + 8} height={b.h + 8} rx={13} fill="none" stroke={t.color} strokeWidth={1.3} className={css.invite} />}
      <rect className={kit.card} width={b.w} height={b.h} rx={10} style={stroke ? { stroke, strokeWidth: 1.6 } : { stroke: t.color, strokeOpacity: 0.45 }} />
      <rect x={12} y={0} width={b.w - 24} height={2} rx={1} fill={t.color} opacity={0.9} />

      {/* header */}
      <text className={kit.caps} x={nameX} y={nameY} style={{ fill: t.color, fontSize: P ? 9 : 10, fontWeight: 600 }}>
        {name}
      </text>
      {holdsFit && (
        <g>
          <Padlock x={nameX + nameW + 9} y={nameY - 4} held color={SIG.hc} s={0.6} />
          <text className={css.tiny} x={nameX + nameW + 16} y={nameY} fill={SIG.hc}>
            {t.holds.join(' ')}
          </text>
        </g>
      )}
      <text className={css.tStatus} x={b.w - (P ? 9 : 12)} y={nameY} textAnchor="end" fill={st.color}>
        {st.text}
      </text>
      {!P && (
        <text className={css.src} x={14} y={37}>
          {sim.cfg.mode === 'run' ? `for i in 1…${fmtN(per)}:` : t.prog.src}
        </text>
      )}
      {!P && iters > 1 && sim.cfg.mode !== 'run' && (
        <text className={css.tiny} x={b.w - 12} y={37} textAnchor="end" fill="var(--text-2)">
          {t.status === 'done' ? `${iters} of ${iters}` : `${Math.min(iters, t.iter + 1)} of ${iters}`}
        </text>
      )}
      <line x1={8} y1={head - 5} x2={b.w - 8} y2={head - 5} stroke="rgba(143,166,201,0.16)" />

      {/* critical section band */}
      {crit && (
        <rect
          x={4}
          y={head + crit[0] * lh - 1}
          width={b.w - 8}
          height={(crit[1] - crit[0] + 1) * lh + 2}
          rx={5}
          fill={crowded ? 'rgba(255,77,106,0.09)' : t.inside ? 'rgba(255,210,63,0.1)' : 'rgba(255,210,63,0.04)'}
          stroke={crowded ? 'rgba(255,77,106,0.7)' : t.inside ? 'rgba(255,210,63,0.75)' : 'rgba(255,210,63,0.35)'}
          strokeDasharray="3 3"
        />
      )}

      {/* instructions */}
      {t.prog.instrs.map((ins, i) => {
        const y = head + i * lh;
        const exec = t.exec === i;
        const isPc = t.pc === i && t.status !== 'done' && sim.cfg.mode !== 'run';
        const val = t.vals[i];
        const args = P || b.w < 240 ? (ins.sargs ?? ins.args) : ins.args;
        const argsEnd = mnX + mnW + args.length * charW;
        const fitsVal = val != null && argsEnd + 16 + val.length * (P ? 6 : 6.6) < b.w - (P ? 7 : 11);
        const faded = val != null && !exec && !isPc;
        return (
          <g key={i}>
            {exec && <rect x={4} y={y} width={b.w - 8} height={lh - 1} rx={4} fill="rgba(255,210,63,0.13)" />}
            {exec && <rect x={4} y={y} width={2} height={lh - 1} fill="var(--accent)" />}
            {isPc && !exec && blocked && <rect x={4} y={y} width={b.w - 8} height={lh - 1} rx={4} fill={stuck ? 'rgba(255,77,106,0.12)' : 'rgba(181,155,255,0.12)'} />}
            <text className={css.lineNo} x={P ? 18 : 27} y={y + lh / 2 + 3.5} textAnchor="end" fill={isPc || exec ? 'var(--accent)' : undefined}>
              {isPc || exec ? '▶' : i + 1}
            </text>
            <text className={css.mn} x={mnX} y={y + lh / 2 + 4} fill={MN_COLOR[ins.op] ?? SIG.text} opacity={faded ? 0.55 : 1}>
              {ins.mn}
            </text>
            {args && (
              <text className={css.args} x={mnX + mnW} y={y + lh / 2 + 4} opacity={faded ? 0.55 : 1}>
                {args}
              </text>
            )}
            {fitsVal && (
              <text className={css.lineVal} x={b.w - (P ? 7 : 11)} y={y + lh / 2 + 4} textAnchor="end">
                {val}
              </text>
            )}
          </g>
        );
      })}
      {crit && (
        <text className={css.critLabel} x={b.w - (P ? 9 : 12)} y={head + (crit[1] + 1) * lh + 3.5} textAnchor="end" fill={crowded ? SIG.err : SIG.warn}>
          {P ? 'critical' : crowded ? 'both inside!' : 'critical section'}
        </text>
      )}

      {/* loop progress (run mode) */}
      {sim.cfg.mode === 'run' && (
        <g transform={`translate(${P ? 10 : 14},${b.h - m.progress - m.pad + (P ? 4 : 6)})`}>
          <text className={css.tiny} x={0} y={P ? 9 : 10} fill="var(--text-2)">
            i = {fmtN(doneN)}
          </text>
          <rect x={P ? 62 : 84} y={P ? 3 : 4} width={b.w - (P ? 20 : 28) - (P ? 62 : 84)} height={5} rx={2.5} fill="rgba(143,166,201,0.15)" />
          <rect
            x={P ? 62 : 84}
            y={P ? 3 : 4}
            width={Math.max(0, (b.w - (P ? 20 : 28) - (P ? 62 : 84)) * (doneN / Math.max(1, per)))}
            height={5}
            rx={2.5}
            fill={waitingNow ? SIG.hc : t.color}
          />
        </g>
      )}

      {blocked && <rect width={b.w} height={b.h} rx={10} fill={stuck ? 'url(#kit-hatch)' : 'url(#kit-hatch-dim)'} pointerEvents="none" />}
    </g>
  );
}

/* ------------------------------------------------------------------ */
/* Interleaving strip                                                  */
/* ------------------------------------------------------------------ */

function ghostChips(sim: RaceSim): Chip[] {
  if (sim.cfg.predict !== 'count' || sim.roundOver) return [];
  const pcs = new Map(sim.threads.map((t) => [t.id, t.pc + (t.status === 'busy' ? 1 : 0)]));
  const out: Chip[] = [];
  for (const id of sim.plan.slice(sim.planPos)) {
    const t = sim.thread(id);
    if (!t) continue;
    const pc = pcs.get(id) ?? 0;
    const ins = t.prog.instrs[pc];
    if (!ins) continue;
    out.push({ tid: id, code: ins.code });
    pcs.set(id, pc + 1);
  }
  return out;
}

function Timeline({ sim, glow }: { sim: RaceSim; glow: boolean }) {
  const b = sim.boxes.get('tl');
  if (!ok(b)) return null;
  const P = sim.orient === 'portrait';
  const lanes = sim.threads;
  const headH = P ? 18 : 24;
  const laneH = P ? 27 : 36;
  const labelW = P ? 24 : 34;
  const chips = sim.hist;
  const ghosts = ghostChips(sim);
  const total = chips.length + ghosts.length;
  const avail = b.w - labelW - 4;
  const colW = Math.min(P ? 40 : 70, avail / Math.max(total, P ? 8 : 10));
  const cap = Math.floor(avail / colW);
  const offset = Math.max(0, total - cap);
  const all = [...chips.map((c) => ({ c, ghost: false })), ...ghosts.map((c) => ({ c, ghost: true }))];
  const twoLine = !P || colW >= 34;
  return (
    <g transform={`translate(${b.x - b.w / 2},${b.y - b.h / 2})`} opacity={b.alpha}>
      {glow && <rect x={-6} y={-6} width={b.w + 12} height={b.h + 12} rx={10} fill="none" stroke="var(--accent)" strokeWidth={1.4} strokeDasharray="3 3" />}
      <text className={kit.caps} x={0} y={P ? 10 : 12}>
        interleaving
      </text>
      <text className={kit.caps} x={b.w} y={P ? 10 : 12} textAnchor="end">
        time →
      </text>
      {lanes.map((t, li) => {
        const y = headH + li * laneH;
        return (
          <g key={t.id} transform={`translate(0,${y})`}>
            <line x1={labelW - 4} y1={laneH / 2} x2={b.w} y2={laneH / 2} stroke="rgba(143,166,201,0.14)" strokeDasharray="2 4" />
            <circle cx={P ? 9 : 12} cy={laneH / 2} r={P ? 8 : 10} fill={t.color} fillOpacity={0.14} stroke={t.color} strokeWidth={1.2} />
            <text className={css.letter} x={P ? 9 : 12} y={laneH / 2 + 3.5} textAnchor="middle" fill={t.color}>
              {t.id}
            </text>
          </g>
        );
      })}
      {all.map(({ c, ghost }, i) => {
        if (i < offset) return null;
        const li = lanes.findIndex((t) => t.id === c.tid);
        if (li < 0) return null;
        const x = labelW + (i - offset) * colW;
        const y = headH + li * laneH + 3;
        const w = colW - 4;
        const h = laneH - 6;
        const color = TCOLOR[c.tid];
        const tone = c.tone;
        const stroke = ghost ? 'rgba(143,166,201,0.45)' : tone === 'bad' ? SIG.err : tone === 'wait' ? SIG.hc : tone === 'fail' ? SIG.heavy : tone === 'atomic' ? SIG.warn : color;
        const fill = ghost ? 'transparent' : tone === 'bad' ? 'rgba(255,77,106,0.16)' : color;
        const next = ghost && i === chips.length;
        return (
          <g key={i} transform={`translate(${x},${y})`} className={ghost ? undefined : css.chipIn}>
            <rect
              width={w}
              height={h}
              rx={5}
              fill={tone === 'wait' && !ghost ? 'url(#kit-hatch-dim)' : fill}
              fillOpacity={ghost || tone === 'bad' || tone === 'wait' ? 1 : 0.14}
              stroke={next ? SIG.warn : stroke}
              strokeWidth={next ? 1.4 : 1.1}
              strokeDasharray={ghost ? '3 3' : undefined}
            />
            {twoLine && c.val ? (
              <>
                <text className={css.chipCode} x={w / 2} y={h / 2 - (P ? 1.5 : 2)} textAnchor="middle" fill={ghost ? 'var(--text-3)' : color}>
                  {c.code}
                </text>
                <text className={css.chipVal} x={w / 2} y={h / 2 + (P ? 8 : 10)} textAnchor="middle" fill={tone === 'bad' ? SIG.err : 'var(--text-1)'}>
                  {c.val}
                </text>
              </>
            ) : (
              <text className={css.chipCode} x={w / 2} y={h / 2 + 3.5} textAnchor="middle" fill={ghost ? 'var(--text-3)' : color}>
                {c.code}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}

/* ------------------------------------------------------------------ */
/* Results chart for the 1,000-increment runs                          */
/* ------------------------------------------------------------------ */

function Chart({ sim }: { sim: RaceSim }) {
  const b = sim.boxes.get('chart');
  if (!ok(b)) return null;
  const P = sim.orient === 'portrait';
  const live = sim.run;
  const sample = sim.runSample();
  const bars: (RunSummary & { live?: boolean })[] = [...sim.runs];
  if (live && sample) {
    const p = live.res.params;
    bars.push({ id: -1, strategy: p.strategy, threads: p.threads, per: p.per, work: p.work, final: sample.count, expected: live.res.expected, lost: sample.lost, ticks: sample.tick, waitShare: 0, retries: 0, live: true });
  }
  const shown = bars.slice(-6);
  const headH = P ? 16 : 20;
  const footH = P ? 30 : 38;
  const top = headH + (P ? 12 : 14);
  const plotH = b.h - top - footH;
  const slots = 6;
  const slotW = b.w / slots;
  const barW = Math.min(P ? 34 : 58, slotW - (P ? 14 : 26));
  const maxT = Math.max(1, ...shown.map((r) => r.ticks));
  const exp = shown.length ? shown[shown.length - 1].expected : sim.nThreads * sim.per;
  const mixed = shown.some((r) => r.expected !== exp);
  return (
    <g transform={`translate(${b.x - b.w / 2},${b.y - b.h / 2})`} opacity={b.alpha}>
      <text className={kit.caps} x={0} y={P ? 10 : 12}>
        {P ? 'results' : `results · ${sim.nThreads} threads × ${fmtN(sim.per)} increments`}
      </text>
      <text className={kit.caps} x={b.w} y={P ? 10 : 12} textAnchor="end" style={{ fill: SIG.res }}>
        {mixed ? 'expected (100%)' : `expected ${fmtN(exp)}`}
      </text>
      <line x1={0} y1={top} x2={b.w} y2={top} stroke={SIG.res} strokeOpacity={0.55} strokeDasharray="4 4" />
      <line x1={0} y1={top + plotH} x2={b.w} y2={top + plotH} stroke="rgba(143,166,201,0.3)" />
      {shown.length === 0 && (
        <text className={css.small} x={b.w / 2} y={top + plotH / 2 + 4} textAnchor="middle" fill="var(--text-3)">
          {P ? 'press run to fill this chart' : 'press run: each run adds a bar'}
        </text>
      )}
      {shown.map((r, i) => {
        const x = slotW * i + slotW / 2;
        const k = clamp(r.final / Math.max(1, r.expected), 0, 1);
        const hBar = plotH * k;
        const exact = !r.live && r.lost === 0;
        const color = r.live ? SIG.warn : exact ? SIG.res : SIG.req;
        const tw = barW * (r.ticks / maxT);
        return (
          <g key={r.id}>
            {!exact && !r.live && (
              <rect x={x - barW / 2} y={top} width={barW} height={plotH - hBar} fill="url(#kit-hatch)" stroke={SIG.err} strokeOpacity={0.5} strokeDasharray="2 3" />
            )}
            <rect x={x - barW / 2} y={top + plotH - hBar} width={barW} height={hBar} rx={2} fill={color} fillOpacity={0.3} stroke={color} strokeWidth={1.2} />
            <text className={css.barVal} x={x} y={Math.max(top - 3, top + plotH - hBar - 5)} textAnchor="middle" fill={exact ? SIG.res : r.live ? SIG.warn : 'var(--text-1)'} style={P ? { fontSize: 9.5 } : undefined}>
              {fmtN(r.final)}
            </text>
            {!exact && !r.live && !P && (
              <text className={css.tiny} x={x} y={top + (plotH - hBar) / 2 + 3} textAnchor="middle" fill={SIG.err}>
                −{fmtN(r.lost)}
              </text>
            )}
            <text className={css.tiny} x={x} y={top + plotH + (P ? 11 : 13)} textAnchor="middle" fill="var(--text-2)" style={P ? { fontSize: 8 } : undefined}>
              {P ? STRATEGY_SHORT[r.strategy] : STRATEGY_LABEL[r.strategy]}
            </text>
            <rect x={x - barW / 2} y={top + plotH + (P ? 17 : 20)} width={barW} height={3} rx={1.5} fill="rgba(143,166,201,0.14)" />
            <rect x={x - barW / 2} y={top + plotH + (P ? 17 : 20)} width={Math.max(1.5, tw)} height={3} rx={1.5} fill={SIG.heavy} opacity={0.85} />
            {!P && (
              <text className={css.tiny} x={x} y={top + plotH + 34} textAnchor="middle" fill="var(--text-3)">
                {r.ticks >= 1000 ? `${(r.ticks / 1000).toFixed(1)}k` : r.ticks} ticks
              </text>
            )}
          </g>
        );
      })}
      {!P && shown.length > 0 && (
        <text className={css.tiny} x={-8} y={top + plotH + 23} textAnchor="end" fill={SIG.heavy}>
          time
        </text>
      )}
    </g>
  );
}

/* ------------------------------------------------------------------ */
/* Deadlock: who holds what, who waits for what                        */
/* ------------------------------------------------------------------ */

function clip(b: Box, toward: { x: number; y: number }, pad = 5) {
  const dx = toward.x - b.x;
  const dy = toward.y - b.y;
  const hw = b.w / 2 + pad;
  const hh = b.h / 2 + pad;
  const s = Math.min(Math.abs(dx) > 1e-6 ? hw / Math.abs(dx) : Infinity, Math.abs(dy) > 1e-6 ? hh / Math.abs(dy) : Infinity);
  return { x: b.x + dx * s, y: b.y + dy * s };
}

function Edge({ a, b, color, dashed, label, flow, P }: { a: Box; b: Box; color: string; dashed?: boolean; label: string | null; flow: number; P: boolean }) {
  const p0 = clip(a, b);
  const p1 = clip(b, a);
  const ang = Math.atan2(p1.y - p0.y, p1.x - p0.x);
  const h = 7;
  const mx = (p0.x + p1.x) / 2;
  const my = (p0.y + p1.y) / 2;
  const tw = (label?.length ?? 0) * (P ? 5.6 : 6.2) + 12;
  return (
    <g>
      <line x1={p0.x} y1={p0.y} x2={p1.x} y2={p1.y} stroke={color} strokeWidth={1.8} strokeDasharray={dashed ? '5 4' : undefined} strokeDashoffset={dashed ? -flow * 18 : undefined} strokeLinecap="round" />
      <path
        d={`M${p1.x - h * Math.cos(ang - 0.45)},${p1.y - h * Math.sin(ang - 0.45)} L${p1.x},${p1.y} L${p1.x - h * Math.cos(ang + 0.45)},${p1.y - h * Math.sin(ang + 0.45)}`}
        fill="none"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {label && (
        <g transform={`translate(${mx},${my})`}>
          <rect x={-tw / 2} y={-8} width={tw} height={16} rx={8} fill="rgba(7,11,20,0.92)" stroke={color} strokeOpacity={0.6} />
          <text className={css.edgeLabel} x={0} y={3.5} textAnchor="middle" fill={color}>
            {label}
          </text>
        </g>
      )}
    </g>
  );
}

function WaitGraph({ sim }: { sim: RaceSim }) {
  const P = sim.orient === 'portrait';
  const edges: { a: Box; b: Box; color: string; dashed?: boolean; label: string; key: string }[] = [];
  const red = sim.deadlocked;
  for (const l of sim.locks) {
    const lb = sim.boxes.get(`l:${l.id}`);
    if (!ok(lb) || !l.owner) continue;
    const tb = sim.boxes.get(`t:${l.owner}`);
    if (!ok(tb)) continue;
    edges.push({ a: lb, b: tb, color: red ? SIG.err : TCOLOR[l.owner], label: `held by ${l.owner}`, key: `h-${l.id}` });
  }
  for (const t of sim.threads) {
    if (!t.waitFor) continue;
    const tb = sim.boxes.get(`t:${t.id}`);
    const lb = sim.boxes.get(`l:${t.waitFor}`);
    if (!ok(tb) || !ok(lb)) continue;
    edges.push({ a: tb, b: lb, color: red ? SIG.err : SIG.warn, dashed: true, label: `${t.id} waits`, key: `w-${t.id}` });
  }
  const flow = sim.vt % 1;
  return (
    <g>
      {edges.map((e) => (
        <Edge key={e.key} a={e.a} b={e.b} color={e.color} dashed={e.dashed} label={P ? null : e.label} flow={flow} P={P} />
      ))}
    </g>
  );
}
