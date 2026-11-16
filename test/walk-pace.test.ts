// v3's walking pace (docs/game-feel.md, section 1) and the doors walls leave for it.
import { describe, expect, it } from 'vitest';
import { DOOR_WIDTH, wallRects } from '../web/src/scene/layout.ts';
import { MAX_PACE, MAX_WALK_MS, PACE, paceMs } from '../web/src/scene/walk.ts';

describe('the pace of a walk', () => {
  it('walks at 3 units a second', () => {
    expect(PACE).toBe(3);
    expect(paceMs(9)).toBe(3000);
    expect(paceMs(0.01)).toBe(0);
  });

  it('speeds a longer route up to fit in 6 s, at most 7.5 units a second, and walks no route longer than that', () => {
    expect(paceMs(30)).toBe(MAX_WALK_MS);
    expect(paceMs(MAX_PACE * (MAX_WALK_MS / 1000))).toBe(MAX_WALK_MS);
    expect(paceMs(MAX_PACE * (MAX_WALK_MS / 1000) + 0.1)).toBeNull();
  });
});

describe('walls with doors', () => {
  const room = { x: 0, z: 0, w: 10, d: 8 };
  const covers = (rects: ReturnType<typeof wallRects>, x: number, z: number) => rects.some((r) => x >= r.x && x <= r.x + r.w && z >= r.z && z <= r.z + r.d);

  it('leaves v2 rooms one door in the middle of the front wall', () => {
    const walls = wallRects(room);
    expect(covers(walls, 5, 7.95)).toBe(false);
    expect(covers(walls, 5 - DOOR_WIDTH, 7.95)).toBe(true);
    expect(covers(walls, 5, 0.05)).toBe(true);
  });

  it('cuts every door a room lists, in any wall', () => {
    const walls = wallRects({ ...room, doors: [{ side: 'back', at: 2, width: 1.6 }, { side: 'right', at: 4, width: 1.6 }] });
    expect(covers(walls, 2, 0.05)).toBe(false);
    expect(covers(walls, 9.95, 4)).toBe(false);
    expect(covers(walls, 5, 7.95)).toBe(true);
    expect(covers(walls, 0.05, 4)).toBe(true);
  });
});
