'use client';

import { BinaryScene } from './scenes/Binary';
import { ChartScene } from './scenes/Chart';
import { ClassifyScene } from './scenes/Classify';
import { ConstantScene } from './scenes/Constant';
import { FibScene } from './scenes/Fib';
import { GridScene } from './scenes/Grid';
import { LapseScene } from './scenes/Lapse';
import { MergeScene } from './scenes/Merge';
import { RaceScene } from './scenes/Race';
import { ScanScene } from './scenes/Scan';
import type { BigOSim } from './sim';

export function Scene({ sim, highlight }: { sim: BigOSim; highlight: string | null }) {
  const hl = highlight;
  switch (sim.cfg.view) {
    case 'race':
      return <RaceScene sim={sim} hl={hl} />;
    case 'scan':
      return <ScanScene sim={sim} hl={hl} />;
    case 'constant':
      return <ConstantScene sim={sim} hl={hl} />;
    case 'binary':
      return <BinaryScene sim={sim} hl={hl} />;
    case 'merge':
      return <MergeScene sim={sim} hl={hl} />;
    case 'grid':
      return <GridScene sim={sim} hl={hl} />;
    case 'fib':
      return <FibScene sim={sim} hl={hl} />;
    case 'chart':
      return <ChartScene sim={sim} hl={hl} />;
    case 'lapse':
      return <LapseScene sim={sim} hl={hl} />;
    case 'classify':
      return <ClassifyScene sim={sim} />;
    default:
      return null;
  }
}
