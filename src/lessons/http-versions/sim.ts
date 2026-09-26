import { SIG } from '@/lib/sim/colors';
import { damp } from '@/lib/sim/geometry';
import { PredictGame, type Question } from '@/lib/sim/predict';
import { Sim, type ScriptEvent } from '@/lib/sim/Sim';
import { MS, PageLoad, PROTO_NAME, type LoadConfig, type Pkt, type Proto } from './engine';
import { makePage } from './page';

/* ------------------------------------------------------------------ */
/* Stage configuration: every step sets one of these                    */
/* ------------------------------------------------------------------ */

export type View = 'lanes' | 'race' | 'seq' | 'devtools';
export type Lower = 'waterfall' | 'hpack';
export type Mode = 'plain' | 'hol' | 'quic' | 'frames' | 'hpack' | 'h1req' | 'migration' | 'altsvc' | 'handshakes' | 'race-predict' | 'playground';
export type RaceKey = 'h1.1' | 'h2' | 'h3';
export const RACE: RaceKey[] = ['h1.1', 'h2', 'h3'];

export interface StageCfg {
  view: View;
  lower: Lower;
  mode: Mode;
  proto: Proto;
  rttMs: number;
  /** Real packet loss rate. A chunk (~11 packets) is lost if any of its packets is. */
  pktLoss: number;
  count: number;
  conns: number;
  zeroRtt: boolean;
  bundle: boolean;
  /** The server takes 250 ms to produce hero.jpg */
  slowHero: boolean;
  /** Label handshake and request packets */
  labels: boolean;
  /** Data chunks (send order) that are always lost */
  forceLoss: number[];
  seed: number;
  /** New random losses on every reload */
  varySeed: boolean;
  loop: boolean;
  /** Learner can click chunks to drop them */
  clickDrop: boolean;
}

export const DEFAULT_CFG: StageCfg = {
  view: 'lanes',
  lower: 'waterfall',
  mode: 'plain',
  proto: 'h1.1',
  rttMs: 100,
  pktLoss: 0,
  count: 12,
  conns: 6,
  zeroRtt: false,
  bundle: false,
  slowHero: false,
  labels: false,
  forceLoss: [],
  seed: 7,
  varySeed: false,
  loop: true,
  clickDrop: false,
};

export const chunkLoss = (p: number) => 1 - Math.pow(1 - p, 11);
export const SLOW_HERO = 2.5;
const LOOP_WAIT = 2.8;
const RACE_WAIT = 3.6;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Geo {
  browser: Rect;
  server: Rect;
  /** Between the browser and the server: x0..x1, and the band the lanes use */
  lanes: Rect;
  lower: Rect;
  race: Rect;
  rows: Rect[];
  seqA: Rect;
  seqB: Rect | null;
  devtools: Rect;
}

const EMPTY: Rect = { x: 0, y: 0, w: 0, h: 0 };

export interface SeqState {
  /** When each diagram started animating (stepT), or null */
  a: number | null;
  b: number | null;
  bKind: '1rtt' | '0rtt';
}

export interface RaceFinal {
  ms: number;
  stalled: number;
}

export function variantKey(c: Pick<StageCfg, 'proto' | 'conns' | 'zeroRtt'>) {
  if (c.proto === 'h3') return c.zeroRtt ? 'h3·0rtt' : 'h3';
  if (c.proto === 'h1.1' || c.proto === 'h1.0') return c.conns === 6 ? c.proto : `${c.proto}·${c.conns}`;
  return c.proto;
}

const niceCeil = (ms: number) => (ms <= 1000 ? Math.ceil(ms / 100) * 100 : Math.ceil(ms / 200) * 200);

/**
 * The lesson's world: a browser and a server loading shop.example over one
 * HTTP version (or three at once, for the race). All protocol behavior lives
 * in PageLoad; this class wires steps, predictions, learner actions and layout.
 */
export class HttpSim extends Sim {
  cfg: StageCfg = { ...DEFAULT_CFG };
  load: PageLoad;
  raceLoads: Record<RaceKey, PageLoad> | null = null;
  raceFinal: Record<RaceKey, RaceFinal> | null = null;
  raceClean: Record<RaceKey, number> | null = null;
  raceOn = false;
  game: PredictGame | null = null;
  /** Last load time (ms) for each variant, for side-by-side comparisons */
  results: Record<string, number> = {};
  /** The last finished load with the current settings (null until one finishes) */
  lastMs: number | null = null;
  loads = 0;
  /** Waterfall time axis (ms): eased toward the target */
  wfScale = 1000;
  wfTarget = 1000;
  altSvcKnown = false;
  altSvcVt = -10;
  seq: SeqState = { a: null, b: null, bKind: '1rtt' };
  insp: { id: number; until: number; x: number; y: number } | null = null;
  lastLossVt = -10;
  G: Geo = { browser: EMPTY, server: EMPTY, lanes: EMPTY, lower: EMPTY, race: EMPTY, rows: [], seqA: EMPTY, seqB: null, devtools: EMPTY };

  private asked = new Set<string>();
  private right = new Set<string>();
  private doneT: number | null = null;
  private raceDoneT: number | null = null;
  private migratedGen = -1;
  private reloads = 0;
  private inspGapT = 0;
  private inspKind: Pkt['kind'] | null = null;
  private seqT0 = 0;

  constructor() {
    super();
    this.load = this.newLoad(this.cfg.proto);
    this.box('browser');
    this.box('server');
  }

  /* ---------------- steps ---------------- */

  enter(cfg: StageCfg, opts: { predict?: number; script?: ScriptEvent<HttpSim>[] } = {}) {
    this.cfg = { ...cfg };
    this.clearTransient();
    this.asked.clear();
    this.right.clear();
    this.game = opts.predict ? new PredictGame(this, opts.predict) : null;
    this.results = {};
    this.lastMs = null;
    this.seq = { a: null, b: null, bKind: '1rtt' };
    this.seqT0 = 0;
    this.altSvcKnown = false;
    this.altSvcVt = -10;
    this.reloads = 0;
    this.wfTarget = 0;
    this.restart();
    this.wfScale = this.wfTarget;
    this.syncBoxes();
    this.relayout();
    this.runScript(opts.script ?? []);
    this.rev++;
  }

  /** Start the page load (or the race) over. */
  restart() {
    const c = this.cfg;
    this.doneT = null;
    this.raceDoneT = null;
    this.insp = null;
    this.inspGapT = 0;
    this.migratedGen = -1;
    this.reloads++;
    // Missed a prediction? Each new run asks again until the game is won.
    if (this.game && !this.game.done) this.asked.clear();
    if (c.view === 'race') {
      const seed = c.varySeed ? c.seed + this.reloads * 101 : c.seed;
      this.raceLoads = { 'h1.1': this.newLoad('h1.1', { seed }), h2: this.newLoad('h2', { seed }), h3: this.newLoad('h3', { seed }) };
      const final = {} as Record<RaceKey, RaceFinal>;
      const clean = {} as Record<RaceKey, number>;
      for (const k of RACE) {
        const L = new PageLoad(this.loadCfg(k, { seed })).runToEnd();
        final[k] = { ms: L.loadMs, stalled: L.res.filter((r) => r.stalls.length > 0).length };
        clean[k] = new PageLoad(this.loadCfg(k, { seed, loss: 0 })).runToEnd().loadMs;
      }
      this.raceFinal = final;
      this.raceClean = clean;
      this.raceOn = c.mode !== 'race-predict' || !this.game || this.game.done || this.right.has('winner');
      const worst = Math.max(...RACE.map((k) => final[k].ms));
      this.wfTarget = niceCeil(worst * 1.04);
    } else {
      this.raceLoads = null;
      const proto = c.mode === 'altsvc' ? (this.altSvcKnown ? 'h3' : 'h2') : c.proto;
      const seed = c.varySeed ? c.seed + this.reloads * 101 : c.seed;
      this.load = this.newLoad(proto, { seed });
      const est = new PageLoad(this.loadCfg(proto, { seed })).runToEnd().loadMs;
      this.wfTarget = niceCeil(est * 1.06);
    }
    this.rev++;
  }

  private loadCfg(proto: Proto, o: { seed?: number; loss?: number } = {}): LoadConfig {
    const c = this.cfg;
    return {
      proto,
      rttMs: c.rttMs,
      loss: o.loss ?? chunkLoss(c.pktLoss),
      files: makePage(c.count, { bundle: c.bundle, slow: c.slowHero ? { name: 'hero.jpg', t: SLOW_HERO } : null }),
      conns: c.conns,
      zeroRtt: proto === 'h3' && c.zeroRtt,
      seed: o.seed ?? c.seed,
      forceLoss: c.forceLoss,
    };
  }

  private newLoad(proto: Proto, o: { seed?: number } = {}) {
    const L: PageLoad = new PageLoad(this.loadCfg(proto, o), {
      onLost: (p) => this.onLost(L, p),
      onLoad: () => this.onLoaded(L),
    });
    return L;
  }

  private onLost(L: PageLoad, p: Pkt) {
    if (L !== this.load || this.cfg.view === 'race') return;
    const pt = this.pktXY(L, p, p.lostAt ?? 0.5);
    this.fx({ kind: 'x', at: pt, color: SIG.err, dur: 1.3, size: 1.1 });
    if (p.why !== 'dead') this.lastLossVt = this.vt;
    this.rev++;
  }

  private onLoaded(L: PageLoad) {
    if (L !== this.load || this.cfg.view === 'race') return;
    this.loads++;
    const key = variantKey({ ...this.cfg, proto: L.cfg.proto });
    this.results = { ...this.results, [key]: L.loadMs };
    this.lastMs = L.loadMs;
    this.doneT = this.t;
    if (this.cfg.mode === 'altsvc' && L.cfg.proto === 'h2') this.altSvcKnown = true;
    if (this.cfg.view === 'lanes') {
      this.fx({ kind: 'ring', at: { id: 'browser' }, color: SIG.res, size: 2.4, dur: 1.2 });
      this.sayBrowser(`loaded in ${Math.round(L.loadMs)} ms`, SIG.res, 2.2);
    }
    this.rev++;
  }

  /* ---------------- learner actions ---------------- */

  setCfg(patch: Partial<StageCfg>) {
    const viewChanged = patch.view != null && patch.view !== this.cfg.view;
    this.cfg = { ...this.cfg, ...patch };
    this.lastMs = null;
    this.clearTransient();
    this.restart();
    if (viewChanged) {
      this.wfScale = this.wfTarget;
      this.syncBoxes();
    }
    this.relayout();
    this.rev++;
  }
  setRtt(ms: number) {
    this.setCfg({ rttMs: ms });
  }
  setLoss(p: number) {
    this.setCfg({ pktLoss: p });
  }
  setCount(n: number) {
    this.setCfg({ count: n });
  }
  setProto(p: Proto) {
    this.setCfg({ proto: p });
  }
  reload() {
    this.clearTransient();
    this.restart();
  }
  dropNext() {
    if (this.cfg.view !== 'lanes') return;
    if (this.load.done) this.reload();
    this.load.dropNextChunk();
    this.rev++;
  }
  dropPacket(id: number) {
    if (!this.cfg.clickDrop) return;
    if (this.load.dropPacket(id)) this.rev++;
  }
  /** Walk out of Wi-Fi range: the browser's IP address changes mid-load. */
  switchNetwork() {
    if (this.cfg.view !== 'lanes') return;
    if (this.load.done) {
      this.reload();
      return;
    }
    this.doMigrate();
  }
  forgetAltSvc() {
    this.altSvcKnown = false;
    this.reload();
  }

  /** A floating label over the browser card, nudged so it never leaves the stage. */
  private sayBrowser(text: string, color: string, dur: number) {
    const b = this.G.browser;
    const half = (text.length * 6.4 + 16) / 2;
    const x = Math.min(Math.max(b.x + b.w / 2, half + 6), this.w - half - 6);
    this.fx({ kind: 'text', at: { x, y: b.y + b.h / 2 + 12 }, text, color, dur });
  }

  private doMigrate() {
    const L = this.load;
    if (!L.migrate()) return;
    this.migratedGen = this.reloads;
    this.fx({ kind: 'ring', at: { id: 'browser' }, color: SIG.warn, size: 2.2, dur: 1 });
    this.sayBrowser(L.net === 'cell' ? 'Wi-Fi → 5G: new IP' : '5G → Wi-Fi: new IP', SIG.warn, 2.4);
    this.rev++;
  }

  /* ---------------- predictions ---------------- */

  /** A question that hasn't been asked in this run and wasn't already answered right */
  private canAsk(key: string) {
    return !!this.game && !this.game.done && !this.asked.has(key) && !this.right.has(key);
  }

  /** Ask once per run; a right answer retires the question for the rest of the step. */
  private pose(key: string, q: Question) {
    if (!this.game || !this.canAsk(key)) return false;
    this.asked.add(key);
    return this.game.ask({
      ...q,
      resolve: (picked, ok) => {
        if (ok) this.right.add(key);
        q.resolve?.(picked, ok);
      },
    });
  }

  /* ---------------- clock ---------------- */

  protected step(dt: number) {
    const stop = () => this.frozen;
    const c = this.cfg;
    if (c.view === 'seq') {
      this.stepSeq();
      return;
    }
    if (c.view === 'race' && this.raceLoads) {
      this.stepRace(dt, stop);
      return;
    }
    const L = this.load;
    L.advance(dt, stop);
    if (this.frozen) return;
    this.watch(L);
    if (L.done && this.doneT != null && c.loop && this.t - this.doneT > LOOP_WAIT) this.restart();
    const need = L.loadMs * 1.04;
    if (need > this.wfTarget) this.wfTarget = niceCeil(need);
  }

  protected animate(dt: number) {
    this.wfScale = damp(this.wfScale, this.wfTarget || this.wfScale, 5, dt);
  }

  private stepRace(dt: number, stop: () => boolean) {
    const loads = this.raceLoads!;
    const c = this.cfg;
    if (!this.raceOn) {
      if (this.canAsk('winner')) {
        if (this.stepT > 0.5) this.askWinner();
      } else if (!this.game?.pending) this.raceOn = true;
      return;
    }
    for (const k of RACE) {
      loads[k].advance(dt, stop);
      if (this.frozen) return;
    }
    const all = RACE.every((k) => loads[k].done);
    if (all) {
      if (this.raceDoneT == null) {
        this.raceDoneT = this.t;
        this.rev++;
      }
      if (c.mode === 'race-predict' && this.canAsk('stalls')) {
        this.askStalls();
        return;
      }
      if (c.loop && this.t - this.raceDoneT > RACE_WAIT) this.restart();
    }
    const tmax = Math.max(...RACE.map((k) => loads[k].loadMs)) * 1.04;
    if (tmax > this.wfTarget) this.wfTarget = niceCeil(tmax);
  }

  /** Things that react to the page load: predictions, the inspector, network switches. */
  private watch(L: PageLoad) {
    const c = this.cfg;
    const g = this.game;
    if (c.mode === 'hol' && g && !g.done) {
      const lost = L.lastLoss;
      const forced = !!lost && lost.why === 'forced' && lost.res != null;
      if (forced && this.canAsk('loss')) {
        const name = L.res[lost!.res!].name;
        const pt = this.pktXY(L, lost!, lost!.lostAt ?? 0.5);
        this.pose('loss', {
          acceptable: ['all'],
          choices: [
            { id: 'one', label: `Only ${name}` },
            { id: 'all', label: 'Every file behind it' },
          ],
          ask: `${name} lost a chunk. Who waits?`,
          askAt: { x: pt.x, y: pt.y - 16 },
          explain: (_p, ok) =>
            ok
              ? 'TCP hands the browser one ordered stream of bytes. Every chunk behind the gap waits in its buffer, whichever file it belongs to.'
              : `TCP doesn't know about files. It delivers bytes strictly in order, so every chunk behind the gap waits, not just ${name}'s.`,
        });
        return;
      }
      if (forced && !this.game?.pending && this.canAsk('resend')) {
        const f = L.inFlight().find((x) => x.p.retx && x.k > 0.62);
        if (f) {
          const pt = this.pktXY(L, f.p, f.k);
          this.pose('resend', {
            acceptable: ['flush'],
            choices: [
              { id: 'flush', label: 'Delivered at once' },
              { id: 'resend', label: 'Resent too' },
            ],
            ask: 'The resend lands. Then what?',
            askAt: { x: pt.x, y: pt.y - 16 },
            explain: (_p, ok) =>
              ok
                ? 'The held chunks already arrived safely. Once the gap is filled, TCP hands all of them to the browser in one burst.'
                : 'They already arrived safely, and the browser told the server so (selective ACKs). Only the lost chunk is resent; the rest is released in one burst.',
          });
          return;
        }
      }
    }
    if (c.mode === 'migration' && this.migratedGen !== this.reloads && !L.done && L.deliveredChunks >= 0.3 * L.totalChunks) this.doMigrate();
    if (c.mode === 'frames' || c.mode === 'hpack' || c.mode === 'h1req' || c.mode === 'altsvc') this.trackInspector(L);
  }

  /**
   * The inspector card rides one packet across, then lingers where it landed
   * long enough to read (sim time, so pausing keeps it up), then picks another.
   */
  private trackInspector(L: PageLoad) {
    const c = this.cfg;
    const cur = this.insp;
    if (cur) {
      const f = L.inFlight().find((x) => x.p.id === cur.id);
      if (f) {
        const pt = this.pktXY(L, f.p, f.k);
        this.insp = { ...cur, x: pt.x, y: pt.y };
        return;
      }
      if (this.t < cur.until) return;
      this.insp = null;
      this.inspGapT = this.t;
      this.rev++;
    }
    if (this.t - this.inspGapT < 0.3) return;
    const flying = L.inFlight().filter((f) => f.k < 0.35);
    let pick: Pkt | null = null;
    if (c.mode === 'hpack' || c.mode === 'h1req') pick = flying.find((f) => f.p.kind === 'req')?.p ?? null;
    else if (c.mode === 'altsvc') pick = L.cfg.proto === 'h2' ? (flying.find((f) => f.p.kind === 'data' && f.p.res === 0 && f.p.chunk === 0)?.p ?? null) : null;
    else {
      // frames: alternate between HEADERS frames (requests) and DATA frames
      const req = flying.find((f) => f.p.kind === 'req')?.p;
      const data = flying.find((f) => f.p.kind === 'data')?.p;
      pick = this.inspKind === 'data' ? (req ?? data ?? null) : (data ?? req ?? null);
    }
    if (pick) {
      const pt = this.pktXY(L, pick, 0);
      this.inspKind = pick.kind;
      this.insp = { id: pick.id, until: this.t + (c.mode === 'altsvc' ? 3.2 : 2.3), x: pt.x, y: pt.y };
      this.rev++;
    }
  }

  /* ---------------- handshake race (sequence diagrams) ---------------- */

  /** Seconds per one-way trip in the sequence diagrams */
  get seqOwd() {
    return 0.75;
  }

  /** Which diagram a phone-sized stage shows */
  get seqFocus(): 'a' | 'b' {
    return this.seq.b != null || this.asked.has('quic') ? 'b' : 'a';
  }

  /** Pixels per simulated second in a sequence diagram of this size */
  seqPx(r: Rect) {
    return Math.max(40, (r.h - 50 - 70) / (6 * this.seqOwd));
  }

  private stepSeq() {
    const g = this.game;
    const asking = !!g && !g.done;
    const o = this.seqOwd;
    let s = this.seq;
    // A round with a missed answer plays again, so there is always a next question.
    if (asking && s.bKind === '0rtt' && s.b != null && this.stepT - s.b > 2 * o + 3) {
      this.seq = { a: null, b: null, bKind: '1rtt' };
      this.asked.clear();
      this.seqT0 = this.stepT;
      s = this.seq;
    }
    const T = this.stepT;
    if (s.a == null) {
      if (T - this.seqT0 < 0.7) return;
      if (this.canAsk('tcp')) {
        this.pose('tcp', {
          acceptable: ['2'],
          choices: [
            { id: '1', label: '1 round trip' },
            { id: '2', label: '2 round trips' },
            { id: '3', label: '3 round trips' },
          ],
          ask: 'TCP + TLS 1.3: round trips before GET?',
          askAt: this.seqAsk('a'),
          explain: (_p, ok) =>
            (ok ? '' : 'Two. ') +
            'TCP’s handshake takes one round trip (SYN, SYN-ACK). Only then can TLS 1.3 start its own: ClientHello out, ServerHello and friends back. The request leaves after 2 round trips.',
          resolve: () => {
            this.seq = { ...this.seq, a: this.stepT };
          },
        });
      } else if (!g?.pending) this.seq = { ...s, a: T };
      return;
    }
    if (s.b == null) {
      if (T - s.a < 6 * o + 1.2) return;
      if (this.canAsk('quic')) {
        this.pose('quic', {
          acceptable: ['1'],
          choices: [
            { id: '0', label: '0 round trips' },
            { id: '1', label: '1 round trip' },
            { id: '2', label: '2 round trips' },
          ],
          ask: 'QUIC: round trips before GET?',
          askAt: this.seqAsk('b'),
          explain: (_p, ok) =>
            (ok ? '' : 'One. ') +
            'QUIC carries the TLS 1.3 handshake inside its own first packets, so connection and encryption are set up together in a single round trip.',
          resolve: () => {
            this.seq = { ...this.seq, b: this.stepT, bKind: '1rtt' };
          },
        });
      } else if (!g?.pending) this.seq = { ...s, b: T, bKind: '1rtt' };
      return;
    }
    if (s.bKind === '1rtt' && T - s.b > 4 * o + 1.4) {
      if (this.canAsk('zero')) {
        this.pose('zero', {
          acceptable: ['0'],
          choices: [
            { id: '0', label: '0 round trips' },
            { id: '1', label: '1 round trip' },
            { id: '2', label: '2 round trips' },
          ],
          ask: 'Coming back tomorrow: round trips?',
          askAt: this.seqAsk('b', 4 * o),
          explain: (_p, ok) =>
            (ok ? '' : 'Zero. ') +
            'The browser kept a session ticket from last time, so it can encrypt the GET immediately and send it in its very first flight: 0-RTT.',
          resolve: () => {
            this.seq = { ...this.seq, b: this.stepT, bKind: '0rtt' };
          },
        });
      } else if (!g?.pending) this.seq = { ...s, b: T, bKind: '0rtt' };
    }
  }

  /** Where a question sits: at the top of an empty diagram, or under the messages already drawn */
  private seqAsk(which: 'a' | 'b', below = 0) {
    const r = which === 'a' || !this.G.seqB ? this.G.seqA : this.G.seqB;
    const y = below > 0 ? r.y + 66 + below * this.seqPx(r) + 58 : r.y + 70;
    return { x: r.x + r.w / 2, y };
  }

  /* ---------------- race predictions ---------------- */

  private askWinner() {
    const f = this.raceFinal!;
    const winner = RACE.reduce((a, b) => (f[b].ms < f[a].ms ? b : a));
    const r = this.raceArea(0);
    this.pose('winner', {
      acceptable: [winner],
      choices: RACE.map((k) => ({ id: k, label: PROTO_NAME[k] })),
      ask: 'Which one finishes first?',
      askAt: { x: r.x + r.w / 2, y: r.y + r.h * 0.55 },
      explain: (_p, ok) =>
        `${ok ? '' : `${PROTO_NAME[winner]} wins. `}HTTP/3 ${Math.round(f.h3.ms)} ms, HTTP/2 ${Math.round(f.h2.ms)} ms, HTTP/1.1 ${Math.round(f['h1.1'].ms)} ms. HTTP/3 starts a round trip earlier, and a loss only ever holds up the one stream it hit.`,
      resolve: () => {
        this.raceOn = true;
      },
    });
  }

  private askStalls() {
    const f = this.raceFinal!;
    const most = RACE.reduce((a, b) => (f[b].stalled > f[a].stalled ? b : a));
    const r = this.raceArea(2);
    this.pose('stalls', {
      acceptable: [most],
      choices: RACE.map((k) => ({ id: k, label: PROTO_NAME[k] })),
      ask: 'Which one stalled the most files?',
      askAt: { x: r.x + r.w * 0.8, y: r.y + r.h * 0.5 },
      explain: (_p, ok) =>
        `${ok ? '' : `${PROTO_NAME[most]}. `}Files stalled by loss: HTTP/2 ${f.h2.stalled}, HTTP/1.1 ${f['h1.1'].stalled}, HTTP/3 ${f.h3.stalled}. One lost chunk freezes every stream sharing HTTP/2’s TCP connection.`,
    });
  }

  /* ---------------- layout ---------------- */

  private syncBoxes() {
    if (this.cfg.view === 'lanes') {
      this.box('browser');
      this.box('server');
    } else {
      this.hide('browser');
      this.hide('server');
    }
  }

  protected layout() {
    const { w, h } = this;
    const P = this.orient === 'portrait';
    const pad = P ? 10 : this.compact ? 18 : 24;
    const top = P ? 62 : 78;
    // keep clear of the legend + controls (bottom-left) and the title block (bottom-right)
    // (a phone legend can wrap to two lines)
    const bottom = h - (P ? 96 : 96);
    const bw = P ? 98 : this.compact ? 150 : 176;
    const sw = P ? 64 : this.compact ? 106 : 124;
    const bh = P ? 150 : Math.round(Math.min(230, Math.max(176, (h - top) * 0.285)));
    const browser = { x: pad, y: top, w: bw, h: bh };
    const server = { x: w - pad - sw, y: top, w: sw, h: bh };
    const lanes = { x: pad + bw, y: top + (P ? 16 : 22), w: w - 2 * pad - bw - sw, h: bh - (P ? 24 : 34) };
    // The waterfall sits at the bottom; spare height becomes a band above it for callouts.
    const n = this.load.res.length;
    const W = this.wfDims();
    const need = W.head + n * W.rowMax + (P ? 12 : 16);
    const avail = bottom - (top + bh);
    const gap = Math.max(P ? 12 : 24, Math.min(P ? 44 : 98, avail - need));
    const lowerTop = top + bh + gap;
    const lower = { x: pad, y: lowerTop, w: w - 2 * pad, h: Math.max(80, bottom - lowerTop) };
    if (this.isLive('browser')) this.place('browser', browser.x + bw / 2, browser.y + bh / 2, bw, bh);
    if (this.isLive('server')) this.place('server', server.x + sw / 2, server.y + bh / 2, sw, bh);

    const race = { x: pad, y: P ? 58 : 74, w: w - 2 * pad, h: (P ? h - 96 : h - 100) - (P ? 58 : 74) };
    const rgap = P ? 10 : 14;
    const rh = (race.h - 2 * rgap) / 3;
    const rows = [0, 1, 2].map((i) => ({ x: race.x, y: race.y + i * (rh + rgap), w: race.w, h: rh }));

    const sy = P ? 96 : 104;
    const sh = (P ? h - 76 : h - 108) - sy;
    const seqA = P ? { x: pad + 4, y: sy, w: w - 2 * pad - 8, h: sh } : { x: pad, y: sy, w: (w - 2 * pad) / 2 - 14, h: sh };
    const seqB = P ? null : { x: w / 2 + 14, y: sy, w: (w - 2 * pad) / 2 - 14, h: sh };
    const dtTop = P ? 40 : 48;
    const dtRows = 30 + 28 + 24 + 26 + Math.max(12, n) * (P ? 24 : 28) + 2;
    const dtMax = (P ? h - 86 : h - 100) - dtTop;
    const dtH = Math.min(dtMax, dtRows);
    const devtools = { x: pad, y: dtTop + Math.max(0, (dtMax - dtH) / 2), w: w - 2 * pad, h: dtH };
    this.G = { browser, server, lanes, lower, race, rows, seqA, seqB, devtools };
  }

  /** Waterfall proportions for n rows */
  wfDims() {
    const P = this.orient === 'portrait';
    return { head: P ? 26 : 34, rowMax: P ? 17 : 20 };
  }

  /** The waterfall area inside race row i (the info column sits on its left, or on top on phones) */
  raceArea(i: number): Rect {
    const r = this.G.rows[i] ?? EMPTY;
    const P = this.orient === 'portrait';
    if (P) return { x: r.x + 10, y: r.y + 52, w: r.w - 20, h: r.h - 60 };
    return { x: r.x + 198, y: r.y + 26, w: r.w - 198 - 14, h: r.h - 26 - 24 };
  }

  /* ---------------- geometry helpers for the scene ---------------- */

  /** y of each lane for the current protocol */
  laneYs(L: PageLoad): number[] {
    const r = this.G.lanes;
    const mid = r.y + r.h / 2;
    if (L.h1) {
      const n = Math.max(1, L.cfg.conns);
      if (n === 1) return [mid];
      return Array.from({ length: n }, (_, i) => r.y + ((i + 0.5) * r.h) / n);
    }
    if (L.cfg.proto === 'h2') return [mid];
    const n = L.nSlots;
    const inset = 10;
    if (n === 1) return [mid];
    return Array.from({ length: n }, (_, i) => r.y + inset + (i * (r.h - 2 * inset)) / (n - 1));
  }

  pktXY(L: PageLoad, p: Pkt, k: number) {
    const r = this.G.lanes;
    const x0 = r.x + 2;
    const x1 = r.x + r.w - 2;
    const x = p.up ? x0 + k * (x1 - x0) : x1 - k * (x1 - x0);
    const ys = this.laneYs(L);
    const mid = r.y + r.h / 2;
    let y = mid;
    if (L.h1) {
      const c = L.conns[p.conn];
      y = (ys[c?.lane ?? 0] ?? mid) + (p.up ? -3 : 3);
    } else if (L.cfg.proto === 'h2') y = mid + (p.up ? -6 : 5);
    else if ((p.kind === 'data' || p.kind === 'req') && p.res != null) y = ys[L.res[p.res].slot] ?? mid;
    return { x, y };
  }

  /** Where the held (arrived but blocked) chunks of a lane pile up */
  holdXY(L: PageLoad, lane: number, j: number) {
    const r = this.G.lanes;
    const P = this.orient === 'portrait';
    const step = P ? 7 : 9.5;
    const ys = this.laneYs(L);
    const mid = r.y + r.h / 2;
    const y = L.h1 ? (ys[lane] ?? mid) + 3 : L.cfg.proto === 'h2' ? mid + 5 : (ys[lane] ?? mid);
    return { x: r.x + (P ? 16 : 22) + j * step, y };
  }

  /** Rectangles for callouts and narration highlights */
  resolveTarget(target: string): Rect | null {
    const G = this.G;
    const c = (r: Rect) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2, w: r.w, h: r.h });
    const v = this.cfg.view;
    if (target === 'browser' || target === 'server') return v === 'lanes' ? c(target === 'browser' ? G.browser : G.server) : null;
    if (target === 'lanes') return v === 'lanes' ? c(G.lanes) : null;
    if (target === 'lanes-r' && v === 'lanes') return { x: G.lanes.x + G.lanes.w * 0.66, y: G.lanes.y + G.lanes.h / 2, w: 40, h: G.lanes.h };
    if (target.startsWith('race-hs:') && v === 'race' && this.raceLoads) {
      const k = target.slice(8) as RaceKey;
      const i = RACE.indexOf(k);
      const L = this.raceLoads[k];
      const s = L.res[0]?.segs.find((x) => x.kind === 'connect');
      if (i < 0 || !s) return null;
      const A = this.raceArea(i);
      const rowH = A.h / L.res.length;
      const xa = A.x + ((s.t0 * MS) / this.wfScale) * A.w;
      const xb = A.x + (((s.t1 ?? L.now) * MS) / this.wfScale) * A.w;
      return { x: (xa + xb) / 2, y: A.y + rowH / 2, w: Math.max(6, xb - xa), h: Math.max(4, rowH) };
    }
    if (target === 'lower') return v === 'lanes' ? c(G.lower) : null;
    if (target === 'devtools') return v === 'devtools' ? c(G.devtools) : null;
    if (target.startsWith('race:')) {
      const i = RACE.indexOf(target.slice(5) as RaceKey);
      return v === 'race' && G.rows[i] ? c(G.rows[i]) : null;
    }
    if (target === 'hold' && v === 'lanes') {
      const L = this.load;
      const hs = L.holds();
      if (!hs.length) return null;
      const hd = hs[0];
      const a = this.holdXY(L, hd.lane, 0);
      const b = this.holdXY(L, hd.lane, Math.max(0, hd.pkts.length - 1));
      return { x: (a.x + b.x) / 2, y: a.y, w: b.x - a.x + 14, h: 12 };
    }
    if (target === 'pipe' && v === 'lanes') {
      const r = G.lanes;
      return { x: r.x + r.w / 2, y: r.y + r.h / 2, w: r.w * 0.5, h: this.load.cfg.proto === 'h2' ? 30 : r.h };
    }
    if (target.startsWith('row:') && v === 'lanes') return this.rowRect(target.slice(4));
    if (target.startsWith('seg:') && v === 'lanes') return this.segRect(target.slice(4));
    return null;
  }

  /** Layout of the waterfall (shared with the scene) */
  wfLayout(rect: Rect, rows: number, labels = true) {
    const P = this.orient === 'portrait';
    const { head, rowMax } = this.wfDims();
    const labelW = labels ? (P ? 70 : this.compact ? 96 : 112) : 0;
    const rowH = Math.max(6, Math.min(rowMax, (rect.h - head - (P ? 12 : 16)) / Math.max(1, rows)));
    const x0 = rect.x + labelW;
    const bw = rect.w - labelW - (P ? 4 : 8);
    return { head, labelW, rowH, x0, bw, y0: rect.y + head };
  }

  private rowRect(name: string): Rect | null {
    const L = this.load;
    const i = L.res.findIndex((r) => r.name === name);
    if (i < 0 || this.cfg.lower !== 'waterfall') return null;
    const W = this.wfLayout(this.G.lower, L.res.length);
    const r = L.res[i];
    const t0 = r.segs[0]?.t0 ?? 0;
    const t1 = r.tDone ?? L.now;
    const xa = W.x0 + ((t0 * MS) / this.wfScale) * W.bw;
    const xb = W.x0 + ((t1 * MS) / this.wfScale) * W.bw;
    return { x: (xa + xb) / 2, y: W.y0 + (i + 0.5) * W.rowH, w: Math.max(10, xb - xa), h: W.rowH * 0.7 };
  }

  private segRect(kind: string): Rect | null {
    const L = this.load;
    if (this.cfg.lower !== 'waterfall') return null;
    const W = this.wfLayout(this.G.lower, L.res.length);
    for (const r of L.res) {
      const s = r.segs.find((x) => x.kind === kind && x.t1 != null);
      if (!s) continue;
      const xa = W.x0 + ((s.t0 * MS) / this.wfScale) * W.bw;
      const xb = W.x0 + (((s.t1 ?? L.now) * MS) / this.wfScale) * W.bw;
      return { x: (xa + xb) / 2, y: W.y0 + (r.i + 0.5) * W.rowH, w: Math.max(8, xb - xa), h: W.rowH * 0.6 };
    }
    return null;
  }
}
