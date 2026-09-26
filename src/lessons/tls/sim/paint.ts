import { SIG } from '@/lib/sim/colors';
import type { Curve } from '@/lib/sim/geometry';
import type { WireSpec } from '@/lib/sim/Sim';
import { COMMON, MALLORY_PAINT, ROUNDS, mix, paintById } from './paintMix';
import type { TlsSim } from './TlsSim';

/*
 * The paint-mixing scene: Diffie–Hellman with colors (and then with numbers).
 * Alice and the server each keep a secret paint, trade mixtures in public,
 * and both end up with the same final color. Eve copies everything on the
 * wire but can't un-mix paint. In 'mitm' mode Mallory sits in the middle
 * and runs a separate exchange with each side.
 */

export type PaintMode = 'paint' | 'numbers' | 'mitm';

export interface PaintCfg {
  mode: PaintMode;
  /** Secret paint ids (see PAINTS) */
  a: string;
  b: string;
}

export const PAINT_DEFAULTS: PaintCfg = { mode: 'paint', a: 'crimson', b: 'blue' };

export type PotId = 'common' | 'aSec' | 'bSec' | 'aMix' | 'bMix' | 'aFin' | 'bFin' | 'mSec' | 'mFinA' | 'mFinB';

const POTS: PotId[] = ['common', 'aSec', 'bSec', 'aMix', 'bMix', 'aFin', 'bFin', 'mSec', 'mFinA', 'mFinB'];
const ACTORS = ['alice', 'server', 'eve', 'mal', 'tap', 'aIn', 'bIn'];
export const pid = (id: string) => `pa:${id}`;

/* Diffie–Hellman with small numbers: g = 5, p = 23, a = 6, b = 15, Mallory m = 13. */
const G = 5;
const P = 23;
const modpow = (base: number, exp: number, m: number) => {
  let r = 1;
  let b = base % m;
  let e = exp;
  while (e > 0) {
    if (e & 1) r = (r * b) % m;
    b = (b * b) % m;
    e >>= 1;
  }
  return r;
};
export const DH = (() => {
  const a = 6;
  const b = 15;
  const A = modpow(G, a, P);
  const B = modpow(G, b, P);
  return { g: G, p: P, a, b, A, B, s: modpow(B, a, P), s2: modpow(A, b, P), eve: (A * B) % P };
})();

const SUP: Record<string, string> = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
const sup = (n: number) => String(n).split('').map((d) => SUP[d]).join('');

export interface PotLabel {
  title: string;
  sub?: string;
  /** Number drawn inside the pot in numbers mode */
  num?: string;
}

interface Ev {
  at: number;
  run: () => void;
}

export class PaintCtl {
  cfg: PaintCfg = { ...PAINT_DEFAULTS };
  /** Current color of each pot (undefined = empty) */
  fill: Partial<Record<PotId, string>> = {};
  /** Pots that hold only part of their final recipe */
  partial: Partial<Record<PotId, boolean>> = {};
  /** Mallory's own mixture (common + her secret) */
  malMix: string | null = null;
  eveHas: { color: string; what: string; num?: string }[] = [];
  eveTry: 'none' | 'mixing' | 'done' = 'none';
  /** Final pots have been compared */
  compared = false;
  round = 0;
  private pt = 0;
  private events: Ev[] = [];
  private next = 0;
  private gen = 0;

  constructor(private sim: TlsSim) {}

  get A() {
    return paintById(this.cfg.a).hex;
  }
  get B() {
    return paintById(this.cfg.b).hex;
  }
  get M() {
    return MALLORY_PAINT;
  }
  get mitm() {
    return this.cfg.mode === 'mitm';
  }
  get numbers() {
    return this.cfg.mode === 'numbers';
  }
  /** The color both sides end up with (paint and numbers modes) */
  get shared() {
    return mix(COMMON, this.A, this.B);
  }
  /** What Eve gets by pouring her two captured mixtures together */
  get eveColor() {
    return mix(COMMON, this.A, COMMON, this.B);
  }

  get pots(): PotId[] {
    return this.mitm ? POTS : POTS.filter((p) => !p.startsWith('m'));
  }

  private get actors(): string[] {
    return this.mitm ? ['alice', 'server', 'mal', 'aIn', 'bIn'] : ['alice', 'server', 'eve', 'tap', 'aIn', 'bIn'];
  }

  /* ---------------- lifecycle ---------------- */

  enter(cfg: PaintCfg, reset: boolean) {
    this.cfg = { ...cfg };
    const live = new Set([...this.pots, ...this.actors].map(pid));
    for (const id of [...POTS, ...ACTORS].map(pid)) {
      if (live.has(id)) this.sim.box(id);
      else this.sim.hide(id);
    }
    if (reset) {
      this.round = 0;
      this.restart(false);
    }
  }

  teardown() {
    this.gen++;
    for (const id of [...POTS, ...ACTORS]) this.sim.hide(pid(id));
  }

  /** Learner picked new secret paints: replay from the moment the secrets appear. */
  setSecrets(a: string, b: string) {
    this.cfg = { ...this.cfg, a, b };
    this.restart(true);
  }

  private restart(skipIntro: boolean) {
    this.sim.clearTransient();
    this.gen++;
    this.fill = {};
    this.partial = {};
    this.malMix = null;
    this.eveHas = [];
    this.eveTry = 'none';
    this.compared = false;
    this.events = this.build(skipIntro);
    this.next = 0;
    this.pt = skipIntro ? 1.7 : 0;
    this.sim.rev++;
  }

  step(dt: number) {
    this.pt += dt;
    while (this.next < this.events.length && this.events[this.next].at <= this.pt) {
      const ev = this.events[this.next++];
      ev.run();
      this.sim.rev++;
      if (this.sim.frozen) break;
    }
  }

  /* ---------------- the script ---------------- */

  private blob(from: string, to: string, color: string, dur: number, onArrive: () => void, label?: string, lane = 0) {
    const g = this.gen;
    this.sim.send({
      from: pid(from),
      to: pid(to),
      dur,
      color,
      r: this.sim.orient === 'portrait' ? 5.5 : 7,
      lane,
      label,
      trail: true,
      onArrive: () => {
        if (g === this.gen) {
          onArrive();
          this.sim.rev++;
        }
      },
    });
  }

  private num(v: number | string) {
    return this.numbers ? String(v) : undefined;
  }

  private build(skipIntro: boolean): Ev[] {
    const C = COMMON;
    const A = this.A;
    const B = this.B;
    const M = this.M;
    const ev: Ev[] = [];
    const at = (t: number, run: () => void) => ev.push({ at: t, run });
    const mitm = this.mitm;

    // 1. The common paint is public.
    if (skipIntro) {
      this.fill = { common: C, aMix: C, bMix: C };
      this.partial = { aMix: true, bMix: true };
      if (!mitm) this.eveHas = [{ color: C, what: this.numbers ? 'g, p' : 'common', num: this.num(`${DH.g}, ${DH.p}`) }];
      else this.malMix = null;
    } else {
      at(0.3, () => {
        this.fill = { ...this.fill, common: C };
      });
      at(0.8, () => {
        this.blob('common', 'aMix', C, 1.05, () => {
          this.fill = { ...this.fill, aMix: C };
          this.partial = { ...this.partial, aMix: true };
        }, this.num(DH.g));
        this.blob('common', 'bMix', C, 1.05, () => {
          this.fill = { ...this.fill, bMix: C };
          this.partial = { ...this.partial, bMix: true };
        }, this.num(DH.g));
        if (mitm) this.blob('common', 'mal', C, 1.05, () => undefined);
        else this.blob('common', 'eve', C, 1.05, () => (this.eveHas = [...this.eveHas, { color: C, what: this.numbers ? 'g, p' : 'common', num: this.num(`${DH.g}, ${DH.p}`) }]));
      });
    }

    // 2. Each side picks a secret and mixes it in.
    at(2.0, () => {
      this.fill = { ...this.fill, aSec: A, bSec: B, ...(mitm ? { mSec: M } : {}) };
    });
    at(2.6, () => {
      this.blob('aSec', 'aMix', A, 0.8, () => {
        this.fill = { ...this.fill, aMix: mix(C, A) };
        this.partial = { ...this.partial, aMix: false };
      }, this.num(DH.a));
      this.blob('bSec', 'bMix', B, 0.8, () => {
        this.fill = { ...this.fill, bMix: mix(C, B) };
        this.partial = { ...this.partial, bMix: false };
      }, this.num(DH.b));
      if (mitm) this.blob('mSec', 'mal', M, 0.8, () => (this.malMix = mix(C, M)));
    });

    // 3. Trade mixtures over the public wire.
    at(3.8, () => {
      if (mitm) {
        const CM = mix(C, M);
        this.blob('aMix', 'mal', mix(C, A), 1.1, () => {
          this.blob('mal', 'mFinA', mix(C, A), 0.55, () => {
            this.fill = { ...this.fill, mFinA: mix(C, A) };
            this.partial = { ...this.partial, mFinA: true };
          });
        }, undefined, -6);
        this.blob('bMix', 'mal', mix(C, B), 1.1, () => {
          this.blob('mal', 'mFinB', mix(C, B), 0.55, () => {
            this.fill = { ...this.fill, mFinB: mix(C, B) };
            this.partial = { ...this.partial, mFinB: true };
          });
        }, undefined, -6);
        this.sim.after(0.35, () => {
          this.blob('mal', 'aIn', CM, 1.0, () =>
            this.blob('aIn', 'aFin', CM, 0.5, () => {
              this.fill = { ...this.fill, aFin: CM };
              this.partial = { ...this.partial, aFin: true };
            }),
          undefined, 6);
          this.blob('mal', 'bIn', CM, 1.0, () =>
            this.blob('bIn', 'bFin', CM, 0.5, () => {
              this.fill = { ...this.fill, bFin: CM };
              this.partial = { ...this.partial, bFin: true };
            }),
          undefined, 6);
        });
        return;
      }
      const AM = mix(C, A);
      const BM = mix(C, B);
      const dur = 1.5;
      this.blob('aMix', 'bIn', AM, dur, () =>
        this.blob('bIn', 'bFin', AM, 0.55, () => {
          this.fill = { ...this.fill, bFin: AM };
          this.partial = { ...this.partial, bFin: true };
        }, this.num(DH.A)),
      this.num(DH.A), -5);
      this.blob('bMix', 'aIn', BM, dur, () =>
        this.blob('aIn', 'aFin', BM, 0.55, () => {
          this.fill = { ...this.fill, aFin: BM };
          this.partial = { ...this.partial, aFin: true };
        }, this.num(DH.B)),
      this.num(DH.B), 5);
      // Eve copies both as they pass her tap.
      const tapAt = this.tapFraction();
      this.sim.after(dur * tapAt.a, () => this.blob('tap', 'eve', AM, 0.45, () => (this.eveHas = [...this.eveHas, { color: AM, what: this.numbers ? 'A' : 'Alice’s mix', num: this.num(DH.A) }])));
      this.sim.after(dur * tapAt.b, () => this.blob('tap', 'eve', BM, 0.45, () => (this.eveHas = [...this.eveHas, { color: BM, what: this.numbers ? 'B' : 'server’s mix', num: this.num(DH.B) }])));
    });

    // 4. Predict: same color on both sides?
    at(6.2, () => this.askSame());

    // 5. Each adds its own secret to what it received.
    at(6.3, () => {
      if (mitm) {
        this.blob('aSec', 'aFin', A, 0.9, () => this.finish('aFin', mix(C, M, A)));
        this.blob('bSec', 'bFin', B, 0.9, () => this.finish('bFin', mix(C, M, B)));
        this.blob('mSec', 'mFinA', M, 0.9, () => this.finish('mFinA', mix(C, A, M)));
        this.blob('mSec', 'mFinB', M, 0.9, () => this.finish('mFinB', mix(C, B, M)));
        return;
      }
      this.blob('aSec', 'aFin', A, 0.9, () => this.finish('aFin', mix(C, B, A)), this.num(DH.a));
      this.blob('bSec', 'bFin', B, 0.9, () => this.finish('bFin', mix(C, A, B)), this.num(DH.b));
    });
    at(7.4, () => {
      this.compared = true;
      if (!mitm) this.sim.say(pid('aFin'), 'same color', SIG.res, 1.6);
    });

    // 6. Eve tries to combine what she copied.
    if (!mitm) {
      at(8.1, () => this.askEve());
      at(8.2, () => {
        this.eveTry = 'mixing';
      });
      at(9.1, () => {
        this.eveTry = 'done';
      });
    }

    at(mitm ? 11.5 : 12.5, () => this.endRound());
    return ev;
  }

  private finish(pot: PotId, color: string) {
    this.fill = { ...this.fill, [pot]: color };
    this.partial = { ...this.partial, [pot]: false };
  }

  /** Fraction of the exchange trip at which each mixture passes Eve's tap. */
  private tapFraction() {
    const s = this.sim;
    const aMix = s.boxes.get(pid('aMix'));
    const bMix = s.boxes.get(pid('bMix'));
    const aIn = s.boxes.get(pid('aIn'));
    const bIn = s.boxes.get(pid('bIn'));
    const tap = s.boxes.get(pid('tap'));
    if (!aMix || !bMix || !aIn || !bIn || !tap) return { a: 0.5, b: 0.5 };
    if (s.orient === 'landscape' || Math.abs(aMix.y - bMix.y) < 4) {
      const x0 = aMix.tx + aMix.w / 2;
      const x1 = bIn.tx;
      const y0 = bMix.tx - bMix.w / 2;
      const y1 = aIn.tx;
      return { a: (tap.tx - x0) / (x1 - x0), b: (y0 - tap.tx) / (y0 - y1) };
    }
    return { a: 0.5, b: 0.5 };
  }

  private askSame() {
    const game = this.sim.game;
    if (!game || game.done || this.mitm) return;
    game.ask({
      acceptable: ['same'],
      choices: [
        { id: 'same', label: 'Same color' },
        { id: 'diff', label: 'Different colors' },
      ],
      ask: 'Same final color on both sides?',
      askAt: { id: pid('common') },
      explain: (_p, ok) =>
        ok
          ? 'Each final pot holds one part common, one part Alice’s secret and one part the server’s. The order of mixing doesn’t matter.'
          : 'They match. Each final pot holds one part common, one part Alice’s secret and one part the server’s, just poured in a different order.',
    });
  }

  private askEve() {
    const game = this.sim.game;
    if (!game || game.done || this.mitm) return;
    game.ask({
      acceptable: ['no'],
      choices: [
        { id: 'yes', label: 'Yes, she gets it' },
        { id: 'no', label: 'No, it comes out wrong' },
      ],
      ask: 'Can Eve mix the shared color?',
      askAt: { id: pid('eve') },
      explain: (_p, ok) =>
        ok
          ? 'Her pot contains the common paint twice, once from each mixture, so it comes out too yellow. She would need to pull paint back out, and paint doesn’t un-mix.'
          : 'Pouring the two mixtures together gives two parts common paint, not one, so the color is off. Getting it right would mean un-mixing paint.',
    });
  }

  private endRound() {
    const game = this.sim.game;
    this.round++;
    if (game && !game.done) {
      const [a, b] = ROUNDS[this.round % ROUNDS.length];
      this.cfg = { ...this.cfg, a, b };
    }
    this.restart(false);
  }

  /* ---------------- labels ---------------- */

  label(id: PotId): PotLabel {
    const compact = this.sim.orient === 'portrait';
    const n = this.numbers;
    const partial = !!this.partial[id];
    const filled = !!this.fill[id];
    switch (id) {
      case 'common':
        return n ? { title: compact ? 'g=5 p=23' : 'public: g = 5, p = 23', num: '5' } : { title: compact ? 'common' : 'common paint', sub: compact ? undefined : 'public' };
      case 'aSec':
      case 'bSec': {
        const who = id === 'aSec' ? 'Alice' : 'server';
        if (n) return { title: id === 'aSec' ? `a = ${DH.a}` : `b = ${DH.b}`, sub: compact ? undefined : 'secret', num: String(id === 'aSec' ? DH.a : DH.b) };
        return { title: compact ? 'secret' : `${who}’s secret`, sub: compact ? undefined : 'never sent' };
      }
      case 'mSec':
        return { title: compact ? 'secret' : 'Mallory’s secret', sub: compact ? undefined : 'never sent' };
      case 'aMix':
        if (n && !filled) return { title: compact ? 'mixture' : 'Alice’s mixture' };
        if (n) return partial ? { title: `g = ${DH.g}`, num: String(DH.g) } : { title: compact ? `A = ${DH.A}` : `A = 5${sup(DH.a)} mod 23 = ${DH.A}`, num: String(DH.A) };
        return { title: compact ? 'mixture' : 'Alice’s mixture', sub: compact ? undefined : 'sent in public' };
      case 'bMix':
        if (n && !filled) return { title: compact ? 'mixture' : 'server’s mixture' };
        if (n) return partial ? { title: `g = ${DH.g}`, num: String(DH.g) } : { title: compact ? `B = ${DH.B}` : `B = 5${sup(DH.b)} mod 23 = ${DH.B}`, num: String(DH.B) };
        return { title: compact ? 'mixture' : 'server’s mixture', sub: compact ? undefined : 'sent in public' };
      case 'aFin':
        if (n && !filled) return { title: compact ? 'result' : 'Alice’s result' };
        if (n) return partial ? { title: `got B = ${DH.B}`, num: String(DH.B) } : { title: compact ? `${DH.B}${sup(DH.a)} mod 23 = ${DH.s}` : `B${sup(DH.a)} mod 23 = ${DH.B}${sup(DH.a)} mod 23 = ${DH.s}`, num: String(DH.s) };
        return { title: compact ? 'final' : this.mitm ? 'Alice’s key' : 'Alice’s final', sub: compact ? undefined : '+ her secret' };
      case 'bFin':
        if (n && !filled) return { title: compact ? 'result' : 'server’s result' };
        if (n) return partial ? { title: `got A = ${DH.A}`, num: String(DH.A) } : { title: compact ? `${DH.A}${sup(DH.b)} mod 23 = ${DH.s2}` : `A${sup(DH.b)} mod 23 = ${DH.A}${sup(DH.b)} mod 23 = ${DH.s2}`, num: String(DH.s2) };
        return { title: compact ? 'final' : this.mitm ? 'server’s key' : 'server’s final', sub: compact ? undefined : '+ its secret' };
      case 'mFinA':
        return { title: compact ? 'w/ Alice' : 'Mallory ↔ Alice', sub: compact ? undefined : 'matches Alice' };
      case 'mFinB':
        return { title: compact ? 'w/ server' : 'Mallory ↔ server', sub: compact ? undefined : 'matches server' };
    }
  }

  /* ---------------- layout ---------------- */

  layout() {
    const { w, h } = this.sim;
    const s = this.sim;
    const land = s.orient === 'landscape';
    const L = land ? w * 0.2 : 62;
    const R = land ? w * 0.8 : w - 62;
    const C = w / 2;
    const pot = land ? 54 : 36;
    const y = land
      ? { actor: 96, common: 158, sec: 246, wire: 342, eve: 412, fin: Math.min(h - 180, 580) }
      : { actor: 80, common: 126, sec: 188, wire: 252, eve: 294, fin: 356 };

    s.put(pid('alice'), L + (land ? 0 : 6), y.actor, land ? 150 : 112, land ? 40 : 34);
    s.put(pid('server'), R - (land ? 0 : 6), y.actor, land ? 168 : 120, land ? 40 : 34);
    s.put(pid('common'), C, y.common, pot, pot);
    s.put(pid('aSec'), L, y.sec, pot, pot);
    s.put(pid('bSec'), R, y.sec, pot, pot);
    s.put(pid('aMix'), L, y.wire, pot, pot);
    s.put(pid('bMix'), R, y.wire, pot, pot);
    s.put(pid('aFin'), L, y.fin, pot, pot);
    s.put(pid('bFin'), R, y.fin, pot, pot);
    const inset = land ? 76 : 46;
    s.put(pid('aIn'), L + inset, y.wire, 4, 4);
    s.put(pid('bIn'), R - inset, y.wire, 4, 4);
    if (this.mitm) {
      s.put(pid('mSec'), C, y.sec, pot, pot);
      s.put(pid('mal'), C, y.wire, land ? 150 : 104, land ? 46 : 38);
      const d = land ? 78 : 44;
      s.put(pid('mFinA'), C - d, y.fin, pot, pot);
      s.put(pid('mFinB'), C + d, y.fin, pot, pot);
    } else {
      s.put(pid('tap'), C, y.wire, 6, 6);
      s.put(pid('eve'), C, y.eve, land ? 112 : 84, land ? 36 : 28);
    }
  }

  wires(): WireSpec[] {
    if (this.mitm) {
      return [
        { from: pid('aMix'), to: pid('mal') },
        { from: pid('mal'), to: pid('bMix') },
      ];
    }
    return [
      { from: pid('aMix'), to: pid('bMix') },
      { from: pid('tap'), to: pid('eve'), state: 'dashed', color: 'rgba(255,77,106,0.6)' },
    ];
  }

  /** Straight trips along the public wire; secrets loop around the outside of each column. */
  curve(from: string, to: string, lane: number): Curve | null {
    const a = this.sim.boxes.get(from);
    const b = this.sim.boxes.get(to);
    if (!a || !b || Number.isNaN(a.x) || Number.isNaN(b.x)) return null;
    const straight = (x0: number, y0: number, x1: number, y1: number): Curve => ({
      p0: { x: x0, y: y0 },
      p1: { x: x0 + (x1 - x0) / 3, y: y0 + (y1 - y0) / 3 },
      p2: { x: x0 + ((x1 - x0) * 2) / 3, y: y0 + ((y1 - y0) * 2) / 3 },
      p3: { x: x1, y: y1 },
    });
    const f = from.slice(3);
    const t = to.slice(3);
    const along = (f === 'aMix' || f === 'bMix' || f === 'mal') && (t === 'aIn' || t === 'bIn' || t === 'mal');
    if (along) {
      const dir = Math.sign(b.x - a.x) || 1;
      return straight(a.x + (dir * a.w) / 2, a.y + lane, b.x - (dir * b.w) / 2, b.y + lane);
    }
    if ((f === 'aSec' && t === 'aFin') || (f === 'bSec' && t === 'bFin')) {
      const side = f === 'aSec' ? -1 : 1;
      const bow = this.sim.orient === 'portrait' ? 34 : 70;
      const x0 = a.x + (side * a.w) / 2;
      const x1 = b.x + (side * b.w) / 2;
      return { p0: { x: x0, y: a.y }, p1: { x: x0 + side * bow, y: a.y + 20 }, p2: { x: x1 + side * bow, y: b.y - 20 }, p3: { x: x1, y: b.y } };
    }
    if (f === 'mSec' && (t === 'mFinA' || t === 'mFinB')) {
      // Around Mallory's card
      const side = t === 'mFinA' ? -1 : 1;
      const mal = this.sim.boxes.get(pid('mal'));
      const bow = (mal ? mal.w / 2 : 60) + 14;
      return { p0: { x: a.x + (side * a.w) / 2, y: a.y }, p1: { x: a.x + side * bow, y: a.y + 30 }, p2: { x: a.x + side * bow, y: b.y - 40 }, p3: { x: b.x, y: b.y - b.h / 2 } };
    }
    return null;
  }
}
