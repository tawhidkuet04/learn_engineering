import { SITE } from '@/content/site';
import css from './site.module.css';

export function LogoMark({ size = 24 }: { size?: number }) {
  return (
    <svg className={css.mark} width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M3 8V3h5M16 3h5v5M21 16v5h-5M8 21H3v-5" stroke="currentColor" strokeOpacity=".45" strokeWidth="1.4" />
      <path d="M6.5 16.5c4 0 4-9 8-9h3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle className={css.markDot} cx="14.5" cy="7.5" r="2.5" fill="#FFD23F" />
    </svg>
  );
}

export function Logo() {
  return (
    <span className={css.logo}>
      <LogoMark />
      <span className={css.logoName}>{SITE.name}</span>
    </span>
  );
}
