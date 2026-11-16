// Where a point on the stage lies against the labels' area, for Send's flight (docs/design-hud.md, "Send's flight"):
// a note whose target is out of view, or under the floating side panel, flies to the area's edge toward it instead.
// Plain numbers, so a test pins the geometry.

/** Send's flight: the middle of the office, from the desk trays' centre of gravity (LabelStore.reach). */
export const OFFICE_MIDDLE = 'office:middle';

export interface Pt {
  x: number;
  y: number;
}

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** A target on the page: where it is, whether it lies inside the labels' area, and the place to fly to either way. */
export interface Reach {
  x: number;
  y: number;
  inside: boolean;
  /** The point itself when inside; else where the line from the area's middle to it leaves the area. */
  edge: Pt;
}

export const inBox = (p: Pt, box: Box): boolean => p.x >= box.left && p.x <= box.right && p.y >= box.top && p.y <= box.bottom;

/**
 * Where the line from the box's middle to `p` leaves the box, pulled `inset` px inside so a paper stays whole there.
 * A point inside the box comes back as it is; a box with no room gives its middle.
 */
export function edgeToward(box: Box, p: Pt, inset = 10): Pt {
  const cx = (box.left + box.right) / 2;
  const cy = (box.top + box.bottom) / 2;
  const hw = Math.max(0, (box.right - box.left) / 2 - inset);
  const hh = Math.max(0, (box.bottom - box.top) / 2 - inset);
  const dx = p.x - cx;
  const dy = p.y - cy;
  if (Math.abs(dx) <= hw && Math.abs(dy) <= hh) return { x: p.x, y: p.y };
  const sx = dx === 0 ? Number.POSITIVE_INFINITY : hw / Math.abs(dx);
  const sy = dy === 0 ? Number.POSITIVE_INFINITY : hh / Math.abs(dy);
  const s = Math.min(sx, sy);
  return { x: cx + dx * s, y: cy + dy * s };
}
