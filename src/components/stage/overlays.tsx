import type { ReactNode } from 'react';
import type { Sim } from '@/lib/sim/Sim';
import css from './overlay.module.css';
import stage from './stage.module.css';

const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(' ');

/* ------------------------------------------------------------------ */
/* Floating effect texts (sim.say / sim.fx({kind:'text'}))             */
/* ------------------------------------------------------------------ */

export function FxTexts({ sim }: { sim: Sim }) {
  return (
    <>
      {sim
        .effectViews()
        .filter((e) => e.kind === 'text')
        .map((e, i) => {
          const fadeIn = Math.min(1, e.k / 0.12);
          const fadeOut = e.k > 0.7 ? 1 - (e.k - 0.7) / 0.3 : 1;
          return (
            <div key={i} className={stage.fxText} style={{ left: e.x, top: e.y - e.k * 14, color: e.color, opacity: fadeIn * fadeOut }}>
              {e.text}
            </div>
          );
        })}
    </>
  );
}

/** The yellow, bobbing "your turn" pill, e.g. "Which server gets it?". */
export function StagePrompt({ x, y, children }: { x: number; y: number; children: ReactNode }) {
  return (
    <div className={stage.prompt} style={{ left: x, top: y }}>
      {children}
    </div>
  );
}

/** A small yellow tag that glides between positions (e.g. "VIP 203.0.113.10"). */
export function Badge({ x, y, children }: { x: number; y: number; children: ReactNode }) {
  return (
    <div className={stage.badge} style={{ left: x, top: y }}>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Readout: a panel that shows a component's internal state            */
/* ------------------------------------------------------------------ */

export function Readout({
  x = 0,
  y = 0,
  anchor = 'below',
  head,
  fresh,
  width,
  children,
}: {
  x?: number;
  y?: number;
  /** below/above: centered on x; right/left: beside the point; strip: docked to the stage bottom (mobile) */
  anchor?: 'below' | 'above' | 'right' | 'left' | 'strip';
  head: string;
  /** Briefly brighten the border (a decision just happened) */
  fresh?: boolean;
  width?: number;
  children: ReactNode;
}) {
  const cls =
    anchor === 'below'
      ? css.readoutBelow
      : anchor === 'above'
        ? css.readoutAbove
        : anchor === 'right'
          ? css.readoutRight
          : anchor === 'left'
            ? css.readoutLeft
            : css.readoutStrip;
  return (
    <div className={cx(css.readout, cls, fresh && css.readoutFresh)} style={anchor === 'strip' ? undefined : { left: x, top: y, width }}>
      <div className={css.readoutHead}>{head}</div>
      {children}
    </div>
  );
}

/** Label · bar of n squares · value, in a readout. */
export function RRow({ label, n, value, good }: { label: string; n: number; value?: ReactNode; good?: boolean }) {
  return (
    <span className={css.row}>
      <span className={cx(css.rowLabel, good && css.rowMin)}>{label}</span>
      <span className={cx(css.bar, good && css.min)}>
        {Array.from({ length: Math.max(0, Math.min(n, 12)) }, (_, i) => (
          <i key={i} />
        ))}
      </span>
      <span className={css.num}>{value ?? n}</span>
    </span>
  );
}

export function RRows({ children }: { children: ReactNode }) {
  return <div className={css.rows}>{children}</div>;
}

/** Row of chips; mark one as "next" (violet) or "last". */
export function RChips({ items }: { items: { label: string; mark?: 'next' | 'last' }[] }) {
  return (
    <div className={cx(css.chips, items.some((i) => i.mark) && css.chipsSpaced)}>
      {items.map((it, i) => (
        <span key={i} className={cx(css.chip, it.mark === 'next' && css.chipNext, it.mark === 'last' && css.chipLast)}>
          {it.label}
        </span>
      ))}
    </div>
  );
}

/** A monospace line; wrap parts in <em> to highlight them in yellow. */
export function RLine({ children, dim }: { children: ReactNode; dim?: boolean }) {
  return <div className={dim ? css.dim : css.formula}>{children}</div>;
}

/** The conclusion line under a dashed rule; wrap the answer in <b>. */
export function RResult({ children }: { children: ReactNode }) {
  return <div className={css.result}>{children}</div>;
}

/* ------------------------------------------------------------------ */
/* Inspector card: shows what's inside a packet or a component         */
/* ------------------------------------------------------------------ */

export type InspectorLine = string | 'rule' | { t: string; kind?: 'add' | 'change' | 'bad' | 'dim' | 'strong' };

export function InspectorCard({
  x,
  y,
  stageW,
  head,
  lines,
  tone = 'req',
  note,
  progress,
}: {
  /** Point the card hangs from (usually a packet or node) */
  x: number;
  y: number;
  stageW: number;
  head: string;
  lines: InspectorLine[];
  tone?: 'req' | 'res' | 'err';
  note?: ReactNode;
  /** Optional 0..1 progress bar (e.g. server work) */
  progress?: number;
}) {
  const cxp = Math.min(Math.max(x, 140), stageW - 140);
  const below = y < 230;
  return (
    <div className={cx(css.inspect, tone === 'res' && css.inspectRes, tone === 'err' && css.inspectErr, below && css.inspectBelow)} style={{ left: cxp, top: y }}>
      <div className={css.inspectHead}>{head}</div>
      <div className={css.inspectBody}>
        {lines.map((l, i) => {
          if (l === 'rule') return <div key={i} className={css.inspectRule} />;
          const line = typeof l === 'string' ? { t: l } : l;
          const mark = line.kind === 'add' ? '+ ' : line.kind === 'change' ? '~ ' : line.kind === 'bad' ? '! ' : '  ';
          return (
            <div
              key={i}
              className={cx(
                css.inspectLine,
                line.kind === 'add' && css.lineAdd,
                line.kind === 'change' && css.lineChange,
                line.kind === 'bad' && css.lineBad,
                line.kind === 'dim' && css.lineDim,
                line.kind === 'strong' && css.lineStrong,
              )}
            >
              {mark}
              {line.t}
            </div>
          );
        })}
        {progress != null && (
          <div className={css.progress}>
            <i style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        )}
        {note && <div className={css.inspectNote}>{note}</div>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Markup callouts: a yellow leader line from a target to a note       */
/* ------------------------------------------------------------------ */

export interface Callout {
  /** A box id, or anything your `resolve` function understands */
  target: string;
  text: ReactNode;
  dir?: 'up' | 'down' | 'left' | 'right';
}

type Rect = { x: number; y: number; w: number; h: number };

function place(r: Rect, dir: NonNullable<Callout['dir']>, W: number, H: number) {
  const gap = 46;
  let ax = r.x;
  let ay = r.y;
  if (dir === 'up') ay = r.y - r.h / 2 - 4;
  if (dir === 'down') ay = r.y + r.h / 2 + 4;
  if (dir === 'left') ax = r.x - r.w / 2 - 4;
  if (dir === 'right') ax = r.x + r.w / 2 + 4;
  let bx = ax + (dir === 'left' ? -gap : dir === 'right' ? gap : 0);
  let by = ay + (dir === 'up' ? -gap : dir === 'down' ? gap : 0);
  if (dir === 'up' || dir === 'down') bx = Math.min(Math.max(bx, 118), W - 118);
  if (dir === 'left') bx = Math.max(bx, 226);
  if (dir === 'right') bx = Math.min(bx, W - 226);
  by = Math.min(Math.max(by, 40), H - 40);
  return { ax, ay, bx, by };
}

export function Callouts({
  sim,
  callouts = [],
  stepKey,
  resolve,
}: {
  sim: Sim;
  callouts?: Callout[];
  stepKey: string;
  /** Map a target to a rectangle (center x/y + size). Defaults to sim boxes by id. */
  resolve?: (target: string) => Rect | null;
}) {
  const items = callouts
    .map((c, i) => {
      const r = resolve?.(c.target) ?? (() => {
        const b = sim.boxes.get(c.target);
        return b && !Number.isNaN(b.x) ? { x: b.x, y: b.y, w: b.w, h: b.h } : null;
      })();
      if (!r) return null;
      const dir = c.dir ?? 'up';
      return { c, i, dir, ...place(r, dir, sim.w, sim.h) };
    })
    .filter((x): x is NonNullable<typeof x> => !!x);
  if (!items.length) return null;
  return (
    <>
      <svg className={css.calloutSvg} width={sim.w} height={sim.h} aria-hidden>
        {items.map((it) => (
          <g key={`${stepKey}-${it.i}`}>
            <path className={css.leader} pathLength={1} d={`M${it.ax},${it.ay} L${it.bx},${it.by}`} style={{ animationDelay: `${it.i * 160}ms` }} />
            <circle className={css.leaderDot} cx={it.ax} cy={it.ay} r={3.2} style={{ animationDelay: `${it.i * 160}ms` }} />
          </g>
        ))}
      </svg>
      {items.map((it) => {
        const t =
          it.dir === 'up' ? 'translate(-50%, -100%)' : it.dir === 'down' ? 'translate(-50%, 0)' : it.dir === 'left' ? 'translate(-100%, -50%)' : 'translate(0, -50%)';
        return (
          <div key={`${stepKey}-${it.i}`} className={css.callout} style={{ left: it.bx, top: it.by, transform: t, animationDelay: `${180 + it.i * 160}ms` }}>
            {it.c.text}
          </div>
        );
      })}
    </>
  );
}
