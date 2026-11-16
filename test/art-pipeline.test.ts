import { deflateSync } from 'node:zlib';
import { BufferAttribute, BufferGeometry, Mesh, MeshBasicMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { decodePng, downscale, encodePng, type Image } from '../scripts/art/png.ts';
import { bakedGeometry, STATIC_ATTRIBUTES } from '../web/src/scene/art/geometry.ts';

const image = (width: number, height: number, pixel: (x: number, y: number) => [number, number, number, number]): Image => {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(pixel(x, y), (y * width + x) * 4);
  return { width, height, data };
};

describe('the atlas PNG codec', () => {
  it('reads back exactly what it wrote, with and without transparency', () => {
    const gradient = image(8, 32, (x, y) => [x * 30, y * 8, 255 - y * 8, 255]);
    const seeThrough = image(5, 3, (x, y) => [x * 50, y * 90, 7, x === 2 ? 0 : 200]);
    for (const original of [gradient, seeThrough]) {
      const back = decodePng(encodePng(original));
      expect([back.width, back.height]).toEqual([original.width, original.height]);
      expect(Buffer.from(back.data).equals(Buffer.from(original.data))).toBe(true);
    }
  });

  it('writes the same bytes every time, as RGB when nothing is transparent', () => {
    const opaque = image(16, 16, (x, y) => [x * 16, y * 16, 128, 255]);
    const first = encodePng(opaque);
    expect(Buffer.from(encodePng(opaque)).equals(Buffer.from(first))).toBe(true);
    expect(first[25]).toBe(2);
    expect(encodePng(image(2, 2, () => [1, 2, 3, 4]))[25]).toBe(6);
  });

  it('refuses what isn’t an 8-bit RGB or RGBA PNG, by name', () => {
    expect(() => decodePng(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]), 'notes.txt')).toThrow('notes.txt: not a PNG');
    const sixteenBit = encodePng(image(1, 1, () => [0, 0, 0, 255]));
    sixteenBit[24] = 16;
    expect(() => decodePng(sixteenBit, 'deep.png')).toThrow(/only 8-bit RGB or RGBA/);
  });

  it('reads every row filter a PNG may use', () => {
    // One row per filter type 0 to 4 over the same pixels, encoded by hand.
    const width = 3;
    const rows = [
      [10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 255],
      [11, 21, 31, 255, 41, 51, 61, 255, 71, 81, 91, 255],
      [12, 22, 32, 255, 42, 52, 62, 255, 72, 82, 92, 255],
      [13, 23, 33, 255, 43, 53, 63, 255, 73, 83, 93, 255],
      [14, 24, 34, 255, 44, 54, 64, 255, 74, 84, 94, 255],
    ];
    const paeth = (a: number, b: number, c: number) => {
      const p = a + b - c;
      const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)];
      return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
    };
    const raw: number[] = [];
    rows.forEach((row, y) => {
      raw.push(y);
      row.forEach((x, i) => {
        const a = i >= 4 ? (row[i - 4] ?? 0) : 0;
        const b = y > 0 ? (rows[y - 1]?.[i] ?? 0) : 0;
        const c = y > 0 && i >= 4 ? (rows[y - 1]?.[i - 4] ?? 0) : 0;
        const predicted = [0, a, b, (a + b) >> 1, paeth(a, b, c)][y] ?? 0;
        raw.push((x - predicted) & 255);
      });
    });
    const png = encodePng(image(width, rows.length, () => [0, 0, 0, 0]));
    const header = png.subarray(0, 33);
    const idat = deflateSync(Uint8Array.from(raw));
    const chunk = new Uint8Array(12 + idat.length);
    new DataView(chunk.buffer).setUint32(0, idat.length);
    chunk.set([73, 68, 65, 84], 4);
    chunk.set(idat, 8);
    const decoded = decodePng(new Uint8Array([...header, ...chunk]));
    expect(Array.from(decoded.data)).toEqual(rows.flat());
  });

  it('downscales by whole factors, averaging each box', () => {
    const small = downscale(image(4, 2, (x) => [x < 2 ? 0 : 200, 100, x * 10, 255]), 2, 2);
    expect([small.width, small.height]).toEqual([2, 1]);
    expect(Array.from(small.data)).toEqual([0, 100, 5, 255, 200, 100, 25, 255]);
    expect(() => downscale(image(3, 2, () => [0, 0, 0, 0]), 2, 2)).toThrow(/doesn't divide/);
  });
});

describe('bakedGeometry', () => {
  it('turns a quantized piece into plain floats in its node’s space, white and indexed', () => {
    const geometry = new BufferGeometry();
    // Positions on a 16-bit grid, as meshopt writes them, undone by the node's scale and offset.
    geometry.setAttribute('position', new BufferAttribute(Int16Array.from([0, 0, 0, 32767, 0, 0, 0, 32767, 0]), 3, true));
    geometry.setAttribute('normal', new BufferAttribute(Int8Array.from([0, 0, 127, 0, 0, 127, 0, 0, 127]), 3, true));
    geometry.setAttribute('uv', new BufferAttribute(Uint16Array.from([0, 0, 65535, 0, 0, 65535]), 2, true));
    geometry.setIndex([0, 1, 2]);
    const mesh = new Mesh(geometry, new MeshBasicMaterial());
    mesh.name = 'table_small';
    mesh.scale.setScalar(2);
    mesh.position.set(1, 0, 0);

    const baked = bakedGeometry(mesh);
    expect(Object.keys(baked.attributes).sort()).toEqual([...STATIC_ATTRIBUTES].sort());
    for (const name of STATIC_ATTRIBUTES) expect(baked.getAttribute(name).array).toBeInstanceOf(Float32Array);
    const position = Array.from(baked.getAttribute('position').array).map((v) => Number(v.toFixed(4)));
    expect(position).toEqual([1, 0, 0, 3, 0, 0, 1, 2, 0]);
    expect(Array.from(baked.getAttribute('normal').array).map((v) => Number(v.toFixed(4)))).toEqual([0, 0, 1, 0, 0, 1, 0, 0, 1]);
    expect(Array.from(baked.getAttribute('uv').array)).toEqual([0, 0, 1, 0, 0, 1]);
    expect(Array.from(baked.getAttribute('color').array)).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1]);
    expect(Array.from(baked.getIndex()?.array ?? [])).toEqual([0, 1, 2]);
  });

  it('takes the baked occlusion as the vertex colour, and white where a piece has none', () => {
    const build = (shade: Uint8Array | null) => {
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3));
      geometry.setAttribute('normal', new BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 3));
      geometry.setAttribute('uv', new BufferAttribute(new Float32Array(6), 2));
      if (shade) geometry.setAttribute('_occlusion', new BufferAttribute(shade, 1, true));
      geometry.setIndex([0, 1, 2]);
      return bakedGeometry(new Mesh(geometry, new MeshBasicMaterial()));
    };
    const shaded = Array.from(build(Uint8Array.from([255, 128, 0])).getAttribute('color').array).map((v) => Number(v.toFixed(2)));
    expect(shaded).toEqual([1, 1, 1, 0.5, 0.5, 0.5, 0, 0, 0]);
    expect(Array.from(build(null).getAttribute('color').array)).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1]);
  });

  it('names the piece when an attribute is missing', () => {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(9), 3));
    const mesh = new Mesh(geometry, new MeshBasicMaterial());
    mesh.name = 'rug_oval_A';
    expect(() => bakedGeometry(mesh)).toThrow('rug_oval_A: no normal attribute');
  });
});
