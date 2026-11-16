// Renders GitHub's social preview image (1280x640) from an HTML page: the wordmark, the tagline, the Workling and a real
// screenshot of the office, set in the office's own fonts and colours (web/src/styles.css).
//
//   node scripts/launch/social-preview.mjs [--shot <screenshot.png>] [--out <image.png>]
//
// Defaults: the screenshot in docs/launch/office-screenshot.png (a 1440x900 capture of the demo company's office) and
// the output docs/launch/social-preview.png. A new office shot swaps in with --shot and nothing else changes. The
// wordmark and the Workling come from docs/launch/brand (rendered by scripts/launch/brand.mjs). Needs
// Playwright's Chromium (`npx playwright install chromium`).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from '@playwright/test';

const root = fileURLToPath(new URL('../../', import.meta.url));
const { values } = parseArgs({ options: { shot: { type: 'string' }, out: { type: 'string' } } });
const shot = resolve(values.shot ?? `${root}docs/launch/office-screenshot.png`);
const out = resolve(values.out ?? `${root}docs/launch/social-preview.png`);

const dataUri = (file, type) => `data:${type};base64,${readFileSync(file).toString('base64')}`;
const font = (pkg, name) => dataUri(`${root}node_modules/@fontsource/${pkg}/files/${pkg}-latin-${name}-normal.woff2`, 'font/woff2');

const LINE = 'Claude Code, with an office around it.';
if (LINE.length >= 70) throw new Error('The line must stay under 70 characters.');
const brand = `${root}docs/launch/brand`;

// Colours are the office's tokens: --mat, --mat-grid, --badge, --badge-line, --ink, --ink-soft, --highlighter.
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><style>
@font-face { font-family: 'Barlow'; font-weight: 500; src: url(${font('barlow', '500')}) format('woff2'); }
@font-face { font-family: 'Barlow'; font-weight: 600; src: url(${font('barlow', '600')}) format('woff2'); }
@font-face { font-family: 'Barlow Semi Condensed'; font-weight: 600; src: url(${font('barlow-semi-condensed', '600')}) format('woff2'); }
@font-face { font-family: 'Barlow Semi Condensed'; font-weight: 700; src: url(${font('barlow-semi-condensed', '700')}) format('woff2'); }
:root { --mat: #3e5b4e; --mat-grid: #5e7d6f; --badge: #fcfbf7; --badge-line: #e6e2d8; --ink: #18241f; --ink-soft: #55635c; --highlighter: #f2d541; }
* { box-sizing: border-box; margin: 0; }
html, body { width: 1280px; height: 640px; overflow: hidden; }
body {
  position: relative; background: var(--mat); font-family: 'Barlow', system-ui, sans-serif; color: var(--badge);
  background-image:
    linear-gradient(30deg, transparent 49.6%, rgba(94,125,111,.55) 49.6% 50.4%, transparent 50.4%),
    linear-gradient(150deg, transparent 49.6%, rgba(94,125,111,.55) 49.6% 50.4%, transparent 50.4%);
  background-size: 120px 69px;
}
.copy { position: absolute; left: 64px; top: 92px; width: 470px; }
.word { display: block; width: 430px; height: auto; margin-left: -8px; }
.line { margin-top: 26px; font-weight: 600; font-size: 46px; line-height: 1.16; }
.tag { position: absolute; left: 64px; bottom: 64px; background: var(--badge); color: var(--ink); border: 1px solid var(--badge-line);
  border-radius: 999px; padding: 8px 18px; font-weight: 600; font-size: 22px; }
.shot { position: absolute; left: 600px; top: 62px; width: 700px; height: 516px; border-radius: 22px 0 0 22px; overflow: hidden;
  background: var(--badge); box-shadow: 0 30px 60px -20px rgba(10,24,18,.7), 0 0 0 6px var(--badge); }
.shot img { position: absolute; left: -10px; top: 0; width: 1010px; height: auto; }
.mascot { position: absolute; left: 420px; top: 330px; width: 270px; height: 270px; 
  /* A cream sticker edge, so the dark outline lifts off the mat, and a soft shadow under it. */
  filter: drop-shadow(4px 0 0 var(--badge)) drop-shadow(-4px 0 0 var(--badge)) drop-shadow(0 4px 0 var(--badge)) drop-shadow(0 -4px 0 var(--badge)) drop-shadow(0 14px 18px rgba(10,24,18,.45)); }
</style></head><body>
<div class="copy">
  <img class="word" src="${dataUri(`${brand}/wordmark-dark.svg`, 'image/svg+xml')}" alt="">
  <div class="line">${LINE}</div>
</div>
<div class="tag">Free and open source</div>
<div class="shot"><img src="${dataUri(shot, 'image/png')}" alt=""></div>
<img class="mascot" src="${dataUri(`${brand}/mascot-1024.png`, 'image/png')}" alt="">
</body></html>`;

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 640 }, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'load' });
  await page.evaluate('document.fonts.ready');
  await page.screenshot({ path: out, type: 'png' });
  console.log(`Wrote ${out}`);
} finally {
  await browser.close();
}
