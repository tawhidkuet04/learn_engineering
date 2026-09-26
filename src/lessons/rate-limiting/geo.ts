/** Shared geometry for the limiter card, so the sim's layout and the drawing agree. */

export interface BucketGeo {
  cx: number;
  top: number;
  bot: number;
  /** width at the rim and at the bottom */
  tw: number;
  bw: number;
  /** token / queued-request radius, column spacing, row height */
  r: number;
  sp: number;
  rowH: number;
  cols: number;
}

export const MAX_SHOWN = 12;

export function bucketRows(cap: number, cols = 3) {
  return Math.max(2, Math.ceil(Math.min(cap, MAX_SHOWN) / cols));
}

/** One big bucket on the left of the card. */
export function singleBucket(landscape: boolean, cap: number, cardH: number): BucketGeo {
  const r = landscape ? 10 : 7;
  const sp = landscape ? 24 : 17;
  const rowH = landscape ? 22 : 15.5;
  const rows = bucketRows(cap);
  const bot = cardH - (landscape ? 12 : 10);
  const top = bot - rows * rowH - (landscape ? 12 : 9);
  const tw = 2 * sp + 2 * r + (landscape ? 30 : 22);
  return { cx: landscape ? 76 : 60, top, bot, tw, bw: tw * 0.78, r, sp, rowH, cols: 3 };
}

/** Center of token/request slot i (filled from the bottom up). */
export function slotPos(g: BucketGeo, i: number) {
  const row = Math.floor(i / g.cols);
  const col = i % g.cols;
  return { x: g.cx + (col - (g.cols - 1) / 2) * g.sp, y: g.bot - g.r - 4 - row * g.rowH };
}

export type CardAlgo = 'none' | 'fixed' | 'log' | 'sliding' | 'token' | 'leaky';

/** Width and height of the limiter card. */
export function limiterCard(landscape: boolean, algo: CardAlgo, keys: number, cap: number, stageW: number) {
  const bucket = algo === 'token' || algo === 'leaky';
  const w = landscape ? 260 : Math.min(260, stageW - 30);
  if (landscape) {
    if (bucket) {
      if (keys > 1) return { w, h: Math.max(170, 80 + bucketRows(cap) * 15.5 + 50) };
      return { w, h: Math.max(150, 74 + bucketRows(cap) * 22 + 24) };
    }
    if (keys > 1) return { w, h: 50 + keys * 26 + 44 };
    return { w, h: 146 };
  }
  if (bucket) {
    if (keys > 1) return { w, h: Math.max(118, 46 + bucketRows(cap) * 9.5 + 44) };
    return { w, h: Math.max(116, 56 + bucketRows(cap) * 15.5 + 19) };
  }
  if (keys > 1) return { w, h: 40 + keys * 20 + 30 };
  return { w, h: 112 };
}
