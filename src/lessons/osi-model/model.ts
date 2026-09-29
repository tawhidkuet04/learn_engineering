/**
 * The facts of the lesson: layers, the cast of machines and their addresses,
 * and a tiny packet builder that produces the real bytes of every frame we
 * draw. Checksums, the FCS and the bits on the wire are computed, not typed
 * in, so every number the learner sees is consistent with every other one.
 */

export type LayerN = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export const ALL_LAYERS: LayerN[] = [7, 6, 5, 4, 3, 2, 1];

export type AppKind = 'http' | 'https' | 'dns' | 'video' | 'smtp';
export type LinkKind = 'ethernet' | 'wifi';
export type ModelKind = 'osi' | 'tcpip';

export interface LayerInfo {
  n: LayerN;
  name: string;
  short: string;
  unit: string;
  color: string;
  job: string;
}

export const LAYERS: Record<LayerN, LayerInfo> = {
  7: { n: 7, name: 'Application', short: 'App', unit: 'data', color: '#45D5FF', job: 'what the program says' },
  6: { n: 6, name: 'Presentation', short: 'Present.', unit: 'data', color: '#2DD4BF', job: 'encoding, compression, encryption' },
  5: { n: 5, name: 'Session', short: 'Session', unit: 'data', color: '#93A5FF', job: 'open, keep and close a dialog' },
  4: { n: 4, name: 'Transport', short: 'Transport', unit: 'segment', color: '#C4F25A', job: 'program to program, reliably' },
  3: { n: 3, name: 'Network', short: 'Network', unit: 'packet', color: '#FF9A3C', job: 'addresses and routes across networks' },
  2: { n: 2, name: 'Data link', short: 'Data link', unit: 'frame', color: '#FF7EB6', job: 'the next hop on this link' },
  1: { n: 1, name: 'Physical', short: 'Physical', unit: 'bits', color: '#B59BFF', job: 'bits as voltage, light or radio' },
};

/** The four TCP/IP layers and which OSI layers each one covers. */
export const TCPIP: { name: string; layers: LayerN[] }[] = [
  { name: 'Application', layers: [7, 6, 5] },
  { name: 'Transport', layers: [4] },
  { name: 'Internet', layers: [3] },
  { name: 'Link', layers: [2, 1] },
];

/* ------------------------------------------------------------------ */
/* The cast                                                            */
/* ------------------------------------------------------------------ */

export const ALICE = { name: 'Alice’s laptop', ip: '198.51.100.23', mac: 'a6:4f:21:9c:3e:07', gw: '198.51.100.1' };
export const BOB_MAC = 'a2:11:5c:02:9b:44';
export const AP_MAC = 'b6:1c:e0:44:a0:3f';
export const ROUTER = {
  lan: { ifname: 'eth0', ip: '198.51.100.1', mac: '0e:5a:c3:10:77:01' },
  wan: { ifname: 'eth1', ip: '203.0.113.1', mac: '0e:5a:c3:10:77:02' },
};

export interface Receiver {
  name: string;
  host: string;
  ip: string;
  mac: string;
  proc: string;
}

export const RECEIVERS: Record<'web' | 'dns' | 'video', Receiver> = {
  web: { name: 'web server', host: 'shop.example', ip: '203.0.113.10', mac: '52:54:00:8a:2f:d3', proc: 'nginx' },
  dns: { name: 'DNS resolver', host: 'ns1.example', ip: '203.0.113.53', mac: '52:54:00:3c:91:5e', proc: 'unbound' },
  video: { name: 'video server', host: 'call.example', ip: '203.0.113.80', mac: '52:54:00:6d:0b:a8', proc: 'sfu' },
};

const MAIL: Receiver = { ...RECEIVERS.web, proc: 'postfix' };

export function receiverFor(app: AppKind): Receiver {
  if (app === 'dns') return RECEIVERS.dns;
  if (app === 'video') return RECEIVERS.video;
  if (app === 'smtp') return MAIL;
  return RECEIVERS.web;
}

export interface AppInfo {
  label: string;
  /** What goes in the L7 row */
  proto: string;
  l4: 'tcp' | 'udp';
  sport: number;
  dport: number;
  portName: string;
}

export const APPS: Record<AppKind, AppInfo> = {
  http: { label: 'Web page', proto: 'HTTP', l4: 'tcp', sport: 51234, dport: 80, portName: 'http' },
  https: { label: 'Secure page', proto: 'HTTP', l4: 'tcp', sport: 51236, dport: 443, portName: 'https' },
  smtp: { label: 'Email', proto: 'SMTP', l4: 'tcp', sport: 51238, dport: 25, portName: 'smtp' },
  dns: { label: 'DNS lookup', proto: 'DNS', l4: 'udp', sport: 53124, dport: 53, portName: 'domain' },
  video: { label: 'Video call', proto: 'RTP', l4: 'udp', sport: 50012, dport: 5004, portName: 'rtp' },
};

/**
 * Layers that exist only in the model for this app: no separate protocol runs
 * there, and nothing is added to the data. Their jobs happen inside the app.
 */
export function isHollow(n: LayerN, app: AppKind): boolean {
  return n === 5 || (n === 6 && app !== 'https');
}

/**
 * Where each layer's work really happens on a Linux host, top to bottom. Spans
 * are in layer units: 4.5 is the gap between rows 4 and 5, 2 is the middle of
 * row 2. Layer 2 is split: the kernel writes the header, the card adds the FCS.
 */
export const RUNS_ON: { label: string; span: [number, number] }[] = [
  { label: 'the program', span: [7.5, 4.5] },
  { label: 'OS kernel', span: [4.5, 2] },
  { label: 'network card', span: [2, 0.5] },
];

/** Label for each layer row, per machine side and settings. */
export function protoFor(n: LayerN, app: AppKind, link: LinkKind, side: 'alice' | 'far'): string {
  const a = APPS[app];
  switch (n) {
    case 7:
      return a.proto;
    case 6:
    case 5:
      return isHollow(n, app) ? '—' : 'TLS';
    case 4:
      return a.l4.toUpperCase();
    case 3:
      return 'IPv4';
    case 2:
      return side === 'alice' && link === 'wifi' ? 'Wi-Fi 802.11' : 'Ethernet';
    case 1:
      return side === 'alice' ? (link === 'wifi' ? 'radio' : 'copper') : 'fiber';
  }
}

/* ------------------------------------------------------------------ */
/* Bytes                                                               */
/* ------------------------------------------------------------------ */

const macBytes = (mac: string) => mac.split(':').map((h) => parseInt(h, 16));
const ipBytes = (ip: string) => ip.split('.').map(Number);
const u16 = (n: number) => [(n >> 8) & 0xff, n & 0xff];
const u32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0) & 0xff);

let CRC_TABLE: number[] | null = null;
/** IEEE 802.3 CRC-32 (the Ethernet FCS). */
export function crc32(data: number[]): number {
  if (!CRC_TABLE) {
    CRC_TABLE = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE.push(c >>> 0);
    }
  }
  let crc = 0xffffffff;
  for (const b of data) crc = CRC_TABLE[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** RFC 1071 Internet checksum (IP, TCP, UDP). */
export function inetChecksum(data: number[]): number {
  let s = 0;
  for (let i = 0; i < data.length; i += 2) s += (data[i] << 8) + (data[i + 1] ?? 0);
  while (s > 0xffff) s = (s & 0xffff) + (s >>> 16);
  return ~s & 0xffff;
}

/** Deterministic filler bytes (ciphertext, video) so renders are stable. */
function filler(n: number, seed: number): number[] {
  let a = seed >>> 0;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    out.push(((t ^ (t >>> 14)) >>> 0) & 0xff);
  }
  return out;
}

export const HTTP_REQUEST = 'GET / HTTP/1.1\r\nHost: shop.example\r\nUser-Agent: curl/8.5.0\r\nAccept: */*\r\n\r\n';
export const SMTP_LINE = 'EHLO alice.example\r\n';
/** First byte of the IPv4 header's identification field, kept stable. */
const IP_ID = 0x3c1d;
const TCP_SEQ = 0x5b3a8f22;
const TCP_ACK = 0x9e27c411;

function appBytes(app: AppKind): number[] {
  switch (app) {
    case 'http':
    case 'https':
      return ascii(HTTP_REQUEST);
    case 'smtp':
      return ascii(SMTP_LINE);
    case 'dns':
      // id, flags (RD), 1 question, then shop.example A IN
      return [...u16(0x7c3a), ...u16(0x0100), ...u16(1), ...u16(0), ...u16(0), ...u16(0), 4, ...ascii('shop'), 7, ...ascii('example'), 0, ...u16(1), ...u16(1)];
    case 'video':
      // RTP: V=2, PT=96, seq, timestamp, SSRC, then a slice of an H.264 frame
      return [0x80, 0x60, ...u16(0x1a2b), ...u32(0x3c4d5e6f), ...u32(0x11223344), ...filler(1160, 7)];
  }
}

export interface Hop {
  /** 0: Alice → router, 1: router → receiver */
  seg: 0 | 1;
  ttl: number;
  link: LinkKind;
}

export interface Built {
  app: number[];
  tls: number[] | null;
  l4: number[];
  ip: number[];
  l2: number[];
  fcs: number[];
  ipSum: number;
  l4Sum: number;
  fcsValue: number;
  /** Frame bytes as captured (no FCS) */
  frame: number[];
  l2Kind: 'eth' | 'wifi';
  src: { mac: string; ip: string };
  dst: { mac: string; ip: string };
}

const cache = new Map<string, Built>();

/** Build the real frame for an app on a given hop. */
export function build(app: AppKind, hop: Hop): Built {
  const key = `${app}|${hop.seg}|${hop.ttl}|${hop.link}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const rx = receiverFor(app);
  const a = APPS[app];
  const payload = appBytes(app);
  const tls = app === 'https' ? [0x17, 0x03, 0x03, ...u16(payload.length + 17), ...filler(payload.length + 17, 23)] : null;
  const above = tls ?? payload;

  const srcIp = ipBytes(ALICE.ip);
  const dstIp = ipBytes(rx.ip);
  const proto = a.l4 === 'tcp' ? 6 : 17;

  let l4: number[];
  let l4Sum: number;
  if (a.l4 === 'tcp') {
    const hdr = [...u16(a.sport), ...u16(a.dport), ...u32(TCP_SEQ), ...u32(TCP_ACK), 0x50, 0x18, ...u16(502), 0, 0, 0, 0];
    const pseudo = [...srcIp, ...dstIp, 0, 6, ...u16(hdr.length + above.length)];
    l4Sum = inetChecksum([...pseudo, ...hdr, ...above]);
    hdr[16] = l4Sum >> 8;
    hdr[17] = l4Sum & 0xff;
    l4 = hdr;
  } else {
    const len = 8 + above.length;
    const hdr = [...u16(a.sport), ...u16(a.dport), ...u16(len), 0, 0];
    const pseudo = [...srcIp, ...dstIp, 0, 17, ...u16(len)];
    l4Sum = inetChecksum([...pseudo, ...hdr, ...above]) || 0xffff;
    hdr[6] = l4Sum >> 8;
    hdr[7] = l4Sum & 0xff;
    l4 = hdr;
  }

  const total = 20 + l4.length + above.length;
  const ip = [0x45, 0x00, ...u16(total), ...u16(IP_ID), 0x40, 0x00, hop.ttl & 0xff, proto, 0, 0, ...srcIp, ...dstIp];
  const ipSum = inetChecksum(ip);
  ip[10] = ipSum >> 8;
  ip[11] = ipSum & 0xff;

  const src = hop.seg === 0 ? { mac: ALICE.mac, ip: ALICE.ip } : { mac: ROUTER.wan.mac, ip: ALICE.ip };
  const dst = hop.seg === 0 ? { mac: ROUTER.lan.mac, ip: rx.ip } : { mac: rx.mac, ip: rx.ip };
  const wifi = hop.seg === 0 && hop.link === 'wifi';
  const l2 = wifi
    ? // 802.11 data frame, To DS: addr1 = AP (BSSID), addr2 = Alice, addr3 = router; then LLC/SNAP with EtherType
      [0x08, 0x01, 0x2c, 0x00, ...macBytes(AP_MAC), ...macBytes(ALICE.mac), ...macBytes(ROUTER.lan.mac), 0x40, 0x3b, 0xaa, 0xaa, 0x03, 0, 0, 0, 0x08, 0x00]
    : [...macBytes(dst.mac), ...macBytes(src.mac), 0x08, 0x00];
  const frame = [...l2, ...ip, ...l4, ...above];
  const fcsValue = crc32(frame);
  const fcs = [fcsValue & 0xff, (fcsValue >>> 8) & 0xff, (fcsValue >>> 16) & 0xff, (fcsValue >>> 24) & 0xff];
  const out: Built = { app: payload, tls, l4, ip, l2, fcs, ipSum, l4Sum, fcsValue, frame, l2Kind: wifi ? 'wifi' : 'eth', src, dst };
  cache.set(key, out);
  return out;
}

export const hex4 = (n: number) => `0x${n.toString(16).padStart(4, '0')}`;
export const hex8 = (n: number) => `0x${n.toString(16).padStart(8, '0')}`;

/* ------------------------------------------------------------------ */
/* Bits on the wire                                                    */
/* ------------------------------------------------------------------ */

export type BitRegion = 'pre' | 'l2' | 'ip' | 'l4' | 'tls' | 'app' | 'fcs';

export const REGION_COLOR: Record<BitRegion, string> = {
  pre: LAYERS[1].color,
  l2: LAYERS[2].color,
  ip: LAYERS[3].color,
  l4: LAYERS[4].color,
  tls: LAYERS[6].color,
  app: LAYERS[7].color,
  fcs: LAYERS[2].color,
};

/**
 * A sample of the bits as they leave the NIC: preamble and SFD first, then
 * the frame front to back, each byte least-significant bit first (as 802.3
 * sends them). Each region is squeezed to a share of `n` glyphs (at least
 * `min`, so every header stays visible) showing that region's first bits.
 */
const sampleCache = new WeakMap<Built, Map<number, { bit: number; region: BitRegion }[]>>();

export function bitSample(b: Built, n = 44, min = 2): { bit: number; region: BitRegion }[] {
  let per = sampleCache.get(b);
  if (!per) {
    per = new Map();
    sampleCache.set(b, per);
  }
  const hit = per.get(n);
  if (hit) return hit;
  const out = sampleBits(b, n, min);
  per.set(n, out);
  return out;
}

function sampleBits(b: Built, n: number, min: number): { bit: number; region: BitRegion }[] {
  const regions: [BitRegion, number[]][] = [
    ['pre', [0x55, 0x55, 0x55, 0x55, 0x55, 0x55, 0x55, 0xd5]],
    ['l2', b.l2],
    ['ip', b.ip],
    ['l4', b.l4],
  ];
  if (b.tls) regions.push(['tls', b.tls.slice(0, 5)], ['app', b.tls.slice(5)]);
  else regions.push(['app', b.app]);
  regions.push(['fcs', b.fcs]);
  const total = regions.reduce((s, [, bytes]) => s + bytes.length, 0);
  const counts = regions.map(([region, bytes]) => Math.max(region === 'pre' ? 4 : min, Math.round((bytes.length / total) * n)));
  const out: { bit: number; region: BitRegion }[] = [];
  regions.forEach(([region, bytes], ri) => {
    const bits: number[] = [];
    for (const byte of bytes) for (let k = 0; k < 8; k++) bits.push((byte >> k) & 1);
    for (let i = 0; i < counts[ri]; i++) out.push({ bit: bits[i % bits.length], region });
  });
  return out;
}

/* ------------------------------------------------------------------ */
/* Header blocks drawn in the data unit                                */
/* ------------------------------------------------------------------ */

export type BlockKind = 'app' | 'tls' | 'tcp' | 'udp' | 'ip' | 'eth' | 'wifi' | 'fcs';

export const BLOCK_LAYER: Record<BlockKind, LayerN> = { app: 7, tls: 6, tcp: 4, udp: 4, ip: 3, eth: 2, wifi: 2, fcs: 2 };

export function blockColor(k: BlockKind) {
  return LAYERS[BLOCK_LAYER[k]].color;
}

/** Bytes a block stands for. The payload is 75 bytes of plaintext until TLS seals it. */
export function blockBytes(k: BlockKind, b: Built, enc = true): number {
  switch (k) {
    case 'app':
      return b.tls && enc ? b.tls.length - 5 : b.app.length;
    case 'tls':
      return 5;
    case 'tcp':
    case 'udp':
      return b.l4.length;
    case 'ip':
      return 20;
    case 'eth':
      return 14;
    case 'wifi':
      return b.l2.length;
    case 'fcs':
      return 4;
  }
}

export function blockLabel(k: BlockKind, app: AppKind): string {
  switch (k) {
    case 'app':
      return APPS[app].proto;
    case 'tls':
      return 'TLS';
    case 'tcp':
      return 'TCP';
    case 'udp':
      return 'UDP';
    case 'ip':
      return 'IP';
    case 'eth':
      return 'ETH';
    case 'wifi':
      return '802.11';
    case 'fcs':
      return 'FCS';
  }
}

/** Name of the data unit, from its outermost block. */
export function unitName(outer: BlockKind | null, bits: boolean): string {
  if (bits) return 'bits';
  switch (outer) {
    case 'eth':
    case 'wifi':
      return 'frame';
    case 'ip':
      return 'packet';
    case 'tcp':
      return 'segment';
    case 'udp':
      return 'datagram';
    case 'tls':
      return 'TLS record';
    case 'app':
      return 'data';
    default:
      return '—';
  }
}
