'use client';

import { useState, type CSSProperties, type ReactNode } from 'react';
import { CodeBlock } from '@/components/lesson/CodeBlock';
import { Icon } from '@/components/lesson/Icon';
import { lessonCss } from '@/components/lesson/Prose';
import { usePoll } from '@/components/lesson/usePoll';
import { SORT_ITEMS } from './content';
import { wiresharkTree } from './fields';
import { ALL_LAYERS, APPS, LAYERS, build, type AppKind, type LayerN, type LinkKind, type ModelKind } from './model';
import type { OsiSim, ViewKind } from './sim';
import css from './osi.module.css';

function Kicker({ icon = 'bolt', children, right }: { icon?: 'bolt' | 'target' | 'power' | 'flag'; children: ReactNode; right?: ReactNode }) {
  return (
    <div className={css.cardTop}>
      <div className={lessonCss.cardKicker}>
        <Icon name={icon} size={13} /> {children}
      </div>
      {right}
    </div>
  );
}

function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: { id: T; label: string; disabled?: boolean }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className={css.seg} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" aria-pressed={value === o.id} disabled={o.disabled} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Swap a layer                                                        */
/* ------------------------------------------------------------------ */

export function SwapCard({ sim }: { sim: OsiSim }) {
  const [link, setLink] = useState<LinkKind>('ethernet');
  const [app, setApp] = useState<AppKind>('http');
  const [last, setLast] = useState<'link' | 'app' | null>(null);
  return (
    <div className={lessonCss.card}>
      <Kicker>Try it · swap a layer</Kicker>
      <p className={lessonCss.cardQ}>Change one layer and watch which rows change on the stage.</p>
      <div className={css.ctlLabel}>Alice’s link (layers 1–2)</div>
      <Seg
        label="Link"
        value={link}
        options={[
          { id: 'ethernet', label: 'Ethernet cable' },
          { id: 'wifi', label: 'Wi-Fi' },
        ]}
        onChange={(v) => {
          setLink(v);
          setLast('link');
          sim.setLink(v);
        }}
      />
      <div className={css.ctlLabel}>The application (layer 7)</div>
      <Seg
        label="Application"
        value={app}
        options={[
          { id: 'http', label: 'Web page (HTTP)' },
          { id: 'smtp', label: 'Email (SMTP)' },
        ]}
        onChange={(v) => {
          setApp(v);
          setLast('app');
          sim.setApp(v);
        }}
      />
      {last === 'link' && (
        <p key={`l-${link}`} className={css.after}>
          {link === 'wifi' ? (
            <>
              Only Alice’s layers 1 and 2 changed: <strong>radio</strong> instead of copper, and an <strong>802.11 header</strong> with three MAC addresses instead of Ethernet’s two. The IP packet inside is identical. The access point swaps the header back to Ethernet, so the server never knows.
            </>
          ) : (
            <>Back to copper and a 14-byte Ethernet header. Layers 3 to 7 never noticed either change.</>
          )}
        </p>
      )}
      {last === 'app' && (
        <p key={`a-${app}`} className={css.after}>
          {app === 'smtp' ? (
            <>
              The data is now an SMTP command, <code>EHLO alice.example</code>. TCP, IP and Ethernet wrap it exactly the same way. The one field that tells them apart is TCP’s <strong>destination port: 25</strong> instead of 80, which is how the server hands it to the mail server instead of the web server.
            </>
          ) : (
            <>Back to HTTP on port 80. TCP, IP and Ethernet carried both without caring what was inside.</>
          )}
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Wireshark-style tree, synced with the stage selection               */
/* ------------------------------------------------------------------ */

export function PacketTree({ sim }: { sim: OsiSim }) {
  usePoll(sim, 120, true);
  const b = sim.built(0, sim.cfg.ttl);
  const nodes = wiresharkTree(sim.cfg.app, b);
  const sel = sim.selected;
  return (
    <figure className={css.tree}>
      <figcaption className={css.treeHead}>
        <span className={lessonCss.codeDots} aria-hidden>
          <i />
          <i />
          <i />
        </span>
        Wireshark · Alice’s eth0
        <small>in the real world</small>
      </figcaption>
      {nodes.map((n, i) => {
        const open = sel != null && n.layer === sel;
        const color = n.layer ? LAYERS[n.layer].color : 'var(--text-2)';
        return (
          <button
            key={i}
            type="button"
            className={css.treeNode}
            aria-expanded={open}
            style={{ '--c': color } as CSSProperties}
            onClick={() => sim.select(open ? null : n.layer)}
          >
            <div className={css.treeLine}>
              <i>{open ? '▾' : '▸'}</i>
              <span>{n.head}</span>
            </div>
            {open && (
              <div className={css.treeKids}>
                {n.lines.map((l, j) => (
                  <div key={j}>{l}</div>
                ))}
              </div>
            )}
          </button>
        );
      })}
    </figure>
  );
}

/* ------------------------------------------------------------------ */
/* The frame as raw bytes, colored by the layer that wrote them        */
/* ------------------------------------------------------------------ */

const DUMP_REGIONS: { n: LayerN; name: string; len: number }[] = [
  { n: 2, name: 'Ethernet', len: 14 },
  { n: 3, name: 'IP', len: 20 },
  { n: 4, name: 'TCP', len: 20 },
  { n: 7, name: 'HTTP', len: 75 },
];

export function HexDump() {
  const bytes = build('http', { seg: 0, ttl: 64, link: 'ethernet' }).frame;
  const layerAt = (i: number) => {
    let off = 0;
    for (const r of DUMP_REGIONS) {
      if (i < off + r.len) return r.n;
      off += r.len;
    }
    return 7 as LayerN;
  };
  const lines: number[][] = [];
  for (let i = 0; i < bytes.length; i += 16) lines.push(bytes.slice(i, i + 16).map((_, j) => i + j));
  return (
    <figure className={lessonCss.code}>
      <figcaption className={lessonCss.codeHead}>
        <span className={lessonCss.codeDots} aria-hidden>
          <i />
          <i />
          <i />
        </span>
        <span>tcpdump -xx</span>
        <span className={lessonCss.codeTag}>in the real world</span>
      </figcaption>
      <pre className={lessonCss.pre}>
        <div className={lessonCss.line}>
          <span style={{ color: 'var(--sig-res)' }}>$</span> sudo tcpdump -i eth0 -xx -c 1 &apos;tcp port 80&apos;
        </div>
        {lines.map((idx, li) => (
          <div key={li} className={lessonCss.line}>
            <span style={{ color: 'var(--text-3)' }}>0x{(li * 16).toString(16).padStart(4, '0')}:</span>{' '}
            {idx.map((i, j) => (
              <span key={i} style={{ color: LAYERS[layerAt(i)].color }}>
                {j % 2 === 0 ? ' ' : ''}
                {bytes[i].toString(16).padStart(2, '0')}
              </span>
            ))}
          </div>
        ))}
      </pre>
      <p className={lessonCss.codeNote}>
        {DUMP_REGIONS.map((r, i) => (
          <span key={r.n}>
            {i > 0 && ' · '}
            <b style={{ color: LAYERS[r.n].color, fontWeight: 500 }}>{r.name}</b> {r.len} B
          </span>
        ))}
        . One run of bytes, headers first: <code>4745 5420</code> is “GET ” in ASCII. The FCS isn’t captured.
      </p>
    </figure>
  );
}

/* ------------------------------------------------------------------ */
/* Sorting game                                                        */
/* ------------------------------------------------------------------ */

export function SortCard({ sim }: { sim: OsiSim }) {
  usePoll(sim, 120, true);
  const item = sim.sortItem;
  const placed = sim.sortPlaced;
  const score = sim.sortScore;
  return (
    <div className={lessonCss.card}>
      <Kicker
        icon="target"
        right={
          <span className={css.score} aria-label={`${score} of ${SORT_ITEMS.length} right`}>
            {SORT_ITEMS.map((it, i) => (
              <i key={it.id} data-on={i < placed.length ? (placed[i].ok ? 'ok' : 'bad') : undefined} />
            ))}
          </span>
        }
      >
        Your turn · sort
      </Kicker>
      {item ? (
        <>
          <p className={lessonCss.cardQ}>Which layer does this live at?</p>
          <div key={item.id} className={css.sortItem}>
            {item.label}
          </div>
          <div className={css.layerGrid}>
            {ALL_LAYERS.map((n) => (
              <button key={n} type="button" className={css.layerBtn} style={{ '--c': LAYERS[n].color } as CSSProperties} onClick={() => sim.sortAnswer(n)}>
                <b>{n}</b> {LAYERS[n].name}
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <p className={lessonCss.cardQ}>
            {score} of {SORT_ITEMS.length} right.{' '}
            {score >= SORT_ITEMS.length - 1 ? 'You know your layers.' : score >= 8 ? 'Nearly there. Check the red tags on the stage.' : 'The red tags on the stage show where those belong.'}
          </p>
          <div className={css.btnRow}>
            <button type="button" className={css.btn} onClick={() => sim.sortRestart()}>
              <Icon name="replay" size={14} /> Sort again
            </button>
          </div>
        </>
      )}
      {sim.sortLast && (
        <div key={sim.sortLast.key} className={css.feedback} data-ok={sim.sortLast.ok}>
          <strong>{sim.sortLast.ok ? 'Right.' : 'Not quite.'}</strong> {sim.sortLast.text}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* traceroute: send your own probe                                     */
/* ------------------------------------------------------------------ */

export function TtlCard({ sim }: { sim: OsiSim }) {
  usePoll(sim, 120, true);
  const [ttl, setTtl] = useState(2);
  const p = sim.traceProbe;
  const fill = ((ttl - 1) / 7) * 100;
  return (
    <div className={lessonCss.card}>
      <Kicker>Try it · send a probe</Kicker>
      <p className={lessonCss.cardQ}>What is the smallest TTL that reaches shop.example?</p>
      <div className={css.ctlLabel}>
        Starting TTL <output>{ttl}</output>
      </div>
      <input
        className={css.range}
        type="range"
        min={1}
        max={8}
        step={1}
        value={ttl}
        style={{ '--fill': `${fill}%` } as CSSProperties}
        onChange={(e) => setTtl(Number(e.target.value))}
        aria-label="Starting TTL"
      />
      <div className={css.scale}>
        <span>1</span>
        <span>8</span>
      </div>
      <div className={css.btnRow}>
        <button type="button" className={`${css.btn} ${css.btnHot}`} disabled={sim.traceBusy} onClick={() => sim.sendProbe(ttl)}>
          <Icon name="arrowRight" size={14} /> {sim.traceBusy ? 'Probe in flight…' : `Send a probe with TTL ${ttl}`}
        </button>
      </div>
      {p && (
        <p key={`${p.ttl}-${p.result}`} className={css.after}>
          <strong>TTL {p.ttl}:</strong> {p.result}{' '}
          {p.ok && p.ttl === 5 && <strong>5 is the smallest: each of the four routers takes one, and the packet still needs 1 left when it arrives.</strong>}
          {p.ok && p.ttl > 5 && <>Try a smaller one.</>}
          {!p.ok && <>Try a bigger one.</>}
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Playground                                                          */
/* ------------------------------------------------------------------ */

const MISSIONS: { id: 'dns' | 'httpsWifi' | 'ttl'; title: string; text: string }[] = [
  { id: 'dns', title: 'Look up a name', text: 'Send a DNS lookup. Spot the difference: an 8-byte UDP header instead of TCP’s 20, and no sequence numbers.' },
  { id: 'httpsWifi', title: 'Secret over the air', text: 'Deliver a secure page over Wi-Fi. The access point and the router forward it without reading a byte of the encrypted data.' },
  { id: 'ttl', title: 'Run out of hops', text: 'Make a router throw a packet away before it arrives. (Hint: the TTL slider.)' },
];

export function Playground({ sim, initial }: { sim: OsiSim; initial: { app: AppKind; link: LinkKind; view: ViewKind; model: ModelKind; ttl: number } }) {
  usePoll(sim, 200, true);
  const [app, setApp] = useState(initial.app);
  const [link, setLink] = useState(initial.link);
  const [view, setView] = useState(initial.view);
  const [model, setModel] = useState(initial.model);
  const [ttl, setTtl] = useState(initial.ttl);
  const stats = sim.pgStats;
  const b = sim.built(0, ttl);
  const tree = wiresharkTree(app, b).map((n) => n.head);
  const fill = ((ttl - 1) / 63) * 100;
  return (
    <div className={css.pg}>
      <div className={css.pgGroup}>
        <div className={css.ctlLabel}>What Alice sends</div>
        <Seg
          label="Traffic"
          value={app}
          options={(['http', 'https', 'dns', 'video'] as AppKind[]).map((id) => ({ id, label: APPS[id].label }))}
          onChange={(v) => {
            setApp(v);
            sim.setApp(v);
          }}
        />
        <div className={css.ctlLabel}>How she’s connected</div>
        <Seg
          label="Link"
          value={link}
          options={[
            { id: 'ethernet', label: 'Ethernet' },
            { id: 'wifi', label: 'Wi-Fi' },
          ]}
          onChange={(v) => {
            setLink(v);
            sim.setLink(v);
          }}
        />
      </div>

      <div className={css.pgGroup}>
        <div className={css.ctlLabel}>Show</div>
        <Seg
          label="View"
          value={view}
          options={[
            { id: 'path', label: 'Whole path' },
            { id: 'stack', label: 'Two stacks' },
          ]}
          onChange={(v) => {
            setView(v);
            sim.setView(v);
          }}
        />
        <Seg
          label="Model"
          value={model}
          options={[
            { id: 'osi', label: 'OSI · 7 layers' },
            { id: 'tcpip', label: 'TCP/IP · 4' },
          ]}
          onChange={(v) => {
            setModel(v);
            sim.setModel(v);
          }}
        />
        <div className={css.ctlLabel}>
          Starting TTL <output>{ttl}</output>
        </div>
        <input
          className={css.range}
          type="range"
          min={1}
          max={64}
          step={1}
          value={ttl}
          style={{ '--fill': `${fill}%` } as CSSProperties}
          onChange={(e) => {
            const v = Number(e.target.value);
            setTtl(v);
            sim.setTtl(v);
          }}
          aria-label="Starting TTL"
        />
        <div className={css.btnRow}>
          <button type="button" className={`${css.btn} ${css.btnHot}`} onClick={() => sim.sendAgain()}>
            <Icon name="arrowRight" size={14} /> Send it now
          </button>
        </div>
      </div>

      <div className={css.pgGroup}>
        <div className={css.ctlLabel}>Challenges</div>
        <div className={css.missions}>
          {MISSIONS.map((m) => (
            <div key={m.id} className={css.mission} data-done={stats[m.id]}>
              <div className={css.missionTitle}>
                {stats[m.id] && <Icon name="check" size={15} />}
                {m.title}
              </div>
              <div className={css.missionText}>{m.text}</div>
            </div>
          ))}
        </div>
      </div>

      <CodeBlock spec={{ title: 'Wireshark summary · live', lang: 'http', code: tree.join('\n') }} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Cheat sheet                                                         */
/* ------------------------------------------------------------------ */

const SHEET: [LayerN, string, string, string][] = [
  [7, 'what the program says', 'data', 'HTTP, DNS, SMTP, SSH'],
  [6, 'encoding, encryption', 'data', 'TLS*, UTF-8, gzip, JPEG'],
  [5, 'open and close dialogs', 'data', 'mostly inside apps'],
  [4, 'program to program', 'segment', 'TCP, UDP, ports · L4 load balancer'],
  [3, 'across networks', 'packet', 'IP, ICMP · router'],
  [2, 'next hop on the link', 'frame', 'Ethernet, Wi-Fi, MACs · switch, access point'],
  [1, 'bits as signals', 'bits', 'copper, fiber, radio · hub, repeater'],
];

export function CheatSheet() {
  return (
    <>
      <table className={css.table}>
        <thead>
          <tr>
            <th>#</th>
            <th>Layer</th>
            <th>Examples</th>
            <th>Unit</th>
          </tr>
        </thead>
        <tbody>
          {SHEET.map(([n, job, unit, ex]) => (
            <tr key={n} style={{ '--c': LAYERS[n].color } as CSSProperties}>
              <td>{n}</td>
              <td>
                {LAYERS[n].name}
                <div style={{ fontWeight: 400, fontSize: 11.5, color: 'var(--text-3)' }}>{job}</div>
              </td>
              <td>{ex}</td>
              <td>{unit}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="" style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--text-3)' }}>
        * TLS doesn’t fit neatly. It’s usually filed under 6, sometimes 5. TCP/IP just calls 5–7 “application”.
      </p>

      <p className={css.subhead}>Remember</p>
      <ul className={css.takeaways}>
        <li>
          Each layer does <strong>one job</strong> and wraps what the layer above gave it in its own header: <strong>encapsulation</strong>.
        </li>
        <li>
          Going up, each layer strips its header and uses one field to pick the next handler: <strong>EtherType → protocol → port</strong>.
        </li>
        <li>
          A <strong>switch</strong> reads layer 2 and changes nothing. A <strong>router</strong> reads layer 3, counts the TTL down and builds a new frame.
        </li>
        <li>
          <strong>MACs change at every hop; IPs stay the same</strong> end to end (unless NAT rewrites them).
        </li>
        <li>
          The internet runs the 4-layer <strong>TCP/IP</strong> model. OSI supplies the vocabulary: L2 switch, L4 load balancer, L7 firewall.
        </li>
        <li>
          Debug <strong>bottom-up</strong>: link, IP, port, then the application.
        </li>
      </ul>
    </>
  );
}
