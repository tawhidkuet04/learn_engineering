import type { ReactNode } from 'react';
import { Stat } from '@/components/lesson/cards';
import type { CodeSpec } from '@/components/lesson/CodeBlock';
import type { IconName } from '@/components/lesson/Icon';
import { Aside } from '@/components/lesson/Prose';
import type { QuizSpec } from '@/components/lesson/QuizCard';
import { Term } from '@/components/lesson/Term';
import type { Callout } from '@/components/stage/overlays';
import type { ScriptEvent } from '@/lib/sim/Sim';
import { CheatSheet } from './CheatSheet';
import type { HudKey, LegendKey, ReadoutKind } from './Overlay';
import css from './replication.module.css';
import { toMs, type ReplConfig, type ReplSim } from './sim';

/* ------------------------------------------------------------------ */
/* Step and chapter shapes                                             */
/* ------------------------------------------------------------------ */

export interface SliderDef {
  label: string;
  min: number;
  max: number;
  step: number;
  initial: (c: ReplConfig) => number;
  set: (s: ReplSim, v: number) => void;
  format: (v: number) => string;
  ends?: [string, string];
}

export type Interaction =
  | { kind: 'predict'; prompt: ReactNode }
  | { kind: 'slider'; prompt?: ReactNode; sliders: SliderDef[]; stats?: (s: ReplSim) => ReactNode; done?: (s: ReplSim) => ReactNode }
  | { kind: 'actions'; prompt?: ReactNode; kicker?: string; buttons: { label: string; icon?: IconName; run: (s: ReplSim) => void; after?: ReactNode }[] }
  | { kind: 'toggle'; prompt: ReactNode; initial?: number; options: { label: string; apply: (s: ReplSim) => void; note?: ReactNode }[] }
  | { kind: 'playground' };

export interface Step {
  id: string;
  title: string;
  body: ReactNode;
  cfg?: Partial<ReplConfig>;
  reset?: boolean;
  /** Correct answers needed in this step's prediction game */
  predict?: number;
  script?: ScriptEvent<ReplSim>[];
  hud?: HudKey[];
  legend?: LegendKey[];
  callouts?: Callout[];
  focus?: string[];
  readout?: ReadoutKind[];
  inspector?: boolean;
  interactions?: Interaction[];
  quiz?: QuizSpec;
  code?: CodeSpec;
  extra?: ReactNode;
  /** Let the learner crash and revive databases by clicking them */
  clickDbs?: boolean;
}

export interface Chapter {
  id: string;
  title: string;
  cfg?: Partial<ReplConfig>;
  steps: Step[];
}

export const META = { slug: 'replication', code: 'SD-05', track: 'System design', title: 'Database Replication' };

/* ------------------------------------------------------------------ */
/* The script                                                          */
/* ------------------------------------------------------------------ */

export const CHAPTERS: Chapter[] = [
  /* ================================================================ */
  {
    id: 'one-database',
    title: 'One database is not enough',
    cfg: { topo: 'single', tape: false, readFrom: 'leader' },
    steps: [
      {
        id: 'every-query-hits-one-machine',
        title: 'Every query hits one machine',
        reset: true,
        cfg: { writeRate: 0.6, readRate: 2.5 },
        body: (
          <>
            <p>
              This is the database behind a small payments app: one <Term k="db1">Postgres server</Term> holding every account. The tiny table
              inside shows two rows from it, Alice&apos;s and Bob&apos;s balances.
            </p>
            <p>
              Every page your <Term k="app1">app server</Term> renders turns into queries. Most are <strong>reads</strong> (cyan: show a balance, list
              transactions). A few are <strong>writes</strong> (orange: a deposit, a payment). Real apps often read ten to a hundred times more than
              they write.
            </p>
            <p>One machine can only answer so many queries at once. Drag the read traffic up and watch the queue form in front of it.</p>
          </>
        ),
        interactions: [
          {
            kind: 'slider',
            sliders: [
              {
                label: 'Reads',
                min: 0.5,
                max: 10,
                step: 0.5,
                initial: (c) => c.readRate,
                set: (s, v) => s.setReadRate(v),
                format: (v) => `${v.toFixed(1)} /s`,
                ends: ['quiet', 'busy'],
              },
            ],
            stats: (s) => (
              <>
                <Stat label="served" value={`${s.rate(s.m.readT).toFixed(1)}/s`} />
                <Stat label="errors" value={s.m.errors} bad={s.m.errors > 0} />
              </>
            ),
            done: (s) =>
              s.m.errors > 0 || s.m.peakRead > 4.2 ? (
                <>
                  <strong>That&apos;s the ceiling of one machine.</strong> Past it, queries queue up and then get refused. You could buy a bigger
                  server, but there&apos;s always a biggest one, and it&apos;s still just one.
                </>
              ) : null,
          },
        ],
        callouts: [
          { target: 'L|db1', text: <>every query lands <b>on this one machine</b></>, dir: 'up' },
          { target: 'P|db1', text: <>every query lands <b>on this one machine</b></>, dir: 'down' },
        ],
        readout: ['load'],
        hud: ['reads', 'readLat', 'errors'],
        legend: ['write', 'read', 'result', 'err'],
      },
      {
        id: 'single-point-of-failure',
        title: 'When it dies, everything stops',
        reset: true,
        cfg: { writeRate: 1, readRate: 1.5 },
        body: (
          <>
            <p>
              Load isn&apos;t the only problem. This one machine is also a <strong>single point of failure</strong>.
            </p>
            <p>
              If the server crashes, every query fails until it&apos;s back. That&apos;s downtime. If the disk dies, it&apos;s worse: you restore
              last night&apos;s backup, and <strong>every write since then is gone</strong>. Deposits, payments, sign-ups. The counter in the corner
              shows how many writes exist only on this one disk.
            </p>
            <p>Try both.</p>
          </>
        ),
        interactions: [
          {
            kind: 'actions',
            buttons: [
              {
                label: 'Crash the database',
                icon: 'power',
                run: (s) => s.crash('db1'),
                after: <>Every query fails. Nothing can be read or written until db-1 comes back.</>,
              },
              {
                label: 'Restart it',
                icon: 'replay',
                run: (s) => s.revive('db1'),
                after: <>The disk survived, so the data is intact. You only paid in downtime.</>,
              },
              {
                label: 'Disk died: restore backup',
                icon: 'book',
                run: (s) => s.restoreBackup(),
                after: (
                  <>
                    db-1 is back, but with last night&apos;s data. Watch the balances jump back. Backups protect you from losing everything, not from
                    losing today.
                  </>
                ),
              },
            ],
          },
        ],
        callouts: [
          { target: 'L|db1', text: <>the <b>only copy</b> of your data</>, dir: 'right' },
          { target: 'P|db1', text: <>the <b>only copy</b> of your data</>, dir: 'down' },
        ],
        hud: ['errors', 'unbacked'],
        legend: ['write', 'read', 'result', 'err'],
      },
      {
        id: 'copies-drift-apart',
        title: 'Copies are easy. Identical copies aren’t.',
        reset: true,
        cfg: { topo: 'naive', dbs: 3, apps: 2, writeRate: 0, readRate: 0, tape: false, scenario: 'drift' },
        body: (
          <>
            <p>
              The fix for both problems is <strong>replication</strong>: keep a full copy of the data on several machines, called{' '}
              <strong>replicas</strong>. If one dies, another has everything. And every copy can answer reads.
            </p>
            <p>
              The hard part is keeping the copies identical while writes pour in. The obvious idea: have the app send every write to every copy.
            </p>
            <p>
              Watch <Term k="app1">app-1</Term> and <Term k="app2">app-2</Term> update Alice&apos;s balance at almost the same moment. Each network path
              takes a slightly different time, so the copies receive the two writes in <strong>different orders</strong>, and whichever arrives last
              wins. The copies drift apart, and nothing even notices.
            </p>
            <Aside>At thousands of writes per second, “two writes to the same row at the same moment” stops being rare. It happens all day.</Aside>
          </>
        ),
        callouts: [
          { target: 'L|db2', text: <>same row, <b>different values</b></>, dir: 'right' },
          { target: 'P|db3', text: <>same row, <b>different values</b></>, dir: 'down' },
        ],
        legend: ['app1', 'app2'],
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'leader-followers',
    title: 'Leader and followers',
    cfg: { topo: 'replicated', dbs: 3, readRate: 0 },
    steps: [
      {
        id: 'one-leader-orders-the-writes',
        title: 'One leader orders the writes',
        reset: true,
        cfg: { ship: false, writeRate: 0.9 },
        focus: ['app1', 'db1'],
        body: (
          <>
            <p>
              The standard fix: make one replica the <Term k="leader">leader</Term> (also called the primary). <strong>Every write goes to the
              leader</strong>, and only to the leader. The others are <Term k="followers">followers</Term> (replicas, standbys).
            </p>
            <p>
              Before the leader touches its table, it appends the change to its <strong>write-ahead log</strong> (WAL), the tape along the bottom
              of the node. Each entry gets the next <strong>log sequence number</strong> (LSN): #101, #102, #103. One machine hands out the numbers,
              so there is exactly one order, and no one can disagree about it.
            </p>
            <p>The followers are dimmed for now. They still hold the old copy and haven&apos;t heard about any of this.</p>
            <Aside>
              Real LSNs are byte positions in the log, like <code>0/3000148</code> in Postgres. MySQL&apos;s binlog uses a file name and position,
              or a GTID. Numbering the entries is a simplification.
            </Aside>
          </>
        ),
        readout: ['wal'],
        callouts: [{ target: 'L|tape:leader', text: <>the <b>log</b>: every change, in order</>, dir: 'down' }],
        code: {
          title: 'psql · on the leader',
          lang: 'sql',
          code: `
-- where has the log reached?
!SELECT pg_current_wal_lsn();
--  0/3000148

-- this UPDATE is logged first, then applied
UPDATE accounts SET balance = balance + 50 WHERE id = 'alice';`,
        },
        hud: ['lsn', 'commitLat'],
        legend: ['write', 'commit'],
      },
      {
        id: 'the-leader-streams-its-log',
        title: 'The leader streams its log',
        cfg: { ship: true, writeRate: 0.9, scenario: 'inspect' },
        body: (
          <>
            <p>
              Now the leader <strong>streams</strong> its log to the <Term k="followers">followers</Term>. Each entry travels down a connection to
              each follower, and each follower <strong>replays</strong> the entries strictly in LSN order into its own copy of the table.
            </p>
            <p>
              Same starting data, same changes, same order: the copies end up identical. That&apos;s the whole trick. Watch a follower&apos;s balance
              change a moment after the leader&apos;s.
            </p>
            <p>
              A follower&apos;s header shows the last position it has replayed. A dashed cell on its tape is an entry that has arrived but hasn&apos;t
              been replayed yet.
            </p>
            <Aside>
              Postgres&apos;s WAL records low-level page changes, and MySQL&apos;s binlog records each changed row. The card shows the effect of an
              entry, not its bytes. Either way it&apos;s one ordered list of changes.
            </Aside>
          </>
        ),
        readout: ['status'],
        inspector: true,
        code: {
          title: 'postgresql.conf',
          lang: 'conf',
          code: `
# on the leader
!wal_level = replica         # log enough detail for replicas
!max_wal_senders = 10        # one sender process per follower

# on each follower (pg_basebackup -R writes this for you)
!primary_conninfo = 'host=10.0.2.11 user=replicator application_name=db2'
# ...plus an empty standby.signal file: "you are a follower"`,
        },
        hud: ['lsn', 'lag'],
        legend: ['write', 'entry', 'commit'],
      },
      {
        id: 'spread-the-reads',
        title: 'Spread the reads across followers',
        reset: true,
        cfg: { dbs: 4, readRate: 5, readFrom: 'followers', writeRate: 0.8, walLabels: false },
        body: (
          <>
            <p>
              Followers can&apos;t take writes, but they can answer reads. Send every write to the leader and <strong>spread the reads across the
              followers</strong>. Three followers, roughly three times the read capacity. Need more? Add another follower.
            </p>
            <p>Push the read traffic past what the single database could handle. The work is shared, so every follower stays comfortable.</p>
            <p>
              That&apos;s why read replicas are the first scaling move for most read-heavy apps. Look closely at the code below, though. There&apos;s a
              bug hiding in the timing.
            </p>
          </>
        ),
        interactions: [
          {
            kind: 'slider',
            sliders: [
              {
                label: 'Reads',
                min: 1,
                max: 16,
                step: 0.5,
                initial: (c) => c.readRate,
                set: (s, v) => s.setReadRate(v),
                format: (v) => `${v.toFixed(1)} /s`,
                ends: ['quiet', 'busy'],
              },
            ],
            stats: (s) => (
              <>
                <Stat label="served" value={`${s.rate(s.m.readT).toFixed(1)}/s`} />
                <Stat label="errors" value={s.m.errors} bad={s.m.errors > 0} />
              </>
            ),
          },
        ],
        code: {
          title: 'db.js',
          lang: 'js',
          code: `
const leader = new Pool({ host: '10.0.2.11' });           // writes
const replicas = ['10.0.2.12', '10.0.2.13', '10.0.2.14']
  .map((host) => new Pool({ host }));                     // reads
let i = 0;
!const reader = () => replicas[i++ % replicas.length];

await leader.query('UPDATE accounts SET balance = balance + 50 WHERE id = $1', [user]);
!const { rows } = await reader().query('SELECT balance FROM accounts WHERE id = $1', [user]);`,
        },
        callouts: [{ target: 'L|db3', text: <>reads <b>shared by followers</b></>, dir: 'right' }],
        readout: ['load'],
        hud: ['reads', 'readLat', 'errors'],
        legend: ['read', 'write', 'entry'],
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'lag',
    title: 'Replication lag',
    cfg: { topo: 'replicated', dbs: 3 },
    steps: [
      {
        id: 'followers-run-behind',
        title: 'Followers run a little behind',
        reset: true,
        cfg: { writeRate: 1.2, readRate: 1.2, readFrom: 'followers', delays: { db3: 1.5 } },
        body: (
          <>
            <p>
              Replication takes time. The leader sends each entry, the network carries it, and the follower replays it. So followers are always a
              little behind the leader. That gap is <strong>replication lag</strong>.
            </p>
            <p>
              On a healthy network it&apos;s milliseconds. Under a burst of writes, with an overloaded follower, or while a long-running query on the
              follower holds up replay, it can grow to seconds or even minutes.
            </p>
            <p>
              Slow down the network to <Term k="db3">db-3</Term>. Watch its lag meter climb, its position fall behind (the yellow{' '}
              <code>−3</code> means three entries behind the leader), and its balances show older values than the leader&apos;s.
            </p>
            <Aside>Time is slowed down so you can follow each message: one second of animation stands for 40 ms.</Aside>
          </>
        ),
        interactions: [
          {
            kind: 'slider',
            sliders: [
              {
                label: 'Extra network delay to db-3',
                min: 0,
                max: 6,
                step: 0.25,
                initial: (c) => c.delays.db3 ?? 0,
                set: (s, v) => s.setDelay('db3', v),
                format: (v) => `+${toMs(v)} ms`,
                ends: ['same rack', 'struggling'],
              },
            ],
            stats: (s) => {
              const f = s.dbs.get('db3');
              return (
                <>
                  <Stat label="db-3 lag" value={`${toMs(s.lagView('db3'))} ms`} bad={toMs(s.lagView('db3')) > 150} />
                  <Stat label="behind by" value={`${f ? s.behind(f) : 0} entries`} />
                </>
              );
            },
          },
        ],
        readout: ['status'],
        code: {
          title: 'psql · on the leader',
          lang: 'sql',
          code: `
!SELECT client_addr, state, replay_lag FROM pg_stat_replication;
--  client_addr | state     | replay_lag
--  10.0.2.12   | streaming | 00:00:00.004
--  10.0.2.13   | streaming | 00:00:02.310

-- MySQL: run this on the replica
!SHOW REPLICA STATUS;   -- Seconds_Behind_Source: 2`,
        },
        callouts: [{ target: 'L|db3', text: <>serves <b>older balances</b></>, dir: 'right' }],
        hud: ['lag', 'lsn'],
        legend: ['entry', 'read', 'result', 'stale'],
      },
      {
        id: 'where-did-my-deposit-go',
        title: 'Where did my $50 go?',
        reset: true,
        predict: 2,
        cfg: { writeRate: 0.7, bgKeys: ['bob'], readRate: 0, delays: { db3: 3 }, scenario: 'stale' },
        body: (
          <>
            <p>
              Here&apos;s where lag bites. Alice deposits $50. The write goes to the <Term k="leader">leader</Term>, commits, and the app shows her a
              success page. Then her browser loads her account page, and that read goes to a follower.
            </p>
            <p>
              The animation pauses when her read reaches the follower. Compare the follower&apos;s position (in its header) with the LSN of her
              deposit, and <strong>predict what balance she sees</strong>.
            </p>
          </>
        ),
        interactions: [{ kind: 'predict', prompt: 'What balance does the follower return to Alice?' }],
        readout: ['status', 'alice'],
        code: {
          title: 'routes.js',
          lang: 'js',
          code: `
// POST /deposit
!await leader.query('UPDATE accounts SET balance = balance + 50 WHERE id = $1', [user]);
res.redirect('/account');

// GET /account, a few milliseconds later
!const { rows } = await reader().query('SELECT balance FROM accounts WHERE id = $1', [user]);`,
        },
        hud: ['aliceStale'],
        legend: ['write', 'read', 'entry', 'stale'],
      },
      {
        id: 'read-your-own-writes',
        title: 'Fix it: read your own writes',
        reset: true,
        cfg: { writeRate: 0.7, bgKeys: ['bob'], readRate: 0, delays: { db3: 3 }, scenario: 'ryw', ryw: 'off' },
        body: (
          <>
            <p>
              Alice needs <strong>read-your-writes</strong> consistency (also called read-after-write): after you change something, your own reads
              always include the change. Other users can see it a moment later, and that&apos;s fine.
            </p>
            <ul className={css.fixList}>
              <li>
                <strong>Read from the leader after writing.</strong> For a few seconds after Alice writes, send her reads to the leader. Simple and
                effective, as long as only recent writers get this treatment.
              </li>
              <li>
                <strong>Wait for her position.</strong> Remember the LSN of Alice&apos;s last write. A follower only answers her once it has replayed at
                least that far. Until then the read waits (or falls back to the leader).
              </li>
            </ul>
            <p>Try each one and watch Alice&apos;s stale-read counter.</p>
            <Aside>
              MongoDB&apos;s causally consistent sessions and Azure Cosmos DB&apos;s session consistency do this bookkeeping for you. MySQL has{' '}
              <code>WAIT_FOR_EXECUTED_GTID_SET()</code> for the wait.
            </Aside>
          </>
        ),
        interactions: [
          {
            kind: 'toggle',
            prompt: 'Where do Alice’s reads go?',
            options: [
              {
                label: 'Any follower',
                apply: (s) => s.setRyw('off'),
                note: <>Half her reads land on db-3, which is seconds behind. Each of those shows her the balance from before her deposit.</>,
              },
              {
                label: 'Leader after a write',
                apply: (s) => s.setRyw('leader'),
                note: <>Always fresh. The cost: for a few seconds after every write, that user&apos;s reads add load to the leader.</>,
              },
              {
                label: 'Wait for her LSN',
                apply: (s) => s.setRyw('lsn'),
                note: <>Always fresh, and reads stay on followers. The cost: on db-3 her read waits until it catches up. Watch her read latency.</>,
              },
            ],
          },
        ],
        readout: ['status', 'alice'],
        code: {
          title: 'psql',
          lang: 'sql',
          code: `
-- on the leader, right after Alice's write commits
!SELECT pg_current_wal_lsn();                      -- 0/3000148: keep it in her session

-- on a follower, before reading for Alice
!SELECT pg_last_wal_replay_lsn() >= '0/3000148';   -- false? wait, or ask the leader`,
        },
        hud: ['aliceStale', 'aliceLat'],
        legend: ['write', 'read', 'entry', 'stale'],
      },
      {
        id: 'dont-go-back-in-time',
        title: 'Don’t travel back in time',
        reset: true,
        cfg: { writeRate: 1.1, bgKeys: ['alice'], bgDelta: [5], readRate: 0, delays: { db3: 2.4 }, scenario: 'monotonic', sticky: false, walLabels: false },
        body: (
          <>
            <p>
              Alice runs a sticker shop, and every sale adds $5 to her balance. She keeps refreshing her dashboard, and each refresh goes to a random
              follower.
            </p>
            <p>
              When one refresh hits the up-to-date <Term k="db2">db-2</Term> and the next hits the lagging <Term k="db3">db-3</Term>, her balance goes{' '}
              <em>down</em>, then up again. Money doesn&apos;t do that. It breaks <strong>monotonic reads</strong>: once you&apos;ve seen a value, you
              should never see an older one.
            </p>
            <p>
              The fix is <strong>stickiness</strong>: send each user to the same follower every time, for example by hashing their user ID. Alice
              may still see slightly old data, but time only moves forward.
            </p>
            <Aside>If her follower dies, she moves to another and might see one small jump. Stickiness is a best effort, not a guarantee.</Aside>
          </>
        ),
        interactions: [
          {
            kind: 'toggle',
            prompt: 'Route Alice’s refreshes to:',
            options: [
              { label: 'A random follower', apply: (s) => s.setSticky(false) },
              {
                label: 'The same follower',
                apply: (s) => s.setSticky(true),
                note: <>Always db-3 now. It&apos;s behind, but it never goes backwards: every value is newer than the last.</>,
              },
            ],
          },
        ],
        readout: ['history', 'status'],
        code: {
          title: 'db.js',
          lang: 'js',
          code: `
// choose a follower per user, not per request
!const replica = replicas[hash(userId) % replicas.length];
const { rows } = await replica.query('SELECT balance FROM accounts WHERE id = $1', [userId]);`,
        },
        callouts: [{ target: 'L|db3', text: <>the <b>lagging</b> follower</>, dir: 'right' }],
        hud: ['backJumps', 'lag'],
        legend: ['write', 'read', 'result', 'stale'],
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'sync-async',
    title: 'Sync or async?',
    cfg: { topo: 'replicated', dbs: 3, readRate: 0 },
    steps: [
      {
        id: 'who-waits-for-whom',
        title: 'Who waits for whom?',
        reset: true,
        cfg: { topo: 'seq', seqMode: 'async' },
        body: (
          <>
            <p>When exactly does the leader say &ldquo;committed&rdquo;? There are two basic answers.</p>
            <p>
              <strong>Asynchronous</strong>, the default in Postgres and MySQL: the leader writes the change to its own log, confirms right away, and
              ships the entry to followers afterwards. Fast. But for a moment the confirmed write exists on exactly one machine.
            </p>
            <p>
              <strong>Synchronous</strong>: the leader sends the entry and waits until a follower confirms it&apos;s safely on disk. Only then does
              it tell the app &ldquo;committed&rdquo;. Every confirmed write lives on two machines. The price is an extra network round trip on every
              single write.
            </p>
            <Aside>
              The milliseconds here are stretched so you can see each message. Inside one data center that extra round trip costs well under a
              millisecond; to another region it costs tens of milliseconds.
            </Aside>
          </>
        ),
        interactions: [
          {
            kind: 'toggle',
            prompt: 'Replay one write in each mode and compare when COMMIT arrives:',
            options: [
              { label: 'Asynchronous', apply: (s) => s.setSeqMode('async') },
              { label: 'Synchronous', apply: (s) => s.setSeqMode('sync') },
            ],
          },
        ],
        quiz: {
          question: 'Your leader is in Virginia and its synchronous follower is in Frankfurt, about 90 ms away round trip. What happens to every commit?',
          options: [
            { text: 'Nothing much: replication happens in the background', why: 'That’s async. In sync mode the COMMIT can’t come back until Frankfurt has confirmed the write.' },
            { text: 'Each commit takes at least 90 ms longer', correct: true, why: 'Every commit now includes a full round trip to Frankfurt. That’s why sync followers usually sit in the same region, often in another availability zone.' },
            { text: 'Commits take twice as long', why: 'The added cost is the round trip to the follower, not a multiplier. A 2 ms local commit becomes about 92 ms.' },
          ],
        },
        code: {
          title: 'postgresql.conf · on the leader',
          lang: 'conf',
          code: `
!synchronous_standby_names = 'FIRST 1 (db2)'   # wait for db2...
!synchronous_commit = on        # ...until it has flushed the entry to disk
# remote_apply: wait until db2 has replayed it (so reads there see it)
# local: don't wait for any standby at all`,
        },
        hud: ['seqLat', 'seqCopies'],
      },
      {
        id: 'when-the-sync-follower-dies',
        title: 'When the sync follower dies',
        reset: true,
        predict: 1,
        cfg: { sync: true, syncNames: ['db2'], writeRate: 0.8, scenario: 'sync-down' },
        script: [{ at: 3.2, run: (s) => s.crash('db2') }],
        body: (
          <>
            <p>
              Synchronous replication has a nasty failure mode. Here the leader waits for <Term k="db2">db-2</Term>, its only synchronous follower.
              Watch the green acks flow back. In a few seconds db-2 crashes.
            </p>
            <p>The next write reaches the leader and goes into its log. Then what? The animation pauses so you can predict it.</p>
          </>
        ),
        interactions: [
          { kind: 'predict', prompt: 'db-2 is down. What happens to the next write?' },
          {
            kind: 'actions',
            kicker: 'Then fix it',
            buttons: [
              {
                label: 'Bring db-2 back',
                icon: 'replay',
                run: (s) => s.revive('db2'),
                after: <>db-2 catches up, confirms, and the stuck writes commit in a burst.</>,
              },
              {
                label: 'Emergency: turn sync off',
                icon: 'bolt',
                run: (s) => s.setSync(false),
                after: (
                  <>
                    Clearing <code>synchronous_standby_names</code> releases every stuck commit at once. You&apos;re back to async, and back to risking
                    data loss.
                  </>
                ),
              },
            ],
          },
        ],
        readout: ['status'],
        code: {
          title: 'psql · on the leader',
          lang: 'sql',
          code: `
-- sessions stuck in COMMIT, waiting for the sync standby
!SELECT pid, wait_event, state FROM pg_stat_activity WHERE wait_event = 'SyncRep';
--  4711 | SyncRep | active`,
          note: 'If the app gives up and cancels, Postgres warns: “The transaction has already committed locally, but might not have been replicated to the standby.”',
        },
        callouts: [{ target: 'L|db2', text: <>the <b>only</b> sync follower</>, dir: 'right' }],
        hud: ['commitLat', 'commits'],
        legend: ['write', 'entry', 'ack', 'commit'],
      },
      {
        id: 'one-sync-rest-async',
        title: 'The compromise: one sync, the rest async',
        reset: true,
        cfg: { dbs: 4, sync: true, syncNames: ['db2', 'db3'], syncMethod: 'first', writeRate: 0.8, walLabels: false },
        body: (
          <>
            <p>
              The usual compromise: keep <strong>one</strong> follower synchronous and the rest asynchronous. Every confirmed write is on at least
              two machines, and you only wait for one round trip.
            </p>
            <p>
              Name a backup too. With <code>FIRST 1 (db2, db3)</code>, <Term k="db2">db-2</Term> is the synchronous follower and{' '}
              <Term k="db3">db-3</Term> is a <em>potential</em> one that takes over if db-2 disappears. Crash db-2 and watch the badges. Crash both and
              writes stall again.
            </p>
            <p>
              MySQL calls this <strong>semi-synchronous replication</strong>: the leader waits until at least one replica has received and logged the
              entry. MySQL also gives up waiting after a timeout (10 seconds by default) and falls back to async.
            </p>
          </>
        ),
        interactions: [
          {
            kind: 'actions',
            kicker: 'Try it',
            buttons: [
              { label: 'Crash db-2', icon: 'power', run: (s) => s.crash('db2'), after: <>db-3 is promoted from potential to sync. Commits keep flowing.</> },
              { label: 'Crash db-3', icon: 'power', run: (s) => s.crash('db3') },
              { label: 'Revive both', icon: 'replay', run: (s) => s.reviveDown() },
            ],
          },
        ],
        readout: ['status'],
        code: {
          title: 'replication settings',
          lang: 'conf',
          code: `
# Postgres: db2 is sync, db3 steps in if db2 disappears, db4 stays async
!synchronous_standby_names = 'FIRST 1 (db2, db3)'
# or wait for any one of them (quorum commit):
# synchronous_standby_names = 'ANY 1 (db2, db3, db4)'

# MySQL semi-sync (8.0.26 and later)
!rpl_semi_sync_source_enabled = 1
rpl_semi_sync_source_timeout = 10000   # ms, then fall back to async`,
        },
        callouts: [{ target: 'L|db3', text: <><b>potential</b>: steps in if db-2 dies</>, dir: 'right' }],
        hud: ['commitLat', 'commits'],
        legend: ['entry', 'ack', 'commit'],
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'failover',
    title: 'Failover',
    cfg: { topo: 'replicated', dbs: 3, monitor: true, failover: 'auto', fencing: true, readRate: 0 },
    steps: [
      {
        id: 'the-leader-dies',
        title: 'The leader dies',
        reset: true,
        cfg: { writeRate: 1, readRate: 1, readFrom: 'followers', walLabels: false },
        body: (
          <>
            <p>A follower dying is annoying. The leader dying is the big one: no leader, no writes.</p>
            <p>
              So something watches it. Here a <Term k="mon">monitor</Term> sends the leader a <strong>heartbeat</strong> every second (the violet
              pulses). After <strong>3 missed heartbeats</strong> in a row it declares the leader dead and runs a <strong>failover</strong>: promote a
              follower to leader, and point every writer at it.
            </p>
            <p>
              Crash the leader and watch the failed writes pile up during the detection window. A shorter timeout means less downtime, but more false
              alarms when the network hiccups or the leader just pauses for a moment.
            </p>
            <Aside>
              Patroni, the most common Postgres failover manager, uses a lock instead of pings: the leader must keep renewing a key in etcd, and when
              the key expires (after 30 seconds by default) the followers race to take it. Same idea: silence for too long means dead.
            </Aside>
          </>
        ),
        interactions: [
          {
            kind: 'actions',
            buttons: [
              { label: 'Crash the leader', icon: 'power', run: (s) => s.crashLeader() },
              {
                label: 'Repair the old leader',
                icon: 'replay',
                run: (s) => s.reviveDown(),
                after: <>It comes back, learns it&apos;s been replaced, and rejoins as a follower of the new leader.</>,
              },
            ],
          },
        ],
        readout: ['status'],
        code: {
          title: 'patroni.yml',
          lang: 'conf',
          code: `
bootstrap:
  dcs:
!    ttl: 30            # the leader lock expires 30 s after its last renewal
!    loop_wait: 10      # every node checks in every 10 s
    retry_timeout: 10  # give up on etcd after 10 s (and step down)`,
        },
        callouts: [{ target: 'L|mon', text: <>declares death after <b>3 misses</b></>, dir: 'down' }],
        hud: ['writeErrors', 'leaders'],
        legend: ['write', 'hb', 'err'],
      },
      {
        id: 'who-takes-over',
        title: 'Which follower takes over?',
        reset: true,
        predict: 2,
        cfg: { dbs: 4, failover: 'ask', writeRate: 1.5, scenario: 'promote', walLabels: false },
        body: (
          <>
            <p>
              When the leader dies, the followers aren&apos;t equally up to date. Each has replayed the log to a different position, shown in its
              header and in the status panel.
            </p>
            <p>
              Promote the follower with the <strong>most complete log</strong>. The new leader&apos;s log becomes the truth: anything it doesn&apos;t
              have is gone for good, and followers that were further ahead get rolled back to match it.
            </p>
            <p>
              The leader is about to crash. When the monitor declares it dead, the animation pauses. <strong>Click the follower you&apos;d
              promote.</strong>
            </p>
          </>
        ),
        interactions: [{ kind: 'predict', prompt: 'Which follower should become the new leader?' }],
        readout: ['status'],
        code: {
          title: 'psql · on each follower',
          lang: 'sql',
          code: `
-- how much of the log has this follower received and replayed?
!SELECT pg_last_wal_receive_lsn(), pg_last_wal_replay_lsn();

-- on the winner: stop following, start taking writes
!SELECT pg_promote();`,
        },
        hud: ['leaders', 'lsn'],
        legend: ['write', 'entry', 'hb'],
      },
      {
        id: 'writes-that-vanish',
        title: 'Writes that vanish',
        reset: true,
        cfg: { writeRate: 1.4, delays: { db2: 0.5, db3: 1.6 }, scenario: 'lost', sync: false, syncNames: ['db2'], walLabels: false },
        script: [{ at: 5.6, run: (s) => s.crashLeader() }],
        body: (
          <>
            <p>
              Even the best follower can be behind. With asynchronous replication the leader confirmed some writes that hadn&apos;t left it yet. When
              it died, those writes died with it.
            </p>
            <p>
              Watch the red cells on <Term k="db1">db-1</Term>&apos;s tape after the failover. Those clients were told &ldquo;committed&rdquo;, and now
              their writes don&apos;t exist. That&apos;s the real cost of async replication: a failover can lose the last few confirmed writes.
            </p>
            <p>
              Now switch to synchronous and replay. The leader only confirms writes that <Term k="db2">db-2</Term> already has, so the new leader has
              every confirmed write. Writes caught mid-flight fail loudly with an error instead, and the app can retry them.
            </p>
            <Aside>
              It can get worse. In a 2012 GitHub incident, a lagging MySQL follower was promoted. Its auto-increment counter reused IDs the old leader
              had already handed out, and because Redis also stored those IDs, some private data was shown to the wrong users.
            </Aside>
          </>
        ),
        interactions: [
          {
            kind: 'toggle',
            prompt: 'Replay the crash with:',
            options: [
              { label: 'Async replication', apply: (s) => s.replayWith({ sync: false }) },
              {
                label: 'Sync to db-2',
                apply: (s) => s.replayWith({ sync: true, syncNames: ['db2'] }),
                note: (
                  <>
                    Lost writes stay at zero. The grey struck-out cells were never confirmed: their clients got an error, not a lie. After the
                    failover, db-3 becomes the new synchronous follower (Patroni re-points the list for you).
                  </>
                ),
              },
            ],
          },
        ],
        readout: ['lost', 'status'],
        code: {
          title: 'patroni.yml',
          lang: 'conf',
          code: `
!synchronous_mode: true            # only a sync standby may be promoted
maximum_lag_on_failover: 1048576  # bytes: never promote a follower further behind`,
        },
        hud: ['lost', 'writeErrors', 'commitLat'],
        legend: ['write', 'entry', 'commit', 'err'],
      },
      {
        id: 'split-brain',
        title: 'Split brain',
        reset: true,
        cfg: { apps: 2, fencing: false, terms: true, writeRate: 1, scenario: 'split', walLabels: false },
        body: (
          <>
            <p>
              Back to that crashed leader. The failover already happened: <Term k="db2">db-2</Term> leads now, in <strong>term 2</strong>. But nobody
              told <Term k="db1">db-1</Term>, and <Term k="app2">app-2</Term> still has db-1&apos;s address in its connection string.
            </p>
            <p>
              Reboot db-1. It starts up exactly as it went down: as a leader. app-2&apos;s writes land on it and succeed. Now two nodes accept writes,
              each with its own version of the truth. This is <strong>split brain</strong>.
            </p>
            <p>
              The histories can&apos;t simply be merged. Compare the balances, and the colored stripes on the tapes: both leaders are handing out the
              same LSNs for different changes.
            </p>
          </>
        ),
        interactions: [
          {
            kind: 'actions',
            buttons: [
              {
                label: 'Reboot db-1',
                icon: 'power',
                run: (s) => s.revive('db1'),
                after: <>Two leaders. Alice&apos;s balance now depends on which one you ask, and every new write widens the gap.</>,
              },
            ],
          },
        ],
        readout: ['split'],
        callouts: [{ target: 'app2', text: <>still points at <b>db-1</b></>, dir: 'down' }],
        hud: ['leaders', 'writeErrors'],
        legend: ['write', 'entry', 'term', 'err'],
      },
      {
        id: 'fencing',
        title: 'Fencing: one leader, guaranteed',
        reset: true,
        cfg: { apps: 2, fencing: true, terms: true, writeRate: 1, scenario: 'split', walLabels: false },
        script: [{ at: 2.2, run: (s) => s.revive('db1') }],
        body: (
          <>
            <p>
              The cure is <strong>fencing</strong>: making sure a deposed leader can&apos;t act like one, even if it wakes up confused.
            </p>
            <p>
              Every failover bumps the <strong>term</strong> (also called epoch or generation). A restarted node must first ask the coordinator what
              the current term is. db-1 learns it&apos;s term 2 and it isn&apos;t the leader, so it steps down: it throws away the two entries nobody
              else has (the job <code>pg_rewind</code> does for Postgres), follows db-2, and refuses writes. app-2 gets a read-only error and
              reconnects to the real leader.
            </p>
            <p>
              The bluntest fence is <strong>STONITH</strong>, &ldquo;shoot the other node in the head&rdquo;: cut the old leader&apos;s power or network
              before promoting anyone, so it can&apos;t come back on its own.
            </p>
            <Aside>Terms are also how Raft, the consensus algorithm inside etcd, avoids two leaders: any message stamped with an older term is rejected.</Aside>
          </>
        ),
        interactions: [
          {
            kind: 'toggle',
            prompt: 'Reboot db-1 again:',
            options: [
              { label: 'With fencing', apply: (s) => s.replayWith({ fencing: true }) },
              { label: 'Without fencing', apply: (s) => s.replayWith({ fencing: false }), note: <>Same reboot, no term check: two leaders again.</> },
            ],
          },
        ],
        readout: ['split'],
        code: {
          title: 'shell',
          lang: 'shell',
          code: `
# Pacemaker: never fail over unless the old node can be fenced
!pcs property set stonith-enabled=true

# turn the old leader into a follower of the new one
!pg_rewind --target-pgdata=/var/lib/postgresql/data \\
    --source-server='host=10.0.2.12 user=postgres'`,
        },
        hud: ['leaders', 'writeErrors'],
        legend: ['write', 'entry', 'term', 'hb'],
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'beyond',
    title: 'Beyond one leader',
    steps: [
      {
        id: 'multi-leader',
        title: 'Multi-leader: a leader per region',
        reset: true,
        cfg: { topo: 'multi', tape: false, writeRate: 0, readRate: 0, scenario: 'multi' },
        body: (
          <>
            <p>
              With one leader, every write in the world travels to one data center. Distant users wait, and if that region goes down, nobody can write.
            </p>
            <p>
              <strong>Multi-leader</strong> replication runs a leader in each region. Writes are fast and local, and the leaders replicate to each other
              asynchronously.
            </p>
            <p>
              The catch: two leaders can change the same row at the same time. Here Alice deposits $50 in us-east while a $20 deposit lands in
              eu-west. Each leader accepts its own write, then receives the other&apos;s: a <strong>write conflict</strong>. A common default,{' '}
              <strong>last write wins</strong>, keeps the change with the later timestamp and silently throws the other away.
            </p>
            <Aside>
              Better options exist (merge functions, CRDTs, keeping both versions for the app to resolve), but the safest plan is to avoid conflicts:
              send all writes for a given record to the same region.
            </Aside>
          </>
        ),
        readout: ['conflict'],
        code: {
          title: 'my.cnf · two MySQL leaders',
          lang: 'conf',
          code: `
# keep auto-increment IDs from colliding across the two leaders
!auto_increment_increment = 2   # both leaders count in steps of 2
!auto_increment_offset    = 1   # us-east: 1, 3, 5…   (eu-west uses 2: 2, 4, 6…)`,
        },
        legend: ['write', 'entry', 'commit'],
      },
      {
        id: 'leaderless',
        title: 'Leaderless: quorums',
        reset: true,
        cfg: { topo: 'leaderless', dbs: 3, tape: false, writeRate: 0, readRate: 0, scenario: 'quorum', quorumR: 2 },
        body: (
          <>
            <p>
              Dynamo-style databases (Cassandra, ScyllaDB, Riak) drop the leader entirely. Each write goes to <strong>all N replicas</strong> and
              counts as done when <strong>W</strong> of them confirm. A read asks <strong>R</strong> replicas and keeps the value with the newest
              version.
            </p>
            <p>
              Here N = 3 and W = 2, and <Term k="db3">node-3</Term> misses the write. With R = 2, the read is guaranteed to reach at least one replica
              that has it, because W + R &gt; N. The client keeps the newest version and fixes node-3 on the way out (<strong>read repair</strong>).
            </p>
            <p>Switch to R = 1 and the read can land on the one replica that missed the write.</p>
            <Aside>This is a teaser. Sloppy quorums, hinted handoff and version vectors deserve a lesson of their own.</Aside>
          </>
        ),
        interactions: [
          {
            kind: 'toggle',
            prompt: 'How many replicas does each read ask?',
            options: [
              { label: 'R = 2 (quorum)', apply: (s) => s.setQuorumR(2) },
              { label: 'R = 1', apply: (s) => s.setQuorumR(1), note: <>W + R = 3, not more than N. Nothing forces the read to overlap the write.</> },
            ],
          },
        ],
        readout: ['quorum'],
        code: {
          title: 'cqlsh',
          lang: 'sql',
          code: `
-- 3 copies of every row in data center dc1
CREATE KEYSPACE shop WITH replication = {'class': 'NetworkTopologyStrategy', 'dc1': 3};

!CONSISTENCY QUORUM;   -- wait for 2 of 3 on writes and on reads`,
        },
        callouts: [{ target: 'L|db3', text: <><b>missed</b> the write</>, dir: 'right' }],
        legend: ['write', 'read', 'result', 'stale', 'repair'],
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'recap',
    title: 'Recap & playground',
    cfg: { topo: 'replicated', dbs: 4, monitor: true, failover: 'auto', fencing: true, walLabels: false },
    steps: [
      {
        id: 'cheat-sheet',
        title: 'Cheat sheet',
        reset: true,
        cfg: { sync: true, syncNames: ['db2', 'db3'], writeRate: 1, readRate: 2, readFrom: 'followers', delays: { db4: 0.8 } },
        body: (
          <p>
            Everything in one picture: one leader ordering writes, a synchronous follower with a backup, an async follower, reads spread across the
            followers, and a monitor ready to fail over.
          </p>
        ),
        extra: <CheatSheet />,
        readout: ['status'],
        hud: ['reads', 'commitLat', 'lag'],
        legend: ['write', 'read', 'entry', 'hb'],
      },
      {
        id: 'playground',
        title: 'Playground',
        reset: true,
        cfg: { writeRate: 1.2, readRate: 2.5, readFrom: 'followers', delays: { db4: 0.8 } },
        clickDbs: true,
        body: (
          <p>
            Your cluster, your rules. Change the commit mode and where reads go, crank the traffic, slow down a follower, and click any database on the
            stage to crash or revive it. The config at the bottom follows your choices.
          </p>
        ),
        interactions: [{ kind: 'playground' }],
        readout: ['status'],
        hud: ['reads', 'commitLat', 'lost'],
        legend: ['write', 'read', 'entry', 'ack', 'hb'],
      },
    ],
  },
];
