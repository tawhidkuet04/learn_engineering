'use client';

import { Cylinder, Effects, Flights, NodeCard, Wires } from '@/components/stage/svg';
import stage from '@/components/stage/stage.module.css';
import { SIG } from '@/lib/sim/colors';
import { clamp } from '@/lib/sim/geometry';
import type { Box } from '@/lib/sim/Sim';
import { arcD, curlShape, easeInOut, easeOut, polar, shortest } from './geom';
import { TWO32, commas } from './hash';
import { SERVERS, hrwScore, keyString, ownership } from './ring';
import type { RingSim } from './sim';
import css from './ch.module.css';

const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(' ');
const NEUTRAL = '#6F7D97';
const fx = (n: number) => n.toFixed(1);

export interface SceneProps {
  sim: RingSim;
  highlight: string | null;
}

export function Scene({ sim, highlight }: SceneProps) {
  switch (sim.cfg.view) {
    case 'buckets':
      return <BucketsScene sim={sim} highlight={highlight} />;
    case 'line':
      return <LineScene sim={sim} highlight={highlight} />;
    case 'hrw':
      return <HrwScene sim={sim} highlight={highlight} />;
    default:
      return <RingScene sim={sim} highlight={highlight} />;
  }
}

/* ================================================================== */
/* The ring                                                            */
/* ================================================================== */

interface Cache {
  key: string;
  base: { ticks: string; major: string };
  arcs: { sid: string; band: string; line: string }[];
  tokens: { sid: string; d: string; dots: { x: number; y: number; i: number }[] }[];
}
let cache: Cache | null = null;

/** Paths that only change with the token list or the stage size. */
function staticPaths(sim: RingSim): Cache {
  const g = sim.geo;
  const key = `${sim.ringVer}|${g.cx}|${g.cy}|${g.R}|${sim.cfg.tokens}`;
  if (cache && cache.key === key) return cache;
  let ticks = '';
  let major = '';
  for (let i = 0; i < 64; i++) {
    const f = i / 64;
    const isMajor = i % 16 === 0;
    const a = polar(g.cx, g.cy, g.R + 1, f);
    const b = polar(g.cx, g.cy, g.R + (isMajor ? 9 : i % 4 === 0 ? 6 : 3.5), f);
    const seg = `M${fx(a.x)},${fx(a.y)} L${fx(b.x)},${fx(b.y)} `;
    if (isMajor) major += seg;
    else ticks += seg;
  }
  const bySid = new Map<string, { band: string; line: string }>();
  for (const iv of ownership(sim.ring)) {
    const cur = bySid.get(iv.sid) ?? { band: '', line: '' };
    cur.band += `${arcD(g.cx, g.cy, g.bandR, iv.a, iv.b)} `;
    cur.line += `${arcD(g.cx, g.cy, g.R, iv.a, iv.b)} `;
    bySid.set(iv.sid, cur);
  }
  const perServer = new Map<string, { d: string; dots: { x: number; y: number; i: number }[] }>();
  const dense = sim.ring.length / Math.max(1, sim.presentList().length) > 16;
  for (const t of sim.ring) {
    const cur = perServer.get(t.sid) ?? { d: '', dots: [] };
    const f = t.h / TWO32;
    if (dense) {
      const a = polar(g.cx, g.cy, g.R - (g.small ? 4 : 5), f);
      const b = polar(g.cx, g.cy, g.R + (g.small ? 4 : 5), f);
      cur.d += `M${fx(a.x)},${fx(a.y)} L${fx(b.x)},${fx(b.y)} `;
    } else {
      const p = polar(g.cx, g.cy, g.R, f);
      cur.dots.push({ x: p.x, y: p.y, i: t.i });
    }
    perServer.set(t.sid, cur);
  }
  cache = {
    key,
    base: { ticks, major },
    arcs: [...bySid.entries()].map(([sid, v]) => ({ sid, ...v })),
    tokens: [...perServer.entries()].map(([sid, v]) => ({ sid, ...v })),
  };
  return cache;
}

function RingScene({ sim, highlight }: SceneProps) {
  const paths = staticPaths(sim);
  const c = sim.cfg;
  const hl = highlight ?? '';
  const hlSid = hl.startsWith('srv:') ? hl.slice(4) : hl.startsWith('arc:') ? hl.slice(4) : null;
  const pending = sim.game?.pending;
  const stageClick = !!pending && !pending.choices;

  return (
    <g>
      <RingBase sim={sim} ticks={paths.base.ticks} major={paths.base.major} glow={hl === 'ring'} />
      {c.arcs && <Arcs sim={sim} arcs={paths.arcs} hlSid={hlSid} />}
      {c.lines && <Chords sim={sim} hl={hl} />}
      <Tokens sim={sim} tokens={paths.tokens} hlSid={hlSid} />
      <Leaders sim={sim} />
      <Keys sim={sim} hl={hl} />
      <PrefLayer sim={sim} />
      <Walkers sim={sim} />
      <Markers sim={sim} hlSid={hl.startsWith('srv:') ? hl.slice(4) : null} stageClick={stageClick} />
      <CenterCard sim={sim} glow={hl === 'center'} />
      <Flights sim={sim} />
      <Effects sim={sim} />
    </g>
  );
}

function RingBase({ sim, ticks, major, glow }: { sim: RingSim; ticks: string; major: string; glow: boolean }) {
  const g = sim.geo;
  const labels = ['0', '1.07B', '2.15B', '3.22B'];
  // Inside the replica badges (drawn at R - 33) so the two never collide.
  const inner = g.keyR - (g.small ? 29 : 34);
  const arrowR = inner - (g.small ? 2 : 4);
  const a0 = polar(g.cx, g.cy, arrowR, 0.018);
  const a1 = polar(g.cx, g.cy, arrowR, 0.058);
  const tip = polar(g.cx, g.cy, arrowR, 0.064);
  const ang = Math.atan2(tip.y - a1.y, tip.x - a1.x);
  return (
    <g>
      <circle cx={g.cx} cy={g.cy} r={g.R} className={css.ringLine} />
      {glow && <circle cx={g.cx} cy={g.cy} r={g.R + 14} fill="none" stroke="var(--accent)" strokeWidth={1.3} strokeDasharray="3 4" />}
      <path d={ticks} className={css.tick} />
      <path d={major} className={css.tickMajor} />
      {labels.map((t, i) => {
        // Make way for a key's name tag when one sits near this quarter mark.
        if (sim.taggedKeyFs().some((f) => Math.abs(shortest(f, i / 4)) < 0.075)) return null;
        const p = polar(g.cx, g.cy, inner, i / 4);
        return (
          <text key={t} x={p.x} y={p.y + 3.5} textAnchor="middle" className={css.ringLabel} style={g.small ? { fontSize: 8.5 } : undefined}>
            {t}
          </text>
        );
      })}
      <path d={`M${fx(a0.x)},${fx(a0.y)} A${arrowR},${arrowR} 0 0 1 ${fx(a1.x)},${fx(a1.y)}`} className={css.cwArrow} />
      <path
        d={`M${fx(tip.x)},${fx(tip.y)} L${fx(tip.x - 5 * Math.cos(ang - 0.5))},${fx(tip.y - 5 * Math.sin(ang - 0.5))} M${fx(tip.x)},${fx(tip.y)} L${fx(tip.x - 5 * Math.cos(ang + 0.5))},${fx(tip.y - 5 * Math.sin(ang + 0.5))}`}
        className={css.cwArrow}
      />
    </g>
  );
}

function Arcs({ sim, arcs, hlSid }: { sim: RingSim; arcs: Cache['arcs']; hlSid: string | null }) {
  const g = sim.geo;
  const sw = sim.sweep;
  const k = sw ? clamp((sim.vt - sw.vt) / 0.9, 0, 1) : 1;
  let cover: { band: string; line: string; sid: string }[] = [];
  let erase = '';
  if (sw && k < 1) {
    const e = easeInOut(k);
    const by = new Map<string, { band: string; line: string }>();
    for (const ch of sw.changes) {
      const a = ch.a + (ch.b - ch.a) * e;
      if (ch.b - a < 1e-6) continue;
      erase += `${arcD(g.cx, g.cy, g.bandR, a, ch.b)} `;
      if (!ch.from) continue;
      const cur = by.get(ch.from) ?? { band: '', line: '' };
      cur.band += `${arcD(g.cx, g.cy, g.bandR, a, ch.b)} `;
      cur.line += `${arcD(g.cx, g.cy, g.R, a, ch.b)} `;
      by.set(ch.from, cur);
    }
    cover = [...by.entries()].map(([sid, v]) => ({ sid, ...v }));
  }
  return (
    <g>
      {arcs.map((a) => {
        const color = SERVERS[a.sid].color;
        const on = hlSid === a.sid;
        const down = !sim.srv.get(a.sid)?.up;
        return (
          <g key={a.sid}>
            <path d={a.band} fill="none" stroke={color} strokeWidth={g.bandW} opacity={down ? 0.12 : on ? 0.55 : 0.26} />
            <path d={a.line} fill="none" stroke={down ? SIG.err : color} strokeWidth={on ? 2.6 : 1.8} opacity={down ? 0.5 : 0.9} strokeDasharray={down ? '4 4' : undefined} />
          </g>
        );
      })}
      {erase && <path d={erase} fill="none" stroke="var(--ink-1)" strokeWidth={g.bandW + 1} />}
      {cover.map((c0) => (
        <g key={`cover-${c0.sid}`}>
          <path d={c0.band} fill="none" stroke={SERVERS[c0.sid].color} strokeWidth={g.bandW} opacity={0.26} />
          <path d={c0.line} fill="none" stroke={SERVERS[c0.sid].color} strokeWidth={1.8} opacity={0.9} />
        </g>
      ))}
    </g>
  );
}

function chordD(sim: RingSim, fKey: number, fTok: number, rKey: number) {
  const g = sim.geo;
  const a = polar(g.cx, g.cy, rKey, fKey);
  const b = polar(g.cx, g.cy, g.R - 3, fTok);
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  // Long chords bow toward the center; short ones stay nearly straight.
  const pull = 0.22 * clamp(Math.hypot(b.x - a.x, b.y - a.y) / g.R, 0, 1);
  const q = { x: mx + (g.cx - mx) * pull, y: my + (g.cy - my) * pull };
  return `M${fx(a.x)},${fx(a.y)} Q${fx(q.x)},${fx(q.y)} ${fx(b.x)},${fx(b.y)}`;
}

function Chords({ sim, hl }: { sim: RingSim; hl: string }) {
  const g = sim.geo;
  const sel = sim.pref?.key ?? null;
  return (
    <g>
      {sim.keys.map((k) => {
        if (!k.placed || k.asking || !k.owner || k.lost) return null;
        if (sel === k.name && sim.cfg.replicas > 1) return null;
        const color = SERVERS[k.owner].color;
        const on = hl === `key:${k.name}` || sel === k.name;
        const moving = sim.vt - k.moveVt < 0.9;
        return (
          <path
            key={k.name}
            d={chordD(sim, k.f, sim.endpointF(k), g.keyR)}
            fill="none"
            stroke={color}
            strokeWidth={on ? 1.8 : moving ? 1.5 : g.small ? 0.9 : 1}
            opacity={on ? 0.95 : moving ? 0.9 : 0.5}
          />
        );
      })}
    </g>
  );
}

function Tokens({ sim, tokens, hlSid }: { sim: RingSim; tokens: Cache['tokens']; hlSid: string | null }) {
  const g = sim.geo;
  return (
    <g>
      {tokens.map((t) => {
        const s = sim.srv.get(t.sid);
        const color = s?.up ? SERVERS[t.sid].color : SIG.err;
        const born = s ? clamp((sim.vt - s.bornVt) / 0.5, 0, 1) : 1;
        const on = hlSid === t.sid;
        return (
          <g key={t.sid} opacity={s?.up ? 1 : 0.8}>
            {t.d && <path d={t.d} stroke={color} strokeWidth={on ? 2.2 : 1.4} opacity={0.95} />}
            {t.dots.map((d) => (
              <circle
                key={d.i}
                cx={d.x}
                cy={d.y}
                r={(d.i === 0 ? (g.small ? 3.8 : 4.6) : g.small ? 2.8 : 3.4) * (0.4 + 0.6 * easeOut(born)) * (on ? 1.25 : 1)}
                fill={s?.up ? color : 'var(--ink-1)'}
                stroke={s?.up ? 'var(--ink-1)' : SIG.err}
                strokeWidth={1.4}
              />
            ))}
          </g>
        );
      })}
    </g>
  );
}

/** Thin line from a server's first token to its label. */
function Leaders({ sim }: { sim: RingSim }) {
  const g = sim.geo;
  return (
    <g>
      {[...sim.srv.values()].map((s) => {
        const b = sim.boxes.get(`srv:${s.id}`);
        if (!b || Number.isNaN(b.x) || !(s.present || s.ghost)) return null;
        const f = sim.tokenF0(s.id);
        const p = polar(g.cx, g.cy, g.R + 2, f);
        const ghost = !s.present;
        return (
          <line
            key={s.id}
            x1={p.x}
            y1={p.y}
            x2={b.x}
            y2={b.y}
            stroke={ghost ? SIG.dim : SERVERS[s.id].color}
            strokeWidth={1}
            strokeDasharray={ghost ? '2 3' : undefined}
            opacity={b.alpha * (ghost ? 0.6 : 0.5)}
          />
        );
      })}
      {[...sim.srv.values()].map((s) => {
        if (s.present || !s.ghost) return null;
        const f = sim.tokenF0(s.id);
        const p = polar(g.cx, g.cy, g.R, f);
        return <circle key={`gh-${s.id}`} cx={p.x} cy={p.y} r={g.small ? 3.4 : 4.2} fill="var(--ink-1)" stroke={s.ghost === 'joining' ? SERVERS[s.id].color : SIG.dim} strokeDasharray="2 2" strokeWidth={1.3} />;
      })}
    </g>
  );
}

function Keys({ sim, hl }: { sim: RingSim; hl: string }) {
  const g = sim.geo;
  const clickable = sim.cfg.selectKeys;
  const sel = sim.selected;
  const r0 = g.small ? 3 : 3.7;
  return (
    <g>
      {sim.keys.map((k) => {
        if (!k.placed) return null;
        const p = polar(g.cx, g.cy, g.keyR, k.f);
        const appear = easeOut(clamp((sim.vt - k.placedVt) / 0.4, 0, 1));
        const flash = clamp(1 - (sim.vt - k.flashVt) / 1.3, 0, 1);
        const on = hl === `key:${k.name}` || sel === k.name;
        const color = k.asking ? SIG.warn : k.lost ? SIG.err : k.owner ? SERVERS[k.owner].color : NEUTRAL;
        return (
          <g
            key={k.name}
            className={clickable ? css.keyHit : undefined}
            onClick={clickable ? () => sim.selectKey(k.name) : undefined}
            role={clickable ? 'button' : undefined}
            aria-label={clickable ? `Key ${k.label}` : undefined}
            opacity={appear}
          >
            {clickable && <circle cx={p.x} cy={p.y} r={g.small ? 9 : 11} fill="transparent" />}
            {flash > 0 && <circle cx={p.x} cy={p.y} r={r0 + 3 + (1 - flash) * 12} fill="none" stroke={SIG.warn} strokeWidth={2 * flash} opacity={flash} />}
            {flash > 0 && <circle cx={p.x} cy={p.y} r={r0 + 2.5} fill={SIG.warn} opacity={0.35 * flash} />}
            {k.asking && <AskPulse x={p.x} y={p.y} r={r0} vt={sim.vt} />}
            {on && <circle cx={p.x} cy={p.y} r={r0 + 4.5} fill="none" stroke="var(--accent)" strokeWidth={1.3} strokeDasharray="2.5 2.5" />}
            <circle cx={p.x} cy={p.y} r={(k.asking ? r0 + 1.4 : on ? r0 + 0.8 : r0) * (0.3 + 0.7 * appear)} fill={color} stroke="var(--ink-1)" strokeWidth={1.2} />
            {k.lost && <LostMark x={p.x} y={p.y} />}
            <title>{k.label}</title>
          </g>
        );
      })}
      <KeyLabels sim={sim} hl={hl} />
    </g>
  );
}

function AskPulse({ x, y, r, vt }: { x: number; y: number; r: number; vt: number }) {
  const k = (vt % 1.2) / 1.2;
  return <circle cx={x} cy={y} r={r + 3 + k * 10} fill="none" stroke={SIG.warn} strokeWidth={1.6 * (1 - k)} opacity={1 - k} />;
}

function LostMark({ x, y }: { x: number; y: number }) {
  return (
    <g stroke={SIG.err} strokeWidth={1.6} strokeLinecap="round">
      <line x1={x - 6} y1={y - 6} x2={x - 2.5} y2={y - 2.5} />
      <line x1={x + 6} y1={y - 6} x2={x + 2.5} y2={y - 2.5} />
      <line x1={x - 6} y1={y + 6} x2={x - 2.5} y2={y + 2.5} />
      <line x1={x + 6} y1={y + 6} x2={x + 2.5} y2={y + 2.5} />
    </g>
  );
}

/** Name tags for the keys the narration is about (asked, selected, hovered). */
function KeyLabels({ sim, hl }: { sim: RingSim; hl: string }) {
  const g = sim.geo;
  const names = new Set<string>();
  if (sim.asking?.kind === 'owner' && sim.asking.key) names.add(sim.asking.key);
  if (sim.selected) names.add(sim.selected);
  if (hl.startsWith('key:')) names.add(hl.slice(4));
  return (
    <g>
      {[...names].map((n) => {
        const k = sim.keyByName(n);
        if (!k || !k.placed) return null;
        const inset = g.small ? 30 : 38;
        const p = polar(g.cx, g.cy, g.keyR - inset, k.f);
        const color = k.asking ? SIG.warn : k.owner ? SERVERS[k.owner].color : SIG.text2;
        const text = k.label;
        const w = text.length * (g.small ? 5.6 : 6.3) + 14;
        const hLab = g.small ? 17 : 19;
        return (
          <g key={n} transform={`translate(${fx(p.x)},${fx(p.y)})`}>
            <rect x={-w / 2} y={-hLab / 2} width={w} height={hLab} rx={hLab / 2} fill="rgba(7,11,20,0.92)" stroke={color} strokeOpacity={0.75} />
            <text x={0} y={g.small ? 3.3 : 3.8} textAnchor="middle" className={css.keyLabel} style={{ fill: color, fontSize: g.small ? 9 : 10.5 }}>
              {text}
            </text>
          </g>
        );
      })}
    </g>
  );
}

/** Replica walk: badges 1, 2, 3 on the servers holding copies, skips crossed out. */
function PrefLayer({ sim }: { sim: RingSim }) {
  const pref = sim.pref;
  const k = sim.keyByName(pref?.key);
  if (!pref || !k) return null;
  const g = sim.geo;
  const prog = sim.prefProgress();
  const walked = pref.span * prog;
  const trail = arcD(g.cx, g.cy, g.keyR, k.f, k.f + Math.max(0.0005, walked));
  const head = polar(g.cx, g.cy, g.keyR, k.f + walked);
  const showRep = sim.cfg.replicas > 1;
  return (
    <g>
      {showRep &&
        pref.marks
          .filter((m) => m.n != null && m.d <= walked + 1e-9)
          .map((m) => (
            <path
              key={`c-${m.sid}-${m.tf}`}
              d={chordD(sim, k.f, m.tf, g.keyR)}
              fill="none"
              stroke={sim.srv.get(m.sid)?.up ? SERVERS[m.sid].color : SIG.err}
              strokeWidth={m.n === 1 ? 1.9 : 1.5}
              strokeDasharray={m.n === 1 ? undefined : '4 3'}
              opacity={0.95}
            />
          ))}
      {prog < 1 && <path d={trail} fill="none" stroke={SIG.warn} strokeWidth={2.2} strokeLinecap="round" opacity={0.75} />}
      {prog < 1 && <circle cx={head.x} cy={head.y} r={4.4} fill={SIG.warn} />}
      {pref.marks.map((m) => {
        if (m.d > walked + 1e-9) return null;
        const p = polar(g.cx, g.cy, g.R - (g.small ? 27 : 33), m.tf);
        if (m.n == null) {
          return (
            <g key={`s-${m.tf}`} opacity={0.8}>
              <circle cx={p.x} cy={p.y} r={g.small ? 6 : 7} fill="rgba(7,11,20,0.9)" stroke={SIG.dim} strokeDasharray="2 2" />
              <line x1={p.x - 3.5} y1={p.y + 3.5} x2={p.x + 3.5} y2={p.y - 3.5} stroke={SIG.text2} strokeWidth={1.3} />
            </g>
          );
        }
        const up = sim.srv.get(m.sid)?.up;
        return (
          <g key={`b-${m.tf}`}>
            <circle cx={p.x} cy={p.y} r={g.small ? 7.5 : 9} fill={up ? SERVERS[m.sid].color : 'var(--ink-1)'} stroke={up ? 'var(--ink-1)' : SIG.err} strokeWidth={1.5} />
            <text x={p.x} y={p.y + (g.small ? 3.2 : 3.8)} textAnchor="middle" className={css.badgeNum} style={{ fill: up ? '#0b1020' : SIG.err, fontSize: g.small ? 9.5 : 11 }}>
              {m.n}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function Walkers({ sim }: { sim: RingSim }) {
  const g = sim.geo;
  return (
    <g>
      {sim.walkers.map((w) => {
        const pos = sim.walkerPos(w);
        if (pos.inFlight != null) {
          const target = polar(g.cx, g.cy, g.keyR, w.f0);
          const t = easeInOut(pos.inFlight);
          const x = g.cx + (target.x - g.cx) * t;
          const y = g.cy + (target.y - g.cy) * t;
          return (
            <g key={w.id}>
              <circle cx={x} cy={y} r={9} fill={w.color} opacity={0.14} />
              <circle cx={x} cy={y} r={3.8} fill={w.color} />
            </g>
          );
        }
        const from = Math.max(w.f0, w.f0 + w.span * pos.p - 0.06);
        const to = w.f0 + w.span * pos.p;
        const head = polar(g.cx, g.cy, g.keyR, to);
        return (
          <g key={w.id}>
            {to - from > 0.001 && <path d={arcD(g.cx, g.cy, g.keyR, from, to)} fill="none" stroke={w.color} strokeWidth={w.kind === 'reveal' ? 3 : 2.2} strokeLinecap="round" opacity={0.55} />}
            <circle cx={head.x} cy={head.y} r={w.kind === 'reveal' ? 11 : 8} fill={w.color} opacity={0.15} />
            <circle cx={head.x} cy={head.y} r={w.kind === 'reveal' ? 4.8 : 3.8} fill={w.color} />
          </g>
        );
      })}
    </g>
  );
}

function Markers({ sim, hlSid, stageClick }: { sim: RingSim; hlSid: string | null; stageClick: boolean }) {
  // Preference-list numbers, shown on the server labels once the walk reaches them.
  const rank = new Map<string, number>();
  if (sim.pref && sim.cfg.replicas > 1) {
    const walked = sim.pref.span * sim.prefProgress();
    for (const m of sim.pref.marks) if (m.n != null && m.d <= walked + 1e-9) rank.set(m.sid, m.n);
  }
  return (
    <g>
      {[...sim.srv.values()].map((s) => {
        const b = sim.boxes.get(`srv:${s.id}`);
        if (!b || Number.isNaN(b.x)) return null;
        const clickable = sim.serverClickable(s.id);
        const n = rank.get(s.id);
        return (
          <g key={s.id}>
            <Marker
              box={b}
              sid={s.id}
              small={sim.geo.small}
              state={!s.present ? (s.ghost === 'joining' ? 'joining' : 'ghost') : s.up ? 'up' : 'down'}
              glow={hlSid === s.id}
              pickable={stageClick && s.present}
              onClick={clickable ? () => sim.clickServer(s.id) : undefined}
            />
            {n != null && (
              <g transform={`translate(${fx(b.x + b.w / 2 - 2)},${fx(b.y - b.h / 2 + 1)})`} pointerEvents="none">
                <circle r={7.5} fill={s.up ? SERVERS[s.id].color : 'var(--ink-1)'} stroke={s.up ? 'var(--ink-1)' : SIG.err} strokeWidth={1.5} />
                <text y={3.4} textAnchor="middle" className={css.badgeNum} style={{ fill: s.up ? '#0b1020' : SIG.err, fontSize: 9.5 }}>
                  {n}
                </text>
              </g>
            )}
          </g>
        );
      })}
    </g>
  );
}

function Marker({
  box,
  sid,
  small,
  state,
  glow,
  pickable,
  onClick,
}: {
  box: Box;
  sid: string;
  small: boolean;
  state: 'up' | 'down' | 'ghost' | 'joining';
  glow: boolean;
  pickable: boolean;
  onClick?: () => void;
}) {
  const def = SERVERS[sid];
  const color = state === 'down' ? SIG.err : def.color;
  const ghost = state === 'ghost' || state === 'joining';
  const x0 = box.x - box.w / 2;
  const y0 = box.y - box.h / 2;
  const opacity = box.alpha * (state === 'ghost' ? 0.55 : 1);
  const r = box.h / 2;
  const caption = state === 'down' ? 'down' : state === 'joining' ? 'joining' : state === 'ghost' ? 'removed' : null;
  return (
    <g
      className={cx(stage.node, onClick && stage.clickable, pickable && stage.pickable)}
      transform={`translate(${fx(x0)},${fx(y0)})`}
      opacity={opacity}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      aria-label={onClick ? def.name : undefined}
    >
      {onClick && <rect x={-7} y={-7} width={box.w + 14} height={box.h + 14} fill="transparent" />}
      {glow && <rect x={-5} y={-5} width={box.w + 10} height={box.h + 10} rx={r + 5} fill="none" stroke="var(--accent)" strokeWidth={1.4} strokeDasharray="3 3" />}
      <rect
        className={stage.card}
        width={box.w}
        height={box.h}
        rx={r}
        style={pickable ? undefined : { stroke: color, strokeDasharray: ghost ? '3 3' : undefined, strokeOpacity: ghost ? 0.8 : 0.9 }}
      />
      {state === 'down' && <rect width={box.w} height={box.h} rx={r} fill="url(#kit-hatch)" pointerEvents="none" />}
      {small ? (
        <text x={box.w / 2} y={box.h / 2 + 4} textAnchor="middle" className={css.markerLetter} style={{ fill: color }}>
          {sid}
        </text>
      ) : (
        <>
          <circle cx={12} cy={box.h / 2} r={4} fill={ghost ? 'none' : color} stroke={color} strokeWidth={1.2} />
          <text x={22} y={box.h / 2 + 4} className={css.markerName} style={state === 'down' ? { fill: SIG.err } : undefined}>
            {def.name}
          </text>
        </>
      )}
      {caption && (
        <text x={box.w / 2} y={box.h + (small ? 10 : 12)} textAnchor="middle" className={stage.caps} style={{ fill: state === 'down' ? SIG.err : 'var(--text-3)', fontSize: small ? 7.5 : 8.5 }}>
          {caption}
        </text>
      )}
    </g>
  );
}

function CenterCard({ sim, glow }: { sim: RingSim; glow: boolean }) {
  const b = sim.boxes.get('center');
  if (!b || Number.isNaN(b.x)) return null;
  const driver = sim.cfg.client === 'driver';
  return (
    <NodeCard
      box={b}
      title={driver ? 'client' : 'app server'}
      sub={driver ? 'token-aware driver' : 'ketama client'}
      glow={glow}
      tone={driver ? 'rgba(69,213,255,0.6)' : undefined}
    />
  );
}

/* ================================================================== */
/* Chapter 1: hash mod N in front of the caches                        */
/* ================================================================== */

function BucketsScene({ sim, highlight }: SceneProps) {
  const app = sim.boxes.get('app');
  const db = sim.boxes.get('db');
  const busy = clamp(1 - (sim.vt - sim.dbVt) / 0.6, 0, 1);
  const rate = sim.dbRate();
  return (
    <g>
      <Wires sim={sim} />
      {app && <NodeCard box={app} title="app server" sub="servers[h % N]" glow={highlight === 'app'} />}
      {db && (
        <Cylinder box={db} title="postgres" sub="10.0.2.5" glow={highlight === 'db'} state={rate >= 1 ? 'hot' : 'normal'}>
          <DbMeter box={db} rate={rate} flash={busy} />
        </Cylinder>
      )}
      {sim.presentBuckets().map((id) => {
        const b = sim.boxes.get(`srv:${id}`);
        return b ? <CacheCard key={id} sim={sim} box={b} sid={id} glow={highlight === `srv:${id}`} /> : null;
      })}
      <Flights sim={sim} />
      <Effects sim={sim} />
    </g>
  );
}

function DbMeter({ box, rate, flash }: { box: Box; rate: number; flash: number }) {
  const w = box.w - 30;
  const k = clamp(rate / 2.5, 0, 1);
  const color = rate >= 1.4 ? SIG.err : rate >= 0.6 ? SIG.heavy : SIG.res;
  const y = box.h - 20;
  return (
    <g>
      <rect x={15} y={y} width={w} height={5} rx={2.5} fill="rgba(143,166,201,0.14)" />
      <rect x={15} y={y} width={Math.max(2, w * k)} height={5} rx={2.5} fill={color} opacity={0.9} />
      {flash > 0 && <rect x={15} y={y} width={w} height={5} rx={2.5} fill="none" stroke={SIG.heavy} strokeOpacity={flash} />}
    </g>
  );
}

function CacheCard({ sim, box, sid, glow }: { sim: RingSim; box: Box; sid: string; glow: boolean }) {
  const def = SERVERS[sid];
  const small = sim.orient === 'portrait';
  const joining = sim.bGhost === sid && !sim.blist.includes(sid);
  const leaving = sim.bLeaving === sid;
  const idx = sim.blist.indexOf(sid);
  const chips = sim.chips.get(sid) ?? [];
  const x0 = box.x - box.w / 2;
  const y0 = box.y - box.h / 2;
  const header = small ? 24 : 30;
  const cols = 4;
  const gx = small ? (box.w - 12) / cols : (box.w - 16) / cols;
  const chipW = small ? 8 : gx - 5;
  const chipH = small ? 8 : 17;
  const rowH = small ? 12 : 20;
  return (
    <g className={stage.node} transform={`translate(${fx(x0)},${fx(y0)})`} opacity={box.alpha * (joining ? 0.8 : 1)}>
      {glow && <rect x={-6} y={-6} width={box.w + 12} height={box.h + 12} rx={14} fill="none" stroke="var(--accent)" strokeWidth={1.4} strokeDasharray="3 3" />}
      <rect
        className={stage.card}
        width={box.w}
        height={box.h}
        rx={10}
        style={joining ? { strokeDasharray: '4 4', stroke: def.color } : leaving ? { strokeDasharray: '4 4', stroke: SIG.err } : undefined}
      />
      <rect x={10} y={0} width={box.w - 20} height={2} rx={1} fill={def.color} opacity={0.9} />
      {small ? (
        <>
          <text x={box.w / 2} y={15} textAnchor="middle" className={css.cardNameSm}>
            {def.name}
          </text>
        </>
      ) : (
        <>
          <circle cx={13} cy={16} r={3.6} fill={def.color} />
          <text x={22} y={20} className={stage.name}>
            {def.name}
          </text>
          <text
            x={box.w - 10}
            y={19.5}
            textAnchor="end"
            className={joining || leaving ? stage.caps : css.cardIdx}
            style={joining ? { fill: def.color } : leaving ? { fill: SIG.err } : undefined}
          >
            {joining ? 'joining' : leaving ? 'leaving' : `servers[${idx}]`}
          </text>
        </>
      )}
      {small && (
        <text
          x={box.w / 2}
          y={box.h + 11}
          textAnchor="middle"
          className={css.cardIdx}
          style={{ fontSize: 8.5, fill: joining ? def.color : leaving ? SIG.err : undefined }}
        >
          {joining ? 'joining' : leaving ? 'leaving' : `[${idx}]`}
        </text>
      )}
      {chips.map((c, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const cxp = (small ? 6 : 8) + col * gx + (gx - chipW) / 2;
        const cyp = header + row * rowH;
        const fresh = clamp(1 - (sim.vt - c.vt) / 1.4, 0, 1);
        const hit = clamp(1 - (sim.vt - c.hitVt) / 0.7, 0, 1);
        const moved = clamp(1 - (sim.vt - c.movedVt) / 1.6, 0, 1);
        const stroke = moved > 0 ? SIG.warn : c.stale ? 'rgba(143,166,201,0.28)' : fresh > 0 ? SIG.res : hit > 0 ? SIG.res : 'rgba(143,166,201,0.38)';
        const fill = c.stale ? 'rgba(143,166,201,0.03)' : fresh > 0 ? `rgba(75,227,160,${0.08 + 0.18 * fresh})` : hit > 0 ? `rgba(75,227,160,${0.2 * hit})` : 'rgba(143,166,201,0.09)';
        if (small) {
          return (
            <g key={c.key}>
              {moved > 0 && <circle cx={cxp + chipW / 2} cy={cyp + chipH / 2} r={5 + (1 - moved) * 6} fill="none" stroke={SIG.warn} strokeWidth={1.5 * moved} opacity={moved} />}
              <rect x={cxp} y={cyp} width={chipW} height={chipH} rx={2} fill={c.stale ? 'none' : fresh > 0 || hit > 0 ? SIG.res : 'rgba(232,238,249,0.75)'} stroke={stroke} strokeDasharray={c.stale ? '2 1.5' : undefined} opacity={c.stale ? 0.6 : 1} />
            </g>
          );
        }
        return (
          <g key={c.key}>
            <rect x={cxp} y={cyp} width={chipW} height={chipH} rx={4} fill={fill} stroke={stroke} strokeWidth={moved > 0 ? 1.6 : 1} strokeDasharray={c.stale && moved === 0 ? '3 2' : undefined} />
            <text x={cxp + chipW / 2} y={cyp + 12} textAnchor="middle" className={cx(css.chipText, c.stale && css.chipStale)}>
              {c.key}
            </text>
          </g>
        );
      })}
    </g>
  );
}

/* ================================================================== */
/* Bend the number line into a ring                                    */
/* ================================================================== */

const LINE_LABELS_FULL = ['0', '1,073,741,824', '2,147,483,648', '3,221,225,472', '4,294,967,295'];
const LINE_LABELS_SHORT = ['0', '1.07B', '2.15B', '3.22B', '4.29B'];
export const NAMED_KEYS = ['alice', 'bob', 'carol', 'dave'];

function LineScene({ sim, highlight }: SceneProps) {
  const g = sim.geo;
  const m = sim.morph();
  const L0 = sim.lineLength();
  const shape = curlShape(g.cx, g.cy, g.R, m, L0);
  const labels = g.small ? LINE_LABELS_SHORT : LINE_LABELS_FULL;
  const inset = g.R - g.keyR;
  let minor = '';
  for (let i = 0; i <= 64; i++) {
    const p = shape.at(i / 64);
    const len = i % 16 === 0 ? 9 : i % 4 === 0 ? 6 : 3.5;
    minor += `M${fx(p.x)},${fx(p.y)} L${fx(p.x - p.nx * len)},${fx(p.y - p.ny * len)} `;
  }
  const joined = clamp((m - 0.94) / 0.06, 0, 1);
  const top = shape.at(0);
  return (
    <g>
      <path d={shape.d} fill="none" className={css.ringLine} style={highlight === 'ring' ? { stroke: 'var(--accent)' } : undefined} />
      <path d={minor} className={css.tick} />
      {labels.map((t, i) => {
        const u = i / 4;
        if (i === 4 && m > 0.85) return null;
        if (i === 0 && m > 0.85) return null;
        const p = shape.at(u);
        const off = g.small ? 14 : 18;
        const ox = -p.nx;
        const anchor = m < 0.3 && i === 0 ? 'start' : m < 0.3 && i === 4 ? 'end' : ox > 0.6 ? 'start' : ox < -0.6 ? 'end' : 'middle';
        return (
          <text
            key={t}
            x={p.x - p.nx * off}
            y={p.y - p.ny * off + 3.5}
            textAnchor={anchor}
            className={css.lineLabel}
            style={{ opacity: i === 4 ? clamp(1 - (m - 0.6) / 0.25, 0, 1) : 1, fontSize: g.small ? 9 : 10.5 }}
          >
            {t}
          </text>
        );
      })}
      {joined > 0 && (
        <g opacity={joined}>
          <line x1={top.x} y1={top.y - 12} x2={top.x} y2={top.y + 12} stroke="var(--accent)" strokeWidth={1.6} />
          <text x={top.x} y={top.y - 20} textAnchor="middle" className={css.wrapLabel} style={g.small ? { fontSize: 9 } : undefined}>
            {g.small ? '4.29B + 1 wraps to 0' : '4,294,967,295 + 1 wraps to 0'}
          </text>
        </g>
      )}
      {sim.keys.map((k, i) => {
        if (!k.placed) return null;
        const t0 = 0.3 + i * 0.07;
        const a = clamp((sim.stepT - t0) / 0.4, 0, 1);
        if (a <= 0) return null;
        const p = shape.at(k.f);
        const drop = (1 - easeOut(a)) * 26;
        const x = p.x + p.nx * inset;
        const y = p.y + p.ny * inset - drop;
        const named = NAMED_KEYS.includes(k.name);
        const on = highlight === `key:${k.name}`;
        // Neighbouring tags (alice/bob, carol/dave) sit at two depths so they never collide.
        const deep = k.name === 'bob' || k.name === 'dave';
        const tagOff = g.small ? (deep ? 33 : 15) : deep ? 40 : 18;
        return (
          <g key={k.name} opacity={a}>
            {on && <circle cx={x} cy={y} r={9} fill="none" stroke="var(--accent)" strokeDasharray="2.5 2.5" />}
            {named && deep && (
              <line x1={x} y1={y} x2={x + p.nx * (tagOff - 8)} y2={y + p.ny * (tagOff - 8)} stroke="rgba(232,238,249,0.35)" strokeWidth={1} />
            )}
            <circle cx={x} cy={y} r={named ? 4.6 : 3.4} fill={named ? SIG.text : NEUTRAL} stroke="var(--ink-1)" strokeWidth={1.2} />
            {named && <LineKeyTag x={x + p.nx * tagOff} y={y + p.ny * tagOff} text={g.small ? k.name : k.label} small={g.small} />}
          </g>
        );
      })}
    </g>
  );
}

function LineKeyTag({ x, y, text, small }: { x: number; y: number; text: string; small: boolean }) {
  const w = text.length * (small ? 5.6 : 6.2) + 12;
  const h = small ? 15 : 17;
  return (
    <g transform={`translate(${fx(x)},${fx(y)})`}>
      <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={h / 2} fill="rgba(7,11,20,0.9)" stroke="rgba(232,238,249,0.45)" />
      <text x={0} y={small ? 3 : 3.6} textAnchor="middle" className={css.keyLabel} style={{ fill: 'var(--text-1)', fontSize: small ? 8.5 : 10 }}>
        {text}
      </text>
    </g>
  );
}

/* ================================================================== */
/* Rendezvous hashing: every server bids, the highest score wins       */
/* ================================================================== */

function HrwScene({ sim, highlight }: SceneProps) {
  const key = keyString(sim.hrwKey());
  const live = sim.hrwLive();
  const best = [...live].sort((a, b) => scoreOf(key, b) - scoreOf(key, a))[0];
  const small = sim.orient === 'portrait';
  const first = sim.hrwRow(sim.cfg.servers[0]);
  const grid = sim.hrwGrid();
  if (!first) return null;
  const nameW = small ? 66 : 100;
  const valW = small ? 0 : 112;
  const changed = sim.hrwChange;
  const flash = changed ? clamp(1 - (sim.vt - changed.vt) / 1.8, 0, 1) : 0;
  return (
    <g>
      <text x={first.x} y={first.y - (small ? 46 : 58)} className={stage.caps} style={{ fontSize: small ? 8.5 : 9.5 }}>
        score = hash(key | server) · highest wins
      </text>
      <text x={first.x} y={first.y - (small ? 26 : 32)} className={css.hrwKey} style={small ? { fontSize: 13.5 } : undefined}>
        {key}
      </text>
      {sim.cfg.servers.map((sid) => {
        const r = sim.hrwRow(sid);
        if (!r) return null;
        const removed = sim.hrwRemoved.has(sid);
        const win = sid === best;
        const trackX = r.x + nameW;
        const trackW = r.w - nameW - valW;
        const bar = sim.hrwBars.get(sid) ?? 0;
        const color = SERVERS[sid].color;
        const on = highlight === `hrw:${sid}` || highlight === `srv:${sid}`;
        const v = scoreOf(key, sid);
        const bh = small ? 10 : 12;
        return (
          <g key={sid} opacity={removed ? 0.45 : 1}>
            {(win || on) && (
              <rect
                x={r.x - 10}
                y={r.y - r.h / 2 - 5}
                width={r.w + 20}
                height={r.h + 10}
                rx={9}
                fill={win ? 'rgba(255,210,63,0.06)' : 'none'}
                stroke={win ? 'rgba(255,210,63,0.65)' : 'var(--accent)'}
                strokeDasharray={win ? undefined : '3 3'}
              />
            )}
            <circle cx={r.x + 6} cy={r.y} r={4.5} fill={removed ? 'none' : color} stroke={color} />
            <text x={r.x + 17} y={r.y + 4} className={css.markerName} style={{ fill: removed ? 'var(--text-3)' : 'var(--text-1)', fontSize: small ? 10.5 : 12 }}>
              {SERVERS[sid].name}
            </text>
            <rect x={trackX} y={r.y - bh / 2} width={trackW} height={bh} rx={bh / 2} fill="rgba(143,166,201,0.1)" />
            <rect x={trackX} y={r.y - bh / 2} width={Math.max(0, trackW * bar)} height={bh} rx={bh / 2} fill={color} opacity={win ? 0.95 : 0.5} />
            {removed && (
              <text x={trackX + 8} y={r.y + 3.5} className={stage.caps} style={{ fill: SIG.err }}>
                removed
              </text>
            )}
            {!removed && !small && (
              <text x={r.x + r.w - 2} y={r.y + 4} textAnchor="end" className={css.hrwScore} style={win ? { fill: 'var(--accent)' } : undefined}>
                {commas(v)}
              </text>
            )}
            {win && (
              <text x={trackX + trackW * bar} y={r.y - bh / 2 - 5} textAnchor="end" className={css.hrwWin} style={small ? { fontSize: 8.5 } : undefined}>
                winner
              </text>
            )}
          </g>
        );
      })}
      {grid && (
        <g>
          <text x={grid.x} y={grid.y - 12} className={stage.caps} style={{ fontSize: small ? 8.5 : 9.5 }}>
            who wins each of the {grid.cells.length} keys
          </text>
          {grid.cells.map((c) => {
            const winner = hrwWinnerOf(c.name, live);
            const moved = !!changed && flash > 0 && c.movedFrom === changed.sid;
            const cur = c.name === sim.hrwKey();
            return (
              <g key={c.name}>
                {cur && <rect x={c.x - 3} y={c.y - 3} width={grid.size + 6} height={grid.size + 6} rx={5} fill="none" stroke="var(--accent)" strokeWidth={1.3} />}
                <rect x={c.x} y={c.y} width={grid.size} height={grid.size} rx={3} fill={winner ? SERVERS[winner].color : NEUTRAL} opacity={0.85} />
                {moved && <rect x={c.x - 1.5} y={c.y - 1.5} width={grid.size + 3} height={grid.size + 3} rx={4} fill="none" stroke={SIG.warn} strokeWidth={2} opacity={flash} />}
                <title>{keyString(c.name)}</title>
              </g>
            );
          })}
        </g>
      )}
      <Effects sim={sim} />
    </g>
  );
}

function hrwWinnerOf(name: string, live: string[]) {
  const key = keyString(name);
  let best: string | null = null;
  let score = -1;
  for (const s of live) {
    const v = scoreOf(key, s);
    if (v > score) {
      score = v;
      best = s;
    }
  }
  return best;
}

const scoreMemo = new Map<string, number>();
function scoreOf(key: string, sid: string) {
  const k = `${key}|${sid}`;
  let v = scoreMemo.get(k);
  if (v === undefined) {
    v = hrwScore(key, sid);
    scoreMemo.set(k, v);
  }
  return v;
}
