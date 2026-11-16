// The people renderer's rules that need no browser: how a person is dressed (people/dress.ts), what their body plays
// for each pose (people/plan.ts) and when the frame governor steps quality down and up (people/governor.ts).
import { describe, expect, it } from 'vitest';
import type { Look } from '../src/core/studio.ts';
import { CLIP_NAMES } from '../web/src/scene/art/spec.ts';
import { dressFor, mixHex, SKIN } from '../web/src/scene/people/dress.ts';
import { type FrameSample, Governor, MAX_LEVEL, walkBudget } from '../web/src/scene/people/governor.ts';
import { type Plan, type PlanOptions, planFor, type Track } from '../web/src/scene/people/plan.ts';
import { type BodyState, HOLDINGS, POSES, type Pose } from '../web/src/scene/poses.ts';

const HUE = '#5B8FC7';
const dress = (key: string, look: Look = {}, visitor = false) => dressFor({ key, look, hue: HUE, visitor });
const keys = Array.from({ length: 40 }, (_, i) => `role-${i}`);
const brightness = (hex: string) => [1, 3, 5].reduce((sum, i) => sum + Number.parseInt(hex.slice(i, i + 2), 16), 0);

describe('dressing people', () => {
  it('dresses the same person the same way every time', () => {
    expect(dress('qa-engineer')).toEqual(dress('qa-engineer'));
  });

  it('puts visitors in the mannequin, whatever their look says', () => {
    expect(dress('explore', { body: 'knight' }, true).body).toBe('mannequin');
  });

  it('wears the body the look names', () => {
    expect(dress('lead', { body: 'barbarian' }).body).toBe('barbarian');
  });

  it('gives staff without a named body one of the four office bodies, never the barbarian or the mannequin', () => {
    const bodies = new Set(keys.map((k) => dress(k).body));
    expect([...bodies].sort()).toEqual(['knight', 'mage', 'ranger', 'rogue']);
  });

  it('wears the look’s colour as is, and the room’s hue with a little spread otherwise', () => {
    expect(dress('designer', { color: '#c94f7c' }).outfit.top).toBe('#C94F7C');
    const tops = new Set(keys.map((k) => dress(k).outfit.top));
    expect(tops).toEqual(new Set([HUE, mixHex(HUE, '#FFFFFF', 0.14), mixHex(HUE, '#2B2F3A', 0.08)]));
  });

  it('shades the darker part of the top darker than the top', () => {
    for (const k of keys) {
      const { top, topDark } = dress(k).outfit;
      expect(brightness(topDark), k).toBeLessThan(brightness(top));
    }
  });

  it('takes the skin tone the look picks and falls back to a stable one for a tone that does not exist', () => {
    expect(dress('writer', { skin: 4 }).outfit.skin).toBe(SKIN[4]);
    expect(SKIN).toContain(dress('writer', { skin: 9 }).outfit.skin);
    expect(dress('writer', { skin: 9 }).outfit.skin).toBe(dress('writer', { skin: -1 }).outfit.skin);
  });

  it('keeps the look’s hair colour and prop', () => {
    const d = dress('reviewer', { hair: '#a8473a', prop: 'clipboard' });
    expect(d.outfit.hair).toBe('#A8473A');
    expect(d.prop).toBe('clipboard');
    expect(dress('reviewer').prop).toBe('none');
  });

  it('gives each person a loop phase between 0 and 1 and a pace between 0.9 and 1.14, varied across a room', () => {
    for (const k of keys) {
      const { phase, pace } = dress(k);
      expect(phase).toBeGreaterThanOrEqual(0);
      expect(phase).toBeLessThan(1);
      expect(pace).toBeGreaterThanOrEqual(0.9);
      expect(pace).toBeLessThanOrEqual(1.14 + 1e-9);
    }
    expect(new Set(keys.map((k) => dress(k).phase)).size).toBeGreaterThan(30);
  });
});

const BODY: Pick<BodyState, 'pose' | 'holding' | 'tired' | 'restPose'> = { pose: 'rest', holding: 'none', tired: 0, restPose: 0 };
const OPTIONS: PlanOptions = { reducedMotion: false, phase: 0.25, pace: 1.1, elapsed: 0, seated: true };
const plan = (body: Partial<typeof BODY>, options: Partial<PlanOptions> = {}): Plan => planFor({ ...BODY, ...body }, { ...OPTIONS, ...options });
const tracks = (p: Plan): Track[] => [p.base, ...p.layers];
const summary = (t: Track) => `${t.clip} ${t.mode}`;
const layer = (p: Plan, clip: string) => p.layers.find((t) => t.clip === clip);
const STANDING: Pose[] = ['walk', 'stand', 'wait', 'talk', 'listen', 'nod', 'clap', 'cheer', 'interact', 'pickup', 'wave'];

describe('what a pose plays', () => {
  it('plays only clips the clips file holds, for every pose, holding, tiredness and rest pose', () => {
    for (const pose of POSES)
      for (const holding of HOLDINGS)
        for (const tired of [0, 1, 2, 3] as const)
          for (const restPose of [0, 1, 2] as const)
            for (const seated of [true, false])
              for (const t of tracks(plan({ pose, holding, tired, restPose }, { seated }))) expect(CLIP_NAMES as readonly string[], `${pose} ${t.clip}`).toContain(t.clip);
  });

  it('types at the desk: sitting idle with the typing layer, both from the person’s phase and pace', () => {
    const p = plan({ pose: 'type' });
    expect(tracks(p).map(summary)).toEqual(['Sit_Chair_Idle loop', 'Typing loop']);
    for (const t of tracks(p)) {
      expect(t.at).toBe(0.25);
      expect(t.timeScale).toBeCloseTo(1.1);
    }
    expect(p.live).toBe(true);
  });

  it('types slower and slouches on a long day (game-feel.md, section 4)', () => {
    expect(layer(plan({ pose: 'type', tired: 1 }), 'Slouch')).toBeUndefined();
    expect(layer(plan({ pose: 'type', tired: 2 }), 'Typing')?.timeScale).toBeCloseTo(0.85 * 1.1);
    expect(layer(plan({ pose: 'type', tired: 2 }), 'Slouch')).toMatchObject({ mode: 'still', weight: 0.55 });
    expect(layer(plan({ pose: 'type', tired: 3 }), 'Typing')?.timeScale).toBeCloseTo(0.75 * 1.1);
    expect(layer(plan({ pose: 'type', tired: 3 }), 'Slouch')).toMatchObject({ mode: 'still', weight: 1 });
  });

  it('holds the rest poses as still frames, so an idle office draws nothing', () => {
    expect(tracks(plan({ pose: 'rest', restPose: 0 })).map(summary)).toEqual(['Sit_Chair_Idle still']);
    expect(tracks(plan({ pose: 'rest', restPose: 1 })).map(summary)).toEqual(['Sit_Chair_Idle still', 'Arms_Crossed still']);
    expect(tracks(plan({ pose: 'lounge', restPose: 2 })).map(summary)).toEqual(['Sit_Chair_Idle still', 'Lean_Back still']);
    for (const restPose of [0, 1, 2] as const) expect(plan({ pose: 'rest', restPose }).live).toBe(false);
  });

  it.each([
    ['read', 'Read'],
    ['stuck', 'Stuck'],
    ['sleep', 'Sleep'],
    ['look', 'Look_Up'],
  ] as const)('holds %s as one still frame with its layer', (pose, clip) => {
    const p = plan({ pose });
    expect(tracks(p).map(summary)).toEqual(['Sit_Chair_Idle still', `${clip} still`]);
    expect(p.live).toBe(false);
  });

  it('never slouches someone asleep on their arms', () => {
    expect(layer(plan({ pose: 'sleep', tired: 3 }), 'Slouch')).toBeUndefined();
  });

  it('thinks with the chin on a hand, breathing at half pace', () => {
    const p = plan({ pose: 'think' });
    expect(tracks(p).map(summary)).toEqual(['Sit_Chair_Idle loop', 'Think still']);
    expect(p.base.timeScale).toBeCloseTo(0.5 * 1.1);
    expect(p.live).toBe(true);
  });

  it('talks standing with the gesturing layer, or seated with it softer', () => {
    expect(tracks(plan({ pose: 'talk' }, { seated: false })).map(summary)).toEqual(['Idle_Talking loop', 'Gesturing loop']);
    const seated = plan({ pose: 'talk' }, { seated: true });
    expect(seated.base.clip).toBe('Sitting_Talking');
    expect(layer(seated, 'Gesturing')?.weight).toBe(0.7);
  });

  it('walks empty-handed, or carrying with what they hold', () => {
    expect(plan({ pose: 'walk' }, { seated: false }).base.clip).toBe('Walking_A');
    expect(plan({ pose: 'walk', holding: 'plant' }, { seated: false }).base.clip).toBe('Walk_Carry');
  });

  it('waits at the front desk on one still holding frame', () => {
    const p = plan({ pose: 'wait', holding: 'note-yours' }, { seated: false });
    expect(tracks(p).map(summary)).toEqual(['Holding_A still']);
    expect(p.holding).toBe('note-yours');
    expect(p.live).toBe(false);
  });

  it('listens with a nodding layer the crowd plays now and then, weightless until it does', () => {
    const p = plan({ pose: 'listen' }, { seated: false });
    expect(p.base.clip).toBe('Idle_Listening');
    expect(layer(p, 'Nodding')).toMatchObject({ mode: 'loop', weight: 0 });
  });

  it('nods once, seated at the desk or standing, from where the nod already is', () => {
    const seated = plan({ pose: 'nod' }, { seated: true, elapsed: 0.3 });
    expect(tracks(seated).map(summary)).toEqual(['Sit_Chair_Idle still', 'Nodding once']);
    expect(layer(seated, 'Nodding')?.elapsed).toBe(0.3);
    expect(plan({ pose: 'nod' }, { seated: false }).base.clip).toBe('Idle_Listening');
  });

  it.each([
    ['clap', 'Clapping loop'],
    ['cheer', 'Victory_Fist_Pump loop'],
    ['interact', 'Interact loop'],
    ['pickup', 'PickUp_Table once'],
    ['wave', 'Waving loop'],
    ['stand', 'Idle_A loop'],
  ] as const)('plays %s as named', (pose, expected) => {
    expect(summary(plan({ pose }, { seated: false }).base)).toBe(expected);
  });

  it('stands holding what they hold', () => {
    expect(plan({ pose: 'stand', holding: 'task' }, { seated: false }).base.clip).toBe('Holding_A');
  });

  it('keeps a desk pose’s layer over a standing frame when the cast has them standing', () => {
    const p = plan({ pose: 'read', holding: 'task' }, { seated: false });
    expect(tracks(p).map(summary)).toEqual(['Holding_A still', 'Read still']);
    expect(p.seated).toBe(false);
    expect(plan({ pose: 'rest' }, { seated: false }).base.clip).toBe('Idle_A');
  });

  it('freezes everything with reduced motion: loops hold a frame and one-offs their end', () => {
    for (const pose of POSES) {
      const p = plan({ pose, tired: 3 }, { reducedMotion: true, seated: !STANDING.includes(pose) });
      expect(p.live, pose).toBe(false);
      for (const t of tracks(p)) expect(t.mode, `${pose} ${t.clip}`).toBe('still');
    }
    expect(plan({ pose: 'pickup' }, { reducedMotion: true, seated: false }).base.at).toBe(1);
  });
});

/** Frames `every` ms apart for `ms`, each as `frame` says, from `start`; returns the levels the governor went through. */
function run(governor: Governor, frame: (at: number) => FrameSample, ms: number, every: number, start = 0): number[] {
  const levels: number[] = [];
  for (let at = start; at <= start + ms; at += every) if (governor.sample(frame(at), at)) levels.push(governor.level);
  return levels;
}
const heavy: FrameSample = { work: 40, took: 50, asked: 33.3 };
const easy: FrameSample = { work: 6, took: 16.7, asked: 16.7 };

describe('the frame governor', () => {
  it('steps down after 2 s of frames whose work runs over 33 ms', () => {
    const g = new Governor();
    expect(run(g, () => heavy, 1900, 50)).toEqual([]);
    expect(run(g, () => heavy, 200, 50, 1950)).toEqual([1]);
  });

  it('leaves a phone alone that draws its motion tier on time at 30 a second', () => {
    const g = new Governor();
    expect(run(g, () => ({ work: 9, took: 33.4, asked: 33.3 }), 10_000, 33.3)).toEqual([]);
    expect(g.level).toBe(0);
  });

  it('leaves ambient frames alone that come at the 20 a second they ask for', () => {
    const g = new Governor();
    expect(run(g, () => ({ work: 12, took: 50, asked: 50 }), 10_000, 50)).toEqual([]);
  });

  it('steps down when frames come a beat late and slower than 30 a second, even with little work', () => {
    const g = new Governor();
    expect(run(g, () => ({ work: 8, took: 70, asked: 50 }), 2100, 70)).toEqual([1]);
  });

  it('steps down on a desktop that can only draw its 60 fps tier at 30', () => {
    const g = new Governor();
    expect(run(g, () => ({ work: 14, took: 33.4, asked: 16.7 }), 2100, 33.4)).toEqual([1]);
  });

  it('does not count frames far apart as a run', () => {
    const g = new Governor();
    expect(run(g, () => heavy, 10_000, 500)).toEqual([]);
  });

  it('judges a frame nobody asked for by its work alone', () => {
    const g = new Governor();
    expect(run(g, () => ({ work: 10, took: null, asked: null }), 3000, 100)).toEqual([]);
    expect(run(g, () => ({ work: 45, took: null, asked: null }), 2100, 100, 3100)).toEqual([1]);
  });

  it('steps back up after 10 s of easy frames, one level at a time, never past 0 or MAX_LEVEL', () => {
    const g = new Governor();
    expect(run(g, () => heavy, 20_000, 50)).toEqual([1, 2, 3]);
    expect(g.level).toBe(MAX_LEVEL);
    expect(run(g, () => easy, 9_900, 16.7, 20_100)).toEqual([]);
    expect(run(g, () => easy, 40_000, 16.7, 30_000)).toEqual([2, 1, 0]);
    expect(g.level).toBe(0);
  });

  it('waits twice as long before trying again a level it had to leave right away', () => {
    const g = new Governor();
    run(g, () => heavy, 2100, 50);
    expect(g.level).toBe(1);
    run(g, () => easy, 10_100, 16.7, 2200);
    expect(g.level).toBe(0);
    // Straight back down: the level up was too much.
    run(g, () => heavy, 2100, 50, 12_400);
    expect(g.level).toBe(1);
    expect(run(g, () => easy, 15_000, 16.7, 14_600)).toEqual([]);
    expect(run(g, () => easy, 6_000, 16.7, 29_700)).toEqual([0]);
  });

  it('lowers the walk budget to 2 from level 2 and leaves the cast’s own below', () => {
    expect(walkBudget(0)).toBeUndefined();
    expect(walkBudget(1)).toBeUndefined();
    expect(walkBudget(2)).toBe(2);
    expect(walkBudget(3)).toBe(2);
  });
});
