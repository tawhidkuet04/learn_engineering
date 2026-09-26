import { SIG } from '@/lib/sim/colors';
import type { Sim } from '@/lib/sim/Sim';

/**
 * Chapter 1's world: numbered packets crossing a small mesh of routers.
 * The upper route is short, the lower one long (so packets overtake each
 * other), R2's queue sometimes overflows (loss) and R1 once forwards a
 * packet twice (duplication). In TCP mode the server acknowledges, Alice
 * retransmits after a timeout and the server hands data to the app in order.
 */

export type NetMode = 'udp' | 'tcp';
export type ArrivalMark = 'ok' | 'late' | 'dup' | 'rtx';

export interface Arrival {
  n: number;
  mark: ArrivalMark;
  key: number;
}

const UP = ['alice', 'r1', 'r2', 'r4', 'srv'];
const DOWN = ['alice', 'r1', 'r3', 'r4', 'srv'];
const BACK = ['srv', 'r4', 'r2', 'r1', 'alice'];

/** Retransmission timeout, on-screen seconds (a round trip here is about 4 s) */
const RTO = 5.2;

/** Hop durations in on-screen seconds */
const HOP: Record<string, number> = {
  'alice>r1': 0.45,
  'r1>r2': 0.55,
  'r2>r4': 0.55,
  'r1>r3': 0.95,
  'r3>r4': 0.95,
  'r4>srv': 0.45,
  'srv>r4': 0.4,
  'r4>r2': 0.45,
  'r2>r1': 0.45,
  'r1>alice': 0.4,
};

interface Plan {
  route: 'up' | 'down';
  lose: boolean;
  dup: boolean;
}

/** The first packets are scripted so every problem shows up early. */
const SCRIPT: Record<number, Plan> = {
  1: { route: 'up', lose: false, dup: false },
  2: { route: 'up', lose: false, dup: false },
  3: { route: 'down', lose: false, dup: false },
  4: { route: 'up', lose: false, dup: false },
  5: { route: 'up', lose: true, dup: false },
  6: { route: 'up', lose: false, dup: true },
  7: { route: 'up', lose: false, dup: false },
  8: { route: 'down', lose: false, dup: false },
  9: { route: 'up', lose: false, dup: false },
  10: { route: 'up', lose: false, dup: false },
};

export class NetDemo {
  mode: NetMode;
  arrivals: Arrival[] = [];
  appRead: number[] = [];
  held = new Set<number>();
  stats = { sent: 0, arrived: 0, lost: 0, late: 0, dups: 0, rtx: 0 };
  /** Numbers that never made it (UDP), shown in red */
  missing = new Set<number>();

  private sim: Sim;
  private next = 1;
  private highest = 0;
  private seen = new Set<number>();
  private expected = 1;
  private acked = 1;
  /** One retransmission timer, for the oldest unacknowledged packet (like TCP) */
  private rtoAt: number | null = null;
  private attempts = new Map<number, number>();
  private clock = 0;
  private nextSend = 0.35;
  private key = 1;
  private lostAt = new Map<number, number>();

  constructor(sim: Sim, mode: NetMode) {
    this.sim = sim;
    this.mode = mode;
  }

  private plan(n: number, attempt: number): Plan {
    if (attempt === 0 && SCRIPT[n]) return SCRIPT[n];
    const r = this.sim.rng();
    return { route: r < 0.72 ? 'up' : 'down', lose: attempt === 0 ? this.sim.rng() < 0.08 : this.sim.rng() < 0.04, dup: attempt === 0 && this.sim.rng() < 0.04 };
  }

  step(dt: number) {
    this.clock += dt;
    if (this.clock >= this.nextSend) {
      if (this.mode === 'udp') {
        this.launch(this.next++, 0);
        this.nextSend = this.clock + 0.55;
      } else if (this.next < this.acked + 4) {
        this.launch(this.next++, 0);
        this.nextSend = this.clock + 0.55;
      }
    }
    if (this.mode === 'tcp' && this.rtoAt != null && this.clock >= this.rtoAt && this.acked < this.next) {
      // Timeout: resend only the oldest unacknowledged packet, then wait again.
      this.stats.rtx++;
      this.launch(this.acked, (this.attempts.get(this.acked) ?? 0) + 1);
      this.rtoAt = this.clock + RTO;
    }
    // UDP: a number is "missing" once everything around it has had time to land.
    if (this.mode === 'udp') {
      for (const [n, t] of this.lostAt) {
        if (this.clock - t > 1.2) {
          this.missing.add(n);
          this.lostAt.delete(n);
          this.sim.rev++;
        }
      }
    }
  }

  private launch(n: number, attempt: number) {
    this.attempts.set(n, attempt);
    this.stats.sent++;
    const p = this.plan(n, attempt);
    const color = attempt > 0 ? SIG.heavy : SIG.req;
    if (this.mode === 'tcp' && this.rtoAt == null) this.rtoAt = this.clock + RTO;
    this.hop(n, p.route === 'up' ? UP : DOWN, 0, { lose: p.lose, dup: p.dup, color, rtx: attempt > 0 });
    this.sim.rev++;
  }

  private hop(n: number, path: string[], k: number, o: { lose: boolean; dup: boolean; color: string; rtx: boolean }) {
    if (k >= path.length - 1) {
      this.arrive(n, o.rtx);
      return;
    }
    const from = path[k];
    const to = path[k + 1];
    const dropHere = o.lose && to === 'r2';
    this.sim.send({
      from,
      to,
      dur: HOP[`${from}>${to}`] ?? 0.5,
      color: o.color,
      label: String(n),
      lane: 4,
      tag: `pkt:${n}`,
      lostAt: dropHere ? 0.9 : null,
      onLost: () => {
        this.stats.lost++;
        this.sim.say('r2', 'queue full: dropped', SIG.err, 1.3);
        if (this.mode === 'udp') this.lostAt.set(n, this.clock);
        this.sim.rev++;
      },
      onArrive: () => {
        if (to === 'r1' && o.dup) {
          // R1 forwards it twice: once up, once the long way round.
          this.sim.say('r1', 'duplicated', SIG.heavy, 1.3);
          this.hop(n, UP, 1, { ...o, dup: false });
          this.hop(n, DOWN, 1, { ...o, dup: false });
          return;
        }
        this.hop(n, path, k + 1, o);
      },
    });
  }

  private arrive(n: number, rtx: boolean) {
    const dup = this.seen.has(n) && (this.mode === 'udp' || n < this.expected || this.held.has(n));
    const late = !dup && n < this.highest;
    const mark: ArrivalMark = dup ? 'dup' : rtx ? 'rtx' : late ? 'late' : 'ok';
    this.seen.add(n);
    this.highest = Math.max(this.highest, n);
    this.stats.arrived++;
    if (dup) this.stats.dups++;
    if (late) this.stats.late++;
    this.arrivals.push({ n, mark, key: this.key++ });
    if (this.arrivals.length > 40) this.arrivals.shift();
    // Ring the edge where packets come in, not the server's name.
    const b = this.sim.boxes.get('srv');
    const edge = !b ? {} : this.sim.orient === 'portrait' ? { dy: -b.h / 2 } : { dx: -b.w / 2 };
    this.sim.fx({ kind: 'ring', at: { id: 'srv', ...edge }, color: dup ? SIG.heavy : late ? SIG.warn : SIG.res, size: 0.7 });

    if (this.mode === 'tcp') {
      if (!dup && n >= this.expected) {
        if (n === this.expected) {
          this.expected++;
          this.appRead.push(n);
          while (this.held.has(this.expected)) {
            this.held.delete(this.expected);
            this.appRead.push(this.expected);
            this.expected++;
          }
          if (this.appRead.length > 60) this.appRead.splice(0, this.appRead.length - 60);
        } else this.held.add(n);
      }
      this.ack(this.expected);
    }
    this.sim.rev++;
  }

  private ack(a: number) {
    const go = (k: number) => {
      if (k >= BACK.length - 1) {
        if (a > this.acked) {
          this.acked = a;
          this.rtoAt = this.acked < this.next ? this.clock + RTO : null;
          this.sim.rev++;
        }
        return;
      }
      const from = BACK[k];
      const to = BACK[k + 1];
      this.sim.send({ from, to, dur: HOP[`${from}>${to}`] ?? 0.45, color: SIG.res, r: 3.4, label: `ack ${a}`, lane: 4, tag: 'ack', onArrive: () => go(k + 1) });
    };
    go(0);
  }

  /** Numbers the app has not received yet but that are held in the buffer */
  get heldList() {
    return [...this.held].sort((x, y) => x - y);
  }

  get expectedNext() {
    return this.expected;
  }
}
