import { SIG } from '@/lib/sim/colors';
import { bezier, clamp, damp, type Curve, type Pt } from '@/lib/sim/geometry';
import { PredictGame, type Question } from '@/lib/sim/predict';
import { curvePathD, Sim, type FlightView, type WireSpec } from '@/lib/sim/Sim';
import {
  computeJourney,
  FACTS,
  markAt,
  NET_DEFAULTS,
  PH,
  type InfoKey,
  type Journey,
  type MarkKey,
  type NetConfig,
  type NodeId,
  type Pkt,
  type Work,
} from './journey';

export type View = 'net' | 'seq' | 'render' | 'url';
export type PredictMode = 'order' | 'paint' | 'repeat';
export type SlowKey = 'parse' | 'render' | 'internal';

export interface StepConfig {
  view: View;
  net: NetConfig;
  /** Section of the journey this step plays */
  from: MarkKey | number;
  to: MarkKey | number;
  /** Journey milliseconds per second of animation */
  speed: number;
  /** If set, speed up so the whole section takes about this many seconds */
  fit: number;
  loop: boolean;
  loopDelay: number;
  slow: SlowKey[];
  inspector: 'full' | 'off';
  /** Show the first (cold) visit behind the current one */
  ghost: boolean;
  /** Show the load balancer, app server and database behind the address */
  cluster: boolean;
  /** Show the whole schedule at once; the cursor shows "now" */
  staticWf: boolean;
  predict: PredictMode | null;
  /** Hold the journey at `from` (no playback) */
  idle: boolean;
  /** Keep the inspector on this one packet */
  pin: InfoKey | null;
}

export const STEP_DEFAULTS: StepConfig = {
  view: 'net',
  net: NET_DEFAULTS,
  from: 0,
  to: 'end',
  speed: 33,
  fit: 0,
  loop: false,
  loopDelay: 2.6,
  slow: [],
  inspector: 'full',
  ghost: false,
  cluster: false,
  staticWf: false,
  predict: null,
  idle: false,
  pin: null,
};

interface Checkpoint {
  id: string;
  at: number;
  q: Question;
}

interface Window {
  from: number;
  to: number;
  factor: number;
}

export interface WfRect {
  x: number;
  y: number;
  w: number;
  h: number;
  head: number;
  rowH: number;
  labelW: number;
}

export interface DockRect {
  x: number;
  y: number;
  w: number;
  maxH: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Current {
  key: InfoKey;
  color: string;
  /** Where the leader line points */
  at: Pt;
}

const NICE = [60, 80, 100, 120, 150, 200, 250, 300, 350, 400, 500, 600, 700, 800, 1000, 1200, 1400, 1600, 2000, 2500, 3000, 4000];
const niceCeil = (v: number) => NICE.find((n) => n >= v * 1.04) ?? Math.ceil(v / 1000) * 1000;

export class JourneySim extends Sim {
  sc: StepConfig = STEP_DEFAULTS;
  j: Journey = computeJourney(NET_DEFAULTS);
  ghostJ: Journey | null = null;
  tau = 0;
  from = 0;
  to = 0;
  state: 'run' | 'hold' = 'hold';
  holdT = 0;
  runId = 0;
  game: PredictGame | null = null;
  /** Eased time axis of the waterfall, ms */
  axis = 300;
  /** Waterfall and inspector geometry, set by layout() */
  wf: WfRect = { x: 0, y: 0, w: 0, h: 0, head: 22, rowH: 18, labelW: 110 };
  dock: DockRect = { x: 0, y: 0, w: 300, maxH: 180 };
  /** The region for the sequence diagram / render pipeline / URL anatomy */
  band: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private restartIn = -1;
  private asked = new Set<string>();
  /** Questions already answered correctly (not asked again) */
  private solved = new Set<string>();
  private firedEv = new Set<string>();
  private cps: Checkpoint[] = [];
  private windows: Window[] = [];
  /** Eased waterfall segment ends for the static view */
  private segEase = new Map<string, { s: number; e: number }>();

  constructor() {
    super();
    this.box('browser');
    this.box('resolver');
    this.box('server');
  }

  /* ---------------- step entry & controls ---------------- */

  enter(sc: StepConfig) {
    this.sc = { ...sc, net: { ...sc.net } };
    this.clearTransient();
    this.game = null;
    this.solved.clear();
    this.recompute();
    // One point per question; wrong answers are asked again on the next loop.
    this.game = sc.predict && this.cps.length ? new PredictGame(this, this.cps.length) : null;
    this.axis = this.axisTarget();
    this.segEase.clear();
    this.applyView();
    // The layout depends on the view, even when no box appears or disappears.
    this.relayout();
    this.runScript([]);
    this.restart();
  }

  /** Change the network settings (sliders, toggles). Restarts the journey. */
  setNet(p: Partial<NetConfig>, debounce = false) {
    this.sc = { ...this.sc, net: { ...this.sc.net, ...p } };
    this.recompute();
    if (debounce) this.restartIn = 0.45;
    else this.restart();
    this.rev++;
  }

  setRtt(v: number) {
    this.setNet({ rtt: v }, true);
  }

  setServerMs(v: number) {
    this.setNet({ serverMs: v }, true);
  }

  loseSyn(on: boolean) {
    this.setNet({ dropSyn: on });
  }

  setTls(v: NetConfig['tls']) {
    this.setNet({ tls: v });
  }

  setCert(c: NetConfig['cert']) {
    this.setNet({ cert: c });
  }

  setScript(s: NetConfig['script']) {
    this.setNet({ script: s });
  }

  restart() {
    this.clearTransient();
    this.tau = this.from;
    this.state = this.sc.idle ? 'hold' : 'run';
    this.holdT = 0;
    this.firedEv.clear();
    this.asked = new Set(this.cps.filter((c) => c.at < this.from - 1e-6).map((c) => c.id));
    for (const e of this.events()) if (e.at < this.from - 1e-6) this.firedEv.add(e.id);
    this.runId++;
    this.restartIn = -1;
    this.rev++;
  }

  private recompute() {
    this.j = computeJourney(this.sc.net);
    this.ghostJ = this.sc.ghost ? computeJourney({ ...this.sc.net, dnsCached: false, reuse: false, assetsCached: false }) : null;
    this.from = markAt(this.j, this.sc.from);
    this.to = Math.max(this.from, markAt(this.j, this.sc.to));
    this.cps = this.checkpoints();
    this.windows = this.buildWindows();
  }

  private applyView() {
    const v = this.sc.view;
    const net = v === 'net';
    if (v === 'seq') this.hide('browser');
    else this.box('browser');
    if (net) {
      this.box('resolver');
      this.box('server');
    } else {
      this.hide('resolver');
      this.hide('server');
    }
    if (net && this.sc.cluster) {
      this.box('app');
      this.box('db');
    } else {
      this.hide('app');
      this.hide('db');
    }
  }

  /* ---------------- playback ---------------- */

  /** ms per animation second right now */
  rateAt(tau: number) {
    let base = this.sc.speed;
    if (this.sc.fit > 0) base = Math.max(base, (this.to - this.from) / this.sc.fit);
    for (const w of this.windows) if (tau >= w.from - 1e-9 && tau < w.to - 1e-9) return base * w.factor;
    return base;
  }

  /** Time-lapse (>1) or slow-motion (<1) factor in effect now, if any. */
  get rateFactor() {
    if (this.state !== 'run') return 1;
    for (const w of this.windows) if (this.tau >= w.from - 1e-9 && this.tau < w.to - 1e-9) return w.factor;
    return 1;
  }

  private buildWindows(): Window[] {
    const m = this.j.marks;
    const out: Window[] = [...this.j.lapse];
    const fin = (a: number, b: number) => Number.isFinite(a) && Number.isFinite(b) && b > a;
    for (const k of this.sc.slow) {
      if (k === 'parse' && fin(m.ttfb, m.parseEnd)) out.push({ from: m.ttfb, to: m.parseEnd, factor: 0.3 });
      if (k === 'render' && fin(m.renderStart, m.fcp)) out.push({ from: m.renderStart, to: m.fcp, factor: 0.12 });
      if (k === 'internal') {
        for (const p of this.j.packets) if (p.internal) out.push({ from: p.send, to: p.arrive, factor: 0.07 });
      }
    }
    return out.sort((a, b) => a.from - b.from);
  }

  protected step(dt: number) {
    if (this.restartIn >= 0) return;
    if (this.state === 'hold') {
      this.holdT += dt;
      if (!this.sc.idle && this.shouldLoop() && this.holdT >= this.sc.loopDelay) this.restart();
      return;
    }
    let left = dt;
    let guard = 0;
    while (left > 1e-9 && !this.frozen && this.state === 'run' && guard++ < 64) {
      if (this.askDue()) break;
      const rate = this.rateAt(this.tau);
      const next = this.nextBoundary();
      const need = (next - this.tau) / rate;
      if (need <= left) {
        this.tau = next;
        left -= need;
      } else {
        this.tau += left * rate;
        left = 0;
      }
      this.fireEvents();
      if (this.tau >= this.to - 1e-9) {
        this.tau = this.to;
        if (!this.askDue()) this.finish();
        break;
      }
    }
  }

  private shouldLoop() {
    return this.sc.loop || (!!this.game && !this.game.done);
  }

  private finish() {
    this.state = 'hold';
    this.holdT = 0;
    this.rev++;
  }

  private nextBoundary() {
    let n = this.to;
    const t = this.tau + 1e-9;
    for (const w of this.windows) {
      if (w.from > t && w.from < n) n = w.from;
      if (w.to > t && w.to < n) n = w.to;
    }
    for (const c of this.cps) if (!this.asked.has(c.id) && c.at > t && c.at < n) n = c.at;
    for (const e of this.events()) if (!this.firedEv.has(e.id) && e.at > t && e.at < n) n = e.at;
    return n;
  }

  private askDue(): boolean {
    const g = this.game;
    if (!g || g.done || g.pending) return false;
    // "Practice again" resets the game: start over with every question.
    if (g.attempts === 0 && this.solved.size) this.solved.clear();
    for (const c of this.cps) {
      if (this.asked.has(c.id) || c.at > this.tau + 1e-6) continue;
      this.asked.add(c.id);
      if (this.solved.has(c.id)) continue;
      const q: Question = {
        ...c.q,
        resolve: (picked, ok) => {
          if (ok) this.solved.add(c.id);
          c.q.resolve?.(picked, ok);
        },
      };
      if (g.ask(q)) return true;
    }
    return false;
  }

  protected animate(dt: number) {
    if (this.restartIn >= 0) {
      this.restartIn -= dt;
      if (this.restartIn < 0) this.restart();
    }
    this.axis = damp(this.axis, this.axisTarget(), 5, dt);
    // Ease the static waterfall toward the new schedule.
    if (this.sc.staticWf) {
      const seen = new Set<string>();
      const count = new Map<string, number>();
      for (const s of this.j.segs) {
        const n = count.get(s.row) ?? 0;
        count.set(s.row, n + 1);
        const key = `${s.row}#${n}#${s.kind}`;
        seen.add(key);
        const cur = this.segEase.get(key);
        if (!cur) this.segEase.set(key, { s: s.start, e: s.end });
        else {
          cur.s = damp(cur.s, s.start, 7, dt);
          cur.e = damp(cur.e, s.end, 7, dt);
        }
      }
      for (const k of [...this.segEase.keys()]) if (!seen.has(k)) this.segEase.delete(k);
    }
  }

  axisTarget() {
    return niceCeil(Math.max(this.j.marks.end, this.ghostJ?.marks.end ?? 0, 40));
  }

  /** Segment extents to draw: eased in the static view, clipped to "now" otherwise. */
  segExtent(row: string, n: number, kind: string, s: number, e: number): { s: number; e: number } | null {
    if (this.sc.staticWf) {
      const v = this.segEase.get(`${row}#${n}#${kind}`);
      return v ? { s: v.s, e: v.e } : { s, e };
    }
    const now = this.tau;
    // A segment shows once the clock has passed its start (or the step is resting there).
    if (!(s < now - 1e-9 || (this.state === 'hold' && s <= now + 1e-9))) return null;
    return { s, e: Math.min(e, now) };
  }

  /** Has the clock reached this time (for labels and marks)? */
  reached(t: number) {
    return Number.isFinite(t) && (t < this.tau - 1e-9 || (this.state === 'hold' && t <= this.tau + 1e-9));
  }

  /* ---------------- events: floating labels at key moments ---------------- */

  private evCache: { runKey: string; list: { id: string; at: number; run: () => void }[] } | null = null;

  private events() {
    const key = `${this.runId}|${this.j.marks.end}|${this.sc.view}`;
    if (this.evCache?.runKey === key) return this.evCache.list;
    const m = this.j.marks;
    const c = this.j.cfg;
    const list: { id: string; at: number; run: () => void }[] = [];
    const add = (id: string, at: number, run: () => void) => {
      if (Number.isFinite(at)) list.push({ id, at, run });
    };
    const net = this.sc.view === 'net';
    if (net && !c.dnsCached) add('ip', m.dnsEnd, () => this.sayNear('browser', 'shop.example = 203.0.113.10', PH.dns, 1.8));
    if (net && m.lossAt != null) add('lost', m.lossAt + 2, () => this.sayNear('browser', 'no answer… waiting 1 s', SIG.err, 2.4));
    if (net && m.lossAt != null) add('retry', m.synAt, () => this.sayNear('browser', 'timeout: send the SYN again', PH.tcp, 1.8));
    if (net && !c.reuse) add('conn', m.tcpEnd, () => this.sayNear('browser', 'TCP connected', PH.tcp, 1.4));
    if (m.failAt != null) {
      add('fail', m.failAt, () => this.sayNear('browser', 'certificate rejected', SIG.err, 2.6));
    } else if (net && !c.reuse) add('keys', m.tlsEnd, () => this.sayNear('browser', 'keys agreed · encrypted', PH.tls, 1.6));
    if (net) add('ttfb', m.ttfb, () => this.sayNear('browser', 'first byte', PH.res, 1.4));
    // In the render view the page itself appearing says it all.
    if (this.sc.view !== 'render') add('fcp', m.fcp, () => this.sayNear('browser', 'first paint', PH.render, 1.8));
    this.evCache = { runKey: key, list };
    return list;
  }

  private fireEvents() {
    for (const e of this.events()) {
      if (this.firedEv.has(e.id) || e.at > this.tau + 1e-6) continue;
      this.firedEv.add(e.id);
      e.run();
      this.rev++;
    }
  }

  /* ---------------- predictions ---------------- */

  private checkpoints(): Checkpoint[] {
    const m = this.j.marks;
    switch (this.sc.predict) {
      case 'order':
        return [
          {
            id: 'first-packet',
            at: m.dnsEnd,
            q: {
              acceptable: ['syn'],
              choices: [
                { id: 'get', label: 'GET /cart' },
                { id: 'syn', label: 'TCP SYN' },
                { id: 'hello', label: 'TLS ClientHello' },
              ],
              ask: 'Got the IP. What does the browser send first?',
              askAt: { id: 'browser' },
              explain: (p, ok) =>
                ok
                  ? 'HTTP and TLS both ride on a TCP connection, and there is none yet. So the first packet is a SYN: “I’d like to connect.”'
                  : p === 'get'
                    ? 'There’s no connection to carry it yet. First TCP opens one: SYN, SYN-ACK, ACK.'
                    : 'TLS runs on top of TCP, so it needs the TCP connection first. The first packet is a SYN.',
              resolve: () => this.sayNear('browser', 'SYN →', PH.tcp, 1.2),
            },
          },
          {
            id: 'after-tcp',
            at: m.tcpEnd,
            q: {
              acceptable: ['tls'],
              choices: [
                { id: 'get', label: 'Send GET /cart now' },
                { id: 'tls', label: 'TLS handshake first' },
              ],
              ask: 'TCP is connected. Can GET /cart go now?',
              askAt: { id: 'browser' },
              explain: (p, ok) =>
                ok
                  ? 'The URL says https. Before any HTTP, the browser agrees on keys with the server and checks its certificate. Otherwise Alice’s cookie would cross the internet in plain text.'
                  : 'Not over https. The request would travel in plain text, cookie and all. The browser first runs the TLS handshake to agree on keys and verify the server.',
            },
          },
        ];
      case 'paint':
        if (!(m.parseEnd < m.cssReady)) return [];
        return [
          {
            id: 'paint-now',
            at: m.parseEnd,
            q: {
              acceptable: ['wait'],
              choices: [
                { id: 'paint', label: 'Paint the text now' },
                { id: 'wait', label: 'Wait for app.css' },
              ],
              ask: 'DOM built, app.css still loading. Paint?',
              askAt: { id: 'browser' },
              explain: (_p, ok) =>
                ok
                  ? 'CSS in <head> is render-blocking. Painting now would flash unstyled text and then jump around (a “flash of unstyled content”), so the browser holds the first paint until the CSSOM is ready.'
                  : 'The browser holds the first paint: CSS in <head> is render-blocking. Painting unstyled text now and restyling a moment later would make the page flash and jump.',
            },
          },
        ];
      case 'repeat':
        return [
          {
            id: 'dns',
            at: 0,
            q: {
              acceptable: ['cached'],
              choices: [
                { id: 'lookup', label: 'Look it up again' },
                { id: 'cached', label: 'Use the cached answer' },
              ],
              ask: 'DNS lookup for shop.example again?',
              askAt: { id: 'resolver' },
              explain: (_p, ok) =>
                ok
                  ? 'The answer came with a TTL of 300 seconds. For five minutes the browser (and the OS) can reuse it: 0 ms.'
                  : 'No need: the answer came with a TTL of 300 seconds, so it’s still in the browser’s cache. 0 ms.',
              resolve: () => this.sayNear('resolver', 'skipped: cached (TTL 300 s)', PH.dns, 2.2),
            },
          },
          {
            id: 'conn',
            at: 0,
            q: {
              acceptable: ['reuse'],
              choices: [
                { id: 'new', label: 'New TCP + TLS handshakes' },
                { id: 'reuse', label: 'Reuse the open connection' },
              ],
              ask: 'Handshake again, or reuse?',
              askAt: { id: 'server' },
              explain: (_p, ok) =>
                ok
                  ? 'The browser kept the connection open after the first visit (keep-alive), and the server hasn’t closed it yet. Both handshakes are skipped: two round trips saved.'
                  : 'The first connection is still open: browsers keep it alive, and servers wait a while (often a minute or more) before closing idle ones. No handshakes needed.',
              resolve: () => this.sayNear('server', 'connection reused', PH.tls, 2.2),
            },
          },
          {
            id: 'html',
            at: 0,
            q: {
              acceptable: ['server'],
              choices: [
                { id: 'cache', label: 'From the HTTP cache' },
                { id: 'server', label: 'Ask the server' },
              ],
              ask: 'Where does /cart come from?',
              askAt: { id: 'server' },
              explain: (_p, ok) =>
                ok
                  ? 'The response said Cache-Control: no-store. A cart is personal and changes often, so it’s never cached. It costs one round trip plus think time.'
                  : 'Not this one. /cart came with Cache-Control: no-store, because a cart is personal and changes. It always goes to the server.',
            },
          },
          {
            id: 'css',
            at: m.discover,
            q: {
              acceptable: ['cache'],
              choices: [
                { id: 'net', label: 'Download it again' },
                { id: 'cache', label: 'From the HTTP cache' },
              ],
              ask: 'app.css: network or cache?',
              askAt: { id: 'browser' },
              explain: (_p, ok) =>
                ok
                  ? 'It came with Cache-Control: max-age=31536000, immutable. For a year the browser uses its copy without even asking.'
                  : 'It’s cached: app.css came with Cache-Control: max-age=31536000, immutable. No request at all.',
              resolve: () => this.sayNear('browser', 'app.css, app.js: disk cache', PH.res, 2.2),
            },
          },
        ];
      default:
        return [];
    }
  }

  /* ---------------- layout ---------------- */

  protected layout() {
    const { w: W, h: H } = this;
    const land = this.orient === 'landscape';
    const has = (id: string) => this.boxes.has(id);
    if (land) {
      const rowH = this.compact ? 16 : 18;
      const head = 24;
      const wfH = head + 10 * rowH + 20;
      const wfBottom = H - 100;
      this.wf = { x: 16, y: wfBottom - wfH, w: W - 32, h: wfH, head, rowH, labelW: this.compact ? 112 : 124 };
      const top = 74;
      const bottom = this.wf.y - 14;
      this.band = { x: 18, y: top, w: W - 36, h: bottom - top };
      const bw = clamp(W * 0.25, 190, 250);
      const bh = clamp(bottom - top - 8, 170, 290);
      const bx = 20 + bw / 2;
      const by = top + 4 + bh / 2;
      const pathY = top + 4 + Math.min(bh * 0.46, 132);
      this.pathY = pathY;
      const sw = this.compact ? 150 : 170;
      const sx = W - 22 - sw / 2;
      const bRight = bx + bw / 2;
      const midX = (bRight + (sx - sw / 2)) / 2;
      if (has('browser')) this.place('browser', bx, by, bw, bh);
      if (has('resolver')) this.place('resolver', midX, top + 26, this.compact ? 150 : 172, 46);
      let dockL = bRight + 16;
      let dockR = sx - sw / 2 - 16;
      if (this.sc.cluster) {
        const aw = this.compact ? 132 : 148;
        const ax = W - 22 - aw / 2;
        const lx = ax - aw / 2 - 56 - sw / 2;
        if (has('server')) this.place('server', lx, pathY, sw, 60);
        if (has('app')) this.place('app', ax, pathY - 64, aw, 50);
        if (has('db')) this.place('db', ax, pathY + 84, aw - 24, 70);
        dockR = lx - sw / 2 - 12;
      } else {
        if (has('server')) this.place('server', sx, pathY, sw, 60);
        if (has('app')) this.place('app', sx, pathY - 70, 140, 50);
        if (has('db')) this.place('db', sx, pathY + 84, 120, 70);
      }
      const dw = Math.min(320, dockR - dockL);
      dockL = (dockL + dockR) / 2 - dw / 2;
      this.dock = { x: dockL + dw / 2, y: pathY + 40, w: dw, maxH: bottom - (pathY + 40) };
    } else {
      const rowH = 13;
      const head = 19;
      const wfH = head + 10 * rowH + 16;
      const wfBottom = H - 74;
      this.wf = { x: 10, y: wfBottom - wfH, w: W - 20, h: wfH, head, rowH, labelW: 54 };
      const top = 64;
      const bottom = this.wf.y - 10;
      this.band = { x: 10, y: top, w: W - 20, h: bottom - top };
      const bw = Math.min(140, W * 0.38);
      const bh = Math.min(128, (bottom - top) * 0.47);
      const pathY = top + 6 + bh * 0.66;
      this.pathY = pathY;
      if (this.sc.view === 'render') {
        const rbw = Math.min(150, W * 0.41);
        if (has('browser')) this.place('browser', 10 + rbw / 2, top + (bottom - top) / 2, rbw, bottom - top - 4);
      } else if (this.sc.view === 'url') {
        if (has('browser')) this.place('browser', 10 + bw / 2, top + 6 + 32, bw, 64);
      } else if (has('browser')) this.place('browser', 10 + bw / 2, top + 6 + bh / 2, bw, bh);
      const rw = Math.min(128, W * 0.35);
      const rx = W - 10 - rw / 2;
      if (has('resolver')) this.place('resolver', rx, top + 20, rw, 36);
      if (has('server')) this.place('server', rx, pathY, rw, 44);
      if (has('app')) this.place('app', rx, pathY + 64, rw - 12, 40);
      if (has('db')) this.place('db', rx, pathY + 130, rw - 28, 56);
      const dockTop = top + 6 + bh + 14;
      const dockR = this.sc.cluster ? rx - rw / 2 - 10 : W - 10;
      this.dock = { x: (10 + dockR) / 2, y: dockTop, w: dockR - 10, maxH: bottom - dockTop };
    }
    // The sequence view: diagram on the left (top on phones), inspector beside it.
    const B = this.band;
    if (land) {
      const sw = Math.min(560, B.w * 0.6);
      this.seqRect = { x: B.x + 8, y: B.y + 4, w: sw, h: B.h - 4 };
      if (this.sc.view === 'seq') {
        const l = B.x + sw + 34;
        const dw = Math.min(320, B.x + B.w - l);
        this.dock = { x: l + dw / 2, y: B.y + 36, w: dw, maxH: B.h - 40 };
      }
    } else {
      // Phones: the diagram needs every pixel of height, so it gets the whole band (no inspector).
      this.seqRect = { x: B.x, y: B.y, w: B.w, h: B.h };
    }
  }

  seqRect: Rect = { x: 0, y: 0, w: 0, h: 0 };

  /** The y of the browser ↔ server path */
  pathY = 200;

  /* ---------------- geometry: ports and curves ---------------- */

  private port(id: string, toward: Pt): Pt | null {
    const b = this.boxes.get(id);
    if (!b || Number.isNaN(b.x)) return null;
    // The browser's "network jack" sits on its right edge, level with the server path.
    if (id === 'browser') return { x: b.x + b.w / 2, y: clamp(this.pathY, b.y - b.h / 2 + 24, b.y + b.h / 2 - 12) };
    const dx = toward.x - b.x;
    const dy = toward.y - b.y;
    if (Math.abs(dx) - b.w / 2 >= Math.abs(dy) - b.h / 2) return { x: b.x + (Math.sign(dx) * b.w) / 2, y: b.y };
    return { x: b.x, y: b.y + (Math.sign(dy) * b.h) / 2 };
  }

  protected curveFor(from: string, to: string, lane: number): Curve | null {
    const a = this.boxes.get(from);
    const b = this.boxes.get(to);
    if (!a || !b || Number.isNaN(a.x) || Number.isNaN(b.x)) return null;
    const p0 = this.port(from, b);
    const p3 = this.port(to, a);
    if (!p0 || !p3) return null;
    const dx = p3.x - p0.x;
    const dy = p3.y - p0.y;
    const horiz = Math.abs(dx) >= Math.abs(dy) * 0.6 || from === 'browser' || to === 'browser';
    if (horiz) {
      const s = Math.sign(dx) || 1;
      const k = Math.max(20, Math.abs(dx) * 0.5);
      const off = lane * s;
      return {
        p0: { x: p0.x, y: p0.y + off },
        p1: { x: p0.x + s * k, y: p0.y + off },
        p2: { x: p3.x - s * k, y: p3.y + off },
        p3: { x: p3.x, y: p3.y + off },
      };
    }
    const s = Math.sign(dy) || 1;
    const k = Math.max(16, Math.abs(dy) * 0.5);
    const off = -lane * s;
    return {
      p0: { x: p0.x + off, y: p0.y },
      p1: { x: p0.x + off, y: p0.y + s * k },
      p2: { x: p3.x + off, y: p3.y - s * k },
      p3: { x: p3.x + off, y: p3.y },
    };
  }

  /** A floating label placed where it can't collide with the HUD. */
  sayNear(id: NodeId, text: string, color: string, dur = 1.5) {
    if (this.sc.view === 'seq') return;
    const land = this.orient === 'landscape';
    if (!land && this.sc.view !== 'render') {
      // Phones have one spot for these labels: the newest replaces the last.
      this.effects = this.effects.filter((e) => e.kind !== 'text');
      this.fx({ kind: 'text', at: { x: this.w / 2, y: this.dock.y - 5 }, text, color, dur });
      return;
    }
    if (id === 'browser') {
      const j = this.jack();
      const b = this.boxes.get('browser');
      if (this.sc.view === 'render' && b) {
        this.fx({ kind: 'text', at: { x: b.tx, y: b.ty + b.h / 2 - 16 }, text, color, dur });
        return;
      }
      if (j) this.fx({ kind: 'text', at: land ? { x: j.x + 92, y: j.y - 20 } : { x: j.x + 44, y: j.y + 30 }, text, color, dur });
      return;
    }
    const b = this.boxes.get(id);
    if (!b) return;
    this.fx({ kind: 'text', at: { id, dy: b.h / 2 + 30 }, text, color, dur });
  }

  /** SVG path of the wire between two nodes. */
  pathD(from: string, to: string): string | null {
    const c = this.curveFor(from, to, 0);
    return c ? curvePathD(c) : null;
  }

  pathPoint(from: string, to: string, t: number): Pt | null {
    const c = this.curveFor(from, to, 0);
    return c ? bezier(c, t) : null;
  }

  /** Where the browser's wires plug in. */
  jack(): Pt | null {
    const b = this.boxes.get('browser');
    if (!b || Number.isNaN(b.x)) return null;
    return this.port('browser', { x: b.x + 200, y: this.pathY });
  }

  protected wires(): WireSpec[] {
    if (this.sc.view !== 'net') return [];
    const m = this.j.marks;
    const dnsActive = !this.j.cfg.dnsCached && this.tau < m.dnsEnd + 30;
    const out: WireSpec[] = [
      { from: 'browser', to: 'resolver', state: dnsActive ? 'normal' : 'dim' },
      { from: 'browser', to: 'server', state: this.connState() === 'none' ? 'dashed' : 'normal' },
    ];
    if (this.sc.cluster) {
      out.push({ from: 'server', to: 'app', state: 'normal' });
      out.push({ from: 'app', to: 'db', state: 'normal' });
    }
    return out;
  }

  /** What the browser ↔ server connection looks like right now. */
  connState(): 'none' | 'tcp' | 'tls' {
    const m = this.j.marks;
    if (this.j.cfg.reuse) return 'tls';
    if (m.failAt != null) return this.tau >= m.tcpEnd - 1e-6 ? 'tcp' : 'none';
    if (this.tau >= m.tlsEnd - 1e-6) return 'tls';
    if (this.tau >= m.tcpEnd - 1e-6) return 'tcp';
    return 'none';
  }

  /* ---------------- per-frame views ---------------- */

  /** Packets in flight right now, computed from the journey clock. */
  flightViews(): FlightView[] {
    if (this.sc.view !== 'net') return [];
    const out: FlightView[] = [];
    const t = this.tau;
    this.j.packets.forEach((p, i) => {
      if (p.internal && !this.sc.cluster) return;
      if (this.sc.idle || t <= p.send + 1e-9 || t >= p.arrive) return;
      const prog = (t - p.send) / Math.max(1e-6, p.arrive - p.send);
      if (p.lostAt != null && prog >= p.lostAt) return;
      const c = this.curveFor(p.from, p.to, 5);
      if (!c) return;
      const pos = bezier(c, prog);
      const tail = bezier(c, clamp(prog - 0.09, 0, 1));
      const ahead = bezier(c, clamp(prog + 0.02, 0, 1));
      const back = bezier(c, clamp(prog - 0.02, 0, 1));
      out.push({
        id: i + 1,
        x: pos.x,
        y: pos.y,
        tx: tail.x,
        ty: tail.y,
        angle: Math.atan2(ahead.y - back.y, ahead.x - back.x),
        progress: prog,
        color: p.color,
        r: p.r ?? (p.shape === 'envelope' ? 5 : 4.8),
        shape: p.shape,
        label: p.label || undefined,
        trail: true,
        tag: p.id,
      });
    });
    return out;
  }

  /** Where a lost packet vanished (drawn as a red X until the retry). */
  lostMark(): { x: number; y: number } | null {
    const m = this.j.marks;
    if (this.sc.view !== 'net' || m.lossAt == null || this.tau < m.lossAt || this.tau >= m.synAt) return null;
    const p = this.j.packets.find((q) => q.id === 'syn-lost');
    if (!p) return null;
    const c = this.curveFor(p.from, p.to, 5);
    return c ? bezier(c, p.lostAt ?? 0.5) : null;
  }

  /** Work in progress on a node right now. */
  workOn(node: NodeId): { w: Work; k: number } | null {
    for (const w of this.j.work) {
      if (w.node !== node || (w.internal && !this.sc.cluster)) continue;
      if (this.tau > w.start + 1e-9 && this.tau < w.end) return { w, k: (this.tau - w.start) / Math.max(1e-6, w.end - w.start) };
    }
    return null;
  }

  /** What the inspector should describe right now. */
  current(): Current | null {
    const t = this.tau;
    const packets = this.j.packets.filter((p) => !p.internal || this.sc.cluster);
    if (this.sc.pin) {
      const p = packets.find((q) => q.info === this.sc.pin);
      if (p) {
        const fv = this.flightViews().find((f) => f.tag === p.id);
        const at = fv ? { x: fv.x, y: fv.y } : this.nodeBottom(t >= p.arrive ? p.to : p.from);
        return { key: p.info, color: p.color, at };
      }
    }
    let best: Pkt | null = null;
    for (const p of packets) {
      if (p.info === 'chunk') continue;
      if (t > p.send + 1e-9 && t < p.arrive && (p.lostAt == null || (t - p.send) / (p.arrive - p.send) < p.lostAt)) {
        if (!best || p.send >= best.send) best = p;
      }
    }
    if (best) {
      const fv = this.flightViews().find((f) => f.tag === best!.id);
      return { key: best.info, color: best.color, at: fv ? { x: fv.x, y: fv.y } : this.nodeBottom(best.to) };
    }
    const nodes: NodeId[] = this.sc.cluster ? ['db', 'app', 'server', 'resolver'] : ['server', 'resolver'];
    for (const n of nodes) {
      const w = this.workOn(n);
      if (w) return { key: w.w.info, color: w.w.color, at: this.nodeBottom(n) };
    }
    // Nothing moving: keep showing the last thing that arrived (or was lost).
    let last: Pkt | null = null;
    for (const p of packets) {
      if (p.info === 'chunk') continue;
      const done = p.lostAt != null ? p.send + (p.arrive - p.send) * p.lostAt : p.arrive;
      if (done <= t + 1e-6 && (!last || done >= (last.lostAt != null ? last.send : last.arrive))) last = p;
    }
    if (last) return { key: last.info, color: last.color, at: this.nodeBottom(last.lostAt != null ? last.from : last.to) };
    return null;
  }

  nodeBottom(id: string): Pt {
    const b = this.boxes.get(id);
    if (!b || Number.isNaN(b.x)) return { x: this.w / 2, y: this.pathY };
    if (id === 'browser') return { x: b.x + b.w / 2, y: this.pathY };
    return { x: b.x, y: b.y + b.h / 2 };
  }

  /** The label for the phase the journey is in. */
  phaseLabel(): string {
    const m = this.j.marks;
    // Resting exactly on a boundary (end of a step, or a question): describe what just happened.
    const t = this.state === 'hold' || this.frozen ? this.tau - 1e-6 : this.tau;
    const c = this.j.cfg;
    if (this.sc.idle || t <= 0) return 'Enter pressed';
    if (m.failAt != null && t >= m.failAt) return 'Blocked: bad certificate';
    if (t < m.dnsEnd) return 'DNS lookup';
    if (!c.reuse && t < m.tcpEnd) return m.lossAt != null && t < m.synAt ? 'Waiting to retransmit' : 'TCP handshake';
    if (!c.reuse && t < m.tlsEnd) return 'TLS handshake';
    if (m.failAt != null) return 'TLS handshake';
    if (t < m.reqArrive) return 'Request in flight';
    if (t < m.resSent) return 'Server thinking';
    if (t < m.ttfb) return 'Response in flight';
    if (m.blockedAt != null && t >= m.blockedAt && t < m.jsRun[1]) return 'Parser blocked on app.js';
    if (t < m.parseEnd) return 'Parsing HTML';
    if (t < m.renderStart) return 'Waiting for app.css';
    if (t < m.styleEnd) return 'Style';
    if (t < m.layoutEnd) return 'Layout';
    if (t < m.paintEnd) return 'Paint';
    if (t < m.fcp) return 'Composite';
    return 'Cart on screen';
  }

  /** Round trips to shop.example completed so far. */
  roundTrips(): number {
    const m = this.j.marks;
    const c = this.j.cfg;
    const t = this.tau;
    let n = 0;
    if (!c.reuse) {
      if (t >= m.tcpEnd) n++;
      if (m.failAt != null) return t >= m.failAt ? n + 1 : n;
      if (c.tls === '1.3' ? t >= m.tlsEnd : t >= m.tlsEnd - c.rtt) n++;
      if (c.tls === '1.2' && t >= m.tlsEnd) n++;
    }
    if (t >= m.ttfb) n++;
    return n;
  }

  /** Where the pipeline is (0..1 per stage) for the render view. */
  renderStages() {
    const m = this.j.marks;
    const t = this.tau;
    const k = (a: number, b: number) => (t <= a ? 0 : t >= b ? 1 : (t - a) / Math.max(1e-6, b - a));
    // Parse progress follows the parser's actual running time (it may be blocked).
    let parse: number;
    if (m.blockedAt != null) {
      const first = m.blockedAt - m.ttfb;
      const total = FACTS.parseMs;
      if (t < m.blockedAt) parse = k(m.ttfb, m.blockedAt) * (first / total);
      else if (t < m.jsRun[1]) parse = first / total;
      else parse = first / total + k(m.jsRun[1], m.parseEnd) * (1 - first / total);
    } else parse = k(m.ttfb, m.parseEnd);
    return {
      parse,
      blocked: m.blockedAt != null && t >= m.blockedAt && t < m.jsRun[1],
      cssArrived: t >= m.cssReady,
      cssK: k(m.cssReady, m.cssReady + 1.5),
      jsArrived: t >= m.jsReady,
      jsRun: t >= m.jsRun[0] && t < m.jsRun[1],
      jsDone: t >= m.jsRun[1],
      style: k(m.renderStart, m.styleEnd),
      layout: k(m.styleEnd, m.layoutEnd),
      paint: k(m.layoutEnd, m.paintEnd),
      composite: k(m.paintEnd, m.fcp),
      requested: t >= m.discover,
    };
  }

  /** The browser tab: what the page area shows right now. */
  pageState(): { mode: 'blank' | 'layout' | 'paint' | 'done' | 'error'; k: number; loading: boolean } {
    const m = this.j.marks;
    const t = this.tau;
    if (m.failAt != null && t >= m.failAt) return { mode: 'error', k: 1, loading: false };
    const loading = !this.sc.idle && t > 0 && t < m.fcp;
    if (t >= m.fcp) return { mode: 'done', k: 1, loading: false };
    if (t >= m.layoutEnd) return { mode: 'paint', k: (t - m.layoutEnd) / Math.max(1e-6, m.fcp - m.layoutEnd), loading };
    if (t >= m.styleEnd) return { mode: 'layout', k: (t - m.styleEnd) / Math.max(1e-6, m.layoutEnd - m.styleEnd), loading };
    return { mode: 'blank', k: 0, loading };
  }
}
