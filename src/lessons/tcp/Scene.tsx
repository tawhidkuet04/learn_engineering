import { NetScene } from './NetView';
import { PipeScene } from './PipeView';
import { SeqScene } from './SeqView';
import type { TcpSim } from './sim';
import { Effects } from '@/components/stage/svg';

/** Draws whichever of the three views the current step uses. */
export function Scene({ sim, hl, onSegClick }: { sim: TcpSim; hl: string | null; onSegClick: (id: number) => void }) {
  if (sim.view === 'net') return <NetScene sim={sim} hl={hl} />;
  if (sim.view === 'pipe')
    return (
      <>
        <PipeScene sim={sim} hl={hl} onSegClick={onSegClick} />
        <Effects sim={sim} />
      </>
    );
  return <SeqScene sim={sim} hl={hl} onSegClick={onSegClick} />;
}
