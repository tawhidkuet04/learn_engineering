import type { Curve } from '@/lib/sim/geometry';
import { PredictGame } from '@/lib/sim/predict';
import { Sim, type WireSpec } from '@/lib/sim/Sim';
import { CERT_DEFAULTS, CertCtl, type CertCfg } from './cert';
import { PAINT_DEFAULTS, PaintCtl, type PaintCfg } from './paint';
import { SHAKE_DEFAULTS, ShakeCtl, type ShakeCfg } from './shake';
import { WIRE_DEFAULTS, WireCtl, type WireCfg } from './wire';

export type SceneId = 'wire' | 'paint' | 'cert' | 'shake';

/** What a step asks for: a scene plus that scene's settings. */
export interface StageCfg {
  scene: SceneId;
  wire?: Partial<WireCfg>;
  paint?: Partial<PaintCfg>;
  cert?: Partial<CertCfg>;
  shake?: Partial<ShakeCfg>;
}

/**
 * One simulation, four scenes. Each scene controller owns its state and
 * boxes; the sim routes layout, stepping, wires and curves to the active one.
 * Components never touch fields directly: they call the controllers' methods.
 */
export class TlsSim extends Sim {
  scene: SceneId = 'wire';
  game: PredictGame | null = null;
  readonly wire = new WireCtl(this);
  readonly paint = new PaintCtl(this);
  readonly cert = new CertCtl(this);
  readonly shake = new ShakeCtl(this);

  enter(cfg: StageCfg, opts: { reset?: boolean; predict?: number } = {}) {
    const changed = cfg.scene !== this.scene || !this.entered;
    this.entered = true;
    const reset = !!opts.reset || changed;
    // A previous step may have been frozen on a prediction: always thaw.
    this.frozen = false;
    if (reset) this.clearTransient();
    if (changed) {
      for (const s of ['wire', 'paint', 'cert', 'shake'] as SceneId[]) if (s !== cfg.scene) this.ctl(s).teardown();
    }
    this.scene = cfg.scene;
    this.game = opts.predict ? new PredictGame(this, opts.predict) : null;
    switch (cfg.scene) {
      case 'wire':
        this.wire.enter({ ...WIRE_DEFAULTS, ...cfg.wire }, reset);
        break;
      case 'paint':
        this.paint.enter({ ...PAINT_DEFAULTS, ...cfg.paint }, reset);
        break;
      case 'cert':
        this.cert.enter({ ...CERT_DEFAULTS, ...cfg.cert }, reset);
        break;
      case 'shake':
        this.shake.enter({ ...SHAKE_DEFAULTS, ...cfg.shake }, reset);
        break;
    }
    this.runScript([]);
    this.relayout();
    this.rev++;
  }

  private entered = false;

  /**
   * Like place(), but never creates a box. The kit's place() revives a box
   * that already faded out and was deleted, so a later relayout would bring
   * hidden nodes (Eve, unsent certificates) back. Scenes lay out with this.
   */
  put(id: string, x: number, y: number, w: number, h: number) {
    if (this.boxes.has(id)) this.place(id, x, y, w, h);
  }

  private ctl(s: SceneId = this.scene) {
    return s === 'wire' ? this.wire : s === 'paint' ? this.paint : s === 'cert' ? this.cert : this.shake;
  }

  protected layout() {
    this.ctl().layout();
  }

  protected step(dt: number) {
    this.ctl().step(dt);
  }

  protected wires(): WireSpec[] {
    return this.ctl().wires();
  }

  protected curveFor(from: string, to: string, lane: number): Curve | null {
    if (this.scene === 'paint') {
      const c = this.paint.curve(from, to, lane);
      if (c) return c;
    }
    if (this.scene === 'cert') {
      const c = this.cert.curve(from, to, lane);
      if (c) return c;
    }
    return super.curveFor(from, to, lane);
  }
}
