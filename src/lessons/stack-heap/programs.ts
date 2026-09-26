import { SIG } from '@/lib/sim/colors';
import { COUNTER_ADDR, HEAP_BASE, MAIN_ADDR, STACK_BASE, hex } from './addr';
import { L_INT, L_OWN, L_PTR, NULLP, P_INT, P_PTR, cells, fields, int, str, text, type Ask, type Op, type Program } from './model';
import type { MemSim } from './sim';

/* Every program the lesson runs: the real source, plus one scripted op per
   executed line that tells the memory model what that line does. */

const op = (line: number, note: string, run?: (m: MemSim) => void, extra: Partial<Op> = {}): Op => ({ line, note, run, ...extra });

const ptrOf = (m: MemSim, name: string) => m.slot(name)?.s.v ?? NULLP;

/* ------------------------------------------------------------------ */
/* Ch 1: where things live (map view)                                  */
/* ------------------------------------------------------------------ */

export const WHERE: Program = {
  id: 'where',
  file: 'where.c',
  lang: 'c',
  cmd: './where',
  beat: 1.5,
  code: `#include <stdio.h>
#include <stdlib.h>

int counter = 7;

int main(void) {
    int x = 42;
    int *p = malloc(sizeof *p);
    printf("%p\\n", (void *)main);
    printf("%p\\n", (void *)&counter);
    printf("%p\\n", (void *)p);
    printf("%p\\n", (void *)&x);
    free(p);
}`,
  ops: [
    op(4, 'Before main runs, the loader maps the code and the globals', (m) => {
      m.pin('main', 'text', 'main()', MAIN_ADDR);
      m.pin('counter', 'data', 'counter = 7', COUNTER_ADDR);
    }, { dur: 1.9 }),
    op(7, 'x is a local variable: it lives in main’s stack frame', (m) => m.pin('x', 'stack', 'x = 42', STACK_BASE - 20)),
    op(8, 'malloc finds 4 free bytes on the heap and returns their address', (m) => m.pin('p', 'heap', '*p (4 bytes)', HEAP_BASE)),
    op(9, 'main is machine code, so its address is in the text segment', (m) => m.printAddr('main', hex(MAIN_ADDR))),
    op(10, 'A global: the data segment, right next to the code', (m) => m.printAddr('counter', hex(COUNTER_ADDR))),
    op(11, 'The heap block: 0x55a3c8…, just above the program', (m) => m.printAddr('p', hex(HEAP_BASE))),
    op(12, 'The local: 0x7ffd…, way up at the top of the address space', (m) => m.printAddr('x', hex(STACK_BASE - 20))),
    op(13, 'free(p) hands the 4 heap bytes back to the allocator', (m) => m.pinFree('p'), { dur: 1.8 }),
  ],
};

/* ------------------------------------------------------------------ */
/* Ch 2: the call stack                                                */
/* ------------------------------------------------------------------ */

const SQUARES_CODE = `int square(int n) {
    int r = n * n;
    return r;
}

int sum_sq(int a, int b) {
    int x = square(a);
    int y = square(b);
    return x + y;
}

int main(void) {
    int total = sum_sq(3, 4);
    printf("%d\\n", total);
    return 0;
}`;

const SQUARE_ASK: Ask = {
  q: 'Where will square(4)’s frame go?',
  choices: [
    { id: 'same', label: 'Exactly where square(3)’s was' },
    { id: 'below', label: 'Below square(3)’s old frame' },
    { id: 'heap', label: 'Somewhere on the heap' },
  ],
  correct: 'same',
  at: 'ghost',
  explain: (ok) =>
    ok
      ? 'square(3) returned, so SP moved back up. The next call starts from that same SP, lands on the very same addresses, and simply overwrites the leftovers.'
      : 'When square(3) returned, SP moved back up to where it was before the call. So the next call lands on the very same addresses and overwrites the old bytes. Frames never go on the heap.',
};

export function squares(opts: { ask?: boolean; pause?: boolean } = {}): Program {
  return {
    id: 'squares',
    file: 'squares.c',
    lang: 'c',
    cmd: './squares',
    code: SQUARES_CODE,
    ops: [
      op(12, 'The program starts: main() gets the first frame', (m) => m.call('main', [L_INT('total')])),
      op(13, 'Call sum_sq(3, 4): push a frame, copy 3 and 4 into it', (m) => m.call('sum_sq', [P_INT('a', 3), P_INT('b', 4), L_INT('x'), L_INT('y')])),
      op(7, 'Call square(a): another frame, pushed below', (m) => m.call('square', [P_INT('n', 3), L_INT('r')], { n: 'a' })),
      op(2, 'r = 3 × 3 = 9, stored in square’s own frame', (m) => m.set('r', 9)),
      op(3, 'return r: 9 travels back, and square’s frame is popped', (m) => m.ret(9, 'x'), { pause: opts.pause }),
      op(8, opts.ask ? 'square(4) gets the same addresses square(3) just used' : 'Call square(b): a fresh frame in the same spot', (m) => m.call('square', [P_INT('n', 4), L_INT('r')], { n: 'b' }), {
        ask: opts.ask ? SQUARE_ASK : undefined,
      }),
      op(2, 'r = 4 × 4 = 16', (m) => m.set('r', 16)),
      op(3, 'return 16 into y; pop', (m) => m.ret(16, 'y')),
      op(9, 'return x + y = 25 to main; sum_sq’s frame is popped', (m) => m.ret(25, 'total')),
      op(14, 'printf reads total from main’s frame', (m) => m.echo('total')),
      op(15, 'main returns too. The stack is empty again', (m) => m.ret(null), { dur: 1.6 }),
    ],
  };
}

export const FACT: Program = {
  id: 'fact',
  file: 'fact.c',
  lang: 'c',
  cmd: './fact',
  beat: 1.15,
  code: `int fact(int n) {
    if (n <= 1)
        return 1;
    return n * fact(n - 1);
}

int main(void) {
    int f = fact(4);
    printf("%d\\n", f);
}`,
  ops: [
    op(7, 'main() starts', (m) => m.call('main', [L_INT('f')])),
    op(8, 'Call fact(4)', (m) => m.call('fact', [P_INT('n', 4)])),
    op(2, 'n is 4, not ≤ 1: keep going'),
    op(4, 'fact(4) needs fact(3) first: push another frame', (m) => m.call('fact', [P_INT('n', 3)], { n: 'n' })),
    op(2, 'n is 3: keep going'),
    op(4, 'fact(3) calls fact(2)', (m) => m.call('fact', [P_INT('n', 2)], { n: 'n' })),
    op(2, 'n is 2: keep going'),
    op(4, 'fact(2) calls fact(1). Four copies of fact are on the stack now', (m) => m.call('fact', [P_INT('n', 1)], { n: 'n' })),
    op(2, 'n is 1: the base case. No more calls', undefined, { dur: 1.4 }),
    op(3, 'fact(1) returns 1 and its frame is popped', (m) => m.ret(1)),
    op(4, 'fact(2) finishes: 2 × 1 = 2', (m) => m.ret(2)),
    op(4, 'fact(3) finishes: 3 × 2 = 6', (m) => m.ret(6)),
    op(4, 'fact(4) finishes: 4 × 6 = 24, back into main’s f', (m) => m.ret(24, 'f')),
    op(9, 'printf prints 24', (m) => m.echo('f')),
    op(10, 'main returns', (m) => m.ret(null), { dur: 1.4 }),
  ],
};

/* ------------------------------------------------------------------ */
/* Ch 4: the heap                                                      */
/* ------------------------------------------------------------------ */

export const SCORES: Program = {
  id: 'scores',
  file: 'scores.c',
  lang: 'c',
  cmd: './scores',
  beat: 1.4,
  code: `int *make_scores(int n) {
    int *s = malloc(n * sizeof(int));
    for (int i = 0; i < n; i++)
        s[i] = i * 10;
    return s;
}

int main(void) {
    int *scores = make_scores(4);
    printf("%d\\n", scores[2]);
    free(scores);
    scores = NULL;
}`,
  ops: [
    op(8, 'main() starts with one pointer variable', (m) => m.call('main', [L_PTR('scores')])),
    op(9, 'Call make_scores(4)', (m) => m.call('make_scores', [P_INT('n', 4), L_PTR('s'), L_INT('i')])),
    op(2, 'malloc(16): room for 4 ints on the heap. s holds only the address', (m) => m.malloc('s', 16, cells('int[4]', 4)), { dur: 1.7 }),
    op(4, 'The loop writes through s: s[0..3] = 0, 10, 20, 30', (m) => {
      [0, 1, 2, 3].forEach((i) =>
        m.after(i * 0.42, () => {
          m.set('i', i);
          m.write(['s'], i, i * 10);
        }),
      );
    }, { dur: 2.3 }),
    op(5, 'return s: only the address travels back. The block stays put', (m) => m.ret(ptrOf(m, 's'), 'scores'), { dur: 1.6 }),
    op(10, 'scores[2]: follow the pointer, take element 2', (m) => m.read(['scores'], 2)),
    op(11, 'free() gives the 16 bytes back. scores still holds the old address!', (m) => m.free('scores'), { dur: 1.7 }),
    op(12, 'Setting it to NULL removes the dangling pointer', (m) => m.nul('scores')),
    op(13, 'main returns. Nothing leaked', (m) => m.ret(null), { dur: 1.4 }),
  ],
};

export const SANDBOX: Program = { id: 'sandbox', file: 'heap.c', lang: 'c', cmd: './heap', code: '', ops: [] };

const FRAG_ASK: Ask = {
  q: 'Can malloc(48) reuse one of the holes?',
  choices: [
    { id: 'reuse', label: 'Yes: 64 bytes are free' },
    { id: 'grow', label: 'No: the heap has to grow' },
  ],
  correct: 'grow',
  at: 'heaptop',
  explain: (ok) =>
    ok
      ? '64 bytes are free, but as two separate 32-byte holes with b sitting between them. A block must be contiguous, so neither hole works and malloc takes fresh space from the top.'
      : 'There are 64 free bytes, but they are two separate 32-byte holes with b in between. A block has to be contiguous and neither hole is big enough, so malloc takes fresh space from the top of the heap.',
};

export const FRAG: Program = {
  id: 'frag',
  file: 'frag.c',
  lang: 'c',
  cmd: './frag',
  beat: 1.45,
  code: `int main(void) {
    char *a = malloc(32);
    char *b = malloc(32);
    char *c = malloc(32);
    char *d = malloc(32);
    free(a); a = NULL;
    free(c); c = NULL;
    char *e = malloc(48);
    free(b); b = NULL;
    char *f = malloc(48);
}`,
  ops: [
    op(1, 'main() with six pointer variables', (m) => m.call('main', ['a', 'b', 'c', 'd', 'e', 'f'].map((n) => L_PTR(n)))),
    op(2, 'a: 32 bytes at the bottom of the heap', (m) => m.malloc('a', 32, text('char[32]'))),
    op(3, 'b: the next 32 bytes', (m) => m.malloc('b', 32, text('char[32]'))),
    op(4, 'c', (m) => m.malloc('c', 32, text('char[32]'))),
    op(5, 'd', (m) => m.malloc('d', 32, text('char[32]'))),
    op(6, 'free(a): a 32-byte hole at the bottom', (m) => m.free('a', { onDone: () => m.nul('a') })),
    op(7, 'free(c): another 32-byte hole, with b between them', (m) => m.free('c', { onDone: () => m.nul('c') }), { dur: 1.7 }),
    op(8, 'Neither hole fits 48 bytes: the heap grows instead', (m) => m.malloc('e', 48, text('char[48]')), { ask: FRAG_ASK, dur: 2.6 }),
    op(9, 'free(b): a, b and c are now one 96-byte hole', (m) => m.free('b', { onDone: () => m.nul('b') }), { dur: 1.9 }),
    op(10, 'Now 48 bytes fit in the merged hole', (m) => m.malloc('f', 48, text('char[48]')), { dur: 2.6 }),
  ],
};

/* ------------------------------------------------------------------ */
/* Ch 5: pointers and references                                       */
/* ------------------------------------------------------------------ */

export const POINTERS: Program = {
  id: 'pointers',
  file: 'pointers.c',
  lang: 'c',
  cmd: './pointers',
  beat: 1.45,
  code: `int main(void) {
    int x = 42;
    int *p = &x;
    *p = 7;
    printf("%d\\n", x);
    int *h = malloc(sizeof *h);
    *h = 99;
    printf("%d\\n", *h);
    free(h);
    return 0;
}`,
  ops: [
    op(1, 'main() with an int and two pointers', (m) => m.call('main', [L_INT('x'), L_PTR('p'), L_PTR('h')])),
    op(2, 'x = 42', (m) => m.set('x', 42)),
    op(3, '&x is x’s address. p stores it: p points to x', (m) => m.addrOf('p', 'x'), { dur: 1.7 }),
    op(4, '*p = 7: follow the arrow and write there. x changes', (m) => m.write(['p'], null, 7), { dur: 1.6 }),
    op(5, 'x really is 7 now', (m) => m.echo('x')),
    op(6, 'A pointer into the heap works the same way', (m) => m.malloc('h', 4, cells('int', 1))),
    op(7, '*h = 99: write through h', (m) => m.write(['h'], 0, 99)),
    op(8, 'Read it back through the pointer', (m) => m.read(['h'], 0)),
    op(9, 'free(h). h still holds the address: dangling until main returns', (m) => m.free('h')),
    op(10, 'main returns: x, p and h vanish with its frame', (m) => m.ret(null), { dur: 1.6 }),
  ],
};

const ALIAS_A: Ask = {
  q: 'What does console.log(a) print?',
  choices: [
    { id: '5', label: '5' },
    { id: '6', label: '6' },
  ],
  correct: '5',
  at: 'console',
  explain: (ok) =>
    ok
      ? 'let b = a copied the number 5 into b’s own slot. Changing b later only touches b.'
      : 'let b = a copied the number itself. a and b are two separate slots, so b = 6 leaves a alone.',
};

const ALIAS_B: Ask = {
  q: 'What does console.log(alice.score) print?',
  choices: [
    { id: '10', label: '10' },
    { id: '99', label: '99' },
  ],
  correct: '99',
  at: 'console',
  explain: (ok) =>
    ok
      ? 'copy = alice copied the reference, not the object. Both names lead to the same object, so the change is visible through either.'
      : 'copy = alice copied the reference: an arrow to the same object, not a new object. copy.score = 99 changed that one shared object.',
};

export const ALIAS: Program = {
  id: 'alias',
  file: 'alias.js',
  lang: 'js',
  mode: 'gc',
  cmd: 'node alias.js',
  beat: 1.4,
  code: `function demo() {
  let a = 5;
  let b = a;
  b = 6;
  console.log(a);
  const alice = { score: 10 };
  const copy = alice;
  copy.score = 99;
  console.log(alice.score);
}
demo();`,
  ops: [
    op(11, 'Calling demo() pushes its frame', (m) => m.call('demo', [L_INT('a'), L_INT('b'), L_PTR('alice', SIG.pink), L_PTR('copy', SIG.teal)])),
    op(2, 'a = 5', (m) => m.set('a', 5)),
    op(3, 'b = a copies the number into b', (m) => m.assign('b', 'a')),
    op(4, 'b = 6 changes b’s slot', (m) => m.set('b', 6)),
    op(5, 'a is still 5', (m) => m.echo('a'), { ask: ALIAS_A }),
    op(6, 'The object goes on the heap; alice holds a reference to it', (m) => m.newObj('alice', { label: 'Object', fields: [['score', 10]] }), { dur: 1.8 }),
    op(7, 'copy = alice copies the reference: same object', (m) => m.assign('copy', 'alice'), { dur: 1.6 }),
    op(8, 'copy.score = 99: follow copy’s arrow, change the object', (m) => m.write(['copy'], 'score', 99)),
    op(9, 'alice sees 99: it is the same object', (m) => m.read(['alice'], 'score'), { ask: ALIAS_B }),
    op(10, 'demo() returns. Nothing refers to the object, so the garbage collector frees it', (m) => m.ret(null), { dur: 2.4 }),
  ],
};

export type CopyKind = 'same' | 'spread' | 'clone';

export function copies(kind: CopyKind): Program {
  const line6 = kind === 'same' ? '  const copy = alice;' : kind === 'spread' ? '  const copy = { ...alice };' : '  const copy = structuredClone(alice);';
  const note6 =
    kind === 'same'
      ? 'copy = alice: one more reference to the same object'
      : kind === 'spread'
        ? '{ ...alice } makes a new object, but copies the stats reference'
        : 'structuredClone copies every object, all the way down';
  return {
    id: `copies-${kind}`,
    file: 'copy.js',
    lang: 'js',
    mode: 'gc',
    cmd: 'node copy.js',
    beat: 1.4,
    code: `function demo() {
  const alice = {
    name: 'Alice',
    stats: { score: 10 },
  };
${line6}
  copy.name = 'Bob';
  copy.stats.score = 99;
  console.log(alice.name);
  console.log(alice.stats.score);
}
demo();`,
    ops: [
      op(12, 'demo() starts', (m) => m.call('demo', [L_PTR('alice', SIG.pink), L_PTR('copy', SIG.teal)])),
      op(2, 'Two objects: alice’s object holds a reference to its stats object', (m) => m.newObj('alice', { label: 'Object', fields: [['name', str('Alice')], ['stats', { label: 'Object', fields: [['score', 10]] }]] }), { dur: 2 }),
      op(6, note6, (m) => (kind === 'same' ? m.assign('copy', 'alice') : m.copyObj('copy', 'alice', kind === 'clone')), { dur: 2.1 }),
      op(7, 'copy.name = ’Bob’', (m) => m.write(['copy'], 'name', str('Bob'))),
      op(8, 'copy.stats.score = 99: two hops', (m) => m.write(['copy', 'stats'], 'score', 99), { dur: 1.6 }),
      op(9, 'alice.name', (m) => m.read(['alice'], 'name')),
      op(10, 'alice.stats.score', (m) => m.read(['alice', 'stats'], 'score'), { dur: 1.6 }),
      op(11, 'demo() returns; the collector frees what nothing references', (m) => m.ret(null), { dur: 2.4 }),
    ],
  };
}

/* ------------------------------------------------------------------ */
/* Ch 6: when memory goes wrong                                        */
/* ------------------------------------------------------------------ */

export const LEAK: Program = {
  id: 'leak',
  file: 'leak.c',
  lang: 'c',
  cmd: 'valgrind ./leak',
  beat: 1.45,
  code: `int main(void) {
    char *p = malloc(64);
    strcpy(p, "first");
    p = malloc(64);
    strcpy(p, "second");
    free(p);
    return 0;
}`,
  ops: [
    op(1, 'main() with one pointer', (m) => m.call('main', [L_PTR('p')])),
    op(2, 'p points to a 64-byte block', (m) => m.malloc('p', 64, text('char[64]'))),
    op(3, 'Write "first" into it', (m) => m.write(['p'], null, str('first'))),
    op(4, 'p now points to a NEW block. Nothing points to the first one', (m) => m.malloc('p', 64, text('char[64]')), { dur: 2.1 }),
    op(5, 'Write "second"', (m) => m.write(['p'], null, str('second'))),
    op(6, 'free(p) frees only the second block', (m) => m.free('p')),
    op(7, 'main returns. The first block was never freed: 64 bytes leaked', (m) => {
      m.ret(null);
      m.after(0.8, () => {
        m.print('==31337== LEAK SUMMARY:', 'dim');
        m.print('==31337==    definitely lost: 64 bytes in 1 blocks', 'err');
      });
    }, { dur: 2.4 }),
  ],
};

export function leakLoop(withFree: boolean): Program {
  const body = withFree
    ? `void handle(int id) {
    char *buf = malloc(64);
    sprintf(buf, "req %d", id);
    puts(buf);
    free(buf);
}`
    : `void handle(int id) {
    char *buf = malloc(64);
    sprintf(buf, "req %d", id);
    puts(buf);
}`;
  const o = withFree ? 1 : 0;
  const ops: Op[] = [op(7 + o, 'A server-ish loop: handle six requests', (m) => m.call('main', [L_INT('i')]))];
  for (let i = 1; i <= 6; i++) {
    ops.push(
      op(8 + o, `i = ${i}`, (m) => m.set('i', i)),
      op(9 + o, `handle(${i})`, (m) => m.call('handle', [P_INT('id', i), L_PTR('buf')], { id: 'i' })),
      op(2, withFree ? 'malloc(64): reuses the hole the last request freed' : 'malloc(64) for this request', (m) => m.malloc('buf', 64, text('char[64]'))),
      op(3, `sprintf writes "req ${i}"`, (m) => m.write(['buf'], null, str(`req ${i}`))),
      op(4, 'puts(buf)', (m) => m.read(['buf'], null)),
    );
    if (withFree) ops.push(op(5, 'free(buf): the block goes back', (m) => m.free('buf')));
    ops.push(op(5 + o, withFree ? 'handle returns. Nothing left behind' : 'handle returns: buf vanishes, its block stays. Leaked', (m) => m.ret(null)));
  }
  ops.push(op(10 + o, withFree ? 'Six requests, never more than 64 bytes in use' : 'Six requests, 384 bytes leaked. A server never stops…', (m) => m.ret(null), { dur: 2.2 }));
  return {
    id: withFree ? 'loop-free' : 'loop-leak',
    file: 'server.c',
    lang: 'c',
    cmd: './server',
    beat: 0.4,
    code: `${body}

int main(void) {
    for (int i = 1; i <= 6; i++)
        handle(i);
}`,
    ops,
  };
}

export const UAF: Program = {
  id: 'uaf',
  file: 'uaf.c',
  lang: 'c',
  cmd: './uaf',
  beat: 1.4,
  code: `struct user  { char name[16]; };
struct order { long total; };

int main(void) {
    struct user *u = malloc(16);
    strcpy(u->name, "alice");
    free(u);
    printf("%s\\n", u->name);
    struct order *o = malloc(16);
    o->total = 4200;
    printf("%s\\n", u->name);
    free(o);
    free(u);
}`,
  ops: [
    op(4, 'main() with two pointers', (m) => m.call('main', [L_PTR('u'), L_PTR('o')])),
    op(5, 'u points to a 16-byte user record', (m) => m.malloc('u', 16, fields('struct user', [['name', { t: 'none' }]]))),
    op(6, 'strcpy writes the name', (m) => m.write(['u'], 'name', str('alice'))),
    op(7, 'free(u). The block is free, but u still holds its address', (m) => m.free('u'), { dur: 1.6 }),
    op(8, 'Use after free: those bytes now hold the allocator’s free-list pointer', (m) => m.read(['u'], 'name', { shown: '/\uFFFD<Z', tone: 'err' }), { pause: true, dur: 1.8 }),
    op(9, 'malloc(16) reuses the freed block: o and u now share it', (m) => m.malloc('o', 16, fields('struct order', [['total', { t: 'none' }]])), { dur: 1.8 }),
    op(10, 'o->total = 4200 overwrites what u calls name', (m) => m.write(['o'], 'total', 4200)),
    op(11, 'u->name now reads the order’s bytes: 4200 is 0x1068 → "h"', (m) => m.read(['u'], 'name', { shown: 'h', tone: 'err' }), { dur: 1.8 }),
    op(12, 'free(o) frees the shared block', (m) => m.free('o'), { pause: true }),
    op(13, 'free(u) frees it a second time: glibc aborts the process', (m) => m.free('u'), { dur: 2 }),
  ],
};

const DANGLE_ASK: Ask = {
  q: 'What does printf print?',
  choices: [
    { id: '0', label: '0' },
    { id: '1234', label: '1234' },
    { id: 'crash', label: 'It crashes' },
  ],
  correct: '1234',
  at: 'console',
  explain: (ok) =>
    ok
      ? 'other()’s frame landed on the same addresses and wrote 1234 exactly where count used to live. c still points there. (It is undefined behavior: an optimized build could print anything, or crash.)'
      : 'c points into make_counter’s dead frame. other() then used the same addresses and wrote 1234 right where count was, so this unoptimized build prints 1234. It is undefined behavior: an optimized build could do something else entirely.',
};

export const DANGLE: Program = {
  id: 'dangle',
  file: 'dangle.c',
  lang: 'c',
  cmd: './dangle',
  beat: 1.45,
  code: `int *make_counter(void) {
    int count = 0;
    return &count;
}

void other(void) {
    int junk = 1234;
}

int main(void) {
    int *c = make_counter();
    other();
    printf("%d\\n", *c);
}`,
  ops: [
    op(10, 'main() with one pointer, c', (m) => m.call('main', [L_PTR('c')])),
    op(11, 'Call make_counter()', (m) => m.call('make_counter', [L_INT('count')])),
    op(2, 'count = 0, in make_counter’s frame', (m) => m.set('count', 0)),
    op(3, 'return &count: the address of a local. The frame is popped…', (m) => {
      const hit = m.slot('count');
      if (hit) m.ret({ t: 'ptr', addr: hit.s.addr, prov: hit.s.uid }, 'c', { label: '&count' });
    }, { dur: 1.8 }),
    op(11, '…so c points below SP, into a dead frame', undefined, { dur: 1.4 }),
    op(12, 'Call other(): its frame reuses those exact addresses', (m) => m.call('other', [L_INT('junk')])),
    op(7, 'junk = 1234 lands exactly where count was', (m) => m.set('junk', 1234)),
    op(8, 'other() returns', (m) => m.ret(null)),
    op(13, '*c reads whatever is there now: 1234', (m) => m.read(['c'], null), { ask: DANGLE_ASK, dur: 2 }),
  ],
};

export type SafetyKind = 'c' | 'js' | 'rust';

export function safety(kind: SafetyKind): Program {
  if (kind === 'c')
    return {
      id: 'safety-c',
      file: 'two.c',
      lang: 'c',
      cmd: './two',
      beat: 1.5,
      code: `int main(void) {
    char *a = malloc(6);
    strcpy(a, "hello");
    char *b = a;
    free(a);
    free(b);
}`,
      ops: [
        op(1, 'main() with two pointers', (m) => m.call('main', [L_PTR('a', SIG.pink), L_PTR('b', SIG.teal)])),
        op(2, 'a points to 6 bytes on the heap', (m) => m.malloc('a', 6, text('char[6]'))),
        op(3, '"hello" goes in', (m) => m.write(['a'], null, str('hello'))),
        op(4, 'b = a: two pointers, one block. Who frees it?', (m) => m.assign('b', 'a')),
        op(5, 'free(a). b now dangles too', (m) => m.free('a')),
        op(6, 'free(b): the same block, freed twice', (m) => m.free('b'), { dur: 2 }),
      ],
    };
  if (kind === 'js')
    return {
      id: 'safety-js',
      file: 'two.js',
      lang: 'js',
      mode: 'gc',
      manualGc: true,
      cmd: 'node two.js',
      beat: 1.5,
      code: `function demo() {
  let a = { msg: 'hello' };
  let b = a;
  a = null;
  b = null;
}
demo();
// …later, the garbage collector runs`,
      ops: [
        op(7, 'demo() starts', (m) => m.call('demo', [L_PTR('a', SIG.pink), L_PTR('b', SIG.teal)])),
        op(2, 'An object on the heap; a refers to it', (m) => m.newObj('a', { label: 'Object', fields: [['msg', str('hello')]] })),
        op(3, 'b = a: two references', (m) => m.assign('b', 'a')),
        op(4, 'a = null. b still reaches the object, so it stays', (m) => m.nul('a')),
        op(5, 'b = null. Now nothing can reach it: garbage', (m) => m.nul('b'), { dur: 1.8 }),
        op(6, 'demo() returns', (m) => m.ret(null)),
        op(8, 'The collector frees every unreachable object. You never call free', (m) => m.gcSweep(), { dur: 2.4 }),
      ],
    };
  return {
    id: 'safety-rust',
    file: 'main.rs',
    lang: 'rust',
    mode: 'rust',
    cmd: 'cargo run',
    beat: 1.5,
    code: `fn main() {
    let a = String::from("hello");
    let b = a;
    // println!("{a}");  // won't compile
    println!("{b}");
}`,
    ops: [
      op(1, 'main() starts', (m) => m.call('main', [L_OWN('a', SIG.pink), L_OWN('b', SIG.teal)])),
      op(2, 'The bytes go on the heap; a owns them', (m) => m.malloc('a', 5, text('str data', 'hello'), { label: 'String::from' })),
      op(3, 'let b = a moves ownership. a is now unusable', (m) => m.move('b', 'a'), { dur: 1.7 }),
      op(4, 'Using a after the move is a compile error (E0382): no alias survives'),
      op(5, 'println! reads through b', (m) => m.read(['b'], null)),
      op(6, 'b goes out of scope: Rust frees the bytes, exactly once', (m) => {
        m.dropOwner('b');
        m.after(0.9, () => m.ret(null));
      }, { dur: 2.4 }),
    ],
  };
}

/* ------------------------------------------------------------------ */
/* Recap: a linked list                                                */
/* ------------------------------------------------------------------ */

function listOps(): Op[] {
  const ops: Op[] = [
    op(8, 'main() starts', (m) => m.call('main', [L_PTR('list'), L_INT('i'), L_PTR('next')])),
    op(9, 'An empty list: a NULL pointer', (m) => m.set('list', NULLP)),
  ];
  for (let i = 1; i <= 3; i++) {
    ops.push(
      op(10, `i = ${i}`, (m) => m.set('i', i)),
      op(11, `push(list, ${i}): a new frame`, (m) => m.call('push', [P_PTR('head', ptrOf(m, 'list')), P_INT('v', i), L_PTR('n')], { head: 'list', v: 'i' })),
      op(2, 'A node on the heap outlives this call', (m) => m.malloc('n', 16, fields('Node', [['v', { t: 'none' }], ['next', { t: 'none' }]]))),
      op(3, `n->v = ${i}`, (m) => m.write(['n'], 'v', i)),
      op(4, i === 1 ? 'n->next = head (NULL): the end of the list' : 'n->next = head: link to the previous node', (m) => m.write(['n'], 'next', ptrOf(m, 'head'))),
      op(5, 'return n: the frame goes, the node stays', (m) => m.ret(ptrOf(m, 'n'), 'list')),
    );
  }
  for (let i = 3; i >= 1; i--) {
    ops.push(
      op(12, 'list is not NULL: keep freeing'),
      op(13, 'Save the next pointer before freeing', (m) => m.load('next', ['list'], 'next')),
      op(14, `free the node holding ${i}`, (m) => m.free('list')),
      op(15, 'Move on to the next node', (m) => m.assign('list', 'next')),
    );
  }
  ops.push(op(12, 'list is NULL: done'), op(17, 'Every malloc had a free. Nothing leaks', (m) => m.ret(null), { dur: 2 }));
  return ops;
}

export const LIST: Program = {
  id: 'list',
  file: 'list.c',
  lang: 'c',
  cmd: './list',
  beat: 1.05,
  code: `Node *push(Node *head, int v) {
    Node *n = malloc(sizeof *n);
    n->v = v;
    n->next = head;
    return n;
}

int main(void) {
    Node *list = NULL;
    for (int i = 1; i <= 3; i++)
        list = push(list, i);
    while (list) {
        Node *next = list->next;
        free(list);
        list = next;
    }
}`,
  ops: listOps(),
};

export const PLAYGROUND: Program = { id: 'playground', file: 'main.c', lang: 'c', cmd: './sandbox', code: '', ops: [] };

export { int };
