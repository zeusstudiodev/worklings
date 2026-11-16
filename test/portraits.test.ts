import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadBody, loadClips } from '../web/src/scene/art/loader.ts';
import { dressFor } from '../web/src/scene/people/dress.ts';
import { imagePixels, PORTRAIT_PX, portraitFrame } from '../web/src/scene/portraits/frame.ts';
import { dressKey, PortraitStore } from '../web/src/scene/portraits/store.ts';

describe('portrait framing', () => {
  it('centres on the head and frames a square window', () => {
    const f = portraitFrame({ x: 0.2, y: 1.6 });
    expect(f.x).toBe(0.2);
    // The window reaches over the crown and well below it: the head and the shoulders.
    expect(f.y + f.half).toBeGreaterThan(1.6);
    expect(f.y - f.half).toBeLessThan(1.6 * 0.3);
  });

  it('frames a taller body by its own height, so every face fills its disc alike', () => {
    const short = portraitFrame({ x: 0, y: 1.2 });
    const tall = portraitFrame({ x: 0, y: 2.4 });
    expect(tall.half / short.half).toBeCloseTo(2, 5);
    expect(tall.y / 2.4).toBeCloseTo(short.y / 1.2, 5);
  });

  it('survives a head bone at the floor', () => {
    const f = portraitFrame({ x: 0, y: 0 });
    expect(Number.isFinite(f.half) && f.half > 0).toBe(true);
  });
});

describe('portrait pixels', () => {
  it('flips the rows, since the GPU reads from the bottom up', () => {
    const src = new Uint8Array(2 * 2 * 4);
    src.set([10, 20, 30, 255], 0); // bottom-left
    src.set([40, 50, 60, 255], 8); // top-left
    const out = imagePixels(src, 2);
    expect([...out.slice(0, 4)]).toEqual([40, 50, 60, 255]);
    expect([...out.slice(8, 12)]).toEqual([10, 20, 30, 255]);
  });

  it('turns premultiplied edges back into straight colour', () => {
    const src = new Uint8Array(4);
    src.set([60, 30, 15, 120]);
    const out = imagePixels(src, 1);
    expect([...out]).toEqual([128, 64, 32, 120]);
  });

  it('leaves empty pixels transparent and does not change its input', () => {
    const src = new Uint8Array(PORTRAIT_PX * PORTRAIT_PX * 4);
    src[3] = 255;
    const copy = src.slice();
    const out = imagePixels(src, PORTRAIT_PX);
    expect(out[(PORTRAIT_PX - 1) * PORTRAIT_PX * 4 + 3]).toBe(255);
    expect(out[3]).toBe(0);
    expect(src).toEqual(copy);
  });
});

describe('the portrait store', () => {
  const make = () => {
    const revoked: string[] = [];
    return { store: new PortraitStore((url) => revoked.push(url)), revoked };
  };

  it('has no picture until one is set, then knows which look it is of', () => {
    const { store } = make();
    expect(store.urlOf('ana')).toBeNull();
    store.set('ana', 'look-1', 'blob:a');
    expect(store.urlOf('ana')).toBe('blob:a');
    expect(store.has('ana', 'look-1')).toBe(true);
    expect(store.has('ana', 'look-2')).toBe(false);
  });

  it('revokes the old URL when a look changes, and only then', () => {
    const { store, revoked } = make();
    store.set('ana', 'look-1', 'blob:a');
    store.set('ana', 'look-1', 'blob:a');
    expect(revoked).toEqual([]);
    store.set('ana', 'look-2', 'blob:b');
    expect(revoked).toEqual(['blob:a']);
    expect(store.urlOf('ana')).toBe('blob:b');
  });

  it('retains the people given, revoking everyone else, and clears them all', () => {
    const { store, revoked } = make();
    store.set('ana', 'x', 'blob:a');
    store.set('bo', 'x', 'blob:b');
    store.set('cy', 'x', 'blob:c');
    store.retain(new Set(['bo']));
    expect(revoked.sort()).toEqual(['blob:a', 'blob:c']);
    expect(store.size).toBe(1);
    store.clear();
    expect(revoked).toContain('blob:b');
    expect(store.size).toBe(0);
  });

  it('tells subscribers when something changed, not when nothing did', () => {
    const { store } = make();
    const seen = vi.fn();
    const off = store.subscribe(seen);
    store.retain(new Set());
    expect(seen).not.toHaveBeenCalled();
    store.set('ana', 'x', 'blob:a');
    expect(seen).toHaveBeenCalledTimes(1);
    off();
    store.set('ana', 'y', 'blob:b');
    expect(seen).toHaveBeenCalledTimes(1);
  });
});

describe('a look as a key', () => {
  const look = { key: 'dev', look: {}, hue: '#3366AA', visitor: false };

  it('is the same for the same person and changes with their colours, body or prop', () => {
    const base = dressKey(dressFor(look));
    expect(dressKey(dressFor(look))).toBe(base);
    expect(dressKey(dressFor({ ...look, look: { color: '#AA3366' } }))).not.toBe(base);
    expect(dressKey(dressFor({ ...look, look: { prop: 'headset' } }))).not.toBe(base);
    expect(dressKey(dressFor({ ...look, visitor: true }))).not.toBe(base);
  });

  it('does not change with the pace and phase a body animates at', () => {
    const a = dressFor(look);
    expect(dressKey({ ...a, outfit: { ...a.outfit } })).toBe(dressKey(a));
  });
});

// The baker needs a GPU to draw; these cases are the ones that never reach it: what it asks for and how often it wakes.
vi.mock('../web/src/scene/art/loader.ts', () => ({ loadBody: vi.fn(), loadClips: vi.fn() }));

describe('the portrait baker when files fail', () => {
  const frames: (() => void)[] = [];
  const stubs = () => {
    frames.length = 0;
    vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0 }) });
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => frames.push(cb));
    vi.stubGlobal('cancelAnimationFrame', () => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  };
  const run = async () => {
    // Runs the frames asked for, a few at a time, as a browser would, letting promises settle in between.
    for (let i = 0; i < 20; i++) {
      await Promise.resolve();
      const due = frames.splice(0);
      for (const cb of due) cb();
    }
  };
  // Loaded by a computed path: the baker uses browser globals, which this project's typecheck (Node, no DOM types) lacks.
  const baker = async () => {
    const { PortraitBaker } = (await import(['..', 'web', 'src', 'scene', 'portraits', 'baker.ts'].join('/'))) as { PortraitBaker: new (...args: unknown[]) => { want(w: unknown[]): void; dispose(): void } };
    return new PortraitBaker({}, 'full', new PortraitStore(vi.fn()), () => false);
  };
  const want = (key: string) => ({ person: key, dress: dressFor({ key, look: { body: 'rogue' }, hue: '#3366AA', visitor: false }) });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.mocked(loadBody).mockReset();
    vi.mocked(loadClips).mockReset();
  });

  it('asks for a body that failed to load once, not on every frame', async () => {
    stubs();
    vi.mocked(loadClips).mockResolvedValue(new Map());
    vi.mocked(loadBody).mockRejectedValue(new Error('404'));
    const b = await baker();
    b.want([want('a'), want('b')]);
    await run();
    expect(loadBody).toHaveBeenCalledTimes(1);
    // Asking again for people with that body doesn't download it again either.
    b.want([want('a'), want('b'), want('c')]);
    await run();
    expect(loadBody).toHaveBeenCalledTimes(1);
    expect(frames).toHaveLength(0);
    b.dispose();
  });

  it('keeps no frame loop when the animation clips fail', async () => {
    stubs();
    vi.mocked(loadClips).mockRejectedValue(new Error('500'));
    const b = await baker();
    b.want([want('a'), want('b')]);
    await run();
    expect(frames).toHaveLength(0);
    expect(loadBody).not.toHaveBeenCalled();
    b.want([want('c')]);
    await run();
    expect(frames).toHaveLength(0);
    b.dispose();
  });
});
