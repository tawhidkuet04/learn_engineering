'use client';

import { SIG } from '@/lib/sim/colors';
import { SequenceDiagram, type SeqMessage, type SeqNote } from '@/components/stage/SequenceDiagram';
import { Label } from '@/components/stage/svg';
import type { HttpSim, Rect } from './sim';

type Kind = 'tcp' | '1rtt' | '0rtt';

/** Handshake messages in units of one-way trips (o). */
function script(kind: Kind, o: number, P: boolean): { msgs: SeqMessage[]; notes: SeqNote[]; end: number } {
  const hs = SIG.heavy;
  if (kind === 'tcp') {
    return {
      msgs: [
        { id: 1, from: 'b', to: 's', t0: 0, t1: o, label: 'SYN', color: hs },
        { id: 2, from: 's', to: 'b', t0: o, t1: 2 * o, label: 'SYN-ACK', color: hs },
        { id: 3, from: 'b', to: 's', t0: 2 * o, t1: 3 * o, label: P ? 'ACK + Hello' : 'ACK + ClientHello', color: hs },
        { id: 4, from: 's', to: 'b', t0: 3 * o, t1: 4 * o, label: P ? 'Hello … Fin' : 'ServerHello … Finished', color: hs },
        { id: 5, from: 'b', to: 's', t0: 4 * o, t1: 5 * o, label: P ? 'Fin + GET /' : 'Finished + GET /', color: SIG.req, hot: true },
        { id: 6, from: 's', to: 'b', t0: 5 * o, t1: 6 * o, label: '200 OK', color: SIG.res },
      ],
      notes: [
        { id: 'n1', actor: 'b', t: 2 * o, text: P ? '1 RTT' : '1 RTT · TCP', color: hs },
        { id: 'n2', actor: 'b', t: 4 * o, text: P ? '2 RTT' : '2 RTT · TLS', color: hs },
      ],
      end: 6 * o,
    };
  }
  if (kind === '1rtt') {
    return {
      msgs: [
        { id: 1, from: 'b', to: 's', t0: 0, t1: o, label: P ? 'Initial' : 'Initial: ClientHello', color: hs },
        { id: 2, from: 's', to: 'b', t0: o, t1: 2 * o, label: P ? 'Initial + HS' : 'Initial + Handshake', color: hs },
        { id: 3, from: 'b', to: 's', t0: 2 * o, t1: 3 * o, label: P ? 'Fin + GET /' : 'Finished + GET /', color: SIG.req, hot: true },
        { id: 4, from: 's', to: 'b', t0: 3 * o, t1: 4 * o, label: '200 OK', color: SIG.res },
      ],
      notes: [{ id: 'n1', actor: 'b', t: 2 * o, text: P ? '1 RTT' : '1 RTT · QUIC+TLS', color: hs }],
      end: 4 * o,
    };
  }
  return {
    msgs: [
      { id: 1, from: 'b', to: 's', t0: 0, t1: o, label: P ? 'Initial + GET /' : 'Initial + 0-RTT: GET /', color: SIG.req, hot: true },
      { id: 2, from: 's', to: 'b', t0: o, t1: 2 * o, label: P ? 'HS + 200 OK' : 'Handshake + 200 OK', color: SIG.res },
    ],
    notes: [{ id: 'n1', actor: 'b', t: 0.1, text: P ? '0 RTT' : '0 RTT · resumed', color: SIG.req }],
    end: 2 * o,
  };
}

const TITLES: Record<Kind, [string, string]> = {
  tcp: ['HTTP/2 · TCP + TLS 1.3', 'two handshakes, one after the other'],
  '1rtt': ['HTTP/3 · QUIC', 'transport + TLS 1.3 in one handshake'],
  '0rtt': ['HTTP/3 · QUIC 0-RTT', 'a returning visitor'],
};

function Diagram({ sim, rect, kind, start }: { sim: HttpSim; rect: Rect; kind: Kind; start: number | null }) {
  const P = sim.orient === 'portrait';
  const o = sim.seqOwd;
  const { msgs, notes, end } = script(kind, o, P);
  const px = sim.seqPx(rect);
  const now = start == null ? -0.01 : Math.min(sim.stepT - start, end);
  const rttMs = 100;
  const [title, sub] = TITLES[kind];
  return (
    <g>
      <Label x={rect.x + rect.w / 2} y={rect.y - 24} text={title} anchor="middle" color="var(--text-1)" size={P ? 9.5 : 10.5} />
      <text
        x={rect.x + rect.w / 2}
        y={rect.y - 10}
        textAnchor="middle"
        style={{ fontFamily: 'var(--font-sans)', fontSize: P ? 11 : 12, fill: 'var(--text-3)' }}
      >
        {sub}
      </text>
      <SequenceDiagram
        x={rect.x}
        y={rect.y}
        w={rect.w}
        h={rect.h}
        now={now}
        pxPerSec={px}
        actors={[
          { id: 'b', label: 'Browser', sub: '192.0.2.10', color: SIG.pink },
          { id: 's', label: 'shop.example', sub: '203.0.113.10', color: SIG.hc },
        ]}
        messages={msgs}
        notes={notes}
        timeLabel={start == null ? undefined : (t) => `${Math.round((Math.max(0, t) / (2 * o)) * rttMs)} ms`}
      />
    </g>
  );
}

export function SeqScene({ sim }: { sim: HttpSim }) {
  const P = sim.orient === 'portrait';
  const s = sim.seq;
  const G = sim.G;
  if (P) {
    const showB = s.b != null || sim.seqFocus === 'b';
    return showB ? <Diagram sim={sim} rect={G.seqA} kind={s.bKind} start={s.b} /> : <Diagram sim={sim} rect={G.seqA} kind="tcp" start={s.a} />;
  }
  return (
    <g>
      <Diagram sim={sim} rect={G.seqA} kind="tcp" start={s.a} />
      {G.seqB && <Diagram sim={sim} rect={G.seqB} kind={s.bKind} start={s.b} />}
    </g>
  );
}
