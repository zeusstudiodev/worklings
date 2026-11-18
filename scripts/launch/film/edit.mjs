// The v0.9 film's edit: a cut list (JSON) into one film, 60 fps, with its captions and source labels; with --music, the
// track laid under it from a given point.
//   node edit.mjs <cut.json> <overlays folder> <out.mp4> [--music <file> --music-from <s>]
// cut.json: { "w": 1920, "h": 1080, "tag": "16", "segments": [...], "captions": [{ "id": "c1", "at": 0.15, "end": 1.3 }] }
// A segment: { "kind": "plain" | "phone" | "cost" | "end", "src": file, "from": s, "dur": s on screen, "speed": 1,
//   "crop": [x, y, w, h] (source pixels, before scaling; may move over the shot with "cropTo"), "pill": "demo" | ... ,
//   and for phone and cost shots: "bg", "bgFrom", "bgCrop" and "card", "cardFrom", "cardCrop" }.
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { ff } from './lib.mjs';

const { values: o, positionals } = parseArgs({ allowPositionals: true, options: { music: { type: 'string' }, 'music-from': { type: 'string', default: '0' }, keep: { type: 'boolean' } } });
const [cutFile, overlays, outFile] = positionals.map((p) => resolve(p));
const cut = JSON.parse(readFileSync(cutFile, 'utf8'));
const { w: W, h: H, tag } = cut;
const FPS = 60;
const work = join(dirname(outFile), `.work-${tag}`);
mkdirSync(work, { recursive: true });
const ov = (n) => join(overlays, `${n}.png`);
const PH = JSON.parse(readFileSync(join(overlays, 'phone.json'), 'utf8'));
const f3 = (n) => Number(n).toFixed(3);

/** An alpha expression for a w x h box with rounded corners of radius r, inset by `pad` inside a larger canvas. */
function roundAlpha(w, h, r, pad = 0) {
  const cx = `(X-${pad}-${w}/2)`;
  const cy = `(Y-${pad}-${h}/2)`;
  const dx = `(abs(${cx})-${w}/2+${r})`;
  const dy = `(abs(${cy})-${h}/2+${r})`;
  return `if(gt(abs(${cx}),${w}/2)+gt(abs(${cy}),${h}/2),0,if(gt(${dx},0)*gt(${dy},0)*gt(hypot(${dx},${dy}),${r}),0,255))`;
}

/** A source cut to `dur` seconds on screen from `from`, at `speed`, cropped (optionally moving) and scaled to w x h. */
function shot(input, { from, dur, speed = 1, crop, cropTo }, w, h, label) {
  const span = dur * speed;
  const parts = [`[${input}:v]trim=start=${f3(from)}:end=${f3(from + span)},setpts=(PTS-STARTPTS)/${speed},fps=${FPS}`];
  if (crop && cropTo) {
    // A move: scaled each frame so the moving box fills w x h, then cut at the box's place (both eased, smoothstep).
    const [x0, y0, cw0] = crop;
    const [x1, y1, cw1] = cropTo;
    const u = `min(1,t/${f3(dur)})`;
    const e = `(${u}*${u}*(3-2*${u}))`;
    const S = `(${w}/(${cw0}+(${cw1 - cw0})*${e}))`;
    parts.push(`scale=w='2*trunc(iw*${S}/2)':h='2*trunc(ih*${S}/2)':eval=frame:flags=bicubic`);
    parts.push(`crop=${w}:${h}:x='(${x0}+(${x1 - x0})*${e})*${S}':y='(${y0}+(${y1 - y0})*${e})*${S}'`);
  } else if (crop) {
    parts.push(`crop=${crop[2]}:${crop[3]}:${crop[0]}:${crop[1]}`);
  }
  parts.push(`scale=${w}:${h}:flags=lanczos,setsar=1`);
  return `${parts.join(',')}[${label}]`;
}

const segFiles = [];
let at = 0;
const timeline = [];
cut.segments.forEach((s, i) => {
  const file = join(work, `seg${String(i).padStart(2, '0')}.mp4`);
  const inputs = [];
  const filters = [];
  const add = (path, extra = []) => {
    inputs.push(...extra, '-i', path);
    return inputs.filter((x) => x === '-i').length - 1;
  };
  let last;
  if (s.kind === 'end') {
    const n = add(s.src);
    filters.push(`[${n}:v]trim=start=${f3(s.from ?? 0)}:end=${f3((s.from ?? 0) + s.dur)},setpts=PTS-STARTPTS,fps=${FPS},scale=${W}:${H},setsar=1[v]`);
    last = 'v';
  } else if (s.kind === 'plain') {
    const n = add(s.src);
    filters.push(shot(n, s, W, H, 'v'));
    last = 'v';
  } else if (s.kind === 'phone' || s.kind === 'boxed') {
    // The mat with its grid, the desktop in a rounded box with a shadow, and (phone) the phone in its frame.
    filters.push(`color=c=0x3e5b4e:s=${W}x${H}:r=${FPS}:d=${f3(s.dur)},drawgrid=w=96:h=96:t=2:c=0x5e7d6f@0.55[mat]`);
    const box = add(s.box ?? s.bg);
    const [bw, bh] = s.boxSize;
    filters.push(shot(box, { from: s.boxFrom ?? s.bgFrom, dur: s.dur, speed: 1, crop: s.boxCrop, cropTo: s.boxCropTo }, bw, bh, 'bx'));
    filters.push(`[bx]format=yuva420p,geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='${roundAlpha(bw, bh, 26)}'[bxr]`);
    filters.push(`color=c=black@0.0:s=${bw + 120}x${bh + 120}:r=${FPS}:d=${f3(s.dur)},format=yuva420p,geq=lum=0:cb=128:cr=128:a='${roundAlpha(bw, bh, 26, 60)}*0.5',boxblur=26:2[sh]`);
    filters.push(`[mat][sh]overlay=${s.boxAt[0] - 60}:${s.boxAt[1] - 60 + 16}:shortest=1[m1]`, `[m1][bxr]overlay=${s.boxAt[0]}:${s.boxAt[1]}:shortest=1[m2]`);
    if (s.kind === 'phone') {
      const ph = add(s.src);
      filters.push(shot(ph, { from: s.from, dur: s.dur, speed: 1, crop: s.crop }, PH.w, PH.h, 'ph'));
      const fr = add(ov('phone-frame-16'), ['-loop', '1', '-framerate', String(FPS), '-t', f3(s.dur)]);
      filters.push(`[m2][ph]overlay=${PH.x}:${PH.y}:shortest=1[m3]`, `[m3][${fr}:v]overlay=0:0:shortest=1[v]`);
    } else filters.push('[m2]null[v]');
    last = 'v';
  } else if (s.kind === 'cost') {
    const bg = add(s.bg ?? s.src);
    const card = add(s.card);
    filters.push(shot(bg, { from: s.bgFrom ?? s.from, dur: s.dur, speed: s.speed ?? 1, crop: s.bgCrop, cropTo: s.bgCropTo }, W, H, 'bg'));
    const [cw, ch] = s.cardSize;
    filters.push(shot(card, { from: s.cardFrom, dur: s.dur, speed: s.cardSpeed ?? s.speed ?? 1, crop: s.cardCrop }, cw, ch, 'cd'));
    // Rounded corners and a soft shadow, drawn with geq on the card's alpha.
    filters.push(`[cd]format=yuva420p,geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='${roundAlpha(cw, ch, 22)}'[cr]`);
    filters.push(`[bg][cr]overlay=${s.cardAt[0]}:${s.cardAt[1]}:shortest=1[v]`);
    last = 'v';
  } else throw new Error(`Unknown kind ${s.kind}`);
  if (s.pill) {
    const pl = add(ov(`pill-${s.pill}-${tag}`), ['-loop', '1', '-framerate', String(FPS), '-t', f3(s.dur)]);
    filters.push(`[${last}][${pl}:v]overlay=0:0:shortest=1[vp]`);
    last = 'vp';
  }
  filters.push(`[${last}]format=yuv420p[out]`);
  ff([...inputs, '-filter_complex', filters.join(';'), '-map', '[out]', '-t', f3(s.dur), '-r', String(FPS), '-c:v', 'libx264', '-preset', 'medium', '-crf', '14', '-pix_fmt', 'yuv420p', '-an', file], `segment ${i}`);
  segFiles.push(file);
  timeline.push({ at: Number(at.toFixed(3)), dur: s.dur, kind: s.kind, src: (s.src ?? '').split(/[\\/]/).pop(), from: s.from, speed: s.speed ?? 1, pill: s.pill ?? null, note: s.note ?? '' });
  at += s.dur;
});
const list = join(work, 'list.txt');
writeFileSync(list, segFiles.map((f) => `file '${f.replace(/\\/g, '/')}'`).join('\n'));
const body = join(work, 'body.mp4');
ff(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', body], 'concat');

// Captions: each slab rises 28 px and fades in over 0.2 s, and fades out in 0.12 s.
const inputs = ['-i', body];
const filters = [];
let last = '0:v';
cut.captions.forEach((c, i) => {
  inputs.push('-loop', '1', '-framerate', String(FPS), '-t', f3(at), '-i', ov(`${c.id}-${tag}`));
  const n = i + 1;
  filters.push(`[${n}:v]format=rgba,fade=t=in:st=${f3(c.at)}:d=0.2:alpha=1,fade=t=out:st=${f3(c.end - 0.12)}:d=0.12:alpha=1[c${n}]`);
  filters.push(`[${last}][c${n}]overlay=x=0:y='if(lt(t,${f3(c.at + 0.24)}),28*pow(1-max(0,t-${f3(c.at)})/0.24,2),0)':enable='between(t,${f3(c.at)},${f3(c.end)})':eval=frame[o${n}]`);
  last = `o${n}`;
});
filters.push(`[${last}]format=yuv420p[final]`);
const args = [...inputs];
if (o.music) args.push('-ss', o['music-from'], '-i', resolve(o.music));
const mapAudio = o.music ? ['-map', `${cut.captions.length + 1}:a`, '-af', `atrim=0:${f3(at)},afade=t=in:st=0:d=0.05,afade=t=out:st=${f3(at - 1.6)}:d=1.6,loudnorm=I=-14:TP=-1.0:LRA=11`, '-c:a', 'aac', '-b:a', '192k', '-ar', '48000'] : ['-an'];
ff([...args, '-filter_complex', filters.join(';'), '-map', '[final]', ...mapAudio, '-t', f3(at), '-r', String(FPS), '-c:v', 'libx264', '-preset', 'slow', '-crf', String(cut.crf ?? 18), '-pix_fmt', 'yuv420p', '-movflags', '+faststart', outFile], 'final');
writeFileSync(outFile.replace(/\.mp4$/, '.timeline.json'), JSON.stringify({ length: Number(at.toFixed(3)), timeline, captions: cut.captions }, null, 2));
console.log(`${outFile}: ${at.toFixed(2)} s, ${(statSync(outFile).size / 1e6).toFixed(1)} MB`);
