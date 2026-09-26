'use client';

import { useState } from 'react';
import { CLIENTS } from '@/lessons/load-balancing/engine/constants';
import { World } from '@/lessons/load-balancing/engine/world';
import { Legend } from '@/lessons/load-balancing/stage/Chrome';
import { Stage } from '@/lessons/load-balancing/stage/Stage';
import css from './hero.module.css';

/** A live load balancer that runs forever on the home page, with random crashes. */
export function HeroStage() {
  const [world] = useState(
    () =>
      new World({
        clients: CLIENTS,
        servers: [{ id: 's1' }, { id: 's2' }, { id: 's3' }, { id: 's4' }],
        lb: 'single',
        algorithm: 'least',
        healthChecks: true,
        chaos: true,
        rps: 3.2,
        arrival: 'poisson',
        heavyRatio: 0.15,
        showBrain: true,
        showZones: true,
      }),
  );

  return (
    <Stage
      world={world}
      playing
      speed={1}
      clickableServers
      onServerClick={(id) => world.toggleServer(id)}
      label="A live load balancer simulation. Servers crash at random and the load balancer routes around them."
      overlay={(v) => (
        <>
          <div className={css.fig}>
            <span>fig. 1</span> a load balancer, live
          </div>
          {v.w >= 640 && <div className={css.tip}>click a server to crash it</div>}
          <Legend keys={['req', 'heavy', 'res', 'err', 'hc']} bottom={14} />
        </>
      )}
    />
  );
}
