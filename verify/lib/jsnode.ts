/**
 * Runs JavaScript in real Node.js child processes, using the same node binary
 * that runs the tests, so every run starts from a fresh event loop.
 */
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const NODE_VERSION = process.versions.node;
export const NODE = `Node ${NODE_VERSION}`;

export interface NodeRun {
  stdout: string;
  stderr: string;
  /** stdout split into lines, trailing blank line removed */
  lines: string[];
  ms: number;
  code: number;
}

/** Write `files` into a fresh temp dir and run `main` there with node. */
export function nodeRun(files: Record<string, string>, main: string, opts: { args?: string[]; timeout?: number; env?: Record<string, string> } = {}): Promise<NodeRun> {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'verify-js-'));
  for (const [name, text] of Object.entries(files)) writeFileSync(path.join(dir, name), text);
  const t0 = performance.now();
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [...(opts.args ?? []), main],
      { cwd: dir, timeout: opts.timeout ?? 60_000, env: { ...process.env, ...opts.env }, maxBuffer: 64 * 1024 * 1024 },
      (err, stdout, stderr) => {
        rmSync(dir, { recursive: true, force: true });
        const code = err ? (typeof err.code === 'number' ? err.code : 1) : 0;
        resolve({ stdout, stderr, lines: stdout.replace(/\n$/, '').split('\n'), ms: performance.now() - t0, code });
      },
    );
  });
}

/** Run one file's code as `name` (the extension picks CommonJS or ES module). */
export const nodeCode = (code: string, name = 'main.cjs', opts?: Parameters<typeof nodeRun>[2]) => nodeRun({ [name]: code }, name, opts);

/** Run a program `n` times, `parallel` at once, and count how often each output appeared. */
export async function nodeTally(code: string, n: number, name = 'main.cjs', parallel = 12): Promise<Record<string, number>> {
  const tally: Record<string, number> = {};
  for (let done = 0; done < n; done += parallel) {
    const runs = await Promise.all(Array.from({ length: Math.min(parallel, n - done) }, () => nodeCode(code, name)));
    for (const r of runs) {
      const key = r.code === 0 ? r.lines.join(' | ') : `exit ${r.code}: ${r.stderr.split('\n')[0]}`;
      tally[key] = (tally[key] ?? 0) + 1;
    }
  }
  return tally;
}

/** "a | b ×3, c | d ×1" */
export const fmtTally = (t: Record<string, number>) =>
  Object.entries(t)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ×${v}`)
    .join('; ');
