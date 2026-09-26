import { useId } from 'react';
import { SIG } from '@/lib/sim/colors';
import type { Box } from '@/lib/sim/Sim';
import kit from '@/components/stage/stage.module.css';
import { PH } from './journey';

const MONO = 'var(--font-mono)';
const SANS = 'var(--font-sans)';

export interface PageState {
  mode: 'blank' | 'layout' | 'paint' | 'done' | 'error';
  k: number;
  loading: boolean;
}

/* The cart page, in page coordinates (320 wide). Order = paint order. */
interface El {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  fill?: string;
  label: string;
}

const PAGE_H = 300;
const ELS: El[] = [
  { id: 'header', x: 0, y: 0, w: 320, h: 40, fill: '#16223b', label: '320×40' },
  { id: 'h1', x: 16, y: 56, w: 180, h: 28, label: '180×28' },
  { id: 'li1', x: 16, y: 98, w: 288, h: 48, label: '288×48' },
  { id: 'li2', x: 16, y: 156, w: 288, h: 48, label: '288×48' },
  { id: 'total', x: 16, y: 214, w: 288, h: 20, label: '288×20' },
  { id: 'btn', x: 16, y: 246, w: 288, h: 38, fill: '#FFD23F', label: '288×38' },
];

function PageMock({ w, h, state, errCode, vt }: { w: number; h: number; state: PageState; errCode: string; vt: number }) {
  const s = Math.min(w / 320, h / PAGE_H);
  const ox = (w - 320 * s) / 2;
  const tiny = s < 0.6;
  if (state.mode === 'error') {
    const cy = h * 0.34;
    return (
      <g>
        <rect width={w} height={h} fill="rgba(255,77,106,0.07)" />
        <g transform={`translate(${w / 2},${cy})`}>
          <path d="M0,-14 L13,9 L-13,9 Z" fill="none" stroke={SIG.err} strokeWidth={1.8} strokeLinejoin="round" />
          <line x1={0} y1={-5} x2={0} y2={2} stroke={SIG.err} strokeWidth={1.8} strokeLinecap="round" />
          <circle cx={0} cy={5.6} r={1.1} fill={SIG.err} />
        </g>
        <text x={w / 2} y={cy + 30} textAnchor="middle" style={{ fontFamily: SANS, fontSize: tiny ? 9 : 13, fontWeight: 600, fill: SIG.text }}>
          {tiny ? 'Not private' : 'Your connection is not private'}
        </text>
        {!tiny && (
          <text x={w / 2} y={cy + 50} textAnchor="middle" style={{ fontFamily: MONO, fontSize: 9, fill: '#ffb3c0' }}>
            {errCode}
          </text>
        )}
      </g>
    );
  }
  if (state.mode === 'blank') {
    return <rect width={w} height={h} fill="rgba(4,7,13,0.55)" />;
  }
  const n = ELS.length;
  const laid = state.mode === 'layout' ? Math.ceil(state.k * n) : n;
  const painted = state.mode === 'layout' ? 0 : state.mode === 'paint' ? Math.floor(state.k * (n + 1)) : n;
  const shimmer = state.mode === 'paint' ? 0.5 + 0.5 * Math.sin(vt * 9) : 0;
  const T = (x: number, y: number) => `translate(${ox + x * s},${y * s})`;
  return (
    <g>
      <rect width={w} height={h} fill={painted > 0 ? '#0e1628' : 'rgba(4,7,13,0.55)'} />
      {ELS.slice(0, laid).map((el, i) => {
        const on = i < painted;
        const bw = el.w * s;
        const bh = el.h * s;
        return (
          <g key={el.id} transform={T(el.x, el.y)}>
            {!on && (
              <>
                <rect width={bw} height={bh} fill="rgba(255,126,182,0.05)" stroke={PH.render} strokeOpacity={0.85} strokeDasharray="3 2" strokeWidth={1} />
                {!tiny && bh > 14 && (
                  <text x={bw - 4} y={bh - 4} textAnchor="end" style={{ fontFamily: MONO, fontSize: 7.5, fill: PH.render }}>
                    {el.label}
                  </text>
                )}
              </>
            )}
            {on && <ElPainted el={el} s={s} tiny={tiny} />}
            {on && state.mode === 'paint' && i === painted - 1 && <rect width={bw} height={bh} fill="#fff" opacity={0.18 * shimmer} />}
          </g>
        );
      })}
    </g>
  );
}

function ElPainted({ el, s, tiny }: { el: El; s: number; tiny: boolean }) {
  const bw = el.w * s;
  const bh = el.h * s;
  const bar = (x: number, y: number, w: number, h: number, c: string, key?: string) => <rect key={key} x={x * s} y={y * s} width={w * s} height={h * s} rx={1.5} fill={c} />;
  const txt = (x: number, y: number, t: string, size: number, color: string, anchor: 'start' | 'end' | 'middle' = 'start', weight = 400) => (
    <text x={x * s} y={y * s} textAnchor={anchor} style={{ fontFamily: SANS, fontSize: size * s, fill: color, fontWeight: weight }}>
      {t}
    </text>
  );
  switch (el.id) {
    case 'header':
      return (
        <g>
          <rect width={bw} height={bh} fill="#16223b" />
          {tiny ? bar(14, 15, 70, 10, '#8fe9ff') : txt(14, 26, 'shop.example', 14, '#8fe9ff', 'start', 600)}
          <g transform={`translate(${292 * s},${20 * s}) scale(${s})`} stroke="#cfd8ea" strokeWidth={1.6} fill="none" strokeLinecap="round" strokeLinejoin="round">
            <path d="M-10,-7 L-7,-7 L-4,5 L7,5 L9,-3 L-5,-3" />
            <circle cx={-2} cy={9} r={1.4} />
            <circle cx={5} cy={9} r={1.4} />
          </g>
        </g>
      );
    case 'h1':
      return tiny ? bar(0, 6, 130, 16, '#e8eef9') : txt(0, 22, 'Your cart', 24, '#e8eef9', 'start', 600);
    case 'li1':
    case 'li2': {
      const name = el.id === 'li1' ? 'Trail boots' : 'Wool socks';
      const sub = el.id === 'li1' ? 'size 42 · qty 1' : 'qty 2';
      const price = el.id === 'li1' ? '$129' : '$24';
      return (
        <g>
          <rect width={48 * s} height={48 * s} rx={4 * s} fill="url(#kit-hatch-dim)" stroke="rgba(143,166,201,0.35)" />
          <path d={`M${8 * s},${38 * s} L${20 * s},${24 * s} L${28 * s},${32 * s} L${34 * s},${27 * s} L${42 * s},${38 * s}`} fill="none" stroke="rgba(143,166,201,0.5)" strokeWidth={1} />
          {tiny ? (
            <>
              {bar(60, 10, 110, 11, '#e8eef9')}
              {bar(60, 28, 70, 8, '#6f7d97')}
              {bar(250, 10, 38, 11, '#e8eef9')}
            </>
          ) : (
            <>
              {txt(60, 20, name, 14, '#e8eef9', 'start', 500)}
              {txt(60, 38, sub, 11, '#8a97ad')}
              {txt(288, 20, price, 14, '#e8eef9', 'end', 500)}
            </>
          )}
          <line x1={0} y1={bh + 5 * s} x2={bw} y2={bh + 5 * s} stroke="rgba(143,166,201,0.18)" />
        </g>
      );
    }
    case 'total':
      return tiny ? (
        <g>
          {bar(0, 5, 50, 10, '#a9b6cc')}
          {bar(248, 5, 40, 10, '#e8eef9')}
        </g>
      ) : (
        <g>
          {txt(0, 15, 'Total', 13, '#a9b6cc')}
          {txt(288, 15, '$153', 14, '#e8eef9', 'end', 600)}
        </g>
      );
    case 'btn':
      return (
        <g>
          <rect width={bw} height={bh} rx={6 * s} fill="#FFD23F" />
          {tiny ? bar(114, 14, 60, 10, '#1b1500') : txt(144, 25, 'Checkout', 14, '#1b1500', 'middle', 600)}
        </g>
      );
    default:
      return null;
  }
}

/** A browser window: tab strip, URL bar and the page area. */
export function BrowserWindow({
  box,
  state,
  vt,
  dim,
  glow,
  urlGlow,
  errCode = 'NET::ERR_CERT_DATE_INVALID',
  secure,
}: {
  box: Box;
  state: PageState;
  vt: number;
  dim?: boolean;
  glow?: boolean;
  urlGlow?: boolean;
  errCode?: string;
  secure: boolean;
}) {
  const clip = `bw-${useId().replace(/:/g, '')}`;
  const { w, h } = box;
  const small = w < 170;
  const tabH = small ? 17 : 22;
  const urlY = tabH + 3;
  const urlH = small ? 16 : 21;
  const vpY = urlY + urlH + (small ? 4 : 6);
  const vpH = Math.max(10, h - vpY - 5);
  const title = state.mode === 'done' ? 'Your cart · shop' : state.mode === 'error' ? 'Privacy error' : 'shop.example';
  const url = small ? 'shop.example/cart' : 'https://shop.example/cart';
  const spin = state.loading;
  return (
    <g transform={`translate(${box.x - w / 2},${box.y - h / 2})`} opacity={box.alpha * (dim ? 0.3 : 1)}>
      {glow && <rect x={-6} y={-6} width={w + 12} height={h + 12} rx={14} fill="none" stroke="var(--accent)" strokeWidth={1.4} strokeDasharray="3 3" />}
      <rect className={kit.card} width={w} height={h} rx={10} />
      <path d={`M0,${tabH} H${w}`} stroke="rgba(143,166,201,0.2)" />
      {[0, 1, 2].map((i) => (
        <circle key={i} cx={(small ? 8 : 11) + i * (small ? 7 : 9)} cy={tabH / 2} r={small ? 2 : 2.6} fill="rgba(143,166,201,0.3)" />
      ))}
      <g transform={`translate(${small ? 30 : 40},${small ? 3 : 4})`}>
        <path
          d={`M0,${tabH - (small ? 3 : 4)} V4 Q0,0 4,0 H${Math.min(w - (small ? 36 : 50), small ? 96 : 140) - 4} Q${Math.min(w - (small ? 36 : 50), small ? 96 : 140)},0 ${Math.min(w - (small ? 36 : 50), small ? 96 : 140)},4 V${tabH - (small ? 3 : 4)}`}
          fill="rgba(143,166,201,0.08)"
          stroke="rgba(143,166,201,0.25)"
        />
        {spin ? (
          <circle
            cx={9}
            cy={(tabH - (small ? 3 : 4)) / 2}
            r={small ? 3.2 : 4}
            fill="none"
            stroke={SIG.req}
            strokeWidth={1.5}
            strokeDasharray="12 20"
            transform={`rotate(${(vt * 360) % 360} 9 ${(tabH - (small ? 3 : 4)) / 2})`}
          />
        ) : (
          <circle cx={9} cy={(tabH - (small ? 3 : 4)) / 2} r={small ? 2.6 : 3.4} fill={state.mode === 'error' ? SIG.err : state.mode === 'done' ? '#FFD23F' : 'rgba(143,166,201,0.4)'} />
        )}
        <text x={18} y={(tabH - (small ? 3 : 4)) / 2 + 3.5} style={{ fontFamily: SANS, fontSize: small ? 8.5 : 10.5, fill: SIG.text2 }}>
          {title}
        </text>
      </g>
      <g transform={`translate(6,${urlY})`}>
        <rect width={w - 12} height={urlH} rx={urlH / 2} fill="rgba(4,7,13,0.6)" stroke={urlGlow ? 'var(--accent)' : 'rgba(143,166,201,0.2)'} strokeWidth={urlGlow ? 1.4 : 1} />
        <g transform={`translate(${small ? 9 : 12},${urlH / 2})`} stroke={state.mode === 'error' ? SIG.err : secure ? SIG.text2 : SIG.dim} strokeWidth={1.2} fill="none">
          <rect x={-3.2} y={-1} width={6.4} height={5} rx={1} />
          <path d="M-2,-1 V-3 A2,2 0 0,1 2,-3 V-1" />
        </g>
        <text x={small ? 17 : 22} y={urlH / 2 + 3.4} style={{ fontFamily: MONO, fontSize: small ? 8.5 : 10.5, fill: SIG.text }}>
          {url}
        </text>
      </g>
      <defs>
        <clipPath id={clip}>
          <rect x={4} y={vpY} width={w - 8} height={vpH} rx={5} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clip})`}>
        <g transform={`translate(4,${vpY})`}>
          <PageMock w={w - 8} h={vpH} state={state} errCode={errCode} vt={vt} />
        </g>
      </g>
      <rect x={4} y={vpY} width={w - 8} height={vpH} rx={5} fill="none" stroke="rgba(143,166,201,0.14)" />
    </g>
  );
}
