const PATHS = {
  play: 'M6 4.5v15l13-7.5z',
  pause: 'M7 4.5h3.5v15H7zM13.5 4.5H17v15h-3.5z',
  replay: 'M4 12a8 8 0 1 0 2.4-5.7M4 4v4.5h4.5',
  left: 'M15 5l-7 7 7 7',
  right: 'M9 5l7 7-7 7',
  arrowRight: 'M4 12h15M13 6l6 6-6 6',
  arrowLeft: 'M20 12H5M11 6l-6 6 6 6',
  check: 'M4.5 12.5l5 5 10-11',
  x: 'M6 6l12 12M18 6L6 18',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  keyboard: 'M3 6.5h18v11H3zM7 10h.01M11 10h.01M15 10h.01M7 14h10',
  bolt: 'M13 3L5 14h6l-1 7 8-11h-6z',
  target: 'M12 3v3M12 18v3M3 12h3M18 12h3M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  power: 'M12 3v8M6.3 7.3a8 8 0 1 0 11.4 0',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  code: 'M9 7l-5 5 5 5M15 7l5 5-5 5',
  book: 'M5 4.5h9a3 3 0 0 1 3 3v12H8a3 3 0 0 1-3-3zM17 7.5h2v12h-2',
  flag: 'M6 21V4M6 4h11l-2 4 2 4H6',
  coffee: 'M4.5 9.5h11.5v4.5a5 5 0 0 1-5 5h-1.5a5 5 0 0 1-5-5zM16 11h1.2a2.8 2.8 0 0 1 0 5.6H15.4M8.5 3.5c-.8 1 .8 1.8 0 3M12 3.5c-.8 1 .8 1.8 0 3',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 16, className, strokeWidth = 1.8 }: { name: IconName; size?: number; className?: string; strokeWidth?: number }) {
  const filled = name === 'play' || name === 'pause';
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
