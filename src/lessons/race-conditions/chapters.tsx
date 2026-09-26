import type { ReactNode } from 'react';
import type { CodeSpec } from '@/components/lesson/CodeBlock';
import type { LessonMeta } from '@/components/lesson/LessonStage';
import { Aside } from '@/components/lesson/Prose';
import type { QuizSpec } from '@/components/lesson/QuizCard';
import { Term } from '@/components/lesson/Term';
import type { HudKey, StepCallout } from './Overlay';
import type { RaceCfg } from './sim';

export const META: LessonMeta = { slug: 'race-conditions', code: 'CS-07', track: 'Computer science', title: 'Race Conditions & Locks' };

export type PanelKind = 'predict-count' | 'predict-lock' | 'scheduler' | 'scheduler-lock' | 'run' | 'run-compare' | 'deadlock' | 'seat' | 'bank' | 'cheatsheet' | 'playground';
export type LegendKey = 'A' | 'B' | 'lost' | 'lock' | 'atomic' | 'held' | 'waits' | 'money' | 'alice' | 'bob' | 'atm' | 'app';

export interface Step {
  id: string;
  title: string;
  body: ReactNode;
  cfg: RaceCfg;
  panel?: PanelKind;
  callouts?: StepCallout[];
  hud?: HudKey[];
  legend?: LegendKey[];
  code?: CodeSpec[];
  quiz?: QuizSpec;
  /** Side note shown after the interaction card, so the card stays above the fold */
  aside?: ReactNode;
}

export interface Chapter {
  id: string;
  title: string;
  steps: Step[];
}

const LOAD = <strong style={{ color: 'var(--sig-req)' }}>LOAD</strong>;
const STORE = <strong style={{ color: 'var(--sig-heavy)' }}>STORE</strong>;

export const CHAPTERS: Chapter[] = [
  /* ================================================================ */
  {
    id: 'one-line',
    title: 'One line, three steps',
    steps: [
      {
        id: 'two-threads',
        title: 'Two threads, one counter',
        cfg: { scene: 'counter', counter: 'naive', mode: 'plan', plan: ['A', 'B'], loop: true, timeline: true },
        body: (
          <>
            <p>
              A <strong>thread</strong> is one path of execution through a program. A program can run many threads at once, and they all share the same
              memory. That sharing makes threads fast and cheap to coordinate. It also makes them dangerous.
            </p>
            <p>
              Here two threads, <Term k="A">A</Term> and <Term k="B">B</Term>, share one variable, <Term k="count">count</Term>, which starts at 5. Each
              thread runs the same line of code once: <code>count = count + 1</code>.
            </p>
            <p>
              Two increments, so count should end at 7. And it does. The <Term k="tl">timeline</Term> at the bottom records what ran, in order.
            </p>
          </>
        ),
        callouts: [{ target: 'c:count', text: <><b>shared</b>: both threads use it</>, dir: 'right', wide: true }],
        hud: ['expected'],
        legend: ['A', 'B'],
        code: [
          {
            title: 'counter.c',
            lang: 'c',
            code: `int count = 5;              // shared by every thread

void *worker(void *arg) {
!    count = count + 1;
    return NULL;
}

pthread_create(&a, NULL, worker, NULL);
pthread_create(&b, NULL, worker, NULL);`,
          },
        ],
      },
      {
        id: 'three-instructions',
        title: 'count++ is three instructions',
        cfg: { scene: 'counter', counter: 'basic', mode: 'plan', plan: ['A', 'A', 'A', 'B', 'B', 'B'], loop: true, timeline: true },
        body: (
          <>
            <p>
              That line looks like one step. It isn’t. A CPU does arithmetic on values in <strong>registers</strong>, tiny storage slots inside each core.
              So <code>count = count + 1</code> becomes three instructions:
            </p>
            <p>
              {LOAD} copies count from memory into a register. <strong>ADD</strong> adds 1 to the register. {STORE} writes the register back to memory.
            </p>
            <p>
              Each thread has its own <Term k="reg">register</Term>. Only <Term k="count">memory</Term> is shared. Watch A’s value travel down, get
              incremented, and travel back up. Then B does the same.
            </p>
            <Aside>
              An optimizing compiler may emit one <code>add [count], 1</code> instead. Inside the CPU that’s still a read, a modify and a write, and without a{' '}
              <code>lock</code> prefix another core can slip in between.
            </Aside>
          </>
        ),
        callouts: [{ target: 'r:A', text: <>A’s <b>register</b>: private to A</>, dir: 'up', wide: true }],
        hud: ['expected'],
        legend: ['A', 'B'],
        code: [
          {
            title: 'counter.s · gcc -O0, x86-64',
            lang: 'shell',
            code: `# count = count + 1
!movl  count(%rip), %eax    # LOAD   eax ← count
!addl  $1, %eax             # ADD    eax ← eax + 1
!movl  %eax, count(%rip)    # STORE  count ← eax`,
          },
        ],
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'lost-update',
    title: 'The lost update',
    steps: [
      {
        id: 'the-lost-update',
        title: 'The lost update',
        cfg: { scene: 'counter', counter: 'basic', mode: 'plan', plan: ['A', 'B', 'A', 'A', 'B', 'B'], loop: true, timeline: true },
        body: (
          <>
            <p>
              Nothing makes a thread finish all three instructions before another one runs. The OS <strong>scheduler</strong> can pause a thread after any
              instruction (a timer interrupt fires every few milliseconds) and run a different one. On a multicore CPU, both threads run at literally the same
              time.
            </p>
            <p>
              Watch this schedule. A loads 5. Before A stores, B loads too, and also sees 5. A adds and stores 6. B adds 1 to <em>its</em> stale 5 and
              stores 6 right over A’s 6.
            </p>
            <p>
              Two increments ran, yet count went up by one. That’s a <strong>lost update</strong>. Bugs like this, where the result depends on the timing of
              threads, are called <strong>race conditions</strong>.
            </p>
          </>
        ),
        callouts: [{ target: 'c:count', text: <>two increments, <b>only +1</b></>, dir: 'right', wide: true }],
        hud: ['expected', 'lost'],
        legend: ['A', 'B', 'lost'],
        code: [
          {
            title: 'worker.js',
            lang: 'js',
            code: `// Two worker threads share one Int32Array
const count = new Int32Array(sharedBuffer);

// in each worker:
!count[0] = count[0] + 1;   // load, add, store: can interleave`,
            note: 'JavaScript workers normally share nothing and pass messages. Hand them a SharedArrayBuffer and they race like threads in any other language.',
          },
        ],
      },
      {
        id: 'predict-the-count',
        title: 'Predict the final count',
        cfg: { scene: 'counter', counter: 'basic', mode: 'plan', predict: 'count', timeline: true },
        panel: 'predict-count',
        body: (
          <>
            <p>
              Your turn. Each round, the <Term k="tl">timeline</Term> shows a schedule before it runs: dashed chips are instructions waiting their turn, left to
              right. Read it and predict where count ends up.
            </p>
            <p>
              The rule: count reaches 7 only if one thread’s {STORE} happens before the other’s {LOAD}. If the two LOAD…STORE windows overlap at all, one
              update is lost.
            </p>
          </>
        ),
        hud: ['expected', 'lost'],
        legend: ['A', 'B', 'lost'],
      },
      {
        id: 'you-are-the-scheduler',
        title: 'You are the scheduler',
        cfg: { scene: 'counter', counter: 'basic', mode: 'manual', timeline: true },
        panel: 'scheduler',
        body: (
          <>
            <p>
              Now you play the OS. Click a thread on the stage, or use the buttons below, to run its next instruction. You decide the interleaving.
            </p>
            <p>
              First, <strong>lose an update</strong>: make count end at 6. Then start over and get the correct 7.
            </p>
            <p>
              Notice how little it takes. No strange input, no rare instruction. Just an unlucky order, and a real scheduler makes that choice millions of times a
              second.
            </p>
          </>
        ),
        hud: ['expected', 'lost'],
        legend: ['A', 'B', 'lost'],
      },
      {
        id: 'a-thousand-increments',
        title: 'Run it a thousand times',
        cfg: { scene: 'counter', mode: 'run', strategy: 'none', threads: 2, per: 1000, chart: true, autoRun: true },
        panel: 'run',
        body: (
          <>
            <p>
              Same bug, in a loop. Each thread increments count 1,000 times, both at once on separate cores. Expected total: 2,000. Press run a few times.
            </p>
            <p>
              The total comes up short, and <strong>by a different amount every run</strong>. The result depends on exactly how the instructions overlap,
              which changes with every interrupt, cache miss and context switch. That’s <strong>nondeterminism</strong>.
            </p>
            <p>
              It’s what makes races so nasty. A test passes a hundred times, then fails in production. Add a print statement to investigate and the timing
              shifts, so the bug hides. Engineers call these <strong>heisenbugs</strong>.
            </p>
          </>
        ),
        aside: (
          <Aside>
            The simulator overlaps the threads and pauses them at random, the way an OS does. Real shortfalls depend on the hardware. Race detectors such as
            ThreadSanitizer (<code>-fsanitize=thread</code>) and <code>go test -race</code> flag unsynchronized access even on runs that happen to come out
            right.
          </Aside>
        ),
        hud: ['expected', 'count', 'lost'],
        legend: ['A', 'B', 'lost'],
        code: [
          {
            title: 'main.go',
            lang: 'c',
            code: `var count int

func main() {
    var wg sync.WaitGroup
    for t := 0; t < 2; t++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for i := 0; i < 1000; i++ {
!                count++          // data race
            }
        }()
    }
    wg.Wait()
    fmt.Println(count)           // not always 2000
}`,
            note: '`go run -race main.go` prints WARNING: DATA RACE with the stack traces of both goroutines.',
          },
        ],
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'locks',
    title: 'Locks',
    steps: [
      {
        id: 'critical-section',
        title: 'The critical section',
        cfg: { scene: 'counter', counter: 'basic', mode: 'plan', plan: ['A', 'B', 'A', 'A', 'B', 'B'], loop: true, timeline: true, crit: true },
        body: (
          <>
            <p>
              The three instructions that read, modify and write count form a <strong>critical section</strong>: code that touches shared state and must not
              overlap with another thread doing the same.
            </p>
            <p>
              Watch the dashed band on each card. It lights up while its thread is inside, and turns red when <strong>both threads are inside at once</strong>.
              That’s exactly when the update gets lost. If only one thread could be inside at a time, every schedule would give 7.
            </p>
            <Aside>
              In C and C++, two threads accessing the same memory without synchronization, at least one of them writing, is a <strong>data race</strong>. The
              language calls it undefined behavior, so the compiler may assume it never happens.
            </Aside>
          </>
        ),
        callouts: [{ target: 'c:count', text: <><b>both inside</b> = lost update</>, dir: 'right', wide: true }],
        hud: ['inside', 'lost'],
        legend: ['A', 'B', 'lost'],
        code: [
          {
            title: 'counter.c',
            lang: 'c',
            code: `void *worker(void *arg) {
    // ---- critical section ----
!    int r = count;     // read
!    r = r + 1;         // modify
!    count = r;         // write
    // --------------------------
    return NULL;
}`,
          },
        ],
      },
      {
        id: 'mutex',
        title: 'A mutex: one thread at a time',
        cfg: { scene: 'counter', counter: 'mutex', mode: 'plan', plan: ['A', 'A', 'B', 'A', 'A', 'A', 'B', 'B', 'B', 'B'], loop: true, timeline: true, crit: true },
        body: (
          <>
            <p>
              A <Term k="mu">mutex</Term> (for <em>mutual exclusion</em>) is a lock that at most one thread can hold. Wrap the critical section in{' '}
              <strong>LOCK</strong> and <strong>UNLOCK</strong>.
            </p>
            <p>
              If the mutex is free, LOCK takes it and the thread walks in. If another thread holds it, the thread <strong>blocks</strong>: the OS parks it so it
              uses no CPU until the mutex is released (many mutexes spin for a moment first). UNLOCK releases it and wakes a waiter.
            </p>
            <p>
              Watch B arrive while A is inside. B waits at the lock. When A unlocks, B takes the mutex and loads 6, not 5. Count ends at 7, every time.
            </p>
          </>
        ),
        callouts: [{ target: 'l:mu', text: <><b>one owner</b> at a time</>, dir: 'up', wide: true }],
        hud: ['expected', 'waited'],
        legend: ['A', 'B', 'lock'],
        code: [
          {
            title: 'counter.go',
            lang: 'c',
            code: `var (
    mu    sync.Mutex
    count int
)

func increment() {
!    mu.Lock()
    count++          // one goroutine in here at a time
!    mu.Unlock()
}`,
          },
        ],
      },
      {
        id: 'predict-the-lock',
        title: 'Predict: who waits?',
        cfg: { scene: 'counter', counter: 'mutex', mode: 'plan', predict: 'lock', timeline: true, crit: true },
        panel: 'predict-lock',
        body: (
          <>
            <p>
              Same program, your call. The animation stops at three key moments and asks what happens next. Keep an eye on the <Term k="mu">mutex</Term>: it
              shows who holds it and who is waiting.
            </p>
          </>
        ),
        hud: ['expected', 'waited'],
        legend: ['A', 'B', 'lock'],
        code: [
          {
            title: 'Counter.java',
            lang: 'js',
            code: `class Counter {
    private int count = 5;

!    synchronized void increment() {   // lock this object
        count++;
!    }                                 // unlock, even on exceptions
}`,
            note: 'Every Java object has a built-in lock. synchronized takes it on entry and releases it on exit.',
          },
        ],
      },
      {
        id: 'try-to-break-it',
        title: 'Now try to break it',
        cfg: { scene: 'counter', counter: 'mutex', mode: 'manual', timeline: true, crit: true },
        panel: 'scheduler-lock',
        body: (
          <>
            <p>You’re the scheduler again, but this time the threads use the mutex. Try to lose an update.</p>
            <p>
              You can still pause a thread anywhere, even in the middle of the critical section. But the other thread can’t get in: its LOCK just blocks,
              and its button goes gray. However you interleave, count ends at 7.
            </p>
          </>
        ),
        hud: ['expected', 'lost'],
        legend: ['A', 'B', 'lock'],
      },
      {
        id: 'the-price-of-a-lock',
        title: 'The price of a lock',
        cfg: { scene: 'counter', mode: 'run', strategy: 'none', threads: 2, per: 1000, chart: true, autoRun: true },
        panel: 'run-compare',
        body: (
          <>
            <p>Correct isn’t free. Run the 1,000-increment experiment with and without the mutex, and compare the orange time bars under each result.</p>
            <p>
              With the lock, the critical sections run one after another: they’re <strong>serialized</strong>. While A is inside, B can only wait, so two
              cores do the work of one. When threads keep fighting over a lock (<strong>contention</strong>), every handoff means putting a thread to sleep
              and waking it again, which costs far more than the increment itself.
            </p>
            <p>
              So keep critical sections <strong>short</strong>. Do slow work, like I/O or network calls, before taking the lock or after releasing it.
            </p>
          </>
        ),
        aside: <Aside>Time is in simulated ticks and the costs are illustrative, but the ordering is realistic: a contended mutex is far slower than the racy loop.</Aside>,
        hud: ['expected', 'count', 'lost'],
        legend: ['A', 'B', 'lost'],
        code: [
          {
            title: 'Checkout.java',
            lang: 'js',
            code: `// Slow: everyone waits during a network call
synchronized (lock) {
!    Price p = pricing.fetch(item);   // 200 ms, lock held
    total += p.amount;
}

// Better: lock only the shared update
Price p = pricing.fetch(item);
synchronized (lock) {
    total += p.amount;
}`,
          },
        ],
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'atomics',
    title: 'Atomic operations',
    steps: [
      {
        id: 'fetch-and-add',
        title: 'One indivisible instruction',
        cfg: { scene: 'counter', counter: 'faa', iters: 2, mode: 'plan', plan: ['A', 'B', 'B', 'A'], loop: true, timeline: true },
        body: (
          <>
            <p>
              For a simple counter there’s a lighter tool. CPUs have <strong>atomic</strong> instructions that read, modify and write memory as one indivisible
              step. <strong>Fetch-and-add</strong> adds to a value and hands back the old one, and no other core can touch that memory in between.
            </p>
            <p>
              On x86 it’s <code>lock xadd</code>: the <code>lock</code> prefix makes the core hold exclusive ownership of that memory (its cache line)
              until the write is done. Nothing to interleave, so nothing to lose, and no thread ever sleeps waiting for a lock.
            </p>
            <p>Each chip on the timeline is now a whole increment. Two per thread, any order: count always ends at 9.</p>
          </>
        ),
        callouts: [{ target: 'c:count', text: <>held <b>exclusively</b> for the whole step</>, dir: 'right', wide: true }],
        hud: ['expected', 'lost'],
        legend: ['A', 'B', 'atomic'],
        code: [
          {
            title: 'Counter.java',
            lang: 'js',
            code: `AtomicInteger count = new AtomicInteger(5);
!count.incrementAndGet();         // lock xadd on x86`,
          },
          {
            title: 'worker.js',
            lang: 'js',
            code: `const count = new Int32Array(sharedBuffer);
!Atomics.add(count, 0, 1);        // returns the old value`,
            note: 'In browsers, SharedArrayBuffer needs a cross-origin isolated page (COOP and COEP headers).',
          },
        ],
      },
      {
        id: 'compare-and-swap',
        title: 'Compare-and-swap: retry on conflict',
        cfg: { scene: 'counter', counter: 'cas', mode: 'plan', plan: ['A', 'A', 'B', 'B', 'B', 'A', 'A', 'A', 'A'], loop: true, timeline: true },
        body: (
          <>
            <p>
              Fetch-and-add only adds. For anything else (keep a maximum, push onto a list) there’s <strong>compare-and-swap</strong>:{' '}
              <code>CAS(addr, expected, new)</code> writes <code>new</code> only if memory still holds <code>expected</code>, and reports whether it did. All
              in one atomic step.
            </p>
            <p>
              A <strong>CAS loop</strong> reads the value, computes the new one, and tries to swap it in. Here B sneaks in first, so A’s CAS finds 6 where it
              expected 5. The swap fails, nothing is overwritten, and A simply retries with the fresh value.
            </p>
            <p>
              No thread ever blocks, and a failed CAS always means some other thread succeeded. Data structures built this way are called{' '}
              <strong>lock-free</strong>.
            </p>
            <Aside>
              CAS compares values, not history. If a value changes 5 → 6 → 5 between your read and your CAS, the swap still succeeds. That’s the{' '}
              <strong>ABA problem</strong>, a classic trap in lock-free code.
            </Aside>
          </>
        ),
        hud: ['expected', 'retries'],
        legend: ['A', 'B', 'atomic'],
        code: [
          {
            title: 'Counter.java',
            lang: 'js',
            code: `int old, next;
do {
    old = count.get();
    next = old + 1;
!} while (!count.compareAndSet(old, next));   // lock cmpxchg`,
          },
        ],
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'deadlock',
    title: 'Deadlock',
    steps: [
      {
        id: 'deadlock',
        title: 'Deadlock: waiting forever',
        cfg: { scene: 'deadlock', orders: ['ab', 'ba'], dl: 'wait', mode: 'plan', plan: ['A', 'B', 'A', 'B'], timeline: true },
        body: (
          <>
            <p>
              Locks bring a new way to fail. A bank transfer locks both accounts so nobody sees money in flight. <Term k="A">Thread A</Term> moves $10 from
              Alice to Bob: it locks <Term k="alice">alice</Term>, then <Term k="bob">bob</Term>. <Term k="B">Thread B</Term> moves $10 the other way: it
              locks bob, then alice.
            </p>
            <p>
              Unlucky timing again: A takes alice while B takes bob. Now A waits for bob, which B holds, and B waits for alice, which A holds. Neither can
              continue, so neither ever unlocks.
            </p>
            <p>
              That’s a <strong>deadlock</strong>. No crash, no error message, just threads waiting forever. The arrows form a cycle: A → bob → B → alice →
              A.
            </p>
          </>
        ),
        hud: ['stuck'],
        legend: ['held', 'waits', 'lock'],
        quiz: {
          question: 'Which change makes this deadlock impossible?',
          options: [
            { text: 'Faster CPUs, so each transfer finishes sooner', why: 'Faster code shrinks the window but never closes it. The same unlucky timing can still happen, just less often.' },
            { text: 'Make B lock alice first, then bob', correct: true, why: 'Now both threads take locks in the same order. Whoever gets alice first also gets bob; the other waits holding nothing. No cycle can form.' },
            { text: 'Add a third lock around each transfer’s MOVE', why: 'The threads still get stuck on their second lock before ever reaching the MOVE.' },
          ],
        },
        code: [
          {
            title: 'transfer.go',
            lang: 'c',
            code: `func transfer(from, to *Account, amount int) {
!    from.mu.Lock()
!    to.mu.Lock()         // may wait forever
    from.balance -= amount
    to.balance += amount
    to.mu.Unlock()
    from.mu.Unlock()
}

go transfer(alice, bob, 10)   // locks alice, then bob
go transfer(bob, alice, 10)   // locks bob, then alice`,
          },
        ],
      },
      {
        id: 'fix-the-deadlock',
        title: 'Build it, then fix it',
        cfg: { scene: 'deadlock', orders: ['ab', 'ba'], dl: 'wait', mode: 'alternate', timeline: true },
        panel: 'deadlock',
        body: (
          <>
            <p>
              A deadlock needs four conditions at once (the <strong>Coffman conditions</strong>): <strong>mutual exclusion</strong>, a lock has one owner;{' '}
              <strong>hold and wait</strong>, a thread holds one lock while waiting for another; <strong>no preemption</strong>, nobody can take a lock
              away; and <strong>circular wait</strong>, a cycle of waiting. Break any one and deadlock can’t happen.
            </p>
            <p>
              Two practical fixes. <strong>Lock ordering</strong>: every thread takes locks in one global order, say by account id, so a cycle can’t form.{' '}
              <strong>Try-lock with a timeout</strong>: if the second lock doesn’t come soon, release the first, back off for a random moment, and retry.
            </p>
          </>
        ),
        aside: (
          <Aside>
            The back-off must be random. If both threads retry in lockstep, they can collide forever without either making progress. That’s a{' '}
            <strong>livelock</strong>.
          </Aside>
        ),
        hud: ['stuck'],
        legend: ['held', 'waits', 'money'],
        code: [
          {
            title: 'transfer.go · ordered',
            lang: 'c',
            code: `func transfer(from, to *Account, amount int) {
!    first, second := from, to
!    if to.id < from.id {        // always lock the lower id first
!        first, second = to, from
!    }
    first.mu.Lock()
    defer first.mu.Unlock()
    second.mu.Lock()
    defer second.mu.Unlock()
    from.balance -= amount
    to.balance += amount
}`,
          },
        ],
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'in-the-wild',
    title: 'Races in the wild',
    steps: [
      {
        id: 'check-then-act',
        title: 'Check-then-act: the double booking',
        cfg: { scene: 'seat', seat: 'racy', mode: 'plan', loop: true, timeline: true },
        panel: 'seat',
        body: (
          <>
            <p>
              Races aren’t only about counters, and they don’t need threads in one process. Two web requests on two servers race just the same when they share
              a database.
            </p>
            <p>
              The classic shape is <strong>check-then-act</strong>: check a condition, then act on it, assuming it still holds. Alice and Bob both ask for seat
              14C. Both requests check: free. Both book it. The row ends up saying bob, but both got a confirmation email.
            </p>
            <p>
              The general name is <strong>TOCTOU</strong>, time of check to time of use. The fix is to make the check and the act one atomic step. Switch
              modes below.
            </p>
          </>
        ),
        aside: (
          <Aside>
            TOCTOU is also a classic security hole: a program checks a file with <code>access()</code>, then opens it with <code>open()</code>. An attacker who
            swaps in a symlink between the two calls gets it to open a file it shouldn’t.
          </Aside>
        ),
        hud: ['booked'],
        legend: ['alice', 'bob', 'lost'],
      },
      {
        id: 'double-spend',
        title: 'Double spend: rows race too',
        cfg: { scene: 'bank', bank: 'racy', mode: 'plan', loop: true, timeline: true },
        panel: 'bank',
        body: (
          <>
            <p>
              Two $80 withdrawals hit an account holding $100 at the same moment. Each transaction reads the balance, checks there’s enough, and writes the new
              balance.
            </p>
            <p>
              Both read $100, both pass the check, both write $20. The customer walked away with $160 from a $100 account: a <strong>double spend</strong>.
              Under <code>READ COMMITTED</code>, the default isolation level in PostgreSQL, nothing stops it.
            </p>
            <p>
              Two standard fixes. <strong>Pessimistic locking</strong>: <code>SELECT … FOR UPDATE</code> locks the row until the transaction commits, so the
              second withdrawal waits, then sees $20. <strong>Optimistic locking</strong>: no lock, but every row carries a <strong>version</strong>, and the
              update only applies if the version is unchanged. Zero rows updated means someone got there first: re-read and retry.
            </p>
          </>
        ),
        aside: (
          <Aside>
            Pessimistic wins when conflicts are common; optimistic wins when they’re rare, since nobody waits. Stricter isolation also helps: under
            PostgreSQL’s REPEATABLE READ, the second update fails with a serialization error and the app retries.
          </Aside>
        ),
        hud: ['paid'],
        legend: ['atm', 'app', 'lock'],
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
        cfg: { scene: 'counter', counter: 'mutex', mode: 'auto', loop: true, timeline: true, crit: true },
        panel: 'cheatsheet',
        body: (
          <>
            <p>
              Everything in one place. On the stage, two threads keep incrementing under a mutex in a random order, round after round, and never lose an
              update.
            </p>
          </>
        ),
        hud: ['rounds', 'lost'],
        legend: ['A', 'B', 'lock'],
      },
      {
        id: 'playground',
        title: 'Playground',
        cfg: { scene: 'counter', mode: 'run', strategy: 'none', threads: 2, per: 1000, chart: true, autoRun: true },
        panel: 'playground',
        body: (
          <p>
            Your lab. Pick how count is protected, how many threads run and how many increments each does, then press run. Each run adds a bar: its height is
            the final count, the orange line under it is how long it took.
          </p>
        ),
        hud: ['expected', 'count', 'lost'],
        legend: ['A', 'B', 'lost'],
      },
    ],
  },
];
