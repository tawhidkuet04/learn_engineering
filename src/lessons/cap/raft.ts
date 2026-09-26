import { SIG } from '@/lib/sim/colors';
import { HOP, NODES, PEOPLE, REGION, type ClientId, type NodeId, type Val } from './model';
import type { CapSim, Status } from './sim';

/*
 * A small Raft, the way etcd runs it: one leader per term, writes commit once
 * a majority has them, followers elect a new leader when heartbeats stop, and
 * a leader that can't hear from a majority steps down (etcd's CheckQuorum).
 * Terms only move forward on a won election (like etcd's pre-vote), so a
 * cut-off node doesn't inflate its term.
 */

type Role = 'leader' | 'follower' | 'candidate';

interface RNode {
  role: Role;
  term: number;
  leader: NodeId | null;
  lastHeard: number;
  /** Election timeout (fixed per node here so the story replays the same way) */
  timeout: number;
  /** Last time a leader heard back from a majority */
  lastQuorum: number;
  acksAt: Partial<Record<NodeId, number>>;
  electing: { term: number; votes: number } | null;
  /** The term this node last voted in, and for whom */
  votedTerm: number;
  votedFor: NodeId | null;
}

const HEARTBEAT = 0.9;
const CHECK_QUORUM = 2.4;
const COMMIT_TIMEOUT = 2.6;
/** How long a candidate waits for votes (longer than the slowest round trip, Frankfurt–Singapore) */
const ELECTION_WINDOW = 2.4;

export class RaftCtl {
  nodes = {} as Record<NodeId, RNode>;
  /** Latest event, for the readout */
  event: { text: string; tone: Status['tone'] } | null = null;
  private hbIn = 0;
  private autoIn = 1.2;
  private turn = 0;

  constructor(private sim: CapSim) {
    this.reset();
  }

  reset() {
    for (const n of NODES) {
      this.nodes[n] = {
        role: n === 'va' ? 'leader' : 'follower',
        term: 3,
        leader: 'va',
        lastHeard: 0,
        timeout: n === 'fra' ? 1.8 : n === 'sg' ? 2.6 : 2.2,
        lastQuorum: 0,
        acksAt: {},
        electing: null,
        votedTerm: 3,
        votedFor: 'va',
      };
    }
    this.event = { text: 'Virginia leads term 3', tone: 'ok' };
    this.hbIn = 0.2;
    this.autoIn = 1.3;
    this.turn = 0;
  }

  start() {
    const t = this.sim.t;
    for (const n of NODES) {
      this.nodes[n].lastHeard = t;
      this.nodes[n].lastQuorum = t;
    }
  }

  get leader(): NodeId | null {
    return NODES.find((n) => this.nodes[n].role === 'leader' && this.sim.reach(n) >= 2) ?? NODES.find((n) => this.nodes[n].role === 'leader') ?? null;
  }

  private log(text: string, tone: Status['tone']) {
    this.event = { text, tone };
    this.sim.rev++;
  }

  step(dt: number) {
    const s = this.sim;
    const t = s.t;
    this.hbIn -= dt;
    if (this.hbIn <= 0) {
      this.hbIn += HEARTBEAT;
      for (const n of NODES) if (this.nodes[n].role === 'leader') this.heartbeat(n);
    }
    for (const n of NODES) {
      const N = this.nodes[n];
      if (N.role === 'leader') {
        if (t - N.lastQuorum > CHECK_QUORUM) {
          N.role = 'follower';
          N.leader = null;
          N.lastHeard = t;
          s.say(n, 'lost its majority: steps down', SIG.warn, 2.2);
          this.log(`${REGION[n].city} can't reach a majority, steps down`, 'err');
        }
        continue;
      }
      if (!N.electing && t - N.lastHeard > N.timeout) this.startElection(n);
    }
    this.autoIn -= dt;
    if (this.autoIn <= 0) {
      this.autoIn = 3.1;
      const c: ClientId = this.turn++ % 2 === 0 ? 'alice' : 'bob';
      if (!s.clients[c].busy) this.clientWrite(c);
    }
  }

  /* ---------------- heartbeats ---------------- */

  private heartbeat(from: NodeId) {
    const s = this.sim;
    const term = this.nodes[from].term;
    for (const p of s.peers(from)) {
      s.link({ from, to: p, color: SIG.hc, r: 2.6, lane: -6, tag: 'hb', onArrive: () => this.onAppend(p, from, term) });
    }
  }

  /** A follower hears from a leader (a heartbeat or a new entry). Returns false if it rejects it. */
  private onAppend(p: NodeId, from: NodeId, term: number, entry?: Val): boolean {
    const s = this.sim;
    const N = this.nodes[p];
    if (term < N.term) {
      // Stale leader: tell it about the newer term.
      s.link({ from: p, to: from, color: SIG.err, r: 3, lane: -6, label: `term ${N.term}`, onArrive: () => this.newerTerm(from, N.term) });
      return false;
    }
    const wasLost = N.leader !== from || N.role !== 'follower';
    N.term = term;
    N.role = 'follower';
    N.leader = from;
    N.electing = null;
    N.lastHeard = s.t;
    const R = s.replicas[p];
    if (R.pending) {
      R.pending = null;
      s.say(p, 'uncommitted write discarded', SIG.heavy, 2.2);
    }
    const lv = entry ?? s.replicas[from].val;
    if (lv.ver > R.val.ver || (lv.ver === R.val.ver && lv.id !== R.val.id)) s.adopt(p, lv);
    if (wasLost && p === 'va' && from !== 'va') this.log(`Virginia rejoins as a follower (term ${term})`, 'ok');
    if (!entry) s.link({ from: p, to: from, color: SIG.res, r: 2.3, lane: -6, tag: 'hb', onArrive: () => this.onAck(from, p, term) });
    return true;
  }

  private onAck(leader: NodeId, from: NodeId, term: number) {
    const L = this.nodes[leader];
    if (L.role !== 'leader' || L.term !== term) return;
    const t = this.sim.t;
    L.acksAt[from] = t;
    const fresh = Object.values(L.acksAt).filter((x) => x != null && t - x < CHECK_QUORUM).length;
    if (fresh + 1 >= 2) L.lastQuorum = t;
  }

  private newerTerm(n: NodeId, term: number) {
    const N = this.nodes[n];
    if (term <= N.term) return;
    N.term = term;
    N.role = 'follower';
    N.leader = null;
    N.electing = null;
    N.lastHeard = this.sim.t;
    this.sim.rev++;
  }

  /* ---------------- elections ---------------- */

  private startElection(n: NodeId) {
    const s = this.sim;
    const N = this.nodes[n];
    // A retry after a failed election asks for a newer term, so split votes can't repeat forever.
    const term = Math.max(N.term, N.votedTerm) + 1;
    N.electing = { term, votes: 1 };
    N.role = 'candidate';
    N.leader = null;
    N.votedTerm = term;
    N.votedFor = n;
    s.rev++;
    for (const p of s.peers(n)) {
      s.link({ from: n, to: p, color: SIG.hc, r: 3.2, label: 'vote?', onArrive: () => this.onVoteRequest(p, n, term) });
    }
    s.after(ELECTION_WINDOW, () => {
      if (N.electing?.term !== term) return;
      N.electing = null;
      N.role = 'follower';
      N.lastHeard = s.t;
      s.rev++;
    });
  }

  private onVoteRequest(p: NodeId, cand: NodeId, term: number) {
    const s = this.sim;
    const N = this.nodes[p];
    const heardLeader = N.role === 'leader' || (N.leader != null && s.t - N.lastHeard < 1.0);
    // One vote per term. The voter's own term moves on only when it hears from the winner.
    const grant = term > N.term && !heardLeader && (N.votedTerm < term || N.votedFor === cand);
    if (grant) {
      N.votedTerm = term;
      N.votedFor = cand;
      N.lastHeard = s.t;
      if (N.electing) {
        N.electing = null;
        N.role = 'follower';
      }
    }
    s.link({ from: p, to: cand, color: grant ? SIG.res : SIG.err, r: 3.2, label: grant ? 'yes' : 'no', onArrive: () => grant && this.onVote(cand, term) });
  }

  private onVote(cand: NodeId, term: number) {
    const s = this.sim;
    const N = this.nodes[cand];
    if (!N.electing || N.electing.term !== term) return;
    N.electing.votes++;
    if (N.electing.votes < 2) return;
    N.electing = null;
    N.role = 'leader';
    N.term = term;
    N.leader = cand;
    N.lastQuorum = s.t;
    N.acksAt = {};
    this.hbIn = 0;
    s.say(cand, `★ elected leader · term ${term}`, SIG.res, 2.2);
    this.log(`${REGION[cand].city} wins term ${term} with 2 of 3 votes`, 'ok');
  }

  /* ---------------- client writes ---------------- */

  clientWrite(c: ClientId) {
    const s = this.sim;
    const home = PEOPLE[c].home;
    s.clients[c].busy = true;
    s.send({ from: c, to: home, dur: HOP, color: SIG.req, shape: 'envelope', label: 'put', onArrive: () => this.atNode(c, home) });
  }

  private atNode(c: ClientId, home: NodeId) {
    const s = this.sim;
    const N = this.nodes[home];
    if (N.role === 'leader') return this.propose(c, home, home);
    const to = N.leader;
    if (!to) {
      s.note(home, 'no leader: write refused', 'err');
      s.reply(c, home, 'err', '✕ no leader', 'no leader');
      return;
    }
    // Followers forward writes to the leader.
    let arrived = false;
    s.link({
      from: home,
      to,
      label: 'fwd',
      onArrive: () => {
        arrived = true;
        if (this.nodes[to].role === 'leader') this.propose(c, home, to);
        else s.reply(c, home, 'err', '✕ no leader', 'no leader');
      },
    });
    s.after(COMMIT_TIMEOUT, () => {
      if (arrived) return;
      s.note(home, 'leader unreachable', 'err');
      s.reply(c, home, 'err', '✕ timed out', 'timeout');
    });
  }

  private propose(c: ClientId, home: NodeId, leader: NodeId) {
    const s = this.sim;
    const L = this.nodes[leader];
    const R = s.replicas[leader];
    const val = s.makeVal(leader, c);
    const term = L.term;
    R.pending = val;
    s.rev++;
    const op = { acks: 1, done: false };
    const finish = (ok: boolean) => {
      const back = (text: string, tone: 'ok' | 'err', label: string) => {
        if (home === leader) s.reply(c, home, tone, text, label);
        else s.link({ from: leader, to: home, color: tone === 'ok' ? SIG.res : SIG.err, label, onArrive: () => s.reply(c, home, tone, text, label) });
      };
      if (ok) back('✓ committed', 'ok', '✓ ok');
      else back('✕ timed out', 'err', 'timeout');
    };
    for (const p of s.peers(leader)) {
      s.link({
        from: leader,
        to: p,
        label: `v${val.ver}`,
        onArrive: () => {
          if (!this.onAppend(p, leader, term, val)) return;
          s.link({
            from: p,
            to: leader,
            color: SIG.res,
            r: 3.4,
            label: 'ack',
            onArrive: () => {
              this.onAck(leader, p, term);
              op.acks++;
              if (op.done || op.acks < 2 || this.nodes[leader].role !== 'leader') return;
              op.done = true;
              R.pending = null;
              s.adopt(leader, val);
              s.acked(val);
              this.log(`v${val.ver} committed on ${REGION[leader].city} + ${REGION[p].city}`, 'ok');
              finish(true);
            },
          });
        },
      });
    }
    s.after(COMMIT_TIMEOUT, () => {
      if (op.done) return;
      op.done = true;
      this.log(`v${val.ver} can't reach a majority: not committed`, 'err');
      finish(false);
    });
  }

  onCut() {
    this.log('the network splits: Virginia is cut off', 'err');
  }

  onHeal() {
    this.log('the network heals', 'info');
  }

  /* ---------------- what the stage shows ---------------- */

  statusFor(x: NodeId): Status | null {
    const s = this.sim;
    const N = this.nodes[x];
    const R = s.replicas[x];
    if (R.pending) return { text: `v${R.pending.ver}? waiting for a majority`, tone: 'stale' };
    if (R.note && s.t < R.note.until) return R.note;
    if (N.role === 'leader') return { text: `★ leader · term ${N.term}`, tone: 'ok' };
    if (N.role === 'candidate') return { text: `candidate · asking for votes`, tone: 'info' };
    if (!N.leader) return { text: 'no leader: refusing writes', tone: 'err' };
    return { text: `follower · term ${N.term}`, tone: 'info' };
  }
}
