// Renders GitHub's social preview image (1280x640) from an HTML page: the name, one line and a real screenshot of the
// office, set in the office's own fonts and colours (web/src/styles.css).
//
//   node scripts/launch/social-preview.mjs [--shot <screenshot.png>] [--out <image.png>]
//
// Defaults: the screenshot in docs/launch/office-screenshot.png (a 1440x900 capture of the demo company's office) and
// the output docs/launch/social-preview.png. Needs Playwright's Chromium (`npx playwright install chromium`).
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

const TITLE = 'Worklings';
const LINE = 'A company of Claude Code agents you run from a 3D office';
if (LINE.length >= 70) throw new Error('The line must stay under 70 characters.');

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
.copy { position: absolute; left: 64px; top: 0; bottom: 0; width: 480px; display: flex; flex-direction: column; justify-content: center; }
.name { font-family: 'Barlow Semi Condensed', 'Barlow', sans-serif; font-weight: 700; font-size: 112px; line-height: 1; letter-spacing: -1px; }
.name span { background: linear-gradient(transparent 68%, rgba(242,213,65,.85) 68% 92%, transparent 92%); padding: 0 6px; margin: 0 -6px; }
.line { margin-top: 30px; font-weight: 500; font-size: 33px; line-height: 1.28; max-width: 480px; }
.tag { margin-top: 34px; align-self: flex-start; background: var(--badge); color: var(--ink); border: 1px solid var(--badge-line);
  border-radius: 999px; padding: 8px 18px; font-weight: 600; font-size: 21px; }
.shot { position: absolute; left: 560px; top: 62px; width: 740px; height: 516px; border-radius: 22px 0 0 22px; overflow: hidden;
  background: var(--badge); box-shadow: 0 30px 60px -20px rgba(10,24,18,.7), 0 0 0 6px var(--badge); }
.shot img { position: absolute; left: -10px; top: 0; width: 1010px; height: auto; }
</style></head><body>
<div class="copy">
  <div class="name"><span>${TITLE}</span></div>
  <div class="line">${LINE}</div>
  <div class="tag">Free and open source</div>
</div>
<div class="shot"><img src="${dataUri(shot, 'image/png')}" alt=""></div>
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
