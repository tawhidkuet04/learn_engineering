/**
 * A shared headless Chrome and a tiny local web server, for the claims that are
 * about the browser: rendering, input, timers, workers, WebSockets, the heap.
 * Everything runs on 127.0.0.1 with a random port.
 */
import { existsSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import type { Duplex } from 'node:stream';
import puppeteer, { type Browser, type BrowserContext, type Page } from 'puppeteer-core';

/** Where Chrome usually lives on macOS and Linux; set CHROME_PATH to override. */
const CHROMES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];
export const CHROME_PATH = process.env.CHROME_PATH ?? CHROMES.find((p) => existsSync(p)) ?? CHROMES[0];

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, Math.max(0, ms)));

export interface Chrome {
  browser: Browser;
  /** e.g. "154.0.8037.58" */
  version: string;
  /** e.g. "Chrome 154", for badges and notes */
  by: string;
  close(): Promise<void>;
}

export async function launchChrome(): Promise<Chrome> {
  // New headless mode: the real browser, rendering at 60 Hz, without a window.
  const browser = await puppeteer.launch({ executablePath: CHROME_PATH, headless: true, args: ['--no-sandbox'] });
  const version = (await browser.version()).replace(/^.*\//, '');
  return { browser, version, by: `Chrome ${version.split('.')[0]}`, close: () => browser.close() };
}

type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => void;
type Upgrade = (req: http.IncomingMessage, socket: Duplex, head: Buffer) => void;

export interface Site {
  port: number;
  url(p: string): string;
  /** Serve fixed text at a path; the type comes from the extension unless given */
  file(p: string, body: string, headers?: Record<string, string>): void;
  route(p: string, h: Handler): void;
  /** Handle WebSocket upgrade requests for a path */
  ws(p: string, h: Upgrade): void;
  close(): Promise<void>;
}

const TYPES: Record<string, string> = { html: 'text/html; charset=utf-8', js: 'text/javascript', mjs: 'text/javascript', json: 'application/json', css: 'text/css' };
const typeOf = (p: string) => TYPES[p.endsWith('/') ? 'html' : (p.split('.').pop() ?? '')] ?? 'text/plain';

export async function startSite(): Promise<Site> {
  const files = new Map<string, { body: string; headers: Record<string, string> }>();
  const routes = new Map<string, Handler>();
  const upgrades = new Map<string, Upgrade>();
  const pathOf = (req: http.IncomingMessage) => new URL(req.url ?? '/', 'http://x').pathname;
  const server = http.createServer((req, res) => {
    const p = pathOf(req);
    const f = files.get(p);
    if (f) {
      res.writeHead(200, { 'content-type': typeOf(p), 'cache-control': 'no-store', ...f.headers });
      res.end(f.body);
      return;
    }
    const h = routes.get(p);
    if (h) return h(req, res);
    res.writeHead(p === '/favicon.ico' ? 204 : 404);
    res.end();
  });
  server.on('upgrade', (req, socket: Duplex, head: Buffer) => {
    socket.on('error', () => {});
    const h = upgrades.get(pathOf(req));
    if (h) h(req, socket, head);
    else socket.destroy();
  });
  const sockets = new Set<Socket>();
  server.on('connection', (s) => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  return {
    port,
    url: (p) => `http://127.0.0.1:${port}${p}`,
    file: (p, body, headers = {}) => files.set(p, { body, headers }),
    route: (p, h) => routes.set(p, h),
    ws: (p, h) => upgrades.set(p, h),
    close: () =>
      new Promise<void>((r) => {
        for (const s of sockets) s.destroy();
        server.close(() => r());
      }),
  };
}

export interface Tab {
  page: Page;
  /** console.log lines, in order */
  logs: string[];
  close(): Promise<void>;
}

/** A fresh page that records console.log output. Pass a context to get a separate renderer process. */
export async function openTab(target: Browser | BrowserContext, url?: string): Promise<Tab> {
  const page = await target.newPage();
  const logs: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'log') logs.push(m.text());
  });
  if (url) await page.goto(url);
  return { page, logs, close: () => page.close() };
}

/** Poll until `cond()` is true or `ms` pass. Returns whether it came true. */
export async function until(cond: () => boolean | Promise<boolean>, ms: number, every = 10): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await cond()) return true;
    await sleep(every);
  }
  return !!(await cond());
}

/** Center of an element, in page pixels (ask while the page is idle). */
export async function centerOf(page: Page, selector: string) {
  const el = await page.$(selector);
  const box = el && (await el.boundingBox());
  if (!box) throw new Error(`no element ${selector}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * A real mouse click, sent over its own DevTools session without waiting for
 * the page to handle it, so it can arrive while the main thread is busy, just
 * like a user's click. (puppeteer's page.mouse waits, and would queue behind.)
 */
export async function clickAt(page: Page, at: { x: number; y: number }) {
  const cdp = await page.createCDPSession();
  const ev = { x: at.x, y: at.y, button: 'left' as const, clickCount: 1 };
  void cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...ev }).catch(() => {});
  void cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...ev }).catch(() => {});
}

/** A page wrapped around a script: optional prelude, the script itself (as a file), optional postlude. */
export function pageHtml(o: { body?: string; prelude?: string; src: string; postlude?: string; module?: boolean }) {
  const t = o.module ? ' type="module"' : '';
  return `<!doctype html><meta charset="utf-8"><title>verify</title>${o.body ?? ''}${o.prelude ? `<script>${o.prelude}</script>` : ''}<script${t} src="${o.src}"></script>${o.postlude ? `<script${t}>${o.postlude}</script>` : ''}`;
}
