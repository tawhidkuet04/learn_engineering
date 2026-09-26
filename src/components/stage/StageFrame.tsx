'use client';

import { useEffect, useReducer, useRef, type ReactNode } from 'react';
import type { Sim } from '@/lib/sim/Sim';
import { KitDefs, RegistrationMarks } from './svg';
import css from './stage.module.css';

export interface StageFrameProps {
  sim: Sim;
  playing: boolean;
  speed: number;
  /** Accessible name for the animation region */
  label: string;
  /** SVG content, re-rendered every frame. Coordinates are CSS pixels of the stage. */
  svg: () => ReactNode;
  /** HTML overlay content (cards, prompts, HUD), re-rendered every frame. */
  overlay?: () => ReactNode;
  className?: string;
}

/**
 * The blueprint "sheet" every lesson animates on. It measures itself, tells
 * the sim its size, and runs the animation loop (pausing while off-screen).
 */
export function StageFrame({ sim, playing, speed, label, svg, overlay, className }: StageFrameProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [, redraw] = useReducer((x: number) => (x + 1) % 1_000_000, 0);
  const live = useRef({ playing, speed, onScreen: true });

  useEffect(() => {
    live.current.playing = playing;
    live.current.speed = speed;
  }, [playing, speed]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      sim.setSize(Math.round(r.width), Math.round(r.height));
      redraw();
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    const io = new IntersectionObserver(([e]) => {
      live.current.onScreen = e.isIntersecting;
    });
    io.observe(el);
    return () => {
      ro.disconnect();
      io.disconnect();
    };
  }, [sim]);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      if (live.current.onScreen) {
        sim.advance(dt, live.current.playing, live.current.speed);
        redraw();
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [sim]);

  return (
    <div ref={ref} className={`${css.stage} ${className ?? ''}`} role="region" aria-label={label}>
      {sim.sized && (
        <>
          <svg className={css.svg} width={sim.w} height={sim.h} viewBox={`0 0 ${sim.w} ${sim.h}`} aria-hidden>
            <KitDefs />
            <RegistrationMarks w={sim.w} h={sim.h} />
            {svg()}
          </svg>
          <div className={css.overlay}>{overlay?.()}</div>
        </>
      )}
    </div>
  );
}
