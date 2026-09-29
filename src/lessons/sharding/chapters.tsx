import Link from 'next/link';
import { Aside } from '@/components/lesson/Prose';
import { Term } from '@/components/lesson/Term';
import type { LegendItem } from '@/components/stage/chrome';
import { SIG } from '@/lib/sim/colors';
import { CheatSheet } from './panel/CheatSheet';
import { COUNTRIES, COUNTRY_MAP, DIR_START, TENANTS } from './routing';
import css from './sharding.module.css';
import type { Chapter } from './types';

export const LESSON = {
  slug: 'sharding',
  code: 'SD-06',
  track: 'System design',
  title: 'Sharding',
};

/* ---------- starting disk use for a few scenarios ---------- */

/** Disk % per shard when data is spread by weight (countries, tenants). */
function byWeight(map: Record<string, number>, weights: { key: string; w: number }[], n: number, total: number) {
  const out = Array.from({ length: n }, () => 0);
  for (const { key, w } of weights) out[map[key]] += w;
  const sum = out.reduce((a, b) => a + b, 0);
  return out.map((v) => Math.round((v / sum) * total));
}

export const COUNTRY_FILL = byWeight(
  COUNTRY_MAP,
  COUNTRIES.map((c) => ({ key: c.code, w: c.w })),
  4,
  118,
);
const DIR_FILL = byWeight(
  DIR_START,
  TENANTS.map((t) => ({ key: t.name, w: t.w })),
  4,
  108,
);
export const HASH_FILL = [31, 30, 32, 30];
export const YEAR_FILL = [58, 70, 77, 28];

/* ---------- legends ---------- */

const L = {
  write: { label: 'write', color: SIG.req },
  failed: { label: 'timed out', color: SIG.err },
  repl: { label: 'replication', color: SIG.hc },
  read: { label: 'read', color: SIG.res, shape: 'small' },
  query: { label: 'query', color: SIG.req, shape: 'square' },
  result: { label: 'partial result', color: SIG.res, shape: 'square' },
  lookup: { label: 'directory lookup', color: SIG.hc, shape: 'small' },
  map: { label: 'shard map update', color: SIG.hc, shape: 'small' },
  id: { label: 'new id', color: SIG.res },
  dup: { label: 'duplicate id', color: SIG.err },
  move: { label: 'row moving', color: SIG.text2, shape: 'square' },
} satisfies Record<string, LegendItem>;

export const CHAPTERS: Chapter[] = [
  /* ================================================================ */
  {
    id: 'one-database',
    title: 'Outgrowing one database',
    steps: [
      {
        id: 'one-machine',
        title: 'One database, one machine',
        cfg: { scene: 'single', rate: 2, ramp: [2, 12, 32], cap: 4, fillPer: 0.3, prefill: [64], readout: 'none' },
        body: (
          <>
            <p>
              Your shop keeps every order in one table on one <Term k="db">database</Term> server. Each glowing dot is a write: a new order, a status
              change, a refund. The <Term k="app">app servers</Term> in front hold no data, so adding more of them is easy.
            </p>
            <p>
              The database is different. It has one disk, one CPU and a fixed amount of memory. Watch its two gauges: the <strong>fill level</strong> is
              disk space, and the bar underneath is <strong>write load</strong>, where 100% means the machine can&apos;t absorb writes any faster.
            </p>
            <p>Business is good and traffic keeps climbing. Soon writes queue up and time out, and the disk runs out of room.</p>
            <Aside>Each dot stands for thousands of writes, and time is squeezed: a real disk fills over months, not seconds.</Aside>
          </>
        ),
        interaction: {
          kind: 'actions',
          prompt: 'The classic first fix:',
          buttons: [
            {
              label: 'Buy a bigger machine',
              icon: 'plus',
              run: (s) => s.upgradeDb(),
              after: (
                <>
                  Twice the CPU and disk buys you time. But traffic keeps growing, big machines get expensive fast, and there&apos;s always a largest one
                  you can buy. That&apos;s <strong>vertical scaling</strong>, and it has a ceiling.
                </>
              ),
            },
          ],
        },
        callouts: [{ target: 'meter:db', text: <>write load: <b>100% = maxed out</b></>, dir: 'right', pdir: 'down' }],
        hud: ['load', 'disk', 'failed'],
        legend: [L.write, L.failed],
        code: {
          title: 'shell',
          lang: 'shell',
          code: `
$ psql shop -Atc "SELECT pg_size_pretty(pg_total_relation_size('orders'))"
!3212 GB
$ df -h /var/lib/postgresql
Filesystem      Size  Used Avail Use% Mounted on
!/dev/nvme1n1    4.0T  3.3T  700G  83% /var/lib/postgresql`,
          note: 'One table, one disk. Indexes, the write-ahead log and vacuum all need room on that same disk too.',
        },
      },
      {
        id: 'copies-dont-add-room',
        title: 'Copies don’t add room',
        cfg: { scene: 'replicas', replicas: 2, reads: true, rate: 3.7, cap: 4, fillPer: 0.25, prefill: [74], readout: 'none' },
        body: (
          <>
            <p>
              A common next move is <strong>replication</strong>: keep copies of the database on more machines. The <Term k="db">primary</Term> takes
              every write and streams it to the <Term k="rep1">replicas</Term> (the purple dots). Reads can go to any copy, so read traffic spreads out
              nicely.
            </p>
            <p>
              Now look at the gauges. Every replica holds <strong>all</strong> of the data, so its disk is exactly as full as the primary&apos;s. And
              every replica must replay <strong>every</strong> write, so its write load is just as high.
            </p>
            <p>Replication gives you more read capacity and a spare if the primary dies. It does nothing for write load or storage.</p>
            <Aside>Replication has its own lesson. Here you only need one fact: each copy is a full copy.</Aside>
          </>
        ),
        interaction: {
          kind: 'actions',
          buttons: [
            {
              label: 'Add another replica',
              icon: 'plus',
              run: (s) => s.addReplica(),
              after: (
                <>
                  The new replica starts by copying the entire database, then replays every write like the others. Same disk use, same write load.
                  More copies, same problem.
                </>
              ),
            },
          ],
        },
        callouts: [{ target: 'tag:rep1', ptarget: 'meter:rep1', text: <>a <b>full copy</b>: same disk, same writes</>, dir: 'up', pdir: 'down' }],
        hud: ['primary', 'replica', 'disk'],
        legend: [L.write, L.repl, L.read, L.failed],
        code: {
          title: 'postgresql.conf · on each replica',
          lang: 'conf',
          code: `
# PostgreSQL 12+: this file plus an empty standby.signal
!primary_conninfo = 'host=10.0.2.10 user=replicator'
hot_standby = on      # serve reads while replaying every write`,
          note: 'A replica follows the primary’s write-ahead log. It has to apply all of it.',
        },
      },
      {
        id: 'split-the-rows',
        title: 'Split the rows instead',
        cfg: { scene: 'sharded', rule: 'name', rate: 5, cap: 4, fillPer: 0.12, prefill: [19, 19, 18, 17], brace: true, readout: 'writes' },
        body: (
          <>
            <p>
              <strong>Sharding</strong> does the opposite. Instead of copying every row everywhere, you <strong>split</strong> the rows: each machine,
              called a <strong>shard</strong>, holds a different subset, and together the shards hold every row exactly once.
            </p>
            <p>
              Here the <Term k="router">router</Term> sends each new user to a shard by the first letter of their username: A–F to{' '}
              <Term k="s0">shard-0</Term>, G–L to shard-1, and so on. The column you split by is the <strong>shard key</strong>.
            </p>
            <p>Four shards means four disks and four machines’ worth of write capacity. Each carries about a quarter of the load.</p>
            <Aside>
              Splitting rows is also called horizontal partitioning. Splitting a table&apos;s columns into separate tables is vertical partitioning, a
              different tool.
            </Aside>
          </>
        ),
        callouts: [{ target: 'router', text: <>picks a shard by the <b>shard key</b></>, dir: 'left', pdir: 'hide' }],
        hud: ['hottest', 'writes'],
        legend: [L.write],
        code: {
          title: 'schema.sql',
          lang: 'sql',
          code: `
-- every shard runs the same schema...
CREATE TABLE users (username text PRIMARY KEY, email text);

-- ...but holds a different slice of the rows. On shard-0:
!SELECT min(username), max(username) FROM users;   -- alice | frank`,
        },
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'ranges',
    title: 'Range sharding',
    steps: [
      {
        id: 'split-by-range',
        title: 'Split by range',
        cfg: { rule: 'name', predict: 'shard', rounds: 3, rate: 1.3, labels: true, fillPer: 0.12, prefill: [21, 18, 20, 17], readout: 'writes' },
        body: (
          <>
            <p>
              What you just saw is <strong>range-based sharding</strong>. The key space is cut into contiguous ranges and each shard owns one. The
              router keeps a small table of boundaries, shown beside it, and finds the range each key falls in.
            </p>
            <p>
              Ranges keep neighbors together. A query for users from <code>ca</code> to <code>ch</code> touches exactly one shard, and the rows come
              back already in order. That makes <strong>range scans</strong> cheap.
            </p>
            <p>
              Your turn. When someone signs up, the animation pauses at the router. <strong>Click the shard you think stores them.</strong>
            </p>
          </>
        ),
        predictPrompt: 'Which shard stores this new user?',
        hud: [],
        legend: [L.write],
        code: {
          title: 'mongosh',
          lang: 'js',
          code: `
// MongoDB: a ranged shard key (1 means "ordered by this field")
!sh.shardCollection("shop.users", { username: 1 })

// sh.status() then lists chunks: key ranges, each on one shard
//   { username: MinKey } -->> { username: "g" }   on: shard0
//   { username: "g" }    -->> { username: "m" }   on: shard1`,
          note: 'Output simplified. MongoDB splits chunks as they grow and moves them to balance the shards.',
        },
      },
      {
        id: 'hot-spot',
        title: 'The hot spot',
        cfg: { rule: 'year', rate: 5, cap: 4, fillPer: 0.3, prefill: YEAR_FILL, readout: 'writes' },
        body: (
          <>
            <p>
              Now shard the <code>orders</code> table by ranges of <code>created_at</code>: one shard per year. It sounds tidy, and a query for
              September&apos;s orders stays on one shard.
            </p>
            <p>
              But look at the traffic. Every new order is created <em>today</em>, so every insert lands on the <Term k="s3">2026 shard</Term>. It&apos;s
              overloaded and filling fast while the other three sit idle. You own four machines and get the write capacity of one.
            </p>
            <p>
              This is a <strong>hot spot</strong>, and any key that only goes up causes it: timestamps, auto-increment IDs, sequence numbers.
            </p>
            <Aside>
              Systems that split hot ranges automatically, like Bigtable, HBase and CockroachDB, still suffer: after a split, all new writes go to the
              range that holds &ldquo;now&rdquo;.
            </Aside>
          </>
        ),
        callouts: [
          { target: 'tag:s3', text: <>every insert: <b>2026</b></>, dir: 'up', pdir: 'hide' },
          { target: 'tag:s0', text: <>no new writes: <b>idle</b></>, dir: 'up', pdir: 'hide' },
        ],
        hud: ['hottest', 'idle', 'failed'],
        legend: [L.write, L.failed],
        code: {
          title: 'mongosh',
          lang: 'js',
          code: `
// ranged on a timestamp: every insert lands in the newest chunk
!sh.shardCollection("shop.orders", { created_at: 1 })

db.orders.insertOne({ created_at: new Date(), customer_id: 1042, total: 59.9 })`,
          note: 'MongoDB’s docs warn about exactly this: a shard key that only increases sends every insert to one shard.',
        },
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'hashing',
    title: 'Hash sharding',
    steps: [
      {
        id: 'hash-the-key',
        title: 'Hash the key',
        cfg: { rule: 'hash', predict: 'shard', rounds: 3, rate: 2, labels: true, fillPer: 0.1, prefill: HASH_FILL, readout: 'writes' },
        body: (
          <>
            <p>
              <strong>Hash-based sharding</strong> scrambles the key first. The router runs <code>customer_id</code> through a hash function, which turns
              any key into a number that looks random, and keeps the remainder: <code>shard = hash(key) mod 4</code>.
            </p>
            <p>
              Neighbors no longer stay together. Customers 1041, 1042 and 1043 signed up one after another, yet they land on different shards. Even a
              key that only goes up now spreads out evenly.
            </p>
            <p>
              Your turn: the router shows the hash. <strong>Do the mod and click the shard.</strong>
            </p>
            <Aside>
              Real hash functions return 32- or 64-bit numbers (MongoDB uses a 64-bit hash). Two digits keep the math in your head. For mod 4, the last
              two digits are all that matter anyway.
            </Aside>
          </>
        ),
        predictPrompt: 'Which shard gets this customer’s order?',
        hud: [],
        legend: [L.write],
        code: {
          title: 'mongosh',
          lang: 'js',
          code: `
// MongoDB: hash the key, then spread the hashes over the shards
!sh.shardCollection("shop.orders", { customer_id: "hashed" })

// the idea, as a simple app-side router would write it
const shard = hash(order.customer_id) % shards.length;`,
          note: 'MongoDB doesn’t literally use mod: it gives each shard ranges of hash values. The resharding chapter shows why.',
        },
      },
      {
        id: 'what-hashing-costs',
        title: 'What hashing costs you',
        cfg: { rule: 'hash', rate: 5, cap: 4, fillPer: 0.1, prefill: HASH_FILL, queries: 'monthly', readout: 'writes' },
        body: (
          <>
            <p>
              Hashing fixed the hot spot, but it threw something away. With year ranges, the <strong>monthly sales report</strong> (
              <code>WHERE created_at &gt;= &apos;2026-09-01&apos;</code>) needed only the 2026 shard. With hashing, September&apos;s orders are sprinkled
              across every shard.
            </p>
            <p>
              So the router sends the report to <strong>all</strong> shards and combines their answers (the square packets). That&apos;s a{' '}
              <strong>scatter-gather</strong> query. Flip between the two keys and watch both the write load and the report&apos;s fan-out.
            </p>
            <p>Neither is free. Ranges give cheap range queries and hot spots. Hashes give even load and scattered range queries.</p>
          </>
        ),
        interaction: {
          kind: 'toggle',
          prompt: 'Shard the orders table by:',
          initial: 0,
          options: [
            { label: 'Hash of customer_id', apply: (s) => s.setRule('hash', HASH_FILL), note: 'Writes spread evenly. The report has to ask all 4 shards.' },
            { label: 'Range of created_at', apply: (s) => s.setRule('year', YEAR_FILL), note: 'The report asks 1 shard, but every write hits the 2026 shard.' },
          ],
        },
        hud: ['monthly', 'hottest'],
        legend: [L.write, L.query, L.result, L.failed],
        code: {
          title: 'queries.sql',
          lang: 'sql',
          code: `
-- orders sharded by hash(customer_id):
SELECT * FROM orders WHERE customer_id = 1042;   -- 1 shard

!SELECT sum(total) FROM orders
! WHERE created_at >= '2026-09-01';              -- every shard`,
        },
      },
      {
        id: 'directory',
        title: 'Or keep a directory',
        cfg: { rule: 'dir', rate: 3.2, cap: 2.5, fillPer: 0.12, labels: true, prefill: DIR_FILL, readout: 'writes' },
        body: (
          <>
            <p>
              A third option skips formulas entirely. A <strong>directory</strong>, or lookup table, records where each key lives:{' '}
              <code>acme → shard-0</code>. Here the shop sells to businesses, and each tenant&apos;s data lives together. The router asks the{' '}
              <Term k="dir">directory</Term> (purple) before each write.
            </p>
            <p>
              The payoff is flexibility. <Term k="s0">shard-0</Term> is busy because acme is your biggest customer. With a directory you can give acme a
              machine of its own: copy its rows, then change one entry.
            </p>
            <p>
              The costs: an extra lookup per request (routers cache it), and the directory becomes critical. If it&apos;s down or wrong, nothing can be
              found.
            </p>
          </>
        ),
        interaction: {
          kind: 'actions',
          buttons: [
            {
              label: 'Give acme its own shard',
              icon: 'plus',
              run: (s) => s.moveTenant('acme'),
              after: (
                <>
                  First acme&apos;s rows are copied, then a single entry flips to <code>acme → 4</code>. No other tenant moved, and shard-0 cools off.
                </>
              ),
            },
          ],
        },
        callouts: [{ target: 'dir', text: <>tenant → shard, <b>looked up</b> per write</>, dir: 'down', pdir: 'hide' }],
        hud: ['hottest', 'lookups'],
        legend: [L.write, L.lookup],
        code: {
          title: 'directory.sql',
          lang: 'sql',
          code: `
CREATE TABLE tenant_shard (tenant text PRIMARY KEY, shard int NOT NULL);

SELECT shard FROM tenant_shard WHERE tenant = 'acme';   -- 0
-- after copying acme's rows to the new shard:
!UPDATE tenant_shard SET shard = 4 WHERE tenant = 'acme';`,
          note: 'Multi-tenant SaaS apps often keep a table like this, so one big customer can move without touching anyone else.',
        },
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'shard-key',
    title: 'Choosing the shard key',
    steps: [
      {
        id: 'pick-a-key',
        title: 'Pick a shard key',
        cfg: { rule: 'hash', rate: 10, cap: 4, fillPer: 0.05, prefill: HASH_FILL, queries: 'myorders', readout: 'writes' },
        body: (
          <>
            <p>
              The shard key is the most important decision in sharding, because changing it later means moving every row. A good key has three
              properties:
            </p>
            <p>
              <strong>High cardinality</strong>: many distinct values, so data can be split finely. <strong>Even distribution</strong>: no value or range
              gets much more traffic than the rest. <strong>Matches your queries</strong>: the most common ones include it, so they go to one shard.
            </p>
            <p>
              Try three candidates for <code>orders</code>. The HUD shows the hottest shard, and how many shards &ldquo;Alice&apos;s orders&rdquo; (
              <code>customer_id = 42</code>) has to ask.
            </p>
          </>
        ),
        interaction: {
          kind: 'toggle',
          prompt: 'Shard key:',
          initial: 0,
          options: [
            {
              label: 'customer_id (hashed)',
              apply: (s) => s.setRule('hash', HASH_FILL),
              note: 'Millions of values, spread evenly, and each customer’s orders sit together. Alice’s orders: 1 shard.',
            },
            {
              label: 'created_at (range)',
              apply: (s) => s.setRule('year', YEAR_FILL),
              note: 'Endless values, but they only go up, so the newest shard takes every write. Alice’s orders: all 4 shards.',
            },
            {
              label: 'country',
              apply: (s) => s.setRule('country', COUNTRY_FILL),
              note: 'Only a couple hundred values, and the US alone is 40% of orders. One value can never be split, so shard-0 stays hot.',
            },
          ],
        },
        hud: ['hottest', 'skew', 'myorders'],
        legend: [L.write, L.query, L.result, L.failed],
        code: {
          title: 'mongosh',
          lang: 'js',
          code: `
!sh.shardCollection("shop.orders", { customer_id: "hashed" })  // even, 1 shard per customer
// sh.shardCollection("shop.orders", { created_at: 1 })       // newest chunk is always hot
// sh.shardCollection("shop.orders", { country: 1 })          // few values, US dominates`,
          note: 'MongoDB 5.0+ can change a collection’s shard key with reshardCollection, but it rewrites the whole collection to do it.',
        },
      },
      {
        id: 'keep-related-together',
        title: 'Keep related data together',
        cfg: { rule: 'hash', rate: 1.2, fillPer: 0.08, prefill: HASH_FILL, queries: 'predict', predict: 'query', rounds: 3, readout: 'queries' },
        body: (
          <>
            <p>
              Sharding by <code>customer_id</code> puts all of a customer&apos;s orders on the same shard. A query that names the customer goes straight
              there: the router hashes the key and asks one shard.
            </p>
            <p>A query that doesn&apos;t include the shard key can&apos;t be routed. The router has no idea where the rows are, so it asks everyone.</p>
            <p>
              Your turn: a query arrives at the <Term k="router">router</Term>. <strong>How many shards must answer it?</strong>
            </p>
          </>
        ),
        predictPrompt: 'How many shards must answer this query?',
        hud: [],
        legend: [L.write, L.query, L.result],
        code: {
          title: 'citus.sql',
          lang: 'sql',
          code: `
-- Citus (Postgres): spread orders across the cluster by customer
!SELECT create_distributed_table('orders', 'customer_id');

SELECT * FROM orders WHERE customer_id = 42;   -- routed to 1 shard
SELECT * FROM orders WHERE order_id = 90017;   -- sent to all shards`,
          note: 'If you often look orders up by order_id, keep a small order_id → customer_id lookup table, or put the shard number inside the ID.',
        },
      },
      {
        id: 'celebrity',
        title: 'The celebrity problem',
        cfg: { rule: 'hash', keyName: 'seller_id', rate: 5, cap: 4, fillPer: 0.08, prefill: HASH_FILL, readout: 'writes' },
        body: (
          <>
            <p>
              A marketplace shards <code>orders</code> by <code>seller_id</code>, so each seller&apos;s dashboard reads one shard. Hashing spreads
              thousands of sellers evenly.
            </p>
            <p>
              Then a celebrity opens a store. Seller 12 announces a merch drop, and suddenly most writes carry the same key. A hash always sends equal
              keys to the same place, so they all pile onto one shard. No shard key can split a single value.
            </p>
            <p>
              The usual fix is to <strong>salt</strong> the hot key: write to <code>12#0</code> … <code>12#3</code> at random, so its rows spread over
              several shards. The price is on reads: fetching seller 12&apos;s orders now means asking all four pieces.
            </p>
          </>
        ),
        interaction: {
          kind: 'actions',
          buttons: [
            {
              label: 'Start the merch drop',
              icon: 'bolt',
              run: (s) => s.setHot(true),
              after: <>Seller 12 hashes to shard-0 (20 mod 4 = 0), so shard-0 takes about 70% of all writes and starts timing out.</>,
            },
            {
              label: 'Salt the hot key',
              icon: 'target',
              run: (s) => {
                s.setHot(true);
                s.setSalted(true);
              },
              after: <>Each order for seller 12 now picks one of four sub-keys, and these four happen to hash to four different shards. The load evens out.</>,
            },
            { label: 'Calm down', icon: 'replay', run: (s) => s.setHot(false) },
          ],
        },
        hud: ['hottest', 'failed'],
        legend: [L.write, L.failed],
        code: {
          title: 'orders.js',
          lang: 'js',
          code: `
// salting: spread one hot key over several sub-keys
!const salt = Math.floor(Math.random() * 4);
!const shardKey = \`\${sellerId}#\${salt}\`;     // "12#0" … "12#3"

// reading the seller's orders now takes all 4 sub-keys
const keys = [0, 1, 2, 3].map((s) => \`\${sellerId}#\${s}\`);`,
          note: 'DynamoDB’s docs call this write sharding. Other fixes: a dedicated shard for the celebrity, or a cache in front for reads.',
        },
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'routing',
    title: 'Routing queries',
    steps: [
      {
        id: 'who-routes',
        title: 'Who knows where the data lives?',
        cfg: { rule: 'vitess', configSvc: true, routerMode: 'proxy', routerSub: 'vtgate', rate: 2.4, labels: true, fillPer: 0.08, prefill: HASH_FILL, readout: 'writes' },
        body: (
          <>
            <p>Something has to turn a key into a shard. There are two usual places for that logic.</p>
            <p>
              A <strong>routing proxy</strong> sits between the app and the shards and speaks the database&apos;s protocol, so the app thinks it has one
              big database. Vitess (<code>vtgate</code>) does this for MySQL, and <code>mongos</code> for MongoDB. Or the app uses a{' '}
              <strong>shard-aware client library</strong> and connects to shards directly: one hop fewer, but every service must embed the same logic.
            </p>
            <p>
              Either way, the authoritative shard map lives in a <Term k="cfg">config service</Term>: etcd, ZooKeeper, or MongoDB&apos;s config servers.
              Routers cache it and watch it for changes (the purple updates).
            </p>
            <Aside>
              Look at the shard names. Vitess hashes each key into a 64-bit keyspace ID and gives each shard a range of that space: <code>-40</code> is
              everything below 0x40…. Ranges of hashes, not mod N. Hold that thought.
            </Aside>
          </>
        ),
        interaction: {
          kind: 'toggle',
          prompt: 'Put the routing in:',
          initial: 0,
          options: [
            { label: 'A routing proxy', apply: (s) => s.setRouterMode('proxy'), note: 'App → vtgate → shard. The app just sends SQL.' },
            { label: 'The app itself', apply: (s) => s.setRouterMode('app'), note: 'App → shard directly, through a library that knows the shard map.' },
          ],
        },
        callouts: [{ target: 'cfg', text: <>the <b>shard map</b>: which range lives where</>, dir: 'down', pdir: 'hide' }],
        hud: [],
        legend: [L.write, L.map],
        code: {
          title: 'vschema.json · Vitess',
          lang: 'js',
          code: `
{
  "sharded": true,
  "vindexes": { "hash": { "type": "hash" } },
  "tables": {
    "orders": {
!      "column_vindexes": [{ "column": "customer_id", "name": "hash" }]
    }
  }
}`,
          note: 'vtgate reads this and the shard ranges (-40, 40-80, 80-c0, c0-) from the topology service.',
        },
      },
      {
        id: 'scatter-gather',
        title: 'Scatter, gather, wait for the slowest',
        cfg: { rule: 'hash', rate: 0, fillPer: 0, prefill: HASH_FILL, queries: 'demo', readout: 'queries' },
        body: (
          <>
            <p>
              A query that names the shard key goes to one shard. Anything else becomes <strong>scatter-gather</strong>: the router sends it to every
              shard, each returns a partial result, and the router merges them. For &ldquo;latest 10 orders&rdquo;, each shard returns its own 10 newest
              and the router keeps the best 10 of those 40.
            </p>
            <p>
              The catch is timing. The router can&apos;t answer until the <strong>slowest</strong> shard replies. One shard pausing for garbage
              collection or a slow disk (orange) delays the whole query.
            </p>
            <p>Run both kinds a few times and compare the averages in the HUD.</p>
            <Aside>
              If each shard is slow 1% of the time, a query that waits for 100 shards is slow 1 − 0.99¹⁰⁰ ≈ 63% of the time. Google calls this the tail
              at scale.
            </Aside>
          </>
        ),
        interaction: {
          kind: 'actions',
          buttons: [
            { label: 'Single-shard query', icon: 'play', run: (s) => s.runQuery('single') },
            { label: 'Scatter-gather query', icon: 'play', run: (s) => s.runQuery('scatter') },
          ],
        },
        hud: ['single', 'scatter'],
        legend: [L.query, L.result],
        code: {
          title: 'avg.sql',
          lang: 'sql',
          code: `
-- the app asks:
SELECT avg(total) FROM orders;

-- the router asks every shard for partial results...
!SELECT sum(total), count(*) FROM orders;
-- ...then merges them: sum of the sums / sum of the counts`,
          note: 'You can’t average the averages: a shard with 10 orders would count as much as one with 10 million.',
        },
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'across-shards',
    title: 'Across shards',
    steps: [
      {
        id: 'joins',
        title: 'Joins across shards',
        cfg: { rule: 'hash', rate: 0, fillPer: 0, prefill: HASH_FILL, queries: 'join', joinMode: 'reference', readout: 'queries' },
        body: (
          <>
            <p>
              Alice&apos;s order history needs product names, so it joins <code>orders</code> with <code>products</code>. Her orders all live on{' '}
              <Term k="s2">shard-2</Term>. Where do the products live?
            </p>
            <p>
              If <code>products</code> is a <strong>reference table</strong>, a full copy sits on every shard and the join runs locally in one round
              trip. That suits small tables that rarely change. If products are sharded by their own key, the router first fetches her orders, then the
              products from other shards, and joins them itself.
            </p>
            <p>
              The same trick applies to your own tables: shard <code>orders</code>, <code>order_items</code> and <code>payments</code> by the same{' '}
              <code>customer_id</code> and they&apos;re <strong>co-located</strong>. Joins between them never leave the shard.
            </p>
          </>
        ),
        interaction: {
          kind: 'toggle',
          prompt: 'The products table is:',
          initial: 0,
          options: [
            { label: 'A reference table', apply: (s) => s.setJoinMode('reference'), note: 'One shard, one round trip.' },
            { label: 'Sharded by product_id', apply: (s) => s.setJoinMode('sharded'), note: 'Two round trips over three shards, and the router does the join.' },
          ],
        },
        hud: ['join'],
        legend: [L.query, L.result],
        code: {
          title: 'citus.sql',
          lang: 'sql',
          code: `
-- a small table copied to every node, so joins with it stay local
!SELECT create_reference_table('products');

-- shard related tables by the same key so their rows live together
SELECT create_distributed_table('order_items', 'customer_id',
                                colocate_with => 'orders');`,
        },
      },
      {
        id: 'transactions',
        title: 'Transactions across shards',
        cfg: { scene: 'twopc', rate: 0, readout: 'none' },
        body: (
          <>
            <p>
              Alice pays Bob $50. Her account lives on shard-0 and his on shard-2. Each shard can commit its own half, but if one commits and the other
              fails, money vanishes or appears from nowhere.
            </p>
            <p>
              <strong>Two-phase commit</strong> (2PC) makes both halves happen or neither. Each shard does its half, then the coordinator (here the router)
              asks each one to <strong>PREPARE</strong>: make the change durable, keep its locks, and vote YES. Only when
              every vote is YES does it log the decision and send <strong>COMMIT</strong>.
            </p>
            <p>
              The weak spot is the coordinator. Crash it after the votes and the shards are stuck <em>in doubt</em>. Having voted YES, they can&apos;t
              abort on their own, and they can&apos;t commit without the decision. So they wait, holding their locks.
            </p>
          </>
        ),
        interaction: {
          kind: 'actions',
          buttons: [
            {
              label: 'Crash the coordinator mid-commit',
              icon: 'power',
              run: (s) => s.runTransfer(true),
              after: (
                <>
                  Both shards voted YES and now wait. Any write to Alice&apos;s or Bob&apos;s row is stuck behind those locks. Plain reads still get the old
                  balances.
                </>
              ),
            },
            {
              label: 'Restart the coordinator',
              icon: 'replay',
              run: (s) => s.recoverCoordinator(),
              after: <>It reads its log, finds the COMMIT decision and finishes the job. Nothing was lost, but everyone waited.</>,
            },
          ],
        },
        legend: [
          { label: 'request', color: SIG.req, shape: 'line' },
          { label: 'PREPARE', color: SIG.warn, shape: 'line' },
          { label: 'vote · commit · ack', color: SIG.res, shape: 'line' },
          { label: 'locks held', color: SIG.heavy, shape: 'square' },
        ],
        code: {
          title: 'transfer.sql · PostgreSQL',
          lang: 'sql',
          code: `
-- phase 1, on shard-0 (and the same on shard-2):
BEGIN;
UPDATE accounts SET balance = balance - 50 WHERE id = 'alice';
!PREPARE TRANSACTION 'transfer-7731';  -- durable, locks kept: a YES vote

-- phase 2, once every shard has voted YES:
!COMMIT PREPARED 'transfer-7731';`,
          note: 'Needs max_prepared_transactions > 0. MySQL’s version is XA PREPARE / XA COMMIT. Citus and MongoDB run 2PC for you on multi-shard writes.',
        },
      },
      {
        id: 'global-ids',
        title: 'IDs without a single counter',
        cfg: { rule: 'hash', rate: 1.4, fillPer: 0.05, prefill: HASH_FILL, idMode: 'auto', readout: 'ids' },
        body: (
          <>
            <p>
              On one database, <code>AUTO_INCREMENT</code> hands out order numbers 1001, 1002, 1003… Give every shard its own counter and they all count
              the same numbers. Two customers both get order #1004, and a payment gets attached to the wrong one.
            </p>
            <p>
              Sharded systems make IDs that are unique without asking anyone. A <strong>Snowflake ID</strong> packs three things into 64 bits: the time
              in milliseconds, the shard or machine number, and a counter for IDs made in the same millisecond. No coordination, and sorting by ID
              roughly sorts by time.
            </p>
            <p>Switch the scheme and watch the duplicates stop.</p>
            <Aside>
              Other options: random UUIDs (version 7 puts the time first, which keeps indexes tidy), or per-shard offsets like MySQL&apos;s{' '}
              <code>auto_increment_increment</code>. Instagram puts the logical shard number inside every ID, so the ID also says where the row lives.
            </Aside>
          </>
        ),
        interaction: {
          kind: 'toggle',
          prompt: 'Each shard makes IDs with:',
          initial: 0,
          options: [
            { label: 'AUTO_INCREMENT', apply: (s) => s.setIdMode('auto'), note: 'Four counters, counting the same numbers.' },
            { label: 'Snowflake IDs', apply: (s) => s.setIdMode('snowflake'), note: 'Time, shard and sequence bits: unique by construction.' },
          ],
        },
        hud: ['ids', 'dupes'],
        legend: [L.write, L.id, L.dup],
        code: {
          title: 'ids.js',
          lang: 'js',
          code: `
// Snowflake-style id: 41 bits of time, 10 of shard, 12 of sequence
!const id = (BigInt(Date.now() - EPOCH) << 22n)
!         | (BigInt(shardId) << 12n)
!         | BigInt(seq++ & 4095);`,
          note: 'Up to 4,096 IDs per millisecond per shard, and the time bits last about 69 years from your EPOCH.',
        },
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'resharding',
    title: 'Resharding',
    steps: [
      {
        id: 'mod-n-trap',
        title: 'Adding a shard: the mod N trap',
        cfg: { rule: 'hash', tiles: true, hashMode: 'modn', rate: 0, prefill: HASH_FILL, readout: 'tiles' },
        body: (
          <>
            <p>
              Shards fill up, so eventually you add one. The squares inside each shard are sample rows, labeled with their hash. Right now each row sits
              on <code>hash mod 4</code>.
            </p>
            <p>
              With a fifth shard the formula becomes <code>hash mod 5</code>, and almost every answer changes. Row 12 lives on shard-0 (12 mod 4 = 0)
              but belongs on shard-2 (12 mod 5 = 2). Every move copies data across the network while the shards keep serving traffic.
            </p>
            <p>Guess first, then add the shard.</p>
          </>
        ),
        quiz: {
          question: 'Going from 4 to 5 shards with hash mod N, roughly what share of the rows must move?',
          options: [
            {
              text: 'About 20%, the new shard’s fair share',
              why: 'That’s the least you could move. With mod N a row only stays when hash mod 4 equals hash mod 5, which is rare.',
            },
            { text: 'About 50%', why: 'Worse than that. A row stays only when hash mod 4 equals hash mod 5: 4 hashes in every 20.' },
            {
              text: 'About 80%',
              correct: true,
              why: 'A row stays only when hash mod 4 equals hash mod 5, which holds for 4 hashes in every 20. Going from N to N+1 shards moves N/(N+1) of everything.',
            },
          ],
        },
        interaction: {
          kind: 'actions',
          buttons: [
            {
              label: 'Add shard-4 (mod 5)',
              icon: 'plus',
              run: (s) => s.reshardTiles(5),
              after: <>19 of 24 rows moved. Only 40, 21, 62, 83 and 43 stayed, because their remainder is the same under mod 4 and mod 5.</>,
            },
            { label: 'Back to 4 shards', icon: 'minus', run: (s) => s.reshardTiles(4) },
          ],
        },
        hud: ['moved'],
        legend: [L.move],
        code: {
          title: 'router.js',
          lang: 'js',
          code: `
!const shard = hash(customerId) % shards.length;
// shards.length goes 4 → 5, and most rows now map somewhere else`,
        },
      },
      {
        id: 'move-less',
        title: 'Move less: many small buckets',
        cfg: { rule: 'hash', tiles: true, hashMode: 'buckets', rate: 0, prefill: HASH_FILL, readout: 'tiles' },
        body: (
          <>
            <p>
              The fix is to stop tying rows to machines directly. Hash each key into a fixed number of <strong>buckets</strong>, far more than you have
              shards, and keep a small table of which shard owns which bucket. Here: 16 buckets, four per shard.
            </p>
            <p>
              Adding shard-4 changes no formula. It takes over three buckets (13, 14 and 15), and only the rows in those buckets move: about a fifth of
              the data, which is the least any scheme can move.
            </p>
            <p>
              Real systems do exactly this. MongoDB&apos;s balancer migrates whole chunks of hash values, and Vitess splits a shard&apos;s key range in two.
              Notion split its Postgres data into 480 logical shards on 32 machines so it could move them later.{' '}
              <Link className={css.link} href="/learn/consistent-hashing">
                Consistent hashing
              </Link>{' '}
              is another way to get the same property.
            </p>
          </>
        ),
        interaction: {
          kind: 'actions',
          buttons: [
            {
              label: 'Add shard-4 (take 3 buckets)',
              icon: 'plus',
              run: (s) => s.reshardTiles(5),
              after: <>5 of 24 rows moved, all from buckets 13, 14 and 15. Everything else stayed put.</>,
            },
            { label: 'Back to 4 shards', icon: 'minus', run: (s) => s.reshardTiles(4) },
          ],
        },
        hud: ['moved'],
        legend: [L.move],
        code: {
          title: 'mongosh',
          lang: 'js',
          code: `
!sh.addShard("rs4/10.0.2.14:27017")   // a new, empty shard
// the balancer then migrates whole chunks (ranges of hash values)
// onto it, a few at a time, while traffic keeps flowing`,
          note: 'Moving live data: copy the bucket, stream the changes made meanwhile, then switch reads and writes over in a brief pause.',
        },
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'recap',
    title: 'Recap & playground',
    steps: [
      {
        id: 'cheat-sheet',
        title: 'Cheat sheet',
        cfg: { rule: 'hash', rate: 4, fillPer: 0.05, prefill: HASH_FILL, queries: 'myorders', readout: 'writes' },
        body: (
          <p>
            The whole lesson on one page. Behind it runs a healthy hash-sharded table: even load, and the most common query goes to a single shard.
          </p>
        ),
        extra: <CheatSheet />,
        hud: ['hottest', 'skew', 'myorders'],
        legend: [L.write, L.query, L.result],
      },
      {
        id: 'playground',
        title: 'Playground',
        cfg: {
          rule: 'hash',
          rate: 6,
          fillPer: 0.05,
          prefill: [26, 26, 26, 26],
          years: [2021, 2022, 2023, 2024, 2025, 2026],
          readout: 'writes',
        },
        body: (
          <p>
            Everything in one sandbox. Pick a shard key, change the traffic, add or remove shards, and unleash a hot key. The code at the bottom follows
            your settings.
          </p>
        ),
        interaction: { kind: 'playground' },
        hud: ['writes', 'hottest', 'failed', 'moved'],
        legend: [L.write, L.move, L.failed],
      },
    ],
  },
];
