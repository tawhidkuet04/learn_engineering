import { Effects, Flights, Wires } from '@/components/stage/svg';
import { GATEWAYS, type RateSim } from '../sim';
import { LimiterCard } from './Limiter';
import { ClientNode, DeviceNode, GatewayNode, LBNode, RedisNode, ServerNode } from './Nodes';
import { RaceScene } from './Race';
import { Strip } from './Strip';

export function Scene({ sim, focus, highlight }: { sim: RateSim; focus?: string[]; highlight: string | null }) {
  const dim = (id: string) => !!focus?.length && !focus.includes(id);
  const glow = (id: string) => highlight === id;
  if (sim.cfg.scene === 'race') return <RaceScene sim={sim} />;

  const storm = sim.cfg.scene === 'storm';
  const b = (id: string) => sim.boxes.get(id);
  const lim = b('limiter');
  const server = b('server');
  const lb = b('lb');
  const redis = b('redis');

  return (
    <>
      {sim.strip && <Strip sim={sim} rect={sim.strip} dim={dim('strip')} glow={glow('strip')} />}
      <Wires sim={sim} />
      {[...sim.clients.values()].map((c) => {
        const box = b(c.id);
        if (!box) return null;
        return storm ? <DeviceNode key={c.id} sim={sim} c={c} box={box} dim={dim(c.id) && dim('clients')} /> : <ClientNode key={c.id} sim={sim} c={c} box={box} dim={dim(c.id) && dim('clients')} glow={glow(c.id)} />;
      })}
      {lb && <LBNode box={lb} dim={dim('lb')} glow={glow('lb')} />}
      {GATEWAYS.map((g) => {
        const box = b(g);
        return box ? <GatewayNode key={g} sim={sim} id={g} box={box} dim={dim(g) && dim('gateways')} glow={glow(g) || glow('gateways')} /> : null;
      })}
      {server && <ServerNode sim={sim} box={server} dim={dim('server')} glow={glow('server')} />}
      {redis && <RedisNode sim={sim} box={redis} dim={dim('redis')} glow={glow('redis')} />}
      {lim && <LimiterCard sim={sim} box={lim} dim={dim('limiter')} glow={glow('limiter')} />}
      <Flights sim={sim} />
      <Effects sim={sim} />
    </>
  );
}
