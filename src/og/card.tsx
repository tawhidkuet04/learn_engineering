import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ReactNode } from 'react';
import { ImageResponse } from 'next/og';
import { TopicGlyph } from '@/components/site/TopicGlyph';
import { SITE } from '@/content/site';

/** Share-card renderer for opengraph-image routes. Rendered at build time. */

export const OG_SIZE = { width: 1200, height: 630 };

const C = {
  ink0: '#04070d',
  ink2: '#0c1322',
  line: '#8fa6c9',
  rule: 'rgba(143, 166, 201, 0.18)',
  text1: '#e8eef9',
  text2: '#a9b6cc',
  text3: '#6f7d97',
  accent: '#ffd23f',
  req: '#45d5ff',
  res: '#4be3a0',
};

async function fonts() {
  const dir = join(process.cwd(), 'src/og/fonts');
  const load = (f: string) => readFile(join(dir, f));
  const [display, displayItalic, sans, mono] = await Promise.all([
    load('newsreader-latin-500-normal.woff'),
    load('newsreader-latin-400-italic.woff'),
    load('ibm-plex-sans-latin-400-normal.woff'),
    load('ibm-plex-mono-latin-500-normal.woff'),
  ]);
  return [
    { name: 'Display', data: display, weight: 500 as const, style: 'normal' as const },
    { name: 'Display', data: displayItalic, weight: 400 as const, style: 'italic' as const },
    { name: 'Sans', data: sans, weight: 400 as const, style: 'normal' as const },
    { name: 'Mono', data: mono, weight: 500 as const, style: 'normal' as const },
  ];
}

function Mark({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M3 8V3h5M16 3h5v5M21 16v5h-5M8 21H3v-5" stroke={C.line} strokeOpacity=".55" strokeWidth="1.4" />
      <path d="M6.5 16.5c4 0 4-9 8-9h3" stroke={C.text1} strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="14.5" cy="7.5" r="2.5" fill={C.accent} />
    </svg>
  );
}

/** Corner brackets echoing the logo mark, framing the artwork. */
function Frame({ size, children }: { size: number; children: ReactNode }) {
  const arm = 34;
  const corner = (pos: Record<string, number>, sides: string[]) => (
    <div
      style={{
        position: 'absolute',
        width: arm,
        height: arm,
        ...pos,
        ...Object.fromEntries(sides.map((s) => [`border${s}`, `2px solid ${C.rule}`])),
      }}
    />
  );
  return (
    <div style={{ position: 'relative', display: 'flex', width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {corner({ top: 0, left: 0 }, ['Top', 'Left'])}
      {corner({ top: 0, right: 0 }, ['Top', 'Right'])}
      {corner({ bottom: 0, left: 0 }, ['Bottom', 'Left'])}
      {corner({ bottom: 0, right: 0 }, ['Bottom', 'Right'])}
      {children}
    </div>
  );
}

function Shell({ eyebrow, children, art, footer }: { eyebrow: string; children: ReactNode; art: ReactNode; footer: string }) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        padding: '56px 64px',
        background: C.ink0,
        backgroundImage: `radial-gradient(circle at 82% 45%, ${C.ink2} 0%, ${C.ink0} 55%)`,
        color: C.text1,
        fontFamily: 'Sans',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <Mark size={40} />
          <span style={{ fontSize: 28, color: C.text1 }}>{SITE.name}</span>
        </div>
        <span style={{ fontFamily: 'Mono', fontSize: 20, letterSpacing: 2, color: C.text3, textTransform: 'uppercase' }}>{eyebrow}</span>
      </div>

      <div style={{ display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'space-between', gap: 48 }}>
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>{children}</div>
        {art}
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingTop: 24,
          borderTop: `1px solid ${C.rule}`,
          fontFamily: 'Mono',
          fontSize: 20,
          color: C.text2,
        }}
      >
        <span>{footer}</span>
        <span style={{ color: C.text3 }}>{SITE.url.replace(/^https?:\/\//, '')}</span>
      </div>
    </div>
  );
}

export async function lessonCard(topic: {
  slug: string;
  code: string;
  title: string;
  blurb: string;
  steps?: number;
  minutes?: number;
  track: { title: string };
}) {
  const long = topic.title.length > 22;
  return new ImageResponse(
    (
      <Shell
        eyebrow={`${topic.code} · ${topic.track.title}`}
        footer={`Animated lesson · ${topic.steps} interactive steps · ~${topic.minutes} min`}
        art={
          <Frame size={330}>
            <TopicGlyph slug={topic.slug} size={250} color={C.line} strokeWidth={1} />
          </Frame>
        }
      >
        <div style={{ fontFamily: 'Display', fontWeight: 500, fontSize: long ? 76 : 92, lineHeight: 1.02, letterSpacing: -1.5 }}>{topic.title}</div>
        <div style={{ display: 'flex', width: 72, height: 4, background: C.accent, borderRadius: 2, margin: '30px 0 26px' }} />
        <div style={{ fontSize: 30, lineHeight: 1.4, color: C.text2, maxWidth: 680 }}>{topic.blurb}</div>
      </Shell>
    ),
    { ...OG_SIZE, fonts: await fonts() },
  );
}

export async function homeCard(lessonCount: number, glyphs: string[]) {
  const dots = [C.req, C.res, C.accent];
  return new ImageResponse(
    (
      <Shell
        eyebrow="System design · Networking · CS"
        footer={`${lessonCount} animated, interactive lessons · free`}
        art={
          <Frame size={330}>
            <div style={{ display: 'flex', flexWrap: 'wrap', width: 258, gap: 18, justifyContent: 'center' }}>
              {glyphs.map((slug, i) => (
                <div
                  key={slug}
                  style={{
                    display: 'flex',
                    position: 'relative',
                    width: 74,
                    height: 74,
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: `1px solid ${C.rule}`,
                    borderRadius: 12,
                  }}
                >
                  <TopicGlyph slug={slug} size={52} color={C.line} strokeWidth={1.6} />
                  {i % 4 === 0 ? (
                    <div style={{ position: 'absolute', top: -5, right: -5, width: 10, height: 10, borderRadius: 5, background: dots[(i / 4) % 3] }} />
                  ) : null}
                </div>
              ))}
            </div>
          </Frame>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', fontFamily: 'Display', fontWeight: 500, fontSize: 104, lineHeight: 1, letterSpacing: -2 }}>
          <span>Systems,</span>
          <span style={{ fontStyle: 'italic', fontWeight: 400, color: C.accent }}>animated.</span>
        </div>
        <div style={{ fontSize: 29, lineHeight: 1.4, color: C.text2, maxWidth: 660, marginTop: 30 }}>
          Watch requests move, predict what happens next, and break things on purpose.
        </div>
      </Shell>
    ),
    { ...OG_SIZE, fonts: await fonts() },
  );
}

export async function testedCard(checks: number, lessons: number, programs: string[], agree: boolean) {
  return new ImageResponse(
    (
      <Shell
        eyebrow="How the lessons are tested"
        footer={`${checks} checks across ${lessons} ${lessons === 1 ? 'lesson' : 'lessons'} · ${agree ? 'all agree' : 'some disagree'}`}
        art={
          <Frame size={330}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, fontFamily: 'Mono', fontSize: 25, color: C.text1 }}>
              {programs.slice(0, 6).map((p) => (
                <div key={p} style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={C.res} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4.5 12.5l5 5 10-11" />
                  </svg>
                  <span>{p}</span>
                </div>
              ))}
            </div>
          </Frame>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', fontFamily: 'Display', fontWeight: 500, fontSize: 92, lineHeight: 1.02, letterSpacing: -1.5 }}>
          <span>Checked against</span>
          <span style={{ fontStyle: 'italic', fontWeight: 400, color: C.res }}>the real thing.</span>
        </div>
        <div style={{ fontSize: 28, lineHeight: 1.4, color: C.text2, maxWidth: 680, marginTop: 28 }}>
          The lessons also run against the real software. When the two disagree, the lesson gets fixed.
        </div>
      </Shell>
    ),
    { ...OG_SIZE, fonts: await fonts() },
  );
}
