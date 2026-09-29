import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { findTopic } from '@/content/catalog';
import { SITE } from '@/content/site';
import { DEV_LESSONS, LESSONS } from '@/lessons/registry';

export const dynamicParams = false;

const isDev = process.env.NODE_ENV === 'development';

export function generateStaticParams() {
  const slugs = Object.keys(LESSONS);
  if (isDev) slugs.push(...Object.keys(DEV_LESSONS));
  return slugs.map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: PageProps<'/learn/[slug]'>): Promise<Metadata> {
  const { slug } = await params;
  const topic = findTopic(slug);
  if (!topic) return {};
  const title = `${topic.title}, animated`;
  return {
    title,
    description: topic.blurb,
    openGraph: { type: 'article', siteName: SITE.name, title, description: topic.blurb, url: `/learn/${slug}` },
    twitter: { card: 'summary_large_image', title, description: topic.blurb },
  };
}

export default async function LessonPage({ params }: PageProps<'/learn/[slug]'>) {
  const { slug } = await params;
  const Lesson = LESSONS[slug] ?? (isDev ? DEV_LESSONS[slug] : undefined);
  if (!Lesson) notFound();
  return <Lesson />;
}
