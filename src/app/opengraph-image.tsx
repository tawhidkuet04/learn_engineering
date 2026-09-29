import { ALL_TOPICS } from '@/content/catalog';
import { SITE } from '@/content/site';
import { homeCard, OG_SIZE } from '@/og/card';

export const alt = `${SITE.name}: ${SITE.tagline}`;
export const size = OG_SIZE;
export const contentType = 'image/png';
export const dynamic = 'force-static';

const GLYPHS = ['load-balancing', 'cdn', 'tcp', 'dns', 'event-loop', 'hash-tables', 'sharding', 'big-o', 'tls'];

export default function Image() {
  const live = ALL_TOPICS.filter((t) => t.status === 'live').length;
  return homeCard(live, GLYPHS);
}
