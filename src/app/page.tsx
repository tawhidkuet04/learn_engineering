import Link from 'next/link';
import { Icon } from '@/components/lesson/Icon';
import { CoffeeBand, CoffeeButton } from '@/components/site/CoffeeButton';
import { HeroStage } from '@/components/site/HeroStage';
import { Logo } from '@/components/site/Logo';
import { TopicGlyph } from '@/components/site/TopicGlyph';
import { TRACKS, type Topic } from '@/content/catalog';
import { SITE } from '@/content/site';
import css from './home.module.css';

const FIRST = '/learn/load-balancing';

function TopicCard({ topic }: { topic: Topic }) {
  const live = topic.status === 'live';
  const inner = (
    <>
      <div className={css.cardTop}>
        <span className={css.cardCode}>{topic.code}</span>
        {live ? (
          <span className={css.pillLive}>Live</span>
        ) : (
          <span className={css.stamp} aria-hidden>
            coming soon
          </span>
        )}
      </div>
      <div className={css.cardGlyph}>
        <TopicGlyph slug={topic.slug} />
      </div>
      <h3 className={css.cardTitle}>{topic.title}</h3>
      <p className={css.cardBlurb}>{topic.blurb}</p>
      {live ? (
        <div className={css.cardFoot}>
          <span>
            {topic.steps} interactive steps · ~{topic.minutes} min
          </span>
          <span className={css.cardGo}>
            Start <Icon name="arrowRight" size={14} />
          </span>
        </div>
      ) : null}
    </>
  );
  return live ? (
    <Link href={`/learn/${topic.slug}`} className={`${css.card} ${css.cardLive}`}>
      {inner}
    </Link>
  ) : (
    <div className={css.card} aria-label={`${topic.title}, coming soon`}>
      {inner}
    </div>
  );
}

const HOW = [
  {
    title: 'Watch it move',
    text: 'Every concept is a running simulation, not a static diagram. Requests travel, queues grow, servers fail, all in front of you.',
    art: (
      <svg viewBox="0 0 160 70" aria-hidden>
        <path d="M10 35 C60 35 60 18 110 18 H150" className={css.artLine} />
        <path d="M10 35 C60 35 60 52 110 52 H150" className={css.artLine} />
        <circle className={css.artDotA} r="4" />
        <circle className={css.artDotB} r="4" />
      </svg>
    ),
  },
  {
    title: 'Predict, then see',
    text: 'The lesson pauses and asks what happens next. Committing to a guess before the answer is what makes it stick.',
    art: (
      <svg viewBox="0 0 160 70" aria-hidden>
        <rect x="20" y="20" width="44" height="30" rx="5" className={css.artBox} />
        <rect x="96" y="20" width="44" height="30" rx="5" className={css.artBoxHot} />
        <text x="118" y="41" textAnchor="middle" className={css.artQ}>
          ?
        </text>
        <path d="M64 35 H96" className={css.artLine} strokeDasharray="3 4" />
      </svg>
    ),
  },
  {
    title: 'Break it on purpose',
    text: (
      <>
        Crash servers, flood the traffic, flip algorithms. Then read the real NGINX or HAProxy config that does the same thing,{' '}
        <Link href="/tested">tested against the real software</Link>.
      </>
    ),
    art: (
      <svg viewBox="0 0 160 70" aria-hidden>
        <defs>
          <pattern id="howHatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" stroke="rgba(255,77,106,0.45)" strokeWidth="2" />
          </pattern>
        </defs>
        <rect x="52" y="14" width="56" height="42" rx="5" className={css.artBoxBad} />
        <rect x="52" y="14" width="56" height="42" rx="5" fill="url(#howHatch)" />
        <path d="M72 27l16 16M88 27L72 43" className={css.artX} />
      </svg>
    ),
  },
];

export default function Home() {
  return (
    <div className={css.page}>
      <header className={css.header}>
        <Link href="/" className={css.brand}>
          <Logo />
        </Link>
        <nav className={css.nav}>
          <a href="#how">How it works</a>
          <a href="#topics">Topics</a>
        </nav>
        <CoffeeButton compact className={css.headerCoffee} />
        <Link href={FIRST} className={css.headerCta}>
          Start learning <Icon name="arrowRight" size={14} />
        </Link>
      </header>

      <section className={css.hero}>
        <p className={css.eyebrow}>Interactive engineering lessons</p>
        <h1 className={css.title}>
          Don&apos;t memorize systems.
          <br />
          <em>Watch them run.</em>
        </h1>
        <div className={css.heroSide}>
          <p className={css.lede}>{SITE.description}</p>
          <div className={css.ctas}>
            <Link href={FIRST} className={css.cta}>
              Start with Load Balancing <Icon name="arrowRight" size={16} />
            </Link>
            <a href="#topics" className={css.ghost}>
              Browse topics
            </a>
          </div>
        </div>
      </section>

      <section className={css.band} aria-label="Live demo">
        <div className={css.bandFrame}>
          <HeroStage />
        </div>
        <p className={css.caption}>
          Every dot is a request. The load balancer spreads them across four servers, checks each one&apos;s health, and routes around the ones that
          crash.
        </p>
      </section>

      <section id="how" className={css.how}>
        {HOW.map((h, i) => (
          <article key={h.title} className={css.howItem}>
            <div className={css.howArt}>{h.art}</div>
            <div className={css.howNo}>0{i + 1}</div>
            <h2 className={css.howTitle}>{h.title}</h2>
            <p className={css.howText}>{h.text}</p>
          </article>
        ))}
      </section>

      <section id="topics" className={css.catalog}>
        <div className={css.catalogHead}>
          <p className={css.eyebrow}>The syllabus</p>
          <h2 className={css.catalogTitle}>
            {TRACKS.reduce((n, t) => n + t.topics.length, 0)} topics, <em>one at a time.</em>
          </h2>
          <p className={css.catalogLede}>Each topic is a complete lesson you can finish in one sitting: a live simulation, questions that make you predict, and a playground to break things in.</p>
        </div>

        {TRACKS.map((track, ti) => {
          const live = track.topics.filter((t) => t.status === 'live').length;
          return (
            <div key={track.id} className={css.track}>
              <div className={css.trackHead}>
                <span className={css.trackNo}>0{ti + 1}</span>
                <h3 className={css.trackTitle}>{track.title}</h3>
                <span className={css.trackIntro}>{track.intro}</span>
                <span className={css.trackCount}>
                  {live === track.topics.length ? `${live} lessons` : `${live} live · ${track.topics.length - live} in drafting`}
                </span>
              </div>
              <div className={css.grid}>
                {track.topics.map((t) => (
                  <TopicCard key={t.slug} topic={t} />
                ))}
              </div>
            </div>
          );
        })}
      </section>

      <CoffeeBand />

      <footer className={css.footer}>
        <Logo />
        <span>{SITE.tagline}</span>
        <Link href="/tested" className={css.footLink}>
          How the lessons are tested
        </Link>
        <span className={css.footNote}>Addresses shown are from documentation ranges (RFC 5737). No servers were harmed.</span>
      </footer>
    </div>
  );
}
