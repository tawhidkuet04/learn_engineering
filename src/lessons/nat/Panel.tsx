'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import cards from '@/components/lesson/cards.module.css';
import { Icon } from '@/components/lesson/Icon';
import { lessonCss } from '@/components/lesson/Prose';
import { usePoll } from '@/components/lesson/usePoll';
import { commas, intToIp, maskOf, usableHosts } from './ip';
import type { NatSim } from './sim';
import css from './nat.module.css';

/* ------------------------------------------------------------------ */
/* Prefix slider with three small goals                                */
/* ------------------------------------------------------------------ */

const PREFIX_GOALS = [
  { id: 'lan', title: 'A home network', text: 'Exactly 254 usable host addresses.', check: (p: number) => p === 24 },
  { id: 'office', title: 'Room for 300', text: 'The smallest subnet that fits 300 hosts.', check: (p: number) => p === 23 },
  { id: 'link', title: 'Router to router', text: 'A link between two routers: just 2 usable addresses.', check: (p: number) => p === 30 || p === 31 },
];

export function PrefixCard({ sim, initial }: { sim: NatSim; initial: number }) {
  const [p, setP] = useState(initial);
  const [done, setDone] = useState<Record<string, boolean>>({});
  const fill = (p / 32) * 100;
  const change = (v: number) => {
    setP(v);
    sim.setPrefix(v);
    setDone((prev) => {
      const hit = PREFIX_GOALS.filter((g) => !prev[g.id] && g.check(v));
      if (!hit.length) return prev;
      const next = { ...prev };
      for (const g of hit) next[g.id] = true;
      return next;
    });
  };
  const count = Object.values(done).filter(Boolean).length;
  const hosts = usableHosts(p);
  return (
    <div className={lessonCss.card}>
      <div className={cards.head}>
        <div className={lessonCss.cardKicker}>
          <Icon name="bolt" size={13} /> Try it
        </div>
        <span className={cards.score} aria-label={`${count} of ${PREFIX_GOALS.length} goals`}>
          {PREFIX_GOALS.map((g) => (
            <i key={g.id} data-on={!!done[g.id]} />
          ))}
        </span>
      </div>
      <div className={cards.sliderHead}>
        <span>Prefix length</span>
        <output>/{p}</output>
      </div>
      <input
        className={cards.range}
        type="range"
        min={0}
        max={32}
        step={1}
        value={p}
        style={{ '--fill': `${fill}%` } as CSSProperties}
        onChange={(e) => change(Number(e.target.value))}
        aria-label="Prefix length"
      />
      <div className={cards.scale}>
        <span>/0 · everything</span>
        <span>/32 · one host</span>
      </div>
      <div className={css.prefixOut}>
        <span>mask</span>
        <span>{intToIp(maskOf(p))}</span>
        <span>usable hosts</span>
        <span>{commas(hosts)}</span>
      </div>
      <div className={css.missions}>
        {PREFIX_GOALS.map((g) => (
          <div key={g.id} className={css.mission} data-done={!!done[g.id]}>
            <div className={css.missionTitle}>
              {done[g.id] && <Icon name="check" size={15} />}
              {g.title}
            </div>
            <div className={css.missionText}>{g.text}</div>
          </div>
        ))}
      </div>
      {count === PREFIX_GOALS.length && (
        <p className={cards.after}>
          <strong>All three.</strong> /24 gives 254 hosts, /23 is the first to fit 300 (510), and /30 leaves exactly 2, the classic point-to-point
          link. /31 counts too: RFC 3021 lets a link use both of its addresses.
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Cheat sheet                                                         */
/* ------------------------------------------------------------------ */

const ROWS: [string, string, string][] = [
  ['IPv4 address', '192.168.1.23', '32 bits, four octets 0–255'],
  ['Prefix / mask', '/24 = 255.255.255.0', 'First 24 bits name the network'],
  ['Subnet size', '/p → 2^(32−p)', 'Minus network and broadcast'],
  ['Default gateway', '192.168.1.1', 'Where non-local packets go'],
  ['Private ranges', '10/8 · 172.16/12 · 192.168/16', 'Reusable, never routed publicly'],
  ['NAT (NAPT)', '.23:51000 ↔ 203.0.113.7:40001', 'Outbound creates the mapping'],
  ['Port forward', ':8080 → 192.168.1.23:8080', 'A static mapping for inbound'],
  ['CGNAT', '100.64.0.0/10', "A second NAT at the ISP"],
  ['IPv6', '2001:db8::/32 (docs)', '128 bits: no NAT needed'],
];

export function CheatSheet() {
  return (
    <>
      <table className={css.table}>
        <thead>
          <tr>
            <th>Concept</th>
            <th>Example</th>
            <th>Remember</th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map(([a, b, c]) => (
            <tr key={a}>
              <td>{a}</td>
              <td>
                <code>{b}</code>
              </td>
              <td>{c}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className={css.subhead}>Remember</p>
      <ul className={css.takeaways}>
        <li>
          An address splits into a <strong>network part</strong> and a <strong>host part</strong>. The prefix length (or mask) says where.
        </li>
        <li>
          Same network after ANDing with the mask? <strong>Deliver directly</strong> (ARP for the MAC). Otherwise send it to the{' '}
          <strong>default gateway</strong>.
        </li>
        <li>
          <strong>Private addresses</strong> are reused in every home and office and never appear on the public internet.
        </li>
        <li>
          NAT rewrites the <strong>source</strong> on the way out, remembers the pair, and rewrites the <strong>destination</strong> of replies on the
          way in.
        </li>
        <li>
          No row, no entry: <strong>unsolicited inbound</strong> packets are dropped. Port forwards, hole punching and TURN work around it.
        </li>
        <li>
          <strong>IPv6</strong> has room for every device, so the router only routes, and a firewall blocks what NAT used to block by accident.
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
  check: (s: NatSim) => boolean;
}

const MISSIONS: Mission[] = [
  {
    id: 'full',
    title: 'Full house',
    text: 'Get 6 live mappings into the NAT table at once.',
    hint: 'Hint: every device online, and a timeout long enough to remember them.',
    check: (s) => s.liveMappings() >= 6,
  },
  {
    id: 'door',
    title: 'Open door',
    text: "Let Carol reach the laptop's web server on :8080.",
    hint: 'Hint: the router needs a row for port 8080 before she knocks.',
    check: (s) => s.stats.inOk > 0,
  },
  {
    id: 'stall',
    title: 'Stalled stream',
    text: "Make the TV's video stall: its server pushes a packet every 8 s.",
    hint: 'Hint: what if the router forgets the mapping between two pushes?',
    check: (s) => s.stats.expiredDrops > 0,
  },
  {
    id: 'quiet',
    title: 'Lights out',
    text: 'Empty the NAT table completely.',
    hint: 'Hint: rows only disappear once nothing uses them.',
    check: (s) => s.rowsOf('router').filter((m) => m.goneVt == null).length === 0 && s.t > 3,
  },
];

const DEVS: [string, string][] = [
  ['laptop', 'laptop'],
  ['phone', 'phone'],
  ['tv', 'TV'],
];

export function Playground({ sim, initialTimeout }: { sim: NatSim; initialTimeout: number }) {
  usePoll(sim, 250);
  const [timeout, setTimeoutS] = useState(initialTimeout);
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

  const fwd = sim.hasForward();
  const fill = ((timeout - 4) / (60 - 4)) * 100;

  return (
    <div className={css.pg}>
      <div className={css.pgGroup}>
        <div className={css.pgLabel}>
          Devices online <output>{DEVS.filter(([id]) => sim.active.has(id)).length} / 3</output>
        </div>
        <div className={css.chips}>
          {DEVS.map(([id, name]) => (
            <button key={id} type="button" className={css.chip} aria-pressed={sim.active.has(id)} onClick={() => sim.setActive(id, !sim.active.has(id))}>
              <i />
              {name}
            </button>
          ))}
        </div>
        <p className={css.hint}>Online devices keep opening connections to the web server. The TV streams video.</p>
      </div>

      <div className={css.pgGroup}>
        <div className={css.pgLabel}>
          Inbound <output>{fwd ? ':8080 → laptop' : 'no forwards'}</output>
        </div>
        <div className={css.btnRow}>
          <button type="button" className={`${css.btn} ${fwd ? '' : css.btnHot}`} onClick={() => sim.setForward(!fwd)}>
            <Icon name={fwd ? 'minus' : 'plus'} size={14} />
            {fwd ? 'Remove the port forward' : 'Add port forward :8080'}
          </button>
          <button type="button" className={`${css.btn} ${fwd ? css.btnHot : ''}`} onClick={() => sim.carolConnect()}>
            <Icon name="arrowRight" size={14} />
            Carol connects
          </button>
        </div>
      </div>

      <div className={css.pgGroup}>
        <div className={css.pgLabel}>
          NAT idle timeout <output>{timeout} s</output>
        </div>
        <input
          className={css.range}
          type="range"
          min={4}
          max={60}
          step={1}
          value={timeout}
          style={{ '--fill': `${fill}%` } as CSSProperties}
          onChange={(e) => {
            const v = Number(e.target.value);
            setTimeoutS(v);
            sim.setNatTimeout(v);
          }}
          aria-label="NAT idle timeout"
        />
        <div className={css.scale}>
          <span>4 s</span>
          <span>60 s</span>
        </div>
        <div className={css.stats}>
          <span>
            mappings <b>{sim.liveMappings()}</b>
          </span>
          <span>
            dropped <b data-tone={sim.stats.drops ? 'bad' : undefined}>{sim.stats.drops}</b>
          </span>
          <span>
            Carol got in <b data-tone={sim.stats.inOk ? 'good' : undefined}>{sim.stats.inOk}</b>
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
        Timeouts are shrunk to seconds here. Real routers keep an idle UDP mapping for about 30 s to a few minutes, and an established TCP connection
        for hours or days.
      </p>
    </div>
  );
}
