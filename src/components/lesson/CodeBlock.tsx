import type { ReactNode } from 'react';
import css from './lesson.module.css';

export type CodeLang = 'nginx' | 'haproxy' | 'js' | 'conf';

export interface CodeSpec {
  title: string;
  lang: CodeLang;
  /** Lines starting with "!" are highlighted as the lines this step is about. */
  code: string;
  note?: string;
}

const JS_KEYWORDS = /\b(const|let|new|return|function|import|from|await|async|require|export)\b/;

function tokenize(line: string, lang: CodeLang): ReactNode[] {
  const out: ReactNode[] = [];
  const commentAt = lang === 'js' ? line.indexOf('//') : line.indexOf('#');
  const code = commentAt >= 0 ? line.slice(0, commentAt) : line;
  const comment = commentAt >= 0 ? line.slice(commentAt) : '';

  const re = /("[^"]*"|'[^']*'|\b\d[\w.:/]*|[A-Za-z_$][\w$.-]*|[{};()[\]=,])/g;
  let last = 0;
  let first = true;
  for (const m of code.matchAll(re)) {
    const tok = m[0];
    const i = m.index ?? 0;
    if (i > last) out.push(code.slice(last, i));
    let cls = '';
    if (/^["']/.test(tok)) cls = css.tStr;
    else if (/^\d/.test(tok)) cls = css.tNum;
    else if (/^[{};()[\]=,]$/.test(tok)) cls = css.tPunct;
    else if (lang === 'js' ? JS_KEYWORDS.test(tok) : first) cls = css.tKey;
    if (/^[A-Za-z_$]/.test(tok)) first = false;
    out.push(
      <span key={i} className={cls || undefined}>
        {tok}
      </span>,
    );
    last = i + tok.length;
  }
  if (last < code.length) out.push(code.slice(last));
  if (comment) out.push(<span key="c" className={css.tComment}>{comment}</span>);
  return out;
}

export function CodeBlock({ spec }: { spec: CodeSpec }) {
  const lines = spec.code.replace(/^\n+|\n+$/g, '').split('\n');
  return (
    <figure className={css.code}>
      <figcaption className={css.codeHead}>
        <span className={css.codeDots} aria-hidden>
          <i />
          <i />
          <i />
        </span>
        <span>{spec.title}</span>
        <span className={css.codeTag}>in the real world</span>
      </figcaption>
      <pre className={css.pre}>
        {lines.map((raw, i) => {
          const hot = raw.startsWith('!');
          const line = hot ? raw.slice(1) : raw;
          return (
            <div key={i} className={hot ? css.lineHot : css.line}>
              {tokenize(line, spec.lang)}
              {line === '' ? ' ' : null}
            </div>
          );
        })}
      </pre>
      {spec.note && <p className={css.codeNote}>{spec.note}</p>}
    </figure>
  );
}
