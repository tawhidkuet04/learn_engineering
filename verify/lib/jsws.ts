/**
 * Just enough of RFC 6455 to stand in for a WebSocket server: read the
 * browser's masked frames and write unmasked server frames. The handshake's
 * Sec-WebSocket-Accept is computed by the lesson's own server.js snippet.
 */
import type { Duplex } from 'node:stream';

export const OP = { text: 1, close: 8, ping: 9, pong: 10 } as const;

/** A server-to-client frame (FIN set, unmasked). */
export function frame(op: number, payload: Buffer | string = Buffer.alloc(0)): Buffer {
  const p = typeof payload === 'string' ? Buffer.from(payload) : payload;
  const head = p.length < 126 ? Buffer.from([0x80 | op, p.length]) : Buffer.from([0x80 | op, 126, p.length >> 8, p.length & 255]);
  return Buffer.concat([head, p]);
}

/** Close frame with a status code. */
export const closeFrame = (code: number) => frame(OP.close, Buffer.from([code >> 8, code & 255]));

export interface Frame {
  op: number;
  masked: boolean;
  payload: Buffer;
}

/** Split a chunk from the browser into frames (handles several per chunk). */
export function parseFrames(buf: Buffer): Frame[] {
  const out: Frame[] = [];
  let i = 0;
  while (i + 2 <= buf.length) {
    const op = buf[i] & 15;
    const masked = (buf[i + 1] & 128) !== 0;
    let len = buf[i + 1] & 127;
    let o = i + 2;
    if (len === 126) {
      len = buf.readUInt16BE(o);
      o += 2;
    }
    const mask = masked ? buf.subarray(o, o + 4) : null;
    if (masked) o += 4;
    const payload = Buffer.from(buf.subarray(o, o + len));
    if (mask) for (let k = 0; k < payload.length; k++) payload[k] ^= mask[k % 4];
    out.push({ op, masked, payload });
    i = o + len;
  }
  return out;
}

/** Answer an upgrade request with 101 and the given accept value. */
export function accept101(socket: Duplex, accept: string) {
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
}
