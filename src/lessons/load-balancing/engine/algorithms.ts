import type { Client, LB, Server } from './entities';
import type { Rng } from '@/lib/sim/rng';
import type { Algo } from './types';

export type Detail =
  | { kind: 'rr'; order: string[]; index: number; last: string | null }
  | { kind: 'least'; counts: [string, number][]; min: number }
  | { kind: 'weighted'; weights: [string, number][] }
  | { kind: 'hash'; ip: string; parts: number[]; sum: number; n: number; mod: number; order: string[] }
  | { kind: 'random'; n: number }
  | { kind: 'p2c'; a: string; b: string; ca: number; cb: number }
  | { kind: 'l4'; ip: string; port: number; reused: boolean }
  | { kind: 'forced' };

export interface Decision {
  chosen: string;
  /** Every answer a learner could give that is also correct (ties) */
  acceptable: string[];
  algo: Algo | 'l4' | 'forced';
  detail: Detail;
  /** Pool routing that happened before the algorithm ran (L7) */
  route?: { path: string; pool: string };
  /** Apply the algorithm's state change (pointer moves, weights shift) */
  commit: (chosen: string) => void;
}

export const ALGO_NAMES: Record<Algo, string> = {
  rr: 'Round robin',
  least: 'Least connections',
  weighted: 'Weighted round robin',
  iphash: 'IP hash',
  random: 'Random',
  p2c: 'Power of two choices',
};

const conns = (lb: LB, id: string) => lb.conns.get(id) ?? 0;

export function decide(lb: LB, algo: Algo, cands: Server[], client: Client, rng: Rng): Decision {
  const ids = cands.map((s) => s.id);
  const n = ids.length;

  switch (algo) {
    case 'rr': {
      const index = lb.rr % n;
      return {
        chosen: ids[index],
        acceptable: [ids[index]],
        algo,
        detail: { kind: 'rr', order: ids, index, last: lb.lastPick },
        commit: () => {
          lb.rr = index + 1;
        },
      };
    }

    case 'least': {
      const counts = ids.map((id) => [id, conns(lb, id)] as [string, number]);
      const min = Math.min(...counts.map((c) => c[1]));
      const ties = counts.filter((c) => c[1] === min).map((c) => c[0]);
      return {
        chosen: ties[lb.rr % ties.length],
        acceptable: ties,
        algo,
        detail: { kind: 'least', counts, min },
        commit: () => {
          lb.rr += 1;
        },
      };
    }

    case 'weighted': {
      // Smooth weighted round robin (the algorithm NGINX uses): every server
      // earns its weight each round, the richest wins and pays the total back.
      const cur = new Map(lb.wrr);
      let total = 0;
      let best = ids[0];
      let bestV = -Infinity;
      for (const s of cands) {
        const v = (cur.get(s.id) ?? 0) + s.weight;
        cur.set(s.id, v);
        total += s.weight;
        if (v > bestV) {
          bestV = v;
          best = s.id;
        }
      }
      cur.set(best, bestV - total);
      return {
        chosen: best,
        acceptable: [best],
        algo,
        detail: { kind: 'weighted', weights: cands.map((s) => [s.id, s.weight]) },
        commit: () => {
          lb.wrr = cur;
        },
      };
    }

    case 'iphash': {
      const parts = client.ip.split('.').map(Number);
      const sum = parts.reduce((a, b) => a + b, 0);
      const mod = sum % n;
      return {
        chosen: ids[mod],
        acceptable: [ids[mod]],
        algo,
        detail: { kind: 'hash', ip: client.ip, parts, sum, n, mod, order: ids },
        commit: () => {},
      };
    }

    case 'random': {
      const i = Math.floor(rng() * n);
      return {
        chosen: ids[i],
        acceptable: ids,
        algo,
        detail: { kind: 'random', n },
        commit: () => {},
      };
    }

    case 'p2c': {
      if (n === 1) {
        return {
          chosen: ids[0],
          acceptable: ids,
          algo,
          detail: { kind: 'p2c', a: ids[0], b: ids[0], ca: conns(lb, ids[0]), cb: conns(lb, ids[0]) },
          commit: () => {},
        };
      }
      const i = Math.floor(rng() * n);
      let j = Math.floor(rng() * (n - 1));
      if (j >= i) j += 1;
      const a = ids[i];
      const b = ids[j];
      const ca = conns(lb, a);
      const cb = conns(lb, b);
      const chosen = cb < ca ? b : a;
      return {
        chosen,
        acceptable: ca === cb ? [a, b] : [chosen],
        algo,
        detail: { kind: 'p2c', a, b, ca, cb },
        commit: () => {},
      };
    }
  }
}

/** One-line explanation of a decision, for feedback after a prediction. */
export function explain(d: Decision, label: (id: string) => string): string {
  const det = d.detail;
  switch (det.kind) {
    case 'rr':
      return det.last
        ? `Round robin just walks down the list. After ${label(det.last)} comes ${label(d.chosen)}.`
        : `Round robin starts at the top of the list: ${label(d.chosen)}.`;
    case 'least': {
      const tied = d.acceptable.length > 1;
      return tied
        ? `${d.acceptable.map(label).join(' and ')} were tied at ${det.min} open connection${det.min === 1 ? '' : 's'}, so any of them is a fair pick.`
        : `${label(d.chosen)} had the fewest open connections (${det.min}).`;
    }
    case 'hash':
      return `${det.parts.join(' + ')} = ${det.sum}, and ${det.sum} mod ${det.n} = ${det.mod}, which is ${label(d.chosen)}. Same IP, same server, every time.`;
    case 'weighted':
      return `Weighted round robin sends more requests to servers with bigger weights.`;
    case 'p2c':
      return `It sampled ${label(det.a)} (${det.ca}) and ${label(det.b)} (${det.cb}) and took the less busy one.`;
    default:
      return `The load balancer picked ${label(d.chosen)}.`;
  }
}
