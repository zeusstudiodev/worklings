// The pure parts of a portrait: where the camera looks, and turning what the GPU read back into a picture. No three, no DOM.

/** A portrait's side in pixels: 2x the largest face (64 px), so it stays sharp on a 2x screen. */
export const PORTRAIT_PX = 128;

export interface PortraitFrame {
  /** The centre of the square window the portrait shows, in the body's own space (it faces +z, feet on y = 0). */
  x: number;
  y: number;
  /** Half the window's side, in the same units. */
  half: number;
}

/** Half the window, as a share of the head bone's height. KayKit's bodies are chunky: the bone is at the crown, the chin about 0.7 of it down. */
const HALF_OF_HEAD_HEIGHT = 0.72;
/** Where the window's middle is, as a share of the same height: air over the hair, the shoulders in the foot. */
const MIDDLE_OF_HEAD_HEIGHT = 0.5;

/**
 * Head and shoulders for a body whose head bone is at `head` (feet on y = 0): every body is framed by its own height, so
 * tall and short fill the disc alike.
 */
export function portraitFrame(head: { x: number; y: number }): PortraitFrame {
  const height = Math.max(1e-3, head.y);
  return { x: head.x, y: height * MIDDLE_OF_HEAD_HEIGHT, half: height * HALF_OF_HEAD_HEIGHT };
}

/**
 * Pixels as the GPU has them (rows from the bottom, colours already multiplied by their alpha, which a multisampled
 * target's edges are) into an image's (rows from the top, straight colours). The input isn't touched.
 */
export function imagePixels(source: Uint8Array | Uint8ClampedArray, size: number): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(size * size * 4);
  for (let row = 0; row < size; row++) {
    let from = (size - 1 - row) * size * 4;
    let to = row * size * 4;
    for (let col = 0; col < size; col++, from += 4, to += 4) {
      const a = source[from + 3] ?? 0;
      if (a === 0) continue;
      const k = 255 / a;
      out[to] = (source[from] ?? 0) * k;
      out[to + 1] = (source[from + 1] ?? 0) * k;
      out[to + 2] = (source[from + 2] ?? 0) * k;
      out[to + 3] = a;
    }
  }
  return out;
}
