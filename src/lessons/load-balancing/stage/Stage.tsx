'use client';

import { useEffect, useId, useReducer, useRef, type ReactNode } from 'react';
import type { LBId } from '../engine/types';
import type { View, World } from '../engine/world';
import { VIP } from '../engine/constants';
import {
  ClientNode,
  EffectTexts,
  EffectsLayer,
  LBNode,
  Packets,
  PendingDot,
  Queue,
  RedisNode,
  RegistrationMarks,
  ServerNode,
  Wires,
  Zones,
} from './nodes';
import { Brain, CalloutBoxes, CalloutLeaders, TourCard, type Callout } from './overlays';
import css from './stage.module.css';

export interface StageProps {
  world: World;
  playing: boolean;
  speed: number;
  /** Spotlight: everything else is dimmed. 'clients' | 'servers' | 'lb' | 'server:s1' | 'client:alice' | 'redis' */
  focus?: string[] | null;
  /** Element hovered in the narration, drawn with a markup ring */
  highlight?: string | null;
  callouts?: Callout[];
  stepKey?: string;
  clickableServers?: boolean;
  onServerClick?: (id: string) => void;
  onLBClick?: (id: LBId) => void;
  /** Extra overlay content that depends on the live view (HUD, title block…) */
  overlay?: (v: View) => ReactNode;
  className?: string;
  label?: string;
}

function matches(list: string[] | null | undefined, kind: string, id: string) {
  if (!list || !list.length) return false;
  return list.includes(kind) || list.includes(`${kind}s`) || list.includes(`${kind}:${id}`);
}

export function Stage({
  world,
  playing,
  speed,
  focus,
  highlight,
  callouts = [],
  stepKey = '',
  clickableServers = false,
  onServerClick,
  onLBClick,
  overlay,
  className,
  label = 'Animated load balancer simulation',
}: StageProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [, redraw] = useReducer((x: number) => (x + 1) % 1_000_000, 0);
  const live = useRef({ playing, speed, onScreen: true });
  const hatchId = `hatch-${useId().replace(/:/g, '')}`;
  const lbFillId = 'lbFill';

  useEffect(() => {
    live.current.playing = playing;
    live.current.speed = speed;
  }, [playing, speed]);

  // Match the drawing to the container's real pixel size.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      world.setSize(Math.round(r.width), Math.round(r.height));
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
  }, [world]);

  // The animation loop.
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      if (live.current.onScreen) {
        world.advance(dt, live.current.playing, live.current.speed);
        redraw();
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [world]);

  const v = world.view();
  const ready = world.sized;
  const activeLB = v.lbs.find((l) => l.active && l.alpha > 0.5);

  return (
    <div ref={ref} className={`${css.stage} ${className ?? ''}`} role="region" aria-label={label}>
      {ready && (
        <>
          <svg className={css.svg} width={v.w} height={v.h} viewBox={`0 0 ${v.w} ${v.h}`} aria-hidden>
            <defs>
              <pattern id={hatchId} width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <line x1="0" y1="0" x2="0" y2="7" stroke="rgba(255,77,106,0.32)" strokeWidth="2" />
              </pattern>
              <linearGradient id={lbFillId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="rgba(181,155,255,0.16)" />
                <stop offset="1" stopColor="rgba(181,155,255,0.05)" />
              </linearGradient>
            </defs>

            <RegistrationMarks w={v.w} h={v.h} />
            <Zones v={v} />
            <Wires wires={v.wires} />

            {v.servers.map((s) => (
              <Queue key={`q-${s.id}`} s={s} dim={matches(focus, 'server', s.id) ? false : !!focus?.length && !matches(focus, 'queue', s.id)} orient={v.orient} />
            ))}

            {v.clients.map((c) => (
              <ClientNode key={c.id} c={c} dim={!!focus?.length && !matches(focus, 'client', c.id)} glow={matches(highlight ? [highlight] : null, 'client', c.id)} />
            ))}

            {v.lbs.map((lb) => (
              <LBNode
                key={lb.id}
                lb={lb}
                hatchId={hatchId}
                dim={!!focus?.length && !matches(focus, 'lb', lb.id)}
                glow={matches(highlight ? [highlight] : null, 'lb', lb.id)}
                onClick={onLBClick ? () => onLBClick(lb.id) : undefined}
              />
            ))}

            {v.servers.map((s) => (
              <ServerNode
                key={s.id}
                s={s}
                vt={world.vt}
                hatchId={hatchId}
                dim={!!focus?.length && !matches(focus, 'server', s.id)}
                glow={matches(highlight ? [highlight] : null, 'server', s.id)}
                compactUnits={v.unitCompact}
                showServed={v.cfg.showServed}
                showWeight={v.cfg.algorithm === 'weighted' && v.cfg.lb !== 'none'}
                clickable={clickableServers}
                onClick={onServerClick}
              />
            ))}

            {v.redis && <RedisNode r={v.redis} dim={!!focus?.length && !matches(focus, 'redis', '')} glow={highlight === 'redis'} />}

            <Packets packets={v.packets} />
            {v.pending && <PendingDot p={v.pending} vt={world.vt} />}
            <EffectsLayer effects={v.effects} />
            <CalloutLeaders view={v} callouts={callouts} stepKey={stepKey} />
          </svg>

          <div className={css.overlay}>
            {v.brain && <Brain b={v.brain} />}
            {v.pending && (
              <div className={css.pendingAsk} style={{ left: v.pending.x, top: v.pending.y - 42 }}>
                Which server gets it? <span className={css.pointer}>Click one</span>
                <span className={css.touch}>Tap one</span>
              </div>
            )}
            {v.cfg.lb === 'pair' && activeLB && (
              <div className={css.vipBadge} style={{ left: activeLB.x, top: activeLB.y - activeLB.h / 2 - 9 }}>
                VIP {VIP}
              </div>
            )}
            {v.tour && <TourCard tour={v.tour} view={v} />}
            <EffectTexts effects={v.effects} />
            <CalloutBoxes view={v} callouts={callouts} stepKey={stepKey} />
            {overlay?.(v)}
          </div>
        </>
      )}
    </div>
  );
}
