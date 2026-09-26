import { SIG } from '@/lib/sim/colors';
import { clamp } from '@/lib/sim/geometry';
import type { Box } from '@/lib/sim/Sim';
import { Cylinder, NodeCard, Rack } from '@/components/stage/svg';
import { fmtClock, GATEWAYS, type ClientState, type RateSim } from '../sim';
import css from './rl.module.css';

const OK = SIG.res;
const BAD = SIG.err;

function Glow({ w, h, rx = 12 }: { w: number; h: number; rx?: number }) {
  return <rect x={-6} y={-6} width={w + 12} height={h + 12} rx={rx} fill="none" stroke="var(--accent)" strokeWidth={1.4} strokeDasharray="3 3" />;
}

/** A person (or bot) calling the API, with a running tally of what came back. */
export function ClientNode({ sim, c, box, dim, glow }: { sim: RateSim; c: ClientState; box: Box; dim?: boolean; glow?: boolean }) {
  if (Number.isNaN(box.x)) return null;
  const L = sim.orient === 'landscape';
  const { w, h } = box;
  const narrow = w < 118;
  const ar = narrow ? 9 : 11;
  const ax = narrow ? 15 : 20;
  const tx = ax + ar + 8;
  const k = clamp((sim.vt - c.pulseVt) / 0.6, 0, 1);
  const bot = c.id === 'bot';
  const showIp = w >= 108;
  return (
    <g transform={`translate(${box.x - w / 2},${box.y - h / 2})`} opacity={box.alpha * (dim ? 0.28 : 1)}>
      {glow && <Glow w={w} h={h} />}
      <rect className={css.cardPlain} width={w} height={h} rx={9} style={bot ? { stroke: 'rgba(255,154,60,0.7)' } : undefined} />
      <circle cx={ax} cy={h / 2} r={ar} fill={c.color} fillOpacity={0.14} stroke={c.color} strokeWidth={1.2} />
      {bot ? (
        <g transform={`translate(${ax},${h / 2})`} stroke={c.color} strokeWidth={1.2} fill="none" strokeLinecap="round">
          <rect x={-4.5} y={-3} width={9} height={7} rx={2} />
          <line x1={0} y1={-3} x2={0} y2={-6} />
          <circle cx={-1.8} cy={0.5} r={0.6} fill={c.color} />
          <circle cx={1.8} cy={0.5} r={0.6} fill={c.color} />
        </g>
      ) : (
        <text x={ax} y={h / 2 + 4} textAnchor="middle" fill={c.color} style={{ fontFamily: 'var(--font-sans)', fontSize: 11, fontWeight: 600 }}>
          {c.name[0]}
        </text>
      )}
      {k < 1 && <circle cx={ax} cy={h / 2} r={ar + k * 11} fill="none" stroke={c.pulseColor} strokeWidth={2 * (1 - k)} opacity={1 - k} />}
      <text className={css.title} x={tx} y={showIp ? h / 2 - 2 : h / 2 + 4} style={narrow ? { fontSize: 11.5 } : undefined}>
        {c.name}
      </text>
      {showIp && (
        <text className={css.monoDim} x={tx} y={h / 2 + 11} style={{ fontSize: narrow ? 8.5 : 9.5 }}>
          {c.ip}
        </text>
      )}
      {c.sent > 0 && (
        <text className={css.tally} x={L ? 4 : w / 2} y={h + (L ? 14 : 12)} textAnchor={L ? 'start' : 'middle'} style={{ fontSize: L ? 9.5 : 9 }}>
          <tspan style={{ fill: OK }}>{c.ok} ok</tspan>
          {c.limited > 0 && <tspan style={{ fill: BAD }}>{` · ${c.limited} × 429`}</tspan>}
          {c.failed > 0 && <tspan style={{ fill: BAD }}>{` · ${c.failed} × 503`}</tspan>}
        </text>
      )}
    </g>
  );
}

/** A phone running your app (the retry-storm scene). */
export function DeviceNode({ sim, c, box, dim }: { sim: RateSim; c: ClientState; box: Box; dim?: boolean }) {
  if (Number.isNaN(box.x)) return null;
  const L = sim.orient === 'landscape';
  const { w, h } = box;
  const k = clamp((sim.vt - c.pulseVt) / 0.6, 0, 1);
  const status = c.waiting ? (c.attempt > 0 ? `retry ${c.attempt}` : 'sending') : c.sent > 0 ? 'done' : '';
  const statusColor = c.waiting ? (c.attempt > 0 ? SIG.warn : SIG.text2) : OK;
  return (
    <g transform={`translate(${box.x - w / 2},${box.y - h / 2})`} opacity={box.alpha * (dim ? 0.28 : 1)}>
      <rect className={css.cardPlain} width={w} height={h} rx={7} style={c.waiting && c.attempt > 0 ? { stroke: 'rgba(255,210,63,0.55)' } : undefined} />
      <g transform={`translate(${L ? 14 : w / 2},${L ? h / 2 : 11})`}>
        <rect x={-4.5} y={-7} width={9} height={14} rx={2} fill="none" stroke={c.color} strokeWidth={1.2} />
        <line x1={-1.5} y1={4.2} x2={1.5} y2={4.2} stroke={c.color} strokeWidth={1.1} strokeLinecap="round" />
        {k < 1 && <circle r={9 + k * 9} fill="none" stroke={c.pulseColor} strokeWidth={1.8 * (1 - k)} opacity={1 - k} />}
      </g>
      {L ? (
        <>
          <text className={css.title} x={28} y={h / 2 + 4} style={{ fontSize: 11.5 }}>
            {c.name}
          </text>
          <text className={css.tally} x={w - 8} y={h / 2 + 3.5} textAnchor="end" style={{ fill: statusColor }}>
            {status}
          </text>
        </>
      ) : (
        <text className={css.tally} x={w / 2} y={h - 5} textAnchor="middle" style={{ fill: status ? statusColor : 'var(--text-3)', fontSize: 8.5 }}>
          {status || c.name}
        </text>
      )}
    </g>
  );
}

/** The API server: a rack of worker slots plus its waiting room. */
export function ServerNode({ sim, box, dim, glow }: { sim: RateSim; box: Box; dim?: boolean; glow?: boolean }) {
  if (Number.isNaN(box.x)) return null;
  const units = sim.jobs.map((j) =>
    j ? { busy: true, p: clamp((sim.t - j.start) / Math.max(0.01, j.end - j.start), 0, 1), color: j.color } : { busy: false, p: 0, color: SIG.req },
  );
  const full = sim.waiting.length >= sim.cfg.queueCap;
  const showQueue = sim.cfg.workers <= 2 || sim.waiting.length > 0;
  const L = sim.orient === 'landscape';
  const d = 10.5;
  return (
    <g>
      {showQueue && (
        <g opacity={box.alpha * (dim ? 0.28 : 1)}>
          {Array.from({ length: sim.cfg.queueCap }, (_, i) => {
            const x = box.x - box.w / 2 - 11 - i * d;
            const y = L ? box.y : box.y + 4;
            const wq = sim.waiting[i];
            return wq ? <circle key={i} cx={x} cy={y} r={3.8} fill={wq.color} /> : <circle key={i} cx={x} cy={y} r={3.4} fill="none" stroke="rgba(143,166,201,0.3)" />;
          })}
          <text className={css.caps} x={box.x - box.w / 2 - 6} y={(L ? box.y : box.y + 4) - 10} textAnchor="end" style={{ fill: full ? BAD : undefined }}>
            {full ? 'waiting room full' : 'waiting'}
          </text>
        </g>
      )}
      <Rack box={box} title="api-1" sub="10.0.2.10" units={units} dim={dim} glow={glow} state={full ? 'hot' : 'normal'} />
    </g>
  );
}

export function LBNode({ box, dim, glow }: { box: Box; dim?: boolean; glow?: boolean }) {
  if (Number.isNaN(box.x)) return null;
  return (
    <NodeCard
      box={box}
      title="load balancer"
      sub="203.0.113.10"
      dim={dim}
      glow={glow}
      icon={
        <g stroke="#b59bff" strokeWidth={1.4} fill="none" strokeLinecap="round">
          <path d="M-7,0 H-1" />
          <path d="M-1,0 C3,0 3,-6 8,-6" />
          <path d="M-1,0 H8" />
          <path d="M-1,0 C3,0 3,6 8,6" />
        </g>
      }
    />
  );
}

/** A gateway instance with its own limiter (distributed scene). */
export function GatewayNode({ sim, id, box, dim, glow }: { sim: RateSim; id: string; box: Box; dim?: boolean; glow?: boolean }) {
  if (Number.isNaN(box.x)) return null;
  const L = sim.orient === 'landscape';
  const { w, h } = box;
  const redis = sim.cfg.store === 'redis';
  const p = sim.params;
  const idx = GATEWAYS.indexOf(id) + 1;
  const last = sim.last && sim.last.node === id ? sim.last : null;
  const flash = last ? clamp(1 - (sim.vt - last.vt) / 0.5, 0, 1) : 0;
  const keys = [...sim.clients.keys()];
  const win = Math.floor(sim.lt / p.window + 1e-9);
  const rowH = L ? 20 : 17;
  const top = L ? 40 : 30;
  const size = L ? 11 : 7;
  return (
    <g transform={`translate(${box.x - w / 2},${box.y - h / 2})`} opacity={box.alpha * (dim ? 0.28 : 1)}>
      {glow && <Glow w={w} h={h} />}
      <rect className={css.card} width={w} height={h} rx={10} />
      {flash > 0.01 && last && <rect x={-2} y={-2} width={w + 4} height={h + 4} rx={12} fill="none" stroke={last.d.ok ? OK : BAD} strokeWidth={2} opacity={flash * 0.85} />}
      <text className={css.title} x={10} y={L ? 19 : 15} style={{ fontSize: L ? 12 : 11 }}>
        gw-{idx}
      </text>
      <text className={css.algo} x={w - 9} y={L ? 18 : 14} textAnchor="end" style={{ fontSize: L ? 8.5 : 7.5 }}>
        {redis ? 'shared' : 'local'}
      </text>
      {redis ? (
        <g>
          <text className={css.mono} x={10} y={top + 6} style={{ fontSize: L ? 10 : 8.5 }}>
            {L ? 'no local count:' : 'asks Redis'}
          </text>
          {L && (
            <text className={css.mono} x={10} y={top + 22} style={{ fill: '#cdbdff' }}>
              INCR in Redis
            </text>
          )}
        </g>
      ) : (
        keys.map((k, i) => {
          const s = sim.gwKeys.get(id)?.get(k);
          const n = s && s.win === win ? s.count : 0;
          const full = n >= p.limit;
          const y = top + i * rowH;
          const color = sim.keyColor(k);
          return (
            <g key={k}>
              <circle cx={13} cy={y} r={3} fill={color} />
              {L && (
                <text className={css.monoDim} x={21} y={y + 3.5}>
                  {sim.keyLabel(k)}
                </text>
              )}
              {Array.from({ length: p.limit }, (_, j) => (
                <rect
                  key={j}
                  className={css.slot}
                  x={(L ? 80 : 21) + j * (size + 3)}
                  y={y - size / 2}
                  width={size}
                  height={size}
                  rx={2}
                  style={j < n ? { fill: full ? BAD : OK, stroke: full ? BAD : OK, fillOpacity: 0.85 } : undefined}
                />
              ))}
              {L && (
                <text className={css.mono} x={w - 10} y={y + 3.5} textAnchor="end" style={{ fill: full ? BAD : undefined }}>
                  {n}/{p.limit}
                </text>
              )}
            </g>
          );
        })
      )}
    </g>
  );
}

/** Redis, with the shared counters inside. */
export function RedisNode({ sim, box, dim, glow }: { sim: RateSim; box: Box; dim?: boolean; glow?: boolean }) {
  if (Number.isNaN(box.x)) return null;
  const L = sim.orient === 'landscape';
  const p = sim.params;
  const win = Math.floor(sim.lt / p.window + 1e-9);
  const keys = [...sim.clients.keys()];
  return (
    <Cylinder box={box} title="redis" sub={L ? '10.0.3.5:6379' : undefined} dim={dim} glow={glow} tone="rgba(181,155,255,0.75)">
      {keys.map((k, i) => {
        const s = sim.keys.get(k);
        const n = s && s.win === win ? s.count : 0;
        const y = (L ? 60 : 44) + i * (L ? 18 : 15);
        const full = n >= p.limit;
        const c = sim.clients.get(k);
        return (
          <g key={k}>
            <text className={css.monoDim} x={10} y={y} style={{ fontSize: L ? 9.5 : 8.5 }}>
              {L ? `rl:${c?.ip ?? k}` : `rl:${c?.name.toLowerCase() ?? k}`}
            </text>
            <text className={css.mono} x={box.w - 10} y={y} textAnchor="end" style={{ fill: full ? BAD : 'var(--text-1)', fontSize: L ? 10.5 : 9.5 }}>
              {n}
            </text>
          </g>
        );
      })}
      {L && (
        <text className={css.monoDim} x={10} y={box.h - 12} style={{ fontSize: 9 }}>
          expires at {fmtClock((win + 1) * p.window)}
        </text>
      )}
    </Cylinder>
  );
}
