import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ALL_TOPICS, findTopic } from '@/content/catalog';
import { LESSONS } from '@/lessons/registry';

export const dynamicParams = false;

export function generateStaticParams() {
  return ALL_TOPICS.filter((t) => t.status === 'live' && LESSONS[t.slug]).map((t) => ({ slug: t.slug }));
}

export async function generateMetadata({ params }: PageProps<'/learn/[slug]'>): Promise<Metadata> {
  const { slug } = await params;
  const topic = findTopic(slug);
  if (!topic) return {};
  return {
    title: `${topic.title}, animated`,
    description: topic.blurb,
  };
}

export default async function LessonPage({ params }: PageProps<'/learn/[slug]'>) {
  const { slug } = await params;
  const Lesson = LESSONS[slug];
  if (!Lesson) notFound();
  return <Lesson />;
}
