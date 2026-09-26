import { SIG } from '@/lib/sim/colors';
import { clamp } from '@/lib/sim/geometry';
import type { CapSim } from './sim';
import css from './cap.module.css';

/* The consistency spectrum, strongest at the top. A simplified line: the real
   map of consistency models is a branching hierarchy. */

export const LEVELS = [
  {
    name: 'Linearizable',
    short: 'acts like a single copy',
    guar: 'Once a write is acknowledged, every read anywhere returns it or something newer. The system behaves as if there were one copy.',
    ok: 'nothing surprising: reads always move forward',
    no: 'reading 1 seat after the booking of the last one was confirmed',
    used: 'etcd, ZooKeeper writes, Spanner, the CP mode you saw',
  },
  {
    name: 'Sequential',
    short: 'one order for everyone, maybe late',
    guar: 'Everyone sees all writes in the same order, and each client’s own operations stay in order. A reader may lag behind real time.',
    ok: 'Bob still sees 1 seat a moment after Alice booked',
    no: 'Bob and Carol seeing two bookings in opposite orders',
    used: 'ZooKeeper reads (call sync() first to catch up)',
  },
  {
    name: 'Causal',
    short: 'causes before effects',
    guar: 'If one write could have influenced another, everyone sees them in that order. Unrelated writes may show up in any order.',
    ok: 'two unrelated posts in a different order for different readers',
    no: 'a reply that shows up before the post it answers',
    used: 'MongoDB causally consistent sessions, COPS',
  },
  {
    name: 'Read-your-writes',
    short: 'you always see your own writes',
    guar: 'After you write, your own reads include it. Other people may still see the old data for a while.',
    ok: 'Bob briefly seeing your old profile photo',
    no: 'your own booking vanishing when you refresh',
    used: 'session guarantees, reading from the leader right after a write',
  },
  {
    name: 'Eventual',
    short: 'agree… eventually',
    guar: 'If writes stop, all replicas converge on the same value. Until then a read may return any recent value, even an older one than last time.',
    ok: 'stale reads, and reads that go back in time',
    no: 'replicas disagreeing forever after writes stop',
    used: 'DNS, Cassandra at ONE, DynamoDB default reads, the AP mode',
  },
];

export function Spectrum({ sim }: { sim: CapSim }) {
  const portrait = sim.orient === 'portrait';
  const sel = clamp(sim.cfg.level, 0, LEVELS.length - 1);
  const railX = portrait ? 30 : Math.round(sim.w * 0.1);
  const top = portrait ? 78 : 124;
  const bottom = portrait ? top + 168 : sim.h - 170;
  const ys = LEVELS.map((_, i) => top + (i * (bottom - top)) / (LEVELS.length - 1));
  const L = LEVELS[sel];
  const detailLeft = Math.max(railX + 290, sim.w * 0.46);
  const detailTop = clamp(ys[sel], 180, sim.h - 250);
  const linkFrom = railX + 20 + 220;
  return (
    <div className={css.spec}>
      <svg width={sim.w} height={sim.h} style={{ position: 'absolute', inset: 0 }} aria-hidden>
        <defs>
          <linearGradient id="cap-rail" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={SIG.warn} stopOpacity={0.9} />
            <stop offset="1" stopColor={SIG.line} stopOpacity={0.35} />
          </linearGradient>
        </defs>
        <line x1={railX} y1={top - 18} x2={railX} y2={bottom + 18} stroke="url(#cap-rail)" strokeWidth={2} strokeLinecap="round" />
        {!portrait && detailLeft - linkFrom > 30 && (
          <path
            d={`M${linkFrom},${ys[sel]} C${linkFrom + 50},${ys[sel]} ${detailLeft - 50},${detailTop} ${detailLeft - 8},${detailTop}`}
            fill="none"
            stroke={SIG.warn}
            strokeOpacity={0.6}
            strokeDasharray="3 4"
          />
        )}
        {ys.map((y, i) => (
          <g key={i}>
            {i === sel && <circle cx={railX} cy={y} r={11} fill="none" stroke={SIG.warn} strokeOpacity={0.45} strokeWidth={1.5} />}
            <circle cx={railX} cy={y} r={i === sel ? 6 : 4.5} fill={i === sel ? SIG.warn : 'var(--ink-1)'} stroke={i === sel ? SIG.warn : SIG.line} strokeWidth={1.4} />
          </g>
        ))}
      </svg>
      <div className={css.specAxis} style={{ left: railX - 6, top: top - (portrait ? 42 : 46) }}>
        {portrait ? '↑ stronger · slower' : '↑ stronger · easier to reason about · slower'}
      </div>
      {!portrait && (
        <div className={css.specAxis} style={{ left: railX - 6, top: bottom + 30 }}>
          ↓ weaker · faster · keeps answering
        </div>
      )}
      {LEVELS.map((l, i) => (
        <div key={l.name} className={css.specStop} data-on={i === sel} style={{ left: railX + 20, top: ys[i], opacity: i === sel ? 1 : 0.8 }}>
          <div className={css.specName}>{l.name}</div>
          <div className={css.specGuar}>{l.short}</div>
        </div>
      ))}
      <div className={`${css.specDetail} ${portrait ? css.specDetailStrip : ''}`} style={portrait ? undefined : { left: detailLeft, top: detailTop }}>
        <div className={css.specTitle}>{L.name}</div>
        <div className={css.specBody}>{L.guar}</div>
        <div className={css.specList}>
          <div className={css.specOk}>✓ allowed: {L.ok}</div>
          <div className={css.specNo}>✕ never: {L.no}</div>
        </div>
        <div className={css.specUsed}>
          e.g. <b>{L.used}</b>
        </div>
      </div>
    </div>
  );
}
