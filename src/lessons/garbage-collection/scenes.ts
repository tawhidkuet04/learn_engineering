import type { SceneDef } from './types';

/*
 * Object graphs used across the lesson. Positions are fractions of the graph
 * region: (u, v) in landscape (u = depth, left to right; v = lane, top to
 * bottom) and p = [x, y] in portrait. Heap addresses are block indexes
 * (16 bytes each) chosen so memory looks like a real, interleaved heap.
 */

/** Chapter 2: roots, a register, and some garbage (including garbage that points at a live object). */
const roots: SceneDef = {
  roots: [
    { id: 'cache', label: 'cache', section: 'globals', v: 0 },
    { id: 'user', label: 'user', section: 'stack', frame: 'main', v: 0.33, px: 0.33 },
    { id: 'cart', label: 'cart', section: 'stack', frame: 'main', v: 0.66, px: 0.67 },
    { id: 'rax', label: 'rax', section: 'registers', v: 1, px: 1 },
  ],
  objs: [
    { id: 'avatar', label: 'avatar', kind: 'img', size: 3, u: 0.84, v: 0.06, p: [0, 0.5], addr: 9 },
    { id: 'user', label: 'user', kind: 'obj', size: 2, u: 0, v: 0.33, p: [0.33, 0], addr: 0 },
    { id: 'profile', label: 'profile', kind: 'obj', size: 1, u: 0.42, v: 0.33, p: [0.33, 0.5], addr: 4 },
    { id: 'cart', label: 'cart', kind: 'obj', size: 1, u: 0, v: 0.66, p: [0.67, 0], addr: 2 },
    { id: 'item', label: 'item', kind: 'obj', size: 1, u: 0.42, v: 0.66, p: [0.67, 0.5], addr: 12 },
    { id: 'product', label: 'product', kind: 'obj', size: 2, u: 0.84, v: 0.66, p: [0.67, 1], addr: 13 },
    { id: 'tmp', label: 'total', kind: 'str', size: 1, u: 0, v: 1, p: [1, 0], addr: 15 },
    { id: 'draft', label: 'draft', kind: 'obj', size: 2, u: 0.42, v: 1, p: [1, 0.5], addr: 5 },
    { id: 'note', label: 'note', kind: 'str', size: 1, u: 0.84, v: 1, p: [1, 1], addr: 3 },
  ],
  refs: [
    ['r:cache', 'o:avatar'],
    ['r:user', 'o:user'],
    ['o:user', 'o:profile'],
    ['o:profile', 'o:avatar'],
    ['r:cart', 'o:cart'],
    ['o:cart', 'o:item'],
    ['o:item', 'o:product'],
    ['r:rax', 'o:tmp'],
    ['o:draft', 'o:note'],
    ['o:draft', 'o:product'],
  ],
};

/** Chapter 2 predict: the shop graph with a shared avatar and a session cycle. */
const shop: SceneDef = {
  roots: [
    { id: 'cache', label: 'cache', section: 'globals', v: 0 },
    { id: 'user', label: 'user', section: 'stack', frame: 'main', v: 0.33, px: 0.33 },
    { id: 'cart', label: 'cart', section: 'stack', frame: 'main', v: 0.66, px: 0.67 },
    { id: 'session', label: 'session', section: 'stack', frame: 'main', v: 1, px: 1 },
  ],
  objs: [
    { id: 'avatar', label: 'avatar', kind: 'img', size: 3, u: 0.84, v: 0.06, p: [0, 0.5], addr: 9 },
    { id: 'user', label: 'user', kind: 'obj', size: 2, u: 0, v: 0.33, p: [0.33, 0], addr: 0 },
    { id: 'profile', label: 'profile', kind: 'obj', size: 1, u: 0.42, v: 0.33, p: [0.33, 0.5], addr: 4 },
    { id: 'cart', label: 'cart', kind: 'obj', size: 1, u: 0, v: 0.66, p: [0.67, 0], addr: 2 },
    { id: 'item', label: 'item', kind: 'obj', size: 1, u: 0.42, v: 0.66, p: [0.67, 0.5], addr: 12 },
    { id: 'product', label: 'product', kind: 'obj', size: 2, u: 0.84, v: 0.66, p: [0.67, 1], addr: 13 },
    { id: 'sessA', label: 'session', kind: 'obj', size: 2, u: 0, v: 1, p: [1, 0], addr: 5 },
    { id: 'sessB', label: 'token', kind: 'obj', size: 1, u: 0.42, v: 1, p: [1, 0.5], addr: 3 },
  ],
  refs: [
    ['r:cache', 'o:avatar'],
    ['r:user', 'o:user'],
    ['o:user', 'o:profile'],
    ['o:profile', 'o:avatar'],
    ['r:cart', 'o:cart'],
    ['o:cart', 'o:item'],
    ['o:item', 'o:product'],
    ['r:session', 'o:sessA'],
    ['o:sessA', 'o:sessB'],
    ['o:sessB', 'o:sessA'],
  ],
};

/** Chapter 3: reference counting on the shop graph (no cycle). */
const rc: SceneDef = {
  roots: [
    { id: 'cache', label: 'cache', section: 'globals', v: 0.04, px: 0 },
    { id: 'user', label: 'user', section: 'stack', frame: 'main', v: 0.45, px: 0.5 },
    { id: 'cart', label: 'cart', section: 'stack', frame: 'main', v: 0.9, px: 1 },
  ],
  objs: [
    { id: 'avatar', label: 'avatar', kind: 'img', size: 3, u: 0.84, v: 0.1, p: [0, 0.5], addr: 9 },
    { id: 'user', label: 'user', kind: 'obj', size: 2, u: 0, v: 0.45, p: [0.5, 0], addr: 0 },
    { id: 'profile', label: 'profile', kind: 'obj', size: 1, u: 0.42, v: 0.45, p: [0.5, 0.5], addr: 4 },
    { id: 'cart', label: 'cart', kind: 'obj', size: 1, u: 0, v: 0.9, p: [1, 0], addr: 2 },
    { id: 'item', label: 'item', kind: 'obj', size: 1, u: 0.42, v: 0.9, p: [1, 0.5], addr: 12 },
    { id: 'product', label: 'product', kind: 'obj', size: 2, u: 0.84, v: 0.9, p: [1, 1], addr: 13 },
  ],
  refs: [
    ['r:cache', 'o:avatar'],
    ['r:user', 'o:user'],
    ['o:user', 'o:profile'],
    ['o:profile', 'o:avatar'],
    ['r:cart', 'o:cart'],
    ['o:cart', 'o:item'],
    ['o:item', 'o:product'],
  ],
};

/** Chapter 3 predict: a chain and a cycle. */
const cycle: SceneDef = {
  roots: [
    { id: 'doc', label: 'doc', section: 'stack', frame: 'render', v: 0.12, px: 0.18 },
    { id: 'tree', label: 'tree', section: 'stack', frame: 'render', v: 0.82, px: 0.82 },
  ],
  objs: [
    { id: 'page', label: 'page', kind: 'obj', size: 2, u: 0, v: 0.12, p: [0.18, 0], addr: 0 },
    { id: 'para', label: 'para', kind: 'obj', size: 1, u: 0.42, v: 0.12, p: [0.18, 0.5], addr: 4 },
    { id: 'text', label: 'text', kind: 'str', size: 2, u: 0.84, v: 0.12, p: [0.18, 1], addr: 7 },
    { id: 'parent', label: 'parent', kind: 'obj', size: 2, u: 0, v: 0.82, p: [0.82, 0], addr: 2 },
    { id: 'child', label: 'child', kind: 'obj', size: 2, u: 0.42, v: 0.82, p: [0.82, 0.5], addr: 5 },
  ],
  refs: [
    ['r:doc', 'o:page'],
    ['o:page', 'o:para'],
    ['o:para', 'o:text'],
    ['r:tree', 'o:parent'],
    ['o:parent', 'o:child'],
    ['o:child', 'o:parent'],
  ],
};

/** Chapter 3: fixing cycles with weak references or CPython's cycle detector. */
const weak: SceneDef = {
  roots: [
    { id: 'tree', label: 'tree', section: 'stack', frame: 'main', v: 0.12, px: 0.2 },
    { id: 'config', label: 'config', section: 'globals', v: 0.84, px: 0.8 },
  ],
  objs: [
    { id: 'parent', label: 'parent', kind: 'obj', size: 2, u: 0, v: 0.12, p: [0.2, 0], addr: 0 },
    { id: 'child', label: 'child', kind: 'obj', size: 2, u: 0.46, v: 0.12, p: [0.2, 0.62], addr: 4 },
    { id: 'settings', label: 'settings', kind: 'obj', size: 2, u: 0, v: 0.84, p: [0.8, 0], addr: 2 },
    { id: 'theme', label: 'theme', kind: 'obj', size: 1, u: 0.46, v: 0.84, p: [0.8, 0.62], addr: 6 },
  ],
  refs: [
    ['r:tree', 'o:parent'],
    ['o:parent', 'o:child'],
    ['o:child', 'o:parent'],
    ['r:config', 'o:settings'],
    ['o:settings', 'o:theme'],
  ],
};

/** Chapter 4: mark and sweep. Live objects plus a garbage cycle and a stray array. */
const mark: SceneDef = {
  roots: [
    { id: 'cache', label: 'cache', section: 'globals', v: 0 },
    { id: 'user', label: 'user', section: 'stack', frame: 'main', v: 0.34, px: 0.34 },
    { id: 'cart', label: 'cart', section: 'stack', frame: 'main', v: 0.68, px: 0.68 },
  ],
  objs: [
    { id: 'user', label: 'user', kind: 'obj', size: 2, u: 0, v: 0.34, p: [0.34, 0], addr: 0 },
    { id: 'draft', label: 'draft', kind: 'obj', size: 2, u: 0.42, v: 1, p: [1, 0], addr: 2 },
    { id: 'profile', label: 'profile', kind: 'obj', size: 2, u: 0.42, v: 0.34, p: [0.34, 0.5], addr: 4 },
    { id: 'log', label: 'log', kind: 'arr', size: 3, u: 0, v: 1, p: [0, 1], addr: 6 },
    { id: 'cart', label: 'cart', kind: 'obj', size: 1, u: 0, v: 0.68, p: [0.68, 0], addr: 9 },
    { id: 'avatar', label: 'avatar', kind: 'img', size: 4, u: 0.84, v: 0.06, p: [0, 0.5], addr: 12 },
    { id: 'note', label: 'note', kind: 'str', size: 2, u: 0.84, v: 1, p: [1, 0.5], addr: 10 },
    { id: 'item', label: 'item', kind: 'obj', size: 1, u: 0.42, v: 0.68, p: [0.68, 0.5], addr: 16 },
    { id: 'product', label: 'product', kind: 'obj', size: 2, u: 0.84, v: 0.68, p: [0.68, 1], addr: 17 },
  ],
  refs: [
    ['r:cache', 'o:avatar'],
    ['r:user', 'o:user'],
    ['o:user', 'o:profile'],
    ['o:profile', 'o:avatar'],
    ['r:cart', 'o:cart'],
    ['o:cart', 'o:item'],
    ['o:item', 'o:product'],
    ['o:draft', 'o:note'],
    ['o:note', 'o:draft'],
    ['o:draft', 'o:product'],
  ],
};

/** Chapter 4: the same program in two panes, one per collector. */
function splitPane(pane: number): SceneDef {
  const k = pane === 0 ? 'a' : 'b';
  return {
    roots: [
      { id: `${k}.doc`, label: 'doc', section: 'stack', frame: 'main', v: 0.1, px: 0.05, pane },
      { id: `${k}.config`, label: 'config', section: 'globals', v: 0.9, px: 0.95, pane },
    ],
    objs: [
      { id: `${k}.page`, label: 'page', kind: 'obj', size: 2, u: 0, v: 0.1, p: [0.05, 0], pane },
      { id: `${k}.para`, label: 'para', kind: 'obj', size: 2, u: 1, v: 0.1, p: [0.5, 0], pane },
      { id: `${k}.cfg`, label: 'theme', kind: 'obj', size: 1, u: 0, v: 0.9, p: [0.95, 0], pane },
    ],
    refs: [
      [`r:${k}.doc`, `o:${k}.page`],
      [`o:${k}.page`, `o:${k}.para`],
      [`o:${k}.para`, `o:${k}.page`],
      [`r:${k}.config`, `o:${k}.cfg`],
    ],
  };
}

const split: SceneDef = {
  roots: [...splitPane(0).roots, ...splitPane(1).roots],
  objs: [...splitPane(0).objs, ...splitPane(1).objs],
  refs: [...splitPane(0).refs, ...splitPane(1).refs],
};

/*
 * Heap-view scenes. Objects are drawn as blocks at their addresses; roots sit
 * in a row above the heap (px = x across). In portrait the heap wraps into
 * two rows of 12 blocks, so no object crosses block 11/12.
 */

/** Chapter 5: a fragmented heap. Holes at 2, 6-7, 9-11, 18-19 and 23: 9 free blocks, the biggest hole is 3. */
const frag: SceneDef = {
  roots: [
    { id: 'a', label: 'a', section: 'stack', frame: 'main', v: 0.04, px: 0.04 },
    { id: 'b', label: 'b', section: 'stack', frame: 'main', v: 0.34, px: 0.62 },
  ],
  objs: [
    { id: 'user', label: 'user', kind: 'obj', size: 2, u: 0, v: 0, addr: 0 },
    { id: 'cart', label: 'cart', kind: 'obj', size: 3, u: 0, v: 0, addr: 3 },
    { id: 'tag', label: 'tag', kind: 'str', size: 1, u: 0, v: 0, addr: 8 },
    { id: 'img', label: 'img', kind: 'img', size: 3, u: 0, v: 0, addr: 12 },
    { id: 'row', label: 'row', kind: 'arr', size: 3, u: 0, v: 0, addr: 15 },
    { id: 'log', label: 'log', kind: 'arr', size: 2, u: 0, v: 0, addr: 20 },
    { id: 'ids', label: 'ids', kind: 'arr', size: 1, u: 0, v: 0, addr: 22 },
  ],
  refs: [
    ['r:a', 'o:user'],
    ['r:b', 'o:tag'],
    ['o:user', 'o:cart'],
    ['o:cart', 'o:img'],
    ['o:tag', 'o:row'],
    ['o:row', 'o:log'],
    ['o:log', 'o:ids'],
  ],
};

/** Chapter 5: compaction. The fragmented heap after a 3-block allocation, plus one new piece of garbage. */
const compact: SceneDef = {
  roots: frag.roots,
  objs: [
    ...frag.objs,
    { id: 'buf', label: 'buf', kind: 'arr', size: 3, u: 0, v: 0, addr: 9 },
    { id: 'tmp', label: 'tmp', kind: 'str', size: 2, u: 0, v: 0, addr: 18 },
  ],
  refs: [...frag.refs, ['o:tag', 'o:buf']],
};

/** Chapter 5: a copying collector. From-space is blocks 0-11, to-space 12-23. */
const copy: SceneDef = {
  roots: [
    { id: 'a', label: 'a', section: 'stack', frame: 'main', v: 0.2, px: 0.14 },
    { id: 'b', label: 'b', section: 'stack', frame: 'main', v: 0.6, px: 0.4 },
  ],
  objs: [
    { id: 'user', label: 'user', kind: 'obj', size: 2, u: 0, v: 0, addr: 0 },
    { id: 'tmp', label: 'tmp', kind: 'str', size: 1, u: 0, v: 0, addr: 2 },
    { id: 'cart', label: 'cart', kind: 'obj', size: 2, u: 0, v: 0, addr: 3 },
    { id: 'old', label: 'old', kind: 'obj', size: 2, u: 0, v: 0, addr: 5 },
    { id: 'item', label: 'item', kind: 'obj', size: 1, u: 0, v: 0, addr: 7 },
    { id: 'log', label: 'log', kind: 'arr', size: 2, u: 0, v: 0, addr: 8 },
    { id: 'prod', label: 'prod', kind: 'obj', size: 2, u: 0, v: 0, addr: 10 },
  ],
  refs: [
    ['r:a', 'o:user'],
    ['r:b', 'o:cart'],
    ['o:user', 'o:prod'],
    ['o:cart', 'o:item'],
    ['o:item', 'o:prod'],
    ['o:tmp', 'o:cart'],
    ['o:old', 'o:log'],
  ],
};

/** Chapter 7: the leak hunt. Closures and reports are added by the script. */
const leak: SceneDef = {
  roots: [
    { id: 'window', label: 'window', section: 'globals', v: 0.02, px: 0.2 },
    { id: 'document', label: 'document', section: 'globals', v: 0.98, px: 0.8 },
  ],
  objs: [
    { id: 'listeners', label: 'resize', kind: 'arr', size: 1, u: 0, v: 0.02, p: [0.2, 0], sub: 'listeners' },
    { id: 'body', label: 'body', kind: 'dom', size: 1, u: 0, v: 0.98, p: [0.8, 0] },
  ],
  refs: [
    ['r:window', 'o:listeners'],
    ['r:document', 'o:body'],
  ],
};

/** Chapter 8: the playground's starting graph. */
const pg: SceneDef = {
  roots: [
    { id: 'a', label: 'a', section: 'stack', frame: 'main', v: 0, px: 0 },
    { id: 'b', label: 'b', section: 'stack', frame: 'main', v: 0.33, px: 0.33 },
    { id: 'c', label: 'c', section: 'stack', frame: 'main', v: 0.66, px: 0.67 },
    { id: 'g', label: 'g', section: 'globals', v: 1, px: 1 },
  ],
  objs: [
    { id: 'n1', label: 'user', kind: 'obj', size: 2, u: 0, v: 0, p: [0, 0], addr: 0, slot: 0 },
    { id: 'n2', label: 'cart', kind: 'obj', size: 1, u: 0.45, v: 0, p: [0, 0.5], addr: 2, slot: 1 },
    { id: 'n3', label: 'node', kind: 'obj', size: 2, u: 0, v: 0.33, p: [0.33, 0], addr: 5, slot: 3 },
    { id: 'n4', label: 'node', kind: 'obj', size: 2, u: 0.45, v: 0.33, p: [0.33, 0.5], addr: 3, slot: 4 },
    { id: 'n5', label: 'config', kind: 'obj', size: 1, u: 0, v: 1, p: [1, 0], addr: 7, slot: 9 },
    { id: 'n6', label: 'list', kind: 'arr', size: 3, u: 0.45, v: 1, p: [1, 0.5], addr: 8, slot: 10 },
  ],
  refs: [
    ['r:a', 'o:n1'],
    ['o:n1', 'o:n2'],
    ['r:b', 'o:n3'],
    ['o:n3', 'o:n4'],
    ['o:n4', 'o:n3'],
    ['r:g', 'o:n5'],
    ['o:n5', 'o:n6'],
  ],
};

/** Chapter 1: a global config that lives forever, plus the request handler's frame. The script allocates the rest. */
const intro: SceneDef = {
  roots: [
    { id: 'config', label: 'config', section: 'globals', v: 0, px: 0 },
    { id: 'req', label: 'req', section: 'stack', frame: 'handleRequest', v: 0.36, px: 0.36 },
    { id: 'user', label: 'user', section: 'stack', frame: 'handleRequest', v: 0.68, px: 0.68 },
    { id: 'cart', label: 'cart', section: 'stack', frame: 'handleRequest', v: 1, px: 1 },
  ],
  objs: [{ id: 'config', label: 'config', kind: 'obj', size: 4, u: 0, v: 0, p: [0, 0], addr: 0 }],
  refs: [['r:config', 'o:config']],
};

/** Chapter 1: a C program managing memory by hand. */
const manual: SceneDef = {
  roots: [
    { id: 'user', label: 'user', section: 'stack', frame: 'main', v: 0.06, px: 0.14 },
    { id: 'cart', label: 'cart', section: 'stack', frame: 'main', v: 0.5, px: 0.5 },
    { id: 'line', label: 'line', section: 'stack', frame: 'main', v: 0.94, px: 0.86 },
  ],
  objs: [
    { id: 'user', label: 'user', kind: 'raw', size: 3, u: 0.3, v: 0.06, p: [0.14, 0.2], addr: 0, sub: 'struct user' },
    { id: 'cart', label: 'cart', kind: 'raw', size: 2, u: 0.3, v: 0.5, p: [0.5, 0.2], addr: 3, sub: 'struct cart' },
  ],
  refs: [
    ['r:user', 'o:user'],
    ['r:cart', 'o:cart'],
  ],
};

export const SCENES: Record<string, SceneDef> = { roots, shop, rc, cycle, weak, mark, split, frag, compact, copy, leak, pg, intro, manual };
