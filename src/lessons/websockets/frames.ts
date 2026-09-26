/**
 * Real WebSocket frames (RFC 6455 §5.2), byte for byte. The "Hello" pair is
 * the RFC's own example in §5.7, masking key and all.
 */
export type FrameKind = 'hello-c' | 'hello-s' | 'json' | 'binary' | 'ping' | 'close';

export interface FrameSample {
  kind: FrameKind;
  /** Button label */
  label: string;
  dir: 'c2s' | 's2c';
  opcode: number;
  opName: string;
  mask: boolean;
  /** The 7-bit payload length field: 0–125, or 126 / 127 meaning "read the extended length" */
  len7: number;
  /** Real payload length in bytes */
  length: number;
  /** Extended payload length bytes (0, 2 or 8 of them) */
  ext: number[];
  /** Masking key (client → server only) */
  key: number[] | null;
  /** The first payload bytes as they travel on the wire (masked if MASK = 1) */
  payload: number[];
  /** The same bytes before masking, for the XOR table */
  plain?: number[];
  /** Payload bytes not drawn */
  more: number;
  /** What the payload is, in words */
  what: string;
  /** Short flight label */
  flight: string;
}

const HELLO = [0x48, 0x65, 0x6c, 0x6c, 0x6f];
const KEY = [0x37, 0xfa, 0x21, 0x3d];

export const FRAMES: Record<FrameKind, FrameSample> = {
  'hello-c': {
    kind: 'hello-c',
    label: '"Hello" · browser',
    dir: 'c2s',
    opcode: 0x1,
    opName: 'text',
    mask: true,
    len7: 5,
    length: 5,
    ext: [],
    key: KEY,
    payload: HELLO.map((b, i) => b ^ KEY[i % 4]),
    plain: HELLO,
    more: 0,
    what: '"Hello", masked',
    flight: 'Hello',
  },
  'hello-s': {
    kind: 'hello-s',
    label: '"Hello" · server',
    dir: 's2c',
    opcode: 0x1,
    opName: 'text',
    mask: false,
    len7: 5,
    length: 5,
    ext: [],
    key: null,
    payload: HELLO,
    more: 0,
    what: '"Hello"',
    flight: 'Hello',
  },
  json: {
    kind: 'json',
    label: '300 B of JSON',
    dir: 's2c',
    opcode: 0x1,
    opName: 'text',
    mask: false,
    len7: 126,
    length: 300,
    ext: [0x01, 0x2c],
    key: null,
    // {"type
    payload: [0x7b, 0x22, 0x74, 0x79, 0x70, 0x65],
    more: 294,
    what: '300 bytes of JSON',
    flight: 'JSON 300 B',
  },
  binary: {
    kind: 'binary',
    label: '100 KB image',
    dir: 's2c',
    opcode: 0x2,
    opName: 'binary',
    mask: false,
    len7: 127,
    length: 100_000,
    ext: [0, 0, 0, 0, 0, 0x01, 0x86, 0xa0],
    key: null,
    // the PNG signature
    payload: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a],
    more: 99_994,
    what: 'a 100,000-byte PNG',
    flight: 'PNG 100 KB',
  },
  ping: {
    kind: 'ping',
    label: 'Ping',
    dir: 's2c',
    opcode: 0x9,
    opName: 'ping',
    mask: false,
    len7: 0,
    length: 0,
    ext: [],
    key: null,
    payload: [],
    more: 0,
    what: 'no payload',
    flight: 'ping',
  },
  close: {
    kind: 'close',
    label: 'Close',
    dir: 's2c',
    opcode: 0x8,
    opName: 'close',
    mask: false,
    len7: 2,
    length: 2,
    ext: [],
    key: null,
    payload: [0x03, 0xe8],
    more: 0,
    what: 'status code 1000, normal closure',
    flight: 'close 1000',
  },
};

export const FRAME_ORDER: FrameKind[] = ['hello-c', 'hello-s', 'json', 'binary', 'ping', 'close'];

export const hex = (n: number) => n.toString(16).padStart(2, '0');

export const byte0 = (f: FrameSample) => 0x80 | f.opcode;
export const byte1 = (f: FrameSample) => (f.mask ? 0x80 : 0) | f.len7;

/** Header size in bytes: 2, plus 2 or 8 for a long length, plus 4 for a masking key. */
export const headerBytes = (f: FrameSample) => 2 + f.ext.length + (f.key ? 4 : 0);

/** Every header byte in order. */
export function headerHex(f: FrameSample): number[] {
  return [byte0(f), byte1(f), ...f.ext, ...(f.key ?? [])];
}

export const bits = (b: number) => Array.from({ length: 8 }, (_, i) => (b >> (7 - i)) & 1);
