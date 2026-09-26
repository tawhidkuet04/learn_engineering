import { highlightLine, type CodeLang } from '@/components/lesson/CodeBlock';
import css from './codetrace.module.css';

/**
 * Source code on the stage with the line being executed highlighted,
 * for lessons that step through a program (event loop, stack vs heap…).
 * Line numbers are 1-based.
 */
export function CodeTrace({
  x,
  y,
  w,
  title,
  code,
  lang = 'js',
  active,
  done = [],
  marks = {},
  maxH,
}: {
  x: number;
  y: number;
  w: number;
  title?: string;
  code: string;
  lang?: CodeLang;
  /** Line currently executing */
  active?: number | null;
  /** Lines already executed (dimmed check) */
  done?: number[];
  /** Short annotations shown at the end of a line, e.g. { 3: 'x = 2' } */
  marks?: Record<number, string>;
  maxH?: number;
}) {
  const lines = code.replace(/^\n+|\n+$/g, '').split('\n');
  return (
    <div className={css.trace} style={{ left: x, top: y, width: w, maxHeight: maxH }}>
      {title && (
        <div className={css.head}>
          <span className={css.dots} aria-hidden>
            <i />
            <i />
            <i />
          </span>
          {title}
        </div>
      )}
      <pre className={css.pre}>
        {lines.map((line, i) => {
          const n = i + 1;
          const state = n === active ? 'active' : done.includes(n) ? 'done' : undefined;
          return (
            <div key={i} className={css.line} data-state={state}>
              <span className={css.num}>{n === active ? '▶' : n}</span>
              <span className={css.code}>
                {highlightLine(line, lang)}
                {line === '' ? ' ' : null}
              </span>
              {marks[n] && <span className={css.mark}>{marks[n]}</span>}
            </div>
          );
        })}
      </pre>
    </div>
  );
}
