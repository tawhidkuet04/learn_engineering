'use client';

import type { CSSProperties, ReactNode } from 'react';
import { Hud, type HudItem } from '@/components/stage/chrome';
import { StagePrompt } from '@/components/stage/overlays';
import { clamp } from '@/lib/sim/geometry';
import { TRACE_HOPS } from './content';
import { emptyInfo, headerInfo, physicalInfo, routerDiff, type Field, type HeaderInfo } from './fields';
import { APPS, BOB_MAC, LAYERS, ROUTER, receiverFor, type BlockKind, type LayerN } from './model';
import { spriteRect } from './Scene';
import type { OsiSim } from './sim';
import css from './osi.module.css';

export type CardKind = 'auto' | 'layer' | 'inspect' | 'switch' | 'router' | 'demux' | 'trace' | 'none';
export type HudKey = 'unit' | 'size' | 'layer' | 'ttl' | 'overhead' | 'delivered' | 'hops' | 'status';

const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(' ');

/* ------------------------------------------------------------------ */
/* HUD                                                                 */
/* ------------------------------------------------------------------ */

export function OsiHud({ sim, keys }: { sim: OsiSim; keys: HudKey[] }) {
  const items: HudItem[] = [];
  const portrait = sim.orient === 'portrait';
  for (const k of keys) {
    if (k === 'unit') items.push({ label: 'data unit', value: sim.blocks.length || sim.bits ? sim.unit : '—' });
    if (k === 'size') items.push({ label: 'size', value: sim.size ? sim.size.toLocaleString('en-US') : '—', unit: sim.size ? 'bytes' : undefined });
    if (k === 'layer') {
      const at = sim.path[sim.at];
      items.push({ label: 'layer', value: at && sim.blocks.length ? `${at.layer} · ${portrait ? LAYERS[at.layer].short : LAYERS[at.layer].name}` : '—' });
    }
    if (k === 'ttl') items.push({ label: 'TTL', value: sim.blocks.some((b) => b.kind === 'ip') || sim.bits ? sim.ttl : '—', tone: sim.ttl <= 0 ? 'bad' : sim.ttl < sim.cfg.ttl ? 'warn' : undefined });
    if (k === 'overhead') {
      const b = sim.built();
      const data = b.tls ? b.tls.length - 5 : b.app.length;
      const hdr = sim.size - data;
      items.push({ label: 'headers', value: sim.size > data ? hdr : 0, unit: `B + ${data} B data` });
    }
    if (k === 'delivered') items.push({ label: 'delivered', value: sim.delivered, tone: sim.delivered ? 'good' : undefined });
    if (k === 'hops') items.push({ label: 'probes answered', value: sim.trace.length });
    if (k === 'status') {
      const done = sim.tripDone && !!sim.deliveredTo;
      const s = !sim.tripSpecActive ? '—' : sim.dead ? `died at layer ${sim.dead.layer}` : done ? (sim.broken === 'app500' ? 'answered 500' : 'delivered') : 'in flight';
      items.push({ label: 'request', value: s, tone: sim.dead || (done && sim.broken === 'app500') ? 'bad' : done ? 'good' : undefined });
    }
  }
  return <Hud items={items} />;
}

/* ------------------------------------------------------------------ */
/* Info card                                                           */
/* ------------------------------------------------------------------ */

interface CardProps {
  /** Force one field column (tables read row by row) */
  table?: boolean;
  head: string;
  color: string;
  right?: string;
  fields?: Field[];
  text?: string[];
  note?: ReactNode;
  result?: ReactNode;
  pos: CardPos;
}

export interface CardPos {
  x: number;
  y: number;
  w: number;
  strip?: boolean;
  /** Phone: two field columns (or one, with notes, for long values) */
  compact?: boolean;
  /** Anchor the card by its bottom edge at y */
  up?: boolean;
}

function InfoCard({ head, color, right, fields = [], text, note, result, pos, table }: CardProps) {
  // Phones: two field columns, unless values are long (MACs), then one column with notes.
  const compact = !!(pos.strip || pos.compact);
  const one = compact && (table || fields.some((f) => f.v.length > 13));
  if (one && fields.length >= 4 && pos.strip) note = undefined;
  const style: CSSProperties = pos.strip
    ? ({ '--c': color } as CSSProperties)
    : ({ '--c': color, left: pos.x, top: pos.y, width: pos.w, transform: pos.up ? 'translateY(-100%)' : undefined } as CSSProperties);
  return (
    <div className={cx(css.card, compact && css.cardCompact, pos.strip && css.cardStrip, one && css.cardOne)} style={style}>
      <div className={css.cardHead}>
        <i />
        <span>{head}</span>
        {right && <em>{right}</em>}
      </div>
      <div className={css.cardBody}>
        {text && text.map((t, i) => <div key={i} className={css.text}>{t}</div>)}
        {fields.length > 0 && (
          <div className={css.rows}>
            {fields.map((f, i) => (
              <div key={i} className={cx(f.kind === 'add' && css.add, f.kind === 'change' && css.change, f.kind === 'same' && css.same, f.kind === 'hot' && css.hot, f.kind === 'bad' && css.bad)} style={{ display: 'contents' }}>
                <span className={css.k}>{f.k}</span>
                <span className={css.v}>{f.v}</span>
                <span className={css.note}>{f.note ?? ''}</span>
              </div>
            ))}
          </div>
        )}
        {result && <div className={css.cardNote} style={{ color: 'var(--text-1)' }}>{result}</div>}
        {note && <div className={cx(css.cardNote, !fields.length && !text && !result && css.cardNoteOnly)}>{note}</div>}
      </div>
    </div>
  );
}

function estHeight(info: { fields?: Field[]; text?: string[]; note?: ReactNode; result?: ReactNode }, strip: boolean) {
  const rows = (info.fields?.length ?? 0) + (info.text?.length ?? 0);
  return 34 + rows * (strip ? 16 : 16.5) + (info.note ? 44 : 0) + (info.result ? 26 : 0);
}

/** Where a card goes for this view and orientation. */
function place(sim: OsiSim, h: number, near?: { dev: string } | null): CardPos {
  const land = sim.orient === 'landscape';
  const view = sim.cfg.view;
  if (!land && view !== 'path') return { x: 0, y: 0, w: 0, strip: true };
  if (!land) return { x: 10, y: 68, w: sim.w - 20, compact: true };
  if (view === 'stack') {
    const { x0, x1 } = lane(sim);
    const w = Math.min(344, x1 - x0);
    const r = spriteRect(sim);
    const mid = (sim.g.y1 - 6 * sim.g.pitch + sim.g.y1) / 2;
    // No unit to hang from (bits on the wire): sit above the cable.
    if (!r) return { x: (x0 + x1) / 2 - w / 2, y: sim.g.y1 - 44, w, up: true };
    const x = clamp(r.x + r.w / 2 - w / 2, x0, x1 - w);
    if (r.sv.y < mid) return { x, y: r.y + r.h + 16, w };
    return { x, y: r.y - 26, w, up: true };
  }
  // path view: above the device that is working, clear of the floating unit
  const w = 330;
  const c = near ? sim.col(near.dev as never) : null;
  const cxp = c ? c.cx : sim.w / 2;
  void h;
  return { x: clamp(cxp - w / 2, 12, sim.w - w - 12), y: sim.spriteRowY() - 34, w, up: true };
}

/** The open space between the two stacks in the stack view. */
export function lane(sim: OsiSim) {
  const a = sim.col('alice');
  const b = sim.col('srv');
  return { x0: (a ? a.cx + a.w / 2 : 0) + 14, x1: (b ? b.cx - b.w / 2 : sim.w) - 14 };
}

/* ------------------------------------------------------------------ */

function blockInfo(sim: OsiSim, kind: BlockKind, fresh: boolean): HeaderInfo {
  const b = sim.built();
  const info = headerInfo(kind, { app: sim.cfg.app, b, seg: sim.seg, ttl: sim.ttl, fresh });
  if (kind === 'eth' || kind === 'wifi') {
    const f = headerInfo('fcs', { app: sim.cfg.app, b, seg: sim.seg, ttl: sim.ttl, fresh });
    return { ...info, title: kind === 'wifi' ? '802.11 + FCS' : 'Ethernet II + FCS', size: `${kind === 'wifi' ? b.l2.length : 14} + 4 bytes`, fields: [...info.fields, { ...f.fields[0], k: 'FCS', note: 'trailer · CRC-32' }] };
  }
  return info;
}

/** The header a layer adds (or would add) for the current settings. */
export function layerInfo(sim: OsiSim, L: LayerN, fresh: boolean): HeaderInfo {
  const a = APPS[sim.cfg.app];
  switch (L) {
    case 7:
      return blockInfo(sim, 'app', fresh);
    case 6:
      return sim.cfg.app === 'https' ? blockInfo(sim, 'tls', fresh) : emptyInfo(6, sim.cfg.app);
    case 5:
      return emptyInfo(5, sim.cfg.app);
    case 4:
      return blockInfo(sim, a.l4, fresh);
    case 3:
      return blockInfo(sim, 'ip', fresh);
    case 2:
      return blockInfo(sim, sim.blocks.some((b) => b.kind === 'wifi' && b.dead == null) ? 'wifi' : 'eth', fresh);
    case 1:
      return physicalInfo(sim.built());
  }
}

function headerCard(sim: OsiSim, info: HeaderInfo, verb: string, near?: { dev: string } | null) {
  const strip = sim.orient === 'portrait' && sim.cfg.view !== 'path';
  const note = info.note;
  const h = estHeight({ fields: info.fields, text: info.text, note }, strip);
  const pos = place(sim, h, near);
  const color = LAYERS[info.layer].color;
  return <InfoCard key={`${info.title}-${verb}`} head={`${verb}${info.title}`} right={info.size} color={color} fields={info.fields} text={info.text} note={note} pos={pos} />;
}

/* ------------------------------------------------------------------ */
/* Cards per step                                                      */
/* ------------------------------------------------------------------ */

export function StageCards({ sim, kind, layer }: { sim: OsiSim; kind: CardKind; layer?: LayerN }) {
  if (kind === 'none') return null;
  const q = sim.game?.pending;
  if (q && sim.predictKind !== 'symptoms') return null;

  if (kind === 'trace') return <TraceCard sim={sim} />;
  if (kind === 'inspect') {
    if (!sim.selected) return null;
    return headerCard(sim, layerInfo(sim, sim.selected, false), `layer ${sim.selected} · `);
  }
  if (kind === 'layer' && layer) {
    // Show the layer's contribution once the unit has reached it.
    const here = sim.path[sim.at];
    if (!here || !sim.blocks.length) return null;
    if (layer === 1) {
      // The physical layer: from the moment the frame turns into bits, all the way across.
      if (!sim.bits && !sim.moving) return null;
      return headerCard(sim, physicalInfo(sim.built(0, sim.cfg.ttl)), '');
    }
    if (sim.moving || here.dev !== 'alice' || here.layer > layer) return null;
    // Presentation and session share a step: show whichever one holds the unit.
    const L = layer === 6 && here.layer === 5 ? 5 : layer;
    const nothing = L === 5 || (L === 6 && sim.cfg.app !== 'https');
    return headerCard(sim, layerInfo(sim, L, !nothing), nothing ? `layer ${L} · ` : 'added: ');
  }
  if (kind === 'switch') return <SwitchCard sim={sim} />;
  if (kind === 'router') return <RouterCard sim={sim} />;
  if (kind === 'demux') return <DemuxCard sim={sim} />;
  if (kind === 'auto') {
    const act = sim.lastAct;
    if (!act || sim.moving || sim.dead) return null;
    if (act.dev === 'sw' && sim.swPhase === 'lookup') return <SwitchCard sim={sim} />;
    if (act.dev === 'rt') return <RouterCard sim={sim} />;
    if (act.dev === 'alice' && act.act === 'encap') {
      if (act.layer === 1) return headerCard(sim, physicalInfo(sim.built()), '', { dev: 'alice' });
      if (!sim.lastAdded || sim.path[sim.at].layer !== act.layer) return null;
      if (act.layer === 5 || (act.layer === 6 && sim.cfg.app !== 'https')) return null;
      return headerCard(sim, layerInfo(sim, act.layer, true), 'added: ', { dev: 'alice' });
    }
    if (act.dev === 'srv' && act.act === 'decap' && act.layer <= 4) return <DemuxCard sim={sim} />;
  }
  return null;
}

function SwitchCard({ sim }: { sim: OsiSim }) {
  const wifi = sim.cfg.link === 'wifi';
  const fields: Field[] = wifi
    ? [
        { k: 'in', v: '802.11 (radio)', note: 'from Alice' },
        { k: 'out', v: 'Ethernet (wire)', note: 'same src and dst MAC' },
        { k: 'dst', v: '0e:5a:c3:10:77:01', note: 'the router', kind: 'hot' },
      ]
    : [
        { k: 'Gi0/1', v: 'a64f.219c.3e07', note: 'Alice · learned from src' },
        { k: 'Gi0/2', v: BOB_MAC.replace(/:/g, '').replace(/(....)(....)(....)/, '$1.$2.$3'), note: 'Bob' },
        { k: 'Gi0/8', v: '0e5a.c310.7701', note: 'router · dst matches', kind: 'hot' },
      ];
  const result = wifi ? (
    <>
      Swap the 802.11 header for Ethernet (and a new FCS). <b style={{ color: 'var(--accent)', fontWeight: 500 }}>IP and above: never opened.</b>
    </>
  ) : (
    <>
      dst <b style={{ color: 'var(--accent)', fontWeight: 500 }}>0e:5a:c3:10:77:01</b> → out port Gi0/8. Frame unchanged, packet never opened.
    </>
  );
  const h = estHeight({ fields, result }, false);
  const pos = place(sim, h, { dev: 'sw' });
  return <InfoCard head={wifi ? 'access point · bridging' : 'switch · MAC address table'} color={LAYERS[2].color} fields={fields} result={result} pos={pos} />;
}

function RouterCard({ sim }: { sim: OsiSim }) {
  const rx = receiverFor(sim.cfg.app);
  const ph = sim.rtPhase;
  let head = 'router';
  let color = LAYERS[3].color;
  let fields: Field[] = [];
  let result: ReactNode = null;
  if (ph === 'check') {
    head = 'router · eth0 got a frame';
    color = LAYERS[2].color;
    fields = [
      { k: 'dst MAC', v: ROUTER.lan.mac, note: 'mine (eth0) ✓', kind: 'hot' },
      { k: 'FCS', v: 'CRC matches', note: 'not corrupted ✓' },
      { k: 'type', v: '0x0800', note: 'IPv4 inside' },
    ];
    result = <>Strip the frame and hand the packet up to layer 3.</>;
  } else if (ph === 'route') {
    head = 'router · routing table';
    fields = [
      { k: '198.51.100.0/24', v: 'eth0', note: 'connected' },
      { k: '203.0.113.0/24', v: 'eth1', note: `connected · ${rx.ip} ✓`, kind: 'hot' },
      { k: '0.0.0.0/0', v: 'eth2', note: 'default, via 192.0.2.254' },
    ];
    result = (
      <>
        TTL {sim.ttl + 1} → <b style={{ color: 'var(--accent)', fontWeight: 500 }}>{sim.ttl}</b>, checksum updated. Next hop: {rx.ip} on eth1.
      </>
    );
  } else if (ph === 'frame' || ph === 'sent') {
    head = 'what the router changed';
    color = 'var(--accent)';
    const before = sim.built(0, sim.ttl + 1);
    const after = sim.built(1, sim.ttl);
    fields = routerDiff(sim.cfg.app, before, after, sim.ttl + 1, sim.ttl);
    if (sim.orient === 'portrait') {
      fields = fields.filter((f) => f.kind === 'change');
      result = <>Unchanged: both IP addresses, the ports and the data.</>;
    }
  } else if (ph === 'expired') {
    head = 'router · TTL expired';
    color = 'var(--sig-err)';
    fields = [{ k: 'TTL', v: '1 → 0', note: 'no hops left', kind: 'bad' }];
    result = <>Drop the packet and send ICMP “time exceeded” back to 198.51.100.23.</>;
  } else if (ph === 'noroute') {
    head = 'router · no route';
    color = 'var(--sig-err)';
    fields = [
      { k: '198.51.100.0/24', v: 'eth0', note: 'connected' },
      { k: '203.0.113.10', v: '?', note: 'no match, no default route', kind: 'bad' },
    ];
    result = <>Drop it and send ICMP “destination net unreachable” to Alice.</>;
  } else return null;
  const h = estHeight({ fields, result }, false);
  const pos = place(sim, h, { dev: 'rt' });
  return <InfoCard key={head} head={head} color={color} fields={fields} result={result} pos={pos} table={ph === 'route' || ph === 'noroute'} />;
}

function DemuxCard({ sim }: { sim: OsiSim }) {
  const rx = receiverFor(sim.cfg.app);
  const a = APPS[sim.cfg.app];
  const act = sim.lastAct;
  const reached = act && act.dev === 'srv' ? act.layer : 1;
  const all: (Field & { at: number })[] = [
    { at: 2, k: 'L2', v: `${rx.mac} ✓`, note: 'type 0x0800 → IP' },
    { at: 3, k: 'L3', v: `${rx.ip} ✓`, note: a.l4 === 'tcp' ? 'protocol 6 → TCP' : 'protocol 17 → UDP' },
    { at: 4, k: 'L4', v: `port ${a.dport}`, note: `→ ${rx.proc}` },
    { at: 7, k: 'L7', v: sim.cfg.app === 'dns' ? 'A? shop.example' : sim.cfg.app === 'video' ? 'RTP video' : 'GET /', note: sim.cfg.app === 'http' || sim.cfg.app === 'https' ? '→ /index.html' : '' },
  ];
  const fields = all.filter((f) => f.at <= reached).map((f) => ({ ...f, kind: f.at === reached ? ('hot' as const) : undefined }));
  if (!fields.length) return null;
  const strip = sim.orient === 'portrait' && sim.cfg.view !== 'path';
  const h = estHeight({ fields }, strip);
  const pos = place(sim, h, { dev: 'srv' });
  return <InfoCard head={`${rx.host} · who gets it?`} color={LAYERS[reached as LayerN].color} fields={fields} pos={pos} />;
}

function TraceCard({ sim }: { sim: OsiSim }) {
  const land = sim.orient === 'landscape';
  const text = [
    ...sim.trace.map((r) => {
      const ms = land ? r.ms.map((m) => `${m.toFixed(3)} ms`).join('  ') : `${r.ms[0].toFixed(3)} ms`;
      return `${String(r.ttl).padStart(2)}  ${r.ip.padEnd(14)} ${ms}`;
    }),
  ];
  if (!text.length) text.push(sim.traceBusy ? '   waiting for the first reply…' : ' ');
  const chain = sim.boxes.get('c.alice');
  const pos: CardPos = land ? { x: sim.w / 2 - 230, y: (chain ? chain.ty : sim.h * 0.34) + 64, w: 460 } : { x: 0, y: 0, w: 0, strip: true };
  const done = sim.trace.length >= TRACE_HOPS.length;
  return (
    <InfoCard
      head={land ? 'traceroute -n shop.example' : 'traceroute -n'}
      right={land ? '30 hops max, 60 byte packets' : undefined}
      color={LAYERS[3].color}
      text={text}
      note={done && land ? 'Every line is a router that counted TTL down to 0 and complained. The last one is the server itself.' : undefined}
      pos={pos}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Prompts                                                             */
/* ------------------------------------------------------------------ */

export function PredictPrompt({ sim }: { sim: OsiSim }) {
  const q = sim.game?.pending;
  if (!q || sim.predictKind === 'symptoms') return null;
  const text = q.ask ?? 'Your turn';
  const half = (text.length * 6.7 + 22) / 2;
  const r = spriteRect(sim);
  if (sim.orient === 'portrait' && sim.cfg.view === 'stack') {
    return (
      <StagePrompt x={sim.w / 2} y={sim.g.y1 + sim.g.rowH / 2 + 44}>
        {text}
      </StagePrompt>
    );
  }
  if (r) {
    const { x0, x1 } = sim.cfg.view === 'stack' ? lane(sim) : { x0: 8, x1: sim.w - 8 };
    return (
      <StagePrompt x={clamp(r.x + r.w / 2, x0 + half, x1 - half)} y={r.y - 24}>
        {text}
      </StagePrompt>
    );
  }
  return (
    <StagePrompt x={sim.w / 2} y={96}>
      {text}
    </StagePrompt>
  );
}

export function SymptomCard({ sim }: { sim: OsiSim }) {
  const s = sim.symptom;
  if (!s) return null;
  const answered = !sim.game?.pending;
  return (
    <div className={css.term} key={s.id} style={sim.orient === 'portrait' ? { top: 72 } : undefined}>
      <div className={css.termHead}>
        <b>
          <i />
          <i />
          <i />
        </b>
        {answered ? `broken: layer ${s.layer} · ${LAYERS[s.layer].name}` : 'Alice’s terminal · what’s broken?'}
      </div>
      <div className={css.termBody}>
        <span className={css.prompt}>$ </span>
        {s.cmd}
        {'\n'}
        <span className={css.err}>{s.out.join('\n')}</span>
      </div>
    </div>
  );
}
