import { Aside } from '@/components/lesson/Prose';
import { Term } from '@/components/lesson/Term';
import { ATTACK_KEYS } from './hashing';
import type { Chapter } from './types';

export const META = { slug: 'hash-tables', code: 'CS-03', track: 'Computer science', title: 'Hash Tables' };

/** The unsorted contact list of chapter 1 */
const CONTACTS = ['carol', 'alice', 'heidi', 'bob', 'frank', 'erin', 'grace', 'judy', 'dave', 'ivan'];
/** Chapter 2's table */
const SEVEN = ['alice', 'bob', 'carol', 'dave', 'grace', 'heidi', 'nina'];
/** Fill order for the load-factor slider */
const FILL = ['alice', 'bob', 'carol', 'dave', 'erin', 'grace', 'judy', 'heidi', 'nina', 'kim'];
/** A table one key away from its resize */
const BEFORE_RESIZE = ['alice', 'bob', 'carol', 'dave', 'erin', 'grace', 'judy'];

export const CHAPTERS: Chapter[] = [
  /* ================================================================ */
  {
    id: 'why',
    title: 'Why hash tables?',
    steps: [
      {
        id: 'scan-a-list',
        title: 'Searching a list, one by one',
        cfg: { view: 'list', list: CONTACTS, machine: 'off' },
        run: (s) => {
          s.pause(0.6);
          s.scan('dave');
          s.pause(0.8);
          s.scan('zoe');
          s.pause(0.8);
          s.scan('carol');
        },
        loop: 2.5,
        body: (
          <>
            <p>
              Your phone’s contacts app holds names and numbers. You type <strong>dave</strong> and want his number. How does it find him?
            </p>
            <p>
              The simplest way is to start at the first entry and check each one. Is this dave? No. This one? No… dave is 9th, so that takes <strong>9
              comparisons</strong>. Searching for <strong>zoe</strong>, who isn’t there at all, means checking all 10 before you can say “not found”.
            </p>
            <p>
              This is a <strong>linear scan</strong>, and its cost grows with the list. A million contacts means up to a million comparisons. In Big-O terms,
              it’s <strong>O(n)</strong>.
            </p>
          </>
        ),
        callouts: [{ target: 'list:8', text: <>dave is 9th: <b>9 comparisons</b></>, dir: 'down' }],
        hud: ['cmp', 'items'],
        legend: ['get', 'cmp', 'hit', 'miss'],
        code: {
          title: 'contacts.js',
          lang: 'js',
          code: `
const contacts = [
  { name: 'carol', phone: '555-0163' },
  { name: 'alice', phone: '555-0142' },
  // ...10 contacts, or 10 million
];

!contacts.find((c) => c.name === 'dave');   // checks them one by one`,
        },
      },
      {
        id: 'jump-to-an-index',
        title: 'Arrays jump straight to a slot',
        cfg: { view: 'list', list: CONTACTS, machine: 'off' },
        run: (s) => {
          s.pause(0.4);
          s.jump(8);
          s.pause(1);
          s.jump(3);
        },
        loop: 2.5,
        body: (
          <>
            <p>
              Now ask for <code>contacts[8]</code> instead: whatever sits in position 8. There’s no searching at all.
            </p>
            <p>
              An array keeps its entries side by side in memory, all the same size. So the computer finds entry 8 with one multiplication and one addition:{' '}
              <strong>start + 8 × entry size</strong>. That costs the same for ten entries or ten million. It’s <strong>O(1)</strong>, constant time.
            </p>
            <p>
              The catch: you don’t know that dave is at position 8. You know his <em>name</em>. What if a function could turn “dave” into a position?
            </p>
          </>
        ),
        readout: 'address',
        hud: ['steps'],
        code: {
          title: 'contacts.c',
          lang: 'c',
          code: `
struct contact { const char *name; const char *phone; };  // 16 bytes
struct contact contacts[10];

!struct contact *c = &contacts[8];   // start + 8 * 16: one step`,
        },
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'key-to-bucket',
    title: 'From key to bucket',
    steps: [
      {
        id: 'hash-function',
        title: 'A hash function turns keys into numbers',
        cfg: { machine: 'full' },
        focus: ['machine'],
        run: (s) => {
          s.pause(0.5);
          s.hashOnly('bob');
          s.pause(0.4);
          s.hashOnly('alice');
          s.pause(0.4);
          s.hashOnly('bob');
        },
        loop: 3,
        body: (
          <>
            <p>
              A <strong>hash function</strong> turns a key into a number. Ours reads the key one character at a time. Every character has a numeric code (b is
              98, o is 111), and <Term k="machine">the machine</Term> keeps a running total: <strong>multiply by 31, add the next code</strong>.
            </p>
            <p>
              Watch it take “bob”: 98, then 98 × 31 + 111 = 3,149, then 3,149 × 31 + 98 = <strong>97,717</strong>.
            </p>
            <p>
              Two properties make this useful. It’s <strong>deterministic</strong>: the same key always gives the same number, so bob comes out as 97,717 every
              time (check the log). And it’s <strong>fast</strong>: one quick pass over the characters, however many keys you store.
            </p>
            <Aside>
              This is exactly Java’s <code>String.hashCode()</code> for short keys. Production tables use functions like SipHash, xxHash or FNV that mix the
              bits far more thoroughly, but the job is the same: key in, number out.
            </Aside>
          </>
        ),
        readout: 'hashlog',
        code: {
          title: 'hash.js',
          lang: 'js',
          code: `
function hash(key) {
  let h = 0;
  for (const ch of key) {
!    h = h * 31 + ch.charCodeAt(0);
  }
  return h;
}

hash('bob');   // 97717
hash('bob');   // 97717, every single time`,
          note: 'Java computes the same thing in 32-bit ints, so long strings wrap around. In JavaScript, Math.imul(h, 31) reproduces that.',
        },
      },
      {
        id: 'hash-to-bucket',
        title: 'From a big number to a bucket',
        cfg: { machine: 'full' },
        run: (s) => {
          s.pause(0.4);
          s.put('alice');
          s.put('bob', { quick: true });
          s.put('carol', { quick: true });
          s.put('dave', { quick: true });
        },
        body: (
          <>
            <p>
              alice hashes to 92,903,040, but our table only has <strong>10 buckets</strong>, numbered 0 to 9. To squeeze any hash into that range, keep the
              remainder: <strong>index = hash mod 10</strong>.
            </p>
            <p>
              With 10 buckets that’s simply the <strong>last digit</strong>. alice’s 92,903,040 goes to bucket 0, bob’s 97,717 to bucket 7. Each key flies
              straight to its bucket. No scanning.
            </p>
            <p>
              That’s the whole idea of a <strong>hash table</strong>: an array of buckets, plus a hash function that picks the bucket.
            </p>
            <Aside>
              Most real tables make the bucket count a power of two (8, 16, 32…) so the remainder is a single fast bit operation. We use 10 so you can do the
              math in your head.
            </Aside>
          </>
        ),
        interaction: { kind: 'keys', prompt: 'Type a name and watch where it lands.', mode: 'put', suggestions: ['kim', 'nina', 'xena', 'uma'] },
        hud: ['items', 'load'],
        legend: ['put'],
        code: {
          title: 'table.js',
          lang: 'js',
          code: `
const buckets = new Array(10);

!const i = hash('alice') % buckets.length;   // 92903040 % 10 = 0
buckets[i] = ['alice', '555-0142'];`,
        },
      },
      {
        id: 'predict-the-bucket',
        title: 'Your turn: pick the bucket',
        cfg: { machine: 'full', preset: ['alice', 'bob', 'carol', 'dave'] },
        predict: { rounds: 3, prompt: 'Which bucket will the key land in? Click it on the stage.' },
        run: (s) => {
          s.pause(0.5);
          for (const k of ['grace', 'heidi', 'nina', 'kim', 'xena', 'uma']) s.put(k, { predict: 'bucket', quick: true });
        },
        loop: 2,
        body: (
          <>
            <p>
              Now the machine stops just before the last step. Read the hash, work out <strong>hash mod 10</strong>, and click the bucket where the key will
              land.
            </p>
            <p>Shortcut: with 10 buckets, it’s the last digit of the hash.</p>
          </>
        ),
        hud: ['items', 'load'],
        legend: ['put'],
      },
      {
        id: 'lookups',
        title: 'Lookups take the same path',
        cfg: { machine: 'full', preset: SEVEN },
        run: (s) => {
          s.pause(0.4);
          s.get('dave');
          s.pause(0.5);
          s.get('zoe');
        },
        body: (
          <>
            <p>
              Finding a key works exactly like inserting it. Hash <strong>dave</strong>, take mod 10, go to bucket 6, and check that the key there really is
              dave. Found, after <strong>1 comparison</strong>.
            </p>
            <p>
              Now look up <strong>zoe</strong>. Her hash ends in 4, so the table checks bucket 4. It holds grace, not zoe, and nothing else, so zoe isn’t in
              the table. One comparison to be sure.
            </p>
            <p>
              Why compare at all? Because a bucket can hold a <em>different</em> key than the one you asked for. That’s the next chapter.
            </p>
          </>
        ),
        interaction: { kind: 'keys', prompt: 'Look up any name.', mode: 'get', suggestions: ['alice', 'nina', 'zoe', 'walt'] },
        hud: ['cmp', 'items'],
        legend: ['get', 'cmp', 'hit', 'miss'],
        code: {
          title: 'phone.js',
          lang: 'js',
          code: `
const phone = new Map();
phone.set('alice', '555-0142');
phone.set('dave', '555-0108');

!phone.get('dave');   // '555-0108': hash, jump, compare
phone.get('zoe');    // undefined
phone.has('alice');  // true`,
        },
      },
      {
        id: 'lookup-race',
        title: 'The lookup race',
        cfg: { view: 'race', list: SEVEN, preset: SEVEN, machine: 'strip', reserve: 1 },
        run: (s) => {
          s.pause(0.8);
          s.raceFor('nina');
        },
        body: (
          <>
            <p>
              The same seven contacts, stored twice: in a plain <Term k="list">list</Term> on top, and in a <Term k="rack">hash table</Term> below. Both look
              up the same name at the same moment.
            </p>
            <p>
              For <strong>nina</strong>, the list checks alice, bob, carol… 7 comparisons. The table hashes once, jumps to bucket 2, and compares{' '}
              <strong>once</strong>.
            </p>
            <p>
              Now race for <strong>alice</strong>. She’s first in the list, so the scan wins: hashing costs a little up front. For a handful of items a scan is
              fine. For big collections it’s hopeless: with a million contacts the list averages 500,000 comparisons per lookup, the table still one or two.
            </p>
          </>
        ),
        interaction: {
          kind: 'actions',
          prompt: 'Pick a name to race for:',
          buttons: [
            { label: 'nina', run: (s) => s.raceFor('nina') },
            { label: 'alice', run: (s) => s.raceFor('alice') },
            { label: 'zoe (missing)', run: (s) => s.raceFor('zoe') },
          ],
        },
        hud: ['race'],
        legend: ['get', 'cmp', 'hit'],
        code: {
          title: 'redis.conf',
          lang: 'conf',
          code: `
# small hashes are stored as a flat list,
# big ones get a real hash table
!hash-max-listpack-entries 128
!hash-max-listpack-value 64`,
          note: 'Redis scans small hashes instead of hashing them: for a few entries that is faster and uses less memory.',
        },
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'collisions',
    title: 'Collisions',
    steps: [
      {
        id: 'collisions',
        title: 'Collisions are unavoidable',
        cfg: { machine: 'full' },
        run: (s) => {
          s.pause(0.4);
          s.put('alice', { quick: true });
          s.put('bob', { quick: true });
          s.put('dave', { quick: true });
          s.put('erin', { hover: true });
        },
        body: (
          <>
            <p>
              Watch <strong>erin</strong> arrive. Her hash, 3,121,810, also ends in 0, and bucket 0 already holds alice. Two different keys want the same
              bucket. That’s a <strong>collision</strong>.
            </p>
            <p>
              You can’t design collisions away. There are endless possible names and only 10 buckets, so some keys must share: that’s the{' '}
              <strong>pigeonhole principle</strong>. And they show up sooner than you’d think. With 4 keys in 10 buckets, the chance of a collision is already
              50%. It’s the <strong>birthday paradox</strong>: in a room of just 23 people, two probably share a birthday.
            </p>
            <p>So every hash table needs a plan for collisions. There are two classic ones.</p>
          </>
        ),
        readout: 'birthday',
        quiz: {
          question: 'A table has 10 buckets and a good hash function. After how many keys is a collision more likely than not?',
          options: [
            { text: '11 keys', why: 'At 11 a collision is certain (pigeonhole). It becomes likely long before that.' },
            { text: '6 keys', why: 'By 6 keys the chance is already 85%. The tipping point comes earlier.' },
            { text: '5 keys', correct: true, why: '1 − (10·9·8·7·6) / 10⁵ ≈ 70%. With 4 keys it’s 49.6%, just under a coin flip.' },
          ],
        },
        hud: ['birthday'],
        legend: ['put', 'taken'],
        code: {
          title: 'birthday.py',
          lang: 'python',
          code: `
from math import prod

def collision_odds(keys, buckets):
    return 1 - prod((buckets - i) / buckets for i in range(keys))

!collision_odds(4, 10)     # 0.496
collision_odds(23, 365)   # 0.507: the birthday paradox`,
        },
      },
      {
        id: 'separate-chaining',
        title: 'Separate chaining',
        cfg: { machine: 'full', preset: ['alice', 'bob', 'dave'] },
        run: (s) => {
          s.pause(0.4);
          s.put('erin');
          s.put('frank', { quick: true });
          s.pause(0.5);
          s.get('frank');
        },
        body: (
          <>
            <p>
              Plan one: every bucket holds a small <strong>linked list</strong> of entries, called a <strong>chain</strong>. erin simply joins alice’s chain in
              bucket 0. frank’s hash ends in 0 too, so he joins the same chain.
            </p>
            <p>
              An insert walks the chain first, to check the key isn’t already there (if it is, it just updates the value). Looking up frank means hashing to
              bucket 0, then walking: alice? No. erin? No. frank? Yes. <strong>3 comparisons.</strong>
            </p>
            <p>
              Long chains are slow, but as long as chains stay short, lookups stay fast. Java’s <code>HashMap</code> works this way.
            </p>
          </>
        ),
        callouts: [{ target: 'chain:0', text: <>one bucket, <b>a chain of keys</b></>, dir: 'down' }],
        hud: ['cmp', 'longest'],
        legend: ['put', 'get', 'cmp', 'hit'],
        code: {
          title: 'chained-table.js',
          lang: 'js',
          code: `
class ChainedTable {
  buckets = Array.from({ length: 10 }, () => []);

  set(key, value) {
!    const chain = this.buckets[hash(key) % 10];
    const entry = chain.find((e) => e.key === key);
    if (entry) entry.value = value;      // already there: update
!    else chain.push({ key, value });     // collision? just append
  }

  get(key) {
    const chain = this.buckets[hash(key) % 10];
!    return chain.find((e) => e.key === key)?.value;
  }
}`,
        },
      },
      {
        id: 'linear-probing',
        title: 'Open addressing: linear probing',
        cfg: { machine: 'full', mode: 'probe', preset: ['alice', 'bob', 'dave', 'grace', 'heidi'] },
        run: (s) => {
          s.pause(0.4);
          s.put('erin');
          s.put('frank', { quick: true });
          s.put('judy', { quick: true });
          s.pause(0.5);
          s.get('judy', { quick: true });
        },
        body: (
          <>
            <p>
              Plan two keeps every key in the array itself. If a key’s slot is taken, try the next one, then the next, until one is free. This is{' '}
              <strong>open addressing</strong>, and stepping one slot at a time is <strong>linear probing</strong>.
            </p>
            <p>
              erin’s home slot 0 is taken, so she lands in 1. frank tries 0 and 1, then lands in 2. judy’s home is 4, but 4 through 7 are all taken, so she
              walks to 8. Runs of taken slots are called <strong>clusters</strong>, and any key that hashes into one must walk to its end. Lookups follow the
              same path and stop at the key, or at the first empty slot.
            </p>
            <p>Flip the toggle to replay the same inserts with chaining.</p>
            <Aside>
              With no pointers and everything in one array, probing is kind to CPU caches. Python’s dict, Rust’s HashMap and Go’s map all use open
              addressing, with smarter probe sequences than +1.
            </Aside>
          </>
        ),
        interaction: {
          kind: 'toggle',
          prompt: 'Replay the same inserts with:',
          options: [
            { label: 'Linear probing', apply: (s) => s.replayWith({ mode: 'probe' }) },
            { label: 'Separate chaining', apply: (s) => s.replayWith({ mode: 'chain' }) },
          ],
        },
        hud: ['cmp', 'longest'],
        legend: ['put', 'get', 'taken', 'hit'],
        code: {
          title: 'probing.js',
          lang: 'js',
          code: `
function get(key) {
  let i = hash(key) % slots.length;
!  while (slots[i] !== undefined) {          // stop at an empty slot
    if (slots[i].key === key) return slots[i].value;
!    i = (i + 1) % slots.length;             // taken: try the next one
  }
  return undefined;
}`,
        },
      },
      {
        id: 'predict-the-probe',
        title: 'Your turn: follow the probe',
        cfg: { machine: 'full', mode: 'probe', preset: ['alice', 'erin', 'grace', 'heidi', 'dave'] },
        predict: { rounds: 3, prompt: 'The key hovers over its home slot. Click the slot where it will end up.' },
        run: (s) => {
          s.pause(0.5);
          for (const k of ['frank', 'carol', 'judy', 'bob', 'walt']) s.put(k, { predict: 'probe', quick: true });
        },
        loop: 2,
        body: (
          <>
            <p>
              Your turn to probe. Each key is hashed and then hovers over its <strong>home slot</strong>. If that slot is taken, it steps right (wrapping from 9
              back to 0) until it finds a free one.
            </p>
            <p>Click the slot where you think it lands. Careful: sometimes the home slot is free.</p>
          </>
        ),
        hud: ['cmp', 'longest'],
        legend: ['put', 'taken'],
      },
      {
        id: 'tombstones',
        title: 'Deleting needs tombstones',
        cfg: { machine: 'full', mode: 'probe', preset: ['alice', 'erin', 'frank', 'grace', 'heidi', 'dave'] },
        body: (
          <>
            <p>
              Deleting from a chained table is easy: unlink the node. Open addressing is trickier, because a lookup stops at the first <strong>empty</strong>{' '}
              slot. Empty means “no key ever had to probe past here”.
            </p>
            <p>
              <Term k="key:frank">frank</Term> sits in slot 2 only because slots 0 and 1 were taken when he arrived. Delete erin from slot 1, then look for
              frank.
            </p>
            <p>
              The fix is a <strong>tombstone</strong>: a marker that says “something used to be here”. Lookups step over it, inserts can reuse it, and the
              next resize clears them all away.
            </p>
          </>
        ),
        interaction: {
          kind: 'actions',
          buttons: [
            {
              label: 'Delete erin: empty the slot',
              icon: 'x',
              run: (s) => s.demoDelete('erin', 'frank', false),
              after: (
                <>
                  The lookup for frank reaches the empty slot 1 and stops: <strong>not found</strong>. But frank is right there in slot 2. The empty slot cut his
                  probe path.
                </>
              ),
            },
            {
              label: 'Delete erin: leave a tombstone',
              icon: 'check',
              run: (s) => s.demoDelete('erin', 'frank', true),
              after: (
                <>
                  Now slot 1 holds a tombstone. The lookup steps over it and finds frank in slot 2. A later insert could reuse slot 1.
                </>
              ),
            },
          ],
        },
        callouts: [{ target: 'key:frank', text: <>frank’s home is <b>slot 0</b></>, dir: 'down' }],
        hud: ['cmp', 'tombs'],
        legend: ['del', 'get', 'tomb', 'hit', 'miss'],
        code: {
          title: 'delete.js',
          lang: 'js',
          code: `
const TOMBSTONE = { deleted: true };

function remove(key) {
  const i = findSlot(key);
!  if (i !== -1) slots[i] = TOMBSTONE;   // not undefined!
}
// get() steps over tombstones and keeps probing;
// set() can reuse the first tombstone it passes.`,
        },
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'growing',
    title: 'Growing the table',
    steps: [
      {
        id: 'load-factor',
        title: 'Load factor: how full is too full?',
        cfg: { machine: 'off', mode: 'probe', list: FILL, preset: FILL.slice(0, 5), curve: true },
        body: (
          <>
            <p>
              The <strong>load factor</strong> is how full the table is: <strong>keys ÷ buckets</strong>, written α. Five keys in 10 buckets makes 0.5.
            </p>
            <p>
              Drag the slider to add keys. With linear probing, clusters grow and merge as the table fills, and a lookup for a missing key must walk to the end
              of one. The curve shows what that costs on a big table: a miss compares against about 1.5 keys at α = 0.5, 7.5 at 0.75, and about 50 at 0.9.
            </p>
            <p>
              Chaining degrades gently instead: a miss walks one chain, and chains hold α keys on average. Either way, the cure is the same:{' '}
              <strong>don’t let the table get too full</strong>.
            </p>
            <Aside>The curves are Knuth’s classic averages for a large table with a well-mixed hash. Our 10-slot table wobbles around them.</Aside>
          </>
        ),
        interaction: { kind: 'load', max: 10 },
        hud: ['items', 'load', 'longest'],
        code: {
          title: 'the limits, in real code',
          lang: 'c',
          code: `
// java.util.HashMap
!static final float DEFAULT_LOAD_FACTOR = 0.75f;

// CPython, Objects/dictobject.c: grow at 2/3 full
!#define USABLE_FRACTION(n) (((n) << 1)/3)`,
        },
      },
      {
        id: 'resize',
        title: 'Double the table, rehash every key',
        cfg: { machine: 'full', preset: BEFORE_RESIZE, maxLoad: 0.75, reserve: 2 },
        run: (s) => {
          s.pause(1.6);
          s.put('kim');
        },
        body: (
          <>
            <p>
              So tables set a <strong>maximum load factor</strong> and <strong>resize</strong> when they cross it. Ours uses 0.75, like Java. Seven keys in 10
              buckets is 0.7. Watch what happens when <strong>kim</strong> arrives.
            </p>
            <p>
              8 ÷ 10 = 0.8, over the limit. The table allocates a <strong>new array with twice the buckets</strong> and moves every key into it. Each key
              needs a fresh index, because the index was hash mod 10 and is now <strong>hash mod 20</strong>. Some keys stay put; others move 10 buckets over.
            </p>
            <p>Then the old array is freed. The load factor drops to 0.4, and the chains get shorter.</p>
            <Aside>
              Java and Python store each key’s hash next to it, so a resize only redoes the cheap mod, never the hash function itself.
            </Aside>
          </>
        ),
        interaction: {
          kind: 'actions',
          buttons: [
            {
              label: 'Insert 3 more keys',
              icon: 'plus',
              run: (s) => {
                for (const k of ['mia', 'nina', 'leo']) s.put(k, { quick: true });
              },
              after: <>The bigger table absorbs them easily. The next resize won’t come until 16 keys (0.8 of 20).</>,
            },
          ],
        },
        hud: ['items', 'cap', 'load'],
        legend: ['put', 'moved', 'stay'],
        code: {
          title: 'Phone.java',
          lang: 'c',
          code: `
// 16 buckets; double when size > 16 × 0.75 = 12
!Map<String, String> phone = new HashMap<>(16, 0.75f);

phone.put("alice", "555-0142");   // ...the 13th put doubles it to 32`,
        },
      },
      {
        id: 'predict-the-rehash',
        title: 'Your turn: stay or move?',
        cfg: { machine: 'full', preset: [...BEFORE_RESIZE, 'kim'], maxLoad: 0.75, reserve: 2 },
        predict: { rounds: 3, prompt: 'The table is doubling from 10 to 20 buckets. Does this key stay in its bucket, or move 10 over?' },
        run: (s) => {
          s.pause(0.9);
          s.resize({ predict: true });
        },
        loop: 2.5,
        body: (
          <>
            <p>Here’s the table again, already over its limit. This time you call each move.</p>
            <p>
              The machine shows each key’s stored hash. Its new bucket is <strong>hash mod 20</strong>, and since 20 is twice 10, the answer is always either
              its current bucket or that bucket + 10. Just look at the last two digits: a hash ending in 62 goes to 62 mod 20 = 2, one ending in 77 goes to 17.
            </p>
          </>
        ),
        hud: ['cap', 'rehashed'],
        legend: ['moved', 'stay'],
      },
      {
        id: 'amortized',
        title: 'Why resizing stays cheap',
        cfg: { view: 'chart', machine: 'off' },
        run: (s) => s.runChart(64),
        loop: 3,
        body: (
          <>
            <p>A resize touches every key, so the insert that triggers one is slow. But look how rarely that happens.</p>
            <p>
              Each bar is one insert into our table (10 buckets, limit 0.75, doubling). Most inserts touch 1 key. Resizes strike at inserts 8, 16, 31 and
              61, each roughly twice as far along as the last, because every doubling buys twice as much room. Add it all up and the{' '}
              <strong>average never gets past about 3 keys per insert</strong>, however long you keep going. That’s <strong>amortized O(1)</strong>.
            </p>
            <p>The red line is what growing one slot at a time would cost: every insert would copy everything, O(n) each.</p>
          </>
        ),
        hud: ['chart'],
        legend: ['bar', 'spike', 'avg', 'naive'],
        code: {
          title: 'Presize.java',
          lang: 'c',
          code: `
// Know the size up front? Skip every resize:
!Map<String, String> phone = HashMap.newHashMap(1_000_000);   // Java 19+

// Older Java: ask for expected / 0.75 buckets
Map<String, String> old = new HashMap<>(1_333_334);`,
        },
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'wrong',
    title: 'When hashing goes wrong',
    steps: [
      {
        id: 'lazy-hash',
        title: 'A lazy hash function',
        cfg: { machine: 'full', hash: 'first', reserve: 4 },
        run: (s) => {
          s.pause(0.4);
          s.put('jack');
          for (const k of ['jane', 'jill', 'joe', 'max', 'mike', 'mia']) s.put(k, { quick: true });
          s.pause(0.5);
          s.get('joe', { quick: true });
        },
        body: (
          <>
            <p>
              A hash function can be deterministic and still terrible. This one looks only at the <strong>first letter</strong>.
            </p>
            <p>
              Real names aren’t spread evenly over the alphabet. Every j-name lands in bucket 6 and every m-name in bucket 9, while 8 buckets sit empty.
              Looking up <strong>joe</strong> walks the whole j-chain: 4 comparisons. With enough j-names, a lookup is a linear scan again, O(n). And resizing
              can’t help: this hash has only 26 possible values.
            </p>
            <p>
              Switch to the full hash and the same keys spread out. A good hash function uses <strong>every character</strong> and mixes them so that similar
              keys land far apart.
            </p>
          </>
        ),
        interaction: {
          kind: 'toggle',
          prompt: 'Rehash the same keys with:',
          options: [
            {
              label: 'First letter only',
              apply: (s) => {
                s.rebuild({ hash: 'first' });
                s.get('joe', { quick: true });
              },
            },
            {
              label: 'Full hash (× 31)',
              apply: (s) => {
                s.rebuild({ hash: 'poly' });
                s.get('joe', { quick: true });
              },
            },
          ],
        },
        hud: ['longest', 'used', 'cmp'],
        legend: ['put', 'get', 'cmp', 'hit'],
        code: {
          title: 'lazy.js',
          lang: 'js',
          code: `
!const lazyHash = (key) => key.charCodeAt(0);   // only 26 possible values

lazyHash('jack') % 10;   // 6
lazyHash('jill') % 10;   // 6: every j-name, same bucket`,
        },
      },
      {
        id: 'hash-flooding',
        title: 'Hash flooding',
        cfg: { machine: 'full', preset: ['alice', 'bob', 'carol', 'grace'], reserve: 8 },
        body: (
          <>
            <p>
              Now picture an attacker who knows your hash function. In Java’s <code>String.hashCode()</code>, <code>{'"Aa"'}</code> and <code>{'"BB"'}</code>{' '}
              both hash to <strong>2,112</strong>. So every string glued together from those two pairs collides too: all 8 six-letter mixes, from{' '}
              <code>AaAaAa</code> to <code>BBBBBB</code>, hash to 1,952,508,096.
            </p>
            <p>
              Send them in. They all pile into bucket 6, and each insert must walk the whole chain first: 0 + 1 + … + 7 = <strong>28 comparisons</strong> for
              8 keys, about n²/2 for n keys. A bigger table doesn’t help, because identical hashes share a bucket at every size.
            </p>
            <p>
              In 2011, researchers showed that a single web request carrying thousands of such keys as form fields could keep a server’s CPU busy for minutes.
              This is <strong>hash flooding</strong>, a denial-of-service attack.
            </p>
          </>
        ),
        interaction: {
          kind: 'actions',
          prompt: 'Break it:',
          buttons: [
            {
              label: 'Send the attack',
              icon: 'bolt',
              run: (s) => s.attack(),
              after: <>Every key walked the entire chain before joining it. Total: 28 comparisons for 8 inserts, and it grows with the square of the keys.</>,
            },
            { label: 'Reset', icon: 'replay', run: (s) => s.fresh() },
          ],
        },
        readout: 'attack',
        hud: ['total', 'longest'],
        legend: ['put', 'cmp', 'taken'],
        code: {
          title: 'Collide.java',
          lang: 'c',
          code: `
"Aa".hashCode();       // 2112
"BB".hashCode();       // 2112
!"AaAaBB".hashCode() == "BBBBBB".hashCode();   // true`,
        },
      },
      {
        id: 'defenses',
        title: 'Defenses: secret seeds and trees',
        cfg: { machine: 'full', preset: ['alice', 'bob', 'carol', 'grace', 'dave', ...ATTACK_KEYS], reserve: 5 },
        run: (s) => {
          s.pause(0.6);
          s.get('BBBBBB', { quick: true });
        },
        body: (
          <>
            <p>Here’s the flooded table, with innocent dave stuck in the same bucket. Languages defend against this in two ways. Try both.</p>
            <p>
              <strong>Secret seeds.</strong> Python, Rust, Ruby and others hash strings with <strong>SipHash</strong>, which mixes in a random secret key picked
              when the program starts. Without the secret, nobody can predict which keys collide, so the attack keys scatter like any others.
            </p>
            <p>
              <strong>Tree buckets.</strong> Java keeps its hash function but limits the damage: once a bucket holds more than 8 entries, it becomes a balanced
              tree. Finding BBBBBB drops from 9 comparisons to 3, and no lookup in that bucket takes more than 4. It grows like log₂ n instead of n.
            </p>
            <Aside>
              Java only builds trees in tables of 64 buckets or more (smaller ones resize instead); we skip that detail. And a random seed bolted onto a weak
              hash doesn’t help: “Aa” and “BB” still collide, whatever the seed. That’s why SipHash exists.
            </Aside>
          </>
        ),
        interaction: {
          kind: 'toggle',
          prompt: 'Defense:',
          options: [
            {
              label: 'None',
              apply: (s) => {
                s.rebuild({ hash: 'poly', tree: false });
                s.get('BBBBBB', { quick: true });
              },
            },
            {
              label: 'Secret seed',
              apply: (s) => {
                s.rebuild({ hash: 'keyed', tree: false });
                s.get('BBBBBB', { quick: true });
              },
              note: <>Same keys, keyed hash: they spread over the buckets like any other keys.</>,
            },
            {
              label: 'Tree buckets',
              apply: (s) => {
                s.rebuild({ hash: 'poly', tree: true });
                s.get('BBBBBB', { quick: true });
              },
              note: <>Same bucket, but sorted into a balanced tree: each comparison discards half of what’s left.</>,
            },
          ],
        },
        hud: ['cmp', 'longest'],
        legend: ['get', 'cmp', 'hit', 'tree'],
        code: {
          title: 'terminal',
          lang: 'shell',
          code: `
$ python3 -c 'print(hash("alice"))'
-4127693010458744186
$ python3 -c 'print(hash("alice"))'
!7019235483562297040        # new process, new secret, new hash
$ PYTHONHASHSEED=0 python3 -c 'print(hash("alice"))'   # pin it, for tests only`,
        },
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'real-world',
    title: 'Hash tables you already use',
    steps: [
      {
        id: 'java-hashmap',
        title: 'Java’s HashMap',
        cfg: { machine: 'full', hash: 'java', cap: 16, reserve: 2 },
        run: (s) => {
          s.pause(0.4);
          s.put('alice');
          for (const k of ['bob', 'carol', 'dave', 'erin', 'frank', 'grace', 'heidi', 'ivan', 'judy', 'kim', 'leo']) s.put(k, { quick: true });
        },
        body: (
          <>
            <p>
              Java’s <code>HashMap</code> is the textbook chaining table plus a few production tricks. It starts with <strong>16 buckets</strong> and a load
              factor of <strong>0.75</strong>, so it doubles once it holds more than <strong>12</strong> entries.
            </p>
            <p>
              Because 16 is a power of two, the index is <code>hash &amp; 15</code>: just the low 4 bits, one CPU instruction. Keys whose hashes differ only in
              the high bits would then collide, so Java first folds the high half into the low half: <code>{'h ^ (h >>> 16)'}</code>.
            </p>
            <p>Long buckets turn into balanced trees, as you saw. And iteration follows the buckets, so the order looks random: never rely on it.</p>
          </>
        ),
        hud: ['items', 'threshold', 'load'],
        legend: ['put'],
        code: {
          title: 'HashMap.java (JDK 8+)',
          lang: 'c',
          code: `
static final int hash(Object key) {
    int h;
!    return (key == null) ? 0 : (h = key.hashCode()) ^ (h >>> 16);
}

// the bucket, with n a power of two:
!first = tab[(n - 1) & hash];`,
        },
      },
      {
        id: 'python-dict',
        title: 'Python’s dict and JavaScript’s Map',
        cfg: { view: 'pydict', cap: 8, machine: 'full', reserve: 0 },
        run: (s) => {
          s.pause(0.4);
          s.pyPut('alice');
          for (const k of ['bob', 'carol', 'frank']) s.pyPut(k, true);
          s.pyPut('erin');
          s.pyPut('dave', true);
        },
        body: (
          <>
            <p>
              Python’s <code>dict</code> uses open addressing with two twists. First, it’s split in two: a small <Term k="rack">index array</Term>, and a dense
              list of <Term k="entries">entries</Term> in insertion order. An index slot stores only where its entry lives.
            </p>
            <p>
              Second, a collision doesn’t step to the next slot. Python mixes in the higher bits of the hash (<code>perturb</code>) and jumps elsewhere, which
              avoids clusters: watch erin collide with frank in slot 2 and jump to 7. At <strong>2/3 full</strong> it grows: the entries are copied over in
              the same order with their stored hashes, and only the index array is rebuilt.
            </p>
            <p>
              That entry list is why a dict remembers insertion order, guaranteed since Python 3.7. JavaScript’s <code>Map</code> in V8 uses the same idea
              (an insertion-ordered entry list, with chains through it), which is why a Map iterates in insertion order too.
            </p>
            <Aside>CPython hashes strings with SipHash and a random seed. This view uses our toy hash so you can follow the numbers.</Aside>
          </>
        ),
        hud: ['items', 'cap', 'load'],
        legend: ['put', 'taken'],
        code: [
          {
            title: 'order.py',
            lang: 'python',
            code: `
phone = {"carol": "555-0163", "alice": "555-0142"}
phone["bob"] = "555-0117"
del phone["carol"]
phone["carol"] = "555-0163"

!list(phone)   # ['alice', 'bob', 'carol']: insertion order`,
          },
          {
            title: 'order.js',
            lang: 'js',
            code: `
const phone = new Map([['carol', '555-0163'], ['alice', '555-0142']]);
phone.set('bob', '555-0117');
![...phone.keys()];   // ['carol', 'alice', 'bob']: insertion order

const obj = {};   // objects start with fixed "shapes" in V8, and turn
obj.carol = '…';  // into hash tables after many adds and deletes`,
            note: 'For a key-value store in JavaScript, reach for Map: any key type, a real size, and fast deletes.',
          },
        ],
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
        cfg: { machine: 'full', preset: ['alice', 'bob', 'carol', 'dave', 'erin'], maxLoad: 0.75, reserve: 2, pace: 0.12 },
        run: (s) => {
          s.pause(0.4);
          s.put('frank', { quick: true });
          s.get('carol', { quick: true });
          s.put('grace', { quick: true });
          s.put('heidi', { quick: true });
          s.get('frank', { quick: true });
          s.del('bob', { quick: true });
        },
        loop: 3,
        body: <p>Everything in one picture: inserts, lookups, a delete, and a resize when the table passes 0.75.</p>,
        extra: 'cheat',
        hud: ['items', 'cap', 'load'],
        legend: ['put', 'get', 'del', 'hit'],
      },
      {
        id: 'playground',
        title: 'Playground',
        cfg: { machine: 'full', preset: ['alice', 'bob', 'carol', 'dave', 'grace'], maxLoad: 0.75, reserve: 3, pace: 0.12 },
        body: (
          <p>
            Your own hash table. Insert, look up and delete any name, switch the collision strategy and the hash function, and decide when it resizes. Then
            take on the challenges.
          </p>
        ),
        extra: 'playground',
        hud: ['items', 'load', 'longest', 'cmp'],
        legend: ['put', 'get', 'del', 'hit', 'taken'],
      },
    ],
  },
];
