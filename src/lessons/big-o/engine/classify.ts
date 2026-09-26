import type { BigOSim } from '../sim';

/* Classify real snippets. The stage shows the code; after an answer it runs
   the doubling test (steps at n = 8, 16, 32) and annotates the hot line. */

export type Answer = 'c1' | 'logn' | 'n' | 'nlogn' | 'n2';

export interface Snippet {
  id: string;
  file: string;
  code: string;
  answer: Answer;
  /** Steps at n = 8, 16, 32 */
  counts: [number, number, number];
  ratio: string;
  /** Annotation on the line that sets the growth rate */
  mark: [number, string];
  why: string;
}

export const SNIPPETS: Snippet[] = [
  {
    id: 'total',
    file: 'total.js',
    code: `function total(prices) {
  let sum = 0;
  for (const p of prices) sum += p;
  return sum;
}`,
    answer: 'n',
    counts: [8, 16, 32],
    ratio: '×2',
    mark: [3, 'runs n times'],
    why: 'One pass over the input: n additions. Double the prices, double the work.',
  },
  {
    id: 'powers',
    file: 'powers.js',
    code: `function powersOfTwo(n) {
  const out = [];
  for (let i = 1; i < n; i *= 2) out.push(i);
  return out;
}`,
    answer: 'logn',
    counts: [3, 4, 5],
    ratio: '+1',
    mark: [3, 'i doubles: log₂ n rounds'],
    why: 'The counter doubles each round, so it reaches n after about log₂ n rounds. Same halving idea as binary search, run backwards.',
  },
  {
    id: 'common',
    file: 'common.js',
    code: `// a and b both hold n items
function common(a, b) {
  return a.filter((x) => b.includes(x));
}`,
    answer: 'n2',
    counts: [64, 256, 1024],
    ratio: '×4',
    mark: [3, 'n × includes (a loop)'],
    why: 'filter visits n items and includes scans up to n items for each one: a hidden nested loop, n × n. Build a Set from b first and it drops to O(n).',
  },
  {
    id: 'last',
    file: 'last.js',
    code: `function last(arr) {
  return arr[arr.length - 1];
}`,
    answer: 'c1',
    counts: [1, 1, 1],
    ratio: 'same',
    mark: [2, 'one read, any n'],
    why: 'length is stored, and indexing is a single address calculation. No loop, no growth.',
  },
  {
    id: 'middle',
    file: 'middle.js',
    code: `function middle(values) {
  const s = [...values].sort((a, b) => a - b);
  return s[s.length >> 1];
}`,
    answer: 'nlogn',
    counts: [24, 64, 160],
    ratio: '×2.5',
    mark: [2, 'copy n + sort n log n'],
    why: 'Copying is O(n), sorting is O(n log n), reading the middle is O(1). Keep the biggest term: O(n log n).',
  },
];

export const ANSWER_CHOICES: { id: Answer; label: string }[] = [
  { id: 'c1', label: 'O(1)' },
  { id: 'logn', label: 'O(log n)' },
  { id: 'n', label: 'O(n)' },
  { id: 'nlogn', label: 'O(n log n)' },
  { id: 'n2', label: 'O(n²)' },
];

export class ClassifyEngine {
  cur = 0;
  revealed = false;
  revealVt = -10;
  /** Last answer on the current snippet: right, wrong, or none yet */
  verdict: boolean | null = null;
  private queue: number[] = [];
  private gen = 0;

  constructor(private sim: BigOSim) {}

  private later(delay: number, fn: () => void) {
    const g = this.gen;
    this.sim.after(delay, () => {
      if (g === this.gen) fn();
    });
  }

  get snippet() {
    return SNIPPETS[this.cur];
  }

  reset() {
    this.gen++;
    this.queue = SNIPPETS.map((_, i) => i);
    this.show(this.queue.shift() ?? 0);
  }

  private show(i: number) {
    this.cur = i;
    this.revealed = false;
    this.verdict = null;
    this.sim.rev++;
    const game = this.sim.game;
    if (game && !game.done) this.later(0.9, () => this.ask());
    else this.later(2.6, () => this.reveal(null));
  }

  private ask() {
    const game = this.sim.game;
    if (!game || game.done) {
      this.reveal(null);
      return;
    }
    const s = this.snippet;
    game.ask({
      acceptable: [s.answer],
      choices: ANSWER_CHOICES,
      ask: `${s.file}: what's the Big-O?`,
      explain: (_p, ok) => `${ok ? '' : `It's ${ANSWER_CHOICES.find((c) => c.id === s.answer)?.label}. `}${s.why}`,
      resolve: (_p, ok) => {
        if (!ok) this.queue.push(this.cur);
        this.reveal(ok);
      },
    });
  }

  private reveal(ok: boolean | null) {
    this.revealed = true;
    this.verdict = ok;
    this.revealVt = this.sim.vt;
    this.sim.rev++;
    this.later(ok == null ? 5 : 4.6, () => this.next());
  }

  private next() {
    if (!this.queue.length) this.queue = SNIPPETS.map((_, i) => i).filter((i) => i !== this.cur);
    this.show(this.queue.shift() ?? 0);
  }
}
