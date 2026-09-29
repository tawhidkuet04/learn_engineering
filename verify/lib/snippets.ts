/**
 * Pulls the code snippets out of a lesson's CHAPTERS, exactly as the page
 * renders them, so the tests run the same text the reader sees.
 */
import type { CodeSpec } from '@/components/lesson/CodeBlock';

export interface Found extends CodeSpec {
  /** Id of the step that shows the snippet, if it sits inside one */
  step?: string;
}

/** Every CodeSpec reachable from `root`, including ones passed as JSX props. */
export function collectSnippets(root: unknown): Found[] {
  const out: Found[] = [];
  const seen = new WeakSet<object>();
  const walk = (v: unknown, step: string | undefined) => {
    if (!v || typeof v !== 'object') return;
    if (seen.has(v)) return;
    seen.add(v);
    const o = v as Record<string, unknown>;
    if (typeof o.code === 'string' && typeof o.lang === 'string' && typeof o.title === 'string') {
      out.push({ ...(o as unknown as CodeSpec), step });
    }
    const here = typeof o.id === 'string' && 'body' in o ? o.id : step;
    for (const [k, child] of Object.entries(o)) {
      if (k === '_owner' || k === '_store' || k === '_debugInfo' || k === '_debugStack') continue;
      walk(child, here);
    }
  };
  walk(root, undefined);
  return out;
}

/** The one snippet with this title in this step (throws if missing, so renamed steps fail loudly). */
export function snippet(all: Found[], step: string, title: string): Found {
  const hit = all.filter((s) => s.step === step && s.title === title);
  if (hit.length !== 1) throw new Error(`expected one "${title}" snippet in step "${step}", found ${hit.length}`);
  return hit[0];
}

/** The config text itself: highlight markers removed, outer blank lines trimmed. */
export function plain(code: string): string {
  return code
    .replace(/^\n+|\n+$/g, '')
    .split('\n')
    .map((l) => (l.startsWith('!') ? l.slice(1) : l))
    .join('\n');
}

/**
 * Point the lesson's example addresses at local stand-in servers,
 * e.g. { '10.0.1.11:8080': '127.0.0.1:53121' }.
 */
export function localize(text: string, map: Record<string, string>): string {
  let out = text;
  for (const [from, to] of Object.entries(map)) out = out.replaceAll(from, to);
  return out;
}
