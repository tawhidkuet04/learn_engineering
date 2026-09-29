import { Fragment, isValidElement, type ReactNode } from 'react';

/** Small line-drawn schematics, one per topic, on a 48×48 grid. */
const G: Record<string, ReactNode> = {
  'load-balancing': (
    <>
      <circle cx="8" cy="24" r="3" />
      <path d="M11 24h8" />
      <rect x="19" y="19" width="10" height="10" rx="2" />
      <path d="M29 24c5 0 5-12 10-12M29 24h10M29 24c5 0 5 12 10 12" />
      <rect x="39" y="9" width="6" height="6" rx="1" />
      <rect x="39" y="21" width="6" height="6" rx="1" />
      <rect x="39" y="33" width="6" height="6" rx="1" />
    </>
  ),
  caching: (
    <>
      <rect x="6" y="14" width="14" height="20" rx="2" />
      <path d="M20 24h8" />
      <path d="M28 13h14v22H28z" />
      <path d="M31 19h8M31 24h8M31 29h8" />
      <path d="M12 19l-2 5h4l-2 5" />
    </>
  ),
  cdn: (
    <>
      <circle cx="24" cy="24" r="15" />
      <path d="M9 24h30M24 9c-6 5-6 25 0 30M24 9c6 5 6 25 0 30" />
      <circle cx="14" cy="15" r="2.5" />
      <circle cx="35" cy="30" r="2.5" />
      <circle cx="30" cy="13" r="2.5" />
    </>
  ),
  'consistent-hashing': (
    <>
      <circle cx="24" cy="24" r="14" />
      <circle cx="24" cy="10" r="2.5" />
      <circle cx="37" cy="29" r="2.5" />
      <circle cx="13" cy="33" r="2.5" />
      <path d="M31 12l2-3M38 20l3-1" />
    </>
  ),
  replication: (
    <>
      <ellipse cx="12" cy="14" rx="6" ry="2.5" />
      <path d="M6 14v12c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5V14" />
      <ellipse cx="36" cy="10" rx="6" ry="2.5" />
      <path d="M30 10v9c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5v-9" />
      <ellipse cx="36" cy="29" rx="6" ry="2.5" />
      <path d="M30 29v9c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5v-9" />
      <path d="M18 18l11-4M18 24l11 6" />
    </>
  ),
  sharding: (
    <>
      <ellipse cx="24" cy="11" rx="12" ry="4" />
      <path d="M12 11v26c0 2.2 5.4 4 12 4s12-1.8 12-4V11" />
      <path d="M12 20c0 2.2 5.4 4 12 4s12-1.8 12-4M12 29c0 2.2 5.4 4 12 4s12-1.8 12-4" strokeDasharray="2 2" />
    </>
  ),
  'rate-limiting': (
    <>
      <path d="M12 18h24l-3 20H15z" />
      <circle cx="20" cy="30" r="2" />
      <circle cx="27" cy="27" r="2" />
      <circle cx="24" cy="10" r="2" />
      <path d="M24 42v3" />
      <circle cx="24" cy="46" r="1" />
    </>
  ),
  'message-queues': (
    <>
      <rect x="4" y="18" width="8" height="12" rx="1.5" />
      <rect x="15" y="18" width="8" height="12" rx="1.5" />
      <rect x="26" y="18" width="8" height="12" rx="1.5" />
      <path d="M37 24h8M41 20l4 4-4 4" />
    </>
  ),
  cap: (
    <>
      <path d="M24 8L40 38H8z" />
      <circle cx="24" cy="8" r="2.5" />
      <circle cx="40" cy="38" r="2.5" />
      <circle cx="8" cy="38" r="2.5" />
    </>
  ),
  'life-of-a-request': (
    <>
      <path d="M6 10l6 14 2-6 6-2z" />
      <path d="M18 26c6 0 6 10 12 10" strokeDasharray="2 3" />
      <circle cx="36" cy="36" r="7" />
      <path d="M29 36h14M36 29c-2.5 2-2.5 12 0 14M36 29c2.5 2 2.5 12 0 14" />
    </>
  ),
  'osi-model': (
    <>
      {[8, 13, 18, 23, 28, 33, 38].map((y, i) => (
        <rect key={y} x={10 + (i % 2)} y={y} width={28 - (i % 2) * 2} height="3.2" rx="1" />
      ))}
    </>
  ),
  tcp: (
    <>
      <path d="M12 6v36M36 6v36" />
      <path d="M12 12l24 6M36 22l-24 6M12 32l24 6" />
      <path d="M33 16.5l3 1.5-3 1.8M15 26.5l-3 1.5 3 1.8M33 36.5l3 1.5-3 1.8" />
    </>
  ),
  dns: (
    <>
      <circle cx="24" cy="8" r="3" />
      <circle cx="12" cy="24" r="3" />
      <circle cx="36" cy="24" r="3" />
      <circle cx="30" cy="40" r="3" />
      <circle cx="42" cy="40" r="3" />
      <path d="M22 10.5l-8 11M26 10.5l8 11M34.5 26.5l-3 11M37.5 26.5l3 11" />
    </>
  ),
  tls: (
    <>
      <rect x="12" y="22" width="24" height="18" rx="3" />
      <path d="M17 22v-6a7 7 0 0 1 14 0v6" />
      <circle cx="24" cy="30" r="2.5" />
      <path d="M24 32.5v3" />
    </>
  ),
  'http-versions': (
    <>
      <path d="M6 14h36M6 24h36M6 34h36" strokeDasharray="1 3" />
      <rect x="8" y="11" width="8" height="6" rx="1.5" />
      <rect x="20" y="21" width="8" height="6" rx="1.5" />
      <rect x="30" y="31" width="8" height="6" rx="1.5" />
      <rect x="26" y="11" width="6" height="6" rx="1.5" />
    </>
  ),
  nat: (
    <>
      <circle cx="8" cy="12" r="2.5" />
      <circle cx="8" cy="24" r="2.5" />
      <circle cx="8" cy="36" r="2.5" />
      <path d="M11 12c8 0 8 12 13 12M11 24h13M11 36c8 0 8-12 13-12" />
      <rect x="24" y="19" width="10" height="10" rx="2" />
      <path d="M34 24h10" />
    </>
  ),
  websockets: (
    <>
      <rect x="4" y="16" width="10" height="16" rx="2" />
      <rect x="34" y="16" width="10" height="16" rx="2" />
      <path d="M16 21h16M28 17l4 4-4 4M32 29H16M20 25l-4 4 4 4" />
    </>
  ),
  'processes-threads': (
    <>
      <rect x="6" y="8" width="36" height="32" rx="3" />
      <path d="M14 14c3 4-3 8 0 12s-3 8 0 10M24 14c3 4-3 8 0 12s-3 8 0 10M34 14c3 4-3 8 0 12s-3 8 0 10" />
    </>
  ),
  'event-loop': (
    <>
      <path d="M36 16a14 14 0 1 0 2 12" />
      <path d="M38 8v8h-8" />
      <circle cx="24" cy="24" r="3" />
    </>
  ),
  'hash-tables': (
    <>
      {[10, 18, 26, 34].map((y) => (
        <rect key={y} x="6" y={y} width="8" height="6" rx="1" />
      ))}
      <path d="M14 13h8M14 29h8M30 29h6" />
      <rect x="22" y="10" width="10" height="6" rx="1" />
      <rect x="22" y="26" width="8" height="6" rx="1" />
      <rect x="36" y="26" width="8" height="6" rx="1" />
    </>
  ),
  'stack-heap': (
    <>
      <rect x="6" y="30" width="14" height="5" rx="1" />
      <rect x="6" y="23" width="14" height="5" rx="1" />
      <rect x="6" y="16" width="14" height="5" rx="1" />
      <rect x="28" y="10" width="8" height="7" rx="1" />
      <rect x="34" y="24" width="9" height="6" rx="1" />
      <rect x="26" y="32" width="7" height="7" rx="1" />
    </>
  ),
  'garbage-collection': (
    <>
      <circle cx="10" cy="24" r="3.5" />
      <circle cx="24" cy="14" r="3.5" />
      <circle cx="24" cy="34" r="3.5" />
      <circle cx="39" cy="24" r="3.5" strokeDasharray="2 2" />
      <path d="M13 22l8-6M13 26l8 6" />
      <path d="M35 20l8 8M43 20l-8 8" />
    </>
  ),
  'cpu-caches': (
    <>
      <rect x="6" y="6" width="36" height="36" rx="2" />
      <rect x="12" y="12" width="24" height="24" rx="2" />
      <rect x="18" y="18" width="12" height="12" rx="2" />
    </>
  ),
  'race-conditions': (
    <>
      <path d="M6 14h16l6 10M6 34h16l6-10" />
      <circle cx="30" cy="24" r="4" />
      <path d="M34 24h8M28 18l-2-3M32 18l2-3" />
    </>
  ),
  'big-o': (
    <>
      <path d="M8 6v34h34" />
      <path d="M8 38c10-1 22-4 32-6" />
      <path d="M8 38c10-4 16-12 20-28" />
      <path d="M8 38C20 36 34 26 40 14" strokeDasharray="2 2" />
    </>
  ),
};

/**
 * The glyph's shapes without the wrapping fragment. next/og's renderer only
 * accepts plain SVG elements inside <svg>.
 */
function shapes(slug: string): ReactNode {
  const g = G[slug] ?? <rect x="8" y="8" width="32" height="32" rx="3" />;
  return isValidElement<{ children?: ReactNode }>(g) && g.type === Fragment ? g.props.children : g;
}

export function TopicGlyph({
  slug,
  size = 44,
  color = 'currentColor',
  strokeWidth = 1.4,
}: {
  slug: string;
  size?: number;
  color?: string;
  strokeWidth?: number;
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {shapes(slug)}
    </svg>
  );
}
