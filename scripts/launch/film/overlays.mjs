// The film's overlays, set in the office's own type and colours: captions (ink on the cream badge slab, the key words
// on the wordmark's highlighter), the small source labels, the phone's frame, and the end card as an animated clip.
//   node overlays.mjs <out folder> [captions.json]
// captions.json: { "c1": [["Your "], ["Claude Code", 1], ["."]], ... }, a 1 marking the words on the highlighter.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, ff, REPO } from './lib.mjs';

const out = resolve(process.argv[2]);
mkdirSync(out, { recursive: true });
const font = (pkg, file) => pathToFileURL(join(REPO, 'node_modules', '@fontsource', pkg, 'files', file)).href;
const brand = (f) => pathToFileURL(join(REPO, 'docs', 'launch', 'brand', f)).href;
const HEAD = `<meta charset="utf-8"><style>
@font-face { font-family: 'BSC'; font-weight: 600; src: url('${font('barlow-semi-condensed', 'barlow-semi-condensed-latin-600-normal.woff2')}'); }
@font-face { font-family: 'BSC'; font-weight: 700; src: url('${font('barlow-semi-condensed', 'barlow-semi-condensed-latin-700-normal.woff2')}'); }
@font-face { font-family: 'BSC'; font-weight: 800; src: url('${font('barlow-semi-condensed', 'barlow-semi-condensed-latin-800-normal.woff2')}'); }
@font-face { font-family: 'B'; font-weight: 500; src: url('${font('barlow', 'barlow-latin-500-normal.woff2')}'); }
@font-face { font-family: 'B'; font-weight: 600; src: url('${font('barlow', 'barlow-latin-600-normal.woff2')}'); }
@font-face { font-family: 'B'; font-weight: 700; src: url('${font('barlow', 'barlow-latin-700-normal.woff2')}'); }
html, body { margin: 0; background: transparent; }
:root { --ink: #18241f; --ink-soft: #55635c; --cream: #fcfbf7; --note: #f4f1e9; --hl: #f2d541; --mat: #3e5b4e; --grid: #5e7d6f; }
.slab { display: inline-block; background: var(--cream); color: var(--ink); border-radius: 22px; box-shadow: 0 7px 0 rgba(10,24,18,.30), 0 24px 40px -18px rgba(10,24,18,.55); font: 800 var(--size)/1.02 BSC; letter-spacing: -.005em; padding: .2em .42em .24em; white-space: nowrap; }
.hl { background: linear-gradient(transparent 58%, var(--hl) 58%, var(--hl) 92%, transparent 92%); padding: 0 .06em; margin: 0 -.06em; }
.pill { display: inline-flex; align-items: center; gap: .5em; background: rgba(252,251,247,.94); color: var(--ink); border-radius: 999px; padding: .32em .8em .36em .66em; font: 600 var(--size) B; box-shadow: 0 3px 0 rgba(10,24,18,.22); }
.dot { width: .62em; height: .62em; border-radius: 50%; display: inline-block; }
</style>`;

const W16 = { w: 1920, h: 1080 };
const W9 = { w: 1080, h: 1920 };
/** Caption words: [text, highlighted?] pieces. */
const CAPTIONS = JSON.parse(process.argv[3] ? readFileSync(process.argv[3], 'utf8') : JSON.stringify({
  c1: [['Your '], ['Claude Code', 1], ['.']],
  c2: [['Now with an '], ['office', 1], ['.']],
  c3: [['Watch it all '], ['happen', 1], ['.']],
  c4: [['Helpers', 1], [' fan out.']],
  c5: [['Every helper, '], ['priced', 1], ['.']],
  c6: [['Approve from your '], ['phone', 1], ['.']],
  c7: [['Done. '], ['Tests pass', 1], ['.']],
}));
const words = (pieces) => pieces.map(([t, h]) => (h ? `<span class="hl">${t}</span>` : t)).join('');
const PILLS = {
  demo: ['Demo data', '#f2d541'],
  real: ['Real Claude Code run', '#367048'],
  real8: ['Real run, sped up ×8', '#367048'],
  real4: ['Real run, sped up ×4', '#367048'],
  real2: ['Real run, sped up ×2', '#367048'],
};

const pages = {};
for (const [id, pieces] of Object.entries(CAPTIONS)) {
  pages[`${id}-16`] = { ...W16, body: `<div style="position:fixed;left:112px;bottom:118px;--size:96px"><span class="slab">${words(pieces)}</span></div>` };
  // 9:16: the upper third, clear of a feed's top bar; wraps if it must.
  pages[`${id}-9`] = { ...W9, body: `<div style="position:fixed;left:0;right:0;top:300px;text-align:center;--size:104px"><span class="slab" style="white-space:normal;max-width:900px">${words(pieces)}</span></div>` };
}
for (const [id, [text, colour]] of Object.entries(PILLS)) {
  pages[`pill-${id}-16`] = { ...W16, body: `<div style="position:fixed;left:40px;top:36px;--size:26px"><span class="pill"><span class="dot" style="background:${colour}"></span>${text}</span></div>` };
  pages[`pill-${id}-9`] = { ...W9, body: `<div style="position:fixed;left:44px;top:196px;--size:32px"><span class="pill"><span class="dot" style="background:${colour}"></span>${text}</span></div>` };
}
// The phone shot: a dark frame with a transparent screen, 405 x 720 points shown 540 x 960, at the right of the 16:9 frame.
const PH = { x: 1236, y: 60, w: 540, h: 960, r: 54, b: 16 };
pages['phone-frame-16'] = { ...W16, body: `<svg width="1920" height="1080" xmlns="http://www.w3.org/2000/svg"><defs><mask id="m"><rect width="1920" height="1080" fill="#fff"/><rect x="${PH.x}" y="${PH.y}" width="${PH.w}" height="${PH.h}" rx="${PH.r - PH.b}" fill="#000"/></mask><filter id="s" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="18" stdDeviation="22" flood-color="#0a1812" flood-opacity=".55"/></filter></defs><rect x="${PH.x - PH.b}" y="${PH.y - PH.b}" width="${PH.w + 2 * PH.b}" height="${PH.h + 2 * PH.b}" rx="${PH.r}" fill="#0b120e" mask="url(#m)" filter="url(#s)"/></svg>` };
writeFileSync(join(out, 'phone.json'), JSON.stringify(PH));

const browser = await chromium.launch();
for (const [name, p] of Object.entries(pages)) {
  const page = await browser.newPage({ viewport: { width: p.w, height: p.h } });
  const file = join(out, `${name}.html`);
  writeFileSync(file, `<!doctype html>${HEAD}<body>${p.body}</body>`);
  await page.goto(pathToFileURL(file).href);
  await page.evaluate('document.fonts.ready');
  await page.waitForTimeout(150);
  await page.screenshot({ path: join(out, `${name}.png`), omitBackground: true });
  await page.close();
}

// The end card, animated: the Workling pops in, the wordmark and the line follow, then the address and the install
// line. Rendered frame by frame (every animation paused at the frame's time), so it is exact at 60 fps.
const END_S = Number(process.env.END_S ?? 7);
const endCard = (w, h) => {
  const tall = h > w;
  const mascot = tall ? 520 : 400;
  const mark = tall ? 800 : 820;
  return `<div class="card" style="width:${w}px;height:${h}px">
  <div class="stack" style="${tall ? 'flex-direction:column;gap:30px;padding-bottom:240px' : 'gap:64px'}">
    <img class="mascot" src="${brand('mascot-1024.png')}" width="${mascot}" height="${mascot}">
    <div class="text" style="${tall ? 'align-items:center;text-align:center' : ''}">
      <img class="mark" src="${brand('wordmark-light.svg')}" width="${mark}">
      <div class="line" style="--size:${tall ? 74 : 66}px"><span class="slab">Free and <span class="hl">open source</span>.</span></div>
      <div class="repo" style="font-size:${tall ? 44 : 40}px">github.com/zeusstudiodev/worklings</div>
      <div class="install" style="font-size:${tall ? 27 : 27}px">claude plugin marketplace add zeusstudiodev/worklings</div>
    </div>
  </div></div>`;
};
const END_CSS = `<style>
.card { background: var(--note); background-image: linear-gradient(rgba(94,125,111,.13) 1px, transparent 1px), linear-gradient(90deg, rgba(94,125,111,.13) 1px, transparent 1px); background-size: 64px 64px; display: flex; align-items: center; justify-content: center; overflow: hidden; }
.stack { display: flex; align-items: center; }
.text { display: flex; flex-direction: column; gap: 26px; align-items: flex-start; }
.mascot { animation: pop .62s cubic-bezier(.2,.8,.2,1.25) both, bob 2.4s ease-in-out .9s infinite; transform-origin: 50% 90%; filter: drop-shadow(0 18px 18px rgba(10,24,18,.22)); }
.mark { animation: rise .5s cubic-bezier(.2,.8,.2,1) .28s both; }
.line { animation: rise .45s cubic-bezier(.2,.8,.2,1) .62s both; }
.repo { font: 700 1em B; color: var(--ink); animation: rise .45s cubic-bezier(.2,.8,.2,1) 1.0s both; }
.install { font: 500 1em ui-monospace, 'Cascadia Code', Consolas, monospace; color: var(--ink); background: rgba(24,36,31,.07); border: 2px solid rgba(24,36,31,.14); padding: .5em .8em; border-radius: 12px; animation: rise .45s cubic-bezier(.2,.8,.2,1) 1.2s both; }
@keyframes pop { from { transform: scale(.4) rotate(-8deg); opacity: 0 } 60% { opacity: 1 } to { transform: scale(1) rotate(0); opacity: 1 } }
@keyframes bob { 0%,100% { transform: translateY(0) rotate(0) } 50% { transform: translateY(-10px) rotate(1.5deg) } }
@keyframes rise { from { transform: translateY(28px); opacity: 0 } to { transform: none; opacity: 1 } }
* { animation-play-state: paused !important; }
</style>`;
for (const [tag, size] of [['16', W16], ['9', W9]]) {
  const page = await browser.newPage({ viewport: { width: size.w, height: size.h } });
  const file = join(out, `endcard-${tag}.html`);
  writeFileSync(file, `<!doctype html>${HEAD}${END_CSS}<body>${endCard(size.w, size.h)}</body>`);
  await page.goto(pathToFileURL(file).href);
  await page.evaluate('document.fonts.ready');
  await page.waitForTimeout(300);
  const dir = join(out, `endcard-${tag}`);
  mkdirSync(dir, { recursive: true });
  const n = Math.round(END_S * 60);
  for (let i = 0; i < n; i++) {
    const t = i / 60;
    // Node's lint has no DOM: the page's code goes as a string.
    await page.evaluate(`for (const a of document.getAnimations()) a.currentTime = ${t * 1000};`);
    await page.screenshot({ path: join(dir, `${String(i).padStart(5, '0')}.png`) });
  }
  ff(['-framerate', '60', '-i', join(dir, '%05d.png'), '-c:v', 'libx264', '-preset', 'slow', '-crf', '14', '-pix_fmt', 'yuv420p', join(out, `endcard-${tag}.mp4`)], `endcard ${tag}`);
  await page.close();
}
await browser.close();
console.log('overlays done');
