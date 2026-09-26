import type { ReactNode } from 'react';
import css from './lesson.module.css';

export type CodeLang = 'nginx' | 'haproxy' | 'js' | 'conf' | 'python' | 'sql' | 'shell' | 'c' | 'http';

export interface CodeSpec {
  title: string;
  lang: CodeLang;
  /** Lines starting with "!" are highlighted as the lines this step is about. */
  code: string;
  note?: string;
}

const KEYWORDS: Partial<Record<CodeLang, RegExp>> = {
  js: /^(const|let|var|new|return|function|import|from|await|async|require|export|if|else|for|while|of|in|class|this|throw|try|catch)$/,
  python: /^(def|return|import|from|if|elif|else|for|while|in|class|with|as|try|except|lambda|None|True|False|and|or|not)$/,
  c: /^(int|char|void|return|if|else|for|while|struct|malloc|free|sizeof|static|const|unsigned|long)$/,
  sql: /^(SELECT|FROM|WHERE|INSERT|INTO|VALUES|UPDATE|SET|DELETE|CREATE|TABLE|INDEX|JOIN|ON|AND|OR|ORDER|BY|LIMIT|GROUP|BEGIN|COMMIT)$/i,
};

/** Languages whose comments start with // (the rest use #). */
const SLASH_COMMENTS: CodeLang[] = ['js', 'c'];

export function highlightLine(line: string, lang: CodeLang): ReactNode[] {
  return tokenize(line, lang);
}

function tokenize(line: string, lang: CodeLang): ReactNode[] {
  const out: ReactNode[] = [];
  const commentAt = SLASH_COMMENTS.includes(lang) ? line.indexOf('//') : lang === 'sql' ? line.indexOf('--') : line.indexOf('#');
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
    else if (KEYWORDS[lang] ? KEYWORDS[lang].test(tok) : first && lang !== 'http') cls = css.tKey;
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
