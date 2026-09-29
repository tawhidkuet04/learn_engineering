/**
 * nginx helpers for the CDN, TLS, HTTP versions, WebSockets, Life of a
 * request, Processes & threads and Consistent hashing lessons.
 *
 * `prepareNginx` follows the same rules as `nginxHttp` in confs.ts (every
 * change is mechanical and listed in `changes`) and adds the few that those
 * snippets need:
 * - http-level blocks (`upstream`, `proxy_cache_path`, …) stay at http level
 *   when a fragment's `location`s get wrapped in a `server {}`,
 * - each `listen` port can map to its own local port (80 and 443 side by side),
 * - a fragment can be placed inside the server block the lesson showed for it,
 * - cache directories move to a temporary directory,
 * - `memcached_pass` targets get stub upstreams like `proxy_pass` ones.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { testCert, type Prepared } from './confs';
import { sleep, tmpDir, waitForPort } from './procs';
import { plain } from './snippets';

/* ------------------------------------------------------------------ */
/* Config text                                                         */
/* ------------------------------------------------------------------ */

export interface Statement {
  /** The statement as written, with any comment lines just above it */
  text: string;
  /** Its directive name, e.g. "upstream", "location", "keepalive_timeout" */
  name: string;
  block: boolean;
}

/** Top-level statements of an nginx config text (quotes and comments respected). */
export function statements(text: string): Statement[] {
  const out: Statement[] = [];
  let depth = 0;
  let quote: string | null = null;
  let comment = false;
  let start = 0;
  const push = (end: number, block: boolean) => {
    const chunk = text.slice(start, end);
    start = end;
    const name = chunk.replace(/^(\s*#[^\n]*\n|\s+)*/, '').match(/^[\w.-]+/)?.[0] ?? '';
    out.push({ text: chunk.replace(/^\s*\n/, '').replace(/\s+$/, ''), name, block });
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (comment) {
      if (ch === '\n') comment = false;
      continue;
    }
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '#') comment = true;
    else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) push(i + 1, true);
    } else if (ch === ';' && depth === 0) push(i + 1, false);
  }
  return out;
}

/** Directives that live in the http block, not in a server. */
const HTTP_LEVEL = new Set(['upstream', 'proxy_cache_path', 'map', 'geo', 'split_clients', 'limit_req_zone', 'limit_conn_zone', 'log_format', 'server']);

export interface PrepareOpts {
  /** Local port for every `listen`, or one per port the snippet uses: { 80: 18080, 443: 18443 } */
  port: number | Record<number, number>;
  /** Example addresses to local ones, e.g. { '10.0.1.11:8080': '127.0.0.1:53121' } */
  addresses?: Record<string, string>;
  /** Addresses for upstream names the snippet uses but doesn't define (default: a closed port) */
  upstreams?: Record<string, string>;
  /** A fragment's own server block, as the lesson showed it: the fragment goes inside it */
  inside?: string;
  /** http-level statements the snippet relies on, shown elsewhere in the lesson */
  context?: string[];
}

/** A lesson's nginx snippet as an `http {}` body nginx can load. */
export function prepareNginx(code: string, opts: PrepareOpts): Prepared {
  const changes: string[] = [];
  const localize = (text: string) => {
    let t = text;
    for (const [from, to] of Object.entries(opts.addresses ?? {})) {
      if (t.includes(from)) {
        t = t.replaceAll(from, to);
        changes.push(`${from} → ${to}`);
      }
    }
    return t;
  };

  const parts = statements(localize(plain(code)));
  const httpLevel = parts.filter((s) => HTTP_LEVEL.has(s.name));
  const serverLevel = parts.filter((s) => !HTTP_LEVEL.has(s.name));
  const body: string[] = [...(opts.context ?? []), ...httpLevel.map((s) => s.text)];
  if (opts.context?.length) changes.push(`added ${opts.context.length} http-level line(s) the snippet relies on`);
  if (serverLevel.length) {
    const inner = serverLevel.map((s) => s.text.replace(/^/gm, '    ')).join('\n');
    if (opts.inside) {
      const host = localize(plain(opts.inside)).replace(/\}\s*$/, '');
      body.push(`${host}\n${inner}\n}`);
      changes.push('placed inside the server block the lesson shows for it');
    } else {
      const first = typeof opts.port === 'number' ? opts.port : Object.values(opts.port)[0];
      body.push(`server {\n    listen 127.0.0.1:${first};\n${inner}\n}`);
      changes.push('wrapped in server {}');
    }
  }
  let text = body.join('\n\n');

  text = text.replace(/listen\s+(?:[\d.]+:)?(\d+)([^;]*);/g, (_m, p: string, rest: string) => {
    const to = typeof opts.port === 'number' ? opts.port : opts.port[Number(p)];
    if (to == null) throw new Error(`no local port given for "listen ${p}"`);
    changes.push(`listen ${p} → 127.0.0.1:${to}`);
    return `listen 127.0.0.1:${to}${rest};`;
  });

  const c = testCert();
  text = text.replace(/(ssl_certificate(?:_key)?)\s+([^;\s]+);/g, (_m, dir: string, file: string) => {
    changes.push(`${file} → test certificate`);
    return `${dir} ${dir.endsWith('_key') ? c.key : c.crt};`;
  });

  text = text.replace(/proxy_cache_path\s+(\S+)/g, (_m, dir: string) => {
    const local = tmpDir('cache');
    changes.push(`${dir} → ${local}`);
    return `proxy_cache_path ${local}`;
  });

  const defined = new Set([...text.matchAll(/upstream\s+([\w.-]+)\s*\{/g)].map((m) => m[1]));
  const used = new Set([...text.matchAll(/(?:proxy_pass\s+https?:\/\/|memcached_pass\s+)([\w.-]+)[;/]/g)].map((m) => m[1]).filter((n) => !/^[\d.]+$/.test(n)));
  for (const name of used) {
    if (defined.has(name)) continue;
    text = `upstream ${name} { server ${opts.upstreams?.[name] ?? '127.0.0.1:9'}; }\n${text}`;
    changes.push(`stub upstream ${name}`);
  }
  return { text, changes };
}

/* ------------------------------------------------------------------ */
/* Whole configs (for snippets that set main-context directives)       */
/* ------------------------------------------------------------------ */

export interface NginxProc {
  child: ChildProcess;
  dir: string;
  stop: () => Promise<void>;
  errorLog: () => string;
}

/**
 * Run nginx with the snippet's main-context lines (worker_processes, events)
 * as they are, plus an http block. Only paths for logs and temp files are added.
 */
export async function startNginxMain(main: string, httpBody: string, port: number): Promise<NginxProc> {
  const dir = tmpDir('nginx-main');
  for (const d of ['body', 'proxy', 'fastcgi', 'uwsgi', 'scgi']) mkdirSync(path.join(dir, d), { recursive: true });
  const file = path.join(dir, 'nginx.conf');
  writeFileSync(
    file,
    `${plain(main)}
error_log ${dir}/error.log info;
pid ${dir}/nginx.pid;
http {
  access_log off;
  client_body_temp_path ${dir}/body;
  proxy_temp_path ${dir}/proxy;
  fastcgi_temp_path ${dir}/fastcgi;
  uwsgi_temp_path ${dir}/uwsgi;
  scgi_temp_path ${dir}/scgi;
${httpBody}
}
`,
  );
  const test = spawnSync('nginx', ['-t', '-p', dir, '-c', file], { encoding: 'utf8' });
  if (test.status !== 0) throw new Error(`nginx rejected the config:\n${test.stderr}\n---\n${readFileSync(file, 'utf8')}`);
  const child = spawn('nginx', ['-p', dir, '-c', file, '-g', 'daemon off;'], { stdio: 'ignore' });
  const stop = () =>
    new Promise<void>((resolve) => {
      if (child.exitCode != null) return resolve();
      child.once('exit', () => resolve());
      child.kill('SIGTERM');
      setTimeout(() => child.exitCode == null && child.kill('SIGKILL'), 3000);
    });
  await waitForPort(port);
  return { child, dir, stop, errorLog: () => readFileSync(path.join(dir, 'error.log'), 'utf8') };
}

/** `nginx -t` on main-context lines plus an http body. */
export function nginxCheckMain(main: string, httpBody: string) {
  const dir = tmpDir('nginx-t');
  for (const d of ['body', 'proxy', 'fastcgi', 'uwsgi', 'scgi']) mkdirSync(path.join(dir, d), { recursive: true });
  const file = path.join(dir, 'nginx.conf');
  writeFileSync(file, `${plain(main)}\nerror_log ${dir}/error.log info;\npid ${dir}/nginx.pid;\nhttp {\n  access_log off;\n  client_body_temp_path ${dir}/body;\n  proxy_temp_path ${dir}/proxy;\n${httpBody}\n}\n`);
  const r = spawnSync('nginx', ['-t', '-p', dir, '-c', file], { encoding: 'utf8' });
  return { ok: r.status === 0, output: `${r.stdout}${r.stderr}`.trim() };
}

/** The processes under an nginx master, and how many threads each runs (macOS `ps -M`, Linux `ps -L`). */
export async function nginxProcesses(masterPid: number) {
  // Workers start a moment after the master.
  let rows: { pid: number; ppid: number; command: string }[] = [];
  for (let i = 0; i < 40; i++) {
    rows = spawnSync('ps', ['-A', '-o', 'pid=,ppid=,command='], { encoding: 'utf8' })
      .stdout.split('\n')
      .map((l) => l.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/))
      .filter((m): m is RegExpMatchArray => !!m)
      .map((m) => ({ pid: Number(m[1]), ppid: Number(m[2]), command: m[3].trim() }));
    if (rows.some((r) => r.ppid === masterPid)) break;
    await sleep(100);
  }
  const threads = (pid: number) => {
    const mac = spawnSync('ps', ['-M', '-p', String(pid)], { encoding: 'utf8' });
    if (mac.status === 0) return mac.stdout.trim().split('\n').length - 1;
    return spawnSync('ps', ['-L', '-o', 'lwp=', '-p', String(pid)], { encoding: 'utf8' }).stdout.trim().split('\n').length;
  };
  const master = rows.find((r) => r.pid === masterPid);
  const workers = rows.filter((r) => r.ppid === masterPid);
  return {
    master: master ? { ...master, threads: threads(master.pid) } : null,
    workers: workers.map((w) => ({ ...w, threads: threads(w.pid) })),
  };
}
