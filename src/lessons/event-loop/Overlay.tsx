'use client';

import type { CSSProperties } from 'react';
import { highlightLine } from '@/components/lesson/CodeBlock';
import { RLine, Readout } from '@/components/stage/overlays';
import { SIG } from '@/lib/sim/colors';
import { clamp } from '@/lib/sim/geometry';
import type { OutLine } from './engine';
import { rectOf } from './Scene';
import { CODE_METRICS, PAGE_LAYOUT, type EventLoopSim } from './sim';
import type { ThreadMode } from './thread';
import css from './el.module.css';

const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(' ');

/* ------------------------------------------------------------------ */
/* code pane: the source with the executing line highlighted           */
/* ------------------------------------------------------------------ */

export function CodePane({
  sim,
  id = 'code',
  title,
  code,
  active,
  marks = {},
  pending = {},
  hot = [],
  tag = 'running',
}: {
  sim: EventLoopSim;
  id?: string;
  title: string;
  code: string;
  active?: number | null;
  marks?: Record<number, string>;
  pending?: Record<number, string>;
  hot?: number[];
  tag?: string;
}) {
  const r = rectOf(sim, id);
  if (!r) return null;
  const compact = sim.orient === 'portrait';
  const cm = compact ? CODE_METRICS.portrait : CODE_METRICS.landscape;
  const lines = code.split('\n');
  const visible = Math.max(1, Math.floor((r.h - cm.head - cm.pad) / cm.line));
  const focusLine = active ?? hot[0] ?? 1;
  const offset = lines.length > visible ? clamp((focusLine - 1 - Math.floor((visible - 1) / 2)) * cm.line, 0, (lines.length - visible) * cm.line) : 0;
  return (
    <div className={cx(css.code, compact && css.compact)} style={{ left: r.x, top: r.y, width: r.w, height: r.h, opacity: r.a }}>
      <div className={css.codeHead}>
        <span className={css.dots} aria-hidden>
          <i />
          <i />
          <i />
        </span>
        {title}
        <span>{tag}</span>
      </div>
      <div className={css.codeBody} style={{ height: r.h - cm.head }}>
        <pre className={css.codePre} style={{ transform: `translateY(${-offset}px)` }}>
          {lines.map((line, i) => {
            const n = i + 1;
            const state = n === active ? 'active' : hot.includes(n) ? 'hot' : undefined;
            return (
              <div key={i} className={css.codeLine} data-state={state}>
                <span className={css.num}>
                  {pending[n] && <i className={css.pend} style={{ color: pending[n] }} />}
                  {n === active ? '▶' : n}
                </span>
                <span className={css.src}>
                  {highlightLine(line, 'js')}
                  {line === '' ? ' ' : null}
                </span>
                {marks[n] && (
                  <span key={marks[n]} className={css.mark}>
                    {marks[n]}
                  </span>
                )}
              </div>
            );
          })}
        </pre>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* console                                                             */
/* ------------------------------------------------------------------ */

const TAG: Record<OutLine['src'], { label: string; color: string }> = {
  script: { label: 'script', color: SIG.text2 },
  task: { label: 'task', color: SIG.req },
  timer: { label: 'timer', color: SIG.req },
  micro: { label: 'microtask', color: SIG.hc },
  raf: { label: 'rAF', color: SIG.res },
  io: { label: 'I/O', color: SIG.teal },
  immediate: { label: 'check', color: SIG.pink },
};

export function ConsolePane({ sim }: { sim: EventLoopSim }) {
  const r = rectOf(sim, 'console');
  if (!r) return null;
  const m = sim.m;
  const compact = sim.orient === 'portrait';
  const lh = compact ? 17 : 21;
  const head = compact ? 20 : 26;
  const cap = compact ? 12 : Math.max(1, Math.floor((r.h - head - 10) / lh));
  const landed = m.out.filter((o) => sim.t - o.t > 0.34);
  const shown = landed.slice(-cap);
  const q = sim.game?.pending;
  const asking = !!q?.choices && sim.cfg.predict === 'order';
  const newest = landed[landed.length - 1];
  return (
    <div className={cx(css.console, compact && css.compactCon)} style={{ left: r.x, top: r.y, width: r.w, height: r.h, opacity: r.a }}>
      <div className={css.conHead}>
        <b>console</b>
        <span>{landed.length ? `${landed.length} line${landed.length === 1 ? '' : 's'}` : ''}</span>
      </div>
      {asking && q?.choices ? (
        <div className={css.chooser}>
          <div className={css.chooserQ}>{q.ask}</div>
          <div className={css.chooserRow}>
            {q.choices.map((c) => (
              <button key={c.id} type="button" className={css.choice} onClick={() => sim.game?.answer(c.id)}>
                {c.label}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className={compact ? css.conChips : css.conBody}>
          {shown.length === 0 && <div className={css.conEmpty}>{m.prog ? 'nothing printed yet' : ''}</div>}
          {shown.map((o, i) => {
            const k = clamp((sim.t - o.t - 0.34) / 0.25, 0, 1);
            const fresh = o === newest ? clamp(1 - (sim.t - o.t - 0.34) / 1.2, 0, 1) : 0;
            const tag = TAG[o.src];
            const key = `${m.out.indexOf(o)}-${i}`;
            if (compact) {
              return (
                <span key={key} className={css.conChip} style={{ opacity: k, borderColor: tag.color, background: fresh > 0 ? `rgba(255,210,63,${0.14 * fresh})` : undefined }}>
                  <i style={{ background: tag.color }} />
                  {o.text}
                </span>
              );
            }
            const style: CSSProperties = { opacity: k, background: fresh > 0 ? `rgba(255,210,63,${0.1 * fresh})` : undefined };
            return (
              <div key={key} className={css.conLine} style={style}>
                <i>›</i>
                <span className={css.conText}>{o.text}</span>
                <span className={css.tag} style={{ color: tag.color }}>
                  {tag.label}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* the page mock (blocking chapter): what the user actually sees       */
/* ------------------------------------------------------------------ */

function Spinner({ angle, size }: { angle: number; size: number }) {
  const r = size / 2 - 5;
  const a1 = (270 * Math.PI) / 180;
  return (
    <svg width={size} height={size} viewBox={`${-size / 2} ${-size / 2} ${size} ${size}`} aria-hidden>
      <circle r={r} fill="none" stroke="rgba(143,166,201,0.16)" strokeWidth={4} />
      <path
        d={`M${r},0 A${r},${r} 0 1 1 ${(r * Math.cos(a1)).toFixed(2)},${(r * Math.sin(a1)).toFixed(2)}`}
        fill="none"
        stroke={SIG.req}
        strokeWidth={4}
        strokeLinecap="round"
        transform={`rotate(${angle.toFixed(1)})`}
      />
    </svg>
  );
}

export function PageMock({ sim }: { sim: EventLoopSim }) {
  const r = rectOf(sim, 'page');
  if (!r) return null;
  const th = sim.th;
  const p = th.painted;
  const L = sim.orient === 'landscape';
  const pl = L ? PAGE_LAYOUT.landscape : PAGE_LAYOUT.portrait;
  const fps = th.slots.filter((s) => s.t > th.ms - 1000 && s.state === 'painted').length;
  const frozen = th.ms > 1000 && fps < 20;
  const pct = Math.round(p.progress * 100);
  return (
    <div className={css.page} style={{ left: r.x, top: r.y, width: r.w, height: r.h, opacity: r.a }}>
      <div className={css.pageBar} style={{ height: pl.bar }}>
        <span className={css.dots} aria-hidden>
          <i />
          <i />
          <i />
        </span>
        <span className={css.url}>shop.example/orders</span>
        <span className={css.fps}>
          <b style={{ color: frozen ? SIG.err : SIG.res }}>{fps}</b> fps
        </span>
      </div>
      <div className={css.pageTitle} style={{ left: pl.spinner.x, top: pl.spinner.y }}>
        <Spinner angle={p.spin} size={pl.spinner.s} />
        <div>
          <strong style={L ? undefined : { fontSize: 13 }}>Orders</strong>
          <small style={L ? undefined : { fontSize: 11 }}>3,000 to process · {p.status}</small>
        </div>
      </div>
      <button
        type="button"
        className={cx(css.pbtn, css.pbtnHot)}
        style={{ left: pl.proc.x, top: pl.proc.y, width: pl.proc.w, height: pl.proc.h, fontSize: L ? 13.5 : 12.5 }}
        onClick={() => sim.pressProcess()}
        disabled={th.job.active}
      >
        Process orders
      </button>
      <div className={css.bar} style={{ left: pl.progress.x, top: pl.progress.y, width: r.w - pl.progress.x - pl.progress.right }}>
        <i style={{ width: `${pct}%` }} />
      </div>
      <span className={css.barLabel} style={{ left: r.w - pl.progress.right + 8, top: pl.progress.y - 5 }}>
        {pct}%
      </span>
      <button
        type="button"
        className={css.pbtn}
        style={{ left: pl.cart.x, top: pl.cart.y, width: pl.cart.w, height: pl.cart.h, fontSize: L ? 13.5 : 12.5 }}
        onClick={() => sim.pressCart()}
      >
        Add to cart
      </button>
      <span className={css.cartCount} style={{ left: pl.count.x, top: pl.count.y }}>
        cart <b>{p.cart}</b>
      </span>
      <span className={cx(css.seen, frozen && css.frozen)}>{frozen ? 'screen frozen' : 'what the user sees'}</span>
    </div>
  );
}

/** Which code the page is running, per strategy. */
export const PAGE_CODE: Record<ThreadMode, { code: string; hot: number[] }> = {
  long: {
    code: `processBtn.addEventListener('click', () => {
  for (const order of orders) {
    process(order);         // ~0.5 ms each
  }
  status.textContent = 'Done';
});
cartBtn.addEventListener('click', addToCart);`,
    hot: [2, 3, 4],
  },
  chunk: {
    code: `processBtn.addEventListener('click', async () => {
  let last = performance.now();
  for (const order of orders) {
    process(order);
    if (performance.now() - last < 12) continue;
    await new Promise((r) => setTimeout(r));  // a task
    last = performance.now();
  }
});`,
    hot: [5, 6],
  },
  micro: {
    code: `processBtn.addEventListener('click', async () => {
  let last = performance.now();
  for (const order of orders) {
    process(order);
    if (performance.now() - last < 12) continue;
    await Promise.resolve();  // a microtask!
    last = performance.now();
  }
});`,
    hot: [5, 6],
  },
  worker: {
    code: `const worker = new Worker('orders-worker.js');
processBtn.addEventListener('click', () => {
  worker.postMessage(orders);   // copy, don't wait
});
worker.onmessage = (e) => {     // a task per message
  if (e.data.done) status.textContent = 'Done';
  else bar.value = e.data.progress;
};`,
    hot: [3, 5],
  },
};

export function ThreadReadout({ sim }: { sim: EventLoopSim }) {
  const th = sim.th;
  const tl = rectOf(sim, 'timeline');
  if (!tl) return null;
  const L = sim.orient === 'landscape';
  const run = th.running;
  const tasks = th.tasks;
  const short = (s: string) => s.replace('click → ', '').replace('timeout → ', '').replace('message → ', 'msg: ');
  const counts = new Map<string, number>();
  for (const t of tasks) counts.set(short(t.label), (counts.get(short(t.label)) ?? 0) + 1);
  const list = [...counts.entries()].map(([k, n]) => (n > 1 ? `${k} ×${n}` : k)).join(' · ');
  const span = th.currentSpan;
  return (
    <Readout x={tl.x + 136} y={tl.y + tl.h + 12} anchor={L ? 'below' : 'strip'} head="main thread" width={L ? 272 : undefined}>
      <RLine>
        {run && run.kind !== 'render' ? (
          <>
            running <em>{short(run.label)}</em> {span > 1 ? `· ${Math.round(span)} ms` : ''}
          </>
        ) : run ? (
          <>rendering a frame</>
        ) : (
          <>idle, free to respond</>
        )}
      </RLine>
      <RLine dim>task queue: {list || 'empty'}</RLine>
      {(th.mode === 'micro' || th.micro.length > 0) && <RLine dim>microtasks: {th.micro.length}</RLine>}
    </Readout>
  );
}
