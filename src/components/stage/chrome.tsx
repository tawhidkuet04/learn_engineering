'use client';

import type { CSSProperties, ReactNode } from 'react';
import { Icon } from '@/components/lesson/Icon';
import { ScrambleText } from '@/components/lesson/ScrambleText';
import css from './chrome.module.css';

const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(' ');

/* ------------------------------------------------------------------ */
/* HUD: live metric chips in the stage's top-left corner               */
/* ------------------------------------------------------------------ */

export interface HudItem {
  label: string;
  value: ReactNode;
  unit?: string;
  tone?: 'bad' | 'warn' | 'good';
  /** Sparkline values (e.g. latency over time) */
  spark?: number[];
  /** Replace the value line with custom content */
  custom?: ReactNode;
  wide?: boolean;
}

function Spark({ series, color = '#45D5FF' }: { series: number[]; color?: string }) {
  if (series.length < 2) return null;
  const w = 64;
  const h = 18;
  const max = Math.max(1e-9, ...series);
  const pts = series.map((v, i) => `${((i / (series.length - 1)) * w).toFixed(1)},${(h - (v / max) * h).toFixed(1)}`).join(' ');
  return (
    <svg className={css.spark} width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.3} strokeLinejoin="round" />
    </svg>
  );
}

export function Hud({ items }: { items: HudItem[] }) {
  if (!items.length) return null;
  return (
    <div className={css.hud} aria-live="off">
      {items.map((it) => (
        <div key={it.label} className={cx(css.chip, it.tone && css[it.tone], it.wide && css.chipWide)}>
          <div className={css.chipLabel}>{it.label}</div>
          {it.custom ?? (
            <div className={css.chipValue}>
              {it.value} {it.unit && <small>{it.unit}</small>}
              {it.spark && <Spark series={it.spark} />}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Legend: what each color means in this step                          */
/* ------------------------------------------------------------------ */

export interface LegendItem {
  label: string;
  color: string;
  shape?: 'dot' | 'small' | 'env' | 'square' | 'line' | 'ring';
}

export function Legend({ items, bottom }: { items: LegendItem[]; bottom?: number }) {
  if (!items.length) return null;
  return (
    <div className={css.legend} style={bottom != null ? { bottom } : undefined}>
      {items.map((it) => (
        <span key={it.label}>
          <i className={it.shape && it.shape !== 'dot' ? css[it.shape] : undefined} style={{ '--c': it.color } as CSSProperties} />
          {it.label}
        </span>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Playback controls and the drawing's title block                     */
/* ------------------------------------------------------------------ */

export function PlaybackControls({
  playing,
  onToggle,
  speed,
  onSpeed,
  onReplay,
}: {
  playing: boolean;
  onToggle: () => void;
  speed: number;
  onSpeed: (s: number) => void;
  onReplay: () => void;
}) {
  const noFocus = (e: { preventDefault: () => void }) => e.preventDefault();
  return (
    <div className={css.controls} onMouseDown={noFocus}>
      <button type="button" className={cx(css.btn, css.btnPrimary)} onClick={onToggle} aria-label={playing ? 'Pause animation' : 'Play animation'} title="Space">
        <Icon name={playing ? 'pause' : 'play'} size={14} />
      </button>
      <div className={css.seg} role="group" aria-label="Speed">
        {[0.5, 1, 2].map((s) => (
          <button key={s} type="button" aria-pressed={speed === s} onClick={() => onSpeed(s)}>
            {s}×
          </button>
        ))}
      </div>
      <span className={css.divider} />
      <button type="button" className={css.btn} onClick={onReplay} title="Replay this step (R)">
        <Icon name="replay" size={14} />
        Replay
      </button>
    </div>
  );
}

export function TitleBlock({ code, title, chapter, chapterNo, step, stepNo, total }: { code: string; title: string; chapter: string; chapterNo: number; step: string; stepNo: number; total: number }) {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return (
    <div className={css.titleBlock} aria-hidden>
      <div className={css.tbRow}>
        <span className={css.tbTitle}>{title}</span>
        <span className={css.tbCode}>{code}</span>
      </div>
      <div className={css.tbRow}>
        <span className={css.tbKey}>ch {pad(chapterNo)}</span>
        <span className={css.tbVal}>
          <ScrambleText text={chapter.toUpperCase()} />
        </span>
      </div>
      <div className={css.tbRow}>
        <span className={css.tbKey}>
          {pad(stepNo)}/{pad(total)}
        </span>
        <span className={css.tbVal}>
          <ScrambleText text={step.toUpperCase()} />
        </span>
      </div>
    </div>
  );
}
