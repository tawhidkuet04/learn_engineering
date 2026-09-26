import { SequenceDiagram, type SeqMessage, type SeqNote } from '@/components/stage/SequenceDiagram';
import { SIG } from '@/lib/sim/colors';
import type { RateSim } from '../sim';
import css from './rl.module.css';

/** The diagram never scrolls: it is tall enough to show the whole exchange. */
const SHOWN = 4.2;

export function raceGeo(sim: RateSim) {
  const L = sim.orient === 'landscape';
  const pps = L ? 70 : 56;
  const x = L ? 90 : 12;
  const h = 106 + (SHOWN + 0.05) * pps;
  const block = L ? 74 : 60;
  const y = L ? Math.max(86, 86 + (sim.h - 196 - h - block) / 2) : 72;
  const w = sim.w - x * 2;
  const yOf = (t: number) => y + 42 + 8 + 16 + t * pps;
  const colX = (i: number) => x + (w / 3) * (i + 0.5);
  return { L, pps, x, y, w, h, yOf, colX };
}

interface Badge {
  actor: 0 | 2;
  t: number;
  text: string;
  short: string;
  ok: boolean;
}

function script(getset: boolean) {
  const key = 'rl:203.0.113.66';
  const messages: SeqMessage[] = getset
    ? [
        { id: 1, from: 'gw1', to: 'redis', t0: 0.5, t1: 1.1, label: 'GET' },
        { id: 2, from: 'gw2', to: 'redis', t0: 0.75, t1: 1.35, label: 'GET' },
        { id: 3, from: 'redis', to: 'gw1', t0: 1.2, t1: 1.8, label: '4', color: SIG.res },
        { id: 4, from: 'redis', to: 'gw2', t0: 1.45, t1: 2.05, label: '4', color: SIG.res },
        { id: 5, from: 'gw1', to: 'redis', t0: 2.7, t1: 3.3, label: 'SET 5' },
        { id: 6, from: 'gw2', to: 'redis', t0: 2.95, t1: 3.55, label: 'SET 5', color: SIG.err, hot: true },
      ]
    : [
        { id: 1, from: 'gw1', to: 'redis', t0: 0.5, t1: 1.1, label: 'INCR' },
        { id: 2, from: 'gw2', to: 'redis', t0: 0.75, t1: 1.35, label: 'INCR' },
        { id: 3, from: 'redis', to: 'gw1', t0: 1.2, t1: 1.8, label: '5', color: SIG.res },
        { id: 4, from: 'redis', to: 'gw2', t0: 1.45, t1: 2.05, label: '6', color: SIG.err, hot: true },
      ];
  const notes: SeqNote[] = getset ? [{ id: 'n1', actor: 'redis', t: 3.85, text: 'count = 5', color: SIG.err }] : [];
  const badges: Badge[] = getset
    ? [
        { actor: 0, t: 1.95, text: '4 < 5 → allow', short: '4<5 allow', ok: true },
        { actor: 2, t: 2.2, text: '4 < 5 → allow', short: '4<5 allow', ok: true },
      ]
    : [
        { actor: 0, t: 1.95, text: '5 ≤ 5 → allow', short: '5≤5 allow', ok: true },
        { actor: 2, t: 2.2, text: '6 > 5 → 429', short: '6>5 429', ok: false },
      ];
  return { key, messages, notes, badges };
}

export function RaceScene({ sim }: { sim: RateSim }) {
  const g = raceGeo(sim);
  const getset = sim.cfg.race === 'getset';
  const now = Math.min(sim.raceT, SHOWN);
  const { key, messages, notes, badges } = script(getset);
  const value = getset ? (now >= 3.3 ? 5 : 4) : now >= 1.35 ? 6 : now >= 1.1 ? 5 : 4;
  const done = now >= (getset ? 3.9 : 2.3);
  return (
    <g>
      <SequenceDiagram
        x={g.x}
        y={g.y}
        w={g.w}
        h={g.h}
        now={now}
        pxPerSec={g.pps}
        actors={[
          { id: 'gw1', label: 'gw-1', sub: g.L ? 'gateway · Scraper req A' : 'req A', color: SIG.heavy },
          { id: 'redis', label: 'redis', sub: g.L ? key : 'shared counter', color: SIG.hc },
          { id: 'gw2', label: 'gw-2', sub: g.L ? 'gateway · Scraper req B' : 'req B', color: SIG.heavy },
        ]}
        messages={messages}
        notes={notes}
      />
      {badges.map((b, i) => {
        if (now < b.t) return null;
        const cx = g.colX(b.actor);
        const text = g.L ? b.text : b.short;
        const tw = text.length * (g.L ? 6.4 : 5.9) + 16;
        const x = g.L ? (b.actor === 0 ? cx - tw - 12 : cx + 12) : cx - tw / 2;
        const y = g.yOf(b.t) + (g.L ? -9 : 6);
        const color = b.ok ? SIG.res : SIG.err;
        return (
          <g key={i}>
            <rect x={x} y={y} width={tw} height={19} rx={9.5} fill="rgba(7,11,20,0.94)" stroke={color} strokeOpacity={0.8} />
            <text x={x + tw / 2} y={y + 13} textAnchor="middle" style={{ fontFamily: 'var(--font-mono)', fontSize: g.L ? 10.5 : 9.5, fill: color }}>
              {text}
            </text>
          </g>
        );
      })}
      <g transform={`translate(${g.colX(1)},${g.y + g.h + (g.L ? 26 : 18)})`}>
        <text className={css.caps} textAnchor="middle" y={0}>
          stored value
        </text>
        <text className={css.big} textAnchor="middle" y={g.L ? 26 : 22} style={{ fill: done && getset ? SIG.err : 'var(--text-1)', fontSize: g.L ? 21 : 17 }}>
          {value}
        </text>
        {done && (
          <text className={css.mono} textAnchor="middle" y={g.L ? 44 : 38} style={{ fill: getset ? SIG.err : SIG.res, fontSize: g.L ? 10.5 : 9.5 }}>
            {getset ? '6 requests allowed, counter says 5' : 'exactly 5 allowed, the 6th refused'}
          </text>
        )}
      </g>
    </g>
  );
}
