import type { Metadata } from 'next';
import Link from 'next/link';
import { Icon } from '@/components/lesson/Icon';
import { Logo } from '@/components/site/Logo';
import { ALL_TOPICS } from '@/content/catalog';
import { CAUGHT } from '@/content/caught';
import CHECKS from '@/content/checks.json';
import { SITE } from '@/content/site';
import { softwareList } from '@/content/software';
import css from './tested.module.css';

const DESCRIPTION =
  'The lessons’ scenarios also run against the real software, with the same config the lesson shows. When the animation and the real program disagree, the test fails and the lesson gets fixed.';

export const metadata: Metadata = {
  title: 'How the lessons are tested',
  description: DESCRIPTION,
  openGraph: {
    title: 'How the lessons are tested',
    description: DESCRIPTION,
    url: '/tested',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'How the lessons are tested',
    description: DESCRIPTION,
  },
};

interface Check {
  lesson: string;
  step?: string;
  title: string;
  software: string;
  real: string;
  lesson_says?: string;
  pass: boolean;
}

const checks = CHECKS.checks as Check[];

/** "nginx 1.31.6", "HAProxy 3.4.6"… from every check, the servers first. */
function programs() {
  return softwareList(checks.map((c) => c.software));
}

function stepLink(lesson: string, step?: string) {
  return `/learn/${lesson}${step ? `#${step}` : ''}`;
}

/** A lesson's checks, with the "this config loads" ones folded into a single row. */
function rowsFor(lesson: string): Check[] {
  const all = checks.filter((c) => c.lesson === lesson);
  const loads = all.filter((c) => c.real === 'accepted');
  const rest = all.filter((c) => c.real !== 'accepted');
  if (loads.length < 2) return all;
  const ok = loads.filter((c) => c.pass).length;
  const by = [...new Set(loads.map((c) => c.software))].join(', ');
  return [
    {
      lesson,
      title: `Every config snippet in the lesson loads (${loads.length})`,
      software: by,
      real: `${ok} of ${loads.length} accepted`,
      pass: ok === loads.length,
    },
    ...rest,
  ];
}

export default function TestedPage() {
  const lessons = ALL_TOPICS.filter((t) => checks.some((c) => c.lesson === t.slug));
  const failing = checks.filter((c) => !c.pass).length;
  const software = programs();

  return (
    <div className={css.page}>
      <header className={css.header}>
        <Link href="/" className={css.brand}>
          <Logo />
        </Link>
        <Link href="/#topics" className={css.back}>
          <Icon name="arrowLeft" size={14} /> All lessons
        </Link>
      </header>

      <section className={css.hero}>
        <p className={css.eyebrow}>How the lessons are tested</p>
        <h1 className={css.title}>
          Checked against <em>the real thing.</em>
        </h1>
        <p className={css.lede}>
          An animation can be internally consistent and still teach the wrong behavior. So the lessons&apos; scenarios also run against the real
          software, configured with the exact snippet the lesson shows, and a test fails whenever the animation and the real program disagree.
        </p>
        <dl className={css.stats}>
          <div>
            <dt>Checks</dt>
            <dd>{checks.length}</dd>
          </div>
          <div>
            <dt>Lessons covered</dt>
            <dd>
              {lessons.length} of {ALL_TOPICS.filter((t) => t.status === 'live').length}
            </dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd className={failing ? css.bad : css.good}>{failing ? `${failing} disagree` : 'All agree'}</dd>
          </div>
          <div>
            <dt>Last run</dt>
            <dd>{CHECKS.ran}</dd>
          </div>
        </dl>
        <p className={css.programs}>
          {software.map((s) => (
            <span key={s}>{s}</span>
          ))}
        </p>
      </section>

      <section className={css.method}>
        <ol>
          <li>
            <span className={css.methodNo}>01</span>
            <h2>Same scenario, twice</h2>
            <p>
              A test takes a lesson step, say &ldquo;web-2 crashes under load&rdquo;, and runs it through the lesson&apos;s own simulation, the code
              that draws the animation.
            </p>
          </li>
          <li>
            <span className={css.methodNo}>02</span>
            <h2>Then on the real program</h2>
            <p>
              The same step runs against real nginx, HAProxy, Redis, PostgreSQL, MySQL, Node or Chrome, using the config printed in the lesson. The
              only edits are mechanical: example IPs become local ports, certificates become a throwaway test one.
            </p>
          </li>
          <li>
            <span className={css.methodNo}>03</span>
            <h2>Compare, and fix the lesson</h2>
            <p>
              Status codes, ordering, timing, which server got what. When they disagree, the lesson changes, not the test. Snippets that pass carry a{' '}
              <span className={css.badge}>
                <Icon name="check" size={10} strokeWidth={3} /> tested on …
              </span>{' '}
              badge.
            </p>
          </li>
        </ol>
      </section>

      {CAUGHT.length > 0 && (
        <section className={css.section}>
          <h2 className={css.sectionTitle}>
            What the tests <em>caught</em>
          </h2>
          <ul className={css.caught}>
            {CAUGHT.map((c) => {
              const topic = ALL_TOPICS.find((t) => t.slug === c.lesson);
              return (
                <li key={c.found}>
                  <Link href={stepLink(c.lesson, c.step)} className={css.caughtLesson}>
                    {topic?.title ?? c.lesson}
                  </Link>
                  <p>{c.found}</p>
                  <p className={css.fixed}>
                    <Icon name="check" size={12} strokeWidth={2.6} /> {c.fixed}
                  </p>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className={css.section}>
        <h2 className={css.sectionTitle}>
          Every check, <em>lesson by lesson</em>
        </h2>
        <p className={css.sectionLede}>Open a lesson to see each comparison: what the real program did, next to what the lesson shows.</p>
        {lessons.map((topic) => {
          const mine = checks.filter((c) => c.lesson === topic.slug);
          const bad = mine.filter((c) => !c.pass).length;
          return (
            <details key={topic.slug} id={topic.slug} className={css.lesson}>
              <summary className={css.lessonHead}>
                <span className={css.lessonCode}>{topic.code}</span>
                <h3>{topic.title}</h3>
                <span className={bad ? css.lessonBad : css.lessonCount}>
                  {mine.length} {mine.length === 1 ? 'check' : 'checks'} · {bad ? `${bad} disagree` : 'all agree'}
                </span>
                <Icon name="right" size={14} className={css.chev} />
              </summary>
              <p className={css.lessonLink}>
                <Link href={`/learn/${topic.slug}`}>
                  Open the lesson <Icon name="arrowRight" size={12} />
                </Link>
              </p>
              <div className={css.rows} role="table" aria-label={`${topic.title} checks`}>
                <div className={css.rowHead} role="row">
                  <span role="columnheader" />
                  <span role="columnheader">Check</span>
                  <span role="columnheader">Real program did</span>
                  <span role="columnheader">Lesson shows</span>
                </div>
                {rowsFor(topic.slug).map((c, i) => (
                  <div key={i} className={css.row} role="row">
                    <span role="cell" className={c.pass ? css.ok : css.no} aria-label={c.pass ? 'agrees' : 'disagrees'}>
                      <Icon name={c.pass ? 'check' : 'x'} size={13} strokeWidth={2.6} />
                    </span>
                    <span role="cell" className={css.what}>
                      {c.step ? <Link href={stepLink(c.lesson, c.step)}>{c.title}</Link> : c.title}
                      <small>{c.software}</small>
                    </span>
                    <span role="cell" className={css.real}>
                      {c.real}
                    </span>
                    <span role="cell" className={css.says}>
                      {c.lesson_says ?? '—'}
                    </span>
                  </div>
                ))}
              </div>
            </details>
          );
        })}
      </section>

      <footer className={css.footer}>
        <Logo />
        <span>{SITE.tagline}</span>
        <Link href="/#topics" className={css.footLink}>
          Back to the lessons <Icon name="arrowRight" size={13} />
        </Link>
      </footer>
    </div>
  );
}
