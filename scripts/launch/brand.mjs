// Composes the logo lockups: the mascot (scripts/launch/mascot.mjs) beside the wordmark, in a light and a dark
// variant with transparent backgrounds, for the README's header (a <picture> picks one by the reader's colour scheme).
//
//   node scripts/launch/brand.mjs [--dir <folder>]
//
// Reads mascot-1024.png and wordmark-light.svg / wordmark-dark.svg from docs/launch/brand (or --dir) and writes
// logo-light.png (ink type, for light pages) and logo-dark.png (cream type, for dark pages) there, 1520 x 480. The
// wordmark is Barlow Semi Condensed Bold (SIL OFL 1.1), the office's display type, outlined to paths. Needs Playwright's
// Chromium.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from '@playwright/test';

const root = fileURLToPath(new URL('../../', import.meta.url));
const { values } = parseArgs({ options: { dir: { type: 'string' } } });
const dir = resolve(values.dir ?? `${root}docs/launch/brand`);
const dataUri = (file, type) => `data:${type};base64,${readFileSync(file).toString('base64')}`;

const W = 1520;
const H = 480;
const page = (variant) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><style>
* { box-sizing: border-box; margin: 0; }
html, body { width: ${W}px; height: ${H}px; overflow: hidden; background: transparent; }
body { display: flex; align-items: center; gap: 0; padding: 0 16px 0 0; }
.mascot { width: ${H}px; height: ${H}px; flex: none; }
.word { width: 1040px; height: auto; flex: none; margin-top: 36px; }
</style></head><body>
<img class="mascot" src="${dataUri(`${dir}/mascot-1024.png`, 'image/png')}" alt="">
<img class="word" src="${dataUri(`${dir}/wordmark-${variant}.svg`, 'image/svg+xml')}" alt="">
</body></html>`;

const browser = await chromium.launch();
try {
  const tab = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  for (const variant of ['light', 'dark']) {
    await tab.setContent(page(variant), { waitUntil: 'load' });
    await tab.screenshot({ path: `${dir}/logo-${variant}.png`, type: 'png', omitBackground: true });
  }
  console.log(`Wrote logo-light.png and logo-dark.png to ${dir}`);
} finally {
  await browser.close();
}
