'use client';

import { SequenceDiagram, type SeqMessage, type SeqNote, type SeqSpan } from '@/components/stage/SequenceDiagram';
import { SIG } from '@/lib/sim/colors';
import { CITIES, ORIGIN_PLACE, POPS, rttMs } from './geo';
import type { CdnSim } from './sim';
import css from './cdn.module.css';

/* The sequence view: two page loads side by side, on the same clock. */

/** 1 unit on the diagram = 100 ms of modeled time; the step clock runs 1 unit per second. */
export const SEQ_MS = 100;

interface Phase {
  label: string;
  color: string;
  t0: number;
  t1: number;
  /** Beside the first lifeline (default) or after the last one */
  side?: 'left' | 'right';
}

interface Lane {
  title: string;
  actors: { id: string; label: string; sub: string; color?: string }[];
  messages: SeqMessage[];
  notes: SeqNote[];
  spans: SeqSpan[];
  /** Labels drawn beside the first lifeline (ms) */
  phases: Phase[];
  done: string;
  doneColor: string;
  /** Total in ms */
  total: number;
}

const U = (ms: number) => ms / SEQ_MS;

type Leg = [string, string, number, number, string, string?];

function toMessages(legs: Leg[], labels = true): SeqMessage[] {
  return legs.map(([from, to, t0, t1, label, color], i) => ({ id: i, from, to, t0: U(t0), t1: U(t1), label: labels ? label : '', color }));
}

function phaseSpans(phases: Phase[]): SeqSpan[] {
  return phases.map((p, i) => ({ id: `p${i}`, actor: 'u', t0: U(p.t0), t1: U(p.t1), color: p.color }));
}

export function sequenceLanes(kind: 'pageload' | 'dynamic', portrait: boolean): [Lane, Lane] {
  const far = rttMs(CITIES.sydney, ORIGIN_PLACE, true) / 2;
  const near = rttMs(CITIES.sydney, POPS.SYD, true) / 2;
  const back = rttMs(POPS.SYD, ORIGIN_PLACE, false) / 2;
  const dns = 21;
  const alice = { id: 'u', label: 'Alice', sub: 'Sydney', color: SIG.pink };
  const origin = { id: 'o', label: 'Origin', sub: portrait ? 'IAD' : 'Virginia', color: SIG.line };

  if (kind === 'pageload') {
    const load = (ow: number, b: string) => {
      let t = dns;
      const legs: Leg[] = [];
      const leg = (from: string, to: string, label: string, color?: string) => {
        legs.push([from, to, t, t + ow, label, color]);
        t += ow;
      };
      leg('u', b, 'SYN');
      leg(b, 'u', 'SYN-ACK', SIG.res);
      leg('u', b, 'ClientHello', SIG.hc);
      leg(b, 'u', portrait ? 'ServerHello' : 'ServerHello … Finished', SIG.hc);
      leg('u', b, 'GET /');
      leg(b, 'u', portrait ? '200 · html' : '200 OK · html', SIG.res);
      leg('u', b, portrait ? 'GET css, js' : 'GET style.css, app.js');
      leg(b, 'u', portrait ? '200' : '200 OK', SIG.res);
      const phases: Phase[] = (
        [
          ['TCP', SIG.line],
          ['TLS', SIG.hc],
          ['HTML', SIG.req],
          ['CSS+JS', SIG.res],
        ] as const
      ).map(([label, color], i) => ({ label, color, t0: dns + i * 2 * ow, t1: dns + (i + 1) * 2 * ow }));
      return { legs, end: t, phases };
    };
    const L = load(far, 'o');
    const R = load(near, 'e');
    return [
      {
        title: portrait ? 'server in Virginia' : 'Alice → a server in Virginia',
        actors: [alice, { ...origin, label: 'Server' }],
        messages: toMessages(L.legs),
        notes: [
          { id: 'dns', actor: 'u', t: U(8), text: 'DNS', color: SIG.dim },
          ...(portrait ? [] : [{ id: 'ttfb', actor: 'o', t: U(dns + 6 * far), text: `first byte ${Math.round(dns + 6 * far)} ms`, color: SIG.text2 }]),
        ],
        spans: phaseSpans(L.phases),
        phases: L.phases,
        done: `page ready in ${Math.round(L.end)} ms`,
        doneColor: SIG.heavy,
        total: L.end,
      },
      {
        title: portrait ? 'server in Sydney' : 'Alice → a server in Sydney',
        actors: [alice, { id: 'e', label: 'Server', sub: 'Sydney', color: SIG.req }],
        messages: toMessages(R.legs, false),
        notes: [{ id: 'dns', actor: 'u', t: U(8), text: 'DNS', color: SIG.dim }],
        spans: [{ id: 'all', actor: 'u', t0: U(dns), t1: U(R.end), color: SIG.res }],
        // The whole exchange is a thin bundle of arrows; name it (there's no room on a phone).
        phases: portrait ? [] : [{ label: 'all 4 round trips', color: SIG.res, t0: dns, t1: R.end, side: 'right' }],
        done: `page ready in ${Math.round(R.end)} ms`,
        doneColor: SIG.res,
        total: R.end,
      },
    ];
  }

  // A page that can't be cached (/account): direct, or through a nearby edge.
  const work = 20;
  let t = dns;
  const direct: Leg[] = [];
  const legD = (from: string, to: string, label: string, color?: string, extra = 0) => {
    direct.push([from, to, t, t + far, label, color]);
    t += far + extra;
  };
  legD('u', 'o', 'SYN');
  legD('o', 'u', 'SYN-ACK', SIG.res);
  legD('u', 'o', 'ClientHello', SIG.hc);
  legD('o', 'u', portrait ? 'ServerHello' : 'ServerHello … Finished', SIG.hc);
  legD('u', 'o', 'GET /account', undefined, work);
  legD('o', 'u', '200 OK', SIG.res);
  const endD = t;
  t = dns;
  const via: Leg[] = [];
  const legV = (from: string, to: string, ow: number, label: string, color?: string, extra = 0) => {
    via.push([from, to, t, t + ow, label, color]);
    t += ow + extra;
  };
  legV('u', 'e', near, '');
  legV('e', 'u', near, '', SIG.res);
  legV('u', 'e', near, '', SIG.hc);
  legV('e', 'u', near, '', SIG.hc);
  legV('u', 'e', near, '');
  legV('e', 'o', back, portrait ? 'GET' : 'GET /account', undefined, work);
  legV('o', 'e', back, portrait ? '200' : '200 OK', SIG.res);
  legV('e', 'u', near, '', SIG.res);
  const endV = t;
  const dPhases: Phase[] = [
    { label: 'TCP', color: SIG.line, t0: dns, t1: dns + 2 * far },
    { label: 'TLS', color: SIG.hc, t0: dns + 2 * far, t1: dns + 4 * far },
    { label: 'GET', color: SIG.req, t0: dns + 4 * far, t1: endD },
  ];
  return [
    {
      title: portrait ? 'direct to Virginia' : 'Alice → origin, direct',
      actors: [alice, origin],
      messages: toMessages(direct),
      notes: [],
      spans: phaseSpans(dPhases),
      phases: dPhases,
      done: `response in ${Math.round(endD)} ms`,
      doneColor: SIG.heavy,
      total: endD,
    },
    {
      title: portrait ? 'via the SYD edge' : 'Alice → SYD edge → origin',
      actors: [alice, { id: 'e', label: 'Edge', sub: 'SYD', color: SIG.req }, origin],
      messages: toMessages(via),
      notes: [],
      spans: [{ id: 'hs', actor: 'u', t0: U(dns), t1: U(dns + 4 * near), color: SIG.hc }],
      phases: portrait ? [] : [{ label: 'TCP+TLS', color: SIG.hc, t0: dns, t1: dns + 4 * near }],
      done: `response in ${Math.round(endV)} ms`,
      doneColor: SIG.res,
      total: endV,
    },
  ];
}

export function SequenceScene({ sim }: { sim: CdnSim }) {
  const portrait = sim.orient === 'portrait';
  const lanes = sequenceLanes(sim.cfg.seq, portrait);
  const pad = portrait ? 6 : 26;
  const top = portrait ? 92 : 104;
  const bottom = portrait ? 64 : 96;
  const gap = portrait ? 8 : 40;
  const W = sim.w - pad * 2;
  const colW = (W - gap) / 2;
  const h = Math.max(200, sim.h - top - bottom);
  const total = Math.max(lanes[0].total, lanes[1].total) / SEQ_MS + 0.9;
  const pps = (h - 42 - 8 - 16 - 40) / total;
  const now = Math.min(sim.stepT, total);
  const nowMs = now * SEQ_MS;
  // Mirrors SequenceDiagram's geometry (header 42, gap 8, first message 16 px down).
  const yOf = (ms: number) => top + 42 + 8 + 16 + U(ms) * pps;
  const label = (x: number) => `${Math.round(x * SEQ_MS)} ms`;
  return (
    <>
      {lanes.map((lane, i) => {
        const x = pad + i * (colW + gap);
        const lifeU = x + colW / (2 * lane.actors.length);
        const lifeLast = x + colW - colW / (2 * lane.actors.length);
        const finished = nowMs >= lane.total;
        return (
          <g key={i}>
            <text className={css.seqTitle} x={x + colW / 2} y={top - 30} textAnchor="middle" style={portrait ? { fontSize: 8, letterSpacing: '0.08em' } : undefined}>
              {lane.title}
            </text>
            <text className={css.tag} x={x + colW / 2} y={top - 13} textAnchor="middle" style={{ fill: finished ? lane.doneColor : SIG.dim, fontSize: portrait ? 9.5 : 11 }}>
              {finished ? lane.done : `loading… ${Math.round(nowMs)} ms`}
            </text>
            <SequenceDiagram
              x={x}
              y={top}
              w={colW}
              h={h}
              actors={lane.actors}
              messages={lane.messages}
              notes={lane.notes}
              spans={lane.spans}
              now={now}
              pxPerSec={pps}
              timeLabel={i === 0 && !portrait ? label : undefined}
            />
            {lane.phases.map((p) =>
              nowMs >= p.t0 ? (
                <text
                  key={p.label}
                  className={`${css.tag} ${css.halo}`}
                  x={p.side === 'right' ? lifeLast + 9 : lifeU - 9}
                  y={yOf((p.t0 + Math.min(p.t1, Math.max(p.t0, nowMs))) / 2) + 3}
                  textAnchor={p.side === 'right' ? 'start' : 'end'}
                  style={{ fill: p.color, fontSize: portrait ? 8.5 : 10 }}
                >
                  {p.label}
                </text>
              ) : null,
            )}
          </g>
        );
      })}
      {!portrait && <line className={css.seqDivider} x1={sim.w / 2} x2={sim.w / 2} y1={top - 44} y2={top + h} />}
    </>
  );
}
