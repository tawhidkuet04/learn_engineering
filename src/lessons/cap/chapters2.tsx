import { ToggleCard } from '@/components/lesson/cards';
import { Aside } from '@/components/lesson/Prose';
import { Term } from '@/components/lesson/Term';
import { AP, CP, LAST_SEAT, LG } from './common';
import { CheatSheet, Playground, QuorumCard } from './panel';
import { LEVELS } from './Spectrum';
import type { Chapter } from './types';

export const CHAPTERS_2: Chapter[] = [
  /* ================================================================ */
  {
    id: 'models',
    title: 'Shades of consistency',
    steps: [
      {
        id: 'spectrum',
        title: 'Consistency is a dial, not a switch',
        cfg: { view: 'spectrum', level: 0 },
        body: (
          <>
            <p>
              So far &ldquo;consistent&rdquo; meant the strongest kind: <strong>linearizable</strong>, where the system acts like a single copy. Below
              it sit weaker levels, each allowing a few more surprises in exchange for less coordination between replicas.
            </p>
            <p>
              Step down the list. Each level forbids one kind of surprise and allows others. The weaker the level, the less replicas have to wait for
              each other, so the faster they answer and the better they cope with partitions.
            </p>
            <p>
              Most apps don&apos;t need the top of the list. They need one specific promise, like &ldquo;users always see their own changes&rdquo; or
              &ldquo;replies never appear before their posts&rdquo;.
            </p>
            <Aside>
              This ladder is simplified. The real map of consistency models branches: causal consistency already includes read-your-writes, and some
              models can&apos;t be compared at all. Jepsen&apos;s consistency-models page draws the whole family tree.
            </Aside>
          </>
        ),
        panel: (s) => <ToggleCard prompt="Pick a level:" options={LEVELS.map((l, i) => ({ label: l.name, apply: () => s.update({ level: i }) }))} />,
      },
      {
        id: 'causal',
        title: 'When a reply arrives before its post',
        cfg: { view: 'feed', causal: false },
        body: (
          <>
            <p>
              A classic anomaly, on a social feed this time. <Term k="alice">Alice</Term> posts &ldquo;Got seat 14C!&rdquo;. <Term k="bob">Bob</Term>{' '}
              reads it in Frankfurt and replies &ldquo;Congrats!&rdquo;. <Term k="carol">Carol</Term> keeps refreshing her feed in Singapore.
            </p>
            <p>
              The Virginia–Singapore link is congested today, so Alice&apos;s post crawls while Bob&apos;s reply takes the faster route and lands first.
              With <strong>eventual consistency</strong>, Singapore shows whatever it has, and Carol sees a reply to a post that doesn&apos;t exist.
            </p>
            <p>
              Switch to <strong>causal consistency</strong>. Bob&apos;s reply now carries a note: &ldquo;I depend on post A.&rdquo; Singapore holds it back
              until A arrives, then shows both in order.
            </p>
            <Aside>
              Causal consistency never refuses a request: it only delays showing some data. That&apos;s why it can stay available during partitions,
              and research shows little that&apos;s stronger can.
            </Aside>
          </>
        ),
        panel: (s) => (
          <ToggleCard
            prompt="How does Singapore apply what it receives?"
            options={[
              { label: 'Eventual', apply: () => s.update({ causal: false }), note: <>Shows each post the moment it arrives.</> },
              { label: 'Causal', apply: () => s.update({ causal: true }), note: <>Holds a reply until the post it answers is there.</> },
            ]}
          />
        ),
        readout: 'feed',
        hud: ['anomalies'],
        legend: [LG.req, LG.repl, LG.held, LG.err],
        code: {
          title: 'replica.js · causal delivery',
          lang: 'js',
          code: `function receive(post) {
!  if (post.replyTo && !feed.has(post.replyTo)) {
!    held.push(post);          // its cause hasn't arrived yet
    return;
  }
  feed.add(post);
  releaseWaiting(held, feed); // anything whose cause just arrived
}`,
          note: 'Real systems track dependencies with vector clocks or per-session tokens instead of a replyTo field, but the rule is the same.',
        },
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'quorums',
    title: 'Quorums: N, W and R',
    cfg: { view: 'quorum' },
    steps: [
      {
        id: 'write-quorum',
        title: 'A write waits for W acks',
        cfg: { n: 3, w: 2, r: 0 },
        body: (
          <>
            <p>
              Dynamo-style databases let you dial consistency with three numbers. <strong>N</strong> is how many replicas store each item. A write goes
              to all N, and the client is told &ldquo;ok&rdquo; once <strong>W</strong> of them acknowledge.
            </p>
            <p>
              Here N = 3 and W = 2. <Term k="qa">Alice</Term>&apos;s write reaches r1 and r2 quickly. They acknowledge, and she&apos;s done. r3 is slow
              today (far away, or busy), so it gets the write later. For a while, one replica is behind.
            </p>
            <p>
              W trades speed for safety. W = 1 answers fastest, but one failed disk can lose the write. W = N is safest, but as slow as the slowest
              replica, and it fails when any replica is down.
            </p>
          </>
        ),
        callouts: [{ target: 'q3', text: <>slow replica: <b>catches up later</b></>, dir: 'down' }],
        phoneCallouts: [],
        focus: ['qa', 'q1', 'q2', 'q3'],
        readout: 'quorum',
        hud: ['qwrite'],
        legend: [LG.write, LG.ack],
      },
      {
        id: 'read-quorum',
        title: 'A read asks R replicas',
        cfg: { n: 3, w: 2, r: 2 },
        onEnter: (s) => s.quorum.setRounds([
          { w: 2, r: 2 },
          { w: 1, r: 1 },
        ]),
        predict: { needed: 2, prompt: 'Will Bob’s read include Alice’s latest write?' },
        body: (
          <>
            <p>
              A read asks <strong>R</strong> replicas and keeps the answer with the highest version. <Term k="qb">Bob</Term> reads from the replicas
              nearest to him.
            </p>
            <p>
              Does his read include at least one replica that got Alice&apos;s write? If the write reached W replicas and the read asks R, the two groups{' '}
              <em>must</em> share one whenever <strong>R + W &gt; N</strong>. There simply aren&apos;t enough replicas for them to miss each other.
            </p>
            <p>
              We show the worst case: the replicas that haven&apos;t acknowledged yet are the ones Bob asks. <strong>Predict each read</strong>. The
              settings change between rounds.
            </p>
            <Aside>
              Real systems also repair: when a read finds an old version on one replica, it writes the newest one back (&ldquo;read repair&rdquo;), and
              background jobs compare replicas to fix the rest.
            </Aside>
          </>
        ),
        readout: 'quorum',
        hud: ['qstale'],
        legend: [LG.write, LG.ack, LG.read, LG.stale],
      },
      {
        id: 'tune-quorum',
        title: 'Tune N, W and R',
        cfg: { n: 3, w: 1, r: 1 },
        body: (
          <>
            <p>
              Your turn. W = 1 and R = 1 is the fastest setting, and Bob keeps reading stale data. Raise either one until the verdict flips.
            </p>
            <p>
              Common choices: <strong>N = 3, W = 2, R = 2</strong>, majority quorums and the usual default; <strong>W = N, R = 1</strong> when reads
              must be fast and writes are rare; <strong>W = 1, R = N</strong> for the opposite. Every extra ack costs latency and lowers how many
              replicas can be down before requests fail.
            </p>
            <Aside>
              R + W &gt; N makes the sets overlap, but on its own it isn&apos;t full linearizability: concurrent writes, and writes that failed on some
              replicas but landed on others, can still surprise you. Systems layer read repair and conflict handling on top.
            </Aside>
          </>
        ),
        panel: (s) => <QuorumCard sim={s} initial={{ n: 3, w: 1, r: 1 }} />,
        readout: 'quorum',
        hud: ['qwrite', 'qread', 'qstale'],
        legend: [LG.write, LG.ack, LG.read, LG.stale],
        code: {
          title: 'cqlsh · replication factor 3',
          lang: 'sql',
          code: `!cqlsh> CONSISTENCY QUORUM;   -- 2 of 3, for reads and writes
Consistency level set to QUORUM.
cqlsh> UPDATE flights SET seats_left = 2 WHERE id = 'UA88';
cqlsh> SELECT seats_left FROM flights WHERE id = 'UA88';`,
          note: 'QUORUM on both sides gives R + W = 4 > 3. Across data centers, LOCAL_QUORUM counts only replicas in your own region: consistent there, and no ocean crossing per request.',
        },
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'conflicts',
    title: 'After the partition heals',
    cfg: { view: 'world', ...AP, ...LAST_SEAT, cut: true },
    steps: [
      {
        id: 'two-truths',
        title: 'The heal reveals two truths',
        cfg: { merge: 'vv' },
        ops: [
          { kind: 'book', c: 'alice', wait: 1 },
          { kind: 'book', c: 'bob', wait: 1.6 },
          { kind: 'heal', wait: 6 },
        ],
        loop: true,
        body: (
          <>
            <p>
              Back to the AP system and the last seat. During the partition, <Term k="alice">Alice</Term> booked it in Virginia and{' '}
              <Term k="bob">Bob</Term> booked it in Frankfurt. Both were told &ldquo;booked&rdquo;.
            </p>
            <p>
              When the network heals, the replicas deliver the updates they held back, and each replica ends up looking at <strong>two different
              versions</strong>, both called v10. Neither is an update of the other: as far as the system can tell, they happened at the same time. These
              are <strong>concurrent writes</strong>, a conflict.
            </p>
            <p>The database has to settle on one answer, or at least know that it has two. The next two steps show the common strategies.</p>
          </>
        ),
        readout: 'conflict',
        hud: ['oversold', 'agree'],
        legend: [LG.req, LG.ok, LG.repl],
        code: {
          title: 'Riak · HTTP API',
          lang: 'http',
          code: `GET /buckets/flights/keys/UA88 HTTP/1.1

!HTTP/1.1 300 Multiple Choices
Content-Type: text/plain

Siblings:
3xFjRkVaDs8ow1Pk4LyASI
4mEsU5dJS3iF0TSiNsFTgu`,
          note: 'A database that keeps both versions hands them to the application as “siblings” and asks it to pick or merge.',
        },
      },
      {
        id: 'last-write-wins',
        title: 'Last write wins, and a booking vanishes',
        cfg: { merge: 'lww', showTs: true },
        predict: { needed: 2, prompt: 'When the replicas meet, whose booking survives?' },
        ops: [
          { kind: 'set', patch: { skew: 0 } },
          { kind: 'book', c: 'alice', wait: 1.2 },
          { kind: 'book', c: 'bob', wait: 1.4 },
          { kind: 'lww', wait: 4.5 },
          { kind: 'set', patch: { skew: 400 } },
          { kind: 'reset', wait: 1.2 },
          { kind: 'book', c: 'alice', wait: 1.2 },
          { kind: 'book', c: 'bob', wait: 1.4 },
          { kind: 'lww', wait: 4.5 },
        ],
        loop: true,
        body: (
          <>
            <p>
              The simplest fix is <strong>last write wins</strong> (LWW). Every write carries a timestamp from the replica that accepted it, and when two
              versions collide, the higher timestamp wins everywhere. Cassandra does this for every column.
            </p>
            <p>
              It always converges, which is why it&apos;s popular. Now look at what it does to our bookings. <strong>Predict who keeps the seat</strong>{' '}
              (the timestamps are on the cards).
            </p>
            <p>
              In round two, Virginia&apos;s clock runs 400 ms fast. Server clocks drift, and NTP keeps them only roughly in sync: usually within a few
              milliseconds, sometimes far worse.
            </p>
            <Aside>
              The losing write isn&apos;t flagged anywhere. The customer got a confirmation; the database quietly dropped it. LWW suits data where losing
              a concurrent update is harmless: caches, &ldquo;last seen&rdquo; times, sensor readings.
            </Aside>
          </>
        ),
        readout: 'lww',
        hud: ['dropped', 'oversold'],
        legend: [LG.req, LG.ok, LG.repl, LG.err],
        code: {
          title: 'cqlsh · the hidden timestamp',
          lang: 'sql',
          code: `cqlsh> SELECT seats_left, WRITETIME(seats_left) FROM flights WHERE id = 'UA88';

 seats_left | writetime(seats_left)
------------+-----------------------
!          0 |      1767261600490000`,
          note: 'Cassandra stores a microsecond timestamp with every value. When two versions meet, the higher one wins, whoever wrote it.',
        },
      },
      {
        id: 'version-vectors',
        title: 'Version vectors: detect, don’t guess',
        cfg: { merge: 'vv' },
        ops: [
          { kind: 'book', c: 'alice', wait: 1.2 },
          { kind: 'book', c: 'bob', wait: 1.6 },
          { kind: 'heal', wait: 6 },
        ],
        loop: true,
        body: (
          <>
            <p>
              A <strong>version vector</strong> keeps one counter per replica, written here as [VA, FRA, SG]: how many writes from each replica this
              version has seen. Before the partition every copy had [3, 3, 3]. Alice&apos;s booking bumped Virginia&apos;s counter, Bob&apos;s bumped
              Frankfurt&apos;s.
            </p>
            <p>
              Compare entry by entry. If one vector is at least as big everywhere, it&apos;s a newer version of the other and simply replaces it. If each
              is bigger somewhere, like [4, 3, 3] and [3, 4, 3], the writes were <strong>concurrent</strong>. The database keeps both as{' '}
              <strong>siblings</strong> and lets the application decide.
            </p>
            <p>
              For the seat, the app now sees the double booking and can fix it: keep Alice, move Bob to the next flight, apologize. For a shopping cart,
              merge the two carts. That&apos;s what Amazon&apos;s Dynamo did.
            </p>
            <Aside>
              <strong>CRDTs</strong> (conflict-free replicated data types) go further: data types with a merge that is always correct, like counters
              that add up every replica&apos;s increments, or sets that union. Like buttons, carts and collaborative editors use them. A seat, sadly,
              can&apos;t be sold twice however you merge.
            </Aside>
          </>
        ),
        panel: (s) => (
          <ToggleCard
            prompt="When two versions meet after the heal:"
            options={[
              { label: 'Version vectors', apply: () => s.update({ merge: 'vv' }), note: <>Concurrent versions are detected and kept side by side.</> },
              { label: 'Last write wins', apply: () => s.update({ merge: 'lww' }), note: <>The higher timestamp wins; the other booking disappears.</> },
            ]}
          />
        ),
        readout: 'vv',
        hud: ['oversold', 'dropped'],
        legend: [LG.req, LG.ok, LG.repl],
        code: {
          title: 'version-vector.js',
          lang: 'js',
          code: `function compare(a, b) {           // e.g. {va: 4, fra: 3, sg: 3}
  let aNewer = false, bNewer = false;
  for (const r of ['va', 'fra', 'sg']) {
    if (a[r] > b[r]) aNewer = true;
    if (b[r] > a[r]) bNewer = true;
  }
!  if (aNewer && bNewer) return 'concurrent'; // keep both
  return aNewer ? 'a' : bNewer ? 'b' : 'equal';
}`,
        },
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'beyond',
    title: 'Beyond CAP',
    cfg: { view: 'world' },
    steps: [
      {
        id: 'pacelc',
        title: 'Even without a partition: latency or consistency',
        cfg: { auto: 'pacelc', seats: 120, ver: 40, wq: 2, rq: 1, readLocal: true, rtt: true },
        body: (
          <>
            <p>
              CAP only talks about partitions, which are rare. What about the rest of the time? Daniel Abadi&apos;s <strong>PACELC</strong> fills the gap:
              if there&apos;s a <strong>P</strong>artition, choose <strong>A</strong> or <strong>C</strong>; <strong>E</strong>lse, choose{' '}
              <strong>L</strong>atency or <strong>C</strong>onsistency.
            </p>
            <p>
              The network is healthy. <Term k="carol">Carol</Term> books from Singapore. Waiting for a majority means waiting for Frankfurt&apos;s ack:
              about 160 ms, on every single write. Answering right away takes a couple of milliseconds, but <Term k="bob">Bob</Term>, reading in
              Frankfurt a moment later, may see the old count.
            </p>
            <p>Switch between the two and watch the write latency and Bob&apos;s reads.</p>
            <Aside>
              In PACELC terms, Cassandra and DynamoDB default to PA/EL: available, and fast. etcd and Spanner are PC/EC: consistent, and they pay for it
              in latency. Many databases let you choose per request, as you saw with consistency levels.
            </Aside>
          </>
        ),
        panel: (s) => (
          <ToggleCard
            prompt="Carol's write returns after:"
            options={[
              { label: 'A majority has it (EC)', apply: () => s.update({ wq: 2 }), note: <>Consistent: Bob reads the new count, but every write pays a round trip.</> },
              { label: 'Singapore has it (EL)', apply: () => s.update({ wq: 1 }), note: <>Fast: about 2 ms, and Bob may read a stale count for a moment.</> },
            ]}
          />
        ),
        readout: 'pacelc',
        hud: ['wlat', 'stale'],
        legend: [LG.req, LG.ok, LG.repl, LG.ack, LG.stale],
        code: {
          title: 'MongoDB · Node.js driver',
          lang: 'js',
          code: `await flights.updateOne(
  { _id: 'UA88' },
  { $inc: { seatsLeft: -1 } },
!  { writeConcern: { w: 'majority' } }, // wait until most members have it
);`,
          note: 'w: 1 returns once the primary has the write; w: "majority" waits for most replica-set members (the default since MongoDB 5.0).',
        },
      },
      {
        id: 'cheat-sheet',
        title: 'Cheat sheet',
        cfg: { ...CP, seats: 3, ver: 7 },
        ops: [
          { kind: 'read', c: 'bob', wait: 0.8 },
          { kind: 'book', c: 'alice', wait: 1 },
          { kind: 'cut', wait: 1.2 },
          { kind: 'read', c: 'alice', wait: 0.8 },
          { kind: 'book', c: 'carol', wait: 0.8 },
          { kind: 'read', c: 'bob', wait: 1 },
          { kind: 'heal', wait: 2.6 },
          { kind: 'read', c: 'alice', wait: 1 },
        ],
        loop: true,
        body: (
          <p>
            One picture to remember: a CP system through a partition. The majority keeps working, the minority refuses, and after the heal Virginia
            catches up. Every other idea in this lesson is a variation on that choice.
          </p>
        ),
        extra: () => <CheatSheet />,
        hud: ['errors', 'stale'],
        legend: [LG.req, LG.ok, LG.check, LG.err],
      },
      {
        id: 'playground',
        title: 'Playground: the last seat',
        cfg: { ...AP, ...LAST_SEAT, merge: 'lww', showTs: true },
        body: (
          <p>
            Everything in one sandbox. Pick CP or AP, cut Virginia off, and book from any continent. Heal the network to see how the replicas
            reconcile. Each challenge below makes you hit one of this lesson&apos;s ideas head-on.
          </p>
        ),
        extra: (s) => <Playground sim={s} />,
        readout: 'decision',
        hud: ['oversold', 'errors', 'dropped'],
        legend: [LG.req, LG.ok, LG.stale, LG.err],
      },
    ],
  },
];
