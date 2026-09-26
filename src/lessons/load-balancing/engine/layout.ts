import { clamp, lerp } from '@/lib/sim/geometry';
import type { World } from './world';

export const UNIT = { h: 11, gap: 3, header: 22, pad: 7 };
export const UNIT_COMPACT = { h: 9, gap: 2, header: 19, pad: 6 };

export function serverHeight(workers: number, compact: boolean) {
  const u = compact ? UNIT_COMPACT : UNIT;
  return u.header + workers * u.h + (workers - 1) * u.gap + u.pad;
}

export function dims(w: World) {
  const portrait = w.orient === 'portrait';
  const compact = w.compact;
  return {
    pad: portrait ? 12 : compact ? 18 : 26,
    top: portrait ? 70 : 72,
    bottom: portrait ? 58 : 64,
    clientW: compact ? 128 : 150,
    clientH: portrait ? 36 : compact ? 38 : 42,
    lbW: portrait ? 146 : compact ? 152 : 172,
    lbH: portrait ? 54 : compact ? 56 : 62,
    serverW: compact ? 146 : 168,
    redisW: portrait ? 132 : 118,
    redisH: 58,
    /** Label strip drawn above every server card */
    serverLabel: 16,
    queueRoom: 150,
  };
}

/** Assigns target positions and sizes to every live node. */
export function layoutWorld(w: World) {
  const D = dims(w);
  const W = w.w;
  const H = w.h;
  const clients = [...w.clients.values()].filter((c) => !c.removing);
  const servers = [...w.servers.values()].filter((s) => !s.removing);
  const lbs = [...w.lbs.values()].filter((l) => !l.removing);
  const redis = w.redis && !w.redis.removing ? w.redis : null;

  const availTop = D.top;
  const availBottom = H - D.bottom;
  const midY = (availTop + availBottom) / 2;

  // Decide whether server cards need the compact unit rows to fit.
  let unitCompact = w.compact || w.orient === 'portrait';
  if (w.orient === 'landscape' && !unitCompact) {
    const total =
      servers.reduce((sum, s) => sum + serverHeight(s.workers, false) + D.serverLabel, 0) +
      Math.max(0, servers.length - 1) * 12;
    if (total > availBottom - availTop) unitCompact = true;
  }
  w.unitCompact = unitCompact;

  if (w.orient === 'landscape') {
    // Columns
    const xC = D.pad + D.clientW / 2;
    const xR = redis ? W - D.pad - D.redisW / 2 : 0;
    const xS = redis ? xR - D.redisW / 2 - 64 - D.serverW / 2 : W - D.pad - D.serverW / 2;
    const left = xC + D.clientW / 2 + 60 + D.lbW / 2;
    const right = xS - D.serverW / 2 - D.queueRoom - D.lbW / 2;
    const xL = right > left ? lerp(left, right, 0.36) : (left + right) / 2;

    // Clients
    const cSpacing = Math.min(92, (availBottom - availTop) / Math.max(1, clients.length));
    clients.forEach((c, i) => {
      c.w = D.clientW;
      c.h = D.clientH;
      c.tx = xC;
      c.ty = midY + (i - (clients.length - 1) / 2) * cSpacing;
    });

    // Servers, stacked
    const heights = servers.map((s) => serverHeight(s.workers, unitCompact));
    const blocks = heights.map((h) => h + D.serverLabel);
    const sum = blocks.reduce((a, b) => a + b, 0);
    const gap = servers.length > 1 ? clamp((availBottom - availTop - sum) / (servers.length + 1), 10, 34) : 0;
    let y = midY - (sum + gap * (servers.length - 1)) / 2;
    servers.forEach((s, i) => {
      s.w = D.serverW;
      s.h = heights[i];
      s.tx = xS;
      s.ty = y + D.serverLabel + heights[i] / 2;
      y += blocks[i] + gap;
    });

    // Load balancers
    if (lbs.length === 1) {
      Object.assign(lbs[0], { w: D.lbW, h: D.lbH, tx: xL, ty: midY });
    } else if (lbs.length === 2) {
      lbs.forEach((lb, i) => Object.assign(lb, { w: D.lbW, h: D.lbH, tx: xL, ty: midY + (i === 0 ? -64 : 64) }));
    }

    if (redis) Object.assign(redis, { w: D.redisW, h: D.redisH, tx: xR, ty: midY });

    w.boundary = lbs.length ? xL : (xC + D.clientW / 2 + xS - D.serverW / 2) / 2;
  } else {
    // Portrait: rows flowing top to bottom
    const n = Math.max(1, clients.length);
    const cW = clamp((W - D.pad * 2 - (n - 1) * 8) / n, 70, 132);
    const yC = availTop + D.clientH / 2 + 4;
    clients.forEach((c, i) => {
      c.w = cW;
      c.h = D.clientH;
      c.tx = W / 2 + (i - (n - 1) / 2) * (cW + 8);
      c.ty = yC;
    });

    const yL = yC + D.clientH / 2 + 62 + D.lbH / 2;
    if (lbs.length === 1) {
      Object.assign(lbs[0], { w: D.lbW, h: D.lbH, tx: W / 2, ty: yL });
    } else if (lbs.length === 2) {
      const lw = Math.min(D.lbW, (W - D.pad * 2 - 20) / 2);
      lbs.forEach((lb, i) => Object.assign(lb, { w: lw, h: D.lbH, tx: W / 2 + (i === 0 ? -1 : 1) * (lw / 2 + 10), ty: yL }));
    }

    const perRow = Math.min(4, Math.max(1, servers.length));
    const sW = clamp((W - D.pad * 2 - (perRow - 1) * 10) / perRow, 78, 160);
    const heights = servers.map((s) => serverHeight(s.workers, true));
    const rowTop = (lbs.length ? yL + D.lbH / 2 : yC + D.clientH / 2) + 118;
    servers.forEach((s, i) => {
      const row = Math.floor(i / perRow);
      const inRow = Math.min(perRow, servers.length - row * perRow);
      const col = i % perRow;
      s.w = sW;
      s.h = heights[i];
      s.tx = W / 2 + (col - (inRow - 1) / 2) * (sW + 10);
      s.ty = rowTop + D.serverLabel + s.h / 2 + row * (Math.max(...heights) + D.serverLabel + 22);
    });

    if (redis) {
      const bottomOfServers = Math.max(...servers.map((s) => s.ty + s.h / 2), rowTop);
      Object.assign(redis, { w: D.redisW, h: D.redisH, tx: W / 2, ty: Math.min(availBottom - D.redisH / 2, bottomOfServers + 40 + D.redisH / 2) });
    }

    w.boundary = lbs.length ? yL : (yC + rowTop) / 2;
  }
}
