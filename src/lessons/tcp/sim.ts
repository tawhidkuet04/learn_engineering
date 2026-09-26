import { SIG } from '@/lib/sim/colors';
import { PredictGame } from '@/lib/sim/predict';
import { damp } from '@/lib/sim/geometry';
import { Sim, type ScriptEvent, type WireSpec } from '@/lib/sim/Sim';
import { pipeGeom, pipePos } from './geom';
import { NetDemo, type NetMode } from './net';
import { TcpModel, type CcAlgo, type LossKind, type ModelEvent, type Seg, type SegKind, type TcpConfig, type TimerKind } from './model';

export type View = 'net' | 'seq' | 'pipe';
export type Scenario = 'handshake' | 'data' | 'teardown' | 'lifecycle';
export type PredictKind = 'handshake' | 'ack' | 'cwnd';

/** What the sequence-diagram view shows around the diagram */
export interface SeqOpts {
  /** Absolute (random ISN based) sequence numbers instead of relative ones */
  abs?: boolean;
  /** Show win= on ACK labels */
  win?: boolean;
  /** Sender's window strip in the top band */
  strip?: boolean;
  /** Draw the usable / not-yet-allowed parts of the window on the strip */
  window?: boolean;
  /** Receiver's buffer in the top band */
  rbuf?: boolean;
  /** Right-hand readout */
  side?: 'rto' | 'dup' | null;
  /** Header inspector riding along with a segment */
  inspect?: boolean;
  /** "1 RTT" bracket on the client lifeline */
  rtt?: boolean;
  /** Timers drawn as bars on the lifelines */
  timers?: TimerKind[];
  /** Segment kinds the learner may click to drop */
  drop?: SegKind[];
}

export interface PipeOpts {
  strip?: boolean;
  chart?: boolean;
  /** Receiver buffer gauge under the server */
  rbuf?: boolean;
}

export interface StepCfg {
  view: View;
  net?: NetMode;
  scenario?: Scenario;
  tcp?: Partial<TcpConfig>;
  seq?: SeqOpts;
  pipe?: PipeOpts;
  /** Restart the scenario after this many quiet seconds */
  loop?: number;
  /** Delay before the scenario's first action, seconds */
  start?: number;
  seed?: number;
  /** Data segments lost on their first transmission, in every run */
  lose?: number[];
}

const SEQ_TCP: Partial<TcpConfig> = {
  path: 'direct',
  msPerSec: 62.5,
  owd: 50,
  jitter: 3,
  gap: 18,
  cc: 'none',
  fixedWnd: 4,
  sack: false,
  rbuf: 44,
  warp: true,
};

const PIPE_TCP: Partial<TcpConfig> = {
  path: 'bottleneck',
  msPerSec: 100,
  owd: 50,
  jitter: 1,
  gap: 4,
  svc: 12.5,
  qcap: 8,
  cc: 'reno',
  sack: true,
  rbuf: 256,
  initCwnd: 10,
  warp: false,
};

const NET_IDS = ['alice', 'r1', 'r2', 'r3', 'r4', 'srv'];
const SEQ_IDS = ['hdrC', 'hdrS', 'body', 'sendStrip', 'rbuf', 'side'];
const PIPE_IDS = ['pAlice', 'pRouter', 'pSrv', 'queue', 'chart', 'pStrip'];

const fmt = (n: number) => String(n);

export class TcpSim extends Sim {
  cfg: StepCfg = { view: 'seq', scenario: 'handshake' };
  view: View = 'seq';
  model: TcpModel | null = null;
  net: NetDemo | null = null;
  game: PredictGame | null = null;
  predict: PredictKind | null = null;
  /** Segment ids the learner dropped (for the HUD) */
  userDrops = 0;
  /** Bumps when the model is rebuilt, so drawings can reset their memory */
  epoch = 0;
  /** Eased left edge (in segments) of the sender strip and receive buffer */
  stripOff = 0;
  rbufOff = 0;

  private quietFor = 0;
  private loopN = 0;
  private cwndNext: LossKind = 'fast';
  private askIdx = new Set<number>();
  private hsAsked = { synack: false, ack: false };
  private closing = -1;

  constructor() {
    super();
    for (const id of SEQ_IDS.slice(0, 3)) this.box(id);
  }

  /* ================================================================ */
  /* Steps                                                             */
  /* ================================================================ */

  enter(cfg: StepCfg, script: ScriptEvent<TcpSim>[] = [], predict?: { kind: PredictKind; rounds: number }) {
    this.clearTransient();
    this.cfg = cfg;
    this.view = cfg.view;
    this.predict = predict?.kind ?? null;
    this.game = predict ? new PredictGame(this, predict.rounds) : null;
    this.loopN = 0;
    this.quietFor = 0;
    this.cwndNext = 'fast';
    this.userDrops = 0;
    this.syncBoxes();
    this.net = cfg.view === 'net' ? new NetDemo(this, cfg.net ?? 'udp') : null;
    this.model = cfg.view === 'net' ? null : this.build();
    this.runScript(script);
    this.relayout();
    this.rev++;
  }

  private syncBoxes() {
    const live = new Set<string>();
    if (this.view === 'net') NET_IDS.forEach((id) => live.add(id));
    if (this.view === 'seq') {
      ['hdrC', 'hdrS', 'body'].forEach((id) => live.add(id));
      if (this.cfg.seq?.strip) live.add('sendStrip');
      if (this.cfg.seq?.rbuf) live.add('rbuf');
      if (this.cfg.seq?.side || this.cfg.seq?.inspect) live.add('side');
    }
    if (this.view === 'pipe') {
      ['pAlice', 'pRouter', 'pSrv', 'queue'].forEach((id) => live.add(id));
      if (this.cfg.pipe?.chart) live.add('chart');
      if (this.cfg.pipe?.strip) live.add('pStrip');
    }
    for (const id of [...NET_IDS, ...SEQ_IDS, ...PIPE_IDS]) {
      if (live.has(id)) this.box(id);
      else this.hide(id);
    }
  }

  tcpConfig(): Partial<TcpConfig> {
    const base = this.view === 'pipe' ? PIPE_TCP : SEQ_TCP;
    return { ...base, ...this.cfg.tcp, seed: (this.cfg.seed ?? 7) + this.loopN * 17 };
  }

  private build(): TcpModel {
    const m = new TcpModel(this.tcpConfig());
    m.hooks = {
      onSend: (s) => this.onSend(s),
      onLoss: (k, apply) => this.onLoss(k, apply),
      onEvent: (e) => this.onModelEvent(e),
      stop: () => this.frozen,
    };
    for (const i of this.cfg.lose ?? []) m.dropIdx.add(i);
    this.hsAsked = { synack: false, ack: false };
    this.askIdx = new Set(this.predict === 'ack' ? [1, 3, 5] : []);
    this.closing = -1;
    const start = this.cfg.start ?? 0.5;
    switch (this.cfg.scenario ?? 'data') {
      case 'handshake':
      case 'lifecycle':
        m.startClosed();
        this.after(start, () => m.connect());
        break;
      case 'teardown':
        m.startEstablished();
        this.after(start, () => m.close());
        break;
      default:
        m.startEstablished();
        this.after(start, () => m.kick());
    }
    this.epoch++;
    this.stripOff = 0;
    this.rbufOff = 0;
    return m;
  }

  /** Start the current scenario over with a fresh connection. */
  restart() {
    this.clearTransient();
    this.loopN++;
    this.quietFor = 0;
    this.model = this.view === 'net' ? null : this.build();
    if (this.view === 'net') this.net = new NetDemo(this, this.net?.mode ?? this.cfg.net ?? 'udp');
    if (this.game && !this.game.done) this.game.pending = null;
    this.frozen = false;
    this.rev++;
  }

  private done(m: TcpModel) {
    switch (this.cfg.scenario ?? 'data') {
      case 'handshake':
        return m.cState === 'ESTABLISHED' && m.sState === 'ESTABLISHED';
      case 'teardown':
      case 'lifecycle':
        return m.cState === 'CLOSED' && m.sState === 'CLOSED';
      default:
        return Number.isFinite(m.cfg.total) && m.una >= m.cfg.total;
    }
  }

  protected step(dt: number) {
    this.net?.step(dt);
    const m = this.model;
    if (!m) return;
    m.advance(dt);
    m.prune(this.orient === 'portrait' ? 30 : 40);
    // The whole-life scenario: close shortly after the upload finishes.
    if (this.cfg.scenario === 'lifecycle' && m.cState === 'ESTABLISHED' && Number.isFinite(m.cfg.total) && m.una >= m.cfg.total && !m.closeWanted) {
      if (this.closing < 0) this.closing = 0;
      this.closing += dt;
      if (this.closing > 0.7) m.close();
    }
    if (this.cfg.loop != null && !this.frozen && m.quiescent() && this.done(m)) {
      this.quietFor += dt;
      if (this.quietFor >= this.cfg.loop) {
        this.loopN++;
        this.quietFor = 0;
        this.clearTransient();
        this.model = this.build();
        this.rev++;
      }
    } else this.quietFor = 0;
  }

  /* ================================================================ */
  /* Predictions                                                       */
  /* ================================================================ */

  private shuffle<T>(a: T[]): T[] {
    const out = [...a];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  private onSend(s: Seg) {
    const g = this.game;
    const m = this.model;
    if (!g || g.done || g.pending || !m) return;
    if (this.predict === 'handshake') {
      const x = m.cIss;
      const y = m.sIss;
      if (s.kind === 'synack' && !this.hsAsked.synack) {
        this.hsAsked.synack = true;
        s.conceal = true;
        g.ask({
          acceptable: ['x1'],
          choices: this.shuffle([
            { id: 'x', label: fmt(x) },
            { id: 'x1', label: fmt(x + 1) },
            { id: 'y1', label: fmt(y + 1) },
          ]),
          ask: 'SYN-ACK: ack = ?',
          explain: (_p, ok) =>
            ok
              ? `Alice's SYN used sequence number ${x} itself, so the next number the server expects from her is ${x + 1}.`
              : `The ack field says what the server expects next from Alice. Her SYN used up ${x}, so it's ${x} + 1 = ${x + 1}.`,
          resolve: () => {
            s.conceal = false;
            this.rev++;
          },
        });
      } else if (s.kind === 'ack' && s.from === 'c' && !this.hsAsked.ack) {
        this.hsAsked.ack = true;
        s.conceal = true;
        g.ask({
          acceptable: ['y1'],
          choices: this.shuffle([
            { id: 'y', label: fmt(y) },
            { id: 'y1', label: fmt(y + 1) },
            { id: 'x1', label: fmt(x + 1) },
          ]),
          ask: 'ACK: ack = ?',
          explain: (_p, ok) =>
            ok
              ? `The server's SYN used ${y}, so Alice acknowledges it by asking for ${y + 1} next.`
              : `Alice is acknowledging the server's SYN, which used sequence number ${y}. She asks for ${y} + 1 = ${y + 1}.`,
          resolve: () => {
            s.conceal = false;
            this.rev++;
          },
        });
      }
      return;
    }
    if (this.predict === 'ack' && s.from === 's' && s.kind === 'ack' && m.lastData && this.askIdx.has(m.lastData.idx) && !m.lastData.rtx) {
      const d = m.lastData;
      this.askIdx.delete(d.idx);
      const next = d.seq + d.len;
      s.conceal = true;
      g.ask({
        acceptable: ['next'],
        choices: this.shuffle([
          { id: 'seq', label: fmt(d.seq) },
          { id: 'last', label: fmt(next - 1) },
          { id: 'next', label: fmt(next) },
        ]),
        ask: `got seq ${d.seq}, len ${d.len}: ack = ?`,
        explain: (p, ok) =>
          ok
            ? `Bytes ${d.seq} to ${next - 1} are in, so the server asks for byte ${next} next: seq + len.`
            : p === 'last'
              ? `${next - 1} is the last byte it has. An ACK names the next byte it wants: ${d.seq} + ${d.len} = ${next}.`
              : `${d.seq} is where this segment started. The ACK names the next byte expected: ${d.seq} + ${d.len} = ${next}.`,
        resolve: () => {
          s.conceal = false;
          this.rev++;
        },
      });
    }
  }

  private onLoss(kind: LossKind, apply: () => void): boolean {
    const g = this.game;
    const m = this.model;
    if (this.predict !== 'cwnd' || !g || g.done || g.pending || !m || kind !== this.cwndNext) return false;
    const cw = Math.max(1, Math.floor(m.cwnd + 1e-9));
    const half = Math.max(2, Math.floor(cw / 2));
    if (kind === 'fast') {
      g.ask({
        acceptable: ['half'],
        choices: [
          { id: 'grow', label: `Keeps growing (${cw + 1})` },
          { id: 'half', label: `Halves (to ${half})` },
          { id: 'one', label: 'Back to 1' },
        ],
        ask: '3 duplicate ACKs: cwnd = ?',
        explain: (_p, ok) =>
          ok
            ? `Duplicate ACKs mean packets are still getting through, so the congestion is mild: Reno halves cwnd (${cw} → ${half}) and keeps going.`
            : `A loss is the signal to back off, but duplicate ACKs show later packets still arrive. That calls for a cut, not a full stop: Reno halves cwnd (${cw} → ${half}).`,
        resolve: () => {
          apply();
          this.cwndNext = 'rto';
          this.after(3, () => this.hiccup());
          this.rev++;
        },
      });
    } else {
      g.ask({
        acceptable: ['one'],
        choices: [
          { id: 'half', label: `Halves (to ${half})` },
          { id: 'one', label: 'Back to 1, slow start again' },
          { id: 'same', label: `Stays at ${cw}` },
        ],
        ask: 'Timeout! cwnd = ?',
        explain: (_p, ok) =>
          ok
            ? `Silence means nothing is getting through, so TCP assumes the worst: cwnd drops to 1 segment and slow start begins again, up to the new ssthresh (${half}).`
            : `A timeout means no ACKs at all came back. TCP assumes heavy congestion: cwnd goes back to 1 and slow start rebuilds it, up to ssthresh = ${half}.`,
        resolve: () => {
          apply();
          this.cwndNext = 'fast';
          this.rev++;
        },
      });
    }
    return true;
  }

  /* ================================================================ */
  /* Model events → stage effects                                      */
  /* ================================================================ */

  private onModelEvent(e: ModelEvent) {
    const m = this.model;
    if (!m) return;
    if (e.type === 'lost' && this.view === 'pipe') {
      const g = pipeGeom(this, m);
      const p = g && pipePos(g, m, e.seg);
      if (p) this.fx({ kind: 'x', at: { x: p.x, y: p.y }, color: SIG.err, dur: 1 });
    }
    if (e.type === 'fast') {
      if (this.view === 'seq') m.note('c', '3 dup ACKs', 'warn');
      else this.sayBelow('pAlice', '3 dup ACKs: resend', SIG.heavy, 1.6);
    } else if (e.type === 'rto') {
      if (this.view === 'seq') m.note('c', 'RTO fired', 'bad');
      else this.sayBelow('pAlice', 'timeout!', SIG.err, 1.8);
    } else if (e.type === 'zero') {
      if (this.view === 'pipe') this.sayBelow('pSrv', 'window = 0', SIG.hc, 1.4);
    } else if (e.type === 'queueDrop') {
      const b = this.boxes.get('queue');
      if (b) this.fx({ kind: 'x', at: { x: b.x - b.w / 2 - 6, y: b.y }, color: SIG.err, dur: 0.9 });
    }
    this.rev++;
  }

  /** Floating label under a box (the space above is taken by the strip). */
  private sayBelow(id: string, text: string, color: string, dur: number) {
    const b = this.boxes.get(id);
    if (!b) return;
    const half = text.length * 3.4 + 12;
    const x = Math.min(Math.max(b.x, half + 6), this.w - half - 6);
    this.fx({ kind: 'text', at: { x, y: b.y + b.h / 2 + 30 }, text, color, dur });
  }

  /* ================================================================ */
  /* Learner actions                                                   */
  /* ================================================================ */

  canDrop(s: Seg) {
    if (this.frozen || s.status !== 'flight') return false;
    if (this.view === 'pipe') return true;
    const kinds = this.cfg.seq?.drop ?? [];
    return kinds.includes(s.kind) || (s.kind === 'wupd' && kinds.includes('ack'));
  }

  dropSeg(id: number) {
    const m = this.model;
    if (!m || this.frozen) return;
    const s = m.segs.find((x) => x.id === id);
    if (!s || !this.canDrop(s)) return;
    if (m.dropSeg(id)) {
      this.userDrops++;
      this.rev++;
    }
  }

  /** A fresh connection that loses the given segments on the way. */
  replayWith(drops: { kind: SegKind; from?: 'c' | 's'; n: number }[]) {
    this.restart();
    for (const d of drops) this.model?.dropNext.push({ ...d });
    this.rev++;
  }

  /** Drop the next segment of this kind (buttons in the panel). */
  dropNext(kind: SegKind, from?: 'c' | 's') {
    this.model?.dropNext.push({ kind, from, n: 1 });
    this.rev++;
  }

  hiccup(ms = 320) {
    this.model?.outage(ms);
    this.rev++;
  }

  setNetMode(mode: NetMode) {
    this.clearTransient();
    this.cfg = { ...this.cfg, net: mode };
    this.net = new NetDemo(this, mode);
    this.rev++;
  }

  setAppStalled(v: boolean) {
    this.model?.setAppStalled(v);
    this.rev++;
  }

  setAppRate(r: number) {
    this.cfg = { ...this.cfg, tcp: { ...this.cfg.tcp, appRate: r } };
    this.model?.setAppRate(r);
    this.rev++;
  }

  setLoss(p: number) {
    this.cfg = { ...this.cfg, tcp: { ...this.cfg.tcp, loss: p } };
    this.model?.setLoss(p);
    this.rev++;
  }

  setRtt(ms: number) {
    this.cfg = { ...this.cfg, tcp: { ...this.cfg.tcp, owd: ms / 2 } };
    this.model?.setOwd(ms / 2);
    this.rev++;
  }

  setCc(cc: CcAlgo) {
    this.cfg = { ...this.cfg, tcp: { ...this.cfg.tcp, cc } };
    this.model?.setCc(cc);
    this.rev++;
  }

  /** Congestion control on/off: a fresh connection either way. */
  setCongestionControl(on: boolean) {
    this.cfg = { ...this.cfg, tcp: { ...this.cfg.tcp, cc: on ? 'reno' : 'none' } };
    this.restart();
  }

  /* ================================================================ */
  /* Layout                                                            */
  /* ================================================================ */

  protected layout() {
    const { w, h } = this;
    const port = this.orient === 'portrait';
    if (this.view === 'net') {
      if (!port) {
        const y = h * 0.43;
        this.place('alice', Math.max(96, w * 0.1), y, 150, 44);
        this.place('r1', w * 0.3, y, 46, 46);
        this.place('r2', w * 0.5, y - Math.min(150, h * 0.19), 46, 46);
        this.place('r3', w * 0.5, y + Math.min(150, h * 0.19), 46, 46);
        this.place('r4', w * 0.7, y, 46, 46);
        this.place('srv', Math.min(w - 96, w * 0.9), y, 156, 52);
      } else {
        const cw = Math.min(w - 24, 190);
        this.place('alice', w / 2, 82, cw, 40);
        this.place('r1', w / 2, 170, 40, 40);
        this.place('r2', w * 0.24, 250, 40, 40);
        this.place('r3', w * 0.76, 250, 40, 40);
        this.place('r4', w / 2, 330, 40, 40);
        this.place('srv', w / 2, 404, cw, 44);
      }
      return;
    }

    if (this.view === 'seq') {
      const o = this.cfg.seq ?? {};
      const hasStrip = !!o.strip;
      const hasRbuf = !!o.rbuf;
      const side = (!!o.side || !!o.inspect) && !port;
      let top = port ? 66 : 72;
      if (!port) {
        if (hasStrip || hasRbuf) {
          const bandH = 74;
          const both = hasStrip && hasRbuf;
          if (hasStrip) this.place('sendStrip', both ? (24 + w / 2 - 12) / 2 : w / 2, top + bandH / 2, both ? w / 2 - 36 : w - 48, bandH);
          if (hasRbuf) this.place('rbuf', both ? (w / 2 + 12 + w - 24) / 2 : w / 2, top + bandH / 2, both ? w / 2 - 36 : w - 48, bandH);
          top += bandH + 18;
        }
      } else {
        const bandH = 58;
        if (hasStrip) {
          this.place('sendStrip', w / 2, top + bandH / 2, w - 20, bandH);
          top += bandH + 6;
        }
        if (hasRbuf) {
          this.place('rbuf', w / 2, top + bandH / 2, w - 20, bandH);
          top += bandH + 6;
        }
        top += 4;
      }
      const xc = port ? w * 0.25 : side ? w * 0.15 : w * 0.24;
      const xs = port ? w * 0.75 : side ? w * 0.6 : w * 0.76;
      const hw = port ? Math.min(160, w * 0.44) : Math.min(200, (xs - xc) * 0.46);
      const hh = port ? 38 : 44;
      this.place('hdrC', xc, top + hh / 2, hw, hh);
      this.place('hdrS', xs, top + hh / 2, hw, hh);
      const bodyTop = top + hh + (port ? 24 : 28);
      const bodyBottom = h - (port ? (o.side || o.inspect ? 150 : 92) : 80);
      this.place('body', w / 2, (bodyTop + bodyBottom) / 2, w, Math.max(80, bodyBottom - bodyTop));
      if (side) {
        const sw = Math.min(268, w * 0.29);
        this.place('side', w - 18 - sw / 2, bodyTop + 4, sw, 10);
      } else if (port && (o.side || o.inspect)) this.place('side', w / 2, h - 100, w - 20, 10);
      return;
    }

    // pipe
    const o = this.cfg.pipe ?? {};
    if (!port) {
      let top = 72;
      if (o.strip) {
        this.place('pStrip', w / 2, top + 36, w - 48, 72);
        top += 72 + 22;
      }
      const y = top + 34;
      const bw = Math.min(160, w * 0.17);
      this.place('pAlice', 24 + bw / 2, y, bw, 52);
      this.place('pSrv', w - 24 - bw / 2, y, bw, 52);
      const rx = w * 0.55;
      this.place('pRouter', rx, y, 96, 52);
      const qw = Math.min(8 * 17, w * 0.2);
      this.place('queue', rx - 48 - 10 - qw / 2, y, qw, 20);
      if (o.chart) {
        const cTop = y + 80;
        const cBottom = h - 96;
        this.place('chart', w / 2, (cTop + cBottom) / 2, w - 48, Math.max(120, cBottom - cTop));
      }
    } else {
      const y = 86;
      const bw = Math.min(96, w * 0.24);
      this.place('pAlice', 10 + bw / 2, y, bw, 40);
      this.place('pSrv', w - 10 - bw / 2, y, bw, 40);
      const rx = w * 0.6;
      this.place('pRouter', rx, y, 56, 40);
      const qw = Math.min(8 * 10, w * 0.2);
      this.place('queue', rx - 28 - 6 - qw / 2, y, qw, 14);
      let top = y + 58;
      if (o.strip) {
        this.place('pStrip', w / 2, top + 28, w - 20, 56);
        top += 56 + 12;
      }
      if (o.chart) {
        const cBottom = h - 88;
        this.place('chart', w / 2, (top + cBottom) / 2, w - 20, Math.max(100, cBottom - top));
      }
    }
  }

  protected animate(dt: number) {
    const m = this.model;
    if (!m) return;
    const total = m.cfg.total;
    const target = Number.isFinite(total) && total <= 14 ? 0 : Math.max(0, m.una - 2);
    this.stripOff = Math.abs(this.stripOff - target) > 40 ? target : damp(this.stripOff, target, 7, dt);
    this.rbufOff = Math.abs(this.rbufOff - m.appRead) > 40 ? m.appRead : damp(this.rbufOff, m.appRead, 7, dt);
  }

  protected wires(): WireSpec[] {
    if (this.view !== 'net') return [];
    return [
      { from: 'alice', to: 'r1' },
      { from: 'r1', to: 'r2' },
      { from: 'r1', to: 'r3', state: 'dashed' },
      { from: 'r2', to: 'r4' },
      { from: 'r3', to: 'r4', state: 'dashed' },
      { from: 'r4', to: 'srv' },
    ];
  }
}
