/**
 * Replication, Sharding and Race Conditions vs. real PostgreSQL (and MySQL
 * for the replication lesson's MySQL lines).
 *
 * Each test builds a small real cluster on 127.0.0.1 (initdb, pg_basebackup,
 * pg_ctl), configures it with the snippet the lesson shows, plays the
 * lesson's scenario (a follower falls behind, the sync follower crashes, the
 * leader crashes and a follower is promoted, two sessions race for one row)
 * and compares what the clients saw with the lesson's own simulation.
 *
 * CAP has nothing to run here: its snippets are Cassandra, etcd, Riak,
 * DynamoDB and MongoDB, and it makes no PostgreSQL claims.
 */
import { chmodSync, cpSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import type { CodeSpec } from '@/components/lesson/CodeBlock';
import { BANK_MODES, SEAT_MODES } from '@/lessons/race-conditions/Cards';
import type { BankMode, SeatMode } from '@/lessons/race-conditions/programs';
import type { Chip } from '@/lessons/race-conditions/sim';
import { CHAPTERS as REPL_CHAPTERS } from '@/lessons/replication/chapters';
import { MODES, applyMode, liveConfig } from '@/lessons/replication/Playground';
import { seqTimeline } from '@/lessons/replication/Scene';
import type { ReplSim } from '@/lessons/replication/sim';
import { CHAPTERS as SHARD_CHAPTERS } from '@/lessons/sharding/chapters';
import { DIR_START, NAMES, PREDICT_QUERIES, TODAY, YEARS, nameShard } from '@/lessons/sharding/routing';
import { DEFAULTS as SHARD_DEFAULTS, ShardSim } from '@/lessons/sharding/sim';
import {
  PgNode,
  baseBackup,
  initPrimary,
  localizeConninfo,
  outcome,
  pgConfValue,
  pgTmpDir,
  pgVersion,
  scratchDataDir,
  sh,
  stillWaiting,
  removePgTemplate,
  stopAllPg,
  touch,
  type PgConn,
  type Result,
} from './lib/pg';
import { mysqlDefault, mysqlValidate, mysqlVersion, startMysql, stopAllMysql, type MyNode } from './lib/pgmysql';
import { chipText, raceRound, replEnter, replRun, type Asked } from './lib/pgsims';
import { freePort, sleep } from './lib/procs';
import { results } from './lib/results';
import { collectSnippets, plain, snippet } from './lib/snippets';

const R = results('postgres-lessons');
const PGV = pgVersion();
const PG = `PostgreSQL ${PGV}`;
const MYV = mysqlVersion();
const MY = `MySQL ${MYV}`;
const REPL = collectSnippets(REPL_CHAPTERS);
const SHARD = collectSnippets(SHARD_CHAPTERS);
const LESSON = { repl: 'replication', shard: 'sharding', race: 'race-conditions' } as const;

afterEach(async () => {
  await stopAllPg();
});
afterAll(async () => {
  await stopAllPg();
  removePgTemplate();
  await stopAllMysql();
});

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** The SQL statements in a snippet: highlight marks and -- comments dropped, split on semicolons. */
function statements(code: string): string[] {
  const lines = plain(code).split('\n').map((line) => {
    let quoted = false;
    for (let i = 0; i < line.length - 1; i++) {
      if (line[i] === "'") quoted = !quoted;
      else if (!quoted && line[i] === '-' && line[i + 1] === '-') return line.slice(0, i);
    }
    return line;
  });
  return lines
    .join('\n')
    .split(';')
    .map((s) => s.replace(/\s*\n\s*/g, ' ').trim())
    .filter(Boolean);
}

/** A shell line split into words, quotes removed. */
function shellWords(line: string) {
  return (line.match(/(?:[^\s'"]+|'[^']*'|"[^"]*")+/g) ?? []).map((w) => w.replace(/'([^']*)'|"([^"]*)"/g, '$1$2'));
}

/** name = value settings in a conf snippet (commented-out alternatives flagged). */
function settings(text: string) {
  return [...text.matchAll(/^([#\s]*)([a-z_]+)\s*=\s*('(?:[^']|'')*'|[^\s#]+)/gm)].map((m) => ({
    line: m[0].replace(/^[#\s]+/, ''),
    name: m[2],
    value: m[3].replace(/^'|'$/g, '').replaceAll("''", "'"),
    commented: m[1].includes('#'),
  }));
}

/** The "replication settings" snippet in its three parts: PostgreSQL, MySQL source, MySQL replica. */
function replicationSettings(code: string) {
  const text = plain(code);
  const [pg, mysql] = text.split(/\n(?=# MySQL)/);
  const [source, replica] = mysql.split(/\n(?=# and on each replica)/);
  return { pg, source, replica };
}

const ACCOUNTS = `CREATE TABLE accounts (id text PRIMARY KEY, balance int NOT NULL); INSERT INTO accounts VALUES ('alice', 100), ('bob', 80)`;
const balance = async (n: PgNode, who = 'alice', database?: string) => Number(await n.one(`SELECT balance FROM accounts WHERE id = '${who}'`, database));
const deposit = (who: string, amount: number) => `UPDATE accounts SET balance = balance ${amount < 0 ? '-' : '+'} ${Math.abs(amount)} WHERE id = '${who}'`;

async function streaming(leader: PgNode, names: string[]) {
  await leader.until(async () => {
    const rows = (await leader.sql(`SELECT application_name FROM pg_stat_replication WHERE state = 'streaming'`)).rows.map((r) => r[0]);
    return names.every((n) => rows.includes(n));
  }, `${names.join(', ')} to stream`);
}

async function caughtUp(leader: PgNode, ...fs: PgNode[]) {
  const lsn = await leader.one('SELECT pg_current_wal_lsn()');
  for (const f of fs) await f.until(async () => (await f.one(`SELECT pg_last_wal_replay_lsn() >= '${lsn}'`)) === 't', `${f.name} to replay up to ${lsn}`);
}

/** A leader with the accounts table, and followers cloned with pg_basebackup -R, each named after itself. */
async function cluster(followers: string[], opts: { leaderConf?: string; followerConf?: string } = {}) {
  const db1 = await initPrimary('db1', opts.leaderConf ?? '');
  await db1.sql(ACCOUNTS);
  const f: Record<string, PgNode> = {};
  for (const name of followers) f[name] = await baseBackup(db1, name, { recoveryConf: true, appName: name, conf: opts.followerConf });
  await streaming(db1, followers);
  return { db1, f };
}

/**
 * Cut a follower off from its leader, as if the network dropped: it keeps
 * what it has and receives nothing new. (A follower whose replay is paused
 * doesn't act on a new primary_conninfo, so the link is also broken by
 * stopping its WAL receiver process, the way a dropped connection would.)
 */
async function cutOff(f: PgNode) {
  await f.sql(`ALTER SYSTEM SET primary_conninfo = ''`);
  await f.sql('SELECT pg_reload_conf()');
  await f.until(async () => {
    const pid = Number(await f.one('SELECT pid FROM pg_stat_wal_receiver'));
    if (!pid) return true;
    await sleep(200);
    process.kill(pid, 'SIGTERM');
    return false;
  }, 'its WAL receiver to stop');
}

async function follow(f: PgNode, leader: PgNode) {
  await f.sql(`ALTER SYSTEM SET primary_conninfo = 'host=127.0.0.1 port=${leader.port} user=postgres application_name=${f.name}'`);
  await f.sql('SELECT pg_reload_conf()');
}

/** Change synchronous_standby_names on a running leader (null: back to what postgresql.conf says). */
async function setSyncNames(leader: PgNode, names: string | null) {
  await leader.sql(names == null ? 'ALTER SYSTEM RESET synchronous_standby_names' : `ALTER SYSTEM SET synchronous_standby_names = '${names}'`);
  await leader.sql('SELECT pg_reload_conf()');
  const want = names ?? settings(readFileSync(path.join(leader.dir, 'postgresql.conf'), 'utf8')).filter((s) => s.name === 'synchronous_standby_names' && !s.commented).pop()?.value;
  await leader.until(async () => (await leader.one('SHOW synchronous_standby_names')) === (want ?? ''), 'the new setting to load');
  await sleep(150);
}

/** Wait until pg_stat_replication shows these sync states, and return what it shows. */
async function syncStates(leader: PgNode, want: Record<string, string>) {
  let got = '';
  const text = (rows: (string | null)[][]) => rows.map((r) => `${r[0]} ${r[1]}`).join(', ');
  const expected = text(Object.entries(want).sort());
  await leader
    .until(async () => {
      got = text((await leader.sql(`SELECT application_name, sync_state FROM pg_stat_replication ORDER BY 1`)).rows);
      return got === expected;
    }, `sync states ${expected}`)
    .catch(() => undefined);
  return got;
}

/** The sync states the animation shows for its live followers, in the same format. */
const simStates = (s: ReplSim) =>
  s
    .followers()
    .filter((f) => f.up)
    .map((f) => `${f.id} ${s.syncStateOf(f)}`)
    .sort()
    .join(', ');

const timed = (n: PgNode, sql: string) => outcome(n.sql(sql));
const ms = (x: number) => `${Math.round(x)} ms`;

/* ================================================================== */
/* Every postgresql.conf line loads                                    */
/* ================================================================== */

describe('every postgresql.conf line the lessons show loads', () => {
  /** The reason postgres -C gave for rejecting a config, if it did. */
  const why = (out: string) => out.split('\n').find((l) => /invalid|syntax|unrecognized/.test(l)) ?? out;

  const CONF = [
    { lesson: LESSON.repl, s: snippet(REPL, 'the-leader-streams-its-log', 'postgresql.conf'), text: (c: string) => plain(c), extra: [] as string[] },
    {
      lesson: LESSON.repl,
      s: snippet(REPL, 'who-waits-for-whom', 'postgresql.conf · on the leader'),
      text: (c: string) => plain(c),
      // the two other values its comments name
      extra: ['synchronous_commit = remote_apply', 'synchronous_commit = local'],
    },
    { lesson: LESSON.repl, s: snippet(REPL, 'one-sync-rest-async', 'replication settings'), text: (c: string) => replicationSettings(c).pg, extra: [] },
    { lesson: LESSON.shard, s: snippet(SHARD, 'copies-dont-add-room', 'postgresql.conf · on each replica'), text: (c: string) => plain(c), extra: [] },
  ];

  for (const { lesson, s, text, extra } of CONF) {
    test(`postgres -C: ${s.step} / ${s.title}`, async () => {
      const dir = await scratchDataDir();
      const orig = readFileSync(path.join(dir, 'postgresql.conf'), 'utf8');
      const found = [...settings(text(s.code)), ...extra.flatMap((l) => settings(l))];
      const res: { name: string; want: string; ok: boolean; got: string }[] = [];
      for (const st of found) {
        writeFileSync(path.join(dir, 'postgresql.conf'), `${orig}\n${st.line}\n`);
        const r = await pgConfValue(dir, st.name);
        res.push({ name: st.name, want: st.value, ok: r.ok, got: r.ok ? r.value : why(r.value) });
      }
      const real = res.map((r) => `${r.name} = ${r.ok ? r.got : `rejected (${r.got})`}`).join('; ');
      const pass = res.length > 0 && res.every((r) => r.ok && r.got === r.want);
      R.check({ lesson, step: s.step, title: `PostgreSQL accepts every setting in the ${s.title} snippet`, software: PG, real, lesson_says: found.map((f) => f.line).join('; '), pass });
      expect(pass, real).toBe(true);
    });
  }

  test('postgres -C: every commit mode the playground can show (playground)', async () => {
    // Drive the lesson's own playground: each commit mode, through failovers and rejoins, re-pointing the sync list like the page does.
    const seen = new Set<string>();
    for (const m of MODES) {
      const sim = replEnter('playground');
      const events: ((s: ReplSim) => void)[] = [
        () => undefined,
        (s) => s.crashLeader(),
        (s) => s.reviveDown(),
        (s) => s.crash(s.followers()[0]?.id ?? ''),
        (s) => s.reviveDown(),
        (s) => s.crashLeader(),
        (s) => s.reviveDown(),
        (s) => s.crashLeader(),
        (s) => s.reviveDown(),
      ];
      for (const ev of events) {
        ev(sim);
        replRun(sim, 7);
        applyMode(sim, m.id);
        seen.add(liveConfig(sim));
      }
    }
    const dir = await scratchDataDir();
    const orig = readFileSync(path.join(dir, 'postgresql.conf'), 'utf8');
    const bad: string[] = [];
    const lines = new Set<string>();
    for (const text of seen) {
      // The whole config, comments and all, as the reader would paste it
      const conf = plain(text);
      writeFileSync(path.join(dir, 'postgresql.conf'), `${orig}\n${conf}\n`);
      for (const st of settings(conf).filter((x) => !x.commented)) {
        lines.add(st.line);
        const r = await pgConfValue(dir, st.name);
        if (!r.ok || r.value !== st.value) bad.push(`${st.line} → ${r.ok ? r.value : why(r.value)}`);
      }
    }
    const pass = seen.size > 4 && bad.length === 0;
    R.check({
      lesson: LESSON.repl,
      step: 'playground',
      title: 'PostgreSQL accepts every config the playground shows',
      software: PG,
      real: `${seen.size} configs, ${lines.size} distinct settings, ${bad.length ? `rejected: ${bad.join('; ')}` : 'all accepted'} (e.g. ${[...lines].filter((l) => l.includes('1 (')).slice(0, 3).join('; ')})`,
      pass,
    });
    expect(bad).toEqual([]);
    expect(seen.size).toBeGreaterThan(4);
  });
});

/* ================================================================== */
/* Replication: a real leader and followers                            */
/* ================================================================== */

describe('replication on real PostgreSQL', () => {
  test('a follower set up with the lesson’s lines streams and replays (the-leader-streams-its-log, spread-the-reads)', async () => {
    const s = snippet(REPL, 'the-leader-streams-its-log', 'postgresql.conf');
    const [leaderPart, followerPart] = plain(s.code).split(/\n(?=# on each follower)/);
    const db1 = await initPrimary('db1', leaderPart);
    await db1.sql(`CREATE ROLE replicator WITH REPLICATION LOGIN; ${ACCOUNTS}`);
    // Clone the leader, then configure the follower with the snippet's own lines (plus the empty standby.signal it mentions).
    const db2 = await baseBackup(db1, 'db2', { start: false });
    db2.conf(localizeConninfo(followerPart, { '10.0.2.11': db1 }));
    touch(path.join(db2.dir, 'standby.signal'));
    await db2.start();
    await streaming(db1, ['db2']);
    const who = (await db1.sql(`SELECT application_name, usename, state FROM pg_stat_replication`)).rows[0];
    await db1.sql(deposit('alice', 50));
    await db2.until(async () => (await balance(db2)) === 150, 'the deposit to reach db2');
    const read = await balance(db2);
    const write = await outcome(db2.sql(deposit('bob', -80)));

    // What pg_basebackup -R writes by itself, with and without an application_name.
    const db3 = await baseBackup(db1, 'db3', { recoveryConf: true });
    const auto3 = readFileSync(path.join(db3.dir, 'postgresql.auto.conf'), 'utf8');
    const signal3 = existsSync(path.join(db3.dir, 'standby.signal')) ? readFileSync(path.join(db3.dir, 'standby.signal'), 'utf8') : null;
    const db4 = await baseBackup(db1, 'db4', { recoveryConf: true, appName: 'db4', start: false });
    const auto4 = readFileSync(path.join(db4.dir, 'postgresql.auto.conf'), 'utf8');
    // The same clone without its standby.signal: "you are a follower" is exactly what that file says.
    rmSync(path.join(db4.dir, 'standby.signal'));
    await db4.start();
    const withoutSignal = await db4.one('SELECT pg_is_in_recovery()');
    await db4.stop('immediate');
    await streaming(db1, ['db2', 'walreceiver']);
    const senders = Number(await db1.one(`SELECT count(*) FROM pg_stat_activity WHERE backend_type = 'walsender'`));
    // db3 streams under the name "walreceiver", so a sync setting naming it never matches.
    await setSyncNames(db1, 'FIRST 1 (db3)');
    const w = outcome(db1.sql(deposit('bob', 1)));
    const waits = await stillWaiting(w, 1000);
    await setSyncNames(db1, '');
    await w;

    const streams = who?.[0] === 'db2' && who?.[1] === 'replicator' && who?.[2] === 'streaming' && read === 150;
    const refuses = !write.ok && write.error.code === '25006';
    const dashR = signal3 === '' && /primary_conninfo = '.*host=127\.0\.0\.1/.test(auto3) && !/application_name/.test(auto3) && /application_name=db4/.test(auto4);
    const checks = [
      {
        step: 'the-leader-streams-its-log',
        title: 'A follower set up with the lesson’s lines streams and replays',
        real: `db2 streams as application_name ${who?.[0]} (user ${who?.[1]}, ${who?.[2]}); the $50 deposit showed up on db2 (alice = ${read}); ${senders} WAL sender processes for 2 followers`,
        lesson_says: 'the leader streams its log; each follower replays it in order; one sender process per follower',
        pass: streams && senders === 2,
      },
      {
        step: 'spread-the-reads',
        title: 'Followers answer reads but refuse writes',
        real: `read alice = ${read}; UPDATE → ${write.ok ? write.value.tag : `ERROR ${write.error.code}: ${write.error.message}`}`,
        lesson_says: 'Followers can’t take writes, but they can answer reads.',
        pass: refuses && read === 150,
      },
      {
        step: 'the-leader-streams-its-log',
        title: 'standby.signal: "you are a follower"',
        real: `db2 (with the file) is in recovery: ${await db2.one('SELECT pg_is_in_recovery()')}; the same kind of clone without it started as a leader (pg_is_in_recovery() = ${withoutSignal})`,
        lesson_says: '...plus an empty standby.signal file: "you are a follower"',
        pass: withoutSignal === 'f',
      },
      {
        step: 'the-leader-streams-its-log',
        title: 'What pg_basebackup -R writes for you',
        real: `an empty standby.signal and primary_conninfo (host, port, user…); application_name only when passed with -d; without it the follower streamed as "walreceiver", and FIRST 1 (db3) left a commit ${waits ? 'waiting' : 'not waiting'}`,
        lesson_says: 'pg_basebackup -R writes the follower settings; the note: application_name only if you pass one, otherwise commits just wait',
        pass: dashR && waits,
      },
    ];
    for (const c of checks) R.check({ lesson: LESSON.repl, software: PG, ...c });
    for (const c of checks) expect(c.pass, `${c.title}: ${c.real}`).toBe(true);
    R.stamp(s.code, {
      lesson: LESSON.repl,
      by: PG,
      kind: 'ran',
      note: `Ran it on PostgreSQL ${PGV}: with these lines and an empty standby.signal, the follower streamed from the leader as db2, replayed each write a moment later, and refused writes of its own.`,
    });
  });

  test('pg_current_wal_lsn is a byte position that moves with each write (one-leader-orders-the-writes)', async () => {
    const s = snippet(REPL, 'one-leader-orders-the-writes', 'psql · on the leader');
    const [lsnSql, update] = statements(s.code);
    const db1 = await initPrimary('db1');
    await db1.sql(ACCOUNTS);
    const c = await db1.connect();
    const before = (await c.one(lsnSql))!;
    const tag = (await c.query(update)).tag;
    const after = (await c.one(lsnSql))!;
    const bytes = Number(await c.one(`SELECT pg_wal_lsn_diff('${after}', '${before}')`));
    const shown = /--\s+([0-9A-F]+\/[0-9A-F]+)/.exec(plain(s.code))?.[1] ?? '';
    const shape = (x: string) => /^[0-9A-F]+\/[0-9A-F]+$/.test(x);
    c.close();
    const pass = shape(before) && shape(after) && shape(shown) && tag === 'UPDATE 1' && bytes > 0 && bytes < 10_000;
    R.check({
      lesson: LESSON.repl,
      step: 'one-leader-orders-the-writes',
      title: 'Every write moves the log position forward',
      software: PG,
      real: `pg_current_wal_lsn() ${before} → ${after} after the UPDATE: ${bytes} bytes of log`,
      lesson_says: `LSNs are byte positions in the log, like ${shown}`,
      pass,
    });
    expect(pass).toBe(true);
    R.stamp(s.code, {
      lesson: LESSON.repl,
      by: PG,
      kind: 'ran',
      note: `Ran it on PostgreSQL ${PGV}: the LSN has the same shape as 0/3000148, and the UPDATE moved it forward by the bytes of its log record.`,
    });
  });

  test('replay_lag: a long transaction on a follower holds up replay (followers-run-behind)', async () => {
    const s = snippet(REPL, 'followers-run-behind', 'psql · on the leader');
    const [lagQuery] = statements(s.code);
    const { db1, f } = await cluster(['db2', 'db3'], { followerConf: 'wal_receiver_status_interval = 1s' });
    // A report on db3 holds a lock that replay is about to need.
    const report = await f.db3.connect({ app: 'report' });
    await report.query('BEGIN');
    await report.query('SELECT count(*) FROM accounts');
    await db1.sql('BEGIN; LOCK TABLE accounts IN ACCESS EXCLUSIVE MODE; COMMIT');
    await db1.sql(deposit('alice', 50));
    const lsn = await db1.one('SELECT pg_current_wal_lsn()');
    await sleep(2300);
    const db3Behind = (await f.db3.one(`SELECT pg_last_wal_replay_lsn() < '${lsn}'`)) === 't';
    const db2Current = (await f.db2.one(`SELECT pg_last_wal_replay_lsn() >= '${lsn}'`)) === 't';
    await report.query('COMMIT');
    report.close();
    // Watch pg_stat_replication for a few seconds and keep each follower's worst replay_lag.
    const worst: Record<string, number> = {};
    let sample: Result | null = null;
    for (let i = 0; i < 80; i++) {
      for (const [app, lag] of (await db1.sql(`SELECT application_name, EXTRACT(epoch FROM replay_lag) FROM pg_stat_replication`)).rows) {
        if (lag != null) worst[app!] = Math.max(worst[app!] ?? 0, Number(lag));
      }
      if (!sample && (worst.db3 ?? 0) >= 2) sample = await db1.sql(lagQuery);
      if (sample && i > 30) break;
      await sleep(50);
    }
    // The animation: db-3 is slowed down and runs behind db-2.
    const sim = replEnter('followers-run-behind');
    replRun(sim, 8);
    const simLag = { db2: sim.lagView('db2') * 40, db3: sim.lagView('db3') * 40 };
    const pass =
      db3Behind &&
      db2Current &&
      (worst.db3 ?? 0) >= 2 &&
      (worst.db2 ?? 0) < 1 &&
      !!sample &&
      sample.fields.join() === 'client_addr,state,replay_lag' &&
      sample.rows.every((r) => r[1] === 'streaming') &&
      simLag.db3 > simLag.db2;
    R.check({
      lesson: LESSON.repl,
      step: 'followers-run-behind',
      title: 'A follower held up by a long query falls behind',
      software: PG,
      real: `db3's replay waited for the report; worst replay_lag: db2 ${(worst.db2 ?? 0).toFixed(3)} s, db3 ${(worst.db3 ?? 0).toFixed(2)} s; the lesson's query returned ${sample?.rows.map((r) => r.join(' | ')).join('; ')}`,
      lesson_says: `db3 lags (${Math.round(simLag.db3)} ms vs ${Math.round(simLag.db2)} ms for db2); lag grows to seconds while a long-running query holds up replay`,
      pass,
    });
    expect(pass).toBe(true);
    R.stamp(s.code, {
      lesson: LESSON.repl,
      by: PG,
      kind: 'ran',
      note: `Ran it on PostgreSQL ${PGV}: while a long transaction on one follower held up replay, its replay_lag climbed to seconds; the other stayed in milliseconds.`,
    });
  });

  test('a lagging follower returns the balance from before the deposit (where-did-my-deposit-go, read-your-own-writes)', async () => {
    const s = snippet(REPL, 'read-your-own-writes', 'psql');
    const [lsnSql, checkSql] = statements(s.code);
    const { db1, f } = await cluster(['db2', 'db3']);
    await f.db3.sql('SELECT pg_wal_replay_pause()'); // db-3 falls behind
    // POST /deposit on the leader, then her LSN, as the snippet says.
    const app = await db1.connect({ app: 'app-1' });
    const dep = await app.query(deposit('alice', 50));
    const lsn = (await app.one(lsnSql))!;
    app.close();
    const check = checkSql.replace('0/3000148', lsn);
    // GET /account on the lagging follower
    const stale = await balance(f.db3);
    const db3Ready = await f.db3.one(check);
    await f.db2.until(async () => (await f.db2.one(check)) === 't', 'db2 to replay the deposit');
    const fromDb2 = await balance(f.db2);
    // Wait for her position on db-3
    await f.db3.sql('SELECT pg_wal_replay_resume()');
    const t0 = performance.now();
    await f.db3.until(async () => (await f.db3.one(check)) === 't', 'db3 to reach her LSN');
    const waited = performance.now() - t0;
    const fresh = await balance(f.db3);

    // The same moments in the animation
    const asked: Asked[] = [];
    const staleSim = replEnter('where-did-my-deposit-go');
    replRun(staleSim, 20, asked);
    const first = asked[0];
    const mode = (ryw: 'off' | 'leader' | 'lsn') => {
      const sim = replEnter('read-your-own-writes');
      sim.setRyw(ryw);
      replRun(sim, 30);
      return sim.m;
    };
    const [off, leader, byLsn] = [mode('off'), mode('leader'), mode('lsn')];
    const checks = [
      {
        step: 'where-did-my-deposit-go',
        title: 'Alice reads her balance from a lagging follower right after depositing',
        real: `deposit ${dep.tag} on the leader; db-3 (behind) returned ${stale}, db-2 returned ${fromDb2}`,
        lesson_says: `"${first?.ask}" → ${first?.acceptable.join()}: ${first?.explain}`,
        pass: dep.tag === 'UPDATE 1' && stale === 100 && fromDb2 === 150 && first?.acceptable[0] === 'old' && staleSim.m.aliceStale > 0,
      },
      {
        step: 'read-your-own-writes',
        title: 'Waiting for her LSN',
        real: `pg_last_wal_replay_lsn() >= '${lsn}': ${db3Ready} on db-3, true on db-2; once db-3 passed it (${ms(waited)} after replay resumed) the read returned ${fresh}`,
        lesson_says: `stale reads: any follower ${off.aliceStale}/${off.aliceReads}, leader after a write ${leader.aliceStale}/${leader.aliceReads}, wait for her LSN ${byLsn.aliceStale}/${byLsn.aliceReads}`,
        pass: db3Ready === 'f' && fresh === 150 && off.aliceStale > 0 && leader.aliceStale === 0 && byLsn.aliceStale === 0 && byLsn.aliceReads > 0,
      },
    ];
    for (const c of checks) R.check({ lesson: LESSON.repl, software: PG, ...c });
    for (const c of checks) expect(c.pass, `${c.title}: ${c.real} / ${c.lesson_says}`).toBe(true);
    R.stamp(s.code, {
      lesson: LESSON.repl,
      by: PG,
      kind: 'ran',
      note: `Ran it on PostgreSQL ${PGV}: on a follower that was behind, the check returned false and a read there showed the old balance; once it passed her LSN, the read included the deposit.`,
    });
  });

  test('reads from two followers can go back in time; one follower can’t (dont-go-back-in-time)', async () => {
    const { db1, f } = await cluster(['db2', 'db3']);
    const sale = () => db1.sql(deposit('alice', 5));
    await sale();
    await caughtUp(db1, f.db2, f.db3);
    await f.db3.sql('SELECT pg_wal_replay_pause()'); // db-3 starts to lag
    for (let i = 0; i < 4; i++) await sale();
    await caughtUp(db1, f.db2);
    // Refreshes that land on whichever follower
    const hopping = [await balance(f.db2), await balance(f.db3), await balance(f.db2)];
    // Refreshes pinned to db-3, while sales continue and db-3 catches up
    const pinned = [await balance(f.db3)];
    await sale();
    pinned.push(await balance(f.db3));
    await f.db3.sql('SELECT pg_wal_replay_resume()');
    await caughtUp(db1, f.db3);
    pinned.push(await balance(f.db3));
    await sale();
    await caughtUp(db1, f.db3);
    pinned.push(await balance(f.db3));
    const backs = (xs: number[]) => xs.slice(1).filter((v, i) => v < xs[i]).length;
    const random = replEnter('dont-go-back-in-time');
    replRun(random, 40);
    const sticky = replEnter('dont-go-back-in-time');
    sticky.setSticky(true);
    replRun(sticky, 40);
    const pass = backs(hopping) > 0 && backs(pinned) === 0 && random.m.backJumps > 0 && sticky.m.backJumps === 0;
    R.check({
      lesson: LESSON.repl,
      step: 'dont-go-back-in-time',
      title: 'Monotonic reads: random followers vs. one follower',
      software: PG,
      real: `db-2, db-3, db-2: ${hopping.join(' → ')} (back ${backs(hopping)}×); always db-3: ${pinned.join(' → ')} (back ${backs(pinned)}×)`,
      lesson_says: `random follower: back in time ${random.m.backJumps}× in 40 s; the same follower: ${sticky.m.backJumps}×`,
      pass,
    });
    expect(pass).toBe(true);
  });

  test('synchronous_commit: on waits for the flush, remote_apply for the replay, local for nobody (who-waits-for-whom)', async () => {
    const s = snippet(REPL, 'who-waits-for-whom', 'postgresql.conf · on the leader');
    const { db1, f } = await cluster(['db2']);
    // Out of the box: nobody to wait for (PostgreSQL), and semi-sync off even once its plugin is loaded (MySQL).
    const defaults = { pg: await db1.one('SHOW synchronous_standby_names'), state: await db1.one(`SELECT sync_state FROM pg_stat_replication`), my: await mysqlDefault('rpl_semi_sync_source_enabled', ['semisync_source.so']) };
    db1.conf(plain(s.code));
    await db1.sql('SELECT pg_reload_conf()');
    await syncStates(db1, { db2: 'sync' });
    // on: returns once db2 has the entry on disk, even with replay paused there
    await f.db2.sql('SELECT pg_wal_replay_pause()');
    const app = await db1.connect({ app: 'app-1' });
    const before = (await app.one('SELECT pg_current_wal_lsn()'))!;
    const on = await outcome(app.query(deposit('alice', 50)));
    const flushed = await f.db2.one(`SELECT pg_last_wal_receive_lsn() > '${before}'`);
    const readThere = await balance(f.db2);
    // remote_apply: waits until db2 has replayed it
    await app.query('SET synchronous_commit = remote_apply');
    const ra = outcome(app.query(deposit('bob', 1)));
    const raWaits = await stillWaiting(ra, 1000);
    await f.db2.sql('SELECT pg_wal_replay_resume()');
    const raDone = await ra;
    const bobThere = await balance(f.db2, 'bob');
    // local: with db2 gone, the commit doesn't wait for it at all
    await f.db2.stop('immediate');
    await app.query('SET synchronous_commit = local');
    const local = await outcome(app.query(deposit('alice', 1)));
    // async (no standby named): the same
    await app.query('RESET synchronous_commit');
    await setSyncNames(db1, '');
    const asyncCommit = await outcome(app.query(deposit('alice', 1)));
    app.close();
    const syncTl = seqTimeline('sync');
    const asyncTl = seqTimeline('async');
    const checks = [
      {
        title: 'Asynchronous is the default',
        real: `PostgreSQL: synchronous_standby_names = '${defaults.pg}', the follower's sync_state is ${defaults.state}; ${MY}: rpl_semi_sync_source_enabled defaults to ${defaults.my}`,
        lesson_says: 'Asynchronous, the default in Postgres and MySQL',
        pass: defaults.pg === '' && defaults.state === 'async' && defaults.my === 'FALSE',
      },
      {
        title: 'synchronous_commit = on',
        real: `with db2's replay paused the commit returned in ${ms(on.ms)}: db2 had flushed it (${flushed === 't'}) but a read there still showed ${readThere}`,
        lesson_says: 'on: wait until db2 has flushed the entry to disk',
        pass: on.ok && flushed === 't' && readThere === 100,
      },
      {
        title: 'synchronous_commit = remote_apply',
        real: `waited while replay was paused (${raWaits}), returned after it resumed; right after, db2 showed bob = ${bobThere}`,
        lesson_says: 'remote_apply: wait until db2 has replayed it (so reads there see it)',
        pass: raWaits && raDone.ok && bobThere === 81,
      },
      {
        title: 'synchronous_commit = local',
        real: `with db2 down, the commit returned in ${ms(local.ms)}`,
        lesson_says: 'local: don’t wait for any standby at all',
        pass: local.ok && local.ms < 800,
      },
      {
        title: 'Copies that exist when COMMIT comes back',
        real: `sync: only after db2 had the entry (2 copies); async: in ${ms(asyncCommit.ms)} with db2 down (1 copy)`,
        lesson_says: `sequence diagram: ${syncTl.copies} copies at COMMIT when sync, ${asyncTl.copies} when async`,
        pass: syncTl.copies === 2 && asyncTl.copies === 1 && flushed === 't' && asyncCommit.ok && asyncCommit.ms < 800,
      },
    ];
    for (const c of checks) R.check({ lesson: LESSON.repl, step: 'who-waits-for-whom', software: PG, ...c });
    for (const c of checks) expect(c.pass, `${c.title}: ${c.real}`).toBe(true);
    R.stamp(s.code, {
      lesson: LESSON.repl,
      by: PG,
      kind: 'ran',
      note: `Ran it on PostgreSQL ${PGV}: with db2's replay paused, a commit still returned once db2 had the entry on disk (a read there still showed the old balance). remote_apply waited for the replay; local didn't wait at all.`,
    });
  });

  test('the only sync follower crashes: commits wait with no error, then finish (when-the-sync-follower-dies)', async () => {
    const s = snippet(REPL, 'when-the-sync-follower-dies', 'psql · on the leader');
    const [stuckSql] = statements(s.code);
    const { db1, f } = await cluster(['db2']);
    db1.conf(plain(snippet(REPL, 'who-waits-for-whom', 'postgresql.conf · on the leader').code));
    await db1.sql('SELECT pg_reload_conf()');
    await syncStates(db1, { db2: 'sync' });
    const a = await db1.connect({ app: 'app-1' });
    const b = await db1.connect({ app: 'app-2' });
    await a.query(deposit('alice', 1));
    await f.db2.stop('immediate'); // db-2 crashes
    const w1 = outcome(a.query(deposit('alice', 50)));
    const w2 = outcome(b.query(deposit('bob', 10)));
    const waiting = (await stillWaiting(w1, 1500)) && (await stillWaiting(w2, 10));
    const stuck = (await db1.sql(stuckSql)).rows;
    const tBack = performance.now();
    await f.db2.start();
    const [r1, r2] = await Promise.all([w1, w2]);
    const released = performance.now() - tBack;
    // Emergency: clear synchronous_standby_names
    await f.db2.stop('immediate');
    const w3 = outcome(a.query(deposit('alice', 1)));
    const w3waits = await stillWaiting(w3, 1000);
    await setSyncNames(db1, '');
    const r3 = await w3;
    // Give up and cancel: the warning the note quotes
    await setSyncNames(db1, null);
    const w4 = outcome(a.query(deposit('alice', 1)));
    const w4waits = await stillWaiting(w4, 1000);
    await db1.sql(`SELECT pg_cancel_backend(pid) FROM pg_stat_activity WHERE wait_event = 'SyncRep'`);
    const r4 = await w4;
    a.close();
    b.close();
    const warning = r4.ok ? r4.value.notices.find((n) => n.severity === 'WARNING') : undefined;
    const quoted = /“(.+)”/.exec(s.note ?? '')?.[1];

    // The animation
    const asked: Asked[] = [];
    const sim = replEnter('when-the-sync-follower-dies');
    replRun(sim, 6, asked);
    const c6 = sim.m.commits;
    replRun(sim, 5);
    const c11 = sim.m.commits;
    const pending = sim.leader()?.pending.length ?? 0;
    const errs = sim.m.writeErrors;
    sim.revive('db2');
    replRun(sim, 3);
    const burst = sim.m.commits - c11;
    const sim2 = replEnter('when-the-sync-follower-dies');
    replRun(sim2, 9);
    const pending2 = sim2.leader()?.pending.length ?? 0;
    sim2.setSync(false);
    replRun(sim2, 1.5);
    const after2 = sim2.leader()?.pending.length ?? 0;
    const q = asked[0];

    const checks = [
      {
        title: 'The next writes after db-2 crashes',
        real: `both still waiting after 1.5 s, no error; the lesson's query: ${stuck.map((r) => r.join(' | ')).join('; ')}`,
        lesson_says: `prediction: "${q?.ask}" → ${q?.acceptable.join()} (${q?.explain}); commits stalled (${c6} → ${c11}), ${pending} waiting, ${errs} errors`,
        pass: waiting && stuck.length === 2 && stuck.every((r) => r[1] === 'SyncRep' && r[2] === 'active') && q?.acceptable.includes('wait') && c11 === c6 && errs === 0,
      },
      {
        title: 'db-2 comes back',
        real: `both commits returned (${r1.ok ? r1.value.tag : r1.error.message}, ${r2.ok ? r2.value.tag : r2.error.message}) ${ms(released)} after db-2 was started`,
        lesson_says: `the stuck writes commit in a burst (${burst} commits right after db-2 revives)`,
        pass: r1.ok && r2.ok && burst >= 2,
      },
      {
        title: 'Clearing synchronous_standby_names',
        real: `a stuck commit returned right after the reload (${r3.ok ? r3.value.tag : r3.error.message})`,
        lesson_says: `releases every stuck commit at once (${pending2} waiting → ${after2})`,
        pass: w3waits && r3.ok && pending2 > 0 && after2 === 0,
      },
      {
        title: 'Cancelling a stuck commit',
        real: warning ? `WARNING: ${warning.message} DETAIL: ${warning.detail} (the client still got ${r4.ok ? r4.value.tag : ''})` : `no warning (${r4.ok ? r4.value.tag : r4.error.message})`,
        lesson_says: quoted ?? '(no quote)',
        pass: w4waits && !!warning && warning.detail === quoted,
      },
    ];
    for (const c of checks) R.check({ lesson: LESSON.repl, step: 'when-the-sync-follower-dies', software: PG, ...c });
    for (const c of checks) expect(c.pass, `${c.title}: ${c.real} / ${c.lesson_says}`).toBe(true);
    R.stamp(s.code, {
      lesson: LESSON.repl,
      by: PG,
      kind: 'ran',
      note: `Ran it on PostgreSQL ${PGV}: with the only sync standby crashed, commits waited in SyncRep with no error and all finished when it came back. Cancelling one printed that warning word for word.`,
    });
  });

  test('FIRST 1 (db2, db3) and ANY 1: who the leader waits for (one-sync-rest-async)', async () => {
    const s = snippet(REPL, 'one-sync-rest-async', 'replication settings');
    const { pg } = replicationSettings(s.code);
    const any = settings(pg).find((x) => x.commented && x.name === 'synchronous_standby_names')!.value;
    const { db1, f } = await cluster(['db2', 'db3', 'db4']);
    db1.conf(pg);
    await db1.sql('SELECT pg_reload_conf()');
    const s0 = await syncStates(db1, { db2: 'sync', db3: 'potential', db4: 'async' });
    await f.db2.stop('immediate');
    const s1 = await syncStates(db1, { db3: 'sync', db4: 'async' });
    const c1 = await timed(db1, deposit('alice', 1));
    await f.db3.stop('immediate');
    const w = outcome(db1.sql(deposit('alice', 1)));
    const stalled = await stillWaiting(w, 1000);
    await f.db3.start();
    const c2 = await w;
    await f.db2.start();
    await setSyncNames(db1, any);
    const s2 = await syncStates(db1, { db2: 'quorum', db3: 'quorum', db4: 'quorum' });
    await f.db2.stop('immediate');
    await f.db3.stop('immediate');
    const c3 = await timed(db1, deposit('alice', 1));

    // The animation
    const sim = replEnter('one-sync-rest-async');
    replRun(sim, 3);
    const t0 = simStates(sim);
    sim.crash('db2');
    replRun(sim, 0.5);
    const t1 = simStates(sim);
    let n = sim.m.commits;
    replRun(sim, 5);
    const flowA = sim.m.commits - n;
    sim.crash('db3');
    replRun(sim, 1.5);
    n = sim.m.commits;
    replRun(sim, 5);
    const flowB = sim.m.commits - n;
    const q = replEnter('one-sync-rest-async', { syncMethod: 'any', syncNames: ['db2', 'db3', 'db4'] });
    replRun(q, 3);
    const tq = simStates(q);
    q.crash('db2');
    q.crash('db3');
    replRun(q, 1.5);
    n = q.m.commits;
    replRun(q, 5);
    const flowQ = q.m.commits - n;
    const checks = [
      { title: 'FIRST 1 (db2, db3) with every follower up', real: s0, lesson_says: t0, pass: s0 === t0 },
      {
        title: 'db-2 crashes',
        real: `${s1}; the next commit took ${ms(c1.ms)}`,
        lesson_says: `${t1}; ${flowA} commits in the next 5 s`,
        pass: s1 === t1 && c1.ok && c1.ms < 1000 && flowA > 0,
      },
      {
        title: 'db-2 and db-3 both down',
        real: `a commit waited (${stalled}) until db-3 came back, then returned`,
        lesson_says: `${flowB} commits in 5 s: writes stall again`,
        pass: stalled && c2.ok && flowB === 0,
      },
      {
        title: `${any}`,
        real: `${s2}; with db2 and db3 down a commit took ${ms(c3.ms)}: db4 was enough`,
        lesson_says: `${tq}; ${flowQ} commits in 5 s with db2 and db3 down`,
        pass: s2 === 'db2 quorum, db3 quorum, db4 quorum' && tq === s2 && c3.ok && c3.ms < 1000 && flowQ > 0,
      },
    ];
    for (const c of checks) R.check({ lesson: LESSON.repl, step: 'one-sync-rest-async', software: PG, ...c });
    for (const c of checks) expect(c.pass, `${c.title}: ${c.real} / ${c.lesson_says}`).toBe(true);
    R.stamp(s.code, {
      lesson: LESSON.repl,
      by: PG,
      kind: 'ran',
      note: `Ran it on PostgreSQL ${PGV}: db2 was sync and db3 potential; when db2 crashed, db3 took over and commits kept flowing; with both down, commits waited. With ANY 1, one follower was enough.`,
    });
  });

  test('the leader crashes: promote the most complete follower, lose the unshipped writes, fence the old leader (who-takes-over, writes-that-vanish, split-brain, fencing)', async () => {
    const { db1, f } = await cluster(['db2', 'db3'], { leaderConf: `wal_log_hints = on\nwal_keep_size = '64MB'` });
    const app = await db1.connect({ app: 'app-1' });
    const write = async (sql: string) => (await app.query(sql)).tag;
    await write(deposit('alice', 10)); // W1: everyone has it
    await caughtUp(db1, f.db2, f.db3);
    await cutOff(f.db3); // db-3 falls behind
    await write(deposit('bob', 20)); // W2: db1 and db2
    await caughtUp(db1, f.db2);
    await f.db2.sql('SELECT pg_wal_replay_pause()');
    await write(deposit('alice', 30)); // W3: db2 receives it but hasn't replayed it
    const w3 = await app.one('SELECT pg_current_wal_lsn()');
    await f.db2.until(async () => (await f.db2.one(`SELECT pg_last_wal_receive_lsn() >= '${w3}'`)) === 't', 'db2 to receive W3');
    await cutOff(f.db2); // db-2 falls behind too
    const confirmed = [await write(deposit('alice', 60)), await write(deposit('bob', -30))]; // W4, W5: only on db-1
    const leaderHad = [await balance(db1), await balance(db1, 'bob')];
    app.close();
    await db1.stop('immediate'); // the leader dies

    // Which follower takes over? The lesson's query on each one.
    const ps = snippet(REPL, 'who-takes-over', 'psql · on each follower');
    const [posSql, promoteSql] = statements(ps.code);
    const pos = { db2: (await f.db2.sql(posSql)).rows[0], db3: (await f.db3.sql(posSql)).rows[0] };
    const newer = (x: string | null, y: string | null) => f.db2.one(`SELECT '${x}'::pg_lsn > '${y}'::pg_lsn`);
    const db2Ahead = (await newer(pos.db2[0], pos.db3[0])) === 't';
    const db2Unreplayed = (await newer(pos.db2[0], pos.db2[1])) === 't';
    const promoted = await f.db2.one(promoteSql);
    const after = [await balance(f.db2), await balance(f.db2, 'bob')];
    await f.db2.sql('CHECKPOINT');
    const timeline = await f.db2.one('SELECT timeline_id FROM pg_control_checkpoint()');
    // Everyone else follows the new leader.
    await follow(f.db3, f.db2);
    await streaming(f.db2, ['db3']);
    await caughtUp(f.db2, f.db3);
    const db3Now = [await balance(f.db3), await balance(f.db3, 'bob')];

    // Split brain: the old leader reboots exactly as it went down.
    await db1.start();
    const db1Recovery = await db1.one('SELECT pg_is_in_recovery()');
    const splitWrite = await outcome(db1.sql(deposit('bob', 7))); // app-2 still points at db-1
    const newWrite = await outcome(f.db2.sql(deposit('alice', -40)));
    const two = { db1: [await balance(db1), await balance(db1, 'bob')], db2: [await balance(f.db2), await balance(f.db2, 'bob')] };
    await db1.stop('fast');

    // Fencing with the lesson's pg_rewind command.
    const fs = snippet(REPL, 'fencing', 'shell');
    const cmd = plain(fs.code).replace(/\\\n\s*/g, ' ').split('\n').find((l) => l.trim().startsWith('pg_rewind'))!;
    const rewindArgs = (target: string) =>
      shellWords(cmd)
        .slice(1)
        .map((w) =>
          w.startsWith('--target-pgdata=')
            ? `--target-pgdata=${target}`
            : w.startsWith('--source-server=')
              ? `--source-server=${localizeConninfo(w.slice('--source-server='.length), { '10.0.2.12': f.db2 })}`
              : w,
        );
    const copyOf = async (name: string) => {
      const node = new PgNode(name, path.join(pgTmpDir(name), 'data'), await freePort());
      cpSync(db1.dir, node.dir, { recursive: true });
      chmodSync(node.dir, 0o700); // PostgreSQL refuses a data directory others can read
      return node;
    };
    // Without --write-recovery-conf (on a copy): the data is rewound, but it starts up as a leader.
    const bare = await copyOf('db1-bare');
    const bareRun = await sh('pg_rewind', rewindArgs(bare.dir).filter((a) => a !== '--write-recovery-conf'));
    await bare.start();
    const bareRecovery = await bare.one('SELECT pg_is_in_recovery()');
    await bare.stop('immediate');
    // Without wal_log_hints (another copy, last started with it off): pg_rewind refuses.
    const noHints = await copyOf('db1-nohints');
    noHints.conf('wal_log_hints = off');
    await noHints.start();
    await noHints.stop('fast');
    const refused = await sh('pg_rewind', rewindArgs(noHints.dir));
    // The lesson's command, on db-1 itself.
    const rewind = await sh('pg_rewind', rewindArgs(db1.dir));
    await db1.start();
    await db1.until(async () => (await db1.one('SELECT status FROM pg_stat_wal_receiver')) === 'streaming', 'db1 to follow db2');
    await caughtUp(f.db2, db1);
    const fenced = {
      recovery: await db1.one('SELECT pg_is_in_recovery()'),
      balances: [await balance(db1), await balance(db1, 'bob')],
      write: await outcome(db1.sql(deposit('bob', 1))),
    };
    const db2Final = [await balance(f.db2), await balance(f.db2, 'bob')];

    // The animation
    const asked: Asked[] = [];
    const pick = replEnter('who-takes-over');
    replRun(pick, 12, asked);
    const q = asked.find((a) => a.ask.startsWith('Which follower'));
    const nu = pick.leader();
    const vanish = replEnter('writes-that-vanish');
    replRun(vanish, 20);
    const split = replEnter('split-brain');
    replRun(split, 1);
    split.revive('db1');
    replRun(split, 4);
    const fence = replEnter('fencing');
    replRun(fence, 8);

    const lost = confirmed.filter((t) => t === 'UPDATE 1').length;
    const bareMsg = refused.out.split('\n').find((l) => /fatal|error/.test(l)) ?? refused.out.trim();
    const checks = [
      {
        step: 'who-takes-over',
        title: 'Which follower to promote',
        real: `received/replayed: db2 ${pos.db2.join(' / ')}, db3 ${pos.db3.join(' / ')}; promoted db2 (pg_promote → ${promoted}); it replayed the entry it had received but not applied (alice ${after[0]}, bob ${after[1]})`,
        lesson_says: `promote the follower with the most complete log (the animation: "${q?.explain}"); promotion applies everything it received (applied #${nu?.applied} of #${nu?.head})`,
        pass: db2Ahead && db2Unreplayed && promoted === 't' && after[0] === 140 && after[1] === 100 && !!q && nu?.applied === nu?.head,
      },
      {
        step: 'writes-that-vanish',
        title: 'Async: confirmed writes that never left the leader',
        real: `db-1 confirmed 2 more writes (${confirmed.join(', ')}; alice ${leaderHad[0]}, bob ${leaderHad[1]}) that no follower had; after the failover db-2 has alice ${after[0]}, bob ${after[1]}: ${lost} confirmed writes gone`,
        lesson_says: `async replay: ${vanish.m.lost} confirmed write(s) lost in the failover`,
        pass: lost === 2 && leaderHad[0] === 200 && leaderHad[1] === 70 && after[0] === 140 && vanish.m.lost > 0,
      },
      {
        step: 'fencing',
        title: 'The failover starts a new term',
        real: `db-2 now runs on timeline ${timeline} (was 1); db-3, re-pointed at it, caught up (alice ${db3Now[0]}, bob ${db3Now[1]})`,
        lesson_says: `every failover bumps the term (term ${pick.term} after the promotion)`,
        pass: timeline === '2' && db3Now[0] === 140 && db3Now[1] === 100 && pick.term === 2,
      },
      {
        step: 'split-brain',
        title: 'The old leader reboots as a leader',
        real: `pg_is_in_recovery() = ${db1Recovery}; app-2's write → ${splitWrite.ok ? splitWrite.value.tag : splitWrite.error.message}; the promoted db-2 took a write too (${newWrite.ok ? newWrite.value.tag : newWrite.error.message}); db-1 has alice ${two.db1[0]}, bob ${two.db1[1]}; db-2 has alice ${two.db2[0]}, bob ${two.db2[1]}`,
        lesson_says: `${split.leaderCount()} leaders, each with its own balances`,
        pass: db1Recovery === 'f' && splitWrite.ok && newWrite.ok && split.leaderCount() === 2 && two.db1.join() !== two.db2.join(),
      },
      {
        step: 'fencing',
        title: 'pg_rewind without --write-recovery-conf',
        real: `rewound (exit ${bareRun.code}) and started with pg_is_in_recovery() = ${bareRecovery}: a leader again`,
        lesson_says: 'note: without --write-recovery-conf, the rewound node starts up as a leader again',
        pass: bareRun.code === 0 && bareRecovery === 'f',
      },
      {
        step: 'fencing',
        title: 'pg_rewind needs wal_log_hints',
        real: `on a copy last run with wal_log_hints = off: ${bareMsg}`,
        lesson_says: 'note: pg_rewind needs wal_log_hints = on (or data checksums), set before the failover',
        pass: refused.code !== 0 && /wal_log_hints/.test(refused.out),
      },
      {
        step: 'fencing',
        title: 'The lesson’s pg_rewind command',
        real: `exit ${rewind.code}; db-1 came back with pg_is_in_recovery() = ${fenced.recovery}, following db-2: alice ${fenced.balances[0]}, bob ${fenced.balances[1]} (db-2: ${db2Final.join(', ')}); its own writes are gone; app-2's write → ${fenced.write.ok ? fenced.write.value.tag : `ERROR ${fenced.write.error.code} ${fenced.write.error.message}`}`,
        lesson_says: `db-1 steps down (${fence.dbs.get('db1')?.role}), throws away what nobody else has, follows db-2 and refuses writes; ${fence.leaderCount()} leader, ${fence.m.writeErrors} read-only error(s)`,
        pass:
          rewind.code === 0 &&
          fenced.recovery === 't' &&
          fenced.balances.join() === db2Final.join() &&
          !fenced.write.ok &&
          fenced.write.error.code === '25006' &&
          fence.dbs.get('db1')?.role === 'follower' &&
          fence.leaderCount() === 1 &&
          fence.m.writeErrors > 0,
      },
    ];
    for (const c of checks) R.check({ lesson: LESSON.repl, software: PG, ...c });
    for (const c of checks) expect(c.pass, `${c.title}: ${c.real} / ${c.lesson_says}`).toBe(true);
    R.stamp(ps.code, {
      lesson: LESSON.repl,
      by: PG,
      kind: 'ran',
      note: `Ran it on PostgreSQL ${PGV}: after the leader crashed, the follower that had received the most log was promoted, and it replayed what it had received but not yet applied.`,
    });
    R.stamp(fs.code, {
      lesson: LESSON.repl,
      by: PG,
      kind: 'ran',
      note: `Ran it on PostgreSQL ${PGV}: the pg_rewind line threw away the writes nobody else had, and the old leader came back as a read-only follower of db-2. (The pcs line needs Pacemaker and wasn't run.)`,
    });
  });

  test('with a sync follower, a failover keeps every confirmed write (writes-that-vanish)', async () => {
    const { db1, f } = await cluster(['db2']);
    db1.conf(plain(snippet(REPL, 'who-waits-for-whom', 'postgresql.conf · on the leader').code));
    await db1.sql('SELECT pg_reload_conf()');
    await syncStates(db1, { db2: 'sync' });
    const app = await db1.connect({ app: 'app-1' });
    const confirmed: string[] = [];
    for (let i = 0; i < 3; i++) confirmed.push((await app.query(deposit('alice', 10))).tag);
    await cutOff(f.db2); // db-2 stops hearing from the leader
    const inFlight = outcome(app.query(deposit('alice', 99)));
    const waiting = await stillWaiting(inFlight, 1000);
    await db1.stop('immediate'); // the leader dies mid-commit
    const r = await inFlight;
    const promoted = await f.db2.one('SELECT pg_promote()');
    const alice = await balance(f.db2);
    const sim = replEnter('writes-that-vanish');
    sim.replayWith({ sync: true, syncNames: ['db2'] });
    replRun(sim, 20);
    const pass = confirmed.every((t) => t === 'UPDATE 1') && waiting && !r.ok && promoted === 't' && alice === 130 && sim.m.lost === 0 && sim.m.writeErrors > 0;
    R.check({
      lesson: LESSON.repl,
      step: 'writes-that-vanish',
      title: 'Sync to db-2: the failover keeps every confirmed write',
      software: PG,
      real: `3 confirmed writes, all on db-2 after the failover (alice ${alice}); the write caught mid-commit got ${r.ok ? `a confirmation (${r.value.tag})` : `an error (${r.error.code}: ${r.error.message})`}`,
      lesson_says: `sync replay: ${sim.m.lost} confirmed writes lost; ${sim.m.writeErrors} writes failed loudly with an error`,
      pass,
    });
    expect(pass).toBe(true);
  });

  test('a crashed database refuses every query; restarted, it has every commit (single-point-of-failure)', async () => {
    const db1 = await initPrimary('db1');
    await db1.sql(ACCOUNTS);
    const c = await db1.connect();
    for (let i = 0; i < 200; i++) await c.query(deposit('alice', 1));
    c.close();
    await db1.stop('immediate'); // crash: no clean shutdown
    const down = await outcome(db1.sql('SELECT 1'));
    await db1.start();
    const kept = await balance(db1);
    const sim = replEnter('single-point-of-failure');
    replRun(sim, 3);
    const e0 = sim.m.errors;
    const writes = sim.writesSinceBackup();
    sim.crash('db1');
    replRun(sim, 3);
    const failed = sim.m.errors - e0;
    sim.revive('db1');
    replRun(sim, 1);
    const pass = !down.ok && kept === 300 && failed > 0 && sim.writesSinceBackup() >= writes;
    R.check({
      lesson: LESSON.repl,
      step: 'single-point-of-failure',
      title: 'Crash, then restart',
      software: PG,
      real: `while down: ${down.ok ? 'answered?!' : down.error.message}; after the restart all 200 committed deposits were there (alice ${kept})`,
      lesson_says: `every query fails while it's down (${failed} errors); after a restart the data is intact, only downtime was lost`,
      pass,
    });
    expect(pass).toBe(true);
  });
});

/* ================================================================== */
/* Replication: the MySQL lines                                        */
/* ================================================================== */

describe('replication: the MySQL lines', () => {
  const twoLeaders = snippet(REPL, 'multi-leader', 'my.cnf · two MySQL leaders');
  const settingsSnip = snippet(REPL, 'one-sync-rest-async', 'replication settings');
  const semi = replicationSettings(settingsSnip.code);
  /** eu-west's copy of the my.cnf: offset 2, as the comment says. */
  const euLines = (text: string) => text.replace(/^(auto_increment_offset\s*=\s*)1\b/m, (_, head: string) => `${head}2`);
  let us: MyNode;
  let eu: MyNode;

  async function until(check: () => Promise<boolean>, what: string, msTotal = 15_000) {
    const end = Date.now() + msTotal;
    while (!(await check().catch(() => false))) {
      if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
      await sleep(100);
    }
  }
  const both = (sql: string) => Promise.all([us.sql(sql), eu.sql(sql)]);
  const idle = async (n: MyNode) => /waiting for more updates/.test((await n.record('SHOW REPLICA STATUS')).Replica_SQL_Running_State ?? '');

  beforeAll(async () => {
    us = await startMysql('us-east', 1, `${plain(twoLeaders.code)}\n${semi.source}`);
    eu = await startMysql('eu-west', 2, `${euLines(plain(twoLeaders.code))}\n${semi.replica}`);
    // Replicate both ways (multi-leader), before any writes, so semi-sync has its replica from the start.
    const [usLog] = await us.rows('SHOW BINARY LOG STATUS');
    const [euLog] = await eu.rows('SHOW BINARY LOG STATUS');
    const from = (src: MyNode, [file, pos]: string[]) =>
      `CHANGE REPLICATION SOURCE TO SOURCE_HOST='127.0.0.1', SOURCE_PORT=${src.port}, SOURCE_USER='root', SOURCE_PASSWORD='', SOURCE_SSL=1, SOURCE_LOG_FILE='${file}', SOURCE_LOG_POS=${pos}; START REPLICA;`;
    for (const [n, q] of [
      [eu, from(us, usLog)],
      [us, from(eu, euLog)],
    ] as const) {
      const r = await n.sql(q);
      if (!r.ok) throw new Error(r.out);
    }
    await until(async () => (await us.status('Rpl_semi_sync_source_clients')) === '1', 'eu-west to connect as a semi-sync replica');
    const r = await us.sql(
      `CREATE DATABASE shop; CREATE TABLE shop.orders (id INT AUTO_INCREMENT PRIMARY KEY, region VARCHAR(8)); CREATE TABLE shop.accounts (id VARCHAR(16) PRIMARY KEY, balance INT); INSERT INTO shop.accounts VALUES ('alice', 100);`,
    );
    if (!r.ok) throw new Error(r.out);
    await until(async () => (await eu.rows(`SELECT balance FROM shop.accounts WHERE id = 'alice'`))[0]?.[0] === '100', 'the schema to reach eu-west');
  }, 120_000);

  afterAll(async () => {
    await stopAllMysql();
  });

  test('two leaders hand out odd and even IDs (multi-leader)', async () => {
    const valid = [await mysqlValidate(plain(twoLeaders.code)), await mysqlValidate(euLines(plain(twoLeaders.code)))];
    // Both regions insert at the same moment: neither has seen the other's rows yet.
    await both('STOP REPLICA SQL_THREAD');
    await Promise.all([us.sql(`INSERT INTO shop.orders (region) VALUES ('us'), ('us'), ('us')`), eu.sql(`INSERT INTO shop.orders (region) VALUES ('eu'), ('eu'), ('eu')`)]);
    const ids = async (n: MyNode, region: string) => (await n.rows(`SELECT id FROM shop.orders WHERE region = '${region}' ORDER BY id`)).map((r) => Number(r[0]));
    const usIds = await ids(us, 'us');
    const euIds = await ids(eu, 'eu');
    await both('START REPLICA SQL_THREAD');
    await until(async () => (await us.rows('SELECT count(*) FROM shop.orders'))[0][0] === '6' && (await eu.rows('SELECT count(*) FROM shop.orders'))[0][0] === '6', 'both leaders to have all 6 rows');
    const all = async (n: MyNode) => (await n.rows('SELECT id, region FROM shop.orders ORDER BY id')).map((r) => r.join(':')).join(' ');
    const merged = [await all(us), await all(eu)];
    const errs = [(await us.record('SHOW REPLICA STATUS')).Last_SQL_Errno, (await eu.record('SHOW REPLICA STATUS')).Last_SQL_Errno];
    // After seeing each other's rows, each continues from the highest ID it has.
    const next = async (n: MyNode, region: string) => Number((await n.rows(`INSERT INTO shop.orders (region) VALUES ('${region}'); SELECT LAST_INSERT_ID();`))[0][0]);
    const nextUs = await next(us, 'us');
    const nextEu = await next(eu, 'eu');
    const pass =
      valid.every((v) => v.ok) &&
      usIds.join() === '1,3,5' &&
      euIds.join() === '2,4,6' &&
      merged[0] === merged[1] &&
      merged[0] === '1:us 2:eu 3:us 4:eu 5:us 6:eu' &&
      errs.every((e) => e === '0') &&
      nextUs % 2 === 1 &&
      nextEu % 2 === 0;
    R.check({
      lesson: LESSON.repl,
      step: 'multi-leader',
      title: 'Two leaders inserting at the same time',
      software: MY,
      real: `us-east got ${usIds.join(', ')}, eu-west ${euIds.join(', ')}; after replicating both ways each had ${merged[0]}, no duplicate-key error; later inserts continued from the highest ID seen (us-east ${nextUs}, eu-west ${nextEu})`,
      lesson_says: 'us-east: 1, 3, 5… (eu-west uses 2: 2, 4, 6…)',
      pass,
    });
    expect(pass).toBe(true);
    R.stamp(twoLeaders.code, {
      lesson: LESSON.repl,
      by: MY,
      kind: 'ran',
      note: `Ran it on MySQL ${MYV}: with two leaders replicating to each other, us-east handed out 1, 3, 5 and eu-west (offset 2) 2, 4, 6. Both ended up with all six rows and no collisions.`,
    });
  });

  test('two leaders change the same row at the same time (multi-leader)', async () => {
    await both('STOP REPLICA SQL_THREAD');
    await us.sql(`UPDATE shop.accounts SET balance = balance + 50 WHERE id = 'alice'`);
    await eu.sql(`UPDATE shop.accounts SET balance = balance + 20 WHERE id = 'alice'`);
    await both('START REPLICA SQL_THREAD');
    await until(async () => (await idle(us)) && (await idle(eu)), 'both appliers to catch up');
    await sleep(300);
    await until(async () => (await idle(us)) && (await idle(eu)), 'both appliers to stay caught up');
    const bal = async (n: MyNode) => Number((await n.rows(`SELECT balance FROM shop.accounts WHERE id = 'alice'`))[0][0]);
    const final = { us: await bal(us), eu: await bal(eu) };
    const st = [await us.record('SHOW REPLICA STATUS'), await eu.record('SHOW REPLICA STATUS')];
    const sim = replEnter('multi-leader');
    replRun(sim, 8);
    const c = sim.conflicts[0];
    const pass = final.us !== final.eu && st.every((x) => x.Replica_SQL_Running === 'Yes' && x.Last_SQL_Errno === '0');
    R.check({
      lesson: LESSON.repl,
      step: 'multi-leader',
      title: 'A write conflict between two MySQL leaders',
      software: MY,
      real: `us-east ended with ${final.us}, eu-west with ${final.eu}: each applied the other's row over its own; replication kept running with no error on either side`,
      lesson_says: `note: MySQL doesn’t resolve conflicts; the leaders can end up with different balances and nothing reports an error (the animation's generic leaders use last write wins: both → ${c ? `$${c.final}` : '?'})`,
      pass,
    });
    expect(pass).toBe(true);
  });

  test('SHOW REPLICA STATUS: Seconds_Behind_Source while replay is held up (followers-run-behind)', async () => {
    const s = snippet(REPL, 'followers-run-behind', 'psql · on the leader');
    const stmt = statements(s.code).find((x) => x.startsWith('SHOW REPLICA STATUS'))!;
    // A long transaction on the replica (eu-west) holds the row the applier needs.
    const holder = eu.sql(`BEGIN; SELECT balance FROM shop.accounts WHERE id = 'alice' FOR UPDATE; DO SLEEP(3.5); COMMIT;`);
    await sleep(300);
    await us.sql(`UPDATE shop.accounts SET balance = balance + 1 WHERE id = 'alice'`);
    let worst = 0;
    const t0 = Date.now();
    while (Date.now() - t0 < 4500) {
      const v = Number((await eu.record(stmt)).Seconds_Behind_Source);
      if (Number.isFinite(v)) worst = Math.max(worst, v);
      await sleep(250);
    }
    await holder;
    await until(async () => (await eu.record(stmt)).Seconds_Behind_Source === '0' && (await idle(eu)), 'eu-west to catch up');
    const pass = worst >= 2;
    R.check({
      lesson: LESSON.repl,
      step: 'followers-run-behind',
      title: 'Seconds_Behind_Source while a long transaction holds up the replica',
      software: MY,
      real: `Seconds_Behind_Source rose to ${worst} while a 3.5 s transaction on the replica held the row, then went back to 0`,
      lesson_says: 'SHOW REPLICA STATUS; -- Seconds_Behind_Source: 2',
      pass,
    });
    expect(pass).toBe(true);
    R.stamp(s.code, {
      lesson: LESSON.repl,
      by: MY,
      kind: 'ran',
      note: `Ran it on MySQL ${MYV}: while a long transaction on the replica held up the applier, Seconds_Behind_Source climbed past 2, then fell back to 0.`,
    });
  });

  test('semi-sync waits for a replica, then falls back to async after the timeout (one-sync-rest-async)', async () => {
    const valid = { source: await mysqlValidate(semi.source), replica: await mysqlValidate(semi.replica) };
    const withoutPlugin = await mysqlValidate(
      semi.source
        .split('\n')
        .filter((l) => !l.startsWith('plugin-load-add'))
        .join('\n'),
    );
    const timeout = await mysqlDefault('rpl_semi_sync_source_timeout', ['semisync_source.so']);
    const status0 = await us.status('Rpl_semi_sync_source_status');
    const clients = await us.status('Rpl_semi_sync_source_clients');
    const fast = await us.sql(`INSERT INTO shop.orders (region) VALUES ('us')`);
    await eu.sql('STOP REPLICA');
    const slow = await us.sql(`INSERT INTO shop.orders (region) VALUES ('us')`);
    const status1 = await us.status('Rpl_semi_sync_source_status');
    const next = await us.sql(`INSERT INTO shop.orders (region) VALUES ('us')`);
    await eu.sql('START REPLICA');
    let back = false;
    await until(async () => (back = (await us.status('Rpl_semi_sync_source_status')) === 'ON'), 'semi-sync to switch back on').catch(() => undefined);
    const pass =
      valid.source.ok &&
      valid.replica.ok &&
      !withoutPlugin.ok &&
      timeout === '10000' &&
      status0 === 'ON' &&
      clients === '1' &&
      fast.ok &&
      fast.ms < 1500 &&
      slow.ok &&
      slow.ms >= 9500 &&
      slow.ms < 14_000 &&
      status1 === 'OFF' &&
      next.ms < 1500 &&
      back;
    R.check({
      lesson: LESSON.repl,
      step: 'one-sync-rest-async',
      title: 'MySQL semi-sync, then the timeout',
      software: MY,
      real: `semi-sync ON with ${clients} replica; a commit took ${ms(fast.ms)}. Replica stopped: the next commit took ${(slow.ms / 1000).toFixed(1)} s, semi-sync switched ${status1}, the one after took ${ms(next.ms)}; ON again once the replica reconnected. Default timeout ${timeout} ms. Without plugin-load-add, mysqld refuses the lines: ${withoutPlugin.errors[0] ?? '?'}`,
      lesson_says: 'the leader waits until at least one replica has the entry; gives up after a timeout (10 seconds by default) and falls back to async',
      pass,
    });
    expect(pass).toBe(true);
    R.stamp(settingsSnip.code, {
      lesson: LESSON.repl,
      by: MY,
      kind: 'ran',
      note: `Ran it on MySQL ${MYV}: commits waited for the replica's ack; with the replica stopped, one commit waited out the 10 s timeout, then the source fell back to async until the replica returned.`,
    });
  });
});

/* ================================================================== */
/* Sharding                                                            */
/* ================================================================== */

describe('sharding on real PostgreSQL', () => {
  test('a replica is a full copy that replays every write (copies-dont-add-room)', async () => {
    const s = snippet(SHARD, 'copies-dont-add-room', 'postgresql.conf · on each replica');
    const primary = await initPrimary('primary');
    await primary.sql(
      `CREATE ROLE replicator WITH REPLICATION LOGIN; CREATE TABLE orders (id bigserial PRIMARY KEY, customer_id int NOT NULL, total numeric(10,2) NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`,
    );
    const replica = await baseBackup(primary, 'replica', { start: false });
    replica.conf(localizeConninfo(plain(s.code), { '10.0.2.10': primary }));
    touch(path.join(replica.dir, 'standby.signal'));
    await replica.start();
    await primary.sql(`INSERT INTO orders (customer_id, total) SELECT (g % 500) + 1, (g % 97) + 0.99 FROM generate_series(1, 20000) g`);
    await caughtUp(primary, replica);
    const size = (n: PgNode) => n.one(`SELECT pg_relation_size('orders') + pg_relation_size('orders_pkey')`);
    const sizes = [await size(primary), await size(replica)];
    const rows = await replica.one('SELECT count(*) FROM orders');
    const write = await outcome(replica.sql(`INSERT INTO orders (customer_id, total) VALUES (1, 1)`));
    const hot = await replica.one('SHOW hot_standby');
    const pretty = await primary.one(`SELECT pg_size_pretty(${sizes[0]}::bigint)`);
    const pass = sizes[0] === sizes[1] && rows === '20000' && !write.ok && write.error.code === '25006' && hot === 'on';
    R.check({
      lesson: LESSON.shard,
      step: 'copies-dont-add-room',
      title: 'A replica holds all the data and replays every write',
      software: PG,
      real: `after 20,000 inserts on the primary, orders (heap + index) is ${pretty} on both, byte for byte the same size; the replica served SELECT count(*) = ${rows} and refused an INSERT (${write.ok ? write.value.tag : write.error.code})`,
      lesson_says: 'every replica holds all of the data, so its disk is as full as the primary’s, and replays every write',
      pass,
    });
    expect(pass).toBe(true);
    R.stamp(s.code, {
      lesson: LESSON.shard,
      by: PG,
      kind: 'ran',
      note: `Ran it on PostgreSQL ${PGV}: with these lines and an empty standby.signal, the replica served reads, refused writes, and after replaying the primary's inserts its orders table was exactly as big as the primary's.`,
    });
  });

  test('every shard runs the same schema but holds a different slice (split-the-rows)', async () => {
    const s = snippet(SHARD, 'split-the-rows', 'schema.sql');
    const [create, minmax] = statements(s.code);
    const db = await initPrimary('shards');
    for (let i = 0; i < 4; i++) await db.sql(`CREATE DATABASE shard${i}`);
    for (let i = 0; i < 4; i++) await db.sql(create, `shard${i}`);
    // The lesson's own users, routed by the lesson's own rule (first letter).
    for (let i = 0; i < 4; i++) {
      const mine = NAMES.filter((n) => nameShard(n) === i);
      if (mine.length) await db.sql(`INSERT INTO users VALUES ${mine.map((n) => `('${n}', '${n}@example.com')`).join(', ')}`, `shard${i}`);
    }
    const got = (await db.sql(minmax, 'shard0')).rows[0];
    const shown = /--\s*(\w+)\s*\|\s*(\w+)/.exec(plain(s.code))!.slice(1);
    const counts: number[] = [];
    const everyone = new Set<string>();
    for (let i = 0; i < 4; i++) {
      const names = (await db.sql('SELECT username FROM users', `shard${i}`)).rows.map((r) => r[0]!);
      counts.push(names.length);
      names.forEach((n) => everyone.add(n));
    }
    const pass = got.join() === shown.join() && everyone.size === NAMES.length && counts.reduce((a, b) => a + b, 0) === NAMES.length;
    R.check({
      lesson: LESSON.shard,
      step: 'split-the-rows',
      title: 'The slice on shard-0',
      software: PG,
      real: `min, max on shard-0: ${got.join(' | ')}; ${counts.join(' + ')} users over 4 shards, each exactly once`,
      lesson_says: `-- ${shown.join(' | ')}`,
      pass,
    });
    expect(pass).toBe(true);
    R.stamp(s.code, {
      lesson: LESSON.shard,
      by: PG,
      kind: 'ran',
      note: `Ran it on PostgreSQL ${PGV}: with four shard databases and the lesson's users split by first letter, shard-0 answered alice | frank.`,
    });
  });

  test('a query with the shard key touches one shard, anything else all of them (what-hashing-costs, keep-related-together, pick-a-key)', async () => {
    const s = snippet(SHARD, 'what-hashing-costs', 'queries.sql');
    const [byCustomer, report] = statements(s.code);
    const db = await initPrimary('parts');
    // Partitions stand in for shards: PostgreSQL's planner routes by the partition key the way a shard router does.
    await db.sql(
      `CREATE TABLE orders (order_id bigint, customer_id int NOT NULL, total numeric(10,2), status text, created_at timestamptz NOT NULL) PARTITION BY HASH (customer_id)`,
    );
    for (let i = 0; i < 4; i++) await db.sql(`CREATE TABLE orders_s${i} PARTITION OF orders FOR VALUES WITH (MODULUS 4, REMAINDER ${i})`);
    await db.sql(
      `INSERT INTO orders SELECT g, (g * 7919) % 2000 + 1, (g % 300) + 0.5, CASE WHEN g % 3 = 0 THEN 'paid' ELSE 'new' END, timestamptz '2023-01-01' + (g % 1360) * interval '1 day' FROM generate_series(1, 20000) g`,
    );
    await db.sql(`CREATE TABLE orders_by_year (LIKE orders) PARTITION BY RANGE (created_at)`);
    for (const y of YEARS) await db.sql(`CREATE TABLE orders_y${y} PARTITION OF orders_by_year FOR VALUES FROM ('${y}-01-01') TO ('${y + 1}-01-01')`);
    await db.sql(`INSERT INTO orders_by_year SELECT * FROM orders; ANALYZE orders; ANALYZE orders_by_year`);
    const touched = async (q: string) => new Set([...(await db.sql(`EXPLAIN (COSTS OFF) ${q}`)).rows.map((r) => r[0]).join('\n').matchAll(/orders_(s\d|y\d{4})/g)].map((m) => m[1])).size;
    const hash = { byCustomer: await touched(byCustomer), report: await touched(report) };
    const predicted = [];
    for (const q of PREDICT_QUERIES) predicted.push({ q, n: await touched(q.sql) });
    const byYear = { report: await touched(report.replace('FROM orders', 'FROM orders_by_year')), alice: await touched('SELECT * FROM orders_by_year WHERE customer_id = 42') };
    // New orders are created today: where do they land?
    const count = async () => (await db.sql(`SELECT tableoid::regclass, count(*) FROM orders_by_year GROUP BY 1 ORDER BY 1`)).rows.map((r) => `${r[0]}=${r[1]}`);
    const before = await count();
    await db.sql(`INSERT INTO orders_by_year SELECT 30000 + g, g, 10, 'new', timestamptz '${TODAY}' + g * interval '1 second' FROM generate_series(1, 500) g`);
    const after = await count();
    const grew = after.filter((x, i) => x !== before[i]).map((x) => x.split('=')[0]);
    const checks = [
      {
        step: 'what-hashing-costs',
        title: 'queries.sql on four hash partitions',
        real: `customer_id = 1042 → ${hash.byCustomer} of 4 partitions; created_at >= '2026-09-01' → ${hash.report} of 4`,
        lesson_says: '-- 1 shard / -- every shard',
        pass: hash.byCustomer === 1 && hash.report === 4,
      },
      {
        step: 'keep-related-together',
        title: 'How many shards each prediction query needs',
        real: predicted.map((p) => `${p.q.short} → ${p.n}`).join('; '),
        lesson_says: predicted.map((p) => `${p.q.short} → ${p.q.kind === 'key' ? 1 : 'all'}`).join('; '),
        pass: predicted.every((p) => p.n === (p.q.kind === 'key' ? 1 : 4)),
      },
      {
        step: 'pick-a-key',
        title: 'Range of created_at instead',
        real: `the report → ${byYear.report} partition, customer_id = 42 → ${byYear.alice}; 500 orders created today all went to ${grew.join(', ')}`,
        lesson_says: 'the report asks 1 shard, Alice’s orders all 4, and every new write hits the 2026 shard',
        pass: byYear.report === 1 && byYear.alice === 4 && grew.join() === 'orders_y2026',
      },
    ];
    for (const c of checks) R.check({ lesson: LESSON.shard, software: PG, ...c });
    for (const c of checks) expect(c.pass, `${c.title}: ${c.real}`).toBe(true);
    R.stamp(s.code, {
      lesson: LESSON.shard,
      by: PG,
      kind: 'ran',
      note: `Ran it on PostgreSQL ${PGV}: with orders hash-partitioned four ways on customer_id (partitions standing in for shards), the first query touched 1 partition and the report all 4.`,
    });
  });

  test('moving one tenant is one UPDATE (directory)', async () => {
    const s = snippet(SHARD, 'directory', 'directory.sql');
    const [create, select, update] = statements(s.code);
    const db = await initPrimary('dir');
    await db.sql(create);
    await db.sql(`INSERT INTO tenant_shard VALUES ${Object.entries(DIR_START).map(([t, n]) => `('${t}', ${n})`).join(', ')}`);
    const before = await db.one(select);
    const tag = (await db.sql(update)).tag;
    const after = await db.one(select);
    const others = (await db.sql(`SELECT tenant, shard FROM tenant_shard WHERE tenant <> 'acme' ORDER BY tenant`)).rows.map((r) => `${r[0]}→${r[1]}`).join(' ');
    const expected = Object.entries(DIR_START)
      .filter(([t]) => t !== 'acme')
      .sort()
      .map(([t, n]) => `${t}→${n}`)
      .join(' ');
    const shown = /--\s*(\d+)/.exec(plain(s.code))?.[1];
    const pass = before === shown && tag === 'UPDATE 1' && after === '4' && others === expected;
    R.check({
      lesson: LESSON.shard,
      step: 'directory',
      title: 'Give acme its own shard',
      software: PG,
      real: `acme → ${before}; ${tag}; acme → ${after}; everyone else unchanged (${others})`,
      lesson_says: `acme → ${shown}, then one entry flips to acme → 4; no other tenant moves`,
      pass,
    });
    expect(pass).toBe(true);
    R.stamp(s.code, {
      lesson: LESSON.shard,
      by: PG,
      kind: 'ran',
      note: `Ran it on PostgreSQL ${PGV}: with the lesson's tenants loaded, acme's lookup returned 0, the UPDATE changed exactly one row, and no other tenant moved.`,
    });
  });

  test('merge partial sums, don’t average the averages (scatter-gather)', async () => {
    const s = snippet(SHARD, 'scatter-gather', 'avg.sql');
    const [appAvg, partial] = statements(s.code);
    const db = await initPrimary('avg');
    const shards = [
      { n: 10, total: 500 },
      { n: 2000, total: 20 },
      { n: 50, total: 80 },
      { n: 3, total: 1000 },
    ];
    await db.sql('CREATE DATABASE whole');
    await db.sql('CREATE TABLE orders (total numeric NOT NULL)', 'whole');
    for (const [i, sh0] of shards.entries()) {
      await db.sql(`CREATE DATABASE shard${i}`);
      const fill = `INSERT INTO orders SELECT ${sh0.total} + (g % 5) FROM generate_series(1, ${sh0.n}) g`;
      await db.sql(`CREATE TABLE orders (total numeric NOT NULL); ${fill}`, `shard${i}`);
      await db.sql(fill, 'whole');
    }
    const parts = [];
    for (let i = 0; i < shards.length; i++) parts.push((await db.sql(partial, `shard${i}`)).rows[0].map(Number));
    const merged = parts.reduce((a, p) => a + p[0], 0) / parts.reduce((a, p) => a + p[1], 0);
    const truth = Number(await db.one(appAvg, 'whole'));
    const avgOfAvgs = parts.reduce((a, p) => a + p[0] / p[1], 0) / parts.length;
    const pass = Math.abs(merged - truth) < 1e-9 && Math.abs(avgOfAvgs - truth) > 1;
    R.check({
      lesson: LESSON.shard,
      step: 'scatter-gather',
      title: 'Merging partial results',
      software: PG,
      real: `avg over all rows ${truth.toFixed(4)}; sum of sums / sum of counts ${merged.toFixed(4)}; average of the four averages ${avgOfAvgs.toFixed(4)}`,
      lesson_says: 'sum of the sums / sum of the counts; you can’t average the averages',
      pass,
    });
    expect(pass).toBe(true);
    R.stamp(s.code, {
      lesson: LESSON.shard,
      by: PG,
      kind: 'ran',
      note: `Ran it on PostgreSQL ${PGV}: over four shards of very different sizes, the merged sums and counts gave exactly avg(total) of all rows; averaging the averages was far off.`,
    });
  });

  test('two-phase commit: prepared transactions wait, holding their locks (transactions)', async () => {
    const s = snippet(SHARD, 'transactions', 'transfer.sql · PostgreSQL');
    const all = statements(s.code);
    const commitSql = all.find((x) => x.startsWith('COMMIT PREPARED'))!;
    const phase1 = all.slice(0, all.indexOf(commitSql));
    const onShard2 = (q: string) => q.replace(`balance - 50 WHERE id = 'alice'`, `balance + 50 WHERE id = 'bob'`);
    const shard0 = await initPrimary('shard0');
    const shard2 = await initPrimary('shard2', 'max_prepared_transactions = 10');
    await shard0.sql(`CREATE TABLE accounts (id text PRIMARY KEY, balance int NOT NULL); INSERT INTO accounts VALUES ('alice', 100)`);
    await shard2.sql(`CREATE TABLE accounts (id text PRIMARY KEY, balance int NOT NULL); INSERT INTO accounts VALUES ('bob', 80)`);
    // The note: it needs max_prepared_transactions > 0 (the default is 0).
    const c0 = await shard0.connect({ app: 'coordinator' });
    let disabled: string | null = null;
    for (const q of phase1) {
      const r = await outcome(c0.query(q));
      if (!r.ok) disabled = `${r.error.code}: ${r.error.message}`;
    }
    c0.close();
    shard0.conf('max_prepared_transactions = 10');
    await shard0.stop('fast');
    await shard0.start();
    // Phase 1 on both shards: each does its half and votes YES.
    const coord = [await shard0.connect({ app: 'coordinator' }), await shard2.connect({ app: 'coordinator' })];
    const tags: string[] = [];
    for (const q of phase1) tags.push((await coord[0].query(q)).tag);
    for (const q of phase1) tags.push((await coord[1].query(onShard2(q))).tag);
    // The coordinator crashes: its connections drop.
    coord.forEach((c) => c.close());
    await sleep(200);
    const inDoubt = [await shard0.one('SELECT gid FROM pg_prepared_xacts'), await shard2.one('SELECT gid FROM pg_prepared_xacts')];
    const writer = await shard0.connect({ app: 'another request' });
    const blocked = outcome(writer.query(deposit('alice', 1)));
    const writeWaits = await stillWaiting(blocked, 800);
    const read = await outcome(shard0.sql(`SELECT balance FROM accounts WHERE id = 'alice'`));
    // Restart shard-0: the YES vote is durable, and so are its locks.
    await shard0.stop('fast');
    await blocked;
    await shard0.start();
    const afterRestart = await shard0.one('SELECT gid FROM pg_prepared_xacts');
    const writer2 = await shard0.connect({ app: 'another request' });
    const blocked2 = outcome(writer2.query(deposit('alice', 1)));
    const waitsAgain = await stillWaiting(blocked2, 800);
    // The coordinator comes back, reads COMMIT in its log and finishes the job.
    const done = [(await shard0.sql(commitSql)).tag, (await shard2.sql(commitSql)).tag];
    const unblocked = await blocked2;
    writer.close();
    writer2.close();
    const final = [await balance(shard0), await balance(shard2, 'bob')];

    // The animation
    const { chapter, step } = (() => {
      for (const c of SHARD_CHAPTERS) {
        const st = c.steps.find((x) => x.id === 'transactions');
        if (st) return { chapter: c, step: st };
      }
      throw new Error('no transactions step');
    })();
    const sim = new ShardSim();
    sim.setSize(1100, 640);
    sim.enter({ ...SHARD_DEFAULTS, ...chapter.cfg, ...step.cfg }, step.script, { seed: step.seed });
    const play = (sec: number) => {
      for (let t = 0; t < sec; t += 1 / 60) sim.advance(1 / 60, true, 1);
    };
    play(8);
    sim.runTransfer(true);
    play(10);
    const stuck = sim.tpc.crashed && sim.tpc.notes.some((n) => /in doubt|wait/.test(n.text)) && sim.tpc.spans.every((x) => x.t1 == null);
    sim.recoverCoordinator();
    play(6);
    const finished = sim.tpc.done && sim.tpc.spans.every((x) => x.t1 != null);
    const checks = [
      {
        title: 'Needs max_prepared_transactions > 0',
        real: `with the default: ${disabled ?? 'PREPARE worked?!'}`,
        lesson_says: 'Needs max_prepared_transactions > 0.',
        pass: disabled?.startsWith('55000') ?? false,
      },
      {
        title: 'The coordinator crashes after both votes',
        real: `phase 1: ${tags.join(', ')}; after the crash both shards still hold ${inDoubt.join(' and ')}; a write to alice waited; after restarting shard-0 it was still prepared (${afterRestart}) and writes still waited (${waitsAgain})`,
        lesson_says: `the shards wait in doubt, holding their locks (animation: ${stuck ? 'both "in doubt: wait", locks held' : 'not stuck?'})`,
        pass: inDoubt.every((g) => g === 'transfer-7731') && writeWaits && afterRestart === 'transfer-7731' && waitsAgain && stuck,
      },
      {
        title: 'Reads during the doubt',
        real: `a plain SELECT on alice returned ${read.ok ? read.value.rows[0][0] : read.error.message} in ${ms(read.ms)} while an UPDATE waited`,
        lesson_says: 'Any write to Alice’s or Bob’s row is stuck behind those locks. Plain reads still get the old balances.',
        pass: read.ok && read.value.rows[0][0] === '100' && read.ms < 500 && writeWaits,
      },
      {
        title: 'The coordinator restarts and commits',
        real: `${done.join(', ')}; the waiting write went through (${unblocked.ok ? unblocked.value.tag : unblocked.error.message}); alice ${final[0]}, bob ${final[1]}`,
        lesson_says: `it finishes the commit; nothing lost (animation: ${finished ? 'COMMIT sent, locks released' : 'not finished?'})`,
        pass: done.every((t) => t === 'COMMIT PREPARED') && unblocked.ok && final[0] === 51 && final[1] === 130 && finished,
      },
    ];
    for (const c of checks) R.check({ lesson: LESSON.shard, step: 'transactions', software: PG, ...c });
    for (const c of checks) expect(c.pass, `${c.title}: ${c.real}`).toBe(true);
    R.stamp(s.code, {
      lesson: LESSON.shard,
      by: PG,
      kind: 'ran',
      note: `Ran it on PostgreSQL ${PGV}: on two shards, after PREPARE the coordinator disconnected; both transactions stayed prepared (even across a shard restart) and writes to the two rows waited until COMMIT PREPARED.`,
    });
  });

  test('the size format in the psql output (one-machine)', async () => {
    const s = snippet(SHARD, 'one-machine', 'shell');
    const lines = plain(s.code).split('\n');
    const cmd = shellWords(lines.find((l) => l.startsWith('$ psql'))!.slice(2));
    const shown = lines[lines.findIndex((l) => l.startsWith('$ psql')) + 1].trim();
    const db = await initPrimary('shop');
    await db.sql('CREATE DATABASE shop');
    await db.sql(`CREATE TABLE orders (id bigserial PRIMARY KEY, total numeric); INSERT INTO orders (total) SELECT g FROM generate_series(1, 1000) g`, 'shop');
    const run = await sh(cmd[0], ['-X', '-h', '127.0.0.1', '-p', String(db.port), '-U', 'postgres', ...cmd.slice(1)]);
    const gb = Number(shown.split(' ')[0]);
    const pretty = await db.one(`SELECT pg_size_pretty(${gb}::bigint * 1024 * 1024 * 1024)`);
    const pass = run.code === 0 && /^\d+ (bytes|kB|MB|GB|TB)$/.test(run.out.trim()) && pretty === shown;
    R.check({
      lesson: LESSON.shard,
      step: 'one-machine',
      title: 'What the psql command prints',
      software: PG,
      real: `on a small table it printed "${run.out.trim()}"; pg_size_pretty of ${gb} GiB prints "${pretty}"`,
      lesson_says: shown,
      pass,
    });
    expect(pass).toBe(true);
  });
});

/* ================================================================== */
/* Race conditions: two sessions, one row                              */
/* ================================================================== */

describe('race conditions on real PostgreSQL', () => {
  async function bank() {
    const db = await initPrimary('race');
    await db.sql(
      `CREATE TABLE accounts (id int PRIMARY KEY, balance int NOT NULL, version int NOT NULL); INSERT INTO accounts VALUES (1, 100, 7); CREATE TABLE seats (id text PRIMARY KEY, owner text); INSERT INTO seats VALUES ('14C', NULL)`,
    );
    return db;
  }

  /**
   * Replay the animation's own interleaving against PostgreSQL: each chip on
   * its timeline becomes the snippet's SQL in that thread's session. Returns
   * the chips again, written from what PostgreSQL answered.
   */
  async function replay(db: PgNode, kind: 'seat' | 'bank', mode: string, spec: CodeSpec, chips: Chip[]) {
    const st = statements(spec.code);
    const find = (re: RegExp) => st.find((q) => re.test(q))!;
    const as = (tid: string, q: string) => (tid === 'B' ? q.replaceAll(`'alice'`, `'bob'`) : q);
    const sess: Record<string, PgConn> = {
      A: await db.connect({ app: kind === 'seat' ? 'alice' : 'atm' }),
      B: await db.connect({ app: kind === 'seat' ? 'bob' : 'app' }),
    };
    const pending: Record<string, Promise<Result> | undefined> = {};
    const b: Record<string, number> = {};
    const out: string[] = [];
    const notes: string[] = [];
    const ok: Record<string, boolean> = { A: false, B: false };
    for (const chip of chips) {
      const t = chip.tid;
      const c = sess[t];
      let val: string | undefined;
      const rowOf = (r: Result) => r.rows[0] ?? [];
      if (kind === 'bank') {
        const select = find(/^SELECT/);
        const update = find(/^UPDATE/);
        if (chip.code === 'SEL' && pending[t]) {
          val = rowOf(await pending[t]!)[0] ?? '';
          b[t] = Number(val);
          pending[t] = undefined;
        } else if (chip.code === 'SEL') {
          if (mode !== 'optimistic') await c.query('BEGIN');
          const p = c.query(select);
          if (chip.val === 'wait') {
            const waits = await stillWaiting(p, 500);
            pending[t] = p;
            val = waits ? 'wait' : 'no wait';
            // The snippet's comment: only other FOR UPDATE readers wait. A plain read doesn't.
            const plainRead = await outcome(db.sql(`SELECT balance FROM accounts WHERE id = 1`));
            notes.push(`plain SELECT meanwhile: ${plainRead.ok ? plainRead.value.rows[0][0] : plainRead.error.message} in ${ms(plainRead.ms)}`);
          } else {
            const r = rowOf(await p);
            b[t] = Number(r[0]);
            val = r.join(', ');
          }
        } else if (chip.code === 'IF') {
          val = b[t] >= 80 ? 'yes' : 'no';
        } else if (chip.code === 'UPD' && mode === 'optimistic') {
          const tag = (await c.query(update)).tag;
          val = tag === 'UPDATE 1' ? 'ok' : 'retry';
          ok[t] = tag === 'UPDATE 1';
        } else if (chip.code === 'UPD') {
          await c.query(update);
          val = rowOf(await c.query(`SELECT balance FROM accounts WHERE id = 1`))[0] ?? '';
          ok[t] = true;
          if (mode === 'racy') await c.query('COMMIT');
        } else if (chip.code === 'COM') {
          await c.query('COMMIT');
        }
      } else {
        const update = find(/^UPDATE/);
        if (chip.code === 'RD') {
          const owner = rowOf(await c.query(find(/^SELECT/)))[0];
          b[t] = owner == null ? 1 : 0;
          val = owner ?? 'free';
        } else if (chip.code === 'IF') {
          val = b[t] ? 'yes' : 'no';
        } else if (chip.code === 'WR') {
          await c.query(as(t, update));
          val = rowOf(await c.query(`SELECT owner FROM seats WHERE id = '14C'`))[0] ?? '';
          ok[t] = true;
        } else if (chip.code === 'BOOK') {
          const tag = (await c.query(as(t, update))).tag;
          val = tag === 'UPDATE 1' ? 'ok' : 'no';
          ok[t] = tag === 'UPDATE 1';
        }
      }
      out.push(chipText({ ...chip, val }));
    }
    Object.values(sess).forEach((c) => c.close());
    let cells: Record<string, string | number>;
    if (kind === 'bank') {
      const [bal, version] = (await db.sql(`SELECT balance, version FROM accounts WHERE id = 1`)).rows[0].map(Number);
      cells = { balance: bal, version };
    } else cells = { seat: (await db.one(`SELECT owner FROM seats WHERE id = '14C'`)) ?? 'free' };
    return { chips: out.join(' '), ok, cells, notes };
  }

  const cases = [
    ...SEAT_MODES.map((m) => ({ kind: 'seat' as const, step: 'check-then-act', m })),
    ...BANK_MODES.map((m) => ({ kind: 'bank' as const, step: 'double-spend', m })),
  ];
  const notes: Record<string, string> = {
    'seat:racy': 'both read NULL, both UPDATEs went through, and the row ended up saying bob',
    'seat:atomic': 'the first UPDATE matched 1 row and the second 0',
    'bank:racy': 'both read 100, both passed the check, both wrote 20',
    'bank:forupdate': 'the second SELECT … FOR UPDATE waited for the first COMMIT, then read 20. A plain SELECT didn’t wait',
    'bank:optimistic': 'the second UPDATE matched 0 rows; the retry read 20, 8 and stopped',
  };

  for (const { kind, step, m } of cases) {
    test(`${kind} · ${m.label}: the animation's interleaving, replayed on PostgreSQL (${step})`, async () => {
      // The step's own config (see race-conditions/chapters.tsx), with this mode picked.
      const sim = raceRound(
        kind === 'seat'
          ? { scene: 'seat', seat: m.id as SeatMode, mode: 'plan', loop: true, timeline: true }
          : { scene: 'bank', bank: m.id as BankMode, mode: 'plan', loop: true, timeline: true },
      );
      const db = await bank();
      const real = await replay(db, kind, m.id, m.code, sim.chips);
      const simChips = sim.chips.map(chipText).join(' ');
      const simOk = Object.fromEntries(sim.threads.map((t) => [t.id, !!t.ok]));
      const simCells = Object.fromEntries(Object.entries(sim.cells).map(([k, v]) => [k, k === 'seat' ? String(v) : Number(v)]));
      const sameCells = JSON.stringify(real.cells) === JSON.stringify(simCells);
      const pass = real.chips === simChips && JSON.stringify(real.ok) === JSON.stringify(simOk) && sameCells && (m.id !== 'forupdate' || /plain SELECT meanwhile: 100/.test(real.notes.join()));
      R.check({
        lesson: LESSON.race,
        step,
        title: `${m.code.title}: the same interleaving, step by step`,
        software: PG,
        real: `${real.chips} → ${JSON.stringify(real.cells)}${real.notes.length ? `; ${real.notes.join('; ')}` : ''}`,
        lesson_says: `${simChips} → ${JSON.stringify(simCells)} (${sim.result?.text})`,
        pass,
      });
      expect(real.chips).toBe(simChips);
      expect(pass).toBe(true);
      R.stamp(m.code.code, { lesson: LESSON.race, by: PG, kind: 'ran', note: `Ran it on PostgreSQL ${PGV}: in two sessions, in the animation's order, ${notes[`${kind}:${m.id}`]}.` });
    });
  }

  test('the conditional UPDATE is atomic even when both run at once (check-then-act)', async () => {
    const spec = SEAT_MODES.find((m) => m.id === 'atomic')!.code;
    const [update] = statements(spec.code);
    const db = await bank();
    const alice = await db.connect({ app: 'alice' });
    const bob = await db.connect({ app: 'bob' });
    await alice.query('BEGIN');
    const a = (await alice.query(update)).tag;
    const b = outcome(bob.query(update.replace(`'alice'`, `'bob'`)));
    const waits = await stillWaiting(b, 500);
    await alice.query('COMMIT');
    const rb = await b;
    alice.close();
    bob.close();
    const owner = await db.one(`SELECT owner FROM seats WHERE id = '14C'`);
    const pass = a === 'UPDATE 1' && waits && rb.ok && rb.value.tag === 'UPDATE 0' && owner === 'alice';
    R.check({
      lesson: LESSON.race,
      step: 'check-then-act',
      title: 'Two conditional UPDATEs at the same moment',
      software: PG,
      real: `alice's UPDATE (not yet committed): ${a}; bob's waited for it (${waits}), then ${rb.ok ? rb.value.tag : rb.error.message}; the seat is ${owner}'s`,
      lesson_says: 'the check and the write happen in one statement; the loser updates 0 rows',
      pass,
    });
    expect(pass).toBe(true);
  });

  test('READ COMMITTED is the default; REPEATABLE READ turns the double spend into a serialization error (double-spend)', async () => {
    const spec = BANK_MODES.find((m) => m.id === 'racy')!.code;
    const [begin, select, update, commit] = statements(spec.code);
    const db = await bank();
    const level = await db.one('SHOW default_transaction_isolation');
    const rr = begin.replace('BEGIN', 'BEGIN ISOLATION LEVEL REPEATABLE READ');
    const atm = await db.connect({ app: 'atm' });
    const app = await db.connect({ app: 'app' });
    await atm.query(rr);
    await app.query(rr);
    const reads = [await atm.one(select), await app.one(select)];
    await atm.query(update);
    await atm.query(commit);
    const second = await outcome(app.query(update));
    await app.query('ROLLBACK');
    // The app retries the whole transaction
    await app.query(rr);
    const retry = await app.one(select);
    await app.query('ROLLBACK');
    atm.close();
    app.close();
    const pass = level === 'read committed' && reads.join() === '100,100' && !second.ok && second.error.code === '40001' && retry === '20';
    R.check({
      lesson: LESSON.race,
      step: 'double-spend',
      title: 'Isolation levels',
      software: PG,
      real: `default_transaction_isolation = ${level}; under REPEATABLE READ both read ${reads.join(' and ')}, the first withdrawal committed, the second UPDATE got ${second.ok ? second.value.tag : `ERROR ${second.error.code}: ${second.error.message}`}; the retry read ${retry} and would refuse`,
      lesson_says: 'READ COMMITTED is PostgreSQL’s default and doesn’t stop it; under REPEATABLE READ the second update fails with a serialization error and the app retries',
      pass,
    });
    expect(pass).toBe(true);
  });

  test('FOR UPDATE in opposite orders deadlocks, and PostgreSQL breaks it (cheat-sheet)', async () => {
    const db = await initPrimary('dl');
    await db.sql(`CREATE TABLE accounts (id text PRIMARY KEY, balance int NOT NULL); INSERT INTO accounts VALUES ('alice', 100), ('bob', 100)`);
    const a = await db.connect({ app: 'A' });
    const b = await db.connect({ app: 'B' });
    const lock = (who: string) => `SELECT balance FROM accounts WHERE id = '${who}' FOR UPDATE`;
    await a.query('BEGIN');
    await b.query('BEGIN');
    await a.query(lock('alice'));
    await b.query(lock('bob'));
    const ra = outcome(a.query(lock('bob')));
    const rb = outcome(b.query(lock('alice')));
    const [x, y] = await Promise.all([ra, rb]);
    const loser = [x, y].find((r) => !r.ok);
    const winner = [x, y].find((r) => r.ok);
    await a.query('ROLLBACK').catch(() => undefined);
    await b.query('ROLLBACK').catch(() => undefined);
    a.close();
    b.close();
    const pass = !!loser && !loser.ok && loser.error.code === '40P01' && !!winner && loser.ms > 900;
    R.check({
      lesson: LESSON.race,
      step: 'cheat-sheet',
      title: 'FOR UPDATE: lock-order deadlocks',
      software: PG,
      real: loser && !loser.ok ? `after ${ms(loser.ms)} one got ERROR ${loser.error.code}: ${loser.error.message}; the other got its row` : 'no deadlock?',
      lesson_says: 'FOR UPDATE: watch out for lock-order deadlocks',
      pass,
    });
    expect(pass).toBe(true);
  });
});
