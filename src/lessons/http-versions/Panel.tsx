'use client';

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { CodeBlock } from '@/components/lesson/CodeBlock';
import { Icon } from '@/components/lesson/Icon';
import { usePoll } from '@/components/lesson/usePoll';
import cards from '@/components/lesson/cards.module.css';
import { PROTO_NAME, type Proto } from './engine';
import { RACE, type HttpSim, type StageCfg } from './sim';

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

/** The pending question's own wording, or the step's prompt. */
export function LiveAsk({ sim, fallback }: { sim: HttpSim; fallback: ReactNode }) {
  usePoll(sim, 120, true);
  return <>{sim.game?.pending?.ask ?? fallback}</>;
}

/** Last load time for each variant the learner has tried in this step. */
export function LiveResults({ sim, items }: { sim: HttpSim; items: { label: string; key: string }[] }) {
  usePoll(sim, 250, true);
  const got = items.filter((it) => sim.results[it.key] != null);
  if (!got.length) return <span style={{ color: 'var(--text-3)' }}>Load times appear here as each version finishes.</span>;
  return (
    <span style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
      {got.map((it) => (
        <span key={it.key}>
          {it.label} <b style={{ color: 'var(--text-1)', fontWeight: 500 }}>{fmt(sim.results[it.key])} ms</b>
        </span>
      ))}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Cheat sheet                                                         */
/* ------------------------------------------------------------------ */

const ROWS: [string, string, string][] = [
  ['HTTP/1.0', 'A new TCP connection for every file', 'Handshakes on every single request'],
  ['HTTP/1.1', 'Keep-alive; ~6 connections, one request at a time on each', 'The response ahead of you on the same connection'],
  ['HTTP/2', 'One TCP connection, many multiplexed streams, HPACK', 'Any lost packet stalls every stream'],
  ['HTTP/3', 'One QUIC connection over UDP, independent streams, QPACK', 'A loss stalls only its own stream'],
];

export function CheatSheet() {
  return (
    <>
      <table className={cards.table}>
        <thead>
          <tr>
            <th>Version</th>
            <th>How it fetches</th>
            <th>What still blocks</th>
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
      <p className={cards.subhead}>Round trips before the first request</p>
      <ul className={cards.takeaways}>
        <li>
          <strong>TCP + TLS 1.3:</strong> 2 (3 with TLS 1.2). <strong>QUIC:</strong> 1, or <strong>0</strong> when resuming a recent session.
        </li>
      </ul>
      <p className={cards.subhead}>Remember</p>
      <ul className={cards.takeaways}>
        <li>
          Small files are bound by <strong>latency</strong>, not bandwidth. Count the round trips.
        </li>
        <li>
          HTTP/1.1&apos;s one-request-per-connection rule causes <strong>head-of-line blocking</strong>; six connections and bundling were workarounds.
        </li>
        <li>
          HTTP/2 <strong>multiplexes</strong> everything over one connection, but TCP&apos;s in-order delivery turns one loss into a stall for all.
        </li>
        <li>
          HTTP/3 runs on <strong>QUIC</strong>: independent streams, a combined handshake, and <strong>connection IDs</strong> that survive a network switch.
        </li>
        <li>
          Check with the DevTools <strong>Protocol</strong> column or <code>curl --http3</code>. Advertise HTTP/3 with <code>Alt-Svc</code>.
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
}

const MISSIONS: Mission[] = [
  {
    id: 'returning',
    title: 'Welcome back',
    text: 'With a round trip of 200 ms or more, load the 12-file page in under 750 ms.',
    hint: 'Hint: a returning visitor can skip a handshake entirely.',
  },
  {
    id: 'commute',
    title: 'Commuter',
    text: 'Switch networks during a load (round trip ≥ 100 ms) and still finish in under 750 ms.',
    hint: 'Hint: which transport survives a new IP address?',
  },
  {
    id: 'lossy',
    title: 'Bad signal',
    text: 'With 2% packet loss or more and a round trip of 100 ms or more, load the page in under 650 ms.',
    hint: 'Hint: which version keeps a loss inside one stream? Loss is random, so reload a few times.',
  },
];

const PROTOS: Proto[] = ['h1.0', 'h1.1', 'h2', 'h3'];

function Range({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <>
      <div className={cards.pgLabel} style={{ marginTop: 12 }}>
        {label} <output>{format(value)}</output>
      </div>
      <input
        className={cards.range}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ '--fill': `${((value - min) / (max - min)) * 100}%` } as CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
      />
    </>
  );
}

function nginxFor(proto: Proto, zeroRtt: boolean) {
  const lines = ['server {'];
  if (proto === 'h3') lines.push('!    listen 443 quic reuseport;');
  lines.push(`${proto === 'h1.0' || proto === 'h1.1' ? '!' : ''}    listen 443 ssl;`);
  if (proto === 'h2' || proto === 'h3') lines.push('!    http2 on;');
  lines.push('    server_name shop.example;');
  if (proto === 'h3') {
    lines.push(`!    add_header Alt-Svc 'h3=":443"; ma=86400';`);
    if (zeroRtt) lines.push('!    ssl_early_data on;    # allow 0-RTT');
  }
  if (proto === 'h1.0') lines.push('    keepalive_timeout 0;  # close after each response');
  lines.push('}');
  return lines.join('\n');
}

export function Playground({ sim, initial }: { sim: HttpSim; initial: StageCfg }) {
  usePoll(sim, 250);
  const [rtt, setRtt] = useState(initial.rttMs);
  const [loss, setLoss] = useState(initial.pktLoss);
  const [count, setCount] = useState(initial.count);
  const [done, setDone] = useState<Record<string, boolean>>({});
  const seen = useRef(-1);
  const cfg = sim.cfg;
  const race = cfg.view === 'race';
  const h1 = cfg.proto === 'h1.0' || cfg.proto === 'h1.1';

  // Score a mission when a page load finishes.
  useEffect(() => {
    const id = window.setInterval(() => {
      if (sim.loads === seen.current) return;
      seen.current = sim.loads;
      const L = sim.load;
      if (sim.cfg.view !== 'lanes' || !L.done) return;
      const ms = L.loadMs;
      const c = sim.cfg;
      const hit: Record<string, boolean> = {};
      const full = c.count >= 12;
      if (full && c.rttMs >= 200 && ms < 750) hit.returning = true;
      if (full && L.migrations > 0 && c.rttMs >= 100 && ms < 750) hit.commute = true;
      if (full && c.pktLoss >= 0.02 && c.rttMs >= 100 && ms < 650) hit.lossy = true;
      if (Object.keys(hit).length) setDone((d) => ({ ...d, ...hit }));
    }, 250);
    return () => window.clearInterval(id);
  }, [sim]);

  return (
    <div className={cards.pg}>
      <div className={cards.pgGroup}>
        <div className={cards.pgLabel}>Version</div>
        <div className={cards.algos} style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}>
          {PROTOS.map((p) => (
            <button
              key={p}
              type="button"
              className={cards.algo}
              aria-pressed={!race && cfg.proto === p}
              onClick={() => sim.setCfg({ proto: p, view: 'lanes' })}
            >
              {PROTO_NAME[p]}
            </button>
          ))}
        </div>
        <label className={cards.switch} style={{ marginTop: 12 }}>
          <span>
            Race all three
            <small>HTTP/1.1, 2 and 3 side by side</small>
          </span>
          <input type="checkbox" checked={race} onChange={(e) => sim.setCfg({ view: e.target.checked ? 'race' : 'lanes' })} />
        </label>
        <label className={cards.switch} style={{ marginTop: 12 }}>
          <span>
            Returning visitor (0-RTT)
            <small>HTTP/3 sends the first request in its first packet</small>
          </span>
          <input type="checkbox" checked={cfg.zeroRtt} onChange={(e) => sim.setCfg({ zeroRtt: e.target.checked })} />
        </label>
      </div>

      <div className={cards.pgGroup}>
        <div className={cards.pgLabel}>Network</div>
        <Range
          label="Round trip"
          value={rtt}
          min={20}
          max={300}
          step={10}
          format={(v) => `${v} ms`}
          onChange={(v) => {
            setRtt(v);
            sim.setRtt(v);
          }}
        />
        <Range
          label="Packet loss"
          value={loss}
          min={0}
          max={0.03}
          step={0.0025}
          format={(v) => `${(v * 100).toFixed(v > 0 && v < 0.01 ? 2 : 1)}%`}
          onChange={(v) => {
            setLoss(v);
            sim.setLoss(v);
          }}
        />
        <Range
          label="Files on the page"
          value={count}
          min={2}
          max={24}
          step={1}
          format={(v) => `${v}`}
          onChange={(v) => {
            setCount(v);
            sim.setCount(v);
          }}
        />
        {h1 && !race && (
          <Range label="Connections per host" value={cfg.conns} min={1} max={6} step={1} format={(v) => `${v}`} onChange={(v) => sim.setCfg({ conns: v })} />
        )}
        <div className={cards.row}>
          <button type="button" className={`${cards.btn} ${cards.btnHot}`} onClick={() => sim.reload()}>
            <Icon name="replay" size={14} /> Reload
          </button>
          <button type="button" className={cards.btn} onClick={() => sim.dropNext()} disabled={race}>
            <Icon name="x" size={14} /> Drop a chunk
          </button>
          <button type="button" className={cards.btn} onClick={() => sim.switchNetwork()} disabled={race}>
            <Icon name="bolt" size={14} /> Switch network
          </button>
        </div>
      </div>

      <div className={cards.pgGroup}>
        <div className={cards.pgLabel}>Challenges</div>
        <div className={cards.missions}>
          {MISSIONS.map((m) => (
            <div key={m.id} className={cards.mission} data-done={!!done[m.id]}>
              <div className={cards.missionTitle}>
                {done[m.id] && <Icon name="check" size={15} />}
                {m.title}
              </div>
              <div className={cards.missionText}>{m.text}</div>
              {!done[m.id] && <div className={cards.missionHint}>{m.hint}</div>}
            </div>
          ))}
        </div>
      </div>

      {race ? (
        <div className={cards.pgGroup}>
          <div className={cards.pgLabel}>Last race</div>
          <div className={cards.stats} style={{ marginTop: 8 }}>
            {RACE.map((k) => (
              <span key={k}>
                {PROTO_NAME[k]} <b>{sim.raceFinal ? `${fmt(sim.raceFinal[k].ms)} ms` : '…'}</b>
              </span>
            ))}
          </div>
        </div>
      ) : (
        <CodeBlock spec={{ title: 'nginx.conf · live', lang: 'nginx', code: nginxFor(cfg.proto, cfg.zeroRtt) }} />
      )}
    </div>
  );
}
