// The mini-map (docs/design-v3.md, "Boards over the map"; docs/design-hud.md): while a board is open, the office lives on
// in the main view's bottom-right corner. It is the same canvas, shrunk and fitted: the stage lays it over this button's
// window and draws the marks over it (scene/Stage.tsx), so the canvas never moves in the page and no second WebGL view is
// made. One button, "Back to the office", named with the company's state and what needs you
// ("Back to the office. Working, 4 need you."), the Esc key cap in its caption (gone in full screen, where the browser
// takes the first Escape). Whole where the main view has room beside the talk bar, else a thumbnail, raised above the
// talk bar where even that has none. The shell places it directly in the main view's box.
import { useCallback, useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react';
import type { StageCamera } from '../../scene/stageCamera.ts';
import type { StateTone } from '../ui/tone.ts';
import { type MiniVariant, miniMark, miniName, miniVariant } from './frameModel.ts';
import './frame.css';

export interface MiniMapProps {
  /** The shell's StageCamera, the same one the Stage has. */
  camera: StageCamera;
  /** The bar pill's word and tone (CompanyState's `pill` and `tone`). */
  state: { pill: string; tone: StateTone };
  /** The inbox's count. */
  needs: number;
  /** Back to the office, as Escape and Office in the views do. */
  onBack: () => void;
  /** The feed lies over the board, or there is no 3D: no mini-map. */
  hidden?: boolean;
  /** In full screen the browser takes the first Escape, so the key cap goes. */
  fullscreen?: boolean;
}

export function MiniMap({ camera, state, needs, onBack, hidden = false, fullscreen = false }: MiniMapProps) {
  const live = useSyncExternalStore(camera.subscribe, () => camera.live);
  const [button, setButton] = useState<HTMLButtonElement | null>(null);
  // Unknown until the main view is measured (before anything is painted): the stage only moves to a window whose form is known.
  const variant = useVariant(button);
  const mark = miniMark(state.pill, state.tone);
  const shown = live && !hidden;
  // The window the stage lays the canvas over, handed to the stage as it comes and goes.
  const viewRef = useCallback((el: HTMLSpanElement | null) => camera.miniView(el), [camera]);
  useLayoutEffect(() => {
    camera.setMarks(shown && variant !== null ? { pill: state.pill, mark, needs, variant } : null);
  }, [camera, shown, state.pill, mark, needs, variant]);
  useEffect(() => () => camera.setMarks(null), [camera]);
  if (!shown) return null;
  const name = miniName(state.pill, needs);
  const form = variant ?? 'thumb';
  return (
    <button ref={setButton} type="button" className={`minimap minimap--${form}`} aria-label={name} title={form === 'whole' ? undefined : name} onClick={onBack}>
      <span ref={viewRef} className="minimap__view" aria-hidden="true" />
      {form === 'whole' && (
        <span className="minimap__caption" aria-hidden="true">
          Back to the office
          {!fullscreen && <kbd className="minimap__esc">Esc</kbd>}
        </span>
      )}
    </button>
  );
}

/** The form for the main view's width: the box the button is placed in, watched as it resizes; null until measured. */
function useVariant(button: HTMLElement | null): MiniVariant | null {
  const [variant, setVariant] = useState<MiniVariant | null>(null);
  useLayoutEffect(() => {
    const main = button?.offsetParent;
    if (!(main instanceof HTMLElement)) return;
    const update = () => setVariant(miniVariant(main.clientWidth, parseFloat(getComputedStyle(document.documentElement).fontSize) || 16));
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(main);
    return () => observer.disconnect();
  }, [button]);
  return variant;
}
