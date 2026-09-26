'use client';

import { createContext, useContext, type ReactNode } from 'react';

/** Lets words in the narration light up the thing they name on the stage. */
export const HighlightContext = createContext<(key: string | null) => void>(() => {});

export function Term({ k, children }: { k: string; children: ReactNode }) {
  const set = useContext(HighlightContext);
  return (
    <span
      className="term"
      tabIndex={0}
      onMouseEnter={() => set(k)}
      onMouseLeave={() => set(null)}
      onFocus={() => set(k)}
      onBlur={() => set(null)}
    >
      {children}
    </span>
  );
}
