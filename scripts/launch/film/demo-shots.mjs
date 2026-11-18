// The demo shots (free, made-up data): the lobby glide and the dive, inside the café's office, the all-hands walk and the
// gathering. Needs the web app served with the film camera: `VITE_WORKLINGS_FILM=1 npx vite --port <port>`.
//   FILM_BASE=http://localhost:<port> node demo-shots.mjs <out> land|port
import { chromium, record, sleep, HIDE_HUD } from './lib.mjs';
import { writeFileSync } from 'node:fs';
const [out, orient = 'land'] = process.argv.slice(2);
const land = orient === 'land';
// 2 device pixels a point: 1920 x 1080, labels and bubbles a third bigger than at 1.5. The vertical cut is filmed square
// (960 x 960 points: the lobby draws its worlds only on a wide page) at the same zoom, and the edit keeps its middle 1080 pixels.
const vp = land ? { width: 960, height: 540 } : { width: 960, height: 960 };
const BASE = process.env.FILM_BASE;
if (!BASE) throw new Error('Set FILM_BASE to the address of a film build of the web app.');
const b = await chromium.launch({ args: ['--enable-gpu', '--use-angle=d3d11', '--force-device-scale-factor=2'] });
const ctx = await b.newContext({ viewport: vp, deviceScaleFactor: 2 });
const p = await ctx.newPage();
p.on('pageerror', (e) => console.log('pageerror', e.message));
const film = (stage, call) => p.evaluate(`window.__worklingsFilm.${stage}.${call}`);
const K = (at, target, azimuth, polar, zoom) => ({ at, target, azimuth, polar, zoom: zoom * 0.75 });
const play = (stage, keys, s) => film(stage, `play(${JSON.stringify(keys)}, ${s})`);
const set = (stage, k) => film(stage, `set(${JSON.stringify(k)})`);
const log = {};

// 1 + 2: the lobby glide and the dive into Café Lumen.
await p.goto(`${BASE}/?demo`);
await p.waitForFunction('window.__worklingsFilm?.lobby', null, { timeout: 30000 });
await sleep(3000);
await p.evaluate(HIDE_HUD);
const CAFE = [-13.1, 1.4, -0.7];
const lobbyKeys = [
  K(0, [13, 1.2, 1], 10, 66, 46),
  K(0.45, [0, 1.3, 0.5], 24, 62, 44),
  K(0.78, [-11.5, 1.5, -0.4], 38, 56, 66),
  K(1, CAFE, 44, 50, 118),
];
await set('lobby', lobbyKeys[0]);
await sleep(1500);
let r = await record(p, out, `${orient}-1-lobby`);
r.mark('move');
await p.evaluate(`void window.__worklingsFilm.lobby.play(${JSON.stringify(lobbyKeys)}, 4.8, 'out')`);
await sleep(3300);
r.mark('enter');
await p.evaluate(`[...document.querySelectorAll('.room-sign__button')].find(b => b.textContent.includes('Café Lumen')).click()`);
await sleep(2600);
log.lobby = (await r.stop()).marks;

// 3: inside the café: from above the engineering room, down over the desks.
await p.waitForFunction('window.__worklingsFilm?.office', null, { timeout: 30000 });
await sleep(4000);
await p.evaluate(HIDE_HUD);
const officeKeys = [
  K(0, [-16, 0.8, -4], 40, 24, 34),
  K(0.45, [-15, 0.9, -3], 34, 50, 70),
  K(1, [-6, 0.9, -3.5], 30, 56, 72),
];
await set('office', officeKeys[0]);
await sleep(1500);
r = await record(p, out, `${orient}-3-desks`);
r.mark('move');
await play('office', officeKeys, 5.5);
await sleep(300);
log.desks = (await r.stop()).marks;

// 4 + 5: everyone gets a message; they walk to the meeting room and gather. Sent with the HUD up, filmed without it.
await set('office', K(0, [-4.5, 0.9, -1.2], 24, 60, 52));
await p.evaluate(`document.getElementById('__film_hud')?.remove()`);
await sleep(400);
const box = p.locator('textarea').last();
await box.click();
await box.pressSequentially('@Every');
await sleep(400);
await box.press('Enter');
await box.pressSequentially('Pickup orders ship today. Thank you!');
r = await record(p, out, `${orient}-4-allhands`);
await box.press('Enter');
r.mark('sent');
await p.evaluate(HIDE_HUD);
await p.mouse.move(vp.width - 2, 2);
// Follow the walkers from the desks to the meeting room, then orbit the gathering.
await play('office', [K(0, [-4.5, 0.9, -1.2], 24, 60, 52), K(0.5, [0, 0.9, 3.5], 30, 60, 56), K(1, [3.4, 0.9, 7.6], 36, 58, 64)], 4.6);
r.mark('arrived');
await play('office', [K(0, [3.4, 0.9, 7.6], 36, 58, 64), K(1, [4.0, 1.0, 8.6], 76, 52, 86)], 6);
r.mark('orbit-end');
await sleep(500);
log.allhands = (await r.stop()).marks;
writeFileSync(`${out}/${orient}-demo-marks.json`, JSON.stringify(log, null, 2));
await b.close();
