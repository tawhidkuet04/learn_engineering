import { ALL_TOPICS, findTopic } from '@/content/catalog';
import { lessonCard, OG_SIZE } from '@/og/card';

export const alt = 'Animated lesson';
export const size = OG_SIZE;
export const contentType = 'image/png';
export const dynamic = 'force-static';

export function generateStaticParams() {
  return ALL_TOPICS.filter((t) => t.status === 'live').map((t) => ({ slug: t.slug }));
}

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return lessonCard(findTopic(slug)!);
}
