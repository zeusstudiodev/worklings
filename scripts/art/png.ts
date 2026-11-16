// A small lossless PNG codec for the packs' gradient atlases: 8-bit RGB or RGBA, not interlaced, which is what KayKit
// ships. Anything else is refused by name. Node's zlib does the compression, so the output is the same bytes on
// every run with the same Node.
import { crc32, deflateSync, inflateSync } from 'node:zlib';

export interface Image {
  width: number;
  height: number;
  /** RGBA, 4 bytes a pixel, rows top to bottom. */
  data: Uint8Array;
}

const SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);

export function decodePng(bytes: Uint8Array, label = 'image'): Image {
  if (!SIGNATURE.every((b, i) => bytes[i] === b)) throw new Error(`${label}: not a PNG`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0;
  let height = 0;
  let channels = 0;
  const idat: Uint8Array[] = [];
  for (let at = 8; at < bytes.length; ) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    const body = bytes.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') {
      width = view.getUint32(at + 8);
      height = view.getUint32(at + 12);
      const [depth, colour, , , interlace] = body.subarray(8, 13);
      if (depth !== 8 || (colour !== 6 && colour !== 2) || interlace !== 0) {
        throw new Error(`${label}: only 8-bit RGB or RGBA PNGs without interlacing are supported (depth ${depth}, colour type ${colour}, interlace ${interlace})`);
      }
      channels = colour === 6 ? 4 : 3;
    } else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    at += 12 + length;
  }
  if (!width || !height || !channels) throw new Error(`${label}: no IHDR chunk`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const rows = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = rows.subarray(y * stride, (y + 1) * stride);
    const up = y > 0 ? rows.subarray((y - 1) * stride, y * stride) : new Uint8Array(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? (out[i - channels] ?? 0) : 0;
      const b = up[i] ?? 0;
      const c = i >= channels ? (up[i - channels] ?? 0) : 0;
      const x = line[i] ?? 0;
      if (filter === 0) out[i] = x;
      else if (filter === 1) out[i] = x + a;
      else if (filter === 2) out[i] = x + b;
      else if (filter === 3) out[i] = x + ((a + b) >> 1);
      else if (filter === 4) out[i] = x + paeth(a, b, c);
      else throw new Error(`${label}: unknown PNG filter ${filter} on row ${y}`);
    }
  }
  const data = new Uint8Array(width * height * 4);
  for (let p = 0; p < width * height; p++) {
    for (let k = 0; k < 3; k++) data[p * 4 + k] = rows[p * channels + k] ?? 0;
    data[p * 4 + 3] = channels === 4 ? (rows[p * channels + 3] ?? 255) : 255;
  }
  return { width, height, data };
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Encodes RGBA, or RGB when every pixel is opaque, choosing each row's filter by the usual smallest-sum rule. */
export function encodePng(image: Image): Uint8Array {
  const { width, height, data } = image;
  let opaque = true;
  for (let p = 3; p < data.length; p += 4) if (data[p] !== 255) opaque = false;
  const channels = opaque ? 3 : 4;
  const stride = width * channels;
  const rows = new Uint8Array(stride * height);
  for (let p = 0; p < width * height; p++) for (let k = 0; k < channels; k++) rows[p * channels + k] = data[p * 4 + k] ?? 0;
  const raw = new Uint8Array((stride + 1) * height);
  const candidate = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const line = rows.subarray(y * stride, (y + 1) * stride);
    const up = y > 0 ? rows.subarray((y - 1) * stride, y * stride) : new Uint8Array(stride);
    let best = 0;
    let bestScore = Number.POSITIVE_INFINITY;
    let bestRow = new Uint8Array(stride);
    for (let filter = 0; filter <= 4; filter++) {
      let score = 0;
      for (let i = 0; i < stride; i++) {
        const a = i >= channels ? (line[i - channels] ?? 0) : 0;
        const b = up[i] ?? 0;
        const c = i >= channels ? (up[i - channels] ?? 0) : 0;
        const x = line[i] ?? 0;
        const predicted = filter === 0 ? 0 : filter === 1 ? a : filter === 2 ? b : filter === 3 ? (a + b) >> 1 : paeth(a, b, c);
        const value = (x - predicted) & 255;
        candidate[i] = value;
        score += value < 128 ? value : 256 - value;
      }
      if (score < bestScore) {
        bestScore = score;
        best = filter;
        bestRow = candidate.slice();
      }
    }
    raw[y * (stride + 1)] = best;
    raw.set(bestRow, y * (stride + 1) + 1);
  }
  const header = new Uint8Array(13);
  const hv = new DataView(header.buffer);
  hv.setUint32(0, width);
  hv.setUint32(4, height);
  header.set([8, opaque ? 2 : 6, 0, 0, 0], 8);
  return concat([SIGNATURE, chunk('IHDR', header), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', new Uint8Array(0))]);
}

function chunk(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + body.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, body.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(body, 8);
  view.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)));
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** Averages each `fx` by `fy` box of pixels into one: an exact downscale by whole factors. */
export function downscale(image: Image, fx: number, fy: number): Image {
  const width = image.width / fx;
  const height = image.height / fy;
  if (!Number.isInteger(width) || !Number.isInteger(height)) throw new Error(`downscale: ${image.width}x${image.height} doesn't divide by ${fx}x${fy}`);
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let k = 0; k < 4; k++) {
        let sum = 0;
        for (let dy = 0; dy < fy; dy++) for (let dx = 0; dx < fx; dx++) sum += image.data[((y * fy + dy) * image.width + x * fx + dx) * 4 + k] ?? 0;
        data[(y * width + x) * 4 + k] = Math.round(sum / (fx * fy));
      }
    }
  }
  return { width, height, data };
}
