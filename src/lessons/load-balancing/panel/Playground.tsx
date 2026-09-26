'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { CodeBlock } from '@/components/lesson/CodeBlock';
import { Icon } from '@/components/lesson/Icon';
import { ALGO_NAMES } from '../engine/algorithms';
import type { Algo, ServerSpec, Size } from '../engine/types';
import type { World } from '../engine/world';
import { nginxConfig } from './nginxConfig';
import { usePoll } from './usePoll';
import css from './panel.module.css';

const ALGOS: Algo[] = ['rr', 'least', 'weighted', 'iphash', 'random', 'p2c'];

interface Mission {
  id: string;
  title: string;
  text: string;
  hint: string;
  hold: number;
  check: (w: World) => boolean;
}

const MISSIONS: Mission[] = [
  {
    id: 'rush',
    title: 'Rush hour',
    text: 'Serve at least 10 req/s with under 1% errors for 15 seconds.',
    hint: 'Hint: add servers, or make them bigger.',
    hold: 15,
    check: (w) => w.metrics.throughput(w.t) >= 9.5 && w.metrics.errRate(w.t) < 0.01,
  },
  {
    id: 'heavy',
    title: 'Heavy day',
    text: 'With 30%+ heavy requests at 5+ req/s, keep p95 latency under 400 ms for 15 seconds.',
    hint: 'Hint: which algorithm notices when a server is busy?',
    hold: 15,
    check: (w) => {
      const p95 = w.metrics.p95(w.t);
      return w.cfg.heavyRatio >= 0.3 && w.cfg.rps >= 5 && p95 != null && p95 < 400;
    },
  },
  {
    id: 'chaos',
    title: 'Chaos monkey',
    text: 'With health checks on, keep 2 servers crashed while errors stay under 5% for 10 seconds.',
    hint: 'Hint: click servers on the stage to crash them.',
    hold: 10,
    check: (w) => {
      const down = [...w.servers.values()].filter((s) => !s.removing && !s.up).length;
      return w.cfg.healthChecks && down >= 2 && w.metrics.errRate(w.t) < 0.05 && w.metrics.throughput(w.t) > 1;
    },
  },
];

export function Playground({ world, initial }: { world: World; initial: { rps: number; heavyRatio: number } }) {
  usePoll(world, 250);
  const [rps, setRps] = useState(initial.rps);
  const [heavy, setHeavy] = useState(initial.heavyRatio);
  const [held, setHeld] = useState<Record<string, number>>({});
  const lastT = useRef<number | null>(null);

  // Track how long each mission's condition has held, in simulated seconds.
  useEffect(() => {
    const id = window.setInterval(() => {
      const t = world.t;
      const dt = lastT.current == null ? 0 : Math.max(0, t - lastT.current);
      lastT.current = t;
      setHeld((prev) => {
        const next = { ...prev };
        for (const m of MISSIONS) {
          if ((prev[m.id] ?? 0) >= m.hold) continue;
          next[m.id] = m.check(world) ? (prev[m.id] ?? 0) + dt : 0;
        }
        return next;
      });
    }, 250);
    return () => window.clearInterval(id);
  }, [world]);

  const cfg = world.cfg;
  const servers = [...world.servers.values()].filter((s) => !s.removing);
  const specs: ServerSpec[] = servers.map((s) => ({ id: s.id, size: s.size }));

  const setServers = (next: ServerSpec[]) => world.update({ servers: next });
  const resize = (id: string, size: Size) => setServers(specs.map((s) => (s.id === id ? { ...s, size } : s)));
  const add = () => {
    const used = new Set(specs.map((s) => s.id));
    let n = 1;
    while (used.has(`s${n}`)) n++;
    setServers([...specs, { id: `s${n}` }]);
  };
  const remove = () => setServers(specs.slice(0, -1));

  const config = nginxConfig(
    cfg.algorithm,
    servers.map((s) => ({ label: s.label, ip: s.ip, size: s.size, weight: s.weight, up: s.up })),
    cfg.healthChecks,
  );

  return (
    <div className={css.pg}>
      <div className={css.pgGroup}>
        <div className={css.pgLabel}>
          Traffic <output>{rps.toFixed(1)} req/s</output>
        </div>
        <input
          className={css.range}
          type="range"
          min={0.5}
          max={14}
          step={0.5}
          value={rps}
          style={{ '--fill': `${((rps - 0.5) / 13.5) * 100}%` } as CSSProperties}
          onChange={(e) => {
            const v = Number(e.target.value);
            setRps(v);
            world.setRps(v);
          }}
          aria-label="Traffic in requests per second"
        />
        <div className={css.pgLabel} style={{ marginTop: 10 }}>
          Heavy requests <output>{Math.round(heavy * 100)}%</output>
        </div>
        <input
          className={css.range}
          type="range"
          min={0}
          max={0.5}
          step={0.05}
          value={heavy}
          style={{ '--fill': `${(heavy / 0.5) * 100}%` } as CSSProperties}
          onChange={(e) => {
            const v = Number(e.target.value);
            setHeavy(v);
            world.update({ heavyRatio: v });
          }}
          aria-label="Share of heavy requests"
        />
      </div>

      <div className={css.pgGroup}>
        <div className={css.pgLabel}>Algorithm</div>
        <div className={css.algos}>
          {ALGOS.map((a) => (
            <button key={a} type="button" className={css.algo} aria-pressed={cfg.algorithm === a} onClick={() => world.update({ algorithm: a })}>
              {ALGO_NAMES[a]}
            </button>
          ))}
        </div>
      </div>

      <div className={css.pgGroup}>
        <div className={css.pgLabel}>
          Servers <output>{servers.length} / 6</output>
        </div>
        {servers.map((s) => (
          <div key={s.id} className={css.srvRow}>
            <button type="button" className={css.srvName} onClick={() => world.toggleServer(s.id)} title={s.up ? 'Crash it' : 'Revive it'}>
              <span className={css.led} data-down={!s.up} />
              {s.label}
            </button>
            <div className={css.sizes} role="group" aria-label={`${s.label} size`}>
              {(['s', 'm', 'l'] as Size[]).map((z) => (
                <button key={z} type="button" aria-pressed={s.size === z} onClick={() => resize(s.id, z)}>
                  {z.toUpperCase()}
                </button>
              ))}
            </div>
            <span className={css.srvMeta}>
              {s.workers} slots{cfg.algorithm === 'weighted' ? ` · w${s.weight}` : ''}
            </span>
          </div>
        ))}
        <div className={css.row}>
          <button type="button" className={css.iconBtn} onClick={remove} disabled={servers.length <= 1} aria-label="Remove a server">
            <Icon name="minus" size={14} />
          </button>
          <button type="button" className={css.iconBtn} onClick={add} disabled={servers.length >= 6} aria-label="Add a server">
            <Icon name="plus" size={14} />
          </button>
        </div>
      </div>

      <div className={css.pgGroup}>
        <label className={css.switch}>
          <span>
            Health checks
            <small>Pull crashed servers out of rotation automatically</small>
          </span>
          <input type="checkbox" checked={cfg.healthChecks} onChange={(e) => world.update({ healthChecks: e.target.checked })} />
        </label>
      </div>

      <div className={css.pgGroup}>
        <div className={css.pgLabel}>Challenges</div>
        <div className={css.missions}>
          {MISSIONS.map((m) => {
            const h = held[m.id] ?? 0;
            const done = h >= m.hold;
            return (
              <div key={m.id} className={css.mission} data-done={done}>
                <div className={css.missionTitle}>
                  {done && <Icon name="check" size={15} />}
                  {m.title}
                </div>
                <div className={css.missionText}>{m.text}</div>
                {!done && <div className={css.missionHint}>{m.hint}</div>}
                <div className={css.meter}>
                  <i style={{ width: `${Math.min(100, (h / m.hold) * 100)}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <CodeBlock spec={{ title: 'nginx.conf · live', lang: 'nginx', code: config }} />
    </div>
  );
}
