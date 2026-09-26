import { SIG } from '@/lib/sim/colors';
import { HOP, NODES, type ClientId, type NodeId } from './model';
import type { CapSim, Status, Tone } from './sim';

/*
 * The causal-consistency demo: Alice posts, Bob replies after reading it,
 * Carol reads in Singapore. Alice's post crosses a congested link, so Bob's
 * reply can overtake it. Eventual consistency shows the reply anyway; causal
 * consistency holds it back until the post it depends on has arrived.
 */

export interface Post {
  id: 'A' | 'B';
  by: string;
  text: string;
  dep?: 'A';
}

export const POST_A: Post = { id: 'A', by: 'Alice', text: 'Got seat 14C!' };
export const POST_B: Post = { id: 'B', by: 'Bob', text: 'Congrats!', dep: 'A' };

export class FeedCtl {
  items = {} as Record<NodeId, Post[]>;
  held = {} as Record<NodeId, Post[]>;
  flash = {} as Record<NodeId, number>;
  said: Partial<Record<ClientId, { text: string; tone: Tone }>> = {};
  anomalies = 0;
  cleanViews = 0;
  private gen = 0;
  private pollIn = 1.2;
  private complete = false;
  private flagged = false;

  constructor(private sim: CapSim) {
    this.clear();
  }

  private clear() {
    for (const n of NODES) {
      this.items[n] = [];
      this.held[n] = [];
      this.flash[n] = -10;
    }
    this.said = {};
    this.complete = false;
    this.flagged = false;
  }

  reset() {
    this.gen++;
    this.clear();
    this.anomalies = 0;
    this.cleanViews = 0;
  }

  start() {
    const g = ++this.gen;
    this.clear();
    this.pollIn = 1.4;
    this.sim.after(0.7, () => this.postA(g));
    this.sim.rev++;
  }

  /** The eventual / causal switch changed: replay the story. */
  restart() {
    const s = this.sim;
    s.flights = s.flights.filter((f) => f.tag !== 'feed');
    for (const c of Object.values(s.clients)) c.busy = false;
    if (s.cfg.view === 'feed') this.start();
  }

  private postA(g: number) {
    const s = this.sim;
    s.send({
      from: 'alice',
      to: 'va',
      dur: HOP,
      color: SIG.req,
      shape: 'envelope',
      label: 'post',
      tag: 'feed',
      onArrive: () => {
        if (g !== this.gen) return;
        this.receive('va', POST_A);
        this.said.alice = { text: 'posted A', tone: 'ok' };
        s.link({
          from: 'va',
          to: 'fra',
          label: 'A',
          tag: 'feed',
          onArrive: () => {
            if (g !== this.gen) return;
            this.receive('fra', POST_A);
            this.bobReads(g);
          },
        });
        s.link({ from: 'va', to: 'sg', dur: 3.7, label: 'A · slow link', tag: 'feed', onArrive: () => g === this.gen && this.receive('sg', POST_A) });
      },
    });
  }

  private bobReads(g: number) {
    const s = this.sim;
    s.send({
      from: 'fra',
      to: 'bob',
      dur: HOP,
      color: SIG.res,
      shape: 'envelope',
      label: 'A',
      tag: 'feed',
      onArrive: () => {
        if (g !== this.gen) return;
        this.said.bob = { text: 'sees A, replies B', tone: 'ok' };
        s.rev++;
        s.after(0.45, () => {
          if (g !== this.gen) return;
          s.send({
            from: 'bob',
            to: 'fra',
            dur: HOP,
            color: SIG.req,
            shape: 'envelope',
            label: 'reply',
            tag: 'feed',
            onArrive: () => {
              if (g !== this.gen) return;
              this.receive('fra', POST_B);
              s.link({ from: 'fra', to: 'sg', label: 'B', tag: 'feed', onArrive: () => g === this.gen && this.receive('sg', POST_B) });
              s.link({ from: 'fra', to: 'va', label: 'B', tag: 'feed', onArrive: () => g === this.gen && this.receive('va', POST_B) });
            },
          });
        });
      },
    });
  }

  private has(n: NodeId, id: string) {
    return this.items[n].some((p) => p.id === id);
  }

  private receive(n: NodeId, p: Post) {
    const s = this.sim;
    if (this.has(n, p.id) || this.held[n].some((h) => h.id === p.id)) return;
    if (s.cfg.causal && p.dep && !this.has(n, p.dep)) {
      this.held[n].push(p);
      s.say(n, `holds ${p.id}: needs ${p.dep} first`, SIG.warn, 2.4);
      s.rev++;
      return;
    }
    this.items[n].push(p);
    this.flash[n] = s.vt;
    const ready = this.held[n].filter((h) => h.dep && this.has(n, h.dep));
    if (ready.length) {
      this.held[n] = this.held[n].filter((h) => !ready.includes(h));
      for (const r of ready) this.items[n].push(r);
      s.say(n, `${ready.map((r) => r.id).join(', ')} released in order`, SIG.res, 2.2);
    }
    s.rev++;
  }

  step(dt: number) {
    const s = this.sim;
    this.pollIn -= dt;
    if (this.pollIn > 0 || s.clients.carol.busy || this.complete) return;
    this.pollIn = 1.15;
    const g = this.gen;
    s.clients.carol.busy = true;
    s.send({
      from: 'carol',
      to: 'sg',
      dur: HOP,
      color: SIG.req,
      shape: 'envelope',
      label: 'read',
      tag: 'feed',
      onArrive: () => {
        if (g !== this.gen) return;
        const seen = this.items.sg.map((p) => p.id);
        const orphan = seen.includes('B') && !seen.includes('A');
        const both = seen.includes('A') && seen.includes('B');
        const tone: Tone = orphan ? 'err' : seen.length ? 'ok' : 'info';
        s.send({
          from: 'sg',
          to: 'carol',
          dur: HOP,
          color: orphan ? SIG.err : SIG.res,
          shape: 'envelope',
          label: seen.length ? seen.join(' ') : 'empty',
          tag: 'feed',
          onArrive: () => {
            if (g !== this.gen) return;
            s.clients.carol.busy = false;
            s.clients.carol.pulseVt = s.vt;
            s.clients.carol.pulseTone = tone === 'err' ? 'err' : 'ok';
            this.said.carol = orphan
              ? { text: '⚠ a reply to… what?', tone: 'err' }
              : both
                ? { text: '✓ post, then reply', tone: 'ok' }
                : seen.length
                  ? { text: 'sees A', tone: 'ok' }
                  : { text: 'nothing new yet', tone: 'info' };
            if (orphan && !this.flagged) {
              this.flagged = true;
              this.anomalies++;
            }
            if (both) {
              if (!this.flagged) this.cleanViews++;
              this.complete = true;
              s.after(3, () => g === this.gen && this.start());
            }
            s.rev++;
          },
        });
      },
    });
  }

  statusFor(n: NodeId): Status | null {
    if (this.held[n].length) return { text: `holding ${this.held[n].map((h) => h.id).join(', ')}: waits for A`, tone: 'stale' };
    if (n === 'sg' && this.has('sg', 'B') && !this.has('sg', 'A')) return { text: 'shows B without A', tone: 'err' };
    return null;
  }
}
