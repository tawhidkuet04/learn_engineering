import { Aside } from '@/components/lesson/Prose';
import { Term } from '@/components/lesson/Term';
import { CheatSheet } from './panel/CheatSheet';
import type { ProcSpec, ThreadSpec } from './sim';
import type { Chapter } from './types';

export const LESSON = {
  slug: 'processes-threads',
  code: 'CS-01',
  track: 'Computer science',
  title: 'Processes vs Threads',
};

/* ---------- the cast ---------- */

const t = (id: string, o: Partial<ThreadSpec> = {}): ThreadSpec => ({ id, ...o });

const SERVER = (threads: ThreadSpec[], o: Partial<ProcSpec> = {}): ProcSpec => ({
  id: 'a',
  pid: 4127,
  name: 'server',
  globals: 'requests = 812',
  files: ['0', '1', '2', '3 sock'],
  threads,
  ...o,
});

const BACKUP = (threads: ThreadSpec[], o: Partial<ProcSpec> = {}): ProcSpec => ({
  id: 'b',
  pid: 4188,
  name: 'backup',
  globals: 'copied = 37',
  files: ['0', '1', '2', '3 file'],
  threads,
  ...o,
});

const INDEXER = (threads: ThreadSpec[]): ProcSpec => ({ id: 'c', pid: 4203, name: 'indexer', globals: 'docs = 1204', threads });

export const POSTGRES: ProcSpec[] = [
  { id: 'a', pid: 812, name: 'postmaster', kind: 'db', globals: 'port = 5432', threads: [t('a1', { asleep: true })] },
  { id: 'b', pid: 2201, name: 'backend', kind: 'db', globals: 'user = alice', threads: [t('b1', { burst: 0.7, io: 1.6 })] },
  { id: 'c', pid: 2202, name: 'backend', kind: 'db', globals: 'user = bob', threads: [t('c1', { burst: 0.9, io: 1.2 })] },
  { id: 'd', pid: 2203, name: 'backend', kind: 'db', globals: 'user = carol', threads: [t('d1', { burst: 0.5, io: 1.9 })] },
];

export const MYSQL: ProcSpec[] = [
  {
    id: 'a',
    pid: 1044,
    name: 'mysqld',
    kind: 'db',
    globals: 'buffer_pool = 128M',
    threads: [t('a1', { role: 'alice', burst: 0.7, io: 1.6 }), t('a2', { role: 'bob', burst: 0.9, io: 1.2 }), t('a3', { role: 'carol', burst: 0.5, io: 1.9 }), t('a4', { role: 'io', asleep: true })],
  },
];

export const NGINX: ProcSpec[] = [
  { id: 'a', pid: 900, name: 'master', globals: 'worker_processes 2', threads: [t('a1', { asleep: true })] },
  { id: 'b', pid: 901, name: 'worker', globals: 'connections = 2817', threads: [t('b1', { burst: 1.4, io: 0.6 })] },
  { id: 'c', pid: 902, name: 'worker', globals: 'connections = 2790', threads: [t('c1', { burst: 1.2, io: 0.7 })] },
];

export const PY_THREADS: ProcSpec[] = [
  { id: 'a', pid: 3301, name: 'python3', kind: 'python', gil: true, globals: 'results = []', threads: [t('a1', { work: 4 }), t('a2', { work: 4 }), t('a3', { work: 4 }), t('a4', { work: 4 })] },
];

export const PY_PROCS: ProcSpec[] = [3302, 3303, 3304, 3305].map((pid, i) => ({
  id: 'abcd'[i],
  pid,
  name: 'python3',
  kind: 'python',
  gil: true,
  globals: 'chunk = ' + (i + 1),
  threads: [t(`${'abcd'[i]}1`, { work: 4 })],
}));

export const CHROME: ProcSpec[] = [
  { id: 'a', pid: 2201, name: 'browser', kind: 'browser', globals: 'tabs = 2', threads: [t('a1', { role: 'UI', burst: 0.8, io: 1.4 }), t('a2', { role: 'IO', burst: 0.5, io: 1.8 })] },
  { id: 'b', pid: 2240, name: 'gpu', kind: 'gpu', globals: 'frames = 6012', threads: [t('b1', { burst: 0.6, io: 1.0 })] },
  { id: 'c', pid: 2305, name: 'renderer', kind: 'renderer', tab: 'news.example', globals: 'dom nodes = 3120', threads: [t('c1', { burst: 1.1, io: 0.9 }), t('c2', { burst: 0.5, io: 1.5 })] },
  { id: 'd', pid: 2311, name: 'renderer', kind: 'renderer', tab: 'mail.example', globals: 'dom nodes = 1877', threads: [t('d1', { burst: 0.9, io: 1.2 })] },
];

/* ---------- code shown in the panel ---------- */

const PY_THREAD_CODE = `
from threading import Thread

def crunch(n):
    return sum(i * i for i in range(n))  # pure Python

!threads = [Thread(target=crunch, args=(10**7,)) for _ in range(4)]
for th in threads: th.start()
for th in threads: th.join()   # they took turns on the GIL`;

const PY_PROC_CODE = `
from multiprocessing import Pool

def crunch(n):
    return sum(i * i for i in range(n))

!with Pool(4) as pool:          # 4 processes, 4 interpreters, 4 GILs
!    sums = pool.map(crunch, [10**7] * 4)`;

/* ================================================================== */

export const CHAPTERS: Chapter[] = [
  /* ================================================================ */
  {
    id: 'processes',
    title: 'From program to process',
    steps: [
      {
        id: 'a-program-becomes-a-process',
        title: 'A program becomes a process',
        reset: true,
        cfg: { launch: true, file: true, cores: 1, procs: [SERVER([t('a1', { role: 'main' })])] },
        script: [{ at: 1.3, run: (s) => s.launchProgram() }],
        body: (
          <>
            <p>
              A <strong>program</strong> is just a file: machine code and data sitting on <Term k="file">disk</Term>, doing nothing. This one is called{' '}
              <code>server</code>. Like every Linux executable, it starts with the magic bytes <code>7f 45 4c 46</code>: 0x7f, then &ldquo;ELF&rdquo;.
            </p>
            <p>
              Run it, and the operating system creates a <strong>process</strong>: a running instance of the program. The process gets an ID, the{' '}
              <strong>PID</strong> (here 4127), its own private memory called an <strong>address space</strong>, a table of open files, and one{' '}
              <strong>thread</strong> to execute the code: the pink token.
            </p>
            <p>
              Watch the code and data land in the new <Term k="proc:a">process</Term>. Then the thread gets a turn on the <Term k="cpu">CPU</Term>.
            </p>
            <Aside>Linux actually maps the file into memory and loads each page the first time it&apos;s touched. Same idea, less copying.</Aside>
          </>
        ),
        callouts: [{ target: 'proc:a', text: <>a process: <b>the program, running</b></>, dir: 'down', only: 'landscape' }],
        code: {
          title: 'terminal',
          lang: 'shell',
          code: `
$ ls -lh /usr/local/bin/server
-rwxr-xr-x 1 root root 2.1M server
!$ ./server &
![1] 4127
$ ps -o pid,nlwp,rss,cmd -p 4127
  PID NLWP   RSS CMD
! 4127    1  5316 ./server`,
          note: 'NLWP is the number of threads ("lightweight processes"). RSS is the memory in use, in KiB.',
        },
        legend: ['thread', 'load'],
      },
      {
        id: 'inside-a-process',
        title: 'Inside a process',
        reset: true,
        cfg: { cores: 1, procs: [SERVER([t('a1', { role: 'main' })])] },
        body: (
          <>
            <p>Zoom in on process 4127. Its memory is split into regions, each with a job:</p>
            <p>
              <Term k="code:a">Code</Term> holds the machine instructions, read-only so a bug can&apos;t overwrite them. <Term k="data:a">Data</Term> holds
              the global variables. The <Term k="heap:a">heap</Term> is memory the program asks for while it runs (<code>malloc</code>,{' '}
              <code>new</code>): watch blocks appear. The <Term k="stack:a">stack</Term> holds function calls and their local variables. Frames push and
              pop as the thread calls and returns.
            </p>
            <p>
              The process also owns <Term k="files:a">file descriptors</Term>: 0, 1 and 2 are stdin, stdout and stderr, and 3 is a network socket it
              opened.
            </p>
            <Aside>
              These addresses are <em>virtual</em>. Every process gets its own page table, which the CPU uses to translate its addresses into physical
              RAM.
            </Aside>
          </>
        ),
        callouts: [
          { target: 'stack:a', text: <>stack: <b>calls and locals</b></>, dir: 'left', pdir: 'up', only: 'landscape' },
          { target: 'heap:a', text: <>heap: <b>allocated at runtime</b></>, dir: 'right', only: 'landscape' },
        ],
        code: {
          title: 'terminal',
          lang: 'shell',
          code: `
$ cat /proc/4127/maps     # trimmed
!55d0c3a00000-55d0c3a2c000 r-xp  /usr/local/bin/server
!55d0c3c2c000-55d0c3c30000 rw-p  /usr/local/bin/server
!55d0c4e1f000-55d0c4e40000 rw-p  [heap]
7f3b2c200000-7f3b2c3c5000 r-xp  /usr/lib/libc.so.6
!7ffd8a1c0000-7ffd8a1e1000 rw-p  [stack]`,
          note: 'Every region of the address space, with its permissions: r-x for code, rw- for data, heap and stack.',
        },
        legend: ['thread'],
      },
      {
        id: 'processes-are-isolated',
        title: 'Run it twice: isolation',
        reset: true,
        cfg: {
          cores: 1,
          table: true,
          procs: [SERVER([t('a1', { role: 'main' })]), SERVER([t('b1', { role: 'main' })], { id: 'b', pid: 4131, globals: 'requests = 55' })],
        },
        body: (
          <>
            <p>
              Run the same program twice and you get two processes: same code, but each with its <strong>own address space</strong>. Even if both use
              the very same address, say <code>0x55d0c4e1f000</code>, they reach different bytes of RAM, because each process has its own page table
              mapping that address somewhere else.
            </p>
            <p>
              Compare their <Term k="data:a">globals</Term>: 812 requests in one, 55 in the other. Neither process can read the other&apos;s memory, not
              even by accident. Both take turns on the single core.
            </p>
            <p>
              That wall is what makes processes robust. <strong>Your turn:</strong> crash one of them.
            </p>
          </>
        ),
        interaction: {
          kind: 'actions',
          buttons: [
            {
              label: 'Crash process A',
              icon: 'power',
              run: (s) => s.crashProcess('a', 'SIGSEGV'),
              after: (
                <>
                  A is gone: the kernel freed its memory and closed its files. <strong>B didn&apos;t notice.</strong> Nothing was shared, so nothing
                  broke.
                </>
              ),
            },
            {
              label: 'Start it again',
              icon: 'replay',
              run: (s) => s.restartProcess('a'),
              after: <>A fresh process with a new PID. Nothing survived from the old one: its memory died with it.</>,
            },
          ],
        },
        code: {
          title: 'terminal',
          lang: 'shell',
          code: `
$ ./server & ./server &
[1] 4127
[2] 4131
!$ kill -SEGV 4127
![1]-  Segmentation fault  (core dumped) ./server
$ pgrep -a server
!4131 ./server`,
        },
        hud: ['alive'],
        legend: ['thread', 'crash'],
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'threads',
    title: 'Threads',
    steps: [
      {
        id: 'threads-share-a-process',
        title: 'Threads: more hands, one memory',
        reset: true,
        cfg: { cores: 2, table: true, procs: [SERVER([t('a1', { role: 'main' })])] },
        script: [
          { at: 0.9, run: (s) => void s.spawnThread('a') },
          { at: 1.9, run: (s) => void s.spawnThread('a') },
        ],
        body: (
          <>
            <p>
              A <strong>thread</strong> is one line of execution inside a process. Every process starts with one, and can ask for more. Watch{' '}
              <code>server</code> start two worker threads.
            </p>
            <p>
              Each thread gets its <Term k="stack:a">own stack</Term>, its own registers and its own <strong>program counter</strong> (the address of the
              next instruction to run). That is all it needs to run on its own: A2 can be deep inside one function while A3 is somewhere else entirely.
            </p>
            <p>
              Everything else is <strong>shared</strong>: the <Term k="heap:a">heap</Term>, the globals, the code and the open files. Watch the heap
              blocks flash in different thread colors. With two cores, two threads really run at the same moment.
            </p>
            <p>
              The kernel schedules threads, not processes. That&apos;s why tools like <code>top -H</code> list one row per thread: the same PID, each
              with its own thread ID (TID).
            </p>
          </>
        ),
        callouts: [
          { target: 'stack:a', text: <>private: <b>one stack per thread</b></>, dir: 'left', only: 'landscape' },
          { target: 'heap:a', text: <>shared: <b>one heap for all</b></>, dir: 'right', only: 'landscape' },
        ],
        code: {
          title: 'server.c',
          lang: 'c',
          code: `
#include <pthread.h>

void *worker(void *arg) {   // its own stack...
    handle_requests(arg);   // ...but the same heap
    return NULL;
}

int main(void) {
    pthread_t t[2];
    for (int i = 0; i < 2; i++)
!        pthread_create(&t[i], NULL, worker, NULL);
    // main keeps running here, alongside both workers
}`,
        },
        legend: ['thread'],
      },
      {
        id: 'what-can-a-thread-see',
        title: 'What can a new thread see?',
        reset: true,
        cfg: {
          cores: 2,
          procs: [SERVER([t('a1', { role: 'main' }), t('a2', { role: 'worker' })]), BACKUP([t('b1')])],
        },
        script: [{ at: 0.7, run: (s) => void s.spawnThread('a') }],
        predict: { kind: 'share', rounds: 3, prompt: 'Can the new thread A3 reach the outlined memory?' },
        body: (
          <>
            <p>
              Test your model. Process A just started a new thread, <Term k="tok:a3">A3</Term>. Process <Term k="proc:b">B</Term> is another program
              that happens to be running on the same machine.
            </p>
            <p>The simulation will pause and outline a piece of memory. Decide whether A3 can reach it.</p>
          </>
        ),
        code: {
          title: 'terminal',
          lang: 'shell',
          code: `
$ ls /proc/4127/task           # one entry per thread
4127  4128  4129
!$ ls /proc/4127/task/4129/fd   # A3's open files...
!0  1  2  3                     # ...are the process's`,
        },
        legend: ['thread', 'ok', 'crash'],
      },
      {
        id: 'threads-are-cheaper',
        title: 'Why threads are cheaper',
        reset: true,
        seed: 11,
        cfg: { cores: 2, procs: [SERVER([t('a1', { role: 'main' })])], spawn: 'thread' },
        body: (
          <>
            <p>
              Say <code>server</code> needs three more workers. It can start <strong>threads</strong>, or it can <strong>fork</strong> copies of itself as
              new processes. Flip between the two below.
            </p>
            <p>
              A new thread needs little more than a stack and a slot in the scheduler. A new process needs a whole new address space: page tables, a copy
              of the file table, its own everything. Linux uses <strong>copy-on-write</strong> so parent and child share memory pages until one of them
              writes, yet forking is still several times more work, and it grows with the size of the parent.
            </p>
            <p>You pay that for isolation: four boxes that can&apos;t hurt each other, instead of one box with four hands.</p>
            <Aside>Ballpark on Linux: starting a thread takes around 10 µs; forking a small process several times that; forking a big one, milliseconds.</Aside>
          </>
        ),
        interaction: {
          kind: 'toggle',
          prompt: 'Start three workers as:',
          initial: 0,
          options: [
            {
              label: 'Threads',
              apply: (s) => s.setSpawn('thread'),
              note: (
                <>
                  <strong>One address space, four stacks.</strong> Each new thread appears in a moment and immediately shares everything.
                </>
              ),
              code: {
                title: 'worker.c',
                lang: 'c',
                code: `
pthread_t t;
!pthread_create(&t, NULL, run_worker, NULL);
// same address space: sees every global and heap object`,
              },
            },
            {
              label: 'Processes',
              apply: (s) => s.setSpawn('fork'),
              note: (
                <>
                  <strong>Four address spaces.</strong> Each child waits while the kernel copies its page tables, and gets a new PID.
                </>
              ),
              code: {
                title: 'worker.c',
                lang: 'c',
                code: `
!pid_t pid = fork();     // duplicate this process
if (pid == 0) {         // in the child:
    run_worker();       // own address space, own PID
    _exit(0);
}`,
              },
            },
          ],
        },
        hud: ['spaces'],
        legend: ['thread'],
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'scheduling',
    title: 'Taking turns',
    steps: [
      {
        id: 'one-core-many-threads',
        title: 'One core, many threads',
        reset: true,
        cfg: { cores: 1, procs: [SERVER([t('a1'), t('a2')]), BACKUP([t('b1')])], gantt: true, queue: true, table: true },
        body: (
          <>
            <p>
              Three threads want to run, but this CPU has <Term k="core:0">one core</Term>, and a core runs exactly one thread at a time. So the operating
              system&apos;s <strong>scheduler</strong> makes them take turns.
            </p>
            <p>
              Each thread gets a <strong>time slice</strong>, typically a few milliseconds. When it&apos;s used up, a timer interrupt hands control to the kernel,
              which <strong>preempts</strong> the thread, puts it at the back of the <Term k="queue">ready queue</Term>, and gives the core to the thread
              at the front.
            </p>
            <p>
              The <Term k="gantt">timeline</Term> records who ran when. Up close, one thread at a time. From a distance, all three move forward together.
              That&apos;s <strong>concurrency</strong>: juggling many tasks, not doing them at the same instant.
            </p>
            <Aside>
              Real schedulers are smarter than this round robin. Linux weighs priorities and how much CPU each thread has had, and keeps a queue per core.
              The taking-turns idea is the same.
            </Aside>
          </>
        ),
        callouts: [{ target: 'core:0', text: <>one core: <b>one thread at a time</b></>, dir: 'left', only: 'landscape' }],
        code: {
          title: 'terminal',
          lang: 'shell',
          code: `
$ ps -eLf | grep -E 'server|backup'   # columns trimmed
UID     PID   LWP  NLWP  CMD
!alice  4127  4127     2  ./server
!alice  4127  4128     2  ./server
alice  4188  4188     1  ./backup`,
          note: 'LWP is the thread ID and NLWP the number of threads in the process. The scheduler juggles all three rows.',
        },
        hud: ['switches'],
        legend: ['thread', 'tsw', 'psw'],
      },
      {
        id: 'who-runs-next',
        title: 'Your turn: be the scheduler',
        reset: true,
        seed: 3,
        cfg: {
          cores: 1,
          procs: [SERVER([t('a1'), t('a2', { burst: 0.6, io: 2.6 })]), BACKUP([t('b1')])],
          gantt: true,
          queue: true,
          disk: true,
        },
        predict: { kind: 'next', rounds: 3, prompt: 'Which thread gets the core next?' },
        body: (
          <>
            <p>
              Now you schedule. Each time the core is about to change hands, the animation pauses: <strong>click the thread you think runs next</strong>.
              The ready queue is hidden, but the timeline shows who ran recently.
            </p>
            <p>
              One twist: A2 reads from the <Term k="disk">disk</Term> now and then. A thread waiting for the disk is <strong>blocked</strong>. It leaves
              the line entirely until its data arrives.
            </p>
          </>
        ),
        code: {
          title: 'terminal',
          lang: 'shell',
          code: `
$ ps -L -o pid,tid,stat,comm -p 4127
  PID   TID STAT COMMAND
 4127  4127 R    server     # running or ready
!4127  4128 D    server     # blocked on the disk`,
          note: 'R: running or waiting in the ready queue. S: sleeping until something happens. D: waiting on the disk.',
        },
        hud: ['switches'],
        legend: ['thread', 'io', 'tsw', 'psw'],
      },
      {
        id: 'context-switch',
        title: 'The context switch',
        reset: true,
        cfg: {
          cores: 1,
          procs: [SERVER([t('a1'), t('a2')]), BACKUP([t('b1')])],
          gantt: true,
          queue: true,
          inspect: true,
          readout: true,
          slice: 2.2,
          tsw: 1.3,
          psw: 2.2,
        },
        inspector: true,
        body: (
          <>
            <p>
              Handing a core to another thread is a <strong>context switch</strong>, and it isn&apos;t free. Here it runs in slow motion: follow the steps
              on the stage card.
            </p>
            <p>
              The kernel saves the outgoing thread&apos;s registers (program counter, stack pointer and the rest) in its <strong>thread control block</strong>
              , picks the next thread, and restores that thread&apos;s registers. The core carries on exactly where the new thread left off.
            </p>
            <p>
              Switching to a thread of <strong>another process</strong> costs more (orange). The kernel also switches address spaces by loading that
              process&apos;s page table. The CPU&apos;s cached address translations (the <strong>TLB</strong>) and its caches hold the old process&apos;s
              data, so the new one starts cold.
            </p>
            <Aside>
              Drawn hundreds of times slower than life. A real switch costs a few microseconds, plus the hidden cost of refilling cold caches
              afterwards. Modern CPUs can tag TLB entries by address space to avoid flushing them all, but the new process still finds little of its own
              data cached.
            </Aside>
          </>
        ),
        code: {
          title: 'terminal',
          lang: 'shell',
          code: `
$ grep ctxt /proc/4127/status
!voluntary_ctxt_switches:     1520
!nonvoluntary_ctxt_switches:  218`,
          note: 'Voluntary: the thread blocked (disk, network, a lock). Nonvoluntary: its time slice ran out and it was preempted.',
        },
        hud: ['switches'],
        legend: ['tsw', 'psw'],
      },
      {
        id: 'how-long-is-a-slice',
        title: 'How long should a slice be?',
        reset: true,
        cfg: {
          cores: 1,
          procs: [SERVER([t('a1'), t('a2')]), BACKUP([t('b1')]), INDEXER([t('c1')])],
          gantt: true,
          queue: true,
          slice: 1.2,
        },
        body: (
          <>
            <p>Four threads share one core. Drag the slider and watch two numbers pull against each other.</p>
            <p>
              <strong>Short slices</strong> keep everyone responsive: no thread waits long for its next turn. But more of the core&apos;s time goes to
              switching instead of useful work. <strong>Long slices</strong> waste less, but a thread that just missed its turn waits and waits: the
              frozen app, the laggy cursor.
            </p>
            <p>Operating systems settle on slices of a few milliseconds, and adjust them as load changes.</p>
            <Aside>
              The overhead here uses the exaggerated switches you can see. With real numbers (microsecond switches, millisecond slices) the direct cost is
              usually under 1%. The cold caches are the bigger bill.
            </Aside>
          </>
        ),
        interaction: { kind: 'slice' },
        code: {
          title: 'terminal',
          lang: 'shell',
          code: `
$ sudo cat /sys/kernel/debug/sched/base_slice_ns
!3000000     # 3 ms on an 8-core machine (Linux 6.6+)`,
          note: 'Linux scales the default slice with the number of cores. Few people ever change it.',
        },
        hud: ['overhead', 'wait'],
        legend: ['thread', 'tsw', 'psw'],
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'parallel',
    title: 'Concurrency & parallelism',
    steps: [
      {
        id: 'more-cores',
        title: 'More cores: parallelism',
        reset: true,
        cfg: {
          cores: 1,
          procs: [SERVER([t('a1', { work: 5 }), t('a2', { work: 5 })]), BACKUP([t('b1', { work: 5 }), t('b2', { work: 5 })])],
          gantt: true,
          queue: true,
          batch: true,
        },
        body: (
          <>
            <p>Now add cores. Each of these four threads has 5 ms of number crunching to do. Drag the slider.</p>
            <p>
              With one core they take turns: <strong>concurrency</strong>. With four, all four run at the same instant: <strong>parallelism</strong>. The
              same job finishes about four times sooner.
            </p>
            <p>
              Parallelism needs both: several cores, and several threads or processes to keep them busy. A single-threaded program uses one core, even on
              a 64-core machine.
            </p>
          </>
        ),
        interaction: { kind: 'cores' },
        code: {
          title: 'terminal',
          lang: 'shell',
          code: `
$ nproc
4
$ top -H -p 4127        # one row per thread, trimmed
  PID USER   %CPU COMMAND
!4127 alice  99.7 crunch
!4128 alice  99.3 crunch
!4129 alice  99.0 crunch
!4130 alice  98.8 crunch`,
          note: 'Four threads, each keeping a whole core busy. Without -H, top shows the process at about 400% CPU.',
        },
        hud: ['batch', 'running'],
        legend: ['thread', 'tsw', 'psw'],
      },
      {
        id: 'waiting-on-io',
        title: 'Waiting doesn’t need a core',
        reset: true,
        cfg: {
          cores: 1,
          procs: [SERVER([t('a1'), t('a2', { burst: 0.5, io: 2.6 }), t('a3', { burst: 0.8, io: 2.1 })])],
          gantt: true,
          queue: true,
          disk: true,
          table: true,
        },
        body: (
          <>
            <p>
              Most threads spend most of their lives waiting: for a disk, a database, a reply from across the internet. A fast SSD read takes tens of
              microseconds, enough for a core to run hundreds of thousands of instructions. A network round trip often takes tens of milliseconds: tens of
              millions of instructions.
            </p>
            <p>
              So when a thread makes a blocking call like <code>read()</code>, the kernel marks it <strong>blocked</strong> and hands the core to someone
              else. When the <Term k="disk">disk</Term> finishes, an interrupt wakes the thread and it rejoins the ready queue.
            </p>
            <p>That&apos;s how a server juggles hundreds of threads on a handful of cores: at any moment, most of them are asleep.</p>
          </>
        ),
        interaction: { kind: 'io' },
        code: {
          title: 'terminal',
          lang: 'shell',
          code: `
$ vmstat 1          # columns trimmed
 r  b   in   cs us sy id wa
!1  2  812 1904 31  4 45 20`,
          note: 'r: threads running or ready. b: blocked on I/O. cs: context switches per second. wa: % of time the CPU sat idle waiting for I/O.',
        },
        hud: ['util', 'switches'],
        legend: ['thread', 'io', 'tsw'],
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'sharing',
    title: 'Sharing & talking',
    steps: [
      {
        id: 'shared-memory-races',
        title: 'Shared memory: fast, and risky',
        reset: true,
        cfg: {
          cores: 2,
          slice: 60,
          procs: [{ id: 'a', pid: 5120, name: 'counter', globals: 'mu: unused', files: ['0', '1', '2'], heap: 0, threads: [t('a1'), t('a2')] }],
          race: 'nolock',
        },
        body: (
          <>
            <p>
              Sharing memory is what makes threads fast. A1 and A2 can both use <code>hits</code> directly: no copying, no kernel. It&apos;s also what
              makes them dangerous.
            </p>
            <p>
              Both threads add 1 to <code>hits</code>. But <code>hits += 1</code> is three steps: <strong>load</strong> the value into a register, add 1,{' '}
              <strong>store</strong> it back. Each core has its own registers. Watch: both threads load the same value, say 41, both compute 42, and both
              store 42. One increment vanished. That&apos;s a <strong>race condition</strong>.
            </p>
            <p>
              Switch on the mutex: a thread must lock it before touching <code>hits</code>, so the other waits, off the CPU, until it&apos;s released.
              Correct, a little slower. The Race Conditions lesson goes deeper.
            </p>
          </>
        ),
        interaction: {
          kind: 'toggle',
          prompt: 'Protect hits with a lock?',
          initial: 0,
          options: [
            { label: 'No lock', apply: (s) => s.setRace('nolock'), note: <>Every round, two increments go in and <strong>hits grows by only 1</strong>.</> },
            {
              label: 'With a mutex',
              apply: (s) => s.setRace('lock'),
              note: (
                <>
                  A2 finds the mutex held and <strong>blocks</strong>: it leaves the CPU until A1 unlocks. Two increments, +2 every time.
                </>
              ),
            },
          ],
        },
        code: {
          title: 'counter.c',
          lang: 'c',
          code: `
struct stats *st = malloc(sizeof *st);   // on the heap:
                                         // every thread sees it
void *worker(void *arg) {
!    pthread_mutex_lock(&mu);
!    st->hits += 1;          // load, add 1, store
!    pthread_mutex_unlock(&mu);
    return NULL;
}`,
        },
        hud: ['race'],
        legend: ['mem', 'store', 'lost', 'lock'],
      },
      {
        id: 'processes-talk-through-the-kernel',
        title: 'Processes talk through the kernel',
        reset: true,
        cfg: {
          cores: 2,
          slice: 60,
          kernel: true,
          ipc: true,
          procs: [
            { id: 'a', pid: 6010, name: 'web', globals: 'orders = 1041', heap: 1, threads: [t('a1')] },
            { id: 'b', pid: 6011, name: 'mailer', globals: 'sent = 1040', heap: 1, threads: [t('b1')] },
          ],
        },
        body: (
          <>
            <p>
              Processes can&apos;t share memory by accident, so to cooperate they must ask the <Term k="kernel">kernel</Term>. That&apos;s{' '}
              <strong>inter-process communication</strong>, or IPC.
            </p>
            <p>
              Here <code>web</code> sends each new order to <code>mailer</code> through a <strong>pipe</strong>. <code>write()</code> copies the bytes from
              web&apos;s memory into a kernel buffer; <code>read()</code> copies them out into mailer&apos;s. Two system calls and two copies for every
              message: slower than threads touching the same object, but neither process can corrupt the other.
            </p>
            <p>
              Other kinds of IPC: <strong>sockets</strong> (which also work between machines), <strong>message queues</strong>, and{' '}
              <strong>shared memory</strong> segments that two processes map on purpose. Those are fast, and bring back the locking problems of threads.
            </p>
          </>
        ),
        code: {
          title: 'orders.py',
          lang: 'python',
          code: `
from multiprocessing import Process, Queue

def mailer(q):
    while True:
!        order = q.get()        # read() from a pipe, unpickle
        send_email(order)

q = Queue()
Process(target=mailer, args=(q,)).start()
!q.put({"order": 1041})         # pickle, write() into the pipe`,
        },
        hud: ['ipc'],
        legend: ['msg'],
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'crashes',
    title: 'When things crash',
    steps: [
      {
        id: 'blast-radius',
        title: 'Blast radius',
        reset: true,
        cfg: {
          cores: 2,
          table: true,
          procs: [SERVER([t('a1', { role: 'main' }), t('a2', { role: 'worker' }), t('a3', { role: 'worker' })]), BACKUP([t('b1'), t('b2')])],
        },
        predict: { kind: 'crash', rounds: 1, prompt: 'A thread is about to crash. How much goes down with it?' },
        crashMode: true,
        body: (
          <>
            <p>
              What happens when one thread crashes? Say <Term k="tok:a2">A2</Term> follows a null pointer. The CPU faults, and the kernel sends process A
              the signal <code>SIGSEGV</code>, a segmentation fault.
            </p>
            <p>Predict the damage before it happens.</p>
            <p>
              Afterwards, try it yourself: <strong>click any thread</strong> to make it crash, or <strong>click a process</strong> to kill it.
            </p>
          </>
        ),
        afterPredict: {
          kind: 'actions',
          buttons: [
            { label: 'Crash thread B1', icon: 'power', run: (s) => s.crashThread('b1'), after: <>B1 took B2 with it. Thread crash, process crash.</> },
            { label: 'Restart everything', icon: 'replay', run: (s) => s.restartAll() },
          ],
        },
        code: {
          title: 'terminal',
          lang: 'shell',
          code: `
$ ./server
!Segmentation fault (core dumped)
$ dmesg | tail -1
server[4128]: segfault at 0 ip 000055d0c3a1b2f4
  sp 00007f3b2bffee40 error 4 in server`,
          note: 'The kernel log names the thread that faulted (4128 is A2). The whole process went down with it.',
        },
        hud: ['alive'],
        legend: ['thread', 'crash'],
      },
      {
        id: 'chrome-uses-processes',
        title: 'Why Chrome uses processes',
        reset: true,
        cfg: { cores: 2, procs: CHROME, crashable: true },
        crashMode: true,
        body: (
          <>
            <p>
              Chrome is built on this idea. The <Term k="proc:a">browser process</Term> runs the window and coordinates everything. Every site gets its
              own <Term k="proc:c">renderer process</Term> to run its HTML and JavaScript, and a <Term k="proc:b">GPU process</Term> puts pixels on
              screen. Helpers such as the network service get processes of their own too.
            </p>
            <p>
              Why pay for so many processes? When a page crashes, you get &ldquo;Aw, Snap!&rdquo; in that one tab and nothing else. And with{' '}
              <strong>Site Isolation</strong>, a malicious page can&apos;t read another site&apos;s memory, even using a CPU bug like Spectre: it&apos;s in
              a different address space.
            </p>
            <p>
              <strong>Try it:</strong> click a renderer to crash it. Then try the browser process.
            </p>
          </>
        ),
        code: {
          title: 'terminal',
          lang: 'shell',
          code: `
$ ps -o pid,args -C chrome   # trimmed
  PID COMMAND
 2201 /opt/google/chrome/chrome
 2240 /opt/google/chrome/chrome --type=gpu-process
!2305 /opt/google/chrome/chrome --type=renderer
!2311 /opt/google/chrome/chrome --type=renderer`,
        },
        hud: ['alive'],
        legend: ['thread', 'wait', 'crash'],
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'real-world',
    title: 'Real-world choices',
    steps: [
      {
        id: 'databases-and-web-servers',
        title: 'Databases and web servers',
        reset: true,
        cfg: { cores: 2, procs: POSTGRES },
        body: (
          <>
            <p>Servers make the same trade-off, and famous ones chose differently.</p>
            <p>
              <strong>PostgreSQL</strong> forks a new process for every client connection. Each backend costs a few megabytes and a fork, so busy apps put
              a pooler like PgBouncer in front. <strong>MySQL</strong> runs one <code>mysqld</code> process with a thread per connection: cheaper
              connections, one shared address space.
            </p>
            <p>
              <strong>nginx</strong> runs a few worker processes, usually one per core, and each worker juggles thousands of connections with an event
              loop instead of a thread per connection.
            </p>
            <Aside>
              Postgres backends aren&apos;t fully isolated: they share a memory segment of cached pages. If one crashes, the postmaster restarts all of
              them, in case that memory was damaged.
            </Aside>
          </>
        ),
        interaction: {
          kind: 'toggle',
          prompt: 'Look inside:',
          initial: 0,
          options: [
            {
              label: 'PostgreSQL',
              apply: (s) => s.load(POSTGRES, { cores: 2 }),
              note: <>The postmaster (asleep until someone connects) and one backend process per client: Alice, Bob and Carol.</>,
              code: {
                title: 'terminal',
                lang: 'shell',
                code: `
$ ps -o pid,nlwp,args -C postgres   # trimmed
  PID NLWP COMMAND
  812    1 postgres -D /var/lib/postgresql/data
  815    1 postgres: checkpointer
!2201    1 postgres: alice shop 192.0.2.10(52144) idle
!2202    1 postgres: bob shop 192.0.2.11(40718) SELECT
!2203    1 postgres: carol shop 192.0.2.12(51002) idle`,
              },
            },
            {
              label: 'MySQL',
              apply: (s) => s.load(MYSQL, { cores: 2 }),
              note: <>One process. Each connection (Alice&apos;s, Bob&apos;s, Carol&apos;s) is a thread in it, plus background threads for disk I/O.</>,
              code: {
                title: 'terminal',
                lang: 'shell',
                code: `
$ ps -o pid,nlwp,args -C mysqld
  PID NLWP COMMAND
!1044   41 /usr/sbin/mysqld`,
              },
            },
            {
              label: 'nginx',
              apply: (s) => s.load(NGINX, { cores: 2 }),
              note: <>A master process that only manages, and one single-threaded worker per core.</>,
              code: {
                title: 'nginx.conf',
                lang: 'nginx',
                code: `
!worker_processes auto;       # one worker per core
events {
!    worker_connections 4096; # per worker, via epoll
}`,
              },
            },
          ],
        },
        hud: ['running'],
        legend: ['thread', 'wait', 'sleep'],
      },
      {
        id: 'python-and-node',
        title: 'Python’s GIL, and Node',
        reset: true,
        cfg: { cores: 4, procs: PY_THREADS, gantt: true, batch: true, slice: 1.0 },
        body: (
          <>
            <p>
              Languages add their own twist. <strong>CPython</strong> has a Global Interpreter Lock, the <strong>GIL</strong>: only the thread holding
              it may run Python code. Four threads on four cores still take turns. Watch the timeline and the lock on the process.
            </p>
            <p>
              For CPU-heavy Python, use processes: <code>multiprocessing</code> starts separate interpreters, each with its own GIL, and they truly run in
              parallel. Threads still pay off for I/O, because the GIL is released while a thread waits.
            </p>
            <p>
              <strong>Node.js</strong> runs your JavaScript on one thread with an event loop. For CPU-heavy work, <code>worker_threads</code> adds real
              threads, each with its own JavaScript heap; they talk by passing messages.
            </p>
            <Aside>
              Python 3.13 added an optional free-threaded build without the GIL; the default interpreter still has one. Teaser: Go&apos;s goroutines and
              Java&apos;s virtual threads multiplex many lightweight threads onto a few OS threads, and async/await does something similar with an event
              loop (see the Event Loop lesson).
            </Aside>
          </>
        ),
        interaction: {
          kind: 'toggle',
          prompt: 'Crunch numbers four ways at once with:',
          initial: 0,
          options: [
            {
              label: 'threading',
              apply: (s) => s.load(PY_THREADS, { cores: 4, batch: true }),
              note: <>One process, one GIL. <strong>Only one thread runs at a time</strong>, so the job takes as long as doing it alone.</>,
              code: { title: 'crunch.py', lang: 'python', code: PY_THREAD_CODE },
            },
            {
              label: 'multiprocessing',
              apply: (s) => s.load(PY_PROCS, { cores: 4, batch: true }),
              note: <>Four processes, four GILs. <strong>All four cores busy</strong>: about four times faster.</>,
              code: { title: 'crunch.py', lang: 'python', code: PY_PROC_CODE },
            },
          ],
        },
        code: {
          title: 'main.js',
          lang: 'js',
          code: `
const { Worker } = require('node:worker_threads');

!const w = new Worker('./crunch.js', { workerData: 1e7 });
w.on('message', (sum) => console.log(sum));  // copied, not shared`,
        },
        hud: ['batch', 'running'],
        legend: ['thread', 'gil', 'tsw', 'psw'],
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
        reset: true,
        cfg: {
          cores: 2,
          procs: [SERVER([t('a1'), t('a2', { burst: 0.9, io: 2.2 }), t('a3')]), BACKUP([t('b1', { burst: 1.2, io: 1.8 })])],
          gantt: true,
          queue: true,
          disk: true,
          table: true,
        },
        body: (
          <p>
            Everything in one picture: two processes, four threads, two cores, a scheduler handing out slices, and threads stepping aside to wait for the
            disk.
          </p>
        ),
        extra: <CheatSheet />,
        hud: ['switches', 'util'],
        legend: ['thread', 'io', 'tsw', 'psw'],
      },
      {
        id: 'playground',
        title: 'Playground',
        reset: true,
        cfg: {
          cores: 2,
          procs: [SERVER([t('a1'), t('a2')]), BACKUP([t('b1')])],
          gantt: true,
          queue: true,
          disk: true,
          crashable: true,
          table: true,
        },
        crashMode: true,
        body: (
          <p>
            Your own little operating system. Add cores, processes and threads, change the time slice, make threads wait on the disk, and click anything
            on the stage to crash it. Then take on the challenges.
          </p>
        ),
        interaction: { kind: 'playground' },
        hud: ['running', 'overhead', 'wait', 'alive'],
        legend: ['thread', 'io', 'tsw', 'psw', 'crash'],
      },
    ],
  },
];
