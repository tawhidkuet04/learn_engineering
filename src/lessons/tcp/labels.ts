import { SIG } from '@/lib/sim/colors';
import type { Seg, TcpModel, TcpState } from './model';

/* Text and color conventions for segments, shared by every view. */

export const CLIENT = { name: 'Alice’s laptop', short: 'Alice', ip: '198.51.100.42', port: 51514 };
export const SERVER = { name: 'photos.example', short: 'server', ip: '203.0.113.10', port: 443 };

export function segColor(s: Seg): string {
  if (s.status === 'lost') return SIG.err;
  if (s.rtx) return SIG.heavy;
  switch (s.kind) {
    case 'syn':
    case 'data':
    case 'fin':
      return SIG.req;
    case 'probe':
    case 'wupd':
      return SIG.hc;
    case 'ack':
      return s.dup ? SIG.warn : SIG.res;
    default:
      return SIG.res;
  }
}

export interface LabelOpts {
  abs?: boolean;
  win?: boolean;
}

/** Caption candidates for a segment, longest first; the drawing picks the first that fits. */
export function segTexts(m: TcpModel, s: Seg, o: LabelOpts): string[] {
  const A = (space: 'c' | 's', rel: number) => (o.abs ? (space === 'c' ? m.absC(rel) : m.absS(rel)) : rel);
  const r = s.rtx ? '↻ ' : '';
  if (s.kind === 'data') return [`${r}seq=${A('c', s.seq)} len=${s.len}`, `${r}seq=${A('c', s.seq)}`];
  if (s.kind === 'ack' && s.from === 's') {
    const ack = `ack=${s.conceal ? '?' : A('c', s.ack)}`;
    if (s.dup) return [`${ack} · dup ${s.dup}`, `dup ${s.dup}`];
    if (s.conceal) return [ack];
    return o.win ? [`${ack} win=${s.win}`, `win=${s.win}`, ack] : [ack];
  }
  if (s.kind === 'wupd') return [`${`ack=${A('c', s.ack)}`} win=${s.win}`, `win=${s.win}`];
  return [segText(m, s, o, false), segText(m, s, o, true)];
}

/** Label for a segment, tcpdump-style but spelled out. */
export function segText(m: TcpModel, s: Seg, o: LabelOpts, short: boolean): string {
  const A = (space: 'c' | 's', rel: number) => (o.abs ? (space === 'c' ? m.absC(rel) : m.absS(rel)) : rel);
  const hide = s.conceal;
  switch (s.kind) {
    case 'syn':
      return `${s.rtx ? '↻ ' : ''}${short ? 'SYN' : `SYN seq=${A('c', s.seq)}`}`;
    case 'synack':
      return `${s.rtx ? '↻ ' : ''}${short ? (hide ? 'SYN-ACK ack=?' : 'SYN-ACK') : `SYN-ACK seq=${A('s', s.seq)} ack=${hide ? '?' : A('c', s.ack)}`}`;
    case 'ack':
      if (s.from === 'c') return short && !hide ? 'ACK' : `ACK ack=${hide ? '?' : A('s', s.ack)}`;
      return `ack=${hide ? '?' : A('c', s.ack)}${o.win && !short ? ` win=${s.win}` : ''}${s.dup ? ` · dup ${s.dup}` : ''}`;
    case 'wupd':
      return short ? `win=${s.win}` : `ack=${A('c', s.ack)} win=${s.win}`;
    case 'data':
      return `${s.rtx ? '↻ ' : ''}${short ? `seq=${A('c', s.seq)}` : `seq=${A('c', s.seq)} len=${s.len}`}`;
    case 'fin':
      return `${s.rtx ? '↻ ' : ''}FIN seq=${s.from === 'c' ? A('c', s.seq) : A('s', s.seq)}`;
    case 'probe':
      return short ? 'probe' : 'window probe';
    default:
      return '';
  }
}

export function stateTone(st: TcpState): string {
  switch (st) {
    case 'ESTABLISHED':
      return SIG.res;
    case 'SYN_SENT':
    case 'SYN_RECEIVED':
      return SIG.warn;
    case 'CLOSED':
    case 'LISTEN':
      return SIG.text2;
    case 'TIME_WAIT':
      return SIG.heavy;
    default:
      return SIG.hc;
  }
}

export function fmtMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 10000) return `${(ms / 1000).toFixed(2)} s`;
  return `${(ms / 1000).toFixed(1)} s`;
}

export function fmtBytes(b: number): string {
  if (b >= 1e6) return `${(b / 1e6).toFixed(2)} MB`;
  if (b >= 1e4) return `${(b / 1e3).toFixed(1)} KB`;
  return `${b} B`;
}

export function fmtRate(bytesPerSec: number): string {
  const bits = bytesPerSec * 8;
  if (bits >= 1e6) return `${(bits / 1e6).toFixed(2)} Mbit/s`;
  return `${Math.round(bits / 1e3)} kbit/s`;
}

/** Rough width of monospace text at a given font size */
export function textW(t: string, size = 10.5) {
  return t.length * size * 0.6;
}
