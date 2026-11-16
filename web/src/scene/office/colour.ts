// Colour arithmetic on #rrggbb strings, for the office's own pieces and floors.

/** Mixes two colours: 0 keeps `a`, 1 is `b`. */
export function mixHex(a: string, b: string, t: number): string {
  const pa = Number.parseInt(a.slice(1), 16);
  const pb = Number.parseInt(b.slice(1), 16);
  const ch = (s: number) => Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t);
  return `#${((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1)}`;
}

/** Toward white: 0 keeps the colour, 1 is white. */
export const tintHex = (hex: string, amount: number): string => mixHex(hex, '#ffffff', amount);

/** Toward black: 0 keeps the colour, 1 is black. */
export const shadeHex = (hex: string, amount: number): string => mixHex(hex, '#000000', amount);

/** Relative luminance (WCAG), 0 for black to 1 for white: tells a dark floor or wall from a light one. */
export function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}
