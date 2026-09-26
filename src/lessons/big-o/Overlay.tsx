'use client';

import type { CSSProperties, ReactNode } from 'react';
import { highlightLine } from '@/components/lesson/CodeBlock';
import { Hud, type HudItem } from '@/components/stage/chrome';
import { StagePrompt } from '@/components/stage/overlays';
import { SIG } from '@/lib/sim/colors';
import { bigGeo, binaryCells, classifyGeo, frame, racePanel, raceGeo, scanGeo } from './layout';
import { CLASSES, commas, fibCalls, fmtCountLg, fmtTimeLg, memoCalls } from './model';
import type { BigOSim } from './sim';
import css from './bigo.module.css';

const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(' ');

export type HudKey = 'n' | 'steps' | 'levels' | 'moves' | 'cmp' | 'calls' | 'clock' | 'score';

/* ------------------------------------------------------------------ */
/* HUD                                                                 */
/* ------------------------------------------------------------------ */

function viewN(sim: BigOSim): number {
  switch (sim.cfg.view) {
    case 'race':
      return sim.race.n;
    case 'scan':
      return sim.scan.n;
    case 'constant':
      return sim.konst.n;
    case 'binary':
      return sim.bin.mode === 'array' ? sim.bin.arr.length : sim.bin.N;
    case 'merge':
      return sim.merge.n;
    case 'grid':
      return sim.grid.n;
    case 'fib':
      return sim.fib.n;
    case 'chart':
      return Math.round(sim.chart.nNow);
    case 'lapse':
      return sim.lapse.n;
    default:
      return 0;
  }
}

function hudItems(sim: BigOSim, keys: HudKey[]): HudItem[] {
  const out: HudItem[] = [];
  const small = sim.orient !== 'landscape';
  for (const k of keys) {
    if (k === 'n') out.push({ label: 'Input size n', value: small && viewN(sim) >= 1e6 ? fmtCountLg(Math.log10(viewN(sim))) : commas(viewN(sim)) });
    else if (k === 'steps') {
      const v = sim.cfg.view === 'binary' ? (sim.bin.mode === 'array' ? sim.bin.steps : sim.bin.bSteps) : sim.scan.steps;
      out.push({ label: 'Steps', value: v, tone: 'good' });
    } else if (k === 'levels') out.push({ label: 'Levels', value: sim.merge.mode === 'split' ? Math.max(0, sim.merge.rowsShown - 1) : sim.merge.L });
    else if (k === 'moves') out.push({ label: 'Moves', value: `${sim.merge.moves} / ${sim.merge.n * sim.merge.L}` });
    else if (k === 'cmp') out.push({ label: 'Comparisons', value: `${sim.grid.k} / ${sim.grid.total}`, tone: 'warn' });
    else if (k === 'calls') out.push({ label: 'Calls', value: `${sim.fib.calls} / ${sim.fib.active.length}`, tone: sim.fib.memo ? 'good' : 'warn' });
    else if (k === 'clock') out.push({ label: 'Clock', value: fmtTimeLg(Math.max(0, sim.lapse.play)) });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Readout shell                                                       */
/* ------------------------------------------------------------------ */

function Ro({ head, children, fresh }: { head: ReactNode; children: ReactNode; fresh?: boolean }) {
  return (
    <div className={cx(css.ro, fresh && css.roFresh)}>
      <div className={css.roHead}>{head}</div>
      {children}
    </div>
  );
}

const Tag = ({ c, children }: { c: string; children: ReactNode }) => (
  <span className={css.tag} style={{ '--c': c, color: c } as CSSProperties}>
    <i />
    {children}
  </span>
);

/* ------------------------------------------------------------------ */
/* Readouts per view                                                   */
/* ------------------------------------------------------------------ */

function ScanReadout({ sim, compact }: { sim: BigOSim; compact: boolean }) {
  const s = sim.scan;
  if (s.mode === 'max') {
    return (
      <Ro head="findMax(arr) · counting">
        {compact ? (
          <div className={css.line}>
            n = <b>{s.n}</b> → <em>{s.steps}</em> comparisons{s.state === 'done' ? ' · T(n) = n' : '…'}
          </div>
        ) : (
          <>
            <div className={css.row2}>
              <span>input size n</span>
              <span>{s.n}</span>
            </div>
            <div className={css.row2}>
              <span>comparisons so far</span>
              <span>{s.steps}</span>
            </div>
            <div className={css.result}>
              {s.state === 'done' ? (
                <>
                  T({s.n}) = <b>{s.steps}</b>: one step per element
                </>
              ) : (
                <span className={css.dim}>one comparison per element…</span>
              )}
            </div>
          </>
        )}
      </Ro>
    );
  }
  if (s.mode === 'search') {
    const upto = s.arr.slice(0, Math.max(0, s.i + 1));
    const shown = upto.slice(compact ? -4 : -6);
    return (
      <Ro head={`arr.includes(${s.target}) · linear search`}>
        <div className={css.line}>
          {upto.length > shown.length && <span className={css.dim}>… </span>}
          {shown.map((v, i) => (
            <span key={i} style={{ color: v === s.target ? SIG.res : undefined }}>
              {v}
              {v === s.target ? ' = ' : ' ≠ '}
              {s.target}
              {i < shown.length - 1 ? ' · ' : ''}
            </span>
          ))}
          {!upto.length && <span className={css.dim}>starting at index 0…</span>}
        </div>
        <div className={css.result}>
          {s.state === 'done' ? (
            s.foundIdx != null ? (
              <>
                found after <b>{s.steps}</b> of n = {s.n} comparisons
              </>
            ) : (
              <>
                missing: all <b>{s.steps}</b> checked
              </>
            )
          ) : (
            <span className={css.dim}>{s.steps} comparisons so far</span>
          )}
        </div>
      </Ro>
    );
  }
  // cases
  const best = s.lastOf('best');
  const worst = s.lastOf('worst');
  const avg = s.avgSteps();
  const avgRuns = s.history.filter((h) => h.kind === 'avg').length;
  if (compact) {
    return (
      <Ro head="linear search · n = 16">
        <div className={css.stripGrid}>
          <span>
            best <b className={css.good}>{best ? best.steps : '—'}</b>
          </span>
          <span>
            worst <b className={css.bad}>{worst ? worst.steps : '—'}</b>
          </span>
          <span>
            average <b>{avg != null ? avg.toFixed(1) : '—'}</b>
          </span>
          <span>
            expected <b>{(s.n + 1) / 2}</b>
          </span>
        </div>
        <div className={css.result}>
          quoted: <b>worst case, O(n)</b>
        </div>
      </Ro>
    );
  }
  return (
    <Ro head={`linear search · n = ${s.n}`}>
      <div className={css.row2}>
        <Tag c={SIG.res}>best case</Tag>
        <span>{best ? `${best.steps} step` : '—'}</span>
      </div>
      <div className={css.row2}>
        <Tag c={SIG.warn}>average ({avgRuns} run{avgRuns === 1 ? '' : 's'})</Tag>
        <span>{avg != null ? `${avg.toFixed(1)} steps` : '—'}</span>
      </div>
      <div className={css.row2}>
        <Tag c={SIG.err}>worst case</Tag>
        <span>{worst ? `${worst.steps} steps` : '—'}</span>
      </div>
      <div className={css.result}>
        Big-O quotes the <b>worst case</b>: n steps, O(n)
      </div>
    </Ro>
  );
}

function SpaceReadout({ sim, compact }: { sim: BigOSim; compact: boolean }) {
  const r = sim.race;
  const n = r.n;
  const nested = r.lanes.find((l) => l.id === 'nested');
  const set = r.lanes.find((l) => l.id === 'set');
  const used = set ? r.memUsed(set) : 0;
  if (compact) {
    return (
      <Ro head={`time vs extra memory · n = ${commas(n)}`}>
        <div className={css.row2}>
          <Tag c={CLASSES.n2.color}>nested</Tag>
          <span>
            {fmtCountLg(Math.log10(Math.max(1, (n * (n - 1)) / 2)))} steps · 2 vars
          </span>
        </div>
        <div className={css.row2}>
          <Tag c={CLASSES.n.color}>Set</Tag>
          <span>
            {fmtCountLg(Math.log10(2 * n))} steps · {commas(used)} stored
          </span>
        </div>
      </Ro>
    );
  }
  return (
    <Ro head={`time vs extra memory · n = ${commas(n)}`}>
      <div className={css.tbl4}>
        <span className={css.tblHead} />
        <span className={css.tblHead}>steps (time)</span>
        <span className={css.tblHead}>extra memory</span>
        <span className={css.tblHead}>Big-O</span>
        <Tag c={CLASSES.n2.color}>Nested loops</Tag>
        <span>
          {fmtCountLg(Math.log10(Math.max(1, (n * (n - 1)) / 2)))} <span className={css.dim}>= n(n−1)/2</span>
        </span>
        <span>
          2 variables <span className={css.dim}>(i, j)</span>
        </span>
        <span>
          <b className={css.warn}>O(n²)</b> time · <b className={css.good}>O(1)</b> space
        </span>
        <Tag c={CLASSES.n.color}>Set</Tag>
        <span>
          {fmtCountLg(Math.log10(2 * n))} <span className={css.dim}>= 2n</span>
        </span>
        <span>
          {commas(used)} <span className={css.dim}>of {commas(n)} items</span>
        </span>
        <span>
          <b className={css.good}>O(n)</b> time · <b className={css.warn}>O(n)</b> space
        </span>
      </div>
      {nested && nested.finishedAt == null && set && set.finishedAt != null && (
        <div className={css.result}>
          the Set finished first; nested loops still at <b>{fmtCountLg(Math.log10(Math.max(1, nested.done)))}</b> comparisons
        </div>
      )}
    </Ro>
  );
}

function BinaryReadout({ sim, compact }: { sim: BigOSim; compact: boolean }) {
  const b = sim.bin;
  const chips = b.sizes;
  return (
    <Ro head={`binary search · find ${b.target}`}>
      {!compact && (
        <div className={css.row2}>
          <span>steps so far</span>
          <span>{b.steps}</span>
        </div>
      )}
      <div className={css.chips} style={compact ? { marginTop: 0 } : undefined}>
        {chips.map((c, i) => (
          <span key={i} data-last={i === chips.length - 1}>
            {c}
          </span>
        ))}
        {compact && <span style={{ border: 0, paddingLeft: 2 }}>· {b.steps} steps</span>}
      </div>
      {!compact && (
        <div className={css.result}>
          at most ⌊log₂ 32⌋ + 1 = <b>6 steps</b>, for any target
        </div>
      )}
    </Ro>
  );
}

function MergeStrip({ sim }: { sim: BigOSim }) {
  const m = sim.merge;
  if (m.mode === 'split') {
    return (
      <Ro head={`merge sort · n = ${m.n}`}>
        <div className={css.line}>
          levels of halving: <em>{Math.max(0, m.rowsShown - 1)}</em> of log₂ {m.n} = {m.L}
        </div>
      </Ro>
    );
  }
  return (
    <Ro head={`merge sort · n = ${m.n}`}>
      <div className={css.line}>
        {m.level != null ? `level ${m.level}: ${m.levelMoves[m.level] ?? 0}/${m.n} moves · ` : ''}total <em>{m.moves}</em> / {m.n} × {m.L} = {m.n * m.L}
      </div>
    </Ro>
  );
}

function GridReadout({ sim, compact }: { sim: BigOSim; compact: boolean }) {
  const g = sim.grid;
  const n = g.n;
  if (compact) {
    return (
      <Ro head={`nested loops · n = ${n}`}>
        <div className={css.line}>
          <em>{g.k}</em> / {g.total} = n(n−1)/2 · double n → ×4
        </div>
      </Ro>
    );
  }
  const rows = [4, 8, 16].map((m) => ({ m, c: (m * (m - 1)) / 2 }));
  return (
    <Ro head={`nested loops · n = ${n}`}>
      <div className={css.row2}>
        <span>pairs compared</span>
        <span>
          {g.k} / {g.total}
        </span>
      </div>
      <div className={css.row2}>
        <span>n(n − 1)/2</span>
        <span>{g.total}</span>
      </div>
      <div className={css.row2}>
        <span>full grid n²</span>
        <span>{n * n}</span>
      </div>
      <div className={css.result}>
        <div className={css.tbl}>
          <span className={css.tblHead}>n</span>
          <span className={css.tblHead}>pairs</span>
          <span className={css.tblHead}>vs last</span>
          {rows.map((r, i) => (
            <FragmentRow key={r.m} a={String(r.m)} b={commas(r.c)} c={i ? `×${(r.c / rows[i - 1].c).toFixed(1)}` : ''} />
          ))}
          <FragmentRow a="1,000" b="499,500" c="" />
        </div>
      </div>
    </Ro>
  );
}

const FragmentRow = ({ a, b, c }: { a: string; b: string; c: string }) => (
  <>
    <span>{a}</span>
    <span>{b}</span>
    <span className={css.warn}>{c}</span>
  </>
);

function FibReadout({ sim, compact }: { sim: BigOSim; compact: boolean }) {
  const f = sim.fib;
  const hits = f.memo ? f.active.filter((nd) => nd.hit).length : 0;
  if (compact) {
    return (
      <Ro head={`fib(${f.n}) · ${f.memo ? 'memoized' : 'plain recursion'}`}>
        <div className={css.line}>
          calls <em>{f.calls}</em> / {f.active.length} · fib(30): {f.memo ? '59' : '2.7M'} · fib(50): {f.memo ? '99' : '40.7B'}
        </div>
      </Ro>
    );
  }
  const ns = [10, 20, 30, 40, 50];
  return (
    <Ro head={`fib(${f.n}) · ${f.memo ? 'memoized' : 'plain recursion'}`} fresh={sim.vt - f.morphVt < 1.2}>
      <div className={css.row2}>
        <span>calls so far</span>
        <span>
          {f.calls} / {f.active.length}
        </span>
      </div>
      {f.memo ? (
        <div className={css.row2}>
          <Tag c={SIG.res}>cache hits</Tag>
          <span>{hits}</span>
        </div>
      ) : (
        <div className={css.row2}>
          <Tag c={SIG.heavy}>repeats in fib({f.n})</Tag>
          <span>{f.wastedCount}</span>
        </div>
      )}
      <div className={css.result}>
        <div className={css.tbl}>
          <span className={css.tblHead}>n</span>
          <span className={css.tblHead}>plain</span>
          <span className={css.tblHead}>memo</span>
          {ns.map((n) => (
            <FibRow key={n} n={n} memo={f.memo} />
          ))}
        </div>
      </div>
    </Ro>
  );
}

const FibRow = ({ n, memo }: { n: number; memo: boolean }) => (
  <>
    <span>{n}</span>
    <span className={memo ? css.dim : css.warn}>{fmtCountLg(Math.log10(fibCalls(n)))}</span>
    <span className={memo ? css.good : css.dim}>{memoCalls(n)}</span>
  </>
);

function ChartReadout({ sim, compact }: { sim: BigOSim; compact: boolean }) {
  const c = sim.chart;
  const N = Math.round(c.N);
  if (c.mode === 'rules') {
    const r1 = 1 + 100 / N;
    return (
      <Ro head={`at n = ${commas(N)}`}>
        {!compact &&
          c.curves.map((cv) => (
            <div key={cv.id} className={css.row2}>
              <Tag c={cv.color}>{cv.label}</Tag>
              <span>{fmtCountLg(cv.lg(N))}</span>
            </div>
          ))}
        <div className={compact ? undefined : css.result}>
          <div className={css.row2}>
            <span>(n² + 100n) ÷ n²</span>
            <b className={r1 < 1.1 ? css.good : r1 < 2 ? css.warn : css.bad}>{r1 < 10 ? r1.toFixed(r1 < 1.1 ? 3 : 2) : r1.toFixed(0)}×</b>
          </div>
          <div className={css.row2}>
            <span>3n ÷ n</span>
            <b>3×, at every n</b>
          </div>
        </div>
      </Ro>
    );
  }
  const rows = c.curves.map((cv) => ({ cv, lg: cv.lg(N) }));
  if (compact) {
    return (
      <Ro head={`n = ${commas(N)} · 1 ns per step`}>
        <div className={css.stripGrid}>
          {rows.map(({ cv, lg }) => (
            <span key={cv.id}>
              <Tag c={cv.color}>{cv.label}</Tag>
              <b className={lg > 17 ? css.bad : undefined}>{lg > 17 ? 'never' : fmtTimeLg(lg)}</b>
            </span>
          ))}
        </div>
      </Ro>
    );
  }
  return (
    <Ro head={`n = ${commas(N)} · 1 ns per step`}>
      <div className={css.tbl}>
        <span className={css.tblHead}>class</span>
        <span className={css.tblHead}>steps</span>
        <span className={css.tblHead}>time</span>
        {rows.map(({ cv, lg }) => (
          <ChartRow key={cv.id} color={cv.color} label={CLASSES[cv.id as keyof typeof CLASSES]?.big ?? cv.label} steps={fmtCountLg(lg)} time={lg > 17 ? 'never' : fmtTimeLg(lg)} bad={lg > 17} />
        ))}
      </div>
      <div className={css.result}>
        {rows[4] && rows[4].lg > 9 ? (
          <>
            O(n²) needs <b>{fmtTimeLg(rows[4].lg)}</b>; O(n log n) {fmtTimeLg(rows[3].lg)}
          </>
        ) : (
          <span className={css.dim}>drag n up and watch the times</span>
        )}
      </div>
    </Ro>
  );
}

const ChartRow = ({ color, label, steps, time, bad }: { color: string; label: string; steps: string; time: string; bad: boolean }) => (
  <>
    <Tag c={color}>{label}</Tag>
    <span>{steps}</span>
    <span className={bad ? css.bad : undefined}>{time}</span>
  </>
);

/* ------------------------------------------------------------------ */
/* Stage overlay                                                       */
/* ------------------------------------------------------------------ */

export function StageOverlay({ sim, hud = [] }: { sim: BigOSim; hud?: HudKey[] }) {
  const land = sim.orient === 'landscape';
  const v = sim.cfg.view;
  const f = frame(sim);
  let side: ReactNode = null;
  let anchored: ReactNode = null;
  let strip: ReactNode = null;

  if (v === 'race' && sim.race.preset === 'space') {
    if (land) {
      const p = racePanel(sim);
      anchored = (
        <div className={css.anchored} style={{ left: (p.x0 + p.x1) / 2, top: p.y0, width: Math.min(640, p.x1 - p.x0), transform: 'translateX(-50%)' }}>
          <SpaceReadout sim={sim} compact={false} />
        </div>
      );
    } else strip = <SpaceReadout sim={sim} compact />;
  } else if (v === 'scan') {
    if (land) {
      const g = scanGeo(sim, sim.scan.n);
      if (sim.scan.mode === 'search') {
        anchored = (
          <div className={css.anchored} style={{ left: g.reg.x, top: g.reg.y + 66, width: 440, transform: 'translateX(-50%)' }}>
            <ScanReadout sim={sim} compact={false} />
          </div>
        );
      } else {
        anchored = (
          <div className={css.anchored} style={{ left: g.panel.x1 + 44, top: g.panel.y0 + 6, width: 270 }}>
            <ScanReadout sim={sim} compact={false} />
          </div>
        );
      }
    } else strip = <ScanReadout sim={sim} compact />;
  } else if (v === 'binary' && sim.bin.mode === 'array') {
    if (land) {
      const { cells, ch } = binaryCells(sim);
      anchored = (
        <div className={css.anchored} style={{ left: (f.x0 + f.x1) / 2, top: cells[0].y + ch + 106, width: 400, transform: 'translateX(-50%)' }}>
          <BinaryReadout sim={sim} compact={false} />
        </div>
      );
    } else strip = <BinaryReadout sim={sim} compact />;
  } else if (v === 'merge') {
    if (!land) strip = <MergeStrip sim={sim} />;
  } else if (v === 'grid') {
    if (land) side = <GridReadout sim={sim} compact={false} />;
    else strip = <GridReadout sim={sim} compact />;
  } else if (v === 'fib') {
    if (land) side = <FibReadout sim={sim} compact={false} />;
    else strip = <FibReadout sim={sim} compact />;
  } else if (v === 'chart') {
    if (land) side = <ChartReadout sim={sim} compact={false} />;
    else strip = <ChartReadout sim={sim} compact />;
  }

  return (
    <>
      <Hud items={hudItems(sim, hud)} />
      {side && (
        <div className={css.col} style={{ width: 262 }}>
          {side}
        </div>
      )}
      {anchored}
      {strip && <div className={css.strip}>{strip}</div>}
      {v === 'classify' && <ClassifyCode sim={sim} />}
      <Prompts sim={sim} />
    </>
  );
}

/** The snippet under test, larger than the kit's CodeTrace so it reads from across the room. */
function ClassifyCode({ sim }: { sim: BigOSim }) {
  const cl = sim.classify;
  const s = cl.snippet;
  const g = classifyGeo(sim).code;
  const land = sim.orient === 'landscape';
  const [line, text] = s.mark;
  const lines = s.code.split('\n');
  const verdict = cl.verdict;
  return (
    <div key={s.id} className={css.code} style={{ left: g.x, top: g.y, width: g.w }}>
      <div className={css.codeHead}>
        <span className={css.codeDots} aria-hidden>
          <i />
          <i />
          <i />
        </span>
        {s.file}
        {cl.revealed && (
          <span className={css.codeVerdict} style={{ color: CLASSES[s.answer].color }}>
            {verdict === false ? 'answer: ' : ''}
            {CLASSES[s.answer].big}
          </span>
        )}
      </div>
      <pre className={css.codePre} style={land ? undefined : { fontSize: 10.5 }}>
        {lines.map((l, i) => {
          const n = i + 1;
          const on = cl.revealed && n === line;
          return (
            <div key={i} className={css.codeLine} data-active={on}>
              <span className={css.codeNum}>{on ? '▶' : n}</span>
              <span className={css.codeText}>
                {highlightLine(l, 'js')}
                {l === '' ? ' ' : null}
              </span>
              {on && land && <span className={css.codeMark}>{text}</span>}
            </div>
          );
        })}
        {cl.revealed && !land && (
          <div className={css.codeLine}>
            <span className={css.codeNum} />
            <span className={css.codeMark}>
              line {line}: {text}
            </span>
          </div>
        )}
      </pre>
    </div>
  );
}

function Prompts({ sim }: { sim: BigOSim }) {
  const q = sim.game?.pending;
  if (!q?.ask) return null;
  const land = sim.orient === 'landscape';
  const v = sim.cfg.view;
  const f = frame(sim);
  const midX = (f.x0 + f.x1) / 2;
  const fit = (text: string, x: number) => {
    const half = (text.length * (land ? 6.7 : 6.4) + 22) / 2;
    return Math.min(Math.max(x, half + 8), sim.w - half - 8);
  };
  if (v === 'binary') {
    const g = bigGeo(sim);
    return (
      <StagePrompt x={fit(q.ask, midX)} y={g.by - (land ? 58 : 62)}>
        {q.ask}
      </StagePrompt>
    );
  }
  if (v === 'race') {
    const r = sim.race;
    const geos = raceGeo(sim, r.lanes.length);
    if (r.asking && r.asking !== 'both') {
      const idx = r.lanes.findIndex((l) => l.id === r.asking);
      const g = geos[idx];
      if (g) {
        const text = land ? q.ask : q.ask.replace(/ steps at n = (\d+)\. At n = (\d+)\?/, ' at n=$1 → n=$2?');
        // Phones pack the lanes tightly, so the question sits above them all;
        // the asked lane's rail pulses yellow.
        return (
          <StagePrompt x={fit(text, land ? (g.tx0 + g.tx1) / 2 : midX)} y={land ? g.ty - 16 : geos[0].y - 10}>
            {text}
          </StagePrompt>
        );
      }
    }
    const g0 = geos[0];
    return (
      <StagePrompt x={fit(q.ask, midX)} y={(g0?.y ?? f.y0) - (land ? 20 : 14)}>
        {q.ask}
      </StagePrompt>
    );
  }
  if (v === 'classify') {
    const g = classifyGeo(sim);
    return (
      <StagePrompt x={fit(q.ask, midX)} y={g.test.y0 - (land ? 12 : 8)}>
        {q.ask}
      </StagePrompt>
    );
  }
  return (
    <StagePrompt x={fit(q.ask, midX)} y={f.y0}>
      {q.ask}
    </StagePrompt>
  );
}
