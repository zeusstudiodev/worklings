// Everyone in the model: KayKit people (people/), advanced from one frame loop on the cast's clock. The loop also sets
// the frame rate the office asks for (docs/game-feel.md, "Frame tiers"): every frame while someone walks or changes
// pose (30 a second on phones), 30 a second (20 on phones, 15 when the governor is at its lowest) while people only
// work at their desks, and none at all while everyone is still: the frame loop stays on demand. The cast's own tier
// (useCast) holds the rate up for what it knows is under way; whatever asks for more wins. While the office is the
// mini-map over a board, a cap holds every rate to a few frames a second, leaving the main thread to the board.
import { useFrame, useThree } from '@react-three/fiber';
import { useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Selection } from './Building.tsx';
import type { Cast, CastMember, SceneClock } from './cast.ts';
import { OfficeLabelsContext } from './labels.tsx';
import { itemPath } from './officeLabels.ts';
import { Crowd, type CrowdFrame } from './people/crowd.ts';
import type { FrameSample } from './people/governor.ts';
import { Person } from './Person.tsx';

interface Props {
  cast: CastMember[];
  clock: SceneClock;
  /** How often the cast needs frames (useCast's `tier`). */
  tier: Cast['tier'];
  selectedKey: string | null;
  /** Whoever you are asking: they wear the yellow ring too. */
  askKey: string | null;
  reducedMotion: boolean;
  /** Phones: the simplified bodies and the lower frame rates. */
  lighter: boolean;
  /** The governor's level (people/governor.ts). */
  quality: number;
  onSelect: (selection: Selection) => void;
  /** Each drawn frame, once it is done: its work and timing for the governor, and the people loop's own numbers. */
  onFrame?: (sample: FrameSample, frame: CrowdFrame) => void;
  /** At most this many frames a second, whatever moves (the mini-map); null for the tiers' own rates. */
  cap?: number | null;
}

export function People({ cast, clock, tier, selectedKey, askKey, reducedMotion, lighter, quality, onSelect, onFrame, cap = null }: Props) {
  const invalidate = useThree((s) => s.invalidate);
  // In a company's office, someone holding a paper for you opens what it is in the inbox; anyone else is selected.
  const shell = useContext(OfficeLabelsContext);
  // Made with the detail it starts at: a phone's people are built from the low-detail bodies, never the full ones too.
  const [crowd] = useState(() => new Crowd({ reducedMotion, detail: lighter ? 'low' : 'full', quality }));
  useEffect(() => () => crowd.dispose(), [crowd]);
  useEffect(() => crowd.listen(invalidate, (error) => console.warn('Worklings: the people could not be drawn.', error)), [crowd, invalidate]);
  useLayoutEffect(() => {
    crowd.configure({ reducedMotion, detail: lighter ? 'low' : 'full', quality });
    invalidate();
  }, [crowd, reducedMotion, lighter, quality, invalidate]);
  // A new tier from the cast starts the frames it asks for.
  useEffect(() => {
    if (tier !== 'still') invalidate();
  }, [tier, invalidate]);

  // One pending wake-up at most: animation frames until the next frame the tier asks for is due. Counting frames
  // (rather than a timer) keeps the rate on the display's beat: 30 a second is every other frame at 60 Hz.
  const wake = useRef<number | null>(null);
  useEffect(() => () => {
    if (wake.current !== null) cancelAnimationFrame(wake.current);
  }, []);
  // When the last frame was drawn and the interval it asked for, so the governor can tell a late frame.
  const paced = useRef<{ at: number; asked: number | null }>({ at: 0, asked: null });
  // A new cap starts a new pace: the frame after it isn't late for the rate before it.
  useEffect(() => {
    paced.current = { at: 0, asked: null };
    invalidate();
  }, [cap, invalidate]);
  // Before the labels follow people (priority 0), so a label never lags its person by a frame.
  useFrame((state, delta) => {
    const real = performance.now();
    const frame = crowd.update(Math.min(delta, 0.1), real, clock.now(real), state.camera);
    const motion = lighter ? 30 : 60;
    const ambient = quality >= 3 ? 15 : lighter ? 20 : 30;
    const own = frame.motion ? motion : frame.ambient ? ambient : 0;
    const wanted = Math.max(own, tier === 'motion' ? motion : tier === 'ambient' ? ambient : 0);
    const fps = cap === null ? wanted : Math.min(wanted, cap);

    const previous = paced.current;
    paced.current = { at: real, asked: fps > 0 ? 1000 / fps : null };
    // The frame's work is known once the whole loop (the draw calls too) has run: right after it, in a microtask.
    if (onFrame) {
      const took = previous.asked !== null ? real - previous.at : null;
      queueMicrotask(() => onFrame({ work: performance.now() - real, took, asked: previous.asked }, frame));
    }

    if (fps === 0 || wake.current !== null) return;
    if (fps >= 60) {
      state.invalidate();
      return;
    }
    // invalidate() draws on the animation frame after the one it's called in, so it's called one beat early. `real`
    // is some way into this frame already, hence the slack.
    const due = real + 1000 / fps - 8;
    let last: number | null = null;
    const next = (t: number) => {
      const beat = last === null ? 1000 / 60 : t - last;
      last = t;
      if (t + beat < due) wake.current = requestAnimationFrame(next);
      else {
        wake.current = null;
        invalidate();
      }
    };
    wake.current = requestAnimationFrame(next);
  }, -1);

  return (
    <group name="people">
      <primitive object={crowd.shadows.mesh} />
      {cast.map((m) => (
        <Person
          key={m.key}
          member={m}
          crowd={crowd}
          selected={selectedKey === m.key || askKey === m.key}
          onSelect={() => (m.item !== null && shell ? shell.open(itemPath(m.item)) : onSelect(m.target))}
        />
      ))}
    </group>
  );
}
