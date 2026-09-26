import { SIG } from '@/lib/sim/colors';
import type { Box } from '@/lib/sim/Sim';
import { ClientCard, Effects, Flights, NodeCard, Wires } from '@/components/stage/svg';
import stage from '@/components/stage/stage.module.css';
import type { TcpSim } from './sim';

/* Chapter 1: packets crossing a mesh of routers. */

function RouterNode({ box, name, dim, glow }: { box: Box; name: string; dim?: boolean; glow?: boolean }) {
  const r = Math.min(box.w, box.h) / 2;
  return (
    <g transform={`translate(${box.x},${box.y})`} opacity={box.alpha * (dim ? 0.3 : 1)}>
      {glow && <circle r={r + 7} fill="none" stroke="var(--accent)" strokeWidth={1.4} strokeDasharray="3 3" />}
      <circle r={r} className={stage.card} />
      <circle r={r - 4} fill="none" stroke="rgba(143,166,201,0.14)" />
      <g stroke="rgba(143,166,201,0.85)" strokeWidth={1.3} strokeLinecap="round" fill="none">
        <path d={`M${-r * 0.42},${-r * 0.16} H${r * 0.38} M${r * 0.2},${-r * 0.32} L${r * 0.38},${-r * 0.16} L${r * 0.2},0`} />
        <path d={`M${r * 0.42},${r * 0.2} H${-r * 0.38} M${-r * 0.2},${r * 0.04} L${-r * 0.38},${r * 0.2} L${-r * 0.2},${r * 0.36}`} />
      </g>
      <text className={stage.caps} y={r + 13} textAnchor="middle">
        {name}
      </text>
    </g>
  );
}

const ROUTE: Record<string, [string, string]> = {
  r2: ['R2 · short route', 'R2 · short'],
  r3: ['R3 · long route', 'R3 · long'],
};

export function NetScene({ sim, hl }: { sim: TcpSim; hl: string | null }) {
  const a = sim.boxes.get('alice');
  const s = sim.boxes.get('srv');
  const r = ['r1', 'r2', 'r3', 'r4'].map((id) => sim.boxes.get(id));
  const port = sim.orient === 'portrait';
  return (
    <g>
      <Wires sim={sim} />
      {r.map((b, i) => b && <RouterNode key={b.id} box={b} name={ROUTE[b.id]?.[port ? 1 : 0] ?? `R${i + 1}`} glow={hl === 'routers' || hl === b.id} />)}
      {a && <ClientCard box={a} name="Alice" sub="198.51.100.42" color={SIG.pink} glow={hl === 'client'} />}
      {s && <NodeCard box={s} title="photos.example" sub="203.0.113.10" led="up" glow={hl === 'server'} />}
      <Flights sim={sim} />
      <Effects sim={sim} />
    </g>
  );
}
