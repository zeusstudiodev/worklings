// The crowd (people/crowd.ts) builds each person from the body file of the detail it was made with, so the lighter mode
// asks for the low-detail bodies only. H26 found phones fetching both sets: the people joined (their layout effects run
// first) before the crowd was told its detail, so they asked for the full bodies too, 317 kB never drawn.
// The crowd's loader reads Vite's import.meta.env, so this Node-typed test borrows Vite's client types to compile it.
/// <reference types="vite/client" />
import { Group } from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { demoCompanyView, demoSnapshot, studioOf } from '../src/core/demo-company.ts';
import { castFrom, SeenLog } from '../web/src/scene/cast.ts';
import { computeLayout } from '../web/src/scene/layout.ts';
import { Crowd } from '../web/src/scene/people/crowd.ts';

// The art never arrives: the test sees what the crowd asks for, and nothing gets built.
const loader = vi.hoisted(() => ({
  loadBody: vi.fn((_body: string, _detail: string) => new Promise<never>(() => {})),
  loadClips: vi.fn(() => new Promise<never>(() => {})),
}));
vi.mock('../web/src/scene/art/loader.ts', () => loader);

const T0 = Date.UTC(2026, 10, 5, 9, 0, 0);

/** The demo company's people as the office casts them. */
function members() {
  const view = demoCompanyView(T0);
  const snapshot = demoSnapshot(view, 'C:\\cafe', T0);
  const layout = computeLayout(studioOf(view));
  const seen = new SeenLog();
  seen.note(snapshot, layout);
  return castFrom(snapshot, layout, { now: T0, seen }).members;
}

const asked = () => loader.loadBody.mock.calls.map(([body, detail]) => `${body}:${detail}`);
const details = () => new Set(loader.loadBody.mock.calls.map(([, detail]) => detail));
const join = (crowd: Crowd) => {
  for (const m of members()) crowd.set(m, new Group());
};

describe('the bodies a crowd asks for', () => {
  beforeEach(() => {
    loader.loadBody.mockClear();
  });

  it('made for the lighter mode, asks for the low-detail bodies only', () => {
    join(new Crowd({ reducedMotion: false, detail: 'low', quality: 0 }));
    expect(loader.loadBody).toHaveBeenCalled();
    expect(details()).toEqual(new Set(['low']));
  });

  it('made with nothing said, asks for the full bodies, once each', () => {
    join(new Crowd());
    expect(details()).toEqual(new Set(['full']));
    expect(asked()).toEqual([...new Set(asked())]);
  });

  it('configured as it was made, asks for nothing more', () => {
    const crowd = new Crowd({ reducedMotion: false, detail: 'low', quality: 0 });
    join(crowd);
    const before = asked().length;
    crowd.configure({ reducedMotion: false, detail: 'low', quality: 0 });
    expect(asked()).toHaveLength(before);
  });

  it('switched to the other detail later, asks for those bodies then', () => {
    const crowd = new Crowd({ reducedMotion: false, detail: 'low', quality: 0 });
    join(crowd);
    crowd.configure({ reducedMotion: false, detail: 'full', quality: 0 });
    expect(details()).toEqual(new Set(['low', 'full']));
  });
});
