// The office screen on the meeting room's back wall (docs/game-feel.md, section 6; docs/design-v3.md, Preview): where
// its glowing face is in the world, and how to lay a DOM element exactly over it. The office draws the screen; the
// label layer's overlay (the latest screenshot, else the company's name) sits on top. The four corners are also label
// anchors, `screen:top-left`, `screen:top-right`, `screen:bottom-right` and `screen:bottom-left`. Pure three.js.
import { type Camera, Vector3 } from 'three';
import type { Layout } from '../layout.ts';
import { planOffice, type ScreenFace } from './plan.ts';

export interface Corners {
  topLeft: Vector3;
  topRight: Vector3;
  bottomRight: Vector3;
  bottomLeft: Vector3;
}

/** The screen's face in a company's office, or null for a floor plan without a meeting room. */
export function officeScreen(layout: Layout): ScreenFace | null {
  return planOffice(layout, { theme: 'office', decor: [] })?.screen ?? null;
}

/** The face's corners in world space. It faces the camera's side (+z). */
export function screenCorners(face: ScreenFace): Corners {
  const left = face.x - face.w / 2;
  const right = face.x + face.w / 2;
  return {
    topLeft: new Vector3(left, face.y + face.h, face.z),
    topRight: new Vector3(right, face.y + face.h, face.z),
    bottomRight: new Vector3(right, face.y, face.z),
    bottomLeft: new Vector3(left, face.y, face.z),
  };
}

export interface ScreenPoint {
  x: number;
  y: number;
}

/** The corners on screen, in CSS pixels from the canvas's top left. */
export function projectCorners(corners: Corners, camera: Camera, width: number, height: number): Record<keyof Corners, ScreenPoint> {
  const at = (v: Vector3): ScreenPoint => {
    const p = v.clone().project(camera);
    return { x: ((p.x + 1) / 2) * width, y: ((1 - p.y) / 2) * height };
  };
  return { topLeft: at(corners.topLeft), topRight: at(corners.topRight), bottomRight: at(corners.bottomRight), bottomLeft: at(corners.bottomLeft) };
}

/**
 * A CSS `matrix()` that puts an element `width` by `height` (with `transform-origin: 0 0`) exactly on the projected
 * face: its top left on the top left corner, and so on. The office camera is orthographic, so the face projects to a
 * parallelogram and three corners fix it.
 */
export function overlayMatrix(p: Record<keyof Corners, ScreenPoint>, width: number, height: number): string {
  const a = (p.topRight.x - p.topLeft.x) / width;
  const b = (p.topRight.y - p.topLeft.y) / width;
  const c = (p.bottomLeft.x - p.topLeft.x) / height;
  const d = (p.bottomLeft.y - p.topLeft.y) / height;
  const f = (n: number) => Number(n.toFixed(6));
  return `matrix(${f(a)}, ${f(b)}, ${f(c)}, ${f(d)}, ${f(p.topLeft.x)}, ${f(p.topLeft.y)})`;
}
