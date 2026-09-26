'use client';

import { memo, useMemo } from 'react';
import { Effects, Flights, Wires } from '@/components/stage/svg';
import { SIG } from '@/lib/sim/colors';
import { bezier } from '@/lib/sim/geometry';
import type { Box } from '@/lib/sim/Sim';
import { CITIES, CITY_IDS, POP_IDS, landDotsPath, project, type CityId, type MapRect, type PopId } from './geo';
import { APP_BUILDS, FILES, arcCurve, type CdnSim, type FileId } from './sim';
import css from './cdn.module.css';

const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(' ');

export const latencyColor = (ms: number) => (ms < 50 ? SIG.res : ms < 120 ? SIG.text : SIG.heavy);

/* ------------------------------------------------------------------ */
/* The dotted world map (re-rendered only when the stage resizes)      */
/* ------------------------------------------------------------------ */

const WorldMap = memo(function WorldMap({ x, y, w, h, portrait }: MapRect & { portrait: boolean }) {
  const spacing = portrait ? 4.4 : Math.max(6, Math.min(8, w / 135));
  const d = useMemo(() => landDotsPath({ x, y, w, h }, spacing), [x, y, w, h, spacing]);
  const eq = project({ x, y, w, h }, 0, 0).y;
  return (
    <g aria-hidden>
      <line className={css.equator} x1={x} x2={x + w} y1={eq} y2={eq} />
      {!portrait && (
        <text className={css.grat} x={x + 6} y={eq - 5}>
          0°
        </text>
      )}
      <path d={d} className={css.land} style={{ strokeWidth: portrait ? 2 : 2.5 }} />
    </g>
  );
});

/* ------------------------------------------------------------------ */
/* Markers                                                             */
/* ------------------------------------------------------------------ */

function hex(r: number) {
  return Array.from({ length: 6 }, (_, i) => {
    const a = ((60 * i - 90) * Math.PI) / 180;
    return `${(r * Math.cos(a)).toFixed(2)},${(r * Math.sin(a)).toFixed(2)}`;
  }).join(' ');
}

function Glow({ r }: { r: number }) {
  return <circle className={css.glowRing} r={r} />;
}

function OriginMarker({ b, sim, dim, glow, showLoad }: { b: Box; sim: CdnSim; dim: boolean; glow: boolean; showLoad: boolean }) {
  const portrait = sim.orient === 'portrait';
  const s = b.w;
  const load = sim.originLoad();
  const loadColor = load >= 1 ? SIG.err : load >= 0.7 ? SIG.heavy : SIG.res;
  return (
    <g className={css.marker} transform={`translate(${b.x},${b.y})`} opacity={b.alpha * (dim ? 0.3 : 1)}>
      {glow && <Glow r={s * 0.9 + 6} />}
      <circle r={s * 1.05} fill="rgba(232,238,249,0.05)" />
      <rect className={css.origin} x={-s / 2} y={-s / 2} width={s} height={s} rx={3} />
      <path className={css.originGlyph} d={portrait ? 'M-3,-2 h6 M-3,0.5 h6 M-3,3 h6' : 'M-5,-4 h10 M-5,0 h10 M-5,4 h10'} />
      {portrait ? (
        <text className={cx(css.caps, css.halo)} x={0} y={s / 2 + 10} textAnchor="middle" style={{ fontSize: 7.5, fill: SIG.text }}>
          origin
        </text>
      ) : (
        <g transform={`translate(${-s / 2 - 8},${s / 2 + 12})`}>
          <text className={cx(css.caps, css.halo)} textAnchor="end" style={{ fill: SIG.text, fontSize: 9 }}>
            origin
          </text>
          <text className={cx(css.mono, css.halo)} y={12} textAnchor="end">
            Virginia · us-east
          </text>
          {showLoad && (
            <g transform="translate(-70,19)">
              <rect width={70} height={5} rx={2} fill="rgba(143,166,201,0.18)" />
              <rect width={Math.min(70, 70 * load)} height={5} rx={2} fill={loadColor} />
              <text className={cx(css.mono, css.halo)} x={70} y={16} textAnchor="end" style={{ fill: loadColor, fontSize: 9 }}>
                load {Math.round(load * 100)}%
              </text>
            </g>
          )}
        </g>
      )}
    </g>
  );
}

function ShieldMarker({ b, sim, dim, glow }: { b: Box; sim: CdnSim; dim: boolean; glow: boolean }) {
  const portrait = sim.orient === 'portrait';
  const r = b.w * 0.55;
  return (
    <g className={css.marker} transform={`translate(${b.x},${b.y})`} opacity={b.alpha * (dim ? 0.3 : 1)}>
      {glow && <Glow r={r + 7} />}
      <polygon className={css.shield} points={hex(r)} />
      <path d={`M0,${-r * 0.45} L${r * 0.4},${-r * 0.25} V${r * 0.1} Q${r * 0.4},${r * 0.45} 0,${r * 0.55} Q${-r * 0.4},${r * 0.45} ${-r * 0.4},${r * 0.1} V${-r * 0.25} Z`} fill="#b59bff" opacity={0.85} />
      <text
        className={cx(css.caps, css.halo)}
        x={portrait ? 0 : r + 5}
        y={portrait ? -r - 4 : -r + 2}
        textAnchor={portrait ? 'middle' : 'start'}
        style={{ fill: '#cdbdff', fontSize: portrait ? 7 : 8.5 }}
      >
        shield
      </text>
    </g>
  );
}

interface ChipItem {
  label: string;
  state: 'fresh' | 'stale' | 'none';
  left: number;
  short: boolean;
}

function chipItems(sim: CdnSim, node: string, files: FileId[]): ChipItem[] {
  return files.map((f) => {
    const c = sim.chip(node, f);
    let label = FILES[f].short;
    if (f === 'app' && sim.cfg.mode === 'pageviews') label = APP_BUILDS[(sim.version.app - 1) % APP_BUILDS.length];
    if (f === 'style' && sim.cfg.versions && c.state !== 'none') label = `css v${c.version}`;
    const pol = sim.policyOf(f);
    return { label, state: c.state, left: c.left, short: pol.kind === 'public' && !pol.immutable && (pol.maxAge ?? 0) < 86400 };
  });
}

function Chip({ items, side, r, oldVersion }: { items: ChipItem[]; side: 'left' | 'right'; r: number; oldVersion?: (label: string) => boolean }) {
  const sw = (it: ChipItem) => Math.max(20, it.label.length * 5.3 + 8);
  const gap = 3;
  const pad = 3;
  const h = 13;
  const widths = items.map(sw);
  const total = widths.reduce((a, w) => a + w + gap, -gap) + pad * 2;
  const x0 = side === 'right' ? r + 6 : -(r + 6 + total);
  const xs = widths.map((_, i) => x0 + pad + widths.slice(0, i).reduce((a, w) => a + w + gap, 0));
  return (
    <g>
      <rect className={css.chipBox} x={x0} y={-h / 2 - pad} width={total} height={h + pad * 2} rx={4} />
      {items.map((it, i) => {
        const w = widths[i];
        const x = xs[i];
        const old = oldVersion?.(it.label);
        return (
          <g key={i}>
            <rect className={css.slot} data-state={old ? 'stale' : it.state} x={x} y={-h / 2} width={w} height={h} rx={2} />
            <text className={css.slotText} data-state={old ? 'stale' : it.state} x={x + w / 2} y={3}>
              {it.label}
            </text>
            {it.short && it.state !== 'none' && <rect x={x + 1} y={h / 2 - 2} width={Math.max(0, (w - 2) * it.left)} height={1.6} fill={SIG.res} />}
          </g>
        );
      })}
    </g>
  );
}

function PopMarker({
  pop,
  b,
  sim,
  dim,
  glow,
  pick,
  onClick,
}: {
  pop: PopId;
  b: Box;
  sim: CdnSim;
  dim: boolean;
  glow: boolean;
  pick: boolean;
  onClick?: () => void;
}) {
  const portrait = sim.orient === 'portrait';
  const r = b.w * 0.55;
  const down = sim.isDown(pop);
  const city = CITY_IDS.map((c) => CITIES[c]).find((c) => c.pop === pop);
  const chipSide = city?.chip ?? 'right';
  const files = sim.cfg.chips;
  return (
    <g
      className={cx(css.marker, down && css.popDown, pick && css.pick, onClick && css.clickable)}
      transform={`translate(${b.x},${b.y})`}
      opacity={b.alpha * (dim ? 0.3 : 1)}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      aria-label={onClick ? `${pop} edge` : undefined}
    >
      {onClick && <circle r={r + 12} fill="transparent" />}
      {glow && <Glow r={r + 7} />}
      <circle r={r * 2.1} fill={down ? 'rgba(255,77,106,0.08)' : 'rgba(69,213,255,0.07)'} />
      <polygon className={css.pop} points={hex(r)} />
      {down ? (
        <path d={`M${-r * 0.4},${-r * 0.4} L${r * 0.4},${r * 0.4} M${r * 0.4},${-r * 0.4} L${-r * 0.4},${r * 0.4}`} stroke={SIG.err} strokeWidth={1.4} strokeLinecap="round" />
      ) : (
        <circle r={r * 0.32} fill="#45d5ff" />
      )}
      <text className={cx(css.code, css.halo)} x={0} y={-r - (portrait ? 4 : 6)} textAnchor="middle" style={portrait ? { fontSize: 7.5, letterSpacing: '0.04em' } : undefined}>
        {pop}
      </text>
      {!portrait && files.length > 0 && !down && (
        <Chip
          items={chipItems(sim, `pop:${pop}`, files)}
          side={chipSide}
          r={r}
          oldVersion={files.includes('style') ? (l) => l.startsWith('css v') && Number(l.slice(5)) < sim.version.style : undefined}
        />
      )}
    </g>
  );
}

function UserMarker({
  id,
  b,
  sim,
  dim,
  glow,
  name,
  code,
  ms,
  guest,
}: {
  id: string;
  b: Box;
  sim: CdnSim;
  dim: boolean;
  glow: boolean;
  name: string;
  code: string;
  ms: number | null;
  guest?: boolean;
}) {
  const portrait = sim.orient === 'portrait';
  const r = b.w / 2;
  const pulse = guest ? (sim.vt * 1.2) % 1 : 0;
  const tag = ms != null ? `${Math.round(ms)} ms` : null;
  // Prefer the city's side, but flip if the label would run off the stage.
  const labelW = portrait ? ((guest ? name : code).length + (tag ? tag.length + 1 : 0)) * 5 + 6 : Math.max(name.length * 6.6, (tag?.length ?? 0) * 6.2) + 8;
  let side = sim.sideOf(id);
  if (side === 'left' && b.x - r - labelW < 4) side = 'right';
  else if (side === 'right' && b.x + r + labelW > sim.w - 4) side = 'left';
  const sx = side === 'left' ? -1 : 1;
  const anchor = side === 'left' ? 'end' : 'start';
  return (
    <g className={cx(css.marker, guest && css.guest)} transform={`translate(${b.x},${b.y})`} opacity={b.alpha * (dim ? 0.3 : 1)}>
      {glow && <Glow r={r + 6} />}
      {guest && <circle r={r + 3 + pulse * 12} fill="none" stroke={SIG.warn} strokeWidth={1.6 * (1 - pulse)} opacity={1 - pulse} />}
      <circle className={css.user} r={r} />
      {!portrait && (
        <g>
          <circle className={css.userGlyph} cx={0} cy={-1.4} r={1.6} />
          <path className={css.userGlyph} d="M-2.9,3.1 a2.9,2.5 0 0 1 5.8,0 z" />
        </g>
      )}
      {portrait ? (
        guest ? (
          // A visitor's name goes underneath: the sides are crowded on a phone.
          <text className={cx(css.tag, css.halo)} x={0} y={r + 10} textAnchor="middle" style={{ fontSize: 8, fill: SIG.warn }}>
            {name}
          </text>
        ) : dim && !tag ? null : (
          <text className={cx(css.tag, css.halo)} x={sx * (r + 3)} y={3} textAnchor={anchor} style={{ fontSize: 8 }}>
            {/* With an edge in town, the PoP's code already names the city. */}
            {(!tag || !sim.cfg.cdn || id.startsWith('person:')) && <tspan style={{ fill: SIG.text2 }}>{code}</tspan>}
            {tag && (
              <tspan dx={3} style={{ fill: latencyColor(ms ?? 0) }}>
                {tag}
              </tspan>
            )}
          </text>
        )
      ) : (
        <>
          <text className={cx(css.cityName, css.halo)} x={sx * (r + 6)} y={tag ? -1.5 : 4} textAnchor={anchor} style={guest ? { fill: SIG.warn } : undefined}>
            {name}
          </text>
          {tag && (
            <text className={cx(css.tag, css.halo)} x={sx * (r + 6)} y={10.5} textAnchor={anchor} style={{ fill: latencyColor(ms ?? 0) }}>
              {tag}
            </text>
          )}
        </>
      )}
    </g>
  );
}

/* ------------------------------------------------------------------ */
/* A highlighted route with a label at its apex                        */
/* ------------------------------------------------------------------ */

export interface RouteMark {
  from: string;
  to: string;
  label: string;
}

function HotRoute({ sim, route }: { sim: CdnSim; route: RouteMark }) {
  const a = sim.boxes.get(route.from);
  const b = sim.boxes.get(route.to);
  if (!a || !b || Number.isNaN(a.x) || Number.isNaN(b.x)) return null;
  const c = arcCurve(a, b, 0, sim.orient === 'portrait' ? 0.45 : sim.k);
  const mid = bezier(c, 0.5);
  const d = `M${c.p0.x},${c.p0.y} C${c.p1.x},${c.p1.y} ${c.p2.x},${c.p2.y} ${c.p3.x},${c.p3.y}`;
  const portrait = sim.orient === 'portrait';
  const w = route.label.length * (portrait ? 5.2 : 6.2) + 14;
  return (
    <g>
      <path d={d} fill="none" stroke={SIG.warn} strokeOpacity={0.55} strokeWidth={1.6} strokeDasharray="5 5" />
      <g transform={`translate(${mid.x},${mid.y})`}>
        <rect x={-w / 2} y={-10} width={w} height={18} rx={9} fill="rgba(20,17,4,0.92)" stroke={SIG.warn} strokeOpacity={0.7} />
        <text className={css.tag} y={3} textAnchor="middle" style={{ fill: '#fff3c4', fontSize: portrait ? 8.5 : 10 }}>
          {route.label}
        </text>
      </g>
    </g>
  );
}

/* ------------------------------------------------------------------ */
/* The map scene                                                       */
/* ------------------------------------------------------------------ */

export function MapScene({
  sim,
  highlight,
  focus,
  route,
  onPop,
  showLoad,
}: {
  sim: CdnSim;
  highlight: string | null;
  focus?: string[];
  route?: RouteMark;
  onPop?: (pop: PopId) => void;
  showLoad?: boolean;
}) {
  const portrait = sim.orient === 'portrait';
  const active = new Set<string>(sim.cfg.cities);
  const dim = (id: string) => (focus?.length ? !focus.includes(id) : false);
  const glow = (id: string) => highlight === id;
  const picking = !!sim.game?.pending && sim.cfg.mode === 'anycast';
  const people = sim.cfg.people;
  const o = sim.boxes.get('origin');
  const sh = sim.boxes.get('shield');
  const guestBox = sim.boxes.get('guest');
  return (
    <>
      <WorldMap x={sim.map.x} y={sim.map.y} w={sim.map.w} h={sim.map.h} portrait={portrait} />
      <Wires sim={sim} />
      {route && <HotRoute sim={sim} route={route} />}
      {o && <OriginMarker b={o} sim={sim} dim={dim('origin')} glow={glow('origin')} showLoad={!!showLoad} />}
      {sh && <ShieldMarker b={sh} sim={sim} dim={dim('shield')} glow={glow('shield')} />}
      {POP_IDS.map((p) => {
        const b = sim.boxes.get(`pop:${p}`);
        if (!b) return null;
        const pickable = picking && !sim.isDown(p);
        return (
          <PopMarker
            key={p}
            pop={p}
            b={b}
            sim={sim}
            dim={dim(`pop:${p}`)}
            glow={glow(`pop:${p}`)}
            pick={pickable}
            onClick={pickable ? () => sim.game?.answer(p) : onPop ? () => onPop(p) : undefined}
          />
        );
      })}
      {CITY_IDS.map((c: CityId) => {
        const id = `user:${c}`;
        const b = sim.boxes.get(id);
        if (!b) return null;
        const m = sim.cityMs[c];
        const ms = sim.cfg.tags ? (sim.cfg.cdn ? m.cdn : m.direct) : null;
        return (
          <UserMarker
            key={c}
            id={id}
            b={b}
            sim={sim}
            dim={focus?.length ? dim(id) : !active.has(c)}
            glow={glow(id)}
            name={CITIES[c].name}
            code={CITIES[c].code}
            ms={ms}
          />
        );
      })}
      {people &&
        people.names.map((n, i) => {
          const id = `person:${i}`;
          const b = sim.boxes.get(id);
          if (!b) return null;
          return <UserMarker key={id} id={id} b={b} sim={sim} dim={dim(id)} glow={glow(id)} name={n} code={n} ms={null} />;
        })}
      {guestBox && sim.guest && (
        <UserMarker id="guest" b={guestBox} sim={sim} dim={false} glow={false} name={sim.guest.place.name} code={sim.guest.place.code} ms={null} guest />
      )}
      <Flights sim={sim} labels={sim.cfg.labels} />
      <Effects sim={sim} />
    </>
  );
}

