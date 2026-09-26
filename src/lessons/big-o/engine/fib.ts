import { fibNum } from '../model';
import type { BigOSim } from '../sim';

/* The naive recursive fib(n) call tree, one call at a time. Repeated calls
   (work already done elsewhere) are marked; memoization prunes them into
   cache hits. Nodes are sim boxes, so toggling memo morphs the tree. */

export interface FibNode {
  id: string;
  path: string;
  k: number;
  depth: number;
  parent: string | null;
  children: string[];
  /** Preorder index in the naive tree (= call order) */
  pre: number;
  /** k ≥ 2 and already computed earlier in call order */
  repeat: boolean;
  /** A repeat, or inside a repeat's subtree: work memoization skips */
  wasted: boolean;
  /** A repeat whose parent isn't wasted: becomes a cache hit with memo */
  hit: boolean;
  /** Last preorder index inside this node's subtree (naive tree) */
  last: number;
}

export interface FibArea {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  r: number;
}

function buildTree(n: number): FibNode[] {
  const nodes: FibNode[] = [];
  const seen = new Set<number>();
  const walk = (k: number, path: string, depth: number, parent: FibNode | null, wasted: boolean) => {
    const repeat = k >= 2 && seen.has(k);
    if (k >= 2) seen.add(k);
    const node: FibNode = {
      id: `fib:${path || 'root'}`,
      path,
      k,
      depth,
      parent: parent?.id ?? null,
      children: [],
      pre: nodes.length,
      repeat,
      wasted: wasted || repeat,
      hit: repeat && !wasted,
      last: nodes.length,
    };
    nodes.push(node);
    parent?.children.push(node.id);
    if (k >= 2) {
      walk(k - 1, `${path}L`, depth + 1, node, node.wasted);
      walk(k - 2, `${path}R`, depth + 1, node, node.wasted);
    }
    node.last = nodes.length - 1;
  };
  walk(n, '', 0, null, false);
  return nodes;
}

export class FibEngine {
  n = 5;
  memo = false;
  nodes: FibNode[] = [];
  byId = new Map<string, FibNode>();
  /** Nodes in the current tree, in call order */
  active: FibNode[] = [];
  /** How many of `active` have been called so far */
  revealed = 0;
  /** vt when memo was last toggled (for the collapse flash) */
  morphVt = -10;
  private t = 0;
  private area: FibArea = { x0: 0, y0: 0, x1: 600, y1: 400, r: 14 };

  constructor(private sim: BigOSim) {}

  get rate() {
    return this.memo ? 3 : 4;
  }

  reset(n: number, memo: boolean) {
    this.clearBoxes();
    this.memo = memo;
    this.build(n);
    this.revealed = 0;
    this.t = -0.5;
    this.sim.rev++;
  }

  /** Slider: a new n restarts the calls. */
  setN(n: number) {
    if (n === this.n) return;
    this.clearBoxes();
    this.build(n);
    this.revealed = 0;
    this.t = -0.3;
    this.sim.rev++;
  }

  /** Toggle: morph the finished tree (or restart the calls if it's still running). */
  setMemo(memo: boolean) {
    if (memo === this.memo) return;
    const wasDone = this.revealed >= this.active.length;
    this.memo = memo;
    this.active = this.nodes.filter((nd) => !memo || !nd.wasted || nd.hit);
    this.morphVt = this.sim.vt;
    if (wasDone) {
      for (const nd of this.nodes) {
        if (this.active.includes(nd)) this.sim.box(nd.id);
        else this.sim.hide(nd.id);
      }
      this.revealed = this.active.length;
      this.sim.relayout();
    } else {
      this.clearBoxes();
      this.revealed = 0;
      this.t = -0.3;
    }
    this.sim.rev++;
  }

  private build(n: number) {
    this.n = n;
    this.nodes = buildTree(n);
    this.byId = new Map(this.nodes.map((nd) => [nd.id, nd]));
    this.active = this.nodes.filter((nd) => !this.memo || !nd.wasted || nd.hit);
  }

  private clearBoxes() {
    for (const id of [...this.sim.boxes.keys()]) if (id.startsWith('fib:')) this.sim.hide(id);
  }

  get calls() {
    return Math.min(this.revealed, this.active.length);
  }

  get done() {
    return this.revealed >= this.active.length;
  }

  /** The most recent call (top of the call stack) */
  get top(): FibNode | null {
    return this.done || this.revealed === 0 ? null : this.active[this.revealed - 1];
  }

  /** Ids on the current call stack: the newest call and its ancestors that haven't returned. */
  stack(): Set<string> {
    const out = new Set<string>();
    let nd = this.top;
    while (nd) {
      out.add(nd.id);
      nd = nd.parent ? (this.byId.get(nd.parent) ?? null) : null;
    }
    return out;
  }

  /** Calls that redo earlier work (repeats and everything under them) */
  get wastedCount() {
    return this.nodes.filter((nd) => nd.wasted).length;
  }

  update(dt: number) {
    if (this.done) return;
    this.t += dt;
    const want = Math.min(this.active.length, Math.floor(Math.max(0, this.t) * this.rate) + 1);
    while (this.revealed < want) {
      const nd = this.active[this.revealed++];
      this.sim.box(nd.id);
      this.sim.relayout();
      const b = this.sim.boxes.get(nd.id);
      const p = nd.parent ? this.sim.boxes.get(nd.parent) : null;
      if (b && p) {
        b.x = p.x;
        b.y = p.y;
      }
      this.sim.rev++;
    }
  }

  /* ---------------- layout ---------------- */

  setArea(a: FibArea) {
    this.area = a;
  }

  /** Place every live fib box for the current tree (called from sim.layout). */
  place() {
    const a = this.area;
    const act = new Set(this.active.map((nd) => nd.id));
    // leaf slots in call order
    const slot = new Map<string, number>();
    let leaves = 0;
    const visit = (nd: FibNode) => {
      const kids = nd.children.map((id) => this.byId.get(id)!).filter((c) => act.has(c.id));
      if (!kids.length) {
        slot.set(nd.id, leaves++);
        return;
      }
      kids.forEach(visit);
      slot.set(nd.id, (slot.get(kids[0].id)! + slot.get(kids[kids.length - 1].id)!) / 2);
    };
    const root = this.nodes[0];
    if (root) visit(root);
    const depth = Math.max(1, ...this.active.map((nd) => nd.depth));
    const spanX = a.x1 - a.x0;
    const gapX = leaves > 1 ? Math.min(a.r * 5, spanX / (leaves - 1)) : 0;
    const cx = (a.x0 + a.x1) / 2;
    const gapY = Math.min(a.r * 6.2, (a.y1 - a.y0) / depth);
    const top = a.y0 + ((a.y1 - a.y0) - gapY * depth) / 2;
    for (const nd of this.nodes) {
      if (!this.sim.boxes.has(nd.id) || !act.has(nd.id)) continue;
      const s = slot.get(nd.id) ?? 0;
      const r = nd.hit && this.memo ? a.r * 0.78 : a.r;
      this.sim.place(nd.id, cx + (s - (leaves - 1) / 2) * gapX, top + nd.depth * gapY, r * 2, r * 2);
    }
  }
}

/** fib(k) value, for labels */
export const fibValue = (k: number) => fibNum(k);
