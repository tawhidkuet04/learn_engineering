'use client';

import { useEffect, useRef, useState } from 'react';

const GLYPHS = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789/<>#*=+';

/** Re-types its text through random glyphs whenever it changes, like a split-flap board. */
export function ScrambleText({ text, duration = 520 }: { text: string; duration?: number }) {
  const [out, setOut] = useState(text);
  const prev = useRef(text);

  useEffect(() => {
    if (prev.current === text) return;
    prev.current = text;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const k = reduce ? 1 : Math.min(1, (now - start) / duration);
      const reveal = Math.floor(k * text.length);
      let s = '';
      for (let i = 0; i < text.length; i++) {
        s += i < reveal || text[i] === ' ' ? text[i] : GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
      }
      setOut(s);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [text, duration]);

  return <span aria-label={text}>{out}</span>;
}
