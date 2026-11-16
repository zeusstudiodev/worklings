// Mounted inside the Stage's canvas, where the office's renderer is: it bakes a portrait of everyone in the cast who is a
// person of the company, for the faces to show (Face.tsx). It draws nothing in the scene itself.
import { useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import type { BodyDetail } from '../art/spec.ts';
import type { CastMember } from '../cast.ts';
import { dressFor } from '../people/dress.ts';
import { PortraitBaker, type Want } from './baker.ts';
import { portraits } from './store.ts';

/** A wheel notch counts as a zoom for this long. */
const WHEEL_MS = 250;

/** Anything held down or scrolling anywhere on the page: a card or the separator dragged, the chart panned, the office zoomed. */
function useInteracting(): () => boolean {
  const state = useRef({ down: false, wheel: -WHEEL_MS });
  useEffect(() => {
    const s = state.current;
    const down = () => {
      s.down = true;
    };
    const up = () => {
      s.down = false;
    };
    const wheel = () => {
      s.wheel = performance.now();
    };
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('pointerup', up, true);
    document.addEventListener('pointercancel', up, true);
    window.addEventListener('blur', up);
    document.addEventListener('wheel', wheel, { capture: true, passive: true });
    return () => {
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('pointerup', up, true);
      document.removeEventListener('pointercancel', up, true);
      window.removeEventListener('blur', up);
      document.removeEventListener('wheel', wheel, true);
    };
  }, []);
  return useMemo(() => () => state.current.down || performance.now() - state.current.wheel < WHEEL_MS, []);
}

export function Portraits({ cast, detail }: { cast: CastMember[]; detail: BodyDetail }) {
  const gl = useThree((s) => s.gl);
  const interacting = useInteracting();
  const wants = useMemo<Want[]>(
    () =>
      cast.flatMap((m) =>
        m.person === null ? [] : [{ person: m.person, dress: dressFor({ key: m.look, look: m.body.outfit, hue: m.hue, visitor: m.body.visitor }) }],
      ),
    [cast],
  );
  const baker = useRef<PortraitBaker | null>(null);
  // The baker is made again for a new renderer or body detail, and handed its people (below, in the same commit) each time.
  useEffect(() => {
    const b = new PortraitBaker(gl, detail, portraits, interacting);
    baker.current = b;
    return () => {
      b.dispose();
      baker.current = null;
    };
  }, [gl, detail, interacting]);
  useEffect(() => baker.current?.want(wants), [wants, gl, detail, interacting]);
  return null;
}
