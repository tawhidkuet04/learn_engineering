import { SIG } from '@/lib/sim/colors';

/* The page every step loads: one HTML document plus the files it references. */

export type ResType = 'html' | 'css' | 'js' | 'font' | 'img';

export const TYPE_COLOR: Record<ResType, string> = {
  html: SIG.text,
  css: SIG.pink,
  js: SIG.lime,
  font: SIG.teal,
  img: SIG.blue,
};

export const TYPE_NAME: Record<ResType, string> = {
  html: 'document',
  css: 'stylesheet',
  js: 'script',
  font: 'font',
  img: 'image',
};

export const MIME: Record<ResType, string> = {
  html: 'text/html',
  css: 'text/css',
  js: 'text/javascript',
  font: 'font/woff2',
  img: 'image/jpeg',
};

export interface FileSpec {
  name: string;
  type: ResType;
  /** Size in chunks. One chunk is about 16 KB, one HTTP/2 DATA frame. */
  chunks: number;
  /** Server time to produce the response, in simulated seconds (default: fast) */
  slow?: number;
  /** Only discovered once this file has arrived (default: the HTML) */
  after?: string;
}

const BASE: FileSpec[] = [
  { name: 'index.html', type: 'html', chunks: 2 },
  { name: 'style.css', type: 'css', chunks: 2 },
  { name: 'app.js', type: 'js', chunks: 4 },
  { name: 'font.woff2', type: 'font', chunks: 2, after: 'style.css' },
  { name: 'logo.svg', type: 'img', chunks: 1 },
  { name: 'hero.jpg', type: 'img', chunks: 5 },
  { name: 'p1.jpg', type: 'img', chunks: 2 },
  { name: 'p2.jpg', type: 'img', chunks: 3 },
  { name: 'p3.jpg', type: 'img', chunks: 2 },
  { name: 'p4.jpg', type: 'img', chunks: 3 },
  { name: 'p5.jpg', type: 'img', chunks: 2 },
  { name: 'p6.jpg', type: 'img', chunks: 2 },
];

const BUNDLES: FileSpec[] = [
  { name: 'bundle.css', type: 'css', chunks: 0 },
  { name: 'bundle.js', type: 'js', chunks: 0 },
  { name: 'sprites.jpg', type: 'img', chunks: 0 },
];

/** Chunks in the 11 subresources of the standard 12-file page. */
const SUB_TOTAL = BASE.slice(1).reduce((s, f) => s + f.chunks, 0);

function named(i: number): FileSpec {
  if (i < BASE.length) return { ...BASE[i] };
  return { name: `p${i - 5}.jpg`, type: 'img', chunks: i % 2 ? 3 : 2 };
}

/**
 * Build a page of `count` files (HTML included). With `bundle`, the same bytes
 * are spread over however many files there are, the way bundlers and sprites
 * trade many small requests for a few big ones.
 */
export function makePage(count: number, opts: { bundle?: boolean; slow?: { name: string; t: number } | null } = {}): FileSpec[] {
  const n = Math.max(2, Math.min(40, Math.round(count)));
  const k = n - 1;
  const files =
    opts.bundle && k <= BUNDLES.length ? [{ ...BASE[0] }, ...BUNDLES.slice(0, k).map((f) => ({ ...f }))] : Array.from({ length: n }, (_, i) => named(i));
  if (opts.bundle) {
    const each = Math.floor(SUB_TOTAL / k);
    const extra = SUB_TOTAL % k;
    files.forEach((f, i) => {
      if (i > 0) f.chunks = Math.max(1, each + (i - 1 < extra ? 1 : 0));
    });
  }
  if (opts.slow) {
    const f = files.find((x) => x.name === opts.slow!.name);
    if (f) f.slow = opts.slow.t;
  }
  return files;
}

/** Display size in KB (a chunk is about 16 KB). */
export function sizeKb(f: { chunks: number }, i: number) {
  return Math.max(3, f.chunks * 16 - ((i * 7) % 6) - 1);
}

export function totalKb(files: { chunks: number }[]) {
  return files.reduce((s, f, i) => s + sizeKb(f, i), 0);
}
