// Shared bits for the launch film's scripts (docs/launch/film/how-it-was-made.md): Playwright from the repo, ffmpeg
// (which the project doesn't install: it must be on the PATH), a 60 fps screencast recorder and the HUD hidden for 3D shots.
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const require = createRequire(join(REPO, 'package.json'));
export const { chromium } = require('@playwright/test');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export function ff(argv, what = 'ffmpeg') {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...argv], { encoding: 'utf8', maxBuffer: 1 << 26 });
  if (r.status !== 0) throw new Error(`${what}: ${r.stderr}`);
}
export const HIDE_HUD = `(() => { let s = document.getElementById('__film_hud'); if (!s) { s = document.createElement('style'); s.id='__film_hud'; document.head.append(s); }
  s.textContent = 'body *{visibility:hidden !important} canvas[data-engine], .labels, .labels *, #__cursor, #__cursor *{visibility:visible !important} .stage-mini__live{visibility:hidden !important} .name-tag__ask{visibility:hidden !important}'; })()`;
export const SHOW_HUD = `document.getElementById('__film_hud')?.remove()`;
/** A screencast of a page into frames with their own times; stop() writes an mp4 at `fps` (frames held to their times). */
export async function record(page, dir, name, { fps = 60, nth = 1, guard = null } = {}) {
  const fdir = join(dir, 'frames', name);
  mkdirSync(fdir, { recursive: true });
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  const writes = [];
  let stopped = false;
  const t0 = Date.now() / 1000;
  const marks = {};
  const leaks = [];
  cdp.on('Page.screencastFrame', (f) => {
    if (stopped) return;
    const file = `${String(frames.length).padStart(6, '0')}.jpg`;
    frames.push({ file, at: f.metadata.timestamp });
    writes.push(writeFile(join(fdir, file), Buffer.from(f.data, 'base64')));
    cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });
  const vp = page.viewportSize();
  const scale = await page.evaluate('devicePixelRatio');
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, everyNthFrame: nth, maxWidth: Math.round(vp.width * scale), maxHeight: Math.round(vp.height * scale) });
  const g = guard ? setInterval(async () => { try { const text = await page.evaluate('document.body.innerText'); for (const bad of guard) if (bad.test.test(text)) leaks.push(`${name}: ${bad.label}`); } catch { /* the page is between documents */ } }, 300) : null;
  return {
    marks,
    t0,
    mark(label) { marks[label] = Date.now() / 1000 - t0; },
    async stop() {
      if (stopped) return null;
      if (g) clearInterval(g);
      const end = Date.now() / 1000;
      stopped = true;
      await cdp.send('Page.stopScreencast').catch(() => {});
      await Promise.all(writes);
      if (!frames.length) throw new Error(`${name}: no frames`);
      // Frame times relative to t0, so marks (wall clock from t0) line up with the video's time.
      const first = frames[0].at;
      const lead = Math.max(0, first - t0);
      const list = frames.map((f, i) => `file '${f.file}'\nduration ${Math.max(0.001, (frames[i + 1]?.at ?? end) - f.at + (i === 0 ? lead : 0)).toFixed(4)}`).join('\n');
      writeFileSync(join(fdir, 'frames.txt'), `${list}\nfile '${frames.at(-1).file}'\n`);
      const file = join(dir, `${name}.mp4`);
      ff(['-f', 'concat', '-safe', '0', '-i', join(fdir, 'frames.txt'), '-vf', `fps=${fps},scale='2*trunc(iw/2)':'2*trunc(ih/2)',format=yuv420p`, '-c:v', 'libx264', '-preset', 'fast', '-crf', '14', '-an', file], name);
      const gaps = frames.slice(1).map((f, i) => f.at - frames[i].at);
      const stats = { frames: frames.length, seconds: end - t0, meanFps: frames.length / Math.max(0.001, frames.at(-1).at - first), slowGaps: gaps.filter((x) => x > 0.03).length };
      writeFileSync(join(dir, `${name}.json`), JSON.stringify({ marks, stats, leaks: [...new Set(leaks)] }, null, 2));
      if (leaks.length) throw new Error(`Something private showed in ${name}: ${[...new Set(leaks)].join('; ')}`);
      return { file, marks, stats };
    },
  };
}
