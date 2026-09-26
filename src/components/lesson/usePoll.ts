'use client';

import { useEffect, useReducer } from 'react';

/**
 * Re-render a panel card while the simulation runs. With `onlyOnChange`, it
 * skips renders until the sim reports a UI-relevant change.
 */
export function usePoll(world: { rev: number }, ms = 200, onlyOnChange = false) {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    let seen = -1;
    const id = window.setInterval(() => {
      if (onlyOnChange && world.rev === seen) return;
      seen = world.rev;
      force();
    }, ms);
    return () => window.clearInterval(id);
  }, [world, ms, onlyOnChange]);
}
