import type { ReactNode } from 'react';
import type { CodeSpec } from '@/components/lesson/CodeBlock';
import type { IconName } from '@/components/lesson/Icon';
import { Aside } from '@/components/lesson/Prose';
import type { QuizSpec } from '@/components/lesson/QuizCard';
import { Term } from '@/components/lesson/Term';
import type { Callout } from '@/components/stage/overlays';
import type { HudKey, LegendKey } from './Overlay';
import { CheatSheet } from './Panels';
import { ALIAS, DANGLE, FACT, FRAG, LEAK, LIST, PLAYGROUND, POINTERS, SANDBOX, SCORES, UAF, WHERE, copies, leakLoop, safety, squares } from './programs';
import type { Cfg, MemSim } from './sim';

export const META = { slug: 'stack-heap', code: 'CS-04', track: 'Computer science', title: 'Stack vs Heap' };

export interface Step {
  id: string;
  title: string;
  body: ReactNode;
  cfg: Partial<Cfg>;
  predict?: { needed: number; prompt: ReactNode };
  actions?: { kicker?: string; prompt?: ReactNode; buttons: { label: string; icon?: IconName; run: (s: MemSim) => void; after?: ReactNode }[] };
  toggle?: { prompt: ReactNode; initial?: number; options: { label: string; apply: (s: MemSim) => void; note?: ReactNode }[] };
  depthSlider?: boolean;
  playground?: boolean;
  quiz?: QuizSpec;
  code?: CodeSpec;
  extra?: ReactNode;
  focus?: ('stack' | 'heap')[];
  callouts?: Callout[];
  hud?: HudKey[];
  legend?: LegendKey[];
  breakPrompt?: string;
}

export interface Chapter {
  id: string;
  title: string;
  steps: Step[];
}

const STEPPER = (after?: ReactNode): Step['actions'] => ({
  kicker: 'Try it',
  prompt: 'Take the controls and run it one line at a time.',
  buttons: [
    { label: 'Next line', icon: 'right', run: (s) => s.next(), after: after ?? <>Each press runs one line. The highlighted line is the one that just ran; the caption says what it did.</> },
    { label: 'Run', icon: 'play', run: (s) => s.play() },
    { label: 'Restart', icon: 'replay', run: (s) => s.restart() },
  ],
});

export const CHAPTERS: Chapter[] = [
  /* ================================================================ */
  {
    id: 'memory',
    title: 'Your program’s memory',
    steps: [
      {
        id: 'memory-map',
        title: 'A map of memory',
        cfg: { view: 'map', program: null, reveal: true, console: false },
        body: (
          <>
            <p>
              When your program runs, the operating system gives it its own <strong>address space</strong>: a huge row of numbered bytes, from{' '}
              <code>0x0</code> up to <code>0x7fffffffffff</code> on 64-bit Linux. Every variable, every function and every string lives at some
              address in that range.
            </p>
            <p>
              The space is split into regions. Low down sits the <Term k="seg:text">text</Term> segment, your compiled machine code, and the{' '}
              <Term k="seg:data">data</Term> segment for global variables. Just above them is the <Term k="seg:heap">heap</Term>, which grows{' '}
              <em>up</em>. Far away at the top is the <Term k="seg:stack">stack</Term>, which grows <em>down</em>.
            </p>
            <p>This lesson is about those two: where your variables live, how long they live, and what breaks when you get it wrong.</p>
            <Aside>
              Not to scale. About 46 terabytes of addresses lie between the heap and the stack, nearly all of them unmapped. Even mapped memory only
              gets real RAM when a page is first touched.
            </Aside>
          </>
        ),
        code: {
          title: 'the memory map of a running process',
          lang: 'shell',
          code: `$ cat /proc/self/maps
55a3c7a4b000-55a3c7a4c000 r-xp  /usr/bin/cat   # text
55a3c7a4e000-55a3c7a4f000 rw-p  /usr/bin/cat   # data
!55a3c8e2f000-55a3c8e50000 rw-p  [heap]
7f3b2a428000-7f3b2a5bd000 r-xp  libc.so.6
!7ffd5e8a5000-7ffd5e8c6000 rw-p  [stack]`,
          note: 'Linux shows any process’s map in /proc/<pid>/maps (trimmed here). r-x means readable and executable, rw- readable and writable.',
        },
      },
      {
        id: 'where-things-live',
        title: 'Every variable has an address',
        cfg: { view: 'map', program: WHERE },
        body: (
          <>
            <p>
              Let’s prove it. This C program prints the addresses of four things: the function <code>main</code>, a global, a block from{' '}
              <code>malloc</code>, and a local variable. <code>%p</code> prints a pointer, and a pointer is just an address.
            </p>
            <p>
              Watch where each one lands. The code and the global sit low, around <code>0x55a3c7…</code>. The heap block is just above them. The
              local <code>x</code> lives way up at <code>0x7ffd…</code>, inside <Term k="seg:stack">main’s stack frame</Term>.
            </p>
            <p>An address is only a number. The rest of this lesson is about who owns the bytes at that number, and for how long.</p>
            <Aside>
              Run it again and the numbers change: ASLR (address space layout randomization) moves each region to a random base on every run, to make
              attacks harder. The layout stays the same.
            </Aside>
          </>
        ),
        quiz: {
          question: (
            <>
              Which of these could be the address of a <strong>local variable</strong>?
            </>
          ),
          options: [
            { text: <code>0x55a3c7a4e010</code>, why: 'That one is right next to the program’s code: the data segment, where globals live.' },
            { text: <code>0x55a3c8e2f2a0</code>, why: 'That is in the heap, just above the program. malloc hands out addresses like this.' },
            { text: <code>0x7ffd5e8c3b4c</code>, correct: true, why: 'Locals live in stack frames, and the stack sits at the very top of the address space: 0x7ffd…' },
          ],
        },
        code: {
          title: 'two runs of the same program',
          lang: 'shell',
          code: `$ ./where
0x55a3c7a4b1a9
0x55a3c7a4e010
0x55a3c8e2f2a0
0x7ffd5e8c3b4c
$ ./where        # again: new bases, same layout
!0x5612f0e161a9
!0x5612f0e19010
!0x5612f2b3f2a0
!0x7ffc1b2d7e0c`,
        },
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'stack',
    title: 'The call stack',
    steps: [
      {
        id: 'calls-push-frames',
        focus: ['stack'],
        title: 'Every call pushes a frame',
        cfg: { program: squares() },
        body: (
          <>
            <p>
              Here is a tiny program with three functions. Watch the <Term k="stack">stack</Term> as it runs.
            </p>
            <p>
              Each time a function is called, it gets a <strong>stack frame</strong>: a small block of memory for its parameters and local variables.
              The new frame goes right below the caller’s, at lower addresses. When the function returns, its frame is removed. <code>main</code>{' '}
              calls <code>sum_sq</code>, which calls <code>square</code> twice, so the stack grows and shrinks like a pile of plates: last in, first
              out.
            </p>
            <p>
              The yellow <Term k="sp">SP</Term> marker is the <strong>stack pointer</strong>, a CPU register (<code>rsp</code> on x86-64) that marks
              the end of the newest frame. Pushing a frame is a subtraction from SP. Popping is an addition.
            </p>
          </>
        ),
        actions: STEPPER(),
        code: {
          title: 'gcc -S squares.c (x86-64)',
          lang: 'conf',
          code: `sum_sq:
    pushq   %rbp          # save the caller's frame pointer
    movq    %rsp, %rbp
!    subq    $16, %rsp     # the frame: room for a, b, x, y
    ...
!    call    square        # push the return address, jump`,
          note: 'Making a frame is ordinary arithmetic on the stack pointer. No allocator is involved.',
        },
        callouts: [{ target: 'L:frame:main', text: <>one <b>frame</b> per active call</>, dir: 'right' }],
        hud: ['frames', 'sp', 'stack'],
        legend: ['arg', 'ret', 'sp'],
      },
      {
        id: 'inside-a-frame',
        focus: ['stack'],
        title: 'What’s inside a frame',
        cfg: { program: squares({ pause: true }), detail: 'full' },
        breakPrompt: 'Paused inside square(3)',
        body: (
          <>
            <p>
              The program is paused inside <code>square(3)</code>, so let’s open its frame. From the top, the higher addresses, down:
            </p>
            <p>
              The <Term k="bk">return address</Term> says where to continue in <code>sum_sq</code> once <code>square</code> is done. The{' '}
              <code>call</code> instruction pushed it. The <strong>saved rbp</strong> is the caller’s frame pointer, kept so it can be restored on the
              way out. Below them sit the parameter <code>n</code> and the local <code>r</code>, each at its own address.
            </p>
            <p>
              The compiler fixed all of this at compile time: every local sits at a known offset in the frame, so reaching <code>r</code> is a single
              instruction like <code>movl -8(%rbp), %eax</code>. That is why stack variables are so cheap.
            </p>
            <Aside>
              Real layouts vary by compiler, CPU and optimization level. On x86-64 the first six integer arguments arrive in registers; unoptimized code
              copies them into the frame, as drawn here. Optimized code keeps many locals in registers and never touches the stack for them.
            </Aside>
          </>
        ),
        actions: STEPPER(<>Step on to watch <code>square</code> return: the return address is how the CPU finds its way back into <code>sum_sq</code>.</>),
        code: {
          title: 'gdb: the frames right now',
          lang: 'c',
          code: `(gdb) bt
!#0  square (n=3) at squares.c:3
#1  0x000055a3c7a4b1d6 in sum_sq (a=3, b=4) at squares.c:7
#2  0x000055a3c7a4b21f in main () at squares.c:13`,
          note: 'bt (backtrace) lists the frames from the newest down to main. The hex numbers are the saved return addresses.',
        },
        callouts: [{ target: 'L:bk', text: <>where to <b>jump back</b> to in the caller</>, dir: 'right' }],
        hud: ['frames', 'sp'],
        legend: ['arg', 'ret', 'sp'],
      },
      {
        id: 'return-pops',
        focus: ['stack'],
        title: 'Returning is instant',
        cfg: { program: squares({ ask: true }), ghosts: true },
        predict: { needed: 1, prompt: 'square(3) just returned. Where will the next call put its frame?' },
        body: (
          <>
            <p>
              When <code>square(3)</code> returns, nothing is erased. SP simply moves back up, and everything below it counts as free. The old frame is
              still sitting there, drawn dashed, bytes and all. It is <strong>dead</strong>: nothing is supposed to read it anymore.
            </p>
            <p>
              That is the whole trick of the stack. Allocating is one subtraction, freeing is one addition, and the top of the stack is reused so often
              that it is almost always in the CPU’s cache. No searching, no bookkeeping, nothing to forget.
            </p>
            <p>
              The program freezes at the second call. <strong>Predict where <code>square(4)</code>’s frame will go.</strong>
            </p>
            <Aside>
              Look at <code>r</code> in the new frame before it is assigned: it shows <code>9?</code>. In C, an uninitialized local holds whatever
              bytes were left there, in this case by <code>square(3)</code>.
            </Aside>
          </>
        ),
        code: {
          title: 'gcc -S: the end of square',
          lang: 'conf',
          code: `    movl    -8(%rbp), %eax   # the return value goes in eax
!    leave                    # rsp = rbp, pop rbp
!    ret                      # pop the return address, jump back`,
          note: 'Popping a frame takes two instructions. The bytes stay behind until the next call overwrites them.',
        },
        callouts: [{ target: 'L:ghost', text: <>popped, but <b>the bytes remain</b></>, dir: 'right' }],
        hud: ['frames', 'sp'],
        legend: ['arg', 'ret', 'sp'],
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'recursion',
    title: 'Recursion and overflow',
    steps: [
      {
        id: 'recursion',
        focus: ['stack'],
        title: 'Recursion stacks up',
        cfg: { program: FACT },
        body: (
          <>
            <p>
              A recursive function calls itself, and <strong>every call gets its own frame</strong> with its own copy of <code>n</code>.{' '}
              <code>fact(4)</code> can’t finish until <code>fact(3)</code> does, which waits on <code>fact(2)</code>, and so on. Four{' '}
              <code>fact</code> frames pile up before anything returns.
            </p>
            <p>
              Once <code>fact(1)</code> hits the base case, the stack <strong>unwinds</strong>: each frame gets a value back, finishes its
              multiplication, returns and disappears. Frames come off in exactly the reverse order they went on.
            </p>
            <p>The deeper the recursion, the more frames exist at the same time. Which raises a question: how deep can it go?</p>
          </>
        ),
        code: {
          title: 'gdb: at the deepest point',
          lang: 'c',
          code: `(gdb) bt
#0  fact (n=1) at fact.c:3
!#1  0x000055a3c7a4b16e in fact (n=2) at fact.c:4
!#2  0x000055a3c7a4b16e in fact (n=3) at fact.c:4
!#3  0x000055a3c7a4b16e in fact (n=4) at fact.c:4
#4  0x000055a3c7a4b19a in main () at fact.c:8`,
          note: 'The same return address three times: every fact returns to the same spot inside fact.',
        },
        callouts: [{ target: 'L:frame:fact', text: <>each call has its <b>own n</b></>, dir: 'right' }],
        hud: ['frames', 'stack'],
        legend: ['arg', 'ret', 'sp'],
      },
      {
        id: 'stack-overflow',
        title: 'Stack overflow',
        cfg: { view: 'overflow', program: null, depth: 50000, info: 'overflow' },
        depthSlider: true,
        body: (
          <>
            <p>
              The stack has a fixed maximum size, set when the thread starts. On Linux the main thread gets <strong>8 MB</strong> by default (
              <code>ulimit -s</code>), on Windows <strong>1 MB</strong>, and other threads can get less (512 KB on macOS).
            </p>
            <p>
              Each <code>dive</code> frame here is 64 bytes, so 8 MB holds about 131,000 of them. Plenty for normal code, not for runaway recursion.
              Drag the slider past the limit, or remove the base case, and see what happens when the next frame has nowhere to go.
            </p>
            <p>
              Right after the end of the stack sits a <Term k="guard">guard page</Term> that belongs to no one. The first write into it causes a
              segmentation fault, and the process dies: a <strong>stack overflow</strong>. Managed languages count frames themselves and throw an error
              instead, like JavaScript’s <code>RangeError</code> or Python’s <code>RecursionError</code>.
            </p>
            <Aside>The fix is rarely a bigger stack. Turn deep recursion into a loop, or keep your own stack of pending work on the heap.</Aside>
          </>
        ),
        actions: {
          kicker: 'Break it',
          buttons: [
            {
              label: 'Remove the base case',
              icon: 'x',
              run: (s) => s.setNoBase(true),
              after: (
                <>
                  Without a base case <code>dive</code> never stops calling itself. It burns through 8 MB in a few milliseconds and hits the guard page.
                </>
              ),
            },
            { label: 'Put it back', icon: 'replay', run: (s) => s.setNoBase(false) },
          ],
        },
        code: {
          title: 'the same crash, three languages',
          lang: 'shell',
          code: `$ ulimit -s        # stack limit, in KB
8192
$ ./dive
!Segmentation fault (core dumped)
$ node -e 'const f = () => f(); f()'
!RangeError: Maximum call stack size exceeded
$ python3 -c 'import sys; print(sys.getrecursionlimit())'
1000`,
          note: 'Node’s default stack is just under 1 MB. Python stops at 1,000 nested calls with RecursionError: maximum recursion depth exceeded.',
        },
        hud: ['depth', 'used'],
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'heap',
    title: 'The heap',
    steps: [
      {
        id: 'outlive',
        title: 'Data that outlives its function',
        cfg: { program: SCORES },
        body: (
          <>
            <p>
              The stack only suits data that dies when its function returns. Sometimes a function must create something that{' '}
              <strong>outlives it</strong>, or whose size isn’t known until the program runs. <code>make_scores(n)</code> builds an array of{' '}
              <code>n</code> ints for its caller.
            </p>
            <p>
              That is what the <Term k="heap">heap</Term> is for. <code>malloc(16)</code> asks the allocator for 16 bytes and gets back their address.
              The block isn’t tied to any frame: it stays until someone calls <code>free</code>. The local <code>s</code> holds only the address, a{' '}
              <strong>pointer</strong>, drawn as an arrow.
            </p>
            <p>
              Watch the return. <code>make_scores</code>’s frame disappears, and <code>s</code> with it, but the block survives because its address
              was handed to <code>main</code>. When <code>main</code> is done with it, it calls <code>free</code> and sets the pointer to{' '}
              <code>NULL</code>.
            </p>
          </>
        ),
        quiz: {
          question: (
            <>
              Why can’t <code>make_scores</code> declare <code>int s[4]</code> and <code>return s</code>?
            </>
          ),
          options: [
            { text: 'Arrays are too big for the stack', why: '16 bytes is tiny: the stack holds megabytes. Size isn’t the problem here.' },
            {
              text: 'The array would live in make_scores’s own frame, which is popped when it returns',
              correct: true,
              why: 'main would receive the address of a dead frame, and the next call would overwrite it. You’ll watch exactly that bug later in this lesson.',
            },
            {
              text: 'C can’t return arrays',
              why: 'C won’t copy an array out, true, but return s still compiles: it returns a pointer to the first element. The real problem is where that element lives.',
            },
          ],
        },
        code: {
          title: 'scores.cpp: the same thing in C++',
          lang: 'c',
          code: `std::vector<int> make_scores(int n) {
!    std::vector<int> s(n);   // the ints live on the heap
    for (int i = 0; i < n; i++) s[i] = i * 10;
    return s;                // moved out, freed later
}`,
          note: 'std::vector keeps its elements on the heap and frees them in its destructor, so you never call free yourself.',
        },
        callouts: [{ target: 'L:block', text: <>lives until <b>free()</b>, not until return</>, dir: 'left' }],
        hud: ['frames', 'heap'],
        legend: ['ptr', 'malloc', 'ret', 'free', 'dangling'],
      },
      {
        id: 'malloc-and-free',
        title: 'malloc and free',
        cfg: { program: SANDBOX, sandbox: true, scan: true, console: false, info: 'alloc', loop: false, auto: false },
        body: (
          <>
            <p>
              The heap is a big region of bytes, and <code>malloc</code> has to find room in it. Every <code>malloc</code> returns the address of a
              block; every <code>free</code> turns a block back into a <strong>hole</strong>.
            </p>
            <p>
              The allocator keeps a list of those holes. On each request it searches for one that is big enough (the rings on the stage), takes what
              it needs, and hands you the address. If nothing fits, it extends the heap at the top. Neighbouring holes are merged.
            </p>
            <p>
              That search is why heap allocation costs more than the stack’s single subtraction: usually tens of nanoseconds, now and then a system
              call. Busy programs make millions of allocations, so it adds up.
            </p>
            <Aside>
              Simplified. Real allocators round each block up (glibc to multiples of 16 bytes) and hide a small header in front of it, keep separate
              lists per size, and reuse the most recently freed block first. Very large requests get their own pages straight from the kernel.
            </Aside>
          </>
        ),
        actions: {
          kicker: 'Try it',
          prompt: 'Allocate and free. Can you make a request that has to skip over a hole?',
          buttons: [
            { label: 'malloc(32)', icon: 'plus', run: (s) => s.sbMalloc(32) },
            { label: 'malloc(64)', icon: 'plus', run: (s) => s.sbMalloc(64) },
            { label: 'free the oldest', icon: 'minus', run: (s) => s.sbFreeOldest() },
            { label: 'Start over', icon: 'replay', run: (s) => s.restart() },
          ],
        },
        code: {
          title: 'strace: where heap memory comes from',
          lang: 'shell',
          code: `$ strace -e trace=brk ./heap
!brk(NULL)                = 0x55a3c8e2f000
!brk(0x55a3c8e50000)      = 0x55a3c8e50000`,
          note: 'The first malloc moves the program break up by 132 KB. Most later mallocs are served from that space without asking the kernel again.',
        },
        hud: ['heap'],
        legend: ['malloc', 'ptr', 'free', 'hole'],
      },
      {
        id: 'fragmentation',
        title: 'Fragmentation',
        cfg: { program: FRAG, scan: true, console: false, info: 'alloc' },
        predict: { needed: 1, prompt: 'Two frees left 64 bytes free. Will malloc(48) fit into a hole?' },
        body: (
          <>
            <p>
              Free blocks in a different order than you allocated them and the heap fills with holes. Here <code>a</code> and <code>c</code> are freed,
              but <code>b</code> still sits between them.
            </p>
            <p>
              That is <strong>fragmentation</strong>: plenty of free memory in total, just not in one piece. The program freezes before{' '}
              <code>malloc(48)</code>. <strong>Predict what the allocator does.</strong>
            </p>
            <p>
              Once <code>b</code> is freed too, the three neighbours merge into one 96-byte hole, and the next <code>malloc(48)</code> fits right at the
              bottom. Long-running servers fight this all the time, which is why allocators like jemalloc and mimalloc exist.
            </p>
          </>
        ),
        code: {
          title: 'redis-cli: a fragmented heap in production',
          lang: 'conf',
          code: `127.0.0.1:6379> INFO memory
used_memory_human:1.02G
used_memory_rss_human:1.48G
!mem_fragmentation_ratio:1.45
mem_allocator:jemalloc-5.3.0`,
          note: 'Redis holds 1.48 GB of RAM to store 1.02 GB of data: 45% overhead, mostly holes.',
        },
        hud: ['heap'],
        legend: ['malloc', 'ptr', 'free', 'hole'],
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'pointers',
    title: 'Pointers and references',
    steps: [
      {
        id: 'pointers',
        title: 'A variable that holds an address',
        cfg: { program: POINTERS },
        body: (
          <>
            <p>
              A <strong>pointer</strong> is a variable whose value is an address. <code>&amp;x</code> means “the address of x”, and <code>*p</code>{' '}
              means “whatever is at the address in p”: follow the arrow.
            </p>
            <p>
              <Term k="slot:p">p</Term> holds <code>0x7ffd5e8c3b4c</code>, the address of <code>x</code>. <code>*p = 7</code> doesn’t change{' '}
              <code>p</code> at all: it follows the arrow and changes <code>x</code>. A pointer can just as well lead into the heap, like{' '}
              <code>h</code>. To the CPU there is no difference: both are 8-byte numbers.
            </p>
            <p>
              This one mechanism is behind references in Java, objects in JavaScript and slices in Go: a small value on the stack, pointing at bigger
              data somewhere else.
            </p>
          </>
        ),
        code: {
          title: 'gdb: a pointer is a number',
          lang: 'c',
          code: `(gdb) print p
$1 = (int *) 0x7ffd5e8c3b4c
(gdb) print *p
$2 = 7
!(gdb) x/4xb p
0x7ffd5e8c3b4c: 0x07  0x00  0x00  0x00`,
          note: 'x/4xb dumps the raw bytes at p: the int 7, stored lowest byte first (little-endian).',
        },
        callouts: [{ target: 'L:slot:p', text: <>p holds <b>x’s address</b></>, dir: 'right' }],
        hud: ['frames', 'heap'],
        legend: ['ptr', 'malloc', 'value'],
      },
      {
        id: 'aliasing',
        title: 'Two names, one object',
        cfg: { program: ALIAS },
        predict: { needed: 2, prompt: 'The program stops at each console.log. What does it print?' },
        body: (
          <>
            <p>
              JavaScript has no <code>malloc</code> and no <code>*</code>, but the same machinery runs underneath. Numbers and other primitives are
              stored <strong>by value</strong>: <code>let b = a</code> copies the number into <code>b</code>’s own slot.
            </p>
            <p>
              Objects always live on the heap, and a variable only holds a <strong>reference</strong> to one. <code>const copy = alice</code> copies
              the reference, not the object. Now two names lead to the same object. That is called <strong>aliasing</strong>.
            </p>
            <p>
              The program freezes at each <code>console.log</code>. <strong>Predict what it prints.</strong>
            </p>
            <Aside>
              JavaScript never shows you addresses; the @ numbers are how Chrome’s heap snapshots label objects. Engines also decide where each value
              really lives. What you can rely on is the behavior: primitives act like copies, objects like shared references. And{' '}
              <code>const</code> only stops the name from being re-pointed; the object itself can still change.
            </Aside>
          </>
        ),
        code: {
          title: 'aliasing in Python',
          lang: 'python',
          code: `a = [1, 2, 3]
!b = a            # the same list, a second name
b.append(4)
!print(a)         # [1, 2, 3, 4]`,
          note: 'Python works the same way: every name is a reference, and lists can be changed in place.',
        },
        hud: ['objects'],
        legend: ['ref', 'new', 'gc'],
      },
      {
        id: 'copying',
        title: 'Copy the reference, or the object?',
        cfg: { program: copies('same') },
        toggle: {
          prompt: 'Pick how copy is made, then compare what alice ends up with:',
          initial: 0,
          options: [
            {
              label: 'copy = alice',
              apply: (s) => s.loadProgram(copies('same')),
              note: (
                <>
                  One object, two names. Both changes hit <code>alice</code>: it prints <code>Bob</code> and <code>99</code>.
                </>
              ),
            },
            {
              label: '{ ...alice }',
              apply: (s) => s.loadProgram(copies('spread')),
              note: (
                <>
                  A new outer object, but <code>stats</code> is still shared. The name stays Alice, the score still becomes 99. This is a{' '}
                  <strong>shallow copy</strong>.
                </>
              ),
            },
            {
              label: 'structuredClone',
              apply: (s) => s.loadProgram(copies('clone')),
              note: (
                <>
                  A <strong>deep copy</strong>: every nested object is duplicated, so <code>alice</code> is untouched. Alice, 10.
                </>
              ),
            },
          ],
        },
        body: (
          <>
            <p>
              So how do you get a real copy? It depends how deep it needs to go. Here <code>alice</code> is an object that holds a reference to a
              second object, <code>stats</code>.
            </p>
            <p>
              Switch between three ways of making <code>copy</code> and watch the heap. The spread syntax <code>{'{ ...alice }'}</code> creates a new
              object but copies each field as it is, so the <code>stats</code> reference is shared. <code>structuredClone</code> follows every
              reference and duplicates the whole tree.
            </p>
            <p>
              Function arguments follow the same rule. Pass an object to a function and it receives a copy of the reference, so it can modify your
              object.
            </p>
          </>
        ),
        code: {
          title: 'the same rule for arguments',
          lang: 'js',
          code: `function rename(user) {
!  user.name = 'Mallory';   // changes the caller's object
}
rename(alice);
console.log(alice.name);   // 'Mallory'`,
        },
        hud: ['objects'],
        legend: ['ref', 'inner', 'new', 'gc'],
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'bugs',
    title: 'When memory goes wrong',
    steps: [
      {
        id: 'leaks',
        title: 'Leaks: losing the last pointer',
        cfg: { program: LEAK },
        toggle: {
          prompt: 'Run it three ways:',
          initial: 0,
          options: [
            { label: 'leak.c', apply: (s) => s.loadProgram(LEAK), note: <>Reassigning <code>p</code> loses the only pointer to the first block.</> },
            {
              label: 'server, no free',
              apply: (s) => s.loadProgram(leakLoop(false)),
              note: <>Each request leaks 64 bytes. Watch the Leaked counter climb: a server that runs for weeks eventually runs out of memory.</>,
            },
            {
              label: 'server with free()',
              apply: (s) => s.loadProgram(leakLoop(true)),
              note: (
                <>
                  With <code>free(buf)</code>, every request reuses the same 64-byte block and memory stays flat.
                </>
              ),
            },
          ],
        },
        body: (
          <>
            <p>
              In C the heap has no idea whether you still need a block. It only knows what you told it: allocated, or freed. Lose every pointer to a
              block without freeing it and the block stays allocated, and now nobody can ever free it. That is a <strong>memory leak</strong>.
            </p>
            <p>
              Here <code>p = malloc(64)</code> runs twice. The second call overwrites the only copy of the first address, and the first block turns
              red: still allocated, but <Term k="leaked">unreachable</Term>.
            </p>
            <p>
              A leak in a short script is harmless, since the OS reclaims everything when the process exits. The damage comes from leaks in code that
              runs over and over, in programs that never exit: servers, browsers, daemons.
            </p>
            <Aside>
              Garbage-collected languages leak too, differently: any object you still reference, say in an ever-growing cache or a forgotten event
              listener, can never be collected.
            </Aside>
          </>
        ),
        code: {
          title: 'valgrind finds the leak',
          lang: 'shell',
          code: `$ valgrind --leak-check=full ./leak
==31337== HEAP SUMMARY:
==31337==     in use at exit: 64 bytes in 1 blocks
==31337==   total heap usage: 2 allocs, 1 frees, 128 bytes allocated
!==31337== 64 bytes in 1 blocks are definitely lost in loss record 1 of 1
==31337==    at 0x4848899: malloc (vg_replace_malloc.c:381)
!==31337==    by 0x109186: main (leak.c:2)`,
        },
        callouts: [{ target: 'L:leaked', text: <>allocated, but <b>unreachable</b></>, dir: 'left' }],
        hud: ['heap', 'leaked'],
        legend: ['ptr', 'malloc', 'free', 'leaked'],
      },
      {
        id: 'use-after-free',
        title: 'Use after free',
        cfg: { program: UAF, loop: false },
        breakPrompt: 'Paused: continue with the buttons',
        body: (
          <>
            <p>
              <code>free(u)</code> gives the block back, but it doesn’t touch <code>u</code>. The variable still holds the old address: a{' '}
              <strong>dangling pointer</strong>, drawn as a red dashed arrow.
            </p>
            <p>
              Nothing stops you from using it. Reading through it returns whatever the block holds now; writing through it corrupts whatever lives
              there now. Once the allocator hands the block to someone else, two unrelated parts of your program share the same bytes without knowing
              it. This <strong>use-after-free</strong> is one of the most exploited bug classes in browsers and operating systems.
            </p>
            <p>The program is paused right after the free. Carry on with the buttons.</p>
            <Aside>
              Setting a pointer to NULL right after freeing it (<code>free(u); u = NULL;</code>) turns later mistakes into an immediate crash instead
              of silent corruption. <code>free(NULL)</code> does nothing, so a second free becomes harmless too.
            </Aside>
          </>
        ),
        actions: {
          kicker: 'Break it',
          prompt: 'u still points at the freed block. Keep using it:',
          buttons: [
            {
              label: 'Read u->name',
              icon: 'right',
              run: (s) => s.runTo(8),
              after: (
                <>
                  Garbage. After <code>free</code>, the allocator keeps its own bookkeeping inside the block, here a pointer for its free list. You just
                  printed those bytes.
                </>
              ),
            },
            {
              label: 'malloc an order',
              icon: 'plus',
              run: (s) => s.runTo(11),
              after: (
                <>
                  <code>malloc(16)</code> handed out the same block again, so <code>o</code> and <code>u</code> now share it. Writing the order’s
                  total changed what <code>u</code> calls its name.
                </>
              ),
            },
            {
              label: 'free both',
              icon: 'x',
              run: (s) => s.runTo(13),
              after: (
                <>
                  A <strong>double free</strong>: the same block freed twice. glibc detects this one and aborts the process. Many double frees go
                  undetected and quietly corrupt the heap instead.
                </>
              ),
            },
            { label: 'Restart', icon: 'replay', run: (s) => s.restart() },
          ],
        },
        code: {
          title: 'AddressSanitizer catches it',
          lang: 'c',
          code: `$ gcc -g -fsanitize=address uaf.c && ./a.out
!==4242==ERROR: AddressSanitizer: heap-use-after-free on address 0x602000000010
READ of size 6 at 0x602000000010 thread T0
    #0 0x7f3b2a47b2c1 in printf
    #1 0x55a3c7a4b2e4 in main uaf.c:8`,
          note: 'Build tests with -fsanitize=address: use-after-free, double free and buffer overflows are reported the moment they happen.',
        },
        hud: ['heap'],
        legend: ['ptr', 'dangling', 'malloc', 'free'],
      },
      {
        id: 'dangling-stack',
        focus: ['stack'],
        title: 'Returning a local’s address',
        cfg: { program: DANGLE, ghosts: true },
        predict: { needed: 1, prompt: 'c points into a frame that no longer exists. What does printf print?' },
        body: (
          <>
            <p>
              The stack has its own version of this bug. <code>make_counter</code> returns <code>&amp;count</code>, the address of its own local. The
              address itself is fine. The problem is that the frame it points into is popped the moment the function returns.
            </p>
            <p>
              <code>c</code> now points below SP, into <Term k="ghost">dead memory</Term>. The next call, <code>other()</code>, gets exactly the same
              addresses and writes its own local there. <strong>Predict what <code>*c</code> reads.</strong>
            </p>
            <p>
              Compilers warn about the simple cases, like the one below, but not when the address escapes in a roundabout way, say through a struct
              field. The rule: never let a pointer to a local outlive its function.
            </p>
          </>
        ),
        code: {
          title: 'clang warns, then prints 1234 anyway',
          lang: 'shell',
          code: `$ clang dangle.c
!dangle.c:3:13: warning: address of stack memory associated with local
!      variable 'count' returned [-Wreturn-stack-address]
    3 |     return &count;
      |             ^~~~~
$ ./a.out
1234`,
          note: 'GCC warns too (-Wreturn-local-addr) and quietly returns NULL instead, so its build crashes on *c. Undefined behavior: each compiler may do something different.',
        },
        callouts: [{ target: 'L:ghost', text: <>a dead frame, <b>below SP</b></>, dir: 'right' }],
        hud: ['frames', 'sp'],
        legend: ['ptr', 'dangling', 'sp'],
      },
      {
        id: 'safety',
        title: 'How languages protect you',
        cfg: { program: safety('c') },
        toggle: {
          prompt: 'Two names for one heap value, in three languages:',
          initial: 0,
          options: [
            {
              label: 'C',
              apply: (s) => s.loadProgram(safety('c')),
              note: <>Two pointers, one block, and nothing tracks who owns it. Freeing through both is a double free.</>,
            },
            {
              label: 'JavaScript (GC)',
              apply: (s) => s.loadProgram(safety('js')),
              note: <>You never free anything. The collector frees objects that nothing can reach anymore, so references can’t dangle.</>,
            },
            {
              label: 'Rust (ownership)',
              apply: (s) => s.loadProgram(safety('rust')),
              note: (
                <>
                  Every value has exactly one owner. <code>let b = a</code> moves ownership, the compiler rejects any later use of <code>a</code>, and
                  the bytes are freed exactly once when <code>b</code> goes out of scope.
                </>
              ),
            },
          ],
        },
        body: (
          <>
            <p>
              Leaks, dangling pointers and double frees all come down to one question: <strong>who frees this block, and when?</strong> In C and C++
              the answer lives only in the programmer’s head.
            </p>
            <p>
              <strong>Garbage-collected</strong> languages (Java, JavaScript, Python, Go, C#) take the job away from you. A collector regularly finds
              every object reachable from your variables and frees the rest. The price is extra CPU and memory, and pauses you don’t control.
            </p>
            <p>
              <strong>Rust</strong> settles it at compile time instead. Each heap value has a single <strong>owner</strong>, and when the owner goes
              out of scope the value is freed. Assigning it to another name moves ownership, and the compiler refuses any use of the old name. No
              collector, and no dangling pointers.
            </p>
          </>
        ),
        code: {
          title: 'rustc: using a after the move',
          lang: 'shell',
          code: `error[E0382]: borrow of moved value: \`a\`
 --> src/main.rs:4:16
  |
2 |     let a = String::from("hello");
  |         - move occurs because \`a\` has type \`String\`
3 |     let b = a;
  |             - value moved here
!4 |     println!("{a}");
  |                ^ value borrowed here after move`,
          note: 'Uncomment the line that uses a, and the program no longer compiles.',
        },
        hud: ['heap'],
        legend: ['ptr', 'dangling', 'malloc', 'free', 'gc'],
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
        cfg: { program: LIST },
        body: (
          <p>
            One last program uses everything at once. Each call to <code>push</code> gets a stack frame and allocates a node on the heap that outlives
            the call, linked to the previous node. At the end, a loop frees every node before <code>main</code> returns.
          </p>
        ),
        extra: <CheatSheet />,
        hud: ['frames', 'heap', 'leaked'],
        legend: ['ptr', 'inner', 'malloc', 'free'],
      },
      {
        id: 'playground',
        title: 'Playground',
        cfg: { program: PLAYGROUND, playground: true, loop: false, auto: false },
        playground: true,
        body: (
          <p>
            Your turn to write the program. Call functions, allocate, copy pointers, free them and use them. The code writes itself as you click, and it
            runs under AddressSanitizer, so every mistake is caught and reported, like in a real debug build.
          </p>
        ),
        hud: ['frames', 'heap', 'leaked'],
        legend: ['ptr', 'dangling', 'malloc', 'free', 'leaked'],
      },
    ],
  },
];
