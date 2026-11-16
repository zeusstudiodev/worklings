// Renders the Workling mascot: one of the office's own people (a KayKit body in the office's outfit shader and light)
// waving from a little desk with an open laptop, drawn by web/src/launch/mascot.ts in a headless browser.
//
//   node scripts/launch/mascot.mjs [--out <folder>] [--probe]
//
// Writes, in docs/launch/brand (or --out): mascot-1024.png, mascot-512.png (the whole scene, transparent) and
// mascot-avatar-256.png (a square head-and-shoulders crop on the office's mat green, safe for round avatars).
// `--probe` writes the scene in four of the office's hues instead, for choosing. Needs Playwright's Chromium. The art is
// the built GLBs in web/public/art (CC0, CREDITS.md); nothing is downloaded.
/* global window, document, Image */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('../../', import.meta.url));
const { values } = parseArgs({ options: { out: { type: 'string' }, probe: { type: 'boolean' } } });
const out = resolve(values.out ?? `${root}docs/launch/brand`);
mkdirSync(out, { recursive: true });

/** The mascot's look: the office's visitor (the mannequin), in a top of the ops room's orange (palette.ts) and quiet trousers. */
const OUTFIT = {
  skin: '#EDB98F',
  hair: '#4D3626',
  top: '#EE8A43',
  topDark: '#B0662F',
  trousers: '#34405A',
  shoes: '#3A2C25',
  accent: '#C9B98F',
};
const SCENE = {
  body: 'mannequin',
  outfit: OUTFIT,
  hue: '#5B8FC7',
  at: 0.65,
  turn: 0.22,
  camera: { at: [1.3, 2.35, 5.4], look: [0.1, 1.0, -0.3], fov: 34 },
  outline: 0.012,
  outlineColour: '#FCFBF7',
  shadow: 0.22,
  chair: false,
};

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:transparent}</style></head>
<body><script type="module" src="/src/launch/mascot.ts"></script></body></html>`;

const server = await createServer({
  root: `${root}web`,
  configFile: false,
  logLevel: 'error',
  server: { port: 0, host: '127.0.0.1', fs: { allow: [root] } },
  plugins: [
    {
      name: 'mascot-page',
      configureServer(s) {
        s.middlewares.use((req, res, next) => {
          if (req.url !== '/mascot.html') return next();
          res.setHeader('content-type', 'text/html');
          res.end(PAGE);
        });
      },
    },
  ],
});
await server.listen();
const address = server.httpServer?.address();
const port = typeof address === 'object' && address ? address.port : 0;
const browser = await chromium.launch({ args: ['--enable-gpu', '--use-angle=d3d11', '--enable-unsafe-swiftshader'] });

/** One render, as PNG bytes. Settings override the mascot's scene. */
async function render(page, settings) {
  const url = await page.evaluate((o) => window.renderMascot(o), { ...SCENE, ...settings });
  return Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
}

/** Resizes (and crops) a PNG in the page's 2D canvas, with high-quality smoothing; `bg` fills behind it. */
async function resize(page, png, size, crop = null, bg = null) {
  const url = await page.evaluate(
    async ({ src, size, crop, bg }) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = size;
      c.height = size;
      const ctx = c.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      if (bg) {
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, size, size);
      }
      const [x, y, w] = crop ?? [0, 0, img.width];
      // Halve in steps, so a large source doesn't alias.
      let source = img;
      let sw = w;
      let sx = x;
      let sy = y;
      while (sw / 2 >= size) {
        const half = document.createElement('canvas');
        half.width = sw / 2;
        half.height = sw / 2;
        const h = half.getContext('2d');
        h.imageSmoothingQuality = 'high';
        h.drawImage(source, sx, sy, sw, sw, 0, 0, sw / 2, sw / 2);
        source = half;
        sw /= 2;
        sx = 0;
        sy = 0;
      }
      ctx.drawImage(source, sx, sy, sw, sw, 0, 0, size, size);
      return c.toDataURL('image/png');
    },
    { src: `data:image/png;base64,${png.toString('base64')}`, size, crop, bg },
  );
  return Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
}

/** Crops a PNG to a square around what it draws (any pixel more than faintly opaque), with `pad` of room on each side. */
async function bounds(page, png, pad) {
  return page.evaluate(
    async ({ src, pad }) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const { data } = ctx.getImageData(0, 0, img.width, img.height);
      let x0 = img.width;
      let y0 = img.height;
      let x1 = 0;
      let y1 = 0;
      for (let y = 0; y < img.height; y++) {
        for (let x = 0; x < img.width; x++) {
          if (data[(y * img.width + x) * 4 + 3] > 6) {
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
          }
        }
      }
      const side = Math.max(x1 - x0, y1 - y0) * (1 + pad * 2);
      return [Math.round((x0 + x1 - side) / 2), Math.round((y0 + y1 - side) / 2), Math.round(side)];
    },
    { src: `data:image/png;base64,${png.toString('base64')}`, pad },
  );
}

try {
  const page = await browser.newPage({ viewport: { width: 400, height: 400 } });
  page.on('pageerror', (e) => console.error(e));
  await page.goto(`http://127.0.0.1:${port}/mascot.html`);
  await page.waitForFunction(() => typeof window.renderMascot === 'function');
  if (values.probe) {
    // Tops in the office's hues (palette.ts), each with the shade dress.ts would give it.
    const tops = { yellow: ['#F2C94C', '#B3943A'], blue: ['#5B8FC7', '#43699A'], orange: ['#E07F3C', '#A65E2C'], teal: ['#3FA5A0', '#2E7A76'] };
    for (const [name, [top, topDark]] of Object.entries(tops)) {
      const png = await render(page, { outfit: { ...OUTFIT, top, topDark }, px: 1024 });
      writeFileSync(`${out}/probe-${name}.png`, await resize(page, png, 512, await bounds(page, png, 0.04)));
    }
    console.log(`Wrote probes to ${out}`);
  } else {
    const full = await render(page, { px: 3072 });
    const box = await bounds(page, full, 0.04);
    writeFileSync(`${out}/mascot-1024.png`, await resize(page, full, 1024, box));
    writeFileSync(`${out}/mascot-512.png`, await resize(page, full, 512, box));
    // The avatar: the face and the waving hand, from the same shot without the sticker or the floor, centred on the
    // office's mat so a round crop keeps them.
    const bare = await render(page, { px: 3072, outline: 0, shadow: 0 });
    const [x, y, side] = box;
    writeFileSync(`${out}/mascot-avatar-256.png`, await resize(page, bare, 256, [Math.round(x + side * 0.15), Math.round(y - side * 0.06), Math.round(side * 0.7)], '#3E5B4E'));
    console.log(`Wrote the mascot to ${out}`);
  }
} finally {
  await browser.close();
  await server.close();
}
