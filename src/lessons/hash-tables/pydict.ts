import { polyHash } from './hashing';

/**
 * CPython's "compact dict" (3.6+), simplified: a sparse array of small
 * integers (`indices`) that points into a dense array of entries kept in
 * insertion order. Probing follows CPython's recurrence:
 *
 *   perturb = hash;  i = hash & mask
 *   while taken:  perturb >>= 5;  i = (5*i + perturb + 1) & mask
 *
 * The dict resizes before inserting when it is 2/3 full (USABLE_FRACTION),
 * to the next power of two ≥ used × 3 (GROWTH_RATE). We use the toy hash so
 * the numbers can be followed; real CPython hashes strings with SipHash.
 */

export interface PyEntry {
  key: string;
  hash: number;
}

export interface PyProbe {
  slot: number;
  /** perturb value used to compute this slot (after shifting), null for the first */
  perturb: number | null;
  /** slot we came from */
  prev: number | null;
  taken: boolean;
}

export class PyDict {
  indices: (number | null)[];
  entries: PyEntry[] = [];

  constructor(public size = 8) {
    this.indices = Array.from({ length: size }, () => null);
  }

  get mask() {
    return this.size - 1;
  }

  /** USABLE_FRACTION(n) = (n << 1) / 3 */
  get usable() {
    return Math.floor((this.size * 2) / 3);
  }

  has(key: string) {
    return this.entries.some((e) => e.key === key);
  }

  /** Would inserting one more new key trigger a resize first? */
  needsResize() {
    return this.entries.length >= this.usable;
  }

  /** GROWTH_RATE(d) = used × 3, rounded up to a power of two */
  grownSize() {
    let n = 8;
    while (n < this.entries.length * 3) n *= 2;
    return n;
  }

  probe(hash: number): PyProbe[] {
    const mask = this.mask;
    let perturb = hash;
    let i = hash & mask;
    const out: PyProbe[] = [{ slot: i, perturb: null, prev: null, taken: this.indices[i] !== null }];
    let guard = 0;
    while (this.indices[i] !== null && guard++ < 64) {
      perturb = Math.floor(perturb / 32);
      const prev = i;
      i = (i * 5 + perturb + 1) & mask;
      out.push({ slot: i, perturb, prev, taken: this.indices[i] !== null });
    }
    return out;
  }

  insert(key: string): { seq: PyProbe[]; entry: number } {
    const hash = polyHash(key);
    const seq = this.probe(hash);
    const entry = this.entries.length;
    this.entries.push({ key, hash });
    this.indices[seq[seq.length - 1].slot] = entry;
    return { seq, entry };
  }

  /** A bigger, empty index array over the same entries (indices get re-placed one by one). */
  static withEntries(size: number, entries: PyEntry[]): PyDict {
    const d = new PyDict(size);
    d.entries = entries.map((e) => ({ ...e }));
    return d;
  }

  /** Put entry n's position into the index array (used while rebuilding). */
  placeIndex(n: number): PyProbe[] {
    const seq = this.probe(this.entries[n].hash);
    this.indices[seq[seq.length - 1].slot] = n;
    return seq;
  }
}
