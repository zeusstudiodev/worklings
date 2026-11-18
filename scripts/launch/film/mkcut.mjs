// The 0.3 film's cut lists: the same edit for 16:9 and 9:16, on the track's 174 BPM beat grid (b = 60 / 174 s). The
// sources and their times are this film's: the helpers and their costs from take 5; the phone, the desktop's answer and the
// result from take 4 (director.mjs's marks), the 3D demo shots from demo-shots.mjs. A new film starts from a copy.
//   node mkcut.mjs --takes <folder with take4 and take5> --demo <demo shots folder> --overlays <overlays folder>
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

const { values: o } = parseArgs({ options: { takes: { type: 'string' }, demo: { type: 'string' }, overlays: { type: 'string' } } });
const slash = (p) => resolve(p).split(String.fromCharCode(92)).join('/');
const T4 = `${slash(o.takes)}/take4`;
const T5 = `${slash(o.takes)}/take5`;
const b = 60 / 174;
const D = (tag) => `${slash(o.demo)}/${tag === '16' ? 'land' : 'port'}`;
// Take 5: the board started at A's 'helpers' mark (32.86). Take 4: D tap 4.03, G tap 4.08.
const C0 = 32.86, D_TAP = 4.03, G_TAP = 4.08;
// The vertical demo shots are filmed square (the lobby draws its worlds only on a wide page): their middle 1080 pixels.
const mid = (v) => (v ? { crop: [420, 0, 1080, 1920] } : {});
function cut(tag) {
  const v = tag === '9';
  const seg = [];
  seg.push({ kind: 'plain', src: `${D(tag)}-1-lobby.mp4`, from: 0.0, dur: 11 * b, pill: 'demo', note: 'Lobby glide and the dive into Cafe Lumen', ...mid(v) });
  seg.push({ kind: 'plain', src: `${D(tag)}-3-desks.mp4`, from: 1.0, dur: 10 * b, pill: 'demo', note: 'Inside the office: design and engineering at their desks', ...mid(v) });
  seg.push({ kind: 'plain', src: `${D(tag)}-4-allhands.mp4`, from: 1.5, dur: 8 * b, pill: 'demo', note: 'A message to everyone: they walk to the meeting room', ...mid(v) });
  seg.push({ kind: 'plain', src: `${D(tag)}-4-allhands.mp4`, from: 6.2, dur: 6 * b, pill: 'demo', note: 'The gathering', ...mid(v) });
  seg.push({ kind: 'plain', src: v ? `${T5}/B-desk-9x16.mp4` : `${T5}/A-desk.mp4`, from: 34.4, dur: 8 * b, pill: 'real', note: 'Three helpers walk over to Claude Code’s desk' });
  if (v) seg.push({ kind: 'plain', src: `${T5}/C-board.mp4`, from: 37.37 - C0, dur: 8 * b, pill: 'real', note: 'The task board: each helper’s live cost' });
  else seg.push({ kind: 'cost', bg: `${T5}/A-desk.mp4`, bgFrom: 37.37, dur: 8 * b, pill: 'real', card: `${T5}/C-board.mp4`, cardFrom: 37.37 - C0, cardCrop: [44, 880, 992, 640], cardSize: [660, 426], cardAt: [1230, 56], note: 'The push in, with each helper’s live cost from the task board' });
  const before = 7 * b;
  if (!v) {
    seg.push({ kind: 'phone', src: `${T4}/D-phone.mp4`, from: D_TAP - before, dur: 12 * b, pill: 'real', box: `${T4}/G-desktop.mp4`, boxFrom: G_TAP - before, boxCrop: [0, 0, 2100, 1181], boxSize: [1060, 596], boxAt: [96, 150], note: 'The npm test prompt on a phone, Allow once; the desktop answers' });
  } else {
    // Vertical: the phone fills the frame, and its own office and card answer the tap.
    seg.push({ kind: 'plain', src: `${T4}/D-phone.mp4`, from: D_TAP - before, dur: 12 * b, pill: 'real', note: 'The npm test prompt on a phone, Allow once' });
  }
  seg.push(v
    ? { kind: 'boxed', box: `${T4}/E-result.mp4`, boxFrom: 0.8, boxCrop: [440, 560, 1180, 965], boxCropTo: [500, 630, 1050, 859], boxSize: [1000, 818], boxAt: [40, 640], dur: 8 * b, pill: 'real', note: 'Claude Code’s last words' }
    : { kind: 'plain', src: `${T4}/E-result.mp4`, from: 0.8, dur: 8 * b, pill: 'real', crop: [200, 300, 2000, 1125], cropTo: [440, 600, 1680, 945], note: 'Claude Code’s last words' });
  seg.push({ kind: 'end', src: `${slash(o.overlays)}/endcard-${tag}.mp4`, from: 0, dur: 16 * b, note: 'End card' });
  const at = (n) => n * b;
  const captions = [
    { id: 'c1', at: 0.12, end: at(4) - 0.04 },
    { id: 'c2', at: at(4), end: at(11) - 0.06 },
    { id: 'c3', at: at(11), end: at(21) - 0.06 },
    { id: 'c4', at: at(35), end: at(43) - 0.06 },
    { id: 'c5', at: at(43), end: at(51) - 0.06 },
    { id: 'c6', at: at(51), end: at(63) - 0.06 },
    { id: 'c7', at: at(63), end: at(71) - 0.06 },
  ];
  return { w: v ? 1080 : 1920, h: v ? 1920 : 1080, tag, segments: seg, captions };
}
writeFileSync('cut16.json', JSON.stringify(cut('16'), null, 1));
writeFileSync('cut9.json', JSON.stringify(cut('9'), null, 1));
console.log('beat', b.toFixed(4), 'length', (87 * b).toFixed(2));
