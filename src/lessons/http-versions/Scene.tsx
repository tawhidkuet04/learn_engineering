'use client';

import type { Box } from '@/lib/sim/Sim';
import { SIG } from '@/lib/sim/colors';
import { Effects } from '@/components/stage/svg';
import stage from '@/components/stage/stage.module.css';
import { FIRST_HEADERS, H1_HEADERS, MS, PROTO_NAME, type PageLoad, type Pkt, type Res } from './engine';
import { TYPE_COLOR } from './page';
import { RACE, type HttpSim, type Rect } from './sim';
import { SeqScene } from './SeqScene';

const LINE = (a: number) => `rgba(143,166,201,${a})`;

export function Scene({ sim, highlight }: { sim: HttpSim; highlight: string | null }) {
  const v = sim.cfg.view;
  return (
    <>
      {v === 'lanes' && <LanesScene sim={sim} />}
      {v === 'race' && <RaceScene sim={sim} />}
      {v === 'seq' && <SeqScene sim={sim} />}
      <Effects sim={sim} />
      {highlight && <Highlight sim={sim} target={highlight} />}
    </>
  );
}

function Highlight({ sim, target }: { sim: HttpSim; target: string }) {
  const r = sim.resolveTarget(target);
  if (!r) return null;
  return (
    <rect
      x={r.x - r.w / 2 - 6}
      y={r.y - r.h / 2 - 6}
      width={r.w + 12}
      height={r.h + 12}
      rx={10}
      fill="none"
      stroke="var(--accent)"
      strokeWidth={1.4}
      strokeDasharray="3 3"
      pointerEvents="none"
    />
  );
}

/* ================================================================== */
/* Browser · lanes · server                                            */
/* ================================================================== */

function LanesScene({ sim }: { sim: HttpSim }) {
  const L = sim.load;
  const b = sim.boxes.get('browser');
  const s = sim.boxes.get('server');
  return (
    <g>
      <Lanes sim={sim} L={L} />
      {b && <BrowserWindow sim={sim} L={L} box={b} />}
      {s && <ServerCard sim={sim} L={L} box={s} />}
      <Holds sim={sim} L={L} />
      <Packets sim={sim} L={L} />
      {sim.cfg.lower === 'waterfall' ? <Waterfall sim={sim} L={L} rect={sim.G.lower} /> : <HpackPanel sim={sim} L={L} rect={sim.G.lower} />}
    </g>
  );
}

function Lanes({ sim, L }: { sim: HttpSim; L: PageLoad }) {
  const r = sim.G.lanes;
  const P = sim.orient === 'portrait';
  const ys = sim.laneYs(L);
  const x0 = r.x + 2;
  const x1 = r.x + r.w - 2;
  const mid = r.y + r.h / 2;
  const cap = { fontSize: P ? 7.5 : 8.5 };

  if (L.h1) {
    const half = P ? 4.5 : 6;
    return (
      <g>
        {ys.map((y, i) => {
          const c = L.laneConn(i);
          const st = c?.state ?? 'none';
          const dead = st === 'dead';
          const hs = st === 'handshake';
          const off = st === 'closed' || st === 'none';
          const stroke = dead ? 'rgba(255,77,106,0.6)' : hs ? 'rgba(255,154,60,0.55)' : off ? LINE(0.15) : LINE(0.36);
          const dash = dead || off ? '3 5' : undefined;
          const cur = c && c.cur != null ? L.res[c.cur] : null;
          const tag = dead ? 'connection lost' : hs ? 'handshake' : off ? (L.cfg.proto === 'h1.0' && c ? 'closed' : '') : cur ? cur.name : 'idle';
          const tagColor = dead ? SIG.err : hs ? SIG.heavy : cur ? TYPE_COLOR[cur.type] : 'var(--text-3)';
          return (
            <g key={i}>
              <rect x={x0} y={y - half} width={x1 - x0} height={half * 2} fill={hs ? 'rgba(255,154,60,0.05)' : off ? 'none' : 'rgba(143,166,201,0.035)'} />
              <line x1={x0} x2={x1} y1={y - half} y2={y - half} stroke={stroke} strokeDasharray={dash} />
              <line x1={x0} x2={x1} y1={y + half} y2={y + half} stroke={stroke} strokeDasharray={dash} />
              <text className={stage.caps} x={x0 + 5} y={y - half - 3} style={{ ...cap, fill: off ? LINE(0.4) : 'var(--text-3)' }}>
                {P ? `tcp ${i + 1}` : `TCP ${i + 1}`}
              </text>
              {!P && tag && (
                <text className={stage.mono} x={(x0 + x1) / 2} y={y - half - 3} textAnchor="middle" style={{ fontSize: 9, fill: tagColor, opacity: 0.9 }}>
                  {tag}
                </text>
              )}
              {P && (hs || dead) && (
                <text className={stage.mono} x={x1 - 4} y={y - half - 3} textAnchor="end" style={{ fontSize: 7.5, fill: tagColor }}>
                  {dead ? 'lost' : 'handshake'}
                </text>
              )}
            </g>
          );
        })}
      </g>
    );
  }

  if (L.cfg.proto === 'h2') {
    const c = L.muxConnection;
    const dead = c?.state === 'dead';
    const hs = c?.state === 'handshake';
    const ph = P ? 22 : 28;
    const streams = L.openStreams;
    return (
      <g>
        <rect
          x={x0}
          y={mid - ph / 2}
          width={x1 - x0}
          height={ph}
          rx={ph / 2}
          fill={hs ? 'rgba(255,154,60,0.05)' : 'rgba(143,166,201,0.04)'}
          stroke={dead ? 'rgba(255,77,106,0.65)' : hs ? 'rgba(255,154,60,0.55)' : LINE(0.42)}
          strokeDasharray={dead ? '4 5' : undefined}
        />
        <text className={stage.caps} x={x0 + 6} y={mid - ph / 2 - 7} style={cap}>
          {P ? '1 tcp connection' : 'one TCP connection · h2'}
        </text>
        <text
          className={stage.mono}
          x={x1 - 4}
          y={mid - ph / 2 - 7}
          textAnchor="end"
          style={{ fontSize: P ? 8 : 9.5, fill: dead ? SIG.err : hs ? SIG.heavy : 'var(--text-2)' }}
        >
          {dead ? 'connection lost' : hs ? 'handshake' : `${streams} stream${streams === 1 ? '' : 's'} open`}
        </text>
      </g>
    );
  }

  // HTTP/3: one QUIC connection, drawn with a lane per stream
  const c = L.muxConnection;
  const hs = c?.state === 'handshake';
  const top = r.y - 2;
  const bot = r.y + r.h + 2;
  const spacing = ys.length > 1 ? ys[1] - ys[0] : 20;
  const streamOf = (slot: number) => {
    let best: Res | null = null;
    for (const x of L.res) if (x.slot === slot && x.requested) best = x;
    return best;
  };
  return (
    <g>
      <rect
        x={x0}
        y={top}
        width={x1 - x0}
        height={bot - top}
        rx={10}
        fill="rgba(181,155,255,0.035)"
        stroke={hs ? 'rgba(255,154,60,0.55)' : 'rgba(181,155,255,0.45)'}
        strokeDasharray="5 4"
      />
      <text className={stage.caps} x={x0 + 6} y={top - 6} style={{ ...cap, fill: '#cdbdff' }}>
        {P ? '1 quic connection · udp' : 'one QUIC connection · h3 over UDP'}
      </text>
      <text className={stage.mono} x={x1 - 4} y={top - 6} textAnchor="end" style={{ fontSize: P ? 8 : 9.5, fill: hs ? SIG.heavy : 'var(--text-2)' }}>
        {hs ? 'handshake' : `${L.openStreams} streams`}
      </text>
      {ys.map((y, i) => {
        const res = streamOf(i);
        const active = !!res && !res.done;
        const labels = spacing >= 12 && !P;
        return (
          <g key={i}>
            <line x1={x0 + 8} x2={x1 - (labels ? 34 : 8)} y1={y} y2={y} stroke={active ? LINE(0.3) : LINE(0.12)} />
            {labels && res?.stream != null && (
              <text className={stage.mono} x={x1 - 6} y={y + 3} textAnchor="end" style={{ fontSize: 8, fill: active ? TYPE_COLOR[res.type] : 'var(--text-3)' }}>
                #{res.stream}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}

function pktColor(L: PageLoad, p: Pkt) {
  if (p.kind === 'data' && p.res != null) return TYPE_COLOR[L.res[p.res].type];
  if (p.kind === 'req') return SIG.req;
  if (p.kind === 'hs') return SIG.heavy;
  return SIG.hc;
}

const SHORT: Record<string, string> = {
  'ACK + ClientHello': 'ACK+Hello',
  'ServerHello … Finished': 'Hello…Fin',
  'Initial · ClientHello': 'Initial',
  'Initial + Handshake': 'Initial+HS',
  'Initial + 0-RTT': 'Initial+0-RTT',
  'same connection ID': 'same conn ID',
  PATH_CHALLENGE: 'PATH_CHALL…',
  PATH_RESPONSE: 'PATH_RESP…',
};

function pktLabel(sim: HttpSim, L: PageLoad, p: Pkt): string | null {
  const P = sim.orient === 'portrait';
  const m = sim.cfg.mode;
  if (p.kind === 'hs' && sim.cfg.labels) return P ? (SHORT[p.label ?? ''] ?? p.label) : p.label;
  if (p.kind === 'ctl') return P ? (SHORT[p.label ?? ''] ?? p.label) : p.label;
  if (p.kind === 'req' && p.res != null) {
    const r = L.res[p.res];
    if (m === 'hpack') return `${r.hdrBytes} B`;
    if (sim.cfg.labels && L.h1) return P ? r.name : `GET /${r.i === 0 ? '' : r.name}`;
  }
  if (p.kind === 'data' && p.retx && (m === 'hol' || m === 'quic' || m === 'playground')) return 'resend';
  return null;
}

function Packets({ sim, L }: { sim: HttpSim; L: PageLoad }) {
  const P = sim.orient === 'portrait';
  const click = sim.cfg.clickDrop;
  const flying = L.inFlight();
  const insp = sim.insp?.id;
  return (
    <g>
      {flying.map(({ p, k }) => {
        const { x, y } = sim.pktXY(L, p, k);
        const color = pktColor(L, p);
        const dir = p.up ? 1 : -1;
        const trail = P ? 9 : 15;
        const label = k > 0.05 && k < 0.92 ? pktLabel(sim, L, p) : null;
        const size = P ? 5.5 : 7;
        const clickable = click && p.kind === 'data';
        return (
          <g
            key={p.id}
            className={clickable ? stage.clickable : undefined}
            onClick={clickable ? () => sim.dropPacket(p.id) : undefined}
            role={clickable ? 'button' : undefined}
            aria-label={clickable ? 'Drop this packet' : undefined}
          >
            {clickable && <circle cx={x} cy={y} r={P ? 11 : 13} fill="transparent" />}
            <line
              x1={x - dir * trail}
              y1={y}
              x2={x}
              y2={y}
              stroke={color}
              strokeWidth={p.kind === 'data' ? size * 0.8 : 3}
              opacity={0.22}
              strokeLinecap="round"
            />
            {p.kind === 'data' ? (
              <>
                {p.retx && (
                  <rect x={x - size / 2 - 3} y={y - size / 2 - 3} width={size + 6} height={size + 6} rx={3} fill="none" stroke={SIG.err} strokeWidth={1.3} />
                )}
                <rect x={x - size / 2} y={y - size / 2} width={size} height={size} rx={1.6} fill={color} />
              </>
            ) : (
              <>
                <circle cx={x} cy={y} r={p.kind === 'hs' ? 9 : 8} fill={color} opacity={0.13} />
                <circle cx={x} cy={y} r={p.kind === 'hs' ? 4 : 3.4} fill={color} />
              </>
            )}
            {insp === p.id && <circle cx={x} cy={y} r={P ? 8 : 10} fill="none" stroke="var(--accent)" strokeWidth={1.4} />}
            {label && <PillLabel x={x} y={y - (p.kind === 'data' ? 11 : 12)} text={label} color={p.retx ? SIG.err : color} small={P} />}
          </g>
        );
      })}
    </g>
  );
}

export function PillLabel({ x, y, text, color, small }: { x: number; y: number; text: string; color: string; small?: boolean }) {
  const cw = small ? 5.2 : 6.1;
  const w = text.length * cw + 10;
  return (
    <g transform={`translate(${x},${y})`} pointerEvents="none">
      <rect x={-w / 2} y={-8} width={w} height={14} rx={7} fill="rgba(7,11,20,0.92)" stroke={color} strokeOpacity={0.7} />
      <text className={stage.flightLabel} x={0} y={2.5} textAnchor="middle" fill={color} style={small ? { fontSize: 8 } : undefined}>
        {text}
      </text>
    </g>
  );
}

function Holds({ sim, L }: { sim: HttpSim; L: PageLoad }) {
  const hs = L.holds();
  if (!hs.length) return null;
  const P = sim.orient === 'portrait';
  const size = P ? 5 : 6.5;
  const maxN = Math.max(3, Math.floor((sim.G.lanes.w * 0.42) / (P ? 7 : 9.5)));
  const pipe = !L.h1 && L.cfg.proto === 'h2';
  const pipeBottom = sim.G.lanes.y + sim.G.lanes.h / 2 + (P ? 11 : 14);
  return (
    <g>
      {hs.map((hd, gi) => {
        const miss = sim.holdXY(L, hd.lane, -1);
        const shown = hd.pkts.slice(0, maxN);
        const more = hd.pkts.length - shown.length;
        const first = hd.pkts[0];
        const stream = first?.res != null ? L.res[first.res].stream : null;
        const last = sim.holdXY(L, hd.lane, shown.length - 1);
        return (
          <g key={hd.key}>
            <rect
              x={miss.x - size / 2 - 1}
              y={miss.y - size / 2 - 1}
              width={size + 2}
              height={size + 2}
              rx={1.5}
              fill="rgba(255,77,106,0.12)"
              stroke={SIG.err}
              strokeDasharray="2 1.6"
            />
            {shown.map((p, j) => {
              const q = sim.holdXY(L, hd.lane, j);
              return (
                <rect
                  key={p.id}
                  x={q.x - size / 2}
                  y={q.y - size / 2}
                  width={size}
                  height={size}
                  rx={1.4}
                  fill={p.res != null ? TYPE_COLOR[L.res[p.res].type] : SIG.text}
                  opacity={0.8}
                  stroke={SIG.err}
                  strokeWidth={0.9}
                />
              );
            })}
            {more > 0 && (
              <text className={stage.mono} x={last.x + 8} y={last.y + 3} style={{ fontSize: 8.5, fill: SIG.err }}>
                +{more}
              </text>
            )}
            {(gi === 0 || !P) && (
              <text
                className={stage.caps}
                x={pipe ? miss.x - size / 2 : (more > 0 ? last.x + 26 : last.x + 9) + (shown.length ? 0 : 4)}
                y={pipe ? pipeBottom + (P ? 10 : 12) : last.y + 3}
                style={{ fill: SIG.err, fontSize: P ? 7 : 8.5 }}
              >
                {hd.tcp
                  ? pipe
                    ? `held by TCP · ${hd.pkts.length} chunk${hd.pkts.length === 1 ? '' : 's'}`
                    : P
                      ? 'held'
                      : 'held by TCP'
                  : P
                    ? `#${stream ?? ''} waits`
                    : `stream #${stream ?? ''} waits`}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}

/* ------------------------------------------------------------------ */
/* The browser: a tiny window whose page fills in as files arrive       */
/* ------------------------------------------------------------------ */

function BrowserWindow({ sim, L, box }: { sim: HttpSim; L: PageLoad; box: Box }) {
  const P = sim.orient === 'portrait';
  const w = box.w;
  const h = box.h;
  const x = box.x - w / 2;
  const y = box.y - h / 2;
  const bar = P ? 17 : 22;
  const has = (name: string) => L.res.some((r) => r.name === name);
  const done = (name: string) => L.res.some((r) => r.name === name && r.done);
  const html = L.res[0]?.done ?? false;
  const css = done('style.css') || done('bundle.css') || (!has('style.css') && !has('bundle.css') && html);
  const font = done('font.woff2') || (!has('font.woff2') && css);
  const js = done('app.js') || done('bundle.js') || (!has('app.js') && !has('bundle.js') && html);
  // Images without a file of their own: sprited into the last image when bundling,
  // otherwise the page simply has no image there (a plain block).
  const lastImg = [...L.res].reverse().find((r) => r.type === 'img');
  const spare: boolean | null = sim.cfg.bundle ? !!lastImg?.done : null;
  const img = (name: string): boolean | null => (has(name) ? done(name) : spare);
  const logo = img('logo.svg');
  const hero = img('hero.jpg');
  const products = L.res.filter((r) => /^p\d+\.jpg$/.test(r.name));
  const nTiles = Math.min(9, Math.max(6, products.length));
  const tileDone = (i: number): boolean | null => {
    const mine = products.filter((_, j) => j % nTiles === i);
    return mine.length ? mine.every((r) => r.done) : spare;
  };
  const progress = L.totalChunks ? L.deliveredChunks / L.totalChunks : 0;
  const footer = sim.cfg.mode === 'migration' ? (P ? 13 : 16) : 0;
  const cx0 = P ? 6 : 8;
  const cy0 = bar + (P ? 6 : 8);
  const cw = w - cx0 * 2;
  const ch = h - cy0 - (P ? 6 : 8) - footer;
  const skel = LINE(html ? 0.34 : 0);
  const fill = (on: boolean | null, color: string) => (on ? color : !css ? 'none' : on === null ? LINE(0.16) : LINE(0.07));
  const fillOp = (on: boolean | null, a = 0.55) => (on ? a : 1);

  // page layout
  const headH = P ? 8 : 11;
  const heroY = cy0 + headH + (P ? 5 : 7);
  const heroH = Math.round(ch * (P ? 0.2 : 0.22));
  const textY = heroY + heroH + (P ? 6 : 8);
  const gridY = textY + (P ? 11 : 15);
  const btnH = P ? 7 : 9;
  const gridH = cy0 + ch - btnH - (P ? 5 : 7) - gridY;
  const cols = 3;
  const rows = Math.max(1, Math.ceil(nTiles / cols));
  const gap = P ? 3 : 4;
  const tw = (cw - gap * (cols - 1)) / cols;
  const th = Math.max(3, Math.min(P ? 16 : 24, (gridH - gap * (rows - 1)) / rows));
  const loading = !L.done && L.now > 0;
  const spin = sim.vt * 5;

  return (
    <g transform={`translate(${x},${y})`} opacity={box.alpha}>
      <rect className={stage.card} width={w} height={h} rx={10} />
      <line x1={0} x2={w} y1={bar} y2={bar} stroke={LINE(0.22)} />
      {!P && [10, 18, 26].map((dx) => <circle key={dx} cx={dx} cy={bar / 2} r={2.4} fill={LINE(0.3)} />)}
      <rect x={P ? 5 : 34} y={4} width={w - (P ? 10 : 42)} height={bar - 8} rx={(bar - 8) / 2} fill="rgba(143,166,201,0.07)" />
      {loading ? (
        <path
          d={`M${(P ? 11 : 41) + 3.2 * Math.cos(spin)},${bar / 2 + 3.2 * Math.sin(spin)} A3.2,3.2 0 1,1 ${(P ? 11 : 41) + 3.2 * Math.cos(spin + 4.4)},${bar / 2 + 3.2 * Math.sin(spin + 4.4)}`}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={1.3}
        />
      ) : (
        <path
          d={`M${P ? 9 : 39},${bar / 2 - 0.5} h5 v4 h-5 z M${P ? 10 : 40},${bar / 2 - 0.5} v-1.6 a1.5,1.5 0 0 1 3,0 v1.6`}
          fill="none"
          stroke={SIG.res}
          strokeWidth={1}
        />
      )}
      <text className={stage.mono} x={P ? 17 : 48} y={bar / 2 + 3.2} style={{ fontSize: P ? 7.5 : 9.5, fill: 'var(--text-2)' }}>
        shop.example
      </text>
      <text
        className={stage.caps}
        x={w - (P ? 8 : 12)}
        y={bar / 2 + 3}
        textAnchor="end"
        style={{ fontSize: P ? 7 : 8, fill: 'var(--accent)', letterSpacing: '0.06em' }}
      >
        {L.cfg.proto === 'h1.0' ? '1.0' : L.cfg.proto === 'h1.1' ? '1.1' : L.cfg.proto}
      </text>
      {loading && <rect x={0} y={bar - 1} width={w * progress} height={2} fill="var(--accent)" opacity={0.85} />}

      {/* page */}
      <g>
        <rect x={cx0} y={cy0} width={cw} height={headH} rx={2} fill={css ? 'rgba(143,166,201,0.09)' : 'none'} stroke={skel} strokeWidth={0.8} />
        <rect
          x={cx0 + 2}
          y={cy0 + 2}
          width={headH - 4}
          height={headH - 4}
          rx={1.5}
          fill={logo ? TYPE_COLOR.img : logo === null && css ? LINE(0.35) : 'none'}
          stroke={logo ? 'none' : skel}
          strokeWidth={0.8}
        />
        {[0, 1].map((k) => (
          <rect
            key={k}
            x={cx0 + cw - (k + 1) * (P ? 14 : 20)}
            y={cy0 + headH / 2 - 1.2}
            width={P ? 10 : 15}
            height={2.4}
            rx={1}
            fill={html ? (font ? LINE(0.8) : LINE(0.28)) : 'none'}
          />
        ))}
        <rect
          x={cx0}
          y={heroY}
          width={cw}
          height={heroH}
          rx={3}
          fill={fill(hero, TYPE_COLOR.img)}
          fillOpacity={fillOp(hero, 0.5)}
          stroke={skel}
          strokeWidth={0.8}
        />
        {hero && (
          <path
            d={`M${cx0 + 4},${heroY + heroH - 3} l${cw * 0.22},${-heroH * 0.45} l${cw * 0.14},${heroH * 0.25} l${cw * 0.2},${-heroH * 0.35} l${cw * 0.36},${heroH * 0.55}`}
            fill="none"
            stroke="rgba(7,11,20,0.45)"
            strokeWidth={1.2}
          />
        )}
        <rect x={cx0} y={textY} width={cw * 0.62} height={P ? 3 : 4} rx={1.5} fill={html ? (font ? LINE(0.85) : LINE(0.26)) : 'none'} />
        <rect x={cx0} y={textY + (P ? 5 : 7)} width={cw * 0.4} height={P ? 2.4 : 3} rx={1.2} fill={html ? (font ? LINE(0.5) : LINE(0.18)) : 'none'} />
        {Array.from({ length: nTiles }, (_, i) => {
          const cxI = i % cols;
          const ry = Math.floor(i / cols);
          const on = tileDone(i);
          return (
            <rect
              key={i}
              x={cx0 + cxI * (tw + gap)}
              y={gridY + ry * (th + gap)}
              width={tw}
              height={th}
              rx={2}
              fill={fill(on, TYPE_COLOR.img)}
              fillOpacity={fillOp(on, 0.42)}
              stroke={skel}
              strokeWidth={0.7}
            />
          );
        })}
        <rect
          x={cx0}
          y={cy0 + ch - btnH}
          width={cw * 0.42}
          height={btnH}
          rx={btnH / 2}
          fill={js ? TYPE_COLOR.js : 'none'}
          fillOpacity={js ? 0.75 : 1}
          stroke={js ? 'none' : skel}
          strokeWidth={0.8}
        />
        {!html && L.now > 0 && (
          <text className={stage.mono} x={w / 2} y={cy0 + ch / 2} textAnchor="middle" style={{ fontSize: P ? 8 : 9.5, fill: 'var(--text-3)' }}>
            {L.res[0]?.requested ? 'waiting…' : 'connecting…'}
          </text>
        )}
      </g>
      {footer > 0 && (
        <g>
          <line x1={0} x2={w} y1={h - footer} y2={h - footer} stroke={LINE(0.18)} />
          <text
            className={stage.mono}
            x={P ? 5 : 9}
            y={h - footer / 2 + 3}
            style={{ fontSize: P ? 7 : 8.5, fill: L.net === 'wifi' ? 'var(--text-2)' : SIG.warn }}
          >
            {L.net === 'wifi' ? (P ? 'Wi-Fi 192.0.2.10' : 'Wi-Fi · 192.0.2.10') : P ? '5G 198.51.100.23' : '5G · 198.51.100.23'}
          </text>
        </g>
      )}
    </g>
  );
}

/* ------------------------------------------------------------------ */
/* The server and what it has ready to send                             */
/* ------------------------------------------------------------------ */

function ServerCard({ sim, L, box }: { sim: HttpSim; L: PageLoad; box: Box }) {
  const P = sim.orient === 'portrait';
  const w = box.w;
  const h = box.h;
  const x = box.x - w / 2;
  const y = box.y - h / 2;
  const sending = L.res.filter((r) => r.serverReady && r.sent < r.chunks);
  const preparing = L.res.filter((r) => r.requested && !r.serverReady && r.tReq != null && L.now >= r.tReq + L.owd);
  const rowH = P ? 10 : 13;
  const listY = P ? 40 : 60;
  const maxRows = Math.max(1, Math.floor((h - listY - 6) / rowH));
  const rows: { r: Res; prep: boolean }[] = [...preparing.map((r) => ({ r, prep: true })), ...sending.map((r) => ({ r, prep: false }))];
  const shown = rows.slice(0, maxRows);
  const more = rows.length - shown.length;
  const sq = P ? 4 : 5;
  return (
    <g transform={`translate(${x},${y})`} opacity={box.alpha}>
      <rect className={stage.card} width={w} height={h} rx={10} />
      <rect className={stage.cardInner} x={3.5} y={3.5} width={w - 7} height={h - 7} rx={7.5} />
      <circle cx={w - 11} cy={11} r={3.2} fill={SIG.res} />
      {P ? (
        <>
          <text className={stage.name} x={8} y={17} style={{ fontSize: 10.5 }}>
            server
          </text>
          <text className={stage.mono} x={8} y={29} style={{ fontSize: 7.5 }}>
            nginx
          </text>
        </>
      ) : (
        <>
          <text className={stage.name} x={12} y={22}>
            shop.example
          </text>
          <text className={stage.mono} x={12} y={35}>
            203.0.113.10 · nginx
          </text>
          <line x1={10} x2={w - 10} y1={44} y2={44} stroke={LINE(0.16)} />
          <text className={stage.caps} x={12} y={55} style={{ fontSize: 8 }}>
            {rows.length ? 'sending' : 'idle'}
          </text>
        </>
      )}
      {shown.map(({ r, prep }, i) => {
        const yy = listY + i * rowH;
        const left = r.chunks - r.sent;
        return (
          <g key={r.i} transform={`translate(${P ? 7 : 12},${yy})`}>
            {!P && (
              <text className={stage.mono} x={0} y={sq} style={{ fontSize: 8.5, fill: prep ? SIG.heavy : 'var(--text-2)' }}>
                {r.name.length > 10 ? `${r.name.slice(0, 9)}…` : r.name}
              </text>
            )}
            {prep ? (
              <text className={stage.mono} x={P ? 0 : 62} y={sq} style={{ fontSize: P ? 7 : 8.5, fill: SIG.heavy }}>
                {P ? `${r.name.slice(0, 5)}…` : 'working…'}
              </text>
            ) : (
              Array.from({ length: Math.min(left, P ? 8 : 7) }, (_, k) => (
                <rect key={k} x={(P ? 0 : 62) + k * (sq + 2)} y={0} width={sq} height={sq} rx={1} fill={TYPE_COLOR[r.type]} opacity={0.85} />
              ))
            )}
          </g>
        );
      })}
      {more > 0 && (
        <text className={stage.mono} x={P ? 7 : 12} y={listY + shown.length * rowH + (P ? 5 : 6)} style={{ fontSize: P ? 7 : 8.5, fill: 'var(--text-3)' }}>
          +{more} more
        </text>
      )}
    </g>
  );
}

/* ================================================================== */
/* Waterfall                                                           */
/* ================================================================== */

export function ticksFor(scaleMs: number, max: number) {
  const steps = [50, 100, 200, 250, 500, 1000, 2000];
  const step = steps.find((s) => scaleMs / s <= max) ?? 5000;
  const out: number[] = [];
  for (let t = 0; t <= scaleMs + 1; t += step) out.push(t);
  return out;
}

export function Bars({ res, X, y, th, now, connecting }: { res: Res; X: (t: number) => number; y: number; th: number; now: number; connecting?: number }) {
  return (
    <g>
      {res.segs.map((s, k) => {
        const t1 = s.t1 ?? now;
        const xa = X(s.t0);
        const xb = Math.max(xa + (s.kind === 'dl' ? 1.5 : 0), X(t1));
        // Still waiting for a connection that is handshaking right now
        if (connecting != null && s.t1 == null && (s.kind === 'queue' || s.kind === 'lost')) {
          const xc = Math.min(xb, Math.max(xa, X(connecting)));
          return (
            <g key={k}>
              {xc > xa && (
                <line
                  x1={xa}
                  x2={xc}
                  y1={y}
                  y2={y}
                  stroke={s.kind === 'lost' ? SIG.err : LINE(0.45)}
                  strokeWidth={1.2}
                  strokeDasharray={s.kind === 'lost' ? '3 3' : undefined}
                />
              )}
              <rect x={xc} y={y - th * 0.36} width={Math.max(1, xb - xc)} height={th * 0.72} rx={1.5} fill={SIG.heavy} opacity={0.88} />
            </g>
          );
        }
        if (s.kind === 'queue') return <line key={k} x1={xa} x2={xb} y1={y} y2={y} stroke={LINE(0.45)} strokeWidth={1.1} />;
        if (s.kind === 'lost') return <line key={k} x1={xa} x2={xb} y1={y} y2={y} stroke={SIG.err} strokeWidth={1.4} strokeDasharray="3 3" />;
        if (s.kind === 'connect')
          return <rect key={k} x={xa} y={y - th * 0.36} width={Math.max(1, xb - xa)} height={th * 0.72} rx={1.5} fill={SIG.heavy} opacity={0.88} />;
        if (s.kind === 'wait') return <rect key={k} x={xa} y={y - th * 0.18} width={Math.max(1, xb - xa)} height={th * 0.36} rx={1} fill={LINE(0.5)} />;
        return <rect key={k} x={xa} y={y - th / 2} width={Math.max(1.5, xb - xa)} height={th} rx={1.8} fill={TYPE_COLOR[res.type]} opacity={0.9} />;
      })}
      {res.stalls.map((s, k) => {
        const xa = X(s.t0);
        const xb = Math.max(xa + 1.5, X(s.t1 ?? now));
        return (
          <g key={`s${k}`}>
            <rect
              x={xa}
              y={y - th / 2 - 2}
              width={xb - xa}
              height={th + 4}
              rx={2}
              fill="url(#kit-hatch)"
              stroke={SIG.err}
              strokeWidth={1}
              strokeOpacity={0.85}
            />
          </g>
        );
      })}
    </g>
  );
}

function Waterfall({ sim, L, rect }: { sim: HttpSim; L: PageLoad; rect: Rect }) {
  const P = sim.orient === 'portrait';
  const n = L.res.length;
  const W = sim.wfLayout(rect, n);
  const scale = sim.wfScale;
  const X = (t: number) => W.x0 + ((t * MS) / scale) * W.bw;
  const ticks = ticksFor(scale, P ? 4 : 8);
  const th = Math.min(P ? 8 : 10, W.rowH * 0.56);
  const bottom = W.y0 + n * W.rowH;
  const labels = W.rowH >= 9;
  const pc = L.pendingConnects();
  const legend: [string, string, 'line' | 'thin' | 'bar' | 'stall'][] = [
    ['queued', LINE(0.6), 'line'],
    ['connecting', SIG.heavy, 'bar'],
    ['waiting', LINE(0.6), 'thin'],
    ['downloading', SIG.blue, 'bar'],
    ['stalled', SIG.err, 'stall'],
  ];
  const showStall = L.res.some((r) => r.stalls.length) || sim.cfg.pktLoss > 0 || sim.cfg.forceLoss.length > 0 || sim.cfg.clickDrop;
  const items = legend.filter((l) => l[2] !== 'stall' || showStall);
  let lx = rect.x + rect.w;
  const legendNodes = P
    ? null
    : items
        .slice()
        .reverse()
        .map(([label, color, kind]) => {
          const tw = label.length * 5.6 + 22;
          lx -= tw;
          const x = lx;
          return (
            <g key={label} transform={`translate(${x},${rect.y + 9})`}>
              {kind === 'line' && <line x1={0} x2={12} y1={-3} y2={-3} stroke={color} strokeWidth={1.2} />}
              {kind === 'thin' && <rect x={0} y={-5} width={12} height={4} rx={1} fill={color} />}
              {kind === 'bar' && <rect x={0} y={-7} width={12} height={8} rx={1.5} fill={color} opacity={0.9} />}
              {kind === 'stall' && <rect x={0} y={-7} width={12} height={8} rx={1.5} fill="url(#kit-hatch)" stroke={color} />}
              <text className={stage.mono} x={16} y={0} style={{ fontSize: 9, fill: 'var(--text-3)' }}>
                {label}
              </text>
            </g>
          );
        });

  return (
    <g>
      <text className={stage.caps} x={rect.x} y={rect.y + 9} style={{ fontSize: P ? 8 : 9, fill: 'var(--text-2)' }}>
        {P ? 'waterfall' : 'waterfall · one row per file'}
      </text>
      {legendNodes}
      {ticks.map((t) => {
        const x = W.x0 + (t / scale) * W.bw;
        const label = t === 0 ? '0' : `${t}${t === ticks[ticks.length - 1] ? ' ms' : ''}`;
        const flip = x + label.length * 5.4 + 4 > rect.x + rect.w;
        return (
          <g key={t}>
            <line x1={x} x2={x} y1={W.y0 - 3} y2={bottom} stroke={LINE(t === 0 ? 0.25 : 0.1)} />
            <text
              className={stage.mono}
              x={flip ? x - 2 : x + 2}
              y={W.y0 - 5}
              textAnchor={flip ? 'end' : 'start'}
              style={{ fontSize: P ? 7.5 : 8.5, fill: 'var(--text-3)' }}
            >
              {label}
            </text>
          </g>
        );
      })}
      {L.res.map((r, i) => {
        const yc = W.y0 + (i + 0.5) * W.rowH;
        return (
          <g key={r.i}>
            {i % 2 === 0 && <rect x={rect.x} y={W.y0 + i * W.rowH} width={rect.w} height={W.rowH} fill="rgba(143,166,201,0.025)" />}
            {labels && (
              <>
                <rect x={rect.x + 2} y={yc - 3} width={6} height={6} rx={1.2} fill={TYPE_COLOR[r.type]} opacity={r.discovered ? 0.9 : 0.3} />
                <text
                  className={stage.mono}
                  x={rect.x + 13}
                  y={yc + 3.2}
                  style={{ fontSize: P ? 8.5 : 10, fill: r.done ? 'var(--text-1)' : r.discovered ? 'var(--text-2)' : 'var(--text-3)' }}
                >
                  {r.name}
                </text>
              </>
            )}
            <Bars res={r} X={X} y={yc} th={th} now={L.now} connecting={pc.get(r.i)} />
          </g>
        );
      })}
      {L.done && L.tLoad != null ? (
        <g>
          <line x1={X(L.tLoad)} x2={X(L.tLoad)} y1={W.y0 - 3} y2={bottom + 2} stroke={SIG.res} strokeWidth={1.3} />
          <text
            className={stage.mono}
            x={X(L.tLoad) + (X(L.tLoad) > rect.x + rect.w - 90 ? -4 : 4)}
            y={bottom + (P ? 11 : 13)}
            textAnchor={X(L.tLoad) > rect.x + rect.w - 90 ? 'end' : 'start'}
            style={{ fontSize: P ? 8.5 : 10, fill: SIG.res }}
          >
            loaded · {Math.round(L.tLoad * MS)} ms
          </text>
        </g>
      ) : (
        L.now > 0 && <line x1={X(L.now)} x2={X(L.now)} y1={W.y0 - 3} y2={bottom + 2} stroke="rgba(255,210,63,0.6)" strokeDasharray="2 3" />
      )}
    </g>
  );
}

/* ================================================================== */
/* HPACK: header bytes per request                                     */
/* ================================================================== */

const HPACK_TABLE = [
  ['62', 'cookie: session=8f3a2c…'],
  ['63', 'accept-language: en-US,en;q=0.9'],
  ['64', 'user-agent: Mozilla/5.0 (Macintosh…'],
  ['65', ':authority: shop.example'],
];

function HpackPanel({ sim, L, rect }: { sim: HttpSim; L: PageLoad; rect: Rect }) {
  const P = sim.orient === 'portrait';
  const reqs = L.res.filter((r) => r.requested).sort((a, b) => (a.tReq ?? 0) - (b.tReq ?? 0));
  const tableW = P ? 0 : Math.min(250, rect.w * 0.34);
  const chartW = rect.w - tableW - (P ? 0 : 24);
  const labelW = P ? 62 : 92;
  const head = 30;
  const n = L.res.length;
  const rowH = Math.max(9, Math.min(P ? 16 : 19, (rect.h - head - 6) / n));
  const barMax = chartW - labelW - (P ? 58 : 84);
  const X = (bytes: number) => (bytes / H1_HEADERS) * barMax;
  const th = Math.min(8, rowH * 0.42);
  const total = reqs.reduce((s, r) => s + r.hdrBytes, 0);
  const tx = rect.x + chartW + 24;
  return (
    <g>
      <text className={stage.caps} x={rect.x} y={rect.y + 9} style={{ fontSize: P ? 8 : 9, fill: 'var(--text-2)' }}>
        request header bytes
      </text>
      <g transform={`translate(${rect.x + labelW},${rect.y + 21})`}>
        <rect x={0} y={-6} width={10} height={5} rx={1} fill="none" stroke={LINE(0.55)} />
        <text className={stage.mono} x={14} y={0} style={{ fontSize: P ? 7.5 : 9, fill: 'var(--text-3)' }}>
          {P ? 'HTTP/1.1 text' : 'as HTTP/1.1 text'}
        </text>
        <rect x={P ? 76 : 116} y={-6} width={10} height={5} rx={1} fill={SIG.req} />
        <text className={stage.mono} x={P ? 90 : 130} y={0} style={{ fontSize: P ? 7.5 : 9, fill: 'var(--text-3)' }}>
          {P ? 'HPACK' : 'HPACK-encoded (HTTP/2)'}
        </text>
      </g>
      {reqs.map((r, i) => {
        const y = rect.y + head + i * rowH + rowH / 2;
        return (
          <g key={r.i}>
            <text className={stage.mono} x={rect.x} y={y + 3} style={{ fontSize: P ? 8 : 9.5, fill: 'var(--text-2)' }}>
              {r.name}
            </text>
            <rect x={rect.x + labelW} y={y - th / 2} width={X(H1_HEADERS)} height={th} rx={1.5} fill="none" stroke={LINE(0.45)} />
            <rect x={rect.x + labelW} y={y - th / 2} width={Math.max(2, X(r.hdrBytes))} height={th} rx={1.5} fill={SIG.req} opacity={0.9} />
            <text
              className={stage.mono}
              x={rect.x + labelW + X(H1_HEADERS) + 6}
              y={y + 3}
              style={{ fontSize: P ? 8 : 9.5, fill: r.hdrBytes >= FIRST_HEADERS ? 'var(--text-2)' : SIG.req }}
            >
              {P ? `${r.hdrBytes} B` : `${H1_HEADERS} → ${r.hdrBytes} B`}
            </text>
          </g>
        );
      })}
      {reqs.length > 0 && (
        <text
          className={stage.mono}
          x={rect.x}
          y={rect.y + head + reqs.length * rowH + (P ? 12 : 16)}
          style={{ fontSize: P ? 8.5 : 10, fill: 'var(--text-1)' }}
        >
          total {(total / 1000).toFixed(1)} KB vs {((reqs.length * H1_HEADERS) / 1000).toFixed(1)} KB as HTTP/1.1
        </text>
      )}
      {!P && (
        <g transform={`translate(${tx},${rect.y + 26})`}>
          <rect x={0} y={0} width={tableW} height={36 + HPACK_TABLE.length * 17} rx={9} fill="rgba(10,15,28,0.9)" stroke="rgba(181,155,255,0.32)" />
          <rect x={11} y={11} width={6} height={6} transform="rotate(45 14 14)" fill={SIG.hc} />
          <text className={stage.caps} x={24} y={17} style={{ fontSize: 8.5, fill: '#cdbdff' }}>
            dynamic table · both ends
          </text>
          {HPACK_TABLE.map(([idx, entry], k) => {
            const on = L.requests > 0;
            return (
              <g key={idx} opacity={on ? 1 : 0.25}>
                <text className={stage.mono} x={12} y={40 + k * 17} style={{ fontSize: 9.5, fill: 'var(--accent)' }}>
                  {idx}
                </text>
                <text className={stage.mono} x={34} y={40 + k * 17} style={{ fontSize: 9.5, fill: 'var(--text-2)' }}>
                  {entry.length > 30 ? `${entry.slice(0, 29)}…` : entry}
                </text>
              </g>
            );
          })}
        </g>
      )}
    </g>
  );
}

/* ================================================================== */
/* The race: three protocols, same page, same network                  */
/* ================================================================== */

const RACE_SUB: Record<string, string> = { 'h1.1': '6 TCP connections', h2: '1 TCP connection', h3: '1 QUIC connection' };

function RaceScene({ sim }: { sim: HttpSim }) {
  const loads = sim.raceLoads;
  if (!loads) return null;
  const P = sim.orient === 'portrait';
  const scale = sim.wfScale;
  const order = RACE.filter((k) => loads[k].done).sort((a, b) => loads[a].loadMs - loads[b].loadMs);
  const lossy = sim.cfg.pktLoss > 0;
  const ticks = ticksFor(scale, P ? 4 : 7);
  return (
    <g>
      {RACE.map((k, i) => {
        const rect = sim.G.rows[i];
        if (!rect) return null;
        const L = loads[k];
        const A = sim.raceArea(i);
        const n = L.res.length;
        const rowH = A.h / n;
        const th = Math.max(2.5, Math.min(7, rowH * 0.62));
        const X = (t: number) => A.x + ((t * MS) / scale) * A.w;
        const rank = order.indexOf(k);
        const pc = L.pendingConnects();
        const stalled = L.res.filter((r) => r.stalls.length > 0).length;
        const clean = sim.raceClean?.[k];
        const done = L.done;
        const first = done && rank === 0;
        const timeColor = first ? SIG.res : 'var(--text-1)';
        const place = done ? `${['1st', '2nd', '3rd'][rank]}${P ? '' : ' place'}` : `${L.filesDone}/${n} files`;
        const stallText = stalled ? `${stalled} file${stalled === 1 ? '' : 's'} stalled` : lossy ? 'no stalls yet' : '';
        return (
          <g key={k}>
            <rect
              x={rect.x}
              y={rect.y}
              width={rect.w}
              height={rect.h}
              rx={12}
              fill="rgba(10,15,28,0.55)"
              stroke={first ? 'rgba(75,227,160,0.55)' : LINE(0.2)}
            />
            {ticks.map((t) => {
              const x = A.x + (t / scale) * A.w;
              const label = t === 0 ? '0' : `${t}${t === ticks[ticks.length - 1] ? ' ms' : ''}`;
              const flip = x + label.length * 5.4 + 4 > rect.x + rect.w - 6;
              return (
                <g key={t}>
                  <line x1={x} x2={x} y1={A.y - 3} y2={A.y + A.h} stroke={LINE(t === 0 ? 0.22 : 0.08)} />
                  {(!P || i === 0) && (
                    <text
                      className={stage.mono}
                      x={flip ? x - 2 : x + 2}
                      y={A.y - 6}
                      textAnchor={flip ? 'end' : 'start'}
                      style={{ fontSize: P ? 7 : 8.5, fill: 'var(--text-3)' }}
                    >
                      {label}
                    </text>
                  )}
                </g>
              );
            })}
            {lossy && clean != null && (
              <g>
                <line x1={X(clean / MS)} x2={X(clean / MS)} y1={A.y - 3} y2={A.y + A.h + 3} stroke={LINE(0.6)} strokeDasharray="2 3" />
                {!P && (
                  <text className={stage.mono} x={X(clean / MS) - 4} y={A.y + A.h + 14} textAnchor="end" style={{ fontSize: 8.5, fill: 'var(--text-3)' }}>
                    no loss: {Math.round(clean)} ms
                  </text>
                )}
              </g>
            )}
            {L.res.map((r, j) => (
              <Bars key={r.i} res={r} X={X} y={A.y + (j + 0.5) * rowH} th={th} now={L.now} connecting={pc.get(r.i)} />
            ))}
            {done && L.tLoad != null ? (
              <line x1={X(L.tLoad)} x2={X(L.tLoad)} y1={A.y - 3} y2={A.y + A.h + 3} stroke={first ? SIG.res : LINE(0.7)} strokeWidth={1.4} />
            ) : (
              L.now > 0 && <line x1={X(L.now)} x2={X(L.now)} y1={A.y - 3} y2={A.y + A.h + 3} stroke="rgba(255,210,63,0.6)" strokeDasharray="2 3" />
            )}
            {P ? (
              <g>
                <text className={stage.name} x={rect.x + 10} y={rect.y + 18} style={{ fontSize: 12.5, fontWeight: 600 }}>
                  {PROTO_NAME[k]}
                </text>
                <text className={stage.mono} x={rect.x + 70} y={rect.y + 18} style={{ fontSize: 8 }}>
                  {RACE_SUB[k]}
                </text>
                <text className={stage.monoStrong} x={rect.x + rect.w - 10} y={rect.y + 19} textAnchor="end" style={{ fontSize: 13, fill: timeColor }}>
                  {Math.round(L.loadMs)} ms
                </text>
                <text className={stage.mono} x={rect.x + 10} y={rect.y + 32} style={{ fontSize: 8, fill: first ? SIG.res : 'var(--text-3)' }}>
                  {place}
                </text>
                {stallText && (
                  <text
                    className={stage.mono}
                    x={rect.x + rect.w - 10}
                    y={rect.y + 32}
                    textAnchor="end"
                    style={{ fontSize: 8, fill: stalled ? SIG.err : 'var(--text-3)' }}
                  >
                    {stallText}
                  </text>
                )}
              </g>
            ) : (
              <g transform={`translate(${rect.x + 16},${rect.y})`}>
                <text className={stage.name} x={0} y={28} style={{ fontSize: 17, fontWeight: 600 }}>
                  {PROTO_NAME[k]}
                </text>
                <text className={stage.mono} x={0} y={44}>
                  {RACE_SUB[k]}
                </text>
                <text className={stage.monoStrong} x={0} y={80} style={{ fontSize: 26, fill: timeColor }}>
                  {Math.round(L.loadMs)}
                  <tspan style={{ fontSize: 12, fill: 'var(--text-3)' }}> ms</tspan>
                </text>
                <text className={stage.mono} x={0} y={100} style={{ fontSize: 10, fill: first ? SIG.res : done ? 'var(--text-2)' : 'var(--text-3)' }}>
                  {place}
                </text>
                {stallText && (
                  <text className={stage.mono} x={0} y={116} style={{ fontSize: 10, fill: stalled ? SIG.err : 'var(--text-3)' }}>
                    {stallText}
                  </text>
                )}
              </g>
            )}
          </g>
        );
      })}
    </g>
  );
}
