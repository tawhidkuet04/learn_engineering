import { SequenceDiagram } from '@/components/stage/SequenceDiagram';
import { ClientCard, Cylinder, Effects, NodeCard, Wires } from '@/components/stage/svg';
import { SIG } from '@/lib/sim/colors';
import { clamp } from '@/lib/sim/geometry';
import { POLICY_NAMES, type Entry, type Ghost } from './cache';
import { ADMIN, HOT, SHOPPERS, keyName } from './products';
import { RACE_END, raceActors, raceMessages, raceNotes, raceSpans } from './race';
import { GHOST_S, type CacheSim, type DbJob } from './sim';
import css from './caching.module.css';

export interface SceneProps {
  sim: CacheSim;
  /** Dim everything outside these ids (the step's spotlight) */
  focus?: string[];
  /** Narration hover: a box id or row:<key> */
  highlight?: string | null;
  /** Rows are clickable (eviction prediction) */
  pickRows?: boolean;
  onRowClick?: (key: number) => void;
}

const MINT_EDGE = 'rgba(75,227,160,0.55)';

export function Scene(props: SceneProps) {
  const v = props.sim.cfg.view;
  if (v === 'sequence') return <RaceSequence sim={props.sim} />;
  if (v === 'layers') return <LayersScene sim={props.sim} highlight={props.highlight} />;
  return <FlowScene {...props} />;
}

/* ------------------------------------------------------------------ */
/* Flow view: shoppers → app → Redis / Postgres                        */
/* ------------------------------------------------------------------ */

function FlowScene({ sim, focus, highlight, pickRows, onRowClick }: SceneProps) {
  const dim = (id: string) => !!focus?.length && !focus.includes(id);
  const glow = (id: string) => highlight === id;
  const clients = [...SHOPPERS, ADMIN];
  const app = sim.boxes.get('app');
  const db = sim.boxes.get('db');
  const overloaded = sim.queue.length >= 3;
  return (
    <>
      <Wires sim={sim} />
      {clients.map((c) => {
        const b = sim.boxes.get(c.id);
        if (!b) return null;
        return <ClientCard key={c.id} box={b} name={c.name} sub={c.sub} color={c.color} dim={dim(c.id) || dim('clients')} glow={glow(c.id)} />;
      })}
      {app && (
        <NodeCard box={app} title="app-1" sub="10.0.1.11" led="up" dim={dim('app')} glow={glow('app')} icon={<AppGlyph />}>
          <Waiters sim={sim} h={app.h} />
        </NodeCard>
      )}
      {db && (
        <Cylinder
          box={db}
          title="postgres"
          sub={db.h > 84 ? '10.0.2.5' : undefined}
          dim={dim('db')}
          glow={glow('db')}
          tone={overloaded ? 'rgba(255,77,106,0.85)' : sim.running.length ? 'rgba(255,154,60,0.75)' : undefined}
        >
          <DbLanes sim={sim} w={db.w} h={db.h} />
        </Cylinder>
      )}
      <DbQueue sim={sim} />
      <CacheBox sim={sim} dim={dim('cache')} glow={glow('cache')} highlight={highlight} pickRows={pickRows} onRowClick={onRowClick} />
      <CacheFlights sim={sim} />
      <Effects sim={sim} />
    </>
  );
}

function AppGlyph() {
  return (
    <g stroke="rgba(143,166,201,0.8)" strokeWidth={1.2} fill="none">
      <rect x={-7} y={-7} width={14} height={14} rx={2.5} />
      <path d="M-3.5,-2 L-1,0.5 L-3.5,3 M0.5,3 H4" strokeLinecap="round" strokeLinejoin="round" />
    </g>
  );
}

/** Coalesced requests parked at the app, waiting for the one query in flight. */
function Waiters({ sim, h }: { sim: CacheSim; h: number }) {
  const n = sim.waitingTotal;
  if (!n) return null;
  const portrait = sim.orient === 'portrait';
  const shown = Math.min(n, portrait ? 10 : 14);
  const y = h + 13;
  return (
    <g>
      {Array.from({ length: shown }, (_, i) => (
        <circle key={i} cx={10 + i * 9} cy={y} r={3.2} fill={SIG.req} opacity={0.85} />
      ))}
      <text className={css.mono} x={14 + shown * 9} y={y + 3.5} style={{ fill: SIG.req, fontSize: 9.5 }}>
        {n > shown ? `+${n - shown} ` : ''}waiting on 1 query
      </text>
    </g>
  );
}

/* ------------------------------------------------------------------ */
/* Postgres: worker lanes inside the cylinder, and a queue outside     */
/* ------------------------------------------------------------------ */

function jobColor(j: DbJob) {
  if (j.kind === 'refresh' || j.kind === 'flush') return SIG.hc;
  return SIG.heavy;
}

function DbLanes({ sim, w, h }: { sim: CacheSim; w: number; h: number }) {
  const n = sim.cfg.dbWorkers;
  const lh = h > 84 ? 7 : 6;
  const gap = h > 84 ? 4 : 3;
  const top = h - 12 - n * lh - (n - 1) * gap;
  const x = 14;
  const bw = w - 28;
  return (
    <g>
      {Array.from({ length: n }, (_, i) => {
        const j = sim.running[i];
        const p = j ? sim.jobProgress(j) : 0;
        return (
          <g key={i} transform={`translate(${x},${top + i * (lh + gap)})`}>
            <rect width={bw} height={lh} rx={2} fill="rgba(143,166,201,0.06)" stroke="rgba(143,166,201,0.16)" />
            {j && <rect x={1.5} y={1.5} width={Math.max(1.5, (bw - 3) * p)} height={lh - 3} rx={1.5} fill={jobColor(j)} opacity={0.9} />}
          </g>
        );
      })}
    </g>
  );
}

function DbQueue({ sim }: { sim: CacheSim }) {
  const db = sim.boxes.get('db');
  if (!db || Number.isNaN(db.x) || !sim.queue.length) return null;
  const portrait = sim.orient === 'portrait';
  const max = portrait ? 9 : 12;
  const shown = sim.queue.slice(0, max);
  const extra = sim.queue.length - shown.length;
  if (portrait) {
    const y = db.y + db.h / 2 + 11;
    const x0 = db.x - db.w / 2 + 6;
    return (
      <g>
        {shown.map((j, i) => (
          <circle key={j.id} cx={x0 + i * 10} cy={y} r={3.4} fill={jobColor(j)} opacity={0.9} />
        ))}
        {extra > 0 && (
          <text className={css.mono} x={x0 + shown.length * 10 + 2} y={y + 3.5} style={{ fill: SIG.heavy }}>
            +{extra}
          </text>
        )}
      </g>
    );
  }
  const y = db.y + 2;
  const x0 = db.x - db.w / 2 - 12;
  return (
    <g>
      {shown.map((j, i) => (
        <circle key={j.id} cx={x0 - i * 10} cy={y} r={3.6} fill={jobColor(j)} opacity={0.9} />
      ))}
      {extra > 0 && (
        <text className={css.mono} x={x0 - shown.length * 10 - 4} y={y + 3.5} textAnchor="end" style={{ fill: SIG.heavy }}>
          +{extra}
        </text>
      )}
      <text className={css.caps} x={x0 + 4} y={y - 12} textAnchor="end" style={{ fill: 'rgba(255,154,60,0.8)', fontSize: 8.5 }}>
        waiting · {sim.queue.length}
      </text>
    </g>
  );
}

/* ------------------------------------------------------------------ */
/* Redis: every key, its value, its TTL, in eviction order             */
/* ------------------------------------------------------------------ */

function RedisGlyph() {
  return (
    <g fill="none" stroke={SIG.res} strokeWidth={1.1} strokeLinejoin="round">
      <path d="M0,-5 L7,-2 L0,1 L-7,-2 Z" fill="rgba(75,227,160,0.18)" />
      <path d="M-7,1 L0,4 L7,1" />
      <path d="M-7,4 L0,7 L7,4" opacity={0.6} />
    </g>
  );
}

function CacheBox({
  sim,
  dim,
  glow,
  highlight,
  pickRows,
  onRowClick,
}: {
  sim: CacheSim;
  dim: boolean;
  glow: boolean;
  highlight?: string | null;
  pickRows?: boolean;
  onRowClick?: (key: number) => void;
}) {
  const g = sim.cacheGeom();
  if (!g || !sim.cfg.cache) return null;
  const { x0, y0, w, h, header, rowH } = g;
  const cfg = sim.cfg;
  const cap = sim.cache.capacity;
  const rows = sim.rows();
  const portrait = sim.orient === 'portrait';
  const fs = rowH >= 22 ? 11 : rowH >= 17 ? 10 : 9.2;
  const full = rows.length >= cap;
  const down = sim.cacheDown;
  const byPolicy = cfg.order === 'policy';
  const ordering = cfg.policy === 'lru' ? 'recent first' : cfg.policy === 'fifo' ? 'newest first' : 'most read first';
  const hl = highlight?.startsWith('row:') ? Number(highlight.slice(4)) : null;
  const used = new Set(rows.map((e) => e.slot));
  const empty = Array.from({ length: cap }, (_, i) => i).filter((i) => (byPolicy ? i >= rows.length : !used.has(i)));
  const rank = new Map(rows.map((e, i) => [e.key, i]));
  // Draw the most recently touched row last, so a row sliding to the top passes over the others.
  const drawOrder = [...rows].sort((a, b) => a.lastUsed - b.lastUsed || a.seq - b.seq);
  const status = down
    ? 'down: restarting'
    : byPolicy
      ? `${rows.length}/${cap} keys · ${POLICY_NAMES[cfg.policy]}${portrait || w < 300 ? '' : ` · ${ordering}`}`
      : `${rows.length}/${cap} keys`;
  return (
    <g transform={`translate(${x0},${y0})`} opacity={g.alpha * (dim ? 0.28 : 1)}>
      {glow && <rect x={-6} y={-6} width={w + 12} height={h + 12} rx={14} fill="none" stroke="var(--accent)" strokeWidth={1.4} strokeDasharray="3 3" />}
      <rect width={w} height={h} rx={10} fill="var(--node-fill)" stroke={down ? SIG.err : MINT_EDGE} strokeWidth={1.2} />
      <rect x={3.5} y={3.5} width={w - 7} height={h - 7} rx={7.5} fill="none" stroke="rgba(143,166,201,0.1)" />
      <g transform={`translate(17,${header / 2})`}>
        <RedisGlyph />
      </g>
      <text className={css.monoStrong} x={32} y={header / 2 + 4}>
        redis
      </text>
      {w >= 300 && (
        <text className={css.mono} x={72} y={header / 2 + 4}>
          10.0.2.6
        </text>
      )}
      <text className={css.mono} x={w - 12} y={header / 2 + 4} textAnchor="end" style={{ fill: 'var(--text-2)' }}>
        {status}
      </text>
      <line x1={8} x2={w - 8} y1={header} y2={header} stroke="rgba(143,166,201,0.16)" />

      {empty.map((i) => (
        <rect
          key={`e${i}`}
          x={7}
          y={header + 4 + i * rowH + 1}
          width={w - 14}
          height={rowH - 4}
          rx={4}
          fill="none"
          stroke="rgba(143,166,201,0.16)"
          strokeDasharray="3 4"
        />
      ))}
      {!rows.length && !down && (
        <text className={css.mono} x={w / 2} y={header + 4 + Math.min(cap, 3) * rowH * 0.5 + 4} textAnchor="middle" style={{ fill: 'var(--text-3)' }}>
          empty (cold): every read misses
        </text>
      )}

      {drawOrder.map((e) => {
        const i = rank.get(e.key) ?? 0;
        return (
          <Row
            key={e.key}
            e={e}
            index={byPolicy ? i : null}
            sim={sim}
            w={w}
            header={header}
            rowH={rowH}
            fs={fs}
            victim={byPolicy && full && i === rows.length - 1 && cfg.predict !== 'evict'}
            pick={!!pickRows}
            onClick={onRowClick}
            lit={hl === e.key}
          />
        );
      })}

      {/* Keys on their way out, drawn over the rows sliding into their place, then fading. */}
      {sim.ghosts.map((gh, i) => (
        <GhostRow key={`g${gh.key}-${i}`} gh={gh} sim={sim} w={w} header={header} rowH={rowH} fs={fs} />
      ))}

      {down && <rect width={w} height={h} rx={10} fill="url(#kit-hatch)" pointerEvents="none" />}
    </g>
  );
}

function Row({
  e,
  index,
  sim,
  w,
  header,
  rowH,
  fs,
  victim,
  pick,
  onClick,
  lit,
}: {
  e: Entry;
  /** Rank in eviction order (drawn as 1..n), or null when rows keep fixed slots */
  index: number | null;
  sim: CacheSim;
  w: number;
  header: number;
  rowH: number;
  fs: number;
  victim: boolean;
  pick: boolean;
  onClick?: (key: number) => void;
  lit: boolean;
}) {
  const cfg = sim.cfg;
  const y = header + 4 + e.ry * rowH;
  const rh = rowH - 4;
  const cy = rh / 2 + 1;
  const portrait = sim.orient === 'portrait';
  const stale = sim.isStale(e);
  const flashK = e.flash ? clamp(1 - (sim.vt - e.flash.vt) / 0.8, 0, 1) : 0;
  const flashColor = e.flash?.kind === 'hit' ? SIG.res : SIG.hc;
  const keyX = 26;
  const keyW = fs * 0.6 * 10;
  const valX = keyX + keyW + 10;
  const showTtl = cfg.showTtl && e.ttl > 0;
  const barW = portrait ? 58 : 74;
  const barX = w - 12 - barW;
  const left = showTtl ? clamp((e.expiresAt - sim.t) / e.ttl, 0, 1) : 1;
  const barColor = left > 0.5 ? SIG.res : left > 0.2 ? SIG.warn : SIG.err;
  const secs = showTtl ? Math.max(0, Math.ceil(e.expiresAt - sim.t)) : 0;
  const tagX = valX + fs * 0.6 * 5 + 4;
  const clickable = pick && !!onClick;
  return (
    <g
      className={`${css.row} ${clickable ? css.pick : ''}`}
      transform={`translate(0,${y})`}
      opacity={e.alpha}
      onClick={clickable ? () => onClick?.(e.key) : undefined}
      role={clickable ? 'button' : undefined}
      aria-label={clickable ? `Evict ${keyName(e.key)}` : undefined}
    >
      <rect x={7} y={1} width={w - 14} height={rh} rx={4} fill="#0e1729" />
      <rect x={7} y={1} width={w - 14} height={rh} rx={4} fill={stale ? 'rgba(255,77,106,0.1)' : 'rgba(143,166,201,0.04)'} stroke={stale ? 'rgba(255,77,106,0.5)' : 'rgba(143,166,201,0.16)'} />
      {flashK > 0 && <rect x={7} y={1} width={w - 14} height={rh} rx={4} fill={flashColor} opacity={0.26 * flashK} />}
      {clickable && <rect className={css.pickRing} x={5} y={-1} width={w - 10} height={rh + 4} rx={5} fill="transparent" stroke="var(--accent)" strokeWidth={1.4} />}
      {lit && <rect x={3} y={-3} width={w - 6} height={rh + 8} rx={6} fill="none" stroke="var(--accent)" strokeWidth={1.3} strokeDasharray="3 3" />}
      {index != null && (
        <text className={css.val} x={16} y={cy + fs * 0.36} textAnchor="middle" style={{ fontSize: fs - 2, fill: 'var(--text-3)' }}>
          {index + 1}
        </text>
      )}
      <text className={css.key} x={keyX} y={cy + fs * 0.36} style={{ fontSize: fs, fill: e.key === HOT ? SIG.res : undefined }}>
        {keyName(e.key)}
      </text>
      <text className={css.val} x={valX} y={cy + fs * 0.36} style={{ fontSize: fs, fill: stale ? SIG.err : e.dirty ? SIG.heavy : undefined }}>
        ${e.price}
      </text>
      {stale && <Tag x={tagX} y={cy} text="stale" color={SIG.err} />}
      {e.dirty && <Tag x={tagX} y={cy} text="dirty" color={SIG.heavy} />}
      {victim && !stale && !e.dirty && <Tag x={tagX} y={cy} text={portrait || showTtl ? 'next out' : 'evicted next'} color="rgba(255,77,106,0.9)" />}
      {cfg.showFreq && (
        <text className={css.val} x={showTtl ? barX - 30 : w - 14} y={cy + fs * 0.36} textAnchor="end" style={{ fontSize: fs - 0.5, fill: SIG.hc }}>
          ×{e.freq}
        </text>
      )}
      {showTtl && (
        <g>
          <text className={css.val} x={barX - 6} y={cy + (fs - 1.5) * 0.36} textAnchor="end" style={{ fontSize: fs - 1.5, fill: barColor }}>
            {secs}s
          </text>
          <rect x={barX} y={cy - 2.5} width={barW} height={5} rx={2.5} fill="rgba(143,166,201,0.14)" />
          <rect x={barX} y={cy - 2.5} width={Math.max(0, barW * left)} height={5} rx={2.5} fill={barColor} opacity={0.9} />
        </g>
      )}
    </g>
  );
}

function Tag({ x, y, text, color }: { x: number; y: number; text: string; color: string }) {
  const w = text.length * 5.6 + 10;
  return (
    <g transform={`translate(${x},${y})`}>
      <rect x={0} y={-6.5} width={w} height={13} rx={3} fill="rgba(7,11,20,0.7)" stroke={color} strokeOpacity={0.7} />
      <text className={css.tag} x={w / 2} y={3} textAnchor="middle" style={{ fill: color }}>
        {text}
      </text>
    </g>
  );
}

const GHOST: Record<Ghost['kind'], { color: string; text: string }> = {
  evict: { color: SIG.err, text: 'evicted' },
  expire: { color: SIG.warn, text: 'expired' },
  del: { color: SIG.hc, text: 'deleted' },
  lost: { color: SIG.err, text: 'lost' },
};

function GhostRow({ gh, sim, w, header, rowH, fs }: { gh: Ghost; sim: CacheSim; w: number; header: number; rowH: number; fs: number }) {
  const k = clamp((sim.vt - gh.vt) / GHOST_S, 0, 1);
  const y = header + 4 + gh.ry * rowH;
  const rh = rowH - 4;
  const cy = rh / 2 + 1;
  const style = GHOST[gh.kind];
  const dx = k * 12;
  const keyW = fs * 0.6 * 10;
  return (
    <g transform={`translate(${dx},${y})`} opacity={(1 - k) * 0.95} pointerEvents="none">
      <rect x={7} y={1} width={w - 14 - dx} height={rh} rx={4} fill="rgba(7,11,20,0.85)" stroke={style.color} strokeOpacity={0.8} />
      <text className={css.key} x={26} y={cy + fs * 0.36} style={{ fontSize: fs, fill: style.color }}>
        {keyName(gh.key)}
      </text>
      <line x1={24} x2={26 + keyW + 2} y1={cy} y2={cy} stroke={style.color} strokeWidth={1.2} />
      <text className={css.tag} x={w - 16 - dx} y={cy + 3} textAnchor="end" style={{ fill: style.color, fontSize: 9 }}>
        {gh.dirty && gh.kind === 'lost' ? 'unsaved write lost' : style.text}
      </text>
    </g>
  );
}

/* ------------------------------------------------------------------ */
/* Packets                                                             */
/* ------------------------------------------------------------------ */

/**
 * Which packet labels to show. Requests only get a label when traffic is slow
 * enough to read it; responses show their timing mid-trip, away from the
 * crowded spot where everything leaves the app.
 */
function labelVisible(sim: CacheSim, tag: string | undefined, progress: number) {
  if (tag === 'req') return sim.cfg.sequential || sim.cfg.tour;
  // At high traffic the hits' "1 ms" labels are noise; the slow and stale ones are the story.
  if (tag === 'resp-fast' && sim.cfg.rps >= 4) return false;
  if (tag === 'resp-fast' || tag === 'resp-slow' || tag === 'stale') return progress > 0.2 && progress < 0.93;
  return true;
}

export function CacheFlights({ sim }: { sim: CacheSim }) {
  return (
    <g>
      {sim.flightViews().map((p) => {
        const labelColor = p.tag === 'resp-slow' ? SIG.heavy : p.color;
        const showLabel = !!p.label && labelVisible(sim, p.tag, p.progress);
        const body =
          p.shape === 'square' ? (
            <rect x={p.x - 4.6} y={p.y - 4.6} width={9.2} height={9.2} rx={1.5} fill={p.color} transform={`rotate(${(p.angle * 180) / Math.PI} ${p.x} ${p.y})`} />
          ) : (
            <circle cx={p.x} cy={p.y} r={p.r} fill={p.color} />
          );
        return (
          <g key={p.id} pointerEvents="none">
            {p.trail && <line x1={p.tx} y1={p.ty} x2={p.x} y2={p.y} stroke={p.color} strokeWidth={p.r * 1.25} strokeLinecap="round" opacity={0.26} />}
            <circle cx={p.x} cy={p.y} r={p.r * 2.5} fill={p.color} opacity={0.13} />
            {body}
            {showLabel && <FlightLabel x={p.x} y={p.y - p.r - 9} text={p.label ?? ""} color={labelColor} />}
          </g>
        );
      })}
    </g>
  );
}

function FlightLabel({ x, y, text, color }: { x: number; y: number; text: string; color: string }) {
  const w = text.length * 6 + 10;
  return (
    <g transform={`translate(${x},${y})`}>
      <rect x={-w / 2} y={-8} width={w} height={14} rx={7} fill="rgba(7,11,20,0.9)" stroke={color} strokeOpacity={0.7} />
      <text className={css.flightLabel} x={0} y={2.5} textAnchor="middle" fill={color}>
        {text}
      </text>
    </g>
  );
}

/* ------------------------------------------------------------------ */
/* Layers view: caches all the way down                                */
/* ------------------------------------------------------------------ */

export const LAYERS = [
  {
    name: 'Browser cache',
    where: 'on Alice’s device · just for her',
    holds: 'JS, CSS, images, cacheable API replies',
    hit: '0 ms: no network',
    inval: 'can’t reach it: wait out max-age',
  },
  { name: 'CDN edge', where: 'a server in her city · shared', holds: 'images, video, JS, CSS, public pages', hit: '≈ 10–40 ms away', inval: 'purge by API, takes seconds' },
  { name: 'App memory', where: 'inside each app process', holds: 'config, feature flags, tiny hot lookups', hit: '≈ 0.0001 ms', inval: 'every server has its own copy' },
  { name: 'Redis / Memcached', where: 'one copy, shared by all app servers', holds: 'sessions, products, rendered fragments', hit: '≈ 1 ms', inval: 'DEL the key' },
  { name: 'Postgres buffer pool', where: 'RAM inside the database', holds: 'table and index pages, 8 KB each', hit: 'no disk read', inval: 'automatic' },
];

function LayersScene({ sim, highlight }: { sim: CacheSim; highlight?: string | null }) {
  const bg = sim.bandGeom;
  const portrait = sim.orient === 'portrait';
  const user = sim.boxes.get('user');
  const cur = sim.layer.current;
  return (
    <>
      <Wires sim={sim} />
      {LAYERS.map((L, i) => {
        const y = bg.top + i * (bg.h + bg.gap);
        const lit = sim.layer.lit.find((l) => l.band === i);
        const k = lit ? clamp(1 - (sim.vt - lit.vt) / (lit.kind === 'hit' ? 2.6 : 0.9), 0, 1) : 0;
        const hitNow = lit?.kind === 'hit';
        const stroke = hitNow ? `rgba(75,227,160,${0.35 + 0.6 * k})` : lit ? `rgba(143,166,201,${0.22 + 0.3 * k})` : 'rgba(143,166,201,0.22)';
        const port = sim.boxes.get(`L${i}`);
        const tx = portrait ? 58 : 84;
        const glow = highlight === `band:${i}`;
        return (
          <g key={L.name}>
            <rect
              x={bg.x0}
              y={y}
              width={bg.x1 - bg.x0}
              height={bg.h}
              rx={10}
              fill={hitNow ? `rgba(75,227,160,${0.04 + 0.08 * k})` : 'rgba(11,19,36,0.72)'}
              stroke={stroke}
              strokeWidth={1.2}
            />
            {glow && <rect x={bg.x0 - 5} y={y - 5} width={bg.x1 - bg.x0 + 10} height={bg.h + 10} rx={14} fill="none" stroke="var(--accent)" strokeWidth={1.4} strokeDasharray="3 3" />}
            <text className={css.caps} x={bg.x1 - 12} y={y + 16} textAnchor="end" style={{ fontSize: 8.5 }}>
              layer {i + 1}
            </text>
            <text className={css.bandTitle} x={tx} y={y + (portrait ? bg.h / 2 - 6 : bg.h / 2 - 8)} style={portrait ? { fontSize: 13 } : undefined}>
              {L.name}
            </text>
            <text className={css.bandSub} x={tx} y={y + (portrait ? bg.h / 2 + 9 : bg.h / 2 + 8)} style={portrait ? { fontSize: 9.5 } : undefined}>
              {portrait ? L.hit : L.where}
            </text>
            {!portrait && (
              <text className={css.bandSub} x={tx} y={y + bg.h / 2 + 23} style={{ fill: 'rgba(143,166,201,0.62)' }}>
                invalidate: {L.inval}
              </text>
            )}
            {!portrait && bg.x1 - bg.x0 > 760 && (
              <text className={css.bandSub} x={bg.x0 + (bg.x1 - bg.x0) * 0.47} y={y + bg.h / 2 + 4} style={{ fill: 'var(--text-2)' }}>
                holds: {L.holds}
              </text>
            )}
            {!portrait && (
              <text className={css.monoStrong} x={bg.x1 - 16} y={y + bg.h / 2 + 8} textAnchor="end" style={{ fill: i < 2 ? 'var(--text-1)' : i === 3 ? SIG.res : 'var(--text-1)' }}>
                {L.hit}
              </text>
            )}
            {sim.layer.hits[i] > 0 && (
              <text className={css.bandSub} x={bg.x1 - 12} y={y + bg.h - 10} textAnchor="end" style={{ fill: SIG.res }}>
                {sim.layer.hits[i]} hit{sim.layer.hits[i] > 1 ? 's' : ''}
              </text>
            )}
            {lit && k > 0.05 && (
              <text
                className={css.tag}
                x={portrait ? tx : bg.x1 - 12}
                y={y + (portrait ? 15 : 30)}
                textAnchor={portrait ? 'start' : 'end'}
                style={{ fill: hitNow ? SIG.res : 'var(--text-3)', opacity: Math.min(1, k * 2) }}
              >
                {hitNow ? 'hit: answered here' : 'miss: ask the next layer'}
              </text>
            )}
            {port && !Number.isNaN(port.x) && (
              <circle cx={port.x} cy={port.y} r={6} fill="var(--ink-1)" stroke={hitNow ? SIG.res : 'rgba(143,166,201,0.55)'} strokeWidth={1.3} />
            )}
          </g>
        );
      })}
      {user && <ClientCard box={user} name="Alice’s browser" sub={cur ? cur.path : 'shop.example'} color={SHOPPERS[0].color} />}
      <CacheFlights sim={sim} />
      <Effects sim={sim} />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Sequence view: the slow reader races the writer                     */
/* ------------------------------------------------------------------ */

function RaceSequence({ sim }: { sim: CacheSim }) {
  const portrait = sim.orient === 'portrait';
  const x = portrait ? 8 : 36;
  const y = portrait ? 76 : 84;
  const w = sim.w - x * 2;
  const h = sim.h - y - (portrait ? 64 : 104);
  const bodyH = h - 50;
  // Fit the whole story (RACE_END seconds) without scrolling, then hold the last frame.
  const pxPerSec = Math.max(24, (bodyH - 64) / RACE_END);
  return (
    <SequenceDiagram
      x={x}
      y={y}
      w={w}
      h={h}
      now={Math.min(sim.stepT, RACE_END)}
      actors={raceActors(portrait)}
      messages={raceMessages(portrait)}
      notes={raceNotes(portrait)}
      spans={raceSpans(portrait)}
      pxPerSec={pxPerSec}
    />
  );
}
