import { Aside } from '@/components/lesson/Prose';
import { Term } from '@/components/lesson/Term';
import type { LegendItem } from '@/components/stage/chrome';
import { SIG } from '@/lib/sim/colors';
import type { Chapter } from './types';

export const META = { slug: 'consistent-hashing', code: 'SD-04', track: 'System design', title: 'Consistent Hashing' };

const FIVE = ['a', 'b', 'c', 'd', 'e'];

const LG: Record<string, LegendItem> = {
  req: { label: 'request', color: SIG.req },
  hit: { label: 'hit / response', color: SIG.res },
  db: { label: 'miss → database', color: SIG.heavy },
  key: { label: 'key', color: '#6F7D97', shape: 'small' },
  token: { label: 'server position', color: SIG.text, shape: 'ring' },
  owner: { label: 'key → owner', color: SIG.line, shape: 'line' },
  moved: { label: 'moved key', color: SIG.warn },
  walk: { label: 'clockwise walk', color: SIG.warn, shape: 'line' },
  lookup: { label: 'lookup', color: SIG.req },
  down: { label: 'crashed', color: SIG.err },
  write: { label: 'write', color: SIG.req },
  ack: { label: 'ack', color: SIG.res },
};

export const CHAPTERS: Chapter[] = [
  /* ================================================================ */
  {
    id: 'mod-n',
    title: 'The mod N trap',
    cfg: { view: 'buckets', servers: ['a', 'b', 'c', 'd'], keys: 20, rps: 2.2 },
    steps: [
      {
        id: 'spread-keys-with-mod-n',
        title: 'Spread keys with hash mod N',
        body: (
          <>
            <p>
              Your app caches user profiles in memory so it doesn&apos;t hit the <Term k="db">database</Term> on every page view. One cache server
              isn&apos;t enough, so you run four, <Term k="srv:a">cache-a</Term> to <Term k="srv:d">cache-d</Term>. Each key must live on exactly one of
              them, and every <Term k="app">app server</Term> has to agree on which.
            </p>
            <p>
              The classic rule: hash the key to a big number, divide by the number of servers N, and use the <strong>remainder</strong> as an index.{' '}
              <code>hash(&quot;user:alice&quot;)</code> is 1,500,882,790, and 1,500,882,790 mod 4 = 2, so Alice lives on <code>servers[2]</code>,{' '}
              <Term k="srv:c">cache-c</Term>.
            </p>
            <p>
              One line of code, an even spread, no lookup table. The cache is warm, so every request comes back as a green <strong>hit</strong>, straight
              from memory.
            </p>
          </>
        ),
        hud: ['hit', 'db'],
        side: ['modn'],
        strip: 'modn',
        legend: [LG.req, LG.hit],
        callouts: [{ target: 'wide:srv:a', text: <>servers[0]: every key with <b>hash mod 4 = 0</b></>, dir: 'up' }],
        code: {
          title: 'cache.js',
          lang: 'js',
          code: `
const servers = ['cache-a', 'cache-b', 'cache-c', 'cache-d'];

function serverFor(key) {
!  return servers[murmur3(key) % servers.length];
}

serverFor('user:alice');  // 1500882790 % 4 = 2 → 'cache-c'`,
        },
      },
      {
        id: 'add-a-server',
        title: 'Add one more server',
        body: (
          <>
            <p>
              Business is good and memory is filling up, so you add a fifth server, <Term k="srv:e">cache-e</Term>. The formula becomes{' '}
              <code>hash mod 5</code>.
            </p>
            <p>
              The cached data doesn&apos;t move by itself: every profile stays exactly where it is. What changes is where the app <em>looks</em> for each
              key.
            </p>
            <p>
              So before the animation continues: of the 20 cached keys, how many will the app now look for on a <strong>different</strong> server?
            </p>
          </>
        ),
        predict: { kind: 'modn', needed: 1, prompt: 'How many of the 20 cached keys will map to a different server?' },
        hud: ['hit', 'db', 'servers'],
        side: ['modn', 'bmoves'],
        strip: 'bmoves',
        legend: [LG.req, LG.hit, LG.db],
      },
      {
        id: 'cache-wipeout',
        title: 'The cache wipeout',
        script: [{ at: 2.4, run: (s) => s.bucketsAdd() }],
        body: (
          <>
            <p>
              Watch the resize happen. Alice&apos;s profile still sits in <Term k="srv:c">cache-c</Term>, but <code>hash mod 5</code> now sends every
              request for it to <Term k="srv:a">cache-a</Term>, which has never seen it. <strong>Miss.</strong> The request falls through to the{' '}
              <Term k="db">database</Term>, and the orphaned copy in cache-c just wastes memory (the struck-out keys).
            </p>
            <p>
              That happens to 4 keys in 5 at once. The hit rate collapses and the database, sized for a trickle of misses, suddenly takes most of the
              reads. In effect you <strong>wiped most of your cache</strong>, and adding capacity is what did it.
            </p>
            <p>
              Scale makes it worse: going from N to N+1 servers remaps about <strong>N/(N+1)</strong> of all keys. That&apos;s 91% at 10 servers and
              99% at 100. For a database that stores the data itself, every remapped key is data to copy across the network.
            </p>
          </>
        ),
        actions: {
          buttons: [
            {
              label: 'Add a server',
              icon: 'plus',
              run: (s) => s.bucketsAdd(),
              after: <>Another reshuffle. Most keys map somewhere new again, and the misses start over.</>,
            },
            {
              label: 'Remove a server',
              icon: 'minus',
              run: (s) => s.bucketsRemove(),
              after: <>Removing is just as bad: most keys move, not only the ones that lived on the removed server.</>,
            },
          ],
        },
        hud: ['hit', 'db', 'servers'],
        side: ['modn', 'bmoves'],
        strip: 'bmoves',
        legend: [LG.req, LG.hit, LG.db],
        code: {
          title: 'count-moves.js',
          lang: 'js',
          code: `
let moved = 0;
for (let i = 0; i < 100_000; i++) {
  const h = murmur3(\`key:\${i}\`);
!  if (h % 4 !== h % 5) moved++;   // index changes: 4 → 5 servers
}
moved;  // 80180: 80.2% of all keys`,
        },
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'ring',
    title: 'The hash ring',
    cfg: { view: 'ring', servers: ['a', 'b', 'c', 'd'], keys: 20 },
    steps: [
      {
        id: 'bend-the-line',
        title: 'Bend the line into a ring',
        cfg: { view: 'line', arcs: false, lines: false },
        body: (
          <>
            <p>
              The fix, published by Karger and colleagues at MIT in 1997, starts by <strong>not</strong> dividing by N at all. Hash the key once and
              treat the result as a <strong>position</strong>.
            </p>
            <p>
              A 32-bit hash is a number from 0 to 4,294,967,295. Put those values on a line: <Term k="key:alice">user:alice</Term> lands 34.9% of the way
              along, <Term k="key:dave">user:dave</Term> at 83.3%.
            </p>
            <p>
              Now bend the line until its two ends meet, so that after 4,294,967,295 comes 0 again. That circle is the <strong>hash ring</strong>. A
              key&apos;s position depends only on the key, so it never changes, however many servers you run.
            </p>
            <Aside>Real systems often use bigger rings. Cassandra&apos;s tokens are 64-bit, from −2⁶³ to 2⁶³−1. The picture is the same.</Aside>
          </>
        ),
        side: ['hashes'],
        strip: 'hashes',
        legend: [LG.key],
      },
      {
        id: 'servers-take-a-seat',
        title: 'Servers take a seat',
        cfg: { intro: true },
        script: [
          { at: 0.8, run: (s) => s.introJoin('a') },
          { at: 1.9, run: (s) => s.introJoin('b') },
          { at: 3.0, run: (s) => s.introJoin('c') },
          { at: 4.1, run: (s) => s.introJoin('d') },
        ],
        body: (
          <>
            <p>
              Servers go on the same ring. Hash each server&apos;s address, like <code>10.0.1.227:11211</code> for <Term k="srv:a">cache-a</Term>, and
              the server takes a seat at that position.
            </p>
            <p>
              The rule: a key belongs to the <strong>first server clockwise</strong> from it. So every server owns the <Term k="arc:b">arc</Term> behind
              it, back to the previous server, and its share of the ring is its share of the keys. The colors show who owns what, and each key&apos;s thin
              line points at its owner.
            </p>
            <p>Nobody stores a key-to-server table. Anyone with the server list can rebuild this exact ring and find any key on their own.</p>
          </>
        ),
        side: ['shares'],
        strip: 'shares',
        legend: [LG.key, LG.token, LG.owner],
        callouts: [{ target: 'wide:arc:b', text: <>cache-b owns <b>this whole arc</b></>, dir: 'left' }],
        code: {
          title: 'seats.js',
          lang: 'js',
          code: `
// A server's seat is just the hash of its address
!murmur3('10.0.1.227:11211');  // 356,005,006   → cache-a
!murmur3('10.0.1.91:11211');   // 2,269,559,466 → cache-b
!murmur3('10.0.1.176:11211');  // 2,973,913,008 → cache-c
!murmur3('10.0.1.224:11211');  // 3,824,260,019 → cache-d`,
        },
      },
      {
        id: 'walk-clockwise',
        title: 'Walk clockwise to the owner',
        body: (
          <>
            <p>
              <strong>Your turn.</strong> New keys will drop onto the ring. From the key, walk <strong>clockwise</strong> until you reach a server. That
              server owns it. Click it.
            </p>
            <p>
              Two traps. The nearest server isn&apos;t always the owner, because the walk never goes backwards. And a key past the last server keeps
              going, through 0, to the first one.
            </p>
            <p>
              In code the ring is just a <strong>sorted array</strong> of server positions. Finding the owner is a binary search for the first position
              at or after the key&apos;s hash, wrapping to the start if you fall off the end. The readout shows exactly that.
            </p>
          </>
        ),
        predict: { kind: 'owner', needed: 3, prompt: 'Which server owns the new key?' },
        side: ['lookup', 'shares'],
        strip: 'lookup',
        legend: [LG.key, LG.walk],
        code: {
          title: 'ring.js',
          lang: 'js',
          code: `
// The ring: every server's position, sorted
const ring = servers
  .map((s) => ({ pos: murmur3(s.addr), server: s }))
  .sort((a, b) => a.pos - b.pos);

function serverFor(key) {
  const h = murmur3(key);
  let lo = 0, hi = ring.length;
!  while (lo < hi) {                        // first pos >= h
!    const mid = (lo + hi) >> 1;
!    if (ring[mid].pos < h) lo = mid + 1; else hi = mid;
!  }
!  return ring[lo % ring.length].server;    // off the end? wrap to 0
}`,
        },
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'churn',
    title: 'Servers come and go',
    cfg: { view: 'ring', servers: ['a', 'b', 'c', 'd'], keys: 26 },
    steps: [
      {
        id: 'a-server-joins',
        title: 'A server joins',
        body: (
          <>
            <p>
              Time to repeat chapter 1&apos;s experiment on the ring. A new server, <Term k="srv:e">cache-e</Term>, hashes its address and takes a seat
              (the dashed marker).
            </p>
            <p>
              Which keys should move to it? Only those whose clockwise walk now reaches cache-e first: the keys between the previous server and
              cache-e. <strong>Predict which server hands them over.</strong>
            </p>
            <p>
              The readout counts the moved keys next to what <code>hash mod N</code> would move for the same change, on this ring and on 100,000 keys.
            </p>
          </>
        ),
        predict: { kind: 'join', needed: 2, prompt: 'Which server gives up keys to the newcomer?' },
        side: ['moves', 'shares'],
        strip: 'moves',
        legend: [LG.key, LG.token, LG.moved],
        code: {
          title: 'ring.js',
          lang: 'js',
          code: `
// A join is one sorted insert. Nothing else changes.
!ring.push({ pos: murmur3('10.0.1.68:11211'), server: cacheE });
ring.sort((a, b) => a.pos - b.pos);
// Keys between cache-e's predecessor and cache-e
// now reach cache-e first. Every other key stays put.`,
        },
      },
      {
        id: 'a-server-leaves',
        title: 'A server leaves',
        cfg: { servers: FIVE, click: 'remove' },
        hint: 'Click a server to remove it',
        body: (
          <>
            <p>
              Servers also leave: a crash, a scale-down, a reclaimed spot instance. When one disappears from the ring, its keys simply continue
              clockwise to the <strong>next server</strong>. Every other key stays where it is.
            </p>
            <p>
              <strong>Your turn:</strong> click a server on the ring to remove it, then click its ghost to bring it back. Compare the counts each time.
            </p>
            <p>
              Adding or removing one of N servers moves only about <strong>1/N</strong> of the keys. That&apos;s the least any scheme can do: a newcomer
              has to get its share from somewhere, and a departed server&apos;s keys have to go somewhere.
            </p>
          </>
        ),
        side: ['moves', 'shares'],
        strip: 'moves',
        legend: [LG.key, LG.token, LG.moved],
        code: {
          title: 'nginx.conf',
          lang: 'nginx',
          code: `
upstream memcached_pool {
!    hash $uri consistent;     # ketama ring, not hash mod N
    server 10.0.1.227:11211;
    server 10.0.1.91:11211;
    server 10.0.1.176:11211;
    server 10.0.1.224:11211;
    server 10.0.1.68:11211;
}

location /profile/ {
    set $memcached_key $uri;
    memcached_pass memcached_pool;
}`,
          note: 'Without "consistent", NGINX hashes mod N and a server change remaps nearly every URI.',
        },
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'vnodes',
    title: 'Virtual nodes',
    cfg: { view: 'ring', servers: ['a', 'b', 'c', 'd'], keys: 26 },
    steps: [
      {
        id: 'unlucky-arcs',
        title: 'Unlucky arcs',
        body: (
          <>
            <p>
              Look at the arcs again. With one seat per server their sizes are pure luck: <Term k="srv:b">cache-b</Term> owns 45% of the ring and{' '}
              <Term k="srv:c">cache-c</Term> just 16%. cache-b stores almost three times as many keys and serves almost three times the traffic.
            </p>
            <p>
              Failures make it worse, because a dead server&apos;s whole arc lands on <strong>one</strong> neighbor. Take cache-b offline and watch
              cache-c.
            </p>
            <Aside>
              More servers don&apos;t fix the luck. With N servers at random positions, the biggest arc is typically about (ln N + 0.6) times the fair
              share: roughly 5× with 100 servers.
            </Aside>
          </>
        ),
        actions: {
          buttons: [
            {
              label: 'Take cache-b offline',
              icon: 'power',
              run: (s) => s.leave('b'),
              after: (
                <>
                  cache-c inherits <strong>all</strong> of cache-b&apos;s keys. Its share jumps from 16% to 61%, nearly four times its old load. One
                  failure can overload the neighbor, and then the next.
                </>
              ),
            },
            { label: 'Bring it back', icon: 'replay', run: (s) => s.join('b') },
          ],
        },
        hud: ['busiest'],
        side: ['shares', 'moves'],
        strip: 'shares',
        legend: [LG.key, LG.token, LG.moved],
        callouts: [{ target: 'wide:arc:b', text: <>one lucky seat: <b>45% of all keys</b></>, dir: 'left' }],
      },
      {
        id: 'virtual-nodes',
        title: 'Many seats per server',
        tokens: true,
        body: (
          <>
            <p>
              The fix: give every server <strong>many</strong> seats. Hash <code>10.0.1.227:11211#1</code>, <code>…#2</code>, <code>…#3</code> and so
              on, and seat cache-a at every result. Each seat is a <strong>virtual node</strong>, also called a <strong>token</strong>.
            </p>
            <p>
              Each server now owns lots of small arcs scattered around the ring instead of one big one, and the luck averages out.{' '}
              <strong>Drag the slider</strong> and watch the busiest server approach its fair 25%.
            </p>
            <Aside>
              It&apos;s still randomness, just averaged: the spread shrinks roughly like 1/√tokens, so 128 tokens can land a hair worse than 64.
              That&apos;s why Cassandra has a token allocator (added in 3.0, the default setup since 4.0) that places tokens deliberately.
            </Aside>
          </>
        ),
        hud: ['tokens', 'busiest'],
        side: ['shares'],
        strip: 'shares',
        legend: [LG.key, LG.token],
        code: {
          title: 'ring.js',
          lang: 'js',
          code: `
const TOKENS = 128;
for (const s of servers) {
  ring.push({ pos: murmur3(s.addr), server: s });
!  for (let i = 1; i < TOKENS; i++) {          // TOKENS - 1 more seats
!    ring.push({ pos: murmur3(\`\${s.addr}#\${i}\`), server: s });
!  }
}
ring.sort((a, b) => a.pos - b.pos);  // lookups don't change at all`,
        },
      },
      {
        id: 'failure-spreads-out',
        title: 'A failure, shared by everyone',
        cfg: { tokens: 64 },
        body: (
          <>
            <p>
              Virtual nodes fix the failure problem too. <Term k="srv:b">cache-b</Term>&apos;s 64 tokens are scattered all over the ring, and the next
              token clockwise from each one belongs to a random other server.
            </p>
            <p>
              So when cache-b goes, its keys don&apos;t pile onto one neighbor. They spread across <strong>all</strong> the survivors. Take it offline
              and read where its keys went.
            </p>
            <p>It works in reverse too: a new server takes a little from everyone, so no single neighbor has to stream it all of its data.</p>
          </>
        ),
        actions: {
          buttons: [
            {
              label: 'Take cache-b offline',
              icon: 'power',
              run: (s) => s.leave('b'),
              after: (
                <>
                  cache-b&apos;s keys scattered across a, c and d instead of landing on one neighbor, so nobody gets swamped. The readout shows the
                  split, measured on 100,000 keys.
                </>
              ),
            },
            { label: 'Bring it back', icon: 'replay', run: (s) => s.join('b') },
          ],
        },
        hud: ['busiest'],
        side: ['moves', 'shares'],
        strip: 'moves',
        legend: [LG.key, LG.token, LG.moved],
      },
      {
        id: 'bigger-servers',
        title: 'Bigger servers, more tokens',
        cfg: { tokens: 64 },
        body: (
          <>
            <p>
              Tokens also handle mismatched hardware. If <Term k="srv:d">cache-d</Term> has twice the memory of the others, give it twice the tokens and
              it owns about twice the keys.
            </p>
            <p>
              That&apos;s how real systems weight servers. ketama, the classic memcached client algorithm, scales each server&apos;s points by its
              memory, and Cassandra lets you set <code>num_tokens</code> per node.
            </p>
          </>
        ),
        toggle: {
          prompt: 'How many tokens does cache-d get?',
          initial: 0,
          options: [
            { label: '64, like the rest', apply: (s) => s.setWeight('d', 1), note: <>Four equal servers, about 25% each.</> },
            { label: '128 (×2)', apply: (s) => s.setWeight('d', 2), note: <>cache-d now owns about 39%. Its fair share is 2 of 5 parts: 40%.</> },
            { label: '256 (×4)', apply: (s) => s.setWeight('d', 4), note: <>About 57%, right at its fair 4 of 7 parts.</> },
          ],
        },
        side: ['shares'],
        strip: 'shares',
        legend: [LG.key, LG.token],
        code: {
          title: 'cassandra.yaml',
          lang: 'conf',
          code: `
# on the three regular nodes
num_tokens: 16

# on the node with twice the disk and memory
!num_tokens: 32`,
          note: 'num_tokens is read when a node first joins the ring; changing it later means rebuilding that node.',
        },
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'replication',
    title: 'Replication on the ring',
    cfg: { view: 'ring', servers: FIVE, tokens: 3, keys: 26, selectKeys: true, replicas: 3 },
    steps: [
      {
        id: 'preference-list',
        title: 'Keep copies on the next servers',
        cfg: { autoSelect: true },
        body: (
          <>
            <p>
              A cache can shrug off a lost server, because the data is still in the database. A database can&apos;t. So data stores keep{' '}
              <strong>R copies</strong> of every key, usually three, and the ring decides where.
            </p>
            <p>
              Walk clockwise from the key as usual. The first server you reach is the key&apos;s home, the <strong>coordinator</strong>. Keep walking:
              the next R−1 <em>different</em> servers hold the copies. Amazon&apos;s Dynamo paper calls this list the key&apos;s{' '}
              <strong>preference list</strong>.
            </p>
            <p>
              &ldquo;Different&rdquo; matters with virtual nodes. When the walk reaches another token of a server that already has a copy, it{' '}
              <strong>skips</strong> it, so no machine holds two. <strong>Click any key</strong> to walk its list, and change R.
            </p>
          </>
        ),
        toggle: {
          prompt: 'Copies per key:',
          initial: 2,
          options: [
            { label: 'R = 1', apply: (s) => s.setReplicas(1) },
            { label: 'R = 2', apply: (s) => s.setReplicas(2) },
            { label: 'R = 3', apply: (s) => s.setReplicas(3) },
          ],
        },
        side: ['pref', 'shares'],
        strip: 'pref',
        legend: [LG.key, LG.token, LG.walk],
        code: {
          title: 'schema.cql',
          lang: 'sql',
          code: `
CREATE KEYSPACE shop
!  WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 3};
-- SimpleStrategy: the next 3 distinct nodes clockwise on the ring`,
        },
      },
      {
        id: 'survive-failures',
        title: 'Crash servers, keep the data',
        cfg: { click: 'fail', autoSelect: true },
        hint: 'Click a server to crash it',
        body: (
          <>
            <p>
              <strong>Your turn to break things.</strong> Click servers to crash them, and click again to repair them. A crashed server keeps its seats
              on the ring; it just stops answering.
            </p>
            <p>
              Each key&apos;s line jumps to the next live server on its preference list, so reads keep working. A key is only in trouble when{' '}
              <strong>every</strong> server on its list is down. Watch the <em>no live copy</em> counter, then try R = 1.
            </p>
            <Aside>
              Dynamo goes further with <strong>hinted handoff</strong>: while a replica is down, its writes go to the next healthy server on the ring,
              which hands them back once the replica recovers.
            </Aside>
          </>
        ),
        toggle: {
          prompt: 'Copies per key:',
          initial: 2,
          options: [
            { label: 'R = 1', apply: (s) => s.setReplicas(1) },
            { label: 'R = 2', apply: (s) => s.setReplicas(2) },
            { label: 'R = 3', apply: (s) => s.setReplicas(3) },
          ],
        },
        quiz: {
          question: 'With R = 3 on this ring, what is the fewest crashes that can leave some key with no live copy?',
          options: [
            { text: 'One', why: 'One crash still leaves every key with two live copies.' },
            { text: 'Two', why: 'Every key has three different servers on its list, so two crashes always leave at least one.' },
            {
              text: 'Three',
              correct: true,
              why: 'Crash all three servers on one key’s preference list. With virtual nodes, many different trios will do it.',
            },
            { text: 'It can’t happen', why: 'It can: R copies protect you from R−1 failures, not from R.' },
          ],
        },
        hud: ['down', 'lost'],
        side: ['pref', 'moves'],
        strip: 'pref',
        legend: [LG.key, LG.down, LG.walk],
        code: {
          title: 'cqlsh',
          lang: 'sql',
          code: `
-- how many of the 3 copies must answer a read
!CONSISTENCY ONE;      -- any live copy: what the stage shows
CONSISTENCY QUORUM;   -- 2 of 3: survives one crash, not two
SELECT * FROM shop.users WHERE id = 'alice';`,
          note: 'Replication decides where the copies live. The consistency level decides how many must respond.',
        },
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'real-world',
    title: 'In the real world',
    cfg: { view: 'ring', keys: 26 },
    steps: [
      {
        id: 'dynamo-and-cassandra',
        title: 'Dynamo and Cassandra',
        cfg: { servers: ['a', 'b', 'c', 'd', 'e', 'f'], tokens: 16, replicas: 3, client: 'driver', writes: true },
        body: (
          <>
            <p>
              This is how Amazon&apos;s <strong>Dynamo</strong> (2007) and <strong>Apache Cassandra</strong> work. The <Term k="center">client</Term>{' '}
              hashes the key, finds its preference list, and sends the write to a replica. That node acts as <strong>coordinator</strong> and forwards
              the write to the other copies.
            </p>
            <p>
              The coordinator doesn&apos;t wait for everyone. With three copies it answers once a <strong>quorum</strong> of two has stored the write, so
              one slow or dead replica can&apos;t stall it.
            </p>
            <p>
              Cassandra hashes keys with Murmur3 onto a 64-bit ring and, since version 4.0, gives each node 16 tokens placed by an allocator rather than
              pure chance. DynamoDB, the managed service, still hashes every partition key, but tracks its partitions with a central metadata service
              instead of a gossiped ring.
            </p>
          </>
        ),
        side: ['write', 'shares'],
        strip: 'write',
        legend: [LG.write, LG.ack, LG.token],
        code: {
          title: 'cassandra.yaml',
          lang: 'conf',
          code: `
!num_tokens: 16
!allocate_tokens_for_local_replication_factor: 3
partitioner: org.apache.cassandra.dht.Murmur3Partitioner`,
          note: 'The replication factor itself is set per keyspace, as in the previous chapter.',
        },
      },
      {
        id: 'memcached-ketama',
        title: 'Memcached: the client holds the ring',
        cfg: { servers: ['a', 'b', 'c', 'd'], tokens: 160, weights: { d: 2 }, client: 'app', rps: 1.5 },
        body: (
          <>
            <p>
              Memcached servers never talk to each other. The ring lives in the <Term k="center">client library</Term> inside every app server.{' '}
              <strong>ketama</strong>, used by libmemcached, spymemcached and twemproxy, gives each server 160 points on the ring, more for servers with
              more memory (here <Term k="srv:d">cache-d</Term> has double), and finds keys with a binary search.
            </p>
            <p>
              That puts the burden on you: every client must build the <strong>same</strong> ring, with the same server list, hash function and point
              scheme. An app server with a stale list will look for keys in the wrong place. Proxies such as twemproxy and mcrouter keep that routing in
              one place.
            </p>
          </>
        ),
        hud: ['points'],
        side: ['shares'],
        strip: 'shares',
        legend: [LG.lookup, LG.token],
        code: {
          title: 'nutcracker.yml',
          lang: 'conf',
          code: `
cache:
  listen: 127.0.0.1:22121
  hash: fnv1a_64
!  distribution: ketama
  servers:
   - 10.0.1.227:11211:1
   - 10.0.1.91:11211:1
   - 10.0.1.176:11211:1
!   - 10.0.1.224:11211:2     # weight 2: twice the points`,
        },
      },
      {
        id: 'other-schemes',
        title: 'Rendezvous, jump and Maglev',
        cfg: { view: 'hrw', servers: FIVE },
        body: (
          <>
            <p>
              The ring isn&apos;t the only way. <strong>Rendezvous hashing</strong> (highest random weight) scores every server with{' '}
              <code>hash(key, server)</code> and picks the highest. Remove the winner and only its keys move, each to its runner-up. It costs a loop over
              every server per lookup, which is fine for dozens. Apache Ignite and pymemcache use it.
            </p>
            <p>
              <strong>Jump consistent hash</strong> (Google, 2014) needs no memory and splits keys almost perfectly evenly, but servers must be numbered
              0 to N−1 and you can only add or remove at the end. Great for numbered shards, not for machines that die at random.
            </p>
            <p>
              <strong>Maglev</strong> hashing, from Google&apos;s software load balancer, fills a lookup table of 65,537 slots, each backend claiming
              slots in its own preferred order. A lookup is one array read and load is nearly even; the price is that a backend change remaps a little
              more than the minimum. Envoy offers both ring hash and Maglev.
            </p>
          </>
        ),
        actions: {
          buttons: [
            { label: 'Next key', icon: 'arrowRight', run: (s) => s.hrwNext() },
            {
              label: 'Remove the winner',
              icon: 'power',
              run: (s) => s.hrwRemoveWinner(),
              after: <>Only keys whose top score belonged to the removed server move, and each goes to its runner-up.</>,
            },
            { label: 'Restore all', icon: 'replay', run: (s) => s.hrwRestore() },
          ],
        },
        side: ['hrw'],
        strip: 'hrw',
        code: {
          title: 'rendezvous.js',
          lang: 'js',
          code: `
function serverFor(key, servers) {
  let best = null, bestScore = -1;
  for (const s of servers) {
!    const score = murmur3(\`\${key}|\${s.addr}\`);   // one score per pair
!    if (score > bestScore) { best = s; bestScore = score; }
  }
  return best;
}`,
        },
        code2: {
          title: 'jump_hash.c',
          lang: 'c',
          code: `
int32_t JumpConsistentHash(uint64_t key, int32_t num_buckets) {
  int64_t b = -1, j = 0;
  while (j < num_buckets) {
    b = j;
!    key = key * 2862933555777941757ULL + 1;
!    j = (b + 1) * ((double)(1LL << 31) / (double)((key >> 33) + 1));
  }
  return b;
}`,
          note: 'From Lamping and Veach, “A Fast, Minimal Memory, Consistent Hash Algorithm” (2014).',
        },
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'recap',
    title: 'Recap & playground',
    cfg: { view: 'ring', servers: FIVE, keys: 26 },
    steps: [
      {
        id: 'cheat-sheet',
        title: 'Cheat sheet',
        cfg: { tokens: 32, replicas: 3, client: 'app', rps: 1.2, selectKeys: true, autoSelect: true },
        body: (
          <p>
            Everything in one picture: five servers with 32 tokens each, lookups walking clockwise to their owners, and every few seconds one key&apos;s
            three copies (the numbered badges).
          </p>
        ),
        cheat: true,
        side: ['shares'],
        strip: 'shares',
        legend: [LG.lookup, LG.key, LG.token],
      },
      {
        id: 'playground',
        title: 'Playground',
        cfg: { tokens: 1, replicas: 1, click: 'fail', selectKeys: true },
        body: (
          <p>
            All the knobs in one place. Add and remove servers, change the tokens per server and the copies per key, click servers on the ring to crash
            them, and click a key to see where its copies live. Then try the challenges.
          </p>
        ),
        playground: true,
        hud: ['servers', 'busiest', 'lost'],
        side: ['moves', 'pref'],
        strip: 'moves',
        legend: [LG.key, LG.token, LG.moved, LG.down],
      },
    ],
  },
];
