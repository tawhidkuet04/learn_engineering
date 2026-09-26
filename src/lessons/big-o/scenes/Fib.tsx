'use client';

import type { ReactNode } from 'react';
import { SIG } from '@/lib/sim/colors';
import type { BigOSim } from '../sim';
import css from '../bigo.module.css';

const CALL = SIG.req;
const WASTE = SIG.heavy;
const HIT = SIG.res;
const STACK = SIG.warn;

export function FibScene({ sim, hl }: { sim: BigOSim; hl: string | null }) {
  const f = sim.fib;
  const land = sim.orient === 'landscape';
  const stack = f.stack();
  const morph = Math.max(0, 1 - (sim.vt - f.morphVt) / 1.2);

  const edges: ReactNode[] = [];
  const nodes: ReactNode[] = [];
  for (const nd of f.nodes) {
    const b = sim.boxes.get(nd.id);
    if (!b || Number.isNaN(b.x) || b.alpha < 0.01) continue;
    const r = b.w / 2;
    const p = nd.parent ? sim.boxes.get(nd.parent) : null;
    const hit = f.memo && nd.hit;
    const wasted = !f.memo && nd.wasted;
    const onStack = stack.has(nd.id);
    if (p && !Number.isNaN(p.x)) {
      const dx = b.x - p.x;
      const dy = b.y - p.y;
      const d = Math.hypot(dx, dy) || 1;
      const pr = p.w / 2;
      edges.push(
        <line
          key={`e${nd.id}`}
          x1={p.x + (dx / d) * pr}
          y1={p.y + (dy / d) * pr}
          x2={b.x - (dx / d) * r}
          y2={b.y - (dy / d) * r}
          stroke={onStack ? STACK : wasted ? 'rgba(255,154,60,0.45)' : 'rgba(143,166,201,0.4)'}
          strokeWidth={onStack ? 1.8 : 1.2}
          strokeDasharray={hit ? '3 3' : undefined}
          opacity={Math.min(b.alpha, p.alpha)}
        />,
      );
    }
    const stroke = onStack ? STACK : hit ? HIT : wasted ? WASTE : nd.k < 2 ? 'rgba(69,213,255,0.55)' : CALL;
    const fill = hit ? 'rgba(75,227,160,0.16)' : wasted ? 'rgba(255,154,60,0.12)' : onStack ? 'rgba(255,210,63,0.12)' : 'var(--node-fill)';
    const glow = (hl === 'repeats' && wasted) || (hl === 'hits' && hit) || (hl === 'root' && nd.pre === 0);
    nodes.push(
      <g key={nd.id} opacity={b.alpha}>
        {glow && <circle cx={b.x} cy={b.y} r={r + 5} fill="none" stroke="var(--accent)" strokeDasharray="3 3" />}
        {onStack && nd === f.top && <circle cx={b.x} cy={b.y} r={r + 7} fill={STACK} opacity={0.12} />}
        {hit && morph > 0 && <circle cx={b.x} cy={b.y} r={r + 4 + (1 - morph) * 14} fill="none" stroke={HIT} strokeWidth={2 * morph} opacity={morph} />}
        <circle cx={b.x} cy={b.y} r={r} fill={fill} stroke={stroke} strokeWidth={onStack ? 2 : 1.4} />
        <text className={css.cellText} x={b.x} y={b.y + (land ? 4.5 : 3.8)} textAnchor="middle" style={{ fontSize: land ? (r < 14 ? 10.5 : 12.5) : r < 9 ? 8.5 : 10.5, fill: hit ? HIT : wasted ? '#ffc38a' : 'var(--text-1)' }}>
          {nd.k}
        </text>
        {hit && land && (
          <text className={`${css.mono} ${css.halo}`} x={b.x} y={b.y + r + 12} textAnchor="middle" style={{ fill: HIT, fontSize: 9 }}>
            memo
          </text>
        )}
      </g>,
    );
  }

  const root = sim.boxes.get('fib:root');
  return (
    <g>
      {edges}
      {nodes}
      {root && land && (
        <text className={`${css.monoStrong} ${css.halo}`} x={root.x - root.w / 2 - 12} y={root.y + 4} textAnchor="end" style={{ fill: 'var(--text-2)', fontSize: 12 }}>
          fib({f.n})
        </text>
      )}
    </g>
  );
}
