import { ALICE, AP_MAC, APPS, HTTP_REQUEST, LAYERS, ROUTER, SMTP_LINE, hex4, hex8, receiverFor, type AppKind, type BlockKind, type Built, type LayerN } from './model';

export type FieldKind = 'add' | 'change' | 'dim' | 'hot' | 'bad' | 'same';

export interface Field {
  k: string;
  v: string;
  note?: string;
  kind?: FieldKind;
}

export interface HeaderInfo {
  layer: LayerN;
  title: string;
  size: string;
  fields: Field[];
  /** Raw text lines (for text protocols like HTTP) */
  text?: string[];
  note?: string;
}

const n = (x: number) => x.toLocaleString('en-US');

function macOwner(mac: string, app: AppKind) {
  if (mac === ALICE.mac) return 'Alice';
  if (mac === ROUTER.lan.mac) return 'router eth0';
  if (mac === ROUTER.wan.mac) return 'router eth1';
  if (mac === AP_MAC) return 'access point';
  return receiverFor(app).host;
}

export interface Ctx {
  app: AppKind;
  b: Built;
  seg: 0 | 1;
  ttl: number;
  /** Mark every field as just added (encapsulation) */
  fresh?: boolean;
}

/** What one header (or the payload, or the trailer) contains. */
export function headerInfo(kind: BlockKind, ctx: Ctx): HeaderInfo {
  const { app, b, ttl } = ctx;
  const a = APPS[app];
  const rx = receiverFor(app);
  const add = ctx.fresh ? ('add' as const) : undefined;
  switch (kind) {
    case 'app': {
      if (b.tls) {
        const hex = b.tls
          .slice(5, 13)
          .map((x) => x.toString(16).padStart(2, '0'))
          .join(' ');
        return {
          layer: 7,
          title: 'Encrypted HTTP',
          size: `${b.tls.length - 5} bytes`,
          fields: [],
          text: [`${hex} …`],
          note: 'The same 75-byte request, sealed by TLS. Switches and routers carry it but can’t read it.',
        };
      }
      if (app === 'http' || app === 'https') {
        return { layer: 7, title: 'HTTP request', size: `${b.app.length} bytes`, fields: [], text: HTTP_REQUEST.split('\r\n').filter(Boolean) };
      }
      if (app === 'smtp') return { layer: 7, title: 'SMTP command', size: `${b.app.length} bytes`, fields: [], text: SMTP_LINE.split('\r\n').filter(Boolean) };
      if (app === 'dns') {
        return {
          layer: 7,
          title: 'DNS query',
          size: `${b.app.length} bytes`,
          fields: [
            { k: 'id', v: '0x7c3a', kind: add },
            { k: 'flags', v: 'query, recursion desired', kind: add },
            { k: 'question', v: 'shop.example  A  IN', kind: add },
          ],
        };
      }
      return {
        layer: 7,
        title: 'RTP packet (video)',
        size: `${n(b.app.length)} bytes`,
        fields: [
          { k: 'version', v: '2', kind: add },
          { k: 'payload type', v: '96 (H.264, dynamic)', kind: add },
          { k: 'sequence', v: '6699', kind: add },
          { k: 'SSRC', v: '0x11223344', kind: add },
          { k: 'payload', v: `${n(b.app.length - 12)} bytes of video`, kind: add },
        ],
      };
    }
    case 'tls':
      return {
        layer: 6,
        title: 'TLS record header',
        size: '5 bytes',
        fields: [
          { k: 'type', v: '23 (application data)', kind: add },
          { k: 'version', v: '0x0303', note: 'fixed, even in TLS 1.3', kind: add },
          { k: 'length', v: String(b.tls ? b.tls.length - 5 : 0), note: '75 + 1 + 16-byte tag', kind: add },
        ],
      };
    case 'tcp':
      return {
        layer: 4,
        title: 'TCP header',
        size: '20 bytes',
        fields: [
          { k: 'src port', v: String(a.sport), note: 'curl’s temporary port', kind: add },
          { k: 'dst port', v: String(a.dport), note: `${a.portName} → ${rx.proc}`, kind: add },
          { k: 'seq', v: '1', note: 'relative', kind: add },
          { k: 'ack', v: '1', kind: add },
          { k: 'flags', v: 'PSH, ACK', kind: add },
          { k: 'window', v: '502', note: '×128 = 64,256 B', kind: add },
          { k: 'checksum', v: hex4(b.l4Sum), kind: add },
        ],
      };
    case 'udp':
      return {
        layer: 4,
        title: 'UDP header',
        size: '8 bytes',
        fields: [
          { k: 'src port', v: String(a.sport), note: 'temporary port', kind: add },
          { k: 'dst port', v: String(a.dport), note: a.portName, kind: add },
          { k: 'length', v: String(b.l4.length + (b.tls ? b.tls.length : b.app.length)), kind: add },
          { k: 'checksum', v: hex4(b.l4Sum), kind: add },
        ],
        note: 'No sequence numbers, no acks, no retries. Just ports.',
      };
    case 'ip':
      return {
        layer: 3,
        title: 'IPv4 header',
        size: '20 bytes',
        fields: [
          { k: 'src', v: b.src.ip, note: 'Alice', kind: add },
          { k: 'dst', v: b.dst.ip, note: rx.host, kind: add },
          { k: 'TTL', v: String(ttl), note: 'hops left', kind: add },
          { k: 'protocol', v: a.l4 === 'tcp' ? '6 (TCP)' : '17 (UDP)', kind: add },
          { k: 'length', v: String((b.ip[2] << 8) | b.ip[3]), kind: add },
          { k: 'id · flags', v: '0x3c1d · DF', kind: add },
          { k: 'checksum', v: hex4(b.ipSum), kind: add },
        ],
      };
    case 'eth':
      return {
        layer: 2,
        title: 'Ethernet II header',
        size: '14 bytes',
        fields: [
          { k: 'dst MAC', v: b.dst.mac, note: macOwner(b.dst.mac, app), kind: add },
          { k: 'src MAC', v: b.src.mac, note: macOwner(b.src.mac, app), kind: add },
          { k: 'type', v: '0x0800', note: 'IPv4 inside', kind: add },
        ],
        note: ctx.seg === 0 ? 'Addressed to the router, not the server: the server isn’t on Alice’s network.' : undefined,
      };
    case 'wifi':
      return {
        layer: 2,
        title: '802.11 + LLC/SNAP header',
        size: `${b.l2.length} bytes`,
        fields: [
          { k: 'receiver', v: AP_MAC, note: 'access point', kind: add },
          { k: 'transmitter', v: ALICE.mac, note: 'Alice', kind: add },
          { k: 'destination', v: ROUTER.lan.mac, note: 'router', kind: add },
          { k: 'LLC/SNAP type', v: '0x0800', note: 'IPv4 inside', kind: add },
        ],
        note: 'Wi-Fi frames carry three addresses: the radio hop plus the real destination.',
      };
    case 'fcs':
      return {
        layer: 2,
        title: 'Frame check sequence',
        size: '4 bytes',
        fields: [{ k: 'FCS', v: hex8(b.fcsValue), note: 'CRC-32 of the frame', kind: add }],
        note: 'The only trailer in the stack. A receiver whose CRC differs drops the frame.',
      };
  }
}

/** The physical layer adds no header: it sends a preamble, then the frame as signals. */
export function physicalInfo(b: Built): HeaderInfo {
  const frame = b.frame.length + 4;
  const wire = (frame + 8 + 12) * 8;
  return {
    layer: 1,
    title: 'On the wire',
    size: `${n(frame * 8)} bits`,
    fields: [
      { k: 'preamble', v: '10101010 ×7', note: 'lets the receiver lock on' },
      { k: 'SFD', v: '10101011', note: 'frame starts now' },
      { k: 'frame', v: `${frame} B = ${n(frame * 8)} bits`, kind: 'hot' },
      { k: 'gap', v: '96 bit times', note: 'silence after' },
      { k: '@ 1 Gb/s', v: `${(wire / 1000).toFixed(2)} µs`, note: 'incl. preamble + gap' },
    ],
  };
}

export function emptyInfo(layer: LayerN, app: AppKind): HeaderInfo {
  if (layer === 6)
    return {
      layer,
      title: 'Presentation',
      size: '0 bytes',
      fields: [],
      note:
        app === 'https'
          ? 'TLS encrypts the data here.'
          : 'Nothing added. The request is already plain UTF-8 text, and HTTP itself says how the body is encoded (Content-Type, Content-Encoding).',
    };
  if (layer === 5)
    return {
      layer,
      title: 'Session',
      size: '0 bytes',
      fields: [],
      note: 'Nothing added. On the internet, “sessions” live in other places: the TCP connection, TLS session tickets, HTTP cookies.',
    };
  return { layer, title: LAYERS[layer].name, size: '', fields: [] };
}

/** What the router changed, field by field. */
export function routerDiff(app: AppKind, before: Built, after: Built, ttlBefore: number, ttlAfter: number): Field[] {
  return [
    { k: 'dst MAC', v: after.dst.mac, note: `was ${before.dst.mac.slice(-5)}`, kind: 'change' },
    { k: 'src MAC', v: after.src.mac, note: `was ${before.src.mac.slice(-5)}`, kind: 'change' },
    { k: 'TTL', v: String(ttlAfter), note: `was ${ttlBefore}`, kind: 'change' },
    { k: 'IP checksum', v: hex4(after.ipSum), note: `was ${hex4(before.ipSum)}`, kind: 'change' },
    { k: 'FCS', v: hex8(after.fcsValue), note: 'new frame', kind: 'change' },
    { k: 'src IP', v: after.src.ip, note: 'same', kind: 'same' },
    { k: 'dst IP', v: after.dst.ip, note: 'same', kind: 'same' },
    { k: APPS[app].l4 === 'tcp' ? 'TCP + data' : 'UDP + data', v: 'untouched', kind: 'same' },
  ];
}

/* ------------------------------------------------------------------ */
/* Wireshark-style tree                                                */
/* ------------------------------------------------------------------ */

export interface TreeNode {
  layer: LayerN | null;
  head: string;
  lines: string[];
}

export function wiresharkTree(app: AppKind, b: Built): TreeNode[] {
  const a = APPS[app];
  const len = b.frame.length;
  const rx = receiverFor(app);
  const nodes: TreeNode[] = [
    {
      layer: 1,
      head: `Frame 4: ${len} bytes on wire (${len * 8} bits), ${len} bytes captured (${len * 8} bits) on interface eth0`,
      lines: [`Frame Length: ${len} bytes (${len * 8} bits)`, `[Protocols in frame: eth:ethertype:ip:${a.l4}${app === 'http' ? ':http' : ''}]`],
    },
    {
      layer: 2,
      head: `Ethernet II, Src: ${b.src.mac}, Dst: ${b.dst.mac}`,
      lines: [`Destination: ${b.dst.mac}`, `Source: ${b.src.mac}`, 'Type: IPv4 (0x0800)'],
    },
    {
      layer: 3,
      head: `Internet Protocol Version 4, Src: ${b.src.ip}, Dst: ${b.dst.ip}`,
      lines: [
        '0100 .... = Version: 4',
        '.... 0101 = Header Length: 20 bytes (5)',
        `Total Length: ${(b.ip[2] << 8) | b.ip[3]}`,
        'Identification: 0x3c1d (15389)',
        "010. .... = Flags: 0x2, Don't fragment",
        `Time to Live: ${b.ip[8]}`,
        `Protocol: ${a.l4 === 'tcp' ? 'TCP (6)' : 'UDP (17)'}`,
        `Header Checksum: ${hex4(b.ipSum)} [validation disabled]`,
        `Source Address: ${b.src.ip}`,
        `Destination Address: ${rx.ip}`,
      ],
    },
  ];
  if (a.l4 === 'tcp') {
    const dlen = b.tls ? b.tls.length : b.app.length;
    nodes.push({
      layer: 4,
      head: `Transmission Control Protocol, Src Port: ${a.sport}, Dst Port: ${a.dport}, Seq: 1, Ack: 1, Len: ${dlen}`,
      lines: [
        `Source Port: ${a.sport}`,
        `Destination Port: ${a.dport}`,
        'Sequence Number: 1    (relative sequence number)',
        'Acknowledgment Number: 1    (relative ack number)',
        '0101 .... = Header Length: 20 bytes (5)',
        'Flags: 0x018 (PSH, ACK)',
        'Window: 502',
        `Checksum: ${hex4(b.l4Sum)} [unverified]`,
      ],
    });
  } else {
    nodes.push({
      layer: 4,
      head: `User Datagram Protocol, Src Port: ${a.sport}, Dst Port: ${a.dport}`,
      lines: [`Source Port: ${a.sport}`, `Destination Port: ${a.dport}`, `Length: ${b.l4.length + b.app.length}`, `Checksum: ${hex4(b.l4Sum)} [unverified]`],
    });
  }
  if (b.tls) {
    nodes.push({
      layer: 6,
      head: 'Transport Layer Security',
      lines: ['TLSv1.3 Record Layer: Application Data Protocol: http-over-tls', 'Opaque Type: Application Data (23)', 'Version: TLS 1.2 (0x0303)', `Length: ${b.tls.length - 5}`, 'Encrypted Application Data […]'],
    });
  } else if (app === 'http') {
    nodes.push({ layer: 7, head: 'Hypertext Transfer Protocol', lines: HTTP_REQUEST.split('\r\n').slice(0, 4).map((l) => `${l}\\r\\n`).concat(['\\r\\n']) });
  } else if (app === 'dns') {
    nodes.push({ layer: 7, head: 'Domain Name System (query)', lines: ['Transaction ID: 0x7c3a', 'Flags: 0x0100 Standard query', 'Questions: 1', 'Queries', '    shop.example: type A, class IN'] });
  }
  return nodes;
}
