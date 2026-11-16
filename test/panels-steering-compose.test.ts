import { describe, expect, it } from 'vitest';
import { STAKEHOLDER } from '../src/core/company.ts';
import {
  boxLabelFor,
  choiceOf,
  choicesAround,
  forChoices,
  groupSends,
  reachOf,
  recipientChoices,
  recipientFromPath,
  recipientKey,
  recipientTitle,
  roomTitle,
  sendHint,
  sendPath,
  sentLine,
  usesSay,
} from '../web/src/company/compose/recipients.ts';
import { hourMinute } from '../web/src/lib/format.ts';
import { audience, copy } from './panels-steering-kit.ts';
import { company, desk, message, min, NOW, studio, update } from './panels-work-kit.ts';

const snap = { studio };

describe('who a message can go to', () => {
  it('offers everyone, each room, each team under a head or lead, and each person, in the org’s order', () => {
    const c = recipientChoices(snap, company());
    expect(c.everyone).toMatchObject({ key: 'everyone', label: 'Everyone, eight people', title: 'everyone' });
    expect(c.rooms.map((r) => [r.key, r.label])).toEqual([
      ['room:direction', 'The direction room, two people'],
      ['room:engineering', 'The engineering room, four people'],
      ['room:design', 'The design room, two people'],
    ]);
    // The CEO's team would be everyone, so it isn't offered; a lead with people is.
    expect(c.teams.map((t) => [t.key, t.label])).toEqual([
      ['team:head-of-engineering', "Ben's team, four people"],
      ['team:frontend-lead', "Ola's team, two people"],
      ['team:head-of-design', "Ada's team, two people"],
    ]);
    expect(c.people.map((p) => p.label)).toEqual(['Noor, CEO', 'Tia, office manager', 'Ben, head of engineering', 'QA engineer', 'Ola, frontend lead', 'Kai, frontend engineer', 'Ada, head of design', 'Mina, UI designer']);
  });

  it('reaches the people each recipient names', () => {
    const c = company();
    expect(reachOf(snap, c, { kind: 'room', id: 'design' })).toEqual(['head-of-design', 'ui-designer']);
    expect(reachOf(snap, c, { kind: 'team', head: 'head-of-engineering' })).toEqual(['head-of-engineering', 'qa-engineer', 'frontend-lead', 'frontend-engineer']);
    expect(reachOf(snap, c, { kind: 'person', id: 'frontend-engineer' })).toEqual(['frontend-engineer']);
    expect(reachOf(snap, c, { kind: 'person', id: 'gone' })).toEqual([]);
    expect(reachOf(snap, c, { kind: 'team', head: 'gone' })).toEqual([]);
    expect(reachOf(snap, c, { kind: 'everyone' })).toHaveLength(8);
  });

  it('names each recipient inside a sentence and on the box', () => {
    const c = company();
    expect(recipientTitle(snap, c, { kind: 'team', head: 'head-of-design' })).toBe("Ada's team");
    expect(recipientTitle(snap, c, { kind: 'person', id: 'qa-engineer' })).toBe('the QA engineer');
    expect(boxLabelFor(snap, c, { kind: 'room', id: 'engineering' })).toBe('Message the engineering room');
    expect(sentLine(snap, c, { kind: 'everyone' })).toBe('Sent to everyone.');
    expect(roomTitle({ studio: { ...studio, departments: [{ id: 'data', name: 'Data & AI', style: 'data' }] } }, 'data')).toBe('the data & AI room');
    // A room already named one isn't a room twice; a word that only ends in "room" still gets it.
    const named = (name: string) => roomTitle({ studio: { ...studio, departments: [{ id: 'x', name, style: 'direction' }] } }, 'x');
    expect(named('Games room')).toBe('the games room');
    expect(named('Meeting Room')).toBe('the meeting room');
    expect(named('Mushroom')).toBe('the mushroom room');
  });

  it("offers only what reaches the person whose panel it is in", () => {
    const around = choicesAround(recipientChoices(snap, company()), 'frontend-engineer');
    expect(around.rooms.map((c) => c.key)).toEqual(['room:engineering']);
    expect(around.teams.map((c) => c.key)).toEqual(['team:head-of-engineering', 'team:frontend-lead']);
    expect(around.people.map((c) => c.key)).toEqual(['person:frontend-engineer']);
    expect(around.everyone.key).toBe('everyone');
  });

  it('finds a choice again by its key, and nothing for someone who left', () => {
    const choices = recipientChoices(snap, company());
    expect(choiceOf(choices, recipientKey({ kind: 'team', head: 'frontend-lead' }))?.title).toBe("Ola's team");
    expect(choiceOf(choices, 'person:gone')).toBeNull();
  });
});

describe('what the box says will happen', () => {
  it('uses the person panel’s words for one person', () => {
    const c = update(company(), 'frontend-engineer', { desk: desk('working') });
    expect(sendHint(snap, c, { kind: 'person', id: 'frontend-engineer' }, [])).toBe('Kai reads it at their next step.');
    expect(sendHint(snap, c, { kind: 'person', id: 'head-of-design' }, ['ui-designer'])).toBe("Ada passes it on. It's for Mina: its trace flags anyone it doesn't reach.");
  });

  it('names who gets a copy for a room or a team, and gathers everyone', () => {
    const c = company();
    expect(sendHint(snap, c, { kind: 'room', id: 'design' }, [])).toBe('Ada and Mina get it. Busy people read it at their next step; the others start on it now.');
    expect(sendHint(snap, c, { kind: 'everyone' }, [])).toBe('All eight people get it, and gather in the office for a moment. Busy people read it at their next step; the others start on it now.');
    const paused = company({ pause: { reason: 'usage-limit', since: NOW - min(5), until: NOW + min(60), message: '' } });
    expect(sendHint(snap, paused, { kind: 'room', id: 'design' }, [])).toBe(`Ada and Mina get it. They read it when the company wakes at ${hourMinute(NOW + min(60))}.`);
    expect(sendHint(snap, c, { kind: 'room', id: 'empty' }, [])).toBe('Nobody is there yet, so there is nobody to send it to.');
  });

  it('sends a plain message to one person the way it always went, and the rest through steering', () => {
    expect(usesSay({ kind: 'person', id: 'frontend-engineer' }, [])).toBe(true);
    expect(usesSay({ kind: 'person', id: 'ceo' }, ['ui-designer'])).toBe(false);
    expect(usesSay({ kind: 'room', id: 'design' }, [])).toBe(false);
  });

  it("offers everyone it isn't for yet", () => {
    expect(forChoices(snap, company(), ['ui-designer', 'ceo']).map((p) => p.id)).not.toContain('ui-designer');
    expect(forChoices(snap, company(), [])).toHaveLength(8);
  });
});

describe("the composer's address", () => {
  it.each([
    [{ kind: 'everyone' } as const, 'send/everyone'],
    [{ kind: 'room', id: 'design' } as const, 'send/room/design'],
    [{ kind: 'team', head: 'head-of-design' } as const, 'send/team/head-of-design'],
    [{ kind: 'person', id: 'a b' } as const, 'send/person/a%20b'],
  ])('goes to %o and back', (recipient, path) => {
    expect(sendPath(recipient)).toBe(path);
    expect(recipientFromPath(path.split('/').slice(1))).toEqual(recipient);
  });

  it('names nobody for a path it does not know', () => {
    expect(sendPath(null)).toBe('send');
    expect(recipientFromPath([])).toBeNull();
    expect(recipientFromPath(['room'])).toBeNull();
    expect(recipientFromPath(['person', '%E0%A4%A'])).toBeNull();
    expect(recipientFromPath(['planet', 'mars'])).toBeNull();
  });
});

describe('your messages to rooms and everyone', () => {
  it('lists one line per group, newest first, leaving out messages to one person and relays', () => {
    const room = audience('room', 'design', 'the design room', 'g-1');
    const all = audience('everyone', null, 'everyone', 'g-2');
    const messages = [
      copy('m1', 'head-of-design', 'Darker.', room, { at: NOW - min(30) }),
      copy('m2', 'ui-designer', 'Darker.', room, { at: NOW - min(30) }),
      copy('m3', 'ceo', 'Launch Monday.', all, { at: NOW - min(5) }),
      message('m4', STAKEHOLDER, 'frontend-engineer', 'Hi.', { at: NOW - min(1) }),
      message('m5', 'head-of-design', 'ui-designer', 'Darker.', { at: NOW - min(20), relayOf: 'm1', origin: STAKEHOLDER, audience: room }),
    ];
    expect(groupSends(company({ messages }))).toEqual([
      { group: 'g-2', to: 'Everyone', title: 'everyone', text: 'Launch Monday.', at: NOW - min(5), copies: 1 },
      { group: 'g-1', to: 'The design room', title: 'the design room', text: 'Darker.', at: NOW - min(30), copies: 2 },
    ]);
  });
});
