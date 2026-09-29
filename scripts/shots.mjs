#!/usr/bin/env node
// Screenshot every step of a lesson (or one page) with headless Chrome.
//
//   node scripts/shots.mjs <url> [outDir] [--width=1440] [--height=900] [--wait=3500] [--steps] [--only=step-id]
//
// --steps   walk the whole lesson with the → key, one PNG per step
// Prints console errors and page errors at the end. Needs Google Chrome
// (or set CHROME_PATH).
import { existsSync, mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith('--'));
const outDir = args.filter((a) => !a.startsWith('--'))[1] ?? 'shots';
const opt = (k, d) => (args.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split('=').slice(1).join('=');
const width = +opt('width', 1440);
const height = +opt('height', 900);
const wait = +opt('wait', 3500);
const walk = args.includes('--steps');
if (!url) {
  console.error('usage: node scripts/shots.mjs <url> [outDir] [--steps] [--width=] [--height=] [--wait=]');
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

const chromes = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? chromes.find((p) => existsSync(p)) ?? chromes[0],
  headless: 'new',
  args: ['--no-sandbox', '--hide-scrollbars'],
});
const page = await browser.newPage();
await page.setViewport({ width, height, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => ['error', 'warn', 'warning'].includes(m.type()) && logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(url, { waitUntil: 'networkidle2', timeout: 120000 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tag = `${width}x${height}`;

if (!walk) {
  await sleep(wait);
  const file = `${outDir}/page-${tag}.png`;
  await page.screenshot({ path: file });
  console.log(file);
} else {
  const seen = new Set();
  for (let i = 0; i < 80; i++) {
    await sleep(wait);
    const hash = await page.evaluate(() => location.hash.slice(1) || 'first');
    if (seen.has(hash)) break;
    seen.add(hash);
    const file = `${outDir}/${String(i + 1).padStart(2, '0')}-${hash}-${tag}.png`;
    await page.screenshot({ path: file });
    console.log(file);
    await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
    await page.keyboard.press('ArrowRight');
  }
}
console.log(logs.length ? `\n${logs.join('\n')}` : '\nno console errors');
await browser.close();
