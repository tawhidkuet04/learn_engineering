import { Effects, Flights, Wires } from '@/components/stage/svg';
import { SIG } from '@/lib/sim/colors';
import { clamp } from '@/lib/sim/geometry';
import type { Box } from '@/lib/sim/Sim';
import { fmtClock, NODES, PEOPLE, REGION, RTT_MS, pairKey, type ClientId, type NodeId } from './model';
import { POST_A, POST_B } from './feed';
import { qid } from './quorum';
import { toneColor, type CapSim, type Replica, type Status, type Tone } from './sim';
import css from './cap.module.css';

/** Rough width of monospace text (Plex Mono is ~0.6em per character). */
const monoW = (s: string, px: number) => s.length * px * 0.6;

export function Scene({ sim, focus, highlight }: { sim: CapSim; focus?: string[]; highlight: string | null }) {
  const view = sim.cfg.view;
  const dim = (id: string) => !!focus?.length && !focus.includes(id);
  const glow = (id: string) => highlight === id;
  if (view === 'spectrum') return null;
  if (view === 'quorum') {
    return (
      <>
        <Wires sim={sim} />
        <QuorumLayer sim={sim} dim={dim} glow={glow} />
        <Flights sim={sim} />
        <Effects sim={sim} />
      </>
    );
  }
  return (
    <>
      <Wires sim={sim} />
      {sim.cfg.rtt && <RttLabels sim={sim} />}
      <CutLayer sim={sim} />
      {NODES.map((id) => (
        <ReplicaCard key={id} sim={sim} id={id} dim={dim(id)} glow={glow(id)} />
      ))}
      {(['alice', 'bob', 'carol'] as ClientId[]).map((id) => {
        const b = sim.boxes.get(id);
        if (!b || Number.isNaN(b.x)) return null;
        const C = sim.clients[id];
        const said = view === 'feed' ? sim.feed.said[id] : C.result;
        return (
          <PersonCard
            key={id}
            box={b}
            name={PEOPLE[id].name}
            color={PEOPLE[id].color}
            text={said?.text ?? `near ${REGION[PEOPLE[id].home].city}`}
            tone={said?.tone}
            pulse={clamp((sim.vt - C.pulseVt) / 0.8, 0, 1)}
            pulseTone={C.pulseTone}
            dim={dim(id)}
            glow={glow(id)}
            small={sim.orient === 'portrait'}
          />
        );
      })}
      <Flights sim={sim} />
      <Effects sim={sim} />
    </>
  );
}

/* ------------------------------------------------------------------ */

export function StatusPill({ x, y, status, opacity = 1 }: { x: number; y: number; status: Status; opacity?: number }) {
  const w = monoW(status.text, 9.5) + 18;
  const c = status.tone === 'info' ? SIG.text2 : toneColor(status.tone);
  return (
    <g transform={`translate(${x},${y})`} opacity={opacity}>
      <rect x={-w / 2} y={-8.5} width={w} height={17} rx={8.5} fill="rgba(7,11,20,0.94)" stroke={c} strokeOpacity={0.55} />
      <text className={css.status} x={0} y={3.4} textAnchor="middle" fill={c}>
        {status.text}
      </text>
    </g>
  );
}

function ReplicaCard({ sim, id, dim, glow }: { sim: CapSim; id: NodeId; dim: boolean; glow: boolean }) {
  const b = sim.boxes.get(id);
  if (!b || Number.isNaN(b.x)) return null;
  const R = sim.replicas[id];
  const portrait = sim.orient === 'portrait';
  const feed = sim.cfg.view === 'feed';
  const status = feed ? sim.feed.statusFor(id) : sim.statusFor(id);
  const flashAt = feed ? sim.feed.flash[id] : R.flashVt;
  const flashK = clamp(1 - (sim.vt - flashAt) / 0.9, 0, 1);
  const flashC = feed ? SIG.req : toneColor(R.flashTone);
  const headH = portrait ? 23 : 26;
  const role = sim.cfg.auto === 'raft' ? sim.raft.nodes[id].role : null;
  const border = R.pending ? SIG.warn : role === 'leader' ? SIG.res : R.siblings.length ? SIG.heavy : undefined;
  const alpha = b.alpha * (dim ? 0.28 : 1);
  return (
    <g>
      <g className={css.node} transform={`translate(${b.x - b.w / 2},${b.y - b.h / 2})`} opacity={alpha}>
        {glow && <rect x={-6} y={-6} width={b.w + 12} height={b.h + 12} rx={14} fill="none" stroke="var(--accent)" strokeWidth={1.4} strokeDasharray="3 3" />}
        {flashK > 0.01 && <rect x={-3} y={-3} width={b.w + 6} height={b.h + 6} rx={12} fill="none" stroke={flashC} strokeWidth={2.4} opacity={flashK * 0.85} />}
        <rect className={css.card} width={b.w} height={b.h} rx={10} style={border ? { stroke: border, strokeWidth: 1.5 } : undefined} />
        <line className={css.rule} x1={0} x2={b.w} y1={headH} y2={headH} />
        <circle cx={12} cy={headH / 2} r={3.2} fill={SIG.res} />
        <text className={css.city} x={21} y={headH / 2 + 4.3} style={portrait ? { fontSize: 11.5 } : undefined}>
          {REGION[id].city}
        </text>
        {!portrait && (
          <text className={css.code} x={b.w - 10} y={headH / 2 + 3.4} textAnchor="end">
            {REGION[id].code}
          </text>
        )}
        {role === 'leader' && portrait && (
          <text className={css.code} x={b.w - 10} y={headH / 2 + 3.4} textAnchor="end" style={{ fill: SIG.res }}>
            ★
          </text>
        )}
        {feed ? <FeedBody sim={sim} id={id} top={headH} portrait={portrait} /> : <ValueBody sim={sim} R={R} box={b} top={headH} portrait={portrait} />}
      </g>
      {status && <StatusPill x={b.x} y={b.y + b.h / 2 + 14} status={status} opacity={alpha} />}
    </g>
  );
}

function ValueBody({ sim, R, box, top, portrait }: { sim: CapSim; R: Replica; box: Box; top: number; portrait: boolean }) {
  const w = box.w;
  const h = box.h;
  if (R.siblings.length) {
    return (
      <g>
        <text className={css.caps} x={12} y={top + 14}>
          seats_left · {R.siblings.length} versions
        </text>
        {R.siblings.slice(0, 2).map((s, i) => (
          <text key={s.id} className={css.valueSm} x={12} y={top + 31 + i * 15} fill={SIG.heavy}>
            {`${s.seats} left · v${s.ver} · ${s.by ?? 'init'}`}
          </text>
        ))}
      </g>
    );
  }
  const v = R.val;
  const valueSize = portrait ? 19 : 22;
  const valueW = monoW(String(v.seats), valueSize);
  const pill = `v${v.ver}`;
  const pw = monoW(pill, 10) + 14;
  const meta = !v.by ? 'initial' : sim.cfg.showTs ? `${v.by} @ ${fmtClock(v.ts, !portrait)}` : `by ${v.by}`;
  return (
    <g>
      <text className={css.caps} x={12} y={top + 14}>
        seats_left
      </text>
      <text className={css.value} x={12} y={h - 12} style={portrait ? { fontSize: valueSize } : undefined}>
        {v.seats}
      </text>
      {R.pending && (
        <text className={css.valueSm} x={12 + valueW + 7} y={h - 14} fill={SIG.warn}>
          → {R.pending.seats}?
        </text>
      )}
      <g transform={`translate(${w - 10 - pw},${top + 6})`}>
        <rect width={pw} height={16} rx={8} fill="rgba(143,166,201,0.08)" stroke="rgba(143,166,201,0.4)" />
        <text className={css.pillText} x={pw / 2} y={11.4} textAnchor="middle" fill="var(--text-1)">
          {pill}
        </text>
      </g>
      {R.pending && !portrait && (
        <g transform={`translate(${w - 10 - pw - 6 - (monoW(`v${R.pending.ver}?`, 10) + 14)},${top + 6})`}>
          <rect width={monoW(`v${R.pending.ver}?`, 10) + 14} height={16} rx={8} fill="rgba(255,210,63,0.08)" stroke={SIG.warn} strokeDasharray="3 2" />
          <text className={css.pillText} x={(monoW(`v${R.pending.ver}?`, 10) + 14) / 2} y={11.4} textAnchor="middle" fill={SIG.warn}>
            {`v${R.pending.ver}?`}
          </text>
        </g>
      )}
      <text className={css.meta} x={w - 10} y={h - 13} textAnchor="end">
        {meta}
      </text>
    </g>
  );
}

function FeedBody({ sim, id, top, portrait }: { sim: CapSim; id: NodeId; top: number; portrait: boolean }) {
  const items = sim.feed.items[id];
  const held = sim.feed.held[id];
  const has = (pid: string) => items.some((p) => p.id === pid);
  const rows: { key: string; text: string; color: string; held?: boolean }[] = [];
  for (const p of [POST_A, POST_B]) {
    const who = p.id === 'A' ? PEOPLE.alice.color : PEOPLE.bob.color;
    const text = p.id === 'A' ? (portrait ? 'A Alice: Got 14C!' : 'A · Alice: Got seat 14C!') : portrait ? 'B ↳ Bob: Congrats!' : 'B ↳ Bob: Congrats!';
    if (has(p.id)) rows.push({ key: p.id, text, color: who });
    else if (held.some((h) => h.id === p.id)) rows.push({ key: p.id, text: portrait ? 'B held: needs A' : 'B held until A arrives', color: SIG.warn, held: true });
  }
  if (!rows.length)
    return (
      <text className={css.feedRow} x={12} y={top + 25} fill="var(--text-3)">
        (no posts yet)
      </text>
    );
  const orphan = has('B') && !has('A');
  return (
    <g>
      {rows.map((r, i) => (
        <g key={r.key} transform={`translate(10,${top + 8 + i * 20})`}>
          {r.held && <rect x={-3} y={-1} width={portrait ? 112 : 150} height={16} rx={4} fill="none" stroke={SIG.warn} strokeDasharray="3 2" opacity={0.7} />}
          <circle cx={3} cy={7} r={2.6} fill={r.color} />
          <text className={css.feedRow} x={10} y={10.5} fill={orphan && r.key === 'B' ? SIG.err : r.held ? SIG.warn : 'var(--text-1)'}>
            {r.text}
          </text>
        </g>
      ))}
    </g>
  );
}

/* ------------------------------------------------------------------ */

function PersonCard({
  box,
  name,
  color,
  text,
  tone,
  pulse,
  pulseTone,
  dim,
  glow,
  small,
}: {
  box: Box;
  name: string;
  color: string;
  text: string;
  tone?: Tone;
  pulse: number;
  pulseTone: Tone;
  dim: boolean;
  glow: boolean;
  small?: boolean;
}) {
  const ar = 10;
  const ax = 19;
  const tx = ax + ar + 8;
  const c = tone ? (tone === 'info' ? SIG.text2 : toneColor(tone)) : undefined;
  return (
    <g className={css.node} transform={`translate(${box.x - box.w / 2},${box.y - box.h / 2})`} opacity={box.alpha * (dim ? 0.28 : 1)}>
      {glow && <rect x={-6} y={-6} width={box.w + 12} height={box.h + 12} rx={13} fill="none" stroke="var(--accent)" strokeWidth={1.4} strokeDasharray="3 3" />}
      <rect className={css.card} width={box.w} height={box.h} rx={9} style={pulse < 1 && tone ? { stroke: c, strokeOpacity: 0.4 + 0.6 * (1 - pulse) } : undefined} />
      <circle cx={ax} cy={box.h / 2} r={ar} fill={color} fillOpacity={0.14} stroke={color} strokeWidth={1.2} />
      <text className={css.avatar} x={ax} y={box.h / 2 + 4} textAnchor="middle" fill={color}>
        {name[0]}
      </text>
      {pulse < 1 && <circle cx={ax} cy={box.h / 2} r={ar + pulse * 12} fill="none" stroke={toneColor(pulseTone)} strokeWidth={2.2 * (1 - pulse)} opacity={1 - pulse} />}
      <text className={css.name} x={tx} y={box.h / 2 - 2}>
        {name}
      </text>
      <text className={css.meta} x={tx} y={box.h / 2 + 11} style={{ fill: c, fontSize: small ? 9 : undefined }}>
        {text}
      </text>
    </g>
  );
}

/* ------------------------------------------------------------------ */

function RttLabels({ sim }: { sim: CapSim }) {
  const portrait = sim.orient === 'portrait';
  const spots: [NodeId, NodeId, number, number][] = [
    ['va', 'fra', 0.5, -9],
    ['va', 'sg', 0.5, -9],
    ['fra', 'sg', portrait ? 0.5 : 0.3, portrait ? -8 : -9],
  ];
  return (
    <g>
      {spots.map(([a, b, t, dy]) => {
        const m = sim.linkPoint(a, b, t);
        if (!m) return null;
        return (
          <text key={`${a}${b}`} className={css.rtt} x={m.x} y={m.y + dy} textAnchor="middle">
            {RTT_MS[pairKey(a, b)]} ms
          </text>
        );
      })}
    </g>
  );
}

/** The partition: a jagged red cut through the severed links, with scissors. */
function CutLayer({ sim }: { sim: CapSim }) {
  if (!sim.cut) return null;
  const L = sim.cutLine();
  if (!L) return null;
  const k = clamp((sim.vt - sim.cutVt) / 0.5, 0, 1);
  const dx = L.b.x - L.a.x;
  const dy = L.b.y - L.a.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy;
  const ny = ux;
  const teeth = Math.max(6, Math.round(len / 13));
  const pts: string[] = [];
  for (let i = 0; i <= teeth; i++) {
    const t = i / teeth;
    const off = i === 0 || i === teeth ? 0 : i % 2 ? 5 : -5;
    pts.push(`${(L.a.x + dx * t + nx * off).toFixed(1)},${(L.a.y + dy * t + ny * off).toFixed(1)}`);
  }
  const d = `M${pts.join(' L')}`;
  const deg = (Math.atan2(dy, dx) * 180) / Math.PI;
  const portrait = sim.orient === 'portrait';
  const va = sim.boxes.get('va');
  // Which side of the line is Virginia on?
  const sideSign = va ? Math.sign((va.x - L.a.x) * nx + (va.y - L.a.y) * ny) || 1 : 1;
  // Side labels: on phones at the right end, one above and one below the line;
  // on wide screens at the bottom end, one to each side.
  const vaLeft = va ? va.x < L.a.x + (dx * (va.y - L.a.y)) / (dy || 1) : true;
  const vaAbove = va ? va.y < L.a.y : true;
  const minority = portrait
    ? { x: sim.w - 16, y: L.b.y + (vaAbove ? -11 : 19), anchor: 'end' as const }
    : { x: L.b.x + (vaLeft ? -14 : 14), y: L.b.y - 2, anchor: vaLeft ? ('end' as const) : ('start' as const) };
  const majority = portrait
    ? { x: sim.w - 16, y: L.b.y + (vaAbove ? 19 : -11), anchor: 'end' as const }
    : { x: L.b.x + (vaLeft ? 14 : -14), y: L.b.y - 2, anchor: vaLeft ? ('start' as const) : ('end' as const) };
  return (
    <g>
      <path d={d} fill="none" stroke={SIG.err} strokeWidth={7} opacity={0.12 * k} strokeLinejoin="round" />
      <path d={d} fill="none" stroke={SIG.err} strokeWidth={1.8} strokeLinejoin="round" pathLength={1} strokeDasharray="1" strokeDashoffset={1 - k} />
      <g transform={`translate(${L.a.x},${L.a.y}) rotate(${deg})`} opacity={k}>
        <g transform="translate(-4,0)">
          <circle cx={-8} cy={-4.2} r={3.3} fill="var(--ink-1)" stroke={SIG.err} strokeWidth={1.4} />
          <circle cx={-8} cy={4.2} r={3.3} fill="var(--ink-1)" stroke={SIG.err} strokeWidth={1.4} />
          <path d="M-5.2,-2.4 L9,3.4 M-5.2,2.4 L9,-3.4" stroke={SIG.err} strokeWidth={1.7} strokeLinecap="round" />
        </g>
      </g>
      <text
        className={css.cutLabel}
        x={portrait ? L.a.x + 18 : L.a.x + nx * 16 * -sideSign}
        y={portrait ? L.a.y - 11 : L.a.y + ny * 16 * -sideSign - 4}
        opacity={k}
      >
        partition
      </text>
      {sim.cfg.sides && (
        <g opacity={k}>
          <text className={css.sideLabel} x={minority.x} y={minority.y} textAnchor={minority.anchor} fill={SIG.err}>
            {portrait ? 'minority 1/3' : 'minority · 1 of 3'}
          </text>
          <text className={css.sideLabel} x={majority.x} y={majority.y} textAnchor={majority.anchor} fill={SIG.res}>
            {portrait ? 'majority 2/3' : 'majority · 2 of 3'}
          </text>
        </g>
      )}
    </g>
  );
}

/* ------------------------------------------------------------------ */

function QuorumLayer({ sim, dim, glow }: { sim: CapSim; dim: (id: string) => boolean; glow: (id: string) => boolean }) {
  const q = sim.quorum;
  const n = q.n;
  const portrait = sim.orient === 'portrait';
  const boxes = Array.from({ length: n }, (_, i) => sim.boxes.get(qid(i))).filter((b): b is Box => !!b && !Number.isNaN(b.x));
  if (boxes.length < n) return null;
  const newest = Math.max(...q.vers.slice(0, n));
  const x0 = (i: number) => boxes[i].x - boxes[i].w / 2;
  const x1 = (i: number) => boxes[i].x + boxes[i].w / 2;
  const top = boxes[0].y - boxes[0].h / 2;
  const bottom = boxes[0].y + boxes[0].h / 2;
  const acked = [...q.acked];
  const overlap = q.lastRead ? q.overlap : [];
  const a = sim.boxes.get('qa');
  const bb = sim.boxes.get('qb');
  return (
    <g>
      {boxes.map((b, i) => {
        const ver = q.vers[i];
        const fresh = ver === newest && newest > 7;
        const flashK = clamp(1 - (sim.vt - q.flash[i]) / 0.9, 0, 1);
        const id = qid(i);
        return (
          <g key={id} className={css.node} transform={`translate(${b.x - b.w / 2},${b.y - b.h / 2})`} opacity={b.alpha * (dim(id) ? 0.28 : 1)}>
            {glow(id) && <rect x={-6} y={-6} width={b.w + 12} height={b.h + 12} rx={13} fill="none" stroke="var(--accent)" strokeWidth={1.4} strokeDasharray="3 3" />}
            {overlap.includes(i) && <rect x={-7} y={-7} width={b.w + 14} height={b.h + 14} rx={14} fill="rgba(255,210,63,0.06)" stroke={SIG.warn} strokeWidth={1.6} strokeDasharray="4 3" />}
            {flashK > 0.01 && <rect x={-3} y={-3} width={b.w + 6} height={b.h + 6} rx={11} fill="none" stroke={SIG.req} strokeWidth={2.2} opacity={flashK * 0.8} />}
            <rect className={css.card} width={b.w} height={b.h} rx={9} />
            <text className={css.caps} x={portrait ? 8 : 10} y={16}>
              {`r${i + 1}`}
            </text>
            <circle cx={b.w - 10} cy={12} r={3} fill={SIG.res} />
            <text className={css.value} x={b.w / 2} y={b.h - 13} textAnchor="middle" style={{ fontSize: portrait ? 16 : 20, fill: fresh ? SIG.res : 'var(--text-2)' }}>
              {`v${ver}`}
            </text>
          </g>
        );
      })}

      {acked.length > 0 && (
        <g>
          <path
            d={`M${x0(Math.min(...acked))},${top - 9} V${top - 16} H${x1(Math.max(...acked))} V${top - 9}`}
            fill="none"
            stroke={SIG.res}
            strokeWidth={1.6}
          />
          <text className={css.bracketLabel} x={x0(Math.min(...acked))} y={top - 23} fill={SIG.res}>
            {`write set · ${acked.length} of W=${q.w} acked`}
          </text>
        </g>
      )}
      {q.readSet.length > 0 && (
        <g>
          <path
            d={`M${x0(Math.min(...q.readSet))},${bottom + 9} V${bottom + 16} H${x1(Math.max(...q.readSet))} V${bottom + 9}`}
            fill="none"
            stroke={SIG.req}
            strokeWidth={1.6}
          />
          <text className={css.bracketLabel} x={x1(Math.max(...q.readSet))} y={bottom + 31} textAnchor="end" fill={SIG.req}>
            {`read set · R=${q.r}`}
          </text>
        </g>
      )}
      {a && <PersonCard box={a} name="Alice" color={PEOPLE.alice.color} text={q.alice?.text ?? 'writes'} tone={q.alice?.tone} pulse={1} pulseTone="ok" dim={dim('qa')} glow={glow('qa')} />}
      {bb && <PersonCard box={bb} name="Bob" color={PEOPLE.bob.color} text={q.bob?.text ?? 'reads'} tone={q.bob?.tone} pulse={1} pulseTone="ok" dim={dim('qb')} glow={glow('qb')} />}
    </g>
  );
}

