import type { ReactNode } from 'react';
import VERIFIED from '@/content/verified.json';
import { snippetHash } from '@/lib/snippetHash';
import css from './lesson.module.css';

interface Stamp {
  by: string;
  note: string;
  kind: 'loads' | 'ran';
}

/** What `npm run verify` confirmed about this exact snippet, if anything. */
function stampsFor(code: string): Stamp[] {
  const all = (VERIFIED.snippets as Record<string, Stamp[]>)[snippetHash(code)] ?? [];
  const ran = all.filter((s) => s.kind === 'ran');
  return ran.length ? ran : all;
}

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
  const stamps = stampsFor(spec.code);
  const by = [...new Set(stamps.map((s) => s.by))].join(' & ');
  return (
    <figure className={css.code}>
      <figcaption className={css.codeHead}>
        <span className={css.codeDots} aria-hidden>
          <i />
          <i />
          <i />
        </span>
        <span>{spec.title}</span>
        {by ? (
          <a
            className={css.codeTested}
            href="/tested"
            target="_blank"
            rel="noopener"
            title="This exact snippet was run against the real software by the site's test suite. Click for every check."
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M4.5 12.5l5 5 10-11" />
            </svg>
            tested on {by}
          </a>
        ) : (
          <span className={css.codeTag}>in the real world</span>
        )}
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
      {stamps.length > 0 && (
        <p className={css.codeProof}>
          {stamps.map((s) => (
            <span key={s.note}>{s.note} </span>
          ))}
        </p>
      )}
    </figure>
  );
}
