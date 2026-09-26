import { SIG } from '@/lib/sim/colors';
import type { Curve } from '@/lib/sim/geometry';
import type { WireSpec } from '@/lib/sim/Sim';
import { CHECKS, FAKES, INTER, LEAF, type CertData, type CertRowKey, type CheckId, type FakeScenario } from './data';
import type { TlsSim } from './TlsSim';

/*
 * The certificate scene: the server (or Mallory) sends a certificate chain,
 * and Alice's browser runs its checks: name, dates, signatures up the chain,
 * a trusted root, and proof that the server holds the private key.
 */

export type CertMode = 'inspect' | 'verify' | 'fake';

export interface CertCfg {
  mode: CertMode;
}

export const CERT_DEFAULTS: CertCfg = { mode: 'inspect' };

export type CheckStatus = 'todo' | 'run' | 'ok' | 'fail' | 'skip';

export type BrowserState = 'connecting' | 'secure' | 'error';

/** A field being looked at right now (drawn as a highlight on the card). */
export interface Spot {
  card: 'leaf' | 'inter' | 'root';
  k: CertRowKey;
  tone: 'run' | 'ok' | 'fail';
}

/** A signature being verified: issuer's key → subject's signature. */
export interface SigLink {
  from: 'inter' | 'root' | 'leaf';
  to: 'leaf' | 'inter';
  tone: 'run' | 'ok' | 'fail';
}

export const TOUR: { k: CertRowKey; title: string; text: string }[] = [
  { k: 'subject', title: 'Subject', text: 'Who it is for. Browsers match the names in the Subject Alternative Name list.' },
  { k: 'issuer', title: 'Issuer', text: 'The Certificate Authority that vouches for it.' },
  { k: 'valid', title: 'Validity', text: 'Not before, not after. This one lasts 90 days; public certificates keep getting shorter-lived.' },
  { k: 'key', title: 'Public key', text: 'The server’s public key. Its private half never leaves the server.' },
  { k: 'sig', title: 'Signature', text: 'The CA signed all of the above with its own private key.' },
];

const IDS = ['alice', 'server', 'leaf', 'inter', 'store'];
export const cid = (id: string) => `ce:${id}`;

export class CertCtl {
  cfg: CertCfg = { ...CERT_DEFAULTS };
  scenario: FakeScenario | null = null;
  leaf: CertData = LEAF;
  inter: CertData | null = INTER;
  arrived = false;
  status: Record<CheckId, CheckStatus> = { name: 'todo', dates: 'todo', sigs: 'todo', root: 'todo', proof: 'todo' };
  cursor = 0;
  running: { id: CheckId; t0: number; dur: number } | null = null;
  browser: BrowserState = 'connecting';
  tour = -1;
  /** CertificateVerify has been checked in the inspect tour */
  proofShown: 'none' | 'run' | 'ok' = 'none';
  round = 0;
  private gen = 0;

  constructor(private sim: TlsSim) {}

  get fake() {
    return this.cfg.mode === 'fake';
  }

  /* ---------------- lifecycle ---------------- */

  enter(cfg: CertCfg, reset: boolean) {
    this.cfg = { ...cfg };
    for (const id of ['alice', 'server', 'store']) this.sim.box(cid(id));
    if (reset) {
      this.round = 0;
      this.restart();
    }
  }

  teardown() {
    this.gen++;
    for (const id of IDS) this.sim.hide(cid(id));
  }

  private restart() {
    this.sim.clearTransient();
    this.gen++;
    this.scenario = this.fake ? FAKES[this.round % FAKES.length] : null;
    this.leaf = this.scenario ? this.scenario.leaf : LEAF;
    this.inter = this.scenario ? this.scenario.inter : INTER;
    this.arrived = false;
    this.sim.hide(cid('leaf'));
    this.sim.hide(cid('inter'));
    this.status = { name: 'todo', dates: 'todo', sigs: 'todo', root: 'todo', proof: 'todo' };
    this.cursor = 0;
    this.running = null;
    this.browser = 'connecting';
    this.tour = -1;
    this.proofShown = 'none';
    const g = this.gen;
    this.later(0.6, () => this.sendChain(g));
    this.sim.rev++;
  }

  private later(delay: number, fn: () => void) {
    const g = this.gen;
    this.sim.after(delay, () => {
      if (g === this.gen) {
        fn();
        this.sim.rev++;
      }
    });
  }

  private sendChain(g: number) {
    this.sim.send({
      from: cid('server'),
      to: cid('alice'),
      dur: 1.3,
      color: SIG.res,
      shape: 'envelope',
      label: this.inter ? 'certificate chain' : 'certificate',
      onArrive: () => {
        if (g !== this.gen) return;
        this.arrived = true;
        this.sim.box(cid('leaf'));
        if (this.inter) this.sim.box(cid('inter'));
        this.sim.rev++;
        this.afterArrival();
      },
    });
  }

  private afterArrival() {
    if (this.cfg.mode === 'inspect') {
      this.later(0.9, () => this.tourStep(0));
      return;
    }
    if (this.cfg.mode === 'fake') {
      const game = this.sim.game;
      if (game && !game.done) this.later(0.8, () => this.askFake());
      else this.later(1.6, () => this.runAll(true));
    }
  }

  /* ---------------- inspect: a guided tour of the fields ---------------- */

  private tourStep(i: number) {
    if (i < TOUR.length) {
      this.tour = i;
      this.later(2.1, () => this.tourStep(i + 1));
      return;
    }
    // Finally: the server proves it holds the private key.
    this.tour = TOUR.length;
    this.proofShown = 'run';
    const g = this.gen;
    this.sim.send({
      from: cid('server'),
      to: cid('alice'),
      dur: 1.2,
      color: SIG.res,
      shape: 'envelope',
      label: 'CertificateVerify',
      onArrive: () => {
        if (g !== this.gen) return;
        this.proofShown = 'ok';
        this.browser = 'secure';
        this.sim.say(cid('alice'), 'signature matches the key ✓', SIG.res, 2);
        this.sim.rev++;
        this.later(3.2, () => this.restart());
      },
    });
  }

  /* ---------------- checks ---------------- */

  outcome(id: CheckId): 'ok' | 'fail' {
    return this.scenario && this.scenario.fails === id ? 'fail' : 'ok';
  }

  get failed() {
    return Object.values(this.status).includes('fail');
  }

  get complete() {
    return this.failed || this.cursor >= CHECKS.length;
  }

  /** Learner: run the next check. */
  nextCheck() {
    if (!this.arrived || this.running || this.complete) return;
    this.runCheck(CHECKS[this.cursor].id, false);
  }

  /** Run every remaining check back to back. */
  runAll(fast = false) {
    if (!this.arrived || this.complete) return;
    const go = () => {
      if (this.complete) return;
      this.runCheck(CHECKS[this.cursor].id, fast, go);
    };
    if (this.running) return;
    go();
  }

  /** Learner: start the chain over. */
  resetChecks() {
    this.restart();
  }

  private runCheck(id: CheckId, fast: boolean, then?: () => void) {
    const base = fast ? 0.65 : 1.25;
    const dur = id === 'sigs' ? base * 1.6 : id === 'proof' ? base * 1.3 : base;
    this.running = { id, t0: this.sim.t, dur };
    this.status = { ...this.status, [id]: 'run' };
    if (id === 'proof') {
      this.sim.send({ from: cid('server'), to: cid('alice'), dur: dur * 0.8, color: this.outcome('proof') === 'ok' ? SIG.res : SIG.err, shape: 'envelope', label: 'CertificateVerify' });
    }
    this.later(dur, () => {
      const res = this.outcome(id);
      this.status = { ...this.status, [id]: res };
      this.running = null;
      this.cursor++;
      if (res === 'fail') {
        for (const c of CHECKS.slice(this.cursor)) this.status = { ...this.status, [c.id]: 'skip' };
        this.browser = 'error';
        this.sim.fx({ kind: 'x', at: { id: cid('alice') }, color: SIG.err, size: 1.8, dur: 1.2 });
        if (this.fake) this.later(4.2, () => this.nextRound());
        return;
      }
      if (this.cursor >= CHECKS.length) {
        this.browser = 'secure';
        this.sim.say(cid('alice'), 'connection secure', SIG.res, 2);
        if (this.fake) this.later(4, () => this.nextRound());
        return;
      }
      then?.();
    });
  }

  /** Progress 0..1 of the running check (drives the animations). */
  runK(): number {
    const r = this.running;
    if (!r) return 0;
    return Math.min(1, Math.max(0, (this.sim.t - r.t0) / r.dur));
  }

  /** Card fields to highlight right now. */
  spots(): Spot[] {
    const out: Spot[] = [];
    if (this.cfg.mode === 'inspect' && this.tour >= 0 && this.tour < TOUR.length) {
      out.push({ card: 'leaf', k: TOUR[this.tour].k, tone: 'run' });
      return out;
    }
    if (this.cfg.mode === 'inspect' && this.tour === TOUR.length) {
      out.push({ card: 'leaf', k: 'key', tone: this.proofShown === 'ok' ? 'ok' : 'run' });
      return out;
    }
    const tone = (id: CheckId): Spot['tone'] | null => {
      const s = this.status[id];
      if (s === 'run') return 'run';
      if (s === 'fail') return 'fail';
      if (s === 'ok' && this.cursor === CHECKS.findIndex((c) => c.id === id) + 1 && !this.complete) return 'ok';
      return null;
    };
    const t1 = tone('name');
    if (t1) out.push({ card: 'leaf', k: 'subject', tone: t1 });
    const t2 = tone('dates');
    if (t2) out.push({ card: 'leaf', k: 'valid', tone: t2 });
    const t3 = tone('root');
    if (t3) out.push({ card: this.inter ? 'root' : 'leaf', k: this.inter ? 'subject' : 'issuer', tone: t3 });
    const t4 = tone('proof');
    if (t4) out.push({ card: 'leaf', k: 'key', tone: t4 });
    if (this.status.sigs === 'fail' && this.scenario) {
      for (const b of this.scenario.badRows) out.push({ card: b.card, k: b.k, tone: 'fail' });
    }
    return out;
  }

  /** Signature checks being drawn right now. */
  links(): SigLink[] {
    const s = this.status.sigs;
    if (s !== 'run' && s !== 'fail' && !(s === 'ok' && this.cursor === 3 && !this.complete)) return [];
    const k = s === 'run' ? this.runK() : 1;
    const bad = this.outcome('sigs') === 'fail';
    if (!this.inter) return [{ from: 'leaf', to: 'leaf', tone: s === 'run' ? 'run' : 'ok' }];
    const firstDone = s !== 'run' || k >= 0.5;
    const first: SigLink = { from: 'inter', to: 'leaf', tone: !firstDone ? 'run' : bad ? 'fail' : 'ok' };
    if (!firstDone || bad) return [first];
    return [first, { from: 'root', to: 'inter', tone: s === 'run' ? 'run' : 'ok' }];
  }

  /* ---------------- fake certificates: predict which check fails ---------------- */

  private askFake() {
    const game = this.sim.game;
    const sc = this.scenario;
    if (!game || game.done || !sc) {
      this.runAll(true);
      return;
    }
    game.ask({
      acceptable: [sc.fails],
      choices: CHECKS.map((c) => ({ id: c.id, label: c.short })),
      ask: 'Which check stops Mallory?',
      askAt: { id: cid('leaf') },
      explain: (_p, ok) => {
        const label = CHECKS.find((c) => c.id === sc.fails)?.label ?? sc.fails;
        return ok ? sc.reason : `It fails at “${label}”. ${sc.reason}`;
      },
      resolve: () => this.later(0.3, () => this.runAll(true)),
    });
  }

  private nextRound() {
    this.round++;
    this.restart();
  }

  /* ---------------- layout ---------------- */

  layout() {
    const { w, h } = this.sim;
    const s = this.sim;
    if (s.orient === 'landscape') {
      const bw = Math.min(250, w * 0.26);
      const bx = Math.max(bw / 2 + 18, w * 0.155);
      s.put(cid('alice'), bx, Math.round(h * 0.44), bw, 206);
      s.put(cid('server'), w - Math.max(118, w * 0.14), 128, 196, 56);
      const cardW = Math.min(300, w * 0.31);
      const col = bx + bw / 2 + 30 + cardW / 2;
      const top = 206;
      const cardH = 118;
      const storeH = 152;
      const gap = Math.max(20, Math.min(34, (h - 110 - top - cardH * 2 - storeH) / 2));
      s.put(cid('leaf'), col, top + cardH / 2, cardW, cardH);
      s.put(cid('inter'), col, top + cardH * 1.5 + gap, cardW, cardH);
      s.put(cid('store'), col, top + cardH * 2 + gap * 2 + storeH / 2, cardW + 24, storeH);
    } else {
      const x = w / 2;
      const cw = Math.min(344, w - 22);
      s.put(cid('alice'), 12 + 104, 92, 208, 62);
      s.put(cid('server'), w - 12 - 62, 92, 124, 40);
      s.put(cid('leaf'), x, 186, cw, 78);
      s.put(cid('inter'), x, 274, cw, 62);
      s.put(cid('store'), x, 360, cw, 78);
    }
  }

  wires(): WireSpec[] {
    return [];
  }

  /** Packets from the server arc over the certificate cards into the top of the browser. */
  curve(from: string, to: string, lane: number): Curve | null {
    if (this.sim.orient !== 'landscape' || from !== cid('server') || to !== cid('alice')) return null;
    const a = this.sim.boxes.get(from);
    const b = this.sim.boxes.get(to);
    if (!a || !b || Number.isNaN(a.x) || Number.isNaN(b.x)) return null;
    const p0 = { x: a.x - a.w / 2, y: a.y + lane };
    const p3 = { x: b.x + b.w * 0.2, y: b.y - b.h / 2 };
    return { p0, p1: { x: p0.x - (p0.x - p3.x) * 0.45, y: p0.y - 24 }, p2: { x: p3.x + 30, y: p3.y - 110 }, p3 };
  }

  step(dt: number) {
    void dt;
  }
}
