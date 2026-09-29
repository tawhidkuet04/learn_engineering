'use client';

import { useState, type CSSProperties, type ReactNode } from 'react';
import { CodeBlock } from '@/components/lesson/CodeBlock';
import { Icon, type IconName } from '@/components/lesson/Icon';
import { lessonCss } from '@/components/lesson/Prose';
import { usePoll } from '@/components/lesson/usePoll';
import { CHECKS } from '../sim/data';
import { COMMON, PAINTS, mix, paintById } from '../sim/paintMix';
import type { Resume, ShakeProto } from '../sim/shake';
import type { TlsSim } from '../sim/TlsSim';
import css from '../tls.module.css';
import { liveNginxConf } from './nginxConf';

function Kicker({ icon, children }: { icon: IconName; children: ReactNode }) {
  return (
    <div className={lessonCss.cardKicker}>
      <Icon name={icon} size={13} /> {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The predict card's question, kept in sync with the sim              */
/* ------------------------------------------------------------------ */

/**
 * PredictCard renders its prompt once, but our questions change as the
 * scene plays. This shows the open question (the same text as the stage
 * prompt), so phone users who scrolled down to the buttons still see it.
 */
export function LivePrompt({ sim, fallback }: { sim: TlsSim; fallback: ReactNode }) {
  usePoll(sim, 100, true);
  const ask = sim.game?.pending?.ask;
  return <>{ask ?? fallback}</>;
}

/* ------------------------------------------------------------------ */
/* Pick the secret paints                                              */
/* ------------------------------------------------------------------ */

export function PaintPicker({ sim, initial }: { sim: TlsSim; initial: { a: string; b: string } }) {
  const [a, setA] = useState(initial.a);
  const [b, setB] = useState(initial.b);
  const shared = mix(COMMON, paintById(a).hex, paintById(b).hex);
  const eve = mix(COMMON, paintById(a).hex, COMMON, paintById(b).hex);
  const pick = (side: 'a' | 'b', id: string) => {
    const na = side === 'a' ? id : a;
    const nb = side === 'b' ? id : b;
    setA(na);
    setB(nb);
    sim.paint.setSecrets(na, nb);
  };
  const row = (side: 'a' | 'b', cur: string) => (
    <div className={css.pickRow} role="group" aria-label={side === 'a' ? 'Alice’s secret paint' : 'The server’s secret paint'}>
      {PAINTS.map((p) => (
        <button key={p.id} type="button" className={css.paintBtn} style={{ '--c': p.hex } as CSSProperties} aria-pressed={cur === p.id} aria-label={p.name} title={p.name} onClick={() => pick(side, p.id)} />
      ))}
    </div>
  );
  return (
    <div className={lessonCss.card}>
      <Kicker icon="bolt">Try it</Kicker>
      <p className={lessonCss.cardQ}>Choose each side’s secret paint. The exchange replays with your colors.</p>
      <div className={css.pickLabel}>Alice’s secret</div>
      {row('a', a)}
      <div className={css.pickLabel}>The server’s secret</div>
      {row('b', b)}
      <div className={css.result}>
        both sides get <i style={{ '--c': shared } as CSSProperties} />
        <span>
          Eve’s best try <i style={{ '--c': eve } as CSSProperties} />
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Step through the certificate checks                                 */
/* ------------------------------------------------------------------ */

export function ChainCard({ sim }: { sim: TlsSim }) {
  usePoll(sim, 150);
  const c = sim.cert;
  const next = CHECKS[c.cursor];
  const busy = !!c.running;
  const done = c.complete;
  return (
    <div className={lessonCss.card}>
      <Kicker icon="target">Your turn · verify</Kicker>
      <p className={lessonCss.cardQ}>Run the browser’s five checks on the chain, one at a time.</p>
      <div className={css.btnRow}>
        <button type="button" className={`${css.btn} ${css.btnHot}`} disabled={!c.arrived || busy || done} onClick={() => sim.cert.nextCheck()}>
          <Icon name="arrowRight" size={14} />
          {done ? 'All checks done' : !c.arrived ? 'Waiting for the chain…' : `Check: ${next?.label.toLowerCase()}`}
        </button>
        <button type="button" className={css.btn} disabled={!c.arrived || busy || done} onClick={() => sim.cert.runAll()}>
          Run the rest
        </button>
        <button type="button" className={css.btn} onClick={() => sim.cert.resetChecks()}>
          <Icon name="replay" size={14} /> Start over
        </button>
      </div>
      {done ? (
        <p className={css.status} data-tone="ok">
          <strong>Connection secure.</strong> The name matches, the dates are fine, every signature checks out up to a root Alice already trusts, and the server proved it holds the private key.
        </p>
      ) : busy ? (
        <p className={css.status}>
          <strong>{CHECKS.find((k) => k.id === c.running?.id)?.label}:</strong> {CHECKS.find((k) => k.id === c.running?.id)?.detail}
        </p>
      ) : c.cursor > 0 ? (
        <p className={css.status}>
          {c.cursor} of {CHECKS.length} passed. Next: <strong>{next?.label.toLowerCase()}</strong>.
        </p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Playground                                                          */
/* ------------------------------------------------------------------ */

interface Challenge {
  id: string;
  title: string;
  text: string;
  hint: string;
}

const CHALLENGES: Challenge[] = [
  { id: 'fast', title: 'Fast lane', text: 'Get an encrypted response back two round trips after the first SYN.', hint: 'Hint: skip the handshake wait entirely.' },
  { id: 'ghost', title: 'Ghost visitor', text: 'Load the page over HTTPS without Eve learning which site Alice visited.', hint: 'Hint: what reveals the name in the ClientHello?' },
  { id: 'museum', title: 'Museum piece', text: 'Find the slowest HTTPS setup: first byte after four round trips.', hint: 'Hint: go back to 2008.' },
];

export function Playground({ sim, initialRtt }: { sim: TlsSim; initialRtt: number }) {
  usePoll(sim, 200);
  const s = sim.shake;
  const cfg = s.cfg;
  const [rtt, setRtt] = useState(initialRtt);
  const protos: { id: ShakeProto; label: string }[] = [
    { id: 'http', label: 'HTTP' },
    { id: 'tls12', label: 'TLS 1.2' },
    { id: 'tls13', label: 'TLS 1.3' },
  ];
  const modes: { id: Resume; label: string; ok: boolean }[] = [
    { id: 'full', label: 'New', ok: true },
    { id: 'ticket', label: 'Resumed', ok: cfg.proto !== 'http' },
    { id: '0rtt', label: '0-RTT', ok: cfg.proto === 'tls13' },
  ];
  const fill = ((rtt - 10) / 290) * 100;
  const conf = liveNginxConf(cfg);
  return (
    <div className={css.pg}>
      <div className={css.pgGroup}>
        <div className={css.pgLabel}>Protocol</div>
        <div className={css.seg} role="group" aria-label="Protocol">
          {protos.map((p) => (
            <button key={p.id} type="button" aria-pressed={cfg.proto === p.id} onClick={() => s.setProto(p.id)}>
              {p.label}
            </button>
          ))}
        </div>
        <div className={css.pgLabel} style={{ marginTop: 12 }}>
          Connection
        </div>
        <div className={css.seg} role="group" aria-label="Connection">
          {modes.map((m) => (
            <button key={m.id} type="button" disabled={!m.ok} aria-pressed={cfg.resume === m.id} onClick={() => s.setResume(m.id)}>
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <div className={css.pgGroup}>
        <label className={css.switch}>
          <span>
            Encrypted Client Hello
            <small>Hide the site name from Eve (TLS 1.3 only)</small>
          </span>
          <input type="checkbox" checked={cfg.ech} disabled={cfg.proto !== 'tls13'} onChange={(e) => s.setEch(e.target.checked)} />
        </label>
        <div className={css.pgLabel} style={{ marginTop: 14 }}>
          Round-trip time <output>{rtt} ms</output>
        </div>
        <input
          className={css.range}
          type="range"
          min={10}
          max={300}
          step={10}
          value={rtt}
          style={{ '--fill': `${fill}%` } as CSSProperties}
          onChange={(e) => {
            const v = Number(e.target.value);
            setRtt(v);
            s.setRtt(v);
          }}
          aria-label="Round-trip time in milliseconds"
        />
        <div className={css.stats}>
          <span>
            handshake <b>{cfg.proto === 'http' ? 'none' : `${s.tlsRtts} RTT`}</b>
          </span>
          <span>
            request leaves <b>{s.requestAtRtts * rtt} ms</b>
          </span>
          <span>
            first byte <b>{s.firstByteRtts * rtt} ms</b>
          </span>
        </div>
      </div>

      <div className={css.pgGroup}>
        <div className={css.pgLabel}>Challenges</div>
        <div className={css.missions}>
          {CHALLENGES.map((m) => {
            const done = s.achieved.has(m.id);
            return (
              <div key={m.id} className={css.mission} data-done={done}>
                <div className={css.missionTitle}>
                  {done && <Icon name="check" size={15} />}
                  {m.title}
                </div>
                <div className={css.missionText}>{m.text}</div>
                {!done && <div className={css.missionHint}>{m.hint}</div>}
              </div>
            );
          })}
        </div>
      </div>

      <CodeBlock spec={{ title: 'nginx.conf · live', lang: 'nginx', code: conf }} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Cheat sheet                                                         */
/* ------------------------------------------------------------------ */

const ROWS: [string, string, string][] = [
  ['Symmetric cipher', 'Encrypts and seals every record with one shared key.', 'AES-GCM · ChaCha20-Poly1305'],
  ['Key exchange', 'Agrees on that key in public, fresh for every connection.', 'ECDHE: X25519 (+ ML-KEM)'],
  ['Certificate', 'Ties the name to a public key, signed by a CA.', 'leaf → intermediate → root'],
  ['CertificateVerify', 'Proves the server holds the matching private key.', 'signature over the handshake'],
  ['Finished', 'Proves nobody altered the handshake.', 'MAC over the transcript'],
  ['HSTS', 'Forces https:// before anything is sent.', 'Strict-Transport-Security'],
];

export function CheatSheet() {
  return (
    <>
      <table className={css.table}>
        <thead>
          <tr>
            <th>Piece</th>
            <th>Job · in practice</th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map(([a, b, c]) => (
            <tr key={a}>
              <td>{a}</td>
              <td>
                {b}
                <br />
                <code>{c}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className={css.subhead}>Remember</p>
      <ul className={css.takeaways}>
        <li>
          HTTPS gives <strong>confidentiality, integrity and authentication</strong>. Without it, every hop can read and rewrite your traffic.
        </li>
        <li>
          Public-key crypto runs only in the handshake. <strong>Symmetric AEAD</strong> protects the data itself.
        </li>
        <li>
          <strong>Diffie–Hellman</strong> agrees on a key without sending it. Fresh keys per connection give <strong>forward secrecy</strong>.
        </li>
        <li>
          Key exchange alone can’t spot a man in the middle. <strong>Certificates plus CertificateVerify</strong> prove who is on the other end.
        </li>
        <li>
          TLS 1.3 takes <strong>1 round trip</strong> (TLS 1.2 took 2). Resumption skips the certificate; <strong>0-RTT</strong> is fast but replayable.
        </li>
        <li>
          Eve still sees <strong>IPs, sizes, timing and the SNI</strong> (unless ECH). <strong>HSTS</strong> stops downgrades to http.
        </li>
      </ul>
    </>
  );
}
