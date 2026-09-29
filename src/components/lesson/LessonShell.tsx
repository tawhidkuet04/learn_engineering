'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CoffeeButton } from '@/components/site/CoffeeButton';
import { Logo } from '@/components/site/Logo';
import { SITE } from '@/content/site';
import { Icon } from './Icon';
import css from './lesson.module.css';

export interface ShellChapter {
  id: string;
  title: string;
  steps: { id: string; title: string }[];
}

interface Props {
  code: string;
  track: string;
  title: string;
  chapters: ShellChapter[];
  index: number;
  visited: number;
  onIndexChange: (i: number) => void;
  stage: ReactNode;
  panel: ReactNode;
  onTogglePlay?: () => void;
  onReplay?: () => void;
}

const pad = (n: number) => n.toString().padStart(2, '0');

/** A new GitHub issue from the suggestion form, with the step's URL and title filled in. */
function suggestHref(pathname: string, lesson: string, step: { id: string; title: string }) {
  const q = new URLSearchParams({
    template: 'suggestion.yml',
    title: `${lesson} · ${step.title}: `,
    where: `${SITE.url}${pathname}#${step.id}`,
  });
  return `${SITE.repo}/issues/new?${q}`;
}

/** Keep mouse clicks from parking focus on a button, so Space still means play/pause. */
const noFocus = { onMouseDown: (e: { preventDefault: () => void }) => e.preventDefault() };

function isTyping(el: Element | null) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el as HTMLElement).isContentEditable;
}

export function LessonShell({ code, track, title, chapters, index, visited, onIndexChange, stage, panel, onTogglePlay, onReplay }: Props) {
  const flat = chapters.flatMap((c, ci) => c.steps.map((s) => ({ ...s, chapter: c, ci })));
  const total = flat.length;
  const cur = flat[index];
  const prev = flat[index - 1];
  const next = flat[index + 1];
  const [menuOpen, setMenuOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  // Keyboard: ← → to move between steps, space to pause, R to replay.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(document.activeElement)) return;
      if (e.key === 'ArrowRight' && index < total - 1) {
        e.preventDefault();
        onIndexChange(index + 1);
      } else if (e.key === 'ArrowLeft' && index > 0) {
        e.preventDefault();
        onIndexChange(index - 1);
      } else if (e.key === ' ' && onTogglePlay) {
        const el = document.activeElement;
        if (el && (el.tagName === 'BUTTON' || el.tagName === 'A')) return;
        e.preventDefault();
        onTogglePlay();
      } else if ((e.key === 'r' || e.key === 'R') && onReplay) {
        onReplay();
      } else if (e.key === 'Escape') {
        setMenuOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, total, onIndexChange, onTogglePlay, onReplay]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [index]);

  const go = (i: number) => {
    setMenuOpen(false);
    onIndexChange(i);
  };

  return (
    <div className={css.shell}>
      {menuOpen && <div className={css.menuBackdrop} onClick={() => setMenuOpen(false)} aria-hidden />}
      <header className={css.top}>
        <Link href="/" className={css.brand} aria-label="All topics">
          <Logo />
        </Link>
        <nav className={css.crumbs} aria-label="Breadcrumb">
          <Link href="/#topics">{track}</Link>
          <span aria-hidden>/</span>
          <span className={css.crumbNow}>{title}</span>
        </nav>
        <div className={css.topRight}>
          <span className={css.keysHint} aria-hidden>
            <kbd>←</kbd>
            <kbd>→</kbd> steps · <kbd>space</kbd> pause
          </span>
          <CoffeeButton compact />
          <button type="button" className={css.menuBtn} onClick={() => setMenuOpen((o) => !o)} aria-expanded={menuOpen}>
            <Icon name="list" size={15} />
            <span>Contents</span>
          </button>
        </div>
        {menuOpen && (
          <div className={css.menu} role="dialog" aria-label="Lesson contents">
            {chapters.map((c, ci) => (
              <div key={c.id} className={css.menuChapter}>
                <div className={css.menuChapterTitle}>
                  <span>{pad(ci + 1)}</span> {c.title}
                </div>
                {c.steps.map((s) => {
                  const i = flat.findIndex((f) => f.id === s.id);
                  return (
                    <button key={s.id} type="button" className={css.menuStep} data-current={i === index} data-seen={i <= visited} onClick={() => go(i)}>
                      <span className={css.menuNum}>{pad(i + 1)}</span>
                      {s.title}
                      {i < index && <Icon name="check" size={12} className={css.menuCheck} />}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </header>

      <main className={css.main}>
        <section className={css.panel} aria-label="Narration">
          <div className={css.panelScroll} ref={scrollRef}>
            <div key={cur.id} className={css.stepIn}>
              <div className={css.kicker}>
                <span>
                  Chapter {pad(cur.ci + 1)} · {cur.chapter.title}
                </span>
                <span className={css.counter}>
                  {pad(index + 1)} / {pad(total)}
                </span>
              </div>
              <h1 className={css.h1}>{cur.title}</h1>
              {panel}
              <a className={css.suggest} href={suggestHref(pathname, title, cur)} target="_blank" rel="noopener noreferrer">
                <Icon name="flag" size={13} />
                <span>
                  Wrong, misleading or unclear? <strong>Suggest a fix</strong>
                </span>
              </a>
            </div>
          </div>
          <div className={css.nav}>
            <button type="button" className={css.back} onClick={() => prev && onIndexChange(index - 1)} disabled={!prev} aria-label="Previous step" {...noFocus}>
              <Icon name="arrowLeft" size={15} />
              <span className={css.hideSm}>Back</span>
            </button>
            <div className={css.navProgress} aria-hidden>
              <i style={{ width: `${((index + 1) / total) * 100}%` }} />
            </div>
            {next ? (
              <button type="button" className={css.next} onClick={() => onIndexChange(index + 1)} {...noFocus}>
                <span className={css.nextLabel}>
                  <small>Next</small>
                  <span className={css.nextTitle}>{next.title}</span>
                </span>
                <Icon name="arrowRight" size={15} />
              </button>
            ) : (
              <Link href="/#topics" className={css.next}>
                <span className={css.nextLabel}>
                  <small>Done</small>
                  More topics
                </span>
                <Icon name="arrowRight" size={15} />
              </Link>
            )}
          </div>
        </section>

        <section className={css.stageArea} aria-label="Animation">
          {stage}
        </section>
      </main>

      <footer className={css.timeline} aria-label="Lesson timeline">
        {chapters.map((c, ci) => {
          const first = flat.findIndex((f) => f.chapter.id === c.id);
          const active = cur.ci === ci;
          return (
            <div key={c.id} className={css.tlChapter} style={{ flexGrow: c.steps.length }} data-active={active}>
              <div className={css.tlLabel}>
                <span>{pad(ci + 1)}</span> {c.title}
              </div>
              <div className={css.tlSteps}>
                {c.steps.map((s, si) => {
                  const i = first + si;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      className={css.tlStep}
                      data-state={i === index ? 'current' : i <= visited ? 'seen' : 'todo'}
                      onClick={() => go(i)}
                      {...noFocus}
                      aria-label={`Step ${i + 1}: ${s.title}`}
                      aria-current={i === index ? 'step' : undefined}
                    >
                      <span className={css.tlTip}>
                        {pad(i + 1)} · {s.title}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
        <span className={css.tlCode}>{code}</span>
      </footer>
    </div>
  );
}
