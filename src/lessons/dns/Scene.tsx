import type { CSSProperties, ReactNode } from 'react';
import { Hud, type HudItem, type LegendItem } from '@/components/stage/chrome';
import { Readout, StagePrompt } from '@/components/stage/overlays';
import { SequenceDiagram, type SeqMessage } from '@/components/stage/SequenceDiagram';
import kit from '@/components/stage/stage.module.css';
import { ClientCard, Effects, Flights, NodeCard, Wires } from '@/components/stage/svg';
import { SIG } from '@/lib/sim/colors';
import type { Box } from '@/lib/sim/Sim';
import { MOVE_RESOLVERS, USERS, type CacheEntry, type DnsSim, type Msg } from './sim';
import type { HudKey, LegendKey, Step } from './types';
import { IP_NEW, IP_OLD, RESOLVER_IP, SERVERS, SERVER_IDS, fmtRR, fqdn, nameWidth, target, type RR, type ServerId } from './zones';
import css from './dns.module.css';

const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(' ');

/** One accent per level of the tree: root, TLD, authoritative. */
export const LEVEL: Record<ServerId, string> = { root: SIG.blue, tld: SIG.teal, auth: SIG.lime, cdn: SIG.lime };

const WHO: Record<string, string> = {
  laptop: 'Alice',
  bob: 'Bob',
  wifi: 'Wi-Fi',
  resolver: 'resolver',
  root: 'a.root-servers.net',
  tld: 'a.nic.example',
  auth: 'ns1.shop.example',
  cdn: 'ns1.cdn.example',
  u1: 'Alice',
  u2: 'Bob',
  u3: 'Carol',
  r1: 'resolver',
  r2: 'resolver',
  r3: 'resolver',
};

const IP_OF: Record<string, string> = {
  laptop: '198.51.100.42',
  bob: '198.51.100.77',
  resolver: RESOLVER_IP,
  root: SERVERS.root.ip,
  tld: SERVERS.tld.ip,
  auth: SERVERS.auth.ip,
  cdn: SERVERS.cdn.ip,
};

/* ------------------------------------------------------------------ */
/* Frame + node shapes                                                 */
/* ------------------------------------------------------------------ */

interface FrameProps {
  box: Box;
  dim?: boolean;
  glow?: boolean;
  state?: 'normal' | 'down' | 'hot' | 'ok';
  pickable?: boolean;
  onClick?: () => void;
  label?: string;
  rx?: number;
  children: ReactNode;
}

function Frame({ box, dim, glow, state = 'normal', pickable, onClick, label, rx = 10, children }: FrameProps) {
  return (
    <g
      className={cx(kit.node, onClick && kit.clickable, pickable && kit.pickable)}
      data-state={state}
      transform={`translate(${box.x - box.w / 2},${box.y - box.h / 2})`}
      opacity={box.alpha * (dim ? 0.28 : 1)}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      aria-label={onClick ? label : undefined}
    >
      {onClick && <rect x={-8} y={-8} width={box.w + 16} height={box.h + 16} fill="transparent" />}
      {glow && <rect x={-6} y={-6} width={box.w + 12} height={box.h + 12} rx={rx + 4} fill="none" stroke="var(--accent)" strokeWidth={1.4} strokeDasharray="3 3" />}
      {children}
    </g>
  );
}

function Card({ box, tone, rx = 10 }: { box: Box; tone?: string; rx?: number }) {
  return (
    <>
      <rect className={kit.card} width={box.w} height={box.h} rx={rx} style={tone ? { stroke: tone } : undefined} />
      <rect className={kit.cardInner} x={3.5} y={3.5} width={Math.max(0, box.w - 7)} height={Math.max(0, box.h - 7)} rx={rx - 2.5} />
    </>
  );
}

/** Three dots on a stem: which level of the DNS tree this server sits on. */
function LevelGlyph({ level, color }: { level: 0 | 1 | 2; color: string }) {
  return (
    <g>
      <line x1={0} y1={-8} x2={0} y2={8} stroke="rgba(143,166,201,0.35)" strokeWidth={1} />
      {[0, 1, 2].map((i) => (
        <circle key={i} cx={0} cy={-8 + i * 8} r={i === level ? 3.2 : 2.2} fill={i === level ? color : 'var(--node-fill)'} stroke={i === level ? color : 'rgba(143,166,201,0.5)'} strokeWidth={1} />
      ))}
    </g>
  );
}

const ROLE_SHORT: Record<ServerId, string> = { root: 'root', tld: 'TLD', auth: 'authoritative', cdn: 'authoritative' };
const ROLE_LONG: Record<ServerId, string> = { root: 'root server', tld: 'TLD server · .example', auth: 'authoritative', cdn: 'authoritative' };

function ServerNode({ box, id, sim, dim, glow, pickable, onClick }: { box: Box; id: ServerId; sim: DnsSim; dim: boolean; glow: boolean; pickable: boolean; onClick?: () => void }) {
  const info = SERVERS[id];
  const narrow = box.w < 170;
  const color = LEVEL[id];
  const kicker = narrow ? ROLE_SHORT[id] : ROLE_LONG[id];
  const title = narrow ? info.zoneLabel : info.host;
  const ky = box.h < 56 ? 15 : 17;
  const level = id === 'root' ? 0 : id === 'tld' ? 1 : 2;
  return (
    <Frame box={box} dim={dim} glow={glow} pickable={pickable} onClick={onClick} label={info.host}>
      <Card box={box} />
      <rect x={12} y={-0.5} width={Math.min(44, box.w - 24)} height={2.2} rx={1} fill={color} />
      <text className={kit.caps} x={12} y={ky} style={{ fill: color, fontSize: narrow ? 8.5 : 9 }}>
        {kicker}
      </text>
      <text className={narrow ? kit.monoStrong : kit.name} x={12} y={box.h * 0.6} style={narrow ? { fontSize: 11 } : undefined}>
        {title}
      </text>
      <text className={kit.mono} x={12} y={box.h - 8} style={narrow ? { fontSize: 9 } : undefined}>
        {info.ip}
      </text>
      {!narrow && (
        <g transform={`translate(${box.w - 18},${box.h / 2})`}>
          <LevelGlyph level={level} color={color} />
        </g>
      )}
      {id === 'root' && sim.cfg.rootLetters && <RootLetters box={box} />}
    </Frame>
  );
}

/** a.root-servers.net … m.root-servers.net: 13 names, each served from many places. */
function RootLetters({ box }: { box: Box }) {
  const letters = 'abcdefghijklm'.split('');
  const step = Math.min(15, (box.w - 8) / 13);
  const x0 = box.w / 2 - (step * 12) / 2;
  const tiny = step < 11;
  return (
    <g transform={`translate(0,${box.h + (tiny ? 9 : 13)})`}>
      {letters.map((l, i) => (
        <g key={l} transform={`translate(${x0 + i * step},0)`}>
          <circle r={tiny ? 2.4 : step * 0.42} fill={tiny ? SIG.blue : 'rgba(147,165,255,0.12)'} fillOpacity={tiny ? 0.8 : 1} stroke={SIG.blue} strokeWidth={0.9} />
          {!tiny && (
            <text y={3} textAnchor="middle" style={{ fontFamily: 'var(--font-mono)', fontSize: 8.5, fill: SIG.blue }}>
              {l}
            </text>
          )}
        </g>
      ))}
      {tiny && (
        <text x={box.w / 2} y={15} textAnchor="middle" style={{ fontFamily: 'var(--font-mono)', fontSize: 8.5, fill: SIG.blue }}>
          a … m
        </text>
      )}
    </g>
  );
}

function ResolverNode({ box, sim, dim, glow, id = 'resolver' }: { box: Box; sim: DnsSim; dim: boolean; glow: boolean; id?: string }) {
  const dnsMode = sim.cfg.resolverTitle === 'DNS';
  const narrow = box.w < 180;
  const busy = sim.lookups.some((l) => l.res === id && !l.done) || (sim.busyUntil.get(id) ?? 0) > sim.t;
  const n = sim.entries(id).length;
  const k = (sim.vt * 2.2) % 3;
  return (
    <Frame box={box} dim={dim} glow={glow} label="resolver" rx={12}>
      <rect width={box.w} height={box.h} rx={12} fill="url(#kit-violet)" stroke="rgba(181,155,255,0.75)" strokeWidth={1.2} />
      <rect className={kit.cardInner} x={4} y={4} width={box.w - 8} height={box.h - 8} rx={9} />
      {dnsMode ? (
        <>
          <text className={kit.caps} x={14} y={18} style={{ fill: '#cdbdff' }}>
            the domain name system
          </text>
          <text x={14} y={box.h - 14} style={{ fontFamily: 'var(--font-display)', fontSize: box.h < 70 ? 26 : 30, fill: 'var(--text-1)' }}>
            DNS
          </text>
          <text className={kit.mono} x={box.h < 70 ? 76 : 84} y={box.h - 16}>
            name → address
          </text>
        </>
      ) : (
        <>
          <text className={kit.caps} x={14} y={box.h < 56 ? 15 : 18} style={{ fill: '#cdbdff', fontSize: narrow ? 8.5 : 9 }}>
            {narrow ? 'resolver' : 'recursive resolver'}
          </text>
          <text className={kit.name} x={14} y={box.h * 0.6} style={narrow ? { fontSize: 11.5 } : undefined}>
            {narrow ? 'ISP resolver' : 'your ISP’s resolver'}
          </text>
          <text className={kit.mono} x={14} y={box.h - 9} style={narrow ? { fontSize: 9 } : undefined}>
            {RESOLVER_IP}
          </text>
          {!narrow && (
            <text className={kit.mono} x={box.w - 12} y={box.h - 9} textAnchor="end" style={{ fill: n ? '#cdbdff' : 'var(--text-3)' }}>
              cache {n}
            </text>
          )}
        </>
      )}
      {busy && (
        <g transform={`translate(${box.w - (narrow ? 26 : 32)},${narrow ? 14 : 17})`}>
          {[0, 1, 2].map((i) => (
            <circle key={i} cx={i * 7} cy={0} r={2.2} fill="#cdbdff" opacity={Math.floor(k) === i ? 1 : 0.3} />
          ))}
        </g>
      )}
    </Frame>
  );
}

/* ---------------- glyphs ---------------- */

function WifiGlyph({ color }: { color: string }) {
  return (
    <g fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round">
      <path d="M-8,-1 A11,11 0 0,1 8,-1" />
      <path d="M-5,2.5 A7,7 0 0,1 5,2.5" />
      <circle cx={0} cy={6} r={1.4} fill={color} stroke="none" />
    </g>
  );
}

function ServerGlyph({ color }: { color: string }) {
  return (
    <g fill="none" stroke={color} strokeWidth={1.3}>
      <rect x={-7} y={-8} width={14} height={7} rx={1.5} />
      <rect x={-7} y={1} width={14} height={7} rx={1.5} />
      <circle cx={-3.5} cy={-4.5} r={0.9} fill={color} stroke="none" />
      <circle cx={-3.5} cy={4.5} r={0.9} fill={color} stroke="none" />
    </g>
  );
}

/* ---------------- tree view ---------------- */

const TREE: Record<string, { kicker: string; title: string; sub: string; level: 0 | 1 | 2 }> = {
  root: { kicker: 'root zone', title: '. (the root)', sub: 'a–m.root-servers.net', level: 0 },
  com: { kicker: 'TLD', title: '.com', sub: 'Verisign', level: 1 },
  org: { kicker: 'TLD', title: '.org', sub: 'PIR', level: 1 },
  tld: { kicker: 'TLD', title: '.example', sub: 'a.nic.example', level: 1 },
  dev: { kicker: 'TLD', title: '.dev', sub: 'Google Registry', level: 1 },
  auth: { kicker: 'domain', title: 'shop.example', sub: 'ns1.shop.example', level: 2 },
  cdn: { kicker: 'domain', title: 'cdn.example', sub: 'ns1.cdn.example', level: 2 },
};

function ZoneNode({ box, id, dim, glow, lit }: { box: Box; id: string; dim: boolean; glow: boolean; lit: boolean }) {
  const z = TREE[id];
  const color = z.level === 0 ? SIG.blue : z.level === 1 ? SIG.teal : SIG.lime;
  const tiny = box.w < 110;
  return (
    <Frame box={box} dim={dim} glow={glow} label={z.title}>
      <Card box={box} tone={lit ? SIG.warn : undefined} />
      <rect x={10} y={-0.5} width={Math.min(36, box.w - 20)} height={2.2} rx={1} fill={color} />
      <text className={kit.caps} x={10} y={14} style={{ fill: color, fontSize: 8.5 }}>
        {z.kicker}
      </text>
      <text x={10} y={tiny ? box.h - 12 : box.h * 0.62} style={{ fontFamily: 'var(--font-mono)', fontSize: tiny ? 12 : 13.5, fontWeight: 500, fill: lit ? SIG.warn : 'var(--text-1)' }}>
        {z.title}
      </text>
      {!tiny && (
        <text className={kit.mono} x={10} y={box.h - 7} style={{ fontSize: 9 }}>
          {z.sub}
        </text>
      )}
    </Frame>
  );
}

function TreeLeaves({ sim }: { sim: DnsSim }) {
  const b = sim.boxes.get('auth');
  if (!b || Number.isNaN(b.x)) return null;
  const small = sim.orient === 'portrait';
  const lines = small ? ['A    203.0.113.10', 'MX   mail.shop…', 'www  CNAME …'] : ['A      203.0.113.10', 'MX     10 mail.shop.example.', 'www    CNAME shop.cdn.example.'];
  const x0 = b.x - b.w / 2 + 12;
  const y0 = b.y + b.h / 2 + 10;
  return (
    <g opacity={b.alpha}>
      <line x1={x0 - 4} y1={y0} x2={x0 - 4} y2={y0 + 14 * lines.length + 4} stroke="rgba(196,242,90,0.35)" />
      {lines.map((l, i) => (
        <text key={i} x={x0 + 4} y={y0 + 13 + i * 14} style={{ fontFamily: 'var(--font-mono)', fontSize: small ? 9 : 10, fill: '#cfe99a', whiteSpace: 'pre' }}>
          {l}
        </text>
      ))}
    </g>
  );
}

/* ---------------- move view ---------------- */

function MoveResolver({ box, sim, id, dim, glow }: { box: Box; sim: DnsSim; id: string; dim: boolean; glow: boolean }) {
  const e = sim.entries(id, 'shop.example').find((x) => x.type === 'A');
  const narrow = box.w < 150;
  const name = { r1: narrow ? 'Alice’s ISP' : 'Alice’s ISP resolver', r2: narrow ? 'Bob’s office' : 'Bob’s office resolver', r3: narrow ? 'Carol: 1.1.1.1' : 'Carol’s 1.1.1.1' }[id] ?? id;
  const left = e ? sim.ttlLeft(e) : 0;
  const frac = e ? Math.max(0, Math.min(1, (e.exp - sim.t) / e.ttl)) : 0;
  const old = e && e.data === IP_OLD;
  const color = !e ? SIG.text2 : old ? SIG.heavy : SIG.res;
  const busy = sim.lookups.some((l) => l.res === id && l.upstream > 0 && !l.done);
  const bw = box.w - 24;
  return (
    <Frame box={box} dim={dim} glow={glow} label={name} rx={11}>
      <rect width={box.w} height={box.h} rx={11} fill="url(#kit-violet)" stroke="rgba(181,155,255,0.7)" strokeWidth={1.1} />
      <text className={kit.caps} x={12} y={15} style={{ fill: '#cdbdff', fontSize: 8.5 }}>
        {narrow ? 'resolver' : 'resolver cache'}
      </text>
      <text className={kit.name} x={12} y={31} style={{ fontSize: narrow ? 11 : 12 }}>
        {name}
      </text>
      <text x={12} y={47} style={{ fontFamily: 'var(--font-mono)', fontSize: narrow ? 9.5 : 10.5, fill: color }}>
        {e ? (narrow ? `→ .${e.data.split('.').pop()}` : `A ${e.data}`) : busy ? 'asking…' : 'expired'}
      </text>
      <text x={box.w - 12} y={47} textAnchor="end" style={{ fontFamily: 'var(--font-mono)', fontSize: narrow ? 9.5 : 10.5, fill: left <= 5 && e ? SIG.warn : 'var(--text-2)' }}>
        {e ? `${left}s` : ''}
      </text>
      <rect x={12} y={box.h - 10} width={bw} height={3} rx={1.5} fill="rgba(143,166,201,0.18)" />
      <rect x={12} y={box.h - 10} width={bw * frac} height={3} rx={1.5} fill={color} />
    </Frame>
  );
}

const USER_COLOR: Record<string, string> = { u1: SIG.pink, u2: SIG.teal, u3: SIG.lime };

/* ------------------------------------------------------------------ */
/* The scene                                                           */
/* ------------------------------------------------------------------ */

export function Scene({ sim, step, highlight }: { sim: DnsSim; step: Step; highlight: string | null }) {
  if (sim.cfg.view === 'seq') return <SeqView sim={sim} />;
  const focus = step.focus;
  const dim = (id: string) => !!focus?.length && !focus.includes(id);
  const glow = (id: string) =>
    highlight === id ||
    (highlight === 'servers' && (SERVER_IDS as string[]).includes(id)) ||
    (highlight === 'users' && (USERS as readonly string[]).includes(id)) ||
    (highlight === 'resolvers' && (MOVE_RESOLVERS as readonly string[]).includes(id));
  const awaiting = !!sim.game?.awaitingStageClick;
  const tree = sim.cfg.view === 'tree';
  const lit = tree ? sim.treeLit : -1;

  const nodes: ReactNode[] = [];
  for (const [id, box] of sim.boxes) {
    if (Number.isNaN(box.x)) continue;
    const d = dim(id);
    const g = glow(id);
    if (tree && TREE[id]) {
      const on = (id === 'root' && lit === 0) || (id === 'tld' && lit === 1) || (id === 'auth' && lit === 2);
      nodes.push(<ZoneNode key={id} box={box} id={id} dim={d} glow={g} lit={on} />);
      continue;
    }
    if ((SERVER_IDS as string[]).includes(id)) {
      const sid = id as ServerId;
      nodes.push(<ServerNode key={id} box={box} id={sid} sim={sim} dim={d} glow={g} pickable={awaiting} onClick={awaiting ? () => sim.game?.answer(sid) : undefined} />);
      continue;
    }
    switch (id) {
      case 'laptop':
        nodes.push(<ClientCard key={id} box={box} name="Alice’s laptop" sub="198.51.100.42" color={SIG.pink} dim={d} glow={g} />);
        break;
      case 'bob':
        nodes.push(<ClientCard key={id} box={box} name="Bob’s phone" sub="198.51.100.77" color={SIG.teal} dim={d} glow={g} />);
        break;
      case 'resolver':
        nodes.push(<ResolverNode key={id} box={box} sim={sim} dim={d} glow={g} />);
        break;
      case 'r1':
      case 'r2':
      case 'r3':
        nodes.push(<MoveResolver key={id} box={box} sim={sim} id={id} dim={d} glow={g} />);
        break;
      case 'u1':
      case 'u2':
      case 'u3': {
        const st = sim.users.get(id);
        const sub = st?.ip ? (box.w < 120 ? `→ .${st.ip.split('.').pop()}` : `→ ${st.ip}`) : '';
        nodes.push(
          <ClientCard key={id} box={box} name={{ u1: 'Alice', u2: 'Bob', u3: 'Carol' }[id]} sub={sub} color={USER_COLOR[id]} dim={d} glow={g}>
            {st?.ok === false && <circle cx={box.w - 10} cy={10} r={3.4} fill={SIG.err} />}
            {st?.ok && <circle cx={box.w - 10} cy={10} r={3.4} fill={st.ip === IP_NEW ? SIG.res : SIG.heavy} />}
          </ClientCard>,
        );
        break;
      }
      case 'web':
      case 'web2': {
        const move = sim.cfg.view === 'move';
        const isOld = id === 'web';
        const down = isOld && sim.webDown;
        nodes.push(
          <NodeCard
            key={id}
            box={box}
            title={move ? (isOld ? 'old server' : 'new server') : 'shop.example'}
            sub={isOld ? IP_OLD : IP_NEW}
            kicker={move ? { text: isOld ? 'still running' : 'new home', color: isOld ? SIG.heavy : SIG.res } : { text: 'web server' }}
            icon={<ServerGlyph color={move ? (isOld ? SIG.heavy : SIG.res) : SIG.blue} />}
            led={down ? 'down' : 'up'}
            tone={move ? (isOld ? 'rgba(255,154,60,0.6)' : 'rgba(75,227,160,0.6)') : undefined}
            state={down ? 'down' : 'normal'}
            dim={d}
            glow={g}
          />,
        );
        break;
      }
      case 'wifi':
        nodes.push(
          <NodeCard
            key={id}
            box={box}
            title={box.w < 125 ? 'Wi-Fi' : 'Café Wi-Fi'}
            sub="on the path"
            icon={<WifiGlyph color={SIG.heavy} />}
            tone="rgba(255,154,60,0.55)"
            dim={d}
            glow={g}
          />,
        );
        break;
    }
  }

  return (
    <>
      <Wires sim={sim} />
      {tree && <TreeLeaves sim={sim} />}
      {nodes}
      <Flights sim={sim} onFlightClick={sim.cfg.clickDrop ? (id) => sim.dropFlight(id) : undefined} labels={sim.cfg.labels} />
      <Effects sim={sim} />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Sequence view: recursive vs iterative                               */
/* ------------------------------------------------------------------ */

const S_PER_MS = 0.06;
const ONE_WAY = { stub: 7, root: 10, tld: 15.5, auth: 22 };

function seqSchedule() {
  const gap = 0;
  let t = 0.5;
  const legs: [string, string, number, string, string, string?][] = [
    ['stub', 'res', ONE_WAY.stub, 'A? shop.example  (rd)', 'A? (rd)', SIG.req],
    ['res', 'root', ONE_WAY.root, 'A? shop.example', 'A?', SIG.req],
    ['root', 'res', ONE_WAY.root, 'referral: .example', '→ .example', SIG.hc],
    ['res', 'tld', ONE_WAY.tld, 'A? shop.example', 'A?', SIG.req],
    ['tld', 'res', ONE_WAY.tld, 'referral: shop.example', '→ shop.example', SIG.hc],
    ['res', 'auth', ONE_WAY.auth, 'A? shop.example', 'A?', SIG.req],
    ['auth', 'res', ONE_WAY.auth, 'A 203.0.113.10  (aa)', '203.0.113.10', SIG.res],
    ['res', 'stub', ONE_WAY.stub, 'A 203.0.113.10  (ra)', '203.0.113.10', SIG.res],
  ];
  const out: { from: string; to: string; t0: number; t1: number; long: string; short: string; color: string }[] = [];
  legs.forEach(([from, to, ms, long, short, color], i) => {
    const t0 = t;
    const t1 = t0 + ms * S_PER_MS;
    out.push({ from, to, t0, t1, long, short, color: color ?? SIG.req });
    t = t1 + (i % 2 === 0 ? gap : 0);
  });
  return out;
}

export const SEQ = seqSchedule();
export const SEQ_END = SEQ[SEQ.length - 1].t1;
export const seqMs = (t: number) => Math.max(0, Math.round((Math.min(t, SEQ_END) - 0.5) / S_PER_MS));

export function seqGeom(sim: DnsSim) {
  const portrait = sim.orient === 'portrait';
  const x = portrait ? 12 : 40;
  const y = portrait ? 70 : 84;
  const w = sim.w - x * 2;
  const h = sim.h - y - (portrait ? 96 : 116);
  const pxPerSec = Math.min(78, (h - 50 - 60) / (SEQ_END + 0.7));
  const colW = w / 5;
  const col = (i: number) => x + colW * (i + 0.5);
  const yOf = (t: number) => y + 42 + 8 + 16 + t * pxPerSec;
  return { x, y, w, h, pxPerSec, col, yOf, portrait };
}

function SeqView({ sim }: { sim: DnsSim }) {
  const g = seqGeom(sim);
  const now = Math.min(sim.stepT, SEQ_END + 0.35);
  const messages: SeqMessage[] = SEQ.map((m, i) => ({ id: i, from: m.from, to: m.to, t0: m.t0, t1: m.t1, label: g.portrait ? m.short : m.long, color: m.color, hot: true }));
  const done = sim.stepT >= SEQ_END;
  return (
    <SequenceDiagram
      x={g.x}
      y={g.y}
      w={g.w}
      h={g.h}
      now={now}
      pxPerSec={g.pxPerSec}
      actors={[
        { id: 'stub', label: g.portrait ? 'Alice' : 'Alice’s laptop', sub: g.portrait ? undefined : 'stub resolver', color: SIG.pink },
        { id: 'res', label: 'Resolver', sub: g.portrait ? undefined : RESOLVER_IP, color: SIG.hc },
        { id: 'root', label: 'Root', sub: g.portrait ? undefined : SERVERS.root.ip, color: SIG.blue },
        { id: 'tld', label: g.portrait ? 'TLD' : '.example TLD', sub: g.portrait ? undefined : SERVERS.tld.ip, color: SIG.teal },
        { id: 'auth', label: g.portrait ? 'Auth' : 'ns1.shop.example', sub: g.portrait ? undefined : SERVERS.auth.ip, color: SIG.lime },
      ]}
      messages={messages}
      spans={[
        { id: 'wait', actor: 'stub', t0: SEQ[0].t1, t1: SEQ[7].t1, color: SIG.pink },
        { id: 'work', actor: 'res', t0: SEQ[0].t1, t1: SEQ[7].t0, color: SIG.hc },
      ]}
      notes={[
        ...(sim.stepT > SEQ[2].t1 && !g.portrait ? [{ id: 'rec', actor: 'stub', t: (SEQ[3].t0 + SEQ[4].t1) / 2, text: 'recursive', color: SIG.pink }] : []),
        ...(done ? [{ id: 'it', actor: 'res', t: SEQ_END + 0.22, text: g.portrait ? 'iterative' : 'iterative: 3 servers asked', color: SIG.hc }] : []),
        ...(done ? [{ id: 'total', actor: 'stub', t: SEQ_END + 0.22, text: `${seqMs(SEQ_END)} ms`, color: SIG.res }] : []),
      ]}
      timeLabel={(t) => `${seqMs(t)} ms`}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Overlay: HUD, dig card, caches, zone file, prompts                   */
/* ------------------------------------------------------------------ */

export const LEGEND: Record<LegendKey, LegendItem> = {
  query: { label: 'query', color: SIG.req },
  referral: { label: 'referral', color: SIG.hc },
  answer: { label: 'answer', color: SIG.res },
  cname: { label: 'CNAME (alias)', color: SIG.heavy },
  nx: { label: 'NXDOMAIN', color: SIG.err },
  http: { label: 'HTTP', color: SIG.blue, shape: 'square' },
  old: { label: `old IP ${IP_OLD}`, color: SIG.heavy, shape: 'square' },
  new: { label: `new IP ${IP_NEW}`, color: SIG.res, shape: 'square' },
  tcp: { label: 'TCP', color: SIG.text2, shape: 'square' },
  enc: { label: 'encrypted', color: SIG.req, shape: 'env' },
  trunc: { label: 'truncated (TC)', color: SIG.warn },
};

function hudItems(sim: DnsSim, keys: HudKey[]): HudItem[] {
  const s = sim.stats;
  const P = sim.orient === 'portrait';
  const last = sim.last;
  const ms = (v: number | undefined) => (v == null ? '—' : v);
  const out: HudItem[] = [];
  for (const k of keys) {
    switch (k) {
      case 'time':
        out.push({ label: 'Last lookup', value: ms(last?.ms), unit: last ? 'ms' : undefined, tone: last && last.ms < 20 ? 'good' : undefined });
        break;
      case 'trips':
        out.push({ label: 'Queries sent', value: last ? last.upstream : '—', unit: last ? 'upstream' : undefined });
        break;
      case 'hits':
        out.push({ label: 'Cache hits', value: s.resHits + s.stubHits, tone: s.resHits + s.stubHits > 0 ? 'good' : undefined });
        break;
      case 'misses':
        out.push({ label: 'Cache misses', value: s.misses });
        break;
      case 'alice': {
        const r = sim.byClient.get('laptop');
        out.push({ label: 'Alice', value: ms(r?.ms), unit: r ? 'ms' : undefined, tone: r && r.ms < 20 ? 'good' : undefined });
        break;
      }
      case 'bob': {
        const r = sim.byClient.get('bob');
        out.push({ label: 'Bob', value: ms(r?.ms), unit: r ? 'ms' : undefined, tone: r && r.ms < 20 ? 'good' : undefined });
        break;
      }
      case 'auth':
        out.push({ label: P ? 'To ns1.shop' : 'Queries to ns1.shop', value: s.authQueries });
        break;
      case 'root':
        out.push({ label: P ? 'To a root' : 'Queries to a root', value: s.rootQueries });
        break;
      case 'neg':
        out.push({ label: 'Cached “no”', value: s.negHits, tone: s.negHits > 0 ? 'good' : undefined });
        break;
      case 'moved':
        out.push({ label: P ? 'Moved' : 'On new server', value: `${sim.onNew()}/3`, tone: sim.onNew() === 3 ? 'good' : undefined });
        break;
      case 'since': {
        const v = sim.movedAt == null ? null : Math.floor((sim.allMovedAt ?? sim.t) - sim.movedAt);
        out.push({ label: sim.allMovedAt != null ? 'All moved in' : P ? 'Since' : 'Since change', value: v == null ? '—' : v, unit: v == null ? undefined : 's' });
        break;
      }
      case 'stale': {
        const v = Math.ceil(sim.staleLeft());
        out.push({ label: 'Old IP still cached', value: v, unit: 's', tone: v > 0 ? 'warn' : 'good' });
        break;
      }
      case 'maxTtl': {
        const v = Math.ceil(sim.maxCached());
        out.push({ label: P ? 'Max cached' : 'Longest cached', value: v, unit: 's', tone: v <= 5 ? 'good' : 'warn' });
        break;
      }
      case 'errors':
        out.push({ label: P ? 'Failed' : 'Failed loads', value: s.errors, tone: s.errors > 0 ? 'bad' : undefined });
        break;
      case 'lost':
        out.push({ label: 'Packets lost', value: s.lost, tone: s.lost > 0 ? 'bad' : undefined });
        break;
      case 'retries':
        out.push({ label: 'Retries', value: s.retries, tone: s.retries > 0 ? 'warn' : undefined });
        break;
      case 'size': {
        const m = sim.dig;
        out.push({ label: 'Last message', value: m ? m.bytes : '—', unit: m ? `bytes · ${m.proto === 'tcp' ? 'TCP' : 'UDP'}` : undefined, tone: m && m.bytes > 512 ? 'warn' : undefined });
        break;
      }
      case 'lookups':
        out.push({ label: 'Lookups', value: s.answered });
        break;
      case 'hitRate': {
        const hits = s.resHits + s.stubHits;
        out.push({ label: P ? 'From cache' : 'Answered from cache', value: s.answered ? Math.round((hits / s.answered) * 100) : '—', unit: s.answered ? '%' : undefined, tone: 'good' });
        break;
      }
    }
  }
  return out;
}

/* ---------------- dig card ---------------- */

const KIND_HEAD: Record<Msg['kind'], string> = {
  query: 'query',
  referral: 'referral',
  answer: 'answer',
  cname: 'alias',
  nxdomain: 'nxdomain',
  nodata: 'no data',
  trunc: 'truncated',
  tcp: 'tcp',
  http: 'http',
  httpres: 'http',
};

const isClient = (id: string) => id === 'laptop' || id === 'bob' || id.startsWith('u');

function note(m: Msg): ReactNode {
  const toClient = isClient(m.to) || m.to === 'wifi';
  const fromClient = isClient(m.from) || (m.from === 'wifi' && m.kind === 'query');
  switch (m.kind) {
    case 'query':
      return fromClient ? (
        <>
          <b>rd</b> (recursion desired): “find me the final answer.”
        </>
      ) : (
        <>
          No <b>rd</b> flag: an iterative query. “Just tell me what you know.”
        </>
      );
    case 'referral':
      return (
        <>
          Not an answer: a <b>referral</b>. Authority names who to ask next; additional gives their addresses (<b>glue</b>).
        </>
      );
    case 'answer':
      if (!toClient)
        return (
          <>
            <b>aa</b>: an authoritative answer, straight from the zone.
          </>
        );
      return m.cached ? (
        <>
          From the resolver’s <b>cache</b>, so the TTL has been counting down.
        </>
      ) : (
        <>
          <b>ra</b>: recursion available. Done in <b>{m.ms} ms</b>.
        </>
      );
    case 'cname':
      return (
        <>
          An alias. The resolver starts over for <b>{target(m.answer[0]?.data ?? '')}</b>.
        </>
      );
    case 'nxdomain':
      return (
        <>
          No such name. The SOA’s last number says how long to remember that.
        </>
      );
    case 'nodata':
      return <>The name exists but has no {m.qtype} record.</>;
    case 'trunc':
      return (
        <>
          <b>tc</b>: truncated. The answer won’t fit in 512 bytes of UDP, so ask again over TCP.
        </>
      );
    case 'tcp':
      return <>Setting up a TCP connection to resend the query.</>;
    default:
      return null;
  }
}

function rrClass(r: RR, section: 'ans' | 'auth' | 'add') {
  if (r.type === 'SOA') return css.rrSoa;
  if (r.type === 'CNAME') return css.rrCname;
  if (section === 'auth') return css.rrRef;
  if (section === 'add') return css.rrGlue;
  return css.rrAns;
}

/** Rough rendered height of the dig card for the current message, in px. */
export function digHeight(sim: DnsSim, compact: boolean) {
  const m = sim.dig;
  if (!m) return 72;
  const cap = compact ? 2 : 3;
  const sec = (n: number) => (n ? 1 + Math.min(n, cap) + (n > cap ? 1 : 0) : 0);
  let lines = (sim.cfg.wire ? 1 : 0) + (m.kind === 'tcp' ? 1 : 3);
  if (m.kind !== 'query' && m.kind !== 'tcp' && m.kind !== 'trunc') lines += sec(m.answer.length) + sec(m.authority.length) + sec(m.additional.length);
  return 44 + lines * 16.5 + (compact ? 0 : 50);
}

/** Phones: the dig card sits under the servers and must stay clear of the legend at the bottom. */
export function phoneDig(sim: DnsSim) {
  const dr = sim.digRect();
  const room = sim.h - 84 - dr.y;
  const compact = digHeight(sim, false) > room;
  return { ...dr, compact, overflows: digHeight(sim, compact) > room };
}

export function DigCard({ sim, x, y, w, compact = false }: { sim: DnsSim; x: number; y: number; w: number; compact?: boolean }) {
  const m = sim.dig;
  const style: CSSProperties = { left: x, top: y, width: w };
  if (!m) {
    return (
      <div className={css.dig} style={style}>
        <div className={css.digHead}>packet capture</div>
        <div className={css.digEmpty}>Waiting for the first DNS message…</div>
      </div>
    );
  }
  const secret = m.proto === 'dot' || m.proto === 'doh';
  const wide = w >= 380;
  const rrs = [...m.answer, ...m.authority, ...m.additional];
  const nw = nameWidth(rrs, fqdn(m.qname).length);
  const isResp = m.kind !== 'query' && m.kind !== 'tcp';
  const flags = m.flags.length ? m.flags.join(' ') : '(none)';
  const src = IP_OF[m.from === 'wifi' ? (m.kind === 'query' ? 'laptop' : 'resolver') : m.from] ?? '';
  const dst = IP_OF[m.to === 'wifi' ? (m.kind === 'query' ? 'resolver' : 'laptop') : m.to] ?? '';
  const proto = m.proto === 'tcp' ? 'TCP' : m.proto === 'dot' ? 'TLS' : m.proto === 'doh' ? 'HTTPS' : 'UDP';
  const lines: ReactNode[] = [];
  if (sim.cfg.wire && src && dst) {
    lines.push(
      <div key="wire" className={cx(css.digLine, css.wireLine)} style={w < 380 ? { fontSize: 10 } : undefined}>
        {proto} {src}:{m.sport} → {dst}:<em>{m.dport}</em> · {m.kind === 'tcp' ? 'handshake' : `${m.bytes} bytes`}
      </div>,
    );
  }
  if (m.kind === 'tcp') {
    lines.push(
      <div key="tcp" className={cx(css.digLine, css.rrQ)}>
        {m.label}
      </div>,
    );
  } else {
    lines.push(
      <div key="meta" className={cx(css.digLine, css.digMeta)}>
        ;; id <b>{m.dnsId}</b> · flags: <b>{flags}</b>
        {isResp ? (
          <>
            {' '}
            · <b style={{ color: m.status === 'NXDOMAIN' ? SIG.err : undefined }}>{m.status}</b>
          </>
        ) : null}
      </div>,
    );
    lines.push(
      <div key="qs" className={css.digSec}>
        ;; QUESTION
      </div>,
    );
    lines.push(
      <div key="q" className={cx(css.digLine, css.rrQ)}>
        ;{fqdn(m.qname).padEnd(nw)} {''.padStart(6)} IN {m.qtype}
      </div>,
    );
    const cap = compact ? 2 : 3;
    const sec = (title: string, list: RR[], kind: 'ans' | 'auth' | 'add', ttls?: number[]) => {
      if (!list.length) return;
      lines.push(
        <div key={`${title}-h`} className={css.digSec}>
          ;; {title}
          {list.length > cap ? ` · ${list.length} records` : ''}
        </div>,
      );
      list.slice(0, cap).forEach((r, i) =>
        lines.push(
          <div key={`${title}-${i}`} className={cx(css.digLine, rrClass(r, kind))}>
            {' '}
            {fmtRR(r, nw, ttls?.[i])}
          </div>,
        ),
      );
      if (list.length > cap) {
        lines.push(
          <div key={`${title}-more`} className={cx(css.digLine, css.digMeta)}>
            {' '}… {list.length - cap} more
          </div>,
        );
      }
    };
    if (isResp && m.kind !== 'trunc') {
      sec('ANSWER', m.answer, 'ans', m.ttls);
      sec('AUTHORITY', m.authority, 'auth');
      sec(wide ? 'ADDITIONAL (glue)' : 'ADDITIONAL', m.additional, 'add');
      if (!m.answer.length && !m.authority.length && m.kind !== 'nodata') lines.push(<div key="empty" className={css.digSec} />);
    }
  }
  return (
    <div className={css.dig} style={style} data-kind={m.kind}>
      <div className={css.digHead}>
        <b>{KIND_HEAD[m.kind]}</b>
        <span className={css.digRoute}>
          {WHO[m.from === 'wifi' ? (m.kind === 'query' ? 'laptop' : 'resolver') : m.from] ?? m.from} → {WHO[m.to === 'wifi' ? (m.kind === 'query' ? 'resolver' : 'laptop') : m.to] ?? m.to}
        </span>
        <span className={css.digNum}>{secret ? '🔒 encrypted on the wire' : `msg ${m.n}`}</span>
      </div>
      <div key={m.seq} className={css.digBody}>
        {lines}
        {!compact && <div className={css.digNote}>{note(m)}</div>}
      </div>
    </div>
  );
}

/* ---------------- cache readout ---------------- */

function valueOf(e: CacheEntry) {
  if (e.kind === 'nx') return 'NXDOMAIN';
  if (e.kind === 'nodata') return `no ${e.type}`;
  return e.data.replace(/\.$/, '');
}

export function CacheTable({ sim, owner, max, hints }: { sim: DnsSim; owner: string; max: number; hints?: boolean }) {
  const rows = [...sim.table(owner)].sort((a, b) => a.born - b.born || a.id - b.id);
  const shown = rows.slice(Math.max(0, rows.length - max));
  const hidden = rows.length - shown.length;
  if (!rows.length && !hints) return <div className={css.cempty}>empty</div>;
  return (
    <>
      <table className={css.ctable}>
        <colgroup>
          <col style={{ width: '37%' }} />
          <col style={{ width: 38 }} />
          <col />
          <col style={{ width: 50 }} />
        </colgroup>
        <tbody>
          {hints && (
            <tr className={css.chint}>
              <td>.</td>
              <td>NS</td>
              <td>a–m.root-servers.net</td>
              <td className={css.cTtl}>hints</td>
            </tr>
          )}
          {shown.map((e) => {
            const left = sim.ttlLeft(e);
            const expired = e.exp <= sim.t;
            const frac = Math.max(0, Math.min(1, (e.exp - sim.t) / e.ttl));
            const color = e.kind === 'ref' || e.kind === 'glue' ? '181,155,255' : e.kind === 'nx' ? '255,77,106' : e.kind === 'cname' ? '255,154,60' : '75,227,160';
            return (
              <tr
                key={e.id}
                className={css.crow}
                data-kind={e.kind}
                data-fresh={sim.t - e.born < 1.1 && !expired}
                data-low={left <= 5 && !expired}
                data-expired={expired}
                style={{ background: `linear-gradient(90deg, rgba(${color},0.1) ${frac * 100}%, transparent ${frac * 100}%)` }}
              >
                <td className={css.cName}>{e.name || '.'}</td>
                <td className={css.cType}>{e.type === 'ANY' ? '' : e.type}</td>
                <td className={css.cVal}>{valueOf(e)}</td>
                <td className={css.cTtl}>{expired ? 'gone' : left}</td>
              </tr>
            );
          })}
          {!rows.length && (
            <tr>
              <td colSpan={4} className={css.cempty}>
                empty: nothing learned yet
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {hidden > 0 && <div className={css.cmore}>+{hidden} older entries</div>}
    </>
  );
}

/* ---------------- zone file ---------------- */

export function zoneLines(sim: DnsSim) {
  const ttl = sim.ttlA;
  return [
    { t: '$ORIGIN shop.example.', dir: true, key: '' },
    { t: '$TTL 3600', dir: true, key: '' },
    { t: '@     SOA   ns1 hostmaster (… 300)', key: 'shop.example|SOA' },
    { t: '@     NS    ns1', key: 'shop.example|NS' },
    { t: '@     NS    ns2', key: 'shop.example|NS' },
    { t: `@ ${String(ttl).padEnd(4)}A     ${sim.shopIp}`, key: 'shop.example|A' },
    { t: '@ 300 AAAA  2001:db8::10', key: 'shop.example|AAAA' },
    { t: '@     MX    10 mail', key: 'shop.example|MX' },
    { t: '@     TXT   "v=spf1 mx -all"', key: 'shop.example|TXT' },
    { t: `www   CNAME ${sim.wwwTarget}`, key: 'www.shop.example|CNAME' },
    { t: 'api   300 A 203.0.113.11', key: 'api.shop.example|A' },
    { t: 'mail  A     203.0.113.25', key: 'mail.shop.example|A' },
    { t: 'ns1   A     203.0.113.53', key: 'ns1.shop.example|A' },
    { t: 'ns2   A     198.51.100.54', key: 'ns2.shop.example|A' },
  ];
}

export function ZoneFile({ sim }: { sim: DnsSim }) {
  const hit = sim.zoneHit && sim.vt - sim.zoneHit.vt < 3.2 ? `${sim.zoneHit.name}|${sim.zoneHit.type}` : null;
  return (
    <div className={css.zone}>
      {zoneLines(sim).map((l, i) => (
        <div key={i} className={css.zoneLine} data-dir={!!l.dir} data-hit={!!hit && l.key === hit}>
          {l.t}
        </div>
      ))}
    </div>
  );
}

/* ---------------- tree: reading a name right to left ---------------- */

export function NameRead({ sim }: { sim: DnsSim }) {
  const lit = sim.treeLit;
  const portrait = sim.orient === 'portrait';
  return (
    <div className={css.nameRead} style={{ left: sim.w / 2, top: portrait ? 16 : 22, fontSize: portrait ? 19 : 22 }}>
      <span data-on={lit === 2}>shop</span>
      <span>.</span>
      <span data-on={lit === 1}>example</span>
      <span data-on={lit === 0}>.</span>
      <small>{lit === 0 ? 'the final dot: the root' : lit === 1 ? 'then the TLD' : 'then the domain'}</small>
    </div>
  );
}

/** Phones: how many cache rows fit between the lowest server and the docked strip. */
function stripRows(sim: DnsSim) {
  const lows = SERVER_IDS.filter((id) => sim.isLive(id)).map((id) => sim.boxes.get(id)!);
  const bottom = lows.length ? Math.max(...lows.map((b) => b.ty + b.h / 2)) : sim.h * 0.5;
  const room = sim.h - 56 - bottom - 18 - 46;
  return Math.max(3, Math.min(9, Math.floor(room / 18.5)));
}

/* ---------------- everything on top of the SVG ---------------- */

export function Overlay({ sim, step, highlight }: { sim: DnsSim; step: Step; highlight: string | null }) {
  const v = sim.cfg.view;
  const L = sim.orient === 'landscape';
  const dock = sim.cfg.dock;
  const q = sim.game?.pending;
  const res = sim.boxes.get('resolver');
  const laptop = sim.boxes.get('laptop');
  const bob = sim.boxes.get('bob');
  const auth = sim.boxes.get('auth');
  const wifi = sim.boxes.get('wifi');
  const showDig = sim.cfg.dig && (L || dock === 'dig');
  const showCache = sim.cfg.cacheTable && res && sim.isLive('resolver') && (L || dock === 'cache');
  const dr = sim.digRect();
  const out: ReactNode[] = [];

  out.push(<Hud key="hud" items={hudItems(sim, step.hud ?? [])} />);
  if (v === 'tree') out.push(<NameRead key="name" sim={sim} />);
  if (showDig) out.push(<DigCard key="dig" sim={sim} x={dr.x} y={dr.y} w={dr.w} compact={!L && phoneDig(sim).compact} />);

  if (showCache && res) {
    const n = sim.table('resolver').length;
    const head = `resolver cache · ${n} ${n === 1 ? 'entry' : 'entries'}`;
    out.push(
      <div key="cache" className={highlight === 'cache' ? css.readoutGlow : undefined} style={{ display: 'contents' }}>
        {L ? (
          <Readout x={res.x} y={res.y + res.h / 2 + 16} anchor="below" head={head} width={340}>
            <CacheTable sim={sim} owner="resolver" max={sim.cfg.stubTable ? 7 : 9} hints />
          </Readout>
        ) : (
          <Readout anchor="strip" head={head}>
            <CacheTable sim={sim} owner="resolver" max={stripRows(sim)} />
          </Readout>
        )}
      </div>,
    );
  }

  if (L && sim.cfg.stubTable && laptop && sim.isLive('laptop')) {
    const anchorBox = bob && sim.isLive('bob') ? bob : laptop;
    out.push(
      <Readout key="stub" x={Math.max(laptop.x, 16 + 115)} y={anchorBox.y + anchorBox.h / 2 + 16} anchor="below" head="Alice’s OS cache" width={230}>
        <CacheTableSmall sim={sim} />
      </Readout>,
    );
  }

  if (sim.cfg.zoneFile && auth && sim.isLive('auth') && (L || dock === 'zone')) {
    out.push(
      L ? (
        <Readout key="zone" x={Math.min(auth.x, sim.w - 210)} y={auth.y + auth.h / 2 + 16} anchor="below" head="zone file · shop.example" width={380}>
          <ZoneFile sim={sim} />
        </Readout>
      ) : (
        <Readout key="zone" anchor="strip" head="zone file · shop.example">
          <ZoneFile sim={sim} />
        </Readout>
      ),
    );
  }

  if (wifi && sim.isLive('wifi') && (L || dock === 'snoop')) {
    const body = (
      <>
        {sim.snoop.length ? (
          sim.snoop.map((l) => (
            <div key={l.id} className={css.snoopLine} data-secret={l.secret}>
              {l.text}
            </div>
          ))
        ) : (
          <div className={css.cempty}>listening…</div>
        )}
      </>
    );
    out.push(
      L ? (
        <Readout
          key="snoop"
          x={Math.max(16 + 155, Math.min(wifi.x, (res?.x ?? sim.w) - 110 - 12 - 155))}
          y={wifi.y + wifi.h / 2 + 16}
          anchor="below"
          head="what the café Wi-Fi sees"
          width={310}
        >
          {body}
        </Readout>
      ) : (
        <Readout key="snoop" anchor="strip" head="what the café Wi-Fi sees">
          {body}
          <div className={css.snoopLine} style={{ color: '#d9ccff', marginTop: 5 }}>
            resolver sees: {sim.resolverLog.length ? sim.resolverLog.slice(-3).join(', ') : '…'}
          </div>
        </Readout>
      ),
    );
    if (L && res) {
      out.push(
        <Readout key="reslog" x={res.x} y={res.y + res.h / 2 + 16} anchor="below" head="what the resolver sees" width={220}>
          {sim.resolverLog.length ? (
            sim.resolverLog.map((n, i) => (
              <div key={i} className={css.snoopLine} style={{ color: '#d9ccff' }}>
                {n}
              </div>
            ))
          ) : (
            <div className={css.cempty}>nothing yet</div>
          )}
        </Readout>,
      );
    }
  }

  const pa = sim.promptAt();
  const pill = (key: string, text: string) => {
    if (!pa) return null;
    const half = Math.min(sim.w / 2 - 12, text.length * 3.35 + 12);
    const x = Math.min(Math.max(pa.x, 12 + half), sim.w - 12 - half);
    return (
      <StagePrompt key={key} x={x} y={pa.y}>
        {text}
      </StagePrompt>
    );
  };
  if (q) {
    const stage = sim.game?.awaitingStageClick;
    out.push(pill('ask', L ? `${q.ask ?? ''}${stage ? ' · click a server' : ''}` : stage ? 'Which server next? Tap it' : (q.ask ?? '')));
  } else if (sim.holding) {
    out.push(pill('hold', L ? 'Read the referral, then press Continue' : 'Press Continue'));
  }
  return <>{out}</>;
}

function CacheTableSmall({ sim }: { sim: DnsSim }) {
  const rows = sim.table('laptop');
  if (!rows.length) return <div className={css.cempty}>empty</div>;
  return (
    <table className={css.ctable}>
      <colgroup>
        <col />
        <col style={{ width: 44 }} />
      </colgroup>
      <tbody>
        {rows.slice(-3).map((e) => {
          const expired = e.exp <= sim.t;
          return (
            <tr key={e.id} className={css.crow} data-kind={e.kind} data-expired={expired} data-low={sim.ttlLeft(e) <= 5 && !expired}>
              <td className={css.cVal}>
                {e.name} {e.kind === 'nx' ? 'NXDOMAIN' : e.data}
              </td>
              <td className={css.cTtl}>{expired ? 'gone' : sim.ttlLeft(e)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** Rectangles for callouts that point at overlay pieces rather than boxes. */
export function resolveTarget(sim: DnsSim, target0: string) {
  let t = target0;
  if (t.startsWith('L:')) {
    // Landscape-only callout: on phones there's no room beside the drawing.
    if (sim.orient !== 'landscape') return null;
    t = t.slice(2);
    const b = sim.boxes.get(t);
    if (b && !Number.isNaN(b.x)) return { x: b.x, y: b.y, w: b.w, h: b.h };
  }
  if (t === 'dig') {
    const r = sim.digRect();
    return { x: r.x + r.w / 2, y: r.y + 60, w: r.w, h: 120 };
  }
  if (t === 'dig-glue') {
    const r = sim.digRect();
    const m = sim.dig;
    if (!m || !m.additional.length) return null;
    const lines = (sim.cfg.wire ? 1 : 0) + 1 + 2 + 1 + Math.min(2, m.authority.length) + 1 + Math.min(2, m.additional.length) / 2;
    return { x: r.x + r.w / 2, y: r.y + 34 + lines * 16, w: r.w, h: 20 };
  }
  if (t === 'letters') {
    const b = sim.boxes.get('root');
    return b ? { x: b.x, y: b.y + b.h / 2 + 13, w: b.w * 0.8, h: 14 } : null;
  }
  if (t === 'cache') {
    const b = sim.boxes.get('resolver');
    return b ? { x: b.x, y: b.y + b.h / 2 + 60, w: 340, h: 90 } : null;
  }
  if (t === 'leaves') {
    const b = sim.boxes.get('auth');
    return b ? { x: b.x - b.w / 2 + 70, y: b.y + b.h / 2 + 30, w: 140, h: 44 } : null;
  }
  if (t.startsWith('seq:')) {
    const g = seqGeom(sim);
    if (t === 'seq:stub') return { x: g.col(0), y: g.yOf(SEQ[3].t0), w: 12, h: 30 };
    if (t === 'seq:res') return { x: g.col(1), y: g.yOf(SEQ[4].t0), w: 12, h: 30 };
  }
  return null;
}
