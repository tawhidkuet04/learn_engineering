import { PredictGame } from '@/lib/sim/predict';
import { Sim, type ScriptEvent } from '@/lib/sim/Sim';
import { BinaryEngine, type BinaryMode } from './engine/binary';
import { ChartEngine, type ChartMode } from './engine/chart';
import { ClassifyEngine } from './engine/classify';
import { ConstEngine } from './engine/constant';
import { FibEngine } from './engine/fib';
import { GridEngine } from './engine/grid';
import { LapseEngine } from './engine/lapse';
import { MergeEngine, type MergeMode } from './engine/merge';
import { RaceEngine, type RacePreset } from './engine/race';
import { ScanEngine, type ScanMode } from './engine/scan';
import { fibArea, calloutRect, type Rect } from './layout';
import type { ClassId } from './model';

/* ------------------------------------------------------------------ */
/* Config                                                              */
/* ------------------------------------------------------------------ */

export type View = 'race' | 'scan' | 'constant' | 'binary' | 'merge' | 'grid' | 'fib' | 'chart' | 'lapse' | 'classify';
export type PredictKind = 'halving' | 'double' | 'constants' | 'classify';

export interface Cfg {
  view: View;
  race: RacePreset;
  scan: ScanMode;
  /** scan/max: sweep n = 4, 8, 12, 16 on entry */
  sweep: boolean;
  /** Input size for the view (constant, merge, grid, fib, race/space, lapse) */
  n: number;
  binary: BinaryMode;
  merge: MergeMode;
  memo: boolean;
  chart: ChartMode;
  log: boolean;
  lanes: ClassId[];
  /** Lapse race restarts by itself when it ends */
  loop: boolean;
}

export const DEFAULTS: Cfg = {
  view: 'race',
  race: 'machines',
  scan: 'max',
  sweep: false,
  n: 16,
  binary: 'array',
  merge: 'split',
  memo: false,
  chart: 'classes',
  log: false,
  lanes: ['c1', 'logn', 'n', 'nlogn', 'n2', 'exp'],
  loop: true,
};

/* ------------------------------------------------------------------ */

export class BigOSim extends Sim {
  cfg: Cfg = { ...DEFAULTS };
  game: PredictGame | null = null;
  pKind: PredictKind | null = null;
  /** Legend labels for this step (phones reserve room for them) */
  legendLabels: string[] = [];

  race = new RaceEngine(this);
  scan = new ScanEngine(this);
  konst = new ConstEngine(this);
  bin = new BinaryEngine(this);
  merge = new MergeEngine(this);
  grid = new GridEngine(this);
  fib = new FibEngine(this);
  chart = new ChartEngine(this);
  lapse = new LapseEngine(this);
  classify = new ClassifyEngine(this);

  /** Called by the lesson whenever a step starts or replays. */
  enter(cfg: Cfg, script: ScriptEvent<BigOSim>[] = [], opts: { predict?: PredictKind | null; needed?: number; legend?: string[] } = {}) {
    this.cfg = { ...cfg, lanes: [...cfg.lanes] };
    this.legendLabels = opts.legend ?? [];
    this.clearTransient();
    this.pKind = opts.predict ?? null;
    this.game = this.pKind ? new PredictGame(this, opts.needed ?? 2) : null;
    if (cfg.view !== 'fib') for (const id of [...this.boxes.keys()]) if (id.startsWith('fib:')) this.boxes.delete(id);
    const c = this.cfg;
    switch (c.view) {
      case 'race':
        this.race.reset(c.race, c.n);
        break;
      case 'scan':
        this.scan.reset(c.scan, c.n, c.sweep);
        break;
      case 'constant':
        this.konst.reset(c.n);
        break;
      case 'binary':
        this.bin.reset(c.binary);
        break;
      case 'merge':
        this.merge.reset(c.merge, c.n);
        break;
      case 'grid':
        this.grid.reset(c.n);
        break;
      case 'fib':
        this.fib.reset(c.n, c.memo);
        break;
      case 'chart':
        this.chart.reset(c.chart, c.n, c.log);
        break;
      case 'lapse':
        this.lapse.reset(c.lanes, c.n, c.loop);
        break;
      case 'classify':
        this.classify.reset();
        break;
    }
    this.runScript(script);
    this.relayout();
    this.rev++;
  }

  /* ---------------- learner controls (panel cards call these) ---------------- */

  setScanN(n: number) {
    this.scan.setN(n);
  }
  runCase(kind: 'best' | 'avg' | 'worst') {
    this.scan.runCase(kind);
  }
  setConstN(n: number) {
    this.konst.setN(n);
  }
  nextSearch() {
    this.bin.next();
  }
  setMergeN(n: number) {
    this.merge.setN(n);
  }
  setGridN(n: number) {
    this.grid.setN(n);
  }
  setFibN(n: number) {
    this.fib.setN(n);
  }
  setMemo(on: boolean) {
    this.fib.setMemo(on);
  }
  setChartN(n: number) {
    this.chart.setN(n);
  }
  setChartLog(on: boolean) {
    this.chart.setLog(on);
  }
  setSpaceN(n: number) {
    this.race.setN(n);
  }
  setLapseN(n: number) {
    this.lapse.setN(n);
  }
  toggleLapseLane(id: ClassId) {
    this.lapse.toggleLane(id);
  }
  raceAgain() {
    if (this.cfg.view === 'lapse') this.lapse.race();
  }

  /* ---------------- sim hooks ---------------- */

  protected layout() {
    if (this.cfg.view === 'fib') {
      this.fib.setArea(fibArea(this));
      this.fib.place();
    }
  }

  protected step(dt: number) {
    switch (this.cfg.view) {
      case 'race':
        this.race.update(dt);
        break;
      case 'scan':
        this.scan.update(dt);
        break;
      case 'constant':
        this.konst.update(dt);
        break;
      case 'binary':
        this.bin.update(dt);
        break;
      case 'merge':
        this.merge.update(dt);
        break;
      case 'grid':
        this.grid.update(dt);
        break;
      case 'fib':
        this.fib.update(dt);
        break;
      case 'lapse':
        this.lapse.update(dt);
        break;
      default:
        break;
    }
  }

  protected animate(dt: number) {
    if (this.cfg.view === 'chart') this.chart.animate(dt);
  }

  /** Callout targets for the current view. */
  calloutRect(target: string): Rect | null {
    return calloutRect(this, target);
  }
}
