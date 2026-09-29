/**
 * MySQL for the replication lesson's MySQL lines (my.cnf for two leaders,
 * semi-sync, SHOW REPLICA STATUS). Servers run on 127.0.0.1 with random
 * ports and temp data directories; queries go through the mysql CLI.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { sh } from './pg';
import { freePort, sleep, tmpDir, waitForPort } from './procs';

export function mysqlVersion() {
  const r = spawnSync('mysqld', ['--version'], { encoding: 'utf8' });
  return r.stdout.match(/Ver ([\d.]+)/)?.[1] ?? 'unknown';
}

let template: string | null = null;

async function freshDataDir(dir: string) {
  if (!template) {
    template = path.join(tmpDir('mysql-template'), 'data');
    const r = await sh('mysqld', ['--no-defaults', '--initialize-insecure', `--datadir=${template}`]);
    if (r.code !== 0) throw new Error(`mysqld --initialize-insecure failed:\n${r.out}`);
  }
  let r = await sh('cp', ['-c', '-R', template, dir]);
  if (r.code !== 0) r = await sh('cp', ['-R', template, dir]);
  if (r.code !== 0) throw new Error(`could not copy the MySQL template:\n${r.out}`);
  // Each server needs its own UUID, which MySQL writes to auto.cnf on first start.
  rmSync(path.join(dir, 'auto.cnf'), { force: true });
}

export interface MyResult {
  ok: boolean;
  out: string;
  ms: number;
}

const live = new Set<MyNode>();
/** Temp directories this run created (a MySQL data directory is ~200 MB). */
const dirs = new Set<string>();

export class MyNode {
  child: ChildProcess | null = null;
  constructor(
    public name: string,
    public root: string,
    public port: number,
    public cnf: string,
  ) {}

  /** mysql -e, tab-separated, no headers. Never throws: ok is false and out holds the error. */
  async sql(q: string, opts: { headers?: boolean } = {}): Promise<MyResult> {
    const t0 = performance.now();
    const args = ['-h127.0.0.1', `-P${this.port}`, '-uroot', '-B', ...(opts.headers ? [] : ['-N']), '-e', q];
    const r = await sh('mysql', args);
    return { ok: r.code === 0, out: r.out.replace(/^mysql: \[Warning\].*\n/gm, '').trim(), ms: performance.now() - t0 };
  }

  async rows(q: string) {
    const r = await this.sql(q);
    if (!r.ok) throw new Error(`${this.name}: ${q}\n${r.out}`);
    return r.out ? r.out.split('\n').map((l) => l.split('\t')) : [];
  }

  /** `SHOW ... \G`-style output as a record (e.g. SHOW REPLICA STATUS). */
  async record(q: string): Promise<Record<string, string>> {
    const r = await this.sql(`${q}\\G`, { headers: true });
    if (!r.ok) throw new Error(`${this.name}: ${q}\n${r.out}`);
    const out: Record<string, string> = {};
    for (const line of r.out.split('\n')) {
      const m = line.match(/^\s*([A-Za-z_]+): ?(.*)$/);
      if (m) out[m[1]] = m[2];
    }
    return out;
  }

  async status(name: string) {
    const rows = await this.rows(`SHOW STATUS LIKE '${name}'`);
    return rows[0]?.[1] ?? '';
  }

  async start() {
    const child = spawn('mysqld', [`--defaults-file=${this.cnf}`], { stdio: ['ignore', 'ignore', 'pipe'] });
    this.child = child;
    let err = '';
    child.stderr?.on('data', (d) => (err += d));
    const died = new Promise<never>((_, reject) => child.once('exit', (code) => reject(new Error(`mysqld ${this.name} exited (${code}):\n${err}`))));
    await Promise.race([waitForPort(this.port, 30_000), died]);
    for (let i = 0; i < 100; i++) {
      if ((await this.sql('SELECT 1')).ok) break;
      await sleep(100);
    }
    live.add(this);
  }

  async stop() {
    const c = this.child;
    if (!c || c.exitCode != null) return;
    const exited = new Promise<void>((r) => c.once('exit', () => r()));
    c.kill('SIGTERM');
    const t = setTimeout(() => c.kill('SIGKILL'), 10_000);
    await exited;
    clearTimeout(t);
    live.delete(this);
  }
}

/**
 * A MySQL server whose my.cnf is the harness's own [mysqld] lines followed by
 * `lines` (the lesson's snippet text).
 */
export async function startMysql(name: string, serverId: number, lines: string) {
  const root = tmpDir(`mysql-${name}`);
  dirs.add(root);
  const data = path.join(root, 'data');
  await freshDataDir(data);
  const port = await freePort();
  const cnf = path.join(root, 'my.cnf');
  writeFileSync(
    cnf,
    `[mysqld]
# --- verify harness ---
datadir = ${data}
port = ${port}
bind-address = 127.0.0.1
socket = ${root}/mysql.sock
mysqlx = OFF
server_id = ${serverId}
log_error = ${root}/error.log
pid_file = ${root}/mysqld.pid
# --- the lesson ---
${lines}
`,
  );
  const node = new MyNode(name, root, port, cnf);
  await node.start();
  return node;
}

/** `mysqld --validate-config` on a my.cnf made of `lines`: does MySQL accept it? */
export async function mysqlValidate(lines: string) {
  const root = tmpDir('mysql-validate');
  const cnf = path.join(root, 'my.cnf');
  writeFileSync(cnf, `[mysqld]\n${lines}\n`);
  const r = await sh('mysqld', [`--defaults-file=${cnf}`, '--validate-config']);
  rmSync(root, { recursive: true, force: true });
  const errors = r.out
    .split('\n')
    .filter((l) => /\[ERROR\]/.test(l) && !/Aborting/.test(l))
    .map((l) => l.replace(/^.*\[Server\] /, ''));
  return { ok: r.code === 0, errors };
}

/** A variable's compiled-in default, as `mysqld --verbose --help` prints it (plugins loaded on request). */
export async function mysqlDefault(variable: string, plugins: string[] = []) {
  const r = await sh('mysqld', ['--no-defaults', ...plugins.map((p) => `--plugin-load-add=${p}`), '--verbose', '--help']);
  const name = variable.replaceAll('_', '-');
  return r.out.split('\n').find((l) => l.startsWith(`${name} `))?.slice(name.length).trim() ?? null;
}

/** Stop every server and delete the data directories (and the template). */
export async function stopAllMysql() {
  for (const n of [...live]) await n.stop();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs.clear();
  if (template) rmSync(path.dirname(template), { recursive: true, force: true });
  template = null;
}
