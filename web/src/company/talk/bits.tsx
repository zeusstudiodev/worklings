// Small pieces the talk bar, the strip and the feed share: their glyphs (design-hud, "Icons": a 20-unit grid, 1.8
// stroke, round caps, the current colour; never alone without a name) and who a face shows for a recipient or an id.
import { type CompanyView, STAKEHOLDER } from '../../../../src/core/company.ts';
import type { Snapshot } from '../../../../src/core/snapshot.ts';
import type { Recipient } from '../../../../src/core/steering.ts';
import { Face, type FaceOf, type FaceSize, roomHue } from '../ui/Face.tsx';

const PATHS = {
  send: 'M3 9.4 16.8 3.2 12.6 17 9.6 10.4zM9.6 10.4l7.2-7.2',
  feed: 'M3 4.8A1.8 1.8 0 0 1 4.8 3h7.4A1.8 1.8 0 0 1 14 4.8v4.4A1.8 1.8 0 0 1 12.2 11H7.5L4.5 13.5V11A1.8 1.8 0 0 1 3 9.2zM14 7.5h1.2A1.8 1.8 0 0 1 17 9.3v4a1.8 1.8 0 0 1-1.8 1.8h-.2v2.4L12 15.1H9.3A1.8 1.8 0 0 1 7.5 13.3V13',
  down: 'm6 8 4 4 4-4',
  close: 'm5 5 10 10M15 5 5 15',
  stop: 'M5.5 4.5h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z',
  command: 'M7 4.5A2.5 2.5 0 1 0 4.5 7H7zM13 4.5A2.5 2.5 0 1 1 15.5 7H13zM7 15.5A2.5 2.5 0 1 1 4.5 13H7zM13 15.5a2.5 2.5 0 1 0 2.5-2.5H13zM7 7h6v6H7z',
  relay: 'M3.5 10h12M11.5 6l4 4-4 4',
  stall: 'M10 3.5a6.5 6.5 0 1 0 0 13a6.5 6.5 0 1 0 0-13M10 6.5V10l2.5 1.5',
  check: 'm4.5 10.5 3.5 3.5 7.5-8',
  warning: 'M10 3.2 17.5 16.5h-15zM10 8v4M10 14.3v.2',
} as const;

export type GlyphName = keyof typeof PATHS;

export function Glyph({ name, size = 20, className }: { name: GlyphName; size?: 14 | 16 | 20; className?: string }) {
  return (
    <svg className={`tglyph${className ? ` ${className}` : ''}`} width={size} height={size} viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d={PATHS[name]} />
    </svg>
  );
}

/** Your words, as the office carries them: a small yellow paper with two ink lines (game-feel's note). */
export function Paper({ white = false }: { white?: boolean }) {
  return <span className={`tpaper${white ? ' tpaper--white' : ''}`} aria-hidden="true" />;
}

type Studio = Pick<Snapshot, 'studio'>;

/** Who a face shows for a recipient: the person, a room on its hue, a team, all hands. */
export function faceOfRecipient(snapshot: Studio, company: Pick<CompanyView, 'people'>, r: Recipient): FaceOf {
  switch (r.kind) {
    case 'person': {
      const p = company.people.find((x) => x.id === r.id);
      return p ? { kind: 'person', person: p, hue: roomHue(snapshot, p.room) } : { kind: 'visitor' };
    }
    case 'room':
      return { kind: 'room', hue: roomHue(snapshot, r.id) };
    case 'team':
      return { kind: 'team' };
    case 'everyone':
      return { kind: 'everyone' };
  }
}

/** Who a face shows for someone by id: a person, you, or for the office and anyone who left, a plain disc. */
export function faceOfId(snapshot: Studio, company: Pick<CompanyView, 'people'>, id: string): FaceOf {
  if (id === STAKEHOLDER) return { kind: 'you' };
  const p = company.people.find((x) => x.id === id);
  return p ? { kind: 'person', person: p, hue: roomHue(snapshot, p.room) } : { kind: 'room', hue: null };
}

/** Up to three faces overlapping, for several picks or a burst. */
export function Faces({ faces, size }: { faces: readonly FaceOf[]; size: FaceSize }) {
  return (
    <span className="tfaces" aria-hidden="true">
      {faces.slice(0, 3).map((f, i) => (
        <Face key={i} of={f} size={size} />
      ))}
    </span>
  );
}
