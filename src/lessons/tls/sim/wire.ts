import { SIG } from '@/lib/sim/colors';
import type { FlightShape, WireSpec } from '@/lib/sim/Sim';
import { HOST, IP, fmtBytes, hexNoise } from './data';
import type { TlsSim } from './TlsSim';

/*
 * The "wire" scene: Alice's browser → café Wi-Fi → ISP → shop.example,
 * with an attacker on the path. Eve taps the café Wi-Fi and copies every
 * packet; Mallory runs the hotspot, so every packet passes through her hands.
 */

export type WireProto = 'http' | 'https' | 'sym' | 'leak' | 'pair';
export type WireStory = 'login' | 'checkout' | 'orders' | 'keys' | 'pair' | 'browse' | 'strip';
export type Attacker = 'eve' | 'mallory';

export interface WireCfg {
  attacker: Attacker;
  proto: WireProto;
  story: WireStory;
  tamper: boolean;
  hsts: boolean;
  ech: boolean;
}

export const WIRE_DEFAULTS: WireCfg = { attacker: 'eve', proto: 'http', story: 'login', tamper: false, hsts: false, ech: false };

export type LineKind = 'bad' | 'dim' | 'strong' | 'ok' | 'key' | 'add';

export interface CapLine {
  t: string;
  kind?: LineKind;
  /** Name of the secret this line leaks, e.g. "password" */
  leak?: string;
}

export interface Capture {
  id: number;
  dir: 'out' | 'in';
  lines: CapLine[];
}

export type Secure = 'none' | 'lock' | 'warn';

export interface Page {
  url: string;
  title: string;
  lines: string[];
}

export interface BrowserView extends Page {
  secure: Secure;
  alert: { text: string; tone: 'err' | 'ok' } | null;
}

const LOGIN: Page = { url: 'shop.example/login', title: 'Log in', lines: ['alice@example.com', 'password  ••••••••'] };
const ACCOUNT: Page = { url: 'shop.example/account', title: 'Your account', lines: ['Card •••• 4242', '12 Oak St, Springfield'] };
const CHECKOUT: Page = { url: 'shop.example/checkout', title: 'Checkout', lines: ['1 × Trail boots   $49.00', 'Pay with saved card'] };
const ORDERS: Page = { url: 'shop.example/orders', title: 'Your orders', lines: ['#1042  Trail boots', '#1043  Wool socks'] };
const TYPED: Page = { url: 'shop.example', title: 'Loading…', lines: ['', ''] };

const ALL = ['alice', 'wifi', 'mallory', 'isp', 'server', 'eve', 'tap'];

/** The café hop is drawn longer, so it gets a little more time. */
const hopDur = (a: string, b: string) => (a === 'alice' || b === 'alice' ? 0.95 : 0.62);

interface TravelOpts {
  color: string;
  shape: FlightShape;
  label?: string;
  r?: number;
  lane?: number;
  dir: 'out' | 'in';
  /** What the attacker reads from this packet (empty: nothing new) */
  lines: () => CapLine[];
  bytes?: number;
  /** Mallory holds the packet; call go() to let it continue (after changing it, maybe) */
  atMallory?: (go: () => void, o: TravelOpts) => void;
}

interface Msg {
  label: string;
  /** The HTTP text, as anyone reading plain HTTP would see it */
  http: CapLine[];
  bytes: number;
}

type Beat = (done: () => void) => void;

export class WireCtl {
  cfg: WireCfg = { ...WIRE_DEFAULTS };
  captures: Capture[] = [];
  leaked: string[] = [];
  packets = 0;
  browser: BrowserView = { ...LOGIN, secure: 'warn', alert: null };
  /** Who holds the shared session key (symmetric steps) */
  keys = { alice: false, server: false, eve: false };
  /** Who holds the server's public key (key-pair step) */
  pub = { alice: false, eve: false };
  /** The attacker has decrypted content with a stolen key */
  stolen = false;
  /** Site name as Eve learned it (browse story) */
  sni: string | null = null;
  bytesSeen = 0;
  requests = 0;
  private flipNext = false;
  private gen = 0;
  private beat = 0;
  private seq = 0;

  constructor(private sim: TlsSim) {}

  get mid() {
    return this.cfg.attacker === 'eve' ? 'wifi' : 'mallory';
  }

  get ids() {
    return this.cfg.attacker === 'eve' ? ['alice', 'wifi', 'isp', 'server', 'eve', 'tap'] : ['alice', 'mallory', 'isp', 'server'];
  }

  get path() {
    return ['alice', this.mid, 'isp', 'server'];
  }

  get encrypted() {
    return this.cfg.proto !== 'http' && !(this.cfg.story === 'strip' && !this.cfg.hsts);
  }

  /* ---------------- lifecycle ---------------- */

  enter(cfg: WireCfg, reset: boolean) {
    this.cfg = { ...cfg };
    for (const id of ALL) if (!this.ids.includes(id)) this.sim.hide(id);
    for (const id of this.ids) this.sim.box(id);
    if (reset) this.restart();
  }

  teardown() {
    this.gen++;
    for (const id of ALL) this.sim.hide(id);
  }

  private restart() {
    this.sim.clearTransient();
    this.gen++;
    this.captures = [];
    this.leaked = [];
    this.packets = 0;
    this.keys = { alice: false, server: false, eve: false };
    this.pub = { alice: false, eve: false };
    this.stolen = false;
    this.sni = null;
    this.bytesSeen = 0;
    this.requests = 0;
    this.flipNext = false;
    this.beat = 0;
    const start: Record<WireStory, Page> = { login: LOGIN, checkout: CHECKOUT, orders: ORDERS, keys: ACCOUNT, pair: ACCOUNT, browse: ACCOUNT, strip: TYPED };
    this.browser = { ...start[this.cfg.story], secure: this.secureFor(), alert: null };
    if (this.cfg.story === 'orders') this.keys = { alice: true, server: true, eve: false };
    if (this.cfg.story === 'strip') this.browser.secure = 'none';
    const g = this.gen;
    const loop = () => {
      if (g !== this.gen) return;
      const beats = this.beats();
      const b = beats[this.beat % beats.length];
      this.beat++;
      b(() => this.sim.after(0.9, loop));
    };
    this.sim.after(0.5, loop);
    this.sim.rev++;
  }

  private secureFor(): Secure {
    return this.cfg.proto === 'http' ? 'warn' : 'lock';
  }

  /* ---------------- learner controls ---------------- */

  setProto(proto: WireProto) {
    if (proto === this.cfg.proto) return;
    this.cfg = { ...this.cfg, proto };
    this.restart();
  }

  setTamper(on: boolean) {
    this.cfg = { ...this.cfg, tamper: on };
    if (!on) this.browser = { ...this.browser, alert: null };
    this.sim.rev++;
  }

  setHsts(on: boolean) {
    this.cfg = { ...this.cfg, hsts: on };
    this.restart();
  }

  setEch(on: boolean) {
    this.cfg = { ...this.cfg, ech: on };
    this.restart();
  }

  /** Mallory flips one bit in the next encrypted record she forwards. */
  flipBit() {
    this.flipNext = true;
    this.sim.say('mallory', 'next record: flip 1 bit', SIG.err, 1.8);
    this.sim.rev++;
  }

  /* ---------------- layout ---------------- */

  layout() {
    const { w, h } = this.sim;
    const mid = this.mid;
    if (this.sim.orient === 'landscape') {
      const compact = this.sim.compact;
      const y = Math.round(Math.min(Math.max(h * 0.4, 210), 320));
      const aW = compact ? 200 : 228;
      const ax = Math.max(aW / 2 + 22, w * 0.15);
      const sW = compact ? 160 : 182;
      const sx = w - Math.max(sW / 2 + 22, w * 0.13);
      const mx = ax + aW / 2 + (sx - sW / 2 - (ax + aW / 2)) * 0.34;
      const ix = ax + aW / 2 + (sx - sW / 2 - (ax + aW / 2)) * 0.72;
      this.sim.put('alice', ax, y, aW, 132);
      this.sim.put(mid, mx, y, compact ? 138 : 152, 52);
      this.sim.put('isp', ix, y, compact ? 112 : 126, 46);
      this.sim.put('server', sx, y, sW, 56);
      const tx = (ax + aW / 2 + mx - (compact ? 69 : 76)) / 2;
      this.sim.put('tap', tx, y, 8, 8);
      this.sim.put('eve', tx, y + 150, 132, 42);
    } else {
      const x = w / 2;
      const aY = Math.round(h * 0.195);
      const mY = Math.round(h * 0.4);
      this.sim.put('alice', x, aY, Math.min(236, w - 40), 80);
      this.sim.put(mid, x, mY, 150, 42);
      this.sim.put('isp', x, Math.round(h * 0.525), 118, 36);
      this.sim.put('server', x, Math.round(h * 0.645), 170, 44);
      const ty = (aY + 40 + mY - 21) / 2;
      this.sim.put('tap', x, ty, 8, 8);
      this.sim.put('eve', w - 62, ty, 100, 34);
    }
  }

  wires(): WireSpec[] {
    const p = this.path;
    const out: WireSpec[] = [];
    for (let i = 0; i < p.length - 1; i++) {
      out.push({ from: p[i], to: p[i + 1] });
    }
    if (this.cfg.attacker === 'eve') out.push({ from: 'tap', to: 'eve', state: 'dashed', color: 'rgba(255,77,106,0.6)' });
    return out;
  }

  step(dt: number) {
    void dt;
  }

  /* ---------------- traffic ---------------- */

  private route(dir: 'out' | 'in', port: number): CapLine {
    return dir === 'out'
      ? { t: `${IP.alice} → ${IP.server}:${port}`, kind: 'dim' }
      : { t: `${IP.server}:${port} → ${IP.alice}`, kind: 'dim' };
  }

  /** What the attacker reads from a message, given the current protection. */
  private seen(dir: 'out' | 'in', m: Msg, enc: boolean): CapLine[] {
    if (!enc) return [this.route(dir, 80), ...m.http];
    const lines: CapLine[] = [this.route(dir, 443), { t: `TLS record · ${fmtBytes(m.bytes)}`, kind: 'strong' }, { t: `${hexNoise(this.seq + m.bytes)} …`, kind: 'dim' }];
    if (this.cfg.proto === 'leak' && this.keys.eve) {
      lines.push({ t: 'decrypted with the stolen key:', kind: 'key' }, ...m.http.map((l) => ({ ...l, kind: 'bad' as const })));
    } else {
      lines.push({ t: 'unreadable without the key', kind: 'ok' });
    }
    return lines;
  }

  private capture(dir: 'out' | 'in', lines: CapLine[], bytes = 0) {
    if (!lines.length) return;
    this.captures = [...this.captures.slice(-5), { id: ++this.seq, dir, lines }];
    this.packets++;
    this.bytesSeen += bytes;
    for (const l of lines) if (l.leak && !this.leaked.includes(l.leak)) this.leaked = [...this.leaked, l.leak];
    if (lines.some((l) => l.kind === 'key' && l.t.startsWith('decrypted'))) this.stolen = true;
    this.sim.rev++;
  }

  /**
   * Send a packet hop by hop along `path`. The attacker captures what it can:
   * Eve copies it at her tap, Mallory holds the whole packet (and may change it).
   */
  private travel(path: string[], o: TravelOpts, done: () => void) {
    const g = this.gen;
    const hop = (i: number) => {
      if (g !== this.gen) return;
      if (i >= path.length - 1) {
        done();
        return;
      }
      const a = path[i];
      const b = path[i + 1];
      const dur = hopDur(a, b);
      this.sim.send({
        from: a,
        to: b,
        dur,
        color: o.color,
        shape: o.shape,
        label: o.label,
        r: o.r,
        lane: o.lane,
        onArrive: () => {
          if (g !== this.gen) return;
          if (b === 'mallory') {
            this.capture(o.dir, o.lines(), o.bytes);
            if (o.atMallory) {
              o.atMallory(() => hop(i + 1), o);
              return;
            }
          }
          hop(i + 1);
        },
      });
      const tapHop = this.cfg.attacker === 'eve' && ((a === 'alice' && b === 'wifi') || (a === 'wifi' && b === 'alice'));
      if (tapHop) {
        this.sim.after(dur * 0.5, () => {
          if (g !== this.gen) return;
          this.sim.send({
            from: 'tap',
            to: 'eve',
            dur: 0.42,
            color: SIG.err,
            r: 3,
            trail: false,
            lane: 0,
            onArrive: () => {
              if (g === this.gen) this.capture(o.dir, o.lines(), o.bytes);
            },
          });
        });
      }
    };
    hop(0);
  }

  private request(m: Msg, done: () => void, extra: { atMallory?: TravelOpts['atMallory']; enc?: boolean } = {}) {
    const enc = extra.enc ?? this.encrypted;
    this.requests++;
    this.travel(
      this.path,
      { color: SIG.req, shape: enc ? 'envelope' : 'dot', label: enc ? fmtBytes(m.bytes) : m.label, dir: 'out', lines: () => this.seen('out', m, enc), bytes: m.bytes, atMallory: extra.atMallory },
      done,
    );
  }

  private response(m: Msg, done: () => void, extra: { atMallory?: TravelOpts['atMallory']; enc?: boolean } = {}) {
    const enc = extra.enc ?? this.encrypted;
    this.travel(
      [...this.path].reverse(),
      { color: SIG.res, shape: enc ? 'envelope' : 'dot', label: enc ? fmtBytes(m.bytes) : m.label, dir: 'in', lines: () => this.seen('in', m, enc), bytes: m.bytes, atMallory: extra.atMallory },
      done,
    );
  }

  private page(p: Page, secure: Secure = this.secureFor()) {
    this.browser = { ...p, secure, alert: null };
    this.sim.rev++;
  }

  private beats(): Beat[] {
    switch (this.cfg.story) {
      case 'login':
        return this.loginBeats();
      case 'checkout':
        return this.checkoutBeats();
      case 'orders':
        return this.ordersBeats();
      case 'keys':
        return this.keyBeats();
      case 'pair':
        return this.pairBeats();
      case 'browse':
        return this.browseBeats();
      case 'strip':
        return this.stripBeats();
    }
  }

  /* ---------------- stories ---------------- */

  private loginBeats(): Beat[] {
    return [
      (done) => {
        this.page(LOGIN);
        this.request(
          {
            label: 'POST /login',
            bytes: 612,
            http: [{ t: 'POST /login HTTP/1.1' }, { t: `Host: ${HOST}` }, { t: 'email=alice%40example.com', kind: 'bad', leak: 'email' }, { t: 'password=hunter2', kind: 'bad', leak: 'password' }],
          },
          () =>
            this.response(
              {
                label: '302 Found',
                bytes: 389,
                http: [{ t: 'HTTP/1.1 302 Found' }, { t: 'Set-Cookie: session=8f3e2a9c', kind: 'bad', leak: 'session cookie' }, { t: 'Location: /account' }],
              },
              done,
            ),
        );
      },
      (done) => {
        this.request(
          { label: 'GET /account', bytes: 431, http: [{ t: 'GET /account HTTP/1.1' }, { t: `Host: ${HOST}` }, { t: 'Cookie: session=8f3e2a9c', kind: 'bad', leak: 'session cookie' }] },
          () =>
            this.response(
              {
                label: '200 OK',
                bytes: 18230,
                http: [{ t: 'HTTP/1.1 200 OK' }, { t: '<p>Card •••• 4242</p>', kind: 'bad', leak: 'card digits' }, { t: '<p>12 Oak St, Springfield</p>', kind: 'bad', leak: 'home address' }],
              },
              () => {
                this.page(ACCOUNT);
                this.sim.after(2.2, done);
              },
            ),
        );
      },
    ];
  }

  private checkoutBeats(): Beat[] {
    return [
      (done) => {
        this.request({ label: 'GET /checkout', bytes: 402, http: [{ t: 'GET /checkout HTTP/1.1' }, { t: `Host: ${HOST}` }] }, () => {
          const tamper = this.cfg.tamper;
          const html: CapLine[] = [{ t: 'HTTP/1.1 200 OK' }, { t: '<h1>Checkout</h1> … $49.00' }];
          if (tamper) html.push({ t: '<script src="//evil.example/x.js">', kind: 'add' });
          this.response(
            { label: '200 OK', bytes: 9120, http: html },
            () => {
              this.browser = { ...CHECKOUT, secure: 'warn', alert: tamper ? { text: 'Session expired: re-enter card', tone: 'err' } : null };
              this.sim.rev++;
              this.sim.after(tamper ? 4.2 : 2.6, () => {
                this.browser = { ...this.browser, alert: null };
                this.sim.rev++;
                done();
              });
            },
            {
              atMallory: (go, f) => {
                if (!tamper) {
                  go();
                  return;
                }
                this.sim.say('mallory', 'injects a <script>', SIG.err, 1.6);
                this.sim.after(0.7, () => {
                  f.color = SIG.err;
                  f.label = '200 OK + <script>';
                  go();
                });
              },
            },
          );
        });
      },
    ];
  }

  private ordersBeats(): Beat[] {
    return [
      (done) => {
        if (!this.keys.alice) {
          this.keys = { alice: true, server: true, eve: false };
          this.browser = { ...ORDERS, secure: 'lock', alert: null };
          this.sim.say('alice', 'new connection', SIG.res);
        }
        this.request({ label: 'GET /orders', bytes: 97, http: [{ t: 'GET /orders HTTP/1.1' }] }, () => {
          let flipped = false;
          this.response(
            { label: '200 OK', bytes: 4380, http: [{ t: 'HTTP/1.1 200 OK' }] },
            () => {
              if (flipped) {
                this.sim.fx({ kind: 'x', at: { id: 'alice' }, color: SIG.err, size: 1.6, dur: 1.2 });
                this.sim.say('alice', 'auth tag mismatch!', SIG.err, 2);
                this.browser = { ...this.browser, alert: { text: 'bad_record_mac: closed', tone: 'err' } };
                this.keys = { alice: false, server: false, eve: false };
                this.sim.rev++;
                this.sim.after(3, () => {
                  this.browser = { ...this.browser, alert: null };
                  this.sim.rev++;
                  done();
                });
                return;
              }
              this.browser = { ...ORDERS, secure: 'lock', alert: null };
              this.sim.rev++;
              this.sim.after(1.2, done);
            },
            {
              atMallory: (go, f) => {
                if (!this.flipNext) {
                  go();
                  return;
                }
                this.flipNext = false;
                flipped = true;
                this.sim.after(0.5, () => {
                  f.color = SIG.err;
                  f.label = '1 bit flipped';
                  this.sim.rev++;
                  go();
                });
              },
            },
          );
        });
      },
    ];
  }

  private keyBeats(): Beat[] {
    const g = () => this.gen;
    return [
      (done) => {
        const gen = g();
        this.keys = { alice: true, server: false, eve: false };
        this.stolen = false;
        this.sim.say('alice', 'makes a key K', SIG.lime, 1.6);
        this.sim.rev++;
        this.sim.after(1, () => {
          if (gen !== this.gen) return;
          this.travel(
            this.path,
            {
              color: SIG.lime,
              shape: 'square',
              label: 'key K',
              dir: 'out',
              lines: () => {
                this.keys = { ...this.keys, eve: true };
                return [this.route('out', 443), { t: 'key K = 7c 1e 94 0b 5d a2 …', kind: 'key', leak: 'the key' }, { t: 'sent in the clear: copied!', kind: 'bad' }];
              },
            },
            () => {
              this.keys = { ...this.keys, server: true };
              this.sim.rev++;
              done();
            },
          );
        });
      },
      (done) => {
        this.request({ label: 'GET /account', bytes: 431, http: [{ t: 'GET /account HTTP/1.1' }, { t: 'Cookie: session=8f3e2a9c', leak: 'session cookie' }] }, () =>
          this.response({ label: '200 OK', bytes: 18230, http: [{ t: 'HTTP/1.1 200 OK' }, { t: '<p>Card •••• 4242</p>', leak: 'card digits' }] }, () => {
            this.browser = { ...ACCOUNT, secure: 'lock', alert: null };
            this.sim.rev++;
            this.sim.after(2.4, () => {
              this.keys = { alice: false, server: false, eve: false };
              this.captures = [];
              this.sim.rev++;
              done();
            });
          }),
        );
      },
    ];
  }

  private pairBeats(): Beat[] {
    return [
      (done) => {
        this.pub = { alice: false, eve: false };
        this.browser = { ...ACCOUNT, secure: 'lock', alert: null };
        this.sim.rev++;
        this.travel(
          [...this.path].reverse(),
          {
            color: SIG.teal,
            shape: 'square',
            label: 'public key',
            dir: 'in',
            lines: () => {
              this.pub = { ...this.pub, eve: true };
              return [this.route('in', 443), { t: 'public key 04:3b:9f:c2 …', kind: 'strong' }, { t: 'fine to share: it can only check', kind: 'ok' }, { t: 'signatures, never make them', kind: 'ok' }];
            },
          },
          () => {
            this.pub = { ...this.pub, alice: true };
            this.sim.rev++;
            done();
          },
        );
      },
      (done) => {
        this.travel(
          [...this.path].reverse(),
          {
            color: SIG.res,
            shape: 'dot',
            label: 'signed message',
            dir: 'in',
            lines: () => [this.route('in', 443), { t: '“I’m shop.example”', kind: 'strong' }, { t: 'signature 30 45 02 21 00 c7 …', kind: 'dim' }, { t: 'readable, but she can’t forge one', kind: 'ok' }],
          },
          () => {
            this.sim.say('alice', 'signature ✓', SIG.res, 1.8);
            this.browser = { ...this.browser, alert: { text: 'Signature valid: made with shop.example’s key', tone: 'ok' } };
            this.sim.rev++;
            this.sim.after(1.6, done);
          },
        );
      },
      (done) => {
        const gen = this.gen;
        this.sim.say('eve', 'forges a message', SIG.err, 1.4);
        this.sim.after(0.6, () => {
          if (gen !== this.gen) return;
          this.sim.send({
            from: 'eve',
            to: 'alice',
            dur: 1.1,
            color: SIG.err,
            label: 'forged message',
            onArrive: () => {
              if (gen !== this.gen) return;
              this.sim.fx({ kind: 'x', at: { id: 'alice' }, color: SIG.err, size: 1.5, dur: 1.1 });
              this.sim.say('alice', 'signature ✗', SIG.err, 1.8);
              this.browser = { ...this.browser, alert: { text: 'Signature invalid: message rejected', tone: 'err' } };
              this.sim.rev++;
              this.sim.after(2.4, () => {
                this.browser = { ...this.browser, alert: null };
                this.sim.rev++;
                done();
              });
            },
          });
        });
      },
    ];
  }

  private browseBeats(): Beat[] {
    return [
      (done) => {
        this.browser = { ...ACCOUNT, secure: 'lock', alert: null };
        const ech = this.cfg.ech;
        this.travel(
          this.path,
          {
            color: SIG.req,
            shape: 'dot',
            label: 'ClientHello',
            dir: 'out',
            bytes: 517,
            lines: () => {
              this.sni = ech ? 'cdn.example (outer name only)' : HOST;
              return ech
                ? [this.route('out', 443), { t: 'TLS ClientHello (with ECH)', kind: 'strong' }, { t: 'outer SNI: cdn.example', kind: 'ok' }, { t: 'real name: encrypted', kind: 'ok' }]
                : [this.route('out', 443), { t: 'TLS ClientHello', kind: 'strong' }, { t: `SNI: ${HOST}`, kind: 'bad', leak: 'site name' }, { t: 'offers TLS 1.3 · x25519', kind: 'dim' }];
            },
          },
          () =>
            this.response({ label: 'ServerHello', bytes: 2630, http: [] }, done, {
              enc: true,
            }),
        );
      },
      (done) => {
        this.request({ label: 'GET /orders', bytes: 431, http: [] }, () => this.response({ label: '200 OK', bytes: 38410, http: [] }, () => this.sim.after(0.6, done), { enc: true }), { enc: true });
      },
      (done) => {
        this.request({ label: 'GET /account', bytes: 402, http: [] }, () => this.response({ label: '200 OK', bytes: 18230, http: [] }, () => this.sim.after(1.4, done), { enc: true }), { enc: true });
      },
    ];
  }

  private stripBeats(): Beat[] {
    if (this.cfg.hsts) {
      return [
        (done) => {
          this.browser = { ...TYPED, secure: 'none', alert: null };
          this.sim.say('alice', 'HSTS: use https://', SIG.res, 2);
          this.sim.rev++;
          this.sim.after(1.1, () => {
            this.travel(
              this.path,
              {
                color: SIG.req,
                shape: 'dot',
                label: 'ClientHello',
                dir: 'out',
                lines: () => [this.route('out', 443), { t: `TLS ClientHello · SNI ${HOST}`, kind: 'strong' }, { t: 'no private key for shop.example:', kind: 'dim' }, { t: 'she can only relay or drop it', kind: 'ok' }],
              },
              () =>
                this.response(
                  { label: 'ServerHello', bytes: 2630, http: [] },
                  () => {
                    this.page(LOGIN, 'lock');
                    this.sim.after(0.8, done);
                  },
                  { enc: true },
                ),
            );
          });
        },
        (done) => {
          this.request({ label: 'POST /login', bytes: 612, http: [] }, () =>
            this.response(
              { label: '302 Found', bytes: 389, http: [] },
              () => {
                this.page(ACCOUNT, 'lock');
                this.sim.after(2.2, done);
              },
              { enc: true },
            ),
          { enc: true },
          );
        },
      ];
    }
    // No HSTS: Mallory keeps Alice on plain http and talks https to the server herself.
    const viaMallory = (up: Msg, down: Msg, page: Page, done: () => void) => {
      const g = this.gen;
      this.travel(['alice', 'mallory'], { color: SIG.req, shape: 'dot', label: up.label, dir: 'out', lines: () => [this.route('out', 80), ...up.http], bytes: up.bytes }, () => {
        if (g !== this.gen) return;
        this.sim.say('mallory', 'relays it over her own https', SIG.err, 1.8);
        this.travel(['mallory', 'isp', 'server'], { color: SIG.req, shape: 'envelope', label: 'https', dir: 'out', lines: () => [], bytes: 0 }, () => {
          this.travel(['server', 'isp', 'mallory'], { color: SIG.res, shape: 'envelope', label: 'https', dir: 'in', lines: () => [], bytes: 0 }, () => {
            if (g !== this.gen) return;
            this.travel(['mallory', 'alice'], { color: SIG.res, shape: 'dot', label: down.label, dir: 'in', lines: () => [], bytes: down.bytes }, () => {
              this.page(page, 'warn');
              done();
            });
          });
        });
      });
    };
    return [
      (done) => {
        this.browser = { ...TYPED, secure: 'none', alert: null };
        this.sim.rev++;
        viaMallory(
          { label: 'GET / (http)', bytes: 402, http: [{ t: 'GET / HTTP/1.1' }, { t: `Host: ${HOST}` }, { t: 'plain http: nothing to verify', kind: 'ok' }] },
          { label: '200 OK (http)', bytes: 9120, http: [] },
          LOGIN,
          () => this.sim.after(1, done),
        );
      },
      (done) => {
        viaMallory(
          {
            label: 'POST /login (http)',
            bytes: 612,
            http: [{ t: 'POST /login HTTP/1.1' }, { t: 'email=alice@example.com', kind: 'bad', leak: 'email' }, { t: 'password=hunter2', kind: 'bad', leak: 'password' }],
          },
          { label: '302 Found (http)', bytes: 389, http: [] },
          ACCOUNT,
          () => this.sim.after(2.2, done),
        );
      },
    ];
  }
}
