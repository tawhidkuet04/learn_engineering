import { Aside } from '@/components/lesson/Prose';
import { Term } from '@/components/lesson/Term';
import type { LegendItem } from '@/components/stage/chrome';
import { SIG } from '@/lib/sim/colors';
import type { Chapter } from './types';

export const META = { slug: 'cpu-caches', code: 'CS-06', track: 'Computer science', title: 'CPU Caches' };

const LG: Record<string, LegendItem> = {
  req: { label: 'load request', color: SIG.req },
  data: { label: 'data coming back', color: SIG.res },
  cursor: { label: 'current load', color: SIG.warn, shape: 'square' },
  fill: { label: 'line fill (64 B)', color: SIG.res, shape: 'square' },
  pf: { label: 'prefetched line', color: SIG.hc, shape: 'square' },
  inL1: { label: 'line in L1', color: SIG.res, shape: 'ring' },
  evict: { label: 'evicted', color: SIG.err, shape: 'ring' },
  ctrl: { label: 'coherence message', color: SIG.hc },
  write: { label: 'write', color: SIG.heavy },
  rfo: { label: 'ownership request', color: SIG.hc },
  line: { label: 'line transfer', color: SIG.res },
};

export const CHAPTERS: Chapter[] = [
  /* ================================================================ */
  {
    id: 'memory-wall',
    title: 'The memory wall',
    cfg: { view: 'wall' },
    steps: [
      {
        id: 'a-fast-core-a-slow-memory',
        title: 'A fast core, a slow memory',
        cfg: { cache: false },
        body: (
          <>
            <p>
              A CPU <Term k="core">core</Term> is absurdly fast. At 4 GHz its clock ticks every quarter of a nanosecond, and a modern core can finish
              several instructions on every tick.
            </p>
            <p>
              Main memory is not. <Term k="ram">RAM</Term>, the DRAM chips on a separate stick, takes roughly <strong>80–100 ns</strong> to answer a
              request. That&apos;s about <strong>400 clock cycles</strong>, time in which the core could have run over a thousand instructions.
            </p>
            <p>
              Watch the core walk a <strong>linked list</strong>. Each node sits somewhere random in memory, and the core can&apos;t ask for the next
              node until the current one arrives, because that&apos;s where the next address is written. The gauge counts the cycles it spends waiting.
            </p>
            <Aside>
              Real cores don&apos;t just sit there: out-of-order execution keeps several loads in flight at once. But in a linked list every address
              comes out of the previous load, so there&apos;s nothing to overlap.
            </Aside>
          </>
        ),
        hud: ['cycles', 'waiting', 'pass'],
        legend: [LG.req, LG.data],
        callouts: [{ target: 'wide:ram', text: <>about <b>100 ns</b> for every request</>, dir: 'down' }],
        code: {
          title: 'list.c',
          lang: 'c',
          code: `
struct node { long value; struct node *next; };

long sum = 0;
for (struct node *p = head; p != NULL; p = p->next)
!    sum += p->value;   // the next address is inside *p`,
          note: 'The add takes one cycle. The load that feeds it can take four hundred.',
        },
      },
      {
        id: 'keep-a-copy-close',
        title: 'Keep a copy close by',
        cfg: { cache: true },
        body: (
          <>
            <p>
              The fix is as old as computing: keep copies of recently used data in a small, fast memory right next to the core. That&apos;s a{' '}
              <Term k="cache">cache</Term>. It&apos;s built from SRAM, which answers in about a nanosecond but costs far more per byte than DRAM, so
              it&apos;s small.
            </p>
            <p>
              Every load checks the cache first. If the data is there, that&apos;s a <strong>hit</strong> and the answer comes straight back. If not,
              it&apos;s a <strong>miss</strong>: the request carries on to RAM, and a copy is kept on the way back, betting you&apos;ll want it again.
            </p>
            <p>
              Here the program walks the same list twice. The first walk misses on every node. The second finds every node already cached and finishes
              about <strong>100× faster</strong>.
            </p>
          </>
        ),
        hud: ['passes', 'cycles'],
        legend: [LG.req, LG.data],
        callouts: [{ target: 'wide:cache', text: <>the cache: <b>~1 ns</b> away</>, dir: 'up' }],
        code: {
          title: 'list.c',
          lang: 'c',
          code: `
for (int pass = 0; pass < 2; pass++)
    for (struct node *p = head; p; p = p->next)
!        sum += p->value;   // pass 2: every node is already cached`,
        },
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'hierarchy',
    title: 'The memory hierarchy',
    cfg: { view: 'ladder' },
    steps: [
      {
        id: 'l1-l2-l3',
        title: 'L1, L2, L3: a ladder of caches',
        body: (
          <>
            <p>
              One cache can&apos;t be both big and fast. The bigger a memory is, the longer its wires and the slower its lookups. So CPUs stack
              several levels, each bigger and slower than the one before.
            </p>
            <p>
              <Term k="l1">L1</Term> sits inside each core: 32–64 KB, about 1 ns. <Term k="l2">L2</Term> is per core too: 1–2 MB, 3–5 ns.{' '}
              <Term k="l3">L3</Term> is shared by all the cores: tens of MB, 10–20 ns. Only a load that misses all three goes out to{' '}
              <Term k="ram">RAM</Term>.
            </p>
            <p>
              The stage is drawn <strong>to scale</strong>: each level&apos;s distance from the core is proportional to its latency. The caches huddle
              against the core, and RAM is a long way off.
            </p>
            <Aside>
              Each core really has two L1s, one for instructions (L1i) and one for data (L1d). We only draw the data side. Registers, the core&apos;s
              own scratch space, are faster still.
            </Aside>
          </>
        ),
        hud: ['last'],
        legend: [LG.req, LG.data],
        callouts: [{ target: 'wide:ram', text: <>RAM is <b>100× farther</b> than L1</>, dir: 'down' }],
        code: {
          title: 'terminal',
          lang: 'shell',
          code: `
$ lscpu | grep -i cache    # 8-core Ryzen 7 7700X
!L1d cache:  256 KiB (8 instances)   # 32 KiB per core
L1i cache:  256 KiB (8 instances)
L2 cache:   8 MiB (8 instances)     # 1 MiB per core
!L3 cache:   32 MiB (1 instance)     # shared by all 8`,
        },
      },
      {
        id: 'if-l1-took-a-second',
        title: 'If an L1 hit took one second',
        cfg: { human: true },
        body: (
          <>
            <p>Nanoseconds are hard to feel, so stretch time by a factor of a billion: pretend every nanosecond takes a whole second.</p>
            <p>
              An <strong>L1 hit</strong> is 1 second, a glance at your desk. <strong>L2</strong> takes 4 seconds and <strong>L3</strong> 15. A trip to{' '}
              <strong>RAM</strong> takes nearly <strong>2 minutes</strong>. An <strong>SSD read</strong> takes more than a day, and a round trip to
              another server in the same datacenter about a week.
            </p>
            <p>Your turn: send a load to each level and watch the stopwatch.</p>
            <Aside>At this stage&apos;s scale, an SSD would sit tens of meters past the right edge of your screen.</Aside>
          </>
        ),
        actions: {
          kicker: 'Try it',
          prompt: 'Load a value that lives in…',
          buttons: [
            { label: 'L1', run: (s) => s.loadFrom('l1') },
            { label: 'L2', run: (s) => s.loadFrom('l2') },
            { label: 'L3', run: (s) => s.loadFrom('l3') },
            {
              label: 'RAM',
              run: (s) => s.loadFrom('ram'),
              after: (
                <>
                  <strong>1 min 40 s</strong> on the human clock. A program that misses to RAM on every load spends almost all of its time waiting.
                </>
              ),
            },
          ],
        },
        hud: ['stopwatch', 'last'],
        side: ['human'],
        legend: [LG.req, LG.data],
        quiz: {
          question: 'A loop does 50 loads that hit L1 and 1 load that goes to RAM. Where does most of its time go?',
          options: [
            { text: 'The 50 L1 hits', why: '50 hits at about 1 ns each is 50 ns. The single miss alone costs about 100 ns.' },
            { text: 'The one trip to RAM', correct: true, why: 'About 100 ns for the miss against 50 ns for all the hits together. Misses dominate, which is why hit rate matters so much.' },
            { text: 'They cost about the same', why: 'Not quite: the one miss (≈100 ns) costs about twice as much as all 50 hits (≈50 ns).' },
          ],
        },
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'cache-lines',
    title: 'Cache lines',
    cfg: { view: 'grid', dims: 1, ways: 4, pace: 'slow' },
    steps: [
      {
        id: '64-byte-lines',
        title: 'Memory moves in 64-byte lines',
        cfg: { order: 'row' },
        body: (
          <>
            <p>
              Caches don&apos;t fetch single values. Memory is carved into 64-byte blocks called <strong>cache lines</strong>, and every level of the
              hierarchy moves whole lines.
            </p>
            <p>
              Here&apos;s an array of 128 <code>long</code>s, 8 bytes each, so each outlined line holds 8 of them. The loop reads them in order. The
              first load, <code>a[0]</code>, misses and brings in the whole line, <code>a[0]</code> to <code>a[7]</code>. The next seven loads are
              hits. Then <code>a[8]</code> starts a new line and misses again.
            </p>
            <p>
              That&apos;s 1 miss for every 8 loads. Our toy <Term k="l1">L1</Term> holds just 4 lines, so once it&apos;s full, the least recently
              used line makes room for the next one.
            </p>
            <Aside>
              A real L1 holds 512 to 1,024 lines. Lines are 64 bytes on virtually every x86 chip and most ARM ones; Apple&apos;s M-series use 128.
            </Aside>
          </>
        ),
        hud: ['hits', 'misses', 'rate', 'time'],
        side: ['access'],
        strip: 'access',
        legend: [LG.cursor, LG.req, LG.fill],
        callouts: [{ target: 'wide:slots', text: <>4 slots, each one <b>whole line</b></>, dir: 'down' }],
        code: {
          title: 'lines.c',
          lang: 'c',
          code: `
long a[128];                    // 8 bytes each: 8 per line

uintptr_t addr = (uintptr_t)&a[i];
!uintptr_t line = addr & ~63;   // start of its 64-byte line
!uintptr_t off  = addr & 63;    // position inside the line`,
        },
        code2: {
          title: 'terminal',
          lang: 'shell',
          code: `
$ getconf LEVEL1_DCACHE_LINESIZE    # Linux, x86
!64
$ sysctl -n hw.cachelinesize        # macOS, Apple silicon
!128`,
        },
      },
      {
        id: 'hit-or-miss',
        title: 'Hit or miss?',
        cfg: { order: 'quiz' },
        predict: { kind: 'grid', needed: 3, prompt: 'Is the line holding this value already in L1?' },
        body: (
          <>
            <p>
              Your turn. The program now jumps around the array. Before each interesting load the animation stops: is its line already in{' '}
              <Term k="l1">L1</Term>?
            </p>
            <p>
              Lines in the cache are outlined green in RAM and listed in the L1. Watch the <strong>next out</strong> tag: when all 4 slots are full, a
              miss evicts the least recently used line to make room.
            </p>
          </>
        ),
        hud: ['hits', 'misses', 'rate'],
        side: ['access'],
        strip: 'access',
        legend: [LG.cursor, LG.inL1, LG.evict],
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'locality',
    title: 'Locality',
    cfg: { view: 'grid', dims: 1, ways: 4 },
    steps: [
      {
        id: 'two-kinds-of-locality',
        title: 'Two kinds of locality',
        cfg: { order: 'row', pace: 'tutorial', code: true },
        body: (
          <>
            <p>
              Caches work because programs are predictable. They show <strong>locality</strong>, in two flavours.
            </p>
            <p>
              <strong>Spatial locality:</strong> touch an address and you&apos;ll probably touch its neighbours soon. Walking an array does this, and
              lines reward it: 7 of every 8 loads hit.
            </p>
            <p>
              <strong>Temporal locality:</strong> touch something and you&apos;ll probably touch it again soon. A hot counter or a small lookup table
              stays cached, so after the first miss it&apos;s all hits.
            </p>
            <p>Random access over a big array has neither. It only hits when it happens to land on a line that&apos;s already cached.</p>
          </>
        ),
        toggle: {
          prompt: 'Pick an access pattern and watch the hit rate:',
          initial: 0,
          options: [
            { label: 'Sequential', apply: (s) => s.setOrder('row'), note: <>1 miss, then 7 hits, line after line: <strong>87.5%</strong>. Spatial locality.</> },
            {
              label: 'Same few values',
              apply: (s) => s.setOrder('reuse'),
              note: <>4 misses to warm up, then every load hits. <strong>Temporal locality.</strong></>,
            },
            {
              label: 'Random',
              apply: (s) => s.setOrder('random'),
              note: (
                <>
                  About <strong>1 load in 4</strong> hits, because 4 of the 16 lines fit in the cache. On an array far bigger than the cache it would be
                  close to 0%.
                </>
              ),
            },
          ],
        },
        hud: ['hits', 'misses', 'rate', 'nspa'],
        strip: null,
        legend: [LG.cursor, LG.fill, LG.inL1],
        code: {
          title: 'patterns.c',
          lang: 'c',
          code: `
// spatial: neighbours, one after another
for (int i = 0; i < n; i++) sum += a[i];

// temporal: the same few values, again and again
for (int i = 0; i < n; i++) sum += table[i & 3];

// neither: somewhere new every time
for (int i = 0; i < n; i++) sum += a[rand() % n];`,
        },
      },
      {
        id: 'the-prefetcher',
        title: 'The prefetcher reads ahead',
        cfg: { order: 'row', pace: 'true', prefetch: false },
        body: (
          <>
            <p>
              Even at 1 miss per 8 loads, a sequential loop still waits a full trip to RAM at the start of every line. So the hardware plays detective.
            </p>
            <p>
              The <strong>prefetcher</strong> watches the addresses you load. When it sees you walk line after line, it requests the next lines{' '}
              <em>before</em> you ask for them (the violet fills), so they&apos;re already arriving when the loop gets there.
            </p>
            <p>
              This step runs at <strong>real proportions</strong>: a hit takes 1 ns of screen time and a trip to RAM takes 100 times as long. Turn the
              prefetcher on and compare the time.
            </p>
            <Aside>
              Real prefetchers track many streams at once, spot constant strides, and run 10–20 lines ahead, so a sequential loop runs at close to full
              memory bandwidth. They stop at 4 KB page boundaries, and they can&apos;t guess where a linked list or a hash table goes next.
            </Aside>
          </>
        ),
        toggle: {
          prompt: 'Flip the prefetcher:',
          initial: 0,
          options: [
            { label: 'Prefetcher off', apply: (s) => s.setPrefetch(false), note: <>Every new line stalls for a full 100 ns: about <strong>1,700 ns</strong> per pass.</> },
            {
              label: 'Prefetcher on',
              apply: (s) => s.setPrefetch(true),
              note: (
                <>
                  After two misses it spots the stream and runs ahead. Lines arrive early or partway there, and the pass takes about{' '}
                  <strong>half the time</strong>.
                </>
              ),
            },
          ],
        },
        hud: ['misses', 'pf', 'time', 'nspa'],
        side: ['pf'],
        strip: 'pf',
        legend: [LG.cursor, LG.fill, LG.pf],
        code: {
          title: 'prefetch.c',
          lang: 'c',
          code: `
for (int i = 0; i < n; i++) {
!    __builtin_prefetch(&a[i + 32]);   // GCC/Clang: "I'll need this soon"
    sum += a[i];
}`,
          note: 'You rarely need to write this: the hardware already prefetches simple loops. It helps when the pattern is predictable to you but not to the CPU.',
        },
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'rows-vs-columns',
    title: 'Rows vs columns',
    cfg: { view: 'grid', dims: 2, ways: 4 },
    steps: [
      {
        id: 'row-major',
        title: 'How C stores a 2D array',
        cfg: { order: 'row', pace: 'tutorial', code: true },
        body: (
          <>
            <p>
              Memory is one long strip of bytes, so a 2D array has to be flattened. C stores it <strong>row-major</strong>: all of row 0, then all of
              row 1, and so on. <code>a[i][j]</code> lives at <code>base + (i × 16 + j) × 8</code>.
            </p>
            <p>
              The grid is the same memory as before, labelled by row <code>i</code> and column <code>j</code>. Each row is 128 bytes, exactly 2
              lines, and <code>a[0][15]</code> sits right next to <code>a[1][0]</code>.
            </p>
            <p>
              The classic loop runs <code>i</code> outside and <code>j</code> inside, so it reads memory in order: 1 miss, then 7 hits, line after
              line.
            </p>
            <Aside>
              C, C++, Rust, Go and NumPy (by default) are row-major. Fortran, MATLAB, Julia and R are column-major, so there the fast loop order is the
              other way round.
            </Aside>
          </>
        ),
        hud: ['hits', 'misses', 'rate', 'time'],
        side: ['access'],
        strip: 'access',
        legend: [LG.cursor, LG.fill, LG.inL1],
        callouts: [{ target: 'wide:row:7', text: <>each row: <b>128 bytes</b>, 2 lines</>, dir: 'down' }],
        code: {
          title: 'sum_rows.c',
          lang: 'c',
          code: `
long a[8][16];                     // 8 rows of 16, row after row

for (int i = 0; i < 8; i++)        // rows outside
!    for (int j = 0; j < 16; j++)   // columns inside: neighbours
        sum += a[i][j];`,
        },
      },
      {
        id: 'column-by-column',
        title: 'Walking down a column',
        cfg: { order: 'colquiz', pace: 'slow', code: true },
        predict: { kind: 'grid', needed: 2, prompt: 'Is the line holding this value already in L1?' },
        body: (
          <>
            <p>
              Now swap the loops: <code>j</code> outside, <code>i</code> inside. Same array, same additions, same answer. But each load now jumps a
              whole row ahead, 16 × 8 = <strong>128 bytes</strong>, two lines further on.
            </p>
            <p>
              Predict the loads as they come. Watch the L1 closely when the walk wraps around to <code>a[0][1]</code>: its line was loaded just eight
              loads earlier.
            </p>
          </>
        ),
        hud: ['hits', 'misses', 'rate', 'time'],
        side: ['access'],
        strip: 'access',
        legend: [LG.cursor, LG.inL1, LG.evict],
        code: {
          title: 'sum_cols.c',
          lang: 'c',
          code: `
for (int j = 0; j < 16; j++)       // columns outside
!    for (int i = 0; i < 8; i++)    // rows inside: 128 bytes apart
        sum += a[i][j];`,
        },
      },
      {
        id: 'the-race',
        title: 'Race: rows against columns',
        cfg: { view: 'race', order: 'row', orderB: 'col', pace: 'true' },
        body: (
          <>
            <p>
              Two cores run the two loops over identical arrays: 128 loads and 128 additions each. This time the animation runs at{' '}
              <strong>real proportions</strong>, so a hit takes 1 ns of screen time and a miss 100 times as long.
            </p>
            <p>
              Row order pays one miss per line and uses all 8 values it fetched. Column order uses one value from each line, and by the time it comes
              back for the other seven, the line has been evicted. <strong>Every single load misses.</strong>
            </p>
            <p>
              That&apos;s 7.5× slower here. On real hardware, summing a big matrix column by column is typically 3–10× slower, and worse as it grows.
            </p>
            <Aside>
              Stride prefetchers can spot a constant jump like this, but they won&apos;t cross a 4 KB page and they can&apos;t change the arithmetic:
              the column walk still fetches 8 bytes for every one it uses.
            </Aside>
          </>
        ),
        actions: {
          kicker: 'Try it',
          buttons: [
            { label: 'Race again', icon: 'replay', run: (s) => s.restartPass() },
            {
              label: 'Race with the prefetcher on',
              icon: 'bolt',
              run: (s) => s.setPrefetch(true),
              after: <>Row order gets faster still. Column order doesn&apos;t move: it never walks two neighbouring lines in a row.</>,
            },
          ],
        },
        hud: ['rows', 'cols', 'ratio'],
        legend: [LG.cursor, LG.fill],
        code: {
          title: 'terminal',
          lang: 'shell',
          code: `
$ perf stat -e L1-dcache-load-misses ./sum_rows
!   16,834,207  L1-dcache-load-misses
       0.086 s  elapsed
$ perf stat -e L1-dcache-load-misses ./sum_cols
!  265,410,322  L1-dcache-load-misses
       0.591 s  elapsed`,
          note: 'Illustrative numbers for summing a 16,384 × 16,384 int array (1 GiB). Yours will differ; the ratio won’t by much.',
        },
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'capacity',
    title: 'When data doesn’t fit',
    steps: [
      {
        id: 'the-capacity-cliff',
        title: 'Falling off the cliff',
        cfg: { view: 'cliff', ws: 16 * 1024 },
        body: (
          <>
            <p>
              A cache can only keep what fits. The data a loop keeps coming back to is its <strong>working set</strong>, and what matters is the
              smallest level it fits in.
            </p>
            <p>
              Here a loop reads random elements of an array, over and over. Drag the slider to grow the array. While it fits in{' '}
              <Term k="l1">L1</Term>, loads take about 1 ns. Past 32 KB they spill to <Term k="l2">L2</Term>, past 1 MB to <Term k="l3">L3</Term>,
              and past 32 MB almost every load goes out to <Term k="ram">RAM</Term>.
            </p>
            <p>
              Each step down is a <strong>cliff</strong>: the same code, several times slower, only because there&apos;s more data.
            </p>
            <Aside>
              A model of a typical desktop core, not a measurement. Real curves have softer edges, and past a few hundred MB they climb above 100 ns as
              the TLB, the cache for address translations, runs out too.
            </Aside>
          </>
        ),
        wsSlider: true,
        hud: ['ws', 'avg', 'fits'],
        strip: 'mix',
        legend: [LG.req, LG.data],
        code: {
          title: 'chase.c',
          lang: 'c',
          code: `
// A random cycle through \`size\` bytes. Every load depends on
// the one before, so nothing can hide the latency.
for (long i = 0; i < 100000000; i++)
!    p = *(void **)p;`,
        },
        code2: {
          title: 'terminal',
          lang: 'shell',
          code: `
$ perf stat -e cache-references,cache-misses ./chase 4M
!      942,613  cache-misses   #  0.9 % of all cache refs
$ perf stat -e cache-references,cache-misses ./chase 256M
!   94,280,352  cache-misses   # 92.6 % of all cache refs`,
          note: 'These events count the last-level cache: 4 MB fits in a 32 MB L3, 256 MB doesn’t. Illustrative numbers.',
        },
      },
      {
        id: 'tiles',
        title: 'Tiles: shrink the working set',
        cfg: { view: 'grid', dims: 2, order: 'col', pace: 'true', ways: 4, code: true },
        body: (
          <>
            <p>
              Sometimes you can&apos;t pick the order. A matrix transpose reads one array by rows and writes the other by columns, and matrix
              multiplication walks one of its inputs down the columns.
            </p>
            <p>
              Then shrink the working set instead. <strong>Tiling</strong>, also called blocking, works through the array in small blocks. Here a tile
              is 4 rows tall, so a column walk inside it touches just 4 lines, exactly what the toy L1 holds. The loop is still column by column, but
              every line gets fully used before it&apos;s evicted.
            </p>
            <p>Switch between the two and compare the misses.</p>
            <Aside>
              Real code sizes tiles to fit L1 or L2, often 32×32 or 64×64 elements, and tuned math libraries such as BLAS tile for every level of the
              hierarchy.
            </Aside>
          </>
        ),
        toggle: {
          prompt: 'Same column-by-column loop, two shapes:',
          initial: 0,
          options: [
            { label: 'Plain columns', apply: (s) => s.setOrder('col'), note: <>8 lines per column, 4 slots: every load misses.</> },
            {
              label: '4-row tiles',
              apply: (s) => s.setOrder('tile'),
              note: (
                <>
                  4 lines per tile column: they all fit, so it&apos;s <strong>1 miss per line</strong>, as good as row order.
                </>
              ),
            },
          ],
        },
        hud: ['hits', 'misses', 'rate', 'time'],
        side: ['access'],
        strip: 'access',
        legend: [LG.cursor, LG.fill, LG.inL1],
        code: {
          title: 'tiled.c',
          lang: 'c',
          code: `
for (int ii = 0; ii < 8; ii += 4)            // one tile of 4 rows
    for (int j = 0; j < 16; j++)             // walk its columns
!        for (int i = ii; i < ii + 4; i++)    // 4 lines: fits in L1
            sum += a[i][j];`,
        },
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'multicore',
    title: 'Many cores',
    cfg: { view: 'cores' },
    steps: [
      {
        id: 'coherence',
        title: 'Private caches, shared data',
        cfg: { cores: 'coherence' },
        body: (
          <>
            <p>
              Each core has its own <Term k="l1">L1</Term> and L2, and they all share the <Term k="l3">L3</Term>. So one line can have several copies.
              What happens when one core writes?
            </p>
            <p>
              A <strong>cache coherence</strong> protocol keeps the copies consistent. The classic one is <strong>MESI</strong>: every cached line is
              Modified, Exclusive, Shared or Invalid. Any number of cores may hold a line to read it, but a core that wants to write must first make
              every other copy <strong>invalid</strong>.
            </p>
            <p>
              Follow the variable <code>x</code>: two reads, a write, and a read that has to fetch the new value from the other core&apos;s cache.
            </p>
            <Aside>
              Intel uses a variant called MESIF and AMD uses MOESI. The extra states let caches share dirty data without writing it back to RAM first,
              but the rule is the same: one writer, or many readers.
            </Aside>
          </>
        ),
        side: ['mesi'],
        strip: 'mesi',
        legend: [LG.req, LG.data, LG.ctrl, LG.write],
        quiz: {
          question: 'Core 0 holds x in state M (modified). What’s true about x in RAM?',
          options: [
            {
              text: 'RAM already has the new value',
              why: 'Not yet. Caches are write-back: the new value lives only in core 0’s cache until the line is evicted or another core asks for it.',
            },
            {
              text: 'RAM is stale, and core 0 has the only valid copy',
              correct: true,
              why: 'Exactly. M means this cache holds the one up-to-date copy, so it must hand the line over before anyone else can read x.',
            },
            {
              text: 'Core 1 still has a valid copy',
              why: 'No. Before core 0 could write, every other copy was invalidated. That’s what makes the write safe.',
            },
          ],
        },
      },
      {
        id: 'false-sharing',
        title: 'False sharing',
        cfg: { cores: 'packed' },
        predict: { kind: 'fs', needed: 2, prompt: 'Two threads, two different counters, one cache line.' },
        body: (
          <>
            <p>
              Now two threads count things. Thread 0 on <Term k="core">core 0</Term> increments <code>a</code>; thread 1 on{' '}
              <Term k="core:1">core 1</Term> increments <code>b</code>. Neither ever touches the other&apos;s variable, so there&apos;s nothing to
              coordinate. Right?
            </p>
            <p>
              But <code>a</code> and <code>b</code> sit next to each other in memory, in the <strong>same 64-byte line</strong>, and coherence works on
              lines, not variables. Each write needs the line exclusively, so it <strong>ping-pongs</strong> between the two L1s, and each trip across
              the chip costs roughly 40–100 ns.
            </p>
            <p>
              That&apos;s <strong>false sharing</strong>: the threads share a line, not data. Predict what each write does.
            </p>
          </>
        ),
        hud: ['incA', 'incB', 'xfers', 'nsinc'],
        legend: [LG.rfo, LG.line],
        code: {
          title: 'counters.c',
          lang: 'c',
          code: `
struct {
    _Atomic long a;   // written only by thread 0
!    _Atomic long b;   // written only by thread 1: same line as a
} counters;

// thread 0:  while (running) counters.a++;
// thread 1:  while (running) counters.b++;`,
        },
      },
      {
        id: 'pad-it',
        title: 'Give each counter its own line',
        cfg: { cores: 'packed' },
        body: (
          <>
            <p>
              The fix: put the counters on <strong>different lines</strong>. Align each one to 64 bytes so it fills a line of its own. That wastes 56
              bytes per counter, and it&apos;s worth it.
            </p>
            <p>
              Switch to padded. Each core keeps its own line in the Modified state for good. No invalidations, no transfers: every increment is an L1
              hit, around 1 ns.
            </p>
            <p>
              False sharing is easy to miss because the code looks perfectly parallel. <code>perf c2c</code> finds it by reporting lines that bounce
              between cores.
            </p>
            <Aside>
              Some Intel chips fetch lines in adjacent pairs, which is why some libraries pad to 128 bytes. C++17 names the right distance{' '}
              <code>std::hardware_destructive_interference_size</code>.
            </Aside>
          </>
        ),
        toggle: {
          prompt: 'Lay out the two counters:',
          initial: 0,
          options: [
            { label: 'Packed: one line', apply: (s) => s.setCores('packed'), note: <>The line crosses the chip after every burst of writes.</> },
            {
              label: 'Padded: a line each',
              apply: (s) => s.setCores('padded'),
              note: (
                <>
                  Both counters race ahead at L1 speed, about <strong>10× faster</strong> each in this model.
                </>
              ),
            },
          ],
        },
        hud: ['incA', 'incB', 'xfers', 'nsinc'],
        legend: [LG.rfo, LG.line],
        code: {
          title: 'counters.cpp',
          lang: 'c',
          code: `
!struct alignas(64) Counter {   // each counter starts a new line
    std::atomic<long> value;    // 8 bytes used, 56 bytes padding
};

Counter counters[2];            // 64 bytes apart: no false sharing`,
        },
        code2: {
          title: 'terminal',
          lang: 'shell',
          code: `
$ perf c2c record ./counters
$ perf c2c report --stdio
# top of the list: the line holding a and b, with
# thousands of HITM loads (hits on a line that
# another core had modified)`,
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
        cfg: { view: 'ladder', human: true },
        body: (
          <p>
            Everything in one place. The numbers are rounded for a typical desktop chip. The ratios are what matter, and they&apos;ve held for decades.
          </p>
        ),
        cheat: true,
        hud: ['last', 'stopwatch'],
        side: ['human'],
        legend: [LG.req, LG.data],
      },
      {
        id: 'playground',
        title: 'Playground',
        cfg: { view: 'grid', dims: 2, order: 'col', pace: 'true', ways: 4, prefetch: false, code: true },
        body: (
          <p>
            All the pieces in one sandbox. Pick an access pattern, resize the L1, flip the prefetcher, and watch the misses. Each challenge is checked
            at the end of a full pass; <strong>Finish this pass now</strong> skips ahead.
          </p>
        ),
        playground: true,
        hud: ['hits', 'misses', 'rate', 'time'],
        side: ['access'],
        strip: 'access',
        legend: [LG.cursor, LG.fill, LG.pf, LG.inL1],
      },
    ],
  },
];
