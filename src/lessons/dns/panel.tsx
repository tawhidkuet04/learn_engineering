'use client';

import { useState, type CSSProperties, type ReactNode } from 'react';
import { CodeBlock, type CodeLang, type CodeSpec } from '@/components/lesson/CodeBlock';
import { Icon } from '@/components/lesson/Icon';
import { lessonCss } from '@/components/lesson/Prose';
import { usePoll } from '@/components/lesson/usePoll';
import type { DnsSim } from './sim';
import { fmtRR, fqdn, nameWidth, type RR, type RRType } from './zones';
import css from './dns.module.css';

/* ------------------------------------------------------------------ */
/* Code blocks for dig output and zone files (';' starts a comment)    */
/* ------------------------------------------------------------------ */

export interface DnsCodeSpec {
  title: string;
  lang: CodeLang | 'dig' | 'zone';
  code: string;
  note?: string;
}

const TYPE_RE = /(?<=^|\s)(IN|A|AAAA|NS|CNAME|MX|TXT|SOA)(?=\s|$)/;

function tokens(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /("[^"]*"|\$[A-Z]+|(?<=^|\s)(?:IN|A|AAAA|NS|CNAME|MX|TXT|SOA)(?=\s|$)|(?<![\w.-])\d[\w.:-]*)/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    const i = m.index ?? 0;
    if (i > last) out.push(text.slice(last, i));
    const tok = m[0];
    const cls = tok.startsWith('"') ? lessonCss.tStr : tok.startsWith('$') || TYPE_RE.test(tok) ? lessonCss.tKey : lessonCss.tNum;
    out.push(
      <span key={`${keyPrefix}${i}`} className={cls}>
        {tok}
      </span>,
    );
    last = i + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function commentAt(line: string, ch: string) {
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') inQ = !inQ;
    else if (!inQ && line[i] === ch) return i;
  }
  return -1;
}

function dnsLine(line: string): ReactNode[] {
  if (line.startsWith('$ ')) {
    const c = commentAt(line, '#');
    const cmd = c >= 0 ? line.slice(2, c) : line.slice(2);
    const [first, ...rest] = cmd.split(' ');
    return [
      <span key="p" className={lessonCss.tPunct}>
        ${' '}
      </span>,
      <span key="c" className={lessonCss.tKey}>
        {first}
      </span>,
      rest.length ? ` ${rest.join(' ')}` : '',
      c >= 0 ? (
        <span key="k" className={lessonCss.tComment}>
          {line.slice(c)}
        </span>
      ) : null,
    ];
  }
  const c = commentAt(line, ';');
  const body = c >= 0 ? line.slice(0, c) : line;
  const out = tokens(body, 't');
  if (c >= 0) {
    out.push(
      <span key="cm" className={lessonCss.tComment}>
        {line.slice(c)}
      </span>,
    );
  }
  return out;
}

export function DnsCode({ spec }: { spec: DnsCodeSpec }) {
  if (spec.lang !== 'dig' && spec.lang !== 'zone') return <CodeBlock spec={spec as CodeSpec} />;
  const lines = spec.code.replace(/^\n+|\n+$/g, '').split('\n');
  return (
    <figure className={lessonCss.code}>
      <figcaption className={lessonCss.codeHead}>
        <span className={lessonCss.codeDots} aria-hidden>
          <i />
          <i />
          <i />
        </span>
        <span>{spec.title}</span>
        <span className={lessonCss.codeTag}>in the real world</span>
      </figcaption>
      <pre className={lessonCss.pre}>
        {lines.map((raw, i) => {
          const hot = raw.startsWith('!');
          const line = hot ? raw.slice(1) : raw;
          return (
            <div key={i} className={hot ? lessonCss.lineHot : lessonCss.line}>
              {dnsLine(line)}
              {line === '' ? ' ' : null}
            </div>
          );
        })}
      </pre>
      {spec.note && <p className={lessonCss.codeNote}>{spec.note}</p>}
    </figure>
  );
}

/* ------------------------------------------------------------------ */
/* Step through a lookup, one held message at a time                    */
/* ------------------------------------------------------------------ */

function Kicker({ icon = 'target', children }: { icon?: 'target' | 'bolt' | 'flag' | 'power'; children: ReactNode }) {
  return (
    <div className={lessonCss.cardKicker}>
      <Icon name={icon} size={13} /> {children}
    </div>
  );
}

export function ContinueCard({ sim, prompt, onRestart }: { sim: DnsSim; prompt: ReactNode; onRestart: () => void }) {
  usePoll(sim, 150);
  const holding = sim.holding;
  const finished = !sim.lookups.length && !!sim.last;
  return (
    <div className={lessonCss.card}>
      <Kicker icon="bolt">Your turn · step through</Kicker>
      <p className={lessonCss.cardQ}>{prompt}</p>
      <div className={css.row}>
        <button type="button" className={`${css.btn} ${css.btnHot}`} disabled={!holding} onClick={() => sim.releaseHeld()}>
          Continue
          <Icon name="arrowRight" size={14} />
        </button>
        <button type="button" className={css.btn} onClick={onRestart}>
          <Icon name="replay" size={14} /> Start over
        </button>
      </div>
      <p className={css.after}>
        {holding ? (
          <>
            A <strong>referral</strong> is waiting at the resolver. Find the NS records and the glue in the card.
          </>
        ) : finished ? (
          <>
            <strong>Done.</strong> Two referrals and one answer. Look at the resolver’s cache: it kept all of them.
          </>
        ) : (
          <>Messages in flight…</>
        )}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Cheat sheet                                                         */
/* ------------------------------------------------------------------ */

const WHO_ROWS: [string, string, ReactNode][] = [
  ['Stub resolver', 'Just its resolver’s address', <code key="s">/etc/resolv.conf</code>],
  ['Recursive resolver', 'Walks the tree, caches everything', <code key="r">1.1.1.1, your ISP</code>],
  ['Root server', 'Where each TLD’s servers are', <code key="o">a–m.root-servers.net</code>],
  ['TLD server', 'Where each domain’s servers are', <code key="t">a.gtld-servers.net</code>],
  ['Authoritative', 'The actual records (the zone)', <code key="a">ns1.shop.example</code>],
];

const TYPE_ROWS: [string, string, string][] = [
  ['A / AAAA', 'IPv4 / IPv6 address', '203.0.113.10'],
  ['CNAME', 'Alias: look up this name instead', 'shop.cdn.example.'],
  ['MX', 'Mail servers, lowest priority first', '10 mail.shop.example.'],
  ['NS', 'The zone’s name servers', 'ns1.shop.example.'],
  ['TXT', 'Text: ownership proofs, SPF', '"v=spf1 mx -all"'],
  ['SOA', 'Zone settings: serial, negative TTL', '2026092601 … 300'],
];

export function CheatSheet() {
  return (
    <>
      <p className={css.subhead}>Who knows what</p>
      <table className={css.table}>
        <tbody>
          {WHO_ROWS.map(([a, b, c]) => (
            <tr key={a}>
              <td>{a}</td>
              <td>{b}</td>
              <td>{c}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className={css.subhead}>Record types</p>
      <table className={css.table}>
        <tbody>
          {TYPE_ROWS.map(([a, b, c]) => (
            <tr key={a}>
              <td>{a}</td>
              <td>{b}</td>
              <td>
                <code>{c}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className={css.subhead}>Remember</p>
      <ul className={css.takeaways}>
        <li>
          DNS is a <strong>tree of zones</strong>. Each level delegates the one below, so no server knows everything.
        </li>
        <li>
          Your stub asks one <strong>recursive resolver</strong>, which walks root → TLD → authoritative with <strong>iterative</strong> queries.
        </li>
        <li>
          <strong>Referrals</strong> (NS records plus glue) point one level down. Only the authoritative server answers with <code>aa</code>.
        </li>
        <li>
          Everything is cached for its <strong>TTL</strong>: answers, referrals, and even “no such name” (<strong>negative caching</strong>).
        </li>
        <li>
          “Propagation” is just <strong>caches expiring</strong>. Lower the TTL before you change a record.
        </li>
        <li>
          Plain DNS is <strong>UDP port 53</strong> (TCP when answers are big), readable by anyone on the path unless you use <strong>DoT or DoH</strong>.
        </li>
      </ul>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Playground                                                          */
/* ------------------------------------------------------------------ */

const PG_NAMES: [string, string][] = [
  ['shop.example', 'the shop itself'],
  ['www.shop.example', 'an alias to the CDN'],
  ['api.shop.example', 'same zone as the shop'],
  ['cdn.example', 'another domain in .example'],
  ['static.cdn.example', 'inside cdn.example'],
  ['mail.shop.example', 'the mail server'],
  ['shpo.example', 'a typo: no such domain'],
  ['sale.shop.example', 'no such name in the zone'],
];

const PG_TYPES: RRType[] = ['A', 'AAAA', 'MX', 'TXT', 'NS'];

export const MISSIONS: { id: string; title: string; text: string; hint: string }[] = [
  { id: 'source', title: 'Straight to the source', text: 'Make the resolver’s very first query go to an authoritative server.', hint: 'Hint: it needs a cached referral for the name’s zone.' },
  { id: 'nocall', title: 'Zero queries sent', text: 'Get an answer from the resolver without it asking anyone.', hint: 'Hint: ask for something it has just learned.' },
  { id: 'no', title: 'Remember “no”', text: 'Get an NXDOMAIN answered straight from the negative cache.', hint: 'Hint: make the same typo twice.' },
  { id: 'long', title: 'The long way round', text: 'Make a single lookup touch 4 different servers.', hint: 'Hint: an alias into another zone, on an empty cache.' },
];

function Range({ value, min, max, onChange, label }: { value: number; min: number; max: number; onChange: (v: number) => void; label: string }) {
  return (
    <input
      className={css.range}
      type="range"
      min={min}
      max={max}
      step={5}
      value={value}
      style={{ '--fill': `${((value - min) / (max - min)) * 100}%` } as CSSProperties}
      onChange={(e) => onChange(Number(e.target.value))}
      aria-label={label}
    />
  );
}

function digOutput(sim: DnsSim) {
  const r = sim.last;
  if (!r) return '$ dig shop.example\n; pick a name above to send a query';
  const rrs: RR[] = r.answer;
  const nw = nameWidth(rrs, fqdn(r.qname).length);
  const how = r.from === 'stub' ? 'from Alice’s OS cache' : r.upstream === 0 ? 'from the resolver’s cache' : `${r.upstream} ${r.upstream === 1 ? 'query' : 'queries'} upstream: ${r.hops.join(' → ')}`;
  const lines = [`$ dig ${r.qname}${r.qtype === 'A' ? '' : ` ${r.qtype}`}`, `;; status: ${r.status} · ${how}`];
  if (rrs.length) {
    lines.push(';; ANSWER SECTION:');
    rrs.forEach((x, i) => lines.push(`!${fmtRR(x, nw, r.ttls[i])}`));
  } else lines.push(`;; (no ${r.qtype} records)`);
  lines.push(`;; Query time: ${r.ms} msec`);
  return lines.join('\n');
}

export function Playground({ sim }: { sim: DnsSim }) {
  usePoll(sim, 250);
  const [type, setType] = useState<RRType>('A');
  const [ttl, setTtl] = useState(300);
  const s = sim.stats;
  const hitRate = s.answered ? Math.round(((s.resHits + s.stubHits) / s.answered) * 100) : 0;
  return (
    <div className={css.pg}>
      <div className={css.pgGroup}>
        <div className={css.pgLabel}>
          Look up <output>type {type}</output>
        </div>
        <div className={css.types} role="group" aria-label="Record type">
          {PG_TYPES.map((t) => (
            <button key={t} type="button" aria-pressed={type === t} onClick={() => setType(t)}>
              {t}
            </button>
          ))}
        </div>
        <div className={css.names}>
          {PG_NAMES.map(([n, why]) => (
            <button key={n} type="button" className={css.nameBtn} onClick={() => sim.query(n, type)}>
              {n}
              <small>{why}</small>
            </button>
          ))}
        </div>
      </div>

      <div className={css.pgGroup}>
        <label className={css.switch}>
          <span>
            Resolver cache
            <small>Off: every lookup walks the whole tree</small>
          </span>
          <input type="checkbox" checked={sim.cfg.resCache} onChange={(e) => sim.setResCache(e.target.checked)} />
        </label>
        <label className={css.switch}>
          <span>
            Alice’s OS cache
            <small>On: repeat lookups never leave the laptop</small>
          </span>
          <input type="checkbox" checked={sim.cfg.stubCache} onChange={(e) => sim.setStubCache(e.target.checked)} />
        </label>
        <div className={css.row}>
          <button type="button" className={css.btn} onClick={() => sim.flushResolver()}>
            <Icon name="replay" size={14} /> Flush resolver cache
          </button>
          <button type="button" className={css.btn} onClick={() => sim.flushStub()}>
            <Icon name="replay" size={14} /> Flush OS cache
          </button>
        </div>
        <div className={css.pgLabel} style={{ marginTop: 14 }}>
          TTL of shop.example <output>{ttl} s</output>
        </div>
        <Range
          value={ttl}
          min={5}
          max={600}
          label="TTL of shop.example"
          onChange={(v) => {
            setTtl(v);
            sim.setTtlA(v);
          }}
        />
        <div className={css.stats}>
          <span>
            lookups <b>{s.answered}</b>
          </span>
          <span>
            from cache <b>{hitRate}%</b>
          </span>
          <span>
            root asked <b>{s.rootQueries}×</b>
          </span>
        </div>
      </div>

      <div className={css.pgGroup}>
        <div className={css.pgLabel}>Challenges</div>
        <div className={css.missions}>
          {MISSIONS.map((m) => {
            const done = sim.achieved.has(m.id);
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

      <DnsCode spec={{ title: 'dig · your last lookup', lang: 'dig', code: digOutput(sim) }} />
    </div>
  );
}
