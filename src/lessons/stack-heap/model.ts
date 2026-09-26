import type { MemSim } from './sim';

/* The memory model the stage draws: stack frames made of slots, heap blocks
   made of fields, and values that may be pointers (plain numbers that happen
   to be addresses). */

export type Lang = 'c' | 'js' | 'rust';

export type Val =
  | { t: 'none' }
  | { t: 'int'; v: number; stale?: boolean }
  | { t: 'str'; v: string; stale?: boolean }
  /** addr 0 is NULL. prov = which allocation (or stack slot) the address came from. */
  | { t: 'ptr'; addr: number; prov: number; stale?: boolean }
  /** A code address, e.g. a return address: shown as the function it points into. */
  | { t: 'code'; v: string };

export const NONE: Val = { t: 'none' };
export const NULLP: Val = { t: 'ptr', addr: 0, prov: 0 };
export const int = (v: number): Val => ({ t: 'int', v });
export const str = (v: string): Val => ({ t: 'str', v });

export type Raw = Val | number | string;
export const val = (r: Raw): Val => (typeof r === 'number' ? int(r) : typeof r === 'string' ? str(r) : r);

export type SlotKind = 'ret' | 'rbp' | 'param' | 'local';
export type SlotType = 'int' | 'ptr' | 'own' | 'char';

export interface Slot {
  uid: number;
  name: string;
  kind: SlotKind;
  type: SlotType;
  addr: number;
  size: number;
  v: Val;
  color?: string;
  /** Rust: ownership moved away; the name can no longer be used */
  moved?: boolean;
  /** vt of the last write (row flash) */
  flash: number;
  /** the last write was bad (through a dangling pointer, a crash…) */
  bad?: boolean;
}

export interface Frame {
  id: string;
  fn: string;
  /** Highest address of the frame (exclusive); the frame spans [base - size, base) */
  base: number;
  size: number;
  slots: Slot[];
  /** Popped, but its bytes are still sitting below the stack pointer */
  ghost: boolean;
}

export interface SlotSpec {
  name: string;
  type: SlotType;
  init?: Val;
  param?: boolean;
  color?: string;
}

export const P_INT = (name: string, v?: number): SlotSpec => ({ name, type: 'int', param: true, init: v == null ? undefined : int(v) });
export const L_INT = (name: string, v?: number): SlotSpec => ({ name, type: 'int', init: v == null ? undefined : int(v) });
export const L_PTR = (name: string, color?: string): SlotSpec => ({ name, type: 'ptr', color });
export const P_PTR = (name: string, init?: Val, color?: string): SlotSpec => ({ name, type: 'ptr', param: true, init, color });
export const L_OWN = (name: string, color?: string): SlotSpec => ({ name, type: 'own', color });

export type BlockState = 'live' | 'free' | 'leaked' | 'garbage';
export type BlockKind = 'cells' | 'fields' | 'text';

export interface Field {
  k: string;
  v: Val;
  flash: number;
  bad?: boolean;
}

export interface Block {
  id: string;
  /** Allocation id: pointers remember it, so reuse of the same address is detectable */
  alloc: number;
  addr: number;
  /** Bytes the chunk occupies (rounded up) */
  size: number;
  /** Bytes the program asked for */
  req: number;
  label: string;
  kind: BlockKind;
  fields: Field[];
  state: BlockState;
  /** The malloc request has landed and the block is drawn */
  shown: boolean;
  /** Its address is in flight and not stored anywhere yet (counts as reachable) */
  pending: boolean;
  flash: number;
  since: number;
  js?: boolean;
  /** What the stale bytes of a freed block now hold */
  meta?: string;
  /** Drawn as a thin bar because the heap column is crowded */
  compact?: boolean;
}

export interface BlockSpec {
  label: string;
  kind: BlockKind;
  fields: [string, Raw][];
}

export const cells = (label: string, n: number, init?: number[]): BlockSpec => ({
  label,
  kind: 'cells',
  fields: Array.from({ length: n }, (_, i): [string, Raw] => [String(i), init ? init[i] : { t: 'none' }]),
});
export const text = (label: string, s?: string): BlockSpec => ({ label, kind: 'text', fields: [['', s == null ? { t: 'none' } : s]] });
export const fields = (label: string, f: [string, Raw][]): BlockSpec => ({ label, kind: 'fields', fields: f });

/** A nested JavaScript object literal: fields may hold other objects. */
export interface ObjSpec {
  label: string;
  fields: [string, Raw | ObjSpec][];
}

export interface OutLine {
  text: string;
  tone?: 'err' | 'dim' | 'warn' | 'ok';
  vt: number;
}

/* ------------------------------------------------------------------ */
/* Programs: source code plus one scripted op per executed line         */
/* ------------------------------------------------------------------ */

export interface Ask {
  /** Shown on the stage while the sim waits */
  q: string;
  choices: { id: string; label: string }[];
  correct: string;
  explain: (ok: boolean, picked: string) => string;
  /** Where the stage prompt sits (a stage target, see MemSim.target) */
  at?: string;
}

export interface Op {
  line: number;
  /** What just happened, in words (the caption under the code) */
  note?: string;
  run?: (m: MemSim) => void;
  /** Seconds before the next op (default: the program's beat) */
  dur?: number;
  /** Predict-then-reveal: freeze and ask before running this op */
  ask?: Ask;
  /** Breakpoint: auto-run stops before this op */
  pause?: boolean;
}

export interface Program {
  id: string;
  file: string;
  lang: Lang;
  code: string;
  ops: Op[];
  /** c: manual free · gc: unreachable objects get collected · rust: ownership */
  mode?: 'c' | 'gc' | 'rust';
  beat?: number;
  /** The command shown at the top of the terminal */
  cmd?: string;
  /** Garbage stays visible until the program runs the collector itself */
  manualGc?: boolean;
}

export function fmtVal(v: Val, lang: Lang, jsId: (alloc: number) => string, tail: (n: number) => string): string {
  switch (v.t) {
    case 'none':
      return '?';
    case 'int':
      return String(v.v);
    case 'str':
      return lang === 'js' ? `'${v.v}'` : `"${v.v}"`;
    case 'code':
      return v.v;
    case 'ptr':
      if (!v.addr) return lang === 'js' ? 'null' : lang === 'rust' ? '·' : 'NULL';
      return lang === 'js' ? jsId(v.prov) : tail(v.addr);
  }
}
