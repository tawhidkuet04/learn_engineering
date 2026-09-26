/* Shared types for the Garbage Collection lesson. */

export type View = 'graph' | 'split' | 'heap' | 'gen' | 'threads';
export type Section = 'stack' | 'globals' | 'registers';
/** Visual kind of a heap object: plain object, array, function/closure, DOM node, image bytes, string, raw C struct. */
export type ObjKind = 'obj' | 'arr' | 'fn' | 'dom' | 'img' | 'str' | 'raw';
/** Tri-color marking state. */
export type Mark = 'white' | 'gray' | 'black';
/** What has happened to an object. */
export type Fate = 'live' | 'garbage' | 'leaked' | 'freed' | 'ghost';
/** Whether (and why) the learner can click arrows. */
export type CutMode = 'off' | 'free' | 'predict';
export type GcMode = 'stw' | 'parallel' | 'incremental' | 'concurrent';
/** Which heap scenario a heap-view step plays. */
export type HeapPlay = 'none' | 'frag' | 'compact' | 'copy';

export interface RootDef {
  id: string;
  label: string;
  section: Section;
  /** Lane in landscape (0 = top of the graph region, 1 = bottom) */
  v: number;
  /** Portrait x position (0..1 across); defaults to v */
  px?: number;
  /** Stack frame name, e.g. main */
  frame?: string;
  pane?: number;
}

export interface ObjDef {
  id: string;
  label: string;
  kind?: ObjKind;
  /** Heap blocks (16 bytes each) */
  size: number;
  /** Landscape position: u = depth (0 left .. 1 right), v = lane (0 top .. 1 bottom) */
  u: number;
  v: number;
  /** Portrait position [x across, y down], 0..1; defaults to [v, u] */
  p?: [number, number];
  addr?: number;
  pane?: number;
  /** Small second line, e.g. "5 MB" */
  sub?: string;
  /** Playground grid slot */
  slot?: number;
}

export type RefDef = [from: string, to: string, opts?: { weak?: boolean; bend?: number }];

export interface SceneDef {
  roots: RootDef[];
  objs: ObjDef[];
  refs: RefDef[];
}

export interface GcConfig {
  view: View;
  /** Scene to build when the step resets */
  scene: string | null;
  /** Show reference counts and free on zero */
  rc: boolean;
  /** Heap strip under the object graph: always, never, or landscape only */
  heap: 'on' | 'off' | 'land';
  cut: CutMode;
  /** Heap-view scenario */
  play: HeapPlay;
  /* generational world */
  allocRate: number;
  generational: boolean;
  /** Share of objects that live a long time */
  longLived: number;
  /** Allocation stops (scripted steps drive the world instead) */
  genPaused: boolean;
  /* pause timeline */
  gcMode: GcMode;
  liveMB: number;
  /** A readout is docked at the bottom of the stage on phones (heap strip moves up) */
  ro: boolean;
}

export const DEFAULTS: GcConfig = {
  view: 'graph',
  scene: null,
  rc: false,
  heap: 'on',
  cut: 'off',
  play: 'none',
  allocRate: 9,
  generational: true,
  longLived: 0.1,
  genPaused: false,
  gcMode: 'stw',
  liveMB: 300,
  ro: false,
};
