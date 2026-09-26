import { Stat } from '@/components/lesson/cards';
import { Aside } from '@/components/lesson/Prose';
import { Term } from '@/components/lesson/Term';
import type { LegendItem } from '@/components/stage/chrome';
import { SIG } from '@/lib/sim/colors';
import { commas, fibCalls, fmtCountLg, memoCalls } from './model';
import type { Chapter } from './types';

export const META = { slug: 'big-o', code: 'CS-08', track: 'Computer science', title: 'Big-O, Visually' };

const LG: Record<string, LegendItem> = {
  current: { label: 'being compared', color: SIG.warn, shape: 'square' },
  checked: { label: 'already checked', color: '#2A5A6E', shape: 'square' },
  max: { label: 'max so far', color: SIG.res, shape: 'ring' },
  run: { label: 'one run: (n, steps)', color: SIG.req },
  found: { label: 'found', color: SIG.res, shape: 'square' },
  jumpA: { label: 'address jump', color: SIG.req },
  jumpB: { label: 'hash → bucket', color: SIG.hc },
  mid: { label: 'middle', color: SIG.warn, shape: 'square' },
  range: { label: 'still possible', color: SIG.lime, shape: 'square' },
  gone: { label: 'thrown away', color: SIG.err, shape: 'line' },
  best: { label: 'best case', color: SIG.res, shape: 'square' },
  avg: { label: 'average', color: SIG.warn, shape: 'line' },
  worst: { label: 'worst case (missing)', color: SIG.err, shape: 'square' },
  moving: { label: 'item being merged', color: SIG.warn, shape: 'square' },
  sorted: { label: 'sorted run', color: SIG.hc, shape: 'square' },
  compared: { label: 'compared pair', color: SIG.heavy, shape: 'square' },
  iLoop: { label: 'outer loop i', color: SIG.warn, shape: 'square' },
  jLoop: { label: 'inner loop j', color: SIG.req, shape: 'square' },
  call: { label: 'call', color: SIG.req, shape: 'ring' },
  repeat: { label: 'repeated work', color: SIG.heavy, shape: 'ring' },
  stack: { label: 'call stack', color: SIG.warn, shape: 'line' },
  hit: { label: 'cache hit', color: SIG.res, shape: 'ring' },
  ghost: { label: 'finish line at n = 16', color: SIG.warn, shape: 'line' },
  gap: { label: 'the part Big-O drops', color: 'rgba(255,154,60,0.6)', shape: 'square' },
};

export const CHAPTERS: Chapter[] = [
  /* ================================================================ */
  {
    id: 'counting',
    title: 'Counting steps',
    steps: [
      {
        id: 'why-not-seconds',
        title: 'Why not just time it?',
        cfg: { view: 'race', race: 'machines' },
        body: (
          <>
            <p>
              You wrote a function that finds the largest number in an array, and you want to know if it&apos;s fast. The obvious move is to time it.
              Here the same function scans the same <strong>10 million numbers</strong> on three machines.
            </p>
            <p>
              The stopwatches disagree: about 6 ms on the <Term k="lane:server">server</Term>, 14 ms on the <Term k="lane:laptop">laptop</Term>, 27 ms on
              the <Term k="lane:battery">same laptop on battery</Term>. A timing describes one machine on one day, not the code.
            </p>
            <p>
              Now look at the counters. Every machine made exactly <strong>10,000,000 comparisons</strong>, one per number. That count belongs to the code
              itself, so it&apos;s what we&apos;ll measure.
            </p>
            <Aside>
              The timings are illustrative, but the spread is realistic: CPU generation, power settings, other programs and even temperature change
              clock time. Benchmarks still matter; they just answer a different question.
            </Aside>
          </>
        ),
        hud: ['n'],
        callouts: [{ target: 'wide:steps', text: <>different clocks, <b>same count</b></>, dir: 'up' }],
        code: {
          title: 'findMax.js',
          lang: 'js',
          code: `
function findMax(arr) {
  let max = -Infinity;
!  for (const x of arr) {       // one comparison per element
!    if (x > max) max = x;
  }
  return max;
}

console.time('findMax');
findMax(numbers);              // 10,000,000 numbers
console.timeEnd('findMax');    // 6 ms? 14 ms? depends on the machine`,
        },
      },
      {
        id: 'count-the-steps',
        title: 'Count steps as n grows',
        cfg: { view: 'scan', scan: 'max', sweep: true },
        body: (
          <>
            <p>
              So count <strong>basic steps</strong> instead: simple operations like one comparison, one addition or reading one array slot, which take
              roughly constant time on any machine. Then write the count as a function of the input size, <strong>n</strong>.
            </p>
            <p>
              <code>findMax</code> compares each element once, so n numbers cost n comparisons. The stage runs it for n = 4, 8, 12 and 16, and every run
              drops a <Term k="dots">dot on the chart</Term>. The dots fall on a straight line: T(n) = n.
            </p>
            <p>
              The exact count matters less than its <strong>shape</strong>. Big-O answers one question: as n gets large, how fast does the work grow?
              Here, double the input and the work doubles. Other code grows much faster, or hardly at all.
            </p>
          </>
        ),
        card: 'scanSize',
        hud: ['n', 'steps'],
        legend: [LG.current, LG.max, LG.run],
        code: {
          title: 'count.js',
          lang: 'js',
          code: `
function findMax(arr) {
  let max = -Infinity;
!  for (const x of arr) {     // runs n times…
!    if (x > max) max = x;    // …one comparison each
  }
  return max;
}
// T(n) = n comparisons: grows like n, written O(n)`,
        },
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'fast',
    title: 'Constant and log time',
    steps: [
      {
        id: 'constant-time',
        title: 'O(1): the same work at any size',
        cfg: { view: 'constant', n: 10 },
        body: (
          <>
            <p>
              Some operations don&apos;t care how big the input is. Reading <Term k="arr">arr[6]</Term> is one step whether the array holds 10 items or 10
              million: the elements sit side by side in memory, so the address is just <em>start + 6 × 8 bytes</em> and the CPU jumps straight there.
            </p>
            <p>
              A <Term k="hash">hash lookup</Term> works the same way on average. <code>set.has(&quot;carol&quot;)</code> hashes the key into a bucket
              number and checks that one bucket, never touching the other entries.
            </p>
            <p>
              Work that stays flat as n grows is <strong>constant time</strong>, written <strong>O(1)</strong>. Switch the size below and watch the step
              counters.
            </p>
            <Aside>
              O(1) doesn&apos;t mean one instruction or instant, just a fixed cost that doesn&apos;t grow with n. Hash lookups are O(1) on{' '}
              <em>average</em>: if many keys collide into one bucket, a lookup degrades toward O(n).
            </Aside>
          </>
        ),
        toggle: {
          prompt: 'How many items?',
          initial: 0,
          options: [
            { label: '10', apply: (s) => s.setConstN(10), note: <>10 items, 16 buckets. One jump each.</> },
            { label: '1,000', apply: (s) => s.setConstN(1000), note: <>100× more data. Still one jump each.</> },
            {
              label: '10 million',
              apply: (s) => s.setConstN(10_000_000),
              note: (
                <>
                  A million times more data, and <strong>still one step</strong>. The table grew to millions of buckets, but a lookup only ever visits
                  one.
                </>
              ),
            },
          ],
        },
        hud: ['n'],
        legend: [LG.jumpA, LG.jumpB],
        code: {
          title: 'constant.js',
          lang: 'js',
          code: `
const arr = new Float64Array(10_000_000);   // 8 bytes per number
!arr[6];                   // start + 6 × 8 → one read

const names = new Set(['alice', 'bob', 'carol', 'dave']);
!names.has('carol');       // hash → bucket → one check (on average)`,
        },
      },
      {
        id: 'binary-search',
        title: 'O(log n): halve it every step',
        cfg: { view: 'binary', binary: 'array' },
        body: (
          <>
            <p>
              If an array is <strong>sorted</strong>, you don&apos;t have to look at every item. Check the <Term k="mid">middle</Term>. If it&apos;s smaller
              than the target, the target can only be in the right half, so throw the left half away. Otherwise throw the right half away. Repeat.
            </p>
            <p>
              Every check throws away at least half of the <Term k="range">range that&apos;s left</Term>. At worst the range goes 32 → 16 → 8 → 4 → 2 →
              1, so finding any number among 32 takes at most 6 checks.
            </p>
            <p>
              The number of times you can halve n before reaching 1 is the <strong>logarithm</strong> of n, base 2. So binary search is{' '}
              <strong>O(log n)</strong>: double the array and it needs just one more step.
            </p>
            <Aside>
              The base doesn&apos;t matter in Big-O: log₂ n and log₁₀ n differ by a constant factor (about 3.3), and constant factors get dropped, as
              chapter 7 shows.
            </Aside>
          </>
        ),
        actions: {
          buttons: [{ label: 'Search for another number', icon: 'arrowRight', run: (s) => s.nextSearch() }],
        },
        hud: ['n', 'steps'],
        legend: [LG.mid, LG.range, LG.gone],
        callouts: [{ target: 'wide:mid', text: <>always check the <b>middle</b></>, dir: 'up' }],
        code: {
          title: 'binarySearch.js',
          lang: 'js',
          code: `
function binarySearch(sorted, target) {
  let lo = 0, hi = sorted.length - 1;
  while (lo <= hi) {
!    const mid = (lo + hi) >> 1;               // look in the middle
    if (sorted[mid] === target) return mid;
!    if (sorted[mid] < target) lo = mid + 1;   // drop the left half
!    else hi = mid - 1;                        // drop the right half
  }
  return -1;                                  // not there
}`,
        },
      },
      {
        id: 'how-many-halvings',
        title: 'Predict: a million items',
        cfg: { view: 'binary', binary: 'big' },
        predict: { kind: 'halving', needed: 2, prompt: 'How many steps does binary search need, at most?' },
        body: (
          <>
            <p>
              Thirty-two items took at most 6 steps. Now the sorted array holds <strong>1,000,000</strong> items, say every user of a mid-size app,
              sorted by ID.
            </p>
            <p>
              How many halvings does it take to get from a million down to one? Guess before the animation runs. The bar always shows just the range
              that&apos;s left, so every step looks like a zoom, and the ladder below records the sizes.
            </p>
            <p>Then try a billion.</p>
          </>
        ),
        hud: ['n', 'steps'],
        legend: [LG.range, LG.mid],
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'linear',
    title: 'Linear time',
    steps: [
      {
        id: 'linear-search',
        title: 'O(n): look at everything',
        cfg: { view: 'scan', scan: 'search' },
        body: (
          <>
            <p>
              Without sorted data there&apos;s no shortcut. To find 46 in an unsorted array you check items one by one until you hit it. That&apos;s a{' '}
              <strong>linear search</strong>, and it&apos;s exactly what <code>arr.includes(x)</code> and <code>arr.indexOf(x)</code> do under the hood.
            </p>
            <p>
              When the target is near the end, or missing, you touch all n items. Work that grows in step with n is <strong>linear time</strong>,{' '}
              <strong>O(n)</strong>. So is summing, copying, or finding the max.
            </p>
            <p>
              Linear is usually fine: a million items take about a millisecond. The trouble starts when one hides inside another loop. Call{' '}
              <code>includes</code> once per item and you&apos;ve written O(n²) without a nested loop in sight.
            </p>
            <p>
              If you look things up in the same data again and again, pay O(n) once to build a <code>Set</code>. After that, each{' '}
              <code>has()</code> is O(1) on average, the hash lookup from chapter 2.
            </p>
          </>
        ),
        hud: ['n', 'steps'],
        legend: [LG.current, LG.checked, LG.found],
        code: {
          title: 'search.js',
          lang: 'js',
          code: `
const ids = [17, 3, 88, 42, 9, 61, 25, 70, 5, 94, 33, 12, 58, 81, 46, 29];

!ids.includes(46);          // O(n): walks from index 0 until it finds 46
ids.indexOf(46);           // same walk, returns 14

const idSet = new Set(ids); // O(n), once
!idSet.has(46);             // O(1) on average, every time after`,
        },
      },
      {
        id: 'best-average-worst',
        title: 'Best, average and worst case',
        cfg: { view: 'scan', scan: 'cases' },
        body: (
          <>
            <p>
              The same search can be lucky or unlucky. If the target is the first item, it takes <strong>1 step</strong>, the <strong>best case</strong>.
              If it&apos;s missing, all <strong>n steps</strong>, the <strong>worst case</strong>. If it&apos;s at a random position, about{' '}
              <strong>n/2</strong> on average.
            </p>
            <p>
              Try all three below and watch the bars. The best case is O(1), but it promises nothing: you can&apos;t count on luck. The average, n/2, is
              still O(n) because halving is just a constant factor.
            </p>
            <p>
              So when people say &ldquo;linear search is O(n)&rdquo;, they mean the <strong>worst case</strong>, a bound that holds for every input.
              Unless someone says otherwise, a Big-O is a worst-case bound.
            </p>
            <Aside>
              Strictly, Big-O is an upper bound on a function, and best, average and worst case are three different functions you can bound. Engineers
              usually quote the worst case, and often say &ldquo;O&rdquo; when they mean &ldquo;grows exactly like&rdquo; (Big-Θ).
            </Aside>
          </>
        ),
        actions: {
          prompt: 'Search the same 16 numbers:',
          buttons: [
            { label: 'Best: first item', run: (s) => s.runCase('best'), after: <>One comparison. Nice, but you can&apos;t plan on it.</> },
            {
              label: 'Average: random item',
              run: (s) => s.runCase('avg'),
              after: <>Press it a few times. The average settles near (n + 1)/2 = 8.5 steps: half of n, still linear.</>,
            },
            { label: 'Worst: missing item', run: (s) => s.runCase('worst'), after: <>All 16 items checked before giving up. This is the case Big-O quotes.</> },
          ],
        },
        hud: ['n', 'steps'],
        legend: [LG.best, LG.avg, LG.worst],
        code: {
          title: 'cases.js',
          lang: 'js',
          code: `
!arr.indexOf(arr[0]);        // best case: 1 comparison
arr.indexOf(randomItem);    // average: about n/2
!arr.indexOf(-1);            // worst case: n comparisons, returns -1`,
        },
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'nlogn',
    title: 'Divide and conquer',
    steps: [
      {
        id: 'split-in-halves',
        title: 'Merge sort: split in half',
        cfg: { view: 'merge', merge: 'split', n: 16 },
        body: (
          <>
            <p>
              Sorting needs a new trick. <strong>Merge sort</strong> splits the array in half, then splits each half, and so on until every piece holds
              a single number. A piece of one is already sorted.
            </p>
            <p>
              How many rounds of splitting does that take? It&apos;s the same halving as binary search: 16 → 8 → 4 → 2 → 1, so{' '}
              <strong>log₂ 16 = 4 levels</strong> below the top. A million items would need about 20.
            </p>
            <p>Splitting is the easy part. The real work happens on the way back up.</p>
          </>
        ),
        hud: ['n', 'levels'],
        code: {
          title: 'mergeSort.js',
          lang: 'js',
          code: `
function mergeSort(arr) {
  if (arr.length <= 1) return arr;        // one item: already sorted
!  const mid = arr.length >> 1;
!  const left = mergeSort(arr.slice(0, mid));
!  const right = mergeSort(arr.slice(mid));
  return merge(left, right);              // next step
}`,
        },
      },
      {
        id: 'merge-back-up',
        title: 'Merge: n work per level',
        cfg: { view: 'merge', merge: 'merge', n: 16 },
        body: (
          <>
            <p>
              Now merge the pieces back up. Two sorted pieces merge like two sorted piles of cards: compare the two top cards, take the smaller one,
              repeat. Every item <strong>moves once per level</strong>.
            </p>
            <p>
              So each level costs about <strong>n</strong> moves, and there are <strong>log₂ n</strong> levels. Total: <strong>n × log n</strong>,
              written <strong>O(n log n)</strong>. Here that&apos;s 16 × 4 = 64 moves. For a million items it&apos;s about 20 million, where comparing
              every pair would take half a trillion.
            </p>
            <p>
              That&apos;s the speed limit for sorting by comparisons: none can beat n log n in the worst case. It&apos;s also what <code>arr.sort()</code>{' '}
              costs you.
            </p>
          </>
        ),
        toggle: {
          prompt: 'Change the array size:',
          initial: 2,
          options: [
            { label: 'n = 4', apply: (s) => s.setMergeN(4), note: <>2 levels × 4 moves = 8.</> },
            { label: 'n = 8', apply: (s) => s.setMergeN(8), note: <>3 levels × 8 moves = 24.</> },
            { label: 'n = 16', apply: (s) => s.setMergeN(16), note: <>4 levels × 16 moves = 64. Double n: twice the moves per level, plus one level.</> },
          ],
        },
        hud: ['n', 'moves'],
        legend: [LG.moving, LG.sorted],
        code: {
          title: 'merge.js',
          lang: 'js',
          code: `
function merge(a, b) {
  const out = [];
  let i = 0, j = 0;
!  while (i < a.length && j < b.length) {
!    out.push(a[i] <= b[j] ? a[i++] : b[j++]);   // take the smaller head
  }
  return out.concat(a.slice(i), b.slice(j));      // one side ran out
}

![5, 3, 9, 1].sort((x, y) => x - y);   // V8 uses TimSort: O(n log n)`,
        },
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'explode',
    title: 'When work explodes',
    steps: [
      {
        id: 'all-pairs',
        title: 'O(n²): every pair',
        cfg: { view: 'grid', n: 12 },
        body: (
          <>
            <p>
              Does an array contain a duplicate? The straightforward answer compares every item with every later item: a loop inside a loop. Each cell of
              the <Term k="grid">grid</Term> is one comparison, <code>arr[i] === arr[j]</code>.
            </p>
            <p>
              With n items that&apos;s n × (n − 1) / 2 comparisons, about <strong>n²/2</strong>. Drop the constant ½ and it&apos;s{' '}
              <strong>quadratic time</strong>, <strong>O(n²)</strong>. Bubble sort and insertion sort have the same shape.
            </p>
            <p>
              <strong>Drag the slider</strong>: double n and the comparisons roughly <strong>quadruple</strong>. At 1,000 items that&apos;s half a million
              comparisons; at a million, half a trillion.
            </p>
          </>
        ),
        slider: {
          label: 'Array size n',
          min: 2,
          max: 16,
          step: 1,
          set: (s, v) => s.setGridN(v),
          ends: ['2', '16'],
          stats: (s) => (
            <>
              <Stat label="comparisons" value={s.grid.total} />
              <Stat label="n²" value={s.grid.n * s.grid.n} />
            </>
          ),
        },
        quiz: {
          question: 'A loop over all n users, and inside it a loop over the 7 days of the week. What’s the Big-O?',
          options: [
            { text: 'O(n²)', why: 'Only if both loops grow with the input. The inner loop always runs 7 times, however many users there are.' },
            { text: 'O(7n)', why: 'That’s the right count, but Big-O drops constant factors, so it’s written O(n).' },
            { text: 'O(n)', correct: true, why: '7 × n steps. A nested loop is only quadratic when the inner loop also grows with n.' },
            { text: 'O(1)', why: 'The outer loop visits every user, so the work grows with n.' },
          ],
        },
        hud: ['n', 'cmp'],
        legend: [LG.compared, LG.iLoop, LG.jLoop],
        callouts: [{ target: 'wide:grid', text: <>one cell = <b>one comparison</b></>, dir: 'right' }],
        code: {
          title: 'hasDuplicate.js',
          lang: 'js',
          code: `
function hasDuplicate(arr) {
!  for (let i = 0; i < arr.length; i++) {
!    for (let j = i + 1; j < arr.length; j++) {   // every later item
      if (arr[i] === arr[j]) return true;
    }
  }
  return false;
}`,
        },
      },
      {
        id: 'exploding-calls',
        title: 'O(2ⁿ): the call tree explodes',
        cfg: { view: 'fib', n: 6, memo: false },
        body: (
          <>
            <p>
              Some code grows faster than any polynomial. The textbook Fibonacci function calls itself <strong>twice</strong>:{' '}
              <code>fib(n) = fib(n − 1) + fib(n − 2)</code>. Each of those calls makes two more, so the tree of calls nearly doubles with every level.
            </p>
            <p>
              Look at the <Term k="repeats">orange calls</Term>: <code>fib(3)</code> is computed 3 times, <code>fib(2)</code> 5 times. The function keeps
              redoing work it has already done.
            </p>
            <p>
              fib(6) makes 25 calls, fib(30) makes 2.7 million, fib(50) about 40 billion. Adding 1 to n multiplies the work by about 1.6. That&apos;s{' '}
              <strong>exponential time</strong>, bounded by <strong>O(2ⁿ)</strong>.
            </p>
            <Aside>
              The exact growth is φⁿ ≈ 1.618ⁿ (φ is the golden ratio), still exponential; 2ⁿ is the usual quick upper bound. Algorithms that try every
              subset of n items take exactly 2ⁿ steps.
            </Aside>
          </>
        ),
        slider: {
          label: 'fib(n)',
          min: 2,
          max: 6,
          step: 1,
          format: (v) => `fib(${v})`,
          set: (s, v) => s.setFibN(v),
          ends: ['2', '6'],
          stats: (s) => (
            <>
              <Stat label="calls" value={s.fib.nodes.length} />
              <Stat label="repeated" value={s.fib.wastedCount} bad={s.fib.wastedCount > 0} />
            </>
          ),
        },
        hud: ['n', 'calls'],
        legend: [LG.call, LG.repeat, LG.stack],
        code: {
          title: 'fib.js',
          lang: 'js',
          code: `
function fib(n) {
  if (n < 2) return n;
!  return fib(n - 1) + fib(n - 2);   // two calls, each making two more…
}

fib(30);   // ${commas(fibCalls(30))} calls
fib(50);   // ${commas(fibCalls(50))} calls: minutes, even on a fast machine`,
        },
      },
      {
        id: 'memoization',
        title: 'Memoize: remember answers',
        cfg: { view: 'fib', n: 6, memo: false, fast: true },
        body: (
          <>
            <p>
              The fix is to <strong>remember</strong> each answer the first time you compute it, and check that cache before computing again. This is{' '}
              <strong>memoization</strong>.
            </p>
            <p>
              <strong>Switch it on</strong> and watch the tree collapse. Every orange repeat becomes an instant <Term k="hits">cache hit</Term>, and the
              calls drop from 25 to 11. Memoized fib makes 2n − 1 calls: <strong>O(n)</strong> instead of exponential. fib(50) goes from 40 billion calls
              to 99.
            </p>
            <p>
              The price is memory: the cache keeps one answer per value of n. Trading space for time is one of the most common moves in performance work.
            </p>
          </>
        ),
        toggle: {
          prompt: 'How should fib run?',
          initial: 0,
          options: [
            { label: 'Plain recursion', apply: (s) => s.setMemo(false), note: <>25 calls, and the 17 orange ones redo work that was already done.</> },
            {
              label: 'With memoization',
              apply: (s) => s.setMemo(true),
              note: (
                <>
                  11 calls. Three cache hits replace all 17 repeated calls, because a hit returns at once and never makes the calls below it. At n =
                  50: {memoCalls(50)} calls instead of {fmtCountLg(Math.log10(fibCalls(50)))}.
                </>
              ),
            },
          ],
        },
        hud: ['n', 'calls'],
        legend: [LG.call, LG.hit, LG.repeat],
        code: {
          title: 'fibMemo.js',
          lang: 'js',
          code: `
const memo = new Map();
function fib(n) {
  if (n < 2) return n;
!  if (memo.has(n)) return memo.get(n);   // seen it? O(1)
  const v = fib(n - 1) + fib(n - 2);
!  memo.set(n, v);                        // remember it
  return v;
}
fib(50);   // 99 calls`,
        },
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'growth',
    title: 'Side by side',
    steps: [
      {
        id: 'double-the-input',
        title: 'Predict: double the input',
        cfg: { view: 'race', race: 'double' },
        predict: { kind: 'double', needed: 2, prompt: 'The input doubles from 16 to 32. How many steps will the highlighted lane take?' },
        body: (
          <>
            <p>
              Five algorithms race on the same machine at the same speed, one step per tick, on an input of <strong>n = 16</strong>. Every lane must reach
              its finish line, so lanes with more steps take longer.
            </p>
            <p>
              Next the input <strong>doubles</strong> to 32. Before the race runs, predict the new step counts. The dashed marker in each lane will show
              where the old finish line lands on the new track.
            </p>
            <p>
              This <strong>doubling test</strong> is a handy way to recognize a growth rate from measurements: time your code at n and at 2n, and look at
              the ratio.
            </p>
          </>
        ),
        hud: ['n'],
        legend: [LG.ghost],
      },
      {
        id: 'growth-chart',
        title: 'Plot the curves',
        cfg: { view: 'chart', chart: 'classes', n: 20, log: false },
        body: (
          <>
            <p>
              Plot steps against n for each class and the difference becomes a picture. At small n the curves bunch together. <strong>Drag n</strong> to
              the right and they tear apart: <Term k="curve:n2">n²</Term> shoots up, <Term k="curve:exp">2ⁿ</Term> leaves the chart almost immediately,
              while <Term k="curve:logn">log n</Term> and <Term k="curve:c1">1</Term> hug the floor.
            </p>
            <p>
              Past a few thousand, even <Term k="curve:nlogn">n log n</Term> looks flat next to n². Switch on the <strong>log scale</strong>, where every
              gridline is 10× the one below, to see all six at once.
            </p>
            <p>
              The readout converts steps to time at about <strong>1 nanosecond per step</strong>, the right ballpark for a simple operation on a modern
              CPU.
            </p>
          </>
        ),
        card: 'chart',
        hud: ['n'],
      },
      {
        id: 'a-million-items',
        title: 'A million items',
        cfg: { view: 'lapse', n: 1_000_000, lanes: ['c1', 'logn', 'n', 'nlogn', 'n2', 'exp'], loop: true },
        body: (
          <>
            <p>
              Make it concrete: one million items, one nanosecond per step. The playhead is the clock, on a log scale so a nanosecond and a billion years
              both fit.
            </p>
            <p>
              O(1) and O(log n) finish in nanoseconds. <Term k="lane:n">O(n)</Term> takes about <strong>1 millisecond</strong>,{' '}
              <Term k="lane:nlogn">O(n log n)</Term> about <strong>20 ms</strong>. <Term k="lane:n2">O(n²)</Term> needs a trillion steps: about{' '}
              <strong>17 minutes</strong>. <Term k="lane:exp">O(2ⁿ)</Term> needs a number of steps with 301,030 digits. It never finishes, not in the
              lifetime of the universe.
            </p>
            <p>
              That&apos;s why the growth rate beats any hardware upgrade. A 10× faster machine turns 17 minutes into 100 seconds. Switching from O(n²) to
              O(n log n) turns it into 20 milliseconds.
            </p>
            <Aside>
              Real steps cost anywhere from well under a nanosecond (adding two registers) to around 100 ns (a cache miss to main memory). The rankings
              don&apos;t change, only the absolute numbers.
            </Aside>
          </>
        ),
        hud: ['n', 'clock'],
        code: {
          title: 'a-million.js',
          lang: 'js',
          code: `
// n = 1,000,000 at about 1 ns per step
!n                 // 1,000,000 steps           ≈ 1 ms
!n * Math.log2(n)  // ≈ 20,000,000 steps        ≈ 20 ms
!n ** 2            // 1,000,000,000,000 steps   ≈ 17 min
2 ** n            // a 301,030-digit number     never`,
        },
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'rules',
    title: 'The rules of Big-O',
    steps: [
      {
        id: 'drop-the-constants',
        title: 'Drop constants and small terms',
        cfg: { view: 'chart', chart: 'rules', n: 10, log: false },
        body: (
          <>
            <p>
              Real step counts are messy, like <code>3n + 2</code> or <code>n² + 100n</code>. Big-O keeps only the part that dominates as n grows, and
              drops the rest.
            </p>
            <p>
              <strong>Drop lower-order terms.</strong> At n = 10, <Term k="curve:n2+100n">n² + 100n</Term> is 11 times <Term k="curve:n2">n²</Term>.{' '}
              <strong>Zoom out</strong> with the slider: at n = 10,000 the extra 100n adds just 1%, and the two curves merge. So n² + 100n is O(n²).
            </p>
            <p>
              <strong>Drop constant factors.</strong> <Term k="curve:3n">3n</Term> is always three times <Term k="curve:n">n</Term>, but both are straight
              lines of the same shape, and both flatten to nothing next to n². So 3n is O(n). That&apos;s also why the base of a log doesn&apos;t matter.
            </p>
          </>
        ),
        card: 'rules',
        quiz: {
          question: 'A function takes 3n² + 50n + 1,000 steps. What’s its Big-O?',
          options: [
            { text: 'O(3n²)', why: 'Right shape, but constant factors are dropped: O(n²).' },
            { text: 'O(n² + n)', why: 'The n term is lower-order. At large n it’s noise next to n², so it goes too.' },
            { text: 'O(n²)', correct: true, why: 'Keep the fastest-growing term and drop its constant. The 50n and the 1,000 vanish as n grows.' },
            { text: 'O(1,000)', why: 'The 1,000 is a constant: it matters at tiny n and not at all at large n.' },
          ],
        },
        hud: ['n'],
        legend: [LG.gap],
        code: {
          title: 'simplify.js',
          lang: 'js',
          code: `
for (const x of arr) {           // n times
!  sum += x; count++; last = x;    // 3 steps each → 3n → O(n)
}
for (const a of arr)             // n × n = n²
  for (const b of arr) pairs++;
!for (const x of arr) seen.add(x); // + n → n² + n → O(n²)`,
        },
      },
      {
        id: 'constants-still-matter',
        title: 'Predict: when constants win',
        cfg: { view: 'race', race: 'constants' },
        predict: { kind: 'constants', needed: 2, prompt: 'Which sort finishes first?' },
        body: (
          <>
            <p>
              Dropping constants is right for large n, but it is a simplification. Here are two real sorting algorithms on the same machine:{' '}
              <strong>insertion sort</strong>, O(n²), whose inner loop is tiny, and <strong>merge sort</strong>, O(n log n), which takes fewer steps but
              pays for recursion and copying on each one.
            </p>
            <p>
              Predict the winner at <strong>n = 8</strong>, then at <strong>n = 1,000</strong>.
            </p>
            <p>
              This is why real sorts are hybrids. V8 and CPython both use <strong>TimSort</strong>, which sorts short runs (up to 64 items) with insertion
              sort and then merges the runs.
            </p>
            <Aside>
              The costs here are illustrative: insertion sort ≈ n²/4 cheap steps, merge sort ≈ 3 × n log₂ n heavier ones. Real crossover points depend
              on the language and the machine. Measure before you optimize.
            </Aside>
          </>
        ),
        hud: ['n'],
      },
      {
        id: 'space-complexity',
        title: 'Space: memory grows too',
        cfg: { view: 'race', race: 'space', n: 12 },
        body: (
          <>
            <p>
              Big-O measures memory the same way. <strong>Space complexity</strong> counts the <em>extra</em> memory an algorithm needs as n grows, not
              counting the input itself.
            </p>
            <p>
              The <Term k="lane:nested">nested-loop</Term> duplicate check needs two counters, i and j, at any size: <strong>O(1) space</strong>, but
              O(n²) time. The <Term k="lane:set">Set version</Term> remembers every item it has seen: one pass, <strong>O(n) time</strong>, but also{' '}
              <strong>O(n) extra memory</strong>.
            </p>
            <p>
              Merge sort pays O(n) for its temporary arrays, recursion pays for its call stack, memoized fib for its cache. Trading memory for time is
              usually a good deal, until the memory runs out.
            </p>
          </>
        ),
        toggle: {
          prompt: 'How many items?',
          initial: 0,
          options: [
            { label: '12', apply: (s) => s.setSpaceN(12), note: <>66 comparisons against 24 Set operations.</> },
            {
              label: '1,000',
              apply: (s) => s.setSpaceN(1000),
              note: <>499,500 comparisons against 2,000 Set operations. The nested loops are still crawling.</>,
            },
            {
              label: '1,000,000',
              apply: (s) => s.setSpaceN(1_000_000),
              note: (
                <>
                  About <strong>500 billion</strong> comparisons, 8 minutes even at 1 ns each, against 2 million Set operations: a fraction of a second
                  even at 50 ns apiece. The Set holds a million entries to do it.
                </>
              ),
            },
          ],
        },
        hud: ['n'],
        code: {
          title: 'hasDuplicate.js',
          lang: 'js',
          code: `
function hasDuplicate(arr) {
!  const seen = new Set();            // O(n) extra memory
  for (const x of arr) {
!    if (seen.has(x)) return true;    // O(1) on average
    seen.add(x);
  }
  return false;
}
// same idea in one line:
new Set(arr).size !== arr.length;`,
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
        id: 'classify-the-code',
        title: 'Classify the code',
        cfg: { view: 'classify' },
        predict: { kind: 'classify', needed: 5, prompt: 'What’s the Big-O of the snippet on the stage?' },
        body: (
          <>
            <p>
              Time to read code the way Big-O does. Find what grows with n: a loop over the input is n, a loop inside a loop is n², a loop whose counter
              doubles or halves is log n, and a library call costs whatever it does inside.
            </p>
            <p>
              Loops in sequence <strong>add</strong>, nested loops <strong>multiply</strong>, and then you keep the biggest term. After each answer, the
              stage runs the doubling test on the snippet.
            </p>
          </>
        ),
      },
      {
        id: 'cheat-sheet',
        title: 'Cheat sheet',
        cfg: { view: 'chart', chart: 'cheat', n: 1_000_000, log: true },
        body: <p>All six growth rates on one log-log chart, and what each one costs at a million items.</p>,
        cheat: true,
      },
      {
        id: 'playground',
        title: 'Playground',
        cfg: { view: 'lapse', n: 20, lanes: ['n', 'nlogn', 'n2', 'exp'], loop: false },
        body: (
          <p>
            Race any growth rates on any input size. Pick the racers and an n, and the clock restarts from a nanosecond. Then try the challenges.
          </p>
        ),
        card: 'playground',
        hud: ['n', 'clock'],
      },
    ],
  },
];
