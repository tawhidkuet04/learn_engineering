/**
 * Realistic x86-64 Linux addresses for one run of a small PIE binary.
 * The ranges match what `cat /proc/<pid>/maps` prints for such a process,
 * so every number on the stage is one you could really see in gdb.
 */

/** main's frame starts just below this (the top of the stack in use). */
export const STACK_BASE = 0x7ffd5e8c3b60;
/** [stack] mapping */
export const STACK_LO = 0x7ffd5e8a5000;
export const STACK_HI = 0x7ffd5e8c6000;
/** Shared libraries (libc) */
export const LIBS_LO = 0x7f3b2a400000;
export const LIBS_HI = 0x7f3b2a61d000;
/** [heap] mapping, grown with brk() */
export const HEAP_LO = 0x55a3c8e2f000;
export const HEAP_HI = 0x55a3c8e50000;
/** First pointer glibc's malloc hands out in a fresh process (after its 0x290-byte tcache header). */
export const HEAP_BASE = 0x55a3c8e2f2a0;
/** Read-write data of the executable (.data / .bss) */
export const DATA_LO = 0x55a3c7a4e000;
export const DATA_HI = 0x55a3c7a4f000;
/** Executable code (.text) */
export const TEXT_LO = 0x55a3c7a4b000;
export const TEXT_HI = 0x55a3c7a4c000;

export const MAIN_ADDR = 0x55a3c7a4b1a9;
export const COUNTER_ADDR = 0x55a3c7a4e010;

/** Overflow demo: default Linux main-thread stack (ulimit -s 8192). */
export const STACK_LIMIT = 8 * 1024 * 1024;
export const DIVE_FRAME = 64;
/** argv, environment strings, libc start-up frames and main's own frame */
export const STACK_PRE_USED = 5120;
export const MAX_DEPTH = Math.floor((STACK_LIMIT - STACK_PRE_USED) / DIVE_FRAME);

export const hex = (n: number) => `0x${n.toString(16)}`;

/** Last hex digits, e.g. …3b4c. Shared prefixes are shown once, on the column. */
export const tail = (n: number, k = 4) => `…${n.toString(16).slice(-k)}`;

export const group = (n: number) => Math.round(n).toLocaleString('en-US');

export function bytes(n: number): string {
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 2 : 1)} MB`;
}

/** Chrome DevTools-style id for a JavaScript heap object. */
export const jsId = (alloc: number) => `@${1033 + alloc * 8}`;
