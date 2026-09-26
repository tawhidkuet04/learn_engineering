'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { CodeBlock } from '@/components/lesson/CodeBlock';
import { Icon } from '@/components/lesson/Icon';
import { usePoll } from '@/components/lesson/usePoll';
import css from '@/components/lesson/cards.module.css';
import type { CcAlgo, TcpModel } from './model';
import type { TcpSim } from './sim';

/* ------------------------------------------------------------------ */
/* Cheat sheet                                                          */
/* ------------------------------------------------------------------ */

const ROWS: [string, string, string][] = [
  ['Handshake', 'SYN → SYN-ACK → ACK, random ISNs', 'Costs 1 RTT before any data'],
  ['Seq / ack', 'Count bytes; ack = next byte expected', 'Cumulative: one ACK confirms all before it'],
  ['Timeout', 'RTO = SRTT + 4·RTTVAR (Linux floor 200 ms)', 'Doubles after every timeout'],
  ['Fast retransmit', '3 duplicate ACKs → resend now', 'Repairs a loss in about 1 RTT'],
  ['Flow control', 'rwnd = receiver’s free buffer', '0 pauses the sender; probes keep it alive'],
  ['Congestion control', 'Slow start ×2 per RTT, then +1 per RTT', 'Loss: halve (Reno) or 0.7× (CUBIC); timeout: 1'],
  ['Teardown', 'FIN / ACK in each direction', 'First closer waits in TIME_WAIT (60 s on Linux)'],
];

export function CheatSheet() {
  return (
    <>
      <table className={css.table}>
        <thead>
          <tr>
            <th>Mechanism</th>
            <th>How it works</th>
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
          IP is <strong>best effort</strong>. TCP adds numbering, acknowledgments and retransmission to build a <strong>reliable, ordered byte stream</strong>.
        </li>
        <li>
          Alice may send up to <strong>min(cwnd, rwnd)</strong>: the receiver’s window protects the receiver, the congestion window protects the network.
        </li>
        <li>
          Losses are found two ways: <strong>duplicate ACKs</strong> (fast, while data still flows) and the <strong>retransmission timer</strong> (slow,
          the last resort).
        </li>
        <li>
          Reliability costs latency: a lost segment holds up everything behind it (<strong>head-of-line blocking</strong>). That’s one reason QUIC
          builds its own streams on UDP.
        </li>
        <li>
          Inspect it all on a real machine with <code>tcpdump</code> (segments) and <code>ss -ti</code> (RTT, cwnd, retransmissions).
        </li>
      </ul>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Playground                                                           */
/* ------------------------------------------------------------------ */

const ALGOS: { id: CcAlgo; name: string; note: string }[] = [
  { id: 'reno', name: 'Reno', note: 'halve on loss, +1 per RTT' },
  { id: 'cubic', name: 'CUBIC', note: 'Linux default: 0.7× on loss' },
  { id: 'bbr', name: 'BBR', note: 'paces at measured bandwidth' },
];

interface Mission {
  id: string;
  title: string;
  text: string;
  hint: string;
  /** Seconds the condition must hold (0 = the moment it happens) */
  hold: number;
  check: (m: TcpModel) => boolean;
}

const MISSIONS: Mission[] = [
  {
    id: 'zero',
    title: 'Starve the sender',
    text: 'Make the receiver advertise a zero window.',
    hint: 'Hint: slow the receiver right down.',
    hold: 0,
    check: (m) => m.stats.zeroWin > 0,
  },
  {
    id: 'rto',
    title: 'Force a timeout',
    text: 'Make the retransmission timer fire.',
    hint: 'Hint: crank up the loss rate, so even retransmissions get lost.',
    hold: 0,
    check: (m) => m.stats.timeouts > 0,
  },
  {
    id: 'fat',
    title: 'Long fat pipe',
    text: 'With no random loss, get cwnd to 30 segments or more.',
    hint: 'Hint: a longer round trip means a bigger pipe to fill.',
    hold: 0,
    check: (m) => m.cfg.loss === 0 && m.cfg.cc !== 'bbr' && m.cwnd >= 30,
  },
  {
    id: 'noise',
    title: 'Beat the noise',
    text: 'With at least 2% random loss, keep goodput above 80% of the link for 10 s.',
    hint: 'Hint: which algorithm doesn’t treat every loss as congestion?',
    hold: 10,
    check: (m) => m.cfg.loss >= 0.02 && m.goodput(2000) >= 0.8 * m.capacity(),
  },
];

function bps(bytesPerSec: number) {
  const bits = bytesPerSec * 8;
  return bits >= 1e6 ? `${(bits / 1e6).toFixed(2)}Mbps` : `${Math.round(bits / 1e3)}Kbps`;
}

function ssOutput(m: TcpModel) {
  const cc = m.cfg.cc === 'none' ? 'reno' : m.cfg.cc;
  const sendQ = Math.max(0, m.nxt - m.una) * m.cfg.mss;
  const cwnd = Math.max(1, Math.floor(m.cwnd));
  const ss = Number.isFinite(m.ssthresh) && cc !== 'bbr' ? ` ssthresh:${Math.round(m.ssthresh)}` : '';
  const rtxNow = m.segs.filter((s) => s.kind === 'data' && s.rtx && s.status === 'flight').length;
  const b = m.bbrInfo();
  const lines = [
    '$ ss -ti dst 203.0.113.10',
    `ESTAB  0  ${sendQ}  198.51.100.42:51514  203.0.113.10:443`,
    `!    ${cc} wscale:7,7 rto:${Math.round(m.rto)} rtt:${m.srtt.toFixed(1)}/${m.rttvar.toFixed(1)} mss:${m.cfg.mss}`,
    `!    cwnd:${cwnd}${ss} bytes_acked:${m.bytesThrough(m.una)} retrans:${rtxNow}/${m.stats.rtx}`,
    `    delivery_rate ${bps(m.goodput(1000))}`,
  ];
  if (cc === 'bbr') lines.push(`    bbr:(bw:${bps(b.btlBw * 1000 * m.cfg.mss)},mrtt:${Number.isFinite(b.minRtt) ? b.minRtt.toFixed(1) : '0'},pacing_gain:${b.pacingGain.toFixed(2)})`);
  return lines.join('\n');
}

export function Playground({ sim }: { sim: TcpSim }) {
  usePoll(sim, 250);
  const [loss, setLoss] = useState(0);
  const [rtt, setRtt] = useState(100);
  const [app, setApp] = useState(60);
  const [cc, setCcState] = useState<CcAlgo>('reno');
  const [held, setHeld] = useState<Record<string, number>>({});
  const lastT = useRef<number | null>(null);

  useEffect(() => {
    const id = window.setInterval(() => {
      const m = sim.model;
      if (!m) return;
      const t = sim.t;
      const dt = lastT.current == null ? 0 : Math.max(0, t - lastT.current);
      lastT.current = t;
      setHeld((prev) => {
        const next = { ...prev };
        for (const ms of MISSIONS) {
          const h = prev[ms.id] ?? 0;
          if (h >= Math.max(ms.hold, 1e-3)) continue;
          if (ms.check(m)) next[ms.id] = ms.hold === 0 ? 1 : h + dt;
          else if (ms.hold > 0) next[ms.id] = 0;
        }
        return next;
      });
    }, 250);
    return () => window.clearInterval(id);
  }, [sim]);

  const m = sim.model;
  const appText = app >= 60 ? 'instantly' : `${app} segments/s`;

  return (
    <div className={css.pg}>
      <div className={css.pgGroup}>
        <div className={css.pgLabel}>
          Random loss <output>{(loss * 100).toFixed(0)}%</output>
        </div>
        <input
          className={css.range}
          type="range"
          min={0}
          max={10}
          step={1}
          value={loss * 100}
          style={{ '--fill': `${loss * 1000}%` } as CSSProperties}
          onChange={(e) => {
            const v = Number(e.target.value) / 100;
            setLoss(v);
            sim.setLoss(v);
          }}
          aria-label="Random loss rate"
        />
        <div className={css.pgLabel} style={{ marginTop: 10 }}>
          Round-trip time <output>{rtt} ms</output>
        </div>
        <input
          className={css.range}
          type="range"
          min={40}
          max={300}
          step={20}
          value={rtt}
          style={{ '--fill': `${((rtt - 40) / 260) * 100}%` } as CSSProperties}
          onChange={(e) => {
            const v = Number(e.target.value);
            setRtt(v);
            sim.setRtt(v);
          }}
          aria-label="Round-trip time"
        />
        <div className={css.pgLabel} style={{ marginTop: 10 }}>
          Receiver app reads <output>{appText}</output>
        </div>
        <input
          className={css.range}
          type="range"
          min={2}
          max={60}
          step={2}
          value={app}
          style={{ '--fill': `${((app - 2) / 58) * 100}%` } as CSSProperties}
          onChange={(e) => {
            const v = Number(e.target.value);
            setApp(v);
            sim.setAppRate(v >= 60 ? Infinity : v);
          }}
          aria-label="Receiver reading speed"
        />
      </div>

      <div className={css.pgGroup}>
        <div className={css.pgLabel}>Congestion control</div>
        <div className={css.algos}>
          {ALGOS.map((a) => (
            <button
              key={a.id}
              type="button"
              className={css.algo}
              aria-pressed={cc === a.id}
              onClick={() => {
                setCcState(a.id);
                sim.setCc(a.id);
              }}
            >
              <strong>{a.name}</strong>
              <br />
              <small style={{ color: 'var(--text-3)' }}>{a.note}</small>
            </button>
          ))}
          <button type="button" className={css.algo} onClick={() => sim.restart()}>
            <strong>
              <Icon name="replay" size={13} /> New connection
            </strong>
            <br />
            <small style={{ color: 'var(--text-3)' }}>same settings, fresh start</small>
          </button>
        </div>
      </div>

      <div className={css.pgGroup}>
        <div className={css.pgLabel}>Challenges</div>
        <div className={css.missions}>
          {MISSIONS.map((ms) => {
            const h = held[ms.id] ?? 0;
            const done = ms.hold === 0 ? h > 0 : h >= ms.hold;
            return (
              <div key={ms.id} className={css.mission} data-done={done}>
                <div className={css.missionTitle}>
                  {done && <Icon name="check" size={15} />}
                  {ms.title}
                </div>
                <div className={css.missionText}>{ms.text}</div>
                {!done && <div className={css.missionHint}>{ms.hint}</div>}
                {ms.hold > 0 && (
                  <div className={css.meter}>
                    <i style={{ width: `${Math.min(100, (h / ms.hold) * 100)}%` }} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {m && <CodeBlock spec={{ title: 'terminal · live', lang: 'shell', code: ssOutput(m) }} />}
    </div>
  );
}
