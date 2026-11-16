// A face wherever someone is named (docs/design-v3.md, "Stage and dock", decision 7; docs/design-hud.md, "Faces"): a
// disc in their room's hue with their portrait, baked by the stage's renderer (scene/portraits). Until one is baked, or where there is no stage or no WebGL, a person is their first letter on their
// room's paper. You, a room, a team, all hands and a visitor are a glyph on a disc. A face is decorative, since the words
// beside it name who it is; pass `label` where nothing does.
import type { Person } from '../../../../src/core/company.ts';
import type { Snapshot } from '../../../../src/core/snapshot.ts';
import { usePortrait } from '../../scene/portraits/usePortrait.ts';
import './face.css';

export type FaceSize = 16 | 20 | 24 | 28 | 32 | 40 | 64;

/** The state mark at a face's foot. The words beside it always say the state too. */
export type FaceMark = 'ok' | 'needs' | 'waiting' | 'stuck' | 'rest';

/** Who a face shows. `hue` is a room's style ('design', 'engineering'), as roomHue gives it; null for none. */
export type FaceOf =
  | { kind: 'person'; person: Pick<Person, 'id' | 'name' | 'look'>; hue: string | null }
  | { kind: 'you' }
  | { kind: 'room'; hue: string | null }
  | { kind: 'team' }
  | { kind: 'everyone' }
  | { kind: 'visitor' };

export interface FaceProps {
  of: FaceOf;
  size: FaceSize;
  mark?: FaceMark | null;
  /** The highlighter ring of someone who needs you, as their bubble turns yellow in the office. */
  needsYou?: boolean;
  /** The face's name, where nothing beside it names who it is; without it the face is hidden from screen readers. */
  label?: string;
}

/** A room's style for `data-hue` ("design"), from the studio's departments; null for a room it doesn't know. */
export function roomHue(snapshot: Pick<Snapshot, 'studio'>, room: string): string | null {
  return snapshot.studio?.departments.find((d) => d.id === room)?.style ?? null;
}

/** A name's first letter, a whole character even outside the Basic Multilingual Plane. */
export function initialOf(name: string): string {
  const first = Array.from(name.trim())[0];
  return first ? first.toLocaleUpperCase() : '?';
}

/** The glyphs of design-hud's set (a 20-unit grid, 1.8 stroke): a room's house, a team, all hands' megaphone, a visitor. */
const GLYPHS = {
  room: 'M3 17V5.5L10 3l7 2.5V17M7.5 17v-5h5v5',
  team: 'M4.4 7a2.6 2.6 0 1 0 5.2 0a2.6 2.6 0 1 0-5.2 0M11.3 7.5a2.2 2.2 0 1 0 4.4 0a2.2 2.2 0 1 0-4.4 0M2.5 16.5c.3-3 2.1-5 4.5-5s4.2 2 4.5 5M12 11.6c.5-.2 1-.3 1.5-.3 2 0 3.6 1.7 4 4.7',
  everyone: 'M3.5 8.2v3.6h3l6.5 3.7V4.5L6.5 8.2zM15.5 7.5a3.6 3.6 0 0 1 0 5M6.5 11.8l1 4.2',
  visitor: 'M6.7 6.3a3.3 3.3 0 1 0 6.6 0a3.3 3.3 0 1 0-6.6 0M3.8 17.5c.4-3.6 2.9-6 6.2-6s5.8 2.4 6.2 6z',
} as const;

export function Face({ of, size, mark = null, needsYou = false, label }: FaceProps) {
  const hue = of.kind === 'person' || of.kind === 'room' ? of.hue : null;
  const className = `face face--${size} face--${of.kind}${needsYou ? ' face--needs' : ''}`;
  const portrait = usePortrait(of.kind === 'person' ? of.person.id : null);
  const named = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true };
  return (
    <span className={className} data-hue={hue ?? undefined} {...named}>
      {of.kind === 'person' ? (
        portrait ? (<img className="face__portrait" src={portrait} alt="" draggable={false} />) : (<span className="face__initial">{initialOf(of.person.name)}</span>)
      ) : of.kind === 'you' ? (
        <span className="face__you">You</span>
      ) : (
        <svg className="face__glyph" viewBox="0 0 20 20" aria-hidden="true">
          <path d={GLYPHS[of.kind]} />
        </svg>
      )}
      {mark && <span className={`face__mark face__mark--${mark}`} />}
    </span>
  );
}
