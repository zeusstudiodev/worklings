// The office screen (web/src/scene/office/screen.ts): its glowing face in the meeting room, its four corners for the
// label layer, and the CSS transform that lays an element exactly over it.
import { OrthographicCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { computeLayout } from '../web/src/scene/layout.ts';
import { officeScreen, overlayMatrix, projectCorners, screenCorners } from '../web/src/scene/office/screen.ts';
import { companyLayout } from './scenery-kit.ts';

/** The office's isometric camera, looking at the screen. */
function camera(target: Vector3): OrthographicCamera {
  const cam = new OrthographicCamera(-10, 10, 6, -6, 0.1, 500);
  cam.position.copy(target).addScaledVector(new Vector3(1, 1.18, 1).normalize(), 90);
  cam.lookAt(target);
  cam.updateMatrixWorld();
  cam.updateProjectionMatrix();
  return cam;
}

describe('the office screen', () => {
  it('stands in the meeting room, against its back wall, at the floor plan’s place and size', () => {
    const layout = companyLayout(25);
    const meeting = layout.office?.meeting;
    const face = officeScreen(layout);
    if (!meeting || !face) throw new Error('no meeting room');
    expect(face.x).toBeCloseTo(meeting.screen.x);
    expect(face.w).toBeCloseTo(meeting.screen.w - 0.12);
    expect(face.y).toBeGreaterThan(meeting.screen.y - 0.01);
    expect(face.z).toBeGreaterThan(meeting.z);
    expect(face.z).toBeLessThan(meeting.z + 1);
    expect(face.x - face.w / 2).toBeGreaterThan(meeting.x);
    expect(face.x + face.w / 2).toBeLessThan(meeting.x + meeting.w);
  });

  it('has none without a company floor plan', () => {
    expect(officeScreen(computeLayout(null))).toBeNull();
  });

  it('gives its corners in order round the face, in one plane facing the camera’s side', () => {
    const c = screenCorners({ x: 2, y: 1, z: 3, w: 4, h: 2 });
    expect(c.topLeft.toArray()).toEqual([0, 3, 3]);
    expect(c.topRight.toArray()).toEqual([4, 3, 3]);
    expect(c.bottomRight.toArray()).toEqual([4, 1, 3]);
    expect(c.bottomLeft.toArray()).toEqual([0, 1, 3]);
  });

  it('lays an element’s corners exactly on the projected face', () => {
    const face = { x: 2, y: 1, z: 3, w: 3.2, h: 1.4 };
    const corners = screenCorners(face);
    const p = projectCorners(corners, camera(new Vector3(2, 1.5, 3)), 1440, 900);
    const matrix = overlayMatrix(p, 320, 140);
    const [a, b, c, d, e, f] = (/matrix\(([^)]+)\)/.exec(matrix)?.[1] ?? '').split(',').map(Number) as [number, number, number, number, number, number];
    const map = (x: number, y: number) => ({ x: a * x + c * y + e, y: b * x + d * y + f });
    for (const [x, y, want] of [[0, 0, p.topLeft], [320, 0, p.topRight], [0, 140, p.bottomLeft], [320, 140, p.bottomRight]] as const) {
      const got = map(x, y);
      expect(got.x).toBeCloseTo(want.x, 3);
      expect(got.y).toBeCloseTo(want.y, 3);
    }
  });
});
