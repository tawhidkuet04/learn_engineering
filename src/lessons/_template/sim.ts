import { SIG } from '@/lib/sim/colors';
import { PredictGame } from '@/lib/sim/predict';
import { Sim, type ScriptEvent, type WireSpec } from '@/lib/sim/Sim';

/**
 * TEMPLATE: copy this folder to src/lessons/<your-slug>/ and replace
 * everything. A lesson sim owns all state; the stage just draws it.
 *
 * Here: a client sends a request to a server, which asks a database, then
 * responds. The server keeps a tiny cache so we can ask "hit or miss?".
 */
export interface DemoConfig {
  rps: number;
  cache: boolean;
}

export const DEFAULTS: DemoConfig = { rps: 0.8, cache: false };

export class DemoSim extends Sim {
  cfg: DemoConfig = { ...DEFAULTS };
  game: PredictGame | null = null;
  cached = new Set<string>();
  served = 0;
  hits = 0;
  lastKey: string | null = null;
  private nextIn = 0.3;
  private keys = ['/home', '/cart', '/home', '/about', '/cart', '/home'];
  private n = 0;

  constructor() {
    super();
    this.box('client');
    this.box('server');
    this.box('db');
  }

  /** Components must change the sim through methods, never by assigning fields. */
  setRps(rps: number) {
    this.cfg = { ...this.cfg, rps };
    this.rev++;
  }

  /** Called by the lesson when a step starts. */
  enter(cfg: DemoConfig, script: ScriptEvent<DemoSim>[] = [], opts: { reset?: boolean; predict?: number } = {}) {
    this.cfg = { ...cfg };
    if (opts.reset) {
      this.clearTransient();
      this.cached.clear();
      this.served = 0;
      this.hits = 0;
      this.n = 0;
    }
    this.game = opts.predict ? new PredictGame(this, opts.predict) : null;
    this.runScript(script);
    this.rev++;
  }

  protected layout() {
    const { w, h } = this;
    if (this.orient === 'landscape') {
      this.place('client', w * 0.14, h * 0.5, 150, 42);
      this.place('server', w * 0.5, h * 0.5, 170, 62);
      this.place('db', w * 0.84, h * 0.5, 120, 70);
    } else {
      this.place('client', w * 0.5, h * 0.2, 150, 40);
      this.place('server', w * 0.5, h * 0.47, 160, 58);
      this.place('db', w * 0.5, h * 0.74, 120, 66);
    }
  }

  protected wires(): WireSpec[] {
    return [
      { from: 'client', to: 'server' },
      { from: 'server', to: 'db', state: this.cfg.cache ? 'dim' : 'normal' },
    ];
  }

  protected step(dt: number) {
    this.nextIn -= dt;
    if (this.nextIn <= 0 && this.cfg.rps > 0) {
      this.nextIn += 1 / this.cfg.rps;
      this.request();
    }
  }

  private request() {
    const key = this.keys[this.n++ % this.keys.length];
    this.send({
      from: 'client',
      to: 'server',
      dur: 0.9,
      label: key,
      onArrive: () => this.atServer(key),
    });
  }

  private atServer(key: string) {
    const hit = this.cfg.cache && this.cached.has(key);
    const proceed = () => {
      if (hit) {
        this.hits++;
        this.say('server', 'cache hit', SIG.res);
        this.respond();
      } else {
        this.send({ from: 'server', to: 'db', dur: 0.7, color: SIG.req, onArrive: () => this.send({ from: 'db', to: 'server', dur: 0.7, color: SIG.res, onArrive: () => this.respond(key) }) });
      }
    };
    // Prediction: freeze and ask before revealing.
    if (this.game && !this.game.done && this.cfg.cache) {
      this.game.ask({
        acceptable: [hit ? 'hit' : 'miss'],
        choices: [
          { id: 'hit', label: 'Cache hit' },
          { id: 'miss', label: 'Cache miss' },
        ],
        ask: `Is ${key} in the cache?`,
        askAt: { id: 'server' },
        explain: () => (hit ? `${key} was fetched earlier, so it's still cached.` : `${key} hasn't been fetched yet, so the server must ask the database.`),
        resolve: proceed,
      });
      return;
    }
    proceed();
  }

  private respond(key?: string) {
    if (key && this.cfg.cache) this.cached.add(key);
    this.served++;
    this.lastKey = key ?? this.lastKey;
    this.flashWire('client', 'server');
    this.send({ from: 'server', to: 'client', dur: 0.9, color: SIG.res });
    this.rev++;
  }
}
