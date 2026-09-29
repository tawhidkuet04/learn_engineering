import { ActionsCard, SliderCard, Stat, ToggleCard } from '@/components/lesson/cards';
import { Aside } from '@/components/lesson/Prose';
import { Term } from '@/components/lesson/Term';
import { CheatSheet } from './panel/CheatSheet';
import { KEYS as PLAYGROUND_KEYS, Playground } from './panel/Playground';
import { CURVE_MAX, sizeForGoal } from './overlays';
import { HOT } from './products';
import type { Chapter } from './types';

export const LESSON = {
  slug: 'caching',
  code: 'SD-02',
  track: 'System design',
  title: 'Caching',
};

const pct = (v: number | null) => (v == null ? '—' : `${Math.round(v * 100)}%`);
const WARM6 = [42, 7, 13, 5, 21, 8];
const WARM8 = [42, 7, 13, 5, 21, 8, 99, 3];
const GOAL = 0.75;

export const CHAPTERS: Chapter[] = [
  /* ================================================================ */
  {
    id: 'why',
    title: 'Why cache?',
    cfg: { keys: 16 },
    steps: [
      {
        id: 'every-read-hits-the-db',
        title: 'Every read hits the database',
        reset: true,
        cfg: { cache: false, rps: 1.3 },
        body: (
          <>
            <p>
              Meet an outdoor-gear shop: three <Term k="alice">shoppers</Term>, one <Term k="app">app server</Term> and a <Term k="db">Postgres</Term>{' '}
              database. Every product page runs a query that joins the product with its 12,000 reviews to get the average rating. It takes about{' '}
              <strong>50 ms</strong>.
            </p>
            <p>
              Each orange dot is one of those queries, and the bars inside Postgres are queries running right now. The database is busy, and every
              shopper waits the full 50 ms, longer when queries have to queue.
            </p>
            <p>
              Now look at <em>what</em> it computes. The tally counts reads per product: the same few, over and over. Trail boots (
              <code>product:42</code>) alone gets about a third of all views. Postgres works out the same answer again and again.
            </p>
            <Aside>
              Popularity like this is so common it has a name: a <strong>Zipf distribution</strong>. The second most popular item gets roughly half the
              views of the first, the third roughly a third, and so on down a long tail.
            </Aside>
          </>
        ),
        readout: 'tally',
        hud: ['p95', 'db'],
        legend: ['req', 'query', 'resp'],
        callouts: [{ target: 'db', text: <>every read: a <b>50 ms query</b></>, dir: 'up', pdir: 'down' }],
        code: [
          {
            title: 'product page query',
            lang: 'sql',
            code: `
-- runs on every product page view
!SELECT p.name, p.price,
!       avg(r.stars), count(r.id)
FROM products p
JOIN reviews r ON r.product_id = p.id
WHERE p.id = 42
GROUP BY p.id;

-- EXPLAIN ANALYZE says:
--   Planning Time: 0.3 ms
!--   Execution Time: 48.7 ms`,
          },
        ],
      },
      {
        id: 'memory-is-faster',
        title: 'Memory is 50× faster',
        reset: true,
        cfg: { view: 'race', cache: true, slots: 1, prewarm: [42], rps: 0 },
        body: (
          <>
            <p>
              A <strong>cache</strong> keeps a copy of data somewhere faster to read. For web apps the most popular choice is <Term k="cache">Redis</Term>,
              a server that keeps everything in RAM.
            </p>
            <p>
              Watch the race: the <Term k="app">app</Term> asks Redis and <Term k="db">Postgres</Term> for the same product at the same moment. This race
              is <strong>drawn to scale</strong>. Redis answers in about 1 ms, and most of that is the network hop. Postgres needs about 50.
            </p>
            <p>
              Why the gap? Redis looks the key up in an in-memory hash table and sends back a string it already has. Postgres has to plan the query,
              read pages, join 12,000 reviews and average them.
            </p>
            <Aside>
              From here on the animation is slowed down and <em>not</em> to scale, or cache hits would be a blur. The millisecond labels show
              real-world timings.
            </Aside>
          </>
        ),
        readout: 'ladder',
        legend: ['req', 'hit', 'query'],
        code: [
          {
            title: 'terminal',
            lang: 'shell',
            code: `
$ redis-cli -h 10.0.2.6 --latency
!min: 0, max: 1, avg: 0.21 (1532 samples)

$ redis-cli -h 10.0.2.6 GET product:42
"{\\"name\\":\\"Trail boots\\",\\"price\\":89}"`,
            note: '--latency pings Redis over and over and reports round trips in milliseconds.',
          },
        ],
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'cache-aside',
    title: 'Cache-aside',
    cfg: { keys: 8, slots: 8 },
    steps: [
      {
        id: 'check-the-cache-first',
        title: 'Check the cache first',
        reset: true,
        cfg: { tour: true, sequential: true, sequence: [42, 42, 7, 7, 13, 42], rps: 1 },
        body: (
          <>
            <p>
              The most common way to use a cache is <strong>cache-aside</strong>, also called lazy loading. The app is in charge, and the cache sits off to
              the side:
            </p>
            <p>
              <strong>1.</strong> Ask <Term k="cache">Redis</Term> for the key. <strong>2.</strong> On a <strong>hit</strong>, you’re done.{' '}
              <strong>3.</strong> On a <strong>miss</strong>, query <Term k="db">Postgres</Term>, store a copy in Redis, then reply.
            </p>
            <p>
              Follow the card riding along. The first read of <code>product:42</code> misses and takes the long way, but it leaves a copy behind. The next
              read of it is a hit and comes straight back.
            </p>
          </>
        ),
        hud: ['hit', 'avg'],
        legend: ['req', 'hit', 'nil', 'query', 'set'],
        code: [
          {
            title: 'products.js',
            lang: 'js',
            code: `
async function getProduct(id) {
  const key = \`product:\${id}\`;
  // 1. ask Redis first (~1 ms)
!  const cached = await redis.get(key);
!  if (cached) return JSON.parse(cached);

  // 2. a miss: query Postgres (~50 ms)
  const { rows } = await db.query(SQL, [id]);
  // 3. keep a copy for 60 seconds
!  await redis.set(key, JSON.stringify(rows[0]),
!    { EX: 60 });
  return rows[0];
}`,
          },
        ],
      },
      {
        id: 'hit-or-miss',
        title: 'Hit or miss?',
        reset: true,
        cfg: { sequential: true, sequence: [42, 5, 5, 13, 21, 7, 21, 99, 42, 8], prewarm: [42, 7, 13], rps: 1, predict: 'hitmiss' },
        predict: { rounds: 3, prompt: 'Is this product already in Redis?' },
        body: (
          <>
            <p>Your turn. Reads now arrive one at a time, and the animation pauses as each one reaches the app.</p>
            <p>
              Check the keys in <Term k="cache">Redis</Term> and predict: will this read <strong>hit</strong> or <strong>miss</strong>? Remember that every
              miss leaves a copy behind.
            </p>
          </>
        ),
        hud: ['hit'],
        legend: ['req', 'hit', 'nil', 'query', 'set'],
        code: [
          {
            title: 'redis-cli',
            lang: 'shell',
            code: `
!127.0.0.1:6379> SCAN 0 MATCH product:* COUNT 100
1) "0"
2) 1) "product:42"
   2) "product:7"
   3) "product:13"`,
            note: 'SCAN walks the keyspace in small batches. Avoid KEYS in production: it blocks Redis while it scans everything.',
          },
        ],
      },
      {
        id: 'hit-ratio',
        title: 'Hit ratio is everything',
        reset: true,
        cfg: { rps: 2.4 },
        body: (
          <>
            <p>
              The share of reads served from the cache is the <strong>hit ratio</strong>. This cache starts empty, or <strong>cold</strong>, so at first
              everything misses. Watch the ratio climb as it <strong>warms up</strong>.
            </p>
            <p>
              It’s the number that matters most, because average latency mixes the two paths: <code>hits × 1 ms + misses × 52 ms</code>. The readout does
              the math live.
            </p>
            <p>
              Misses are rare, yet they dominate that average. Going from 90% hits to 99% makes the average read about 4× faster and cuts the reads that
              reach Postgres by 10×.
            </p>
          </>
        ),
        readout: 'formula',
        hud: ['hit', 'avg', 'db'],
        legend: ['req', 'hit', 'nil', 'query', 'set'],
        quiz: {
          question: 'Your hit ratio improves from 90% to 99%. What happens to the read traffic reaching Postgres?',
          options: [
            {
              text: 'It drops about 9%',
              why: 'That’s how much the hits went up. Postgres only sees the misses, and those fell from 10% of reads to 1%.',
            },
            {
              text: 'It drops 10×',
              correct: true,
              why: 'Misses fell from 10 in every 100 reads to 1 in 100. Small changes near the top of the hit ratio make huge differences to the database.',
            },
            {
              text: 'It stays the same',
              why: 'Every hit is a read Postgres never sees. More hits means fewer queries.',
            },
          ],
        },
        code: [
          {
            title: 'terminal',
            lang: 'shell',
            code: `
$ redis-cli INFO stats | grep keyspace
!keyspace_hits:1843021
!keyspace_misses:96112
# 1843021 / (1843021 + 96112) ≈ 95% hits`,
          },
        ],
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'expiry',
    title: 'Expiry',
    cfg: { keys: 8, slots: 8, showTtl: true },
    steps: [
      {
        id: 'ttl',
        title: 'Every key gets a TTL',
        reset: true,
        cfg: { ttl: 8, rps: 2.4, prewarm: WARM6 },
        body: (
          <>
            <p>
              A cached copy can’t live forever, because the real data changes. So every key gets a <strong>time to live</strong> (TTL).{' '}
              <code>SET product:42 … EX 60</code> tells Redis to delete the key 60 seconds later.
            </p>
            <p>
              The bar on each row is its TTL running down. When it hits zero the key disappears, and the next read of it misses and fetches a fresh copy
              from <Term k="db">Postgres</Term>.
            </p>
            <Aside>
              Time is compressed: these TTLs are 8 seconds so you can watch them run out. Redis deletes an expired key when something touches it, and a
              background job samples keys with a TTL about 10 times a second to clean up the rest.
            </Aside>
          </>
        ),
        hud: ['hit', 'db'],
        legend: ['req', 'hit', 'nil', 'query', 'set'],
        callouts: [{ target: 'ttl', text: <>seconds until <b>Redis deletes it</b></>, dir: 'up', only: 'landscape' }],
        code: [
          {
            title: 'redis-cli',
            lang: 'shell',
            code: `
!127.0.0.1:6379> SET product:42 "{…}" EX 60
OK
127.0.0.1:6379> TTL product:42
!(integer) 42
# …a minute later:
127.0.0.1:6379> GET product:42
(nil)`,
            note: 'TTL answers -1 for a key with no expiry and -2 for a key that doesn’t exist.',
          },
        ],
      },
      {
        id: 'ttl-tradeoff',
        title: 'Short TTL or long TTL?',
        reset: true,
        cfg: { ttl: 6, rps: 2.6, admin: true, writeEvery: 2.2, writeMode: 'none', prewarm: WARM6 },
        body: (
          <>
            <p>
              Now <Term k="dave">Dave</Term>, the shop admin, changes a price every couple of seconds (the yellow squares). Postgres has the new price
              right away. Redis doesn’t: until its copy expires, shoppers get the old price. That’s a <strong>stale read</strong> (red).
            </p>
            <p>
              Drag the TTL. A <strong>long</strong> TTL means more hits and less database load, but more stale reads. A <strong>short</strong> TTL keeps
              data fresher but sends more reads to Postgres.
            </p>
            <p>
              A TTL is a promise about staleness: a copy is never more than one TTL out of date. Pick it per kind of data. A product description can be an
              hour old; stock levels, a few seconds at most.
            </p>
          </>
        ),
        cards: (sim, { cfg }) => (
          <SliderCard
            poll={sim}
            prompt="How stale are you willing to be?"
            sliders={[
              {
                label: 'TTL',
                min: 1,
                max: 30,
                step: 1,
                initial: cfg.ttl,
                format: (v) => `${v} s`,
                ends: ['fresh', 'fast'],
                onChange: (v) => sim.setTtl(v),
              },
            ]}
            stats={() => (
              <>
                <Stat label="hits" value={pct(sim.hitRatio)} />
                <Stat label="stale reads" value={pct(sim.staleRate)} bad={(sim.staleRate ?? 0) > 0.1} />
                <Stat label="DB load" value={pct(sim.dbLoad)} bad={sim.dbLoad > 0.8} />
              </>
            )}
          />
        ),
        hud: ['hit', 'stale', 'db'],
        legend: ['write', 'hit', 'stale', 'query'],
        code: [
          {
            title: 'catalog.js',
            lang: 'js',
            code: `
// how stale may each kind of data be?
const TTL = {
  description: 3600,  // an hour
!  price: 60,          // a minute
!  stock: 5,           // a few seconds
};
await redis.set(key, json, { EX: TTL.price });`,
          },
        ],
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'eviction',
    title: 'Eviction',
    cfg: { keys: 16, slots: 6, ttl: 0, showTtl: false, order: 'policy' },
    steps: [
      {
        id: 'out-of-room',
        title: 'Out of room',
        reset: true,
        cfg: { rps: 1.6, prewarm: WARM6 },
        body: (
          <>
            <p>
              Redis keeps everything in RAM, and RAM is limited, so you cap it with <code>maxmemory</code>. Here the cache holds 6 keys, but the shop sells
              16 products.
            </p>
            <p>
              When a new key arrives and the cache is full, Redis must <strong>evict</strong> one. This policy is <strong>LRU</strong>, least recently
              used. The rows stay in order of last use: every read moves a key to the top, and when room is needed, the bottom key goes.
            </p>
            <p>
              Watch <Term k={`row:${HOT}`}>product:42</Term>: it’s read so often that it seldom sinks to the bottom. When it does get evicted, its next
              read brings it right back.
            </p>
            <Aside>
              Real Redis approximates LRU. Instead of keeping a sorted list, it samples 5 keys at a time (<code>maxmemory-samples</code>) and evicts the
              one idle longest among the keys it has sampled. It needs no extra memory per key, and it’s nearly as good: on this lesson’s traffic, over
              12,000 reads, its hit ratio stayed within about two points of exact LRU’s 66%.
            </Aside>
          </>
        ),
        hud: ['hit', 'db'],
        legend: ['hit', 'nil', 'query', 'set', 'evict'],
        callouts: [{ target: 'row:next', text: <>least recently used: <b>next out</b></>, dir: 'left', pdir: 'down' }],
        code: [
          {
            title: 'redis.conf',
            lang: 'conf',
            code: `
!maxmemory 2gb
!maxmemory-policy allkeys-lru
maxmemory-samples 5`,
            note: 'The default policy is noeviction: when memory is full, writes fail with an OOM error. Other choices include allkeys-lfu, allkeys-random and volatile-lru (only keys that have a TTL).',
          },
        ],
      },
      {
        id: 'which-key-goes',
        title: 'Which key goes?',
        reset: true,
        cfg: { sequential: true, rps: 1, prewarm: WARM6, sequence: [7, 99, 42, 3, 13, 64, 5, 17, 42, 11], predict: 'evict' },
        predict: { rounds: 3, prompt: 'The cache is full. Which key will LRU evict?' },
        pickRows: true,
        body: (
          <>
            <p>
              Your turn. When a miss needs room in the full cache, the animation pauses. <strong>Click the key LRU will evict.</strong>
            </p>
            <p>Watch the hits in between: each one moves its key to the top and changes who’s at the bottom.</p>
            <Aside>
              Real Redis doesn’t always agree. We ran these ten reads on Redis 7.2.5 again and again: its picks changed from run to run, and sometimes
              it evicted <code>product:5</code> the moment it was written, because it still remembered the old <code>product:5</code> as long idle.
            </Aside>
          </>
        ),
        hud: ['hit'],
        legend: ['hit', 'nil', 'query', 'set', 'evict'],
        code: [
          {
            title: 'redis-cli',
            lang: 'shell',
            code: `
127.0.0.1:6379> OBJECT IDLETIME product:42
(integer) 0
!127.0.0.1:6379> OBJECT IDLETIME product:8
!(integer) 94`,
            note: 'IDLETIME is how many seconds since a key was last read or written: exactly what LRU compares.',
          },
        ],
      },
      {
        id: 'lru-lfu-fifo',
        title: 'LRU, LFU or FIFO?',
        reset: true,
        cfg: { rps: 2.6, prewarm: WARM6 },
        body: (
          <>
            <p>
              <strong>FIFO</strong> (first in, first out) evicts whichever key was cached first, no matter how popular it is. Switch to it and watch{' '}
              <Term k={`row:${HOT}`}>product:42</Term>: it sinks to the bottom and gets thrown out for being old, then misses on its very next read.
            </p>
            <p>
              <strong>LFU</strong> (least frequently used) counts reads and evicts the least popular key. It wins when popularity is stable, but a key
              that was hot yesterday can hog space long after, so Redis’s LFU slowly decays its counters. Its counts are approximate, so on this
              traffic Redis’s LFU scores below the exact LFU in the readout, though it usually still beats LRU.
            </p>
            <p>
              <strong>LRU</strong> is the usual choice: cheap, and quick to adapt when popularity shifts. The readout compares all three on this exact
              traffic over 12,000 reads.
            </p>
          </>
        ),
        cards: (sim) => (
          <ToggleCard
            prompt="Eviction policy:"
            options={[
              { label: 'LRU', apply: () => sim.setPolicy('lru'), note: <>Most recently used on top. A hit moves a key to the top; the bottom goes.</> },
              { label: 'LFU', apply: () => sim.setPolicy('lfu'), note: <>Most read on top (the violet counts). The least read key goes.</> },
              { label: 'FIFO', apply: () => sim.setPolicy('fifo'), note: <>Newest on top, and hits don’t reorder anything. The oldest key goes, however popular.</> },
            ]}
          />
        ),
        readout: 'policies',
        hud: ['hit', 'db'],
        legend: ['hit', 'nil', 'query', 'set', 'evict'],
        code: [
          {
            title: 'redis.conf',
            lang: 'conf',
            code: `
!maxmemory-policy allkeys-lfu
# counts grow ever more slowly: about 10
# after 100 reads, 255 (the max) by a million
lfu-log-factor 10
# an idle key's count drops by 1 each minute
!lfu-decay-time 1`,
            note: 'Redis has no FIFO policy, though volatile-ttl acts much like one when every key has the same TTL. FIFO is here to show why recency matters.',
          },
        ],
      },
      {
        id: 'working-set',
        title: 'How big should it be?',
        reset: true,
        cfg: { rps: 2.6, slots: 3 },
        body: (
          <>
            <p>
              Drag the cache size. The first few slots help enormously, because they hold the hottest products. Then the curve flattens: each extra slot
              holds a product that’s rarely read.
            </p>
            <p>
              The keys your traffic actually touches over a period of time are its <strong>working set</strong>. Size the cache for the hot part of it.
              RAM spent on the long tail buys almost nothing.
            </p>
          </>
        ),
        cards: (sim, { cfg }) => {
          const goal = sizeForGoal(16, cfg.skew, GOAL);
          return (
            <SliderCard
              poll={sim}
              prompt={<>Find the smallest cache that serves 75% of reads from memory.</>}
              sliders={[
                {
                  label: 'Cache size',
                  min: 1,
                  max: CURVE_MAX,
                  step: 1,
                  initial: cfg.slots,
                  format: (v) => `${v} keys`,
                  ends: ['1 key', `${CURVE_MAX} keys`],
                  onChange: (v) => sim.setSlots(v),
                },
              ]}
              stats={() => (
                <>
                  <Stat label="hits (live)" value={pct(sim.hitRatio)} />
                  <Stat label="DB load" value={pct(sim.dbLoad)} bad={sim.dbLoad > 0.8} />
                </>
              )}
              done={() =>
                sim.cache.capacity === goal ? (
                  <>
                    <strong>That’s it: {goal} keys.</strong> Half the catalog serves about three quarters of all reads. On this traffic the first 4 slots
                    buy about 51 points of hit ratio; the last 4 (keys 13 to 16) would buy about 9.
                  </>
                ) : null
              }
            />
          );
        },
        readout: 'curve',
        hud: ['hit', 'db'],
        legend: ['hit', 'nil', 'query', 'set', 'evict'],
        code: [
          {
            title: 'terminal',
            lang: 'shell',
            code: `
$ redis-cli INFO memory
…
used_memory_human:1.83G
…
maxmemory_human:2.00G
…
$ redis-cli INFO stats | grep evicted_keys
!evicted_keys:48213`,
            note: 'A steadily climbing evicted_keys with a falling hit ratio means your working set no longer fits.',
          },
        ],
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'writes',
    title: 'Writes',
    cfg: { keys: 8, slots: 8, admin: true, showTable: true, ttl: 0, showTtl: false },
    steps: [
      {
        id: 'dave-changes-a-price',
        title: 'Dave changes a price',
        reset: true,
        cfg: { rps: 1.8, prewarm: WARM6, writeMode: 'none', writeEvery: 0 },
        body: (
          <>
            <p>
              Here’s the catch with every cache: it holds <strong>copies</strong>, and copies go stale. <Term k="dave">Dave</Term> is about to put Trail
              boots on sale.
            </p>
            <p>
              Press the first button. <Term k="db">Postgres</Term> now says $79, but Redis still has $89 and no idea anything changed. Every shopper who
              reads <Term k={`row:${HOT}`}>product:42</Term> sees the old price (red), and nothing fixes it until the key expires or gets evicted.
            </p>
            <p>
              The fix is to <strong>invalidate</strong>: whenever you write to the database, delete the cached key too. Press the second button. The next
              read misses and loads the new price.
            </p>
            <Aside>
              Why delete instead of writing the new value into Redis? Deleting is simpler and safer when two updates race: the next read always reloads
              whatever the database holds.
            </Aside>
          </>
        ),
        cards: (sim) => (
          <ActionsCard
            buttons={[
              {
                label: 'Change the price (DB only)',
                icon: 'bolt',
                run: () => sim.changePrice(HOT, 'none'),
                after: (
                  <>
                    Postgres has the new price, Redis still serves the old one. Every red response is a shopper seeing a price that no longer exists.
                  </>
                ),
              },
              {
                label: 'Change it and DEL the key',
                icon: 'check',
                run: () => sim.changePrice(HOT, 'around'),
                after: (
                  <>
                    <code>UPDATE</code>, then <code>DEL product:42</code>. The next read misses, reloads the row, and the cache is right again.
                  </>
                ),
              },
            ]}
          />
        ),
        readout: 'table',
        hud: ['stale', 'hit'],
        legend: ['write', 'hit', 'stale', 'set'],
        code: [
          {
            title: 'products.js',
            lang: 'js',
            code: `
async function updatePrice(id, price) {
!  await db.query(
!    'UPDATE products SET price=$1 WHERE id=$2',
!    [price, id]);
  // invalidate: the next read reloads it
!  await redis.del(\`product:\${id}\`);
}`,
          },
        ],
      },
      {
        id: 'three-ways-to-write',
        title: 'Three ways to write',
        reset: true,
        cfg: { rps: 1.6, prewarm: WARM6, writeMode: 'through', writeEvery: 3.2 },
        body: (
          <>
            <p>Deleting on write is one option. There are three classic strategies. Pick one and watch Dave’s writes; the HUD shows how long each one takes.</p>
            <p>
              <strong>Write-through</strong>: write to Postgres and Redis, then reply. Reads stay fresh and keep hitting, but every write waits for the
              database.
            </p>
            <p>
              <strong>Write-back</strong> (or write-behind): write to Redis only, reply at once, and flush to Postgres every few seconds in batches.
              Writes are fast, but if Redis dies before a flush, those writes are gone. Try crashing it.
            </p>
            <p>
              <strong>Write-around</strong>: write only to Postgres and delete the cached key, so the next read reloads it. Good for data that’s written
              far more often than it’s read.
            </p>
            <Aside>
              Redis can save to disk, which narrows the window. Out of the box it snapshots at most once a minute, and a crash loses every write since
              the last snapshot. With the append-only file on, a killed Redis came back with every write it had acknowledged, though by default it
              syncs that file to disk only once a second.
            </Aside>
          </>
        ),
        cards: (sim) => (
          <>
            <ToggleCard
              prompt="Write strategy:"
              options={[
                { label: 'Write-through', apply: () => sim.setWriteMode('through'), note: <>Postgres first, then Redis, then the reply. About 10 ms per write.</> },
                {
                  label: 'Write-back',
                  apply: () => sim.setWriteMode('back'),
                  note: <>Redis only, then the reply: about 1 ms. Orange rows are “dirty”: newer than Postgres until the next flush.</>,
                },
                { label: 'Write-around', apply: () => sim.setWriteMode('around'), note: <>Postgres, then DEL the key. The next read of it misses.</> },
              ]}
            />
            <ActionsCard
              kicker="Break it"
              prompt="What happens to unflushed writes if Redis dies?"
              buttons={[
                {
                  label: 'Crash Redis',
                  icon: 'power',
                  run: () => sim.crashCache(),
                  after: (
                    <>
                      With write-back, any <strong>dirty</strong> rows never reached Postgres: Dave was told “saved”, and the change is simply gone. With
                      the other two, only copies are lost. Either way Redis comes back <strong>cold</strong>, because this one has no snapshot to
                      reload, so every read misses and Postgres takes the full load until the cache warms up again.
                    </>
                  ),
                },
              ]}
            />
          </>
        ),
        readout: 'writes',
        hud: ['writeMs', 'stale', 'lost'],
        legend: ['write', 'set', 'query', 'flush', 'stale'],
        code: [
          {
            title: 'products.js',
            lang: 'js',
            code: `
// write-through: both, before replying
await db.query(UPDATE_SQL, [price, id]);
!await redis.set(key, json, { EX: 60 });

// write-back: reply now, flush later
!await redis.set(key, json);
!await redis.sAdd('dirty-products', String(id));`,
          },
        ],
      },
      {
        id: 'a-race-you-can-lose',
        title: 'A race you can lose',
        reset: true,
        cfg: { view: 'sequence', rps: 0, admin: false, showTable: false },
        body: (
          <>
            <p>
              Even delete-on-write has a gap. Read the diagram from the top: a reader misses and loads the price from Postgres, $89. Then it stalls for a
              moment: a garbage-collection pause, a slow network.
            </p>
            <p>
              Meanwhile a writer updates the price to $79 and deletes the key, which isn’t even cached yet. Then the reader wakes up and caches the{' '}
              <strong>old</strong> price. It stays wrong until the TTL runs out.
            </p>
            <p>
              That’s why you keep a TTL even when you invalidate on write: it bounds how long a mistake can live. At very large scale you go further.
              Facebook’s memcache hands out <strong>leases</strong>, tokens issued on a miss that a delete cancels, so a late <code>SET</code> like this one
              gets rejected.
            </p>
          </>
        ),
        cards: (_sim, { replay }) => <ActionsCard buttons={[{ label: 'Replay the race', icon: 'replay', run: replay }]} />,
        code: [
          {
            title: 'products.js',
            lang: 'js',
            code: `
const { rows } = await db.query(SQL, [id]);
// …a pause here, while a writer UPDATEs
// the price and DELs the key…
!await redis.set(key, JSON.stringify(rows[0]),
!  { EX: 60 }); // the TTL is the safety net`,
          },
        ],
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'stampede',
    title: 'Stampedes',
    cfg: { keys: 8, slots: 8, ttl: 20, showTtl: true, hotShare: 0.7, rps: 5, prewarm: WARM8, hotTtlLeft: 5.5 },
    steps: [
      {
        id: 'when-a-hot-key-expires',
        title: 'When a hot key expires',
        reset: true,
        cfg: { predict: 'stampede' },
        predict: { rounds: 1, prompt: 'product:42 is about to expire. What happens next?' },
        body: (
          <>
            <p>
              Flash sale! Most traffic now wants <Term k={`row:${HOT}`}>product:42</Term>, and Redis absorbs it easily. Watch its TTL bar run down.
            </p>
            <p>
              When it expires, every read that arrives before someone refills the key misses too, and each one runs the same 50 ms query. The database
              drowns in identical work and latency spikes. This is a <strong>cache stampede</strong>, also called a <strong>thundering herd</strong>.
            </p>
            <p>
              Here it’s over a dozen queries. A real site doing thousands of reads a second fires thousands at once, and that can take the database down, and
              everything that depends on it.
            </p>
          </>
        ),
        cards: (sim) => (
          <ActionsCard
            kicker="Break it"
            buttons={[{ label: 'Expire product:42 now', icon: 'bolt', run: () => sim.expireNow(HOT), after: <>Count the orange dots piling up at Postgres.</> }]}
          />
        ),
        readout: 'stampede',
        hud: ['p95', 'inflight', 'db'],
        legend: ['hit', 'nil', 'query', 'set'],
        code: [
          {
            title: 'psql',
            lang: 'sql',
            code: `
SELECT count(*), left(query, 40)
FROM pg_stat_activity
WHERE state = 'active'
GROUP BY 2;
!-- 38 | SELECT p.name, p.price, avg(r.stars)…`,
            note: 'During a stampede, the same query shows up dozens of times at once.',
          },
        ],
      },
      {
        id: 'taming-the-herd',
        title: 'Taming the herd',
        reset: true,
        cfg: { coalesce: true },
        body: (
          <>
            <p>
              <strong>Request coalescing</strong> (single flight): the first miss runs the query, and every other read of the same key waits for that one
              result. One query instead of dozens. The waiting reads collect under the app.
            </p>
            <p>
              <strong>Refresh-ahead</strong>: when a hot key is close to expiring, refresh it in the background while still serving the current copy.
              Readers never see a miss.
            </p>
            <p>
              And add <strong>jitter</strong> to your TTLs (60 s ± 10%) so keys cached at the same moment, say right after a deploy, don’t all expire in
              the same second.
            </p>
            <Aside>
              Coalescing inside one process only merges that server’s misses. Across many app servers, take a short lock in Redis first:{' '}
              <code>SET lock:product:42 &lt;token&gt; NX PX 5000</code>. The winner runs the query; the others wait briefly and retry the cache.
            </Aside>
          </>
        ),
        cards: (sim) => (
          <>
            <ToggleCard
              prompt="Stampede protection:"
              initial={1}
              options={[
                { label: 'None', apply: () => sim.setProtection('none'), note: <>Every miss runs its own query.</> },
                { label: 'Coalescing', apply: () => sim.setProtection('coalesce'), note: <>Misses for the same key share one query. Watch the waiting dots.</> },
                {
                  label: 'Refresh-ahead',
                  apply: () => sim.setProtection('refresh'),
                  note: <>The violet refresh renews the key before it expires. It can’t help if the key is deleted or evicted, so pair it with coalescing.</>,
                },
              ]}
            />
            <ActionsCard buttons={[{ label: 'Expire product:42 now', icon: 'bolt', run: () => sim.expireNow(HOT) }]} />
          </>
        ),
        readout: 'stampede',
        hud: ['p95', 'inflight', 'hotq'],
        legend: ['hit', 'nil', 'query', 'set', 'refresh'],
        code: [
          {
            title: 'products.js',
            lang: 'js',
            code: `
const inflight = new Map(); // key -> Promise

async function getProduct(id) {
  const key = \`product:\${id}\`;
  const cached = await redis.get(key);
  if (cached) return JSON.parse(cached);
!  if (!inflight.has(key)) {
!    const p = loadAndCache(id)
!      .finally(() => inflight.delete(key));
!    inflight.set(key, p);
!  }
!  return inflight.get(key); // one shared query
}

// jitter: a TTL between 54 and 66 seconds
const ttl = 54 + Math.floor(Math.random() * 13);`,
          },
        ],
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'layers',
    title: 'Caches everywhere',
    steps: [
      {
        id: 'caches-all-the-way-down',
        title: 'Caches all the way down',
        reset: true,
        cfg: { view: 'layers', rps: 0 },
        body: (
          <>
            <p>
              Redis is one layer of many. A request passes several caches on its way to the data, and the first one that has it answers, saving every trip
              below it:
            </p>
            <p>
              the <Term k="band:0">browser cache</Term> (governed by <code>Cache-Control</code> headers), a <Term k="band:1">CDN</Term> edge near the user,
              the app’s own <Term k="band:2">in-process memory</Term>, a shared cache like <Term k="band:3">Redis or Memcached</Term>, and the
              database’s <Term k="band:4">buffer pool</Term>, which keeps hot pages in RAM so queries skip the disk.
            </p>
            <p>
              The closer to the user, the faster the hit, and the harder it is to invalidate. You can delete a Redis key in a millisecond, but you can’t
              reach into a million browsers.
            </p>
          </>
        ),
        legend: ['req', 'resp'],
        code: [
          {
            title: 'HTTP response',
            lang: 'http',
            code: `
HTTP/1.1 200 OK
Content-Type: application/json
!Cache-Control: public, max-age=60
ETag: "p42-v7"`,
            note: 'public: CDNs may keep a copy too. max-age=60: fresh for 60 seconds. ETag: afterwards the browser can revalidate cheaply and get a 304 Not Modified. Add stale-while-revalidate=30 to serve the old copy 30 s longer while refetching in the background.',
          },
        ],
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'recap',
    title: 'Recap & playground',
    cfg: { keys: 16 },
    steps: [
      {
        id: 'cheat-sheet',
        title: 'Cheat sheet',
        reset: true,
        cfg: {
          slots: 8,
          order: 'policy',
          ttl: 15,
          jitter: 0.1,
          showTtl: true,
          coalesce: true,
          rps: 3,
          admin: true,
          writeEvery: 4,
          writeMode: 'around',
          prewarm: WARM8,
        },
        body: (
          <p>
            Everything together: LRU sized for the working set, TTLs with jitter, delete-on-write while Dave edits prices, and coalescing to protect
            Postgres. Notice how little of the traffic ever reaches the database.
          </p>
        ),
        extra: <CheatSheet />,
        hud: ['hit', 'p95', 'db'],
        legend: ['write', 'hit', 'nil', 'query', 'set'],
      },
      {
        id: 'playground',
        title: 'Playground',
        reset: true,
        cfg: { keys: PLAYGROUND_KEYS, slots: 6, ttl: 10, showTtl: true, rps: 3, prewarm: WARM6, order: 'policy' },
        body: (
          <p>
            Everything you’ve learned, in one sandbox. Change the traffic, the cache size, the TTL and the eviction policy. Turn on price changes to see
            what staleness costs, and expire the hot key to set off a stampede. The config at the bottom follows your settings.
          </p>
        ),
        cards: (sim, { cfg }) => <Playground sim={sim} initial={cfg} />,
        hud: ['hit', 'p95', 'db', 'stale'],
        legend: ['write', 'hit', 'nil', 'query', 'set', 'stale'],
      },
    ],
  },
];
