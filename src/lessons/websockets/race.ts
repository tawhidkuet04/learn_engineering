/**
 * Three ways to get Alice's messages to Bob, run side by side on one clock:
 * short polling, long polling and a WebSocket. Every lane sees the same
 * messages reach the server at the same moments; what differs is when Bob's
 * browser hears about them and how many requests it takes.
 */
export type LaneKind = 'short' | 'long' | 'ws';

/** A diagonal on a lane: something crossing between Bob (bottom) and the server (top). */
export interface RSeg {
  t0: number;
  t1: number;
  /** req: Bob → server · data/empty: server → Bob response · push: frame down an open socket */
  kind: 'req' | 'data' | 'empty' | 'push';
}

export interface RSpan {
  t0: number;
  t1: number | null;
}

export interface RDeliv {
  id: number;
  ts: number;
  tr: number;
}

export interface RMsg {
  id: number;
  /** Alice presses send */
  ts: number;
  /** The message is on the server */
  tServer: number;
}

export interface Lane {
  kind: LaneKind;
  segs: RSeg[];
  holds: RSpan[];
  deliv: RDeliv[];
  requests: number;
  empty: number;
  /** Messages already on their way to Bob */
  got: Set<number>;
  /** Responses in flight, with what they carry */
  flying: { seg: RSeg; ids: number[] }[];
  // short polling
  nextPoll: number;
  outReqs: RSeg[];
  // long polling
  lp: 'send' | 'out' | 'held' | 'back';
  lpReq: RSeg | null;
  lpHold: RSpan | null;
  lpSendAt: number;
}

function lane(kind: LaneKind): Lane {
  return {
    kind,
    segs: [],
    holds: [],
    deliv: [],
    requests: 0,
    empty: 0,
    got: new Set(),
    flying: [],
    nextPoll: 0.4,
    outReqs: [],
    lp: 'send',
    lpReq: null,
    lpHold: null,
    lpSendAt: 0.4,
  };
}

export class Race {
  /** One network trip, seconds */
  d = 0.45;
  interval = 3;
  timeout = 20;
  t = 0;
  msgs: RMsg[] = [];
  lanes: Lane[] = [];
  private seq = 0;

  constructor() {
    this.reset();
  }

  reset() {
    this.t = 0;
    this.msgs = [];
    this.seq = 0;
    this.lanes = [lane('short'), lane('long'), lane('ws')];
  }

  lane(kind: LaneKind) {
    return this.lanes.find((l) => l.kind === kind)!;
  }

  /** Alice sends a message now. */
  send() {
    this.msgs.push({ id: ++this.seq, ts: this.t, tServer: this.t + this.d });
  }

  setPollInterval(v: number) {
    const s = this.lane('short');
    const last = s.nextPoll - this.interval;
    this.interval = v;
    s.nextPoll = Math.max(this.t + 0.05, last + v);
  }

  avg(kind: LaneKind) {
    const d = this.lane(kind).deliv;
    return d.length ? d.reduce((a, x) => a + (x.tr - x.ts), 0) / d.length : null;
  }

  worst(kind: LaneKind) {
    const d = this.lane(kind).deliv;
    return d.length ? Math.max(...d.map((x) => x.tr - x.ts)) : null;
  }

  /** Advance to time t. */
  step(t: number) {
    this.t = t;
    for (const L of this.lanes) {
      if (L.kind === 'short') this.stepShort(L);
      else if (L.kind === 'long') this.stepLong(L);
      else this.stepWs(L);
      // responses that reach Bob
      for (const f of L.flying) {
        if (f.seg.t1 > t) continue;
        for (const id of f.ids) {
          const m = this.msgs.find((x) => x.id === id);
          if (m) L.deliv.push({ id, ts: m.ts, tr: f.seg.t1 });
        }
      }
      L.flying = L.flying.filter((f) => f.seg.t1 > t);
      // forget what scrolled far off the left edge
      const cut = t - 90;
      if (L.segs.length > 400) L.segs = L.segs.filter((s) => s.t1 > cut);
      if (L.holds.length > 100) L.holds = L.holds.filter((s) => s.t1 == null || s.t1 > cut);
    }
  }

  /** Messages on the server at time `at` that this lane hasn't sent yet. */
  private waiting(L: Lane, at: number) {
    return this.msgs.filter((m) => m.tServer <= at + 1e-9 && !L.got.has(m.id));
  }

  private respond(L: Lane, at: number, ids: number[]) {
    const seg: RSeg = { t0: at, t1: at + this.d, kind: ids.length ? 'data' : 'empty' };
    ids.forEach((id) => L.got.add(id));
    if (!ids.length) L.empty++;
    L.segs.push(seg);
    L.flying.push({ seg, ids });
    return seg;
  }

  private stepShort(L: Lane) {
    while (L.nextPoll <= this.t) {
      const req: RSeg = { t0: L.nextPoll, t1: L.nextPoll + this.d, kind: 'req' };
      L.segs.push(req);
      L.outReqs.push(req);
      L.requests++;
      L.nextPoll += this.interval;
    }
    for (const req of L.outReqs) {
      if (req.t1 > this.t) continue;
      this.respond(
        L,
        req.t1,
        this.waiting(L, req.t1).map((m) => m.id),
      );
    }
    L.outReqs = L.outReqs.filter((r) => r.t1 > this.t);
  }

  private stepLong(L: Lane) {
    // A few passes so a quick chain (respond → arrive → ask again) settles in one tick.
    for (let pass = 0; pass < 4; pass++) {
      if (L.lp === 'send' && L.lpSendAt <= this.t) {
        const req: RSeg = { t0: L.lpSendAt, t1: L.lpSendAt + this.d, kind: 'req' };
        L.segs.push(req);
        L.requests++;
        L.lpReq = req;
        L.lp = 'out';
      }
      if (L.lp === 'out' && L.lpReq && L.lpReq.t1 <= this.t) {
        const at = L.lpReq.t1;
        const ready = this.waiting(L, at);
        if (ready.length) {
          const seg = this.respond(
            L,
            at,
            ready.map((m) => m.id),
          );
          L.lp = 'back';
          L.lpSendAt = seg.t1;
        } else {
          L.lpHold = { t0: at, t1: null };
          L.holds.push(L.lpHold);
          L.lp = 'held';
        }
      }
      if (L.lp === 'held' && L.lpHold) {
        const first = this.msgs.filter((m) => !L.got.has(m.id) && m.tServer <= this.t).sort((a, b) => a.tServer - b.tServer)[0];
        const limit = L.lpHold.t0 + this.timeout;
        if (first && first.tServer <= limit) {
          const at = Math.max(L.lpHold.t0, first.tServer);
          L.lpHold.t1 = at;
          const seg = this.respond(
            L,
            at,
            this.waiting(L, at).map((m) => m.id),
          );
          L.lp = 'back';
          L.lpSendAt = seg.t1;
        } else if (this.t >= limit) {
          L.lpHold.t1 = limit;
          const seg = this.respond(L, limit, []);
          L.lp = 'back';
          L.lpSendAt = seg.t1;
        }
      }
      if (L.lp === 'back' && L.lpSendAt <= this.t) L.lp = 'send';
    }
  }

  private stepWs(L: Lane) {
    for (const m of this.waiting(L, this.t)) {
      const seg: RSeg = { t0: m.tServer, t1: m.tServer + this.d, kind: 'push' };
      L.got.add(m.id);
      L.segs.push(seg);
      L.flying.push({ seg, ids: [m.id] });
    }
  }
}
