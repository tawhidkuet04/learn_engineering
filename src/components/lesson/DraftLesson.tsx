import Link from 'next/link';
import { findTopic } from '@/content/catalog';

/** Placeholder shown for a topic whose lesson is still being built. */
export function DraftLesson({ slug }: { slug: string }) {
  const topic = findTopic(slug);
  return (
    <main style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 24, textAlign: 'center' }}>
      <div>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--accent)' }}>
          {topic?.code ?? 'Draft'} · on the drafting table
        </p>
        <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 400, fontSize: 44, margin: '12px 0' }}>{topic?.title ?? slug}</h1>
        <p style={{ color: 'var(--text-2)' }}>This lesson is being built.</p>
        <Link href="/#topics" style={{ color: 'var(--accent)' }}>
          ← All topics
        </Link>
      </div>
    </main>
  );
}
