// Renders the brand images from their sources: the Workling (docs/launch/brand/workling.svg, original artwork) and the
// wordmark (wordmark-light.svg / wordmark-dark.svg, Barlow Semi Condensed Bold, SIL OFL 1.1, outlined to paths).
//
//   node scripts/launch/brand.mjs [--dir <folder>]
//
// Writes, in docs/launch/brand (or --dir):
// - mascot-1024.png, mascot-512.png, mascot-256.png: the Workling on transparent;
// - avatar-500.png, avatar-256.png: the Workling with a cream sticker edge on the office's mat green, kept inside the
//   middle circle so a round crop loses nothing;
// - logo-light.png (ink type, for light pages) and logo-dark.png (cream type, and the Workling with a cream sticker edge
//   so its dark outline still separates from a dark page), 1520 x 480 on transparent, for the README's <picture>.
// Needs Playwright's Chromium.
/* global document, Image */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from '@playwright/test';

const root = fileURLToPath(new URL('../../', import.meta.url));
const { values } = parseArgs({ options: { dir: { type: 'string' } } });
const dir = resolve(values.dir ?? `${root}docs/launch/brand`);
const dataUri = (file, type) => `data:${type};base64,${readFileSync(file).toString('base64')}`;
const workling = dataUri(`${dir}/workling.svg`, 'image/svg+xml');

/** The office's colours (web/src/scene/palette.ts): the mat and the cream of its badges. */
const MAT = '#3E5B4E';
const CREAM = '#FCFBF7';

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 400, height: 400 } });
  await page.setContent('<!doctype html><html><body></body></html>');

  /**
   * The Workling drawn at `size` px: `scale` of the square, centred, on `bg` (or transparent), with a sticker edge of
   * `edge` (a fraction of the size) when asked. Returns PNG bytes; a canvas writes nothing but pixels.
   */
  const draw = async (size, { scale = 0.92, edge = 0, bg = null } = {}) => {
    const url = await page.evaluate(
      async ({ src, size, scale, edge, bg, cream }) => {
        const img = new Image();
        img.src = src;
        await img.decode();
        const canvas = (px) => {
          const c = document.createElement('canvas');
          c.width = px;
          c.height = px;
          return [c, c.getContext('2d')];
        };
        // Drawn at four times the size and halved twice, so edges stay smooth.
        const big = size * 4;
        const side = big * scale;
        const at = (big - side) / 2;
        const [art, a] = canvas(big);
        a.drawImage(img, at, at, side, side);
        const [out, o] = canvas(big);
        if (bg) {
          o.fillStyle = bg;
          o.fillRect(0, 0, big, big);
        }
        if (edge > 0) {
          const [mask, m] = canvas(big);
          m.drawImage(art, 0, 0);
          m.globalCompositeOperation = 'source-in';
          m.fillStyle = cream;
          m.fillRect(0, 0, big, big);
          const r = edge * big;
          for (let ring = 1; ring <= 4; ring++) {
            for (let i = 0; i < 64; i++) {
              const t = (i / 64) * Math.PI * 2;
              o.drawImage(mask, Math.cos(t) * (r * ring) / 4, Math.sin(t) * (r * ring) / 4);
            }
          }
        }
        o.drawImage(art, 0, 0);
        let src2 = out;
        for (let px = big / 2; px >= size; px /= 2) {
          const [half, h] = canvas(px);
          h.imageSmoothingQuality = 'high';
          h.drawImage(src2, 0, 0, px, px);
          src2 = half;
        }
        return src2.toDataURL('image/png');
      },
      { src: workling, size, scale, edge, bg, cream: CREAM },
    );
    return Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
  };

  for (const px of [1024, 512, 256]) writeFileSync(`${dir}/mascot-${px}.png`, await draw(px));
  // Inside the middle circle: the art's corners (the hat's brim, the mug) stay within a round crop at this scale.
  for (const px of [500, 256]) writeFileSync(`${dir}/avatar-${px}.png`, await draw(px, { scale: 0.82, edge: 0.012, bg: MAT }));

  const plain = `data:image/png;base64,${(await draw(1024)).toString('base64')}`;
  const sticker = `data:image/png;base64,${(await draw(1024, { scale: 0.88, edge: 0.016 })).toString('base64')}`;
  const W = 1520;
  const H = 480;
  const lockup = (mascot, variant) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><style>
* { box-sizing: border-box; margin: 0; }
html, body { width: ${W}px; height: ${H}px; overflow: hidden; background: transparent; }
body { display: flex; align-items: center; gap: 0; padding: 0 16px 0 0; }
.mascot { width: ${H}px; height: ${H}px; flex: none; }
.word { width: 1040px; height: auto; flex: none; margin-top: 36px; }
</style></head><body>
<img class="mascot" src="${mascot}" alt="">
<img class="word" src="${dataUri(`${dir}/wordmark-${variant}.svg`, 'image/svg+xml')}" alt="">
</body></html>`;
  const tab = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  for (const [variant, mascot] of [['light', plain], ['dark', sticker]]) {
    await tab.setContent(lockup(mascot, variant), { waitUntil: 'load' });
    await tab.screenshot({ path: `${dir}/logo-${variant}.png`, type: 'png', omitBackground: true });
  }
  console.log(`Wrote the mascot, the avatars and the logos to ${dir}`);
} finally {
  await browser.close();
}
