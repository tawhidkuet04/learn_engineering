import { SIG } from '@/lib/sim/colors';
import type { Curve } from '@/lib/sim/geometry';
import type { WireSpec } from '@/lib/sim/Sim';
import { shift, vertical } from './geom';
import { MS_PER_S } from './model';
import type { CapSim } from './sim';

/*
 * Dynamo-style quorums. Alice (top left) writes to all N replicas and is told
 * "ok" after W acks. Bob (bottom right) reads from the R replicas nearest to
 * him and keeps the highest version. We show the worst case: the replicas that
 * didn't ack yet are slow, so they're still behind when Bob reads.
 */

export interface QRound {
  w: number;
  r: number;
}

export const qid = (i: number) => `q${i + 1}`;
/** What the stage calls replica i. */
export const rName = (i: number) => `r${i + 1}`;
const isQ = (id: string) => /^q\d$/.test(id);

export class QuorumCtl {
  vers = [7, 7, 7, 7, 7];
  flash = [-10, -10, -10, -10, -10];
  latest = 7;
  writing: number | null = null;
  acked = new Set<number>();
  readSet: number[] = [];
  readGot: number[] = [];
  phase: 'idle' | 'write' | 'read' | 'settle' = 'idle';
  lastRead: { ver: number; stale: boolean } | null = null;
  alice: { text: string; tone: 'ok' | 'err' | 'info' | 'stale' } | null = null;
  bob: { text: string; tone: 'ok' | 'err' | 'info' | 'stale' } | null = null;
  wMs: number | null = null;
  rMs: number | null = null;
  stale = 0;
  fresh = 0;
  /** Scripted (w, r) settings for the prediction step */
  rounds: QRound[] | null = null;
  round = 0;
  private gen = 0;

  constructor(private sim: CapSim) {}

  get n() {
    return this.sim.cfg.n;
  }
  get w() {
    return this.rounds ? this.rounds[this.round % this.rounds.length].w : Math.min(this.sim.cfg.w, this.n);
  }
  get r() {
    return this.rounds ? this.rounds[this.round % this.rounds.length].r : Math.min(this.sim.cfg.r, this.n);
  }
  get overlap() {
    return this.readSet.filter((i) => this.acked.has(i));
  }

  reset() {
    this.gen++;
    this.vers = [7, 7, 7, 7, 7];
    this.flash = [-10, -10, -10, -10, -10];
    this.latest = 7;
    this.writing = null;
    this.acked = new Set();
    this.readSet = [];
    this.readGot = [];
    this.phase = 'idle';
    this.lastRead = null;
    this.alice = null;
    this.bob = null;
    this.wMs = null;
    this.rMs = null;
    this.stale = 0;
    this.fresh = 0;
    this.rounds = null;
    this.round = 0;
  }

  /** Script the (W, R) settings round by round (the prediction step). */
  setRounds(rounds: QRound[] | null) {
    this.rounds = rounds;
    this.round = 0;
    this.sim.rev++;
  }

  start() {
    const g = ++this.gen;
    this.sim.after(0.9, () => this.cycle(g));
  }

  /** N, R or W changed: start a fresh cycle with every replica in sync. */
  configure() {
    const s = this.sim;
    this.gen++;
    s.flights = s.flights.filter((f) => f.tag !== 'q');
    this.vers = this.vers.map(() => this.latest);
    this.acked = new Set();
    this.readSet = [];
    this.readGot = [];
    this.phase = 'idle';
    this.lastRead = null;
    this.alice = null;
    this.bob = null;
    this.stale = 0;
    this.fresh = 0;
    if (s.cfg.view === 'quorum') this.start();
  }

  private cycle(g: number) {
    if (g !== this.gen) return;
    const s = this.sim;
    const { n, w } = this;
    const ver = this.latest + 1;
    this.phase = 'write';
    this.writing = ver;
    this.acked = new Set();
    this.readSet = [];
    this.readGot = [];
    this.lastRead = null;
    this.alice = { text: `writing v${ver}…`, tone: 'info' };
    this.bob = null;
    const t0 = s.t;
    for (let i = 0; i < n; i++) {
      const fast = i < w;
      const d = 0.55 + 0.16 * i;
      s.send({
        from: 'qa',
        to: qid(i),
        dur: fast ? d : 5.6,
        color: SIG.req,
        label: fast ? `v${ver}` : `v${ver} · slow`,
        tag: 'q',
        onArrive: () => {
          if (g !== this.gen) return;
          this.vers[i] = Math.max(this.vers[i], ver);
          this.flash[i] = s.vt;
          s.rev++;
          s.send({
            from: qid(i),
            to: 'qa',
            dur: d,
            color: SIG.res,
            r: 3.4,
            label: 'ack',
            tag: 'q',
            onArrive: () => {
              if (g !== this.gen || this.phase !== 'write' || this.writing !== ver) return;
              this.acked.add(i);
              s.rev++;
              if (this.acked.size < w) return;
              this.phase = 'read';
              this.latest = ver;
              this.wMs = (s.t - t0) * MS_PER_S;
              this.alice = { text: `✓ v${ver} · ${w} ack${w > 1 ? 's' : ''}`, tone: 'ok' };
              s.after(0.45, () => this.readPhase(g, ver));
            },
          });
        },
      });
    }
  }

  private readPhase(g: number, ver: number) {
    if (g !== this.gen) return;
    const s = this.sim;
    const { n, r, w } = this;
    if (r <= 0) {
      this.settle(g);
      return;
    }
    this.readSet = Array.from({ length: r }, (_, k) => n - 1 - k);
    s.rev++;
    const names = this.readSet.map(rName).join(' + ');
    const hit = this.overlap;
    const go = () => this.sendReads(g, ver);
    const game = s.game;
    if (game && !game.done) {
      const asked = game.ask({
        acceptable: [hit.length ? 'new' : 'stale'],
        choices: [
          { id: 'new', label: `Yes: v${ver}` },
          { id: 'stale', label: `No: v${ver - 1}` },
        ],
        ask: `Bob reads ${names}. Does he see v${ver}?`,
        askAt: { id: 'qb' },
        explain: () =>
          hit.length
            ? `${hit.map(rName).join(' and ')} acked the write and Bob asks it too. R + W = ${r} + ${w} = ${r + w} > N = ${n}, so the two groups must share at least one replica, and Bob keeps the highest version he hears.`
            : `The write reached ${[...this.acked].map(rName).join(' + ')}, but Bob only asks ${names}. R + W = ${r} + ${w} = ${r + w} is not more than N = ${n}, so the two groups can miss each other and Bob gets the old v${ver - 1}.`,
        resolve: go,
      });
      if (asked) return;
    }
    go();
  }

  private sendReads(g: number, ver: number) {
    const s = this.sim;
    const n = this.n;
    const t0 = s.t;
    this.bob = { text: `asking ${this.readSet.length}…`, tone: 'info' };
    for (const i of this.readSet) {
      const d = 0.55 + 0.16 * (n - 1 - i);
      s.send({
        from: 'qb',
        to: qid(i),
        dur: d,
        color: SIG.req,
        r: 3.6,
        label: 'get',
        tag: 'q',
        onArrive: () => {
          if (g !== this.gen) return;
          const v = this.vers[i];
          s.send({
            from: qid(i),
            to: 'qb',
            dur: d,
            color: v >= ver ? SIG.res : SIG.heavy,
            r: 3.6,
            label: `v${v}`,
            tag: 'q',
            onArrive: () => {
              if (g !== this.gen) return;
              this.readGot.push(v);
              if (this.readGot.length < this.readSet.length) return;
              const best = Math.max(...this.readGot);
              const stale = best < this.latest;
              this.lastRead = { ver: best, stale };
              if (stale) this.stale++;
              else this.fresh++;
              this.rMs = (s.t - t0) * MS_PER_S;
              this.bob = stale ? { text: `✕ got v${best}: stale`, tone: 'stale' } : { text: `✓ got v${best}`, tone: 'ok' };
              s.rev++;
              this.settle(g);
            },
          });
        },
      });
    }
  }

  /** Wait for the slow replicas to catch up, then go again. */
  private settle(g: number) {
    const s = this.sim;
    this.phase = 'settle';
    let waited = 0;
    const check = () => {
      if (g !== this.gen) return;
      const done = this.vers.slice(0, this.n).every((v) => v >= this.latest);
      if (done || waited > 8) {
        s.after(2.2, () => {
          if (g !== this.gen) return;
          this.round++;
          this.cycle(g);
        });
        return;
      }
      waited += 0.3;
      s.after(0.3, check);
    };
    check();
  }

  step(dt: number) {
    void dt;
  }

  /* ---------------- layout ---------------- */

  layout() {
    const s = this.sim;
    const { w: W, h: H } = s;
    const n = this.n;
    if (s.orient === 'landscape') {
      const gap = Math.min(150, (W - 280) / Math.max(1, n - 1));
      const y = H * 0.5;
      for (let i = 0; i < 5; i++) s.place(qid(i), W / 2 + (i - (n - 1) / 2) * gap, y, 112, 72);
      s.place('qa', W * 0.17, H * 0.2, 150, 40);
      s.place('qb', W * 0.8, H * 0.78, 150, 40);
    } else {
      const cw = n >= 5 ? 62 : n === 4 ? 78 : 96;
      const gap = cw + 8;
      const y = 262;
      for (let i = 0; i < 5; i++) s.place(qid(i), W / 2 + (i - (n - 1) / 2) * gap, y, cw, 64);
      s.place('qa', W * 0.3, 102, 140, 36);
      s.place('qb', W * 0.7, 394, 140, 36);
    }
  }

  wires(): WireSpec[] {
    const out: WireSpec[] = [];
    for (let i = 0; i < this.n; i++) {
      out.push({ from: 'qa', to: qid(i), state: 'dim' });
      out.push({ from: 'qb', to: qid(i), state: 'dim' });
    }
    return out;
  }

  /** Alice's and Bob's messages leave and enter vertically. Returns undefined for other pairs. */
  curveFor(from: string, to: string, lane: number): Curve | null | undefined {
    const client = from === 'qa' || from === 'qb' ? from : to === 'qa' || to === 'qb' ? to : null;
    const rep = client === from ? to : from;
    if (!client || !isQ(rep)) return undefined;
    const A = this.sim.boxes.get(from);
    const B = this.sim.boxes.get(to);
    if (!A || !B || Number.isNaN(A.x) || Number.isNaN(B.x)) return null;
    const edge = (b: typeof A, other: typeof A) => ({ x: b.x, y: b.y < other.y ? b.y + b.h / 2 : b.y - b.h / 2 });
    return shift(vertical(edge(A, B), edge(B, A), 0.55), lane);
  }
}
