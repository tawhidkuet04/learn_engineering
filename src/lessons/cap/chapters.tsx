import { ActionsCard, ToggleCard } from '@/components/lesson/cards';
import { Aside } from '@/components/lesson/Prose';
import { Term } from '@/components/lesson/Term';
import { CHAPTERS_2 } from './chapters2';
import { AP, CP, LAST_SEAT, LG } from './common';
import type { Chapter } from './types';

const CHAPTERS_1: Chapter[] = [
  /* ================================================================ */
  {
    id: 'replicas',
    title: 'Copies around the world',
    cfg: { view: 'world', seats: 3, ver: 7 },
    steps: [
      {
        id: 'three-copies',
        title: 'One database, three continents',
        cfg: { rtt: true },
        ops: [
          { kind: 'book', c: 'alice', wait: 2.4 },
          { kind: 'read', c: 'carol', wait: 1.6 },
          { kind: 'book', c: 'bob', wait: 2.4 },
          { kind: 'read', c: 'alice', wait: 1 },
        ],
        loop: true,
        body: (
          <>
            <p>
              An airline sells seats on flight UA88 from three data centers: <Term k="va">Virginia</Term>, <Term k="fra">Frankfurt</Term> and{' '}
              <Term k="sg">Singapore</Term>. Each one keeps a full copy of the database. Each copy is a <strong>replica</strong>.
            </p>
            <p>
              Why three? If a data center loses power, the other two still have every booking. And each customer talks to the replica nearest to them:{' '}
              <Term k="alice">Alice</Term> in the US, <Term k="bob">Bob</Term> in Europe, <Term k="carol">Carol</Term> in Asia. Staying on one continent
              takes a millisecond or two instead of a couple of hundred.
            </p>
            <p>
              Watch Alice book a seat. Virginia updates its copy (<code>seats_left</code> drops and the version goes from v7 to v8), answers her, then
              sends the change to the other two. That&apos;s <strong>replication</strong>.
            </p>
            <Aside>
              The numbers on the links are typical round-trip times between these cloud regions. The animation runs about 10× slower than real life so
              you can follow every message.
            </Aside>
          </>
        ),
        callouts: [{ target: 'sg', text: <>each replica holds <b>a full copy</b></>, dir: 'up' }],
        hud: ['agree'],
        legend: [LG.req, LG.ok, LG.repl],
        code: {
          title: 'cqlsh · keyspace',
          lang: 'sql',
          code: `CREATE KEYSPACE booking WITH replication = {
!  'class': 'NetworkTopologyStrategy',
!  'virginia': 1, 'frankfurt': 1, 'singapore': 1
};`,
          note: 'Cassandra: keep one full copy of every row in each data center. The data-center names come from your cluster’s own configuration.',
        },
      },
      {
        id: 'replication-lag',
        title: 'For a moment, the copies disagree',
        ops: [
          { kind: 'book', c: 'alice', wait: 0.05 },
          { kind: 'read', c: 'carol', wait: 1.6 },
          { kind: 'read', c: 'carol' },
        ],
        body: (
          <>
            <p>
              Replication takes time. A message needs roughly 110 ms to get from Virginia to Singapore, so for a moment the copies{' '}
              <strong>disagree</strong>.
            </p>
            <p>
              Here <Term k="carol">Carol</Term> checks the flight right after Alice&apos;s booking. Her request reaches <Term k="sg">Singapore</Term> before
              the update does, so she gets the old count: a <strong>stale read</strong> (orange). A moment later the update lands and her second read is
              right.
            </p>
            <p>
              This is <strong>asynchronous replication</strong>: answer first, copy later. The replicas are <em>eventually consistent</em>. Stop writing
              and they converge within a fraction of a second.
            </p>
            <Aside>Why not copy first, then answer? Then every booking waits for the slowest ocean crossing. Hold that thought: it returns at the end.</Aside>
          </>
        ),
        panel: (s) => (
          <ActionsCard
            prompt="Race the replication yourself:"
            buttons={[
              {
                label: 'Book in Virginia, read in Singapore',
                icon: 'bolt',
                run: () => s.race(),
                after: (
                  <>
                    Carol&apos;s read beat the update across the Pacific, so Singapore answered from its <strong>old copy</strong>.
                  </>
                ),
              },
              { label: 'Read in Singapore again', icon: 'replay', run: () => s.userRequest('carol', 'read') },
            ]}
          />
        ),
        callouts: [{ target: 'sg', text: <>a read here can <b>beat the update</b></>, dir: 'up' }],
        hud: ['agree', 'stale'],
        legend: [LG.req, LG.ok, LG.repl, LG.stale],
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'partitions',
    title: 'When the network splits',
    cfg: { view: 'world' },
    steps: [
      {
        id: 'partition',
        title: 'The network splits',
        cfg: { seats: 3, ver: 7, heartbeats: true },
        ops: [
          { kind: 'wait', wait: 2.4 },
          { kind: 'cut', wait: 1.8 },
          { kind: 'book', c: 'alice', wait: 2.6 },
          { kind: 'read', c: 'bob' },
        ],
        body: (
          <>
            <p>
              Now the bad day. A ship drags its anchor across an undersea cable, or someone pushes a router config with a typo, and the link between{' '}
              <Term k="va">Virginia</Term> and the other two data centers goes dark. This is a <strong>network partition</strong>.
            </p>
            <p>
              Every server is still running. Their lights stay green and each one still serves the customers near it. They just can&apos;t talk to each
              other. The purple pulses are <strong>heartbeats</strong>, the &ldquo;I&apos;m still here&rdquo; messages replicas trade. The ones that
              cross the cut vanish, and so does Alice&apos;s booking on its way to Europe and Asia.
            </p>
            <p>
              From inside Virginia, silence from Frankfurt looks exactly like Frankfurt crashing. It <em>can&apos;t tell</em> a dead peer from a broken
              link, and it can&apos;t wait forever to find out.
            </p>
            <Aside>
              Partitions aren&apos;t exotic. Cut cables, misconfigured routers or firewalls, overloaded links dropping packets, even a server frozen in a
              long garbage-collection pause: from the outside they all look the same. Messages stop arriving.
            </Aside>
          </>
        ),
        panel: (s) => (
          <ActionsCard
            buttons={[
              { label: 'Cut the network', icon: 'power', run: () => s.cutNetwork() },
              { label: 'Heal it', icon: 'replay', run: () => s.healNetwork() },
            ]}
          />
        ),
        callouts: [{ target: 'cut', text: <>servers up, <b>messages lost</b></>, dir: 'up' }],
        phoneCallouts: [],
        hud: ['agree'],
        legend: [LG.hb, LG.repl, LG.err],
        code: {
          title: 'shell · from Virginia',
          lang: 'shell',
          code: `$ ping -c 3 198.51.100.10        # Frankfurt
PING 198.51.100.10 (198.51.100.10) 56(84) bytes of data.

--- 198.51.100.10 ping statistics ---
!3 packets transmitted, 0 received, 100% packet loss, time 2042ms`,
          note: 'Frankfurt is up and serving Bob. Virginia simply can’t reach it.',
        },
      },
      {
        id: 'the-dilemma',
        title: 'Answer, or refuse?',
        cfg: { ...LAST_SEAT, cut: true },
        ops: [
          { kind: 'book', c: 'bob', wait: 1.8 },
          { kind: 'dilemma', c: 'alice' },
        ],
        body: (
          <>
            <p>
              The partition is still there. On the far side, <Term k="bob">Bob</Term> books the last seat in Frankfurt, and Singapore hears about it.{' '}
              <Term k="va">Virginia</Term> doesn&apos;t: its copy still says 1 seat left.
            </p>
            <p>
              Now <Term k="alice">Alice</Term> asks Virginia how many seats are left. Virginia has exactly two options.
            </p>
            <p>
              <strong>Answer with what it has</strong>: &ldquo;1 seat left&rdquo;. Fast and friendly, but wrong: Bob already has that seat.{' '}
              <strong>Or refuse</strong>: &ldquo;I can&apos;t confirm that right now.&rdquo; Alice gets an error, but never a wrong answer. Waiting longer
              doesn&apos;t help; that&apos;s just refusing slowly.
            </p>
            <p>You decide. Pick one and watch what Alice sees.</p>
          </>
        ),
        panel: (s) => (
          <ActionsCard
            prompt="Virginia can't check with the others. What should it do?"
            buttons={[
              {
                label: 'Answer with what you have',
                icon: 'arrowRight',
                run: () => s.decideDilemma('answer'),
                after: (
                  <>
                    Alice sees <strong>1 seat left</strong>. Fast, friendly, and wrong: Bob already booked it. If she books now, the seat is sold twice.
                  </>
                ),
              },
              {
                label: 'Refuse until you can check',
                icon: 'x',
                run: () => s.decideDilemma('refuse'),
                after: (
                  <>
                    Alice gets an <strong>error</strong> after a timeout. Annoying, but nothing she was told is false.
                  </>
                ),
              },
            ]}
          />
        ),
        readout: 'dilemma',
        legend: [LG.req, LG.stale, LG.check, LG.err],
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'cap',
    title: 'The CAP theorem',
    cfg: { view: 'world', ...LAST_SEAT, cut: true },
    steps: [
      {
        id: 'cap-theorem',
        title: 'CAP: during a partition, pick one',
        ops: [
          { kind: 'book', c: 'bob', as: 'cp', wait: 1.4 },
          { kind: 'read', c: 'alice', as: 'ap', wait: 2 },
          { kind: 'read', c: 'alice', as: 'cp', wait: 2.2 },
        ],
        loop: true,
        body: (
          <>
            <p>
              That choice has a name. Eric Brewer conjectured it in 2000, and Seth Gilbert and Nancy Lynch proved it in 2002: when the network is
              partitioned, a replicated system can&apos;t be both of these at once.
            </p>
            <p>
              <strong>Consistent</strong>: every read sees the latest write, as if there were only one copy. (The precise term is{' '}
              <em>linearizable</em>.) <strong>Available</strong>: every replica that is up answers every request, without errors.
            </p>
            <p>
              <strong>P</strong>, partition tolerance, isn&apos;t something you get to skip: across data centers, partitions will happen. So the real
              choice is what the cut-off side does. It refuses (<strong>C</strong>) or answers anyway (<strong>A</strong>). The stage replays both:
              Alice gets a stale answer from an available Virginia, then an error from a consistent one.
            </p>
            <Aside>
              You&apos;ll often hear &ldquo;pick two of three&rdquo;. That&apos;s misleading: you can&apos;t drop P. And when there is no partition,
              there&apos;s nothing to give up: a system can be consistent and available at the same time.
            </Aside>
          </>
        ),
        quiz: {
          question: 'Your database runs in three regions. Why can’t you simply choose “CA”?',
          options: [
            {
              text: 'You can: most databases are CA',
              why: 'A single-machine database is “CA” because there’s no network inside it to break. Spread across regions, partitions are a fact of life.',
            },
            {
              text: 'Partitions will happen anyway, and then it must give up C or A',
              correct: true,
              why: 'Choosing “CA” across a network only means you haven’t decided what happens during a partition. The network will decide for you.',
            },
            {
              text: 'C and A always conflict, even without a partition',
              why: 'With a healthy network every replica can check with the others, so it can answer and stay consistent. (It costs latency, as you’ll see at the end, but it’s possible.)',
            },
          ],
        },
        readout: 'cap',
        legend: [LG.req, LG.ok, LG.stale, LG.err],
      },
      {
        id: 'choose-consistency',
        title: 'Choose C: the minority refuses',
        cfg: { ...CP },
        predict: { needed: 3, prompt: 'During the partition, what does each person get?' },
        ops: [
          {
            kind: 'book',
            c: 'bob',
            wait: 1.2,
            ask: {
              ask: 'Bob books the last seat in Frankfurt. What happens?',
              why: 'Frankfurt can still reach Singapore, and 2 of 3 is a majority. The booking is stored on both, so Bob gets his seat.',
            },
          },
          {
            kind: 'read',
            c: 'alice',
            wait: 1.2,
            ask: {
              ask: 'Alice checks the seats in Virginia. What does she get?',
              why: 'Virginia can only reach itself, and 1 of 3 is not a majority. It can’t be sure it has the latest write (it doesn’t: Bob just took the seat), so a CP system refuses rather than risk a wrong answer.',
            },
          },
          {
            kind: 'read',
            c: 'carol',
            wait: 1.2,
            ask: {
              ask: 'Carol checks the seats in Singapore. What does she get?',
              why: 'Singapore confirms with Frankfurt (2 of 3), sees Bob’s booking and answers “0 left”: the new value.',
            },
          },
        ],
        loop: true,
        body: (
          <>
            <p>
              A <strong>CP</strong> system chooses consistency. This one follows a simple rule: <strong>answer only once a majority (2 of 3) confirms</strong>.
              A booking must be stored on a majority. A read must hear from a majority, and the newest version wins.
            </p>
            <p>
              The partition splits the replicas 1 against 2. Frankfurt and Singapore still form a majority, so they keep working. Virginia is the{' '}
              <strong>minority</strong>, and it refuses.
            </p>
            <p>
              Why is the majority side safe? A write needs 2 of 3, and there&apos;s only room for one group of 2. Virginia alone can&apos;t have accepted
              anything the others missed. The simulation pauses at each request: <strong>predict what happens</strong>.
            </p>
            <Aside>Real CP systems run every write through an elected leader (next chapter). This majority rule is the heart of it.</Aside>
          </>
        ),
        readout: 'decision',
        hud: ['errors', 'stale'],
        legend: [LG.req, LG.ok, LG.check, LG.err],
        code: {
          title: 'etcdctl · on Virginia',
          lang: 'shell',
          code: `$ etcdctl put seats_left 0
!Error: context deadline exceeded`,
          note: 'etcdctl gives up after its 5-second command timeout: the write never reached a majority, so it never committed.',
        },
      },
      {
        id: 'choose-availability',
        title: 'Choose A: everyone answers',
        cfg: { ...AP },
        predict: { needed: 3, prompt: 'Same partition, same last seat. What happens now?' },
        ops: [
          {
            kind: 'book',
            c: 'alice',
            wait: 1.2,
            ask: {
              ask: 'Alice books the last seat in Virginia. What happens?',
              why: 'An AP replica answers from its own copy. Virginia still sees 1 seat, so it takes the booking and says “booked”. The copies for the others wait until the network heals.',
            },
          },
          {
            kind: 'read',
            c: 'bob',
            wait: 1.2,
            ask: {
              ask: 'Bob checks the seats in Frankfurt. What does he see?',
              why: 'Frankfurt never heard about Alice’s booking. It happily answers “1 left”: stale, but fast and error-free.',
            },
          },
          {
            kind: 'book',
            c: 'bob',
            wait: 1.6,
            ask: {
              ask: 'Bob books the last seat too. What happens?',
              why: 'Frankfurt still thinks the seat is free, so it takes the booking. Two people now hold a confirmation for one seat. Availability kept them both happy, for now.',
            },
          },
        ],
        loop: true,
        body: (
          <>
            <p>
              An <strong>AP</strong> system chooses availability: every replica answers from its own copy, partition or not. No errors, low latency, and
              the cut-off side keeps selling.
            </p>
            <p>
              The price shows up as <strong>stale reads</strong> and, worse, <strong>conflicting writes</strong>: both sides can change the same data
              without knowing about each other.
            </p>
            <p>
              <strong>Predict each outcome</strong> again. Same partition, same last seat, different rule.
            </p>
            <Aside>
              AP doesn&apos;t mean anything goes. The replicas still sync whenever they can, and updates that couldn&apos;t cross the partition are held
              and delivered after it heals (Cassandra calls this &ldquo;hinted handoff&rdquo;). Chapter 7 shows what happens then.
            </Aside>
          </>
        ),
        readout: 'decision',
        hud: ['oversold', 'stale'],
        legend: [LG.req, LG.ok, LG.stale, LG.repl],
        code: {
          title: 'cqlsh · in Virginia',
          lang: 'sql',
          code: `cqlsh> CONSISTENCY ONE;
Consistency level set to ONE.
!cqlsh> UPDATE flights SET seats_left = 0 WHERE id = 'UA88';`,
          note: 'At consistency level ONE, Cassandra accepts the write as soon as one replica has it, even with the others unreachable.',
        },
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'systems',
    title: 'Real systems pick a side',
    cfg: { view: 'world' },
    steps: [
      {
        id: 'etcd-raft',
        title: 'CP in practice: a leader and a majority',
        cfg: { auto: 'raft', seats: 50, ver: 20 },
        body: (
          <>
            <p>
              <strong>etcd</strong>, <strong>ZooKeeper</strong> and <strong>Consul</strong> are CP. They hold the data that must never be wrong: who
              holds a lock, which node is primary, the cluster&apos;s configuration. Kubernetes keeps all of its state in etcd.
            </p>
            <p>
              They run a consensus protocol: <strong>Raft</strong> in etcd and Consul, Zab in ZooKeeper. One replica is the <strong>leader</strong>.
              Every write goes through it and commits once a majority has stored it. Followers expect the leader&apos;s heartbeat; when it stops, they
              hold an election, and winning takes a majority of the votes.
            </p>
            <p>
              <strong>Cut Virginia off</strong> while it leads. The other two stop hearing heartbeats and elect Frankfurt. Virginia can&apos;t reach a
              majority, so it steps down and writes there fail. Then heal the network and watch it rejoin as a follower.
            </p>
            <Aside>
              A majority of 3 is 2, so a 3-node cluster survives 1 failure; 5 nodes survive 2. A 4th node doesn&apos;t help: 4 nodes need 3 votes and
              still survive just 1. That&apos;s why clusters come in odd sizes.
            </Aside>
          </>
        ),
        panel: (s) => (
          <ActionsCard
            buttons={[
              { label: 'Cut Virginia off', icon: 'power', run: () => s.cutNetwork() },
              { label: 'Heal the network', icon: 'replay', run: () => s.healNetwork() },
            ]}
          />
        ),
        readout: 'raft',
        hud: ['leader', 'errors'],
        legend: [LG.req, LG.ok, LG.vote, LG.err],
        code: {
          title: 'shell · after the election',
          lang: 'shell',
          code: `$ etcdctl endpoint status --cluster -w table
+-----------------------------+-----------+-----------+
|          ENDPOINT           | IS LEADER | RAFT TERM |
+-----------------------------+-----------+-----------+
| https://192.0.2.10:2379     |     false |         4 |
!| https://198.51.100.10:2379  |      true |         4 |
| https://203.0.113.10:2379   |     false |         4 |
+-----------------------------+-----------+-----------+`,
          note: 'Columns trimmed. Frankfurt leads term 4; Virginia rejoined as a follower.',
        },
      },
      {
        id: 'tunable',
        title: 'AP in practice: choose per request',
        cfg: { auto: 'tunable', seats: 120, ver: 40, wq: 1, rq: 1, failFast: true, hints: true, rtt: true },
        body: (
          <>
            <p>
              <strong>Cassandra</strong> and <strong>DynamoDB</strong>, descendants of Amazon&apos;s Dynamo, lean AP: any replica accepts writes, and
              replicas reconcile later. But they let you choose how long to wait, <em>per request</em>.
            </p>
            <p>
              In Cassandra that&apos;s the <strong>consistency level</strong>. The replica <Term k="carol">Carol</Term> talks to acts as{' '}
              <strong>coordinator</strong>: it sends her write to all three replicas and replies once enough have acknowledged. <code>ONE</code> waits for
              one, <code>QUORUM</code> for a majority, <code>ALL</code> for every replica. Try each, then cut Virginia off and try again.
            </p>
            <p>
              That&apos;s how teams mix both worlds. A like counter or a shopping cart can use <code>ONE</code>: a stale read there costs little. Selling
              the last seat should wait for a majority, or use a lightweight transaction (<code>IF seats_left = 1</code>), which runs Paxos and makes that
              one operation CP.
            </p>
          </>
        ),
        panel: (s) => (
          <>
            <ToggleCard
              prompt="Carol's consistency level:"
              options={[
                { label: 'ONE', apply: () => s.update({ wq: 1 }), note: <>Done as soon as Singapore has it: about 2 ms.</> },
                { label: 'QUORUM', apply: () => s.update({ wq: 2 }), note: <>Waits for the nearest other replica, Frankfurt: about 160 ms.</> },
                { label: 'ALL', apply: () => s.update({ wq: 3 }), note: <>Waits for Virginia too: about 220 ms, and fails if any replica is down.</> },
              ]}
            />
            <ToggleCard
              kicker="Break it"
              prompt="The network:"
              options={[
                { label: 'Healthy', apply: () => s.healNetwork() },
                {
                  label: 'Virginia cut off',
                  apply: () => s.cutNetwork(),
                  note: (
                    <>
                      <code>ONE</code> and <code>QUORUM</code> still work. <code>ALL</code> fails at once: the coordinator knows only 2 of 3 replicas are
                      reachable.
                    </>
                  ),
                },
              ]}
            />
          </>
        ),
        quiz: {
          question: 'Which of these should refuse to answer during a partition?',
          options: [
            { text: 'The like counter on a post', why: 'A like that shows up a few seconds late hurts nobody, and counters merge cleanly after the heal.' },
            {
              text: 'Moving $500 between two bank accounts',
              correct: true,
              why: 'Doing it twice, or on a stale balance, costs real money. Better to show an error and let the customer retry.',
            },
            {
              text: 'Adding boots to a shopping cart',
              why: 'Amazon built Dynamo so the cart always accepts writes: losing a sale is worse than merging two versions of a cart later.',
            },
          ],
        },
        readout: 'tunable',
        hud: ['wlat', 'errors'],
        legend: [LG.req, LG.ok, LG.repl, LG.ack, LG.err],
        code: [
          {
            title: 'cqlsh · Virginia cut off',
            lang: 'sql',
            code: `cqlsh> CONSISTENCY ALL;
cqlsh> UPDATE flights SET seats_left = 119 WHERE id = 'UA88';
!Unavailable: Error from server: code=1000 [Unavailable exception]
!message="Cannot achieve consistency level ALL"
info={'consistency': 'ALL', 'required_replicas': 3, 'alive_replicas': 2}`,
          },
          {
            title: 'DynamoDB · JavaScript SDK',
            lang: 'js',
            code: `const { Item } = await ddb.send(new GetCommand({
  TableName: 'flights',
  Key: { id: 'UA88' },
!  ConsistentRead: true,   // default: false (eventually consistent)
}));`,
            note: 'Eventually consistent reads are the default and cost half as much; strongly consistent reads use twice the read capacity.',
          },
        ],
      },
    ],
  },
];

export const CHAPTERS: Chapter[] = [...CHAPTERS_1, ...CHAPTERS_2];
