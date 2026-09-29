/**
 * Real PostgreSQL for the replication, sharding and race-condition lessons.
 *
 * Throwaway clusters live in temp directories and listen on 127.0.0.1 only
 * (Unix sockets are off: macOS temp paths are too long for them). A tiny
 * client speaks the wire protocol directly, so a test can keep several
 * sessions open, see which statement is still waiting, and read the exact
 * SQLSTATE codes and warnings, without a driver package.
 */
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { freePort, sleep, tmpDir } from './procs';

export function pgVersion() {
  const r = spawnSync('postgres', ['--version'], { encoding: 'utf8' });
  return r.stdout.match(/(\d+\.\d+)/)?.[1] ?? 'unknown';
}

/** Run a program; resolves with its exit code and combined output (never rejects). */
export function sh(cmd: string, args: string[]) {
  return new Promise<{ code: number | null; out: string }>((resolve) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('error', (e) => resolve({ code: -1, out: String(e) }));
    child.on('close', (code) => resolve({ code, out }));
  });
}

/* ------------------------------------------------------------------ */
/* Wire protocol client                                                */
/* ------------------------------------------------------------------ */

export class PgError extends Error {
  constructor(
    public code: string,
    message: string,
    public detail?: string,
    public severity?: string,
  ) {
    super(message);
  }
}

export interface Notice {
  severity: string;
  code: string;
  message: string;
  detail?: string;
}

export interface Result {
  rows: (string | null)[][];
  fields: string[];
  /** Command tag of the last statement, e.g. "UPDATE 1" */
  tag: string;
  /** Warnings the server sent while running it */
  notices: Notice[];
}

export interface PgConn {
  readonly pid: number;
  readonly closed: boolean;
  query(sql: string): Promise<Result>;
  /** First column of the first row */
  one(sql: string): Promise<string | null>;
  close(): void;
}

interface Pending {
  sql: string;
  resolve: (r: Result) => void;
  reject: (e: Error) => void;
  rows: (string | null)[][];
  fields: string[];
  tag: string;
  notices: Notice[];
  error: PgError | null;
}

function errorFields(body: Buffer) {
  const f: Record<string, string> = {};
  let i = 0;
  while (i < body.length && body[i] !== 0) {
    const end = body.indexOf(0, i + 1);
    f[String.fromCharCode(body[i])] = body.toString('utf8', i + 1, end);
    i = end + 1;
  }
  return f;
}

/** Open a session (trust auth, simple query protocol). */
export async function pgConnect(port: number, opts: { user?: string; database?: string; app?: string } = {}): Promise<PgConn> {
  const sock = net.connect(port, '127.0.0.1');
  sock.setNoDelay(true);
  let buf = Buffer.alloc(0);
  const queue: Omit<Pending, 'rows' | 'fields' | 'tag' | 'notices' | 'error'>[] = [];
  let cur: Pending | null = null;
  let pid = 0;
  let started = false;
  let closed = false;
  let lastError: PgError | null = null;
  let lastNotice: Notice | null = null;
  let ready!: () => void;
  let fail!: (e: Error) => void;
  const startup = new Promise<void>((res, rej) => {
    ready = res;
    fail = rej;
  });
  // A refused connection rejects the connect step first; don't also report this one as unhandled.
  startup.catch(() => undefined);

  const send = (type: string, payload: Buffer) => {
    const head = Buffer.alloc(5);
    head.write(type, 0, 'latin1');
    head.writeInt32BE(payload.length + 4, 1);
    sock.write(Buffer.concat([head, payload]));
  };

  const next = () => {
    if (cur || !started || closed || !queue.length) return;
    const p = queue.shift()!;
    cur = { ...p, rows: [], fields: [], tag: '', notices: [], error: null };
    send('Q', Buffer.from(`${p.sql}\0`, 'utf8'));
  };

  const onMessage = (type: string, body: Buffer) => {
    switch (type) {
      case 'R':
        if (body.readInt32BE(0) !== 0) {
          fail(new Error(`authentication method ${body.readInt32BE(0)} is not supported (use trust)`));
          sock.destroy();
        }
        break;
      case 'K':
        pid = body.readInt32BE(0);
        break;
      case 'Z':
        if (!started) {
          started = true;
          ready();
        } else if (cur) {
          const c = cur;
          cur = null;
          if (c.error) c.reject(c.error);
          else c.resolve({ rows: c.rows, fields: c.fields, tag: c.tag, notices: c.notices });
        }
        next();
        break;
      case 'T': {
        if (!cur) break;
        cur.fields = [];
        cur.rows = [];
        const n = body.readInt16BE(0);
        let i = 2;
        for (let k = 0; k < n; k++) {
          const end = body.indexOf(0, i);
          cur.fields.push(body.toString('utf8', i, end));
          i = end + 1 + 18;
        }
        break;
      }
      case 'D': {
        if (!cur) break;
        const n = body.readInt16BE(0);
        let i = 2;
        const row: (string | null)[] = [];
        for (let k = 0; k < n; k++) {
          const len = body.readInt32BE(i);
          i += 4;
          if (len < 0) row.push(null);
          else {
            row.push(body.toString('utf8', i, i + len));
            i += len;
          }
        }
        cur.rows.push(row);
        break;
      }
      case 'C':
        if (cur) cur.tag = body.toString('utf8', 0, body.length - 1);
        break;
      case 'E': {
        const f = errorFields(body);
        const e = new PgError(f.C, f.M, f.D, f.V ?? f.S);
        if (!started) fail(e);
        else if (cur) cur.error = e;
        else lastError = e;
        break;
      }
      case 'N': {
        const f = errorFields(body);
        const n: Notice = { severity: f.V ?? f.S, code: f.C, message: f.M, detail: f.D };
        lastNotice = n;
        if (cur) cur.notices.push(n);
        break;
      }
      default:
        break;
    }
  };

  sock.on('data', (d) => {
    buf = Buffer.concat([buf, d]);
    while (buf.length >= 5) {
      const len = buf.readInt32BE(1);
      if (buf.length < 1 + len) break;
      const type = String.fromCharCode(buf[0]);
      const body = buf.subarray(5, 1 + len);
      buf = buf.subarray(1 + len);
      onMessage(type, body);
    }
  });

  const lost = (why: string) => {
    if (closed) return;
    closed = true;
    // What the client actually saw: an error, a shutdown warning, or just a closed socket.
    const notice = lastNotice as Notice | null;
    const e =
      cur?.error ??
      lastError ??
      (notice?.code?.startsWith('57') ? new PgError(notice.code, notice.message) : new PgError('08006', why));
    if (!started) fail(e);
    cur?.reject(e);
    cur = null;
    for (const q of queue.splice(0)) q.reject(e);
  };
  sock.on('close', () => lost('server closed the connection unexpectedly'));
  sock.on('error', (err) => lost(err.message));

  await new Promise<void>((resolve, reject) => {
    sock.once('connect', () => resolve());
    sock.once('error', reject);
  });
  const params = ['user', opts.user ?? 'postgres', 'database', opts.database ?? 'postgres', 'application_name', opts.app ?? 'verify'];
  const payload = Buffer.concat([Buffer.alloc(4), Buffer.from(`${params.join('\0')}\0\0`, 'utf8')]);
  payload.writeInt32BE(196608, 0);
  const len = Buffer.alloc(4);
  len.writeInt32BE(payload.length + 4, 0);
  sock.write(Buffer.concat([len, payload]));
  await startup;

  const query = (sql: string) =>
    new Promise<Result>((resolve, reject) => {
      if (closed) return reject(new PgError('08003', 'connection is closed'));
      queue.push({ sql, resolve, reject });
      next();
    });
  return {
    get pid() {
      return pid;
    },
    get closed() {
      return closed;
    },
    query,
    one: async (sql: string) => (await query(sql)).rows[0]?.[0] ?? null,
    close() {
      if (closed) return;
      try {
        send('X', Buffer.alloc(0));
      } catch {
        /* already gone */
      }
      closed = true;
      sock.end();
    },
  };
}

/** Is this promise still pending after `ms`? (A statement waiting on a lock or a standby.) */
export async function stillWaiting(p: Promise<unknown>, ms: number) {
  let settled = false;
  p.then(
    () => (settled = true),
    () => (settled = true),
  );
  await sleep(ms);
  return !settled;
}

/** Resolve with the outcome instead of throwing, so a test can compare errors too. */
export function outcome<T>(p: Promise<T>): Promise<{ ok: true; value: T; ms: number } | { ok: false; error: PgError; ms: number }> {
  const t0 = performance.now();
  return p.then(
    (value) => ({ ok: true as const, value, ms: performance.now() - t0 }),
    (error: PgError) => ({ ok: false as const, error, ms: performance.now() - t0 }),
  );
}

/* ------------------------------------------------------------------ */
/* Throwaway servers                                                   */
/* ------------------------------------------------------------------ */

const live = new Set<PgNode>();
/** Temp directories this run created; removed once their servers are stopped (each is 40+ MB). */
const dirs = new Set<string>();
let template: string | null = null;

/** A temp directory for a server's data, deleted by stopAllPg. */
export function pgTmpDir(name: string) {
  const d = tmpDir(`pg-${name}`);
  dirs.add(d);
  return d;
}

/** Every cluster starts as a copy of one initdb (trust auth, C locale). */
async function freshDataDir(dir: string) {
  if (!template) {
    template = path.join(tmpDir('pg-template'), 'data');
    const r = await sh('initdb', ['-D', template, '-U', 'postgres', '--auth=trust', '-E', 'UTF8', '--locale=C', '--no-sync']);
    if (r.code !== 0) throw new Error(`initdb failed:\n${r.out}`);
  }
  // APFS clone when available (instant), plain copy otherwise.
  let r = await sh('cp', ['-c', '-R', template, dir]);
  if (r.code !== 0) r = await sh('cp', ['-R', template, dir]);
  if (r.code !== 0) throw new Error(`could not copy the template cluster:\n${r.out}`);
}

/** Settings every test server gets; the lesson's own lines are appended after these. */
const BASE_CONF = `
# --- verify harness ---
listen_addresses = '127.0.0.1'
unix_socket_directories = ''
shared_buffers = 16MB
`;

export class PgNode {
  up = false;
  constructor(
    public name: string,
    public dir: string,
    public port: number,
  ) {}

  get logFile() {
    return path.join(path.dirname(this.dir), `${this.name}.log`);
  }

  log() {
    return existsSync(this.logFile) ? readFileSync(this.logFile, 'utf8') : '';
  }

  /** Append lines to postgresql.conf (the last setting of a name wins). */
  conf(text: string) {
    appendFileSync(path.join(this.dir, 'postgresql.conf'), `\n${text}\n`);
  }

  async start() {
    // The port goes on the command line: pg_rewind copies the source's config files over ours.
    const r = await sh('pg_ctl', ['-D', this.dir, '-o', `-p ${this.port}`, '-l', this.logFile, '-w', '-t', '60', 'start']);
    if (r.code !== 0) throw new Error(`${this.name} did not start:\n${r.out}\n${this.log().split('\n').slice(-12).join('\n')}`);
    this.up = true;
    live.add(this);
  }

  /** fast: a clean shutdown. immediate: the process dies on the spot, like a crash. */
  async stop(mode: 'fast' | 'immediate' = 'fast') {
    await sh('pg_ctl', ['-D', this.dir, '-m', mode, '-w', '-t', '60', 'stop']);
    this.up = false;
    live.delete(this);
  }

  connect(opts: { app?: string; database?: string; user?: string } = {}) {
    return pgConnect(this.port, opts);
  }

  /** Run one statement (or several, separated by semicolons) on a fresh session. */
  async sql(text: string, database?: string) {
    const c = await this.connect({ database });
    try {
      return await c.query(text);
    } finally {
      c.close();
    }
  }

  async one(text: string, database?: string) {
    return (await this.sql(text, database)).rows[0]?.[0] ?? null;
  }

  /** Poll until `check` is true (or throw after `ms`). */
  async until(check: () => Promise<boolean>, what: string, ms = 10_000) {
    const end = Date.now() + ms;
    for (;;) {
      if (await check().catch(() => false)) return;
      if (Date.now() > end) throw new Error(`${this.name}: timed out waiting for ${what}`);
      await sleep(50);
    }
  }
}

/** A new primary. `conf` is appended to its postgresql.conf. */
export async function initPrimary(name: string, conf = '', opts: { start?: boolean } = {}) {
  const root = pgTmpDir(name);
  const dir = path.join(root, 'data');
  await freshDataDir(dir);
  const node = new PgNode(name, dir, await freePort());
  node.conf(BASE_CONF);
  if (conf) node.conf(conf);
  if (opts.start !== false) await node.start();
  return node;
}

/**
 * A follower cloned from `leader` with pg_basebackup. With `recoveryConf`
 * (-R) pg_basebackup writes primary_conninfo and standby.signal itself;
 * without it the caller writes the follower config (the lesson's lines).
 */
export async function baseBackup(
  leader: PgNode,
  name: string,
  opts: { recoveryConf?: boolean; appName?: string; conf?: string; start?: boolean } = {},
) {
  const root = pgTmpDir(name);
  const dir = path.join(root, 'data');
  // --checkpoint=fast: don't spend seconds pacing the start-of-backup checkpoint on a tiny test cluster.
  const args = ['-h', '127.0.0.1', '-p', String(leader.port), '-U', 'postgres', '-D', dir, '-X', 'stream', '--no-sync', '--checkpoint=fast'];
  if (opts.recoveryConf) args.push('-R');
  if (opts.appName) args.push('-d', `application_name=${opts.appName}`);
  const r = await sh('pg_basebackup', args);
  if (r.code !== 0) throw new Error(`pg_basebackup for ${name} failed:\n${r.out}`);
  const node = new PgNode(name, dir, await freePort());
  if (opts.conf) node.conf(opts.conf);
  if (opts.start !== false) await node.start();
  return node;
}

/** The lesson's example addresses point at local servers: host=10.0.2.11 -> host=127.0.0.1 port=NNNN. */
export function localizeConninfo(text: string, map: Record<string, PgNode>) {
  let out = text;
  for (const [ip, node] of Object.entries(map)) out = out.replaceAll(`host=${ip}`, `host=127.0.0.1 port=${node.port}`);
  return out;
}

export function touch(file: string) {
  writeFileSync(file, '');
}

/** Stop every server still running (crash-stop: nothing to wait for) and delete their directories. */
export async function stopAllPg() {
  for (const n of [...live]) await n.stop('immediate');
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs.clear();
}

/** At the very end: the template cluster too. */
export function removePgTemplate() {
  if (template) rmSync(path.dirname(template), { recursive: true, force: true });
  template = null;
}

/** `postgres -C name`: does the server accept this config file, and what value does it read? */
export async function pgConfValue(dir: string, name: string) {
  const r = await sh('postgres', ['-D', dir, '-C', name]);
  return { ok: r.code === 0, value: r.out.trim() };
}

/** A scratch data directory (never started) for checking config text with postgres -C. */
export async function scratchDataDir() {
  const dir = path.join(pgTmpDir('conf'), 'data');
  await freshDataDir(dir);
  return dir;
}
