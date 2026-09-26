'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import { CodeBlock } from '@/components/lesson/CodeBlock';
import { Icon } from '@/components/lesson/Icon';
import { usePoll } from '@/components/lesson/usePoll';
import { distanceLabel, fmtMs, PH, WARM, type Journey, type NetConfig } from './journey';
import type { JourneySim } from './sim';
import css from './lesson.module.css';

/* ------------------------------------------------------------------ */
/* Cheat sheet                                                         */
/* ------------------------------------------------------------------ */

const ROWS: { c: string; phase: string; cost: string; fix: string }[] = [
  { c: PH.dns, phase: 'DNS', cost: '0 ms cached, ~20–100 ms cold', fix: 'TTL caching, dns-prefetch' },
  { c: PH.tcp, phase: 'TCP', cost: '1 RTT', fix: 'keep-alive, servers near users (CDN)' },
  { c: PH.tls, phase: 'TLS', cost: '1 RTT (1.3), 2 RTT (1.2)', fix: 'TLS 1.3, session resumption' },
  { c: PH.req, phase: 'Request', cost: '1 RTT + think time', fix: 'server caching, faster queries' },
  { c: PH.res, phase: 'Download', cost: 'size ÷ bandwidth', fix: 'compression, a small first 14 KB' },
  { c: PH.render, phase: 'Render', cost: 'waits for CSS and plain scripts', fix: 'defer scripts, lean CSS' },
];

export function CheatSheet() {
  return (
    <>
      <table className={css.table}>
        <thead>
          <tr>
            <th>Phase</th>
            <th>Costs</th>
            <th>Make it cheaper</th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map((r) => (
            <tr key={r.phase}>
              <td>
                <i style={{ '--c': r.c } as CSSProperties} />
                {r.phase}
              </td>
              <td>{r.cost}</td>
              <td>{r.fix}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className={css.subhead}>Remember</p>
      <ul className={css.takeaways}>
        <li>
          A cold https visit pays <strong>DNS + 3 round trips + think time</strong> before the first byte of HTML.
        </li>
        <li>
          <strong>Distance multiplies, think time adds.</strong> Moving servers (or a CDN) closer often beats optimizing code.
        </li>
        <li>
          <strong>Reuse is the big win:</strong> cached DNS, a kept-alive connection and cached assets shrink a repeat visit to one round trip.
        </li>
        <li>
          The browser <strong>streams</strong>: it parses HTML and requests CSS and JS while bytes are still arriving.
        </li>
        <li>
          <strong>CSS blocks rendering; plain scripts block parsing.</strong> Use <code>defer</code>.
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
  check: (j: Journey) => boolean;
}

const MISSIONS: Mission[] = [
  {
    id: 'handshakes',
    title: 'Cut the handshake tax',
    text: 'On a cold visit (no reuse), with RTT at 80 ms or more and think time at 100 ms or more, get the first byte under 400 ms.',
    hint: 'Hint: count the round trips each TLS version needs.',
    check: (j) => !j.cfg.reuse && j.cfg.rtt >= 80 && j.cfg.serverMs >= 100 && j.marks.ttfb < 400,
  },
  {
    id: 'unblock',
    title: 'Paint before the script',
    text: 'Make first paint happen before app.js has even finished downloading.',
    hint: 'Hint: look at the <script> tag.',
    check: (j) => Number.isFinite(j.marks.fcp) && j.marks.fcp < j.marks.jsReady,
  },
  {
    id: 'instant',
    title: 'Instant from far away',
    text: 'With RTT at 150 ms or more, get first paint under 300 ms.',
    hint: 'Hint: what can a repeat visit skip?',
    check: (j) => j.cfg.rtt >= 150 && j.marks.fcp < 300,
  },
];

function timingText(j: Journey) {
  const m = j.marks;
  const c = j.cfg;
  const pad = (s: string, n = 29) => s.padEnd(n, ' ');
  const ms = (v: number) => `${v.toFixed(1)} ms`;
  const lines: string[] = [];
  lines.push(pad('DNS Lookup') + (c.dnsCached ? '0 ms  (cached)' : ms(m.dnsEnd)));
  if (c.reuse) lines.push(pad('Initial connection') + '—  (reused)');
  else {
    const conn = (m.failAt ?? m.tlsEnd) - m.dnsEnd;
    lines.push('!' + pad('Initial connection') + ms(conn));
    lines.push(pad('  SSL') + ms((m.failAt ?? m.tlsEnd) - m.tcpEnd));
  }
  if (m.failAt != null) {
    lines.push('!' + pad('(failed)') + 'certificate error');
    return lines.join('\n');
  }
  lines.push('!' + pad('Waiting for server response') + ms(m.ttfb - m.tlsEnd));
  lines.push(pad('Content Download') + ms(m.dlEnd - m.ttfb));
  lines.push('');
  lines.push('!' + pad('TTFB (since Enter)') + ms(m.ttfb));
  lines.push('!' + pad('First paint') + ms(m.fcp));
  return lines.join('\n');
}

function Range({ label, value, min, max, step, onChange, format, note }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; format: (v: number) => string; note?: string }) {
  return (
    <>
      <div className={css.pgLabel}>
        <span>
          {label} {note && <small>· {note}</small>}
        </span>
        <output>{format(value)}</output>
      </div>
      <input
        className={css.range}
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

export function Playground({ sim, initial }: { sim: JourneySim; initial: NetConfig }) {
  usePoll(sim, 250);
  const [cfg, setCfg] = useState<NetConfig>(initial);
  const [done, setDone] = useState<Record<string, boolean>>({});

  // Mark challenges as completed once they've been met (they stay done).
  useEffect(() => {
    const id = window.setInterval(() => {
      const j = sim.j;
      setDone((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const m of MISSIONS) {
          if (!prev[m.id] && m.check(j)) {
            next[m.id] = true;
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 300);
    return () => window.clearInterval(id);
  }, [sim]);

  const apply = (p: Partial<NetConfig>, debounce = false) => {
    setCfg((c) => ({ ...c, ...p }));
    sim.setNet(p, debounce);
  };
  const j = sim.j;
  const sw = (key: keyof NetConfig, label: string, small: string, on: boolean, value: (v: boolean) => Partial<NetConfig>) => (
    <label className={css.switch} key={key}>
      <span>
        {label}
        <small>{small}</small>
      </span>
      <input type="checkbox" checked={on} onChange={(e) => apply(value(e.target.checked))} />
    </label>
  );

  return (
    <div className={css.pg}>
      <div className={css.pgGroup}>
        <Range label="Round trip (RTT)" note={distanceLabel(cfg.rtt)} value={cfg.rtt} min={5} max={250} step={5} format={(v) => `${v} ms`} onChange={(v) => apply({ rtt: v }, true)} />
        <div style={{ height: 6 }} />
        <Range label="Server think time" value={cfg.serverMs} min={10} max={400} step={10} format={(v) => `${v} ms`} onChange={(v) => apply({ serverMs: v }, true)} />
      </div>

      <div className={css.pgGroup}>
        <div className={css.pgLabel}>TLS version</div>
        <div className={css.segCtl} role="group" aria-label="TLS version">
          {(['1.2', '1.3'] as const).map((v) => (
            <button key={v} type="button" aria-pressed={cfg.tls === v} onClick={() => apply({ tls: v })}>
              TLS {v}
            </button>
          ))}
        </div>
        <div className={css.pgLabel} style={{ marginTop: 14 }}>
          app.js
        </div>
        <div className={css.segCtl} role="group" aria-label="Script loading">
          {(['blocking', 'defer'] as const).map((v) => (
            <button key={v} type="button" aria-pressed={cfg.script === v} onClick={() => apply({ script: v })}>
              {v === 'blocking' ? '<script>' : '<script defer>'}
            </button>
          ))}
        </div>
      </div>

      <div className={`${css.pgGroup} ${css.switches}`}>
        {sw('dnsCached', 'DNS answer cached', 'Skip the lookup (within the TTL)', cfg.dnsCached, (v) => ({ dnsCached: v }))}
        {sw('reuse', 'Reuse the connection', 'Keep-alive: no TCP or TLS handshake', cfg.reuse, (v) => ({ reuse: v }))}
        {sw('assetsCached', 'app.css and app.js cached', 'Served from the HTTP cache', cfg.assetsCached, (v) => ({ assetsCached: v }))}
        {sw('dropSyn', 'Lose the first SYN', 'One unlucky packet', cfg.dropSyn, (v) => ({ dropSyn: v }))}
        <div className={css.presets}>
          <button type="button" onClick={() => apply({ dnsCached: false, reuse: false, assetsCached: false })}>
            First visit
          </button>
          <button type="button" onClick={() => apply({ ...WARM })}>
            Repeat visit
          </button>
        </div>
        <div className={css.stats}>
          <span>
            TTFB <b>{fmtMs(j.marks.ttfb)}</b>
          </span>
          <span>
            first paint <b>{fmtMs(j.marks.fcp)}</b>
          </span>
          <span>
            round trips before first byte <b>{j.rtts}</b>
          </span>
        </div>
      </div>

      <div className={css.pgGroup}>
        <div className={css.pgLabel}>Challenges</div>
        <div className={css.missions}>
          {MISSIONS.map((m) => {
            const ok = !!done[m.id];
            return (
              <div key={m.id} className={css.mission} data-done={ok}>
                <div className={css.missionTitle}>
                  {ok && <Icon name="check" size={15} />}
                  {m.title}
                </div>
                <div className={css.missionText}>{m.text}</div>
                {!ok && <div className={css.missionHint}>{m.hint}</div>}
              </div>
            );
          })}
        </div>
      </div>

      <CodeBlock spec={{ title: 'DevTools › Timing · live', lang: 'http', code: timingText(j) }} />
    </div>
  );
}

/** A small card that shows the live numbers for the slider step. */
export function LiveNumbers({ sim }: { sim: JourneySim }) {
  usePoll(sim, 250);
  const m = sim.j.marks;
  const c = sim.j.cfg;
  const hs = c.reuse ? 0 : m.tlsEnd - m.dnsEnd;
  return (
    <div className={css.stats}>
      <span>
        TTFB <b>{fmtMs(m.ttfb)}</b>
      </span>
      <span>
        handshakes <b>{fmtMs(hs)}</b>
      </span>
      <span>
        first paint <b>{fmtMs(m.fcp)}</b>
      </span>
    </div>
  );
}

