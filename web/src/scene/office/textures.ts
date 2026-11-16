// The small textures the office draws for itself on canvases, so nothing else is downloaded: what screens show, each
// theme's floor pattern in its own colours, and a soft round gradient for light pools and halos. Each is drawn once
// and kept for the session; a floor is a few kilobytes.
import { CanvasTexture, LinearFilter, LinearMipmapLinearFilter, RepeatWrapping, SRGBColorSpace, type Texture } from 'three';
import type { ArtPack } from '../../../../src/core/themes.ts';
import type { Textures } from './build.ts';
import { mixHex, shadeHex, tintHex } from './colour.ts';
import { type Floor, floorKey } from './style.ts';

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (!g) throw new Error('no 2D canvas context for the office textures');
  return [c, g];
}

/** A seeded generator, so every texture comes out the same each time it is drawn. */
function random(seed: number): () => number {
  let s = seed % 2147483647 || 7;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/** Eight 128 px tiles: code, a terminal, artwork, a page layout, test runs, progress bars, charts, plain white. */
function screenAtlas(): Texture {
  const rnd = random(7);
  const T = 128;
  const [c, g] = canvas(T * 8, T);
  const tile = (i: number, bg: string, draw: (x: number) => void) => {
    g.fillStyle = bg;
    g.fillRect(i * T, 0, T, T);
    draw(i * T);
  };
  const code = (x: number, palette: readonly string[], terminal: boolean) => {
    g.fillStyle = terminal ? '#1A2A24' : '#232B3A';
    g.fillRect(x, 0, T, 14);
    ['#E8706A', '#F2C14E', '#7CD38A'].forEach((col, k) => {
      g.fillStyle = col;
      g.beginPath();
      g.arc(x + 9 + k * 9, 7, 3, 0, Math.PI * 2);
      g.fill();
    });
    let y = 22;
    while (y < T - 6) {
      let cx = x + 10 + (terminal ? 0 : 14) + Math.floor(rnd() * 4) * 8;
      if (!terminal) {
        g.fillStyle = '#3B4658';
        g.fillRect(x + 6, y, 8, 4);
      }
      const words = 1 + Math.floor(rnd() * 4);
      for (let w = 0; w < words && cx < x + T - 10; w++) {
        const len = 6 + Math.floor(rnd() * 22);
        g.fillStyle = palette[Math.floor(rnd() * palette.length)] ?? '#C9D1E0';
        g.fillRect(cx, y, Math.min(len, x + T - 8 - cx), 4);
        cx += len + 4;
      }
      y += 8 + (rnd() < 0.15 ? 6 : 0);
    }
  };
  tile(0, '#1B2230', (x) => code(x, ['#7FD1F6', '#F6A5C0', '#F2D57E', '#A6E3A1', '#C9D1E0'], false));
  tile(1, '#14201B', (x) => code(x, ['#8EF0B0', '#8EF0B0', '#D6F5E2', '#F2D57E'], true));
  const art = (x: number) => {
    g.fillStyle = '#E6DFD5';
    g.fillRect(x, 0, 16, T);
    g.fillRect(x + T - 26, 0, 26, T);
    ['#E58FA0', '#5B8FC7', '#F2D541', '#6FAE6A', '#8E7CC3', '#E9A36B'].forEach((col, k) => {
      g.fillStyle = col;
      g.fillRect(x + 4, 8 + k * 14, 8, 8);
      g.fillStyle = '#CFC6B8';
      g.fillRect(x + T - 22, 10 + k * 12, 18, 6);
    });
  };
  tile(2, '#FBF7F0', (x) => {
    art(x);
    for (const [col, cx, cy, r] of [['#F6B3C1', 50, 44, 20], ['#9EC3EA', 74, 70, 18], ['#F2D57E', 46, 92, 12]] as const) {
      g.fillStyle = col;
      g.beginPath();
      g.arc(x + cx, cy, r, 0, Math.PI * 2);
      g.fill();
    }
  });
  tile(3, '#FBF7F0', (x) => {
    art(x);
    g.fillStyle = '#2B3340';
    g.fillRect(x + 40, 18, 46, 92);
    g.fillStyle = '#FDE7EC';
    g.fillRect(x + 44, 26, 38, 76);
    g.fillStyle = '#E58FA0';
    g.fillRect(x + 48, 32, 30, 20);
    g.fillStyle = '#CFC6B8';
    for (let k = 0; k < 4; k++) g.fillRect(x + 48, 58 + k * 9, 30 - k * 5, 5);
  });
  tile(4, '#18211D', (x) => {
    for (let k = 0; k < 11; k++) {
      const fail = k === 6;
      g.fillStyle = fail ? '#F07070' : '#7CDB8E';
      g.fillRect(x + 8, 10 + k * 10, 6, 6);
      g.fillStyle = fail ? '#F3B0A8' : '#B9CFC2';
      g.fillRect(x + 20, 11 + k * 10, 30 + ((k * 37) % 60), 4);
    }
  });
  tile(5, '#18211D', (x) => {
    for (let k = 0; k < 6; k++) {
      g.fillStyle = '#2C3A33';
      g.fillRect(x + 10, 14 + k * 18, T - 20, 8);
      g.fillStyle = k === 4 ? '#F2C14E' : '#7CDB8E';
      g.fillRect(x + 10, 14 + k * 18, (T - 20) * (k === 4 ? 0.55 : 1 - k * 0.05), 8);
    }
  });
  tile(6, '#F7F4EE', (x) => {
    g.fillStyle = '#8E7CC3';
    g.fillRect(x + 10, 10, 70, 8);
    ['#5B8FC7', '#E58FA0', '#6FAE6A', '#5B8FC7', '#E58FA0', '#6FAE6A'].forEach((col, k) => {
      g.fillStyle = col;
      const h = 20 + ((k * 23) % 50);
      g.fillRect(x + 14 + k * 17, T - 14 - h, 11, h);
    });
  });
  tile(7, '#FFFFFF', () => {});
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  // UVs count down from the top, as the packs' glTF atlases do.
  t.flipY = false;
  t.minFilter = LinearMipmapLinearFilter;
  t.anisotropy = 4;
  return t;
}

/** A theme's floor in its two colours; rooms multiply it by their tint. Repeats every 3.2 units (checks: 1.8). */
function floorTexture(floor: Floor): Texture {
  const S = 256;
  const [c, g] = canvas(S, S);
  const rnd = random(floorKey(floor).length * 131 + floor.colour.charCodeAt(2) * 7);
  const { colour, second } = floor;
  g.fillStyle = colour;
  g.fillRect(0, 0, S, S);
  const speckle = (n: number, alpha: number, light = false) => {
    for (let p = 0; p < n; p++) {
      g.fillStyle = light ? `rgba(255,255,255,${alpha * rnd()})` : `rgba(0,0,0,${alpha * rnd()})`;
      g.fillRect(rnd() * S, rnd() * S, 1.5, 1.5);
    }
  };
  const planks = (rows: number, length: number, grain: boolean) => {
    const h = S / rows;
    for (let r = 0; r < rows; r++) {
      const shift = ((r * 97) % 5) * (length / 5);
      for (let x = -shift; x < S; x += length) {
        g.fillStyle = mixHex(colour, second, rnd() * 0.7);
        g.fillRect(x, r * h, length, h);
        if (grain) {
          g.fillStyle = 'rgba(0,0,0,0.05)';
          for (let k = 0; k < 3; k++) g.fillRect(x + rnd() * length, r * h + 3 + rnd() * (h - 6), 18 + rnd() * 40, 1);
        }
        g.fillStyle = 'rgba(0,0,0,0.16)';
        g.fillRect(x, r * h, 2, h);
      }
      g.fillStyle = 'rgba(0,0,0,0.2)';
      g.fillRect(0, r * h, S, 2);
    }
  };
  switch (floor.pattern) {
    case 'carpet-tiles': {
      const n = 4;
      const s = S / n;
      for (let i = 0; i < n; i++) {
        for (let k = 0; k < n; k++) {
          g.fillStyle = (i + k) % 2 ? mixHex(colour, second, 0.55) : colour;
          g.fillRect(i * s, k * s, s, s);
        }
      }
      speckle(3000, 0.06);
      break;
    }
    case 'checks': {
      const n = 2;
      const s = S / n;
      for (let i = 0; i < n; i++) {
        for (let k = 0; k < n; k++) {
          g.fillStyle = (i + k) % 2 ? second : colour;
          g.fillRect(i * s, k * s, s, s);
        }
      }
      g.fillStyle = 'rgba(128,128,128,0.25)';
      for (let i = 0; i <= n; i++) {
        g.fillRect(i * s - 1, 0, 2, S);
        g.fillRect(0, i * s - 1, S, 2);
      }
      break;
    }
    case 'boards':
      planks(8, 150, false);
      break;
    case 'dark-wood':
      planks(8, 120, true);
      speckle(800, 0.08, true);
      break;
    case 'oak':
      planks(6, 200, true);
      break;
    case 'tiles': {
      const n = 4;
      const s = S / n;
      g.fillStyle = second;
      for (let i = 0; i <= n; i++) {
        g.fillRect(i * s - 1.5, 0, 3, S);
        g.fillRect(0, i * s - 1.5, S, 3);
      }
      break;
    }
    case 'grass': {
      for (let p = 0; p < 2600; p++) {
        g.fillStyle = rnd() < 0.5 ? shadeHex(colour, 0.1 + rnd() * 0.12) : tintHex(colour, 0.08 + rnd() * 0.12);
        const x = rnd() * S;
        const y = rnd() * S;
        g.fillRect(x, y, 1.5, 3 + rnd() * 4);
      }
      break;
    }
    case 'street': {
      // Paving slabs in running bond.
      const rows = 4;
      const h = S / rows;
      const w = S / 2;
      g.fillStyle = second;
      g.fillRect(0, 0, S, S);
      for (let r = 0; r < rows; r++) {
        const shift = r % 2 ? w / 2 : 0;
        for (let x = -shift; x < S; x += w) {
          g.fillStyle = mixHex(colour, second, rnd() * 0.25);
          g.fillRect(x + 2, r * h + 2, w - 4, h - 4);
        }
      }
      speckle(1500, 0.07);
      break;
    }
    case 'stars': {
      speckle(1600, 0.1);
      for (let p = 0; p < 26; p++) {
        const x = rnd() * S;
        const y = rnd() * S;
        const r = 2 + rnd() * 4;
        g.fillStyle = rnd() < 0.3 ? '#F2D27A' : second;
        g.beginPath();
        for (let k = 0; k < 10; k++) {
          const a = (k / 10) * Math.PI * 2 - Math.PI / 2;
          const rr = k % 2 ? r * 0.45 : r;
          g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
        }
        g.fill();
      }
      break;
    }
    case 'flagstones': {
      g.fillStyle = second;
      g.fillRect(0, 0, S, S);
      const cells = 5;
      const s = S / cells;
      for (let i = 0; i < cells; i++) {
        for (let k = 0; k < cells; k++) {
          const x = i * s + (k % 2 ? s / 2 : 0);
          for (const dx of [0, -S]) {
            g.fillStyle = mixHex(colour, second, rnd() * 0.3);
            g.beginPath();
            g.roundRect(x + dx + 3, k * s + 3, s - 6 - rnd() * 6, s - 6 - rnd() * 6, 7);
            g.fill();
          }
        }
      }
      speckle(1200, 0.06);
      break;
    }
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = RepeatWrapping;
  t.wrapT = RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/** A soft round gradient: white in the middle to clear at the edge. */
function radial(): Texture {
  const S = 128;
  const [c, g] = canvas(S, S);
  const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.42, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  const t = new CanvasTexture(c);
  t.minFilter = LinearFilter;
  t.generateMipmaps = false;
  return t;
}

let shared: { screens: Texture; glow: Texture; floors: Map<string, Texture> } | null = null;

/** The office's textures with a pack's atlas; drawn on first use and shared by every build. */
export function officeTextures(atlas: Partial<Record<ArtPack, Texture>>): Textures {
  shared ??= { screens: screenAtlas(), glow: radial(), floors: new Map() };
  const { screens, glow, floors } = shared;
  return {
    atlas,
    screens,
    glow,
    floor(floor) {
      const key = floorKey(floor);
      let t = floors.get(key);
      if (!t) {
        t = floorTexture(floor);
        floors.set(key, t);
      }
      return t;
    },
  };
}
