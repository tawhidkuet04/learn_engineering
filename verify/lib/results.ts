/**
 * Every test file writes what it measured to verify/results/<name>.json.
 * When the run ends, global.ts merges those files into
 * src/content/verified.json (the badges on code snippets) and verify/REPORT.md.
 *
 * Entries are kept per test: when a test starts, its old entries are removed,
 * so a test that now fails can't leave a stale badge behind, and running a
 * single test (`-t`) leaves the other tests' results alone.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach } from 'vitest';
import { snippetHash } from '@/lib/snippetHash';

export const RESULTS_DIR = path.resolve(import.meta.dirname, '..', 'results');

export interface Check {
  /** Lesson slug */
  lesson: string;
  /** Step id inside the lesson, when the check is about one step */
  step?: string;
  /** What was checked, in plain words */
  title: string;
  /** The real software, with version, e.g. "HAProxy 3.4.6" */
  software: string;
  /** What the real software did */
  real: string;
  /** What the lesson's animation or text says */
  lesson_says?: string;
  pass: boolean;
  /** Filled in automatically: the test that made this entry */
  test?: string;
}

export interface Stamp {
  hash: string;
  lesson: string;
  /** e.g. "nginx 1.31.6" */
  by: string;
  /** One sentence shown under the snippet */
  note: string;
  /** loads: the program accepted it. ran: we ran a scenario with it and it behaved as the lesson says. */
  kind: 'loads' | 'ran';
  test?: string;
}

export interface ResultFile {
  file: string;
  checks: Check[];
  stamps: Stamp[];
}

interface TaskLike {
  name: string;
  suite?: TaskLike;
}

function fullName(task: TaskLike): string {
  const parts: string[] = [];
  for (let t: TaskLike | undefined = task; t; t = t.suite) if (t.name) parts.unshift(t.name);
  return parts.join(' > ');
}

/**
 * This test file's results. Call `check` for every comparison, and `stamp`
 * only once a snippet has actually been run and behaved as the lesson says.
 */
export function results(name: string) {
  mkdirSync(RESULTS_DIR, { recursive: true });
  const target = path.join(RESULTS_DIR, `${name}.json`);
  const out: ResultFile = existsSync(target) ? JSON.parse(readFileSync(target, 'utf8')) : { file: name, checks: [], stamps: [] };
  const flush = () => {
    // Atomic, so a run of another test file never reads half a file.
    const tmp = `${target}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(out, null, 2)}\n`);
    renameSync(tmp, target);
  };
  let current = '(outside a test)';

  beforeEach(({ task }) => {
    current = fullName(task as TaskLike);
    out.checks = out.checks.filter((c) => c.test !== current);
    out.stamps = out.stamps.filter((s) => s.test !== current);
    flush();
  });

  return {
    check(c: Check) {
      out.checks.push({ ...c, test: current });
      flush();
    },
    stamp(code: string, s: Omit<Stamp, 'hash' | 'test'>) {
      const hash = snippetHash(code);
      if (!out.stamps.some((x) => x.hash === hash && x.by === s.by && x.note === s.note)) out.stamps.push({ hash, ...s, test: current });
      flush();
    },
  };
}

/** Seconds, rounded for reports. */
export const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
