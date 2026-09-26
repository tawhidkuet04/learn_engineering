'use client';

import type { CSSProperties } from 'react';
import { Hud, type HudItem } from '@/components/stage/chrome';
import { Badge, InspectorCard, StagePrompt, type InspectorLine } from '@/components/stage/overlays';
import { SIG } from '@/lib/sim/colors';
import { MS, PROTO_NAME, type PageLoad, type Pkt, type Proto } from './engine';
import { sizeKb, TYPE_COLOR } from './page';
import type { HttpSim } from './sim';
import css from './devtools.module.css';

export type HudKey = 'proto' | 'load' | 'files' | 'conns' | 'hs' | 'lost' | 'held' | 'rtt' | 'loss' | 'hdr' | 'net' | 'streams' | 'queue';

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

function hudItems(sim: HttpSim, keys: HudKey[]): HudItem[] {
  const L = sim.load;
  const P = sim.orient === 'portrait';
  const race = sim.cfg.view === 'race';
  const out: HudItem[] = [];
  for (const k of keys) {
    if (race && !['rtt', 'loss'].includes(k)) continue;
    switch (k) {
      case 'proto':
        out.push({ label: 'Protocol', value: PROTO_NAME[L.cfg.proto] });
        break;
      case 'load':
        out.push({ label: L.done ? 'Page loaded' : 'Loading', value: fmt(L.loadMs), unit: 'ms', tone: L.done ? 'good' : undefined });
        break;
      case 'files':
        out.push({ label: 'Files', value: `${L.filesDone}/${L.res.length}` });
        break;
      case 'conns':
        out.push({ label: P ? 'Conns' : 'Connections', value: L.conns.length });
        break;
      case 'hs':
        out.push({ label: 'Handshakes', value: L.handshakes, tone: L.handshakes > 1 ? 'warn' : undefined });
        break;
      case 'lost':
        out.push({ label: P ? 'Lost' : 'Lost chunks', value: L.lostCount + L.pathLost, tone: L.lostCount + L.pathLost ? 'bad' : undefined });
        break;
      case 'held': {
        const n = L.holds().reduce((s, h) => s + h.pkts.length, 0);
        out.push({ label: L.tcp ? 'Held by TCP' : 'Held in stream', value: n, tone: n ? 'bad' : undefined });
        break;
      }
      case 'rtt':
        out.push({ label: 'RTT', value: sim.cfg.rttMs, unit: 'ms' });
        break;
      case 'loss':
        out.push({
          label: P ? 'Loss' : 'Packet loss',
          value: (sim.cfg.pktLoss * 100).toFixed(sim.cfg.pktLoss && sim.cfg.pktLoss < 0.01 ? 2 : 1),
          unit: '%',
          tone: sim.cfg.pktLoss ? 'bad' : undefined,
        });
        break;
      case 'hdr':
        out.push({ label: 'Header bytes', value: (L.headerBytes / 1000).toFixed(1), unit: 'KB' });
        break;
      case 'net':
        out.push({ label: 'Network', value: L.net === 'wifi' ? 'Wi-Fi' : '5G', tone: L.net === 'wifi' ? undefined : 'warn' });
        break;
      case 'streams':
        out.push({ label: 'Open streams', value: L.openStreams });
        break;
      case 'queue':
        out.push({ label: 'Queued', value: L.queue.length, tone: L.queue.length ? 'warn' : undefined });
        break;
    }
  }
  return P ? out.slice(0, 3) : out;
}

/* ------------------------------------------------------------------ */
/* Inspector: what's inside the packet the card rides on                */
/* ------------------------------------------------------------------ */

const UA = 'Mozilla/5.0 (Macintosh…)';

function inspect(sim: HttpSim, L: PageLoad, p: Pkt): { head: string; lines: InspectorLine[]; tone: 'req' | 'res'; note?: string } | null {
  const r = p.res != null ? L.res[p.res] : null;
  if (!r) return null;
  const m = sim.cfg.mode;
  if (m === 'h1req' && p.kind === 'req') {
    return {
      head: `request · TCP ${(L.conns[p.conn]?.lane ?? 0) + 1}`,
      tone: 'req',
      lines: [
        { t: `GET ${r.i === 0 ? '/' : `/${r.name}`} HTTP/1.1`, kind: 'strong' },
        'Host: shop.example',
        { t: 'Connection: keep-alive', kind: 'change' },
        `User-Agent: ${UA}`,
        'Cookie: session=8f3a2c…',
        'Accept-Language: en-US,en…',
      ],
      note: `${r.hdrBytes} bytes of plain text, on every request`,
    };
  }
  if (m === 'hpack' && p.kind === 'req') {
    const first = r.hdrBytes >= 400;
    return {
      head: `HEADERS · stream ${r.stream} · ${r.hdrBytes} bytes`,
      tone: 'req',
      lines: first
        ? [
            ':method GET        static #2',
            ':scheme https      static #7',
            ':path /            static #4',
            { t: ':authority …       new entry', kind: 'add' },
            { t: 'user-agent …       new entry', kind: 'add' },
            { t: 'cookie …           new entry', kind: 'add' },
          ]
        : [
            { t: ':method GET        static #2', kind: 'dim' },
            { t: ':scheme https      static #7', kind: 'dim' },
            { t: `:path /${r.name}`.padEnd(19) + 'literal', kind: 'change' },
            { t: ':authority …       dynamic #65', kind: 'dim' },
            { t: 'user-agent …       dynamic #64', kind: 'dim' },
            { t: 'cookie …           dynamic #62', kind: 'dim' },
          ],
      note: first ? 'First request: fields go into the table' : 'Repeats cost one byte each',
    };
  }
  if (m === 'altsvc' && p.kind === 'data') {
    return {
      head: 'response headers · index.html',
      tone: 'res',
      lines: [{ t: 'HTTP/2 200', kind: 'strong' }, 'content-type: text/html', 'cache-control: no-cache', { t: 'alt-svc: h3=":443"; ma=86400', kind: 'add' }],
      note: 'HTTP/3 is on UDP port 443; remember it for a day',
    };
  }
  if (m === 'frames') {
    if (p.kind === 'req') {
      return {
        head: `HEADERS frame · stream ${r.stream}`,
        tone: 'req',
        lines: [
          `length   ${r.hdrBytes}`,
          'type     0x1  HEADERS',
          'flags    END_STREAM, END_HEADERS',
          { t: `stream   ${r.stream}`, kind: 'change' },
          'rule',
          ':method GET',
          `:path ${r.i === 0 ? '/' : `/${r.name}`}`,
        ],
      };
    }
    if (p.kind === 'data') {
      const last = p.chunk === r.chunks - 1;
      return {
        head: `DATA frame · stream ${r.stream}`,
        tone: 'res',
        lines: [
          'length   16384',
          'type     0x0  DATA',
          `flags    ${last ? 'END_STREAM' : '(none)'}`,
          { t: `stream   ${r.stream}  → ${r.name}`, kind: 'change' },
          'rule',
          `payload  bytes ${fmt(p.chunk * 16384)}–${fmt((p.chunk + 1) * 16384 - 1)}`,
        ],
      };
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */

export function Overlay({ sim, hud }: { sim: HttpSim; hud: HudKey[] }) {
  const P = sim.orient === 'portrait';
  const v = sim.cfg.view;
  const L = sim.load;
  const q = sim.game?.pending;
  let ask: { x: number; y: number } | null = null;
  if (q?.askAt) {
    if ('x' in q.askAt) ask = { x: q.askAt.x, y: q.askAt.y };
    else {
      const b = sim.boxes.get(q.askAt.id);
      if (b) ask = { x: b.x, y: b.y - b.h / 2 - 10 };
    }
    // The prompt pill is centered on x: keep all of it on the stage.
    if (ask) {
      const half = Math.min(sim.w / 2 - 8, (q.ask?.length ?? 20) * 3.4 + 14);
      ask = { x: Math.min(Math.max(ask.x, half + 8), sim.w - half - 8), y: ask.y };
    }
  }
  const ip = sim.insp && v === 'lanes' ? L.pkts.find((p) => p.id === sim.insp!.id) : null;
  const flying = ip ? L.inFlight().find((f) => f.p.id === ip.id) : null;
  const card = ip ? inspect(sim, L, ip) : null;
  const at = ip ? (flying ? sim.pktXY(L, ip, flying.k) : { x: sim.insp!.x, y: sim.insp!.y }) : null;
  const b = sim.boxes.get('browser');
  return (
    <>
      {v !== 'devtools' && hud.length > 0 && <Hud items={hudItems(sim, hud)} />}
      {v === 'devtools' && <DevTools sim={sim} />}
      {card && at && <InspectorCard key={ip!.id} x={at.x} y={at.y} stageW={sim.w} head={card.head} lines={card.lines} tone={card.tone} note={card.note} />}
      {sim.cfg.mode === 'altsvc' && sim.altSvcKnown && b && v === 'lanes' && (
        <Badge x={b.x} y={b.y + b.h / 2 + (P ? 22 : 30)}>
          {P ? 'knows: h3 on :443' : 'remembered: h3 on UDP 443'}
        </Badge>
      )}
      {sim.cfg.clickDrop && v === 'lanes' && !q && !P && (
        <div
          style={{
            position: 'absolute',
            left: sim.G.lanes.x + sim.G.lanes.w / 2,
            top: sim.G.lanes.y + sim.G.lanes.h + 14,
            transform: 'translateX(-50%)',
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            letterSpacing: '0.08em',
            color: 'var(--accent)',
            opacity: 0.75,
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          click a chunk in flight to drop it
        </div>
      )}
      {q && ask && (
        <StagePrompt x={ask.x} y={ask.y}>
          {q.ask}
        </StagePrompt>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* DevTools: the Network panel, with the Protocol column               */
/* ------------------------------------------------------------------ */

const PROTO_COL: Record<Proto, string> = { 'h1.0': 'http/1.0', 'h1.1': 'http/1.1', h2: 'h2', h3: 'h3' };

function DevTools({ sim }: { sim: HttpSim }) {
  const L = sim.load;
  const P = sim.orient === 'portrait';
  const r = sim.G.devtools;
  const rows = L.res.filter((x) => x.discovered).sort((a, b) => (a.tDiscover ?? 0) - (b.tDiscover ?? 0) || a.i - b.i);
  const chrome = 30 + 28 + 24 + 26;
  const rh = Math.max(16, Math.min(P ? 24 : 28, (r.h - chrome - 2) / Math.max(12, L.res.length)));
  const cols = P ? 'minmax(0,1.2fr) 64px 52px minmax(0,1fr)' : 'minmax(0,1.3fr) 74px 72px 70px 84px 60px 66px minmax(0,2fr)';
  const scale = sim.wfScale;
  const pct = (t: number) => `${Math.min(100, ((t * MS) / scale) * 100)}%`;
  const kb = L.res.reduce((s, x, i) => s + (x.done ? sizeKb(x, i) : 0), 0);
  const type = (i: number) => {
    const x = L.res[i];
    if (x.type === 'html') return 'document';
    if (x.type === 'css') return 'stylesheet';
    if (x.type === 'js') return 'script';
    if (x.type === 'font') return 'font';
    return x.name.endsWith('.svg') ? 'svg+xml' : 'jpeg';
  };
  const connId = (i: number) => {
    const x = L.res[i];
    if (!x.requested || x.conn == null) return '';
    return String(48210 + x.conn);
  };
  return (
    <>
      <div className={css.caption} style={{ left: r.x, top: r.y - 22 }}>
        DevTools · Network panel · {PROTO_NAME[L.cfg.proto]}
      </div>
      <div className={css.dt} style={{ left: r.x, top: r.y, width: r.w, height: r.h, '--rh': `${rh}px` } as CSSProperties}>
        <div className={css.tabs}>
          {(P ? ['Elements', 'Console', 'Network'] : ['Elements', 'Console', 'Sources', 'Network', 'Performance', 'Application']).map((t) => (
            <span key={t} className={t === 'Network' ? `${css.tab} ${css.tabOn}` : css.tab}>
              {t}
            </span>
          ))}
        </div>
        <div className={css.toolbar}>
          <i className={css.rec} />
          <span>{P ? 'No throttling' : 'Preserve log · Disable cache · No throttling'}</span>
        </div>
        <div className={css.table}>
          <div className={`${css.row} ${css.head}`} style={{ gridTemplateColumns: cols }}>
            <span>Name</span>
            {!P && <span>Status</span>}
            <span className={css.proto}>Protocol</span>
            {!P && <span>Conn ID</span>}
            {!P && <span>Type</span>}
            {!P && <span>Size</span>}
            <span>Time</span>
            <span>Waterfall</span>
          </div>
          {rows.map((x) => (
            <div key={x.i} className={css.row} style={{ gridTemplateColumns: cols }}>
              <span className={css.name}>
                <i style={{ background: TYPE_COLOR[x.type] }} />
                {x.name}
              </span>
              {!P && <span className={x.done ? undefined : css.pending}>{x.done ? '200' : '(pending)'}</span>}
              <span className={css.proto}>{x.requested ? PROTO_COL[L.cfg.proto] : ''}</span>
              {!P && <span>{connId(x.i)}</span>}
              {!P && <span>{type(x.i)}</span>}
              {!P && <span>{x.done ? `${sizeKb(x, x.i)} kB` : ''}</span>}
              <span className={x.done ? undefined : css.pending}>
                {x.done && x.tDone != null && x.tDiscover != null ? `${fmt((x.tDone - x.tDiscover) * MS)} ms` : 'pending'}
              </span>
              <span className={css.wf}>
                {x.segs.map((s, k) => {
                  const t1 = s.t1 ?? L.now;
                  const style: CSSProperties = { left: pct(s.t0), width: `calc(${pct(t1)} - ${pct(s.t0)})` };
                  const cls =
                    s.kind === 'dl' ? css.dl : s.kind === 'connect' ? css.conn : s.kind === 'wait' ? css.wait : s.kind === 'lost' ? css.lost : css.queue;
                  return <i key={k} className={cls} style={s.kind === 'dl' ? { ...style, background: TYPE_COLOR[x.type] } : style} />;
                })}
                {x.stalls.map((s, k) => (
                  <i key={`s${k}`} className={css.stall} style={{ left: pct(s.t0), width: `calc(${pct(s.t1 ?? L.now)} - ${pct(s.t0)})` }} />
                ))}
              </span>
            </div>
          ))}
        </div>
        <div className={css.footer}>
          <span>{L.res.filter((x) => x.requested).length} requests</span>
          <span>{kb} kB transferred</span>
          {!P && <span>Finish: {fmt(L.loadMs)} ms</span>}
          {L.done && <span style={{ color: SIG.res }}>Load: {fmt(L.loadMs)} ms</span>}
        </div>
      </div>
    </>
  );
}
