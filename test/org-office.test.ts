import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { loadLibrary } from '../src/composer/library.ts';
import { type OfficeChange, OrgRefusal } from '../src/core/company.ts';
import { applyOfficeChange, MAX_OFFICE_ROOMS } from '../src/core/org.ts';
import { orgOps } from '../src/org/index.ts';
import { tempDir } from './library-kit.ts';
import { CAFE_PROMPT, cafeProposal, read, studioOf } from './org-kit.ts';

// Each case writes a whole studio (agents, rules, skills, the org) to disk and reads it back: about 2 s alone, much
// slower while the full suite saturates the machine.
vi.setConfig({ testTimeout: 120_000 });

const library = loadLibrary();
const ops = orgOps(library);

function company(): string {
  const root = tempDir();
  ops.found(root, CAFE_PROMPT);
  const checked = ops.check(cafeProposal(), { preset: 'thorough' });
  if (!checked.ok) throw new Error(checked.errors.join('\n'));
  ops.write(root, checked.proposal);
  return root;
}

function snapshot(root: string): Record<string, string> {
  const files: Record<string, string> = {};
  for (const entry of readdirSync(root, { recursive: true, encoding: 'utf8' })) {
    const path = join(root, entry);
    if (statSync(path).isFile()) files[entry.replaceAll('\\', '/')] = readFileSync(path, 'utf8');
  }
  return files;
}

const manifest = (root: string) => read(root, '.claude/studio.yaml');

/** A refused office change: the sentence, and every file as it was. */
function refuses(root: string, change: unknown, message: string, code = 'invalid') {
  const before = snapshot(root);
  let error: unknown;
  try {
    ops.changeOffice(root, change as OfficeChange);
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(OrgRefusal);
  expect({ code: (error as OrgRefusal).code, message: (error as OrgRefusal).message }).toEqual({ code, message });
  expect(snapshot(root)).toEqual(before);
}

describe('changing the office', () => {
  it('adds a games room with an arcade theme, and removing it undoes it', () => {
    const root = company();
    const before = manifest(root);
    const change: OfficeChange = { change: 'add-room', room: { id: 'games', title: 'Games room', kind: 'games', theme: 'arcade' } };
    const planned = applyOfficeChange(studioOf(root), change);
    expect(planned).toMatchObject({ ok: true, undo: { change: 'remove-room', room: 'games' } });
    expect(ops.changeOffice(root, change)).toEqual({
      ok: true,
      message: 'Added Games room with the arcade theme. Remove the room to undo it.',
      changed: ['.claude/studio.yaml'],
    });
    expect(studioOf(root).office?.rooms.at(-1)).toEqual({ id: 'games', title: 'Games room', kind: 'games', theme: 'arcade' });
    if (!planned.ok) throw new Error(planned.error);
    expect(ops.changeOffice(root, planned.undo).message).toBe('Removed Games room. Adding it back undoes it.');
    expect(manifest(root)).toBe(before);
  });

  it('refuses a room the office can’t have, and changes nothing', () => {
    const root = company();
    const room = (r: Record<string, unknown>) => ({ change: 'add-room', room: { id: 'games', title: 'Games room', kind: 'games', ...r } });
    refuses(root, room({ kind: 'ballroom' }), 'A room\'s kind is one of meeting, ceo, reception, lounge, games, kitchen, not "ballroom".');
    refuses(root, room({ theme: 'castle' }), 'A room\'s theme is one of office, cafe, game-studio, shop, lab, garden, city, arcade, music-studio, not "castle".');
    refuses(root, room({ id: 'Games Room' }), 'A room\'s id is lowercase letters, digits and hyphens, like "games-room"; got "Games Room".');
    refuses(root, room({ id: 'design' }), 'There is a room called "design" already.');
    refuses(root, room({ id: 'meeting' }), 'There is a room called "meeting" already.');
    refuses(root, room({ id: 'copywriter' }), '"copywriter" is someone\'s id; give the room another one.');
    refuses(root, room({ title: 'A games room with a pinball machine and two arcade cabinets' }), "A room's title is up to 40 characters; this one has 59.");
    refuses(root, { change: 'add-room', room: 'games' }, 'A new room needs an id, a title and a kind.');
    refuses(root, { change: 'remove-room', room: 'design' }, "Design is a department's room; only rooms that aren't a department's, like the meeting room, can be removed.");
    refuses(root, { change: 'remove-room', room: 'attic' }, 'There is no "attic" room to remove.', 'unknown');
    refuses(root, { change: 'paint', colour: 'blue' }, 'An office change is one of theme, add-room, remove-room, room-theme, decor or look.');
  });

  it(`holds up to ${MAX_OFFICE_ROOMS} rooms besides the departments’`, () => {
    const root = company();
    for (let i = 3; i <= MAX_OFFICE_ROOMS; i++) ops.changeOffice(root, { change: 'add-room', room: { id: `lounge-${i}`, title: `Lounge ${i}`, kind: 'lounge' } });
    expect(studioOf(root).office?.rooms).toHaveLength(MAX_OFFICE_ROOMS);
    refuses(root, { change: 'add-room', room: { id: 'one-more', title: 'One more', kind: 'lounge' } }, "The office has 12 rooms besides the departments'. Remove one to add another.");
  });

  it('changes the theme and a room’s theme, saying how to undo each', () => {
    const root = company();
    expect(ops.changeOffice(root, { change: 'theme', theme: 'game-studio' }).message).toBe("The office's theme is game studio now (it was café). Set it back to café to undo it.");
    expect(ops.changeOffice(root, { change: 'theme', theme: 'game-studio' })).toEqual({ ok: true, message: "The office's theme is game studio already.", changed: [] });
    expect(ops.changeOffice(root, { change: 'room-theme', room: 'design', theme: null }).message).toBe("Design follows the office's theme now. Set it back to café to undo it.");
    expect(ops.changeOffice(root, { change: 'room-theme', room: 'meeting', theme: 'lab' }).message).toBe("Meeting room has the lab theme now. Set it back to the office's theme to undo it.");
    const studio = studioOf(root);
    expect(studio.office?.theme).toBe('game-studio');
    expect(studio.departments.find((d) => d.id === 'design')?.theme).toBeUndefined();
    expect(studio.office?.rooms.find((r) => r.id === 'meeting')?.theme).toBe('lab');
    refuses(root, { change: 'theme', theme: 'castle' }, "The office's theme is one of office, cafe, game-studio, shop, lab, garden, city, arcade, music-studio, not \"castle\".");
    refuses(root, { change: 'room-theme', room: 'attic', theme: 'lab' }, 'There is no "attic" room.', 'unknown');
  });

  it('adds and removes decor, up to 40 pieces', () => {
    const root = company();
    expect(ops.changeOffice(root, { change: 'decor', add: ['plants', 'espresso-bar'], remove: [] }).message).toBe('Added plants and espresso bar to the office. Removing them undoes it.');
    expect(ops.changeOffice(root, { change: 'decor', add: ['lamp'], remove: ['plants'] }).message).toBe('Added lamp and removed plants. Swapping them back undoes it.');
    expect(studioOf(root).office?.decor).toEqual(['espresso-bar', 'lamp']);
    refuses(root, { change: 'decor', add: [], remove: ['rug'] }, 'There is no "rug" in the office to remove.', 'unknown');
    refuses(root, { change: 'decor', add: ['Big Plant'], remove: [] }, 'A decor piece is an id like "plants"; got "Big Plant".');
    refuses(root, { change: 'decor', add: [], remove: [] }, 'Name a piece to add or remove.');
    refuses(root, { change: 'decor', add: Array.from({ length: 39 }, (_, i) => `piece-${i}`), remove: [] }, 'The office holds 40 pieces. Remove one to add another.');
  });

  it('changes a person’s look through the look checks', () => {
    const root = company();
    expect(ops.changeOffice(root, { change: 'look', person: 'ui-designer', look: { body: 'mage', color: '#3E5B4E' } }).message).toBe(
      'Changed the look of Kai, UI designer. Setting it back undoes it.',
    );
    expect(studioOf(root).roles.find((r) => r.id === 'ui-designer')?.look).toEqual({ body: 'mage', color: '#3e5b4e' });
    refuses(root, { change: 'look', person: 'ui-designer', look: { color: 'red' } }, 'That look doesn\'t fit: look.color: expected a colour like #3e5b4e, got "red".');
    refuses(root, { change: 'look', person: 'nobody', look: {} }, '"nobody" is not on the staff.', 'unknown');
  });

  it('undoes every kind of change exactly', () => {
    const root = company();
    const changes: OfficeChange[] = [
      { change: 'theme', theme: 'arcade' },
      { change: 'add-room', room: { id: 'kitchen', title: 'Kitchen', kind: 'kitchen' } },
      { change: 'remove-room', room: 'meeting' },
      { change: 'room-theme', room: 'engineering', theme: 'lab' },
      { change: 'decor', add: ['plants', 'plants'], remove: [] },
      { change: 'look', person: 'ui-designer', look: { prop: 'headset' } },
      { change: 'look', person: 'copywriter', look: { skin: 2 } },
    ];
    for (const change of changes) {
      const before = manifest(root);
      const planned = applyOfficeChange(studioOf(root), change);
      if (!planned.ok) throw new Error(planned.error);
      ops.changeOffice(root, change);
      expect(manifest(root), change.change).not.toBe(before);
      ops.changeOffice(root, planned.undo);
      expect(manifest(root), change.change).toBe(before);
    }
  });

  it('gives a company that has only its CEO an office on the first change', () => {
    const root = tempDir();
    ops.found(root, CAFE_PROMPT);
    ops.changeOffice(root, { change: 'add-room', room: { id: 'games', title: 'Games room', kind: 'games', theme: 'arcade' } });
    expect(studioOf(root).office).toEqual({ theme: 'office', rooms: [{ id: 'games', title: 'Games room', kind: 'games', theme: 'arcade' }], decor: [] });
  });
});
