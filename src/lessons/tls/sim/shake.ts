import type { WireSpec } from '@/lib/sim/Sim';
import { HOST } from './data';
import type { TlsSim } from './TlsSim';

/*
 * The handshake scene: a sequence diagram of TLS between Alice's browser and
 * shop.example, with Eve's tap in the middle recording what she can read.
 * Notation follows RFC 8446: {…} handshake keys, […] application keys,
 * (…) early-data keys, no brackets = in the clear.
 */

export type ShakeProto = 'http' | 'tls12' | 'tls13';
export type Resume = 'full' | 'ticket' | '0rtt';
export type EarlyReq = 'get' | 'post';

export interface ShakeCfg {
  proto: ShakeProto;
  resume: Resume;
  ech: boolean;
  /** Draw the TCP handshake first (and count it in the timings) */
  tcp: boolean;
  /** Play only the first N TLS flights (0 = all) */
  upto: number;
  /** Round-trip time in ms, for labels */
  rtt: number;
  /** Ask "clear or encrypted?" before the server's first flight */
  predict: boolean;
  early: EarlyReq;
}

export const SHAKE_DEFAULTS: ShakeCfg = { proto: 'tls13', resume: 'full', ech: false, tcp: true, upto: 0, rtt: 80, predict: false, early: 'get' };

export type Enc = 'tcp' | 'clear' | 'hs' | 'app' | 'early' | 'attack';

export interface HsMsg {
  id: string;
  /** Full name in RFC notation, e.g. "{Certificate}" */
  name: string;
  /** Phone label */
  short: string;
  enc: Enc;
  bytes: number;
  /** What Eve can read from it (clear messages) */
  eve?: string;
  /** Explanation for the predict question */
  why?: string;
}

export interface HsFlight {
  n: number;
  dir: 'cs' | 'sc' | 'xs';
  msgs: HsMsg[];
  t0: number;
  t1: number;
}

export interface KeyMark {
  side: 'c' | 's';
  t: number;
  label: string;
}

export interface ServerNote {
  t: number;
  text: string;
  tone: 'ok' | 'warn' | 'bad';
}

export interface NoteEntry {
  n: number;
  dir: HsFlight['dir'];
  clear: { name: string; eve: string }[];
  enc: { count: number; bytes: number };
}

/** One-way trip, in simulated seconds */
export const LEG = 1.15;

const m = (id: string, name: string, short: string, enc: Enc, bytes: number, eve?: string, why?: string): HsMsg => ({ id, name, short, enc, bytes, eve, why });

const WHY = {
  sh: 'It carries the server’s key share. Alice needs it to compute the keys, so it has to travel in the clear.',
  ee: 'The server already has the handshake keys, so everything after ServerHello is encrypted. This one holds settings like the chosen HTTP version.',
  cert: 'Encrypted in TLS 1.3, so Eve can’t even see which certificate you received. TLS 1.2 sent it in the clear.',
  cv: 'The server’s signature over the handshake so far, made with the certificate’s private key. Encrypted like everything after ServerHello.',
  fin: 'A MAC over the whole conversation. If anyone had changed a byte of either hello, this check would fail.',
};

function tlsFlights(c: ShakeCfg): { dir: 'cs' | 'sc'; msgs: HsMsg[] }[] {
  const get = m('get', '[GET /account]', '[GET]', 'app', 431);
  const ok = m('ok', '[HTTP 200 OK]', '[200 OK]', 'app', 18230);
  const sni = c.ech ? 'outer SNI cdn.example · real hello encrypted' : `SNI ${HOST}`;
  if (c.proto === 'http') {
    return [
      { dir: 'cs', msgs: [m('get', 'GET /account', 'GET /account', 'clear', 431, 'GET /account · Cookie: session=8f3e2a9c')] },
      { dir: 'sc', msgs: [m('ok', 'HTTP 200 OK', '200 OK', 'clear', 18230, 'the whole page: Card •••• 4242')] },
    ];
  }
  if (c.proto === 'tls12') {
    if (c.resume !== 'full') {
      return [
        { dir: 'cs', msgs: [m('ch', 'ClientHello + ticket', 'Hello+ticket', 'clear', 517, `SNI ${HOST} · session ticket`)] },
        { dir: 'sc', msgs: [m('sh', 'ServerHello', 'ServerHello', 'clear', 96, 'accepts the ticket'), m('sccs', 'ChangeCipherSpec', 'CCS', 'clear', 6), m('sfin', '{Finished}', '{Finished}', 'hs', 40)] },
        { dir: 'cs', msgs: [m('cccs', 'ChangeCipherSpec', 'CCS', 'clear', 6), m('cfin', '{Finished}', '{Finished}', 'hs', 40), get] },
        { dir: 'sc', msgs: [ok] },
      ];
    }
    return [
      { dir: 'cs', msgs: [m('ch', 'ClientHello', 'ClientHello', 'clear', 517, `SNI ${HOST} · offers TLS 1.2`)] },
      {
        dir: 'sc',
        msgs: [
          m('sh', 'ServerHello', 'ServerHello', 'clear', 96, 'picks ECDHE-ECDSA-AES256-GCM-SHA384'),
          m('cert', 'Certificate', 'Certificate', 'clear', 2100, `certificate: ${HOST}, by Example CA R3`),
          m('ske', 'ServerKeyExchange', 'ServerKeyExch', 'clear', 116, 'server key share (signed)'),
          m('shd', 'ServerHelloDone', 'HelloDone', 'clear', 4),
        ],
      },
      { dir: 'cs', msgs: [m('cke', 'ClientKeyExchange', 'ClientKeyExch', 'clear', 37, 'client key share'), m('cccs', 'ChangeCipherSpec', 'CCS', 'clear', 6), m('cfin', '{Finished}', '{Finished}', 'hs', 40)] },
      { dir: 'sc', msgs: [m('sccs', 'ChangeCipherSpec', 'CCS', 'clear', 6), m('sfin', '{Finished}', '{Finished}', 'hs', 40)] },
      { dir: 'cs', msgs: [get] },
      { dir: 'sc', msgs: [ok] },
    ];
  }
  // TLS 1.3
  if (c.resume === '0rtt') {
    const early = c.early === 'post' ? m('early', '(POST /buy)', '(POST /buy)', 'early', 512) : m('early', '(GET /account)', '(GET)', 'early', 431);
    return [
      { dir: 'cs', msgs: [m('ch', 'ClientHello + early', 'Hello+early', 'clear', 612, `${sni} · ticket · early data`), early] },
      {
        dir: 'sc',
        msgs: [m('sh', 'ServerHello', 'ServerHello', 'clear', 128, 'accepts ticket · x25519 share'), m('ee', '{EncryptedExtensions}', '{EncExt}', 'hs', 40), m('sfin', '{Finished}', '{Finished}', 'hs', 52), c.early === 'post' ? m('ok', '[HTTP 200 OK]', '[200 OK]', 'app', 2400) : ok],
      },
      { dir: 'cs', msgs: [m('eoed', '(EndOfEarlyData)', '(EndOfEarly)', 'early', 20), m('cfin', '{Finished}', '{Finished}', 'hs', 52)] },
    ];
  }
  if (c.resume === 'ticket') {
    return [
      { dir: 'cs', msgs: [m('ch', 'ClientHello + PSK', 'Hello+PSK', 'clear', 612, `${sni} · resumption ticket`)] },
      { dir: 'sc', msgs: [m('sh', 'ServerHello', 'ServerHello', 'clear', 128, 'accepts ticket · x25519 share'), m('ee', '{EncryptedExtensions}', '{EncExt}', 'hs', 40), m('sfin', '{Finished}', '{Finished}', 'hs', 52)] },
      { dir: 'cs', msgs: [m('cfin', '{Finished}', '{Finished}', 'hs', 52), get] },
      { dir: 'sc', msgs: [ok] },
    ];
  }
  return [
    { dir: 'cs', msgs: [m('ch', c.ech ? 'ClientHello + ECH' : 'ClientHello', c.ech ? 'Hello+ECH' : 'ClientHello', 'clear', 517, `${sni} · TLS 1.3 · x25519 share`)] },
    {
      dir: 'sc',
      msgs: [
        m('sh', 'ServerHello', 'ServerHello', 'clear', 122, 'picks TLS_AES_256_GCM_SHA384 · x25519', WHY.sh),
        m('ee', '{EncryptedExtensions}', '{EncExt}', 'hs', 40, undefined, WHY.ee),
        m('cert', '{Certificate}', '{Cert}', 'hs', 2100, undefined, WHY.cert),
        m('cv', '{CertificateVerify}', '{CertVerify}', 'hs', 80, undefined, WHY.cv),
        m('sfin', '{Finished}', '{Finished}', 'hs', 52, undefined, WHY.fin),
      ],
    },
    { dir: 'cs', msgs: [m('cfin', '{Finished}', '{Finished}', 'hs', 52), get] },
    { dir: 'sc', msgs: [m('nst', '[NewSessionTicket]', '[Ticket]', 'app', 250), ok] },
  ];
}

export class ShakeCtl {
  cfg: ShakeCfg = { ...SHAKE_DEFAULTS };
  flights: HsFlight[] = [];
  keys: KeyMark[] = [];
  notes: ServerNote[] = [];
  /** Diagram time (simulated seconds since the first packet) */
  now = 0;
  /** Messages whose encryption style is shown (predict mode hides the rest) */
  revealed = new Set<string>();
  /** Message currently being asked about */
  asking: string | null = null;
  /** Handshakes that have played to the end */
  runs = 0;
  /** Playground challenges completed */
  achieved = new Set<string>();
  private asked = false;
  private holdUntil = 0;
  private counted = false;

  constructor(private sim: TlsSim) {}

  /* ---------------- derived facts ---------------- */

  /** Index of the first TLS flight (after the TCP handshake). */
  get tcpLegs() {
    return this.cfg.tcp ? 2 : 0;
  }

  get endT() {
    const last = this.flights.filter((f) => f.dir !== 'xs').at(-1);
    return last ? last.t1 : 0;
  }

  /** Time to draw: the playhead parks just after the last message instead of drifting on. */
  get viewNow() {
    const last = Math.max(this.endT, ...this.flights.map((f) => f.t1));
    return Math.min(this.now, last + LEG * 0.3);
  }

  /** Round trips spent on the TLS handshake before the request can leave. */
  get tlsRtts() {
    const all = tlsFlights(this.cfg);
    const k = all.findIndex((f) => f.msgs.some((x) => x.id === 'get' || x.id === 'early'));
    return Math.floor(Math.max(0, k) / 2);
  }

  /** Round trips from the very first packet until the response arrives. */
  get firstByteRtts() {
    const all = tlsFlights(this.cfg);
    const k = all.findIndex((f) => f.msgs.some((x) => x.id === 'ok'));
    return (this.cfg.tcp ? 1 : 0) + (k + 1) / 2;
  }

  get requestAtRtts() {
    return (this.cfg.tcp ? 1 : 0) + this.tlsRtts;
  }

  ms(t: number) {
    return Math.round((t / LEG) * (this.cfg.rtt / 2));
  }

  /** The flight the predict game asks about (the server's first TLS flight). */
  get askFlight(): HsFlight | null {
    return this.flights.find((f) => f.msgs.some((x) => x.id === 'sh')) ?? null;
  }

  /** What Eve has recorded so far. */
  notebook(): NoteEntry[] {
    const out: NoteEntry[] = [];
    for (const f of this.flights) {
      const cross = f.dir === 'xs' ? f.t0 : (f.t0 + f.t1) / 2;
      if (cross > this.now) continue;
      const e: NoteEntry = { n: f.n, dir: f.dir, clear: [], enc: { count: 0, bytes: 0 } };
      for (const x of f.msgs) {
        if (x.enc === 'clear' || x.enc === 'tcp' || x.enc === 'attack') e.clear.push({ name: x.name, eve: x.eve ?? (x.enc === 'tcp' ? 'TCP control packet' : '') });
        else {
          e.enc.count++;
          e.enc.bytes += x.bytes;
        }
      }
      out.push(e);
    }
    return out;
  }

  /* ---------------- lifecycle ---------------- */

  enter(cfg: ShakeCfg, reset: boolean) {
    this.cfg = { ...cfg };
    for (const id of ['client', 'server', 'eve']) this.sim.box(`hs:${id}`);
    this.rebuild();
    if (reset) this.restartLoop();
  }

  teardown() {
    for (const id of ['client', 'server', 'eve']) this.sim.hide(`hs:${id}`);
  }

  private rebuild() {
    const c = this.cfg;
    const list: { dir: 'cs' | 'sc'; msgs: HsMsg[] }[] = [];
    let tls = tlsFlights(c);
    if (c.upto > 0) tls = tls.slice(0, c.upto);
    if (c.tcp) {
      list.push({ dir: 'cs', msgs: [m('syn', 'SYN', 'SYN', 'tcp', 0)] }, { dir: 'sc', msgs: [m('synack', 'SYN-ACK', 'SYN-ACK', 'tcp', 0)] });
      tls = tls.map((f, i) => (i === 0 ? { ...f, msgs: [m('ack', 'ACK', 'ACK', 'tcp', 0), ...f.msgs] } : f));
    }
    list.push(...tls);
    this.flights = list.map((f, i) => ({ n: i, dir: f.dir, msgs: f.msgs, t0: i * LEG, t1: (i + 1) * LEG }));

    // When each side can compute keys.
    const keys: KeyMark[] = [];
    const idx = (id: string) => this.flights.findIndex((f) => f.msgs.some((x) => x.id === id));
    const at = (id: string, end: boolean) => {
      const f = this.flights[idx(id)];
      return f ? (end ? f.t1 : f.t0) : null;
    };
    if (c.proto === 'tls13') {
      const s = at('ch', true);
      const cl = at('sh', true);
      if (c.resume === '0rtt') {
        const e = at('ch', false);
        if (e != null) keys.push({ side: 'c', t: e, label: 'early key' });
      }
      if (s != null) keys.push({ side: 's', t: s, label: 'keys' });
      if (cl != null) keys.push({ side: 'c', t: cl, label: 'keys' });
    } else if (c.proto === 'tls12') {
      const cl = at('sh', true);
      const s = at(c.resume === 'full' ? 'cke' : 'ch', true);
      if (cl != null) keys.push({ side: 'c', t: cl, label: 'keys' });
      if (s != null) keys.push({ side: 's', t: s, label: 'keys' });
    }
    this.keys = keys.sort((a, b) => a.t - b.t);
    this.notes = [];
    if (c.proto === 'tls13' && c.resume === '0rtt') {
      const t = at('ch', true);
      if (t != null) this.notes.push({ t, text: c.early === 'post' ? 'runs POST /buy early' : 'answers GET early', tone: 'ok' });
    }
    this.revealed = new Set();
    this.asking = null;
  }

  restartLoop() {
    this.flights = this.flights.filter((f) => f.dir !== 'xs');
    this.notes = this.notes.filter((n) => n.tone === 'ok');
    this.now = 0;
    this.asked = false;
    this.asking = null;
    this.revealed = new Set();
    this.holdUntil = 0;
    this.counted = false;
    this.sim.rev++;
  }

  /* ---------------- learner controls ---------------- */

  private apply(patch: Partial<ShakeCfg>) {
    this.cfg = { ...this.cfg, ...patch };
    if (this.cfg.proto !== 'tls13') this.cfg = { ...this.cfg, ech: false, resume: this.cfg.resume === '0rtt' ? 'ticket' : this.cfg.resume };
    if (this.cfg.proto === 'http') this.cfg = { ...this.cfg, resume: 'full' };
    this.rebuild();
    this.restartLoop();
  }

  setProto(proto: ShakeProto) {
    this.apply({ proto });
  }

  setResume(resume: Resume) {
    this.apply({ resume });
  }

  setEch(ech: boolean) {
    this.apply({ ech });
  }

  setEarly(early: EarlyReq) {
    this.apply({ early });
  }

  setRtt(rtt: number) {
    this.cfg = { ...this.cfg, rtt };
    this.sim.rev++;
  }

  /** Mallory re-sends a copy of Alice's first flight to the server. */
  replay() {
    if (this.cfg.proto === 'http' || this.flights.some((f) => f.dir === 'xs')) return;
    // Rewind to just after the handshake so the replay lands inside the drawing.
    if (this.now > this.endT) this.now = this.endT + 0.1;
    const t0 = this.endT + 0.4;
    const first = this.flights.find((f) => f.msgs.some((x) => x.id === 'ch'));
    if (!first) return;
    const copy = first.msgs.filter((x) => x.enc !== 'tcp').map((x) => ({ ...x, id: `re-${x.id}`, enc: 'attack' as Enc, eve: x.enc === 'early' ? 'replayed early data' : 'replayed copy' }));
    const f: HsFlight = { n: this.flights.length, dir: 'xs', msgs: copy, t0, t1: t0 + LEG * 0.55 };
    this.flights = [...this.flights, f];
    const zero = this.cfg.proto === 'tls13' && this.cfg.resume === '0rtt';
    this.notes = [
      ...this.notes.filter((n) => n.tone === 'ok'),
      zero
        ? { t: f.t1, text: this.cfg.early === 'post' ? 'POST /buy ran again: 2 orders!' : 'GET /account served again', tone: this.cfg.early === 'post' ? 'bad' : 'warn' }
        : { t: f.t1, text: 'no keys, no data: nothing runs', tone: 'warn' },
    ];
    this.holdUntil = f.t1 + 4.5;
    this.sim.rev++;
  }

  /* ---------------- predict: clear or encrypted? ---------------- */

  private beginAsk() {
    const f = this.askFlight;
    if (!f) return;
    this.asked = true;
    this.askMsg(f, 0);
  }

  private askMsg(f: HsFlight, i: number) {
    const game = this.sim.game;
    const msgs = f.msgs.filter((x) => x.enc !== 'tcp');
    const x = msgs[i];
    if (!game || !x || game.done || game.correct >= game.needed) {
      for (const y of msgs) this.revealed.add(y.id);
      this.asking = null;
      this.sim.rev++;
      return;
    }
    this.asking = x.id;
    const clear = x.enc === 'clear';
    game.ask({
      acceptable: [clear ? 'clear' : 'enc'],
      choices: [
        { id: 'clear', label: 'In the clear' },
        { id: 'enc', label: 'Encrypted' },
      ],
      ask: `${x.name.replace(/[{}[\]]/g, '')}: can Eve read it?`,
      askAt: { id: 'hs:server' },
      explain: (_p, ok) => `${ok ? '' : clear ? 'It’s sent in the clear. ' : 'It’s encrypted. '}${x.why ?? ''}`,
      resolve: () => {
        this.revealed.add(x.id);
        this.asking = null;
        this.askMsg(f, i + 1);
      },
    });
  }

  isRevealed(x: HsMsg) {
    const game = this.sim.game;
    if (!this.cfg.predict || !game || game.done) return true;
    const f = this.askFlight;
    if (!f || !f.msgs.includes(x)) return true;
    return this.revealed.has(x.id) || this.now > f.t0 + 0.01;
  }

  /* ---------------- clock ---------------- */

  step(dt: number) {
    const f = this.askFlight;
    const game = this.sim.game;
    const next = this.now + dt;
    if (this.cfg.predict && f && game && !game.done && !this.asked && this.now <= f.t0 && next >= f.t0) {
      this.now = f.t0;
      this.beginAsk();
      return;
    }
    this.now = next;
    const end = this.endT;
    if (!this.counted && this.now >= end) {
      this.counted = true;
      this.runs++;
      this.checkChallenges();
      this.sim.rev++;
    }
    const loopAt = Math.max(end + 3.6, this.holdUntil);
    if (this.now > loopAt) this.restartLoop();
  }

  private checkChallenges() {
    const c = this.cfg;
    const got = new Set(this.achieved);
    if (c.proto === 'tls13' && c.resume === '0rtt' && c.tcp && this.firstByteRtts === 2) got.add('fast');
    if (c.proto === 'tls13' && c.ech) got.add('ghost');
    if (c.proto === 'tls12' && c.resume === 'full' && c.tcp && this.firstByteRtts === 4) got.add('museum');
    this.achieved = got;
  }

  /* ---------------- layout ---------------- */

  geo() {
    const { w, h } = this.sim;
    const land = this.sim.orient === 'landscape';
    if (land) {
      const x0 = 18;
      const x1 = Math.round(w * 0.655);
      const cw = Math.min(150, (x1 - x0) * 0.27);
      const cx = x0 + cw + 8;
      const sx = x1 - cw - 8;
      return { land, x0, x1, cw, cx, sx, ex: (cx + sx) / 2, head: 96, top: 140, bottom: h - 92, chipH: 16, font: 10, panel: { x: Math.round(w * 0.675), y: 78, w: Math.round(w - 16 - w * 0.675), h: h - 78 - 110 } };
    }
    const x0 = 8;
    const x1 = w - 8;
    const cw = 88;
    const cx = x0 + cw + 6;
    const sx = x1 - cw - 6;
    return { land, x0, x1, cw, cx, sx, ex: (cx + sx) / 2, head: 84, top: 116, bottom: h - 162, chipH: 13, font: 8.5, panel: null };
  }

  pxPerSec() {
    const g = this.geo();
    const extra = this.flights.some((f) => f.dir === 'xs') ? LEG * 0.9 : 0;
    const total = Math.max(this.endT + extra, LEG * 3);
    return Math.min(g.land ? 82 : 58, (g.bottom - g.top - 18) / total);
  }

  layout() {
    const g = this.geo();
    const land = g.land;
    this.sim.put('hs:client', g.cx, g.head, land ? 140 : 112, land ? 40 : 34);
    this.sim.put('hs:server', g.sx, g.head, land ? 140 : 112, land ? 40 : 34);
    this.sim.put('hs:eve', g.ex, g.head, land ? 66 : 48, land ? 26 : 22);
  }

  wires(): WireSpec[] {
    return [];
  }
}
