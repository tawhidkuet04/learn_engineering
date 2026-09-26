'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import { SliderCard, Stat } from '@/components/lesson/cards';
import { Icon } from '@/components/lesson/Icon';
import { lessonCss } from '@/components/lesson/Prose';
import { usePoll } from '@/components/lesson/usePoll';
import { pct } from './hash';
import { busiest, spread } from './Overlay';
import { SERVERS, SERVER_IDS } from './ring';
import { TOKEN_STEPS, type RingSim } from './sim';
import css from './ch.module.css';

/* ------------------------------------------------------------------ */
/* Tokens per server                                                   */
/* ------------------------------------------------------------------ */

export function TokensCard({ sim, initial }: { sim: RingSim; initial: number }) {
  const idx0 = Math.max(0, TOKEN_STEPS.indexOf(initial));
  return (
    <SliderCard
      poll={sim}
      prompt="Give every server more seats on the ring:"
      sliders={[
        {
          label: 'Tokens per server',
          min: 0,
          max: TOKEN_STEPS.length - 1,
          step: 1,
          initial: idx0,
          format: (i) => String(TOKEN_STEPS[i]),
          onChange: (i) => sim.setTokens(TOKEN_STEPS[i]),
          ends: ['1', '256'],
        },
      ]}
      stats={() => {
        const b = busiest(sim);
        return (
          <>
            <Stat label="busiest ÷ fair" value={`${b.toFixed(2)}×`} bad={b > 1.4} />
            <Stat label="spread" value={`±${pct(spread(sim), 0)}`} />
            <Stat label="points on ring" value={sim.ring.length} />
          </>
        );
      }}
      done={() =>
        busiest(sim) <= 1.1 ? (
          <>
            <strong>Within 10% of fair.</strong> That&apos;s why Dynamo-style stores run tens to hundreds of tokens per node, and ketama gives every
            memcached server 160 points.
          </>
        ) : null
      }
    />
  );
}

/* ------------------------------------------------------------------ */
/* Cheat sheet                                                         */
/* ------------------------------------------------------------------ */

const ROWS = [
  ['hash mod N', 'servers[hash % N]', 'A resize remaps ~N/(N+1) of keys'],
  ['Hash ring', 'First server clockwise', 'Join or leave moves ~1/N of keys'],
  ['Virtual nodes', 'Many tokens per server', 'Even load, gentle failures, weights'],
  ['Preference list', 'Next R distinct servers', 'Survives R−1 failures'],
  ['Rendezvous', 'Highest hash(key, server)', 'No ring, O(N) per lookup'],
  ['Jump hash', 'Arithmetic, no memory', 'Numbered buckets, grow at the end'],
  ['Maglev', 'Precomputed lookup table', 'O(1) lookups for load balancers'],
];

export function CheatSheet() {
  return (
    <>
      <table className={css.table}>
        <thead>
          <tr>
            <th>Scheme</th>
            <th>Picks</th>
            <th>Remember</th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map(([a, b, c]) => (
            <tr key={a}>
              <td>{a}</td>
              <td>{b}</td>
              <td>{c}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className={css.subhead}>Remember</p>
      <ul className={css.takeaways}>
        <li>
          Never route with <strong>hash mod N</strong> when N can change: one resize remaps almost every key.
        </li>
        <li>
          On the ring a key belongs to the <strong>first server clockwise</strong>. The ring is a sorted array; a lookup is a binary search.
        </li>
        <li>
          Adding or removing a server moves only <strong>its share</strong> of the keys, about 1/N.
        </li>
        <li>
          Give each server <strong>many virtual nodes</strong> for even load, failures that spread out, and weights for bigger machines.
        </li>
        <li>
          Replicate to the <strong>next R distinct servers</strong>. A key survives until all R are down.
        </li>
        <li>
          Every client must build the <strong>same ring</strong>: same members, same hash, same tokens.
        </li>
      </ul>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Playground                                                          */
/* ------------------------------------------------------------------ */

interface Mission {
  id: string;
  title: string;
  text: string;
  hint: string;
  check: (s: RingSim) => boolean;
}

const MISSIONS: Mission[] = [
  {
    id: 'even',
    title: 'Even keel',
    text: 'With at least 5 servers, get the busiest one within 10% of its fair share.',
    hint: 'Hint: more tokens per server.',
    check: (s) => s.presentList().length >= 5 && busiest(s) <= 1.1,
  },
  {
    id: 'gentle',
    title: 'Gentle growth',
    text: 'Add a server that moves under 20% of the keys, where hash mod N would move over 75%.',
    hint: 'Hint: switch a server on above and read the comparison.',
    check: (s) => {
      const c = s.lastChange;
      return !!c && c.kind === 'join' && !!c.scale && c.scale.ring / c.scale.total < 0.2 && c.scale.mod / c.scale.total > 0.75;
    },
  },
  {
    id: 'unsinkable',
    title: 'Unsinkable',
    text: 'Crash two servers and keep every key readable.',
    hint: 'Hint: one copy per key won’t survive that.',
    check: (s) => s.presentList().filter((id) => !s.srv.get(id)?.up).length >= 2 && s.lostCount() === 0,
  },
  {
    id: 'break',
    title: 'Break it',
    text: 'With R = 2, leave at least one key with no live copy.',
    hint: 'Hint: click a key, then crash both servers on its list.',
    check: (s) => s.cfg.replicas === 2 && s.lostCount() > 0,
  },
];

export function Playground({ sim, initialTokens }: { sim: RingSim; initialTokens: number }) {
  usePoll(sim, 250);
  const [tok, setTok] = useState(Math.max(0, TOKEN_STEPS.indexOf(initialTokens)));
  const [done, setDone] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const id = window.setInterval(() => {
      setDone((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const m of MISSIONS) {
          if (!next[m.id] && m.check(sim)) {
            next[m.id] = true;
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 300);
    return () => window.clearInterval(id);
  }, [sim]);

  const present = sim.presentList();
  const fill = (tok / (TOKEN_STEPS.length - 1)) * 100;

  return (
    <div className={css.pg}>
      <div className={css.pgGroup}>
        <div className={css.pgLabel}>
          Servers on the ring <output>{present.length} / 7</output>
        </div>
        <div className={css.srvChips}>
          {SERVER_IDS.map((id) => {
            const s = sim.srv.get(id);
            return (
              <button
                key={id}
                type="button"
                className={css.srvChip}
                aria-pressed={!!s?.present}
                data-down={!!s?.present && !s.up}
                style={{ '--c': SERVERS[id].color } as CSSProperties}
                onClick={() => sim.toggleMember(id)}
                disabled={!!s?.present && present.length <= 1}
              >
                <i />
                {id}
              </button>
            );
          })}
        </div>
        <p className={css.hint}>Toggle membership here. Click a server on the ring to crash or repair it.</p>
      </div>

      <div className={css.pgGroup}>
        <div className={css.pgLabel}>
          Tokens per server <output>{TOKEN_STEPS[tok]}</output>
        </div>
        <input
          className={css.range}
          type="range"
          min={0}
          max={TOKEN_STEPS.length - 1}
          step={1}
          value={tok}
          style={{ '--fill': `${fill}%` } as CSSProperties}
          onChange={(e) => {
            const v = Number(e.target.value);
            setTok(v);
            sim.setTokens(TOKEN_STEPS[v]);
          }}
          aria-label="Tokens per server"
        />
        <div className={css.pgLabel} style={{ marginTop: 10 }}>
          Copies per key (R) <output>{sim.cfg.replicas}</output>
        </div>
        <div className={css.seg} role="group" aria-label="Replication factor">
          {[1, 2, 3].map((r) => (
            <button key={r} type="button" aria-pressed={sim.cfg.replicas === r} onClick={() => sim.setReplicas(r)}>
              R = {r}
            </button>
          ))}
        </div>
        <div className={css.stats}>
          <span>
            busiest ÷ fair <b data-tone={busiest(sim) <= 1.1 ? 'good' : undefined}>{busiest(sim).toFixed(2)}×</b>
          </span>
          <span>
            no live copy <b data-tone={sim.lostCount() ? 'bad' : 'good'}>{sim.lostCount()}</b>
          </span>
        </div>
      </div>

      <div className={css.pgGroup}>
        <div className={css.pgLabel}>
          Challenges <output>{Object.values(done).filter(Boolean).length} / {MISSIONS.length}</output>
        </div>
        <div className={css.missions}>
          {MISSIONS.map((m) => (
            <div key={m.id} className={css.mission} data-done={!!done[m.id]}>
              <div className={css.missionTitle}>
                {done[m.id] && <Icon name="check" size={15} />}
                {m.title}
              </div>
              <div className={css.missionText}>{m.text}</div>
              {!done[m.id] && <div className={css.missionHint}>{m.hint}</div>}
            </div>
          ))}
        </div>
      </div>
      <p className={lessonCss.aside} style={{ marginTop: 0 }}>
        The ring here uses 32-bit murmur3 hashes of real-looking addresses, and every count in the readouts is computed, not faked.
      </p>
    </div>
  );
}
