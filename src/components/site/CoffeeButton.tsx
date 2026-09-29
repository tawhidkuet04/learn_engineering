import { Icon } from '@/components/lesson/Icon';
import { SITE } from '@/content/site';
import css from './coffee.module.css';

/**
 * Link to the Buy Me a Coffee page. A plain link on purpose: the official
 * widget script would load third-party code on every page.
 * `compact` hides the label on narrow screens (lesson header).
 */
export function CoffeeButton({ variant = 'ghost', compact = false, className = '' }: { variant?: 'ghost' | 'solid'; compact?: boolean; className?: string }) {
  if (!SITE.coffeeUrl) return null;
  return (
    <a
      href={SITE.coffeeUrl}
      target="_blank"
      rel="noopener noreferrer"
      className={`${css.btn} ${variant === 'solid' ? css.solid : css.ghost} ${compact ? css.compact : ''} ${className}`}
      aria-label="Buy me a coffee (opens in a new tab)"
    >
      <Icon name="coffee" size={16} className={css.cup} />
      <span className={css.label}>Buy me a coffee</span>
    </a>
  );
}

/** Closing note on the home page, above the footer. */
export function CoffeeBand() {
  if (!SITE.coffeeUrl) return null;
  return (
    <section className={css.band} aria-label="Support this project">
      <div className={css.bandText}>
        <p className={css.bandKicker}>Free, no sign-up, no ads</p>
        <p className={css.bandTitle}>
          If a lesson made something <em>click</em>, you can buy me a coffee.
        </p>
        <p className={css.bandSub}>It keeps new topics coming.</p>
      </div>
      <CoffeeButton variant="solid" />
    </section>
  );
}
