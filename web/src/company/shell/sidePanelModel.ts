// The side panel's geometry and memory (docs/design-v3.md, "The shell", "The side panel"; design-hud, "Layouts"). Pure, for
// tests: which layout a window gets, how wide the side panel may be, what the separator's keys and presses do, and the
// one preference this browser keeps.

/** The shell's layouts: docked from 896 px, floating from 721 to 895, the phone layout at 720 or less wide or 480 or less tall, short under 560 tall. */
export type ShellLayout = 'docked' | 'floating' | 'phone' | 'short';

export function layoutOf(width: number, height: number): ShellLayout {
  if (width <= 720 || height <= 480) return height < 560 ? 'short' : 'phone';
  return width <= 895 ? 'floating' : 'docked';
}

/** The side panel's narrowest width, and its width while it floats. */
export const PANEL_MIN = 300;
/** The main view keeps at least this beside a docked side panel. */
const MAIN_MIN = 560;
/** The main view's least, the side panel's gutter and the window's: 560 + 12 + 12 + 12. */
const DOCK_ROOM = MAIN_MIN + 36;

export interface PanelBounds {
  min: number;
  /** The widest: `min(560, window − 596)`, never under the narrowest. */
  max: number;
  /** Its default: 320 below a 1280 px window, 360 from 1280, or the widest if that is less. */
  preferred: number;
}

export function panelBounds(windowWidth: number): PanelBounds {
  const max = Math.max(PANEL_MIN, Math.min(560, windowWidth - DOCK_ROOM));
  return { min: PANEL_MIN, max, preferred: Math.min(windowWidth < 1280 ? 320 : 360, max) };
}

/** A width kept for a docked side panel, fitted to the window: within its bounds, the default when none is kept. */
export const fitPanelWidth = (width: number | null, bounds: PanelBounds): number =>
  width === null ? bounds.preferred : Math.round(Math.min(bounds.max, Math.max(bounds.min, width)));

/**
 * The separator's keys (the window splitter pattern): Left widens and Right narrows by 16 px, 64 with Shift; Home is the
 * narrowest, End the widest. Null for a key it doesn't use.
 */
export function widthByKey(key: string, shift: boolean, width: number, bounds: PanelBounds): number | null {
  const step = shift ? 64 : 16;
  const to = (w: number) => fitPanelWidth(w, bounds);
  switch (key) {
    case 'ArrowLeft':
      return to(width + step);
    case 'ArrowRight':
      return to(width - step);
    case 'Home':
      return bounds.min;
    case 'End':
      return bounds.max;
    default:
      return null;
  }
}

/** A press on the separator without a drag steps through narrow, the default and wide, then narrow again (WCAG 2.5.7). */
export function nextStop(width: number, bounds: PanelBounds): number {
  if (width < bounds.preferred) return bounds.preferred;
  if (width < bounds.max) return bounds.max;
  return bounds.min;
}

/** A width to the pointer: the window's right edge less the pointer and the gutter, within the bounds. */
export const widthAtPointer = (pointerX: number, windowWidth: number, bounds: PanelBounds): number => fitPanelWidth(windowWidth - 12 - pointerX, bounds);

/**
 * A drag's width. The panel shown, its edge moves as far as the pointer from where it was pressed, so grabbing the
 * separator anywhere across its band moves nothing until the pointer does; pulled out from hidden (no width at the
 * start), it opens to the pointer.
 */
export function widthFromDrag(drag: { startX: number; startWidth: number | null }, pointerX: number, windowWidth: number, bounds: PanelBounds): number {
  if (drag.startWidth === null) return widthAtPointer(pointerX, windowWidth, bounds);
  return fitPanelWidth(drag.startWidth + drag.startX - pointerX, bounds);
}

/** What this browser keeps of the side panel: its width (null for the default) and whether it is hidden. */
export interface PanelMemory {
  width: number | null;
  hidden: boolean;
}

export const PANEL_MEMORY_KEY = 'worklings-side-panel';

/** The kept preference, read leniently: anything that isn't one gives the defaults (shown, at the default width). */
export function readPanelMemory(raw: string | null): PanelMemory {
  if (raw === null) return { width: null, hidden: false };
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return { width: null, hidden: false };
    const width = 'width' in value && typeof value.width === 'number' && Number.isFinite(value.width) ? Math.round(value.width) : null;
    const hidden = 'hidden' in value && value.hidden === true;
    return { width, hidden };
  } catch {
    return { width: null, hidden: false };
  }
}

export const writePanelMemory = (memory: PanelMemory): string => JSON.stringify(memory);
