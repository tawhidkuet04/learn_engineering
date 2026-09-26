'use client';

import type { CSSProperties, ReactNode } from 'react';
import { Hud, type HudItem } from '@/components/stage/chrome';
import { StagePrompt } from '@/components/stage/overlays';
import { SIG } from '@/lib/sim/colors';
import { clamp } from '@/lib/sim/geometry';
import { bitsGeo, mapGeo, rowY, v6Geo } from './geo';
import { bcastOf, blockSize, commas, ep, intToIp, ipToInt, maskOf, netOf, octets, placeSum, usableHosts } from './ip';
import { FILL_DUR, FILL_ORDER, FILL_START, MAC, BROADCAST_MAC, type Mapping, type NatSim, type Pkt } from './sim';
import { focusOctet } from './Scene';
import css from './nat.module.css';

const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(' ');

export type HudKey = 'addrs' | 'free' | 'hosts' | 'mappings' | 'public' | 'devices' | 'drops' | 'inbound' | 'v6' | 'bits';
export type ReadoutKey = 'octet' | 'prefix' | 'pool' | 'ranges' | 'v6' | 'laptop' | 'rt' | 'nat' | 'natB' | 'cgnat' | 'server' | 'carol' | 'p2p';

/* ------------------------------------------------------------------ */
/* HUD                                                                 */
/* ------------------------------------------------------------------ */

export function freeBlocks(sim: NatSim) {
  const per = FILL_DUR / FILL_ORDER.length;
  const done = clamp(Math.floor((sim.stepT - FILL_START) / per) + 1, 0, FILL_ORDER.length);
  return FILL_ORDER.length - done;
}

function hudItems(sim: NatSim, keys: HudKey[]): HudItem[] {
  const out: HudItem[] = [];
  for (const k of keys) {
    if (k === 'addrs') out.push({ label: 'IPv4 addresses', value: '4,294,967,296' });
    else if (k === 'bits') out.push({ label: 'Address size', value: 32, unit: 'bits' });
    else if (k === 'free') {
      const f = sim.cfg.map === 'fill' ? freeBlocks(sim) : 0;
      out.push({ label: 'Free /8s at IANA', value: f, tone: f === 0 ? 'bad' : f < 20 ? 'warn' : undefined });
    } else if (k === 'hosts') out.push({ label: 'Usable hosts', value: commas(usableHosts(sim.prefix)) });
    else if (k === 'mappings') out.push({ label: 'NAT mappings', value: sim.liveMappings() });
    else if (k === 'public') out.push({ label: 'Public IPs', value: 1 });
    else if (k === 'devices') out.push({ label: 'Devices online', value: ['laptop', 'phone', 'tv'].filter((d) => sim.boxes.has(d) && sim.active.has(d)).length });
    else if (k === 'drops') out.push({ label: 'Dropped', value: sim.stats.drops, tone: sim.stats.drops ? 'bad' : undefined });
    else if (k === 'inbound') out.push({ label: 'Carol got in', value: `${sim.stats.inOk}/${sim.stats.inTries}`, tone: sim.stats.inOk ? 'good' : sim.stats.inTries ? 'bad' : undefined });
    else if (k === 'v6') out.push({ label: 'IPv6 addresses', value: '3.4 × 10³⁸' });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Readout shell                                                       */
/* ------------------------------------------------------------------ */

function Ro({ head, children, fresh, style }: { head: ReactNode; children: ReactNode; fresh?: boolean; style?: CSSProperties }) {
  return (
    <div className={cx(css.ro, fresh && css.roFresh)} style={style}>
      <div className={css.roHead}>{head}</div>
      {children}
    </div>
  );
}

/* ---------------- bits ---------------- */

function OctetReadout({ sim, compact }: { sim: NatSim; compact?: boolean }) {
  const fo = focusOctet(sim);
  const oc = octets(sim.addr);
  const k = fo >= 0 ? fo : 0;
  const sum = placeSum(oc[k]);
  return (
    <Ro head={compact ? `octet ${k + 1} of 4 · ${intToIp(sim.addr)}` : `four octets make one number`}>
      <div className={css.line}>
        octet {k + 1}: {oc[k].toString(2).padStart(8, '0')}
        {sum.includes('+') ? ` = ${sum}` : ''} = <em>{oc[k]}</em>
      </div>
      {!compact && (
        <div className={css.line}>
          {oc[0]}×2²⁴ + {oc[1]}×2¹⁶ + {oc[2]}×2⁸ + {oc[3]}
        </div>
      )}
      <div className={css.result}>
        as one 32-bit number: <b>{commas(sim.addr)}</b>
      </div>
    </Ro>
  );
}

function PrefixReadout({ sim, compact }: { sim: NatSim; compact?: boolean }) {
  const P = sim.prefix;
  const a = sim.addr;
  const hosts = usableHosts(P);
  const first = P >= 31 ? netOf(a, P) : netOf(a, P) + 1;
  const last = P >= 31 ? bcastOf(a, P) : bcastOf(a, P) - 1;
  if (compact) {
    return (
      <Ro head={`${intToIp(a)}/${P} · mask ${intToIp(maskOf(P))}`}>
        <div className={css.line}>
          net <em>{intToIp(netOf(a, P))}</em> · bcast {intToIp(bcastOf(a, P))}
        </div>
        <div className={css.result}>
          2<sup>{32 - P}</sup> = {commas(blockSize(P))} addresses → <b>{commas(hosts)}</b> host{hosts === 1 ? '' : 's'}
        </div>
      </Ro>
    );
  }
  return (
    <Ro head={`${intToIp(a)}/${P}`}>
      <div className={css.kv}>
        <span>mask</span>
        <b>{intToIp(maskOf(P))}</b>
        <span>network</span>
        <b>{intToIp(netOf(a, P))}</b>
        <span>broadcast</span>
        <b>{intToIp(bcastOf(a, P))}</b>
        <span>hosts</span>
        <b>{P >= 32 ? intToIp(a) : `${intToIp(first)} – ${intToIp(last)}`}</b>
      </div>
      <div className={css.result}>
        2<sup>{32 - P}</sup> = {commas(blockSize(P))} addresses{P <= 30 ? ' − 2' : ''} → <b>{commas(hosts)}</b> usable
      </div>
    </Ro>
  );
}

/* ---------------- map ---------------- */

function PoolReadout({ sim, compact }: { sim: NatSim; compact?: boolean }) {
  const f = freeBlocks(sim);
  const done = f === 0;
  return (
    <Ro head="IANA's free pool">
      <div className={css.bigNum}>
        {f} <span className={css.dim} style={{ fontSize: 11 }}>of 221 /8 blocks left</span>
      </div>
      {!compact && (
        <div className={css.keyList} style={{ marginTop: 8 }}>
          <Key color="rgba(143,166,201,0.5)" fill="rgba(143,166,201,0.26)" text="handed out (16,777,216 each)" />
          <Key color="rgba(143,166,201,0.3)" hatch text="reserved: 0, 10, 127, 240–255" />
          <Key color="rgba(181,155,255,0.5)" fill="rgba(181,155,255,0.1)" text="multicast: 224–239" />
        </div>
      )}
      {done && (
        <div className={css.stamp}>
          <b>3 Feb 2011:</b> IANA hands out its last five /8s (102, 103, 104, 179, 185), one per regional registry.
        </div>
      )}
    </Ro>
  );
}

function Key({ color, fill, hatch, text }: { color: string; fill?: string; hatch?: boolean; text: string }) {
  return (
    <div className={css.keyItem}>
      <i className={cx(css.swatch, hatch && css.swatchHatch)} style={{ borderColor: color, background: hatch ? undefined : fill }} />
      <span>{text}</span>
    </div>
  );
}

const RANGES: [string, string, string][] = [
  ['10.0.0.0/8', '16,777,216', '10.0.0.0 – 10.255.255.255'],
  ['172.16.0.0/12', '1,048,576', '172.16.0.0 – 172.31.255.255'],
  ['192.168.0.0/16', '65,536', '192.168.0.0 – 192.168.255.255'],
];

function RangesReadout({ compact }: { compact?: boolean }) {
  if (compact) {
    return (
      <Ro head="private ranges · RFC 1918">
        {RANGES.map(([p, n]) => (
          <div key={p} className={css.line} style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span className={css.priv}>{p}</span>
            <span className={css.dim}>{n}</span>
          </div>
        ))}
      </Ro>
    );
  }
  return (
    <Ro head="private ranges · RFC 1918">
      {RANGES.map(([p, n, r]) => (
        <div key={p} style={{ marginBottom: 5 }}>
          <div className={css.line} style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
            <span className={css.priv}>{p}</span>
            <span>{n}</span>
          </div>
          <div className={css.dim} style={{ fontSize: 10 }}>
            {r}
          </div>
        </div>
      ))}
      <div className={css.result}>
        free for anyone to use inside a network · <b>never routed</b> on the internet
      </div>
    </Ro>
  );
}

function V6Readout({ compact }: { compact?: boolean }) {
  return (
    <Ro head="how many is 2¹²⁸?">
      <div className={css.kv}>
        <span>IPv4</span>
        <b>4.3 × 10⁹</b>
        <span>IPv6</span>
        <b className={css.warn}>3.4 × 10³⁸</b>
        {!compact && (
          <>
            <span>one /64 LAN</span>
            <b>1.8 × 10¹⁹</b>
            <span>a home /56</span>
            <b>256 LANs</b>
          </>
        )}
      </div>
      <div className={css.result}>{compact ? '2⁹⁶ IPv6 addresses per IPv4 address' : <>every IPv4 address could have <b>2⁹⁶</b> IPv6 addresses</>}</div>
    </Ro>
  );
}

/* ---------------- delivery ---------------- */

function LaptopReadout({ sim, compact }: { sim: NatSim; compact?: boolean }) {
  const d = sim.decision;
  const me = sim.labels.laptop?.ip ?? '192.168.1.23';
  const P = d?.prefix ?? sim.lanPrefix;
  if (!d) {
    return (
      <Ro head="laptop · where does it go?">
        <div className={css.dim}>waiting for a packet…</div>
      </Ro>
    );
  }
  const myNet = intToIp(netOf(ipToInt(me), P));
  const dstNet = intToIp(netOf(ipToInt(d.dst), P));
  const arpRows = [...sim.arp.entries()];
  if (compact) {
    return (
      <Ro head={`laptop · ${me}/${P}`} fresh={sim.vt - d.vt < 1}>
        <div className={css.line}>
          dst {d.dst} → net {d.revealed ? <em>{dstNet}</em> : '?'}
        </div>
        <div className={css.result}>
          {d.revealed ? (
            d.local ? (
              <>
                = my network <b>→ deliver directly</b>
              </>
            ) : (
              <>
                ≠ {myNet} <b>→ gateway 192.168.1.1</b>
              </>
            )
          ) : (
            <>
              same network as {myNet}? <b>?</b>
            </>
          )}
        </div>
      </Ro>
    );
  }
  return (
    <Ro head="laptop · where does it go?" fresh={sim.vt - d.vt < 1}>
      <div className={css.kv}>
        <span>mask /{P}</span>
        <b>{intToIp(maskOf(P))}</b>
        <span>me</span>
        <b>
          {me} → <span className={css.priv}>{myNet}</span>
        </b>
        <span>dst</span>
        <b>
          {d.dst} → {d.revealed ? <span className={d.local ? css.priv : css.warn}>{dstNet}</span> : '?'}
        </b>
      </div>
      <div className={css.result}>
        {d.revealed ? (
          d.local ? (
            <>
              same network <b>→ deliver directly (ARP)</b>
            </>
          ) : (
            <>
              different network <b>→ default gateway 192.168.1.1</b>
            </>
          )
        ) : (
          <>
            AND each with the mask. Same network? <b>?</b>
          </>
        )}
      </div>
      {arpRows.length > 0 && (
        <div className={css.lookup}>
          <div className={css.dim} style={{ fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
            ARP cache
          </div>
          {arpRows.map(([ip, v]) => (
            <div key={ip} className={css.line} style={{ background: sim.vt - v.vt < 1.2 ? 'rgba(181,155,255,0.15)' : undefined, borderRadius: 3 }}>
              {ip} → {v.mac}
            </div>
          ))}
        </div>
      )}
    </Ro>
  );
}

function RouteReadout({ sim, compact }: { sim: NatSim; compact?: boolean }) {
  const r = sim.route;
  const hit = r && sim.vt - r.vt < 2.2 ? r.row : -1;
  const rows: [string, string][] = [
    ['192.168.1.0/24', 'LAN (directly connected)'],
    ['0.0.0.0/0', 'WAN via 203.0.113.1 (ISP)'],
  ];
  return (
    <Ro head="router · routing table" fresh={hit >= 0}>
      <div className={css.rt}>
        {rows.map(([p, v], i) => (
          <div key={p} className={cx(css.rtRow, hit === i && css.rtHit)}>
            <span>{p}</span>
            <span className={css.dim}>{compact ? v.replace(' (directly connected)', '').replace(' (ISP)', '') : v}</span>
          </div>
        ))}
      </div>
      <div className={css.result}>
        {r ? (
          <>
            {r.dst}: most specific match <b>0.0.0.0/0 → WAN</b>
          </>
        ) : (
          <span className={css.dim}>waiting for a packet…</span>
        )}
      </div>
    </Ro>
  );
}

/* ---------------- NAT tables ---------------- */

function rowClass(sim: NatSim, m: Mapping) {
  if (m.goneVt != null) return css.natGone;
  if (sim.vt - m.bornVt < 1.4) return css.natNew;
  if (sim.vt - m.hitVt < 0.9) return css.natHit;
  return undefined;
}

export function NatReadout({
  sim,
  id = 'router',
  compact,
  max = 6,
  title,
  cols = 'full',
}: {
  sim: NatSim;
  id?: string;
  compact?: boolean;
  max?: number;
  title?: string;
  /** 'short' drops the remote column for narrow tables */
  cols?: 'full' | 'short';
}) {
  const n = sim.nats.get(id);
  if (!n) return null;
  const rows = n.rows;
  const shown = rows.slice(-max);
  const hidden = rows.length - shown.length;
  const lk = n.lookup && sim.vt - n.lookup.vt < 2.4 ? n.lookup : null;
  const head = title ?? (id === 'cgnat' ? `ISP CGNAT · ${n.pub}` : id === 'routerB' ? `Bob's NAT · ${n.pub}` : `NAT table · public ${n.pub}`);
  const fresh = rows.some((m) => sim.vt - m.bornVt < 1) || !!(lk && sim.vt - lk.vt < 0.8);
  if (!n.on) {
    return (
      <Ro head={id === 'routerB' ? "Bob's router" : 'router'}>
        <div className={css.dim}>no NAT: packets pass through unchanged</div>
      </Ro>
    );
  }
  if (compact) {
    return (
      <Ro head={head} fresh={fresh}>
        <div className={css.natCompact}>
          {shown.length === 0 && <div className={css.dim}>empty</div>}
          {shown.map((m) => (
            <div key={m.id} className={cx(css.natCompactRow, rowClass(sim, m))} style={m.static ? { color: 'var(--accent)' } : undefined}>
              <span>
                {m.static ? '*' : ''}
                <span className={css.priv}>{ep(m.inside)}</span> ↔ :{m.outside.port}
              </span>
              <span>{m.static ? 'port forward' : `${m.proto} ${ep(m.remote)}`}</span>
            </div>
          ))}
          {hidden > 0 && <div className={css.dim}>+{hidden} more</div>}
        </div>
        {lk && !lk.ok && <div className={cx(css.lookup, css.bad)}>:{lk.port} from {lk.from.ip} → no row → drop</div>}
      </Ro>
    );
  }
  const timeout = sim.cfg.timeout;
  const short = cols === 'short';
  const rowCls = (extra?: string) => cx(css.natRow, short && css.natShort, extra);
  return (
    <Ro head={head} fresh={fresh}>
      <div className={css.natTable}>
        <div className={rowCls(css.natHead)}>
          <span>proto</span>
          <span>inside</span>
          <span>outside</span>
          {!short && <span>remote</span>}
          <span>idle</span>
        </div>
        {shown.length === 0 && <div className={css.dim}>empty: nothing has gone out yet</div>}
        {shown.map((m) => {
          const left = m.static ? 1 : clamp(1 - (sim.t - m.last) / timeout, 0, 1);
          return (
            <div key={m.id} className={rowCls(rowClass(sim, m))}>
              <span className={css.dim}>{m.proto}</span>
              <span className={id === 'cgnat' ? css.warnText : css.priv}>{ep(m.inside)}</span>
              <span className={m.static ? css.natStatic : undefined}>:{m.outside.port}</span>
              {!short && <span className={m.static ? css.natStatic : undefined}>{m.static ? 'any (forward)' : ep(m.remote)}</span>}
              {m.static ? (
                <span className={css.natStatic} style={{ fontSize: 9 }}>
                  static
                </span>
              ) : (
                <span className={css.idle}>
                  <i style={{ width: `${left * 100}%`, background: left < 0.25 ? SIG.err : undefined }} />
                </span>
              )}
            </div>
          );
        })}
        {hidden > 0 && <div className={css.dim}>+{hidden} older</div>}
      </div>
      {lk && (
        <div className={cx(css.lookup, lk.ok ? css.good : css.bad)}>
          in: {lk.proto} :{lk.port} from {ep(lk.from)} → {lk.ok ? 'row found ✓' : 'no row → drop'}
        </div>
      )}
    </Ro>
  );
}

/* ---------------- logs ---------------- */

function ServerReadout({ sim }: { sim: NatSim }) {
  const log = sim.serverLog;
  return (
    <Ro head="web server · who connected" fresh={!!log[0] && sim.vt - log[0].vt < 1}>
      {log.length === 0 ? (
        <div className={css.dim}>no connections yet</div>
      ) : (
        <div className={css.log}>
          {log.slice(0, 3).map((l, i) => (
            <div key={`${l.vt}-${i}`} className={css.logLine}>
              {l.text}
            </div>
          ))}
        </div>
      )}
    </Ro>
  );
}

function CarolReadout({ sim }: { sim: NatSim }) {
  const log = sim.carolLog;
  return (
    <Ro head="Carol · opening :8080" fresh={!!log[0] && sim.vt - log[0].vt < 1}>
      {log.length === 0 ? (
        <div className={css.dim}>not tried yet</div>
      ) : (
        <div className={css.log}>
          {log.slice(0, 3).map((l, i) => (
            <div key={l.pid ?? i} className={css.logLine} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, opacity: i === 0 ? 1 : 0.55 }}>
              <span>{l.text}</span>
              <span className={l.tone === 'ok' ? css.good : l.tone === 'bad' ? css.bad : css.dim}>{l.status}</span>
            </div>
          ))}
        </div>
      )}
    </Ro>
  );
}

function P2pReadout({ sim, compact }: { sim: NatSim; compact?: boolean }) {
  const s = sim.p2p;
  return (
    <Ro head="peer to peer" fresh={sim.stats.punched}>
      <div className={css.line} style={{ whiteSpace: 'normal' }}>
        {s.phase || 'starting…'}
      </div>
      {!compact && (
        <div className={css.kv} style={{ marginTop: 5 }}>
          <span>Alice</span>
          <b>{s.alice ? ep(s.alice) : '?'}</b>
          <span>Bob</span>
          <b>{s.bob ? ep(s.bob) : '?'}</b>
        </div>
      )}
      <div className={css.result}>
        {sim.stats.punched ? <b className={css.good}>hole punched: direct connection ✓</b> : compact ? `Alice ${s.alice ? ep(s.alice) : '?'} · Bob ${s.bob ? ep(s.bob) : '?'}` : 'public addresses learned from STUN'}
      </div>
    </Ro>
  );
}

function renderReadout(k: ReadoutKey, sim: NatSim, compact: boolean) {
  switch (k) {
    case 'octet':
      return <OctetReadout key={k} sim={sim} compact={compact} />;
    case 'prefix':
      return <PrefixReadout key={k} sim={sim} compact={compact} />;
    case 'pool':
      return <PoolReadout key={k} sim={sim} compact={compact} />;
    case 'ranges':
      return <RangesReadout key={k} compact={compact} />;
    case 'v6':
      return <V6Readout key={k} compact={compact} />;
    case 'laptop':
      return <LaptopReadout key={k} sim={sim} compact={compact} />;
    case 'rt':
      return <RouteReadout key={k} sim={sim} compact={compact} />;
    case 'nat':
      return (
        <NatReadout
          key={k}
          sim={sim}
          compact={compact}
          max={compact ? 3 : 6}
          cols={sim.cfg.topo === 'cgnat' ? 'short' : 'full'}
          title={sim.cfg.topo === 'cgnat' ? `home router · WAN ${sim.nats.get('router')?.pub}` : sim.cfg.topo === 'two' ? `Alice's NAT · ${sim.nats.get('router')?.pub}` : undefined}
        />
      );
    case 'natB':
      return <NatReadout key={k} sim={sim} id="routerB" compact={compact} max={compact ? 2 : 4} />;
    case 'cgnat':
      return <NatReadout key={k} sim={sim} id="cgnat" compact={compact} max={compact ? 2 : 4} cols="short" />;
    case 'server':
      return <ServerReadout key={k} sim={sim} />;
    case 'carol':
      return <CarolReadout key={k} sim={sim} />;
    case 'p2p':
      return <P2pReadout key={k} sim={sim} compact={compact} />;
  }
}

/* ------------------------------------------------------------------ */
/* Where each readout sits on a landscape stage                         */
/* ------------------------------------------------------------------ */

function placeFor(k: ReadoutKey, sim: NatSim): CSSProperties | null {
  const W = sim.w;
  const H = sim.h;
  const b = (id: string) => {
    const x = sim.boxes.get(id);
    return x && !Number.isNaN(x.x) ? x : null;
  };
  const view = sim.cfg.view;
  if (view === 'bits' && sim.cfg.v6) {
    const g = v6Geo(W, H, true);
    return { left: W / 2 + 40, top: g.top + (g.lines - 1) * g.lineGap + g.ch + 30, width: 330, transform: 'translateX(-50%)' };
  }
  if (view === 'bits') {
    const g = bitsGeo(W, H, true);
    const last = rowY(g, sim.cfg.rows.length - 1) + g.ch;
    const top = sim.cfg.places ? last + 70 : last + 58;
    return { left: W / 2, top, width: k === 'prefix' ? 330 : 340, transform: 'translateX(-50%)' };
  }
  if (view === 'map') {
    const g = mapGeo(W, H, true);
    const left = g.x0 + g.size + 28;
    return { left, top: g.y0, width: Math.min(300, W - left - 16) };
  }
  if (k === 'laptop' || k === 'p2p') return { right: 14, top: 14, width: k === 'p2p' ? 300 : 318 };
  if (k === 'server' || k === 'carol') {
    const s = b('server');
    if (!s) return null;
    return { right: 14, top: s.y + s.h / 2 + 16, width: 232 };
  }
  const lowest = () => {
    const ids = ['router', 'routerB', 'cgnat', 'laptop', 'phone', 'tv', 'guest', 'bob'];
    return Math.max(...ids.map((id) => (b(id) ? b(id)!.y + b(id)!.h / 2 : 0)));
  };
  if (k === 'rt' || k === 'nat') {
    const r = b('router');
    if (!r) return null;
    const top = lowest() + 50;
    if (sim.cfg.topo === 'two') return { left: 16, top, width: 420 };
    if (sim.cfg.topo === 'cgnat') return { left: clamp(r.x - 170, 16, W), top, width: 300 };
    const width = k === 'rt' ? 340 : 430;
    return { left: clamp(r.x - r.w / 2 - 20, 16, W - width - 16), top, width };
  }
  if (k === 'natB') return { right: 16, top: lowest() + 50, width: 420 };
  if (k === 'cgnat') {
    const r = b('router');
    if (!r) return null;
    return { left: clamp(r.x - 170, 16, W) + 316, top: lowest() + 50, width: 300 };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Packet inspector                                                    */
/* ------------------------------------------------------------------ */

interface PLine {
  k: string;
  v: string;
  changed?: boolean;
  was?: string;
}

function pktLines(sim: NatSim, p: Pkt): PLine[] {
  if (p.arp) {
    if (p.arp.op === 'request') {
      return [
        { k: 'to', v: `${BROADCAST_MAC} (everyone)` },
        { k: 'ask', v: `who has ${p.arp.who}?` },
        { k: 'from', v: `${p.arp.tell} · ${MAC.laptop}` },
      ];
    }
    return [
      { k: 'to', v: `${MAC.laptop} (laptop)` },
      { k: 'says', v: `${p.arp.who} is at` },
      { k: '', v: p.arp.mac ?? '' },
    ];
  }
  if (p.eth) {
    return [
      { k: 'MAC', v: `dst ${p.eth.dst}${p.eth.dstName !== 'ISP' ? ` (${p.eth.dstName})` : ''}`, changed: p.eth.dstName === 'ISP' },
      { k: 'IP', v: `dst ${p.dst.ip}${p.dst.ip === '198.51.100.20' ? ' (web server)' : p.dst.ip === '192.168.1.40' ? ' (TV)' : ''}` },
    ];
  }
  const out: PLine[] = [];
  const srcChanged = p.changed === 'src';
  const dstChanged = p.changed === 'dst';
  out.push({ k: 'src', v: ep(p.src), changed: srcChanged, was: srcChanged && p.was.src ? ep(p.was.src) : undefined });
  out.push({ k: 'dst', v: ep(p.dst), changed: dstChanged, was: dstChanged && p.was.dst ? ep(p.was.dst) : undefined });
  if (p.mapped) out.push({ k: 'says', v: `you are ${ep(p.mapped)}` });
  void sim;
  return out;
}

/** Rough footprint of a landscape readout, so packet cards can steer around it. */
function readoutRect(k: ReadoutKey, sim: NatSim, st: CSSProperties): Rect | null {
  const width = typeof st.width === 'number' ? st.width : 300;
  const top = typeof st.top === 'number' ? st.top : 14;
  let x = typeof st.left === 'number' ? st.left : sim.w - (typeof st.right === 'number' ? st.right : 14) - width;
  if (st.transform) x -= width / 2;
  const rows = (id: string) => Math.max(1, Math.min(6, sim.rowsOf(id).length));
  const h =
    k === 'nat'
      ? 60 + rows('router') * 19 + 28
      : k === 'natB'
        ? 60 + rows('routerB') * 19
        : k === 'cgnat'
          ? 60 + rows('cgnat') * 19 + 28
          : k === 'laptop'
            ? 170
            : k === 'rt'
              ? 110
              : k === 'p2p'
                ? 140
                : 92;
  return { x, y: top, w: width, h };
}

function PacketCard({ sim, avoid }: { sim: NatSim; avoid: Rect[] }) {
  const it = sim.inspected();
  if (!it) return null;
  const { p } = it;
  const land = sim.orient === 'landscape';
  const lines = pktLines(sim, p);
  const tone =
    p.outcome === 'dropped' ? css.pktErr : p.color === SIG.res ? css.pktRes : p.color === SIG.hc ? css.pktCtl : p.color === SIG.heavy ? css.pktIn : undefined;
  const proto = p.proto === 'eth' ? 'Ethernet' : p.proto.toUpperCase();
  const rewrittenBy = p.changed ? (it.resting ? 'just rewritten' : 'rewritten by NAT') : null;
  const note =
    p.outcome === 'dropped' ? (
      <>dropped</>
    ) : p.changed && it.resting ? (
      <>
        <b>{p.changed === 'src' ? 'Source' : 'Destination'} rewritten</b> {p.changed === 'src' ? 'on the way out' : 'on the way in'}
      </>
    ) : null;
  const body = (
    <>
      <div className={css.pktHead}>
        <span>{p.head}</span>
        <span>{proto}</span>
      </div>
      <div className={css.pktBody}>
        {lines.map((l, i) => (
          <div key={i}>
            <div className={cx(css.pktLine, l.changed && css.pktChanged)}>
              <span>{l.k}</span>
              <span>{l.v}</span>
            </div>
            {l.was && land && (
              <div className={cx(css.pktLine, css.pktWas)}>
                <span />
                <span>{l.was}</span>
              </div>
            )}
          </div>
        ))}
        {note && land && <div className={css.pktNote}>{note}</div>}
        {!land && rewrittenBy && lines.some((l) => l.was) && (
          <div className={css.pktNote}>
            was {lines.find((l) => l.was)?.was} · <b>{rewrittenBy}</b>
          </div>
        )}
      </div>
    </>
  );
  if (!land) return <div className={cx(css.pkt, css.pktDock, tone)}>{body}</div>;
  // Two homes: hosts sit above the cloud, so a riding card would cover them. Dock it instead.
  if (sim.cfg.topo === 'two') {
    return (
      <div className={cx(css.pkt, tone)} style={{ left: 14, top: 14, width: 300 }}>
        {body}
      </div>
    );
  }
  const W = 270;
  const H = 34 + lines.length * 17 + lines.filter((l) => l.was).length * 17 + (note ? 22 : 0);
  const spot = cardSpot(sim, p.id, it.x, it.y, W, H, avoid);
  const cxp = clamp(it.x, spot.x, spot.x + W);
  const cyp = clamp(it.y, spot.y, spot.y + H);
  // Anchor the edge nearest the packet, so a card taller than estimated grows away from it.
  const style: CSSProperties =
    spot.anchor === 'bottom'
      ? { left: spot.x, top: spot.y + H, width: W, transform: 'translateY(-100%)' }
      : spot.anchor === 'middle'
        ? { left: spot.x, top: spot.y + H / 2, width: W, transform: 'translateY(-50%)' }
        : { left: spot.x, top: spot.y, width: W };
  return (
    <>
      <svg className={css.leaderSvg} width={sim.w} height={sim.h} aria-hidden>
        <line x1={it.x} y1={it.y} x2={cxp} y2={cyp} stroke="rgba(143,166,201,0.55)" strokeWidth={1} strokeDasharray="2 3" />
        <circle cx={it.x} cy={it.y} r={8} fill="none" stroke="rgba(232,238,249,0.45)" strokeWidth={1} />
      </svg>
      <div className={cx(css.pkt, tone)} style={style}>
        {body}
      </div>
    </>
  );
}

/* ---------------- where the riding card goes ---------------- */

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const overlap = (a: Rect, b: Rect) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

/** Last spot per packet, so the card doesn't hop around as its packet moves. */
const lastSpot = new Map<number, number>();

function cardSpot(sim: NatSim, id: number, px: number, py: number, w: number, h: number, avoid: Rect[]): Rect & { anchor: 'top' | 'bottom' | 'middle' } {
  const obstacles: Rect[] = [...avoid];
  for (const b of sim.boxes.values()) {
    if (Number.isNaN(b.x) || b.alpha < 0.3) continue;
    obstacles.push({ x: b.x - b.w / 2 - 8, y: b.y - b.h / 2 - 8, w: b.w + 16, h: b.h + 16 });
  }
  const g = 40;
  const cands: (Rect & { anchor: 'top' | 'bottom' | 'middle' })[] = [
    { x: px - w / 2, y: py - g - h, w, h, anchor: 'bottom' as const },
    { x: px + g, y: py - h / 2, w, h, anchor: 'middle' as const },
    { x: px - g - w, y: py - h / 2, w, h, anchor: 'middle' as const },
    { x: px - w / 2, y: py + g, w, h, anchor: 'top' as const },
    { x: px + 12, y: py - g - h, w, h, anchor: 'bottom' as const },
    { x: px - w - 12, y: py - g - h, w, h, anchor: 'bottom' as const },
    { x: px + 12, y: py + g, w, h, anchor: 'top' as const },
    { x: px - w - 12, y: py + g, w, h, anchor: 'top' as const },
  ].map((r) => ({ ...r, x: clamp(r.x, 10, sim.w - w - 10), y: clamp(r.y, 10, sim.h - h - 64) }));
  const score = (r: Rect, i: number) => obstacles.reduce((s, o) => s + overlap(r, o), 0) + i * 30;
  let best = 0;
  let bestScore = Infinity;
  cands.forEach((r, i) => {
    const s = score(r, i);
    if (s < bestScore) {
      bestScore = s;
      best = i;
    }
  });
  const prev = lastSpot.get(id);
  if (prev != null && score(cands[prev], prev) <= bestScore + 900) best = prev;
  lastSpot.set(id, best);
  if (lastSpot.size > 64) lastSpot.delete(lastSpot.keys().next().value as number);
  return cands[best];
}

/* ------------------------------------------------------------------ */
/* Prompts                                                             */
/* ------------------------------------------------------------------ */

function Prompts({ sim, hint }: { sim: NatSim; hint?: string | null }) {
  const q = sim.game?.pending;
  const a = sim.asking;
  const land = sim.orient === 'landscape';
  const place = (id: string, text: string, below = false) => {
    const b = sim.boxes.get(id);
    if (!b || Number.isNaN(b.x)) return null;
    const half = text.length * 3.45 + 14;
    const x = clamp(b.x, half + 8, sim.w - half - 8);
    return (
      <StagePrompt x={x} y={below ? b.y + b.h / 2 + 36 : b.y - b.h / 2 - 12}>
        {text}
      </StagePrompt>
    );
  };
  if (q && a) {
    const text = land && sim.w >= 900 ? a.text : (q.ask ?? a.text);
    // Router questions come with a packet card above the router, so ask underneath it.
    return place(a.at, text, a.at === 'router' && land);
  }
  if (hint) {
    if (sim.cfg.view === 'bits') {
      const g = bitsGeo(sim.w, sim.h, land);
      const text = land ? hint : hint.replace(/^Click/, 'Tap');
      return (
        <StagePrompt x={sim.w / 2} y={rowY(g, 0) - (land ? 30 : 24)}>
          {text}
        </StagePrompt>
      );
    }
    const target = sim.boxes.has('carol') ? 'carol' : 'router';
    return place(target, land ? hint : hint.replace(/^Click/, 'Tap'));
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Stage overlay                                                       */
/* ------------------------------------------------------------------ */

export function StageOverlay({
  sim,
  hud = [],
  side = [],
  strip,
  hint,
  inspect,
}: {
  sim: NatSim;
  hud?: HudKey[];
  side?: ReadoutKey[];
  strip?: ReadoutKey | null;
  hint?: string | null;
  inspect?: boolean;
}) {
  const land = sim.orient === 'landscape';
  const showHud = land || !inspect;
  const items = hudItems(sim, hud);
  const avoid: Rect[] = [];
  if (showHud && items.length) avoid.push({ x: 10, y: 10, w: items.length * 112, h: 56 });
  const placed = land ? side.map((k) => ({ k, st: placeFor(k, sim) })) : [];
  for (const { k, st } of placed) {
    const r = st && readoutRect(k, sim, st);
    if (r) avoid.push(r);
  }
  return (
    <>
      {showHud && <Hud items={items} />}
      {placed.map(({ k, st }) =>
        st ? (
          <div key={k} className={css.anchored} style={st}>
            {renderReadout(k, sim, false)}
          </div>
        ) : null,
      )}
      {!land && strip && <div className={css.strip}>{renderReadout(strip, sim, true)}</div>}
      <PacketCard sim={sim} avoid={avoid} />
      <Prompts sim={sim} hint={hint} />
    </>
  );
}
