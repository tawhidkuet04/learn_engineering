/**
 * Minimal WebSocket chat servers (RFC 6455) on node:http's 'upgrade' event,
 * so the tests need no WebSocket library. Each one says hello when a socket
 * opens, echoes text, answers pings, counts pongs, and closes with 1001
 * ("going away") when it is restarted.
 */
import crypto from 'node:crypto';
import http from 'node:http';
import type net from 'node:net';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export const acceptKey = (key: string) => crypto.createHash('sha1').update(key + GUID).digest('base64');

function frame(opcode: number, payload: Buffer = Buffer.alloc(0)): Buffer {
  const n = payload.length;
  let head: Buffer;
  if (n < 126) head = Buffer.from([0x80 | opcode, n]);
  else if (n < 65536) head = Buffer.from([0x80 | opcode, 126, n >> 8, n & 0xff]);
  else {
    head = Buffer.alloc(10);
    head[0] = 0x80 | opcode;
    head[1] = 127;
    head.writeBigUInt64BE(BigInt(n), 2);
  }
  return Buffer.concat([head, payload]);
}

export interface WsConn {
  socket: net.Socket;
  received: string[];
  openedAt: number;
  send: (text: string) => void;
  ping: () => void;
  close: (code: number) => void;
}

export interface WsBackend {
  name: string;
  port: number;
  open: Set<WsConn>;
  /** Headers of every upgrade request that reached this server */
  upgrades: http.IncomingHttpHeaders[];
  /** Headers of requests that arrived without an Upgrade header (and got 426) */
  plain: http.IncomingHttpHeaders[];
  pongs: number;
  /** Send a ping on every open socket */
  pingAll: () => void;
  /** Restart: close every socket with `code`, stop listening */
  kill: (code?: number) => Promise<void>;
  revive: () => Promise<void>;
}

export async function wsBackends(names: string[]): Promise<WsBackend[]> {
  return Promise.all(names.map((n) => wsBackend(n)));
}

async function wsBackend(name: string): Promise<WsBackend> {
  let server: http.Server | null = null;
  const b: WsBackend = {
    name,
    port: 0,
    open: new Set(),
    upgrades: [],
    plain: [],
    pongs: 0,
    pingAll: () => b.open.forEach((c) => c.ping()),
    kill: async (code = 1001) => {
      if (!server) return;
      const s = server;
      server = null;
      for (const c of b.open) c.close(code);
      await new Promise((r) => setTimeout(r, 50));
      for (const c of b.open) c.socket.destroy();
      b.open.clear();
      s.closeAllConnections();
      await new Promise<void>((r) => s.close(() => r()));
    },
    revive: async () => {
      if (server) return;
      server = http.createServer((req, res) => {
        b.plain.push(req.headers);
        res.writeHead(426, { 'content-type': 'text/plain', upgrade: 'websocket' });
        res.end('Upgrade Required\n');
      });
      server.on('upgrade', (req, socket: net.Socket) => onUpgrade(b, req, socket));
      await new Promise<void>((r) => server!.listen(b.port, '127.0.0.1', () => r()));
      b.port = (server.address() as net.AddressInfo).port;
    },
  };
  await b.revive();
  return b;
}

function onUpgrade(b: WsBackend, req: http.IncomingMessage, socket: net.Socket) {
  b.upgrades.push(req.headers);
  const key = req.headers['sec-websocket-key'];
  if (String(req.headers.upgrade).toLowerCase() !== 'websocket' || typeof key !== 'string') {
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    return;
  }
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${acceptKey(key)}\r\n\r\n`);
  const conn: WsConn = {
    socket,
    received: [],
    openedAt: performance.now(),
    send: (text) => socket.writable && socket.write(frame(0x1, Buffer.from(text))),
    ping: () => socket.writable && socket.write(frame(0x9)),
    close: (code) => {
      const p = Buffer.alloc(2);
      p.writeUInt16BE(code);
      if (socket.writable) socket.write(frame(0x8, p));
    },
  };
  b.open.add(conn);
  socket.on('close', () => b.open.delete(conn));
  socket.on('error', () => {});
  conn.send(`hello from ${b.name}`);

  let buf = Buffer.alloc(0);
  socket.on('data', (d: Buffer) => {
    buf = Buffer.concat([buf, d]);
    for (;;) {
      if (buf.length < 2) return;
      const opcode = buf[0] & 0x0f;
      const masked = (buf[1] & 0x80) !== 0;
      let len = buf[1] & 0x7f;
      let at = 2;
      if (len === 126) {
        if (buf.length < 4) return;
        len = buf.readUInt16BE(2);
        at = 4;
      } else if (len === 127) {
        if (buf.length < 10) return;
        len = Number(buf.readBigUInt64BE(2));
        at = 10;
      }
      const mask = masked ? buf.subarray(at, at + 4) : null;
      if (masked) at += 4;
      if (buf.length < at + len) return;
      const payload = Buffer.from(buf.subarray(at, at + len));
      if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      buf = buf.subarray(at + len);
      if (opcode === 0x1) {
        const text = payload.toString('utf8');
        conn.received.push(text);
        conn.send(`echo: ${text} (${b.name})`);
      } else if (opcode === 0x9) socket.write(frame(0xa, payload));
      else if (opcode === 0xa) b.pongs++;
      else if (opcode === 0x8) {
        if (socket.writable) socket.end(frame(0x8, payload.subarray(0, 2)));
        return;
      }
    }
  });
}
