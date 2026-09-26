'use client';

import type { CSSProperties } from 'react';
import { ScrambleText } from '@/components/lesson/ScrambleText';
import { Icon } from '@/components/lesson/Icon';
import type { HudView } from '../engine/world';
import css from './chrome.module.css';

const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(' ');

export type HudKey = 'throughput' | 'latency' | 'errors' | 'drops' | 'share';

const SHARE_COLORS = ['#45D5FF', '#B59BFF', '#4BE3A0', '#FF9A3C', '#FF7EB6', '#C4F25A'];

function Spark({ series }: { series: number[] }) {
  if (series.length < 2) return null;
  const w = 64;
  const h = 18;
  const max = Math.max(300, ...series);
  const pts = series.map((v, i) => `${((i / (series.length - 1)) * w).toFixed(1)},${(h - (v / max) * h).toFixed(1)}`).join(' ');
  return (
    <svg className={css.spark} width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden>
      <polyline points={pts} fill="none" stroke="#45D5FF" strokeWidth={1.3} strokeLinejoin="round" />
    </svg>
  );
}

export function Hud({ hud, show }: { hud: HudView; show: HudKey[] }) {
  if (!show.length) return null;
  const p95 = hud.p95 == null ? '—' : Math.round(hud.p95).toString();
  return (
    <div className={css.hud} aria-live="off">
      {show.includes('throughput') && (
        <div className={css.chip}>
          <div className={css.chipLabel}>Throughput</div>
          <div className={css.chipValue}>
            {hud.throughput.toFixed(1)} <small>req/s</small>
          </div>
        </div>
      )}
      {show.includes('latency') && (
        <div className={cx(css.chip, hud.p95 != null && hud.p95 > 600 ? css.bad : hud.p95 != null && hud.p95 > 300 && css.warn)}>
          <div className={css.chipLabel}>p95 latency</div>
          <div className={css.chipValue}>
            {p95} <small>ms</small>
            <Spark series={hud.series} />
          </div>
        </div>
      )}
      {show.includes('errors') && (
        <div className={cx(css.chip, hud.errRate > 0.001 && css.bad)}>
          <div className={css.chipLabel}>Errors</div>
          <div className={css.chipValue}>
            {(hud.errRate * 100).toFixed(1)} <small>%</small>
          </div>
        </div>
      )}
      {show.includes('drops') && (
        <div className={cx(css.chip, hud.drops > 0 && css.bad)}>
          <div className={css.chipLabel}>Turned away (503)</div>
          <div className={css.chipValue}>{hud.drops}</div>
        </div>
      )}
      {show.includes('share') && hud.served.length > 0 && (
        <div className={cx(css.chip, css.share)}>
          <div className={css.chipLabel}>Share of requests served</div>
          <div className={css.shareBar}>
            {hud.served.map((s, i) => (
              <i key={s.id} style={{ width: `${s.share * 100}%`, background: SHARE_COLORS[i % SHARE_COLORS.length] }} />
            ))}
          </div>
          <div className={css.shareLegend}>
            {hud.served.map((s, i) => (
              <span key={s.id} style={{ '--c': SHARE_COLORS[i % SHARE_COLORS.length] } as CSSProperties}>
                {s.label} {Math.round(s.share * 100)}%
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export type LegendKey = 'req' | 'res' | 'heavy' | 'err' | 'warn' | 'hc' | 'hb' | 'clients' | 'api' | 'media' | 'sealed' | 'sess';

const LEGEND: Record<LegendKey, { label: string; color: string; shape?: 'small' | 'env' }> = {
  req: { label: 'request', color: '#45D5FF' },
  res: { label: 'response 200', color: '#4BE3A0' },
  heavy: { label: 'heavy request', color: '#FF9A3C' },
  err: { label: 'error 5xx', color: '#FF4D6A' },
  warn: { label: 'wrong cart', color: '#FFD23F' },
  hc: { label: 'health check', color: '#B59BFF', shape: 'small' },
  hb: { label: 'heartbeat', color: '#B59BFF', shape: 'small' },
  clients: { label: 'request (colored by user)', color: '#FF7EB6' },
  api: { label: '/api/*', color: '#45D5FF' },
  media: { label: '/media/*', color: '#FF7EB6' },
  sealed: { label: 'encrypted TCP data', color: '#45D5FF', shape: 'env' },
  sess: { label: 'session lookup', color: '#B59BFF', shape: 'small' },
};

export function Legend({ keys, bottom }: { keys: LegendKey[]; bottom?: number }) {
  if (!keys.length) return null;
  return (
    <div className={css.legend} style={bottom != null ? { bottom } : undefined}>
      {keys.map((k) => (
        <span key={k}>
          <i className={LEGEND[k].shape ? css[LEGEND[k].shape!] : undefined} style={{ '--c': LEGEND[k].color } as CSSProperties} />
          {LEGEND[k].label}
        </span>
      ))}
    </div>
  );
}

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
