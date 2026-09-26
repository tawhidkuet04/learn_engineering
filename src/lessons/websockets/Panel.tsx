'use client';

import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { SliderCard, Stat } from '@/components/lesson/cards';
import cardsCss from '@/components/lesson/cards.module.css';
import { Icon } from '@/components/lesson/Icon';
import { lessonCss } from '@/components/lesson/Prose';
import { usePoll } from '@/components/lesson/usePoll';
import type { LaneKind } from './race';
import type { Mode, WsSim } from './sim';
import css from './ws.module.css';

/* ------------------------------------------------------------------ */
/* Short polling interval                                              */
/* ------------------------------------------------------------------ */

export function IntervalCard({ sim, initial }: { sim: WsSim; initial: number }) {
  return (
    <SliderCard
      poll={sim}
      prompt="How often should Bob’s browser ask?"
      sliders={[
        {
          label: 'Poll every',
          min: 1,
          max: 10,
          step: 0.5,
          initial,
          format: (v) => `${v} s`,
          onChange: (v) => sim.setPollInterval(v),
          ends: ['1 s', '10 s'],
        },
      ]}
      stats={() => {
        const s = sim.stat;
        const pct = s.responses ? Math.round((s.empty / s.responses) * 100) : 0;
        const a = sim.avgDelay();
        return (
          <>
            <Stat label="requests / min" value={Math.round(60 / sim.cfg.interval)} />
            <Stat label="empty" value={`${pct}%`} bad={pct >= 50} />
            <Stat label="avg delay" value={a == null ? '–' : `${a.toFixed(1)} s`} bad={a != null && a > 3} />
          </>
        );
      }}
      done={() =>
        sim.tried.fast && sim.tried.slow ? (
          <>
            <strong>That&apos;s the trade-off.</strong> Ask often and most answers are empty. Ask rarely and messages sit on the server. The browser is
            guessing when news will arrive, and no interval guesses right.
          </>
        ) : null
      }
    />
  );
}

/* ------------------------------------------------------------------ */
/* Race controls                                                       */
/* ------------------------------------------------------------------ */

const LANES: { kind: LaneKind; name: string }[] = [
  { kind: 'short', name: 'Short polling' },
  { kind: 'long', name: 'Long polling' },
  { kind: 'ws', name: 'WebSocket' },
];

export function RaceCard({ sim, initial }: { sim: WsSim; initial: number }) {
  usePoll(sim, 200);
  const [v, setV] = useState(initial);
  const fill = ((v - 1) / 9) * 100;
  return (
    <div className={lessonCss.card}>
      <div className={cardsCss.head}>
        <div className={lessonCss.cardKicker}>
          <Icon name="bolt" size={13} /> Try it
        </div>
      </div>
      <p className={lessonCss.cardQ}>Send messages as Alice whenever you like, and change how often short polling asks.</p>
      <div className={cardsCss.row} style={{ marginTop: 0 }}>
        <button type="button" className={`${cardsCss.btn} ${cardsCss.btnHot}`} onClick={() => sim.raceSend()}>
          <Icon name="arrowRight" size={14} /> Alice sends a message
        </button>
      </div>
      <div className={cardsCss.sliderHead} style={{ marginTop: 14 }}>
        <span>Short polling every</span>
        <output>{v} s</output>
      </div>
      <input
        className={cardsCss.range}
        type="range"
        min={1}
        max={10}
        step={0.5}
        value={v}
        style={{ '--fill': `${fill}%` } as CSSProperties}
        onChange={(e) => {
          const nv = Number(e.target.value);
          setV(nv);
          sim.setPollInterval(nv);
        }}
        aria-label="Short polling interval"
      />
      <div className={css.laneStats}>
        <span>lane</span>
        <span style={{ textAlign: 'right' }}>requests</span>
        <span style={{ textAlign: 'right' }}>avg delay</span>
        {LANES.map((l) => {
          const lane = sim.race.lane(l.kind);
          const a = sim.race.avg(l.kind);
          return (
            <FragmentRow key={l.kind} name={l.name} reqs={lane.requests} avg={a} />
          );
        })}
      </div>
    </div>
  );
}

function FragmentRow({ name, reqs, avg }: { name: string; reqs: number; avg: number | null }) {
  return (
    <>
      <span style={{ color: 'var(--text-2)' }}>{name}</span>
      <b>{reqs}</b>
      <b style={{ color: avg == null ? undefined : avg > 2 ? 'var(--sig-heavy)' : 'var(--sig-res)' }}>{avg == null ? '–' : `${avg.toFixed(1)} s`}</b>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Show something only once the prediction is done                     */
/* ------------------------------------------------------------------ */

export function AfterPredict({ sim, children }: { sim: WsSim; children: ReactNode }) {
  usePoll(sim, 200, true);
  return sim.game?.done ? <>{children}</> : null;
}

/* ------------------------------------------------------------------ */
/* Cheat sheet                                                         */
/* ------------------------------------------------------------------ */

const ROWS = [
  ['Short polling', 'Browser asks every N s', 'Up to N s late; most answers empty'],
  ['Long polling', 'Server holds the request', 'About one trip; a full request per reply'],
  ['Server-Sent Events', 'One response that never ends', 'Server → browser only; built-in reconnect'],
  ['WebSocket', 'Upgraded TCP connection', 'Both ways, any time; stateful to run'],
];

export function CheatSheet() {
  return (
    <>
      <table className={css.table}>
        <thead>
          <tr>
            <th>Technique</th>
            <th>How news arrives</th>
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
          HTTP is <strong>request/response</strong>: the browser always speaks first, and a server can only answer.
        </li>
        <li>
          A WebSocket starts as a <code>GET</code> with <code>Upgrade: websocket</code> and a random <code>Sec-WebSocket-Key</code>. The server answers{' '}
          <strong>101 Switching Protocols</strong> with <code>Sec-WebSocket-Accept</code>.
        </li>
        <li>
          After that the same TCP connection carries <strong>frames both ways</strong>, text or binary, with 2 to 14 bytes of header. Browser frames
          are masked.
        </li>
        <li>
          <strong>Ping/pong heartbeats</strong> find dead connections and keep proxies from closing idle ones. Clients reconnect with{' '}
          <strong>exponential backoff and jitter</strong>, then resync what they missed.
        </li>
        <li>
          Every socket lives on <strong>one server</strong>. Load balancers must pass the upgrade and allow long idle times, and a{' '}
          <strong>pub/sub backplane</strong> (Redis, NATS, Kafka) gets messages to users on other servers.
        </li>
        <li>
          Use WebSockets when <strong>both sides talk often</strong>, SSE when only the server pushes, and plain HTTP for everything else.
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
  check: (s: WsSim) => boolean;
}

const MISSIONS: Mission[] = [
  {
    id: 'instant',
    title: 'Instant',
    text: 'Get three messages in a row to Bob, each in under 1.7 seconds.',
    hint: 'Hint: stop asking on a timer.',
    check: (s) => {
      const d = s.stat.bobDelays;
      return d.length >= 3 && d.slice(-3).every((x) => x < 1.7);
    },
  },
  {
    id: 'across',
    title: 'Across the gap',
    text: 'With two servers, get a message from Alice to Bob the moment she sends it.',
    hint: 'Hint: the servers need a way to talk to each other.',
    check: (s) => s.cfg.servers === 2 && s.stat.crossLive > 0,
  },
  {
    id: 'comeback',
    title: 'Comeback',
    text: 'Cut Bob’s network, let Alice send two messages, restore it, and watch Bob catch up.',
    hint: 'Hint: WebSocket mode, heartbeats on.',
    check: (s) => s.stat.resynced >= 2,
  },
  {
    id: 'zombie',
    title: 'Break it: the zombie',
    text: 'With heartbeats off, cut Bob’s network and lose two messages while both ends still think the connection is open.',
    hint: 'Hint: nobody notices a silent connection unless someone checks.',
    check: (s) => {
      const b = s.ppl.get('bob')!;
      return s.cfg.mode === 'ws' && !s.cfg.heartbeat && !b.net && b.conn === 'open' && s.serverHas('bob') && b.lostInTransit >= 2;
    },
  },
];

const MODES: { mode: Mode; label: string }[] = [
  { mode: 'short', label: 'Short poll' },
  { mode: 'long', label: 'Long poll' },
  { mode: 'sse', label: 'SSE' },
  { mode: 'ws', label: 'WebSocket' },
];

export function Playground({ sim }: { sim: WsSim }) {
  usePoll(sim, 250);
  const [interval, setIntervalV] = useState(sim.cfg.interval);
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

  const c = sim.cfg;
  const bob = sim.ppl.get('bob')!;
  const ws = c.mode === 'ws';
  const fill = ((interval - 1) / 9) * 100;
  const avg = sim.avgDelay();
  const pct = sim.stat.responses ? Math.round((sim.stat.empty / sim.stat.responses) * 100) : 0;

  return (
    <div className={css.pg}>
      <div className={css.pgGroup}>
        <div className={css.pgLabel}>Transport</div>
        <div className={css.seg} role="group" aria-label="Transport">
          {MODES.map((m) => (
            <button key={m.mode} type="button" aria-pressed={c.mode === m.mode} onClick={() => sim.setMode(m.mode)}>
              {m.label}
            </button>
          ))}
        </div>
        <div className={css.pgLabel} style={{ marginTop: 12 }}>
          Short polling every <output>{interval} s</output>
        </div>
        <input
          className={css.range}
          type="range"
          min={1}
          max={10}
          step={0.5}
          value={interval}
          disabled={c.mode !== 'short'}
          style={{ '--fill': `${fill}%` } as CSSProperties}
          onChange={(e) => {
            const v = Number(e.target.value);
            setIntervalV(v);
            sim.setPollInterval(v);
          }}
          aria-label="Short polling interval"
        />
        <div className={css.stats}>
          <span>
            delivered{' '}
            <b>
              {sim.stat.delivered}/{sim.stat.expected}
            </b>
          </span>
          <span>
            avg delay <b data-tone={avg == null ? undefined : avg > 2.6 ? 'warn' : 'good'}>{avg == null ? '–' : `${avg.toFixed(1)} s`}</b>
          </span>
          <span>
            empty responses <b data-tone={pct >= 50 ? 'bad' : undefined}>{pct}%</b>
          </span>
        </div>
      </div>

      <div className={css.pgGroup}>
        <div className={css.pgLabel}>Chat and break things</div>
        <div className={css.btns}>
          <button type="button" className={css.btn} onClick={() => sim.chat('alice')}>
            Send as Alice
          </button>
          <button type="button" className={css.btn} onClick={() => sim.chat('bob')}>
            Send as Bob
          </button>
          <button type="button" className={css.btn} aria-pressed={!bob.net} onClick={() => (bob.net ? sim.cutNet('bob') : sim.restoreNet('bob'))}>
            <Icon name="power" size={14} />
            {bob.net ? 'Cut Bob’s network' : 'Restore Bob’s network'}
          </button>
        </div>
        <div className={css.pgLabel} style={{ marginTop: 12 }}>
          Heartbeat (WebSocket)
        </div>
        <div className={css.seg} role="group" aria-label="Heartbeat">
          <button type="button" aria-pressed={c.heartbeat} disabled={!ws} onClick={() => sim.setHeartbeat(true)}>
            On
          </button>
          <button type="button" aria-pressed={!c.heartbeat} disabled={!ws} onClick={() => sim.setHeartbeat(false)}>
            Off
          </button>
        </div>
      </div>

      <div className={css.pgGroup}>
        <div className={css.pgLabel}>Scale out (WebSocket)</div>
        <div className={css.seg} role="group" aria-label="Servers">
          <button type="button" aria-pressed={c.servers === 1} disabled={!ws} onClick={() => sim.setServers(1)}>
            1 server
          </button>
          <button type="button" aria-pressed={c.servers === 2} disabled={!ws} onClick={() => sim.setServers(2)}>
            2 servers
          </button>
        </div>
        <div className={css.seg} role="group" aria-label="Redis pub/sub" style={{ marginLeft: 8 }}>
          <button type="button" aria-pressed={c.backplane} disabled={!ws || c.servers !== 2} onClick={() => sim.setBackplane(true)}>
            Redis on
          </button>
          <button type="button" aria-pressed={!c.backplane} disabled={!ws || c.servers !== 2} onClick={() => sim.setBackplane(false)}>
            Redis off
          </button>
        </div>
        <p className={css.hint}>With two servers, Alice connects to ws-1 and Bob to ws-2.</p>
      </div>

      <div className={css.pgGroup}>
        <div className={css.pgLabel}>
          Challenges{' '}
          <output>
            {Object.values(done).filter(Boolean).length} / {MISSIONS.length}
          </output>
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
    </div>
  );
}
