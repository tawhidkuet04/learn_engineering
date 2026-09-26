import { Effects, Flights, Wires } from '@/components/stage/svg';
import { SIG } from '@/lib/sim/colors';
import { clamp } from '@/lib/sim/geometry';
import type { Box } from '@/lib/sim/Sim';
import { OTHER_ROOTS, ROOT, TODAY } from '../sim/data';
import type { SigLink } from '../sim/cert';
import { cid } from '../sim/cert';
import { pid, type PotId } from '../sim/paint';
import type { Enc, HsFlight, HsMsg } from '../sim/shake';
import type { TlsSim } from '../sim/TlsSim';
import css from '../tls.module.css';
import {
  BrowserNode,
  Card,
  CertCard,
  Cross,
  Eye,
  KeyChip,
  KeyGlyph,
  Lock,
  Person,
  Pot,
  RouterGlyph,
  ServerGlyph,
  Tick,
  Wifi,
  type BrowserLook,
  type RowSpot,
} from './parts';

export interface SceneProps {
  sim: TlsSim;
  dim: (id: string) => boolean;
  glow: (id: string) => boolean;
}

const live = (sim: TlsSim, id: string): Box | null => {
  const b = sim.boxes.get(id);
  return b && !Number.isNaN(b.x) ? b : null;
};

/* ================================================================== */
/* Wire: Alice → café Wi-Fi → ISP → shop.example, with Eve or Mallory   */
/* ================================================================== */

export function WireScene({ sim, dim, glow }: SceneProps) {
  const w = sim.wire;
  const portrait = sim.orient === 'portrait';
  const alice = live(sim, 'alice');
  const wifi = live(sim, 'wifi');
  const mal = live(sim, 'mallory');
  const isp = live(sim, 'isp');
  const server = live(sim, 'server');
  const eve = live(sim, 'eve');
  const tap = live(sim, 'tap');
  const story = w.cfg.story;
  const look: BrowserLook = { ...w.browser };
  const mid = wifi ?? mal;

  return (
    <>
      {!portrait && alice && mid && server && isp && (
        <g opacity={0.9}>
          <text className={css.caps} x={(alice.x - alice.w / 2 + mid.x + mid.w / 2) / 2} y={alice.y - alice.h / 2 - 46} textAnchor="middle">
            café · shared Wi-Fi
          </text>
          <text className={css.caps} x={(isp.x + server.x) / 2} y={alice.y - alice.h / 2 - 46} textAnchor="middle">
            the internet
          </text>
          <line x1={mid.x + mid.w / 2 + 18} y1={alice.y - alice.h / 2 - 58} x2={mid.x + mid.w / 2 + 18} y2={alice.y + alice.h / 2 + 18} stroke="rgba(143,166,201,0.2)" strokeDasharray="2 6" />
        </g>
      )}
      <Wires sim={sim} />
      {tap && (
        <g transform={`translate(${tap.x},${tap.y})`} opacity={tap.alpha * (dim('eve') ? 0.3 : 1)}>
          <circle r={8 + ((sim.vt * 0.9) % 1) * 6} fill="none" stroke={SIG.err} strokeOpacity={0.5 * (1 - ((sim.vt * 0.9) % 1))} />
          <circle r={4} fill={SIG.err} />
        </g>
      )}
      {alice && <BrowserNode box={alice} look={look} compact={portrait} dim={dim('alice')} glow={glow('alice')} />}
      {wifi && <Card box={wifi} title="café Wi-Fi" sub="open hotspot" icon={<Wifi x={0} y={-1} s={0.9} />} dim={dim('wifi')} glow={glow('wifi')} />}
      {mal && (
        <Card
          box={mal}
          title="Free_Cafe_WiFi"
          sub="Mallory’s hotspot"
          tone="rgba(255,77,106,0.75)"
          kicker={portrait ? undefined : { text: 'Mallory · in the middle', color: SIG.err }}
          icon={<Wifi x={0} y={-1} s={0.9} color={SIG.err} />}
          dim={dim('mallory')}
          glow={glow('mallory')}
        />
      )}
      {isp && <Card box={isp} title="ISP router" sub={portrait ? undefined : 'AS 64500'} icon={<RouterGlyph x={0} y={0} />} dim={dim('isp')} glow={glow('isp')} />}
      {server && <Card box={server} title="shop.example" sub="203.0.113.10" icon={<ServerGlyph x={0} y={0} />} dim={dim('server')} glow={glow('server')} />}
      {eve && <Person box={eve} name="Eve" sub={portrait ? undefined : 'on the café Wi-Fi'} color={SIG.err} dim={dim('eve')} glow={glow('eve')} />}
      <WireKeys sim={sim} portrait={portrait} story={story} />
      <Flights sim={sim} />
      <Effects sim={sim} />
    </>
  );
}

function WireKeys({ sim, portrait, story }: { sim: TlsSim; portrait: boolean; story: string }) {
  const w = sim.wire;
  const alice = live(sim, 'alice');
  const server = live(sim, 'server');
  const eve = live(sim, 'eve');
  const chips = [];
  const below = (b: Box, dy = 8) => ({ x: b.x, y: b.y + b.h / 2 + dy });
  if (story === 'orders' || story === 'keys') {
    if (alice && w.keys.alice) chips.push(<KeyChip key="ka" x={alice.x - alice.w / 2} y={alice.y + alice.h / 2 + 7} kind="shared" text="key K" anchor="start" />);
    if (server && w.keys.server) {
      const p = portrait ? { x: server.x + server.w / 2 + 6, y: server.y - 8.5 } : below(server);
      chips.push(<KeyChip key="ks" x={p.x} y={p.y} kind="shared" text="key K" anchor={portrait ? 'start' : 'middle'} />);
    }
    if (eve && w.keys.eve) {
      const p = portrait ? { x: eve.x + eve.w / 2, y: eve.y + eve.h / 2 + 5 } : below(eve);
      chips.push(<KeyChip key="ke" x={p.x} y={p.y} kind="stolen" text="stolen key K" anchor={portrait ? 'end' : 'middle'} />);
    }
  }
  if (story === 'pair') {
    if (server) {
      if (portrait) {
        chips.push(<KeyChip key="spriv" x={server.x + server.w / 2 + 6} y={server.y - 19} kind="private" text="private" anchor="start" />);
        chips.push(<KeyChip key="spub" x={server.x + server.w / 2 + 6} y={server.y + 2} kind="public" text="public" anchor="start" />);
      } else {
        chips.push(<KeyChip key="spriv" x={server.x} y={server.y + server.h / 2 + 8} kind="private" text="private key · never sent" />);
        chips.push(<KeyChip key="spub" x={server.x} y={server.y + server.h / 2 + 29} kind="public" text="public key · share freely" />);
      }
    }
    if (alice && w.pub.alice) chips.push(<KeyChip key="apub" x={alice.x - alice.w / 2} y={alice.y + alice.h / 2 + 7} kind="public" text={portrait ? 'public key' : 'shop.example’s public key'} anchor="start" />);
    if (eve && w.pub.eve) {
      const p = portrait ? { x: eve.x + eve.w / 2, y: eve.y + eve.h / 2 + 5 } : below(eve);
      chips.push(<KeyChip key="epub" x={p.x} y={p.y} kind="public" text="public key" anchor={portrait ? 'end' : 'middle'} />);
    }
  }
  return <g>{chips}</g>;
}

/* ================================================================== */
/* Paint: Diffie–Hellman with colors (and numbers)                      */
/* ================================================================== */

export function PaintScene({ sim, dim, glow }: SceneProps) {
  const p = sim.paint;
  const portrait = sim.orient === 'portrait';
  const alice = live(sim, pid('alice'));
  const server = live(sim, pid('server'));
  const eve = live(sim, pid('eve'));
  const mal = live(sim, pid('mal'));
  const tap = live(sim, pid('tap'));
  const aFin = live(sim, pid('aFin'));
  const bFin = live(sim, pid('bFin'));
  const mFinA = live(sim, pid('mFinA'));
  const mFinB = live(sim, pid('mFinB'));
  const pot = (id: PotId) => {
    const b = live(sim, pid(id));
    if (!b) return null;
    const l = p.label(id);
    const mark = p.compared && (id === 'aFin' || id === 'bFin' || id === 'mFinA' || id === 'mFinB') ? (p.mitm ? 'bad' : 'ok') : null;
    return (
      <Pot
        key={id}
        box={b}
        color={p.fill[id]}
        partial={p.partial[id]}
        secret={id === 'aSec' || id === 'bSec' || id === 'mSec'}
        label={l.title}
        sub={l.sub}
        num={p.numbers && p.fill[id] ? l.num : undefined}
        dim={dim(pid(id))}
        glow={glow(pid(id))}
        mark={mark}
        compact={portrait}
        plain={p.numbers}
      />
    );
  };
  const eq = (key: string, a: Box, b: Box, text: string, ok: boolean, dy: number) => {
    const x = (a.x + b.x) / 2;
    const y = a.y + dy;
    return (
      <g key={key}>
        <line x1={a.x + a.w / 2 + 8} y1={a.y} x2={b.x - b.w / 2 - 8} y2={b.y} stroke={ok ? SIG.res : SIG.err} strokeOpacity={0.55} strokeDasharray="3 4" />
        <circle cx={x} cy={a.y} r={portrait ? 9 : 12} fill="rgba(7,11,20,0.95)" stroke={ok ? SIG.res : SIG.err} />
        <text x={x} y={a.y + (portrait ? 4.5 : 6)} textAnchor="middle" style={{ fontFamily: 'var(--font-sans)', fontSize: portrait ? 13 : 17, fontWeight: 700, fill: ok ? SIG.res : SIG.err }}>
          {ok ? '=' : '≠'}
        </text>
        {text && (
          <text x={x} y={y} textAnchor="middle" className={`${css.caps} ${css.halo}`} style={{ fill: ok ? SIG.res : SIG.err, fontSize: portrait ? 7.5 : 9 }}>
            {text}
          </text>
        )}
      </g>
    );
  };
  return (
    <>
      <Wires sim={sim} />
      {tap && (
        <g transform={`translate(${tap.x},${tap.y})`} opacity={tap.alpha}>
          <circle r={4} fill={SIG.err} />
        </g>
      )}
      {!portrait && !p.mitm && (
        <text className={css.caps} x={sim.w / 2} y={(live(sim, pid('aMix'))?.y ?? 0) - 30} textAnchor="middle" style={{ fill: 'var(--text-3)' }}>
          public wire · anyone can copy
        </text>
      )}
      {alice && <Card box={alice} title="Alice" sub={portrait ? undefined : 'browser'} dim={dim(pid('alice'))} glow={glow(pid('alice'))} />}
      {server && <Card box={server} title="shop.example" sub={portrait ? undefined : 'server'} icon={portrait ? undefined : <ServerGlyph x={0} y={0} />} dim={dim(pid('server'))} glow={glow(pid('server'))} />}
      {eve && <Person box={eve} name="Eve" color={SIG.err} dim={dim(pid('eve'))} glow={glow(pid('eve'))} />}
      {mal && (
        <Card box={mal} title="Mallory" sub={portrait ? undefined : 'in the middle'} tone="rgba(255,77,106,0.75)" dim={dim(pid('mal'))} glow={glow(pid('mal'))}>
          {p.malMix && <circle cx={mal.w - 16} cy={mal.h / 2} r={portrait ? 7 : 9} fill={p.malMix} stroke="rgba(255,255,255,0.3)" />}
        </Card>
      )}
      {p.pots.map((id) => pot(id))}
      {p.compared && !p.mitm && aFin && bFin && eq('ab', aFin, bFin, portrait ? 'shared' : 'same color: the shared secret', true, portrait ? 22 : 30)}
      {p.compared && p.mitm && aFin && mFinA && eq('am', aFin, mFinA, '', true, 0)}
      {p.compared && p.mitm && bFin && mFinB && eq('mb', mFinB, bFin, '', true, 0)}
      {p.compared && p.mitm && mFinA && mFinB && eq('mm', mFinA, mFinB, '', false, 0)}
      <Flights sim={sim} labels={p.numbers} />
      <Effects sim={sim} />
    </>
  );
}

/* ================================================================== */
/* Certificates: the chain and the browser's checks                    */
/* ================================================================== */

export function CertScene({ sim, dim, glow }: SceneProps) {
  const c = sim.cert;
  const portrait = sim.orient === 'portrait';
  const alice = live(sim, cid('alice'));
  const server = live(sim, cid('server'));
  const leaf = live(sim, cid('leaf'));
  const inter = live(sim, cid('inter'));
  const store = live(sim, cid('store'));
  const sc = c.scenario;
  const spots = c.spots();
  const links = c.links();
  const rowSpots = (card: 'leaf' | 'inter' | 'root'): RowSpot[] => {
    const out: RowSpot[] = spots.filter((s) => s.card === card).map((s) => ({ k: s.k, tone: s.tone }));
    for (const l of links) {
      if (l.to === card) out.push({ k: 'sig', tone: l.tone });
      if (l.from === card && card !== 'leaf') out.push({ k: 'key', tone: l.tone === 'fail' ? 'run' : l.tone });
    }
    return out;
  };

  const err = c.browser === 'error' && sc;
  const look: BrowserLook = {
    url: 'shop.example',
    secure: c.browser === 'secure' ? 'lock' : err ? 'warn' : 'pending',
    title: c.browser === 'secure' ? 'Trail boots' : 'Connecting…',
    lines: c.browser === 'secure' ? ['$49.00 · in stock', 'Add to cart'] : [c.arrived ? 'checking the certificate…' : 'waiting for the server…'],
    error: err ? { title: sc.fails === 'proof' ? 'Secure connection failed' : 'Your connection is not private', line: sc.warning, code: sc.code } : null,
  };

  const nameRun = c.status.name === 'run' || (c.status.name !== 'todo' && c.cursor === 1 && !c.complete) || c.status.name === 'fail';
  const nameTone = c.status.name === 'run' ? SIG.warn : c.status.name === 'fail' ? SIG.err : SIG.res;
  const datesOn = c.status.dates === 'run' || c.status.dates === 'fail' || (c.status.dates === 'ok' && c.cursor === 2 && !c.complete);
  const rootTone = c.status.root === 'run' ? SIG.warn : c.status.root === 'fail' ? SIG.err : c.status.root === 'ok' && c.cursor === 4 ? SIG.res : null;

  return (
    <>
      {alice && <BrowserNode box={alice} look={look} compact={portrait} dim={dim(cid('alice'))} glow={glow(cid('alice'))} />}
      {alice && nameRun && (
        <rect
          x={alice.x - alice.w / 2 + 4}
          y={alice.y - alice.h / 2 + (portrait ? 12 : 17)}
          width={alice.w - 8}
          height={portrait ? 22 : 25}
          rx={11}
          fill="none"
          stroke={nameTone}
          strokeWidth={1.6}
        />
      )}
      {alice && datesOn && (
        <g transform={`translate(${alice.x - alice.w / 2},${alice.y + alice.h / 2 + (portrait ? 3 : 7)})`}>
          <rect width={portrait ? 138 : 172} height={17} rx={8.5} fill="rgba(7,11,20,0.92)" stroke={c.status.dates === 'fail' ? SIG.err : SIG.warn} strokeOpacity={0.8} />
          <text x={9} y={11.8} style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, fill: c.status.dates === 'fail' ? '#ffb3c0' : SIG.warn }}>
            {portrait ? `today: ${TODAY}` : `browser clock: ${TODAY}`}
          </text>
        </g>
      )}
      {server &&
        (c.fake ? (
          <Card box={server} title="Mallory" sub={portrait ? 'fake server' : 'posing as shop.example'} tone="rgba(255,77,106,0.75)" icon={<Eye x={0} y={0} s={0.9} />} dim={dim(cid('server'))} glow={glow(cid('server'))} />
        ) : (
          <Card box={server} title="shop.example" sub="203.0.113.10" icon={<ServerGlyph x={0} y={0} />} dim={dim(cid('server'))} glow={glow(cid('server'))} />
        ))}
      {store && <TrustStore sim={sim} box={store} tone={rootTone} spots={rowSpots('root')} portrait={portrait} dim={dim(cid('store'))} glow={glow(cid('store'))} />}
      {inter && c.inter && <CertCard box={inter} data={c.inter} spots={rowSpots('inter')} compact={portrait} dim={dim(cid('inter'))} glow={glow(cid('inter'))} />}
      {leaf && <CertCard box={leaf} data={c.leaf} spots={rowSpots('leaf')} compact={portrait} fake={!!sc && c.failed} dim={dim(cid('leaf'))} glow={glow(cid('leaf'))} />}
      {links.map((l) => (
        <LinkPill key={`${l.from}-${l.to}`} sim={sim} link={l} portrait={portrait} />
      ))}
      <Flights sim={sim} />
      <Effects sim={sim} />
    </>
  );
}

function TrustStore({ sim, box, tone, spots, portrait, dim, glow }: { sim: TlsSim; box: Box; tone: string | null; spots: RowSpot[]; portrait: boolean; dim: boolean; glow: boolean }) {
  const headH = portrait ? 14 : 20;
  const rootH = portrait ? 46 : 100;
  const inner: Box = { ...box, id: 'ce:root', x: box.x, y: box.y - box.h / 2 + headH + 4 + rootH / 2, w: box.w - (portrait ? 12 : 16), h: rootH };
  const noMatch = sim.cert.status.root === 'fail';
  return (
    <g opacity={box.alpha * (dim ? 0.28 : 1)}>
      {glow && <rect x={box.x - box.w / 2 - 6} y={box.y - box.h / 2 - 6} width={box.w + 12} height={box.h + 12} rx={14} fill="none" stroke="var(--accent)" strokeDasharray="3 3" strokeWidth={1.4} />}
      <rect x={box.x - box.w / 2} y={box.y - box.h / 2} width={box.w} height={box.h} rx={12} fill="rgba(75,227,160,0.035)" stroke={tone ?? 'rgba(75,227,160,0.45)'} strokeDasharray={tone ? undefined : '4 4'} strokeWidth={tone ? 1.5 : 1.1} />
      <text className={css.caps} x={box.x - box.w / 2 + 10} y={box.y - box.h / 2 + (portrait ? 10.5 : 13.5)} style={{ fill: SIG.res, fontSize: portrait ? 7.6 : 8.6 }}>
        {portrait ? 'Alice’s trust store' : 'Alice’s trust store · built into her OS / browser'}
      </text>
      {noMatch ? (
        <g>
          <rect x={inner.x - inner.w / 2} y={inner.y - inner.h / 2} width={inner.w} height={inner.h} rx={8} fill="rgba(255,77,106,0.08)" stroke="rgba(255,77,106,0.6)" strokeDasharray="4 3" />
          <Cross x={inner.x - inner.w / 2 + 16} y={inner.y} s={portrait ? 0.9 : 1.1} />
          <text x={inner.x - inner.w / 2 + 30} y={inner.y + 4} style={{ fontFamily: 'var(--font-sans)', fontSize: portrait ? 10.5 : 12, fontWeight: 600, fill: '#ffb3c0' }}>
            No root named “shop.example” here
          </text>
        </g>
      ) : (
        <CertCard box={inner} data={ROOT} spots={spots} compact={portrait} tag={portrait ? 'pre-installed' : 'pre-installed · trusted'} bare />
      )}
      <text className={css.mono} x={box.x - box.w / 2 + 10} y={box.y + box.h / 2 - (portrait ? 5 : 8)} style={{ fontSize: portrait ? 7.8 : 9 }}>
        {portrait ? `+ ${OTHER_ROOTS[0]}, ${OTHER_ROOTS[2]}… ~150 roots` : `+ ${OTHER_ROOTS[0]} · ${OTHER_ROOTS[1]} · … ~150 roots`}
      </text>
    </g>
  );
}

function LinkPill({ sim, link, portrait }: { sim: TlsSim; link: SigLink; portrait: boolean }) {
  const leaf = live(sim, cid('leaf'));
  const inter = live(sim, cid('inter'));
  const store = live(sim, cid('store'));
  if (!leaf) return null;
  const color = link.tone === 'run' ? SIG.warn : link.tone === 'ok' ? SIG.res : SIG.err;
  let y: number;
  let text: string;
  if (link.from === 'leaf') {
    y = leaf.y + leaf.h / 2 + (store ? (store.y - store.h / 2 - (leaf.y + leaf.h / 2)) / 2 : 12);
    text = link.tone === 'run' ? 'checking its signature…' : portrait ? 'signed by itself ✓ (proves nothing)' : 'signed by itself: the math checks out, but proves nothing';
  } else if (link.from === 'inter') {
    if (!inter) return null;
    y = (leaf.y + leaf.h / 2 + inter.y - inter.h / 2) / 2;
    text =
      link.tone === 'run'
        ? portrait
          ? 'R3’s key checks the leaf…'
          : 'Example CA R3’s public key checks the leaf’s signature…'
        : link.tone === 'ok'
          ? portrait
            ? '✓ leaf signed by Example CA R3'
            : '✓ the leaf really was signed by Example CA R3'
          : portrait
            ? '✗ signature doesn’t match'
            : '✗ signature doesn’t match the edited contents';
  } else {
    if (!inter || !store) return null;
    y = (inter.y + inter.h / 2 + store.y - store.h / 2) / 2;
    text = link.tone === 'run' ? (portrait ? 'root’s key checks R3…' : 'Example Root X1’s public key checks R3’s signature…') : portrait ? '✓ R3 signed by Example Root X1' : '✓ Example CA R3 really was signed by Example Root X1';
  }
  const fs = portrait ? 8.6 : 10;
  const w = text.length * (portrait ? 5.1 : 5.9) + 18;
  return (
    <g transform={`translate(${leaf.x - w / 2},${y - 8.5})`}>
      <rect width={w} height={17} rx={8.5} fill="rgba(7,11,20,0.95)" stroke={color} strokeOpacity={0.85} />
      <text x={w / 2} y={11.8} textAnchor="middle" style={{ fontFamily: 'var(--font-mono)', fontSize: fs, fontWeight: 500, fill: color }}>
        {text}
      </text>
    </g>
  );
}

/* ================================================================== */
/* Handshake: sequence diagram with Eve's tap in the middle            */
/* ================================================================== */

export const ENC_COLOR: Record<Enc, string> = { tcp: SIG.dim, clear: SIG.req, hs: SIG.res, app: SIG.res, early: SIG.heavy, attack: SIG.err };
const sealed = (e: Enc) => e === 'hs' || e === 'app' || e === 'early';

function Chip({ x, y, anchor, msg, compact, revealed, asking, h }: { x: number; y: number; anchor: 'start' | 'end'; msg: HsMsg; compact: boolean; revealed: boolean; asking: boolean; h: number }) {
  const label = compact ? msg.short : msg.name;
  const charW = compact ? 5.15 : 6.05;
  const lock = revealed && sealed(msg.enc);
  const w = label.length * charW + (lock ? 22 : 12) + (revealed || compact ? 0 : 10);
  const x0 = anchor === 'end' ? x - w : x;
  const color = revealed ? ENC_COLOR[msg.enc] : SIG.warn;
  const text = msg.enc === 'tcp' ? SIG.text2 : color;
  return (
    <g transform={`translate(${x0},${y})`}>
      <rect
        width={w}
        height={h - 2}
        rx={4}
        fill={revealed ? `${color}14` : 'rgba(255,210,63,0.08)'}
        stroke={color}
        strokeOpacity={msg.enc === 'tcp' ? 0.4 : 0.75}
        strokeDasharray={revealed ? undefined : '3 2'}
        className={asking ? css.pickPulse : undefined}
      />
      {lock && <Lock x={9} y={(h - 2) / 2 - 0.6} s={compact ? 0.6 : 0.72} color={color} />}
      <text x={lock ? 18 : 6} y={(h - 2) / 2 + (compact ? 3 : 3.5)} className={css.chipText} style={{ fontSize: compact ? 8.5 : 10, fill: text }}>
        {label}
        {!revealed && !compact && ' ?'}
      </text>
    </g>
  );
}

function arrowHead(x: number, y: number, ang: number, color: string) {
  const a = 7;
  return <polyline points={`${x - a * Math.cos(ang - 0.42)},${y - a * Math.sin(ang - 0.42)} ${x},${y} ${x - a * Math.cos(ang + 0.42)},${y - a * Math.sin(ang + 0.42)}`} fill="none" stroke={color} strokeWidth={1.6} strokeLinejoin="round" />;
}

export function ShakeScene({ sim, dim, glow }: SceneProps) {
  const s = sim.shake;
  const g = s.geo();
  const pps = s.pxPerSec();
  const now = s.viewNow;
  const yOf = (t: number) => g.top + t * pps;
  const compact = !g.land;
  const client = live(sim, 'hs:client');
  const server = live(sim, 'hs:server');
  const eveBox = live(sim, 'hs:eve');
  const bottom = Math.max(yOf(Math.max(s.endT, 3 * 1.15)) + 18, yOf(now) + 10);
  const flights = s.flights.filter((f) => f.t0 <= now + 1e-6);

  const flightLine = (f: HsFlight) => {
    const x1 = f.dir === 'cs' ? g.cx : f.dir === 'sc' ? g.sx : g.ex;
    const x2 = f.dir === 'sc' ? g.cx : g.sx;
    const y1 = yOf(f.t0);
    const y2 = yOf(f.t1);
    const p = clamp((now - f.t0) / (f.t1 - f.t0), 0, 1);
    const hx = x1 + (x2 - x1) * p;
    const hy = y1 + (y2 - y1) * p;
    const encs = [...new Set(f.msgs.filter((m) => m.enc !== 'tcp' || f.msgs.every((x) => x.enc === 'tcp')).map((m) => (m.enc === 'app' ? 'hs' : m.enc)))] as Enc[];
    const ang = Math.atan2(y2 - y1, x2 - x1);
    const nx = -Math.sin(ang);
    const ny = Math.cos(ang);
    const allTcp = f.msgs.every((m) => m.enc === 'tcp');
    const anyHidden = f.msgs.some((m) => !s.isRevealed(m));
    return (
      <g key={`f${f.n}`}>
        {encs.map((e, i) => {
          const off = (i - (encs.length - 1) / 2) * 3.2;
          const color = anyHidden ? SIG.warn : ENC_COLOR[e];
          return (
            <g key={e}>
              <line x1={x1 + nx * off} y1={y1 + ny * off} x2={hx + nx * off} y2={hy + ny * off} stroke={color} strokeWidth={allTcp ? 1.1 : sealed(e) ? 2 : 1.5} strokeOpacity={allTcp ? 0.55 : 0.9} strokeDasharray={e === 'attack' ? '5 3' : undefined} strokeLinecap="round" />
              {p >= 1 && arrowHead(x2 + nx * off, y2 + ny * off, ang, color)}
            </g>
          );
        })}
        {p < 1 && p > 0 && (
          <g transform={`translate(${hx},${hy})`}>
            <circle r={11} fill={encs.some(sealed) ? SIG.res : SIG.req} opacity={0.14} />
            {encs.some(sealed) ? (
              <g>
                <rect x={-6.5} y={-4.8} width={13} height={9.6} rx={1.5} fill={encs.includes('early') ? SIG.heavy : SIG.res} />
                <path d="M-6.5,-4.3 L0,0.8 L6.5,-4.3" fill="none" stroke="rgba(5,8,15,0.75)" strokeWidth={1.1} />
              </g>
            ) : (
              <circle r={allTcp ? 3.2 : 4.6} fill={allTcp ? SIG.dim : encs.includes('attack') ? SIG.err : SIG.req} />
            )}
          </g>
        )}
      </g>
    );
  };

  const chips = (f: HsFlight) => {
    const x = f.dir === 'cs' ? g.cx - 8 : f.dir === 'sc' ? g.sx + 8 : g.ex - 8;
    const anchor = f.dir === 'sc' ? 'start' : 'end';
    return f.msgs.map((m, i) => (
      <Chip key={`${f.n}-${m.id}`} x={x} y={yOf(f.t0) + 1 + i * g.chipH} anchor={anchor} msg={m} compact={compact} revealed={s.isRevealed(m)} asking={s.asking === m.id} h={g.chipH} />
    ));
  };

  const crossings = flights
    .filter((f) => f.dir !== 'xs')
    .map((f) => {
      const tc = (f.t0 + f.t1) / 2;
      if (tc > now) return null;
      const y = (yOf(f.t0) + yOf(f.t1)) / 2;
      const clear = f.msgs.some((m) => m.enc === 'clear');
      const tcp = f.msgs.every((m) => m.enc === 'tcp');
      return (
        <g key={`x${f.n}`} transform={`translate(${g.ex},${y})`}>
          <circle r={tcp ? 3 : 8} fill="rgba(7,11,20,0.95)" stroke={tcp ? SIG.dim : SIG.err} strokeOpacity={0.8} />
          {!tcp && (clear ? <Eye x={0} y={0} s={0.72} color={SIG.err} /> : <Lock x={0} y={-0.4} s={0.72} color={SIG.res} />)}
        </g>
      );
    });

  return (
    <>
      {client && <line className={css.lifeline} x1={g.cx} y1={client.y + client.h / 2} x2={g.cx} y2={bottom} />}
      {server && <line className={css.lifeline} x1={g.sx} y1={server.y + server.h / 2} x2={g.sx} y2={bottom} />}
      {eveBox && <line className={css.eveLane} x1={g.ex} y1={eveBox.y + eveBox.h / 2} x2={g.ex} y2={bottom} />}
      {client && <Card box={client} title={compact ? 'Alice' : 'Alice’s browser'} sub={compact ? undefined : '192.168.1.23'} dim={dim('hs:client')} glow={glow('hs:client')} />}
      {server && <Card box={server} title="shop.example" sub={compact ? undefined : '203.0.113.10'} dim={dim('hs:server')} glow={glow('hs:server')} />}
      {eveBox && (
        <g className={css.node} transform={`translate(${eveBox.x - eveBox.w / 2},${eveBox.y - eveBox.h / 2})`} opacity={eveBox.alpha * (dim('hs:eve') ? 0.28 : 1)}>
          {glow('hs:eve') && <rect x={-5} y={-5} width={eveBox.w + 10} height={eveBox.h + 10} rx={12} fill="none" stroke="var(--accent)" strokeDasharray="3 3" strokeWidth={1.4} />}
          <rect width={eveBox.w} height={eveBox.h} rx={eveBox.h / 2} fill="rgba(255,77,106,0.1)" stroke="rgba(255,77,106,0.7)" />
          <Eye x={compact ? 11 : 14} y={eveBox.h / 2} s={compact ? 0.62 : 0.75} color={SIG.err} />
          <text x={compact ? 20 : 26} y={eveBox.h / 2 + 3.8} style={{ fontFamily: 'var(--font-sans)', fontSize: compact ? 10 : 11.5, fontWeight: 600, fill: '#ffb3c0' }}>
            Eve
          </text>
        </g>
      )}
      {s.keys
        .filter((k) => k.t <= now)
        .map((k) => {
          const x = k.side === 'c' ? g.cx : g.sx;
          const y = yOf(k.t);
          return (
            <g key={`${k.side}${k.t}`} transform={`translate(${x},${y})`}>
              <circle r={8} fill="rgba(7,11,20,0.95)" stroke={SIG.lime} strokeOpacity={0.8} />
              <KeyGlyph x={0.4} y={0} s={0.7} color={SIG.lime} />
            </g>
          );
        })}
      {flights.map(flightLine)}
      {crossings}
      {flights.map(chips)}
      {s.notes
        .filter((n) => n.t <= now)
        .map((n) => {
          const color = n.tone === 'bad' ? SIG.err : n.tone === 'warn' ? SIG.heavy : SIG.res;
          const w = n.text.length * (compact ? 5.1 : 6) + 16;
          const x = compact ? Math.min(g.sx + 8, sim.w - 8 - w) : g.sx + 8;
          // Sit below any chips drawn at the server at this moment.
          const at = s.flights.find((f) => f.dir === 'sc' && Math.abs(f.t0 - n.t) < 1e-6 && f.t0 <= now);
          const y = yOf(n.t) + (at ? at.msgs.length * g.chipH + 3 : 4);
          return (
            <g key={`${n.t}-${n.text}`} transform={`translate(${x},${y})`}>
              <rect width={w} height={16} rx={8} fill="rgba(7,11,20,0.95)" stroke={color} />
              {n.tone !== 'ok' ? <Cross x={9} y={8} s={0.62} color={color} /> : <Tick x={9} y={8} s={0.62} color={color} />}
              <text x={16} y={11.5} style={{ fontFamily: 'var(--font-mono)', fontSize: compact ? 8.3 : 9.5, fontWeight: 500, fill: color }}>
                {n.text}
              </text>
            </g>
          );
        })}
      <line className={css.playhead} x1={g.x0} y1={yOf(now)} x2={g.x1} y2={yOf(now)} />
      <text x={g.x0 + 2} y={yOf(now) - 4} className={css.halo} style={{ fontFamily: 'var(--font-mono)', fontSize: compact ? 8.5 : 9.5, fill: 'rgba(255,210,63,0.8)' }}>
        {s.ms(now)} ms
      </text>
    </>
  );
}

