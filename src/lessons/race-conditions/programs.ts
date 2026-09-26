/**
 * The tiny instruction set the threads on the stage execute, and the
 * programs each scene runs. Every instruction is one indivisible step:
 * the scheduler may switch threads between any two of them.
 */

export type TId = 'A' | 'B' | 'C' | 'D';
export type Val = number | string;
export type Regs = Record<string, Val | null>;

export type OpKind = 'inc' | 'load' | 'add' | 'store' | 'lock' | 'unlock' | 'faa' | 'cas' | 'check' | 'work' | 'trylock';

/** What an instruction can see of its thread. */
export interface Ctx {
  regs: Regs;
  who: string;
}

export interface Instr {
  op: OpKind;
  /** Mnemonic column on the thread card, e.g. "LOAD" */
  mn: string;
  /** Operands, e.g. "r ← count" */
  args: string;
  /** Shorter operands for narrow (phone) cards */
  sargs?: string;
  /** Short code for the interleaving strip, e.g. "LD" */
  code: string;
  cell?: string;
  lock?: string;
  /** Destination register */
  reg?: string;
  /** Source register */
  src?: string;
  n?: number;
  /** store: value to write (defaults to the source register) */
  put?: (c: Ctx) => Val;
  /** load: extra cells read in the same step */
  also?: { cell: string; reg: string }[];
  /** lock: read a cell right after acquiring (SELECT … FOR UPDATE) */
  thenLoad?: { cell: string; reg: string };
  /** check: the condition, and where to go when it fails */
  test?: (c: Ctx) => boolean;
  pass?: string;
  fail?: string;
  failTo?: number | 'end';
  failMsg?: string;
  /** cas: compare `cell` with expect(), write next() only if equal */
  expect?: (c: Ctx) => Val;
  next?: (c: Ctx) => Val;
  alsoWrite?: { cell: string; val: (c: Ctx) => Val }[];
  /** cas: on failure jump here (a retry loop), otherwise give up with failMsg */
  retryTo?: number;
  /** trylock: seconds to wait before giving up */
  timeout?: number;
  /** work: floating label */
  label?: string;
}

export interface Program {
  /** The source line these instructions come from */
  src: string;
  instrs: Instr[];
  /** Registers shown in the thread's register box */
  regs: string[];
  /** Instruction range that reads, modifies and writes shared state */
  crit?: [number, number];
  /** Result text when the thread finishes normally */
  okMsg?: string;
  /** How many times the program runs (a loop) */
  iters?: number;
}

/* ------------------------------------------------------------------ */
/* Instruction builders                                                */
/* ------------------------------------------------------------------ */

const num = (v: Val | null | undefined) => (typeof v === 'number' ? v : 0);

export const I = {
  inc: (): Instr => ({ op: 'inc', mn: 'count = count + 1', args: '', code: 'INC', cell: 'count', reg: 'r' }),
  load: (cell = 'count', reg = 'r', mn = 'LOAD', args?: string, code = 'LD'): Instr => ({ op: 'load', mn, args: args ?? `${reg} ← ${cell}`, code, cell, reg }),
  add: (reg = 'r', src = reg, n = 1): Instr => ({ op: 'add', mn: 'ADD', args: `${reg} ← ${src} + ${n}`, code: '+1', reg, src, n }),
  store: (cell = 'count', src = 'r'): Instr => ({ op: 'store', mn: 'STORE', args: `${cell} ← ${src}`, code: 'ST', cell, src }),
  lock: (lock = 'mu'): Instr => ({ op: 'lock', mn: 'LOCK', args: lock, code: 'LK', lock }),
  unlock: (lock = 'mu'): Instr => ({ op: 'unlock', mn: 'UNLOCK', args: lock, code: 'UL', lock }),
  faa: (): Instr => ({ op: 'faa', mn: 'FETCH_ADD', args: 'count, 1', code: 'FAA', cell: 'count', reg: 'r', n: 1 }),
  cas: (): Instr => ({
    op: 'cas',
    mn: 'CAS',
    args: 'count: old → new',
    sargs: 'old → new',
    code: 'CAS',
    cell: 'count',
    expect: (c) => num(c.regs.old),
    next: (c) => num(c.regs.new),
    retryTo: 0,
  }),
};

/* ------------------------------------------------------------------ */
/* Counter programs                                                    */
/* ------------------------------------------------------------------ */

export type CounterKind = 'naive' | 'basic' | 'mutex' | 'faa' | 'cas';

const WORK: Instr = { op: 'work', mn: 'WORK', args: '(private, no sharing)', code: 'W' };

export function counterProgram(kind: CounterKind, iters = 1, work = false): Program {
  const p = counterBase(kind, iters);
  if (!work) return p;
  return { ...p, instrs: [WORK, ...p.instrs], crit: p.crit ? [p.crit[0] + 1, p.crit[1] + 1] : undefined };
}

function counterBase(kind: CounterKind, iters: number): Program {
  switch (kind) {
    case 'naive':
      return { src: 'count = count + 1', instrs: [I.inc()], regs: [], iters };
    case 'basic':
      return { src: 'count = count + 1', instrs: [I.load(), I.add(), I.store()], regs: ['r'], crit: [0, 2], iters };
    case 'mutex':
      return { src: 'lock; count++; unlock', instrs: [I.lock(), I.load(), I.add(), I.store(), I.unlock()], regs: ['r'], crit: [1, 3], iters };
    case 'faa':
      return { src: 'atomic_fetch_add(&count, 1)', instrs: [I.faa()], regs: ['r'], iters };
    case 'cas':
      return { src: 'do { … } while (!CAS(…))', instrs: [I.load('count', 'old'), I.add('new', 'old'), I.cas()], regs: ['old', 'new'], iters };
  }
}

/* ------------------------------------------------------------------ */
/* Deadlock: two bank transfers                                        */
/* ------------------------------------------------------------------ */

export type LockOrder = 'ab' | 'ba';
export type DLStrategy = 'wait' | 'trylock';

export function transferProgram(me: TId, order: LockOrder, strategy: DLStrategy): Program {
  const [first, second] = order === 'ab' ? ['alice', 'bob'] : ['bob', 'alice'];
  const move = me === 'A' ? 'alice → bob' : 'bob → alice';
  const take: Instr =
    strategy === 'trylock'
      ? { op: 'trylock', mn: 'TRYLOCK', args: `${second} (1s)`, code: 'TL', lock: second, timeout: 1.6, failTo: 0 }
      : I.lock(second);
  return {
    src: `transfer(${move}, $10)`,
    instrs: [
      I.lock(first),
      take,
      { op: 'work', mn: 'MOVE', args: `$10 ${move}`, sargs: `$10 → ${me === 'A' ? 'bob' : 'alice'}`, code: '$', label: `$10 ${move}` },
      I.unlock(second),
      I.unlock(first),
    ],
    regs: [],
    okMsg: 'transfer done',
  };
}

/* ------------------------------------------------------------------ */
/* Check-then-act: booking one seat                                    */
/* ------------------------------------------------------------------ */

export type SeatMode = 'racy' | 'atomic';

export function seatProgram(who: string, mode: SeatMode): Program {
  if (mode === 'atomic') {
    return {
      src: `UPDATE … WHERE owner IS NULL`,
      instrs: [
        {
          op: 'cas',
          mn: 'BOOK',
          args: `14C if free`,
          code: 'BOOK',
          cell: 'seat',
          expect: () => 'free',
          next: () => who,
          failMsg: 'sold out',
        },
      ],
      regs: [],
      okMsg: 'booked',
    };
  }
  return {
    src: `if seat is free: book it`,
    instrs: [
      I.load('seat', 's', 'READ', 's ← seat 14C', 'RD'),
      { op: 'check', mn: 'IF', args: 's is free', code: 'IF', test: (c) => c.regs.s === 'free', pass: 'free ✓', fail: 'taken', failTo: 'end', failMsg: 'seat taken' },
      { op: 'store', mn: 'WRITE', args: `seat 14C ← ${who}`, sargs: `seat ← ${who}`, code: 'WR', cell: 'seat', put: () => who },
    ],
    regs: ['s'],
    crit: [0, 2],
    okMsg: 'booked',
  };
}

/* ------------------------------------------------------------------ */
/* Database rows: two $80 withdrawals from a $100 balance              */
/* ------------------------------------------------------------------ */

export type BankMode = 'racy' | 'forupdate' | 'optimistic';

const enough: Instr['test'] = (c) => num(c.regs.b) >= 80;

export function bankProgram(mode: BankMode): Program {
  if (mode === 'forupdate') {
    return {
      src: 'SELECT … FOR UPDATE; UPDATE; COMMIT',
      instrs: [
        { op: 'lock', mn: 'SELECT', args: 'b ← balance FOR UPDATE', sargs: 'FOR UPDATE', code: 'SEL', lock: 'row', thenLoad: { cell: 'balance', reg: 'b' } },
        { op: 'check', mn: 'IF', args: 'b ≥ 80', code: 'IF', test: enough, pass: 'enough ✓', fail: 'too low', failTo: 3, failMsg: 'insufficient funds' },
        { op: 'store', mn: 'UPDATE', args: 'balance ← b − 80', sargs: 'bal ← b − 80', code: 'UPD', cell: 'balance', put: (c) => num(c.regs.b) - 80 },
        { op: 'unlock', mn: 'COMMIT', args: '(releases the row lock)', sargs: 'unlock row', code: 'COM', lock: 'row' },
      ],
      regs: ['b'],
      okMsg: 'paid $80',
    };
  }
  if (mode === 'optimistic') {
    return {
      src: 'UPDATE … WHERE version = v',
      instrs: [
        { op: 'load', mn: 'SELECT', args: 'b, v ← balance, version', sargs: 'b, v ← row', code: 'SEL', cell: 'balance', reg: 'b', also: [{ cell: 'version', reg: 'v' }] },
        { op: 'check', mn: 'IF', args: 'b ≥ 80', code: 'IF', test: enough, pass: 'enough ✓', fail: 'too low', failTo: 'end', failMsg: 'insufficient funds' },
        {
          op: 'cas',
          mn: 'UPDATE',
          args: '… WHERE version = v',
          sargs: 'if version = v',
          code: 'UPD',
          cell: 'version',
          expect: (c) => num(c.regs.v),
          next: (c) => num(c.regs.v) + 1,
          alsoWrite: [{ cell: 'balance', val: (c) => num(c.regs.b) - 80 }],
          retryTo: 0,
        },
      ],
      regs: ['b', 'v'],
      okMsg: 'paid $80',
    };
  }
  return {
    src: 'SELECT; if enough: UPDATE',
    instrs: [
      I.load('balance', 'b', 'SELECT', 'b ← balance', 'SEL'),
      { op: 'check', mn: 'IF', args: 'b ≥ 80', code: 'IF', test: enough, pass: 'enough ✓', fail: 'too low', failTo: 'end', failMsg: 'insufficient funds' },
      { op: 'store', mn: 'UPDATE', args: 'balance ← b − 80', sargs: 'bal ← b − 80', code: 'UPD', cell: 'balance', put: (c) => num(c.regs.b) - 80 },
    ],
    regs: ['b'],
    crit: [0, 2],
    okMsg: 'paid $80',
  };
}
